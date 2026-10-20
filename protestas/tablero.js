/* =========================================================
   Tablero de Protestas sociales — Observatorio para la Democracia
   y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, generado por procesos/protestas/procesar.py
   a partir de la Base de Eventos de Protesta del Perú.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`. Los controles solo modifican `estado`.

   Parámetros de URL (para enlazar o incrustar una vista concreta):
     ?modulo=general|actores|acciones|adversarios|reclamos
     &region=CUSCO          región elegida (código en mayúsculas)
     &desde=2000&hasta=2025 período
     &acciones=0-3          categorías elegidas de cada módulo (índices)
     &embed=1               oculta título y pie (para un iframe)
   ========================================================= */

const MODULOS = ["general", "actores", "acciones", "adversarios", "reclamos"];

// Módulos con filtro propio: tabla, campo de la categoría y textos
const CONFIG = {
  actores: {
    tabla: "actores", dim: "tipo", dic: "tipo_sector",
    etiqueta: "Tipo de actor", todos: "Todos los tipos", nombreDim: "Tipo de actor", femenino: false,
    total: "Participaciones de actores", unidad: "participaciones de actores",
    uno: (n) => `Participaciones de ${Obs.minus(n)}`,
  },
  acciones: {
    tabla: "acciones", dim: "accion", dic: "accion",
    etiqueta: "Acciones", todos: "Todas las acciones", nombreDim: "Acción", femenino: true,
    total: "Acciones registradas", unidad: "acciones",
    uno: (n) => `Acciones de tipo ${Obs.minus(n)}`,
  },
  adversarios: {
    tabla: "adversarios", dim: "adversario", dic: "adversario",
    etiqueta: "Adversarios", todos: "Todos los adversarios", nombreDim: "Adversario", femenino: false,
    total: "Eventos de protesta", unidad: "eventos",
    uno: (n) => `Eventos contra ${n}`,
    detalle: [["adversario", "Adversario"], ["institucion", "Institución"]],
  },
  reclamos: {
    tabla: "reclamos", dim: "reclamo", dic: "reclamo",
    etiqueta: "Reclamos", todos: "Todos los reclamos", nombreDim: "Reclamo", femenino: false,
    total: "Eventos de protesta", unidad: "eventos",
    uno: (n) => `Eventos por reclamos ${Obs.minus(n)}`,
    detalle: [["reclamo", "Reclamo"], ["subreclamo", "Subreclamo"]],
  },
};
CONFIG.actores.detalle = [["sector", "Sector"], ["actor", "Actor"]];

const ARCHIVOS = [
  { clave: "protestas_base_completa", etiqueta: "Base completa de eventos (1980-2025)" },
  { clave: "protestas_actores", etiqueta: "Actores" },
  { clave: "protestas_acciones", etiqueta: "Acciones" },
  { clave: "protestas_adversarios", etiqueta: "Adversarios" },
  { clave: "protestas_reclamos", etiqueta: "Reclamos" },
];

const estado = {
  modulo: "general",
  ambito: "nacional",     // "nacional" o "regional" (muestra la lista de regiones)
  region: "NACIONAL",
  desde: null,
  hasta: null,
  cat: {},                // módulo -> Set de categorías elegidas (índices del diccionario)
};

let D;                    // datos.json
const T = {};             // tablas expandidas en filas
let ANIOS = [];
const REGION_INDICE = new Map();
const mapas = {};
let controles, multis = {};

/* ---------------------------------------------------------
   Utilidades
   --------------------------------------------------------- */
