/* =========================================================
   Tablero de Vacancias presidenciales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script
   (Tableros > Publicar tableros) desde la pestaña «General» del
   Sheet «4. Vacancias presidenciales». Una fila por pedido y
   bancada que lo firmó: N (número del pedido), Documento,
   Presidente, Gobierno, Periodo Anual de Sesiones, Autores,
   Presentación, Admisión, Vacancia (fechas), Resultado y
   Bancada proponentes.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`.

   Parámetros de URL:
     ?presidente=Dina Boluarte&bancada=Perú Libre
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "vacancias-presidenciales";
const ARCHIVOS = [{ clave: "vacancias_presidenciales_base", etiqueta: "Pedidos de vacancia presidencial (2000-2025)" }];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const MESES_C = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
// Hasta dónde llegó el pedido, en orden
const ESTADOS = [
  { clave: "presentada", nombre: "Solo se presentó", css: "--e-presentada" },
  { clave: "adm-rechazada", nombre: "No fue admitido", css: "--e-adm-rechazada" },
  { clave: "suspendida", nombre: "Admitido y suspendido", css: "--e-suspendida" },
  { clave: "vac-rechazada", nombre: "Vacancia rechazada", css: "--e-vac-rechazada" },
  { clave: "aprobada", nombre: "Vacancia aprobada", css: "--e-aprobada" },
];
const ADMITIDOS = new Set(["suspendida", "vac-rechazada", "aprobada"]);

const estado = { presidente: "", bancada: "" };

let PEDIDOS = [], PRESIDENTES = [], BANCADAS = [], C;
const NOMBRE_ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.clave, e.nombre]));

const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const n = (k, uno, varios) => `${Obs.fmtN(k)} ${k === 1 ? uno : varios}`;
// Fechas: AAAA-MM-DD (Apps Script) o d/m/aaaa (Sheet copiado)
function fecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
// Nombres cortos de bancadas para los gráficos (la tabla y el filtro usan el nombre completo)
const cortoBancada = (b) => b.replace(/ - Partido de Integración Social$/i, "").replace(/ - Bloque Magisterial$/, "")
  .replace(/^Bloque Magisterial de Concertación Nacional$/, "Bloque Magisterial");
const fmtFecha = (d) => (d ? `${d.getUTCDate()} ${MESES_C[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—");
const fmtFechaLarga = (d) => `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
function clasificar(resultado) {
  const r = resultado.toLowerCase();
  if (r.startsWith("vacancia aprobada")) return "aprobada";
  if (r.startsWith("vacancia rechazada")) return "vac-rechazada";
  if (r.startsWith("admisión aprobada")) return "suspendida";
  if (r.startsWith("admisión rechazada")) return "adm-rechazada";
  return "presentada";
}

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(pedidos, e) {
  const dePres = (p) => !e.presidente || p.presidente === e.presidente;
  const deBanc = (p) => !e.bancada || p.bancadas.has(e.bancada);
  return {
    elegidos: pedidos.filter((p) => dePres(p) && deBanc(p)),
    presidentes: pedidos.filter(deBanc),
    bancadas: pedidos.filter(dePres),
  };
}

/* ---------- Resumen y cifras clave ---------- */
function cifras(s) {
  const p = s.elegidos;
  const aprob = p.filter((x) => x.estado === "aprobada");
  const vacados = [...new Set(aprob.map((x) => x.presidente))];
  const contra = [...new Set(p.map((x) => x.presidente))];
  const el = document.getElementById("resumen");
  if (!p.length) {
    el.textContent = `${estado.bancada} no firmó pedidos de vacancia contra ${estado.presidente}.`;
  } else {
    const quien = estado.bancada ? `${Obs.escapar(estado.bancada)} firmó` : "se presentaron";
    const contraQuien = estado.presidente ? `contra ${Obs.escapar(estado.presidente)}` : `contra ${n(contra.length, "presidente", "presidentes")}`;
    const desde = p[0].pres.getUTCFullYear(), hasta = p.at(-1).pres.getUTCFullYear();
    const cuando = desde === hasta ? `En ${desde}` : `Entre ${desde} y ${hasta}`;
    el.innerHTML = `${cuando} ${quien} <strong>${n(p.length, "pedido de vacancia", "pedidos de vacancia")}</strong> ${contraQuien}. ` +
      (aprob.length
        ? `${aprob.length === 1 ? "Uno terminó" : `${Obs.fmtN(aprob.length)} terminaron`} con la vacancia aprobada: con ${aprob.length === 1 ? "él" : "ellos"} se declaró la vacancia de ${vacados.map((v) => `<strong>${Obs.escapar(v)}</strong>`).join(", ").replace(/, ([^,]*)$/, " y $1")}.`
        : "Ninguno terminó con la vacancia aprobada.");
  }
  Obs.kpi("k-pedidos", { etiqueta: "Pedidos de vacancia", valor: Obs.fmtN(p.length), pie: p.length ? `${fmtFecha(p[0].pres)} a ${fmtFecha(p.at(-1).pres)}` : "" });
  const adm = p.filter((x) => ADMITIDOS.has(x.estado)).length;
  Obs.kpi("k-admitidos", { etiqueta: "Admitidos a debate", valor: Obs.fmtN(adm), pie: p.length ? `${Obs.fmtPct(adm / p.length, 0)} de los pedidos` : "" });
  Obs.kpi("k-aprobados", { etiqueta: "Con la vacancia aprobada", valor: Obs.fmtN(aprob.length), pie: aprob.length > vacados.length ? "Varios pedidos se votaron juntos" : "" });
  Obs.kpi("k-vacados", { etiqueta: "Presidentes vacados", valor: Obs.fmtN(vacados.length), pie: vacados.length ? Obs.escapar(vacados.join(", ")) : "" });
}

