/* =========================================================
   Tablero de Indicadores electorales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma procesos/indicadores-electorales/procesar.py
   desde las bases de los tableros de elecciones presidenciales, congresales
   y subnacionales. Tablas:
     generales      anio, eleccion, concentracion, margen, nep, organizaciones
     subnacionales  anio, nivel, dep, ubigeo, region, provincia, distrito,
                    concentracion, margen, nep, organizaciones, anulada
     notas          tema, nota

   Patrón: un objeto `estado`, funciones puras de consulta y una sola
   función `render()`.

   Parámetros de URL:
     ?modulo=subnacionales&nivel=distrital&region=08&anio=2022&indicador=nep
     ?eleccion=congreso
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "indicadores-electorales";
const ARCHIVOS = [{ clave: "indicadores_electorales_base", etiqueta: "Indicadores electorales 2000-2026" }];
const MODULOS = ["generales", "subnacionales"];
const PE = "PE";
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const ELECCIONES = [["presidencial1", "Presidencial 1.ª vuelta"], ["presidencial2", "Presidencial 2.ª vuelta"], ["congreso", "Congreso"]];
const NOMBRE_ELECCION = { presidencial1: "la primera vuelta presidencial", presidencial2: "la segunda vuelta presidencial", congreso: "la elección del Congreso" };
const CAMARAS_2026 = [["diputados", "Diputados"], ["senado_nacional", "Senado (distrito nacional)"], ["senado_regional", "Senado (distritos regionales)"]];
const NIVELES = [["regional", "Regional"], ["regional2", "Regional 2.ª vuelta"], ["provincial", "Provincial"], ["distrital", "Distrital"]];
const NOMBRE_NIVEL = { regional: "la elección regional", regional2: "la segunda vuelta regional", provincial: "las elecciones provinciales", distrital: "las elecciones distritales" };
const LUGARES = { regional: "regiones", regional2: "regiones", provincial: "provincias", distrital: "distritos" };
const LUGAR = { regional: "Región", regional2: "Región", provincial: "Provincia", distrital: "Distrito" };
// Con artículo, para que concuerde: «las regiones», «las provincias», «los distritos»
const LOS = { regional: "las regiones", regional2: "las regiones", provincial: "las provincias", distrital: "los distritos" };
const INDICADORES = {
  concentracion: { nombre: "Concentración", fmt: (v) => pct(v), corto: "concentración" },
  margen: { nombre: "Margen de victoria", fmt: (v) => pp(v), corto: "margen de victoria" },
  nep: { nombre: "Número efectivo de partidos", fmt: (v) => n2(v), corto: "número efectivo de partidos" },
  organizaciones: { nombre: "Organizaciones", fmt: (v) => n0(v), corto: "número de organizaciones" },
};
/* Definiciones resumidas (al lado de los gráficos y bajo el selector de indicador) */
const DEFINICIONES = {
  concentracion: {
    titulo: "Concentración",
    texto: "Porcentaje de los votos válidos que obtienen, en total, los dos partidos más votados. En segunda vuelta siempre es 100 %, porque solo participan dos opciones. Una concentración alta indica que pocos partidos dominan el sistema, y una baja, que los votos están más repartidos entre diversas opciones.",
    cuenta: () => [`60 %`, "+", `20 %`, "=", `80 %`], pie: () => "Por ejemplo, si el partido A obtiene 60 % de los votos válidos y el partido B 20 %, la concentración es 80 %.",
  },
  margen: {
    titulo: "Margen de victoria",
    texto: "Mide el grado de rivalidad entre las principales opciones políticas. Se calcula como la diferencia entre el porcentaje de votos válidos del partido más votado y el del segundo. A mayor margen, menor competitividad, porque predomina el más votado. Un margen bajo refleja una contienda más reñida y un voto más distribuido.",
    cuenta: () => [`60 %`, "−", `20 %`, "=", `40 p. p.`], pie: () => "Con el mismo ejemplo, el margen es de 40 puntos porcentuales.",
  },
  nep: {
    titulo: "Número efectivo de partidos",
    texto: "Indica cuántos partidos de igual tamaño producirían el mismo reparto del voto. Un valor bajo significa que pocas organizaciones concentran los votos, y uno alto, que el voto se dispersa entre muchas.",
    cuenta: () => ["3 partidos con 33 %", "→", "3"], pie: () => "Se calcula como 1 entre la suma de los cuadrados de la proporción de votos de cada organización.",
  },
  organizaciones: {
    titulo: "Organizaciones",
    texto: "Partidos, movimientos y alianzas que se presentaron a la elección. Muchas organizaciones suponen una oferta amplia, pero también fragmentación. Pocas pueden indicar un sistema más consolidado o una oferta limitada.",
    cuenta: (f) => (f ? [`${n0(f.organizaciones)} organizaciones`, "→", `${n2(f.nep)} efectivas`] : null),
    pie: (f) => (f ? `En ${f.anio}, la distancia entre ambas cifras indica que la mayoría recibió pocos votos.` : ""),
  },
};
/* Panel de definiciones: cada una con una barra del color de su línea en el gráfico (también sirve de leyenda)
   y un ejemplo en forma de cuenta. f: la última elección, para el ejemplo con datos reales */
function definiciones(claves, f = null) {
  return claves.map((k) => {
    const d = DEFINICIONES[k], c = d.cuenta(f);
    const cuenta = c ? `<p class="cuenta" aria-label="Ejemplo">${c.map((x) => (["+", "−", "=", "→"].includes(x) ? `<span class="op">${x}</span>` : `<span>${x}</span>`)).join("")}</p>` : "";
    return `<section class="def" style="--c:${C.tema[k]}"><h4>${d.titulo}</h4><p>${d.texto}</p>${cuenta}<p class="cuenta-pie">${d.pie(f)}</p></section>`;
  }).join("");
}

const DEPS = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca", "07": "Callao",
  "08": "Cusco", "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque",
  "15": "Lima", "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura", "21": "Puno",
  "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};
// Código del mapa de regiones: la elección regional de Lima es la de Lima Provincias
const sinTilde = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const DEP_GEO = Object.fromEntries(Object.entries(DEPS).map(([c, n]) => [c, c === "15" ? "LIMA PROVINCIAS" : sinTilde(n)]));
const GEO_DEP = Object.fromEntries(Object.entries(DEP_GEO).map(([c, n]) => [n, c]));

