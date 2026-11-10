/* =========================================================
   Tablero de Seguridad ciudadana — Observatorio para la Democracia
   y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script, desde el Sheet
   «[Tableros] Seguridad ciudadana», que llena el notebook
   procesos/seguridad-ciudadana/actualizar_seguridad.ipynb con las bases
   de ENAPRES 2014-2025. Una pestaña por tema, en formato largo:
     anio, codigo (región o PE), dimensiones del tema, n, base, valor (0-1), muestra

   Tres pestañas: Víctimas y denuncias, Percepción de inseguridad y Policía
   e instituciones. Filtros comunes arriba: ámbito y región, año y «Comparar
   con». En cada pestaña: resumen dinámico, cifras clave (con su cambio y su
   línea), gráficos del año elegido, evolución 2014-2025 y mapa con ranking.
   Patrón: un objeto `estado`, funciones puras para leer los datos y una
   sola `render()`.

   Parámetros de URL:
     ?modulo=victimas|percepcion|policia
     &region=CUSCO     región elegida
     &comparar=PUNO    Perú (NACIONAL) u otra región; «ninguna» = sin comparación
     &anio=2024        año (por defecto, el último)
     &embed=1          oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "seguridad-ciudadana";
const MODULOS = ["victimas", "percepcion", "policia"];
const NACIONAL = "NACIONAL";
const ALGUNO = "Al menos un delito";
const TODOS = "Todos los delitos";
const PNP = "Policía Nacional";
const MIN_MUESTRA = 30;   // con menos encuestados, el dato es referencial
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const pct = (v) => Obs.fmtPct(v, 1);

const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho",
  CAJAMARCA: "Cajamarca", CALLAO: "Callao", CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco",
  ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad", LAMBAYEQUE: "Lambayeque",
  "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto",
  "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno",
  "SAN MARTIN": "San Martín", TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};
// Cuadrícula del Perú: [columna, fila] de cada región (todas del mismo tamaño)
const CUADRO = {
  TUMBES: [1, 0], LORETO: [4, 0], PIURA: [0, 1], CAJAMARCA: [1, 1], AMAZONAS: [2, 1], "SAN MARTIN": [3, 1],
  LAMBAYEQUE: [0, 2], "LA LIBERTAD": [1, 2], HUANUCO: [2, 2], UCAYALI: [3, 2], ANCASH: [1, 3], PASCO: [2, 3],
  JUNIN: [3, 3], CALLAO: [0, 4], "LIMA METROPOLITANA": [1, 4], "LIMA PROVINCIAS": [2, 4], HUANCAVELICA: [3, 4],
  CUSCO: [4, 4], "MADRE DE DIOS": [5, 4], ICA: [2, 5], AYACUCHO: [3, 5], APURIMAC: [4, 5], PUNO: [5, 5],
  AREQUIPA: [3, 6], MOQUEGUA: [4, 6], TACNA: [4, 7],
};

/* Columnas de cada pestaña del Sheet (sin anio, codigo, n, base, valor ni muestra) */
const DIMS = {
  victimizacion: ["delito", "grupo", "categoria"],
  denuncia: ["delito", "grupo", "categoria"],
  denuncia_resultado: ["delito", "resultado"],
  no_denuncia_motivo: ["delito", "motivo"],
  percepcion: ["delito", "grupo", "categoria"],
  inseguridad: ["lugar", "grupo", "categoria"],
  razones_inseguridad: ["razon"],
  vigilancia: ["quien", "medida"],
  confianza: ["institucion", "respuesta", "grupo", "categoria"],
  razones_desconfianza: ["razon"],
  desempeno: ["aspecto"],
};

/* Indicadores principales: cifras clave, evolución y mapa.
   mejor: si es mejor que suba o que baje (para el color del cambio) */
const IND = {
  victimas: { quien: "que fue víctima de al menos un delito", p: "victimizacion", dims: { delito: ALGUNO }, corto: "Víctimas de al menos un delito", mejor: "bajo", delitos: true,
    etiqueta: "Fueron víctimas de un delito", frase: "fue víctima de al menos un delito en el último año" },
  denuncia: { quien: "de víctimas que denunció", p: "denuncia", dims: { delito: ALGUNO }, corto: "Víctimas que denunciaron", mejor: "alto", delitos: true,
    etiqueta: "De las víctimas, denunciaron", frase: "de las víctimas denunció el delito" },
  percepcion: { quien: "que cree que puede ser víctima", p: "percepcion", dims: { delito: ALGUNO }, corto: "Creen que pueden ser víctimas", mejor: "bajo", delitos: true,
    etiqueta: "Creen que pueden ser víctimas", frase: "cree que puede ser víctima de un delito en los próximos 12 meses" },
  zona: { quien: "que se siente inseguro en su zona o barrio", p: "inseguridad", dims: { lugar: "En su zona o barrio" }, corto: "Inseguros en su zona o barrio", mejor: "bajo",
    etiqueta: "Se sienten inseguros en su zona", frase: "se siente inseguro en su zona o barrio" },
  noche: { quien: "que se siente inseguro caminando de noche", p: "inseguridad", dims: { lugar: "Caminando de noche en su zona o barrio" }, corto: "Inseguros caminando de noche", mejor: "bajo",
    etiqueta: "Se sienten inseguros de noche", frase: "se siente inseguro caminando de noche por su zona" },
  confianza: { quien: "que confía en la Policía", p: "confianza", suma: ["Suficiente", "Bastante"], corto: "Confían en la Policía", mejor: "alto",
    etiqueta: "Confían en la Policía", frase: "confía en la Policía (suficiente o bastante)" },
  patrullaje: { quien: "que ve patrullaje de la Policía en su zona", p: "vigilancia", dims: { quien: PNP, medida: "Hay vigilancia" }, corto: "Ven patrullaje de la Policía", mejor: "alto",
    etiqueta: "Ven patrullaje policial en su zona", frase: "dice que la Policía vigila su zona" },
  comisaria: { quien: "que califica bien a su comisaría", p: "desempeno", dims: { aspecto: "Trabajo de la comisaría de su zona" }, corto: "Califican bien a su comisaría", mejor: "alto",
    etiqueta: "Califican bien a su comisaría", frase: "califica como bueno o muy bueno el trabajo de su comisaría" },
};

const MOD = {
  victimas: { kpis: ["victimas", "denuncia", "masFrecuente"], mapa: ["victimas", "denuncia"] },
  percepcion: { kpis: ["percepcion", "zona", "noche"], mapa: ["percepcion", "zona", "noche"] },
  policia: { kpis: ["confianza", "patrullaje", "comisaria"], mapa: ["confianza", "patrullaje", "comisaria"] },
};

/* «Ver por»: grupos con desglose en el Sheet (solo «al menos un delito», sensación y confianza en la Policía) */
const VER_POR = {
  Sexo: ["Hombre", "Mujer"],
  Edad: ["15 a 29 años", "30 a 44 años", "45 a 64 años", "65 años a más"],
};

const estado = {
  modulo: "victimas",
  ambito: "nacional",
  region: NACIONAL,
  comparar: "",
  anio: null,                 // se fija al último año al cargar
  delitos: new Set(),         // delitos elegidos arriba (todos al cargar)
  // lo que se compara entre regiones en el mapa de cada pestaña (clic en una barra); null = el indicador del mapa
  foco: { victimas: null, percepcion: null, policia: null },
  evol: {
    victimas: { ind: "victimas", verPor: "Total" },
    inseguridad: { ind: "zona", verPor: "Total" },
    confianza: { institucion: PNP, verPor: "Total" },
  },
  mapa: { victimas: { ind: "victimas" }, percepcion: { ind: "percepcion" }, policia: { ind: "confianza" } },
  vista: "mapa",              // mapa o cuadricula
};

let C, GEO, controles, multiDelitos, ANIOS = [], DELITOS = [];
const D = new Map();          // "pestaña|lugar|año|dim1|dim2…" -> { v, n, m }
const BASE = new Map();       // "pestaña|lugar|año|delito" -> { b, m } (resultado y motivo, por delito)
const mapas = {};
const ORDEN = {};
const BUSCAR = {};

/* ---------------------------------------------------------
   Lectura de los datos
   --------------------------------------------------------- */
const llave = (p, lugar, a, dims) =>
  [p, lugar, a, ...DIMS[p].map((d) => dims[d] ?? (d === "grupo" || d === "categoria" ? "Total" : ""))].join("|");
const dato = (p, dims, lugar = estado.region, a = estado.anio) => D.get(llave(p, lugar, a, dims)) ?? null;

/* Valor de un indicador. o: { delito, institucion, grupo, categoria } */
function ind(clave, lugar = estado.region, a = estado.anio, o = {}) {
  const I = IND[clave];
  const g = o.grupo ? { grupo: o.grupo, categoria: o.categoria } : {};
  if (I.suma) {
    const partes = I.suma.map((r) => dato(I.p, { institucion: o.institucion ?? PNP, respuesta: r, ...g }, lugar, a));
    const hay = partes.filter(Boolean);
    if (!hay.length) return null;
    return { v: hay.reduce((s, x) => s + x.v, 0), m: hay[0].m };
  }
  return dato(I.p, { ...I.dims, ...(o.delito ? { delito: o.delito } : {}), ...g }, lugar, a);
}
const vInd = (...a) => ind(...a)?.v ?? null;
const aniosInd = (clave, lugar = estado.region, o = {}) => ANIOS.filter((a) => ind(clave, lugar, a, o));
const ref = (x) => x && x.m < MIN_MUESTRA;
const nombre = (c) => (c === NACIONAL ? "Perú" : NOMBRES[c] ?? c);
const enLugar = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombre(c)}`);
const EnLugar = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombre(c)}`);
const lugarComp = () => (estado.comparar && estado.comparar !== estado.region ? estado.comparar : null);
const puntos = (d) => `${Obs.fmtN(Math.abs(d) * 100, 1)} ${Math.abs(d * 100).toFixed(1) === "1.0" ? "punto" : "puntos"}`;
const destacar = (s) => `<strong>${s}</strong>`;
const $ = (s, raiz = document) => raiz.querySelector(s);
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const desde = (p, dims) => ANIOS.find((a) => dato(p, dims, NACIONAL, a)) ?? null;

