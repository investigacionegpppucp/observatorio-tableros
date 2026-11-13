/* =========================================================
   Tablero de Saneamiento — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma procesos/saneamiento/procesar.py desde
   el Censo 2025 (Redatam del INEI, vía procesos/saneamiento/censo.py)
   y los Excel del MEF. Tablas:
     censo               viviendas por fuente de agua (a_*), servicio higiénico (d_*),
                         días y horas de agua, tiempo para ir por agua; país y
                         departamentos, total, urbano y rural
     censo_distrito      fuente de agua y servicio higiénico por distrito
     prioridad           peso de cada función en el presupuesto nacional (por_pia, por_pim)
     prioridad_regional  lo mismo en cada departamento
     presupuesto         función Saneamiento por año: pia, pim, devengado (soles)
     nivel_gobierno      lo mismo por nivel de gobierno (pestaña pendiente)
     cobertura           hogares según su acceso a agua (pestaña pendiente)

   Patrón: un objeto `estado`, funciones puras de consulta y una sola
   función `render()`.

   Parámetros de URL:
     ?modulo=prioridad&region=PUNO&anio=2022&medida=pia&funcion=SALUD
     ?region=CUSCO&area=rural&ind=desague_red&nivel=distrito
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "saneamiento";
const ARCHIVOS = [
  { clave: "saneamiento_censo", etiqueta: "Acceso al agua y desagüe por departamento y distrito (Censo 2025)" },
  { clave: "saneamiento_base", etiqueta: "Presupuesto de saneamiento y prioridad por función (2012-2023)" },
];
const NACIONAL = "NACIONAL";
const SANEAMIENTO = "SANEAMIENTO";
const MODULOS = ["acceso", "prioridad", "presupuesto"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca", CALLAO: "Callao",
  CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad", LAMBAYEQUE: "Lambayeque",
  LIMA: "Lima", "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto", "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno",
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

const estado = { modulo: "acceso", region: NACIONAL, anio: null, medida: "pim", funcion: SANEAMIENTO, anioP: null, area: "total", ind: "agua_red", nivel: "departamento", buscar: "" };
let D = {}, C, mapa, ANIOS = [], REGIONES = [], ANIOS_P = [], REGIONES_CENSO = [], GEO_REG = null;
const mapasCenso = {};

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
   Acceso al agua y desagüe (Censo 2025)
   --------------------------------------------------------- */
const AGUA = [["a_red", "Red pública", "#003fa3"], ["a_pilon", "Pilón o pileta de uso público", "#4f7fd6"], ["a_cisterna", "Camión cisterna u otro similar", "#8fb0ec"],
  ["a_pozo", "Pozo (agua subterránea)", "#e8a33d"], ["a_manantial", "Manantial o puquio", "#c96f1e"], ["a_rio", "Río, acequia, lago o laguna", "#a3123a"], ["a_otro", "Otro", "#9aa3b0"]];
const DESAGUE = [["d_red_dentro", "Red pública dentro de la vivienda", "#003fa3"], ["d_red_fuera", "Red pública fuera de la vivienda, en el lote", "#4f7fd6"],
  ["d_septico", "Pozo séptico, tanque séptico o biodigestor", "#8fb0ec"], ["d_letrina", "Letrina con tratamiento", "#bcd0f5"], ["d_ciego", "Pozo ciego o negro", "#e8a33d"],
  ["d_rio", "Río, acequia o canal", "#c96f1e"], ["d_aire", "Sin servicio, al aire libre", "#a3123a"], ["d_otro", "Otro", "#9aa3b0"]];