/* ---------- Línea de tiempo ----------
   Una fila por presidente; los pedidos del mismo día se apilan. Lo que no
   entra en el filtro queda atenuado, para no perder el contexto. */
function lineaTiempo(s) {
  const id = "g-linea";
  const el = document.getElementById(id);
  const presis = PRESIDENTES;
  el.style.height = `${presis.length * 52 + 50}px`;
  const g = Obs.grafico(id);
  g.resize();
  const elegidos = new Set(s.elegidos.map((p) => p.n));
  const mismoDia = new Map();
  PEDIDOS.forEach((p) => { const k = `${p.presidente}|${+p.pres}`; mismoDia.set(k, (mismoDia.get(k) ?? []).concat(p)); });
  const datos = PEDIDOS.map((p) => {
    const grupo = mismoDia.get(`${p.presidente}|${+p.pres}`), i = grupo.indexOf(p);
    return { value: [+p.pres, presis.indexOf(p.presidente)], p, symbolOffset: [0, (i - (grupo.length - 1) / 2) * 11],
      itemStyle: { color: C.estado[p.estado], opacity: elegidos.has(p.n) ? 1 : 0.15, borderColor: "#fff", borderWidth: 1.5 } };
  });
  const ini = Date.UTC(PEDIDOS[0].pres.getUTCFullYear(), 0, 1), fin = Date.UTC(PEDIDOS.at(-1).pres.getUTCFullYear() + 1, 0, 1);
  const angosto = el.clientWidth < 600;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "item", formatter: (q) => detalle(q.data.p) },
    grid: { left: angosto ? 92 : 168, right: 20, top: 8, bottom: 30 },
    xAxis: { type: "time", min: ini, max: fin, splitNumber: angosto ? 4 : 10, axisLine: { lineStyle: { color: C.linea } }, axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: C.linea } }, axisLabel: { ...txt(), formatter: "{yyyy}" } },
    yAxis: { type: "category", data: presis.map((x) => (angosto ? x.split(" ").at(-1) : x)), inverse: true, axisTick: { show: false }, axisLine: { show: false },
      splitLine: { show: true, lineStyle: { color: C.fondo, width: 1 } },
      axisLabel: { ...txt({ color: C.texto }), formatter: (v, i) => (presis[i] === estado.presidente ? `{b|${v}}` : v), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
    series: [{ type: "scatter", symbolSize: 12, data: datos, cursor: "pointer" }],
  }, true);
  g.off("click");
  g.on("click", (q) => q.data?.p && actualizar({ presidente: q.data.p.presidente === estado.presidente ? "" : q.data.p.presidente }));
  document.getElementById("ley-linea").innerHTML = ESTADOS.map((e) => `<span><i class="p" style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("");
  el.setAttribute("aria-label", "Línea de tiempo de los pedidos de vacancia: " + s.elegidos.map((p) => `${p.doc}, ${p.presidente}, ${fmtFecha(p.pres)}, ${NOMBRE_ESTADO[p.estado]}`).join("; ") + ".");
}
function detalle(p) {
  const fila = (k, v) => (v ? `<br>${k}: <strong>${fmtFecha(v)}</strong>` : "");
  return `<strong>${Obs.escapar(p.doc)}</strong><br>Contra ${Obs.escapar(p.presidente)}` +
    fila("Presentado", p.pres) + fila("Votación de admisión", p.adm) + fila("Votación de la vacancia", p.vac) +
    `<br><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${C.estado[p.estado]};margin-right:6px"></span>${NOMBRE_ESTADO[p.estado]}` +
    (p.detalle ? `<br><span style="opacity:.85">${Obs.escapar(p.detalle)}</span>` : "");
}