function puesto(clave, region, a, o = {}) {
  const v = vInd(clave, region, a, o);
  if (v == null) return null;
  const lista = Object.keys(NOMBRES).map((r) => vInd(clave, r, a, o)).filter((x) => x != null);
  return { n: lista.filter((x) => x > v).length + 1, de: lista.length };
}

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const botones = (opciones, elegida) => opciones.filter((o) => !o.desactivado).map((o) =>
  `<button type="button" data-valor="${Obs.escapar(o.valor)}" aria-pressed="${o.valor === elegida}">${Obs.escapar(o.etiqueta)}</button>`).join("");
const opciones = (lista, elegida) => lista.map((o) =>
  `<option value="${Obs.escapar(o.valor)}"${o.valor === elegida ? " selected" : ""}>${Obs.escapar(o.etiqueta)}</option>`).join("");

function chispa(valores, color) {
  const pts = valores.filter((p) => p[1] != null);
  if (pts.length < 2) return "";
  const W = 120, H = 36, a0 = pts[0][0], a1 = pts.at(-1)[0];
  const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), r = hi - lo || 1;
  const x = (a) => 3 + ((a - a0) / (a1 - a0 || 1)) * (W - 6), y = (v) => H - 4 - ((v - lo) / r) * (H - 8);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const sel = pts.find((p) => p[0] === estado.anio) ?? pts.at(-1);
  return `<svg class="chispa" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="${x(sel[0]).toFixed(1)}" cy="${y(sel[1]).toFixed(1)}" r="3.5" fill="${color}"/></svg>`;
}