const HORAS = [["h24", "Las 24 horas", "#003fa3"], ["h12", "De 12 a 23 horas", "#4f7fd6"], ["h6", "De 6 a 11 horas", "#e8a33d"], ["h1", "Menos de 6 horas", "#a3123a"]];
const TIEMPO = [["t_no", "No se desplaza (le llevan el agua o la tiene cerca)", "#9aa3b0"], ["t_30", "Menos de 30 minutos", "#8fb0ec"], ["t_60", "De 30 minutos a 1 hora", "#e8a33d"],
  ["t_120", "De 1 a 2 horas", "#c96f1e"], ["t_180", "De 2 a 3 horas", "#a3123a"]];
const suma = (f, lista) => (f ? lista.reduce((s, [k]) => s + (f[k] ?? 0), 0) : 0);
const censo = (reg, area = estado.area) => D.censo.find((f) => f.region === (reg === NACIONAL ? "PERU" : reg) && f.area === area) ?? null;
const AREAS = { total: "", urbano: " del área urbana", rural: " del área rural" };
// Indicadores (porcentaje de viviendas); `dist`: también por distrito; `solo_total`: sin dato por área
const IND_CENSO = [
  { id: "agua_red", nombre: "Agua por red pública", f: (x) => x.a_red / suma(x, AGUA), dist: true },
  { id: "desague_red", nombre: "Desagüe por red pública", f: (x) => (x.d_red_dentro + x.d_red_fuera) / suma(x, DESAGUE), dist: true },
  { id: "aire", nombre: "Sin servicio higiénico (al aire libre)", f: (x) => x.d_aire / suma(x, DESAGUE), dist: true },
  { id: "rio", nombre: "Agua de río, acequia, manantial o puquio", f: (x) => (x.a_rio + x.a_manantial) / suma(x, AGUA), dist: true },
  { id: "cisterna", nombre: "Agua de camión cisterna", f: (x) => x.a_cisterna / suma(x, AGUA), dist: true },
  { id: "dias", nombre: "Agua todos los días (con red o pilón)", f: (x) => (x.dias_si == null ? null : x.dias_si / (x.dias_si + x.dias_no)), solo_total: true },
  { id: "h24", nombre: "Agua las 24 horas, todos los días (con red o pilón)", f: (x) => (x.h24 == null ? null : x.h24 / (x.dias_si + x.dias_no)), solo_total: true },
];
function composicion(id, items, unidad = "viviendas") {
  const total = items.reduce((s, x) => s + x.valor, 0);
  if (!total) { $(id).innerHTML = `<p class="pista">Sin datos para esta selección.</p>`; return; }
  $(id).innerHTML = `<div class="barra-comp" aria-hidden="true">${items.filter((x) => x.valor).map((x) => `<i style="flex:${x.valor} 1 0;background:${x.color}" title="${Obs.escapar(x.etiqueta)}: ${pct(x.valor / total)}"></i>`).join("")}</div>` +
    `<ul class="partes" aria-label="${unidad}">${items.map((x) => `<li><div><b style="background:${x.color}"></b><span>${Obs.escapar(x.etiqueta)}</span><strong>${Obs.fmtN(x.valor, 0)}</strong><em>${pct(x.valor / total)}</em></div></li>`).join("")}</ul>`;
}
const partes = (f, lista) => lista.map(([k, e, c]) => ({ etiqueta: e, valor: f?.[k] ?? 0, color: c }));

