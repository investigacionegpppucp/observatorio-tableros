/* =========================================================
   Tablero de Saneamiento — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma procesos/saneamiento/procesar.py desde
   los Excel del MEF. Tablas:
     prioridad           peso de cada función en el presupuesto nacional (por_pia, por_pim)
     prioridad_regional  lo mismo en cada departamento
     presupuesto         función Saneamiento por año: pia, pim, devengado (soles)
     nivel_gobierno      lo mismo por nivel de gobierno (pestaña pendiente)
     cobertura           hogares según su acceso a agua (pestaña pendiente)

   Patrón: un objeto `estado`, funciones puras de consulta y una sola
   función `render()`.

   Parámetros de URL:
     ?modulo=presupuesto&region=PUNO&anio=2022&medida=pia&funcion=SALUD
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "saneamiento";
const ARCHIVOS = [{ clave: "saneamiento_base", etiqueta: "Presupuesto de saneamiento y prioridad por función (2012-2023)" }];
const NACIONAL = "NACIONAL";
const SANEAMIENTO = "SANEAMIENTO";
const MODULOS = ["prioridad", "presupuesto"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca", CALLAO: "Callao",
  CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad", LAMBAYEQUE: "Lambayeque",
  LIMA: "Lima", LORETO: "Loreto", "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno",
  "SAN MARTIN": "San Martín", TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};
// Nombres de las funciones del presupuesto, con tildes
const FUNCIONES = {
  ENERGIA: "Energía", MINERIA: "Minería", "VIVIENDA Y DESARROLLO URBANO": "Vivienda y desarrollo urbano", "CULTURA Y DEPORTE": "Cultura y deporte",
  "PREVISIÓN SOCIAL": "Previsión social", "PROTECCIÓN SOCIAL": "Protección social", "DEUDA PÚBLICA": "Deuda pública", "ORDEN PÚBLICO": "Orden público",
  "RELACIONES EXTERIORES": "Relaciones exteriores",
};
const nombreFuncion = (f) => FUNCIONES[f] ?? f.charAt(0) + f.slice(1).toLowerCase();
// En el mapa, el departamento de Lima pinta Lima Metropolitana y Lima Provincias
const DEL_MAPA = { "LIMA METROPOLITANA": "LIMA", "LIMA PROVINCIAS": "LIMA" };

const estado = { modulo: "prioridad", region: NACIONAL, anio: null, medida: "pim", funcion: SANEAMIENTO, anioP: null };
let D = {}, C, mapa, ANIOS = [], REGIONES = [], ANIOS_P = [];

const pct = (v) => (v == null ? "—" : Obs.fmtPct(v, 1));
const millones = (v) => (v == null ? "—" : `S/ ${Obs.fmtN(v / 1e6, 0)} millones`);
const mill = (v) => Obs.fmtN(v / 1e6, 0);
const puntos = (d) => `${Obs.fmtN(Math.abs(d * 100), 1)} ${Math.abs(Math.round(d * 1000)) === 10 ? "punto" : "puntos"}`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const nombreRegion = (c) => (c === NACIONAL ? "Perú" : NOMBRES[c] ?? c);
const enAmbito = (c) => (c === NACIONAL ? "del Perú" : `de ${nombreRegion(c)}`);
const destacar = (s) => `<strong>${s}</strong>`;
const $ = (s) => document.querySelector(s);
// «el saneamiento», «la educación»…, para las frases
const laFuncion = (f) => (f === SANEAMIENTO ? "el saneamiento" : `«${nombreFuncion(f).toLowerCase()}»`);
const campo = () => `por_${estado.medida}`;
const nombreMedida = () => (estado.medida === "pim" ? "presupuesto modificado (PIM)" : "presupuesto de apertura (PIA)");

/* ---------- Consultas ---------- */
const funcionesDe = (reg, anio) => (reg === NACIONAL ? D.prioridad.filter((f) => f.anio === anio) : D.prioridad_regional.filter((f) => f.region === reg && f.anio === anio));
const peso = (reg, anio, funcion = SANEAMIENTO) => funcionesDe(reg, anio).find((f) => f.funcion === funcion)?.[campo()] ?? null;
const puesto = (reg, anio, funcion = SANEAMIENTO) => {
  const orden = funcionesDe(reg, anio).sort((a, b) => b[campo()] - a[campo()]);
  return { n: orden.findIndex((f) => f.funcion === funcion) + 1, de: orden.length };
};

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
  $(id).innerHTML = lista.map(({ etiqueta, valor, pie, texto }) => `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor${texto ? " texto" : ""}">${valor}</span><span class="kpi-pie">${pie}</span></div>`).join("");
}