/* Tabla ordenable, con buscador opcional. columnas: [{ clave, titulo, num, valor(f), html(f) }] */
function tablaOrdenable(id, columnas, filas, { inicial, claveFila, elegida = null, alClic = null, descripcion, buscar = null, claseFila = () => "" }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const cmp = (a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  };
  const datos = [...filas].sort(cmp);
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    const sentido = activo ? (orden.dir === 1 ? "ascending" : "descending") : "none";
    return `<th class="${c.num ? "num" : ""}" aria-sort="${sentido}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = claveFila(f);
    const clases = [claseFila(f), k === elegida ? "elegida" : ""].filter(Boolean).join(" ");
    return `<tr tabindex="0" data-k="${Obs.escapar(String(k))}" data-texto="${Obs.escapar(columnas.filter((c) => !c.num).map((c) => String(c.valor(f) ?? "")).join(" ").toLowerCase())}"${clases ? ` class="${clases}"` : ""}>` +
      columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("") + "</tr>";
  }).join("");
  const caja = buscar ? `<div class="buscador-tabla"><label for="${id}-buscar">Buscar</label><input id="${id}-buscar" type="search" placeholder="${buscar}" autocomplete="off" value="${Obs.escapar(BUSCAR[id] ?? "")}"></div>` : "";
  el.innerHTML = caja + `<div class="tabla-desliza"><table class="tabla ordenable"><caption class="solo-lectores">${descripcion}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>` +
    `<p class="tabla-vacia" hidden>Ninguna fila coincide con la búsqueda.</p></div>`;
  const filtrar = () => {
    const q = (BUSCAR[id] ?? "").trim().toLowerCase();
    let visibles = 0;
    el.querySelectorAll("tbody tr").forEach((r) => { const ok = !q || r.dataset.texto.includes(q); r.hidden = !ok; visibles += ok; });
    el.querySelector(".tabla-vacia").hidden = visibles > 0;
  };
  filtrar();
  const input = el.querySelector("input[type=search]");
  if (input) input.oninput = () => { BUSCAR[id] = input.value; filtrar(); };
  el.querySelector("thead").onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (!b) return;
    const c = columnas.find((x) => x.clave === b.dataset.orden);
    ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
    tablaOrdenable(id, columnas, filas, { inicial, claveFila, elegida, alClic, descripcion, buscar, claseFila });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
  if (alClic) {
    el.querySelector("tbody").onclick = (e) => { const r = e.target.closest("tr[data-k]"); if (r) alClic(r.dataset.k); };
    el.querySelector("tbody").onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) alClic(e.target.dataset.k); };
  }
}

/* Líneas por año, de 0 a un tope redondo. series: [{ nombre, color, valores, punteada }]
   quiebres: [{ anio, texto }] cambios de la encuesta (línea vertical con su nota) */
function lineas(id, series, { quiebres = [], aria = "" } = {}) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  if (!todos.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const ancho = el.clientWidth;
  const maximo = Math.max(...todos) * 1.05;
  const paso = maximo > 0.5 ? 0.2 : maximo > 0.2 ? 0.1 : maximo > 0.08 ? 0.02 : 0.01;
  const tope = Math.min(1, Math.ceil(maximo / paso - 1e-9) * paso);
  const cada = ancho < 420 ? 4 : ancho < 760 ? 2 : 1;
  const rotular = series.length <= 4 && ancho >= 520;
  const ultimoIdx = (vals) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i; return -1; };
  // Etiquetas del último año separadas al menos 17 px, para que no se encimen
  const arriba = quiebres.length ? 34 : 16, altoTrazo = Math.max(1, el.clientHeight - arriba - 30);
  const desplazo = new Map();
  if (rotular) {
    const fin = series.map((s, i) => { const u = ultimoIdx(s.valores); return u < 0 ? null : { i, y: arriba + altoTrazo * (1 - s.valores[u] / tope) }; })
      .filter(Boolean).sort((a, b) => a.y - b.y);
    const pos = fin.map((f) => f.y);
    for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + 17);
    // si se salen por abajo, se suben en bloque
    const exceso = pos.length ? pos[pos.length - 1] - (arriba + altoTrazo + 8) : 0;
    if (exceso > 0) for (let k = pos.length - 1; k >= 0; k--) pos[k] = Math.min(pos[k] - exceso, k < pos.length - 1 ? pos[k + 1] - 17 : Infinity);
    fin.forEach((f, k) => desplazo.set(f.i, pos[k] - f.y));
  }
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => p.value != null).sort((x, y) => y.value - x.value)
        .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: 52, right: rotular ? 64 : 18, top: arriba, bottom: 30 },
    xAxis: { type: "category", data: ANIOS.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (ANIOS.length - 1 - i) % cada === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, interval: paso, splitLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ formatter: (v) => `${Math.round(v * 100)} %` }) },
    series: series.map((s, i) => {
      const u = ultimoIdx(s.valores);
      return {
        name: s.nombre, type: "line", connectNulls: true, symbol: "circle", symbolSize: s.punteada ? 6 : 8, z: s.punteada ? 2 : 3,
        data: s.valores.map((v, j) => (j === u && rotular ? { value: v, label: { show: true, position: "right", distance: 8, offset: [0, desplazo.get(i) ?? 0], formatter: () => pct(v), ...txt({ color: C.texto, fontWeight: 700 }) } } : v)),
        lineStyle: { width: s.punteada ? 2 : 2.5, color: s.color, type: s.punteada ? [6, 4] : "solid" },
        itemStyle: { color: s.punteada ? "#fff" : s.color, borderColor: s.color, borderWidth: s.punteada ? 2 : 1.5 },
        emphasis: { focus: "series" },
        // el año elegido arriba, y los cambios de la encuesta
        markLine: i === 0 ? { silent: true, symbol: "none", animation: false, data: [
          { xAxis: String(estado.anio), lineStyle: { color: C.navy, width: 1, type: "solid", opacity: 0.35 }, label: { show: false } },
          ...quiebres.map((q) => ({ xAxis: String(q.anio), lineStyle: { color: C.textoSuave, type: [4, 4], width: 1 },
            label: { show: ancho >= 520, position: "end", formatter: q.texto, ...txt({ fontSize: 13 }) } })),
        ] } : undefined,
      };
    }),
  }, true);
  el.setAttribute("aria-label", aria);
}

function leyenda(id, entradas, { comparacion = null } = {}) {
  const partes = entradas.map(([n, color, punteada]) => `<span><i class="l${punteada ? " punteada" : ""}" style="border-color:${color}"></i>${Obs.escapar(n)}</span>`);
  if (comparacion) partes.push(`<span><i class="l punteada" style="border-color:${C.textoSuave}"></i>${Obs.escapar(comparacion)} (línea punteada)</span>`);
  document.getElementById(id).innerHTML = partes.join("");
}

/* Nombres cortos para las barras (el nombre completo va en las notas y en la tabla) */
const CORTO = {
  "Robo de autopartes del vehículo": "Robo de autopartes",
  "Maltrato físico o psicológico de un familiar": "Maltrato de un familiar",
  "Robo de motocicleta o mototaxi": "Robo de moto o mototaxi",
  "Robo de vehículo automotor": "Robo de vehículo",
  "Robo de dinero, cartera o celular": "Robo de dinero o celular",
  "Recuperó sus bienes y se detuvo al delincuente": "Recuperó sus bienes y detuvieron al delincuente",
};

/* Barras horizontales del año elegido, con la marca de la comparación y los referenciales en gris.
   items: [{ clave, etiqueta, x (dato del lugar), k (dato de la comparación) }] */
function barras(id, items, aria, { alClic = null, seleccion = null } = {}) {
  const comp = lugarComp();
  const datos = items.filter((d) => d.x).map((d) => ({
    clave: d.clave, etiqueta: (CORTO[d.etiqueta] ?? d.etiqueta) + (ref(d.x) ? " *" : ""), valor: d.x.v, comp: d.k?.v ?? null,
    color: ref(d.x) ? C.referencial : d.color ?? C.unica,
  }));
  Obs.barras(id, datos, { formato: pct, nombre: nombre(estado.region), comparacion: comp ? nombre(comp) : null, alClic, seleccion });
  document.getElementById(id).setAttribute("aria-label", aria);
  return datos;
}

/* ---------------------------------------------------------
   Delitos elegidos arriba y foco del mapa
   --------------------------------------------------------- */
const todos = () => estado.delitos.size === DELITOS.length;
const unico = () => (estado.delitos.size === 1 ? [...estado.delitos][0] : null);
const elegidos = () => DELITOS.filter((d) => estado.delitos.has(d));
const txtDelitos = () => (todos() ? "" : unico() ? ` (${Obs.minus(unico())})` : ` (${estado.delitos.size} delitos elegidos)`);
// Artículo de cada delito para los textos («la estafa», «las amenazas», «el robo»)
const articulo = (d) => (/^(amenazas|ofensas)/i.test(d) ? "las" : /^(estafa|extorsi)/i.test(d) ? "la" : "el");
const conA = (d) => (articulo(d) === "el" ? "al" : `a ${articulo(d)}`);

// Clic en un delito: el primero deja solo ese; los siguientes lo suman o lo quitan
function alternarDelito(d) {
  if (todos()) estado.delitos = new Set([d]);
  else if (estado.delitos.has(d)) { estado.delitos.delete(d); if (!estado.delitos.size) estado.delitos = new Set(DELITOS); }
  else estado.delitos.add(d);
}

// Qué pasó con la denuncia o por qué no denunció, para los delitos elegidos: se suman n y base
function agregado(p, col, cat, lugar = estado.region, a = estado.anio) {
  if (todos()) return dato(p, { delito: TODOS, [col]: cat }, lugar, a);
  let n = 0, b = 0, m = 0, hay = false;
  for (const d of elegidos()) {
    const t = BASE.get(`${p}|${lugar}|${a}|${d}`);
    if (!t) continue;
    hay = true; b += t.b; m += t.m;
    n += dato(p, { delito: d, [col]: cat }, lugar, a)?.n ?? 0;
  }
  return hay && b > 0 ? { v: n / b, n, m } : null;
}

// Clic en una barra: el mapa de la pestaña pasa a comparar eso entre regiones (otro clic lo quita)
function enfocar(tipo, clave) {
  const m = estado.modulo, f = estado.foco[m];
  estado.foco[m] = f?.tipo === tipo && f.clave === clave ? null : { tipo, clave };
}
const enFoco = (tipo) => { const f = estado.foco[estado.modulo]; return f?.tipo === tipo ? new Set([f.clave]) : null; };
const FOCOS = {
  victimizacion: (k) => ({ titulo: `Víctimas de ${Obs.minus(k)}`, valor: (r) => dato("victimizacion", { delito: k }, r) }),
  denuncia: (k) => ({ titulo: `Víctimas de ${Obs.minus(k)} que denunciaron`, valor: (r) => dato("denuncia", { delito: k }, r) }),
  resultado: (k) => ({ titulo: `Tras denunciar: «${Obs.minus(k)}»${txtDelitos()}`, valor: (r) => agregado("denuncia_resultado", "resultado", k, r) }),
  motivo: (k) => ({ titulo: `No denunciaron porque «${Obs.minus(k)}»${txtDelitos()}`, valor: (r) => agregado("no_denuncia_motivo", "motivo", k, r) }),
  percepcion: (k) => ({ titulo: `Creen que pueden ser víctimas de ${Obs.minus(k)}`, valor: (r) => dato("percepcion", { delito: k }, r) }),
  lugar: (k) => ({ titulo: `Se sienten inseguros: ${Obs.minus(k)}`, valor: (r) => dato("inseguridad", { lugar: k }, r), primero: desde("inseguridad", { lugar: k }) }),
  razon_inseg: (k) => ({ titulo: `Se sienten inseguros por: ${Obs.minus(k)}`, valor: (r) => dato("razones_inseguridad", { razon: k }, r), primero: desde("razones_inseguridad", { razon: k }) }),
  confianza: (k) => ({ titulo: `Confían suficiente o bastante en: ${k}`, valor: (r) => ind("confianza", r, estado.anio, { institucion: k }) }),
  razon_desconf: (k) => ({ titulo: `No confían en la Policía porque: ${Obs.minus(k)}`, valor: (r) => dato("razones_desconfianza", { razon: k }, r), primero: desde("razones_desconfianza", { razon: k }) }),
  vigilancia: (k) => ({ titulo: `Dicen que vigila su zona: ${k}`, valor: (r) => dato("vigilancia", { quien: k, medida: "Hay vigilancia" }, r) }),
  desempeno: (k) => ({ titulo: `Califican bien: ${Obs.minus(k)}`, valor: (r) => dato("desempeno", { aspecto: k }, r), primero: desde("desempeno", { aspecto: k }) }),
};

/* ---------------------------------------------------------
   Tarjetas
   --------------------------------------------------------- */
const tarjeta = (id, titulo, desc, { controles = "" } = {}) => `<article class="tarjeta" id="c-${id}">
  <header><h3>${titulo}</h3><p>${desc}</p></header>
  ${controles ? `<div class="controles">${controles}</div>` : ""}
  <p class="aviso-anio" id="av-${id}"></p>
  <p class="lectura" id="l-${id}" aria-live="polite"></p>
  <div class="ley" id="ley-${id}"></div>
  <div class="grafico" id="g-${id}"></div>
  <p class="nota-tarjeta" id="n-${id}"></p>
</article>`;
const par = (...t) => `<div class="par">${t.join("")}</div>`;
const local = (id, etiqueta, interior) => `<div class="filtro-local" role="group" aria-labelledby="lbl-${id}"><span id="lbl-${id}">${etiqueta}</span>${interior}</div>`;
const selectLocal = (id, etiqueta, atributo) => `<div class="filtro-local"><label for="${id}">${etiqueta}</label><select id="${id}" ${atributo}></select></div>`;

/* Si la pregunta no existe en el año elegido, la tarjeta lo dice en vez de quedar vacía */
function sinAnio(id, p, dims, extra = "") {
  const a0 = desde(p, dims);
  const av = document.getElementById(`av-${id}`);
  const falta = a0 == null || estado.anio < a0;
  av.textContent = falta ? `Esta pregunta se hace desde ${a0}. Elige ${a0} o un año posterior arriba.${extra}` : "";
  document.getElementById(`g-${id}`).hidden = falta;
  if (falta) {
    document.getElementById(`l-${id}`).textContent = "";
    document.getElementById(`ley-${id}`).innerHTML = "";
  }
  return falta;
}

function notaRef(id, datos) {
  document.getElementById(`n-${id}`).textContent = datos.some((d) => d.etiqueta.endsWith(" *"))
    ? "* Dato referencial: menos de 30 personas encuestadas." : "";
}

/* --- Pestaña 1: víctimas y denuncias --- */
function pintarDelitos() {
  const comp = lugarComp(), sel = todos() ? null : estado.delitos;
  for (const [id, p, tipo] of [["delitos", "victimizacion", "victimizacion"], ["denuncia-delito", "denuncia", "denuncia"]]) {
    const items = DELITOS.map((d) => ({ clave: d, etiqueta: d, x: dato(p, { delito: d }), k: comp ? dato(p, { delito: d }, comp) : null }));
    const datos = barras(`g-${id}`, items, `${tipo === "denuncia" ? "Denuncia por delito" : "Víctimas por delito"}, ${enLugar(estado.region)}, ${estado.anio}`,
      { seleccion: sel, alClic: (d) => { alternarDelito(d); enfocar(tipo, d); render(); } });
    notaRef(id, datos);
    const vistos = sel ? datos.filter((d) => sel.has(d.clave)) : datos;
    const orden = [...vistos].sort((a, b) => b.valor - a.valor);
    const l = document.getElementById(`l-${id}`);
    if (!orden.length) { l.textContent = ""; continue; }
    const top = orden[0], bajo = orden.at(-1), limpio = (d) => Obs.minus(d.etiqueta.replace(" *", ""));
    if (tipo === "victimizacion") {
      l.innerHTML = orden.length === 1 ? `${EnLugar(estado.region)}, el ${destacar(pct(top.valor))} de las personas fue víctima de ${limpio(top)}.`
        : `${EnLugar(estado.region)}, ${sel ? "entre los delitos elegidos, " : ""}el más frecuente fue el ${limpio(top)}: lo sufrió el ${destacar(pct(top.valor))} de las personas.`;
    } else {
      l.innerHTML = orden.length === 1 ? `El ${destacar(pct(top.valor))} de las víctimas de ${limpio(top)} lo denunció.`
        : `Se denuncia más el ${limpio(top)} (${destacar(pct(top.valor))} de sus víctimas) y menos ${articulo(bajo.clave)} ${limpio(bajo)} (${pct(bajo.valor)}).`;
    }
  }
  document.getElementById("n-delitos").textContent += " Haz clic en un delito para filtrar el tablero por ese delito y verlo en el mapa.";
}

function pintarEvolVictimas() {
  const e = estado.evol.victimas, card = document.getElementById("c-evol-victimas"), comp = lugarComp();
  $("[data-ev-ind]", card).innerHTML = botones([{ valor: "victimas", etiqueta: "Víctimas" }, { valor: "denuncia", etiqueta: "Denunciaron" }], e.ind);
  if (!todos()) e.verPor = "Total";
  $("[data-ev-verpor]", card).innerHTML = botones(["Total", "Sexo", "Edad"].map((v) => ({ valor: v, etiqueta: v, desactivado: v !== "Total" && !todos() })), e.verPor);
  const nota = document.getElementById("n-evol-victimas");
  const lista = elegidos();
  if (todos() || lista.length > 5) {
    pintarEvol("evol-victimas", e.ind, { delito: ALGUNO }, e.verPor, comp);
    nota.textContent = todos() ? "«Ver por» sexo y edad está disponible para «al menos un delito»."
      : "Con más de 5 delitos elegidos se muestra «al menos un delito». Elige hasta 5 para verlos por separado.";
    return;
  }
  if (lista.length === 1) {
    pintarEvol("evol-victimas", e.ind, { delito: lista[0] }, "Total", comp);
    nota.textContent = "";
    return;
  }
  // Varios delitos: una línea por delito, en el lugar elegido
  const I = IND[e.ind], lugar = estado.region;
  const series = lista.map((d, i) => ({ nombre: CORTO[d] ?? d, color: Obs.colorCategoria(i), valores: ANIOS.map((a) => vInd(e.ind, lugar, a, { delito: d })) }));
  leyenda("ley-evol-victimas", series.map((s) => [s.nombre, s.color]));
  lineas("g-evol-victimas", series, { aria: `${I.corto} por delito, ${enLugar(lugar)}` });
  const ult = series.map((s) => [s.nombre, s.valores.at(-1)]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]);
  document.getElementById("l-evol-victimas").innerHTML = ult.length
    ? `${EnLugar(lugar)}, en ${ANIOS.at(-1)}, ${e.ind === "denuncia" ? "se denunció más" : "fue más frecuente"} el ${Obs.minus(ult[0][0])} (${destacar(pct(ult[0][1]))}).` : "";
  nota.textContent = comp ? "Con varios delitos elegidos no se muestra la comparación. Elige uno solo para compararlo." : "";
}

/* Evolución genérica de un indicador, con «Ver por» y comparación */
function pintarEvol(id, clave, o, verPor, comp, quiebres = []) {
  const I = IND[clave], lugar = estado.region;
  let series;
  if (verPor !== "Total") {
    series = VER_POR[verPor].map((cat, i) => ({ nombre: cat, color: C.grupos[i], valores: ANIOS.map((a) => vInd(clave, lugar, a, { ...o, grupo: verPor, categoria: cat })) }));
    leyenda(`ley-${id}`, series.map((s) => [s.nombre, s.color]));
  } else {
    series = [{ nombre: nombre(lugar), color: C.unica, valores: ANIOS.map((a) => vInd(clave, lugar, a, o)) }];
    if (comp) series.push({ nombre: nombre(comp), color: C.navy, punteada: true, valores: ANIOS.map((a) => vInd(clave, comp, a, o)) });
    leyenda(`ley-${id}`, comp ? [[nombre(lugar), C.unica]] : [], { comparacion: comp ? nombre(comp) : null });
  }
  lineas(`g-${id}`, series, { quiebres, aria: `${I.corto}, ${enLugar(lugar)}, ${ANIOS[0]}-${ANIOS.at(-1)}` });
  // Lectura: primer y último año con dato, y el año elegido
  const anios = aniosInd(clave, lugar, o);
  const l = document.getElementById(`l-${id}`);
  if (!anios.length) { l.textContent = `${EnLugar(lugar)} no hay datos para esta selección.`; return; }
  const a0 = anios[0], a1 = anios.at(-1), v0 = vInd(clave, lugar, a0, o), v1 = vInd(clave, lugar, a1, o);
  const que = o.delito && o.delito !== ALGUNO ? ` (${Obs.minus(o.delito)})` : "";
  if (verPor !== "Total") {
    const vals = VER_POR[verPor].map((c) => [c, vInd(clave, lugar, estado.anio, { ...o, grupo: verPor, categoria: c })]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]);
    l.innerHTML = vals.length ? `${EnLugar(lugar)}, en ${estado.anio}, el valor más alto es el de ${Obs.minus(vals[0][0])} (${destacar(pct(vals[0][1]))}) y el más bajo, el de ${Obs.minus(vals.at(-1)[0])} (${pct(vals.at(-1)[1])}).` : "";
  } else {
    const verbo = Math.abs(v1 - v0) < 0.005 ? "se mantuvo" : v1 > v0 ? "subió" : "bajó";
    const quien = clave === "confianza" ? `que confía suficiente o bastante en ${o.institucion === PNP ? "la Policía" : o.institucion}`
      : que && clave === "victimas" ? "que fue víctima" : que && clave === "denuncia" ? "de víctimas que denunció" : I.quien;
    l.innerHTML = verbo === "se mantuvo" ? `${EnLugar(lugar)}, el porcentaje ${quien}${que} se mantuvo cerca de ${destacar(pct(v1))} entre ${a0} y ${a1}.`
      : `${EnLugar(lugar)}, el porcentaje ${quien}${que} ${verbo} de ${pct(v0)} en ${a0} a ${destacar(pct(v1))} en ${a1}.`;
  }
}

/* Qué pasó con la denuncia / por qué no denunció: todos los delitos juntos */
function pintarDenunciaDetalle() {
  const comp = lugarComp();
  for (const [id, p, col] of [["resultado", "denuncia_resultado", "resultado"], ["motivo", "no_denuncia_motivo", "motivo"]]) {
    const cats = [...new Set(FILAS[p].filter((f) => f.delito === TODOS).map((f) => f[col]))];
    const items = cats.map((c) => ({ clave: c, etiqueta: c, x: agregado(p, col, c), k: comp ? agregado(p, col, c, comp) : null }));
    const datos = barras(`g-${id}`, items, `${col === "resultado" ? "Qué pasó con la denuncia" : "Por qué no denunció"}, ${enLugar(estado.region)}, ${estado.anio}`,
      { seleccion: enFoco(col), alClic: (c) => { enfocar(col, c); render(); } });
    notaRef(id, datos);
    const top = [...datos].sort((a, b) => b.valor - a.valor)[0];
    const de = txtDelitos();
    document.getElementById(`l-${id}`).innerHTML = top
      ? (col === "resultado" ? `En el ${destacar(pct(top.valor))} de las denuncias${de}, ${Obs.minus(top.etiqueta.replace(" *", ""))}.`
        : `El motivo más citado para no denunciar${de}: «${Obs.minus(top.etiqueta.replace(" *", ""))}» (${destacar(pct(top.valor))}).`)
      : `${EnLugar(estado.region)} no hay denuncias de los delitos elegidos en ${estado.anio}.`;
  }
}

/* --- Pestaña 2: percepción --- */
function pintarBrecha() {
  const lugar = estado.region, comp = lugarComp();
  // Con un solo delito elegido, la brecha es la de ese delito
  const d = unico();
  const o = d ? { delito: d } : {};
  const nomP = d ? `Creen que pueden ser víctimas de ${Obs.minus(CORTO[d] ?? d)}` : "Creen que pueden ser víctimas";
  const nomV = d ? `Fueron víctimas de ${Obs.minus(CORTO[d] ?? d)}` : "Fueron víctimas";
  const series = [
    { nombre: nomP, color: C.percepcion, valores: ANIOS.map((a) => vInd("percepcion", lugar, a, o)) },
    { nombre: nomV, color: C.victimas, valores: ANIOS.map((a) => vInd("victimas", lugar, a, o)) },
  ];
  if (comp) series.push({ nombre: `${nomP} (${nombre(comp)})`, color: C.percepcion, punteada: true, valores: ANIOS.map((a) => vInd("percepcion", comp, a, o)) },
    { nombre: `${nomV} (${nombre(comp)})`, color: C.victimas, punteada: true, valores: ANIOS.map((a) => vInd("victimas", comp, a, o)) });
  leyenda("ley-brecha", series.filter((s) => !s.punteada).map((s) => [s.nombre, s.color]), { comparacion: comp ? nombre(comp) : null });
  lineas("g-brecha", series, { aria: `Percepción y victimización, ${enLugar(lugar)}` });
  const p = vInd("percepcion", lugar, estado.anio, o), v = vInd("victimas", lugar, estado.anio, o);
  const que = d ? ` de ${Obs.minus(d)}` : " de un delito";
  document.getElementById("l-brecha").innerHTML = p != null && v ? `${EnLugar(lugar)}, en ${estado.anio}, el ${destacar(pct(p))} cree que puede ser víctima${que}, pero el ${destacar(pct(v))} lo fue en el último año: ${destacar(Obs.fmtN(p / v, 1))} veces más.` : "";
  document.getElementById("n-brecha").textContent = !todos() && !d ? "Con varios delitos elegidos se muestra «al menos un delito». Elige uno solo para ver su brecha." : "";
}

function pintarPercepcionDelitos() {
  const comp = lugarComp(), sel = todos() ? null : new Set([...estado.delitos]);
  const lista = ["Robo a su vivienda", ...DELITOS];
  const items = lista.map((d) => ({ clave: d, etiqueta: d, x: dato("percepcion", { delito: d }), k: comp ? dato("percepcion", { delito: d }, comp) : null, color: C.percepcion }));
  const datos = barras("g-perc-delitos", items, `Creen que pueden ser víctimas, por delito, ${enLugar(estado.region)}, ${estado.anio}`,
    { seleccion: sel, alClic: (d) => { if (DELITOS.includes(d)) alternarDelito(d); enfocar("percepcion", d); render(); } });
  notaRef("perc-delitos", datos);
  const vistos = sel ? datos.filter((d) => sel.has(d.clave)) : datos;
  const top = [...vistos].sort((a, b) => b.valor - a.valor)[0];
  document.getElementById("l-perc-delitos").innerHTML = top ? `${sel ? "Entre los delitos elegidos, el" : "El"} temor más extendido es ${conA(top.clave)} ${Obs.minus(top.etiqueta.replace(" *", ""))}: ${destacar(pct(top.valor))}.` : "";
  document.getElementById("n-perc-delitos").textContent += " En robos de vehículo, autopartes, moto y bicicleta, el porcentaje es sobre toda la población, tenga o no ese bien.";
}

function pintarLugares() {
  const comp = lugarComp();
  const lugares = [...new Set(FILAS.inseguridad.map((f) => f.lugar))];
  const items = lugares.map((l) => ({ clave: l, etiqueta: l, x: dato("inseguridad", { lugar: l }), k: comp ? dato("inseguridad", { lugar: l }, comp) : null, color: C.percepcion }));
  const datos = barras("g-lugares", items, `Se sienten inseguros, por lugar, ${enLugar(estado.region)}, ${estado.anio}`,
    { seleccion: enFoco("lugar"), alClic: (l) => { enfocar("lugar", l); render(); } });
  notaRef("lugares", datos);
  const av = document.getElementById("av-lugares");
  av.textContent = estado.anio < 2022 ? `Los lugares como la casa, el mercado o el transporte se preguntan desde 2022. En ${estado.anio} solo hay ${datos.length === 1 ? "un lugar" : "estos lugares"}.` : "";
  const top = [...datos].sort((a, b) => b.valor - a.valor)[0];
  document.getElementById("l-lugares").innerHTML = top ? `Donde más inseguros se sienten: ${Obs.minus(top.etiqueta.replace(" *", ""))} (${destacar(pct(top.valor))}).` : "";
}

function pintarEvolInseguridad() {
  const e = estado.evol.inseguridad, card = document.getElementById("c-evol-inseguridad");
  $("[data-in-ind]", card).innerHTML = botones([{ valor: "zona", etiqueta: "En su zona o barrio" }, { valor: "noche", etiqueta: "Caminando de noche" }], e.ind);
  $("[data-in-verpor]", card).innerHTML = botones(["Total", "Sexo", "Edad"].map((v) => ({ valor: v, etiqueta: v })), e.verPor);
  pintarEvol("evol-inseguridad", e.ind, {}, e.verPor, lugarComp());
  document.getElementById("n-evol-inseguridad").textContent = e.ind === "zona" ? "La pregunta sobre su zona o barrio se hace desde 2019." : "";
}

function pintarRazones(id, p, titulo, color, tipo) {
  const comp = lugarComp();
  if (sinAnio(id, p, { razon: FILAS[p][0].razon })) return;
  const razones = [...new Set(FILAS[p].map((f) => f.razon))];
  const items = razones.map((r) => ({ clave: r, etiqueta: r, x: dato(p, { razon: r }), k: comp ? dato(p, { razon: r }, comp) : null, color }));
  const datos = barras(`g-${id}`, items, `${titulo}, ${enLugar(estado.region)}, ${estado.anio}`,
    { seleccion: enFoco(tipo), alClic: (r) => { enfocar(tipo, r); render(); } });
  notaRef(id, datos);
  const top = [...datos].sort((a, b) => b.valor - a.valor)[0];
  document.getElementById(`l-${id}`).innerHTML = top ? `La razón más citada: «${Obs.minus(top.etiqueta.replace(" *", ""))}» (${destacar(pct(top.valor))}).` : "";
}

/* --- Pestaña 3: Policía e instituciones --- */
const RESPUESTAS = ["Nada", "Poca", "Suficiente", "Bastante"];
function pintarConfianzaInstituciones() {
  const id = "conf-inst", lugar = estado.region;
  const insts = [...new Set(FILAS.confianza.map((f) => f.institucion))];
  const filas = insts.map((i) => ({ i, r: RESPUESTAS.map((r) => dato("confianza", { institucion: i, respuesta: r })?.v ?? null) })).filter((f) => f.r.some((v) => v != null));
  const el = document.getElementById(`g-${id}`);
  document.getElementById(`ley-${id}`).innerHTML = RESPUESTAS.map((r, k) => `<span><i class="bloque" style="background:${C.conf[k]}"></i>${r}</span>`).join("");
  if (!filas.length) return Obs.vacio(`g-${id}`);
  filas.sort((a, b) => (b.r[2] ?? 0) + (b.r[3] ?? 0) - (a.r[2] ?? 0) - (a.r[3] ?? 0));
  el.style.height = `${filas.length * 64 + 20}px`;
  const g = Obs.grafico(`g-${id}`);
  g.resize();
  const angosto = el.clientWidth < 520;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,84,.05)" } },
      formatter: (ps) => `<strong>${Obs.escapar(ps[0].name)}</strong>` + ps.filter((p) => p.value != null).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: angosto ? 110 : 190, right: 16, top: 4, bottom: 4 },
    xAxis: { type: "value", max: 1, show: false },
    yAxis: { type: "category", inverse: true, data: filas.map((f) => (angosto && f.i === "Municipalidad del distrito" ? "Municipalidad" : f.i)), axisTick: { show: false }, axisLine: { show: false },
      axisLabel: txt({ color: C.texto, width: angosto ? 100 : 180, overflow: "break", fontWeight: 600 }) },
    series: RESPUESTAS.map((r, k) => ({
      name: r, type: "bar", stack: "c", barWidth: 30, cursor: "pointer",
      itemStyle: { color: C.conf[k] },
      data: filas.map((f) => f.r[k]),
      label: { show: true, formatter: (p) => (p.value >= 0.06 ? `${Math.round(p.value * 100)} %` : ""), color: k === 1 ? C.navy : "#fff", fontFamily: C.fuente, fontSize: 14, fontWeight: 700 },
    })),
  }, true);
  el.setAttribute("aria-label", `Confianza en cada institución, ${enLugar(lugar)}, ${estado.anio}`);
  g.off("click");
  g.on("click", (p) => { enfocar("confianza", filas[p.dataIndex].i); render(); });
  const mejor = filas[0], peor = filas.at(-1);
  const s = (f) => (f.r[2] ?? 0) + (f.r[3] ?? 0);
  const art = (i) => ({ "Policía Nacional": "la Policía Nacional", "Municipalidad del distrito": "la municipalidad del distrito", "Poder Judicial": "el Poder Judicial", "Ministerio Público": "el Ministerio Público" })[i] ?? i;
  document.getElementById(`l-${id}`).innerHTML = `${EnLugar(lugar)}, en ${estado.anio}, la institución que más confianza inspira es ${art(mejor.i)} (${destacar(pct(s(mejor)))} confía suficiente o bastante) y la que menos, ${art(peor.i)} (${pct(s(peor))}).`;
  const notas = [];
  if (estado.anio <= 2017) notas.push(`En ${estado.anio} la encuesta no tenía la opción «suficiente»: solo nada, poca o mucha.`);
  if (estado.anio >= 2024) notas.push("Desde 2024 solo se pregunta a quienes conocen las funciones de cada institución.");
  document.getElementById(`n-${id}`).textContent = notas.join(" ");
}

function pintarEvolConfianza() {
  const e = estado.evol.confianza, card = document.getElementById("c-evol-confianza");
  const insts = [...new Set(FILAS.confianza.map((f) => f.institucion))];
  $("#cf-inst").innerHTML = opciones(insts.map((i) => ({ valor: i, etiqueta: i })), e.institucion);
  const conGrupos = e.institucion === PNP;
  if (!conGrupos) e.verPor = "Total";
  $("[data-cf-verpor]", card).innerHTML = botones(["Total", "Sexo", "Edad"].map((v) => ({ valor: v, etiqueta: v, desactivado: v !== "Total" && !conGrupos })), e.verPor);
  pintarEvol("evol-confianza", "confianza", { institucion: e.institucion }, e.verPor, lugarComp(),
    [{ anio: 2018, texto: "Cambio de cuestionario" }, { anio: 2024, texto: "Solo quienes conocen la institución" }]);
  document.getElementById("n-evol-confianza").textContent = "Hasta 2017 la encuesta no tenía la opción «suficiente», por eso la confianza sube en 2018. Desde 2024 solo se pregunta a quienes conocen las funciones de la institución.";
}

function pintarVigilancia() {
  const id = "vigilancia", comp = lugarComp();
  const quienes = [...new Set(FILAS.vigilancia.map((f) => f.quien))];
  const items = quienes.map((q) => ({ clave: q, etiqueta: q, x: dato("vigilancia", { quien: q, medida: "Hay vigilancia" }), k: comp ? dato("vigilancia", { quien: q, medida: "Hay vigilancia" }, comp) : null }));
  const datos = barras(`g-${id}`, items, `Hay vigilancia en su zona, ${enLugar(estado.region)}, ${estado.anio}`,
    { seleccion: enFoco("vigilancia"), alClic: (q) => { enfocar("vigilancia", q); render(); } });
  notaRef(id, datos);
  const cal = quienes.map((q) => [q, dato("vigilancia", { quien: q, medida: "La califica buena o muy buena" })]).filter((x) => x[1]);
  document.getElementById(`l-${id}`).innerHTML = cal.length
    ? `De quienes ven vigilancia, la califican como buena o muy buena: ${cal.map(([q, x]) => `${q === PNP ? "la Policía" : q === "Serenazgo" ? "el serenazgo" : "la Policía y el serenazgo juntos"}, ${destacar(pct(x.v))}`).join("; ")}.` : "";
}

function pintarDesempeno() {
  const id = "desempeno", comp = lugarComp();
  if (sinAnio(id, "desempeno", { aspecto: "Atender pronto cuando ocurre un delito" })) return;
  const aspectos = [...new Set(FILAS.desempeno.map((f) => f.aspecto))];
  const items = aspectos.map((a) => ({ clave: a, etiqueta: a, x: dato("desempeno", { aspecto: a }), k: comp ? dato("desempeno", { aspecto: a }, comp) : null }));
  const datos = barras(`g-${id}`, items, `Califican bien a la Policía, ${enLugar(estado.region)}, ${estado.anio}`,
    { seleccion: enFoco("desempeno"), alClic: (a) => { enfocar("desempeno", a); render(); } });
  notaRef(id, datos);
  const bajo = [...datos].sort((a, b) => a.valor - b.valor)[0];
  document.getElementById(`l-${id}`).innerHTML = bajo ? `Lo peor calificado: ${Obs.minus(bajo.etiqueta.replace(" *", ""))} (solo ${destacar(pct(bajo.valor))} lo califica como bueno o muy bueno).` : "";
}

/* ---------------------------------------------------------
   Mapa o cuadrícula, con ranking (uno por pestaña)
   --------------------------------------------------------- */
function htmlMapa(m) {
  return `<article class="tarjeta" id="c-mapa-${m}">
    <header><h3>¿Cómo está cada región?</h3>
      <p>Valor de cada región en el año elegido arriba. Haz clic en una barra de los gráficos de esta pestaña para compararla aquí entre regiones, o en una región del mapa o de la tabla para elegirla en todo el tablero.</p></header>
    <div class="controles">
      ${local(`mi-${m}`, "Indicador", `<div class="segmentado claro" data-mapa-ind></div>`)}
      ${local(`mv-${m}`, "Ver como", `<div class="segmentado claro" data-vista></div>`)}
    </div>
    <p class="foco-mapa" id="foco-${m}" hidden></p>
    <p class="aviso-anio" id="av-mapa-${m}"></p>
    <p class="lectura" id="l-mapa-${m}" aria-live="polite"></p>
    <div class="mapa-y-tabla" id="mt-${m}">
      <div><div id="mapa-${m}"></div><div class="cuadricula" id="cuad-${m}" role="group" aria-label="Regiones en cuadrícula"></div><div class="leyenda-mapa" id="ley-mapa-${m}"></div></div>
      <div id="t-mapa-${m}"></div>
    </div>
  </article>`;
}

function defMapa(m) {
  const f = estado.foco[m];
  if (f && FOCOS[f.tipo]) return FOCOS[f.tipo](f.clave);
  const clave = estado.mapa[m].ind, I = IND[clave];
  const d = I.delitos ? unico() : null;
  return { titulo: d ? `${I.corto} (${Obs.minus(d)})` : I.corto, valor: (r) => ind(clave, r, estado.anio, d ? { delito: d } : {}), primero: aniosInd(clave, NACIONAL, d ? { delito: d } : {})[0] };
}

function pintarMapa(m) {
  const card = document.getElementById(`c-mapa-${m}`), f = estado.foco[m];
  const def = defMapa(m);
  $("[data-mapa-ind]", card).innerHTML = botones(MOD[m].mapa.map((i) => ({ valor: i, etiqueta: IND[i].corto })), f ? null : estado.mapa[m].ind);
  $("[data-vista]", card).innerHTML = botones([{ valor: "mapa", etiqueta: "Mapa" }, { valor: "cuadricula", etiqueta: "Cuadrícula" }], estado.vista);
  const foco = document.getElementById(`foco-${m}`);
  foco.hidden = !f;
  foco.innerHTML = f ? `En el mapa: ${destacar(Obs.escapar(def.titulo))} <button type="button" class="quitar-foco" data-quitar-foco>Volver al indicador</button>` : "";
  const filas = Object.keys(NOMBRES).map((r) => ({ region: r, x: def.valor(r) })).filter((x) => x.x).map((x) => ({ ...x, v: x.x.v })).sort((a, b) => b.v - a.v);
  const cuerpo = document.getElementById(`mt-${m}`), lectura = document.getElementById(`l-mapa-${m}`);
  document.getElementById(`av-mapa-${m}`).textContent = !filas.length && def.primero && estado.anio < def.primero ? `Esta pregunta se hace desde ${def.primero}. Elige ${def.primero} o un año posterior arriba.` : "";
  cuerpo.hidden = !filas.length;
  if (!filas.length) { lectura.textContent = def.primero && estado.anio < def.primero ? "" : "No hay datos regionales para esta selección."; return; }
  const valores = new Map(filas.map((x) => [x.region, x.v * 100]));
  const cortes = Obs.cortesCuantiles([...valores.values()]);
  const colorDe = (v) => Obs.colorTramo(v, cortes, C.escala);
  const etiqueta = (r) => { const x = filas.find((y) => y.region === r); return x ? `${pct(x.v)}${ref(x.x) ? " *" : ""}` : "sin datos"; };
  const enMapa = estado.vista === "mapa";
  document.getElementById(`mapa-${m}`).hidden = !enMapa;
  document.getElementById(`cuad-${m}`).hidden = enMapa;
  if (enMapa) {
    if (!mapas[m]) mapas[m] = new Obs.Mapa(`mapa-${m}`, GEO, { alClic: elegirRegion, nombre });
    mapas[m].pintar({ valores, color: colorDe, texto: (v) => `${Obs.fmtN(v, 1)} %`, elegida: estado.region });
  } else {
    // Cuadrícula: todas las regiones del mismo tamaño, así se ven Callao y Lima Metropolitana
    const oscuro = new Set(C.escala.slice(2));
    document.getElementById(`cuad-${m}`).innerHTML = Object.entries(CUADRO).sort((a, b) => a[1][1] - b[1][1] || a[1][0] - b[1][0]).map(([r, [c, fi]]) => {
      const v = valores.get(r), fondo = v != null ? colorDe(v) : null;
      return `<button type="button" data-region="${r}" style="grid-column:${c + 1};grid-row:${fi + 1};${fondo ? `background:${fondo}` : ""}" class="${fondo ? (oscuro.has(fondo) ? "oscuro" : "claro") : "sin-dato"}" aria-pressed="${r === estado.region}" aria-label="${nombre(r)}: ${etiqueta(r)}">` +
        `${Obs.escapar(nombre(r).length > 11 ? abreviar(r) : nombre(r))}<span>${v != null ? `${Obs.fmtN(v, 0)} %` : "—"}</span></button>`;
    }).join("");
  }
  Obs.leyendaTramos(`ley-mapa-${m}`, cortes, C.escala, (v) => `${Obs.fmtN(v, 0)} %`);

  const peru = def.valor(NACIONAL);
  const alto = filas[0], bajo = filas.at(-1);
  let t = `En ${estado.anio} (${Obs.minus(def.titulo)}), ${destacar(nombre(alto.region))} tiene el valor más alto (${pct(alto.v)}) y ` +
    `${destacar(nombre(bajo.region))} el más bajo (${pct(bajo.v)})` + (peru ? `; el Perú, ${pct(peru.v)}` : "");
  if (estado.region !== NACIONAL) {
    const p = filas.findIndex((x) => x.region === estado.region);
    if (p >= 0) t += `. ${nombre(estado.region)} está en el puesto ${destacar(`${p + 1} de ${filas.length}`)}`;
  }
  lectura.innerHTML = `${t}.` + (filas.some((x) => ref(x.x)) ? " Las regiones con * tienen menos de 30 encuestados: son referenciales." : "");

  const lista = filas.map((x, i) => ({ region: x.region, nombre: nombre(x.region), v: x.v, r: ref(x.x), pos: i + 1 }));
  if (peru) lista.push({ region: NACIONAL, nombre: "Perú", v: peru.v, r: false, pos: null });
  tablaOrdenable(`t-mapa-${m}`, [
    { clave: "pos", titulo: "#", num: true, valor: (x) => (x.pos ?? filas.filter((y) => y.v > x.v).length + 0.5), html: (x) => (x.pos ? String(x.pos) : "") },
    { clave: "nombre", titulo: "Región", valor: (x) => x.nombre, html: (x) => Obs.escapar(x.nombre) + (x.r ? " *" : "") },
    { clave: "v", titulo: "Porcentaje", num: true, valor: (x) => x.v,
      html: (x) => pct(x.v) },
  ], lista, { inicial: { clave: "v", dir: -1 }, claveFila: (x) => x.region, elegida: estado.region, alClic: elegirRegion, buscar: "Nombre de la región",
    claseFila: (x) => (x.region === NACIONAL ? "peru" : ""), descripcion: `${def.titulo} por región, ${estado.anio}` });
}

const abreviar = (r) => ({ "LIMA METROPOLITANA": "Lima Met.", "LIMA PROVINCIAS": "Lima Prov.", "MADRE DE DIOS": "Madre de D.", HUANCAVELICA: "Huancav." })[r] ?? nombre(r);

/* ---------------------------------------------------------
   Cifras clave y resumen
   --------------------------------------------------------- */
function delitoMasFrecuente(lugar, a) {
  return DELITOS.map((d) => [d, dato("victimizacion", { delito: d }, lugar, a)]).filter((x) => x[1]).sort((x, y) => y[1].v - x[1].v)[0] ?? null;
}

function pintarCifras(m) {
  const comp = lugarComp(), lugar = estado.region, a = estado.anio, d = unico();
  document.getElementById(`k-${m}`).innerHTML = MOD[m].kpis.map((k) => {
    if (k === "masFrecuente") {
      const top = delitoMasFrecuente(lugar, a);
      return `<div class="kpi"><span class="kpi-etiqueta">Delito más frecuente${todos() ? "" : " entre los elegidos"}</span>
        <span class="kpi-valor texto">${top ? Obs.escapar(top[0]) : "—"}</span>
        <span class="kpi-pie">${top ? `Lo sufrió el ${pct(top[1].v)} en ${a}` : "Sin datos"}</span></div>`;
    }
    const I = IND[k], o = I.delitos && d ? { delito: d } : {};
    const etiqueta = o.delito ? { victimas: "Fueron víctimas de", denuncia: "Denunciaron", percepcion: "Creen que pueden ser víctimas de" }[k] + ` ${Obs.minus(CORTO[d] ?? d)}` : I.etiqueta;
    const x = ind(k, lugar, a, o);
    if (!x) {
      const a0 = aniosInd(k, NACIONAL, o)[0];
      return `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">—</span><span class="kpi-pie">${a0 && a < a0 ? `Se pregunta desde ${a0}` : "Sin datos"}</span></div>`;
    }
    let cambio = "";
    const previo = ind(k, lugar, a - 1, o);
    if (previo) {
      const dd = x.v - previo.v, quieto = Math.abs(dd) < 0.0005;
      const mejora = I.mejor === "alto" ? dd > 0 : dd < 0;
      cambio = `<span class="kpi-cambio ${quieto ? "igual" : mejora ? "mejora" : "empeora"}"><span aria-hidden="true">${quieto ? "=" : dd > 0 ? "▲" : "▼"}</span> ${quieto ? "Igual" : puntos(dd)} frente a ${a - 1}<span class="solo-lectores"> (${quieto ? "sin cambio" : mejora ? "mejora" : "empeora"})</span></span>`;
    }
    const kc = comp ? ind(k, comp, a, o) : null;
    return `<div class="kpi">
      <span class="kpi-etiqueta">${etiqueta}</span>
      <div class="kpi-cuerpo"><span class="kpi-valor">${pct(x.v)}${ref(x) ? " *" : ""}</span>${chispa(ANIOS.map((y) => [y, vInd(k, lugar, y, o)]), C.unica)}</div>
      ${cambio}
      <span class="kpi-pie">${a}${lugar !== NACIONAL ? `, ${nombre(lugar)}` : ""}${kc ? `. ${nombre(comp)}: ${pct(kc.v)}` : ""}${!todos() && !d && I.delitos ? ". Al menos un delito" : ""}</span>
    </div>`;
  }).join("");
}

