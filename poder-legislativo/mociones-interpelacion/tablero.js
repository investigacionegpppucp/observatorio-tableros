/* =========================================================
   Tablero de Mociones de interpelación — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script
   (Tableros > Publicar tableros) desde la pestaña «General» del
   Sheet «6. Mociones de Interpelación». Una fila por moción y
   ministro interpelado: Número, Gobierno, Número_Moción,
   Fecha_presentación, Ministro_Interpelado, Sector, Sumilla,
   Fecha_admisión_debate y la votación de admisión, Estado_Admisión,
   Fecha_Concurrencia, Conclusión, Observación, Autor_principal,
   Bancada_autor_principal y link.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`.

   Parámetros de URL:
     ?gobierno=Dina Boluarte&sector=Interior
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "mociones-interpelacion";
const ARCHIVOS = [{ clave: "mociones_interpelacion_base", etiqueta: "Mociones de interpelación (2001-2026)" }];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const MESES_C = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
// Cómo terminó el pedido, de lo que llegó más lejos a lo que sigue abierto
const ESTADOS = [
  { clave: "realizada", nombre: "Interpelación realizada", css: "--e-realizada" },
  { clave: "rechazada", nombre: "Admisión rechazada", css: "--e-rechazada" },
  { clave: "archivada", nombre: "Archivada", css: "--e-archivada" },
  { clave: "proceso", nombre: "En proceso", css: "--e-proceso" },
];

const estado = { gobierno: "", sector: "" };

let PEDIDOS = [], GOBIERNOS = [], SECTORES = [], ANIOS = [], C;
const NOMBRE_ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.clave, e.nombre]));

const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const n = (k, uno, varios) => `${Obs.fmtN(k)} ${k === 1 ? uno : varios}`;
const negrita = (s) => `<strong>${s}</strong>`;
// Fechas: AAAA-MM-DD (Apps Script) o d/m/aaaa (Sheet copiado); «-» o vacío = sin fecha
function fecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
const fmtFecha = (d) => (d ? `${d.getUTCDate()} ${MESES_C[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—");
function clasificar(conclusion) {
  const c = conclusion.toLowerCase();
  if (c.startsWith("aprobada")) return "realizada";
  if (c.startsWith("admisión rechazada")) return "rechazada";
  if (c.startsWith("en proceso")) return "proceso";
  return "archivada";
}
// Nombres cortos para los gráficos; la tabla y el filtro usan el nombre completo
const SECTOR_CORTO = { "Presidencia del Consejo de Ministros": "Presidencia del Consejo", "Vivienda, Construcción y Saneamiento": "Vivienda",
  "Trabajo y Promoción del Empleo": "Trabajo", "Mujer y Poblaciones Vulnerables": "Mujer" };
// «Pedro Emilio Sánchez Gamarra» -> «Pedro Sánchez Gamarra» (primer nombre y dos apellidos)
const nombreCorto = (m) => { const w = m.split(" "); return w.length > 3 ? [w[0], ...w.slice(-2)].join(" ") : m; };
const renuncio = (p) => /renunci/i.test(p.observacion);

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(pedidos, e) {
  const deGob = (p) => !e.gobierno || p.gobierno === e.gobierno;
  const deSec = (p) => !e.sector || p.sector === e.sector;
  return {
    elegidos: pedidos.filter((p) => deGob(p) && deSec(p)),
    gobiernos: pedidos.filter(deSec),
    sectores: pedidos.filter(deGob),
  };
}

/* ---------- Resumen y cifras clave ---------- */
function cifras(s) {
  const p = s.elegidos;
  const el = document.getElementById("resumen");
  const cuenta = (k) => p.filter((x) => x.estado === k).length;
  const mociones = new Set(p.map((x) => x.mocion)).size;
  if (!p.length) {
    el.textContent = `No hubo pedidos de interpelación al sector ${estado.sector} durante el gobierno de ${estado.gobierno}.`;
  } else {
    const desde = p[0].fecha.getUTCFullYear(), hasta = p.at(-1).fecha.getUTCFullYear();
    const cuando = estado.gobierno ? `Durante el gobierno de ${Obs.escapar(estado.gobierno)}` : desde === hasta ? `En ${desde}` : `Entre ${desde} y ${hasta}`;
    const aQuien = estado.sector ? `a un ministro del sector ${Obs.escapar(estado.sector)}` : "a un ministro";
    const real = cuenta("realizada");
    el.innerHTML = `${cuando}, el Congreso pidió interpelar ${aQuien} ${negrita(n(p.length, "vez", "veces"))}, en ${n(mociones, "moción", "mociones")}. ` +
      (real ? `${negrita(Obs.fmtN(real))} ${real === 1 ? "terminó" : "terminaron"} en una interpelación ante el Pleno (${Obs.fmtPct(real / p.length, 0)}).`
        : "Ninguno terminó en una interpelación ante el Pleno.");
  }
  Obs.kpi("k-pedidos", { etiqueta: "Pedidos de interpelación", valor: Obs.fmtN(p.length), pie: `En ${n(mociones, "moción", "mociones")}` });
  const real = cuenta("realizada");
  Obs.kpi("k-realizadas", { etiqueta: "Interpelaciones realizadas", valor: Obs.fmtN(real), pie: p.length ? `${Obs.fmtPct(real / p.length, 0)} de los pedidos` : "" });
  Obs.kpi("k-frenadas", { etiqueta: "Archivadas o no admitidas", valor: Obs.fmtN(cuenta("archivada") + cuenta("rechazada")),
    pie: `${Obs.fmtN(cuenta("rechazada"))} rechazadas en la votación de admisión` });
  const ren = p.filter(renuncio), antes = ren.filter((x) => x.estado !== "realizada").length;
  Obs.kpi("k-renuncias", { etiqueta: "El ministro renunció", valor: Obs.fmtN(ren.length), pie: ren.length ? `${Obs.fmtN(antes)} antes de responder ante el Pleno` : "" });
}