const nombreRegion = (cod) => (cod === "NACIONAL" ? "Total nacional" : D.regiones.find((r) => r.region === cod)?.nombre ?? cod);
const codigoRegion = (i) => D.regiones[i].region;
const enAmbito = (cod) => (cod === "NACIONAL" ? "A nivel nacional" : `En ${nombreRegion(cod)}`);
const enLugar = (cod) => (cod === "NACIONAL" ? "a nivel nacional" : `en ${nombreRegion(cod)}`);
// "más frecuente" / "más frecuente entre los elegidos", con el género de la categoría
const masFrecuente = (cfg, todas) => `más frecuente${todas ? "" : cfg.femenino ? " entre las elegidas" : " entre los elegidos"}`;
const textoPeriodo = () => (estado.desde === estado.hasta ? `en ${estado.desde}` : `entre ${estado.desde} y ${estado.hasta}`);
const etiquetaDic = (dic, i) => D.dic[dic][i];
const todasElegidas = (m) => estado.cat[m].size === D.dic[CONFIG[m].dic].length;

// Años del período elegido: los gráficos anuales muestran solo estos años
const aniosPeriodo = () => ANIOS.filter((a) => a >= estado.desde && a <= estado.hasta);
// Serie anual del período a partir de filas
const anual = (filas) => {
  const m = Obs.sumarPor(filas, "anio");
  return aniosPeriodo().map((a) => m.get(a) ?? 0);
};
const mayor = (mapa) => [...mapa].sort((a, b) => b[1] - a[1])[0];

/* ---------------------------------------------------------
   filtrar(): función pura. Recibe las tablas y el estado y devuelve
   los subconjuntos que necesita el módulo activo. Cada gráfico usa
   el subconjunto que ignora su propio filtro:
     principal    período + región + categorías
     todasLasCat  período + región (barras de la propia categoría)
     regiones     período + categorías (mapa y ranking regional)
   --------------------------------------------------------- */
function filtrar(tablas, e) {
  const cfg = CONFIG[e.modulo];
  const filas = cfg ? tablas[cfg.tabla] : tablas.eventos;
  const cat = cfg ? e.cat[e.modulo] : null;
  const enAnios = (f) => f.anio >= e.desde && f.anio <= e.hasta;
  const enCat = (f) => !cat || cat.has(f[cfg.dim]);
  const i = REGION_INDICE.get(e.region);
  const enRegion = e.region === "NACIONAL" ? () => true : (f) => f.region === i;
  return {
    principal: filas.filter((f) => enAnios(f) && enCat(f) && enRegion(f)),
    todasLasCat: filas.filter((f) => enAnios(f) && enRegion(f)),
    regiones: filas.filter((f) => enAnios(f) && enCat(f)),
  };
}

/* ---------------------------------------------------------
   Piezas compartidas por los módulos
   --------------------------------------------------------- */

// Mapa coroplético + ranking regional (ignora la región elegida; la resalta)
function pintarRegiones(m, filas, unidad) {
  const porRegion = Obs.sumarPor(filas, (f) => codigoRegion(f.region));
  if (!mapas[m]) mapas[m] = new Obs.Mapa(`mapa-${m}`, Obs._geoDatos, { alClic: elegirRegion, nombre: nombreRegion });
  const escala = Obs.tema().escala;
  const cortes = Obs.cortesCuantiles([...porRegion.values()]);
  mapas[m].pintar({
    valores: porRegion,
    color: (v) => Obs.colorTramo(v, cortes, escala),
    texto: (v) => `${Obs.fmtN(v)} ${unidad}`,
    elegida: estado.region,
  });
  Obs.leyendaTramos(`ley-${m}`, cortes, escala);
  const orden = [...porRegion].sort((a, b) => b[1] - a[1]);
  Obs.tabla(`t-${m}-regiones`,
    [{ titulo: "#", campo: "pos" }, { titulo: "Región", campo: "nombre" }, { titulo: "Cantidad", campo: "n", num: true }],
    orden.map(([region, n], i) => ({ pos: String(i + 1), region, nombre: nombreRegion(region), n })),
    { total: { n: Obs.total(filas) }, alClic: elegirRegion, elegida: estado.region });
}

// Evolución anual, solo con los años del período
function pintarEvolucion(id, seriesDe, sub) {
  Obs.lineas(id, aniosPeriodo(), [{ titulo: nombreRegion(estado.region), series: seriesDe(sub.principal) }], { altoPanel: 320 });
}

