/* =========================================================
   Tablero de Confianza institucional — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script
   (Tableros > Publicar tableros) desde la pestaña «Confianza
   institucional» del Sheet «[Tableros] Cultura Política». Una fila
   por año, región e institución: AÑO, region_ubicacion (PE-xxx o
   Nacional), region, org, Nivel (Nacional o Regional), y las
   proporciones nada_p, poca_p, suficiente_p, bastante_p,
   no_sabe_p y sufi_bast_p (suficiente + bastante = «confía»).

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`.

   Parámetros de URL:
     ?institucion=Poder Judicial&region=CUSCO&anio=2025
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "confianza-institucional";
const ARCHIVOS = [{ clave: "confianza_institucional_base", etiqueta: "Confianza en las instituciones por región y año (2013-2025)" }];
const NACIONAL = "NACIONAL";
const INSTITUCION_INICIAL = "Congreso de la República";
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
// Respuestas, de la desconfianza a la confianza; «no sabe» al final
const RESPUESTAS = [
  { campo: "nada", nombre: "Nada", css: "--r-nada" },
  { campo: "poca", nombre: "Poca", css: "--r-poca" },
  { campo: "suficiente", nombre: "Suficiente", css: "--r-suficiente" },
  { campo: "bastante", nombre: "Bastante", css: "--r-bastante" },
  { campo: "nosabe", nombre: "No sabe", css: "--r-nosabe" },
];

const estado = { institucion: INSTITUCION_INICIAL, region: NACIONAL, anio: null };

let FILAS = [], INSTITUCIONES = [], REGIONES = [], ANIOS = [], C;
const NOMBRE_REGION = new Map([[NACIONAL, "Perú"]]);
const INDICE = new Map(); // "institución|región|año" -> fila

const pct = (v) => Obs.fmtPct(v, 1);
const pts = (v) => `${Obs.fmtN(Math.abs(v * 100), 1)} ${Math.abs(Math.round(v * 1000)) === 10 ? "punto" : "puntos"}`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const fila = (inst, reg, anio) => INDICE.get(`${inst}|${reg}|${anio}`) ?? null;
const enAmbito = (reg) => (reg === NACIONAL ? "en el Perú" : `en ${NOMBRE_REGION.get(reg)}`);
// Códigos del mapa: mayúsculas y sin tildes, como en publica/mapas/peru_regiones.geojson
const codigo = (nombre) => nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
// Nombres cortos para los gráficos
const corto = (org) => org === "Superintendencia Nacional de Aduanas y Administración Tributaria" ? "Sunat"
  : org.replace(/^Registro Nacional de Identificación y Estado Civil - RENIEC$/, "Reniec").replace(/ - (\w+)$/, " ($1)");

// Con artículo, para las frases: «el Congreso de la República», «las Fuerzas Armadas»
const ARTICULO = { Congreso: "el", Ministerio: "el", Gobierno: "el", Jurado: "el", Poder: "el", Reniec: "el", Fuerzas: "las", Partidos: "los" };
const conArticulo = (org) => { const c = corto(org); return `${ARTICULO[c.split(" ")[0]] ?? "la"} ${c}`; };

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(filas, e) {
  return {
    ranking: filas.filter((f) => f.region === e.region && f.anio === e.anio), // todas las instituciones
    serie: filas.filter((f) => f.org === e.institucion && f.region === e.region), // todos los años
    nacional: filas.filter((f) => f.org === e.institucion && f.region === NACIONAL),
    regiones: filas.filter((f) => f.org === e.institucion && f.anio === e.anio && f.region !== NACIONAL), // todas las regiones
  };
}

/* ---------- Resumen y cifras clave ---------- */
function cifras(s) {
  const f = fila(estado.institucion, estado.region, estado.anio);
  const el = document.getElementById("resumen");
  if (!f) {
    el.textContent = `No hay datos de ${conArticulo(estado.institucion)} en ${estado.anio}: se pregunta desde 2014. Elige otro año.`;
    ["k-confia", "k-cambio", "k-puesto"].forEach((id) => Obs.kpi(id, { etiqueta: "", valor: "—" }));
    return;
  }
  const primero = s.serie[0];
  el.innerHTML = `En ${estado.anio}, <strong>${pct(f.confia)}</strong> de las personas de 18 años y más ${Obs.escapar(enAmbito(estado.region))} confía suficiente o bastante en ` +
    `<strong>${Obs.escapar(conArticulo(estado.institucion))}</strong>` +
    (primero && primero.anio !== estado.anio ? `; en ${primero.anio} era ${pct(primero.confia)}.` : ".");

  Obs.kpi("k-confia", { etiqueta: "Confía suficiente o bastante", valor: pct(f.confia), pie: `${Obs.escapar(NOMBRE_REGION.get(estado.region))}, ${estado.anio}` });
  if (primero && primero.anio !== estado.anio) {
    const d = f.confia - primero.confia;
    Obs.kpi("k-cambio", { etiqueta: `Cambio desde ${primero.anio}`, valor: `${d > 0 ? "+" : d < 0 ? "−" : ""}${Obs.fmtN(Math.abs(d * 100), 1)}`,
      pie: Math.abs(d) < 0.0005 ? "Sin cambio" : `${pts(d)} ${d > 0 ? "más" : "menos"} que en ${primero.anio}` });
  } else Obs.kpi("k-cambio", { etiqueta: "Cambio", valor: "—", pie: "Es el primer año con datos" });
  const orden = [...s.ranking].sort((a, b) => b.confia - a.confia);
  const puesto = orden.findIndex((x) => x.org === estado.institucion) + 1;
  Obs.kpi("k-puesto", { etiqueta: "Puesto entre las instituciones", valor: `${puesto}.º de ${orden.length}`,
    pie: puesto === 1 ? "La que genera más confianza" : `La primera es ${Obs.escapar(corto(orden[0].org))} (${pct(orden[0].confia)})` });
}