function pintarResumen(m) {
  const lugar = estado.region, comp = lugarComp(), a = estado.anio, el = document.getElementById(`r-${m}`), d = unico();
  const vs = (k, o = {}) => { const kc = comp ? ind(k, comp, a, o) : null; return kc ? ` (${nombre(comp)}: ${pct(kc.v)})` : ""; };
  const cambio = (k, o = {}) => {
    const x = ind(k, lugar, a, o), p = ind(k, lugar, a - 1, o);
    if (!x || !p || Math.abs(x.v - p.v) < 0.005) return "";
    return `, ${puntos(x.v - p.v)} ${x.v > p.v ? "más" : "menos"} que en ${a - 1}`;
  };
  const partes = [];
  if (m === "victimas") {
    const o = d ? { delito: d } : {};
    const v = ind("victimas", lugar, a, o), dn = ind("denuncia", lugar, a, o), top = delitoMasFrecuente(lugar, a);
    if (v) partes.push(`${EnLugar(lugar)}, en ${a}, el ${destacar(pct(v.v))} ${d ? `fue víctima de ${Obs.minus(d)}` : "fue víctima de al menos un delito en el último año"}${vs("victimas", o)}${cambio("victimas", o)}.`);
    if (dn) partes.push(`Solo el ${destacar(pct(dn.v))} de las víctimas lo denunció${vs("denuncia", o)}.`);
    if (top && !d) partes.push(`${todos() ? "El delito más frecuente" : "Entre los delitos elegidos, el más frecuente"} fue el ${Obs.minus(top[0])} (${pct(top[1].v)}).`);
    const p = lugar !== NACIONAL ? puesto("victimas", lugar, a, o) : null;
    if (p) partes.push(`Es la región número ${destacar(p.n)} de ${p.de} con más víctimas${d ? ` de ${Obs.minus(d)}` : ""}.`);
  } else if (m === "percepcion") {
    const o = d ? { delito: d } : {};
    const p = ind("percepcion", lugar, a, o), v = ind("victimas", lugar, a, o), z = ind("zona", lugar, a);
    if (p) partes.push(`${EnLugar(lugar)}, en ${a}, el ${destacar(pct(p.v))} cree que puede ser víctima ${d ? `de ${Obs.minus(d)}` : "de un delito"} en los próximos 12 meses${vs("percepcion", o)}${v ? `, aunque el ${pct(v.v)} lo fue en el último año` : ""}.`);
    if (z) partes.push(`Además, el ${destacar(pct(z.v))} se siente inseguro en su zona o barrio${vs("zona")}${cambio("zona")}.`);
  } else {
    const c = ind("confianza", lugar, a), pa = ind("patrullaje", lugar, a), co = ind("comisaria", lugar, a);
    if (c) partes.push(`${EnLugar(lugar)}, en ${a}, solo el ${destacar(pct(c.v))} confía en la Policía (suficiente o bastante)${vs("confianza")}${cambio("confianza")}.`);
    if (pa) partes.push(`El ${destacar(pct(pa.v))} dice que la Policía vigila su zona${vs("patrullaje")}.`);
    if (co) partes.push(`Y el ${destacar(pct(co.v))} califica como bueno o muy bueno el trabajo de su comisaría.`);
  }
  el.innerHTML = partes.length ? partes.join(" ") : `${EnLugar(lugar)} no hay datos en ${a} para esta pestaña.`;
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  const antes = estado.ambito;
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  if (antes === "nacional" && estado.ambito === "regional" && !("comparar" in parche) && !estado.comparar) estado.comparar = NACIONAL;
  if (estado.ambito === "nacional" && estado.comparar === NACIONAL) estado.comparar = "";
  render();
}
function elegirRegion(cod) {
  if (cod === NACIONAL || cod === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: cod });
}

