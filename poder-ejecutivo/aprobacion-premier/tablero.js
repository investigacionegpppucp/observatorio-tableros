/* =========================================================
   Tablero de Aprobación del presidente del Consejo de Ministros
   (premier) — Observatorio para la Democracia y Gobernabilidad
   (EGPP-PUCP)

   Datos: datos.json, exportado desde el Sheet de aprobación con el
   Apps Script (Tableros > Publicar tableros). Una tabla,
   «Aprobación», con una fila por mes: Periodo (AAAA-MM-01),
   Gobierno, Premier, Aprobacion_premier, Desaprobacion_premier,
   No sabe_premier y Aprobacion_presidente (proporciones de 0 a 1).
   El tablero usa solo las dos aprobaciones.
   La aprobación del premier se mide desde 1999; las filas
   anteriores (solo presidente) no se usan aquí.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`.

   Parámetros de URL:
     ?gobierno=Toledo&desde=2001&hasta=2006&presidente=1
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "aprobacion-premier";
const ARCHIVOS = [{ clave: "aprobacion_premier_base", etiqueta: "Aprobación del premier y del presidente (mensual)" }];

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const MESES_C = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const estado = { gobierno: "", desde: null, hasta: null, presidente: false };

let FILAS = [], GOBIERNOS = [], ANIOS = [], C;
const POR_T = new Map();

const mesLargo = (f) => `${MESES[f.mes]} de ${f.anio}`;
const mesCorto = (f) => `${MESES_C[f.mes]} ${f.anio}`;
const pct = (v) => Obs.fmtPct(v, 0);
const puntos = (v) => `${Obs.fmtN(Math.abs(v * 100), 0)} ${Math.abs(Math.round(v * 100)) === 1 ? "punto" : "puntos"}`;
const promedio = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const medidas = (filas) => filas.filter((f) => f.ap != null);
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });

/* Agrupa filas consecutivas con la misma clave (gobierno o premier) en tramos */
function tramos(filas, clave) {
  const out = [];
  for (const f of filas) {
    const k = clave(f), ult = out.at(-1);
    if (ult && ult.clave === k) ult.filas.push(f);
    else out.push({ clave: k, filas: [f] });
  }
  return out;
}

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(filas, e) {
  const enPeriodo = (f) => f.anio >= e.desde && f.anio <= e.hasta;
  const enGob = (f) => !e.gobierno || f.gob === e.gobierno;
  return {
    elegidas: filas.filter((f) => enPeriodo(f) && enGob(f)),
    // las barras por gobierno ignoran el gobierno elegido (y el período que este fija)
    periodo: e.gobierno ? filas : filas.filter(enPeriodo),
  };
}