function pintarAcceso() {
  const r = estado.region, a = estado.area, f = censo(r), t = censo(r, "total");
  const amb = r === NACIONAL ? "el Perú" : nombreRegion(r);
  if (!f) { $("#r-acceso").textContent = `${nombreRegion(r)} no tiene área ${a === "urbano" ? "urbana" : "rural"} en el Censo. Elige otra área.`; ["#k-acceso", "#g-agua", "#g-desague"].forEach((id) => ($(id).innerHTML = "")); pintarMapaCenso(); return; }
  const ta = suma(f, AGUA), td = suma(f, DESAGUE);
  const red = f.a_red / ta, des = (f.d_red_dentro + f.d_red_fuera) / td, aire = f.d_aire / td;
  const u = censo(r, "urbano"), ru = censo(r, "rural");
  const redU = u ? u.a_red / suma(u, AGUA) : null, redR = ru ? ru.a_red / suma(ru, AGUA) : null;
  const donde = a === "total" ? `en ${amb}` : `en el área ${a === "urbano" ? "urbana" : "rural"} ${r === NACIONAL ? "del Perú" : `de ${amb}`}`;
  $("#r-acceso").innerHTML = `Según el Censo 2025, ${donde}, ${destacar(pct(red))} de las viviendas tiene agua por red pública y ${destacar(pct(des))} desagüe por red pública. ` +
    `${destacar(Obs.fmtN(f.d_aire, 0))} viviendas no tienen servicio higiénico (${pct(aire)}).` +
    (a === "total" && redU != null && redR != null ? ` En el área urbana, ${pct(redU)} tiene agua por red pública; en la rural, ${pct(redR)}.` : "");
  const diasT = t.dias_si / (t.dias_si + t.dias_no), h24 = t.h24 / (t.dias_si + t.dias_no);
  kpis("#k-acceso", [
    { etiqueta: "Agua por red pública", valor: pct(red), pie: `${Obs.fmtN(f.a_red, 0)} viviendas` },
    { etiqueta: "Desagüe por red pública", valor: pct(des), pie: `${Obs.fmtN(f.d_red_dentro + f.d_red_fuera, 0)} viviendas` },
    { etiqueta: "Agua todos los días", valor: pct(diasT), pie: `De las viviendas con red o pilón${a !== "total" ? " (urbano y rural)" : ""}` },
    { etiqueta: "Agua las 24 horas, todos los días", valor: pct(h24), pie: `De las viviendas con red o pilón${a !== "total" ? " (urbano y rural)" : ""}` },
  ]);
  $("#d-agua").textContent = `Fuente principal del agua de las viviendas${AREAS[a]}, ${amb}.`;
  composicion("#g-agua", partes(f, AGUA));
  $("#d-desague").textContent = `Servicio higiénico de las viviendas${AREAS[a]}, ${amb}.`;
  composicion("#g-desague", partes(f, DESAGUE));
  // Días y horas (solo hay dato para el total)
  $("#d-horas").textContent = `Viviendas con agua por red pública o pilón todos los días, según las horas al día con servicio, ${amb}${a !== "total" ? " (urbano y rural juntos: no hay dato por área)" : ""}.`;
  composicion("#g-horas", partes(t, HORAS));
  $("#l-dias").innerHTML = `Además, ${destacar(Obs.fmtN(t.dias_no, 0))} viviendas con red pública o pilón (${pct(1 - diasT)}) no tienen agua todos los días de la semana.`;
  $("#d-tiempo").textContent = `Viviendas sin agua por red pública, según el tiempo que demoran en ir, recoger agua y volver, ${amb}${a !== "total" ? " (urbano y rural juntos)" : ""}.`;
  composicion("#g-tiempo", partes(t, TIEMPO));
  // Urbano y rural
  $("#d-areas").textContent = `Porcentaje de viviendas, ${amb}, en el área urbana y en la rural.`;
  const inds = IND_CENSO.filter((i) => !i.solo_total);
  if (!u || !ru) Obs.vacio("g-areas");
  else {
    const g = Obs.grafico("g-areas");
    g.setOption({
      textStyle: { fontFamily: C.fuente }, animation: ANIM,
      legend: { top: 0, left: 0, textStyle: txt(), icon: "rect", itemWidth: 12, itemHeight: 12 },
      tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
        formatter: (ps) => `<strong>${ps[0].name}</strong>` + ps.map((q) => `<br>${q.marker}${q.seriesName}: <strong>${pct(q.value)}</strong>`).join("") },
      grid: { left: 230, right: 56, top: 32, bottom: 8 },
      xAxis: { type: "value", show: false, max: 1 },
      yAxis: { type: "category", inverse: true, data: inds.map((i) => i.nombre), axisTick: { show: false }, axisLine: { show: false }, axisLabel: txt({ color: C.texto, width: 220, overflow: "break" }) },
      series: [["Urbano", u, C.unica], ["Rural", ru, "#e8a33d"]].map(([n, x, c]) => ({ name: n, type: "bar", barWidth: 14, barGap: "20%", data: inds.map((i) => i.f(x)), itemStyle: { color: c, borderRadius: [0, 2, 2, 0] },
        label: { show: true, position: "right", formatter: (q) => pct(q.value), ...txt({ fontSize: 13, color: C.texto }) } })),
    }, true);
  }
  pintarMapaCenso();
}

