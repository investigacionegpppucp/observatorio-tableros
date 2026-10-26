/* =========================================================
   Tablero de Aprobación del Congreso — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma el Apps Script «Publicar tableros» desde
   el Sheet de «Bases tableros». Una sola tabla, `Limpio`, con una fila
   por mes (enero de 2002 en adelante): Mes, Mes_2, Año, Mes-Año,
   Aprueba (% que aprueba al Congreso, de 0 a 100), Mayoría en el
   Congreso, Congreso, Presidente y Orden (a, b, c... según el gobierno).
   Fuente: Opinión Data, Ipsos Perú.

   Se elige por gobierno, por Congreso o por período; al cambiar uno, los
   otros vuelven a «todos». Patrón: un objeto `estado`, el subconjunto
   que sale de `enSub()` y una sola función `render()`.

   Parámetros de URL:
     ?gobierno=boluarte        (apellido, sin tildes)
     ?congreso=2021-2026
     ?desde=2010&hasta=2020
     &embed=1                  oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "aprobacion-parlamento";
const ARCHIVOS = [{ clave: "aprobacion_parlamento_serie", etiqueta: "Aprobación del Congreso, serie mensual" }];
const FUENTE = "Opinión Data - Resumen de Encuestas a la opinión pública - Ipsos Perú";

// Color por mayoría parlamentaria, en el orden en que aparece en la serie (el color sigue al partido).
// Los cinco primeros son los de tema.css; el sexto se validó con dataviz/validate_palette.js junto a ellos.
const COLORES_PARTIDO = ["#3a5fcd", "#c61c44", "#6f9800", "#067bc2", "#e06991", "#7e57c2"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const TOPE_Y = 60;        // eje vertical de toda la serie (0 a 60%); una selección lo ajusta a sus valores
const MESES_ESTRENO = 24; // meses que se siguen después de que empieza un Congreso
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const MES_MS = 30.4375 * 864e5;

const pct0 = (v) => (v == null ? "—" : Obs.fmtN(v) + "%");
const pct1 = (v) => (v == null ? "—" : Obs.fmtN(v, 1) + "%");
const fecha = (r) => `${r.mesNombre} de ${r.anio}`;
const media = (rs) => rs.reduce((s, r) => s + r.valor, 0) / rs.length;
const unicos = (xs) => [...new Set(xs)];
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const apellido = (nombre) => nombre.split(" ").at(-1);
const movil = () => matchMedia("(max-width: 600px)").matches;
const describir = (id, texto) => {
  const el = document.getElementById(id);
  el.setAttribute("aria-label", `${el.closest(".tarjeta")?.querySelector("h3")?.textContent ?? "Gráfico"}. ${texto}`);
};

const estado = { gobierno: null, congreso: null, desde: null, hasta: null };
let T, FILAS, ANIOS, POR_MES, PROM_TOTAL, GOBIERNOS, CONGRESOS, PARTIDOS, ESTRENOS, INICIOS_CONGRESO;

const colorPartido = (m) => COLORES_PARTIDO[PARTIDOS.indexOf(m)] ?? T.otros;
const periodoCompleto = () => estado.desde === ANIOS[0] && estado.hasta === ANIOS.at(-1);
const hayFiltro = () => !!(estado.gobierno || estado.congreso || !periodoCompleto());
const enSub = (r) => estado.gobierno ? r.orden === estado.gobierno
  : estado.congreso ? r.congreso === estado.congreso
    : r.anio >= estado.desde && r.anio <= estado.hasta;

/* Tramos consecutivos con la misma clave (p. ej., mismo Congreso y misma mayoría) */
function tramos(filas, clave) {
  const out = [];
  for (const r of filas) {
    const k = clave(r), u = out.at(-1);
    if (u && u.k === k) { u.t1 = r.t; u.filas.push(r); } else out.push({ k, t0: r.t, t1: r.t, filas: [r], r0: r });
  }
  return out;
}