/* ---------- Pedidos por año (columnas apiladas por resultado) ---------- */
function anual(s) {
  const id = "g-anual";
  const anios = ANIOS.map(String);
  document.getElementById("ley-anual").innerHTML = ESTADOS.map((e) => `<span><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("");
  document.getElementById("d-anual").textContent = "Pedidos de interpelación a ministros, según el año en que se presentó la moción" +
    (estado.gobierno || estado.sector ? ` (${[estado.gobierno && `gobierno de ${estado.gobierno}`, estado.sector].filter(Boolean).join(", ")}).` : ".");
  if (!s.elegidos.length) return Obs.vacio(id);
  const cuenta = (a, k) => s.elegidos.filter((p) => p.anio === +a && p.estado === k).length;
  const total = anios.map((a) => s.elegidos.filter((p) => p.anio === +a).length);
  const g = Obs.grafico(id);
  const ancho = document.getElementById(id).clientWidth;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${ps[0].name}</strong>` + ps.filter((q) => q.value && q.seriesName !== "total").map((q) => `<br>${q.marker}${q.seriesName}: <strong>${q.value}</strong>`).join("") +
        `<br>Total: <strong>${total[ps[0].dataIndex]}</strong>` },
    grid: { left: 40, right: 12, top: 28, bottom: 30 },
    xAxis: { type: "category", data: anios, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % (ancho < 600 ? 4 : 2) === 0 }) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [
      ...ESTADOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barCategoryGap: "24%",
        itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 1 }, data: anios.map((a) => cuenta(a, e.clave) || null) })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: anios.map(() => 0),
        label: { show: ancho >= 600, position: "top", formatter: (q) => (total[q.dataIndex] ? String(total[q.dataIndex]) : ""), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
}

