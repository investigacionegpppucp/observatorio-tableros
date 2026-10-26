/* =========================================================
   Tablero de Principales problemas del país — Observatorio para
   la Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script
   (Tableros > Publicar tableros), pestaña «Problemas del país».
   Una fila por año, ámbito y problema: Año (texto), Problema,
   Nivel (Nacional o Regional), region, region_ubicacion, Si y No
   (personas, con factores de expansión), Total, y las proporciones
   Si_p y No_p. El tablero usa Si_p («es un problema»).

   Los valores del Perú son los de la fila Nacional (ponderados por
   población); el informe de Looker mostraba el promedio simple de las
   regiones, que da cifras distintas. Cuando el período abarca varios
   años, se promedian los porcentajes de cada año.

   La región se identifica por su nombre (sin tildes, en mayúsculas),
   como en publica/mapas/peru_regiones.geojson. No se usa
   region_ubicacion: en 2024 San Martín viene con otro código.

   Tres módulos (pestañas): General, ¿Cómo han cambiado? y ¿Dónde se
   mencionan más?. Patrón: un objeto `estado`, una función pura
   `filtrar()` y una sola función `render()`.

   Parámetros de URL:
     ?modulo=general|evolucion|territorio
     &region=CUSCO            región elegida (código en mayúsculas)
     &desde=2018&hasta=2025   período
     &problemas=Corrupción|Delincuencia   problemas del módulo de evolución
     &problema=Pobreza        problema del módulo de territorio
     &embed=1                 oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "principales-problemas";
const MODULOS = ["general", "evolucion", "territorio"];
const ARCHIVOS = [{ clave: "principales_problemas_base", etiqueta: "Principales problemas del país por región y año (2013-2025)" }];
const NACIONAL = "NACIONAL";
const PROBLEMA_INICIAL = "Corrupción";
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const estado = {
  modulo: "general",
  ambito: "nacional",     // "nacional" o "regional" (muestra la lista de regiones)
  region: NACIONAL,
  desde: null,
  hasta: null,
  problemas: new Set(),   // módulo de evolución
  problema: PROBLEMA_INICIAL, // módulo de territorio
};

let FILAS = [], PROBLEMAS = [], REGIONES = [], ANIOS = [], C, controles, multi, multiGeneral, GEO;
const NOMBRE_REGION = new Map([[NACIONAL, "Perú"]]);
const INDICE = new Map();   // "problema|región|año" -> proporción
const FIJO = new Map();     // los cinco problemas más mencionados en el Perú -> posición en la paleta
const mapas = {};

/* ---------------------------------------------------------
   Utilidades
   --------------------------------------------------------- */