function sincronizarControles() {
  controles.sincronizar(estado);
  multiDelitos.sincronizar(estado.delitos, { visible: estado.modulo !== "policia" });
  $("#f-anio").value = estado.anio;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  const comp = lugarComp();
  const delitos = estado.modulo === "policia" || todos() ? "" : `, ${unico() ? Obs.minus(unico()) : `${estado.delitos.size} delitos`}`;
  document.getElementById("viendo").innerHTML = `Mostrando: ${destacar(`${nombre(estado.region)}, ${estado.anio}${delitos}`)}${comp ? ` frente a ${destacar(nombre(comp))}` : ""}`;
  // Chips: los delitos elegidos, para quitarlos uno por uno, y «Limpiar filtros»
  const chips = [];
  if (estado.modulo !== "policia" && !todos()) {
    if (estado.delitos.size <= 4) for (const d of elegidos()) chips.push({ texto: d, quitar: { delito: d } });
    else chips.push({ texto: `${estado.delitos.size} delitos`, quitar: { delitos: "todos" } });
  }
  const sucio = !todos() || estado.region !== NACIONAL || estado.comparar || estado.anio !== ANIOS.at(-1) || Object.values(estado.foco).some(Boolean);
  document.getElementById("chips").innerHTML = chips.map((c) =>
    `<span class="chip">${Obs.escapar(c.texto)}<button type="button" data-quitar='${JSON.stringify(c.quitar)}' aria-label="Quitar ${Obs.escapar(c.texto)}">×</button></span>`).join("") +
    (sucio ? `<button type="button" class="chip-limpiar" data-limpiar>Limpiar filtros</button>` : "");
  document.getElementById("chips").hidden = !chips.length && !sucio;
}