/* ---------- Resumen y cifras clave ---------- */
function resumen(S) {
  const n = S.length, prom = media(S), primera = S[0], ultima = S.at(-1);
  const cuando = n === 1 ? fecha(primera) : `de ${fecha(primera)} a ${fecha(ultima)}`;
  const baja = S.filter((r) => r.valor < 10).length;
  const cmp = Math.abs(prom - PROM_TOTAL) < 0.05 ? "igual al" : prom > PROM_TOTAL ? "por encima del" : "por debajo del";
  let frase;
  if (estado.gobierno) {
    const g = GOBIERNOS.find((x) => x.orden === estado.gobierno);
    frase = `Durante el gobierno de <strong>${g.nombre}</strong> (${cuando}), la aprobación del Congreso promedió <strong>${pct1(prom)}</strong>, ${cmp} promedio de toda la serie (${pct1(PROM_TOTAL)}).`;
  } else if (estado.congreso) {
    frase = `Durante el Congreso <strong>${estado.congreso}</strong> (${cuando}), la aprobación promedió <strong>${pct1(prom)}</strong>, ${cmp} promedio de toda la serie (${pct1(PROM_TOTAL)}).`;
  } else {
    frase = `Entre ${fecha(primera)} y ${fecha(ultima)}, en promedio <strong>${pct1(prom)}</strong> de las personas encuestadas aprobó el trabajo del Congreso.`;
  }
  document.getElementById("resumen").innerHTML = frase +
    (baja ? (n === 1 ? ` Ese mes la aprobación estuvo por debajo de 10%.` : ` En ${baja} de ${n} meses la aprobación estuvo por debajo de 10%.`) : "");

  const mayor = S.reduce((a, r) => (r.valor > a.valor ? r : a)), menor = S.reduce((a, r) => (r.valor < a.valor ? r : a));
  Obs.kpi("k-ultimo", { etiqueta: "Último dato", valor: pct0(ultima.valor), pie: fecha(ultima) });
  Obs.kpi("k-prom", { etiqueta: "Promedio", valor: pct1(prom), pie: `${Obs.fmtN(n)} ${n === 1 ? "mes" : "meses"} con dato` });
  Obs.kpi("k-max", { etiqueta: "Máximo", valor: pct0(mayor.valor), pie: fecha(mayor) });
  Obs.kpi("k-min", { etiqueta: "Mínimo", valor: pct0(menor.valor), pie: fecha(menor) });
}