/* Colores fijos por categoría: las 5 primeras del diccionario (las más
   frecuentes de toda la base) tienen color propio; si se eligen otras,
   toman los colores libres en orden. Así el color sigue a la categoría. */
function coloresCategorias(cats) {
  const n = Obs.tema().categorias.length;
  const usados = new Set(cats.filter((c) => c < n));
  const libres = [...Array(n).keys()].filter((i) => !usados.has(i));
  const colores = new Map();
  for (const c of cats) colores.set(c, c < n ? Obs.colorCategoria(c) : libres.length ? Obs.colorCategoria(libres.shift()) : Obs.tema().otros);
  return colores;
}

// Series por categoría: las elegidas si son 5 o menos; si no, las 5 más frecuentes del período + "Otras"
function seriesPorCategoria(m, referencia) {
  const cfg = CONFIG[m];
  const totales = Obs.sumarPor(referencia, cfg.dim);
  const elegidas = [...estado.cat[m]].sort((a, b) => (totales.get(b) ?? 0) - (totales.get(a) ?? 0));
  const top = elegidas.slice(0, 5);
  const resto = elegidas.slice(5);
  const colores = coloresCategorias(top);
  return (filas) => {
    const series = top.map((c) => ({ nombre: etiquetaDic(cfg.dic, c), color: colores.get(c), valores: anual(filas.filter((f) => f[cfg.dim] === c)) }));
    if (resto.length) {
      const otras = new Set(resto);
      series.push({
        nombre: resto.length === 1 ? etiquetaDic(cfg.dic, resto[0]) : `Otras (${resto.length})`,
        color: Obs.tema().otros, valores: anual(filas.filter((f) => otras.has(f[cfg.dim]))),
      });
    }
    return series;
  };
}

// Barras por categoría
function pintarBarras(id, m, campo, dic, filas, { seleccion = null, alClic = null, limite = null } = {}) {
  const porR = Obs.sumarPor(filas, campo);
  const items = [...porR].map(([c, n]) => ({ clave: c, etiqueta: etiquetaDic(dic, c), valor: n }));
  Obs.barras(id, items, { nombre: nombreRegion(estado.region), seleccion, alClic, limite });
  const desc = document.getElementById(`d-${m}-barras`);
  if (desc) desc.textContent = `Número de ${CONFIG[m]?.unidad ?? "eventos"} ${textoPeriodo()}.`;
}

// Tabla de detalle (sector y actor, adversario e institución...): las 15 combinaciones más frecuentes
function pintarDetalle(m, filas) {
  const [[c1, t1], [c2, t2]] = CONFIG[m].detalle;
  const grupos = Obs.sumarPor(filas, (f) => `${f[c1]}|${f[c2]}`);
  const top = [...grupos].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => {
    const [a, b] = k.split("|").map(Number);
    return { uno: etiquetaDic(c1, a), dos: etiquetaDic(c2, b), n };
  });
  if (!top.length) { document.getElementById(`t-${m}-detalle`).innerHTML = '<p class="pista">Sin datos para esta selección.</p>'; return; }
  Obs.tabla(`t-${m}-detalle`,
    [{ titulo: t1, campo: "uno" }, { titulo: t2, campo: "dos" }, { titulo: "Cantidad", campo: "n", num: true }],
    top, { total: { n: Obs.total(filas) } });
}

/* ---------------------------------------------------------
   Módulos
   --------------------------------------------------------- */