const estado = { modulo: "generales", eleccion: "presidencial1", nivel: "regional", region: PE, provincia: null, anio: null, indicador: "margen", lugar: null };
let G = [], S = [], C, GEO = {};
const mapas = {}, GEO_FILTRADO = new Map(), NOMBRE_LUGAR = new Map(), ORDEN = {};

/* ---------- Formatos ---------- */
const $ = (s) => document.querySelector(s);
const pct = (v) => (v == null ? "—" : Obs.fmtPct(v, 1));
const pp = (v) => (v == null ? "—" : `${Obs.fmtN(v * 100, 1)} p. p.`);
const n0 = (v) => (v == null ? "—" : Obs.fmtN(v, 0));
const n2 = (v) => (v == null ? "—" : Obs.fmtN(v, 2));
const destacar = (s) => `<strong>${s}</strong>`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const MINUS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "a", "por", "para", "con"]);
const titulo = (s) => String(s ?? "").toLowerCase().split(" ").map((p, i) => (i && MINUS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const nombreRegion = (c) => (c === PE ? "Perú" : DEPS[c] ?? c);
const enAmbito = (c) => (c === PE ? "en el Perú" : `en ${nombreRegion(c)}`);
const nombreFila = (f) => (f.nivel.startsWith("regional") ? nombreRegion(f.dep) : (f.ubigeo && NOMBRE_LUGAR.get(f.ubigeo)) || titulo(f.nivel === "provincial" ? f.provincia : f.distrito));
const mediana = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const botones = (opciones, elegida, attr = "valor") => opciones.map(([v, e]) => `<button type="button" data-${attr}="${v}" aria-pressed="${v === elegida}">${e}</button>`).join("");

/* Cambio entre dos elecciones, con flecha neutra: que suba o baje no es bueno ni malo */
function cambio(d, fmt, anio0) {
  if (d == null) return `<span class="kpi-pie">Primera elección de la serie</span>`;
  if (Math.abs(d) < 1e-9) return `<span class="kpi-pie">Igual que en ${anio0}</span>`;
  return `<span class="kpi-cambio"><span aria-hidden="true">${d > 0 ? "▲" : "▼"}</span> ${fmt(Math.abs(d))} ${d > 0 ? "más" : "menos"} que en ${anio0}</span>`;
}
function kpis(id, lista) {
  $(id).innerHTML = lista.map(({ etiqueta, valor, pie, texto }) =>
    `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor${texto ? " texto" : ""}">${valor}</span>${pie}</div>`).join("");
}

/* ---------------------------------------------------------
   Elecciones generales
   --------------------------------------------------------- */
// Serie de la elección elegida. En el Congreso, 2026 es la Cámara de Diputados (la que se parece al Congreso unicameral)
function serieGeneral(e) {
  const filas = G.filter((f) => f.eleccion === e || (e === "congreso" && f.eleccion === "diputados")).sort((a, b) => a.anio - b.anio);
  return filas;
}
function pintarGenerales() {
  const e = estado.eleccion, serie = serieGeneral(e), ult = serie.at(-1), ant = serie.at(-2), seg = e === "presidencial2";
  const nombreUlt = e === "congreso" && ult.eleccion === "diputados" ? "la elección de Diputados" : NOMBRE_ELECCION[e];
  $("#r-generales").innerHTML = seg
    ? `En la segunda vuelta presidencial de ${ult.anio}, el ganador superó al segundo por ${destacar(pp(ult.margen))} de los votos válidos. ` +
      `La más reñida de la serie fue la de ${serie.reduce((m, f) => (f.margen < m.margen ? f : m)).anio}.`
    : `En ${nombreUlt} de ${ult.anio}, las dos organizaciones más votadas sumaron ${destacar(pct(ult.concentracion))} de los votos válidos, ` +
      `con un margen de ${destacar(pp(ult.margen))} entre ellas. El voto se repartió como si hubiera ${destacar(n2(ult.nep))} partidos de igual tamaño, entre ${ult.organizaciones} organizaciones.`;

  const d = (k) => (ant && ult[k] != null && ant[k] != null ? ult[k] - ant[k] : null);
  kpis("#k-generales", seg ? [
    { etiqueta: `Margen de victoria, ${ult.anio}`, valor: pp(ult.margen), pie: cambio(d("margen"), pp, ant?.anio) },
    { etiqueta: "Segunda vuelta más reñida", valor: String(serie.reduce((m, f) => (f.margen < m.margen ? f : m)).anio), texto: true, pie: `<span class="kpi-pie">Margen de ${pp(Math.min(...serie.map((f) => f.margen)))}</span>` },
    { etiqueta: "Segunda vuelta menos reñida", valor: String(serie.reduce((m, f) => (f.margen > m.margen ? f : m)).anio), texto: true, pie: `<span class="kpi-pie">Margen de ${pp(Math.max(...serie.map((f) => f.margen)))}</span>` },
    { etiqueta: "Concentración", valor: "100 %", pie: `<span class="kpi-pie">Siempre, porque compiten solo dos</span>` },
  ] : [
    { etiqueta: `Concentración, ${ult.anio}`, valor: pct(ult.concentracion), pie: cambio(d("concentracion"), pp, ant?.anio) },
    { etiqueta: `Margen de victoria, ${ult.anio}`, valor: pp(ult.margen), pie: cambio(d("margen"), pp, ant?.anio) },
    { etiqueta: `Número efectivo de partidos, ${ult.anio}`, valor: n2(ult.nep), pie: cambio(d("nep"), n2, ant?.anio) },
    { etiqueta: `Organizaciones, ${ult.anio}`, valor: n0(ult.organizaciones), pie: cambio(d("organizaciones"), n0, ant?.anio) },
  ]);

  const anios = serie.map((f) => String(f.anio));
  const a0 = anios[0], a1 = anios.at(-1);
  const nota2026 = e === "congreso" ? " En 2026, Cámara de Diputados." : "";
  // Concentración y margen (o solo margen en segunda vuelta)
  $("#t-conc").textContent = seg ? `Margen de victoria, ${a0}-${a1}` : `Concentración y margen de victoria, ${a0}-${a1}`;
  $("#d-conc").textContent = `Porcentaje de los votos válidos.${nota2026}`;
  const series = seg ? [["margen", "Margen de victoria", C.tema.margen]] : [["concentracion", "Concentración", C.tema.concentracion], ["margen", "Margen de victoria", C.tema.margen]];
  $("#ley-conc").innerHTML = series.map(([, n, c]) => `<span><i class="l" style="border-color:${c}"></i>${n}</span>`).join("");
  $("#def-conc").innerHTML = definiciones(seg ? ["margen"] : ["concentracion", "margen"]);
  lineas("g-conc", anios, series.map(([k, n, c]) => ({ nombre: n, color: c, datos: serie.map((f) => f[k]), fmt: pct })), { max: seg ? null : 1, fmtEje: (x) => `${Math.round(x * 100)} %` });

  // NEP y organizaciones (no en segunda vuelta)
  $("#par-nep").hidden = seg;
  if (!seg) {
    // El número efectivo de partidos y el de organizaciones, juntos: la distancia entre ambos dice cuántas recibieron pocos votos
    $("#t-nep").textContent = `Número efectivo de partidos y organizaciones, ${a0}-${a1}`;
    $("#d-nep").textContent = `Organizaciones que se presentaron y entre cuántas de igual tamaño se reparte el voto.${nota2026}`;
    const s2 = [{ nombre: "Organizaciones", color: C.tema.organizaciones, datos: serie.map((f) => f.organizaciones), fmt: n0 },
      { nombre: "Número efectivo de partidos", color: C.tema.nep, datos: serie.map((f) => f.nep), fmt: n2 }];
    $("#ley-nep").innerHTML = s2.map((x) => `<span><i class="l" style="border-color:${x.color}"></i>${x.nombre}</span>`).join("");
    lineas("g-nep", anios, s2, { min: 0, fmtEje: (x) => Obs.fmtN(x, 0) });
    $("#def-nep").innerHTML = definiciones(["nep", "organizaciones"], ult);
  }

  // Tabla: todas las elecciones de la serie (en el Congreso, las tres de 2026)
  const filas = e === "congreso" ? [...serie.filter((f) => f.eleccion === "congreso"), ...G.filter((f) => f.anio === 2026 && CAMARAS_2026.some(([k]) => k === f.eleccion))] : serie;
  $("#t-tabla-g").textContent = `${ELECCIONES.find(([k]) => k === e)[1]}: todas las elecciones`;
  $("#d-tabla-g").textContent = seg ? "En segunda vuelta compiten dos candidaturas: la concentración es 100 % y no se calcula el número efectivo de partidos." : "Indicadores sobre los votos válidos nacionales, con los del extranjero.";
  const etiq = (f) => (f.eleccion === "congreso" || !CAMARAS_2026.some(([k]) => k === f.eleccion) ? String(f.anio) : `${f.anio}: ${CAMARAS_2026.find(([k]) => k === f.eleccion)[1]}`);
  tablaOrdenable("t-generales", [
    { clave: "anio", titulo: "Elección", valor: (f) => f.anio * 10 + CAMARAS_2026.findIndex(([k]) => k === f.eleccion), html: etiq },
    ...(seg ? [] : [{ clave: "concentracion", titulo: "Concentración", num: true, valor: (f) => f.concentracion, html: (f) => pct(f.concentracion) }]),
    { clave: "margen", titulo: "Margen de victoria", num: true, valor: (f) => f.margen, html: (f) => pp(f.margen) },
    ...(seg ? [] : [
      { clave: "nep", titulo: "Número efectivo de partidos", num: true, valor: (f) => f.nep, html: (f) => n2(f.nep) },
      { clave: "organizaciones", titulo: "Organizaciones", num: true, valor: (f) => f.organizaciones, html: (f) => n0(f.organizaciones) },
    ]),
  ], filas, { inicial: { clave: "anio", dir: -1 }, descripcion: $("#t-tabla-g").textContent });
}

/* Gráfico de líneas por año: una o más series, con la última cifra al final de cada línea */
function lineas(id, anios, series, { min = 0, max = null, intervalo = null, fmtEje = (x) => x, compacto = false, conectar = true, resaltar = null } = {}) {
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((p) => `<br>${p.marker}${p.seriesName}: <strong>${series[p.seriesIndex].fmt(p.value)}</strong>`).join("") },
    grid: compacto ? { left: 40, right: 64, top: 12, bottom: 26 } : { left: 48, right: 72, top: 16, bottom: 30 },
    xAxis: { type: "category", data: anios, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt(compacto ? { fontSize: 12, interval: 0, formatter: (x) => (x === resaltar ? `{b|${x}}` : x), rich: { b: txt({ fontSize: 12, color: C.texto, fontWeight: 800 }) } } : {}) },
    yAxis: { type: "value", min, max, ...(intervalo ? { interval: intervalo } : { splitNumber: compacto ? 3 : 5 }), splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: fmtEje, ...(compacto ? { fontSize: 12 } : {}) }) },
    series: series.map((s) => ({
      name: s.nombre, type: "line", data: s.datos, symbol: "circle", symbolSize: compacto ? 6 : 7, connectNulls: conectar,
      lineStyle: { width: s.tipo ? 2 : 2.5, color: s.color, type: s.tipo ?? "solid" }, itemStyle: { color: s.color }, z: s.sinEtiqueta ? 1 : 3,
      endLabel: { show: !s.sinEtiqueta, formatter: (p) => s.fmt(p.value), ...txt({ color: s.color, fontWeight: 800, ...(compacto ? { fontSize: 12 } : {}) }) },
    })),
  }, true);
}

