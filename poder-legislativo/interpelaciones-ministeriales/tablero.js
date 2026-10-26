/* =========================================================
   Tablero de Interpelaciones ministeriales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script
   (Tableros > Publicar tableros) desde cuatro pestañas del Sheet
   «6. Mociones de Interpelación»:
     - «General»: una fila por moción y ministro (fechas de
       presentación, admisión y concurrencia, votación de admisión,
       Cantidad_preguntas, Conclusión, Observación…).
     - «Mociones por legislatura»: por período anual de sesiones,
       mociones (_moc) y ministros (_pro) según cómo terminaron.
     - «Mociones por gobierno»: pedidos por gobierno según cómo
       terminaron, Días de gobierno y Ratio (días por pedido).
     - «Mociones por ministerio»: pedidos por gobierno y sector según
       cómo terminaron.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`.

   Parámetros de URL:
     ?periodo=2021-2026&unidad=pro
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "interpelaciones-ministeriales";
const ARCHIVOS = [{ clave: "mociones_interpelacion_base", etiqueta: "Mociones de interpelación (2001-2026)" }];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const MESES_C = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
// Cómo terminó la moción; «campo» es el prefijo de la columna en «Mociones por legislatura»
const ESTADOS = [
  { clave: "realizada", campo: "Aprobado", nombre: "Interpelación realizada", css: "--e-realizada" },
  { clave: "rechazada", campo: "Rechazada", nombre: "Admisión rechazada", css: "--e-rechazada" },
  { clave: "archivada", campo: "Archivada", nombre: "Archivada", css: "--e-archivada" },
  { clave: "proceso", campo: "Proceso", nombre: "En proceso", css: "--e-proceso" },
];
const DIA = 86400000;

const estado = { periodo: "", unidad: "moc" };

let FILAS = [], LEGIS = [], POR_GOB = [], POR_MIN = [], PERIODOS = [], GOBIERNOS = [], C;

const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const n = (k, uno, varios) => `${Obs.fmtN(k)} ${k === 1 ? uno : varios}`;
const sinEspacios = (s) => String(s ?? "").replace(/\s+/g, "");
const mediana = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function fecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
const fmtFecha = (d) => (d ? `${d.getUTCDate()} ${MESES_C[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—");
function clasificar(c) {
  c = c.toLowerCase();
  if (c.startsWith("aprobada")) return "realizada";
  if (c.startsWith("admisión rechazada")) return "rechazada";
  if (c.startsWith("en proceso")) return "proceso";
  return "archivada";
}
// Una legislatura (2016-2017) pertenece al período parlamentario (2016-2021) que la contiene
const enPeriodo = (legis, periodo) => { if (!periodo) return true; const a = +legis.slice(0, 4), [p0, p1] = periodo.split("-").map(Number); return a >= p0 && a < p1; };

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(e) {
  return {
    filas: FILAS.filter((f) => !e.periodo || f.periodo === e.periodo),
    legis: LEGIS, // el gráfico por legislatura muestra todas y resalta las del período
  };
}

/* ---------- Resumen y cifras clave ---------- */
function cifras(s) {
  const real = s.filas.filter((f) => f.estado === "realizada");
  const ministros = new Set(real.map((f) => f.ministro)).size;
  const legis = LEGIS.filter((l) => enPeriodo(l.legis, estado.periodo));
  const top = [...legis].sort((a, b) => b.moc.total - a.moc.total)[0];
  const cuando = estado.periodo ? `En el período parlamentario ${estado.periodo}` : `Entre ${FILAS[0].fecha.getUTCFullYear()} y ${FILAS.at(-1).fecha.getUTCFullYear()}`;
  document.getElementById("resumen").innerHTML = real.length
    ? `${cuando}, <strong>${n(real.length, "interpelación llegó", "interpelaciones llegaron")}</strong> al Pleno: ${n(ministros, "ministro respondió", "ministros distintos respondieron")} un pliego de preguntas.` +
      (top && legis.length > 1 ? ` La legislatura con más mociones fue ${top.legis}, con ${top.moc.total}.` : "")
    : `${cuando} no hubo interpelaciones realizadas.`;
  Obs.kpi("k-realizadas", { etiqueta: "Interpelaciones realizadas", valor: Obs.fmtN(real.length), pie: `De ${n(s.filas.length, "pedido", "pedidos")} a ministros` });
  const varias = new Map(); real.forEach((f) => varias.set(f.ministro, (varias.get(f.ministro) ?? 0) + 1));
  const repetidos = [...varias.values()].filter((v) => v > 1).length;
  Obs.kpi("k-ministros", { etiqueta: "Ministros interpelados", valor: Obs.fmtN(ministros), pie: repetidos ? `${n(repetidos, "lo fue", "lo fueron")} más de una vez` : "" });
  const dias = mediana(real.map((f) => f.dias));
  Obs.kpi("k-dias", { etiqueta: "Días hasta responder", valor: dias == null ? "—" : Obs.fmtN(dias), pie: "Mediana, desde la presentación de la moción" });
  const preg = mediana(real.map((f) => f.preguntas));
  Obs.kpi("k-preguntas", { etiqueta: "Preguntas por pliego", valor: preg == null ? "—" : Obs.fmtN(preg), pie: "Mediana de los pliegos interpelatorios" });
}

