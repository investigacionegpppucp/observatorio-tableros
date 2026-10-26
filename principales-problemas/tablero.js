/* =========================================================
   Tablero de Principales problemas del país — Observatorio para
   la Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script
   (Tableros > Publicar tableros), pestaña «Problemas del país».
   Una fila por año, ámbito y problema: Año (texto), Problema,
   Nivel (Nacional o Regional), region, region_ubicacion, Si y No
   (personas, con factores de expansión), Total, y las proporciones
   Si_p y No_p. El tablero usa Si_p («es un problema»).

   Los valores del Perú son los de la fila Nacional (ponderados por
   población); el informe de Looker mostraba el promedio simple de las
   regiones, que da cifras distintas.

   La región se identifica por su nombre (sin tildes, en mayúsculas),
   como en publica/mapas/peru_regiones.geojson. No se usa
   region_ubicacion: en 2024 San Martín viene con otro código.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una sola
   función `render()`.

   Parámetros de URL:
     ?problema=Corrupción&region=CUSCO&anio=2024
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "principales-problemas";
const ARCHIVOS = [{ clave: "principales_problemas_base", etiqueta: "Principales problemas del país por región y año (2013-2025)" }];
const NACIONAL = "NACIONAL";
const PROBLEMA_INICIAL = "Corrupción";
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const estado = { problema: PROBLEMA_INICIAL, region: NACIONAL, anio: null };

let FILAS = [], PROBLEMAS = [], REGIONES = [], ANIOS = [], C;
const NOMBRE_REGION = new Map([[NACIONAL, "Perú"]]);
const INDICE = new Map(); // "problema|región|año" -> fila
const COLOR_PROBLEMA = new Map(); // los cinco problemas más mencionados en el Perú; el resto va en gris

const pct = (v) => (v == null ? "—" : `${Obs.fmtN(v * 100, 1)}%`);
const pts = (v) => `${Obs.fmtN(Math.abs(v * 100), 1)} ${Math.abs(Math.round(v * 1000)) === 10 ? "punto" : "puntos"}`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const fila = (p, reg, anio) => INDICE.get(`${p}|${reg}|${anio}`) ?? null;
const enAmbito = (reg) => (reg === NACIONAL ? "en el Perú" : `en ${NOMBRE_REGION.get(reg)}`);
// Códigos del mapa: mayúsculas y sin tildes
const codigo = (nombre) => nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const colorProblema = (p) => COLOR_PROBLEMA.get(p) ?? C.gris;
// Los problemas sin color fijo van en gris; si hay más de uno, se distinguen por el trazo (guiones, puntos...)
const TRAZOS = ["dashed", "dotted", "dashed"];
const trazoDe = (nombres) => new Map(nombres.filter((p) => !COLOR_PROBLEMA.has(p)).map((p, i) => [p, TRAZOS[i % TRAZOS.length]]));

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(filas, e) {
  const ranking = filas.filter((f) => f.region === e.region && f.anio === e.anio).sort((a, b) => b.si - a.si);
  return {
    ranking, // todos los problemas, del más al menos mencionado
    serie: filas.filter((f) => f.problema === e.problema && f.region === e.region), // todos los años
    nacional: filas.filter((f) => f.problema === e.problema && f.region === NACIONAL),
    regiones: filas.filter((f) => f.problema === e.problema && f.anio === e.anio && f.region !== NACIONAL), // todas las regiones
  };
}

/* ---------- Resumen y cifras clave ---------- */
function cifras(s) {
  const f = fila(estado.problema, estado.region, estado.anio);
  const el = document.getElementById("resumen");
  const [uno, dos] = s.ranking;
  const ambito = `${NOMBRE_REGION.get(estado.region)}, ${estado.anio}`;
  if (uno) Obs.kpi("k-primero", { etiqueta: "Problema principal", texto: uno.problema, pie: `${pct(uno.si)}, ${Obs.escapar(ambito)}` });
  else Obs.kpi("k-primero", { etiqueta: "Problema principal", valor: "—" });
  if (dos) Obs.kpi("k-segundo", { etiqueta: "Segundo problema", texto: dos.problema, pie: `${pct(dos.si)}, ${Obs.escapar(ambito)}` });
  else Obs.kpi("k-segundo", { etiqueta: "Segundo problema", valor: "—" });
  if (!f) {
    el.textContent = `No hay datos de «${estado.problema}» ${enAmbito(estado.region)} en ${estado.anio}. Elige otro año.`;
    Obs.kpi("k-elegido", { etiqueta: estado.problema, valor: "—" });
    return;
  }
  const primero = s.serie[0];
  el.innerHTML = `En ${estado.anio}, el <strong>${pct(f.si)}</strong> de las personas ${Obs.escapar(enAmbito(estado.region))} señaló ` +
    `<strong>«${Obs.escapar(estado.problema)}»</strong> entre los principales problemas del país` +
    (primero && primero.anio !== estado.anio ? `; en ${primero.anio} era ${pct(primero.si)}.` : ".");
  const puesto = s.ranking.findIndex((x) => x.problema === estado.problema) + 1;
  const d = primero && primero.anio !== estado.anio ? f.si - primero.si : null;
  Obs.kpi("k-elegido", { etiqueta: estado.problema, valor: pct(f.si),
    pie: `${puesto}.º de ${s.ranking.length} problemas` + (d == null ? "" : `. ${Math.abs(d) < 0.0005 ? "Sin cambio" : `${pts(d)} ${d > 0 ? "más" : "menos"}`} que en ${primero.anio}`) });
}