/* ---------------------------------------------------------
   Elecciones regionales y municipales
   --------------------------------------------------------- */
const aniosNivel = (nivel) => [...new Set(S.filter((f) => f.nivel === nivel).map((f) => f.anio))].sort((a, b) => a - b);
// ámbito: PE, una región (código de 2 dígitos) o una provincia (4 dígitos, para los distritos)
const enAlcance = (f, amb) => amb === PE || (amb.length === 2 ? f.dep === amb : String(f.ubigeo).startsWith(amb));
const filasSub = (anio, nivel, amb) => S.filter((f) => f.anio === anio && f.nivel === nivel && enAlcance(f, amb));
// Ámbito de la vista: en distritos, la provincia elegida (si hay); si no, la región
const ambito = () => (estado.nivel === "distrital" && estado.provincia ? estado.provincia : estado.region);
const nombreAmbito = (c) => (c === PE ? "Perú" : c.length === 4 ? `la provincia de ${NOMBRE_LUGAR.get(c) ?? c}` : nombreRegion(c));
const enAmbitoV = (c) => (c === PE ? "en el Perú" : `en ${nombreAmbito(c)}`);
const regionalNivel = () => estado.nivel.startsWith("regional");

function pintarSub() {
  const { nivel, region, anio } = estado, ind = INDICADORES[estado.indicador], amb = ambito();
  const fs = filasSub(anio, nivel, amb), validas = fs.filter((f) => !f.anulada);
  const unaRegion = regionalNivel() && region !== PE;
  const f1 = unaRegion ? fs[0] : null;
  const med = (k) => mediana(validas.map((f) => f[k]));
  const reñidas = validas.filter((f) => f.margen != null && f.margen < 0.05).length;
  const anuladas = fs.length - validas.length;

  // Resumen y cifras clave
  if (unaRegion && !f1) {
    $("#r-sub").textContent = `${nombreRegion(region)} no tuvo segunda vuelta regional en ${anio}.`;
  } else if (unaRegion) {
    $("#r-sub").innerHTML = `En ${NOMBRE_NIVEL[nivel]} de ${nombreRegion(region)} de ${anio}, las dos organizaciones más votadas sumaron ${destacar(pct(f1.concentracion))} de los votos válidos ` +
      `y el margen entre ellas fue de ${destacar(pp(f1.margen))}.` + (nivel === "regional" ? ` El número efectivo de partidos fue ${destacar(n2(f1.nep))}, con ${f1.organizaciones} organizaciones.` : "");
  } else {
    $("#r-sub").innerHTML = `En ${NOMBRE_NIVEL[nivel]} de ${anio} ${enAmbitoV(amb)}, en la mitad de ${LOS[nivel].replace(/ (\S+)$/, ` ${validas.length} $1`)} el margen entre los dos primeros fue menor de ${destacar(pp(med("margen")))}` +
      (nivel === "regional2" ? "." : `, y el número efectivo de partidos, mayor de ${destacar(n2(med("nep")))}.`) +
      (reñidas ? ` En ${reñidas} el margen fue menor de 5 puntos porcentuales.` : "") + (anuladas ? ` En ${anuladas} la elección se anuló.` : "");
  }
  const nombreAmb = amb === PE ? "del Perú" : `de ${nombreAmbito(amb)}`;
  kpis("#k-sub", unaRegion ? (f1 ? [
    { etiqueta: `Concentración, ${anio}`, valor: pct(f1.concentracion), pie: `<span class="kpi-pie">Mediana de las regiones: ${pct(mediana(filasSub(anio, nivel, PE).map((f) => f.concentracion)))}</span>` },
    { etiqueta: `Margen de victoria, ${anio}`, valor: pp(f1.margen), pie: `<span class="kpi-pie">Mediana de las regiones: ${pp(mediana(filasSub(anio, nivel, PE).map((f) => f.margen)))}</span>` },
    ...(nivel === "regional" ? [
      { etiqueta: `Número efectivo de partidos, ${anio}`, valor: n2(f1.nep), pie: `<span class="kpi-pie">Mediana de las regiones: ${n2(mediana(filasSub(anio, nivel, PE).map((f) => f.nep)))}</span>` },
      { etiqueta: `Organizaciones, ${anio}`, valor: n0(f1.organizaciones), pie: `<span class="kpi-pie">Mediana de las regiones: ${n0(mediana(filasSub(anio, nivel, PE).map((f) => f.organizaciones)))}</span>` },
    ] : []),
  ] : []) : [
    { etiqueta: "Concentración (mediana)", valor: pct(med("concentracion")), pie: `<span class="kpi-pie">${validas.length} ${LUGARES[nivel]} ${nombreAmb}</span>` },
    { etiqueta: "Margen de victoria (mediana)", valor: pp(med("margen")), pie: `<span class="kpi-pie">Mitad de las elecciones por debajo</span>` },
    nivel === "regional2"
      ? { etiqueta: "Segundas vueltas", valor: n0(fs.length), pie: `<span class="kpi-pie">De 25 regiones</span>` }
      : { etiqueta: "Número efectivo de partidos (mediana)", valor: n2(med("nep")), pie: `<span class="kpi-pie">Organizaciones (mediana): ${n0(med("organizaciones"))}</span>` },
    { etiqueta: "Elecciones reñidas", valor: n0(reñidas), pie: `<span class="kpi-pie">Margen menor de 5 p. p. (${pct(reñidas / (validas.length || 1))})</span>` },
  ]);

  // Indicadores disponibles: en segunda vuelta no hay número efectivo de partidos ni organizaciones
  const disp = Object.keys(INDICADORES).filter((k) => !(nivel === "regional2" && (k === "nep" || k === "organizaciones")));
  if (!disp.includes(estado.indicador)) estado.indicador = "margen";
  $("#f-indicador").innerHTML = botones(disp.map((k) => [k, INDICADORES[k].nombre]), estado.indicador, "ind");
  const d = DEFINICIONES[estado.indicador];
  $("#def-ind").innerHTML = `<strong>${d.titulo}.</strong> ${d.texto}`;
  pintarMapaSub();
  pintarFicha();
}