/* ---------- Ranking de instituciones ---------- */
function ranking(s) {
  Obs.barras("g-ranking", s.ranking.map((f) => ({ clave: f.org, etiqueta: corto(f.org), valor: f.confia })), {
    formato: pct, nombre: NOMBRE_REGION.get(estado.region), seleccion: new Set([estado.institucion]), alClic: (org) => actualizar({ institucion: org }),
  });
  document.getElementById("d-ranking").textContent = `Porcentaje que confía suficiente o bastante, ${enAmbito(estado.region)}, ${estado.anio}.`;
}

/* ---------- Evolución ----------
   La línea del ámbito elegido; con una región, el Perú en gris como referencia. */
function evolucion(s) {
  const id = "g-evol";
  const anios = ANIOS;
  const conRef = estado.region !== NACIONAL;
  const valores = (filas) => anios.map((a) => filas.find((f) => f.anio === a)?.confia ?? null);
  const principal = valores(s.serie), ref = conRef ? valores(s.nacional) : [];
  document.getElementById("t-evol").textContent = `Confianza en ${conArticulo(estado.institucion)}, ${anios[0]}-${anios.at(-1)}`;
  document.getElementById("d-evol").textContent = `Porcentaje que confía suficiente o bastante, ${enAmbito(estado.region)}.`;
  document.getElementById("ley-evol").innerHTML = conRef
    ? `<span><i class="l" style="border-color:${C.unica}"></i>${Obs.escapar(NOMBRE_REGION.get(estado.region))}</span><span><i class="l" style="border-color:${C.gris}"></i>Perú</span>` : "";
  if (!principal.some((v) => v != null)) return Obs.vacio(id);
  const tope = Math.min(1, Math.ceil((Math.max(...principal.concat(ref).filter((v) => v != null)) + 0.05) * 10) / 10);
  const k = anios.indexOf(estado.anio);
  // los nulos iniciales se quitan: si no, el rótulo final de ECharts arranca en NaN
  const pares = (vals) => vals.map((v, i) => [String(anios[i]), v]).filter((p) => p[1] != null);
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value[1])}</strong>`).join("") },
    grid: { left: 52, right: 24, top: 30, bottom: 30 },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % (document.getElementById(id).clientWidth < 420 ? 3 : 2) === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => Math.round(v * 100) + " %" }) },
    series: [
      ...(conRef ? [{ name: "Perú", type: "line", data: pares(ref), connectNulls: true, symbol: "circle", symbolSize: 6, z: 1,
        lineStyle: { width: 2, color: C.gris }, itemStyle: { color: C.gris }, emphasis: { disabled: true } }] : []),
      { name: NOMBRE_REGION.get(estado.region), type: "line", data: pares(principal), connectNulls: true, symbol: "circle", symbolSize: 8, z: 3,
        lineStyle: { width: 2, color: C.unica }, itemStyle: { color: C.unica, borderColor: "#fff", borderWidth: 2 },
        markPoint: principal[k] != null ? { symbol: "circle", symbolSize: 14, itemStyle: { color: C.unica, borderColor: "#fff", borderWidth: 3 },
          label: { show: true, position: "top", distance: 8, formatter: () => pct(principal[k]), ...txt({ color: C.texto, fontWeight: 700 }) },
          data: [{ coord: [String(estado.anio), principal[k]] }] } : undefined },
    ],
  }, true);
  g.off("click");
  g.getZr().off("click");
  // clic en cualquier punto de la columna de un año
  g.getZr().on("click", (e) => {
    if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
    if (anios[i] && anios[i] !== estado.anio) actualizar({ anio: anios[i] });
  });
  document.getElementById(id).setAttribute("aria-label", `Confianza en ${conArticulo(estado.institucion)} ${enAmbito(estado.region)}: ` +
    anios.map((a, i) => (principal[i] == null ? null : `${a}, ${pct(principal[i])}`)).filter(Boolean).join("; ") + ".");
}

/* ---------- Respuestas por año (barras apiladas al 100 %) ---------- */
function respuestas(s) {
  const id = "g-resp";
  const filas = [...s.serie].sort((a, b) => b.anio - a.anio);
  document.getElementById("t-resp").textContent = `¿Cuánto se confía en ${conArticulo(estado.institucion)}?`;
  document.getElementById("ley-resp").innerHTML = RESPUESTAS.map((r) => `<span><i style="background:${C.resp[r.campo]}"></i>${r.nombre}</span>`).join("");
  if (!filas.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${filas.length * 30 + 40}px`;
  const g = Obs.grafico(id);
  g.resize();
  const claro = new Set(["poca", "suficiente", "nosabe"]);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${ps[0].name}</strong>` + ps.map((p) => `<br>${p.marker}${p.seriesName}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: 44, right: 24, top: 4, bottom: 30 },
    xAxis: { type: "value", min: 0, max: 1, interval: 0.25, splitLine: { show: false }, axisLabel: txt({ formatter: (v) => Math.round(v * 100) + " %" }) },
    yAxis: { type: "category", inverse: true, data: filas.map((f) => String(f.anio)), axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { ...txt(), formatter: (v) => (+v === estado.anio ? `{b|${v}}` : v), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
    series: RESPUESTAS.map((r) => ({
      name: r.nombre, type: "bar", stack: "r", barWidth: 18,
      itemStyle: { color: C.resp[r.campo], borderColor: "#fff", borderWidth: 1 },
      // rótulo solo donde cabe
      label: { show: true, formatter: (p) => (p.value >= 0.08 ? Obs.fmtN(p.value * 100, 0) : ""), ...txt({ fontSize: 12, fontWeight: 700, color: claro.has(r.campo) ? C.texto : "#fff" }) },
      data: filas.map((f) => f[r.campo]),
    })),
  }, true);
}

