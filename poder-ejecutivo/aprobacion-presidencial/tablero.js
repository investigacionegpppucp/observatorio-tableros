/* =========================================================
   Tablero de Aprobación presidencial — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, exportado desde Sheets por el Apps Script
   (apps-script/exportar-json/). Tabla «Aprobación»: una fila por
   mes con Periodo (AAAA-MM-01), Gobierno, Aprobacion_presidente,
   Desaprobacion_presidente, No sabe_presidente (proporciones 0-1),
   Premier, Tipo de encuesta y Fuente (enlace a la encuesta).

   Patrón: un objeto `estado`, una función pura `filtrar()` y una
   sola función `render()`. Los controles solo cambian `estado`.

   Parámetros de URL:
     ?gobierno=Toledo&desde=2001&hasta=2006&mes=2004-05&serie=ambas
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "aprobacion-presidencial";
const ARCHIVOS = [{ clave: "aprobacion_presidencial", etiqueta: "Aprobación presidencial mensual (1985-2026)" }];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const estado = { gobierno: null, desde: null, hasta: null, mes: null, serie: "aprobacion" };

let FILAS = [], GOBIERNOS = [], ANIOS = [];
let C; // colores, leídos de tema.css al arrancar

/* ---------- Formato ---------- */
const pct = (v) => Obs.fmtPct(v, 1);
const puntos = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Obs.fmtN(Math.abs(v * 100), 1)}`;
const mesLargo = (f) => `${MESES[f.mes]} de ${f.anio}`;
const mesMayus = (f) => mesLargo(f).replace(/^./, (c) => c.toUpperCase());
const mesCorto = (f) => `${MESES_CORTOS[f.mes]} ${f.anio}`;
const anios = (g) => (g.desde.anio === g.hasta.anio ? `${g.desde.anio}` : `${g.desde.anio}-${g.hasta.anio}`);
const promedio = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const txt = (x = {}) => ({ fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, ...x });

/* ---------- Datos ----------
   La tabla viene en columnas con los nombres de la hoja; aquí se pasa a
   filas con nombres cortos. «No precisa» se redondea porque en la hoja
   es 1 - aprobación - desaprobación (arrastra decimales de más). */
function preparar(tabla) {
  const r2 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  FILAS = Obs.expandir(tabla).map((f) => {
    const [a, m] = f.Periodo.split("-").map(Number);
    return {
      clave: f.Periodo.slice(0, 7), anio: a, mes: m - 1, gobierno: f.Gobierno,
      aprob: f.Aprobacion_presidente, desaprob: f.Desaprobacion_presidente, noPrecisa: r2(f["No sabe_presidente"]),
      premier: (f.Premier || "").trim(), tipo: f["Tipo de encuesta"], fuente: typeof f.Fuente === "string" && /^https?:/.test(f.Fuente) ? f.Fuente : null,
    };
  }).sort((x, y) => x.clave.localeCompare(y.clave));
  FILAS.forEach((f, i) => (f.i = i));
  // Gobiernos en orden cronológico; el nombre es la clave
  for (const f of FILAS) {
    const g = GOBIERNOS.at(-1);
    if (g && g.nombre === f.gobierno) g.hasta = f;
    else GOBIERNOS.push({ nombre: f.gobierno, desde: f, hasta: f });
  }
  ANIOS = [...new Set(FILAS.map((f) => f.anio))];
}
const gobierno = (nombre) => GOBIERNOS.find((g) => g.nombre === nombre) ?? null;

/* Cada gráfico usa el subconjunto que ignora su propio filtro:
   la serie mensual se recorta al gobierno elegido; los promedios
   por gobierno, no (resaltan el elegido). */
function filtrar(e) {
  const enPeriodo = FILAS.filter((f) => f.anio >= e.desde && f.anio <= e.hasta);
  const meses = e.gobierno ? enPeriodo.filter((f) => f.gobierno === e.gobierno) : enPeriodo;
  const porGobierno = GOBIERNOS.map((g) => {
    const fs = enPeriodo.filter((f) => f.gobierno === g.nombre);
    return { ...g, n: fs.length, aprob: promedio(fs.map((f) => f.aprob)), desaprob: promedio(fs.map((f) => f.desaprob)), noPrecisa: promedio(fs.map((f) => f.noPrecisa)) };
  }).filter((g) => g.n);
  const mes = meses.find((f) => f.clave === e.mes) ?? meses.at(-1) ?? null;
  return { meses, porGobierno, mes };
}

/* =========== Render =========== */
function render() {
  sincronizarControles();
  const s = filtrar(estado);
  const g = gobierno(estado.gobierno);
  const alcance = g ? `el gobierno de ${g.nombre}` : estado.desde === estado.hasta ? `${estado.desde}` : `${estado.desde}-${estado.hasta}`;

  resumen(s, g);
  cifras(s, g);
  evolucion(s, g);
  gobiernos(s);
  ficha(s);

  document.getElementById("d-evol").textContent = s.meses.length
    ? `Porcentaje de personas encuestadas, de ${mesLargo(s.meses[0])} a ${mesLargo(s.meses.at(-1))}.` : "";
  document.getElementById("d-gobiernos").textContent = g
    ? `Promedio de cada gobierno en ${estado.desde === estado.hasta ? estado.desde : `${estado.desde}-${estado.hasta}`}. Resaltado: ${g.nombre}.`
    : `Promedio de sus meses en ${alcance}. El más reciente arriba.`;

  Obs.escribirURL({
    gobierno: estado.gobierno, mes: estado.mes,
    desde: estado.desde === ANIOS[0] ? null : estado.desde, hasta: estado.hasta === ANIOS.at(-1) ? null : estado.hasta,
    serie: estado.serie === "ambas" ? "ambas" : null,
  });
}

function resumen(s, g) {
  const el = document.getElementById("resumen");
  if (!s.meses.length) { el.textContent = `${g ? g.nombre : "Este período"} no tiene mediciones entre ${estado.desde} y ${estado.hasta}. Amplía el período o elige otro gobierno.`; return; }
  const a = promedio(s.meses.map((f) => f.aprob)), d = promedio(s.meses.map((f) => f.desaprob));
  const ult = s.meses.at(-1);
  if (g) {
    el.innerHTML = `Durante el gobierno de ${Obs.escapar(g.nombre)} (${mesLargo(s.meses[0])} a ${mesLargo(ult)}), en promedio
      <strong>${pct(a)}</strong> aprobó su gestión${d != null ? ` y <strong>${pct(d)}</strong> la desaprobó` : ""}.`;
  } else {
    const n = new Set(s.meses.map((f) => f.gobierno)).size;
    el.innerHTML = `Entre ${mesLargo(s.meses[0])} y ${mesLargo(ult)} el Perú tuvo <strong>${n} ${n === 1 ? "gobierno" : "gobiernos"}</strong>.
      En la última medición, de ${mesLargo(ult)}, <strong>${pct(ult.aprob)}</strong> aprobaba la gestión de ${Obs.escapar(ult.gobierno)}.`;
  }
}

function cifras(s, g) {
  if (!s.meses.length) { ["k-promedio", "k-maximo", "k-minimo"].forEach((id) => Obs.kpi(id, { etiqueta: "", valor: "—" })); return; }
  const max = s.meses.reduce((m, f) => (f.aprob > m.aprob ? f : m));
  const min = s.meses.reduce((m, f) => (f.aprob < m.aprob ? f : m));
  const quien = (f) => (g ? mesLargo(f) : `${f.gobierno}, ${mesLargo(f)}`);
  Obs.kpi("k-promedio", { etiqueta: g ? `Aprobación promedio de ${g.nombre}` : "Aprobación promedio", valor: pct(promedio(s.meses.map((f) => f.aprob))), pie: `${Obs.fmtN(s.meses.length)} ${s.meses.length === 1 ? "mes" : "meses"} con encuesta` });
  Obs.kpi("k-maximo", { etiqueta: "Aprobación más alta", valor: pct(max.aprob), pie: quien(max) });
  Obs.kpi("k-minimo", { etiqueta: "Aprobación más baja", valor: pct(min.aprob), pie: quien(min) });
}

/* ---------- Serie mensual con franjas por gobierno ---------- */
// Rótulos del eje: tantos como quepan. Con muchos años, enero de cada N años; con pocos, cada N meses.
function intervaloEje(meses, ancho) {
  const porMes = ancho / Math.max(meses.length, 1);
  if (meses.length > 36) {
    const paso = [1, 2, 5, 10].find((p) => p * 12 * porMes >= 52) ?? 10;
    return { etiqueta: (f) => String(f.anio), mostrar: (f) => f.mes === 0 && f.anio % paso === 0 };
  }
  const paso = [1, 2, 3, 6, 12].find((p) => p * porMes >= 74) ?? 12;
  return { etiqueta: mesCorto, mostrar: (f, i) => i % paso === 0 };
}

function evolucion(s, g) {
  const id = "g-evol";
  const ambas = estado.serie === "ambas";
  document.getElementById("ley-evol").innerHTML = ambas
    ? `<span><i class="l" style="border-color:${C.aprob}"></i>Aprobación</span><span><i class="l" style="border-color:${C.desaprob}"></i>Desaprobación</span>` : "";
  if (!s.meses.length) return Obs.vacio(id, "Sin mediciones en este período");

  const el = document.getElementById(id);
  const angosto = el.clientWidth < 600;
  const izq = 48, der = 16;
  const anchoUtil = el.clientWidth - izq - der;
  const eje = intervaloEje(s.meses, anchoUtil);
  const claves = s.meses.map((f) => f.clave);

  // Franjas: una por gobierno visible, alternando un fondo muy suave; el nombre arriba si cabe
  const tramos = [];
  for (const f of s.meses) {
    const t = tramos.at(-1);
    if (t && t.nombre === f.gobierno) { t.hasta = f.clave; t.n++; } else tramos.push({ nombre: f.gobierno, desde: f.clave, hasta: f.clave, n: 1 });
  }
  const franjas = tramos.map((t, k) => {
    const ancho = (t.n / s.meses.length) * anchoUtil;
    const cabe = !angosto && ancho >= t.nombre.length * 8 + 10;
    return [{ xAxis: t.desde, name: t.nombre, itemStyle: { color: k % 2 ? "rgba(4,35,85,0)" : "rgba(4,35,85,0.045)" },
      label: { show: cabe, position: "insideTop", distance: 6, ...txt({ color: C.texto, fontWeight: 700 }) } }, { xAxis: t.hasta }];
  });

  const elegido = s.mes;
  const serieLinea = (nombre, campo, color, extra = {}) => ({
    name: nombre, type: "line", data: s.meses.map((f) => f[campo]), connectNulls: true,
    symbol: "circle", symbolSize: 7, showSymbol: s.meses.length <= 72,
    lineStyle: { width: 2, color }, itemStyle: { color, borderColor: "#fff", borderWidth: 1.5 },
    emphasis: { focus: "none", scale: 1.4 }, ...extra,
  });
  const marcaMes = elegido ? {
    silent: true, symbol: "none", animation: false,
    lineStyle: { color: C.navy, type: "solid", width: 1.5 },
    label: { show: false }, data: [{ xAxis: elegido.clave }],
  } : undefined;

  const gr = Obs.grafico(id);
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: {
      ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.navy, width: 1, type: "dashed" } },
      formatter: (ps) => {
        const f = s.meses[ps[0].dataIndex];
        return `<strong>${mesMayus(f)}</strong><br>Gobierno: ${Obs.escapar(f.gobierno)}` +
          `<br><span style="color:#b4c6fa">●</span> Aprobación: <strong>${pct(f.aprob)}</strong>` +
          (ambas || f.desaprob != null ? `<br><span style="color:#f19bb0">●</span> Desaprobación: <strong>${pct(f.desaprob)}</strong>` : "");
      },
    },
    grid: { left: izq, right: der, top: 34, bottom: 34 },
    xAxis: {
      type: "category", data: claves, boundaryGap: false,
      axisLine: { lineStyle: { color: C.linea } }, axisTick: { show: false },
      axisLabel: txt({ interval: (i) => eje.mostrar(s.meses[i], i), formatter: (v, i) => eje.etiqueta(s.meses[i]), hideOverlap: false }),
    },
    yAxis: { type: "value", min: 0, max: 1, interval: 0.2, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => `${Math.round(v * 100)} %` }) },
    series: [
      serieLinea("Aprobación", "aprob", C.aprob, {
        areaStyle: ambas ? undefined : { color: "rgba(58,95,205,0.10)" },
        markArea: { silent: true, data: franjas },
        markLine: marcaMes,
        markPoint: elegido ? { silent: true, symbol: "circle", symbolSize: 12, animation: false, itemStyle: { color: C.aprob, borderColor: "#fff", borderWidth: 2.5 }, label: { show: false },
          data: [{ coord: [elegido.clave, elegido.aprob] }] } : undefined,
      }),
      ...(ambas ? [serieLinea("Desaprobación", "desaprob", C.desaprob)] : []),
    ],
  }, true);

  // Un clic en cualquier parte del área del gráfico elige el mes más cercano
  const zr = gr.getZr();
  zr.off("click");
  zr.on("click", (ev) => {
    if (!gr.containPixel({ gridIndex: 0 }, [ev.offsetX, ev.offsetY])) return;
    const i = Math.round(gr.convertFromPixel({ xAxisIndex: 0 }, ev.offsetX));
    const f = s.meses[Math.max(0, Math.min(s.meses.length - 1, i))];
    if (f) actualizar({ mes: f.clave });
  });
  el.setAttribute("aria-label", `Aprobación presidencial mensual${g ? ` durante el gobierno de ${g.nombre}` : ""}, de ${mesLargo(s.meses[0])} a ${mesLargo(s.meses.at(-1))}. ` +
    `Última medición: ${pct(s.meses.at(-1).aprob)}.`);
}

/* ---------- Promedio por gobierno: barras 100 % apiladas ---------- */
function gobiernos(s) {
  const id = "g-gobiernos";
  const datos = [...s.porGobierno].reverse(); // el más reciente arriba
  if (!datos.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const angosto = el.clientWidth < 480;
  el.style.height = `${datos.length * 46 + 16}px`;
  const gr = Obs.grafico(id);
  gr.resize();
  const izq = angosto ? 104 : 128;
  const sel = estado.gobierno;
  const opacidad = (g) => (sel && g.nombre !== sel ? 0.28 : 1);
  // Rótulo dentro del tramo solo si cabe («57,0 %» ocupa unos 48 px)
  const anchoBarra = el.clientWidth - izq - 12;
  const rotulo = (v, claro) => ({
    show: v != null && v * anchoBarra >= 54, position: "inside", formatter: (p) => pct(p.value),
    ...txt({ color: claro ? "#fff" : C.texto, fontWeight: 700 }),
  });
  const tramo = (nombre, campo, color, claro) => ({
    name: nombre, type: "bar", stack: "total", barWidth: 22, cursor: "pointer",
    // los gobiernos atenuados van sin rótulo: el texto no se lee sobre el color pálido
    data: datos.map((g) => ({ value: g[campo], itemStyle: { color, opacity: opacidad(g) }, label: rotulo(opacidad(g) < 1 ? null : g[campo], claro) })),
  });

  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: {
      ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => {
        const g = datos[ps[0].dataIndex];
        return `<strong>${Obs.escapar(g.nombre)}</strong> (${anios(g)})<br>Aprobación: <strong>${pct(g.aprob)}</strong>` +
          (g.desaprob != null ? `<br>Desaprobación: <strong>${pct(g.desaprob)}</strong><br>No precisa: <strong>${pct(g.noPrecisa)}</strong>` : "<br>Sin datos de desaprobación") +
          `<br>${g.n} ${g.n === 1 ? "mes" : "meses"} con encuesta`;
      },
    },
    grid: { left: izq, right: 12, top: 4, bottom: 4 },
    xAxis: { type: "value", min: 0, max: 1, show: false },
    yAxis: {
      type: "category", inverse: true, data: datos.map((g) => g.nombre),
      axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, triggerEvent: true,
      axisLabel: {
        formatter: (v, i) => `{n|${v}}\n{a|${anios(datos[i])}}`,
        rich: {
          n: txt({ color: C.texto, fontWeight: 700, lineHeight: 18 }),
          a: txt({ lineHeight: 18 }),
        },
      },
    },
    series: [tramo("Aprobación", "aprob", C.aprob, true), tramo("Desaprobación", "desaprob", C.desaprob, true), tramo("No precisa", "noPrecisa", C.noPrecisa, false)],
  }, true);
  gr.off("click");
  // un clic en una barra o en el nombre del gobierno lo elige
  gr.on("click", (p) => elegirGobierno(p.componentType === "yAxis" ? p.value : datos[p.dataIndex].nombre));
}

/* ---------- Ficha del mes elegido ---------- */
function ficha(s) {
  const f = s.mes;
  const $ = (id) => document.getElementById(id);
  if (!f) {
    $("t-mes").textContent = "Sin mediciones";
    $("d-mes").textContent = "Amplía el período para ver una encuesta.";
    $("reparto").innerHTML = $("datos-mes").innerHTML = "";
    $("mes-anterior").disabled = $("mes-siguiente").disabled = true;
    return;
  }
  $("t-mes").textContent = `Encuesta de ${mesLargo(f)}`;
  $("d-mes").textContent = f === s.meses.at(-1) && !estado.mes ? "La más reciente del período. Elige otro mes en el gráfico." : "Mes elegido en el gráfico.";
  const fila = (nombre, v, color) => `<div class="reparto-fila"><span>${nombre}</span>
    <span class="reparto-barra"><i style="width:${(v ?? 0) * 100}%;background:${color}"></i></span><b>${pct(v)}</b></div>`;
  $("reparto").innerHTML = fila("Aprobación", f.aprob, C.aprob) +
    (f.desaprob != null ? fila("Desaprobación", f.desaprob, C.desaprob) + fila("No precisa", f.noPrecisa, C.noPrecisa)
      : `<p class="sin-dato">Sin datos de desaprobación para este mes.</p>`);

  const previo = FILAS[f.i - 1];
  const cambio = previo && previo.aprob != null ? f.aprob - previo.aprob : null;
  const dato = (dt, dd) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  $("datos-mes").innerHTML =
    dato("Gobierno", Obs.escapar(f.gobierno)) +
    (f.premier ? dato("Presidente del Consejo de Ministros", Obs.escapar(f.premier)) : "") +
    (cambio != null ? dato(`Frente a ${mesLargo(previo)}`, cambio === 0 ? "Sin cambio" : `${puntos(cambio)} puntos de aprobación`) : "") +
    (f.tipo ? dato("Muestra", f.tipo === "Lima" ? "Lima Metropolitana" : "Nacional") : "") +
    (f.fuente ? dato("Fuente", `<a href="${Obs.escapar(f.fuente)}" target="_blank" rel="noopener">Ver la encuesta</a>`) : "");

  const k = s.meses.indexOf(f);
  $("mes-anterior").disabled = k <= 0;
  $("mes-siguiente").disabled = k >= s.meses.length - 1;
  $("mes-anterior").onclick = () => actualizar({ mes: s.meses[k - 1].clave });
  $("mes-siguiente").onclick = () => actualizar({ mes: s.meses[k + 1].clave });
}

/* =========== Controles =========== */
function sincronizarControles() {
  document.getElementById("f-gobierno").value = estado.gobierno ?? "";
  document.getElementById("f-desde").value = estado.desde;
  document.getElementById("f-hasta").value = estado.hasta;
  document.querySelectorAll("[data-serie]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.serie === estado.serie));
}

function actualizar(parche) {
  Object.assign(estado, parche);
  render();
}
// Al elegir un gobierno, el período se amplía si no lo cubre entero; el mes elegido vuelve al último
function elegirGobierno(nombre) {
  const g = gobierno(nombre === estado.gobierno ? null : nombre);
  if (!g) return actualizar({ gobierno: null, mes: null });
  actualizar({ gobierno: g.nombre, mes: null, desde: Math.min(estado.desde, g.desde.anio), hasta: Math.max(estado.hasta, g.hasta.anio) });
}

function montarControles() {
  const op = (v, t) => `<option value="${Obs.escapar(v)}">${Obs.escapar(t)}</option>`;
  const fg = document.getElementById("f-gobierno");
  fg.innerHTML = op("", "Todos los gobiernos") + [...GOBIERNOS].reverse().map((g) => op(g.nombre, `${g.nombre} (${anios(g)})`)).join("");
  fg.onchange = (e) => elegirGobierno(e.target.value || estado.gobierno);
  const fd = document.getElementById("f-desde"), fh = document.getElementById("f-hasta");
  fd.innerHTML = fh.innerHTML = ANIOS.map((a) => op(a, a)).join("");
  // si «desde» queda después de «hasta», se corre el otro extremo
  fd.onchange = (e) => { const d = +e.target.value; actualizar({ desde: d, hasta: Math.max(d, estado.hasta), mes: null }); };
  fh.onchange = (e) => { const h = +e.target.value; actualizar({ hasta: h, desde: Math.min(h, estado.desde), mes: null }); };
  document.querySelectorAll("[data-serie]").forEach((b) => (b.onclick = () => actualizar({ serie: b.dataset.serie })));
}

function leerURL() {
  const p = Obs.parametros();
  const g = gobierno(p.get("gobierno"));
  const anio = (k, def) => { const v = +p.get(k); return ANIOS.includes(v) ? v : def; };
  Object.assign(estado, { desde: anio("desde", ANIOS[0]), hasta: anio("hasta", ANIOS.at(-1)) });
  if (estado.desde > estado.hasta) [estado.desde, estado.hasta] = [estado.hasta, estado.desde];
  if (g) Object.assign(estado, { gobierno: g.nombre, desde: Math.min(estado.desde, g.desde.anio), hasta: Math.max(estado.hasta, g.hasta.anio) });
  if (FILAS.some((f) => f.clave === p.get("mes"))) estado.mes = p.get("mes");
  if (p.get("serie") === "ambas") estado.serie = "ambas";
}

Obs.iniciar(TABLERO, async () => {
  const D = await Obs.cargarJSON("datos.json");
  const t = Obs.tema();
  C = { ...t, aprob: t.categorias[0], desaprob: t.categorias[1], noPrecisa: t.otros };
  preparar(D.tablas["Aprobación"]);
  document.getElementById("subtitulo").textContent =
    `Cuántos peruanos aprueban la gestión del presidente, mes a mes, de ${ANIOS[0]} a ${ANIOS.at(-1)}.`;
  const [a, m, d] = (D.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? `${d} de ${MESES[m - 1]} de ${a}` : "—";

  montarControles();
  leerURL();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