function actualizarURL() {
  const f = estado.foco[estado.modulo];
  Obs.escribirURL({
    modulo: estado.modulo === "victimas" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    comparar: (estado.region === NACIONAL ? estado.comparar : estado.comparar === NACIONAL ? null : estado.comparar || "ninguna") || null,
    anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
    delitos: todos() ? null : elegidos().join("|"),
    foco: f ? `${f.tipo}:${f.clave}` : null,
  });
}

function render() {
  // un foco de delito que ya no está entre los elegidos se quita
  for (const m of MODULOS) {
    const f = estado.foco[m];
    if (f && ["victimizacion", "denuncia"].includes(f.tipo) && (todos() || !estado.delitos.has(f.clave))) estado.foco[m] = null;
    if (f && f.tipo === "percepcion" && DELITOS.includes(f.clave) && (todos() || !estado.delitos.has(f.clave))) estado.foco[m] = null;
  }
  sincronizarControles();
  const m = estado.modulo;
  pintarResumen(m);
  pintarCifras(m);
  if (m === "victimas") { pintarDelitos(); pintarEvolVictimas(); pintarDenunciaDetalle(); }
  if (m === "percepcion") { pintarBrecha(); pintarPercepcionDelitos(); pintarLugares(); pintarEvolInseguridad(); pintarRazones("razones-inseg", "razones_inseguridad", "Razones para sentirse inseguro", C.percepcion, "razon_inseg"); }
  if (m === "policia") { pintarConfianzaInstituciones(); pintarEvolConfianza(); pintarRazones("razones-desconf", "razones_desconfianza", "Razones para no confiar en la Policía", C.unica, "razon_desconf"); pintarVigilancia(); pintarDesempeno(); }
  igualarPares();
  pintarMapa(m);
  actualizarURL();
}