/* ---------------------------------------------------------
   Prioridad en el presupuesto
   --------------------------------------------------------- */
function pintarPrioridad() {
  const r = estado.region, a = estado.anio, a0 = ANIOS[0];
  const v = peso(r, a), v0 = peso(r, a0), p = puesto(r, a);
  const regs = REGIONES.map((reg) => ({ reg, v: peso(reg, a) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v);
  $("#r-prioridad").innerHTML = `En ${a}, el saneamiento recibió ${destacar(pct(v))} del ${nombreMedida()} ${enAmbito(r)}: el ${destacar(`puesto ${p.n}`)} entre ${p.de} funciones.` +
    (v0 != null && a !== a0 ? ` En ${a0} era ${pct(v0)}.` : "");
  const d = v != null && v0 != null && a !== a0 ? v - v0 : null;
  const peru = peso(NACIONAL, a);
  kpis("#k-prioridad", [
    { etiqueta: "Peso del saneamiento", valor: pct(v), pie: `Del ${estado.medida.toUpperCase()} ${enAmbito(r)}, ${a}` },
    { etiqueta: "Puesto entre las funciones", valor: `${p.n}.º de ${p.de}`, pie: `La primera es ${nombreFuncion(funcionesDe(r, a).sort((x, y) => y[campo()] - x[campo()])[0].funcion).toLowerCase()}` },
    { etiqueta: `Cambio desde ${a0}`, valor: d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Obs.fmtN(Math.abs(d * 100), 1)}`, pie: d == null ? "Es el primer año con datos" : `${puntos(d)} ${d > 0 ? "más" : "menos"} que en ${a0}` },
    r === NACIONAL
      ? { etiqueta: "El departamento con más peso", valor: nombreRegion(regs[0].reg), pie: `${pct(regs[0].v)}; el de menos es ${nombreRegion(regs.at(-1).reg)} (${pct(regs.at(-1).v)})`, texto: true }
      : { etiqueta: "Frente al Perú", valor: v != null && peru != null ? `${v >= peru ? "+" : "−"}${Obs.fmtN(Math.abs(v - peru) * 100, 1)}` : "—", pie: `En el Perú: ${pct(peru)}` },
  ]);
  // Funciones, de mayor a menor peso
  $("#t-funciones").textContent = `¿En qué se gasta el presupuesto ${enAmbito(r)}?`;
  $("#d-funciones").textContent = `Porcentaje del ${nombreMedida()} que va a cada función, ${a}. En azul, la función elegida.`;
  const lista = funcionesDe(r, a);
  const el = $("#g-funciones");
  el.style.height = `${lista.length * 24 + 30}px`;
  Obs.barras("g-funciones", lista.map((f) => ({ clave: f.funcion, etiqueta: nombreFuncion(f.funcion), valor: f[campo()] })), {
    formato: pct, nombre: nombreRegion(r), seleccion: new Set([estado.funcion]), alClic: (f) => actualizar({ funcion: f }),
  });
  // Evolución del peso de la función elegida
  const fn = nombreFuncion(estado.funcion);
  const conRef = r !== NACIONAL;
  $("#t-evol").textContent = `¿Ganó o perdió prioridad ${laFuncion(estado.funcion)}?`;
  $("#d-evol").textContent = `Porcentaje del ${nombreMedida()} ${enAmbito(r)} que va a ${fn.toLowerCase()}, y su puesto entre las funciones.`;
  $("#ley-evol").innerHTML = conRef ? `<span><i class="l" style="border-color:${C.unica}"></i>${nombreRegion(r)}</span><span><i class="l" style="border-color:#9aa3b0"></i>Perú</span>` : "";
  const serie = (reg) => ANIOS.map((x) => peso(reg, x, estado.funcion));
  const principal = serie(r), ref = conRef ? serie(NACIONAL) : [];
  const g = Obs.grafico("g-evol");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((q) => `<br>${q.marker}${q.seriesName}: <strong>${pct(q.value)}</strong> (puesto ${puesto(q.seriesName === "Perú" ? NACIONAL : r, +q.axisValue, estado.funcion).n})`).join("") },
    grid: { left: 52, right: 40, top: 48, bottom: 30 },
    xAxis: { type: "category", data: ANIOS.map(String), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ formatter: (x) => (+x === a ? `{b|${x}}` : x), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } }) },
    yAxis: { type: "value", min: 0, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Obs.fmtN(x * 100, 0) + " %" }) },
    series: [
      ...(conRef ? [{ name: "Perú", type: "line", data: ref, symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: "#9aa3b0" }, itemStyle: { color: "#9aa3b0" } }] : []),
      { name: nombreRegion(r), type: "line", data: principal, symbol: "circle", symbolSize: 9, z: 3, lineStyle: { width: 2.5, color: C.unica }, itemStyle: { color: C.unica, borderColor: "#fff", borderWidth: 2 },
        label: { show: true, position: "top", distance: 10, formatter: (q) => `${pct(q.value)}\n{p|puesto ${puesto(r, ANIOS[q.dataIndex], estado.funcion).n}}`, ...txt({ color: C.texto, fontWeight: 700, lineHeight: 18 }), rich: { p: txt({ fontSize: 13, fontWeight: 400 }) } } },
    ],
  }, true);
  g.getZr().off("click");
  g.getZr().on("click", (e) => {
    if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
    if (ANIOS[i] && ANIOS[i] !== estado.anio) actualizar({ anio: ANIOS[i] });
  });
  pintarMapa();
}

/* Mapa de departamentos (escala continua) y ranking */
function pintarMapa() {
  const a = estado.anio, fn = nombreFuncion(estado.funcion);
  const todas = [...new Set(D.prioridad.map((f) => f.funcion))];
  $("#f-funcion").innerHTML = todas.map((f) => `<option value="${Obs.escapar(f)}"${f === estado.funcion ? " selected" : ""}>${Obs.escapar(nombreFuncion(f))}</option>`).join("");
  $("#t-mapa").textContent = `¿Cuánto pesa ${laFuncion(estado.funcion)} en cada departamento? ${a}`;
  const regs = REGIONES.map((reg) => ({ reg, v: peso(reg, a, estado.funcion) })).filter((x) => x.v != null);
  const vs = regs.map((x) => x.v), min = Math.min(...vs), max = Math.max(...vs);
  const valores = new Map(regs.map((x) => [x.reg, x.v]));
  valores.set("LIMA METROPOLITANA", valores.get("LIMA")); valores.set("LIMA PROVINCIAS", valores.get("LIMA"));
  const elegida = estado.region === NACIONAL ? null : estado.region;
  mapa.pintar({ valores, color: (v) => colorContinuo(max > min ? (v - min) / (max - min) : 1), texto: pct, elegida: elegida === "LIMA" ? "LIMA METROPOLITANA" : elegida });
  $("#ley-mapa").innerHTML = regs.length ? `<div class="ley-continua"><span>${pct(min)}</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${pct(max)}</span></div>` : "";
  const orden = [...regs].sort((x, y) => y.v - x.v), peru = peso(NACIONAL, a, estado.funcion);
  $("#l-mapa").innerHTML = orden.length ? `Va de ${destacar(pct(min))} en ${nombreRegion(orden.at(-1).reg)} a ${destacar(pct(max))} en ${nombreRegion(orden[0].reg)}. En el Perú: ${pct(peru)}.` : "";
  Obs.barras("g-regiones", regs.map((x) => ({ clave: x.reg, etiqueta: nombreRegion(x.reg), valor: x.v })), {
    formato: pct, nombre: fn, seleccion: elegida ? new Set([elegida]) : null, alClic: elegirRegion,
  });
}

/* ---------------------------------------------------------
   Presupuesto y gasto (nacional)
   --------------------------------------------------------- */
function pintarPresupuesto() {
  const P = D.presupuesto, a = estado.anioP, f = P.find((x) => x.anio === a), f0 = P[0];
  const ejec = f.devengado / f.pim;
  const ejecs = P.map((x) => x.devengado / x.pim), prom = ejecs.reduce((s, x) => s + x, 0) / ejecs.length;
  $("#r-presupuesto").innerHTML = `En ${a}, el saneamiento empezó el año con ${destacar(millones(f.pia))} y terminó con un presupuesto de ${destacar(millones(f.pim))}. ` +
    `Se gastó ${destacar(millones(f.devengado))}: ${destacar(pct(ejec))} de lo asignado.`;
  kpis("#k-presupuesto", [
    { etiqueta: "Presupuesto modificado (PIM)", valor: `S/ ${mill(f.pim)} M`, pie: `${a}. Al inicio (PIA): S/ ${mill(f.pia)} M` },
    { etiqueta: "Gasto (devengado)", valor: `S/ ${mill(f.devengado)} M`, pie: `${a}` },
    { etiqueta: "Ejecución", valor: pct(ejec), pie: `El promedio de ${P[0].anio}-${P.at(-1).anio} es ${pct(prom)}` },
    { etiqueta: `Cambio del PIM desde ${f0.anio}`, valor: a === f0.anio ? "—" : `${f.pim >= f0.pim ? "+" : "−"}${pct(Math.abs(f.pim / f0.pim - 1))}`, pie: a === f0.anio ? "Es el primer año" : `En ${f0.anio}: S/ ${mill(f0.pim)} M` },
  ]);
  const anios = P.map((x) => String(x.anio));
  const marca = (x) => (+x === a ? `{b|${x}}` : x);
  const ejeX = { type: "category", data: anios, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: marca, rich: { b: txt({ color: C.texto, fontWeight: 800 }) } }) };
  const clicAnio = (g) => { g.getZr().off("click"); g.getZr().on("click", (e) => {
    if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
    if (ANIOS_P[i] && ANIOS_P[i] !== estado.anioP) actualizar({ anioP: ANIOS_P[i] });
  }); };
  const series = [["PIA", "pia", C.categorias[3]], ["PIM", "pim", C.unica], ["Devengado", "devengado", C.categorias[2]]];
  $("#ley-pres").innerHTML = series.map(([n, , c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
  const g = Obs.grafico("g-pres");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((q) => `<br>${q.marker}${q.seriesName}: <strong>${millones(q.value)}</strong>`).join("") + `<br>Ejecución: <strong>${pct(P[ps[0].dataIndex].devengado / P[ps[0].dataIndex].pim)}</strong>` },
    grid: { left: 60, right: 16, top: 12, bottom: 30 },
    xAxis: ejeX,
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Obs.fmtN(x / 1e6, 0) }) },
    series: series.map(([n, k, c]) => ({ name: n, type: "bar", barGap: "10%", barCategoryGap: "28%", data: P.map((x) => x[k]), itemStyle: { color: c, borderRadius: [2, 2, 0, 0], opacity: 1 },
      emphasis: { focus: "series" } })),
  }, true);
  clicAnio(g);
  // Ejecución por año, con el promedio
  $("#d-ejec").textContent = `Ejecución: devengado como porcentaje del presupuesto modificado (PIM), por año. La línea punteada es el promedio de ${P[0].anio}-${P.at(-1).anio} (${pct(prom)}).`;
  const ge = Obs.grafico("g-ejec");
  ge.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } }, formatter: (ps) => `<strong>${ps[0].axisValue}</strong><br>Ejecución: <strong>${pct(ps[0].value)}</strong>` },
    grid: { left: 48, right: 16, top: 24, bottom: 30 },
    xAxis: ejeX,
    yAxis: { type: "value", min: 0, max: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Math.round(x * 100) + " %" }) },
    series: [{ type: "bar", barCategoryGap: "30%", data: ejecs.map((x, i) => ({ value: x, itemStyle: { color: C.unica, opacity: P[i].anio === a ? 1 : 0.45, borderRadius: [2, 2, 0, 0] } })),
      label: { show: true, position: "top", formatter: (q) => Obs.fmtN(q.value * 100, 0), ...txt({ fontSize: 13, color: C.texto }) },
      markLine: { silent: true, symbol: "none", lineStyle: { color: C.texto, type: "dashed", opacity: 0.6 }, label: { show: false }, data: [{ yAxis: prom }] } }],
  }, true);
  clicAnio(ge);
  // Modificaciones: PIM − PIA
  const gm = Obs.grafico("g-mod");
  gm.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = P[ps[0].dataIndex]; return `<strong>${ps[0].axisValue}</strong><br>PIM − PIA: <strong>${millones(ps[0].value)}</strong><br>El PIM fue ${pct(x.pim / x.pia - 1)} mayor que el PIA`; } },
    grid: { left: 60, right: 16, top: 24, bottom: 30 },
    xAxis: ejeX,
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Obs.fmtN(x / 1e6, 0) }) },
    series: [{ type: "bar", barCategoryGap: "30%", data: P.map((x) => ({ value: x.pim - x.pia, itemStyle: { color: C.unica, opacity: x.anio === a ? 1 : 0.45, borderRadius: [2, 2, 0, 0] } })),
      label: { show: true, position: "top", formatter: (q) => mill(q.value), ...txt({ fontSize: 13, color: C.texto }) } }],
  }, true);
  clicAnio(gm);
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function render() {
  $("#f-region").value = estado.region;
  $("#f-anio").value = estado.anio;
  $("#f-medida").innerHTML = [["pim", "PIM"], ["pia", "PIA"]].map(([k, e]) => `<button type="button" data-m="${k}" aria-pressed="${estado.medida === k}">${e}</button>`).join("");
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => ($(`#m-${m}`).hidden = m !== estado.modulo));
  $("#filtros").hidden = estado.modulo !== "prioridad"; // la pestaña de presupuesto es nacional
  if (estado.modulo === "prioridad") pintarPrioridad(); else pintarPresupuesto();
  Obs.escribirURL({
    modulo: estado.modulo === "prioridad" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
    medida: estado.medida === "pim" ? null : estado.medida,
    funcion: estado.funcion === SANEAMIENTO ? null : estado.funcion,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (cod) => { const c = DEL_MAPA[cod] ?? cod; actualizar({ region: c === estado.region || c === NACIONAL ? NACIONAL : c }); };

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  C = Obs.tema();
  D = Object.fromEntries(Object.entries(datos.tablas).map(([k, t]) => [k, Obs.expandir(t)]));
  ANIOS = [...new Set(D.prioridad.map((f) => f.anio))].sort((a, b) => a - b);
  ANIOS_P = D.presupuesto.map((f) => f.anio);
  REGIONES = Object.keys(NOMBRES).filter((r) => D.prioridad_regional.some((f) => f.region === r)).sort((a, b) => nombreRegion(a).localeCompare(nombreRegion(b), "es"));
  Object.assign(estado, { anio: ANIOS.at(-1), anioP: ANIOS_P.at(-1) });
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  $("#actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-region").innerHTML = opcion(NACIONAL, "Perú (nacional)") + REGIONES.map((r) => opcion(r, nombreRegion(r))).join("");
  $("#f-anio").innerHTML = [...ANIOS].reverse().map((a) => opcion(a, a)).join("");
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  $("#f-medida").onclick = (e) => { const b = e.target.closest("button[data-m]"); if (b) actualizar({ medida: b.dataset.m }); };
  $("#f-funcion").onchange = (e) => actualizar({ funcion: e.target.value });

  // Estado inicial desde la URL
  const p = Obs.parametros();
  if (MODULOS.includes(p.get("modulo"))) estado.modulo = p.get("modulo");
  const reg = String(p.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) estado.region = reg;
  if (ANIOS.includes(+p.get("anio"))) estado.anio = +p.get("anio");
  if (p.get("medida") === "pia") estado.medida = "pia";
  if (D.prioridad.some((f) => f.funcion === p.get("funcion"))) estado.funcion = p.get("funcion");

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

  mapa = new Obs.Mapa("mapa-regiones", geo, { alClic: elegirRegion, nombre: (c) => (DEL_MAPA[c] ? `Lima (departamento)` : nombreRegion(c)) });
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