async function geoDistritos() {
  if (!geoDistritos.g) {
    const d = await Obs.cargarJSON("../../mapas/peru_distritos.geojson");
    geoDistritos.g = { ...d, features: [...GEO_REG.features.filter((f) => f.properties.tipo === "pais"), ...d.features] };
  }
  return geoDistritos.g;
}
async function pintarMapaCenso() {
  const ind = IND_CENSO.find((i) => i.id === estado.ind) ?? IND_CENSO[0];
  const nivel = ind.dist ? estado.nivel : "departamento";
  const a = ind.solo_total || nivel === "distrito" ? "total" : estado.area;
  $("#f-ind").innerHTML = IND_CENSO.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  $("#f-nivel").innerHTML = [["departamento", "Departamento"], ["distrito", "Distrito"]].filter(([n]) => n === "departamento" || ind.dist)
    .map(([n, e]) => `<button type="button" data-n="${n}" aria-pressed="${n === nivel}">${e}</button>`).join("");
  $("#t-mapa-c").textContent = `${ind.nombre}${AREAS[a]}, por ${nivel}`;
  $("#d-mapa-c").textContent = `Porcentaje de viviendas. Cuanto más oscura el área, mayor el porcentaje. ${nivel === "departamento" ? "Haz clic en un departamento para verlo en todo el tablero; otro clic vuelve al Perú." : "La tabla muestra los distritos del departamento elegido, o los de todo el país."}`;
  $("#n-mapa-c").textContent = nivel === "distrito"
    ? "Los distritos creados después de 2017 no tienen límites en el mapa: aparecen solo en la tabla." + (estado.area !== "total" ? " Por distrito no hay datos por área: se muestra el total." : "")
    : (estado.area !== "total" && ind.solo_total ? "Este indicador no tiene datos por área: se muestra el total." : "");
  ["departamento", "distrito"].forEach((n) => ($(`#mapa-censo-${n === "departamento" ? "dep" : "dist"}`).hidden = n !== nivel));
  $("#g-deps").hidden = nivel !== "departamento";
  $("#caja-dist").hidden = nivel !== "distrito";
  let valores, nombres;
  if (nivel === "departamento") {
    const regs = REGIONES_CENSO.map((reg) => { const x = censo(reg, a); return { reg, v: x ? ind.f(x) : null }; }).filter((x) => x.v != null && isFinite(x.v)); // el Callao y Lima Metropolitana no tienen área rural
    valores = new Map(regs.map((x) => [x.reg, x.v]));
    nombres = (c) => nombreRegion(c);
    Obs.barras("g-deps", regs.map((x) => ({ clave: x.reg, etiqueta: nombreRegion(x.reg), valor: x.v })), {
      formato: pct, nombre: ind.nombre, seleccion: estado.region === NACIONAL ? null : new Set([estado.region]), alClic: elegirRegionCenso,
    });
  } else {
    const filas = D.censo_distrito.map((x) => ({ ...x, v: ind.f(x), viv: suma(x, AGUA) }));
    valores = new Map(filas.map((x) => [x.ubigeo, x.v]));
    const porUbigeo = new Map(filas.map((x) => [x.ubigeo, x]));
    nombres = (c) => { const x = porUbigeo.get(c); return x ? `${x.distrito} (${x.provincia}, ${nombreRegion(x.departamento)})` : c; };
    const q = estado.buscar.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const plano = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const vista = filas.filter((x) => (estado.region === NACIONAL || x.departamento === estado.region) && (!q || plano(`${x.distrito} ${x.provincia}`).includes(q)));
    tablaOrdenable("t-dist", [
      { clave: "distrito", titulo: "Distrito", valor: (x) => x.distrito, html: (x) => `<strong>${Obs.escapar(x.distrito)}</strong><small>${Obs.escapar(x.provincia)}, ${nombreRegion(x.departamento)}</small>` },
      { clave: "viv", titulo: "Viviendas", num: true, valor: (x) => x.viv, html: (x) => Obs.fmtN(x.viv, 0) },
      { clave: "v", titulo: ind.nombre, num: true, valor: (x) => x.v, html: (x) => pct(x.v) },
    ], vista, { inicial: { clave: "v", dir: 1 }, claveFila: (x) => x.ubigeo, descripcion: `${ind.nombre} por distrito` });
  }
  const vs = [...valores.values()].filter((v) => v != null && isFinite(v));
  const min = Math.min(...vs), max = Math.max(...vs);
  const orden = [...valores].filter(([, v]) => v != null && isFinite(v)).sort((x, y) => y[1] - x[1]);
  const peru = ind.f(censo(NACIONAL, a));
  $("#l-mapa-c").innerHTML = orden.length ? `Va de ${destacar(pct(min))} en ${Obs.escapar(nombres(orden.at(-1)[0]))} a ${destacar(pct(max))} en ${Obs.escapar(nombres(orden[0][0]))}. En el Perú: ${pct(peru)}.` : "";
  $("#ley-mapa-c").innerHTML = `<div class="ley-continua"><span>${pct(min)}</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${pct(max)}</span></div>`;
  const clave = nivel === "departamento" ? "dep" : "dist";
  if (!mapasCenso[clave]) {
    const geo = nivel === "departamento" ? GEO_REG : await geoDistritos();
    mapasCenso[clave] = new Obs.Mapa(`mapa-censo-${clave}`, geo, { alClic: nivel === "departamento" ? elegirRegionCenso : () => {}, nombre: (c) => mapasCenso[clave].nombres?.(c) ?? c });
  }
  mapasCenso[clave].nombres = nombres;
  mapasCenso[clave].pintar({ valores, color: (v) => colorContinuo(max > min ? (v - min) / (max - min) : 1), texto: pct, elegida: nivel === "departamento" && estado.region !== NACIONAL ? estado.region : null });
}
const elegirRegionCenso = (cod) => actualizar({ region: cod === estado.region || cod === NACIONAL ? NACIONAL : cod });

