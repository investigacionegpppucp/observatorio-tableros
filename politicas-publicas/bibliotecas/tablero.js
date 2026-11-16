/* =========================================================
   Tablero de Bibliotecas municipales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma procesos/bibliotecas/procesar.py desde la
   serie del Observatorio (Bibliotecas_VF.xlsx) y los microdatos del
   RENAMU. Tabla «bibliotecas»: una fila por año, región (o NACIONAL) y
   tipo de municipalidad, con total, tiene, lect_sala, personal_exclusivo,
   compu, internet (conteos) y n_libros, t_compu (medianas).

   Patrón: un objeto `estado`, funciones puras de consulta y una sola
   función `render()`.

   Parámetros de URL:
     ?modulo=servicios&region=CUSCO&anio=2020&tipo=Distrital&mapa=internet
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "bibliotecas";
const ARCHIVOS = [{ clave: "bibliotecas_base", etiqueta: "Bibliotecas municipales por región, tipo de municipalidad y año (2004-2026)" }];
const NACIONAL = "NACIONAL";
const MODULOS = ["cobertura", "servicios"];
const TIPOS = [["todas", "Todas"], ["Provincial", "Provinciales"], ["Distrital", "Distritales"]];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca", CALLAO: "Callao",
  CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad", LAMBAYEQUE: "Lambayeque",
  "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto", "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua",
  PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno", "SAN MARTIN": "San Martín", TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};
// Servicios: porcentaje de las municipalidades con biblioteca
const SERVICIOS = [
  { id: "lect_sala", nombre: "Lectura en sala", color: "--serie-1" },
  { id: "personal_exclusivo", nombre: "Personal exclusivo", color: "--serie-2" },
  { id: "compu", nombre: "Computadoras operativas", color: "--serie-3" },
  { id: "internet", nombre: "Computadoras con internet", color: "--serie-4" },
];
const CONTEOS = ["total", "tiene", "lect_sala", "personal_exclusivo", "compu", "internet"];

const estado = { modulo: "cobertura", region: NACIONAL, anio: null, tipo: "todas", mapa: {} };
let D = [], C, mapa, ANIOS = [], REGIONES = [];
const INDICE = new Map();

const pct = (v) => (v == null || !isFinite(v) ? "—" : Obs.fmtPct(v, 1));
const n0 = (v) => (v == null ? "—" : Obs.fmtN(v, 0));
const puntos = (d) => `${Obs.fmtN(Math.abs(d * 100), 1)} ${Math.abs(Math.round(d * 1000)) === 10 ? "punto" : "puntos"}`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const nombreRegion = (c) => (c === NACIONAL ? "Perú" : NOMBRES[c] ?? c);
const enAmbito = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnAmbito = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombreRegion(c)}`);
const destacar = (s) => `<strong>${s}</strong>`;
const $ = (s) => document.querySelector(s);
const deTipo = (t = estado.tipo) => (t === "todas" ? "municipalidades" : t === "Provincial" ? "municipalidades provinciales" : "municipalidades distritales");

/* ---------- Consultas ---------- */
// Una fila (o la suma de provinciales y distritales); las medianas no se suman
function fila(reg, anio, tipo = estado.tipo) {
  if (tipo !== "todas") return INDICE.get(`${anio}|${reg}|${tipo}`) ?? null;
  const p = INDICE.get(`${anio}|${reg}|Provincial`), d = INDICE.get(`${anio}|${reg}|Distrital`);
  if (!p && !d) return null;
  return Object.fromEntries(CONTEOS.map((c) => [c, p?.[c] == null && d?.[c] == null ? null : (p?.[c] ?? 0) + (d?.[c] ?? 0)]));
}
const cobertura = (f) => (f && f.total ? f.tiene / f.total : null);
const servicio = (f, id) => (f && f.tiene && f[id] != null ? f[id] / f.tiene : null);

/* ---------- Escala continua ---------- */
const escalaContinua = () => ["#f1f5fd", ...C.escala];
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorContinuo(t) {
  const cs = escalaContinua().map(hexRGB);
  const x = Math.max(0, Math.min(1, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${cs[i].map((c, k) => Math.round(c + (cs[i + 1][k] - c) * f)).join(",")})`;
}
function kpis(id, lista) {
  $(id).innerHTML = lista.map(({ etiqueta, valor, pie }) => `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">${valor}</span><span class="kpi-pie">${pie}</span></div>`).join("");
}
function clicAnio(g) {
  g.getZr().off("click");
  g.getZr().on("click", (e) => {
    if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
    if (ANIOS[i] && ANIOS[i] !== estado.anio) actualizar({ anio: ANIOS[i] });
  });
}
const ejeAnios = () => ({ type: "category", data: ANIOS.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
  axisLabel: txt({ formatter: (x) => (+x === estado.anio ? `{b|${x}}` : x), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } }) });