/* ---------- Pedidos por presidente (barras apiladas por resultado) ---------- */
function porPresidente(s) {
  const id = "g-presidentes";
  const presis = PRESIDENTES.filter((x) => s.presidentes.some((p) => p.presidente === x));
  document.getElementById("d-presidentes").textContent = estado.bancada ? `Pedidos firmados por ${estado.bancada}, según cómo terminaron.` : "Número de pedidos, según cómo terminaron.";
  document.getElementById("ley-presidentes").innerHTML = ESTADOS.map((e) => `<span><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("");
  if (!presis.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${presis.length * 40 + 40}px`;
  const g = Obs.grafico(id);
  g.resize();
  const cuenta = (pr, e) => s.presidentes.filter((p) => p.presidente === pr && p.estado === e).length;
  const total = presis.map((pr) => s.presidentes.filter((p) => p.presidente === pr).length);
  const angosto = el.clientWidth < 420;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${Obs.escapar(presis[ps[0].dataIndex])}</strong>` + ps.filter((q) => q.value && q.seriesName !== "total").map((q) => `<br>${q.marker}${q.seriesName}: <strong>${q.value}</strong>`).join("") +
        `<br>Total: <strong>${total[ps[0].dataIndex]}</strong>` },
    grid: { left: angosto ? 84 : 168, right: 40, top: 4, bottom: 28 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: presis.map((x) => (angosto ? x.split(" ").at(-1) : x)), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      triggerEvent: true, axisLabel: { ...txt({ color: C.texto }), formatter: (v, i) => (presis[i] === estado.presidente ? `{b|${v}}` : v), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
    series: [
      ...ESTADOS.map((e) => ({
        name: e.nombre, type: "bar", stack: "t", barWidth: 18, cursor: "pointer",
        itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 1 },
        data: presis.map((pr) => ({ value: cuenta(pr, e.clave) || null, itemStyle: { opacity: estado.presidente && pr !== estado.presidente ? 0.3 : 1 } })),
      })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, tooltip: { show: false }, itemStyle: { color: "transparent" }, data: presis.map(() => 0),
        label: { show: true, position: "right", formatter: (q) => String(total[q.dataIndex]), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
  g.off("click");
  const etiquetas = presis.map((x) => (angosto ? x.split(" ").at(-1) : x));
  g.on("click", (q) => {
    const pr = q.componentType === "yAxis" ? presis[etiquetas.indexOf(q.value)] : presis[q.dataIndex];
    if (pr) actualizar({ presidente: pr === estado.presidente ? "" : pr });
  });
}

/* ---------- Bancadas que firmaron más pedidos ---------- */
function porBancada(s) {
  const cuenta = new Map();
  s.bancadas.forEach((p) => p.bancadas.forEach((b) => cuenta.set(b, (cuenta.get(b) ?? 0) + 1)));
  Obs.barras("g-bancadas", [...cuenta].map(([b, v]) => ({ clave: b, etiqueta: cortoBancada(b), valor: v })), {
    formato: (v) => Obs.fmtN(v), nombre: "Pedidos firmados", limite: 15,
    seleccion: estado.bancada ? new Set([estado.bancada]) : null, alClic: (b) => actualizar({ bancada: b === estado.bancada ? "" : b }),
  });
  document.getElementById("d-bancadas").textContent = (estado.presidente ? `Pedidos contra ${estado.presidente}` : "Pedidos") +
    ` que cada bancada firmó${cuenta.size > 15 ? " (las 15 con más pedidos)" : ""}.`;
}

/* ---------- Tabla ---------- */
function tabla(s) {
  const el = document.getElementById("t-pedidos");
  if (!s.elegidos.length) { el.innerHTML = '<p class="pista">No hay pedidos para esta selección.</p>'; return; }
  const filas = [...s.elegidos].reverse().map((p) => `<tr>
      <td class="doc">${Obs.escapar(p.doc)}</td><td>${Obs.escapar(p.presidente)}</td>
      <td class="fecha">${fmtFecha(p.pres)}</td><td class="fecha">${fmtFecha(p.adm)}</td><td class="fecha">${fmtFecha(p.vac)}</td>
      <td><span class="estado"><i style="background:${C.estado[p.estado]}"></i><span>${NOMBRE_ESTADO[p.estado]}${p.detalle ? `<small>${Obs.escapar(p.detalle)}</small>` : ""}</span></span></td>
      <td class="autores">${Obs.escapar(p.autores)}</td></tr>`).join("");
  el.innerHTML = `<table class="tabla"><thead><tr><th>Pedido</th><th>Presidente</th><th>Presentado</th><th>Admisión</th><th>Vacancia</th><th>Resultado</th><th>Firmado por</th></tr></thead><tbody>${filas}</tbody></table>`;
  document.getElementById("t-tabla").textContent = s.elegidos.length === 1 ? "El pedido" : `Los ${s.elegidos.length} pedidos, uno por uno`;
}

/* ---------- Controles ---------- */
const $ = (q) => document.querySelector(q);
function render() {
  $("#f-presidente").value = estado.presidente;
  $("#f-bancada").value = estado.bancada;
  const s = filtrar(PEDIDOS, estado);
  cifras(s);
  lineaTiempo(s);
  porPresidente(s);
  porBancada(s);
  tabla(s);
  Obs.escribirURL({ presidente: estado.presidente || null, bancada: estado.bancada || null });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  C = { ...Obs.tema(), estado: Object.fromEntries(ESTADOS.map((e) => [e.clave, css.getPropertyValue(e.css).trim()])) };

  // Una fila por pedido y bancada: se junta en un pedido con el conjunto de sus bancadas
  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " ").replace(/\.$/, ""));
  const formas = new Map(); // nombre de bancada en minúsculas -> forma más usada
  const filas = Obs.expandir(datos.tablas.General);
  const usos = new Map();
  filas.forEach((f) => { const b = limpio(f["Bancada proponentes"]); if (b) usos.set(b, (usos.get(b) ?? 0) + 1); });
  [...usos].sort((a, b) => b[1] - a[1]).forEach(([b]) => { if (!formas.has(b.toLowerCase())) formas.set(b.toLowerCase(), b); });
  const porN = new Map();
  for (const f of filas) {
    const k = f.N;
    if (!porN.has(k)) {
      const res = limpio(f.Resultado);
      const est = clasificar(res);
      porN.set(k, { n: k, doc: limpio(f.Documento), presidente: limpio(f.Presidente), autores: limpio(f.Autores),
        pres: fecha(f["Presentación"]), adm: fecha(f["Admisión"]), vac: fecha(f.Vacancia), estado: est,
        detalle: est === "suspendida" ? res.replace(/^Admisión aprobada\.\s*/i, "") : "", bancadas: new Set() });
    }
    const b = limpio(f["Bancada proponentes"]);
    if (b) porN.get(k).bancadas.add(formas.get(b.toLowerCase()));
  }
  PEDIDOS = [...porN.values()].filter((p) => p.pres).sort((a, b) => a.pres - b.pres || a.n - b.n);
  PRESIDENTES = [...new Set(PEDIDOS.map((p) => p.presidente))];
  BANCADAS = [...new Set(PEDIDOS.flatMap((p) => [...p.bancadas]))].sort((a, b) => a.localeCompare(b, "es"));

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? fmtFechaLarga(new Date(Date.UTC(aa, mm - 1, dd))) : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-presidente").innerHTML = opcion("", "Todos los presidentes") + PRESIDENTES.map((x) => opcion(x, x)).join("");
  $("#f-bancada").innerHTML = opcion("", "Todas las bancadas") + BANCADAS.map((x) => opcion(x, x)).join("");
  $("#f-presidente").onchange = (e) => actualizar({ presidente: e.target.value });
  $("#f-bancada").onchange = (e) => actualizar({ bancada: e.target.value });

  const p = Obs.parametros();
  const pr = PRESIDENTES.find((x) => x.toLowerCase() === (p.get("presidente") || "").toLowerCase());
  const ba = BANCADAS.find((x) => x.toLowerCase() === (p.get("bancada") || "").toLowerCase());
  if (pr) estado.presidente = pr;
  if (ba) estado.bancada = ba;

  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