/* ---------- Serie mensual: una línea, con el máximo, el mínimo y el último dato rotulados, y una línea punteada donde empieza cada Congreso ---------- */
function serie(S) {
  const el = document.getElementById("g-serie");
  const g = Obs.grafico("g-serie");
  g.resize();
  const cel = movil();
  const izq = cel ? 48 : 58, der = cel ? 30 : 22, H0 = el.clientHeight - 36;
  const t0 = S[0].t, t1 = S.at(-1).t;
  const pad = t1 - t0 < 24 * MES_MS ? 3 * MES_MS : 0; // vistas cortas: aire a los lados
  const a0 = t0 - pad, a1 = t1 + pad;

  const clavePuntos = new Set();
  const mayor = S.reduce((a, r) => (r.valor > a.valor ? r : a)), menor = S.reduce((a, r) => (r.valor < a.valor ? r : a));
  const puntos = [[mayor, "top"], [menor, "bottom"], [S.at(-1), "top"]].filter(([r]) => !clavePuntos.has(r.i) && clavePuntos.add(r.i));

  const tope = S.length === FILAS.length ? TOPE_Y : Math.max(20, Math.ceil((mayor.valor + 12) / 10) * 10);
  const eje = (extra = {}) => ({ axisLine: { lineStyle: { color: T.linea } }, axisTick: { show: false }, axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14 }, splitLine: { show: false }, ...extra });
  const sobreAnios = (t1 - t0) / (365.25 * 864e5) >= 4;
  g.setOption({
    useUTC: true, animation: ANIM, animationDurationUpdate: 300, textStyle: { fontFamily: T.fuente },
    tooltip: {
      ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", snap: true, lineStyle: { color: T.navy, opacity: 0.35 } },
      formatter: (ps) => {
        const r = ps.find((p) => p.seriesType === "line")?.data?.r;
        return r ? `<strong>${r.mesNombre} de ${r.anio}</strong><br>Aprobación: <strong>${pct0(r.valor)}</strong><br>Gobierno: ${Obs.escapar(r.presidente)}<br>Congreso ${r.congreso}, mayoría ${Obs.escapar(r.mayoria)}` : "";
      },
    },
    grid: { left: izq, right: der, top: 6, height: H0 },
    xAxis: eje({ type: "time", min: a0, max: a1, splitNumber: cel ? 4 : 10,
      axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, hideOverlap: true,
        formatter: (x) => { const d = new Date(x); return sobreAnios ? String(d.getUTCFullYear()) : `${MESES_CORTOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; } } }),
    yAxis: eje({ type: "value", min: 0, max: tope, interval: 10, axisLine: { show: false }, splitLine: { lineStyle: { color: T.linea } },
      axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, formatter: (x) => `${x}%` } }),
    series: [
      {
        type: "line", z: 3, name: "Aprobación",
        data: S.map((r) => ({ value: [r.t, r.valor], r })),
        showSymbol: S.length <= 60, symbol: "circle", symbolSize: 7, lineStyle: { width: 2, color: T.unica }, itemStyle: { color: T.unica, borderColor: "#fff", borderWidth: 1.5 },
        // línea fina donde empieza cada Congreso
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { type: "dashed", color: "#9aa5b5", width: 1 },
          data: INICIOS_CONGRESO.filter((t) => t > t0 && t <= t1).map((t) => ({ xAxis: t })) },
        markPoint: {
          silent: true, symbol: "circle", symbolSize: 10, itemStyle: { color: T.unica, borderColor: "#fff", borderWidth: 2 },
          label: { show: true, formatter: (p) => pct0(p.value), color: T.texto, fontFamily: T.fuente, fontSize: 14, fontWeight: 700, textBorderColor: "#fff", textBorderWidth: 3 },
          data: puntos.map(([r, position]) => ({ coord: [r.t, r.valor], value: r.valor, label: { position } })),
        },
      },
    ],
  }, true);

  // Meses sin encuesta dentro del rango
  const faltan = [];
  for (let m = S[0].m; m <= S.at(-1).m; m++) if (!POR_MES.has(m)) faltan.push(m);
  document.getElementById("n-serie").textContent = faltan.length
    ? `${faltan.length === 1 ? "Un mes de este rango no tiene" : `${faltan.length} meses de este rango no tienen`} dato de encuesta; la línea une el mes anterior con el siguiente.`
    : "";
  document.getElementById("d-serie").textContent = hayFiltro() && S.length < FILAS.length
    ? `Porcentaje de personas que aprueba el trabajo del Congreso, de ${fecha(S[0])} a ${fecha(S.at(-1))}. El eje vertical se ajusta a esta selección.`
    : "Porcentaje de personas que aprueba el trabajo del Congreso, cada mes.";
  describir("g-serie", `Línea mensual de aprobación, de ${fecha(S[0])} a ${fecha(S.at(-1))}. Máximo ${pct0(mayor.valor)} en ${fecha(mayor)}; mínimo ${pct0(menor.valor)} en ${fecha(menor)}; último dato ${pct0(S.at(-1).valor)}.`);
}

/* ---------- Períodos del Congreso: tabla que también filtra ---------- */
function tablaCongresos() {
  const tope = 30; // la barra de la media llena su columna con 30%
  document.getElementById("t-congresos").innerHTML = `<table class="tabla"><thead><tr>
      <th>Período</th><th>Mayoría en el Congreso</th><th class="num">Aprobación media</th></tr></thead><tbody>${
    CONGRESOS.map((c) => {
      const elegido = estado.congreso === c.nombre;
      return `<tr data-congreso="${Obs.escapar(c.nombre)}"${elegido ? ' class="elegida"' : ""}>
        <td><button type="button" class="fila-boton" aria-pressed="${elegido}">${Obs.escapar(c.nombre)}</button></td>
        <td>${c.mayorias.map((m) => `<span class="partido"><i style="background:${colorPartido(m)}"></i>${Obs.escapar(m)}</span>`).join("")}</td>
        <td class="num media"><span class="barrita" style="width:${Math.round((c.media / tope) * 70)}px"></span>${pct1(c.media)}</td></tr>`;
    }).join("")}</tbody></table>`;
}

/* ---------- Los cinco meses más altos y los cinco más bajos de la selección ---------- */
function extremos(S) {
  const orden = [...S].sort((a, b) => b.valor - a.valor || a.t - b.t);
  const k = Math.min(5, Math.floor(S.length / 2)) || Math.min(1, S.length);
  const tabla = (filas) => `<table class="tabla"><thead><tr><th>Mes</th><th class="num">Aprobación</th><th>Gobierno</th></tr></thead><tbody>${
    filas.map((r) => `<tr><td>${r.mesNombre} de ${r.anio}</td><td class="num"><strong>${pct0(r.valor)}</strong></td><td>${Obs.escapar(r.presidente)}</td></tr>`).join("")}</tbody></table>`;
  const altos = orden.slice(0, k), bajos = orden.slice(-k).reverse();
  document.getElementById("t-extremos").innerHTML = k < 1 ? "" :
    `<div class="extremos-dos"><div><p class="subtabla">Mayor aprobación</p>${tabla(altos)}</div><div><p class="subtabla">Menor aprobación</p>${tabla(bajos)}</div></div>`;
  document.getElementById("d-extremos").textContent = S.length < FILAS.length
    ? `Dentro de la selección: de ${fecha(S[0])} a ${fecha(S.at(-1))}.` : "En toda la serie: los cinco meses más altos y los cinco más bajos.";
}

/* ---------- Aprobación media por gobierno ---------- */
function barrasGobiernos() {
  Obs.barras("g-gobiernos", GOBIERNOS.map((g) => ({ clave: g.orden, etiqueta: g.nombre, valor: g.media })), {
    formato: pct1, nombre: "Aprobación media", seleccion: estado.gobierno ? new Set([estado.gobierno]) : null,
    alClic: (o) => actualizar({ gobierno: o === estado.gobierno ? null : o }),
  });
  const orden = [...GOBIERNOS].sort((a, b) => b.media - a.media);
  describir("g-gobiernos", `Barras con la aprobación media de cada gobierno. Mayor: ${orden[0].nombre}, ${pct1(orden[0].media)}. Menor: ${orden.at(-1).nombre}, ${pct1(orden.at(-1).media)}.`);
}

/* ---------- Cómo empieza cada Congreso ---------- */
function estreno() {
  const cel = movil();
  const g = Obs.grafico("g-estreno");
  document.getElementById("g-estreno").style.height = cel ? "500px" : "400px";
  g.resize();
  const ks = Array.from({ length: MESES_ESTRENO + 1 }, (_, k) => k);
  const elegido = estado.congreso;
  g.setOption({
    animation: ANIM, textStyle: { fontFamily: T.fuente },
    legend: { top: 0, left: 0, icon: "rect", itemWidth: 14, itemHeight: 4, itemGap: 16, textStyle: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14 }, data: ESTRENOS.map((e) => e.nombre) },
    tooltip: {
      ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue === 0 ? "Primer mes" : `Mes ${ps[0].axisValue}`}</strong>` + ps.filter((p) => p.value != null)
        .sort((a, b) => b.value - a.value).map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct0(p.value)}</strong>`).join(""),
    },
    grid: { left: 52, right: 16, top: cel ? 160 : 56, bottom: 52 },
    xAxis: { type: "category", data: ks, name: "Meses desde que empezó el Congreso", nameLocation: "middle", nameGap: 34, nameTextStyle: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14 },
      axisTick: { show: false }, axisLine: { lineStyle: { color: T.linea } }, axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, interval: (i) => i % 3 === 0 } },
    yAxis: { type: "value", min: 0, max: 60, interval: 10, splitLine: { lineStyle: { color: T.linea } },
      axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, formatter: (v) => `${v}%` } },
    series: ESTRENOS.map((e) => {
      const color = colorPartido(e.mayoria), apagado = elegido && e.congreso !== elegido;
      return { name: e.nombre, type: "line", data: e.valores, connectNulls: true, symbol: "circle", symbolSize: 6, showSymbol: false,
        lineStyle: { width: elegido === e.congreso ? 3.5 : 2, color, opacity: apagado ? 0.25 : 1 }, itemStyle: { color }, emphasis: { focus: "series" }, cursor: "pointer" };
    }),
  }, true);
  g.off("click");
  g.on("click", (p) => { const c = ESTRENOS[p.seriesIndex]?.congreso; if (c) actualizar({ congreso: c === estado.congreso ? null : c }); });

  document.getElementById("t-estreno").innerHTML = `<table class="tabla"><thead><tr>
      <th>Congreso</th><th class="num">Mes anterior</th><th class="num">Mejor de los 3 primeros meses</th><th class="num">A los 12 meses</th></tr></thead><tbody>${
    ESTRENOS.map((e) => `<tr><td><span class="partido"><i style="background:${colorPartido(e.mayoria)}"></i><strong class="sin-corte">${e.congreso}</strong></span><small>${Obs.escapar(e.mayoria)}</small></td>
      <td class="num">${pct0(e.previo)}</td><td class="num">${pct0(e.pico)}</td><td class="num">${pct0(e.a12)}</td></tr>`).join("")}</tbody></table>`;

  const subieron = ESTRENOS.filter((e) => e.pico - e.previo >= 10);
  const cayeron = subieron.filter((e) => e.a12 != null && e.pico - e.a12 >= 10);
  document.getElementById("n-estreno").textContent =
    `En ${subieron.length} de ${ESTRENOS.length} Congresos la aprobación subió 10 puntos o más en los tres primeros meses; doce meses después, en ${cayeron.length} de ellos había bajado 10 puntos o más desde ese máximo. ` +
    ESTRENOS.filter((e) => e.pico - e.previo < 10).map((e) => { const m = Math.max(...e.valores.filter((v) => v != null)); return `En el Congreso ${e.congreso} la subida llegó después: ${pct0(m)} en el mes ${e.valores.indexOf(m)}. `; }).join("") +
    `El Congreso ${CONGRESOS[0].nombre} no aparece porque la serie empieza en ${fecha(FILAS[0])}. El mes 0 es el primer mes de la base con el nuevo Congreso.`;
  describir("g-estreno", `Líneas de aprobación en los primeros ${MESES_ESTRENO} meses de cada Congreso. ` + ESTRENOS.map((e) => `${e.congreso}: ${pct0(e.previo)} el mes anterior, ${pct0(e.pico)} como mejor mes de los tres primeros`).join("; ") + ".");
}

/* ---------- Estado, controles y arranque ---------- */
function render() {
  sincronizar();
  const S = FILAS.filter(enSub);
  resumen(S);
  serie(S);
  tablaCongresos();
  extremos(S);
  barrasGobiernos();
  estreno();
  Obs.escribirURL({
    gobierno: estado.gobierno ? GOBIERNOS.find((g) => g.orden === estado.gobierno).slug : null, congreso: estado.congreso,
    desde: periodoCompleto() || estado.gobierno || estado.congreso ? null : estado.desde,
    hasta: periodoCompleto() || estado.gobierno || estado.congreso ? null : estado.hasta,
  });
}

function actualizar(parche) {
  const completo = { desde: ANIOS[0], hasta: ANIOS.at(-1) };
  if ("gobierno" in parche) Object.assign(estado, { gobierno: parche.gobierno, congreso: null, ...completo });
  else if ("congreso" in parche) Object.assign(estado, { congreso: parche.congreso, gobierno: null, ...completo });
  else Object.assign(estado, parche, { gobierno: null, congreso: null });
  render();
}

function sincronizar() {
  document.getElementById("f-gobierno").value = estado.gobierno ?? "";
  document.getElementById("f-congreso").value = estado.congreso ?? "";
  document.getElementById("f-desde").value = estado.desde;
  document.getElementById("f-hasta").value = estado.hasta;
  document.getElementById("f-limpiar-caja").hidden = !hayFiltro();
}

Obs.iniciar(TABLERO, async () => {
  const D = await Obs.cargarJSON("datos.json");
  T = Obs.tema();

  FILAS = Obs.expandir(D.tablas.Limpio).map((f) => {
    const [a, m] = f["Mes-Año"].split("-").map(Number);
    return { t: Date.UTC(a, m - 1, 1), anio: a, mes: m, m: a * 12 + m - 1, mesNombre: f.Mes.toLowerCase(), valor: f.Aprueba,
      mayoria: f["Mayoría en el Congreso"], congreso: f.Congreso, presidente: f.Presidente, orden: f.Orden };
  }).filter((r) => r.valor != null).sort((a, b) => a.t - b.t);
  FILAS.forEach((r, i) => (r.i = i));
  POR_MES = new Map(FILAS.map((r) => [r.m, r]));
  ANIOS = Array.from({ length: FILAS.at(-1).anio - FILAS[0].anio + 1 }, (_, i) => FILAS[0].anio + i);
  PROM_TOTAL = media(FILAS);
  PARTIDOS = unicos(FILAS.map((r) => r.mayoria));

  GOBIERNOS = tramos(FILAS, (r) => r.orden).map((t) => ({ orden: t.k, nombre: t.r0.presidente, slug: sinTildes(apellido(t.r0.presidente)), desde: t.filas[0], hasta: t.filas.at(-1),
    media: media(t.filas), mayorias: unicos(t.filas.map((r) => r.mayoria)) }));
  INICIOS_CONGRESO = FILAS.filter((r, i) => i && r.congreso !== FILAS[i - 1].congreso).map((r) => r.t);
  CONGRESOS = unicos(FILAS.map((r) => r.congreso)).map((nombre) => { const rs = FILAS.filter((r) => r.congreso === nombre); return { nombre, media: media(rs), n: rs.length, mayorias: unicos(rs.map((r) => r.mayoria)) }; });

  // Cada vez que cambia el Congreso: aprobación del mes anterior, mejor mes de los tres primeros y doce meses después
  ESTRENOS = [];
  FILAS.forEach((r, i) => {
    if (!i || r.congreso === FILAS[i - 1].congreso) return;
    const valores = Array.from({ length: MESES_ESTRENO + 1 }, (_, k) => { const x = POR_MES.get(r.m + k); return x && x.congreso === r.congreso ? x.valor : null; });
    ESTRENOS.push({ congreso: r.congreso, mayoria: r.mayoria, nombre: `${r.congreso} (${r.mayoria})`, valores, previo: FILAS[i - 1].valor, pico: Math.max(...valores.slice(0, 3).filter((v) => v != null)), a12: valores[12] });
  });

  document.getElementById("fuente").textContent = D.fuente ?? FUENTE;
  document.getElementById("subtitulo").textContent =
    `Cuántas personas aprueban el trabajo del Congreso de la República, mes a mes, de ${fecha(FILAS[0])} a ${fecha(FILAS.at(-1))}.`;

  const opcion = (valor, etiqueta) => `<option value="${Obs.escapar(valor)}">${Obs.escapar(etiqueta)}</option>`;
  const $ = (id) => document.getElementById(id);
  $("f-gobierno").innerHTML = opcion("", "Todos") + GOBIERNOS.map((g) => opcion(g.orden, `${g.nombre} (${g.desde.anio === g.hasta.anio ? g.desde.anio : `${g.desde.anio}-${g.hasta.anio}`})`)).join("");
  $("f-congreso").innerHTML = opcion("", "Todos") + CONGRESOS.map((c) => opcion(c.nombre, c.nombre)).join("");
  $("f-desde").innerHTML = $("f-hasta").innerHTML = ANIOS.map((a) => opcion(a, a)).join("");
  $("f-gobierno").onchange = (e) => actualizar({ gobierno: e.target.value || null });
  $("f-congreso").onchange = (e) => actualizar({ congreso: e.target.value || null });
  $("f-desde").onchange = (e) => { const d = +e.target.value; actualizar({ desde: d, hasta: Math.max(d, estado.hasta) }); };
  $("f-hasta").onchange = (e) => { const h = +e.target.value; actualizar({ hasta: h, desde: Math.min(h, estado.desde) }); };
  $("f-limpiar").onclick = () => actualizar({ gobierno: null });
  $("t-congresos").onclick = (e) => {
    const nombre = e.target.closest("tr[data-congreso]")?.dataset.congreso;
    if (nombre) actualizar({ congreso: nombre === estado.congreso ? null : nombre });
  };

  Object.assign(estado, { desde: ANIOS[0], hasta: ANIOS.at(-1) });
  const p = Obs.parametros();
  const g = GOBIERNOS.find((x) => x.slug === (p.get("gobierno") ?? "").toLowerCase());
  const c = CONGRESOS.find((x) => x.nombre === p.get("congreso"));
  if (g) estado.gobierno = g.orden;
  else if (c) estado.congreso = c.nombre;
  else {
    const d = +p.get("desde"), h = +p.get("hasta");
    if (ANIOS.includes(d)) estado.desde = d;
    if (ANIOS.includes(h)) estado.hasta = Math.max(h, estado.desde);
  }

  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