/* ---------- Ranking de problemas ---------- */
function ranking(s) {
  Obs.barras("g-ranking", s.ranking.map((f) => ({ clave: f.problema, etiqueta: f.problema, valor: f.si })), {
    formato: pct, nombre: NOMBRE_REGION.get(estado.region), seleccion: new Set([estado.problema]), alClic: (p) => actualizar({ problema: p }),
  });
  // en pantallas angostas los nombres largos ocupan hasta cuatro líneas: más alto por fila
  const caja = document.getElementById("g-ranking");
  if (caja.clientWidth < 480) { caja.style.height = `${s.ranking.length * 56 + 16}px`; Obs.grafico("g-ranking").resize(); }
  document.getElementById("d-ranking").textContent =
    `Porcentaje de personas que mencionan cada problema ${enAmbito(estado.region)}, ${estado.anio}. Cada persona puede mencionar más de uno.`;
  const u = s.ranking[0], d = s.ranking[1];
  document.getElementById("g-ranking").setAttribute("aria-label", u && d ? `Principales problemas ${enAmbito(estado.region)} en ${estado.anio}. El primero es ${u.problema}, con ${pct(u.si)}; el segundo, ${d.problema}, con ${pct(d.si)}.` : "Principales problemas");
}

/* Línea de años de un tablero con el eje de porcentajes */
function ejes(anios, tope) {
  const ancho = document.getElementById("g-evol").clientWidth;
  return {
    grid: { left: 52, right: 24, top: 30, bottom: 30 },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % (ancho < 420 ? 3 : 2) === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => `${Math.round(v * 100)}%` }) },
  };
}
const redondeoTope = (vals) => Math.min(1, Math.ceil((Math.max(...vals.filter((v) => v != null)) + 0.05) * 10) / 10);
// los nulos iniciales se quitan: si no, el rótulo final de ECharts arranca en NaN
const pares = (vals, anios) => vals.map((v, i) => [String(anios[i]), v]).filter((p) => p[1] != null);
const clicEnAnio = (g, anios) => {
  g.off("click");
  g.getZr().off("click");
  g.getZr().on("click", (e) => { // clic en cualquier punto de la columna de un año
    if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
    if (anios[i] && anios[i] !== estado.anio) actualizar({ anio: anios[i] });
  });
};

/* ---------- Evolución del problema elegido ----------
   La línea del ámbito elegido; con una región, el Perú en gris como referencia. */
