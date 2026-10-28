/* =========================================================
   Tablero de Estados de emergencia — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma el Apps Script (Tableros > Publicar
   tableros) desde el Sheet «base_tablero_v2»:
     fact_disposiciones   una fila por disposición (id_disposicion, año_ds,
                          gobierno, tipo_emergencia, disposicion_tipo,
                          motivo_identificado, inmovilizacion, numero_dias,
                          codigo_ds…)
     regiones_long        una fila por disposición y región que abarca
     acciones_long        una fila por disposición y acción que ordena
   Las tablas largas se unen a la principal por id_disposicion.

   Cuatro pestañas: Panorama general (todos los tipos de emergencia) y una por
   tipo: perturbación del orden interno, catástrofe y emergencia sanitaria
   (el tipo «Otros» solo entra al panorama). Filtros comunes: período,
   gobierno y región (con clics en el mapa o la tabla de regiones). El gráfico
   por gobierno ignora el filtro de gobierno (lo resalta); el mapa y su tabla
   ignoran el de región (la resaltan). Patrón: `estado`, `filtrar()` y `render()`.

   Parámetros de URL:
     ?modulo=cat&desde=2010&hasta=2020&gobiernos=4-5&region=PUNO&medida=total
     (gobiernos: índices en orden cronológico; region: nombre del mapa)
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "estados-emergencia";
const ARCHIVOS = [{ clave: "estados_emergencia_base", etiqueta: "Estados de emergencia: disposiciones, regiones y acciones" }];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
// Pestañas por tipo de emergencia: clave de la pestaña -> texto en la base
const TIPOS = [
  { k: "poi", base: "Perturbación del orden interno", nombre: "Perturbación del orden interno", corto: "Orden interno", color: "--t-poi" },
  { k: "cat", base: "Catástrofe", nombre: "Catástrofe", corto: "Catástrofe", color: "--t-cat" },
  { k: "san", base: "Emergencia Sanitaria", nombre: "Emergencia sanitaria", corto: "Emergencia sanitaria", color: "--t-san" },
];
const MODULOS = ["general", ...TIPOS.map((t) => t.k)];
const DISPOSICIONES = [
  { base: "Declaratoria", nombre: "Declaratoria", color: "--d-declaratoria" },
  { base: "Prórroga", nombre: "Prórroga", color: "--d-prorroga" },
  { base: "Modificatoria", nombre: "Modificatoria", color: "--d-modificatoria" },
  { base: "Término", nombre: "Término", color: "--d-termino" },
];
// Gobiernos en orden cronológico, con sus fechas (el Sheet trae solo el apellido).
// Los días de gobierno se cuentan dentro del período elegido y de los datos.
const GOBIERNOS = [
  ["Fujimori", "Alberto Fujimori", "1990-07-28", "2000-11-22"], ["Paniagua", "Valentín Paniagua", "2000-11-22", "2001-07-28"],
  ["Toledo", "Alejandro Toledo", "2001-07-28", "2006-07-28"], ["García", "Alan García", "2006-07-28", "2011-07-28"],
  ["Humala", "Ollanta Humala", "2011-07-28", "2016-07-28"], ["Kuczynski", "Pedro Pablo Kuczynski", "2016-07-28", "2018-03-23"],
  ["Vizcarra", "Martín Vizcarra", "2018-03-23", "2020-11-10"], ["Merino", "Manuel Merino", "2020-11-10", "2020-11-15"],
  ["Sagasti", "Francisco Sagasti", "2020-11-17", "2021-07-28"], ["Castillo", "Pedro Castillo", "2021-07-28", "2022-12-07"],
  ["Boluarte", "Dina Boluarte", "2022-12-07", "2025-10-10"], ["Jerí", "José Jerí", "2025-10-10", "2026-02-18"],
  ["Balcázar", "José María Balcázar", "2026-02-18", "2026-07-28"], ["Keiko Fujimori", "Keiko Fujimori", "2026-07-28", null],
];
const DIA = 864e5;

const estado = { modulo: "general", desde: null, hasta: null, gobiernos: null, region: null, medida: "ritmo" };
const ORDEN = {}; // orden elegido de cada tabla: { clave, dir }
// Motivos con color propio en cada pestaña: los 4 más frecuentes de toda la base (fijos, para
// que el color siga al motivo aunque cambien los filtros); el resto va junto en «Otros motivos»
const MOTIVOS_COLOR = {};

let C, FILAS = [], GOB = [], ANIOS = [], FIN_DATOS, multiGob;
const mapas = {};

/* =========== Utilidades =========== */
const num = (v, dec = 0) => Obs.fmtN(v, dec);
const pct = (v) => Obs.fmtPct(v, 1);
const plural = (k, uno, varios) => `${num(k)} ${k === 1 ? uno : varios}`;
const txt = (x = {}) => ({ fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, ...x });
const todos = (sel, lista) => sel.size === lista.length;
const todosLos = (lista) => new Set(lista.map((_, i) => i));
const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const MES = 365.25 / 12; // días de un mes promedio
const ritmo = (n, dias) => (dias > 0 ? (n / dias) * MES : null);

// Lecturas: los datos que cambian con los filtros van destacados (negrita azul con línea lima)
const lectura = (id, html) => (document.getElementById(id).innerHTML = html);
const fuerte = (s) => `<strong>${s}</strong>`;
const destacar = (s) => fuerte(Obs.escapar(String(s)));
const enumerar = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

/* =========== Datos =========== */
// Región de la base -> nombre del polígono del mapa (sin tildes y en mayúsculas;
// la base separa Lima Metropolitana y Lima Provincias, como el mapa)
const REGION_MAPA = (r) => sinTildes(r).toUpperCase();
const nombreRegion = (cod) => NOMBRES_REGION.get(cod) ?? cod;
const NOMBRES_REGION = new Map();