/* En un par de tarjetas lado a lado, los gráficos de barras toman la misma altura,
   para que la tarjeta con menos filas no quede con un hueco abajo */
function igualarPares() {
  document.querySelectorAll(`#c-${estado.modulo} .par`).forEach((par) => {
    const gs = [...par.querySelectorAll(":scope > .tarjeta:not([hidden]) .grafico:not([hidden])")].filter((g) => g.style.height);
    if (gs.length !== 2 || Math.abs(gs[0].getBoundingClientRect().left - gs[1].getBoundingClientRect().left) < 50) return;
    const alto = Math.max(...gs.map((g) => parseFloat(g.style.height)));
    gs.forEach((g) => { if (parseFloat(g.style.height) < alto) { g.style.height = `${alto}px`; Obs.grafico(g.id).resize(); } });
  });
}

function tarjetas() {
  const VP = (attr) => `<div class="segmentado claro" ${attr}></div>`;
  document.getElementById("c-victimas").innerHTML =
    par(tarjeta("delitos", "¿Qué delitos son más frecuentes?", "Porcentaje de personas que sufrió cada delito en los últimos 12 meses, en el año elegido."),
      tarjeta("denuncia-delito", "¿Cuántas víctimas denuncian cada delito?", "Porcentaje de las víctimas de cada delito que lo denunció.")) +
    tarjeta("evol-victimas", "¿Cómo ha cambiado desde 2014?", "Porcentaje de personas que fue víctima o, de las víctimas, que denunció, cada año.",
      { controles: local("ev-ind", "Indicador", VP("data-ev-ind")) + local("ev-vp", "Ver por", VP("data-ev-verpor")) }) +
    par(tarjeta("resultado", "¿Qué pasó con las denuncias?", "Resultado de cada delito denunciado: todos los delitos o los elegidos arriba."),
      tarjeta("motivo", "¿Por qué no denunciaron?", "Motivo principal para no denunciar cada delito: todos los delitos o los elegidos arriba.")) +
    htmlMapa("victimas");
  document.getElementById("c-percepcion").innerHTML =
    tarjeta("brecha", "¿Creemos estar más en peligro de lo que estamos?", "Porcentaje que cree que puede ser víctima de un delito en los próximos 12 meses, frente al que fue víctima en los últimos 12 meses.") +
    par(tarjeta("perc-delitos", "¿De qué delitos temen ser víctimas?", "Porcentaje que cree que puede ser víctima de cada delito en los próximos 12 meses."),
      tarjeta("lugares", "¿Dónde se sienten inseguros?", "Porcentaje que se siente inseguro o muy inseguro en cada lugar.")) +
    tarjeta("evol-inseguridad", "¿Quiénes se sienten más inseguros?", "Porcentaje que se siente inseguro o muy inseguro, cada año.",
      { controles: local("in-ind", "Dónde", VP("data-in-ind")) + local("in-vp", "Ver por", VP("data-in-verpor")) }) +
    tarjeta("razones-inseg", "¿Por qué se sienten inseguros?", "Razones que dan quienes se sienten inseguros en su zona o barrio. Pueden dar más de una.") +
    htmlMapa("percepcion");
  document.getElementById("c-policia").innerHTML =
    tarjeta("conf-inst", "¿Cuánto confían en cada institución?", "Confianza en cada institución en temas de seguridad ciudadana, en el año elegido.") +
    tarjeta("evol-confianza", "¿Cómo ha cambiado la confianza?", "Porcentaje que confía suficiente o bastante en la institución, cada año.",
      { controles: selectLocal("cf-inst", "Institución", "data-cf-inst") + local("cf-vp", "Ver por", VP("data-cf-verpor")) }) +
    par(tarjeta("razones-desconf", "¿Por qué no confían en la Policía?", "Razones que dan quienes confían poco o nada en la Policía. Pueden dar más de una."),
      tarjeta("vigilancia", "¿Hay vigilancia en su zona?", "Porcentaje que dice que en su zona o barrio vigila la Policía, el serenazgo o los dos juntos.")) +
    tarjeta("desempeno", "¿Cómo califican el trabajo de la Policía?", "Porcentaje que califica como bueno o muy bueno cada aspecto del trabajo de la Policía y de la comisaría de su zona.") +
    htmlMapa("policia");

  for (const m of MODULOS) {
    const caja = document.getElementById(`c-${m}`);
    caja.addEventListener("click", (e) => {
      if (e.target.closest("[data-quitar-foco]")) { estado.foco[m] = null; render(); return; }
      const reg = e.target.closest(".cuadricula button[data-region]");
      if (reg) return elegirRegion(reg.dataset.region);
      const b = e.target.closest("button[data-valor]");
      if (!b) return;
      const g = b.parentElement, v = b.dataset.valor;
      if (g.hasAttribute("data-ev-ind")) estado.evol.victimas.ind = v;
      else if (g.hasAttribute("data-ev-verpor")) estado.evol.victimas.verPor = v;
      else if (g.hasAttribute("data-in-ind")) estado.evol.inseguridad.ind = v;
      else if (g.hasAttribute("data-in-verpor")) estado.evol.inseguridad.verPor = v;
      else if (g.hasAttribute("data-cf-verpor")) estado.evol.confianza.verPor = v;
      else if (g.hasAttribute("data-mapa-ind")) { estado.mapa[m] = { ind: v }; estado.foco[m] = null; }
      else if (g.hasAttribute("data-vista")) estado.vista = v;
      else return;
      render();
    });
    caja.addEventListener("change", (e) => {
      if (e.target.matches("[data-cf-inst]")) estado.evol.confianza.institucion = e.target.value;
      else return;
      render();
    });
  }
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
const FILAS = {};
Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  GEO = geo;
  const css = getComputedStyle(document.documentElement);
  const token = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(), victimas: token("--victimas"), percepcion: token("--percepcion"), referencial: token("--referencial"),
    conf: ["--conf-nada", "--conf-poca", "--conf-suficiente", "--conf-bastante"].map(token),
    grupos: ["--grupo-1", "--grupo-2", "--grupo-3", "--grupo-4"].map(token) };

  const anios = new Set();
  for (const [p, dims] of Object.entries(DIMS)) {
    const tabla = datos.tablas[p];
    if (!tabla) continue;
    FILAS[p] = Obs.expandir(tabla);
    for (const f of FILAS[p]) {
      if (f.valor == null) continue;
      const lugar = f.codigo === "PE" ? NACIONAL : f.codigo;
      anios.add(+f.anio);
      D.set([p, lugar, +f.anio, ...dims.map((d) => f[d] ?? "")].join("|"), { v: +f.valor, n: f.n, m: f.muestra });
      if ((p === "denuncia_resultado" || p === "no_denuncia_motivo") && f.delito !== TODOS) BASE.set(`${p}|${lugar}|${+f.anio}|${f.delito}`, { b: f.base, m: f.muestra });
    }
  }
  ANIOS = [...anios].sort((a, b) => a - b);
  DELITOS = [...new Set(FILAS.victimizacion.map((f) => f.delito))].filter((d) => d !== ALGUNO);
  estado.anio = ANIOS.at(-1);
  estado.delitos = new Set(DELITOS);

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  // Estado inicial desde la URL
  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const reg = (q.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) Object.assign(estado, { ambito: "regional", region: reg, comparar: NACIONAL });
  const cmpq = (q.get("comparar") || "").toUpperCase();
  if (cmpq === "NINGUNA") estado.comparar = "";
  else if (NOMBRES[cmpq] || cmpq === NACIONAL) estado.comparar = cmpq;
  if (ANIOS.includes(+q.get("anio"))) estado.anio = +q.get("anio");
  const pedidos = (q.get("delitos") || "").split("|").filter((d) => DELITOS.includes(d));
  if (pedidos.length) estado.delitos = new Set(pedidos);
  const [ft, ...fk] = (q.get("foco") || "").split(":");
  if (FOCOS[ft] && fk.length) estado.foco[estado.modulo] = { tipo: ft, clave: fk.join(":") };

  // Filtros comunes: ámbito, región y comparación; y el año
  const filtros = document.getElementById("filtros");
  const regiones = Object.keys(NOMBRES).map((r) => ({ region: r, nombre: NOMBRES[r] }));
  controles = Obs.controlesComunes(filtros, { regiones, anios: [ANIOS[0], ANIOS.at(-1)], alCambiar: actualizar, comparar: true, periodo: false });
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <label for="f-anio">Año</label>
      <select id="f-anio" class="corto">${[...ANIOS].reverse().map((a) => `<option value="${a}">${a}</option>`).join("")}</select>
    </div>