const ejePct = (max = 1) => ({ type: "value", min: 0, max, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Math.round(x * 100) + " %" }) });
const marcaAnio = () => ({ type: "line", data: [], markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.texto, opacity: 0.25, type: "solid" }, data: [{ xAxis: String(estado.anio) }] } });

/* ---------------------------------------------------------
   ¿Cuántas tienen biblioteca?
   --------------------------------------------------------- */
function pintarCobertura() {
  const r = estado.region, a = estado.anio, a0 = ANIOS[0];
  const f = fila(r, a), f0 = fila(r, a0), v = cobertura(f), v0 = cobertura(f0);
  const prov = cobertura(fila(r, a, "Provincial")), dist = cobertura(fila(r, a, "Distrital"));
  // El año con más bibliotecas
  const serie = ANIOS.map((x) => cobertura(fila(r, x)));
  const iMax = serie.indexOf(Math.max(...serie.filter((x) => x != null)));
  $("#r-cobertura").innerHTML = f
    ? `${EnAmbito(r)}, ${destacar(`${n0(f.tiene)} de ${n0(f.total)} ${deTipo()}`)} tenían una biblioteca municipal según el RENAMU ${a}: ${destacar(pct(v))}.` +
      (a !== a0 && v0 != null ? ` En ${a0} eran ${pct(v0)}${iMax === 0 ? ", el punto más alto de la serie." : `; el punto más alto fue ${ANIOS[iMax]} (${pct(serie[iMax])}).`}` : "")
    : `No hay datos ${enAmbito(r)} en ${a}.`;
  const d = v != null && v0 != null && a !== a0 ? v - v0 : null;
  kpis("#k-cobertura", [
    { etiqueta: "Con biblioteca municipal", valor: pct(v), pie: f ? `${n0(f.tiene)} de ${n0(f.total)} ${deTipo()}` : "" },
    { etiqueta: `Cambio desde ${a0}`, valor: d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Obs.fmtN(Math.abs(d * 100), 1)}`, pie: d == null ? "" : `${puntos(d)} ${d > 0 ? "más" : "menos"} que en ${a0}` },
    { etiqueta: "Provinciales con biblioteca", valor: pct(prov), pie: `${n0(fila(r, a, "Provincial")?.tiene)} municipalidades` },
    { etiqueta: "Distritales con biblioteca", valor: pct(dist), pie: `${n0(fila(r, a, "Distrital")?.tiene)} municipalidades` },
  ]);
  // Evolución: todas, provinciales y distritales; con una región, el Perú punteado
  const conRef = r !== NACIONAL;
  $("#t-evol").textContent = `¿Cuántas municipalidades tienen biblioteca? ${ANIOS[0]}-${ANIOS.at(-1)}`;
  $("#d-evol").textContent = `Porcentaje de municipalidades con al menos una biblioteca municipal, ${enAmbito(r)}.` + (conRef ? " En línea punteada, el Perú." : "");
  const colores = { todas: C.unica, Provincial: C.categorias[1], Distrital: C.categorias[2] };
  $("#ley-evol").innerHTML = "";
  const g = Obs.grafico("g-evol");
  const linea = (t, reg, ref) => ({
    name: `${TIPOS.find((x) => x[0] === t)[1]}${ref ? " (Perú)" : ""}`, type: "line", data: ANIOS.map((x) => cobertura(fila(reg, x, t))),
    symbol: ref ? "none" : "circle", symbolSize: t === estado.tipo ? 7 : 5, z: ref ? 1 : t === estado.tipo ? 4 : 2,
    lineStyle: { width: ref ? 1.5 : t === estado.tipo ? 3 : 1.8, type: ref ? "dashed" : "solid", color: colores[t], opacity: ref ? 0.7 : 1 }, itemStyle: { color: colores[t] },
    endLabel: ref ? undefined : { show: true, formatter: (p) => pct(p.value), ...txt({ color: colores[t], fontWeight: 800 }) },
  });
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: txt() },
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => p.seriesName).map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: 48, right: 64, top: 44, bottom: 30 },
    xAxis: ejeAnios(),
    yAxis: ejePct(1),
    series: [...TIPOS.map(([t]) => linea(t, r, false)), ...(conRef ? [linea(estado.tipo, NACIONAL, true)] : []), marcaAnio()],
  }, true);
  clicAnio(g);
}

/* ---------------------------------------------------------
   ¿Con qué cuentan?
   --------------------------------------------------------- */
function pintarServicios() {
  const r = estado.region, a = estado.anio;
  const f = fila(r, a);
  const vals = Object.fromEntries(SERVICIOS.map((s) => [s.id, servicio(f, s.id)]));
  $("#r-servicios").innerHTML = f && f.tiene && vals.lect_sala == null
    ? `En el RENAMU ${a} aún no se preguntaba por los servicios de las bibliotecas: la serie empieza en 2006. Elige otro año.`
    : f && f.tiene
    ? `${EnAmbito(r)}, de las ${destacar(`${n0(f.tiene)} ${deTipo()} con biblioteca`)} en el RENAMU ${a}, ${destacar(pct(vals.lect_sala))} ofrecía lectura en sala, ` +
      `${pct(vals.personal_exclusivo)} tenía personal exclusivo, ${pct(vals.compu)} contaba con computadoras operativas y ${destacar(pct(vals.internet))} con computadoras conectadas a internet.`
    : `No hay municipalidades con biblioteca ${enAmbito(r)} en ${a}.`;
  kpis("#k-servicios", SERVICIOS.map((s) => ({ etiqueta: s.nombre, valor: pct(vals[s.id]), pie: f?.[s.id] != null ? `${n0(f[s.id])} de ${n0(f.tiene)} bibliotecas` : "Sin dato ese año" })));
  $("#t-serv-evol").textContent = `¿Con qué cuentan las bibliotecas? ${ANIOS[0]}-${ANIOS.at(-1)}`;
  $("#d-serv-evol").textContent = `Porcentaje de las ${deTipo()} con biblioteca que tenían cada servicio, ${enAmbito(r)}. La lectura en sala, el personal y las computadoras se preguntan desde 2006.`;
  const g = Obs.grafico("g-serv-evol");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: txt() },
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => p.seriesName && p.value != null).map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(Array.isArray(p.value) ? p.value[1] : p.value)}</strong>`).join("") },
    grid: { left: 48, right: 64, top: 44, bottom: 30 },
    xAxis: ejeAnios(),
    yAxis: ejePct(1),
    series: [...SERVICIOS.map((s) => ({ name: s.nombre, type: "line", data: ANIOS.map((x) => [String(x), servicio(fila(r, x), s.id)]).filter((q) => q[1] != null), symbol: "circle", symbolSize: 6,
      lineStyle: { width: 2.5, color: C.serv[s.id] }, itemStyle: { color: C.serv[s.id] }, endLabel: { show: true, formatter: (p) => pct(p.value[1]), ...txt({ color: C.serv[s.id], fontWeight: 800 }) } })), marcaAnio()],
  }, true);
  clicAnio(g);
  // Medianas por tipo (no se pueden sumar entre provinciales y distritales)
  $("#d-medianas").textContent = `Mediana de ejemplares de libros por biblioteca, según el tipo de municipalidad, ${enAmbito(r)}. En ${a}, la mediana de computadoras operativas fue ${n0(INDICE.get(`${a}|${r}|Provincial`)?.t_compu)} en las provinciales y ${n0(INDICE.get(`${a}|${r}|Distrital`)?.t_compu)} en las distritales.`;
  const gm = Obs.grafico("g-medianas");
  const med = (t) => ANIOS.map((x) => INDICE.get(`${x}|${r}|${t}`)?.n_libros ?? null);
  gm.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: txt() },
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => p.seriesName && p.value != null).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${n0(p.value)}</strong> libros`).join("") },
    grid: { left: 56, right: 24, top: 44, bottom: 30 },
    xAxis: ejeAnios(),
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => n0(x) }) },
    series: [["Provinciales", "Provincial", C.categorias[1]], ["Distritales", "Distrital", C.categorias[2]]].map(([n, t, c]) => ({ name: n, type: "line", data: med(t), connectNulls: true, symbol: "circle", symbolSize: 6, lineStyle: { width: 2.5, color: c }, itemStyle: { color: c } })).concat([marcaAnio()]),
  }, true);
  clicAnio(gm);
}

/* ---------------------------------------------------------
   Mapa coroplético (escala continua) y ranking de regiones
   --------------------------------------------------------- */
function indicadores() {
  if (estado.modulo === "cobertura") return [{ id: "tiene", nombre: `${deTipo().charAt(0).toUpperCase() + deTipo().slice(1)} con biblioteca (%)`, f: (x) => cobertura(x) }];
  return SERVICIOS.map((s) => ({ id: s.id, nombre: `Bibliotecas con ${s.nombre.toLowerCase()} (%)`, f: (x) => servicio(x, s.id) }));
}
function pintarMapa() {
  const lista = indicadores();
  const ind = lista.find((i) => i.id === estado.mapa[estado.modulo]) ?? lista[0];
  $("#f-mapa").innerHTML = lista.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  $("#t-mapa").textContent = `${ind.nombre.replace(" (%)", "")} por región, ${estado.anio}`;
  const regs = REGIONES.map((reg) => { const x = fila(reg, estado.anio); return { reg, v: x ? ind.f(x) : null, x }; }).filter((x) => x.v != null && isFinite(x.v));
  const vs = regs.map((x) => x.v), min = Math.min(...vs), max = Math.max(...vs);
  mapa.pintar({ valores: new Map(regs.map((x) => [x.reg, x.v])), color: (v) => colorContinuo(max > min ? (v - min) / (max - min) : 1), texto: pct, elegida: estado.region === NACIONAL ? null : estado.region });
  $("#ley-mapa").innerHTML = regs.length ? `<div class="ley-continua"><span>${pct(min)}</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${pct(max)}</span></div>` : "";
  const orden = [...regs].sort((x, y) => y.v - x.v), peru = ind.f(fila(NACIONAL, estado.anio));
  $("#l-mapa").innerHTML = orden.length ? `Va de ${destacar(pct(min))} en ${nombreRegion(orden.at(-1).reg)} a ${destacar(pct(max))} en ${nombreRegion(orden[0].reg)}. En el Perú: ${pct(peru)}.` : "";
  Obs.barras("g-regiones", regs.map((x) => ({ clave: x.reg, etiqueta: nombreRegion(x.reg), valor: x.v })), {
    formato: pct, nombre: ind.nombre, seleccion: estado.region === NACIONAL ? null : new Set([estado.region]), alClic: elegirRegion,
    detalle: (d) => { const x = regs.find((y) => y.reg === d.clave).x; return estado.modulo === "cobertura" ? `${n0(x.tiene)} de ${n0(x.total)}` : `${n0(x[ind.id])} de ${n0(x.tiene)} bibliotecas`; },
  });
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function render() {
  $("#f-region").value = estado.region;
  $("#f-anio").value = estado.anio;
  $("#f-tipo").innerHTML = TIPOS.map(([k, e]) => `<button type="button" data-t="${k}" aria-pressed="${estado.tipo === k}">${e}</button>`).join("");
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => ($(`#m-${m}`).hidden = m !== estado.modulo));
  if (estado.modulo === "cobertura") pintarCobertura(); else pintarServicios();
  pintarMapa();
  Obs.escribirURL({
    modulo: estado.modulo === "cobertura" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
    tipo: estado.tipo === "todas" ? null : estado.tipo,
    mapa: estado.mapa[estado.modulo] ?? null,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (cod) => actualizar({ region: cod === estado.region || cod === NACIONAL ? NACIONAL : cod });

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  C = Obs.tema();
  const css = getComputedStyle(document.documentElement);
  C.serv = Object.fromEntries(SERVICIOS.map((s) => [s.id, css.getPropertyValue(s.color).trim()]));
  D = Obs.expandir(datos.tablas.bibliotecas);
  D.forEach((f) => INDICE.set(`${f.anio}|${f.region}|${f.tipo}`, f));
  ANIOS = [...new Set(D.map((f) => f.anio))].sort((a, b) => a - b);
  REGIONES = Object.keys(NOMBRES).filter((r) => D.some((f) => f.region === r)).sort((a, b) => nombreRegion(a).localeCompare(nombreRegion(b), "es"));
  estado.anio = ANIOS.at(-1);
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  $("#actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-region").innerHTML = opcion(NACIONAL, "Perú (nacional)") + REGIONES.map((r) => opcion(r, nombreRegion(r))).join("");
  $("#f-anio").innerHTML = [...ANIOS].reverse().map((a) => opcion(a, a)).join("");
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  $("#f-tipo").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) actualizar({ tipo: b.dataset.t }); };
  $("#f-mapa").onchange = (e) => { estado.mapa[estado.modulo] = e.target.value; render(); };

  // Estado inicial desde la URL
  const p = Obs.parametros();
  if (MODULOS.includes(p.get("modulo"))) estado.modulo = p.get("modulo");
  const reg = String(p.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) estado.region = reg;
  if (ANIOS.includes(+p.get("anio"))) estado.anio = +p.get("anio");
  if (TIPOS.some(([k]) => k === p.get("tipo"))) estado.tipo = p.get("tipo");
  if (p.get("mapa")) estado.mapa[estado.modulo] = p.get("mapa");

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

  mapa = new Obs.Mapa("mapa-regiones", geo, { alClic: elegirRegion, nombre: nombreRegion });
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