const pct = (v) => (v == null ? "—" : `${Obs.fmtN(v * 100, 1)}%`);
const signo = (d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Obs.fmtN(Math.abs(d * 100), 1)}`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
// Códigos del mapa: mayúsculas y sin tildes
const codigo = (nombre) => nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const nombreRegion = (cod) => NOMBRE_REGION.get(cod) ?? cod;
const enAmbito = (cod) => (cod === NACIONAL ? "A nivel nacional" : `En ${nombreRegion(cod)}`);
const enLugar = (cod) => (cod === NACIONAL ? "en el Perú" : `en ${nombreRegion(cod)}`);
const unAnio = () => estado.desde === estado.hasta;
const textoPeriodo = () => (unAnio() ? `en ${estado.desde}` : `entre ${estado.desde} y ${estado.hasta}`);
const enPromedio = () => (unAnio() ? "" : " en promedio");
const aniosPeriodo = () => ANIOS.filter((a) => a >= estado.desde && a <= estado.hasta);
const valor = (p, reg, a) => INDICE.get(`${p}|${reg}|${a}`) ?? null;
// Promedio de los años del período (con el dato de cada año)
const promedio = (p, reg) => {
  const v = aniosPeriodo().map((a) => valor(p, reg, a)).filter((x) => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
// Problemas ordenados del más al menos mencionado en el ámbito y período
const ranking = (reg, lista = PROBLEMAS) => lista.map((p) => ({ problema: p, v: promedio(p, reg) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
const mayor = (filas, campo = "v") => filas.reduce((a, f) => (a == null || f[campo] > a[campo] ? f : a), null);
const menor = (filas, campo = "v") => filas.reduce((a, f) => (a == null || f[campo] < a[campo] ? f : a), null);

/* Colores fijos: los cinco problemas más mencionados en el Perú tienen color propio; si se muestran
   otros, toman los colores libres en orden. Así el color sigue al problema en lo posible. */
function coloresProblemas(lista) {
  const paleta = C.categorias;
  const usados = new Set(lista.filter((p) => FIJO.has(p)).map((p) => FIJO.get(p)));
  const libres = paleta.map((_, i) => i).filter((i) => !usados.has(i));
  const m = new Map();
  for (const p of lista) m.set(p, FIJO.has(p) ? paleta[FIJO.get(p)] : libres.length ? paleta[libres.shift()] : C.otros);
  return m;
}

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const leyendaLineas = (id, series) => {
  document.getElementById(id).innerHTML = series.map((s) =>
    `<span><i class="l${s.referencia ? " gris" : ""}" style="border-color:${s.color}"></i>${Obs.escapar(s.nombre)}</span>`).join("");
};

// Líneas por año con eje de porcentajes. series: [{ nombre, color, valores (por año del período), grueso, referencia }]
function lineas(id, anios, series, aria) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  if (anios.length < 2) return Obs.vacio(id, "Elige un período de dos o más años para ver la evolución");
  if (!todos.length) return Obs.vacio(id);
  const tope = Math.min(1, Math.ceil((Math.max(...todos) + 0.05) * 10) / 10);
  const ancho = document.getElementById(id).clientWidth;
  const pares = (vals) => vals.map((v, i) => [String(anios[i]), v]).filter((p) => p[1] != null); // sin nulos iniciales
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + [...ps].sort((a, b) => b.value[1] - a.value[1])
        .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value[1])}</strong>`).join("") },
    grid: { left: 52, right: 24, top: 30, bottom: 30 },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % (ancho < 420 ? 3 : 2) === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => `${Math.round(v * 100)}%` }) },
    series: series.map((s) => ({
      name: s.nombre, type: "line", data: pares(s.valores), connectNulls: true, symbol: "circle", symbolSize: s.referencia ? 6 : 8, z: s.referencia ? 1 : 3,
      lineStyle: { width: s.grueso ? 3.5 : 2, color: s.color }, itemStyle: { color: s.color, borderColor: "#fff", borderWidth: 1.5 },
      emphasis: s.referencia ? { disabled: true } : { focus: "series" },
    })),
  }, true);
  document.getElementById(id).setAttribute("aria-label", aria);
}

// Mapa coroplético de un porcentaje + tabla de regiones (ignora la región elegida; la resalta)
function pintarMapa(m, filas, nombreProblema) {
  const valores = new Map(filas.map((f) => [f.region, f.v * 100])); // en puntos porcentuales para los cortes
  if (!mapas[m]) mapas[m] = new Obs.Mapa(`mapa-${m}`, GEO, { alClic: elegirRegion, nombre: nombreRegion });
  const cortes = Obs.cortesCuantiles([...valores.values()]);
  mapas[m].pintar({ valores, color: (v) => Obs.colorTramo(v, cortes, C.escala), texto: (v) => pct(v / 100), elegida: estado.region });
  Obs.leyendaTramos(`ley-${m}`, cortes, C.escala, (v) => `${Obs.fmtN(v, 0)}%`);
  Obs.tabla(`t-${m}-regiones`,
    [{ titulo: "#", campo: "pos" }, { titulo: "Región", campo: "nombre" }, { titulo: "Porcentaje", campo: "pct", num: true }],
    filas.map((f, i) => ({ pos: String(i + 1), region: f.region, nombre: nombreRegion(f.region), pct: pct(f.v) })),
    { alClic: elegirRegion, elegida: estado.region });
  document.getElementById(`t-${m}-regiones`).setAttribute("aria-label", `${nombreProblema} por región`);
}