function evolucion(s) {
  const id = "g-evol", anios = ANIOS;
  const conRef = estado.region !== NACIONAL;
  const valores = (filas) => anios.map((a) => filas.find((f) => f.anio === a)?.si ?? null);
  const principal = valores(s.serie), ref = conRef ? valores(s.nacional) : [];
  document.getElementById("t-evol").textContent = `${estado.problema}, ${anios[0]}-${anios.at(-1)}`;
  document.getElementById("d-evol").textContent = `Porcentaje de personas que lo mencionan ${enAmbito(estado.region)}.`;
  document.getElementById("ley-evol").innerHTML = conRef
    ? `<span><i class="l" style="border-color:${C.unica}"></i>${Obs.escapar(NOMBRE_REGION.get(estado.region))}</span><span><i class="l" style="border-color:${C.gris}"></i>Perú</span>` : "";
  if (!principal.some((v) => v != null)) return Obs.vacio(id);
  const k = anios.indexOf(estado.anio);
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value[1])}</strong>`).join("") },
    ...ejes(anios, redondeoTope(principal.concat(ref))),
    series: [
      ...(conRef ? [{ name: "Perú", type: "line", data: pares(ref, anios), connectNulls: true, symbol: "circle", symbolSize: 6, z: 1,
        lineStyle: { width: 2, color: C.gris }, itemStyle: { color: C.gris }, emphasis: { disabled: true } }] : []),
      { name: NOMBRE_REGION.get(estado.region), type: "line", data: pares(principal, anios), connectNulls: true, symbol: "circle", symbolSize: 8, z: 3,
        lineStyle: { width: 2, color: C.unica }, itemStyle: { color: C.unica, borderColor: "#fff", borderWidth: 2 },
        markPoint: principal[k] != null ? { symbol: "circle", symbolSize: 14, itemStyle: { color: C.unica, borderColor: "#fff", borderWidth: 3 },
          label: { show: true, position: "top", distance: 8, formatter: () => pct(principal[k]), ...txt({ color: C.texto, fontWeight: 700 }) },
          data: [{ coord: [String(estado.anio), principal[k]] }] } : undefined },
    ],
  }, true);
  clicEnAnio(g, anios);
  document.getElementById(id).setAttribute("aria-label", `${estado.problema} ${enAmbito(estado.region)}: ` +
    anios.map((a, i) => (principal[i] == null ? null : `${a}, ${pct(principal[i])}`)).filter(Boolean).join("; ") + ".");
}

/* ---------- Los cinco problemas principales del año elegido, a lo largo del tiempo ----------
   El color sigue al problema: los cinco más mencionados en el Perú tienen color fijo; si en una región
   aparece otro, va en gris y se distingue por su nombre en la leyenda y en el globo. */
function principales(s) {
  const id = "g-top", anios = ANIOS;
  const top = s.ranking.slice(0, 5).map((f) => f.problema);
  const series = top.map((p) => ({ nombre: p, valores: anios.map((a) => fila(p, estado.region, a)?.si ?? null) }));
  document.getElementById("t-top").textContent = `Los cinco problemas principales de ${estado.anio}, a lo largo del tiempo`;
  document.getElementById("d-top").textContent = `Porcentaje de personas que mencionan cada uno ${enAmbito(estado.region)}.`;
  const trazo = trazoDe(top);
  document.getElementById("ley-top").innerHTML = series.map((x) => `<span><i class="l" style="border-color:${colorProblema(x.nombre)};border-top-style:${trazo.get(x.nombre) ?? "solid"}"></i>${Obs.escapar(x.nombre)}</span>`).join("");
  if (!series.length) return Obs.vacio(id);
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + [...ps].filter((p) => p.value[1] != null).sort((a, b) => b.value[1] - a.value[1])
        .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value[1])}</strong>`).join("") },
    ...ejes(anios, redondeoTope(series.flatMap((x) => x.valores))),
    series: series.map((x) => {
      const elegido = x.nombre === estado.problema, color = colorProblema(x.nombre);
      return { name: x.nombre, type: "line", data: pares(x.valores, anios), connectNulls: true, symbol: "circle", symbolSize: elegido ? 8 : 6, z: elegido ? 3 : 2,
        lineStyle: { width: elegido ? 3.5 : 2, color, type: trazo.get(x.nombre) ?? "solid" }, itemStyle: { color, borderColor: "#fff", borderWidth: 1.5 }, emphasis: { focus: "series" } };
    }),
  }, true);
  clicEnAnio(g, anios);
  document.getElementById(id).setAttribute("aria-label", `Evolución de los cinco problemas principales de ${estado.anio} ${enAmbito(estado.region)}: ` +
    series.map((x) => `${x.nombre}, ${pct(x.valores.at(-1))} en ${anios.at(-1)}`).join("; ") + ".");
}

