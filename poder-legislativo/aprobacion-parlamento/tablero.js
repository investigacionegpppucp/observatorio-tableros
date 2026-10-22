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
const NBSP = " ";
const TOPE_Y = 70;        // eje vertical de toda la serie (0 a 70 %); una selección lo ajusta a sus valores
const MESES_ESTRENO = 24; // meses que se siguen después de que empieza un Congreso
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const MES_MS = 30.4375 * 864e5;

const pct0 = (v) => (v == null ? "—" : Obs.fmtN(v) + NBSP + "%");
const pct1 = (v) => (v == null ? "—" : Obs.fmtN(v, 1) + NBSP + "%");
const fecha = (r) => `${r.mesNombre} de ${r.anio}`;
const fechaCorta = (r) => `${MESES_CORTOS[r.mes - 1]} ${r.anio}`;
const media = (rs) => rs.reduce((s, r) => s + r.valor, 0) / rs.length;
const unicos = (xs) => [...new Set(xs)];
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const apellido = (nombre) => nombre.split(" ").at(-1);
const alfa = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
const movil = () => matchMedia("(max-width: 600px)").matches;
const describir = (id, texto) => {
  const el = document.getElementById(id);
  el.setAttribute("aria-label", `${el.closest(".tarjeta")?.querySelector("h3")?.textContent ?? "Gráfico"}. ${texto}`);
};

const estado = { gobierno: null, congreso: null, desde: null, hasta: null };
let T, FILAS, ANIOS, POR_MES, PROM_TOTAL, GOBIERNOS, CONGRESOS, TRAMOS, TRAMOS_GOB, PARTIDOS, ESTRENOS, ctxMedir;

const colorPartido = (m) => COLORES_PARTIDO[PARTIDOS.indexOf(m)] ?? T.otros;
const medir = (texto, peso = 700) => { ctxMedir.font = `${peso} 14px ${T.fuente}`; return ctxMedir.measureText(texto).width; };
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
    (baja ? (n === 1 ? ` Ese mes la aprobación estuvo por debajo de 10${NBSP}%.` : ` En ${baja} de ${n} meses la aprobación estuvo por debajo de 10${NBSP}%.`) : "");

  const mayor = S.reduce((a, r) => (r.valor > a.valor ? r : a)), menor = S.reduce((a, r) => (r.valor < a.valor ? r : a));
  Obs.kpi("k-ultimo", { etiqueta: "Último dato", valor: pct0(ultima.valor), pie: fecha(ultima) });
  Obs.kpi("k-prom", { etiqueta: "Promedio", valor: pct1(prom), pie: `${Obs.fmtN(n)} ${n === 1 ? "mes" : "meses"} con dato` });
  Obs.kpi("k-max", { etiqueta: "Máximo", valor: pct0(mayor.valor), pie: fecha(mayor) });
  Obs.kpi("k-min", { etiqueta: "Mínimo", valor: pct0(menor.valor), pie: fecha(menor) });
}