/* ---------------------------------------------------------
   Módulo General
   --------------------------------------------------------- */
function moduloGeneral() {
  const rk = ranking(estado.region);
  const [uno, dos] = rk;
  const el = document.getElementById("r-general");
  if (!uno) {
    el.textContent = `${enAmbito(estado.region)} no hay datos ${textoPeriodo()}.`;
    ["k-general-1", "k-general-2", "k-general-3"].forEach((id) => Obs.kpi(id, { etiqueta: "", valor: "—" }));
    return;
  }
  const tres = [["Problema principal", uno], ["Segundo problema", dos], ["Tercer problema", rk[2]]];
  tres.forEach(([etiqueta, x], i) => Obs.kpi(`k-general-${i + 1}`, { etiqueta, texto: x?.problema ?? "—", pie: x ? pct(x.v) : "" }));
  el.innerHTML = `${enAmbito(estado.region)}, ${textoPeriodo()}, el problema más mencionado fue <strong>${Obs.escapar(uno.problema)}</strong>, con el ${pct(uno.v)} de las personas${enPromedio()}` +
    (dos ? `, seguido de <strong>${Obs.escapar(dos.problema)}</strong> (${pct(dos.v)}).` : ".");

  // Ranking: el clic lleva a la evolución de ese problema
  Obs.barras("g-general-ranking", rk.map((x) => ({ clave: x.problema, etiqueta: x.problema, valor: x.v })), {
    formato: pct, nombre: nombreRegion(estado.region), alClic: (p) => actualizar({ modulo: "evolucion", problemas: new Set([p]) }),
  });
  const caja = document.getElementById("g-general-ranking");
  if (caja.clientWidth < 480) { caja.style.height = `${rk.length * 56 + 16}px`; Obs.grafico("g-general-ranking").resize(); } // nombres largos en pantallas angostas
  document.getElementById("d-general-ranking").textContent =
    `Porcentaje de personas que mencionan cada problema ${enLugar(estado.region)}${unAnio() ? ` en ${estado.desde}` : `, en promedio ${textoPeriodo()}`}. Cada persona puede mencionar más de uno.`;

  // Evolución de los cinco principales del período
  const anios = aniosPeriodo(), top = rk.slice(0, 5).map((x) => x.problema), colores = coloresProblemas(top);
  const series = top.map((p) => ({ nombre: p, color: colores.get(p), valores: anios.map((a) => valor(p, estado.region, a)) }));
  leyendaLineas("ley-general-evol", series);
  document.getElementById("d-general-evol").textContent = `Porcentaje de personas que mencionan cada uno ${enLugar(estado.region)}, ${textoPeriodo()}.`;
  lineas("g-general-evol", anios, series, `Evolución de los cinco problemas principales ${enLugar(estado.region)}: ` + series.map((s) => `${s.nombre}, ${pct(s.valores.at(-1))} en ${anios.at(-1)}`).join("; ") + ".");

  // Mapa categórico: el problema principal de cada región
  const topRegion = REGIONES.map((r) => ({ region: r.region, ...(ranking(r.region)[0] ?? { problema: null, v: null }) })).filter((x) => x.problema);
  const presentes = [...new Set(topRegion.map((x) => x.problema))].sort((a, b) => topRegion.filter((x) => x.problema === b).length - topRegion.filter((x) => x.problema === a).length);
  const col = coloresProblemas(presentes);
  if (!mapas.general) mapas.general = new Obs.Mapa("mapa-general", GEO, { alClic: elegirRegion, nombre: nombreRegion });
  mapas.general.pintar({ valores: new Map(topRegion.map((x) => [x.region, x.problema])), color: (p) => col.get(p), texto: (p) => p, elegida: estado.region });
  Obs.leyendaCategorias("ley-general", presentes.map((p) => [p, col.get(p)]));
  const filas = [...topRegion].sort((a, b) => b.v - a.v);
  Obs.tabla("t-general-regiones",
    [{ titulo: "#", campo: "pos" }, { titulo: "Región", campo: "nombre" }, { titulo: "Problema principal", campo: "problema" }, { titulo: "Porcentaje", campo: "pct", num: true }],
    filas.map((f, i) => ({ pos: String(i + 1), region: f.region, nombre: nombreRegion(f.region), problema: f.problema, pct: pct(f.v) })),
    { alClic: elegirRegion, elegida: estado.region });
}