function moduloGeneral(sub) {
  const total = Obs.total(sub.principal);
  const nAnios = estado.hasta - estado.desde + 1;
  const porAnio = Obs.sumarPor(sub.principal, "anio");
  const [anioMax, nMax] = mayor(porAnio) ?? ["—", 0];
  Obs.kpi("k-general-1", { etiqueta: "Eventos de protesta", valor: Obs.fmtN(total) });
  Obs.kpi("k-general-2", { etiqueta: "Promedio por año", valor: Obs.fmtN(total / nAnios) });
  Obs.kpi("k-general-3", { etiqueta: "Año con más eventos", texto: String(anioMax), pie: total ? `${Obs.fmtN(nMax)} eventos` : "" });
  document.getElementById("r-general").innerHTML = total
    ? `${enAmbito(estado.region)} se registraron <strong>${Obs.fmtN(total)} eventos de protesta</strong> ${textoPeriodo()}.` +
      (nAnios > 1 ? ` El año con más eventos fue <strong>${anioMax}</strong>, con ${Obs.fmtN(nMax)}.` : "")
    : `${enAmbito(estado.region)} no se registraron eventos de protesta ${textoPeriodo()}.`;

  pintarEvolucion("g-general-evol", (filas) => [{ nombre: "Eventos", color: Obs.tema().unica, valores: anual(filas) }], sub);

  // Por gobierno, en orden cronológico; el clic elige sus años
  const porPres = Obs.sumarPor(sub.principal, "presidente");
  const items = D.presidentes.map((p, i) => ({ clave: i, etiqueta: p.nombre, valor: porPres.get(i) ?? 0 }));
  Obs.barras("g-general-pres", items, {
    ordenar: false, nombre: nombreRegion(estado.region),
    alClic: (i) => actualizar({ desde: D.presidentes[i].desde, hasta: D.presidentes[i].hasta }),
  });
  document.getElementById("d-general-pres").textContent = `Número de eventos en cada período presidencial, ${textoPeriodo()}.`;

  pintarRegiones("general", sub.regiones, "eventos");
}

// Actores, adversarios y reclamos comparten estructura; acciones agrega dos piezas
function moduloCategorias(m, sub) {
  const cfg = CONFIG[m];
  const total = Obs.total(sub.principal);
  const porCat = Obs.sumarPor(sub.principal, cfg.dim);
  const [catMax, nCatMax] = mayor(porCat) ?? [null, 0];
  const uno = estado.cat[m].size === 1 ? [...estado.cat[m]][0] : null;
  const todas = todasElegidas(m);

  Obs.kpi(`k-${m}-1`, {
    etiqueta: uno != null ? cfg.uno(etiquetaDic(cfg.dic, uno)) : cfg.total,
    valor: Obs.fmtN(total),
  });
  Obs.kpi(`k-${m}-2`, {
    etiqueta: `${cfg.nombreDim} ${masFrecuente(cfg, todas)}`,
    texto: catMax != null ? etiquetaDic(cfg.dic, catMax) : "—",
    pie: total ? `${Obs.fmtPct(nCatMax / total)} del total` : "",
  });
  if (m === "acciones") {
    const [anioMax, nAnioMax] = mayor(Obs.sumarPor(sub.principal, "anio")) ?? ["—", 0];
    Obs.kpi(`k-${m}-3`, { etiqueta: "Año con más acciones", texto: String(anioMax), pie: total ? `${Obs.fmtN(nAnioMax)} acciones` : "" });
  } else {
    const c2 = cfg.detalle[1][0];
    const [detMax, nDetMax] = mayor(Obs.sumarPor(sub.principal, c2)) ?? [null, 0];
    Obs.kpi(`k-${m}-3`, {
      etiqueta: `${cfg.detalle[1][1]} más frecuente`,
      texto: detMax != null ? etiquetaDic(c2, detMax) : "—",
      pie: total ? `${Obs.fmtN(nDetMax)} ${cfg.unidad}` : "",
    });
  }

  const nombreTop = catMax != null ? etiquetaDic(cfg.dic, catMax) : "";
  document.getElementById(`r-${m}`).innerHTML = total
    ? `${enAmbito(estado.region)} se registraron <strong>${Obs.fmtN(total)} ${cfg.unidad}</strong> ${textoPeriodo()}` +
      (uno != null ? ` (${Obs.minus(cfg.etiqueta)}: ${Obs.escapar(Obs.minus(nombreTop))}).` :
        `. ${cfg.femenino ? "La" : "El"} ${Obs.minus(cfg.nombreDim)} ${masFrecuente(cfg, todas)} fue <strong>${Obs.escapar(nombreTop)}</strong>, con el ${Obs.fmtPct(nCatMax / total)} del total.`)
    : `${enAmbito(estado.region)} no hay ${cfg.unidad} registrados para esta selección ${textoPeriodo()}.`;

  // Evolución por categoría
  const seriesDe = seriesPorCategoria(m, sub.principal);
  pintarEvolucion(`g-${m}-evol`, seriesDe, sub);
  const descEvol = document.getElementById(`d-${m}-evol`);
  if (descEvol) descEvol.textContent = estado.cat[m].size > 5
    ? `Las cinco categorías más frecuentes ${enLugar(estado.region)} ${textoPeriodo()}; el resto se agrupa en «Otras».`
    : `Número de ${cfg.unidad} por año, ${textoPeriodo()}.`;

  // Barras: actores por sector (respeta el tipo); el resto, por su propia categoría (ignora su filtro y resalta lo elegido)
  if (m === "actores") {
    pintarBarras("g-actores-barras", m, "sector", "sector", sub.principal, { limite: 15 });
  } else {
    pintarBarras(`g-${m}-barras`, m, cfg.dim, cfg.dic, sub.todasLasCat, {
      seleccion: todas ? null : estado.cat[m],
      alClic: (c) => alternarCategoria(m, c),
    });
  }

  if (m === "acciones") {
    Obs.columnas("g-acciones-anual", aniosPeriodo(), anual(sub.principal), { nombre: nombreRegion(estado.region) });
    pintarAccionMasFrecuente(sub.regiones);
  } else {
    pintarDetalle(m, sub.principal);
  }
  pintarRegiones(m, sub.regiones, cfg.unidad);
}

