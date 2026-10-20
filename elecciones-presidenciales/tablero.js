/* =========================================================
   Tablero de Elecciones presidenciales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, generado por procesos/elecciones-presidenciales/
   procesar.py a partir de la base de elecciones presidenciales
   (una fila por distrito electoral, elección y vuelta). Filas
   nacionales: NACION (solo el Perú) y TOTAL (Perú + extranjero,
   desde 1985).

   Dos pestañas: General (toda la serie, nacional) y Por elección
   y región (con filtros). Patrón: un objeto `estado`, una función
   pura `filtrar()` y una sola función `render()`.

   Parámetros de URL:
     ?modulo=eleccion  abre la pestaña por elección
     &eleccion=2021&vuelta=2&region=CUSCO
     &embed=1          oculta título y pie (para un iframe)
   ========================================================= */

// Colores: los generales se leen de tema.css al arrancar; los propios de este tablero van aquí.
// Voto no válido: primera vuelta en tonos plenos, segunda en claros (validados con dataviz/validate_palette.js).
const C = { c1c: "#9db1ec", bl1: "#2d4fb8", nu1: "#587a00", bl2: "#a3b8f2", nu2: "#b5d364", otros: "#6b7584", gris: "#aab3c0",
  primero: "#0f2257", segundo: "#95acee" };
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const BASE = () => ({ textStyle: { fontFamily: C.fuente }, animation: ANIM });
const num = (v, d) => v.toLocaleString("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => v == null ? "—" : num(v * 100, d) + " %";
const pp = (v) => num(Math.abs(v * 100), 1);
// Nombres: la base viene en mayúsculas y sin tildes
const MIN = new Set(["del", "de", "la", "el", "por", "para", "y", "las", "los", "en"]);
const TILDES = { accion: "acción", peru: "perú", pais: "país", integracion: "integración", concentracion: "concentración", democratica: "democrática", democraticas: "democráticas",
  democratico: "democrático", democrata: "demócrata", patriotico: "patriótico", civico: "cívico", coalicion: "coalición", politico: "político", renovacion: "renovación", union: "unión",
  mayoria: "mayoría", martin: "martín", huanuco: "huánuco", junin: "junín", apurimac: "apurímac", ancash: "áncash" };
const SIGLAS = new Set(["fredemo"]);
const titulo = (s) => !s ? "—" : s.toLowerCase().split(" ").map((w, i) => {
  if (SIGLAS.has(w)) return w.toUpperCase();
  w = TILDES[w] ?? w;
  return i && MIN.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
}).join(" ").replace(/^Votos (En Blanco|Nulos)$/, (m) => m.charAt(0) + m.slice(1).toLowerCase());
const nombre = (d) => (d === "NACION" ? "Perú" : d === "RESIDENTES EN EL EXTRANJERO" ? "Extranjero" : titulo(d));
const txt = (x = {}) => ({ color: C.suave, fontFamily: C.fuente, fontSize: 14, ...x });
const eje = (x = {}) => ({ axisLine: { lineStyle: { color: C.linea } }, axisTick: { show: false }, axisLabel: txt(), splitLine: { lineStyle: { color: C.linea } }, ...x });
const ejePct = (x = {}) => eje({ axisLabel: txt({ formatter: (v) => Math.round(v * 100) + " %" }), ...x });
const graf = Obs.grafico;
const nv = (r) => (r && r.blanco != null && r.nulo != null ? r.blanco + r.nulo : null);
// los nulos iniciales se quitan: si no, el rótulo final de ECharts arranca en NaN durante la animación
const vv = (p) => (Array.isArray(p.value) ? p.value[1] : p.value);
const sinNulosIniciales = (datos) => { const k = datos.findIndex((v) => v != null); return datos.map((v, i) => [i, v]).slice(Math.max(k, 0)); };
const linea = (nombreS, datos, color, extra = {}) => ({ name: nombreS, type: "line", data: sinNulosIniciales(datos), connectNulls: true, symbol: "circle", symbolSize: 8, showAllSymbol: true,
  lineStyle: { width: 2, color }, itemStyle: { color, borderColor: "#fff", borderWidth: 2 }, ...extra });
const finRotulo = (fmt = (v) => pct(v)) => ({ show: true, formatter: (p) => fmt(p.value[1]), color: C.texto, fontFamily: C.fuente, fontSize: 14, fontWeight: 700 });

let FILAS = [], ELECCIONES = [], ANIOS = [], DISTRITOS = [];
const fila = (d, e, v) => FILAS.find((f) => f.d === d && f.e === e && f.v === v) ?? null;
const serie = (d, v, f) => ELECCIONES.map((e) => { const r = fila(d, e, v); return r ? f(r) : null; });
const hay2 = (e) => FILAS.some((f) => f.e === e && f.v === 2);
// Resultado nacional: Perú + extranjero (fila TOTAL) cuando existe; antes de 1985, el Perú
const filaN = (e, v) => fila("TOTAL", e, v) ?? fila("NACION", e, v);
const serieN = (v, f) => ELECCIONES.map((e) => { const r = filaN(e, v); return r ? f(r) : null; });
const EXT = "RESIDENTES EN EL EXTRANJERO";

// Eje de años: muestra tantos como quepan, contando desde el último para que 2026 siempre aparezca
function ejeAnios(id, izq, der, anios = ANIOS, extra = {}) {
  const ancho = document.getElementById(id).clientWidth - izq - der;
  const paso = Math.max(1, Math.ceil((anios.length * 44) / Math.max(ancho, 1)));
  const ult = anios.length - 1;
  return { type: "category", data: anios, ...eje({ splitLine: { show: false } }),
    axisLabel: txt({ interval: (i) => (ult - i) % paso === 0, hideOverlap: false }), ...extra };
}
// Separa los rótulos finales de dos líneas cuando quedan encimados
function despegar(id, v1, v2, min = 20) {
  if (v1 == null || v2 == null) return;
  const gr = graf(id), y1 = gr.convertToPixel({ yAxisIndex: 0 }, v1), y2 = gr.convertToPixel({ yAxisIndex: 0 }, v2);
  const falta = min - Math.abs(y1 - y2);
  if (falta <= 0) return;
  const s = y1 <= y2 ? -1 : 1; // la de arriba sube, la de abajo baja
  gr.setOption({ series: [{ endLabel: { offset: [0, (s * falta) / 2] } }, { endLabel: { offset: [0, (-s * falta) / 2] } }] });
}
const describir = (id, texto) => document.getElementById(id).setAttribute("aria-label", texto);

/* =========== Pestaña General (nacional: Perú + extranjero) =========== */
function vistazo() {
  // Participación: una línea por vuelta
  const p1 = serieN(1, (r) => r.parti), p2 = serieN(2, (r) => r.parti);
  const val = p1.filter((x) => x != null), max = Math.max(...val), min = Math.min(...val);
  graf("g-parti").setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => vv(p) != null).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${pct(vv(p))}</strong>`).join("") },
    grid: { left: 52, right: 60, top: 30, bottom: 34 },
    xAxis: ejeAnios("g-parti", 52, 60, ANIOS, { boundaryGap: false }),
    yAxis: { type: "value", min: 0.3, max: 1, ...ejePct() },
    series: [
      linea("Primera vuelta", p1, C.c1, { areaStyle: { color: "rgba(58,95,205,.08)" }, endLabel: finRotulo(),
        markPoint: { symbol: "circle", symbolSize: 1, label: { show: true, position: "top", distance: 10, ...txt({ color: C.texto, fontWeight: 700 }), formatter: (p) => p.name },
          data: [{ name: `Máximo: ${pct(max)} en ${ANIOS[p1.indexOf(max)]}`, coord: [p1.indexOf(max), max] }, { name: `Mínimo: ${pct(min)} en ${ANIOS[p1.indexOf(min)]}`, coord: [p1.indexOf(min), min], label: { position: "right" } }] } }),
      linea("Segunda vuelta", p2, C.c2, { endLabel: finRotulo() }),
    ],
  }, true);
  despegar("g-parti", p1.at(-1), p2.at(-1));
  describir("g-parti", `Participación en las elecciones presidenciales, 1931-2026. Primera vuelta en ${ANIOS.at(-1)}: ${pct(p1.at(-1))}; máximo ${pct(max)} en ${ANIOS[p1.indexOf(max)]} y mínimo ${pct(min)} en ${ANIOS[p1.indexOf(min)]}.`);

  // Voto no válido: columnas en el tiempo (dos por año, una por vuelta)
  const nvFilas = [];
  ELECCIONES.forEach((e) => [1, 2].forEach((v) => { const r = filaN(e, v); if (r && nv(r) != null) nvFilas.push({ e, v, blanco: r.blanco, nulo: r.nulo }); }));
  columnasNoValido("g-nv-hist", nvFilas);
  const ult = nvFilas.at(-1);
  describir("g-nv-hist", `Voto no válido en las elecciones presidenciales, 1963-2026. En ${ult.e}, ${ult.v === 1 ? "primera" : "segunda"} vuelta: ${pct(ult.blanco + ult.nulo)}.`);

  // Qué tan reñida: dumbbells del primero y el segundo, una tarjeta por vuelta
  pesas("g-margen1", 1, ELECCIONES);
  pesas("g-margen2", 2, ELECCIONES.filter(hay2));

  // Organizaciones
  const org = serieN(1, (r) => r.org), maxO = Math.max(...org.filter((x) => x != null));
  graf("g-org").setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } }, formatter: (ps) => `<strong>${ps[0].name}</strong><br>${ps[0].value} organizaciones` },
    grid: { left: 36, right: 10, top: 28, bottom: 34 },
    xAxis: ejeAnios("g-org", 36, 10),
    yAxis: { type: "value", ...eje() },
    series: [{ type: "bar", barWidth: 2, silent: true, data: org, itemStyle: { color: C.c1c } },
      { type: "scatter", symbolSize: 11, data: org, itemStyle: { color: C.c1, borderColor: "#fff", borderWidth: 2 },
        label: { show: true, position: "top", distance: 6, ...txt({ color: C.texto, fontWeight: 700 }), formatter: (p) => (p.value === maxO || p.dataIndex === org.length - 1 || p.value === 1 ? String(p.value) : "") } }],
  }, true);
  describir("g-org", `Organizaciones candidatas en primera vuelta. Máximo: ${maxO} en ${ANIOS[org.indexOf(maxO)]}; ${org.at(-1)} en ${ANIOS.at(-1)}.`);

  // Mujeres en la plancha
  const mp = serieN(1, (r) => r.presi), mv1 = serieN(1, (r) => r.vice1), mv2 = serieN(1, (r) => r.vice2);
  // Mapa de calor: un cargo por fila, una elección por columna, 5 clases de un solo tono
  const CLASES = [{ min: 0, max: 0, t: "0\u00a0%", c: "#eef1fa" }, { gt: 0, lte: 0.15, t: "1 a 15\u00a0%", c: "#ccd6f3" }, { gt: 0.15, lte: 0.3, t: "15 a 30\u00a0%", c: "#95acee" },
    { gt: 0.3, lte: 0.5, t: "30 a 50\u00a0%", c: "#4062cc" }, { gt: 0.5, t: "Más de 50\u00a0%", c: "#0f2257" }];
  document.getElementById("ley-mujeres").innerHTML = CLASES.map((k) => `<span><i style="background:${k.c}"></i>${k.t}</span>`).join("") +
    (mp.concat(mv1, mv2).some((x) => x == null) ? `<span><i class="s"></i>Sin dato</span>` : "");
  const movil = matchMedia("(max-width: 600px)").matches;
  const CARGOS = [["Presidencia", mp], [movil ? "1.ª vice" : "1.ª vicepresidencia", mv1], [movil ? "2.ª vice" : "2.ª vicepresidencia", mv2]];
  const celdas = [], sinDato = [];
  CARGOS.forEach(([, d], f) => d.forEach((x, k) => (x == null ? sinDato : celdas).push([k, f, x ?? "-"])));
  const izqM = movil ? 82 : 150;
  graf("g-mujeres").setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), formatter: (p) => `<strong>${ANIOS[p.value[0]]}</strong><br>${CARGOS[p.value[1]][0]}: <strong>${p.value[2] === "-" ? "sin dato" : pct(p.value[2])}</strong>` },
    grid: { left: izqM, right: 18, top: 10, bottom: 34 },
    xAxis: ejeAnios("g-mujeres", izqM, 18, ANIOS, { axisLine: { show: false } }),
    yAxis: { type: "category", data: CARGOS.map((c) => c[0]), inverse: true, ...eje({ axisLine: { show: false }, splitLine: { show: false }, axisLabel: txt({ color: C.texto }) }) },
    visualMap: { show: false, type: "piecewise", dimension: 2, seriesIndex: 0, pieces: CLASES.map(({ t, c, ...r }) => ({ ...r, color: c })) },
    series: [{ type: "heatmap", data: celdas, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 2 } } },
      // celdas sin dato: blancas con borde punteado, fuera de la escala de color
      { type: "custom", data: sinDato, renderItem: (params, api) => {
        const [x, y] = api.coord([api.value(0), api.value(1)]), [w, h] = api.size([1, 1]);
        return { type: "rect", shape: { x: x - w / 2 + 3, y: y - h / 2 + 3, width: w - 6, height: h - 6, r: 2 }, style: { fill: "#fff", stroke: "#b5bfcc", lineWidth: 1, lineDash: [4, 3] } };
      } }],
  }, true);
  describir("g-mujeres", `Mapa de calor con el porcentaje de candidatas por cargo y elección. En ${ANIOS.at(-1)}: ${pct(mp.at(-1))} en la presidencia, ${pct(mv1.at(-1))} en la primera vicepresidencia y ${pct(mv2.at(-1))} en la segunda.`);
}

/* Voto no válido en el tiempo: una columna apilada (en blanco + nulos) por vuelta, con el
   porcentaje dentro de cada tramo si cabe y el total encima. Si un año no tuvo segunda vuelta, su
   columna va centrada. En el celular, si las columnas no caben, pasa a barras horizontales. */
function columnasNoValido(id, filas) {
  const el = document.getElementById(id);
  const anios = [...new Set(filas.map((f) => f.e))], n = anios.length;
  const izq = 8, der = 8, ancho = el.clientWidth - izq - der;
  const anchoCol = Math.min(42, (ancho / n) * 0.4);
  if (anchoCol < 24) {
    barrasNoValido(id, [...filas].reverse().map((r) => ({ clave: `${r.e}-${r.v}`, eje: r.v === 1 ? String(r.e) : "2.ª vuelta", sub: r.v === 2, blanco: r.blanco, nulo: r.nulo, tip: `${r.e}, ${r.v === 1 ? "primera" : "segunda"} vuelta` })));
    return;
  }
  el.style.height = "400px";
  const gr = graf(id); gr.resize();
  const max = Math.max(...filas.map((f) => f.blanco + f.nulo)) * 1.08;
  const doble = new Set(anios.filter((e) => filas.filter((f) => f.e === e).length === 2));
  const rotulo = (x, y, texto, color, tam = 11, peso = 600) => ({ type: "text", style: { x, y, text: texto, align: "center", verticalAlign: "middle", fill: color, font: `${peso} ${tam}px ${C.fuente}` } });
  gr.setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const e = +ps[0].axisValue; return `<strong>${e}</strong>` + [1, 2].map((v) => { const r = filas.find((f) => f.e === e && f.v === v);
        return r ? `<br><strong>${v === 1 ? "Primera" : "Segunda"} vuelta</strong>: ${pct(r.blanco + r.nulo)}<br>&nbsp;&nbsp;En blanco ${pct(r.blanco)}, nulos ${pct(r.nulo)}` : ""; }).join(""); } },
    grid: { left: izq, right: der, top: 48, bottom: 34 },
    xAxis: { type: "category", data: anios.map(String), ...eje({ splitLine: { show: false } }), axisLabel: txt({ color: C.texto, fontWeight: 700, interval: 0 }) },
    yAxis: { type: "value", max, show: false },
    series: [{ type: "custom", encode: { x: 0, y: [1, 2] }, data: filas.map((f) => [anios.indexOf(f.e), f.blanco, f.nulo, f.v]),
      renderItem: (params, api) => {
        const k = api.value(0), b = api.value(1), nl = api.value(2), v = api.value(3);
        const dx = doble.has(anios[k]) ? (v === 1 ? -1 : 1) * (anchoCol / 2 + 2) : 0;
        const [cx, y0] = api.coord([k, 0]), [, yb] = api.coord([k, b]), [, yt] = api.coord([k, b + nl]);
        const x = cx + dx - anchoCol / 2, cb = v === 1 ? C.bl1 : C.bl2, cn = v === 1 ? C.nu1 : C.nu2;
        const hijos = [
          { type: "rect", shape: { x, y: yb, width: anchoCol, height: y0 - yb }, style: { fill: cb } },
          // 2 px de separación entre tramos
          { type: "rect", shape: { x, y: yt, width: anchoCol, height: Math.max(yb - yt - 2, 0), r: [3, 3, 0, 0] }, style: { fill: cn } },
        ];
        // total encima; si las dos columnas del año quedan a la misma altura, el de la segunda vuelta sube
        let yTotal = yt - 10;
        if (v === 2 && doble.has(anios[k])) {
          const r1 = filas.find((f) => f.e === anios[k] && f.v === 1), [, yt1] = api.coord([k, r1.blanco + r1.nulo]);
          if (Math.abs(yt - yt1) < 18) yTotal = Math.min(yt, yt1) - 28;
        }
        hijos.push(rotulo(cx + dx, yTotal, pct(b + nl), C.texto, 14, 800));
        // porcentaje dentro de cada tramo, solo si cabe
        const cabe = (alto) => anchoCol >= 32 && alto >= 15;
        if (cabe(y0 - yb)) hijos.push(rotulo(cx + dx, (y0 + yb) / 2, pct(b), v === 1 ? "#fff" : C.navy));
        if (cabe(yb - yt - 2)) hijos.push(rotulo(cx + dx, (yb + yt) / 2 - 1, pct(nl), v === 1 ? "#fff" : C.navy));
        return { type: "group", children: hijos };
      } }],
  }, true);
}

/* Barras horizontales apiladas (en blanco + nulos), una fila por región o vuelta.
   filas: [{ clave, eje, sub, blanco, nulo, tip, resaltar }] */
function barrasNoValido(id, filas) {
  const el = document.getElementById(id);
  el.style.height = `${filas.length * 34 + 20}px`;
  const gr = graf(id); gr.resize();
  const izq = 110, der = 64, ancho = el.clientWidth - izq - der;
  const max = Math.max(...filas.map((f) => f.blanco + f.nulo)) * 1.05;
  const cabe = (v) => (v / max) * ancho >= 40;
  const tono = (f, claro, pleno) => (f.sub ? claro : pleno);
  const atenuar = filas.some((f) => f.resaltar);
  const op = (f) => (atenuar && !f.resaltar ? 0.35 : 1); // las demás regiones van en tonos claros, con texto oscuro
  const dentro = (oscuro) => ({ show: true, position: "inside", fontFamily: C.fuente, fontSize: 11, fontWeight: 600, color: oscuro ? C.navy : "#fff" });
  gr.setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const f = filas[ps[0].dataIndex]; return `<strong>${f.tip}</strong><br>En blanco: ${pct(f.blanco)}<br>Nulos: ${pct(f.nulo)}<br>Total no válido: <strong>${pct(f.blanco + f.nulo)}</strong>`; } },
    grid: { left: izq, right: der, top: 6, bottom: 6 },
    xAxis: { type: "value", max, show: false },
    yAxis: { type: "category", inverse: true, data: filas.map((f) => f.clave), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { formatter: (v, k) => (filas[k].sub ? `{s|${filas[k].eje}}` : `{a|${filas[k].eje}}`), rich: { a: txt({ color: C.texto, fontWeight: 700 }), s: txt() } } },
    series: [
      { type: "bar", stack: "t", barWidth: 22, data: filas.map((f) => ({ value: f.blanco, itemStyle: { color: op(f) < 1 ? "#c9d3f3" : tono(f, C.bl2, C.bl1) },
          label: { ...dentro(f.sub || op(f) < 1), formatter: () => (cabe(f.blanco) ? pct(f.blanco, 1) : "") } })) },
      { type: "bar", stack: "t", barWidth: 22, data: filas.map((f) => ({ value: f.nulo, itemStyle: { color: op(f) < 1 ? "#d6e2b5" : tono(f, C.nu2, C.nu1), borderRadius: [0, 3, 3, 0] },
          label: { ...dentro(f.sub || op(f) < 1), formatter: () => (cabe(f.nulo) ? pct(f.nulo, 1) : "") } })) },
      { type: "bar", stack: "t", barWidth: 22, silent: true, itemStyle: { color: "transparent" }, data: filas.map(() => 0.0001),
        label: { show: true, position: "right", distance: 6, ...txt({ color: C.texto, fontWeight: 800 }), formatter: (p) => pct(filas[p.dataIndex].blanco + filas[p.dataIndex].nulo) } },
    ],
  }, true);
}

/* Qué tan reñida fue la elección: un dumbbell por año, con el primero (oscuro) y el segundo (claro)
   sobre votos válidos, unidos por una barra gris. Rótulo de la distancia en la última elección y en la más holgada. */
function pesas(id, v, anios) {
  const izq = 52, der = 16;
  const filas = anios.map((e) => filaN(e, v)).filter((r) => r && r.p2 != null);
  const dist = filas.map((r) => r.p1 - r.p2), mx = Math.max(...dist);
  const rotular = (k) => k === filas.length - 1 || dist[k] === mx;
  graf(id).setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const r = filas[ps[0].dataIndex];
        return `<strong>${r.e}</strong><br>${titulo(r.g1)}: <strong>${pct(r.p1)}</strong><br>${titulo(r.g2)}: <strong>${pct(r.p2)}</strong><br>Distancia: ${pp(r.p1 - r.p2)}\u00a0pp`; } },
    grid: { left: izq, right: der, top: 26, bottom: 34 },
    xAxis: ejeAnios(id, izq, der, filas.map((r) => String(r.e))),
    yAxis: { type: "value", min: 0, max: v === 1 ? 0.8 : 1, ...ejePct() },
    series: [{ type: "custom", encode: { x: 0, y: [1, 2] }, data: filas.map((r, k) => [k, r.p1, r.p2]),
      renderItem: (params, api) => {
        const k = api.value(0), [x, y1] = api.coord([k, api.value(1)]), [, y2] = api.coord([k, api.value(2)]);
        const hijos = [
          { type: "rect", shape: { x: x - 2.5, y: y1, width: 5, height: Math.max(y2 - y1, 0), r: 2.5 }, style: { fill: "#cfd6e4" } },
          { type: "circle", shape: { cx: x, cy: y2, r: 6 }, style: { fill: "#95acee", stroke: "#fff", lineWidth: 2 } },
          { type: "circle", shape: { cx: x, cy: y1, r: 7 }, style: { fill: "#0f2257", stroke: "#fff", lineWidth: 2 } },
        ];
        if (rotular(k)) hijos.push({ type: "text", style: { x, y: y1 - 12, text: pp(api.value(1) - api.value(2)) + "\u00a0pp", align: "center", verticalAlign: "bottom", fill: C.texto, font: `700 14px ${C.fuente}` } });
        return { type: "group", children: hijos };
      } }],
  }, true);
  const u = filas.at(-1);
  describir(id, `Votos del primero y del segundo en ${v === 1 ? "primera" : "segunda"} vuelta. En ${u.e}: ${titulo(u.g1)} ${pct(u.p1)} y ${titulo(u.g2)} ${pct(u.p2)}, ${pp(u.p1 - u.p2)} puntos de distancia. La distancia más grande fue de ${pp(mx)} puntos en ${filas[dist.indexOf(mx)].e}.`);
}

/* =========== Pestaña 2: por elección y región =========== */
const estado = { pestana: "general", e: 2026, v: 1, ambito: "nacional", region: "NACION" };

const ARCHIVOS = [{ clave: "elecciones_presidenciales_base", etiqueta: "Base de elecciones presidenciales (1931-2026)" }];

// Función pura: lo que muestra la pestaña por elección
function filtrar(filas, s) {
  return {
    actual: s.region === "NACION" ? filaN(s.e, s.v) : filas.find((f) => f.d === s.region && f.e === s.e && f.v === s.v) ?? null,
    regiones: filas.filter((f) => f.e === s.e && f.v === s.v && f.d !== "NACION" && f.d !== "TOTAL"),
    evolucion: s.region === "NACION" ? null : { parti: serie(s.region, 1, (r) => r.parti), nv: serie(s.region, 1, nv) },
  };
}

const selE = document.getElementById("f-eleccion"), selR = document.getElementById("f-region");
const actualizar = (parche) => {
  Object.assign(estado, parche);
  if (estado.v === 2 && !hay2(estado.e)) estado.v = 1;
  if (estado.ambito === "nacional") estado.region = "NACION";
  render();
  Obs.escribirURL({ modulo: estado.pestana === "general" ? null : estado.pestana, eleccion: estado.pestana === "general" ? null : estado.e,
    vuelta: estado.pestana === "general" || estado.v === 1 ? null : 2, region: estado.region === "NACION" ? null : estado.region });
};
const elegirRegion = (d) => actualizar(d === estado.region ? { ambito: "nacional" } : { ambito: "regional", region: d });

const TABS = [...document.querySelectorAll("[data-pestana]")];

function render() {
  const enGeneral = estado.pestana === "general";
  TABS.forEach((b) => { const sel = b.dataset.pestana === estado.pestana; b.setAttribute("aria-selected", sel); b.tabIndex = sel ? 0 : -1; });
  document.getElementById("p-general").hidden = !enGeneral;
  document.getElementById("p-eleccion").hidden = enGeneral;
  document.getElementById("filtros").hidden = enGeneral;
  // los gráficos solo se dibujan visibles: ECharts necesita el ancho real
  Obs.redimensionar();
  if (enGeneral) { vistazo(); return; }

  selE.value = estado.e;
  selR.value = estado.region === "NACION" ? "" : estado.region;
  document.getElementById("c-region").hidden = estado.ambito !== "regional";
  document.querySelectorAll("[data-v]").forEach((b) => { b.setAttribute("aria-pressed", +b.dataset.v === estado.v); b.disabled = b.dataset.v === "2" && !hay2(estado.e); });
  document.querySelectorAll("[data-ambito]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.ambito === estado.ambito));
  const s = filtrar(FILAS, estado);
  const vuelta = estado.v === 1 ? "primera vuelta" : "segunda vuelta";
  const r = s.actual;
  document.getElementById("resumen").innerHTML = r
    ? `${estado.region === "NACION" ? (r.d === "TOTAL" ? "En el Perú y el extranjero" : "En el Perú") : (estado.region === EXT ? "Entre los peruanos en el extranjero" : `En ${nombre(estado.region)}`)}, en la ${vuelta} de ${estado.e} votó el <strong>${pct(r.parti)}</strong> de los electores hábiles` +
      (nv(r) != null ? ` y el <strong>${pct(nv(r))}</strong> de los votos fue en blanco o nulo` : "") + `. ${titulo(r.g1)} quedó primero con el ${pct(r.p1)} de los votos válidos` +
      (r.p2 != null ? `, ${pp(r.p1 - r.p2)} puntos por delante de ${titulo(r.g2)}.` : ".")
    : `No hay datos de ${nombre(estado.region)} en la ${vuelta} de ${estado.e}.`;
  mapa(s, vuelta);
  const conNv = s.regiones.filter((x) => nv(x) != null).sort((a, b) => nv(b) - nv(a));
  document.getElementById("t-nv-reg").textContent = `Voto no válido por región (${estado.e}, ${vuelta})`;
  if (conNv.length) {
    barrasNoValido("g-nv-reg", conNv.map((x) => ({ clave: x.d, eje: nombre(x.d), sub: false, blanco: x.blanco, nulo: x.nulo, tip: nombre(x.d), resaltar: x.d === estado.region })));
    describir("g-nv-reg", `Voto no válido por región en ${estado.e}, ${vuelta}. Más alto: ${nombre(conNv[0].d)}, ${pct(nv(conNv[0]))}; más bajo: ${nombre(conNv.at(-1).d)}, ${pct(nv(conNv.at(-1)))}.`);
  } else { document.getElementById("g-nv-reg").style.height = "60px"; graf("g-nv-reg").resize(); graf("g-nv-reg").clear(); graf("g-nv-reg").setOption({ graphic: { type: "text", left: 0, top: "middle", style: { text: `Sin datos de voto en blanco y nulo en ${estado.e}.`, fill: C.suave, font: `600 15px ${C.fuente}` } } }); }
  evolucion(s);
}

/* ---------- Mapa de regiones (comun/mapa.js) ----------
   El GeoJSON separa Lima Metropolitana y Lima Provincias; hasta 2016 la base trae todo el
   departamento como LIMA, así que los dos polígonos toman ese dato. */
const distritoDe = (region) => region === "LIMA METROPOLITANA" ? "LIMA" : region === "LIMA PROVINCIAS" ? (estado.e >= 2021 ? "LIMA PROVINCIAS" : "LIMA") : region;
const poligonoDe = (d) => (d === "LIMA" ? "LIMA METROPOLITANA" : d);
let MAPA = null;

function mapa(s, vuelta) {
  const regs = s.regiones;
  document.getElementById("t-mapa").textContent = `¿Quién ganó en cada región? (${estado.e}, ${vuelta})`;
  // las dos organizaciones que ganaron más regiones toman los dos colores; el resto, gris
  const victorias = {};
  regs.forEach((r) => r.g1 && (victorias[r.g1] = (victorias[r.g1] ?? 0) + 1));
  const top = Object.entries(victorias).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  const color = (n) => (n === top[0] ? C.c1 : n === top[1] ? C.c2 : C.otros);
  const otros = Object.keys(victorias).filter((n) => !top.includes(n));
  document.getElementById("ley-mapa").innerHTML = top.map((n) => `<span><i style="background:${color(n)}"></i>${titulo(n)} (${victorias[n]} ${victorias[n] === 1 ? "región" : "regiones"})</span>`).join("") +
    (otros.length ? `<span><i style="background:${C.otros}"></i>Otras: ${otros.map(titulo).join(", ")}</span>` : "");
  MAPA ??= new Obs.Mapa("g-mapa", GEO, { alClic: (r) => elegirRegion(distritoDe(r)), nombre: (r) => nombre(distritoDe(r)), globo: { alClic: () => elegirRegion(EXT) } });
  const porDistrito = new Map(regs.map((r) => [r.d, r]));
  const valores = new Map(GEO.features.filter((f) => f.properties.tipo === "region").map((f) => [f.properties.region, porDistrito.get(distritoDe(f.properties.region))]).filter(([, r]) => r));
  MAPA.pintar({ valores, color: (r) => color(r.g1), elegida: poligonoDe(estado.region),
    texto: (r) => `${Obs.escapar(titulo(r.g1))}: ${pct(r.p1)}` + (r.g2 ? `<br>${Obs.escapar(titulo(r.g2))}: ${pct(r.p2)}` : "") });
  const ext = porDistrito.get(EXT);
  MAPA.pintarGlobo({ color: ext ? color(ext.g1) : null, titulo: "Extranjero", texto: ext ? `${titulo(ext.g1)}, ${pct(ext.p1)}` : "", elegido: estado.region === EXT,
    aria: ext ? `Peruanos en el extranjero: ganó ${titulo(ext.g1)} con ${pct(ext.p1)}. Elegir` : "Peruanos en el extranjero: sin datos en esta elección" });
  const orden = [...regs].filter((r) => r.parti != null).sort((a, b) => a.parti - b.parti);
  graf("g-reg").off("click"); graf("g-reg").on("click", (p) => elegirRegion(orden[p.dataIndex].d));
  graf("g-reg").setOption({ ...BASE(),
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } }, formatter: (ps) => `<strong>${ps[0].name}</strong><br>Participación: ${pct(ps[0].value)}` },
    grid: { left: 130, right: 54, top: 4, bottom: 4 },
    xAxis: { type: "value", show: false, max: 1 },
    yAxis: { type: "category", data: orden.map((r) => nombre(r.d)), triggerEvent: true, ...eje({ axisLine: { show: false }, splitLine: { show: false }, axisLabel: txt({ color: C.texto }) }) },
    series: [{ type: "bar", barMaxWidth: 10, cursor: "pointer", data: orden.map((r) => ({ value: r.parti, itemStyle: { color: r.d === estado.region ? C.navy : C.c1, borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: "right", fontSize: 12, color: C.texto, fontFamily: C.fuente, formatter: (p) => pct(p.value) } }],
  }, true);
  describir("g-reg", orden.length ? `Participación por región, de menor a mayor. Más baja: ${nombre(orden[0].d)}, ${pct(orden[0].parti)}; más alta: ${nombre(orden.at(-1).d)}, ${pct(orden.at(-1).parti)}.` : "Sin datos de participación.");
}

// Evolución de la región elegida frente al Perú (un indicador por gráfico)
function evolucion(s) {
  const sec = document.getElementById("evolucion-region");
  sec.hidden = !s.evolucion;
  if (!s.evolucion) return;
  const nom = nombre(estado.region), i = ELECCIONES.indexOf(estado.e);
  document.getElementById("t-ev-parti").textContent = `Participación en ${nom}, 1931-2026`;
  document.getElementById("t-ev-nv").textContent = `Voto no válido en ${nom}, 1963-2026`;
  for (const [id, region, peru, ind] of [["g-ev-parti", s.evolucion.parti, serie("NACION", 1, (r) => r.parti), "Participación"], ["g-ev-nv", s.evolucion.nv, serie("NACION", 1, nv), "Voto no válido"]]) {
    graf(id).setOption({ ...BASE(),
      tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => vv(p) != null && p.seriesName).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${pct(vv(p))}</strong>`).join("") },
      grid: { left: 48, right: 60, top: 20, bottom: 34 },
      xAxis: ejeAnios(id, 48, 60, ANIOS, { boundaryGap: false }),
      yAxis: { type: "value", min: 0, max: id === "g-ev-parti" ? 1 : null, ...ejePct() },
      series: [linea(nom, region, C.c1, { endLabel: finRotulo(), z: 3, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.navy, width: 1, type: "solid", opacity: 0.35 }, data: [{ xAxis: i }] } }),
        linea("Perú", peru, C.gris, { symbolSize: 6, lineStyle: { width: 2, color: C.gris }, endLabel: finRotulo() })],
    }, true);
    despegar(id, region.at(-1), peru.at(-1));
    describir(id, `${ind} en ${nom} frente al Perú, primera vuelta. En ${ANIOS.at(-1)}: ${pct(region.at(-1))} en ${nom} y ${pct(peru.at(-1))} en el Perú.`);
  }
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
let GEO = null;
Obs.iniciar("elecciones-presidenciales", async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo()]);
  GEO = geo;
  const t = Obs.tema();
  Object.assign(C, { navy: t.navy, lima: t.lima, c1: t.categorias[0], c2: t.categorias[1], c3: t.categorias[2], linea: t.linea, texto: t.texto, suave: t.textoSuave, fuente: t.fuente });
  FILAS = Obs.expandir(datos.tabla).map((f) => ({ ...f, d: datos.dic.distrito[f.d], g1: datos.dic.org[f.g1] ?? null, g2: datos.dic.org[f.g2] ?? null }));
  ELECCIONES = [...new Set(FILAS.map((f) => f.e))].sort((a, b) => a - b);
  ANIOS = ELECCIONES.map(String);
  DISTRITOS = [...new Set(FILAS.map((f) => f.d))].filter((d) => d !== "NACION" && d !== "TOTAL").sort((a, b) => nombre(a).localeCompare(nombre(b), "es"));
  document.getElementById("fuente").textContent = datos.fuente;

  selE.innerHTML = [...ELECCIONES].reverse().map((e) => `<option value="${e}">${e}</option>`).join("");
  selR.innerHTML = `<option value="" disabled>Elige una región</option>` + DISTRITOS.map((d) => `<option value="${d}">${nombre(d)}</option>`).join("");
  selE.onchange = () => actualizar({ e: +selE.value });
  selR.onchange = () => actualizar({ ambito: "regional", region: selR.value });
  document.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => actualizar({ v: +b.dataset.v })));
  document.querySelectorAll("[data-ambito]").forEach((b) => (b.onclick = () => actualizar(b.dataset.ambito === "nacional" ? { ambito: "nacional" } : { ambito: "regional", region: estado.region === "NACION" ? "LIMA" : estado.region })));
  // Pestañas (con flechas del teclado, como pide el patrón de tablist)
  TABS.forEach((b, k) => {
    b.onclick = () => actualizar({ pestana: b.dataset.pestana });
    b.onkeydown = (ev) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key]; if (!d) return; const o = TABS[(k + d + TABS.length) % TABS.length]; o.focus(); o.click(); };
  });

  // Estado inicial desde la URL (?modulo=eleccion&eleccion=2021&vuelta=2&region=CUSCO)
  const p = Obs.parametros();
  if (p.get("modulo") === "eleccion") estado.pestana = "eleccion";
  if (ELECCIONES.includes(+p.get("eleccion"))) estado.e = +p.get("eleccion");
  else estado.e = ELECCIONES.at(-1);
  if (p.get("vuelta") === "2" && hay2(estado.e)) estado.v = 2;
  const reg = (p.get("region") || "").toUpperCase();
  if (DISTRITOS.includes(reg)) Object.assign(estado, { ambito: "regional", region: reg });

  Obs.descarga({ archivos: ARCHIVOS });
  let espera, anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return; // en celular, la barra del navegador cambia solo el alto
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(render, 150);
  });
  render();
});