/* ---------------------------------------------------------
   Módulo ¿Cómo han cambiado?
   --------------------------------------------------------- */
function moduloEvolucion() {
  const anios = aniosPeriodo();
  const sel = [...estado.problemas];
  const rk = ranking(estado.region, sel);
  const el = document.getElementById("r-evolucion");
  const cambios = rk.map((x) => ({ problema: x.problema, a: valor(x.problema, estado.region, estado.desde), b: valor(x.problema, estado.region, estado.hasta) }))
    .filter((x) => x.a != null && x.b != null).map((x) => ({ ...x, d: x.b - x.a }));
  const conCambio = !unAnio() && cambios.length;

  // Cifras: mayor aumento, mayor caída y mención más alta
  const sube = conCambio ? mayor(cambios, "d") : null, baja = conCambio ? menor(cambios, "d") : null;
  Obs.kpi("k-evolucion-1", sube && sube.d > 0
    ? { etiqueta: "Mayor aumento", texto: sube.problema, pie: `${signo(sube.d)} puntos` }
    : { etiqueta: "Mayor aumento", texto: "—", pie: unAnio() ? "Elige dos o más años" : "Ninguno aumentó" });
  Obs.kpi("k-evolucion-2", baja && baja.d < 0
    ? { etiqueta: "Mayor caída", texto: baja.problema, pie: `${signo(baja.d)} puntos` }
    : { etiqueta: "Mayor caída", texto: "—", pie: unAnio() ? "Elige dos o más años" : "Ninguno bajó" });
  let pico = null;
  for (const p of sel) for (const a of anios) { const v = valor(p, estado.region, a); if (v != null && (!pico || v > pico.v)) pico = { problema: p, anio: a, v }; }
  Obs.kpi("k-evolucion-3", { etiqueta: "Mención más alta", texto: pico ? `${pico.problema}, ${pico.anio}` : "—", pie: pico ? pct(pico.v) : "" });

  el.innerHTML = !rk.length ? `${enAmbito(estado.region)} no hay datos para esta selección ${textoPeriodo()}.`
    : sel.length === 1 && conCambio
      ? `${enAmbito(estado.region)}, la mención de <strong>«${Obs.escapar(sel[0])}»</strong> pasó de <strong>${pct(cambios[0].a)}</strong> en ${estado.desde} a <strong>${pct(cambios[0].b)}</strong> en ${estado.hasta}.`
      : conCambio && sube.d > 0
        ? `${enAmbito(estado.region)}, entre ${estado.desde} y ${estado.hasta}, el problema elegido que más creció fue <strong>${Obs.escapar(sube.problema)}</strong> (${signo(sube.d)} puntos, de ${pct(sube.a)} a ${pct(sube.b)}).`
        : `${enAmbito(estado.region)}, ${textoPeriodo()}, se muestran ${sel.length} ${sel.length === 1 ? "problema" : "problemas"}.`;

  // Líneas: hasta cinco problemas (los más mencionados de los elegidos); con uno y una región, el Perú como referencia
  const top = rk.slice(0, 5).map((x) => x.problema), colores = coloresProblemas(top);
  const conRef = top.length === 1 && estado.region !== NACIONAL; // con un problema y una región, el Perú va como referencia
  const series = top.map((p) => ({ nombre: conRef ? `${p} (${nombreRegion(estado.region)})` : p, color: colores.get(p), valores: anios.map((a) => valor(p, estado.region, a)), grueso: top.length === 1 }));
  if (conRef) series.push({ nombre: "Perú", color: "#9aa3b0", referencia: true, valores: anios.map((a) => valor(top[0], NACIONAL, a)) });
  leyendaLineas("ley-evolucion-evol", series);
  document.getElementById("d-evolucion-evol").textContent = sel.length > 5
    ? `Los cinco más mencionados de los ${sel.length} elegidos ${enLugar(estado.region)}, ${textoPeriodo()}.`
    : `Porcentaje de personas que mencionan cada problema ${enLugar(estado.region)}, ${textoPeriodo()}.`;
  lineas("g-evolucion-evol", anios, series, `Evolución ${enLugar(estado.region)}: ` + series.map((s) => `${s.nombre}, ${pct(s.valores.at(-1))} en ${anios.at(-1)}`).join("; ") + ".");

  // Tabla: todos los elegidos, con el cambio entre el primer y el último año del período
  document.getElementById("t-evolucion-detalle-titulo").textContent = unAnio() ? `Problemas elegidos, ${estado.desde}` : `Cambio entre ${estado.desde} y ${estado.hasta}`;
  document.getElementById("d-evolucion-detalle").textContent = unAnio() ? "Elige un período de dos o más años para ver el cambio." : "Variación en puntos porcentuales, ordenada del mayor aumento a la mayor caída.";
  if (!rk.length) { document.getElementById("t-evolucion-detalle").innerHTML = '<p class="pista">Sin datos para esta selección.</p>'; return; }
  if (unAnio()) {
    Obs.tabla("t-evolucion-detalle", [{ titulo: "Problema", campo: "problema" }, { titulo: "Porcentaje", campo: "b", num: true }],
      rk.map((x) => ({ problema: x.problema, b: pct(valor(x.problema, estado.region, estado.hasta)) })));
  } else {
    const ordenados = [...cambios].sort((x, y) => y.d - x.d);
    Obs.tabla("t-evolucion-detalle",
      [{ titulo: "Problema", campo: "problema" }, { titulo: String(estado.desde), campo: "a", num: true }, { titulo: String(estado.hasta), campo: "b", num: true }, { titulo: "Cambio (puntos)", campo: "d", num: true }],
      ordenados.map((x) => ({ problema: x.problema, a: pct(x.a), b: pct(x.b), d: signo(x.d) })));
  }
}