function preparar(T) {
  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  // Variantes de escritura («Actividades Ilicitas» / «Actividades ilícitas»): se unen
  // y se muestra la forma más frecuente
  const unir = (valores) => {
    const grupos = new Map();
    for (const v of valores) {
      const k = sinTildes(v);
      if (!k) continue;
      const g = grupos.get(k) ?? new Map();
      g.set(v, (g.get(v) ?? 0) + 1);
      grupos.set(k, g);
    }
    return (v) => { const g = grupos.get(sinTildes(v)); return g ? [...g].sort((a, b) => b[1] - a[1] || (/[áéíóú]/i.test(b[0]) - /[áéíóú]/i.test(a[0])))[0][0] : ""; };
  };
  const base = Obs.expandir(T.fact_disposiciones);
  const motivo = unir(base.map((f) => limpio(f.motivo_identificado)));
  const regiones = new Map(), acciones = new Map();
  for (const f of Obs.expandir(T.regiones_long)) {
    const r = limpio(f.region);
    if (!r) continue;
    const cod = REGION_MAPA(r);
    NOMBRES_REGION.set(cod, r);
    (regiones.get(String(f.id_disposicion)) ?? regiones.set(String(f.id_disposicion), new Set()).get(String(f.id_disposicion))).add(cod);
  }
  const filasAccion = Obs.expandir(T.acciones_long);
  const accion = unir(filasAccion.map((f) => limpio(f.accion)));
  for (const f of filasAccion) {
    const a = accion(limpio(f.accion));
    if (a) (acciones.get(String(f.id_disposicion)) ?? acciones.set(String(f.id_disposicion), new Set()).get(String(f.id_disposicion))).add(a);
  }
  // gobiernos presentes, en orden cronológico; uno nuevo que no esté en la lista va al final
  const presentes = new Set(base.map((f) => limpio(f.gobierno)).filter(Boolean));
  GOB = [...GOBIERNOS.filter(([a]) => presentes.has(a)), ...[...presentes].filter((a) => !GOBIERNOS.some(([x]) => x === a)).map((a) => [a, a, null, null])]
    .map(([apellido, nombre, inicio, fin], i) => ({ i, apellido, nombre, inicio: inicio && Date.parse(inicio), fin: fin && Date.parse(fin) }));
  FILAS = base.map((f) => ({
    id: String(f.id_disposicion), anio: +f.año_ds, decreto: limpio(f.codigo_ds) || limpio(f.decreto_supremo),
    
    g: GOB.findIndex((x) => x.apellido === limpio(f.gobierno)),
    tipo: TIPOS.findIndex((t) => sinTildes(t.base) === sinTildes(f.tipo_emergencia)), // -1: Otros
    disp: DISPOSICIONES.findIndex((d) => sinTildes(d.base) === sinTildes(f.disposicion_tipo)),
    motivo: motivo(limpio(f.motivo_identificado)),
    inmov: sinTildes(f.inmovilizacion) === "si",
    dias: +f.numero_dias || 0,
  })).filter((f) => f.anio && f.g >= 0);
  for (const f of FILAS) { f.regiones = regiones.get(f.id) ?? new Set(); f.acciones = acciones.get(f.id) ?? new Set(); }
  // los 4 motivos más frecuentes de cada pestaña, en toda la base
  for (const m of MODULOS) {
    const t = TIPOS.findIndex((x) => x.k === m), c = new Map();
    for (const f of FILAS) if (f.motivo && (m === "general" || f.tipo === t)) c.set(f.motivo, (c.get(f.motivo) ?? 0) + 1);
    // el motivo «Otros» de la base va con el resto, en «Otros motivos»
    MOTIVOS_COLOR[m] = [...c].filter(([v]) => sinTildes(v) !== "otros").sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v);
  }
  const anios = FILAS.map((f) => f.anio);
  ANIOS = [Math.min(...anios), Math.max(...anios)];
  // los datos llegan hasta el 31 de diciembre de su último año (o hasta hoy, si es antes)
  FIN_DATOS = Math.min(Date.UTC(ANIOS[1], 11, 31) + DIA, Date.now());
}

// Días que gobernó cada gobierno dentro del período elegido
function diasGobierno(g, desde, hasta) {
  if (!g.inicio) return null;
  const a = Math.max(g.inicio, Date.UTC(desde, 0, 1)), z = Math.min(g.fin ?? FIN_DATOS, Date.UTC(hasta, 11, 31) + DIA, FIN_DATOS);
  return z > a ? Math.round((z - a) / DIA) : 0;
}

/* Subconjuntos: cada gráfico ignora su propio filtro */
function filtrar(e, tipo = null) {
  const enPeriodo = (f) => f.anio >= e.desde && f.anio <= e.hasta;
  const enTipo = (f) => tipo == null || f.tipo === tipo;
  const enG = (f) => e.gobiernos.has(f.g), enR = (f) => !e.region || f.regiones.has(e.region);
  const base = FILAS.filter((f) => enPeriodo(f) && enTipo(f));
  return {
    todo: base.filter((f) => enG(f) && enR(f)),
    sinGobierno: base.filter(enR),
    sinRegion: base.filter(enG),
  };
}

/* =========== Render =========== */
function render() {
  sincronizarControles();
  if (estado.modulo === "general") pintarGeneral(filtrar(estado));
  else pintarTipo(TIPOS.findIndex((t) => t.k === estado.modulo));
  pintarAplicados();
  escribirURL();
}
function escribirURL() {
  Obs.escribirURL({
    modulo: estado.modulo === "general" ? null : estado.modulo,
    desde: estado.desde === ANIOS[0] ? null : estado.desde, hasta: estado.hasta === ANIOS[1] ? null : estado.hasta,
    gobiernos: todos(estado.gobiernos, GOB) ? null : [...estado.gobiernos].sort((a, b) => a - b).join("-"),
    region: estado.region, medida: estado.medida === "ritmo" ? null : estado.medida,
  });
}