/* ---------- Por gobierno (barras apiladas por resultado) ---------- */
function porGobierno(s) {
  const id = "g-gobiernos";
  const gobs = GOBIERNOS.filter((x) => s.gobiernos.some((p) => p.gobierno === x));
  document.getElementById("d-gobiernos").textContent = estado.sector ? `Pedidos de interpelación al sector ${estado.sector}, según cómo terminaron.` : "Pedidos de interpelación, según cómo terminaron.";
  if (!gobs.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${gobs.length * 36 + 40}px`;
  const g = Obs.grafico(id);
  g.resize();
  const cuenta = (gb, k) => s.gobiernos.filter((p) => p.gobierno === gb && p.estado === k).length;
  const total = gobs.map((gb) => s.gobiernos.filter((p) => p.gobierno === gb).length);
  const angosto = el.clientWidth < 420;
  const etiquetas = gobs.map((x) => (angosto ? x.split(" ").at(-1) : x));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${Obs.escapar(gobs[ps[0].dataIndex])}</strong>` + ps.filter((q) => q.value && q.seriesName !== "total").map((q) => `<br>${q.marker}${q.seriesName}: <strong>${q.value}</strong>`).join("") +
        `<br>Total: <strong>${total[ps[0].dataIndex]}</strong>` },
    grid: { left: angosto ? 84 : 150, right: 40, top: 4, bottom: 28 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: etiquetas, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, triggerEvent: true,
      axisLabel: { ...txt({ color: C.texto }), formatter: (v, i) => (gobs[i] === estado.gobierno ? `{b|${v}}` : v), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
    series: [
      ...ESTADOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 16, cursor: "pointer",
        itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 1 },
        data: gobs.map((gb) => ({ value: cuenta(gb, e.clave) || null, itemStyle: { opacity: estado.gobierno && gb !== estado.gobierno ? 0.3 : 1 } })) })),
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: gobs.map(() => 0),
        label: { show: true, position: "right", formatter: (q) => String(total[q.dataIndex]), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
  g.off("click");
  g.on("click", (q) => {
    const gb = q.componentType === "yAxis" ? gobs[etiquetas.indexOf(q.value)] : gobs[q.dataIndex];
    if (gb) actualizar({ gobierno: gb === estado.gobierno ? "" : gb });
  });
}

/* ---------- Sectores y ministros ---------- */
function porSector(s) {
  const cuenta = new Map();
  s.sectores.forEach((p) => cuenta.set(p.sector, (cuenta.get(p.sector) ?? 0) + 1));
  Obs.barras("g-sectores", [...cuenta].map(([k, v]) => ({ clave: k, etiqueta: SECTOR_CORTO[k] ?? k, valor: v })), {
    formato: (v) => Obs.fmtN(v), nombre: "Pedidos", seleccion: estado.sector ? new Set([estado.sector]) : null,
    alClic: (k) => actualizar({ sector: k === estado.sector ? "" : k }),
  });
  document.getElementById("d-sectores").textContent = estado.gobierno ? `Pedidos de interpelación durante el gobierno de ${estado.gobierno}.` : "Pedidos de interpelación por ministerio.";
}
function porMinistro(s) {
  const cuenta = new Map();
  s.elegidos.forEach((p) => cuenta.set(p.ministro, (cuenta.get(p.ministro) ?? 0) + 1));
  const varios = [...cuenta].filter(([, v]) => v > 1);
  document.getElementById("d-ministros").textContent = varios.length > 12 ? "Los 12 ministros con más pedidos en esta selección." : "Ministros con dos pedidos o más en esta selección.";
  if (!varios.length) return Obs.vacio("g-ministros", "Ningún ministro tuvo más de un pedido en esta selección");
  Obs.barras("g-ministros", varios.map(([k, v]) => ({ clave: k, etiqueta: nombreCorto(k), valor: v })), { formato: (v) => Obs.fmtN(v), nombre: "Pedidos", limite: 12 });
}