// Mapa categórico: la acción más frecuente en cada región
function pintarAccionMasFrecuente(filas) {
  const porRegion = new Map();
  for (const f of filas) {
    const r = codigoRegion(f.region);
    if (!porRegion.has(r)) porRegion.set(r, new Map());
    const m = porRegion.get(r);
    m.set(f.accion, (m.get(f.accion) ?? 0) + f.n);
  }
  const top = new Map([...porRegion].map(([r, m]) => [r, mayor(m)[0]]));
  const presentes = [...new Set(top.values())].sort((a, b) => a - b);
  const colores = coloresCategorias(presentes);
  if (!mapas["acciones-top"]) mapas["acciones-top"] = new Obs.Mapa("mapa-acciones-top", Obs._geoDatos, { alClic: elegirRegion, nombre: nombreRegion });
  mapas["acciones-top"].pintar({ valores: top, color: (c) => colores.get(c), texto: (c) => etiquetaDic("accion", c), elegida: estado.region });
  Obs.leyendaCategorias("ley-acciones-top", presentes.map((c) => [etiquetaDic("accion", c), colores.get(c)]));
}

const PINTAR = {
  general: moduloGeneral,
  actores: (s) => moduloCategorias("actores", s),
  acciones: (s) => moduloCategorias("acciones", s),
  adversarios: (s) => moduloCategorias("adversarios", s),
  reclamos: (s) => moduloCategorias("reclamos", s),
};

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = "NACIONAL";
  render();
}

function elegirRegion(cod) {
  if (cod === estado.region) actualizar({ ambito: "nacional", region: "NACIONAL" });
  else actualizar({ ambito: "regional", region: cod });
}

// Clic en una barra: si están todas, deja solo esa; si no, la agrega o la quita
function alternarCategoria(m, c) {
  const actual = estado.cat[m];
  let nuevo;
  if (todasElegidas(m)) nuevo = new Set([c]);
  else {
    nuevo = new Set(actual);
    nuevo.has(c) ? nuevo.delete(c) : nuevo.add(c);
    if (!nuevo.size) nuevo = todasCategorias(m);
  }
  actualizar({ cat: { ...estado.cat, [m]: nuevo } });
}
const todasCategorias = (m) => new Set(D.dic[CONFIG[m].dic].map((_, i) => i));