// Texto del alcance elegido, para los resúmenes
function alcance() {
  const e = estado, partes = [];
  partes.push(e.desde === e.hasta ? `En ${destacar(e.desde)}` : `Entre ${destacar(e.desde)} y ${destacar(e.hasta)}`);
  if (!todos(e.gobiernos, GOB)) {
    const g = [...e.gobiernos].sort((a, b) => a - b);
    partes.push(g.length === 1 ? `durante el gobierno de ${destacar(GOB[g[0]].nombre)}` : `durante ${destacar(g.length)} gobiernos elegidos`);
  }
  if (e.region) partes.push(`en ${destacar(nombreRegion(e.region))}`);
  return partes.join(", ");
}
const cuenta = (filas, campo) => { const m = new Map(); for (const f of filas) m.set(f[campo], (m.get(f[campo]) ?? 0) + 1); return m; };
const decretos = (filas) => new Set(filas.map((f) => f.decreto).filter(Boolean)).size;

/* =========== Pestaña: Panorama general =========== */
function pintarGeneral(s) {
  const filas = s.todo, n = filas.length;
  const porAnio = cuenta(filas, "anio");
  const pico = [...porAnio].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const porTipo = cuenta(filas, "tipo");
  const tipoTop = [...porTipo].sort((a, b) => b[1] - a[1])[0];
  const dias = [...estado.gobiernos].reduce((a, g) => a + (diasGobierno(GOB[g], estado.desde, estado.hasta) ?? 0), 0);
  const el = document.getElementById("r-general");
  if (!n) el.textContent = "No hay disposiciones con estos filtros. Quita alguno para ver datos.";
  else el.innerHTML = `${alcance()}, el Poder Ejecutivo dictó ${fuerte(plural(n, "disposición", "disposiciones"))} sobre estados de emergencia, en ${fuerte(plural(decretos(filas), "decreto supremo", "decretos supremos"))}. ` +
    `${tipoTop[1] / n > 0.5 ? "La mayoría" : "La mayor parte"} fue por ${destacar(Obs.minus(nombreTipo(tipoTop[0])))}: ${fuerte(pct(tipoTop[1] / n))}.`;
  Obs.kpi("k-general-total", { etiqueta: "Disposiciones", valor: num(n), pie: "Declaratorias, prórrogas, modificatorias y términos" });
  Obs.kpi("k-general-decretos", { etiqueta: "Decretos supremos", valor: num(decretos(filas)), pie: "Un decreto puede tener varias disposiciones" });
  Obs.kpi("k-general-ritmo", { etiqueta: "Por mes de gobierno", valor: n && dias ? num(ritmo(n, dias), 1) : "—", pie: "Disposiciones, en promedio" });
  Obs.kpi("k-general-anio", { etiqueta: "Año con más disposiciones", valor: pico ? String(pico[0]) : "—", pie: pico ? plural(pico[1], "disposición", "disposiciones") : "" });
  anualPorTipo(filas);
  anualPorDisposicion("general", filas, "disp-anual");
  porGobierno(s.sinGobierno);
  donaDisposicion("general", filas);
  donaMotivo("general", filas);
  regiones("general", s.sinRegion, "disposiciones");
}
const nombreTipo = (t) => (t >= 0 ? TIPOS[t].nombre : "Otros");
const colorTipo = (t) => (t >= 0 ? C.tipos[t] : C.otrosTipo);

// Años del período elegido
const aniosPeriodo = () => Array.from({ length: estado.hasta - estado.desde + 1 }, (_, i) => estado.desde + i);

/* ---------- Disposiciones por año: una línea por tipo de emergencia ----------
   Un clic en un año filtra el tablero a ese año; otro clic lo quita. */
function anualPorTipo(filas) {
  const id = "g-general-anual", anios = aniosPeriodo();
  const tipos = [...TIPOS.keys(), -1].filter((t) => filas.some((f) => f.tipo === t));
  const valores = (t) => anios.map((a) => filas.filter((f) => f.anio === a && f.tipo === t).length);
  const totales = anios.map((a) => filas.filter((f) => f.anio === a).length);
  // sin línea de total (aplastaba las demás): el total va en el tooltip
  const series = tipos.map((t) => ({ nombre: nombreTipo(t), color: colorTipo(t), valores: valores(t) }));
  document.getElementById("ley-general-anual").innerHTML = series.map((x) => `<span><i class="linea" style="background:${x.color}"></i>${x.nombre}</span>`).join("");
  if (!filas.length) { lectura("l-general-anual", ""); return Obs.vacio(id); }
  const max = Math.max(...totales), aMax = anios[totales.indexOf(max)];
  const tTop = [...cuenta(filas.filter((f) => f.anio === aMax), "tipo")].sort((a, b) => b[1] - a[1])[0];
  const primero = totales.find((v) => v > 0), iPrimero = totales.indexOf(primero);
  lectura("l-general-anual", `El año con más disposiciones fue ${destacar(aMax)}, con ${fuerte(num(max))}; ${fuerte(pct(tTop[1] / max))} de ellas por ${destacar(Obs.minus(nombreTipo(tTop[0])))}.` +
    (anios.length > 4 && iPrimero < anios.length - 1 ? ` En ${destacar(anios[iPrimero])} hubo ${fuerte(num(primero))}.` : ""));
  lineasAnuales(id, anios, series, { totales, alClic: (a) => actualizar(estado.desde === a && estado.hasta === a ? { desde: ANIOS[0], hasta: ANIOS[1] } : { desde: a, hasta: a }) });
  document.getElementById(id).setAttribute("aria-label", `Disposiciones por año y tipo de emergencia, de ${anios[0]} a ${anios.at(-1)}. Los datos están en la tabla de disposiciones.`);
}