`);
  multiDelitos = new Obs.Multiseleccion(filtros, { id: "f-delitos", etiqueta: "Delitos", todos: "Todos los delitos",
    opciones: DELITOS.map((d) => ({ valor: d, etiqueta: d })), alCambiar: (s) => actualizar({ delitos: new Set(s) }) });
  filtros.insertAdjacentHTML("beforeend", `<p class="viendo" id="viendo" aria-live="polite"></p><div class="chips" id="chips" hidden></div>`);
  document.getElementById("f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  document.getElementById("chips").onclick = (e) => {
    const q = e.target.closest("[data-quitar]");
    if (q) {
      const x = JSON.parse(q.dataset.quitar);
      if (x.delitos) estado.delitos = new Set(DELITOS);
      else { estado.delitos.delete(x.delito); if (!estado.delitos.size) estado.delitos = new Set(DELITOS); }
      return render();
    }
    if (e.target.closest("[data-limpiar]")) {
      Object.assign(estado, { ambito: "nacional", region: NACIONAL, comparar: "", anio: ANIOS.at(-1), delitos: new Set(DELITOS) });
      for (const m of MODULOS) estado.foco[m] = null;
      render();
    }
  };
  MODULOS.forEach((m) => document.getElementById(`r-${m}`).insertAdjacentHTML("beforebegin",
    `<p class="pista-arriba">Elige la región, el año y con quién comparar arriba. Haz clic en una región del mapa o de la tabla para elegirla en todo el tablero.</p>`));
  tarjetas();

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => {
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso) return;
      const sig = pestanas[(i + paso + pestanas.length) % pestanas.length];
      sig.focus();
      sig.click();
    };
  });

  let espera, anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });

  render();
});