/* ---------- Mapa y ranking regional ---------- */
let mapa;
function regiones(s) {
  document.getElementById("t-mapa").textContent = `${estado.problema}, por región, ${estado.anio}`;
  const valores = new Map(s.regiones.map((f) => [f.region, f.si * 100])); // en puntos porcentuales para los cortes
  if (!valores.size) { mapa.pintar({ valores, color: () => C.linea, texto: () => "", elegida: null }); document.getElementById("ley-mapa").innerHTML = ""; return Obs.vacio("g-regiones"); }
  const cortes = Obs.cortesCuantiles([...valores.values()]);
  mapa.pintar({ valores, color: (v) => Obs.colorTramo(v, cortes, C.escala), texto: (v) => pct(v / 100), elegida: estado.region === NACIONAL ? null : estado.region });
  Obs.leyendaTramos("ley-mapa", cortes, C.escala, (v) => `${Obs.fmtN(v, 0)}%`);
  Obs.barras("g-regiones", s.regiones.map((f) => ({ clave: f.region, etiqueta: NOMBRE_REGION.get(f.region), valor: f.si })), {
    formato: pct, nombre: estado.problema, seleccion: estado.region === NACIONAL ? null : new Set([estado.region]), alClic: elegirRegion,
  });
}

/* ---------- Controles ---------- */
const $ = (s) => document.querySelector(s);
function render() {
  $("#f-problema").value = estado.problema;
  $("#f-region").value = estado.region;
  $("#f-anio").value = estado.anio;
  const s = filtrar(FILAS, estado);
  cifras(s);
  ranking(s);
  evolucion(s);
  principales(s);
  regiones(s);
  Obs.escribirURL({
    problema: estado.problema === PROBLEMA_INICIAL ? null : estado.problema,
    region: estado.region === NACIONAL ? null : estado.region,
    anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (cod) => actualizar({ region: cod === estado.region ? NACIONAL : cod });

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../mapas/peru_regiones.geojson")]);
  const t = Obs.tema();
  C = { ...t, gris: "#9aa3b0" };

  FILAS = Obs.expandir(datos.tablas["Problemas del país"]).map((f) => {
    const nac = f.Nivel === "Nacional" || f.region === "Nacional";
    const nombre = String(f.region).trim();
    const cod = nac ? NACIONAL : codigo(nombre);
    if (!nac) NOMBRE_REGION.set(cod, nombre.replace(/^San Martin$/, "San Martín"));
    return { anio: +f["Año"], problema: String(f.Problema).trim(), region: cod, si: f.Si_p };
  });
  FILAS.forEach((f) => INDICE.set(`${f.problema}|${f.region}|${f.anio}`, f));
  PROBLEMAS = [...new Set(FILAS.map((f) => f.problema))].sort((a, b) => a.localeCompare(b, "es"));
  REGIONES = [...NOMBRE_REGION.keys()].filter((r) => r !== NACIONAL).sort((a, b) => NOMBRE_REGION.get(a).localeCompare(NOMBRE_REGION.get(b), "es"));
  ANIOS = [...new Set(FILAS.map((f) => f.anio))].sort((a, b) => a - b);
  estado.anio = ANIOS.at(-1);
  if (!PROBLEMAS.includes(estado.problema)) estado.problema = PROBLEMAS[0];

  // Color fijo para los cinco problemas más mencionados en el Perú, según su promedio de todos los años
  const prom = PROBLEMAS.map((p) => { const v = FILAS.filter((f) => f.problema === p && f.region === NACIONAL).map((f) => f.si); return [p, v.reduce((a, b) => a + b, 0) / (v.length || 1)]; })
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  prom.forEach(([p], i) => COLOR_PROBLEMA.set(p, C.categorias[i]));

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-problema").innerHTML = PROBLEMAS.map((p) => opcion(p, p)).join("");
  $("#f-region").innerHTML = opcion(NACIONAL, "Perú (nacional)") + REGIONES.map((r) => opcion(r, NOMBRE_REGION.get(r))).join("");
  $("#f-anio").innerHTML = [...ANIOS].reverse().map((a) => opcion(a, a)).join("");
  $("#f-problema").onchange = (e) => actualizar({ problema: e.target.value });
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });

  // Estado inicial desde la URL
  const p = Obs.parametros();
  const prob = PROBLEMAS.find((x) => x.toLowerCase() === (p.get("problema") || "").toLowerCase());
  if (prob) estado.problema = prob;
  const reg = codigo(p.get("region") || "");
  if (NOMBRE_REGION.has(reg)) estado.region = reg;
  if (ANIOS.includes(+p.get("anio"))) estado.anio = +p.get("anio");

  mapa = new Obs.Mapa("mapa-regiones", geo, { alClic: elegirRegion, nombre: (r) => NOMBRE_REGION.get(r) ?? r });
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