/* ---------- Mociones por legislatura ---------- */
function porLegislatura(s) {
  const id = "g-legis";
  const u = estado.unidad;
  const legis = s.legis;
  document.querySelectorAll("[data-unidad]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unidad === u)));
  document.getElementById("d-legis").textContent = (u === "moc" ? "Número de mociones" : "Número de ministros a los que se pidió interpelar") +
    " en cada período anual de sesiones, según cómo terminaron" + (estado.periodo ? `; en oscuro, el período ${estado.periodo}.` : ".");
  document.getElementById("ley-legis").innerHTML = ESTADOS.map((e) => `<span><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("");
  const g = Obs.grafico(id);
  const ancho = document.getElementById(id).clientWidth;
  // «2001-02»: el nombre completo no cabe con 26 legislaturas
  const etiquetas = legis.map((l) => `${l.legis.slice(0, 4)}-${l.legis.slice(7, 9)}`);
  const tenue = (l) => estado.periodo && !enPeriodo(l.legis, estado.periodo);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const l = legis[ps[0].dataIndex]; return `<strong>${l.legis}</strong>` + ps.filter((q) => q.value && q.seriesName !== "total").map((q) => `<br>${q.marker}${q.seriesName}: <strong>${q.value}</strong>`).join("") + `<br>Total: <strong>${l[u].total}</strong>`; } },
    grid: { left: 40, right: 12, top: 28, bottom: 30 },
    xAxis: { type: "category", data: etiquetas, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: ancho < 1100 ? (ancho < 600 ? 3 : 1) : 0, fontSize: 12 }) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [
      ...ESTADOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barCategoryGap: "22%",
        itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 1 },
        data: legis.map((l) => ({ value: l[u][e.clave] || null, itemStyle: { opacity: tenue(l) ? 0.25 : 1 } })) })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: legis.map(() => 0),
        label: { show: ancho >= 600, position: "top", formatter: (q) => String(legis[q.dataIndex][u].total || ""), ...txt({ color: C.texto, fontWeight: 700, fontSize: ancho < 900 ? 12 : 14 }) } },
    ],
  }, true);
}

/* ---------- Por gobierno ----------
   Pedidos según cómo terminaron y cada cuántos días hubo uno. Con un
   período elegido se resaltan los gobiernos que caen en él. */
function porGobierno(s) {
  const gobs = POR_GOB;
  const enSel = new Set(s.filas.map((f) => f.gobierno));
  const tenue = (g) => estado.periodo && !enSel.has(g.gobierno);
  document.getElementById("ley-gob").innerHTML = ESTADOS.map((e) => `<span><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("");
  const el = document.getElementById("g-gob");
  el.style.height = `${gobs.length * 36 + 40}px`;
  const g = Obs.grafico("g-gob");
  g.resize();
  const angosto = el.clientWidth < 420;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = gobs[ps[0].dataIndex]; return `<strong>${Obs.escapar(x.gobierno)}</strong>` +
        ps.filter((q) => q.value && q.seriesName !== "total").map((q) => `<br>${q.marker}${q.seriesName}: <strong>${q.value}</strong>`).join("") + `<br>Total: <strong>${x.total}</strong>`; } },
    grid: { left: angosto ? 84 : 150, right: 40, top: 4, bottom: 28 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: gobs.map((x) => (angosto ? x.gobierno.split(" ").at(-1) : x.gobierno)), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ color: C.texto }) },
    series: [
      ...ESTADOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 16,
        itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 1 },
        data: gobs.map((x) => ({ value: x[e.clave] || null, itemStyle: { opacity: tenue(x) ? 0.25 : 1 } })) })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: gobs.map(() => 0),
        label: { show: true, position: "right", formatter: (q) => String(gobs[q.dataIndex].total), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);

  Obs.barras("g-ritmo", gobs.filter((x) => x.ratio != null).map((x) => ({ clave: x.gobierno, etiqueta: x.gobierno, valor: x.ratio })), {
    formato: (v) => `1 cada ${Obs.fmtN(v)} días`, nombre: "", ordenar: false,
    seleccion: estado.periodo ? new Set(gobs.filter((x) => !tenue(x)).map((x) => x.gobierno)) : null,
  });
}