/* Tabla ordenable (distritos) */
const ORDEN = {};
function tablaOrdenable(id, columnas, filas, { inicial, claveFila = () => "", descripcion }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const datos = [...filas].sort((a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null || !isFinite(x) && typeof x === "number") return (x == null) - (y == null);
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  });
  const LIMITE = 300;
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    return `<th class="${c.num ? "num" : ""}" aria-sort="${activo ? (orden.dir === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  el.innerHTML = datos.length
    ? `<table class="tabla ordenable"><caption class="solo-lectores">${Obs.escapar(descripcion)}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>` +
      datos.slice(0, LIMITE).map((f) => `<tr>${columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("")}</tr>`).join("") + "</tbody></table>" +
      (datos.length > LIMITE ? `<p class="pista" style="padding:8px 12px">Se muestran ${LIMITE} de ${Obs.fmtN(datos.length, 0)} distritos. Elige un departamento o busca por nombre.</p>` : "")
    : '<p class="pista" style="padding:12px">Ningún distrito coincide con la búsqueda.</p>';
  if (!datos.length) return;
  el.querySelector("thead").onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (!b) return;
    const c = columnas.find((x) => x.clave === b.dataset.orden);
    ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
    tablaOrdenable(id, columnas, filas, { inicial, claveFila, descripcion });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function render() {
  // El Censo separa Lima Metropolitana y Lima Provincias; el presupuesto trae el departamento de Lima
  const lista = estado.modulo === "acceso" ? REGIONES_CENSO : REGIONES;
  if (estado.region !== NACIONAL && !lista.includes(estado.region)) estado.region = estado.modulo === "acceso" ? "LIMA METROPOLITANA" : DEL_MAPA[estado.region] ?? NACIONAL;
  $("#f-region").innerHTML = `<option value="${NACIONAL}">Perú (nacional)</option>` + lista.map((r) => `<option value="${r}">${nombreRegion(r)}</option>`).join("");
  $("#f-region").value = estado.region;
  $("#f-area").innerHTML = [["total", "Total"], ["urbano", "Urbana"], ["rural", "Rural"]].map(([k, e]) => `<button type="button" data-a="${k}" aria-pressed="${estado.area === k}">${e}</button>`).join("");
  document.querySelectorAll("#filtros [data-en]").forEach((el) => (el.hidden = el.dataset.en !== estado.modulo));
  $("#f-anio").value = estado.anio;
  $("#f-medida").innerHTML = [["pim", "PIM"], ["pia", "PIA"]].map(([k, e]) => `<button type="button" data-m="${k}" aria-pressed="${estado.medida === k}">${e}</button>`).join("");
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => ($(`#m-${m}`).hidden = m !== estado.modulo));
  $("#filtros").hidden = estado.modulo === "presupuesto"; // la pestaña de presupuesto es nacional
  ({ acceso: pintarAcceso, prioridad: pintarPrioridad, presupuesto: pintarPresupuesto })[estado.modulo]();
  Obs.escribirURL({
    modulo: estado.modulo === "acceso" ? null : estado.modulo,
    area: estado.area === "total" ? null : estado.area,
    ind: estado.ind === "agua_red" ? null : estado.ind,
    nivel: estado.nivel === "departamento" ? null : estado.nivel,
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
  GEO_REG = geo;
  C = Obs.tema();
  D = Object.fromEntries(Object.entries(datos.tablas).map(([k, t]) => [k, Obs.expandir(t)]));
  ANIOS = [...new Set(D.prioridad.map((f) => f.anio))].sort((a, b) => a - b);
  ANIOS_P = D.presupuesto.map((f) => f.anio);
  REGIONES = Object.keys(NOMBRES).filter((r) => D.prioridad_regional.some((f) => f.region === r)).sort((a, b) => nombreRegion(a).localeCompare(nombreRegion(b), "es"));
  REGIONES_CENSO = Object.keys(NOMBRES).filter((r) => D.censo.some((f) => f.region === r)).sort((a, b) => nombreRegion(a).localeCompare(nombreRegion(b), "es"));
  Object.assign(estado, { anio: ANIOS.at(-1), anioP: ANIOS_P.at(-1) });
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  $("#actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-area").onclick = (e) => { const b = e.target.closest("button[data-a]"); if (b) actualizar({ area: b.dataset.a }); };
  $("#f-ind").onchange = (e) => actualizar({ ind: e.target.value });
  $("#f-nivel").onclick = (e) => { const b = e.target.closest("button[data-n]"); if (b) actualizar({ nivel: b.dataset.n }); };
  $("#f-buscar").oninput = (e) => { estado.buscar = e.target.value; clearTimeout(window.__b); window.__b = setTimeout(pintarMapaCenso, 200); };
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
  if (["urbano", "rural"].includes(p.get("area"))) estado.area = p.get("area");
  if (IND_CENSO.some((i) => i.id === p.get("ind"))) estado.ind = p.get("ind");
  if (p.get("nivel") === "distrito") estado.nivel = "distrito";
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