/* ---------- Serie mensual: línea, mayoría de fondo, gobierno abajo ---------- */
function serie(S) {
  const el = document.getElementById("g-serie");
  const g = Obs.grafico("g-serie");
  g.resize();
  const cel = movil();
  const izq = cel ? 48 : 58, der = cel ? 30 : 22, altoFranja = 30, H0 = el.clientHeight - altoFranja - 38;
  const t0 = S[0].t, t1 = S.at(-1).t;
  const pad = t1 - t0 < 24 * MES_MS ? 3 * MES_MS : 0; // vistas cortas: aire a los lados
  const a0 = t0 - pad, a1 = t1 + pad, ancho = Math.max(el.clientWidth - izq - der, 1);
  const px = (ms) => (ms / (a1 - a0)) * ancho;

  // Tramos visibles, de borde a borde (cada uno termina donde empieza el siguiente)
  const visibles = (lista) => {
    const v = lista.filter((x) => x.t1 >= t0 && x.t0 <= t1);
    return v.map((x, k) => ({ ...x, ini: k === 0 ? a0 : x.t0, fin: v[k + 1] ? v[k + 1].t0 : a1 }));
  };
  const bandas = visibles(TRAMOS), franja = visibles(TRAMOS_GOB);

  // Un rótulo de Congreso por Congreso, centrado en todo su recorrido visible
  const porCongreso = new Map();
  for (const b of bandas) {
    const c = porCongreso.get(b.r0.congreso);
    if (c) c.fin = b.fin; else porCongreso.set(b.r0.congreso, { nombre: b.r0.congreso, ini: b.ini, fin: b.fin });
  }
  const rotulosCongreso = [...porCongreso.values()].filter((c) => px(c.fin - c.ini) >= medir(c.nombre) + 14);

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
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [{ left: izq, right: der, top: 6, height: H0 }, { left: izq, right: der, top: H0 + 12, height: altoFranja }],
    xAxis: [
      eje({ type: "time", gridIndex: 0, min: a0, max: a1, axisLabel: { show: false } }),
      eje({ type: "time", gridIndex: 1, min: a0, max: a1, axisLine: { show: false }, splitNumber: cel ? 4 : 10,
        axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, hideOverlap: true,
          formatter: (v) => { const d = new Date(v); return sobreAnios ? String(d.getUTCFullYear()) : `${MESES_CORTOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; } } }),
    ],
    yAxis: [
      eje({ type: "value", gridIndex: 0, min: 0, max: tope, interval: 10, axisLine: { show: false }, splitLine: { lineStyle: { color: T.linea } },
        axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, formatter: (v) => `${v}${NBSP}%` } }),
      { type: "value", gridIndex: 1, min: 0, max: 1, show: false },
    ],
    series: [
      {
        type: "line", xAxisIndex: 0, yAxisIndex: 0, z: 3, name: "Aprobación",
        data: S.map((r) => ({ value: [r.t, r.valor], r })),
        showSymbol: S.length <= 60, symbol: "circle", symbolSize: 7, lineStyle: { width: 2, color: T.unica }, itemStyle: { color: T.unica, borderColor: "#fff", borderWidth: 1.5 },
        markArea: { silent: true, data: bandas.map((b) => [{ xAxis: b.ini, itemStyle: { color: alfa(colorPartido(b.r0.mayoria), 0.18) } }, { xAxis: b.fin }]) },
        markPoint: {
          silent: true, symbol: "circle", symbolSize: 10, itemStyle: { color: T.unica, borderColor: "#fff", borderWidth: 2 },
          label: { show: true, formatter: (p) => pct0(p.value), color: T.texto, fontFamily: T.fuente, fontSize: 14, fontWeight: 700, textBorderColor: "#fff", textBorderWidth: 3 },
          data: puntos.map(([r, position]) => ({ coord: [r.t, r.valor], value: r.valor, label: { position } })),
        },
      },
      {
        // rótulos de Congreso, arriba del gráfico
        type: "custom", xAxisIndex: 0, yAxisIndex: 0, silent: true, z: 2, tooltip: { show: false },
        data: rotulosCongreso.map((c) => [c.ini, c.fin]),
        renderItem: (params, api) => {
          const c = rotulosCongreso[params.dataIndex], x0 = api.coord([c.ini, 0])[0], x1 = api.coord([c.fin, 0])[0];
          return { type: "text", style: { text: c.nombre, x: (x0 + x1) / 2, y: params.coordSys.y + 14, textAlign: "center", textVerticalAlign: "middle", fill: T.textoSuave, font: `700 14px ${T.fuente}` } };
        },
      },
      {
        // franja de gobiernos, debajo del eje
        type: "custom", xAxisIndex: 1, yAxisIndex: 1, silent: true, tooltip: { show: false },
        data: franja.map((f) => [f.ini, f.fin]),
        renderItem: (params, api) => {
          const f = franja[params.dataIndex], x0 = api.coord([f.ini, 0])[0], x1 = api.coord([f.fin, 0])[0], w = x1 - x0, cs = params.coordSys;
          const nombre = apellido(f.r0.presidente);
          return { type: "group", children: [
            { type: "rect", shape: { x: x0, y: cs.y, width: Math.max(w - 2, 1), height: cs.height }, style: { fill: params.dataIndex % 2 ? "#dde3ec" : "#eaeef4" } },
            ...(w - 8 >= medir(nombre) ? [{ type: "text", style: { text: nombre, x: x0 + (w - 2) / 2, y: cs.y + cs.height / 2, textAlign: "center", textVerticalAlign: "middle", fill: T.texto, font: `700 14px ${T.fuente}` } }] : []),
          ] };
        },
      },
    ],
  }, true);

  // Leyenda: mayoría de cada Congreso (el color del fondo sigue al partido)
  const presentes = unicos(bandas.map((b) => b.r0.mayoria));
  document.getElementById("ley-mayoria").innerHTML = `<span class="titulo">Mayoría en el Congreso:</span>` +
    presentes.map((m) => `<span><i style="background:${alfa(colorPartido(m), 0.18)};border-bottom:3px solid ${colorPartido(m)}"></i>${Obs.escapar(m)}</span>`).join("");

  // Meses sin encuesta dentro del rango
  const faltan = [];
  for (let m = S[0].m; m <= S.at(-1).m; m++) if (!POR_MES.has(m)) faltan.push(m);
  document.getElementById("n-serie").textContent = faltan.length
    ? `${faltan.length === 1 ? "Un mes de este rango no tiene" : `${faltan.length} meses de este rango no tienen`} dato de encuesta; la línea une el mes anterior con el siguiente. En el mapa de calor se ven como cuadros vacíos.`
    : "";
  document.getElementById("d-serie").textContent = hayFiltro() && S.length < FILAS.length
    ? `Porcentaje de personas que aprueba el trabajo del Congreso, de ${fecha(S[0])} a ${fecha(S.at(-1))}. El eje vertical se ajusta a esta selección.`
    : "Porcentaje de personas que aprueba el trabajo del Congreso, cada mes. El fondo muestra la mayoría del Congreso y la franja de abajo, el gobierno.";
  describir("g-serie", `Línea mensual de aprobación, de ${fecha(S[0])} a ${fecha(S.at(-1))}. Máximo ${pct0(mayor.valor)} en ${fecha(mayor)}; mínimo ${pct0(menor.valor)} en ${fecha(menor)}; último dato ${pct0(S.at(-1).valor)}.`);
}

/* ---------- Gobiernos: tabla que también filtra ---------- */
function tablaGobiernos() {
  const tope = 30; // la barra de la media llena su columna con 30 %
  document.getElementById("t-gobierno").innerHTML = `<table class="tabla"><thead><tr>
      <th>Gobierno</th><th>Mayoría en el Congreso</th><th class="num">Aprobación media</th></tr></thead><tbody>${
    GOBIERNOS.map((g) => {
      const elegido = estado.gobierno === g.orden;
      return `<tr data-gobierno="${g.orden}"${elegido ? ' class="elegida"' : ""}>
        <td><button type="button" class="fila-boton" aria-pressed="${elegido}">${Obs.escapar(g.nombre)}</button><small>${fechaCorta(g.desde)} a ${fechaCorta(g.hasta)}</small></td>
        <td>${g.mayorias.map((m) => `<span class="partido"><i style="background:${colorPartido(m)}"></i>${Obs.escapar(m)}</span>`).join("")}</td>
        <td class="num media"><span class="barrita" style="width:${Math.round((g.media / tope) * 70)}px"></span>${pct1(g.media)}</td></tr>`;
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
    `<p class="subtabla">Mayor aprobación</p>${tabla(altos)}<p class="subtabla">Menor aprobación</p>${tabla(bajos)}`;
  document.getElementById("d-extremos").textContent = S.length < FILAS.length
    ? `Dentro de la selección: de ${fecha(S[0])} a ${fecha(S.at(-1))}.` : "En toda la serie: los cinco meses más altos y los cinco más bajos.";
}

/* ---------- Aprobación media por Congreso ---------- */
function barrasCongresos() {
  Obs.barras("g-congresos", CONGRESOS.map((c) => ({ clave: c.nombre, etiqueta: c.nombre, valor: c.media })), {
    formato: pct1, nombre: "Aprobación media", seleccion: estado.congreso ? new Set([estado.congreso]) : null,
    alClic: (c) => actualizar({ congreso: c === estado.congreso ? null : c }),
  });
  const orden = [...CONGRESOS].sort((a, b) => b.media - a.media);
  describir("g-congresos", `Barras con la aprobación media de cada Congreso. Mayor: ${orden[0].nombre}, ${pct1(orden[0].media)}. Menor: ${orden.at(-1).nombre}, ${pct1(orden.at(-1).media)}.`);
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
      axisLabel: { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14, formatter: (v) => `${v}${NBSP}%` } },
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

/* ---------- Mapa de calor: un cuadro por mes ---------- */
function calor() {
  const cel = movil();
  const sub = estado.gobierno || estado.congreso;
  const anios = ANIOS.filter((a) => sub || (a >= estado.desde && a <= estado.hasta));
  const CLASES = [{ lt: 10, t: `Menos de 10${NBSP}%` }, { gte: 10, lt: 15, t: `10 a 14${NBSP}%` }, { gte: 15, lt: 20, t: `15 a 19${NBSP}%` }, { gte: 20, lt: 30, t: `20 a 29${NBSP}%` }, { gte: 30, t: `30${NBSP}% o más` }];
  const celdas = [], vacias = [];
  anios.forEach((a, ia) => {
    for (let m = 1; m <= 12; m++) {
      const clave = a * 12 + m - 1, r = POR_MES.get(clave), pos = cel ? [m - 1, ia] : [ia, m - 1];
      if (r) celdas.push({ value: [...pos, r.valor], r, itemStyle: enSub(r) ? undefined : { opacity: 0.2 } });
      else if (clave > FILAS[0].m && clave < FILAS.at(-1).m) vacias.push(pos);
    }
  });
  const el = document.getElementById("g-calor");
  const celdaAlto = cel ? 24 : 30;
  el.style.height = `${(cel ? anios.length : 12) * celdaAlto + (cel ? 56 : 48)}px`;
  const g = Obs.grafico("g-calor");
  g.resize();
  const izq = cel ? 50 : 56, der = 8;
  const paso = Math.max(1, Math.ceil((anios.length * 46) / Math.max(el.clientWidth - izq - der, 1)));
  const txt = { color: T.textoSuave, fontFamily: T.fuente, fontSize: 14 };
  const ejeAnios = { type: "category", data: anios, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...txt, interval: cel ? 0 : (i) => (anios.length - 1 - i) % paso === 0 }, ...(cel ? { inverse: true } : {}) };
  const ejeMeses = { type: "category", data: MESES_CORTOS.map((m) => (cel ? m.charAt(0) : m).replace(/^./, (c) => c.toUpperCase())), axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...txt, interval: 0 }, ...(cel ? {} : { inverse: true }) };
  g.setOption({
    animation: false, textStyle: { fontFamily: T.fuente },
    tooltip: { ...Obs.tooltipBase(), formatter: (p) => p.data?.r ? `<strong>${p.data.r.mesNombre} de ${p.data.r.anio}</strong><br>Aprobación: <strong>${pct0(p.data.r.valor)}</strong><br>Gobierno: ${Obs.escapar(p.data.r.presidente)}` : "" },
    grid: { left: izq, right: der, top: 8, bottom: cel ? 28 : 30 },
    xAxis: cel ? ejeMeses : ejeAnios, yAxis: cel ? ejeAnios : ejeMeses,
    visualMap: { show: false, type: "piecewise", dimension: 2, seriesIndex: 0, pieces: CLASES.map(({ t, ...r }, i) => ({ ...r, color: T.escala[i] })) },
    series: [
      { type: "heatmap", data: celdas, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 2 }, emphasis: { itemStyle: { borderColor: T.navy, borderWidth: 2 } } },
      { type: "custom", data: vacias, silent: true, tooltip: { show: false }, renderItem: (params, api) => {
        const [x, y] = api.coord([api.value(0), api.value(1)]), [w, h] = api.size([1, 1]);
        return { type: "rect", shape: { x: x - w / 2 + 3, y: y - h / 2 + 3, width: w - 6, height: h - 6, r: 2 }, style: { fill: "#fff", stroke: "#b5bfcc", lineWidth: 1, lineDash: [4, 3] } };
      } },
    ],
  }, true);
  document.getElementById("ley-calor").innerHTML = CLASES.map((k, i) => `<span><i style="background:${T.escala[i]}"></i>${k.t}</span>`).join("") +
    (vacias.length ? `<span><i class="s"></i>Sin encuesta</span>` : "");
  document.getElementById("d-calor").textContent = sub
    ? "Un cuadro por mes, según el porcentaje que aprueba. Se ven más claros los meses fuera de la selección."
    : "Un cuadro por mes, según el porcentaje que aprueba.";
  const meses = celdas.filter((c) => !c.itemStyle);
  describir("g-calor", `Mapa de calor con ${meses.length} meses con dato, de ${anios[0]} a ${anios.at(-1)}. ${meses.filter((c) => c.value[2] < 10).length} meses con menos de 10 % de aprobación.`);
}

/* ---------- Estado, controles y arranque ---------- */
function render() {
  sincronizar();
  const S = FILAS.filter(enSub);
  resumen(S);
  serie(S);
  tablaGobiernos();
  extremos(S);
  barrasCongresos();
  estreno();
  calor();
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
  ctxMedir = document.createElement("canvas").getContext("2d");

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

  TRAMOS_GOB = tramos(FILAS, (r) => r.orden);
  GOBIERNOS = TRAMOS_GOB.map((t) => ({ orden: t.k, nombre: t.r0.presidente, slug: sinTildes(apellido(t.r0.presidente)), desde: t.filas[0], hasta: t.filas.at(-1),
    media: media(t.filas), mayorias: unicos(t.filas.map((r) => r.mayoria)) }));
  TRAMOS = tramos(FILAS, (r) => `${r.congreso}|${r.mayoria}`);
  CONGRESOS = unicos(FILAS.map((r) => r.congreso)).map((nombre) => { const rs = FILAS.filter((r) => r.congreso === nombre); return { nombre, media: media(rs), n: rs.length }; });

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
  $("t-gobierno").onclick = (e) => {
    const orden = e.target.closest("tr[data-gobierno]")?.dataset.gobierno;
    if (orden) actualizar({ gobierno: orden === estado.gobierno ? null : orden });
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