/* ---------- Ministerios por gobierno (mapa de calor) ----------
   Filas: sectores, de más a menos pedidos. Columnas: gobiernos, en orden.
   Celda: pedidos de interpelación; tono de un solo color, de claro a oscuro. */
const SECTOR_CORTO = { "Presidencia del Consejo de Ministros": "Presidencia del Consejo", "Vivienda, Construcción y Saneamiento": "Vivienda",
  "Trabajo y Promoción del Empleo": "Trabajo", "Mujer y Poblaciones Vulnerables": "Mujer", "Comercio Exterior y Turismo": "Comercio Exterior",
  "Justicia y Derechos Humanos": "Justicia", "Transportes y Comunicaciones": "Transportes", "Desarrollo e Inclusión Social": "Inclusión Social",
  "Desarrollo Agrario y Riego": "Desarrollo Agrario" };
function porMinisterio(s) {
  const id = "g-mapa";
  const gobs = GOBIERNOS.filter((g) => POR_MIN.some((x) => x.gobierno === g));
  const totalSector = new Map();
  POR_MIN.forEach((x) => totalSector.set(x.sector, (totalSector.get(x.sector) ?? 0) + x.total));
  const sectores = [...totalSector].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const enSel = new Set(s.filas.map((f) => f.gobierno));
  const tenue = (g) => estado.periodo && !enSel.has(g);
  // tramos: 1, 2, 3-4, 5-9, 10 o más
  const TRAMOS = [[1, 1, "1"], [2, 2, "2"], [3, 4, "3 a 4"], [5, 9, "5 a 9"], [10, Infinity, "10 o más"]];
  const color = (v) => C.escala[TRAMOS.findIndex(([a, b]) => v >= a && v <= b)];
  document.getElementById("ley-mapa").innerHTML = TRAMOS.map(([, , e], i) => `<span><i style="background:${C.escala[i]}"></i>${e}</span>`).join("");
  document.getElementById("d-mapa").textContent = "Pedidos de interpelación por ministerio y gobierno. Los ministerios, de más a menos pedidos" +
    (estado.periodo ? `; resaltados, los gobiernos del período ${estado.periodo}.` : ".");
  const el = document.getElementById(id);
  const angosto = el.clientWidth < 700;
  el.style.height = `${sectores.length * 30 + (angosto ? 90 : 60)}px`;
  const g = Obs.grafico(id);
  g.resize();
  const datos = POR_MIN.filter((x) => x.total > 0).map((x) => ({ value: [gobs.indexOf(x.gobierno), sectores.indexOf(x.sector), x.total], x,
    itemStyle: { color: color(x.total), opacity: tenue(x.gobierno) ? 0.25 : 1, borderColor: "#fff", borderWidth: 2 } }));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), formatter: (q) => { const x = q.data.x;
      return `<strong>${Obs.escapar(x.sector)}</strong><br>Gobierno de ${Obs.escapar(x.gobierno)}<br>Pedidos: <strong>${x.total}</strong>` +
        ESTADOS.filter((e) => x[e.clave]).map((e) => `<br>${e.nombre}: ${x[e.clave]}`).join(""); } },
    grid: { left: angosto ? 158 : 190, right: 8, top: angosto ? 70 : 40, bottom: 4 },
    xAxis: { type: "category", position: "top", data: gobs.map((x) => (x === "Keiko Fujimori" ? "K. Fujimori" : x === "Pedro Pablo Kuczynski" ? "Kuczynski" : x.split(" ").at(-1))), // apellido
      axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
      axisLabel: txt({ color: C.texto, interval: 0, rotate: angosto ? 45 : 0, fontSize: angosto ? 12 : 14 }) },
    yAxis: { type: "category", inverse: true, data: sectores.map((k) => `${SECTOR_CORTO[k] ?? k} (${totalSector.get(k)})`), axisTick: { show: false }, axisLine: { show: false },
      axisLabel: txt({ color: C.texto, fontSize: angosto ? 12 : 14 }) },
    series: [{ type: "heatmap", data: datos,
      label: { show: true, formatter: (q) => String(q.value[2]), fontFamily: C.fuente, fontSize: 12, fontWeight: 700, color: C.texto },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 2 } } }],
  }, true);
  // número en blanco sobre los tonos oscuros
  g.setOption({ series: [{ data: datos.map((d) => ({ ...d, label: { color: d.value[2] >= 5 ? "#fff" : C.texto } })) }] });
  el.setAttribute("aria-label", "Pedidos de interpelación por ministerio: " + sectores.map((k) => `${k}, ${totalSector.get(k)}`).join("; ") + ".");
}