function sincronizarControles() {
  controles.sincronizar(estado);
  for (const m of Object.keys(CONFIG)) multis[m].sincronizar(estado.cat[m], { visible: m === estado.modulo });
  // En General no hay filtro de categoría: se muestra apagado con su nota
  multis.general.sincronizar(new Set(), { visible: estado.modulo === "general", noAplica: true });
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
}

function actualizarURL() {
  const cats = {};
  for (const m of Object.keys(CONFIG)) cats[m] = todasElegidas(m) ? null : [...estado.cat[m]].sort((a, b) => a - b).join("-");
  Obs.escribirURL({
    modulo: estado.modulo === "general" ? null : estado.modulo,
    region: estado.region === "NACIONAL" ? null : estado.region,
    desde: estado.desde === D.anios[0] ? null : estado.desde,
    hasta: estado.hasta === D.anios[1] ? null : estado.hasta,
    ...cats,
  });
}

function render() {
  sincronizarControles();
  PINTAR[estado.modulo](filtrar(T, estado));
  actualizarURL();
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar("protestas", async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo()]);
  D = datos;
  Obs._geoDatos = geo;
  for (const [nombre, tabla] of Object.entries(D.tablas)) T[nombre] = Obs.expandir(tabla);
  D.regiones.forEach((r, i) => REGION_INDICE.set(r.region, i));
  ANIOS = Array.from({ length: D.anios[1] - D.anios[0] + 1 }, (_, i) => D.anios[0] + i);
  document.getElementById("subtitulo").textContent = `Eventos de protesta en el Perú, ${D.anios[0]}-${D.anios[1]}`;
  document.getElementById("fuente").textContent = D.fuente;

  // Estado inicial desde la URL
  const p = Obs.parametros();
  const anio = (v, def) => (Number.isInteger(+v) && +v >= D.anios[0] && +v <= D.anios[1] ? +v : def);
  estado.desde = anio(p.get("desde"), D.anios[0]);
  estado.hasta = Math.max(estado.desde, anio(p.get("hasta"), D.anios[1]));
  if (MODULOS.includes(p.get("modulo"))) estado.modulo = p.get("modulo");
  const reg = (p.get("region") || "").toUpperCase();
  if (REGION_INDICE.has(reg)) Object.assign(estado, { ambito: "regional", region: reg });
  for (const m of Object.keys(CONFIG)) {
    const n = D.dic[CONFIG[m].dic].length;
    const pedidos = (p.get(m) || "").split("-").filter((x) => x !== "").map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < n);
    estado.cat[m] = pedidos.length ? new Set(pedidos) : todasCategorias(m);
  }

  // Controles
  const filtros = document.getElementById("filtros");
  controles = Obs.controlesComunes(filtros, { regiones: D.regiones, anios: D.anios, alCambiar: actualizar, comparar: false });
  for (const [m, cfg] of Object.entries(CONFIG)) {
    multis[m] = new Obs.Multiseleccion(filtros, {
      id: `f-${m}`, etiqueta: cfg.etiqueta, todos: cfg.todos,
      opciones: D.dic[cfg.dic].map((etiqueta, valor) => ({ valor, etiqueta })),
      alCambiar: (sel) => actualizar({ cat: { ...estado.cat, [m]: sel } }),
    });
  }
  multis.general = new Obs.Multiseleccion(filtros, { id: "f-general", etiqueta: "Categoría", todos: "Todas", opciones: [], alCambiar: () => {} });

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    // flechas para moverse entre pestañas
    b.onkeydown = (e) => {
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso) return;
      const sig = pestanas[(i + paso + pestanas.length) % pestanas.length];
      sig.focus();
      sig.click();
    };
  });

  Obs.descarga({ archivos: ARCHIVOS });

  let espera;
  let anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return; // en celular, la barra del navegador cambia solo el alto
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });

  render();
});