/* Elecciones anuladas por el JNE (sin indicadores) y posibles nulidades de 2026 (con indicadores, señaladas) */
const CAUSAL = {
  inasistencia: "votó menos de la mitad de los electores",
  nulos_blancos: "los votos nulos y en blanco superaron los dos tercios de los emitidos",
  irregularidades: "graves irregularidades",
  violencia: "actos de violencia o destrucción del material electoral",
  no_detallada: "", sin_actas: "aún sin actas contabilizadas",
};
const conCausal = (f) => (CAUSAL[f.causal] ? `: ${CAUSAL[f.causal]}` : "");
const marcaNulidad = (f) => (f.anulada ? `Anulada por el JNE${conCausal(f)}` : f.nulidad === "posible" ? `Posible nulidad${conCausal(f)}` : "");

/* Mapa (regiones, provincias o distritos) y, al lado, ranking (regiones) o distribución (provincias y distritos) */
const nivelGeo = (nivel) => (nivel.startsWith("regional") ? "regional" : nivel);
const claveGeo = (f) => (f.nivel.startsWith("regional") ? DEP_GEO[f.dep] : f.ubigeo);
function geoDe(nivel, region) {
  const k = `${nivel}|${region}`;
  if (!GEO_FILTRADO.has(k)) {
    const base = GEO[nivel];
    const dentro = (f) => (nivel === "regional" ? f.properties.region === DEP_GEO[region] : String(f.properties.region).startsWith(region));
    GEO_FILTRADO.set(k, region === PE ? base : { ...base, features: base.features.filter((f) => f.properties.tipo === "region" && dentro(f)) });
  }
  return GEO_FILTRADO.get(k);
}
const escalaContinua = () => ["#c3cdf7", ...C.escala];
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorContinuo(t) {
  const cs = escalaContinua().map(hexRGB);
  const x = Math.max(0, Math.min(1, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${cs[i].map((c, k) => Math.round(c + (cs[i + 1][k] - c) * f)).join(",")})`;
}
function pintarMapaSub() {
  const { nivel, region, anio } = estado, k = estado.indicador, ind = INDICADORES[k], ng = nivelGeo(nivel);
  // En el mapa regional se ven siempre todas las regiones (la elegida, resaltada); en provincias y distritos, solo la región elegida
  const regionMapa = ng === "regional" ? PE : ambito();
  const fs = filasSub(anio, nivel, regionMapa);
  const validas = fs.filter((f) => !f.anulada && f[k] != null);
  $("#t-mapa").textContent = `${ind.nombre} en ${NOMBRE_NIVEL[nivel]}, ${anio}`;
  $("#d-mapa").textContent = (k === "margen" ? "Los tonos más oscuros indican márgenes más amplios; los más claros, elecciones más reñidas." : "Los tonos más oscuros indican valores más altos.") +
    (ng === "regional" ? "" : region === PE ? ` Para ver ${LUGARES[nivel]} con más detalle, elija una región en «Ámbito».` : "");
  const vs = validas.map((f) => f[k]), min = Math.min(...vs), max = Math.max(...vs);
  const valores = new Map(validas.map((f) => [claveGeo(f), f[k]]));
  const CAPITAL = "capital";
  fs.filter((f) => f.anulada && f.ubigeo).forEach((f) => valores.set(f.ubigeo, f));
  if (nivel === "distrital") geoDe(ng, regionMapa).features.forEach((f) => { const c = f.properties.region; if (f.properties.tipo === "region" && c.endsWith("01") && !valores.has(c)) valores.set(c, CAPITAL); });
  const color = (v) => (v?.anulada ? "#e7b9c3" : v === CAPITAL ? "#ccd3dd" : colorContinuo(max > min ? (v - min) / (max - min) : 1));
  const texto = (v) => (v?.anulada ? `Elección anulada${conCausal(v)}` : v === CAPITAL ? "Capital de provincia: elige alcalde provincial" : ind.fmt(v));
  const caja = $("#mapa-sub"), clave = `${ng}-${regionMapa}`;
  caja.querySelectorAll(":scope > .mapa-nivel").forEach((d) => (d.hidden = d.dataset.clave !== clave));
  let div = caja.querySelector(`.mapa-nivel[data-clave="${clave}"]`);
  if (!div) { div = document.createElement("div"); div.className = "mapa-nivel"; div.dataset.clave = clave; div.id = `mapa-sub-${clave}`; caja.append(div); }
  if (!mapas[clave]) {
    mapas[clave] = new Obs.Mapa(div.id, geoDe(ng, regionMapa), {
      alClic: (g) => (ng === "regional" ? elegirRegion(GEO_DEP[g]) : elegirLugar(g)),
      nombre: (g) => (ng === "regional" ? (g === "LIMA METROPOLITANA" ? "Lima Metropolitana (no elige gobierno regional)" : nombreRegion(GEO_DEP[g])) : NOMBRE_LUGAR.get(g) ?? g),
      borde: ng === "regional" ? "#ffffff" : "#d9dee5",
    });
  }
  const M = mapas[clave];
  // El recuadro de Lima y Callao solo tiene sentido en el mapa de todo el país o de Lima o el Callao
  div.classList.toggle("sin-recuadro", regionMapa !== PE && !regionMapa.startsWith("15") && !regionMapa.startsWith("07"));
  if (regionMapa !== PE) M.principal.fitBounds = () => M.principal;
  M.pintar({ valores, color, texto, elegida: ng === "regional" ? (region === PE ? null : DEP_GEO[region]) : estado.lugar });
  // Una provincia es más chica que una región: se permite acercar más (el mapa común llega hasta 9)
  M.principal.setMaxZoom(regionMapa.length === 4 ? 12 : 9);
  if (regionMapa !== PE) { delete M.principal.fitBounds; M.principal.fitBounds(L.geoJSON(geoDe(ng, regionMapa)).getBounds(), { padding: [12, 12] }); }
  $("#ley-mapa").innerHTML = validas.length ? `<div class="ley-continua"><span>${ind.fmt(min)}</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${ind.fmt(max)}</span></div>` +
    `<div class="ley-extra">${fs.some((f) => f.anulada) ? '<span><i style="background:#e7b9c3"></i>Elección anulada por el JNE (sin indicadores)</span>' : ""}` +
    (nivel === "distrital" ? '<span><i style="background:#ccd3dd"></i>Capital de provincia (elige alcalde provincial)</span>' : "") +
    (ng === "regional" ? '<span><i style="background:#ccd3dd"></i>Sin elección (Lima Metropolitana no elige gobierno regional' + (nivel === "regional2" ? "; regiones sin segunda vuelta" : "") + ")</span>" : "") + "</div>" : "";
  const orden = [...validas].sort((a, b) => b[k] - a[k]);
  $("#l-mapa").innerHTML = orden.length > 1 ? `Va de ${destacar(ind.fmt(orden.at(-1)[k]))} en ${nombreFila(orden.at(-1))} a ${destacar(ind.fmt(orden[0][k]))} en ${nombreFila(orden[0])}.` +
    (ng === "regional" ? "" : ` La mediana es ${ind.fmt(mediana(vs))}`.replace(/\.?$/, ".")) : "";

  // Al lado: ranking de regiones, o distribución de provincias o distritos
  const ranking = ng === "regional";
  $("#g-lado").hidden = !ranking;
  $("#t-sub").hidden = ranking;
  if (ranking) {
    Obs.ranking("g-lado", validas.map((f) => ({ clave: f.dep, etiqueta: nombreRegion(f.dep), valor: f[k] })), {
      formato: ind.fmt, nombre: ind.nombre, color: C.tema[k], elegida: region === PE ? null : region, alClic: elegirRegion,
      referencia: { valor: mediana(vs), etiqueta: "Mediana" },
    });
  } else pintarTablaSub(fs);
}
/* Ficha regional: los cuatro indicadores de la región elegida (su valor, o la mediana de sus provincias o distritos),
   2002-2026, frente a la mediana del Perú. Sin región elegida, muestra el Perú y atajos a regiones destacadas. */
function valorRegion(anio, nivel, reg, k) {
  return mediana(filasSub(anio, nivel, reg).filter((f) => !f.anulada).map((f) => f[k]));
}
function pintarFicha() {
  const { nivel, region, anio } = estado, hay = region !== PE, seg = nivel === "regional2";
  const anios = aniosNivel(nivel);
  const regional = regionalNivel();
  const de = regional ? "" : ` (mediana de sus ${LUGARES[nivel]})`;
  const eleccion = NOMBRE_NIVEL[nivel].replace(/^(la|las) /, "");
  // Provincia o distrito elegido (en el mapa o en la lista): su serie, por su código, frente a su región y al Perú
  const lugar = !regional && estado.lugar ? estado.lugar : null;
  const filasLugar = lugar ? S.filter((f) => f.nivel === nivel && f.ubigeo === lugar) : [];
  const ref = filasLugar.at(-1);
  const nombreL = lugar ? NOMBRE_LUGAR.get(lugar) ?? (ref ? nombreFila(ref) : lugar) : "";
  const dondeL = ref ? (nivel === "distrital" ? `${titulo(ref.provincia)}, ${nombreRegion(ref.dep)}` : nombreRegion(ref.dep)) : "";
  $("#t-ficha").textContent = lugar ? `Ficha de ${nombreL} (${dondeL}): ${eleccion}`
    : hay ? `Ficha de ${nombreRegion(region)}: ${eleccion}` : `Ficha regional: ${eleccion}`;
  $("#d-ficha").textContent = lugar ? `Cada indicador de ${nombreL}, frente a la mediana de ${LOS[nivel]} de ${nombreRegion(region)} y del Perú, ${anios[0]}-${anios.at(-1)}.`
    : hay ? `Cada indicador de ${nombreRegion(region)}${de}, frente a la mediana del Perú, ${anios[0]}-${anios.at(-1)}.`
    : `Mediana del Perú en cada elección, ${anios[0]}-${anios.at(-1)}. Al elegir una región, se compara con ella.`;
  $("#f-region-ficha").value = region;

  // Atajos: regiones que destacan en el año elegido
  const vals = (k) => Object.keys(DEPS).map((c) => ({ c, v: valorRegion(anio, nivel, c, k) })).filter((x) => x.v != null);
  const extremo = (k, signo) => vals(k).sort((x, y) => signo * (y.v - x.v))[0];
  const atajo = (texto, x, fmt) => (x ? `<span class="atajo">${texto}: <button type="button" data-region="${x.c}">${nombreRegion(x.c)}</button> <em>${fmt(x.v)}</em></span>` : "");
  const sufijo = regional ? "" : " (mediana)";
  $("#atajos").innerHTML = hay ? "" : `<span class="atajos-titulo">Regiones que destacan en ${anio}${sufijo}</span>` +
    atajo("Elección más reñida", extremo("margen", -1), pp) + atajo("Mayor margen", extremo("margen", 1), pp) +
    (seg ? "" : atajo("Voto más disperso", extremo("nep", 1), n2) + atajo("Más organizaciones", extremo("organizaciones", 1), n0));
  $("#atajos").hidden = hay;

  const claves = seg ? ["margen"] : ["concentracion", "margen", "nep", "organizaciones"];
  // La serie principal va con el color de su indicador (el de la línea de arriba de cada gráfico); en la leyenda, una muestra con los cuatro
  const multi = `<i class="l multi" style="background:linear-gradient(90deg,${claves.map((k, i) => `${C.tema[k]} ${(i / claves.length) * 100}% ${((i + 1) / claves.length) * 100}%`).join(",")})"></i>`;
  const GRIS_CLARO = "#c3c9d3";
  $("#ley-ficha").innerHTML = lugar
    ? `<span>${multi}${nombreL}</span><span><i class="l" style="border-color:${C.gris}"></i>${nombreRegion(region)} (mediana)</span>` +
      `<span><i class="l punteada" style="border-color:${GRIS_CLARO}"></i>Perú (mediana)</span>`
    : (hay ? `<span>${multi}${nombreRegion(region)}${regional ? "" : " (mediana)"}</span>` : "") +
      `<span>${hay ? `<i class="l" style="border-color:${C.gris}"></i>` : multi}Perú (mediana de ${LOS[nivel]})</span>`;
  const caja = $("#ficha-graficos");
  if (caja.dataset.claves !== claves.join()) {
    caja.innerHTML = claves.map((k) => `<div class="mini" style="--c:${C.tema[k]}"><h4>${INDICADORES[k].nombre}</h4><div class="grafico mini-g" id="fg-${k}"></div></div>`).join("");
    caja.dataset.claves = claves.join();
  }
  caja.style.setProperty("--columnas", claves.length);
  // Años en que el JNE anuló la elección del lugar: sin indicadores, y la línea se corta
  const anuladas = filasLugar.filter((f) => f.anulada), posible = filasLugar.find((f) => f.nulidad === "posible");
  const listaAnios = (xs) => xs.join(", ").replace(/, ([^,]*)$/, " y $1");
  $("#n-ficha").innerHTML = (anuladas.length ? `El JNE anuló la elección de ${Obs.escapar(nombreL)} en ${listaAnios(anuladas.map((f) => `${f.anio}${CAUSAL[f.causal] ? ` (${CAUSAL[f.causal]})` : ""}`))}: ` +
      `${anuladas.length === 1 ? "ese año no tiene" : "esos años no tienen"} indicadores y las autoridades se eligieron en elecciones complementarias.` : "") +
    (posible ? ` En ${posible.anio}, posible nulidad${conCausal(posible)}; el JNE aún debe pronunciarse.` : "");

  for (const k of claves) {
    const ind = INDICADORES[k];
    const peru = anios.map((a) => valorRegion(a, nivel, PE, k));
    const propia = hay ? anios.map((a) => valorRegion(a, nivel, region, k)) : null;
    // Solo la serie principal lleva la cifra al final de la línea (las demás están en el tooltip)
    const series = lugar ? [
      { nombre: nombreL, color: C.tema[k], datos: anios.map((a) => { const f = filasLugar.find((x) => x.anio === a); return f && !f.anulada ? f[k] : null; }), fmt: ind.fmt },
      { nombre: `${nombreRegion(region)} (mediana)`, color: C.gris, datos: propia, fmt: ind.fmt, sinEtiqueta: true },
      { nombre: "Perú (mediana)", color: GRIS_CLARO, datos: peru, fmt: ind.fmt, sinEtiqueta: true, tipo: "dashed" },
    ] : [...(propia ? [{ nombre: nombreRegion(region), color: C.tema[k], datos: propia, fmt: ind.fmt }] : []),
      { nombre: "Perú (mediana)", color: hay ? C.gris : C.tema[k], datos: peru, fmt: ind.fmt, sinEtiqueta: hay }];
    const pctEje = k === "concentracion" || k === "margen";
    lineas(`fg-${k}`, anios.map(String), series, {
      min: 0, max: k === "concentracion" ? 1 : null, intervalo: k === "concentracion" ? 0.25 : null,
      fmtEje: (x) => (pctEje ? `${Math.round(x * 100)} %` : Obs.fmtN(x, 0)), compacto: claves.length > 1, conectar: !seg && !anuladas.length, resaltar: String(anio),
    });
  }
}

/* Al lado del mapa de provincias o distritos: la lista de lugares con sus indicadores, ordenada por el elegido.
   Un clic en una fila resalta el lugar en el mapa. */
function pintarTablaSub(fs) {
  const { nivel, region } = estado, k = estado.indicador;
  // Debajo del nombre, dónde queda (salvo que ya esté filtrado por esa provincia)
  const conRegion = (nivel === "distrital" && !estado.provincia) || region === PE;
  const corta = { concentracion: "Concentración", margen: "Margen", nep: "NEP", organizaciones: "Organizaciones" };
  const col = (c, html) => ({ clave: c, titulo: corta[c], num: true, valor: (f) => f[c], html, activa: c === k });
  // Al cambiar de indicador, la lista vuelve a ordenarse por él (de mayor a menor)
  if (pintarTablaSub.k !== `${nivel}|${k}`) { ORDEN["t-sub"] = { clave: k, dir: -1 }; pintarTablaSub.k = `${nivel}|${k}`; }
  tablaOrdenable("t-sub", [
    { clave: "lugar", titulo: LUGAR[nivel], valor: nombreFila,
      html: (f) => Obs.escapar(nombreFila(f)) + (conRegion ? `<small>${Obs.escapar(nivel === "distrital" ? `${titulo(f.provincia)}${region === PE ? `, ${nombreRegion(f.dep)}` : ""}` : nombreRegion(f.dep))}</small>` : "") +
        (marcaNulidad(f) ? `<small class="${f.anulada ? "anulada" : "posible"}">${marcaNulidad(f)}</small>` : "") },
    col("concentracion", (f) => (f.anulada ? "—" : pct(f.concentracion))),
    col("margen", (f) => (f.anulada ? "—" : pp(f.margen))),
    col("nep", (f) => (f.anulada ? "—" : n2(f.nep))),
    col("organizaciones", (f) => n0(f.organizaciones)),
  ], fs, {
    inicial: { clave: k, dir: -1 }, claveFila: (f) => f.ubigeo, alClic: elegirLugar, elegida: estado.lugar,
    descripcion: `${titulo(LUGARES[nivel])}${region === PE ? "" : ` de ${nombreRegion(region)}`}, ${estado.anio}`,
  });
  $("#t-sub").dataset.ver = k;
}

/* ---------------------------------------------------------
   Tabla ordenable (cifras centradas)
   --------------------------------------------------------- */
function tablaOrdenable(id, columnas, filas, { inicial, claveFila = () => "", elegida = null, descripcion, alClic = null }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  if (!columnas.some((c) => c.clave === orden.clave)) Object.assign(orden, inicial);
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const datos = [...filas].sort((a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  });
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    return `<th class="${c.num ? "num" : ""} c-${c.clave}${c.activa ? " activa" : ""}" aria-sort="${activo ? (orden.dir === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = String(claveFila(f));
    return `<tr data-k="${Obs.escapar(k)}"${alClic && k ? ' tabindex="0"' : ""}${k && k === elegida ? ' class="elegida"' : ""}>` + columnas.map((c) => `<td class="${c.num ? "num" : ""} c-${c.clave}${c.activa ? " activa" : ""}">${c.html(f)}</td>`).join("") + "</tr>";
  }).join("");
  el.innerHTML = `<table class="tabla ordenable centrada"><caption class="solo-lectores">${Obs.escapar(descripcion)}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  el.querySelector("thead").onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (!b) return;
    const c = columnas.find((x) => x.clave === b.dataset.orden);
    ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
    tablaOrdenable(id, columnas, filas, { inicial, claveFila, elegida, descripcion, alClic });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
  if (alClic) {
    const ir = (e) => { const r = e.target.closest("tbody tr[data-k]"); if (r && r.dataset.k && (e.type === "click" || e.key === "Enter")) alClic(r.dataset.k); };
    el.querySelector("tbody").onclick = ir;
    el.querySelector("tbody").onkeydown = ir;
  }
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function render() {
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  document.querySelectorAll("[data-modulo-filtro]").forEach((f) => (f.hidden = f.dataset.moduloFiltro !== estado.modulo));
  // Etiqueta de la región elegida, con su ✕ para volver a todo el Perú
  $("#filtro-viendo").hidden = estado.modulo !== "subnacionales" || estado.region === PE;
  // La ✕ quita lo último que se eligió: el lugar, luego la provincia, luego la región
  const conLugar = estado.lugar && !regionalNivel(), conProv = !conLugar && estado.provincia && estado.nivel === "distrital";
  const nombreChip = conLugar ? `${NOMBRE_LUGAR.get(estado.lugar) ?? estado.lugar}, ${nombreRegion(estado.region)}`
    : conProv ? `${NOMBRE_LUGAR.get(estado.provincia) ?? estado.provincia}, ${nombreRegion(estado.region)}` : nombreRegion(estado.region);
  $("#chip-region").innerHTML = `${nombreChip} <span aria-hidden="true">✕</span>`;
  $("#chip-region").setAttribute("aria-label", `Quitar ${nombreChip}: volver a ${conLugar || conProv ? nombreRegion(estado.region) : "todo el Perú"}`);
  pintarFiltrosLugar();
  $("#m-generales").hidden = estado.modulo !== "generales";
  $("#m-subnacionales").hidden = estado.modulo !== "subnacionales";
  $("#f-eleccion").innerHTML = botones(ELECCIONES, estado.eleccion, "eleccion");
  $("#f-nivel").innerHTML = botones(NIVELES, estado.nivel, "nivel");
  const anios = aniosNivel(estado.nivel);
  if (!anios.includes(estado.anio)) estado.anio = anios.at(-1);
  $("#f-anio").innerHTML = [...anios].reverse().map((a) => `<option value="${a}"${a === estado.anio ? " selected" : ""}>${a}</option>`).join("");
  $("#f-region").value = estado.region;
  if (estado.modulo === "generales") pintarGenerales(); else pintarSub();
  Obs.escribirURL({
    modulo: estado.modulo === "generales" ? null : estado.modulo,
    eleccion: estado.modulo === "generales" && estado.eleccion !== "presidencial1" ? estado.eleccion : null,
    nivel: estado.modulo === "subnacionales" && estado.nivel !== "regional" ? estado.nivel : null,
    region: estado.modulo === "subnacionales" && estado.region !== PE ? estado.region : null,
    anio: estado.modulo === "subnacionales" && estado.anio !== anios.at(-1) ? estado.anio : null,
    indicador: estado.modulo === "subnacionales" && estado.indicador !== "margen" ? estado.indicador : null,
    provincia: estado.modulo === "subnacionales" && estado.nivel === "distrital" ? estado.provincia : null,
    lugar: estado.modulo === "subnacionales" && !regionalNivel() ? estado.lugar : null,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (c) => actualizar({ region: c === estado.region ? PE : c, provincia: null, lugar: null });

/* Filtros de provincia y distrito (solo en las elecciones provinciales y distritales, con una región elegida) */
function opcionesLugares(nivel, amb) {
  const vistos = new Map();
  S.filter((f) => f.nivel === nivel && f.ubigeo && enAlcance(f, amb)).forEach((f) => vistos.set(f.ubigeo, NOMBRE_LUGAR.get(f.ubigeo) ?? nombreFila(f)));
  return [...vistos].sort((x, y) => x[1].localeCompare(y[1], "es"));
}
function pintarFiltrosLugar() {
  const sub = estado.modulo === "subnacionales", { nivel, region } = estado;
  const conProv = sub && region !== PE && (nivel === "provincial" || nivel === "distrital"), conDist = sub && region !== PE && nivel === "distrital";
  $("#filtro-prov").hidden = !conProv;
  $("#filtro-dist").hidden = !conDist;
  if (conProv) {
    const provs = opcionesLugares("provincial", region);
    $("#f-prov").innerHTML = `<option value="">Todas</option>` + provs.map(([u, n]) => `<option value="${u}">${Obs.escapar(n)}</option>`).join("");
    $("#f-prov").value = (nivel === "provincial" ? estado.lugar : estado.provincia) ?? "";
  }
  if (conDist) {
    const dists = opcionesLugares("distrital", estado.provincia ?? region);
    $("#f-dist").innerHTML = `<option value="">Todos</option>` + dists.map(([u, n]) => `<option value="${u}">${Obs.escapar(n)}</option>`).join("");
    $("#f-dist").value = estado.lugar ?? "";
  }
}
// En provincias y distritos, un clic en el mapa elige la región de ese lugar (y lo resalta)
const elegirLugar = (u) => actualizar({ region: String(u).slice(0, 2), lugar: u === estado.lugar ? null : u });

Obs.iniciar(TABLERO, async () => {
  const [datos, gr, gp, gd] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson"),
    Obs.cargarJSON("../../mapas/peru_provincias.geojson"), Obs.cargarJSON("../../mapas/peru_distritos.geojson")]);
  GEO = { regional: gr, provincial: gp, distrital: gd };
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(), gris: "#9aa3b0",
    tema: { concentracion: v("--serie-1"), margen: v("--serie-3"), nep: v("--serie-4"), organizaciones: v("--serie-5") } };
  G = Obs.expandir(datos.tablas.generales);
  S = Obs.expandir(datos.tablas.subnacionales);
  for (const f of gp.features) NOMBRE_LUGAR.set(f.properties.region, titulo(f.properties.nombre));
  for (const f of gd.features) NOMBRE_LUGAR.set(f.properties.region, titulo(f.properties.nombre));
  const n = datos.tablas.notas;
  $("#notas").innerHTML = n.tema.map((t, i) => `<li><strong>${Obs.escapar(t)}:</strong> ${Obs.escapar(n.nota[i])}</li>`).join("");
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  $("#actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";
  const opcionesRegion = `<option value="${PE}">Todas (Perú)</option>` + Object.entries(DEPS).sort((x, y) => x[1].localeCompare(y[1], "es")).map(([c, nm]) => `<option value="${c}">${nm}</option>`).join("");
  $("#f-region").innerHTML = opcionesRegion;
  $("#f-region-ficha").innerHTML = opcionesRegion.replace("Todas (Perú)", "Elegir una región");
  $("#f-region-ficha").onchange = (e) => actualizar({ region: e.target.value, provincia: null, lugar: null });
  $("#chip-region").onclick = () => (estado.lugar && !regionalNivel() ? actualizar({ lugar: null })
    : estado.provincia && estado.nivel === "distrital" ? actualizar({ provincia: null }) : actualizar({ region: PE, provincia: null, lugar: null }));
  $("#f-prov").onchange = (e) => (estado.nivel === "provincial" ? actualizar({ lugar: e.target.value || null }) : actualizar({ provincia: e.target.value || null, lugar: null }));
  $("#f-dist").onchange = (e) => actualizar({ lugar: e.target.value || null, provincia: e.target.value ? e.target.value.slice(0, 4) : estado.provincia });
  $("#atajos").onclick = (e) => { const b = e.target.closest("button[data-region]"); if (b) actualizar({ region: b.dataset.region, provincia: null, lugar: null }); };

  // Estado inicial desde la URL
  const p = Obs.parametros();
  if (MODULOS.includes(p.get("modulo"))) estado.modulo = p.get("modulo");
  if (ELECCIONES.some(([k]) => k === p.get("eleccion"))) estado.eleccion = p.get("eleccion");
  if (NIVELES.some(([k]) => k === p.get("nivel"))) estado.nivel = p.get("nivel");
  if (DEPS[p.get("region")]) estado.region = p.get("region");
  if (INDICADORES[p.get("indicador")]) estado.indicador = p.get("indicador");
  estado.anio = +p.get("anio") || null;
  if (/^\d{4}$/.test(p.get("provincia") ?? "") && p.get("provincia").startsWith(estado.region)) estado.provincia = p.get("provincia");
  if (/^\d{4,6}$/.test(p.get("lugar") ?? "") && p.get("lugar").startsWith(estado.region)) estado.lugar = p.get("lugar");

  // Controles
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value, provincia: null, lugar: null });
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#f-eleccion button, #f-nivel button, #f-indicador button");
    if (!b) return;
    if (b.dataset.eleccion) actualizar({ eleccion: b.dataset.eleccion });
    else if (b.dataset.nivel) actualizar({ nivel: b.dataset.nivel, provincia: null, lugar: null });
    else actualizar({ indicador: b.dataset.ind });
  });
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
  Obs.descarga({ archivos: ARCHIVOS });
  let anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(window.__espera);
    window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });
  render();
});