/* ---------- Votos de admisión ---------- */
function votos(s) {
  const id = "g-votos";
  // una vez por moción: la votación es de la moción, no de cada ministro
  const porMocion = new Map();
  s.filas.filter((f) => f.favor != null && (f.estado === "realizada" || f.estado === "rechazada") && (f.adm || f.fecha))
    .forEach((f) => { if (!porMocion.has(f.mocion)) porMocion.set(f.mocion, f); });
  const mociones = [...porMocion.values()];
  const grupos = [["realizada", "Admitida"], ["rechazada", "Rechazada"]];
  document.getElementById("ley-votos").innerHTML = grupos.map(([k, e]) => `<span><i class="p" style="background:${C.estado[k]}"></i>${e}</span>`).join("");
  if (!mociones.length) return Obs.vacio(id);
  const med = mediana(mociones.filter((f) => f.estado === "realizada").map((f) => f.favor));
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "item", formatter: (q) => { const f = q.data.f;
      return `<strong>Moción ${Obs.escapar(f.mocion)}</strong><br>${Obs.escapar(f.ministros)}<br>Votación: ${fmtFecha(f.adm ?? f.fecha)}` +
        `<br>A favor: <strong>${f.favor}</strong>${f.contra != null ? `<br>En contra: ${f.contra}` : ""}${f.abst != null ? `<br>Abstenciones: ${f.abst}` : ""}<br>${f.estado === "realizada" ? "Admitida" : "Rechazada"}`; } },
    grid: { left: 44, right: 16, top: 16, bottom: 30 },
    xAxis: { type: "time", axisLine: { lineStyle: { color: C.linea } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { ...txt(), formatter: "{yyyy}", hideOverlap: true } },
    yAxis: { type: "value", name: "votos a favor", nameTextStyle: txt({ align: "left" }), splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: grupos.map(([k, e]) => ({
      name: e, type: "scatter", symbolSize: 10, z: k === "realizada" ? 3 : 2,
      itemStyle: { color: C.estado[k], borderColor: "#fff", borderWidth: 1.5 },
      data: mociones.filter((f) => f.estado === k).map((f) => ({ value: [+(f.adm ?? f.fecha), f.favor], f })),
      markLine: k === "realizada" && med != null ? { silent: true, symbol: "none", lineStyle: { color: C.textoSuave, type: "dashed" },
        label: { formatter: `Mediana: ${Obs.fmtN(med)}`, position: "insideEndTop", backgroundColor: "rgba(255,255,255,.9)", padding: [2, 4], ...txt({ color: C.texto, fontWeight: 700 }) }, data: [{ yAxis: med }] } : undefined,
    })),
  }, true);
}