/* ---------- Cifras clave y resumen ---------- */
function cifras(filas) {
  const m = medidas(filas);
  const elResumen = document.getElementById("resumen");
  if (!m.length) {
    elResumen.textContent = "No hay mediciones de la aprobación del premier en esta selección. Prueba con otro período o gobierno.";
    ["k-ultima", "k-promedio", "k-max", "k-min"].forEach((id) => Obs.kpi(id, { etiqueta: "", valor: "—" }));
    return;
  }
  const premiers = tramos(m, (f) => `${f.gob}|${f.premier}`).length;
  const ap = promedio(m.map((f) => f.ap));
  // comparación justa: solo los meses con las dos mediciones
  const ambos = m.filter((f) => f.pres != null);
  const dif = ambos.length ? promedio(ambos.map((f) => f.ap)) - promedio(ambos.map((f) => f.pres)) : null;
  const donde = estado.gobierno ? `Durante el gobierno de ${estado.gobierno}` : `Entre ${mesLargo(m[0])} y ${mesLargo(m.at(-1))}`;
  const quienes = premiers === 1 ? `el premier ${m[0].premier}` : `los ${premiers} premieres`;
  elResumen.innerHTML = `${Obs.escapar(donde)}, ${Obs.escapar(quienes)} tuvieron en promedio una aprobación de <strong>${pct(ap)}</strong>` +
    (dif == null ? "." : Math.abs(dif) < 0.005 ? ", casi igual que la del presidente en los mismos meses."
      : `, <strong>${puntos(dif)} ${dif < 0 ? "menos" : "más"}</strong> que la del presidente en los mismos meses.`);
  if (premiers === 1) elResumen.innerHTML = elResumen.innerHTML.replace("tuvieron", "tuvo");

  const ult = m.at(-1);
  Obs.kpi("k-ultima", { etiqueta: "Última medición", valor: pct(ult.ap), pie: `${Obs.escapar(ult.premier)}, ${mesCorto(ult)}` });
  Obs.kpi("k-promedio", { etiqueta: "Aprobación promedio", valor: pct(ap), pie: ambos.length ? `Presidente: ${pct(promedio(ambos.map((f) => f.pres)))}` : "" });
  const max = m.reduce((a, f) => (f.ap > a.ap ? f : a)), min = m.reduce((a, f) => (f.ap < a.ap ? f : a));
  Obs.kpi("k-max", { etiqueta: "La más alta", valor: pct(max.ap), pie: `${Obs.escapar(max.premier)}, ${mesCorto(max)}` });
  Obs.kpi("k-min", { etiqueta: "La más baja", valor: pct(min.ap), pie: `${Obs.escapar(min.premier)}, ${mesCorto(min)}` });
}

/* ---------- Serie mensual ----------
   Solo la aprobación del premier (y, si se pide, la del presidente).
   Sin nulos: el eje es de tiempo y une las mediciones. */
function serie(filas) {
  const id = "g-serie";
  const g = Obs.grafico(id);
  const el = document.getElementById(id);
  const ancho = el.clientWidth;
  const conDatos = filas.filter((f) => f.ap != null || (estado.presidente && f.pres != null));
  if (!medidas(filas).length) { document.getElementById("ley-serie").innerHTML = ""; return Obs.vacio(id); }
  const t0 = conDatos[0].t, t1 = conDatos.at(-1).t;

  const def = [
    { nombre: "Aprueba al premier", corto: "Premier", campo: "ap", color: C.premier },
  ];
  if (estado.presidente) def.push({ nombre: "Aprueba al presidente", corto: "Presidente", campo: "pres", color: C.presidente, punteada: true });
  const pares = (campo) => conDatos.filter((f) => f[campo] != null).map((f) => [f.t, f[campo]]);
  const pocos = medidas(filas).length <= 40;
  const rotulos = ancho >= 640;
  const der = rotulos ? 150 : 16;

  const valores = conDatos.flatMap((f) => def.map((d) => f[d.campo])).filter((v) => v != null);
  const tope = Math.min(1, Math.ceil((Math.max(...valores) + 0.08) * 10) / 10);

  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: {
      ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.textoSuave, type: "dashed" } },
      formatter: (ps) => {
        const f = POR_T.get(ps[0].axisValue);
        if (!f) return "";
        const fila = (d) => `<br><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${d.color};margin-right:6px"></span>${d.nombre}: <strong>${pct(f[d.campo])}</strong>`;
        return `<strong>${MESES[f.mes].charAt(0).toUpperCase() + MESES[f.mes].slice(1)} de ${f.anio}</strong><br>Gobierno de ${Obs.escapar(f.gob)}<br>Premier: ${Obs.escapar(f.premier)}` +
          def.filter((d) => f[d.campo] != null).map(fila).join("") +
          (f.ap == null ? "<br>Sin medición del premier este mes" : "");
      },
    },
    grid: { left: 52, right: der, top: 30, bottom: 34 },
    xAxis: {
      type: "time", min: t0, max: t1, axisLine: { lineStyle: { color: C.linea } }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { ...txt(), hideOverlap: true, formatter: (v) => { const d = new Date(v); return d.getUTCMonth() === 0 || pocos ? (pocos ? `${MESES_C[d.getUTCMonth()]} ${d.getUTCFullYear()}` : String(d.getUTCFullYear())) : ""; } },
      splitNumber: Math.max(3, Math.floor((ancho - 56 - der) / 90)),
    },
    yAxis: { type: "value", min: 0, max: tope, interval: 0.1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => Math.round(v * 100) + " %" }) },
    series: def.map((d, k) => ({
      name: d.nombre, type: "line", data: pares(d.campo), connectNulls: true,
      symbol: "circle", symbolSize: 8, showSymbol: pocos, z: 3 - k,
      lineStyle: { width: 2, color: d.color, type: d.punteada ? [6, 4] : "solid" }, itemStyle: { color: d.color, borderColor: "#fff", borderWidth: 2 },
      emphasis: { focus: "none" },
      endLabel: rotulos ? { show: true, formatter: (p) => `${d.corto} ${pct(p.value[1])}`, ...txt({ color: C.texto, fontWeight: 700 }) } : undefined,
    })),
  }, true);

  // Separa los rótulos finales que quedan encimados
  if (rotulos) {
    const fin = def.map((d, k) => { const p = pares(d.campo).at(-1); return p ? { k, y: g.convertToPixel({ yAxisIndex: 0 }, p[1]) } : null; }).filter(Boolean).sort((a, b) => a.y - b.y);
    const off = new Array(def.length).fill(0);
    for (let i = 1; i < fin.length; i++) {
      const prev = fin[i - 1].y + off[fin[i - 1].k];
      if (fin[i].y - prev < 20) off[fin[i].k] = prev + 20 - fin[i].y;
    }
    g.setOption({ series: def.map((_, k) => ({ endLabel: { offset: [0, off[k]] } })) });
  }

  // con una sola línea el título la nombra; la leyenda aparece al sumar la del presidente
  document.getElementById("ley-serie").innerHTML = def.length < 2 ? "" : def.map((d) =>
    `<span><i class="l${d.punteada ? " punteada" : ""}" style="border-color:${d.color}"></i>${d.nombre}</span>`).join("");
  document.getElementById("t-serie").textContent = estado.gobierno
    ? `Aprobación del premier en el gobierno de ${estado.gobierno}` : "Aprobación del premier, mes a mes";
  document.getElementById("d-serie").textContent = `Porcentaje de personas encuestadas, de ${mesLargo(conDatos[0])} a ${mesLargo(conDatos.at(-1))}.`;
  el.setAttribute("aria-label", `${document.getElementById("t-serie").textContent}. ${document.getElementById("resumen").textContent}`);
}