/* ---------------------------------------------------------
   Módulo ¿Dónde se mencionan más?
   --------------------------------------------------------- */
function moduloTerritorio() {
  const p = estado.problema;
  const filas = REGIONES.map((r) => ({ region: r.region, v: promedio(p, r.region) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
  const nacional = promedio(p, NACIONAL);
  const el = document.getElementById("r-territorio");
  const alta = filas[0], baja = filas.at(-1);
  Obs.kpi("k-territorio-1", { etiqueta: "Región donde más se menciona", texto: alta ? nombreRegion(alta.region) : "—", pie: alta ? pct(alta.v) : "" });
  Obs.kpi("k-territorio-2", { etiqueta: "Región donde menos se menciona", texto: baja ? nombreRegion(baja.region) : "—", pie: baja ? pct(baja.v) : "" });
  Obs.kpi("k-territorio-3", { etiqueta: "Perú", valor: pct(nacional), pie: "Total nacional" });
  el.innerHTML = alta
    ? `${textoPeriodo().replace(/^en /, "En ").replace(/^entre /, "Entre ")}, <strong>«${Obs.escapar(p)}»</strong> fue mencionado por el <strong>${pct(nacional)}</strong> de las personas en el Perú${enPromedio()}. ` +
      `Se mencionó más en <strong>${Obs.escapar(nombreRegion(alta.region))}</strong> (${pct(alta.v)}) y menos en <strong>${Obs.escapar(nombreRegion(baja.region))}</strong> (${pct(baja.v)}).`
    : `No hay datos de «${Obs.escapar(p)}» ${textoPeriodo()}.`;

  // Evolución: la región elegida frente al Perú
  const anios = aniosPeriodo(), conRef = estado.region !== NACIONAL;
  const color = coloresProblemas([p]).get(p);
  const series = [{ nombre: nombreRegion(estado.region), color, valores: anios.map((a) => valor(p, estado.region, a)), grueso: true }];
  if (conRef) series.push({ nombre: "Perú", color: "#9aa3b0", referencia: true, valores: anios.map((a) => valor(p, NACIONAL, a)) });
  leyendaLineas("ley-territorio-evol", conRef ? series : []);
  document.getElementById("t-territorio-evol").textContent = `${p}, ${textoPeriodo()}`;
  document.getElementById("d-territorio-evol").textContent = `Porcentaje de personas que lo mencionan ${enLugar(estado.region)}${conRef ? ", comparado con el Perú" : ""}.`;
  lineas("g-territorio-evol", anios, series, `${p} ${enLugar(estado.region)}: ` + series.map((s) => `${s.nombre}, ${pct(s.valores.at(-1))} en ${anios.at(-1)}`).join("; ") + ".");

  document.getElementById("t-territorio-mapa").textContent = `${p}, por región, ${textoPeriodo()}`;
  if (!filas.length) return;
  pintarMapa("territorio", filas, p);
}

const PINTAR = { general: moduloGeneral, evolucion: moduloEvolucion, territorio: moduloTerritorio };

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  render();
}
function elegirRegion(cod) {
  if (cod === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: cod });
}

const POR_DEFECTO = () => new Set([...FIJO.keys()]);
const $ = (s) => document.querySelector(s);

function sincronizarControles() {
  controles.sincronizar(estado);
  multi.sincronizar(estado.problemas, { visible: estado.modulo === "evolucion" });
  // En General no hay filtro de problema: se muestra apagado con su nota
  multiGeneral.sincronizar(new Set(), { visible: estado.modulo === "general", noAplica: true });
  $("#f-problema-caja").hidden = estado.modulo !== "territorio";
  $("#f-problema").value = estado.problema;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
}

function actualizarURL() {
  const defecto = POR_DEFECTO();
  const igual = estado.problemas.size === defecto.size && [...estado.problemas].every((p) => defecto.has(p));
  Obs.escribirURL({
    modulo: estado.modulo === "general" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    desde: estado.desde === ANIOS[0] ? null : estado.desde,
    hasta: estado.hasta === ANIOS.at(-1) ? null : estado.hasta,
    problemas: igual ? null : [...estado.problemas].join("|"),
    problema: estado.problema === PROBLEMA_INICIAL ? null : estado.problema,
  });
}

// Las cifras de una pestaña comparten tamaño: el de la referencia (38 px) o, si un nombre largo no cabe en una línea, el mayor
// que quepa; hasta 28 px en una línea y, si aun así no cabe, en dos líneas (22 px como mínimo)
function ajustarCifras() {
  const v = [...document.querySelectorAll(".modulo:not([hidden]) .kpi-valor")];
  let px = 38;
  const fijar = () => v.forEach((e) => (e.style.fontSize = `${px}px`));
  const cabe = (lineas) => v.every((e) => e.getBoundingClientRect().height <= px * (lineas === 1 ? 1.3 : 2.6));
  fijar();
  while (px > 28 && !cabe(1)) { px -= 2; fijar(); }
  while (px > 22 && !cabe(1) && !cabe(2)) { px -= 2; fijar(); }
}

function render() {
  sincronizarControles();
  PINTAR[estado.modulo]();
  ajustarCifras();
  actualizarURL();
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  GEO = geo;
  C = { ...Obs.tema() };

  FILAS = Obs.expandir(datos.tablas["Problemas del país"]).map((f) => {
    const nac = f.Nivel === "Nacional" || f.region === "Nacional";
    const nombre = String(f.region).trim().replace(/^San Martin$/, "San Martín");
    const cod = nac ? NACIONAL : codigo(nombre);
    if (!nac) NOMBRE_REGION.set(cod, nombre);
    return { anio: +f["Año"], problema: String(f.Problema).trim(), region: cod, si: f.Si_p };
  });
  FILAS.forEach((f) => INDICE.set(`${f.problema}|${f.region}|${f.anio}`, f.si));
  PROBLEMAS = [...new Set(FILAS.map((f) => f.problema))].sort((a, b) => a.localeCompare(b, "es"));
  REGIONES = [...NOMBRE_REGION].filter(([c]) => c !== NACIONAL).map(([region, nombre]) => ({ region, nombre }));
  ANIOS = [...new Set(FILAS.map((f) => f.anio))].sort((a, b) => a - b);
  document.getElementById("subtitulo").textContent = `Qué problemas mencionan los peruanos como los más importantes del país, ${ANIOS[0]}-${ANIOS.at(-1)}.`;
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  // Color fijo para los cinco problemas más mencionados en el Perú, según su promedio de todos los años
  PROBLEMAS.map((p) => { const v = ANIOS.map((a) => valor(p, NACIONAL, a)).filter((x) => x != null); return [p, v.reduce((s, x) => s + x, 0) / (v.length || 1)]; })
    .sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([p], i) => FIJO.set(p, i));
  estado.problemas = POR_DEFECTO();
  if (!PROBLEMAS.includes(estado.problema)) estado.problema = PROBLEMAS[0];

  // Estado inicial desde la URL
  const q = Obs.parametros();
  const anio = (v, def) => (Number.isInteger(+v) && +v >= ANIOS[0] && +v <= ANIOS.at(-1) ? +v : def);
  estado.desde = anio(q.get("desde"), ANIOS[0]);
  estado.hasta = Math.max(estado.desde, anio(q.get("hasta"), ANIOS.at(-1)));
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const reg = codigo(q.get("region") || "");
  if (NOMBRE_REGION.has(reg) && reg !== NACIONAL) Object.assign(estado, { ambito: "regional", region: reg });
  const pedidos = (q.get("problemas") || "").split("|").filter((p) => PROBLEMAS.includes(p));
  if (pedidos.length) estado.problemas = new Set(pedidos);
  const uno = PROBLEMAS.find((p) => p.toLowerCase() === (q.get("problema") || "").toLowerCase());
  if (uno) estado.problema = uno;

  // Controles: los comunes, el de problemas (varios) para la evolución y el de un problema para el territorio
  const filtros = document.getElementById("filtros");
  controles = Obs.controlesComunes(filtros, { regiones: REGIONES, anios: [ANIOS[0], ANIOS.at(-1)], alCambiar: actualizar, comparar: false });
  multi = new Obs.Multiseleccion(filtros, {
    id: "f-problemas", etiqueta: "Problemas", todos: "Todos los problemas",
    opciones: PROBLEMAS.map((p) => ({ valor: p, etiqueta: p })), alCambiar: (sel) => actualizar({ problemas: sel }),
  });
  multiGeneral = new Obs.Multiseleccion(filtros, { id: "f-general", etiqueta: "Problemas", todos: "Todos", opciones: [], alCambiar: () => {} });
  filtros.insertAdjacentHTML("beforeend",
    `<div class="filtro" id="f-problema-caja" hidden><label for="f-problema">Problema</label><select id="f-problema">${
      PROBLEMAS.map((p) => `<option value="${Obs.escapar(p)}">${Obs.escapar(p)}</option>`).join("")}</select></div>`);
  $("#f-problema").onchange = (e) => actualizar({ problema: e.target.value });

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => { // flechas para moverse entre pestañas
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso) return;
      const sig = pestanas[(i + paso + pestanas.length) % pestanas.length];
      sig.focus();
      sig.click();
    };
  });

  Obs.descarga({ archivos: ARCHIVOS });

  let espera, anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return; // en celular, la barra del navegador cambia solo el alto
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });

  render();
  // la medida de las cifras depende de la tipografía: se repite cuando termina de cargar
  document.fonts?.ready.then(ajustarCifras);
});