/* ---------- Tabla ---------- */
function tabla(s) {
  const el = document.getElementById("t-pedidos");
  if (!s.elegidos.length) { el.innerHTML = '<p class="pista">No hay pedidos para esta selección.</p>'; return; }
  const votos = (p) => (p.votos ? `${p.votos.favor ?? "—"} a favor, ${p.votos.contra ?? "—"} en contra${p.votos.abst != null ? `, ${p.votos.abst} abst.` : ""}` : "");
  const filas = [...s.elegidos].reverse().map((p) => `<tr>
      <td class="fecha">${fmtFecha(p.fecha)}</td>
      <td class="doc">${p.link ? `<a href="${Obs.escapar(p.link)}" target="_blank" rel="noopener">Moción ${Obs.escapar(p.mocion)}</a>` : `Moción ${Obs.escapar(p.mocion)}`}</td>
      <td class="ministro">${Obs.escapar(p.ministro)}<small>${Obs.escapar(p.sector)}</small></td>
      <td>${Obs.escapar(p.gobierno)}</td>
      <td><span class="estado"><i style="background:${C.estado[p.estado]}"></i><span>${NOMBRE_ESTADO[p.estado]}` +
        `${p.concurrencia ? `<small>Respondió el ${fmtFecha(p.concurrencia)}</small>` : ""}${votos(p) ? `<small>Admisión: ${votos(p)}</small>` : ""}` +
        `${p.observacion ? `<small>${Obs.escapar(p.observacion)}</small>` : ""}</span></span></td>
      <td><span class="sumilla" title="${Obs.escapar(p.sumilla)}">${Obs.escapar(p.sumilla)}</span></td></tr>`).join("");
  el.innerHTML = `<table class="tabla"><thead><tr><th>Presentada</th><th>Moción</th><th>Ministro</th><th>Gobierno</th><th>Cómo terminó</th><th>Motivo</th></tr></thead><tbody>${filas}</tbody></table>`;
  document.getElementById("t-tabla").textContent = s.elegidos.length === 1 ? "El pedido de interpelación" : `Los ${Obs.fmtN(s.elegidos.length)} pedidos de interpelación`;
}

/* ---------- Controles ---------- */
const $ = (q) => document.querySelector(q);
function render() {
  $("#f-gobierno").value = estado.gobierno;
  $("#f-sector").value = estado.sector;
  const s = filtrar(PEDIDOS, estado);
  cifras(s);
  anual(s);
  porGobierno(s);
  porSector(s);
  porMinistro(s);
  tabla(s);
  Obs.escribirURL({ gobierno: estado.gobierno || null, sector: estado.sector || null });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  C = { ...Obs.tema(), estado: Object.fromEntries(ESTADOS.map((e) => [e.clave, css.getPropertyValue(e.css).trim()])) };

  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  const numero = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  PEDIDOS = Obs.expandir(datos.tablas.General).map((f) => {
    const votos = { asist: numero(f.Asistentes_admision), favor: numero(f.A_favor_admision), contra: numero(f.En_contra_admision), abst: numero(f["Abstención_admision"]) };
    return {
      mocion: limpio(f["Número_Moción"]), gobierno: limpio(f.Gobierno), fecha: fecha(f["Fecha_presentación"]),
      ministro: limpio(f.Ministro_Interpelado), sector: limpio(f.Sector), sumilla: limpio(f.Sumilla),
      concurrencia: fecha(f.Fecha_Concurrencia), estado: clasificar(limpio(f["Conclusión"])), observacion: limpio(f["Observación"]),
      votos: votos.favor != null || votos.contra != null ? votos : null, link: /^https?:\/\//.test(limpio(f.link)) ? limpio(f.link) : "",
    };
  }).filter((p) => p.fecha).sort((a, b) => a.fecha - b.fecha);
  PEDIDOS.forEach((p) => (p.anio = p.fecha.getUTCFullYear()));
  GOBIERNOS = [...new Set(PEDIDOS.map((p) => p.gobierno))];
  SECTORES = [...new Set(PEDIDOS.map((p) => p.sector))].sort((a, b) => a.localeCompare(b, "es"));
  ANIOS = Array.from({ length: PEDIDOS.at(-1).anio - PEDIDOS[0].anio + 1 }, (_, i) => PEDIDOS[0].anio + i);

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-gobierno").innerHTML = opcion("", "Todos los gobiernos") + GOBIERNOS.map((x) => opcion(x, x)).join("");
  $("#f-sector").innerHTML = opcion("", "Todos los sectores") + SECTORES.map((x) => opcion(x, x)).join("");
  $("#f-gobierno").onchange = (e) => actualizar({ gobierno: e.target.value });
  $("#f-sector").onchange = (e) => actualizar({ sector: e.target.value });

  const p = Obs.parametros();
  const gb = GOBIERNOS.find((x) => x.toLowerCase() === (p.get("gobierno") || "").toLowerCase());
  const sc = SECTORES.find((x) => x.toLowerCase() === (p.get("sector") || "").toLowerCase());
  if (gb) estado.gobierno = gb;
  if (sc) estado.sector = sc;

  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