/* ---------- Promedio por gobierno ----------
   Barra: aprobación promedio del premier. Punto: la del presidente en los mismos meses. */
function porGobierno(filas) {
  const id = "g-gob";
  const datos = GOBIERNOS.map((gob) => {
    const m = medidas(filas.filter((f) => f.gob === gob));
    const ambos = m.filter((f) => f.pres != null);
    return { gob, ap: promedio(m.map((f) => f.ap)), pres: ambos.length ? promedio(ambos.map((f) => f.pres)) : null, n: m.length };
  }).filter((d) => d.ap != null);
  if (!datos.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${datos.length * 36 + 44}px`;
  const g = Obs.grafico(id);
  g.resize();
  const sel = estado.gobierno;
  const tope = Math.ceil((Math.max(...datos.flatMap((d) => [d.ap, d.pres ?? 0])) + 0.05) * 10) / 10;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: {
      ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => {
        const d = datos[ps[0].dataIndex];
        return `<strong>Gobierno de ${Obs.escapar(d.gob)}</strong><br>Premier: <strong>${pct(d.ap)}</strong>` +
          (d.pres != null ? `<br>Presidente: <strong>${pct(d.pres)}</strong>` : "") + `<br>${d.n} ${d.n === 1 ? "medición" : "mediciones"}`;
      },
    },
    grid: { left: 110, right: 24, top: 4, bottom: 30 },
    xAxis: { type: "value", min: 0, max: tope, interval: el.clientWidth < 600 ? 0.2 : 0.1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => Math.round(v * 100) + " %" }) },
    yAxis: { type: "category", inverse: true, data: datos.map((d) => d.gob), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      triggerEvent: true,
      axisLabel: { ...txt({ color: C.texto }), formatter: (v) => (v === sel ? `{b|${v}}` : v), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
    series: [
      { type: "bar", barMaxWidth: 16, cursor: "pointer",
        data: datos.map((d) => ({ value: d.ap, itemStyle: { color: C.premier, borderRadius: [0, 4, 4, 0], opacity: sel && d.gob !== sel ? 0.3 : 1 } })) },
      { type: "scatter", symbolSize: 11, z: 5, cursor: "pointer",
        data: datos.map((d) => ({ value: d.pres, itemStyle: { color: C.presidente, borderColor: "#fff", borderWidth: 2, opacity: sel && d.gob !== sel ? 0.3 : 1 } })) },
    ],
  }, true);
  g.off("click");
  // clic en la barra, el punto o el nombre del gobierno
  g.on("click", (p) => elegirGobierno(p.componentType === "yAxis" ? p.value : datos[p.dataIndex].gob));
  document.getElementById("d-gob").textContent = estado.gobierno ? "Todas las mediciones." : estado.desde === estado.hasta ? `Mediciones de ${estado.desde}.` : `Mediciones entre ${estado.desde} y ${estado.hasta}.`;
  el.setAttribute("aria-label", "Aprobación promedio del premier en cada gobierno: " + datos.map((d) => `${d.gob}, ${pct(d.ap)}`).join("; ") + ".");
}

/* ---------- Tabla por premier ---------- */
function tabla(filas) {
  const el = document.getElementById("t-premiers");
  const lista = tramos(filas, (f) => `${f.gob}|${f.premier}`)
    .map((t) => ({ ...t, m: medidas(t.filas) }))
    .filter((t) => t.m.length);
  if (!lista.length) { el.innerHTML = '<p class="pista">Sin mediciones para esta selección.</p>'; return; }
  const filasHTML = lista.map((t) => {
    const ambos = t.m.filter((f) => f.pres != null);
    const desde = t.filas[0], hasta = t.filas.at(-1);
    return `<tr><td class="premier">${Obs.escapar(desde.premier)}</td><td>${Obs.escapar(desde.gob)}</td>
      <td class="suave">${mesCorto(desde)}${desde === hasta ? "" : ` a ${mesCorto(hasta)}`}</td>
      <td class="num">${t.m.length}</td><td class="num">${pct(t.m[0].ap)}</td><td class="num">${pct(t.m.at(-1).ap)}</td>
      <td class="num"><strong>${pct(promedio(t.m.map((f) => f.ap)))}</strong></td>
      <td class="num">${ambos.length ? pct(promedio(ambos.map((f) => f.pres))) : "—"}</td></tr>`;
  }).join("");
  el.innerHTML = `<table class="tabla"><thead><tr><th>Premier</th><th>Gobierno</th><th>Período</th><th class="num">Mediciones</th>
    <th class="num">Primera</th><th class="num">Última</th><th class="num">Promedio</th><th class="num">Presidente</th></tr></thead><tbody>${filasHTML}</tbody></table>`;
  document.getElementById("t-tabla").textContent = lista.length === 1 ? "El premier" : `Los ${lista.length} premieres`;
}

/* ---------- Controles ---------- */
const $ = (s) => document.querySelector(s);
function sincronizar() {
  $("#f-gobierno").value = estado.gobierno;
  $("#f-desde").value = estado.desde;
  $("#f-hasta").value = estado.hasta;
  document.querySelectorAll("[data-presidente]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.presidente === (estado.presidente ? "1" : "0"))));
}

function render() {
  sincronizar();
  const s = filtrar(FILAS, estado);
  cifras(s.elegidas);
  serie(s.elegidas);
  porGobierno(s.periodo);
  tabla(s.elegidas);
  const completo = estado.desde === ANIOS[0] && estado.hasta === ANIOS.at(-1);
  Obs.escribirURL({
    gobierno: estado.gobierno || null,
    desde: completo || estado.gobierno ? null : estado.desde,
    hasta: completo || estado.gobierno ? null : estado.hasta,
    presidente: estado.presidente ? 1 : null,
  });
}

function actualizar(parche) { Object.assign(estado, parche); render(); }

// Elegir un gobierno ajusta el período a sus años; volver a todos recupera la serie completa
function elegirGobierno(gob) {
  if (!gob || gob === estado.gobierno) return actualizar({ gobierno: "", desde: ANIOS[0], hasta: ANIOS.at(-1) });
  const f = FILAS.filter((x) => x.gob === gob);
  actualizar({ gobierno: gob, desde: f[0].anio, hasta: f.at(-1).anio });
}

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const t = Obs.tema();
  const css = getComputedStyle(document.documentElement);
  C = { ...t, premier: css.getPropertyValue("--c-premier").trim(), presidente: css.getPropertyValue("--c-presidente").trim() };

  const limpio = (s) => (s == null ? "" : String(s).trim().replace(/\s+/g, " "));
  const todas = Obs.expandir(datos.tablas["Aprobación"]).filter((f) => f.Periodo).map((f) => {
    const [a, m] = String(f.Periodo).split("-").map(Number);
    return { anio: a, mes: m - 1, t: Date.UTC(a, m - 1, 1), gob: limpio(f.Gobierno), premier: limpio(f.Premier),
      ap: f.Aprobacion_premier, pres: f.Aprobacion_presidente };
  }).sort((x, y) => x.t - y.t);
  // la serie del premier va de su primera a su última medición
  const i0 = todas.findIndex((f) => f.ap != null);
  const i1 = todas.length - 1 - [...todas].reverse().findIndex((f) => f.ap != null);
  FILAS = todas.slice(i0, i1 + 1);
  FILAS.forEach((f) => POR_T.set(f.t, f));
  GOBIERNOS = [...new Set(FILAS.map((f) => f.gob))];
  ANIOS = Array.from({ length: FILAS.at(-1).anio - FILAS[0].anio + 1 }, (_, i) => FILAS[0].anio + i);
  Object.assign(estado, { desde: ANIOS[0], hasta: ANIOS.at(-1) });

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  // Controles
  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-gobierno").innerHTML = opcion("", "Todos los gobiernos") + GOBIERNOS.map((gob) => opcion(gob, gob)).join("");
  $("#f-desde").innerHTML = $("#f-hasta").innerHTML = ANIOS.map((a) => opcion(a, a)).join("");
  $("#f-gobierno").onchange = (e) => elegirGobierno(e.target.value);
  // si "desde" queda después de "hasta", se corre el otro extremo; cambiar el período vuelve a todos los gobiernos
  $("#f-desde").onchange = (e) => { const d = +e.target.value; actualizar({ gobierno: "", desde: d, hasta: Math.max(d, estado.hasta) }); };
  $("#f-hasta").onchange = (e) => { const h = +e.target.value; actualizar({ gobierno: "", hasta: h, desde: Math.min(h, estado.desde) }); };
  document.querySelectorAll("[data-presidente]").forEach((b) => (b.onclick = () => actualizar({ presidente: b.dataset.presidente === "1" })));

  // Estado inicial desde la URL
  const p = Obs.parametros();
  if (p.get("presidente") === "1") estado.presidente = true;
  const gob = GOBIERNOS.find((x) => x.toLowerCase() === (p.get("gobierno") || "").toLowerCase());
  const desde = +p.get("desde"), hasta = +p.get("hasta");
  if (gob) { const f = FILAS.filter((x) => x.gob === gob); Object.assign(estado, { gobierno: gob, desde: f[0].anio, hasta: f.at(-1).anio }); }
  else if (ANIOS.includes(desde) || ANIOS.includes(hasta)) {
    const d = ANIOS.includes(desde) ? desde : ANIOS[0], h = ANIOS.includes(hasta) ? hasta : ANIOS.at(-1);
    Object.assign(estado, { desde: Math.min(d, h), hasta: Math.max(d, h) });
  }

  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