/* ---------- Días hasta responder, por gobierno ---------- */
function dias(s) {
  const real = s.filas.filter((f) => f.estado === "realizada" && f.dias != null);
  const items = GOBIERNOS.map((gb) => { const v = real.filter((f) => f.gobierno === gb).map((f) => f.dias); return { clave: gb, etiqueta: gb, valor: mediana(v), n: v.length }; })
    .filter((d) => d.valor != null);
  Obs.barras("g-dias", items, { formato: (v) => `${Obs.fmtN(v)} días`, nombre: "Mediana", ordenar: false });
}

/* ---------- Tabla ---------- */
function tabla(s) {
  const el = document.getElementById("t-interp");
  const real = s.filas.filter((f) => f.estado === "realizada").sort((a, b) => (b.concurrencia ?? b.fecha) - (a.concurrencia ?? a.fecha));
  if (!real.length) { el.innerHTML = '<p class="pista">No hay interpelaciones realizadas en este período.</p>'; return; }
  const voto = (f) => (f.favor != null ? `${f.favor} a favor${f.contra != null ? `, ${f.contra} en contra` : ""}${f.abst != null ? `, ${f.abst} abst.` : ""}` : "—");
  el.innerHTML = `<table class="tabla"><thead><tr><th>Respondió</th><th>Ministro</th><th>Gobierno</th><th>Legislatura</th><th>Admisión</th><th class="num">Preguntas</th><th class="num">Días</th></tr></thead><tbody>` +
    real.map((f) => `<tr><td class="fecha">${fmtFecha(f.concurrencia)}</td>
      <td class="ministro">${Obs.escapar(f.ministro)}<small>${Obs.escapar(f.sector)}</small>${f.observacion ? `<small>${Obs.escapar(f.observacion)}</small>` : ""}</td>
      <td>${Obs.escapar(f.gobierno)}</td><td class="fecha">${Obs.escapar(f.legis)}</td>
      <td>${voto(f)}<small>Moción ${Obs.escapar(f.mocion)}, ${fmtFecha(f.fecha)}</small></td>
      <td class="num">${f.preguntas ?? "—"}</td><td class="num">${f.dias ?? "—"}</td></tr>`).join("") + "</tbody></table>";
  document.getElementById("t-tabla").textContent = real.length === 1 ? "La interpelación realizada" : `Las ${Obs.fmtN(real.length)} interpelaciones realizadas`;
}