/* ---------- Mapa y ranking regional ---------- */
let mapa;
function regiones(s) {
  document.getElementById("t-mapa").textContent = `Confianza en ${conArticulo(estado.institucion)} por región, ${estado.anio}`;
  const valores = new Map(s.regiones.map((f) => [f.codigo, f.confia * 100])); // en puntos porcentuales para los cortes
  const cortes = Obs.cortesCuantiles([...valores.values()]);
  const escala = C.escala;
  mapa.pintar({ valores, color: (v) => Obs.colorTramo(v, cortes, escala), texto: (v) => pct(v / 100), elegida: estado.region === NACIONAL ? null : estado.region });
  Obs.leyendaTramos("ley-mapa", cortes, escala, (v) => Obs.fmtN(v, 0) + " %");
  Obs.barras("g-regiones", s.regiones.map((f) => ({ clave: f.codigo, etiqueta: NOMBRE_REGION.get(f.codigo), valor: f.confia })), {
    formato: pct, nombre: corto(estado.institucion), seleccion: estado.region === NACIONAL ? null : new Set([estado.region]), alClic: elegirRegion,
  });
}

/* ---------- Controles ---------- */
const $ = (s) => document.querySelector(s);
function render() {
  $("#f-institucion").value = estado.institucion;
  $("#f-region").value = estado.region;
  $("#f-anio").value = estado.anio;
  const s = filtrar(FILAS, estado);
  cifras(s);
  ranking(s);
  evolucion(s);
  respuestas(s);
  regiones(s);
  Obs.escribirURL({
    institucion: estado.institucion === INSTITUCION_INICIAL ? null : estado.institucion,
    region: estado.region === NACIONAL ? null : estado.region,
    anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (cod) => actualizar({ region: cod === estado.region ? NACIONAL : cod });

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  const t = Obs.tema();
  const css = getComputedStyle(document.documentElement);
  C = { ...t, gris: "#9aa3b0", resp: Object.fromEntries(RESPUESTAS.map((r) => [r.campo, css.getPropertyValue(r.css).trim()])) };

  const nombreBonito = (n) => (n === "San Martin" ? "San Martín" : n);
  FILAS = Obs.expandir(datos.tablas["Confianza institucional"]).map((f) => {
    const nac = f.Nivel === "Nacional" || f.region_ubicacion === "Nacional";
    const nombre = nombreBonito(String(f.region).trim());
    const cod = nac ? NACIONAL : codigo(nombre);
    if (!nac) NOMBRE_REGION.set(cod, nombre);
    return { anio: +f["AÑO"], org: String(f.org).trim(), region: cod, codigo: cod, confia: f.sufi_bast_p,
      nada: f.nada_p, poca: f.poca_p, suficiente: f.suficiente_p, bastante: f.bastante_p, nosabe: f.no_sabe_p };
  });
  FILAS.forEach((f) => INDICE.set(`${f.org}|${f.region}|${f.anio}`, f));
  INSTITUCIONES = [...new Set(FILAS.map((f) => f.org))].sort((a, b) => corto(a).localeCompare(corto(b), "es"));
  REGIONES = [...NOMBRE_REGION.keys()].filter((r) => r !== NACIONAL).sort((a, b) => NOMBRE_REGION.get(a).localeCompare(NOMBRE_REGION.get(b), "es"));
  ANIOS = [...new Set(FILAS.map((f) => f.anio))].sort((a, b) => a - b);
  estado.anio = ANIOS.at(-1);
  if (!INSTITUCIONES.includes(estado.institucion)) estado.institucion = INSTITUCIONES[0];

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-institucion").innerHTML = INSTITUCIONES.map((o) => opcion(o, corto(o))).join("");
  $("#f-region").innerHTML = opcion(NACIONAL, "Perú (nacional)") + REGIONES.map((r) => opcion(r, NOMBRE_REGION.get(r))).join("");
  $("#f-anio").innerHTML = [...ANIOS].reverse().map((a) => opcion(a, a)).join("");
  $("#f-institucion").onchange = (e) => actualizar({ institucion: e.target.value });
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });

  // Estado inicial desde la URL
  const p = Obs.parametros();
  const inst = INSTITUCIONES.find((o) => o.toLowerCase() === (p.get("institucion") || "").toLowerCase() || corto(o).toLowerCase() === (p.get("institucion") || "").toLowerCase());
  if (inst) estado.institucion = inst;
  const reg = codigo(p.get("region") || "");
  if (NOMBRE_REGION.has(reg)) estado.region = reg;
  if (ANIOS.includes(+p.get("anio"))) estado.anio = +p.get("anio");

  mapa = new Obs.Mapa("mapa-regiones", geo, { alClic: elegirRegion, nombre: (r) => NOMBRE_REGION.get(r) ?? r });
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