/* Líneas por año, una escala, leyenda aparte (centrada, en HTML); sin cifras en cada punto:
   van en el tooltip. alClic(año): opcional. */
// totales: opcional, el total de cada año para el tooltip
function lineasAnuales(id, anios, series, { totales = null, alClic = null } = {}) {
  const el = document.getElementById(id);
  el.style.height = "360px";
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 600, unAnio = anios.length === 1;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animationDurationUpdate: ANIM ? 400 : 0,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.linea, width: 1.5 } },
      formatter: (ps) => `<strong>${ps[0].name}</strong>` + (totales ? `<br>Total: <strong>${num(totales[ps[0].dataIndex])}</strong>` : "") + ps.filter((p) => p.value).sort((a, b) => b.value - a.value)
        .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${num(p.value)}</strong>`).join("") + (alClic ? `<br><span style="opacity:.85">Clic para ver solo este año</span>` : "") },
    grid: { left: 48, right: 18, top: 14, bottom: 34 },
    xAxis: { type: "category", data: anios, boundaryGap: unAnio || anios.length < 4, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: angosto ? (anios.length > 10 ? 4 : 0) : anios.length > 16 ? 1 : 0 }) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: { ...txt(), formatter: (v) => num(v) } },
    series: series.map((x) => ({ name: x.nombre, type: "line", data: x.valores, symbol: "circle", symbolSize: x.total ? 9 : 7, z: x.total ? 3 : 2, cursor: alClic ? "pointer" : "default",
      lineStyle: { width: x.total ? 3.5 : 2, color: x.color }, itemStyle: { color: x.color, borderColor: "#fff", borderWidth: 1.5 }, emphasis: { focus: "series" } })),
  }, true);
  g.off("click");
  g.getZr().off("click");
  if (alClic) g.getZr().on("click", (e) => {
    if (!g.containPixel("grid", [e.offsetX, e.offsetY])) return;
    const i = g.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY])[0];
    if (anios[i] != null) { g.dispatchAction({ type: "hideTip" }); alClic(anios[i]); }
  });
  g.getZr().setCursorStyle?.(alClic ? "pointer" : "default");
}

/* ---------- Por gobierno: por mes de gobierno o total ----------
   Ignora el filtro de gobierno (lo resalta); un clic elige el gobierno. */
function porGobierno(filas) {
  const id = "g-general-gobierno";
  const n = cuenta(filas, "g");
  const items = GOB.map((g) => {
    const dias = diasGobierno(g, estado.desde, estado.hasta), k = n.get(g.i) ?? 0;
    return { clave: g.i, etiqueta: g.apellido, k, dias, r: ritmo(k, dias), valor: estado.medida === "total" ? k : ritmo(k, dias) };
  }).filter((d) => d.dias > 0 || d.k > 0);
  const conDatos = items.filter((d) => d.valor > 0);
  if (!conDatos.length) lectura("l-general-gobierno", "");
  else if (estado.medida === "total") {
    const a = conDatos.reduce((x, y) => (y.k > x.k ? y : x));
    lectura("l-general-gobierno", `${destacar(GOB[a.clave].nombre)} dictó más disposiciones: ${fuerte(num(a.k))}, en ${fuerte(plural(a.dias, "día", "días"))} de gobierno dentro del período.`);
  } else {
    const a = conDatos.reduce((x, y) => (y.r > x.r ? y : x)), z = conDatos.reduce((x, y) => (y.r < x.r ? y : x));
    lectura("l-general-gobierno", `Con ${destacar(GOB[a.clave].nombre)} hubo ${fuerte(num(a.r, 1))} disposiciones por mes de gobierno, el ritmo más alto` +
      (conDatos.length > 1 ? `; con ${destacar(GOB[z.clave].nombre)}, ${fuerte(num(z.r, 1))}, el más bajo.` : ".") +
      (conDatos.some((d) => d.dias < 60) ? " Con gobiernos muy breves, unas pocas disposiciones mueven mucho esta cifra." : ""));
  }
  if (!conDatos.length) return Obs.vacio(id);
  const fmt = (v) => (estado.medida === "total" ? num(v) : num(v, 1));
  const el = document.getElementById(id);
  el.style.height = "380px";
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 700;
  const sel = todos(estado.gobiernos, GOB) ? null : estado.gobiernos;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animationDurationUpdate: ANIM ? 400 : 0,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const d = conDatos[ps[0].dataIndex];
        return `<strong>${Obs.escapar(GOB[d.clave].nombre)}</strong><br>${plural(d.k, "disposición", "disposiciones")}<br>` +
          (d.dias ? `${plural(d.dias, "día", "días")} de gobierno en el período<br><strong>${num(d.r ?? 0, 1)}</strong> por mes de gobierno` : "") +
          `<br><span style="opacity:.85">Clic para filtrar el tablero</span>`; } },
    grid: { left: 44, right: 8, top: 26, bottom: angosto ? 74 : 40 },
    xAxis: { type: "category", data: conDatos.map((d) => d.etiqueta), triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ color: C.texto, interval: 0, rotate: angosto ? 45 : 0, hideOverlap: false }) },
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: { ...txt(), formatter: (v) => num(v) } },
    series: [{ type: "bar", barMaxWidth: 56, barCategoryGap: "30%", cursor: "pointer",
      data: conDatos.map((d) => ({ value: d.valor, itemStyle: { color: C.unica, borderRadius: [3, 3, 0, 0], opacity: sel && !sel.has(d.clave) ? 0.25 : 1 } })),
      // en el celular no caben las cifras sobre cada barra: quedan en el tooltip
      label: { show: !angosto, position: "top", distance: 6, formatter: (q) => fmt(q.value), ...txt({ color: C.texto, fontWeight: 700 }) } }],
  }, true);
  g.off("click");
  g.on("click", (q) => { g.dispatchAction({ type: "hideTip" }); alternar(conDatos[q.componentType === "xAxis" ? conDatos.findIndex((d) => d.etiqueta === q.value) : q.dataIndex].clave); });
  el.setAttribute("aria-label", `Disposiciones ${estado.medida === "total" ? "en total" : "por mes de gobierno"} de cada gobierno, en orden cronológico.`);
}

/* ---------- Mapa y tabla de regiones ----------
   Ignoran el filtro de región (la resaltan); un clic elige la región. */
function regiones(m, filas, unidad) {
  const porRegion = new Map();
  for (const f of filas) for (const r of f.regiones) porRegion.set(r, (porRegion.get(r) ?? 0) + 1);
  if (!mapas[m]) mapas[m] = new Obs.Mapa(`mapa-${m}`, Obs._geo_datos, { alClic: elegirRegion, nombre: nombreRegion });
  const escala = C.escala, distintos = new Set(porRegion.values());
  // todas las regiones con el mismo valor (la emergencia sanitaria): un solo color, sin tramos
  const cortes = distintos.size > 1 ? Obs.cortesCuantiles([...porRegion.values()]) : [];
  const color = distintos.size > 1 ? (v) => Obs.colorTramo(v, cortes, escala) : () => escala[3];
  mapas[m].pintar({ valores: porRegion, color, texto: (v) => `${num(v)} ${unidad}`, elegida: estado.region });
  const ley = document.getElementById(`ley-mapa-${m}`);
  if (cortes.length) Obs.leyendaTramos(`ley-mapa-${m}`, cortes, escala);
  else ley.innerHTML = porRegion.size ? `<span><i style="background:${escala[3]}"></i>${num([...distintos][0])} en cada región</span>` : "";
  const total = filas.length || 1;
  const lista = [...porRegion].map(([region, v]) => ({ region, nombre: nombreRegion(region), v }));
  tablaOrdenable(`t-${m}-region`, [
    { clave: "nombre", titulo: "Región", valor: (x) => x.nombre, html: (x) => Obs.escapar(x.nombre) },
    { clave: "v", titulo: "Disposiciones", num: true, valor: (x) => x.v, html: (x) => num(x.v) },
    { clave: "p", titulo: "Del total", num: true, valor: (x) => x.v, html: (x) => pct(x.v / total) },
  ], lista, { inicial: { clave: "v", dir: -1 }, desempate: (a, b) => a.nombre.localeCompare(b.nombre, "es"), claveFila: (x) => x.region,
    elegidas: new Set(estado.region ? [estado.region] : []), alClic: elegirRegion, descripcion: "Disposiciones por región" });
  if (!lista.length) return lectura(`l-${m}-region`, "");
  const max = Math.max(...lista.map((x) => x.v)), primeras = lista.filter((x) => x.v === max).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (primeras.length === lista.length && lista.length > 1)
    lectura(`l-${m}-region`, `Las ${fuerte(plural(filas.length, "disposición", "disposiciones"))} alcanzaron a las ${fuerte(num(lista.length))} regiones del país: fueron de alcance nacional.`);
  else lectura(`l-${m}-region`, (primeras.length === 1 ? `${destacar(primeras[0].nombre)} fue la región con más disposiciones` : `${enumerar(primeras.map((x) => destacar(x.nombre)))} fueron las regiones con más disposiciones`) +
    `: ${fuerte(num(max))}, ${fuerte(pct(max / total))} del total. ${fuerte(plural(lista.length, "región tuvo", "regiones tuvieron"))} al menos una.`);
}

/* =========== Pestañas por tipo de emergencia =========== */
function pintarTipo(t) {
  const { k } = TIPOS[t];
  const s = filtrar(estado, t), filas = s.todo, n = filas.length;
  const porDisp = cuenta(filas, "disp");
  const el = document.getElementById(`r-${k}`);
  if (!n) el.textContent = "No hay disposiciones de este tipo con estos filtros. Quita alguno para ver datos.";
  else {
    const mot = [...cuenta(filas, "motivo")].filter(([m]) => m).sort((a, b) => b[1] - a[1])[0];
    el.innerHTML = `${alcance()}, hubo ${fuerte(plural(n, "disposición", "disposiciones"))} de estado de emergencia por ${destacar(Obs.minus(TIPOS[t].nombre))}, ` +
      `en ${fuerte(plural(decretos(filas), "decreto supremo", "decretos supremos"))}. ` +
      `${fuerte(pct((porDisp.get(1) ?? 0) / n))} fueron prórrogas de estados de emergencia ya declarados` +
      (!mot ? "." : cuenta(filas, "motivo").size > 1 ? `, y el motivo más frecuente fue ${destacar(Obs.minus(mot[0]))}.` : `. Todas se dictaron por un solo motivo: ${destacar(mot[0])}.`);
  }
  Obs.kpi(`k-${k}-total`, { etiqueta: "Disposiciones", valor: num(n), pie: `En ${plural(decretos(filas), "decreto supremo", "decretos supremos")}` });
  Obs.kpi(`k-${k}-declaratorias`, { etiqueta: "Declaratorias", valor: num(porDisp.get(0) ?? 0), pie: "Estados de emergencia declarados" });
  Obs.kpi(`k-${k}-prorrogas`, { etiqueta: "Prórrogas", valor: num(porDisp.get(1) ?? 0), pie: n ? `${pct((porDisp.get(1) ?? 0) / n)} de las disposiciones` : "" });
  if (TIPOS[t].k === "san") {
    const si = filas.filter((f) => f.inmov).length;
    Obs.kpi(`k-${k}-extra`, { etiqueta: "Con inmovilización social", valor: n ? pct(si / n) : "—", pie: `${plural(si, "disposición", "disposiciones")} la ordenaron` });
  } else {
    const conDias = filas.filter((f) => f.dias > 0 && f.disp <= 1);
    const prom = conDias.length ? conDias.reduce((a, f) => a + f.dias, 0) / conDias.length : null;
    Obs.kpi(`k-${k}-extra`, { etiqueta: "Duración promedio", valor: prom ? `${num(prom)} días` : "—", pie: "De cada declaratoria o prórroga" });
  }
  anualPorDisposicion(k, filas);
  donaMotivo(k, filas); // primero: si se oculta, la dona de disposiciones toma todo el ancho
  donaDisposicion(k, filas);
  barrasDe(k, "accion", filas, (f) => [...f.acciones], "acción", "f");
  regiones(k, s.sinRegion, "disposiciones");
}

/* ---------- Disposiciones por año, una línea por tipo de disposición ---------- */
// sufijo: «anual» en las pestañas por tipo; «disp-anual» en el panorama (su «anual» es por tipo de emergencia)
function anualPorDisposicion(k, filas, sufijo = "anual") {
  const id = `g-${k}-${sufijo}`;
  // solo los años con datos de este tipo dentro del período (la emergencia sanitaria va de 2020 a 2022)
  const conDatos = filas.map((f) => f.anio);
  const anios = conDatos.length ? Array.from({ length: Math.max(...conDatos) - Math.min(...conDatos) + 1 }, (_, i) => Math.min(...conDatos) + i) : [];
  const disp = DISPOSICIONES.map((d, i) => ({ ...d, i, color: C.dispLineas[i], valores: anios.map((a) => filas.filter((f) => f.anio === a && f.disp === i).length) }))
    .filter((d) => d.valores.some((v) => v > 0));
  document.getElementById(`ley-${k}-${sufijo}`).innerHTML = disp.map((d) => `<span><i class="linea" style="background:${d.color}"></i>${d.nombre}</span>`).join("");
  if (!disp.length) { lectura(`l-${k}-${sufijo}`, ""); return Obs.vacio(id); }
  const tot = anios.map((_, j) => disp.reduce((a, d) => a + d.valores[j], 0));
  const max = Math.max(...tot), aMax = anios[tot.indexOf(max)];
  const prorr = disp.find((d) => d.i === 1), decl = disp.find((d) => d.i === 0);
  lectura(`l-${k}-${sufijo}`, `El año con más disposiciones fue ${destacar(aMax)}, con ${fuerte(num(max))}.` +
    (prorr && decl ? ` En todo el período hubo ${fuerte(num(prorr.valores.reduce((a, b) => a + b, 0)))} prórrogas por ${fuerte(num(decl.valores.reduce((a, b) => a + b, 0)))} declaratorias.` : ""));
  lineasAnuales(id, anios, disp.map((d) => ({ nombre: d.nombre, color: d.color, valores: d.valores })));
}

/* ---------- Donas: tipo de disposición y motivo ----------
   Partes de un todo con pocas categorías: dona con etiquetas directas (nombre y %),
   leyenda centrada arriba y el total en el centro. Colores fijos por categoría. */
function dona(id, partes, { total, unidad = "disposiciones" }) {
  const el = document.getElementById(id);
  if (!partes.length) return Obs.vacio(id);
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 460;
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animationDurationUpdate: ANIM ? 400 : 0,
    tooltip: { ...Obs.tooltipBase(), trigger: "item",
      formatter: (q) => `<strong>${Obs.escapar(q.name)}</strong><br><strong>${num(q.value)}</strong> ${unidad}<br>${pct(q.value / total)} del total` +
        (q.data.detalle ? `<br><span style="opacity:.85">${Obs.escapar(q.data.detalle)}</span>` : "") },
    // total en el centro de la dona
    title: { text: num(total), subtext: unidad, left: "center", top: angosto ? "42%" : "43%", itemGap: 2,
      textStyle: { fontFamily: C.fuente, fontSize: 24, fontWeight: 800, color: C.navy }, subtextStyle: { fontFamily: C.fuente, fontSize: 14, color: C.textoSuave } },
    series: [{
      type: "pie", radius: angosto ? ["44%", "66%"] : ["48%", "70%"], center: ["50%", "52%"], avoidLabelOverlap: true, minAngle: 2,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { show: !angosto, formatter: (q) => `{n|${q.name}}\n{p|${pct(q.value / total)}}`, color: C.texto,
        rich: { n: { fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, lineHeight: 18 }, p: { fontFamily: C.fuente, fontSize: 15, fontWeight: 700, color: C.texto, lineHeight: 20 } } },
      labelLine: { length: 10, length2: 10, lineStyle: { color: C.linea } },
      emphasis: { scale: true, scaleSize: 6, itemStyle: { borderWidth: 2 } },
      data: partes.map((d) => ({ name: d.nombre, value: d.valor, detalle: d.detalle, itemStyle: { color: d.color } })),
    }],
  }, true);
  el.setAttribute("aria-label", partes.map((d) => `${d.nombre}: ${num(d.valor)} (${pct(d.valor / total)})`).join("; "));
}
const leyenda = (id, partes) => (document.getElementById(id).innerHTML = partes.map((d) => `<span><i style="background:${d.color}"></i>${Obs.escapar(d.nombre)}</span>`).join(""));

function donaDisposicion(m, filas) {
  const c = cuenta(filas, "disp");
  const partes = DISPOSICIONES.map((d, i) => ({ nombre: d.nombre, valor: c.get(i) ?? 0, color: C.disp[i] })).filter((d) => d.valor > 0);
  leyenda(`ley-${m}-disp`, partes);
  dona(`g-${m}-disp`, partes, { total: filas.length });
  if (!partes.length) return lectura(`l-${m}-disp`, "");
  const top = partes.reduce((a, b) => (b.valor > a.valor ? b : a));
  const decl = c.get(0) ?? 0, prorr = c.get(1) ?? 0;
  const PLURAL = { Declaratoria: "Las declaratorias", Prórroga: "Las prórrogas", Modificatoria: "Las modificatorias", Término: "Los términos" };
  lectura(`l-${m}-disp`, `${PLURAL[top.nombre]} fueron el tipo más frecuente: ${fuerte(pct(top.valor / filas.length))} de las disposiciones.` +
    (decl && prorr ? ` Hubo ${fuerte(plural(decl, "declaratoria", "declaratorias"))} y ${fuerte(plural(prorr, "prórroga", "prórrogas"))}.` : ""));
}

function donaMotivo(m, filas) {
  const c = cuenta(filas.filter((f) => f.motivo), "motivo");
  // tonos de verde, del motivo más frecuente al cuarto (la dona de disposiciones, al lado, va en azules)
  const fijos = MOTIVOS_COLOR[m], colores = C.motivos;
  const partes = fijos.map((v, i) => ({ nombre: v, valor: c.get(v) ?? 0, color: colores[i] })).filter((d) => d.valor > 0);
  const otros = [...c].filter(([v]) => !fijos.includes(v)).sort((a, b) => b[1] - a[1]);
  if (otros.length) partes.push({ nombre: "Otros motivos", valor: otros.reduce((a, [, v]) => a + v, 0), color: C.otrosTipo,
    detalle: otros.slice(0, 4).map(([v, n]) => `${v} (${num(n)})`).join(", ") + (otros.length > 4 ? ` y ${otros.length - 4} más` : "") });
  // un solo motivo (la emergencia sanitaria, todo COVID-19): la tarjeta no dice nada nuevo y se oculta
  const solo = c.size < 2;
  document.getElementById(`c-${m}-motivo`).hidden = solo;
  document.getElementById(`par-${m}`).classList.toggle("solo", solo);
  if (solo) return;
  leyenda(`ley-${m}-motivo`, partes);
  dona(`g-${m}-motivo`, partes, { total: [...c.values()].reduce((a, b) => a + b, 0) });
  const top = [...c].sort((a, b) => b[1] - a[1])[0];
  lectura(`l-${m}-motivo`, `El motivo más frecuente fue ${destacar(top[0])}: ${fuerte(plural(top[1], "disposición", "disposiciones"))}, ${fuerte(pct(top[1] / filas.length))} del total.`);
}

/* ---------- Barras de acción ---------- */
function barrasDe(k, que, filas, valoresDe, nombre, genero) {
  const id = `g-${k}-${que}`;
  const m = new Map();
  for (const f of filas) for (const v of valoresDe(f)) m.set(v, (m.get(v) ?? 0) + 1);
  const items = [...m].map(([v, n]) => ({ clave: v, etiqueta: v, valor: n }));
  if (!items.length) { lectura(`l-${k}-${que}`, ""); return Obs.vacio(id); }
  const a = items.reduce((x, y) => (y.valor > x.valor ? y : x));
  lectura(`l-${k}-${que}`, `${genero === "f" ? "La" : "El"} ${nombre} más frecuente fue ${destacar(a.etiqueta)}: ${fuerte(plural(a.valor, "disposición", "disposiciones"))}, ` +
    `${fuerte(pct(a.valor / filas.length))} del total.`);
  Obs.barras(id, items, { formato: (v) => num(v), nombre: "Disposiciones", limite: 12 });
  Obs.grafico(id).setOption({ tooltip: { formatter: (ps) => {
    const d = [...items].sort((x, y) => y.valor - x.valor)[ps[0].dataIndex];
    return `<strong>${Obs.escapar(d.etiqueta)}</strong><br><strong>${plural(d.valor, "disposición", "disposiciones")}</strong><br>${pct(d.valor / filas.length)} de las disposiciones`;
  } } });
}

/* =========== Tabla ordenable ===========
   columnas: [{ clave, titulo, num, valor(fila), html(fila) }]
   Sin alClic, las filas no se pueden elegir. `limite`: cuántas filas se dibujan. */
function tablaOrdenable(id, columnas, filas, { inicial, desempate = () => 0, claveFila, elegidas, alClic, descripcion, vacia = null, limite = Infinity }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const cmp = (a, b) => { const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null) || desempate(a, b);
    const r = typeof x === "string" ? x.localeCompare(y, "es") : x - y; return r * orden.dir || desempate(a, b); };
  const datos = [...filas].sort(cmp).slice(0, limite);
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    const sentido = activo ? (orden.dir === 1 ? "ascending" : "descending") : "none";
    return `<th class="${c.num ? "num" : ""}" aria-sort="${sentido}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = alClic ? claveFila(f) : null;
    const atributos = alClic ? ` tabindex="0" data-k="${Obs.escapar(String(k))}"${elegidas && elegidas.has(k) ? ' class="elegida"' : ""}` : "";
    return `<tr${atributos}>${columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("")}</tr>`;
  }).join("");
  el.innerHTML = datos.length
    ? `<table class="tabla ordenable"><caption class="solo-lectores">${descripcion}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
    : `<p class="tabla-vacia">${vacia ?? "No hay filas con estos filtros. Quita alguno para ver datos."}</p>`;
  el.onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (b) {
      const c = columnas.find((x) => x.clave === b.dataset.orden);
      ORDEN[id] = col.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
      render();
      document.getElementById(id).querySelector(`button[data-orden="${c.clave}"]`)?.focus();
      return;
    }
    const fila = e.target.closest("tr[data-k]");
    if (fila && alClic) alClic(fila.dataset.k);
  };
  el.onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) alClic?.(e.target.dataset.k); };
}

/* =========== Filtros =========== */
// Un clic en un gobierno: si están todos, queda solo ese; con uno elegido, lo reemplaza; si no, se suma o se quita
function alternar(v) {
  const actual = estado.gobiernos;
  const reemplaza = todos(actual, GOB) || (actual.size === 1 && !actual.has(v));
  let nuevo = reemplaza ? new Set([v]) : new Set(actual);
  if (!reemplaza) nuevo.has(v) ? nuevo.delete(v) : nuevo.add(v);
  if (!nuevo.size) nuevo = todosLos(GOB);
  actualizar({ gobiernos: nuevo });
}
// Un clic en la región elegida la quita
const elegirRegion = (r) => actualizar({ region: estado.region === r ? null : r });

function pintarAplicados() {
  const chips = [];
  const chip = (texto, accion) => chips.push(`<button type="button" class="chip" data-quitar="${accion}" aria-label="Quitar el filtro ${Obs.escapar(texto)}">${Obs.escapar(texto)}<span aria-hidden="true">×</span></button>`);
  if (estado.desde !== ANIOS[0] || estado.hasta !== ANIOS[1]) chip(estado.desde === estado.hasta ? String(estado.desde) : `${estado.desde} a ${estado.hasta}`, "periodo");
  if (!todos(estado.gobiernos, GOB)) [...estado.gobiernos].sort((a, b) => a - b).forEach((i) => chip(GOB[i].nombre, `g:${i}`));
  if (estado.region) chip(nombreRegion(estado.region), "region");
  document.getElementById("aplicados").hidden = !chips.length;
  document.getElementById("aplicados-lista").innerHTML = chips.join("");
}

function sincronizarControles() {
  multiGob.sincronizar(estado.gobiernos);
  document.getElementById("f-desde").value = estado.desde;
  document.getElementById("f-hasta").value = estado.hasta;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  document.querySelectorAll("[data-medida]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.medida === estado.medida));
}

function actualizar(parche) {
  const cambioPestana = parche.modulo && parche.modulo !== estado.modulo;
  Object.assign(estado, parche);
  render();
  if (cambioPestana) requestAnimationFrame(() => { Obs.redimensionar(); render(); });
}

function montarControles() {
  const filtros = document.getElementById("filtros");
  const anios = Array.from({ length: ANIOS[1] - ANIOS[0] + 1 }, (_, i) => ANIOS[0] + i);
  const opciones = anios.map((a) => `<option value="${a}">${a}</option>`).join("");
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <span class="etiqueta" id="lbl-periodo">Período</span>
      <div class="rango" role="group" aria-labelledby="lbl-periodo">
        <select id="f-desde" class="corto" aria-label="Desde">${opciones}</select>
        <span>a</span>
        <select id="f-hasta" class="corto" aria-label="Hasta">${opciones}</select>
      </div>
    </div>`);
  // si «desde» queda después de «hasta», se corre el otro extremo
  document.getElementById("f-desde").onchange = (e) => { const d = +e.target.value; actualizar({ desde: d, hasta: Math.max(d, estado.hasta) }); };
  document.getElementById("f-hasta").onchange = (e) => { const h = +e.target.value; actualizar({ hasta: h, desde: Math.min(h, estado.desde) }); };
  multiGob = new Obs.Multiseleccion(filtros, {
    id: "f-gobiernos", etiqueta: "Gobierno", todos: "Todos los gobiernos",
    opciones: GOB.map((g) => ({ valor: g.i, etiqueta: g.nombre })), alCambiar: (sel) => actualizar({ gobiernos: sel }),
  });

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const sig = pestanas[(i + d + pestanas.length) % pestanas.length];
      sig.focus(); sig.click();
    };
  });
  document.querySelectorAll("[data-medida]").forEach((b) => (b.onclick = () => actualizar({ medida: b.dataset.medida })));


  document.getElementById("aplicados").onclick = (e) => {
    if (e.target.closest("#quitar-todo")) return actualizar({ desde: ANIOS[0], hasta: ANIOS[1], gobiernos: todosLos(GOB), region: null });
    const q = e.target.closest("[data-quitar]")?.dataset.quitar;
    if (!q) return;
    if (q === "periodo") return actualizar({ desde: ANIOS[0], hasta: ANIOS[1] });
    if (q === "region") return actualizar({ region: null });
    const nuevo = new Set(estado.gobiernos); nuevo.delete(+q.split(":")[1]);
    actualizar({ gobiernos: nuevo.size ? nuevo : todosLos(GOB) });
  };
}

function leerURL() {
  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const anio = (k, def) => { const v = +q.get(k); return Number.isInteger(v) && v >= ANIOS[0] && v <= ANIOS[1] ? v : def; };
  estado.desde = anio("desde", ANIOS[0]);
  estado.hasta = Math.max(estado.desde, anio("hasta", ANIOS[1]));
  const g = (q.get("gobiernos") || "").split("-").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < GOB.length);
  estado.gobiernos = g.length ? new Set(g) : todosLos(GOB);
  const r = q.get("region");
  estado.region = r && FILAS.some((f) => f.regiones.has(r)) ? r : null;
  if (q.get("medida") === "total") estado.medida = "total";
}

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  Obs._geo_datos = geo;
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(), tipos: TIPOS.map((t) => v(t.color)), otrosTipo: v("--t-otros"), disp: DISPOSICIONES.map((d) => v(d.color)), dispLineas: DISPOSICIONES.map((d) => v(d.color.replace("--d-", "--dl-"))), motivos: [1, 2, 3, 4].map((i) => v(`--mot-${i}`)) };
  preparar(datos.tablas);
  const [a, m, d] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";

  leerURL();
  montarControles();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