/* ---------- Controles ---------- */
const $ = (q) => document.querySelector(q);
function render() {
  $("#f-periodo").value = estado.periodo;
  const s = filtrar(estado);
  cifras(s);
  porLegislatura(s);
  porGobierno(s);
  porMinisterio(s);
  votos(s);
  dias(s);
  tabla(s);
  Obs.escribirURL({ periodo: estado.periodo || null, unidad: estado.unidad === "moc" ? null : estado.unidad });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  C = { ...Obs.tema(), estado: Object.fromEntries(ESTADOS.map((e) => [e.clave, css.getPropertyValue(e.css).trim()])) };

  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  const numero = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  FILAS = Obs.expandir(datos.tablas.General).map((f) => {
    const pres = fecha(f["Fecha_presentación"]), conc = fecha(f.Fecha_Concurrencia);
    const d = pres && conc ? Math.round((conc - pres) / DIA) : null;
    return {
      mocion: limpio(f["Número_Moción"]), gobierno: limpio(f.Gobierno), periodo: sinEspacios(f.Periodo_Parlamentario), legis: sinEspacios(f.Periodo_Anual_Sesiones),
      fecha: pres, adm: fecha(f["Fecha_admisión_debate"]), concurrencia: conc, dias: d != null && d >= 0 ? d : null, // un caso con fechas inconsistentes queda sin días
      ministro: limpio(f.Ministro_Interpelado), sector: limpio(f.Sector), preguntas: numero(f.Cantidad_preguntas),
      favor: numero(f.A_favor_admision), contra: numero(f.En_contra_admision), abst: numero(f["Abstención_admision"]),
      estado: clasificar(limpio(f["Conclusión"])), observacion: /renunci/i.test(limpio(f["Observación"])) ? limpio(f["Observación"]) : "",
    };
  }).filter((f) => f.fecha).sort((a, b) => a.fecha - b.fecha);
  // ministros de cada moción, para el tooltip de la votación
  const deMocion = new Map();
  FILAS.forEach((f) => deMocion.set(f.mocion, (deMocion.get(f.mocion) ?? []).concat(f.ministro)));
  FILAS.forEach((f) => { const m = deMocion.get(f.mocion); f.ministros = m.length > 3 ? `${m.length} ministros` : m.join(", "); });
  PERIODOS = [...new Set(FILAS.map((f) => f.periodo))];
  GOBIERNOS = [...new Set(FILAS.map((f) => f.gobierno))];

  LEGIS = Obs.expandir(datos.tablas["Mociones por legislatura"]).filter((l) => l.Periodo_Anual_Sesiones).map((l) => {
    const fila = { legis: sinEspacios(l.Periodo_Anual_Sesiones) };
    for (const u of ["moc", "pro"]) {
      fila[u] = Object.fromEntries(ESTADOS.map((e) => [e.clave, numero(l[`${e.campo}_${u}`]) ?? 0]));
      fila[u].total = numero(l[`Total_${u}`]) ?? ESTADOS.reduce((t, e) => t + fila[u][e.clave], 0);
    }
    return fila;
  }).sort((a, b) => a.legis.localeCompare(b.legis));

  // en el orden en que gobernaron (el de la pestaña General)
  const orden = (g) => { const i = GOBIERNOS.indexOf(g); return i < 0 ? 99 : i; };
  POR_GOB = Obs.expandir(datos.tablas["Mociones por gobierno"]).filter((x) => x.Gobierno).map((x) => ({
    gobierno: limpio(x.Gobierno), realizada: numero(x.Aprobada) ?? 0, rechazada: numero(x["Admisión rechazada"]) ?? 0,
    archivada: numero(x.Archivada) ?? 0, proceso: numero(x["En proceso"]) ?? 0, total: numero(x.Total) ?? 0,
    dias: numero(x["Días"]), ratio: numero(x.Ratio),
  })).sort((a, b) => orden(a.gobierno) - orden(b.gobierno));

  POR_MIN = Obs.expandir(datos.tablas["Mociones por ministerio"]).filter((x) => x.Gobierno && x.Sector).map((x) => ({
    gobierno: limpio(x.Gobierno), sector: limpio(x.Sector), realizada: numero(x.Aprobada) ?? 0, rechazada: numero(x["Admisión rechazada"]) ?? 0,
    archivada: numero(x.Archivada) ?? 0, proceso: numero(x["En proceso"]) ?? 0, total: numero(x.Total) ?? 0,
  }));

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-periodo").innerHTML = opcion("", "Todos (2001-2026)") + PERIODOS.map((p) => opcion(p, p)).join("");
  $("#f-periodo").onchange = (e) => actualizar({ periodo: e.target.value });
  document.querySelectorAll("[data-unidad]").forEach((b) => (b.onclick = () => actualizar({ unidad: b.dataset.unidad })));

  const p = Obs.parametros();
  const pe = sinEspacios(p.get("periodo"));
  if (PERIODOS.includes(pe)) estado.periodo = pe;
  if (p.get("unidad") === "pro") estado.unidad = "pro";

  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
