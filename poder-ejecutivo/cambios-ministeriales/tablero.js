/* =========================================================
   Tablero de Cambios ministeriales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, exportado desde Sheets por el Apps Script
   (apps-script/exportar-json/). Todo se calcula desde la tabla
   «Cambios Ministeriales» (una fila por ministro y gabinete) y las
   fechas de cada gobierno de «Cambios por días». «Ministros total»,
   «Personas» y «Quinquenio» no se usan: se derivan de la primera
   (en el Sheet, el quinquenio 2021-2026 cuenta filas en vez de ministros).

   Definiciones (las del informe de Looker):
     ministro   una persona en un ministerio durante un gobierno (gestión)
     cambios    ministros nombrados − ministerios con que empezó el grupo
     días/cambio días de gobierno ÷ cambios; el gobierno en curso cuenta hasta hoy

   Tres pestañas. Filtros comunes: Presidente y Ministerio (selección
   múltiple, también con clics en los gráficos) y Sexo. Cada gráfico
   ignora el filtro de su propia categoría y resalta lo elegido.
   Patrón: un objeto `estado`, una función pura `filtrar()` y una sola
   función `render()`. Las tablas se ordenan por cualquier columna.

   Parámetros de URL:
     ?modulo=ministros|rotacion|personas
     &presidentes=7-8&ministerios=0-3   (índices, en orden cronológico / alfabético)
     &sexo=Mujer|Hombre&persona=<nombre>
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "cambios-ministeriales";
const ARCHIVOS = [{ clave: "cambios_ministeriales_base", etiqueta: "Cambios ministeriales (2001-2026)" }];
const MODULOS = ["ministros", "rotacion", "personas"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const estado = { modulo: "ministros", presidentes: null, ministerios: null, sexo: "todos", persona: null };

let C, GOB = [], MIN = [], FILAS = [], GESTIONES = [], QUINQ = [], HOY;
let multiPres, multiMin;
const ORDEN = {}; // orden elegido de cada tabla: { clave, dir }

/* ---------- Fechas y formato ---------- */
const dia = (s) => { const [a, m, d] = s.split("-").map(Number); return Date.UTC(a, m - 1, d) / 864e5; };
const fecha = (n) => new Date(n * 864e5).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const anio = (n) => new Date(n * 864e5).getUTCFullYear();
const num = (v) => Obs.fmtN(v);
const pct = (v) => Obs.fmtPct(v, 1);
const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
const corto = (nombre) => nombre.trim().split(/\s+/).at(-1); // «Pedro Pablo Kuczynski» -> «Kuczynski»
const txt = (x = {}) => ({ fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, ...x });
const todos = (sel, lista) => sel.size === lista.length;

/* ---------- Datos ---------- */
function preparar(T) {
  const hoy = new Date();
  HOY = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) / 864e5;

  // Gobiernos en orden cronológico, con sus fechas; el que no tiene fin está en curso
  const cg = Obs.expandir(T["Cambios por días"]);
  GOB = cg.map((g) => ({ nombre: g.Presidente.trim(), inicio: dia(g["Fecha_publicación_Nombramiento"]), fin: g["Fecha_publicación_Renuncia"] ? dia(g["Fecha_publicación_Renuncia"]) : null }))
    .sort((a, b) => a.inicio - b.inicio)
    .map((g, i) => ({ ...g, i, corto: corto(g.nombre), enCurso: g.fin == null, dias: (g.fin ?? HOY) - g.inicio }));
  const iGob = new Map(GOB.map((g) => [g.nombre, g.i]));

  // Una fila por ministro y gabinete. Los nombres traen espacios de más en el Sheet.
  const crudas = Obs.expandir(T["Cambios Ministeriales"]);
  MIN = [...new Set(crudas.map((f) => f.Ministerio.trim()))].sort((a, b) => a.localeCompare(b, "es"));
  const iMin = new Map(MIN.map((m, i) => [m, i]));
  FILAS = crudas.map((f) => {
    const desde = dia(f["Fecha_publicación_Nombramiento"]);
    const hasta = f["Fecha_publicación_Renuncia"] ? dia(f["Fecha_publicación_Renuncia"]) : null;
    return { p: iGob.get(f.Presidente.trim()), m: iMin.get(f.Ministerio.trim()), nombre: f.Nombre.trim(), sexo: f.Sexo, gabinete: f.Gabinete.trim(),
      desde, hasta, dias: hasta == null ? HOY - desde : f["Días"] };
  });

  // Gestión: una persona en un ministerio durante un gobierno (suma sus gabinetes)
  const porClave = new Map();
  for (const f of FILAS) {
    const k = `${f.p}|${f.m}|${f.nombre}`;
    let g = porClave.get(k);
    if (!g) porClave.set(k, (g = { k, p: f.p, m: f.m, nombre: f.nombre, sexo: f.sexo, desde: f.desde, hasta: f.hasta, dias: 0, gabinetes: 0, enCurso: false }));
    g.desde = Math.min(g.desde, f.desde);
    g.enCurso ||= f.hasta == null;
    g.hasta = g.enCurso ? null : Math.max(g.hasta, f.hasta);
    g.dias += f.dias;
    g.gabinetes++;
  }
  GESTIONES = [...porClave.values()];

  // Quinquenios: cada gobierno va al quinquenio en que empezó; los días son la suma de los de sus gobiernos
  const q = Obs.expandir(T["Quinquenio"]).map((x) => ({ nombre: x.Quinquenio, inicio: dia(x.Fecha_inicio) })).sort((a, b) => a.inicio - b.inicio);
  QUINQ = q.map((x, k) => ({ ...x, gobiernos: GOB.filter((g) => g.inicio >= x.inicio && (k === q.length - 1 || g.inicio < q[k + 1].inicio)).map((g) => g.i) }))
    .filter((x) => x.gobiernos.length);
}

/* Subconjuntos de gestiones. Cada gráfico ignora el filtro de su propia categoría. */
function filtrar(e) {
  const enP = (g) => e.presidentes.has(g.p), enM = (g) => e.ministerios.has(g.m), enS = (g) => e.sexo === "todos" || g.sexo === e.sexo;
  return {
    todo: GESTIONES.filter((g) => enP(g) && enM(g) && enS(g)),
    sinMinisterio: GESTIONES.filter((g) => enP(g) && enS(g)),
    sinPresidente: GESTIONES.filter((g) => enM(g) && enS(g)),
    sinCruce: GESTIONES.filter(enS),
    // la rotación no se divide por sexo: un cambio es un cambio
    rotacion: GESTIONES.filter(enM),
  };
}

/* Rotación de un grupo de gestiones: cambios = ministros − ministerios distintos */
function rotacion(gestiones, dias) {
  const ministerios = new Set(gestiones.map((g) => g.m)).size;
  const cambios = gestiones.length - ministerios;
  return { ministros: gestiones.length, ministerios, cambios, dias, porCambio: cambios > 0 ? dias / cambios : null };
}
const rotacionGobierno = (g, gestiones) => ({ ...rotacion(gestiones.filter((x) => x.p === g.i), g.dias), g,
  gabinetes: new Set(FILAS.filter((f) => f.p === g.i).map((f) => f.gabinete)).size });

/* =========== Render =========== */
function render() {
  sincronizarControles();
  const s = filtrar(estado);
  ({ ministros: pintarMinistros, rotacion: pintarRotacion, personas: pintarPersonas })[estado.modulo](s);
  pintarAplicados();
  Obs.escribirURL({
    modulo: estado.modulo === "ministros" ? null : estado.modulo,
    presidentes: todos(estado.presidentes, GOB) ? null : [...estado.presidentes].sort((a, b) => a - b).join("-"),
    ministerios: todos(estado.ministerios, MIN) ? null : [...estado.ministerios].sort((a, b) => a - b).join("-"),
    sexo: estado.sexo === "todos" ? null : estado.sexo,
    persona: estado.modulo === "personas" ? estado.persona : null,
  });
}

// Texto para el resumen según lo elegido
function alcance() {
  const p = todos(estado.presidentes, GOB) ? "" : estado.presidentes.size === 1 ? ` con ${GOB[[...estado.presidentes][0]].nombre}` : ` en ${estado.presidentes.size} gobiernos`;
  const m = todos(estado.ministerios, MIN) ? "" : estado.ministerios.size === 1 ? ` en ${MIN[[...estado.ministerios][0]]}` : ` en ${estado.ministerios.size} ministerios`;
  return p + m;
}
const contexto = (principal, secundario) => `<strong class="kpi-quien">${Obs.escapar(principal)}</strong>${secundario ? `<span class="kpi-cuando">${Obs.escapar(secundario)}</span>` : ""}`;
const vacioKpis = (ids) => ids.forEach((id) => Obs.kpi(id, { etiqueta: "Sin datos", valor: "—" }));

/* ---------- Pestaña 1: ¿Cuántos ministros hubo? ---------- */
function pintarMinistros(s) {
  const g = s.todo;
  const personas = new Set(g.map((x) => x.nombre));
  const mujeres = new Set(g.filter((x) => x.sexo === "Mujer").map((x) => x.nombre));
  const quienes = estado.sexo === "Mujer" ? ["ministra", "ministras"] : estado.sexo === "Hombre" ? ["ministro hombre", "ministros hombres"] : ["ministro", "ministros"];
  document.getElementById("r-ministros").innerHTML = g.length
    ? `Desde 2001${Obs.escapar(alcance())} se nombraron <strong>${plural(g.length, ...quienes)}</strong>:
       ${plural(personas.size, "persona distinta", "personas distintas")} ocuparon esos cargos.`
    : "No hay ministros con estos filtros. Quita alguno para ver datos.";
  if (!g.length) vacioKpis(["k-nombrados", "k-personas", "k-mujeres"]);
  else {
    const repetidas = g.length - personas.size;
    Obs.kpi("k-nombrados", { etiqueta: "Ministros nombrados", valor: num(g.length), pie: contexto(`en ${plural(new Set(g.map((x) => x.p)).size, "gobierno", "gobiernos")}`, "una persona por ministerio y gobierno") });
    Obs.kpi("k-personas", { etiqueta: "Personas distintas", valor: num(personas.size), pie: contexto(repetidas ? `${plural(repetidas, "repetición", "repeticiones")}` : "nadie repitió", "quienes volvieron a otro ministerio o gobierno") });
    const gm = g.filter((x) => x.sexo === "Mujer").length;
    Obs.kpi("k-mujeres", { etiqueta: "Mujeres entre las personas", valor: pct(mujeres.size / personas.size), pie: contexto(plural(mujeres.size, "mujer", "mujeres"), `con ${plural(gm, "nombramiento", "nombramientos")} de ${num(g.length)}`) });
  }

  matriz(s.sinCruce);
  barrasSexo("g-por-ministerio", MIN.map((m, i) => ({ clave: i, etiqueta: m, filas: s.sinMinisterio.filter((x) => x.m === i) })),
    { seleccion: estado.ministerios, total: MIN.length, alClic: (i) => alternar("ministerios", i, MIN), ordenar: true, izq: 280 });
  barrasSexo("g-por-gobierno", GOB.map((p) => ({ clave: p.i, etiqueta: p.nombre, sub: anios(p), filas: s.sinPresidente.filter((x) => x.p === p.i) })),
    { seleccion: estado.presidentes, total: GOB.length, alClic: (i) => alternar("presidentes", i, GOB), izq: 200 });
  porAnio(g);
}
const anios = (p) => (anio(p.inicio) === anio(p.fin ?? HOY) ? `${anio(p.inicio)}` : `${anio(p.inicio)}-${p.enCurso ? "hoy" : anio(p.fin)}`);

// Matriz gobierno × ministerio: lo memorable del tablero. Ignora los filtros de presidente y ministerio y resalta lo elegido.
function matriz(gestiones) {
  const id = "g-matriz";
  const cuenta = new Map();
  for (const g of gestiones) cuenta.set(`${g.p}|${g.m}`, (cuenta.get(`${g.p}|${g.m}`) ?? 0) + 1);
  const max = Math.max(1, ...cuenta.values());
  const el = document.getElementById(id);
  el.style.height = `${MIN.length * 32 + 70}px`;
  // en celular la columna de ministerios se acorta y la matriz se desliza hacia el costado
  const angosto = el.parentElement.clientWidth < 700, izq = angosto ? 150 : 290;
  const gr = Obs.grafico(id);
  gr.resize();
  const elegida = (p, m) => estado.presidentes.has(p) && estado.ministerios.has(m);
  const algo = !todos(estado.presidentes, GOB) || !todos(estado.ministerios, MIN);
  const color = (v) => C.escala[Math.min(4, Math.ceil((v / max) * 5) - 1)];
  const datos = [];
  GOB.forEach((p) => MIN.forEach((m, j) => {
    const v = cuenta.get(`${p.i}|${j}`) ?? 0;
    const op = algo && !elegida(p.i, j) ? 0.22 : 1;
    datos.push({ value: [p.i, j, v], itemStyle: { color: v ? color(v) : "#f4f6f9", borderColor: "#fff", borderWidth: 2, opacity: op },
      label: { show: v > 0, color: v / max > 0.55 ? "#fff" : C.navy, opacity: op } });
  }));
  document.getElementById("ley-matriz").innerHTML = `<span>1</span><i style="background:linear-gradient(90deg,${C.escala.join(",")})"></i><span>${max} ministros</span>`;
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: false,
    tooltip: { ...Obs.tooltipBase(), formatter: (q) => {
      const [p, m, v] = q.value;
      return `<strong>${Obs.escapar(MIN[m])}</strong><br>${Obs.escapar(GOB[p].nombre)} (${anios(GOB[p])})<br>${v ? `<strong>${plural(v, "ministro", "ministros")}</strong>` : "Sin ministros con estos filtros"}`;
    } },
    grid: { left: izq, right: 8, top: 44, bottom: 8 },
    xAxis: { type: "category", position: "top", data: GOB.map((p) => p.corto), triggerEvent: true, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: txt({ color: C.texto, fontWeight: 700, interval: 0, formatter: (v, i) => `{n|${v}}\n{a|${angosto ? anios(GOB[i]).replace(/-(\d\d)(\d\d)$/, "-$2") : anios(GOB[i])}}`,
        rich: { n: txt({ color: C.texto, fontWeight: 700, lineHeight: 18 }), a: txt({ lineHeight: 16 }) } }), splitArea: { show: false } },
    yAxis: { type: "category", inverse: true, data: MIN, triggerEvent: true, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: txt({ color: C.texto, width: izq - 10, overflow: "truncate" }) },
    series: [{ type: "heatmap", data: datos, cursor: "pointer", label: { show: true, fontFamily: C.fuente, fontSize: 14, fontWeight: 700 },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 2 } } }],
  }, true);
  gr.off("click");
  gr.on("click", (q) => {
    gr.dispatchAction({ type: "hideTip" }); // el gráfico se redibuja: sin esto la burbuja queda huérfana
    if (q.componentType === "xAxis") return alternar("presidentes", GOB.findIndex((p) => p.corto === q.value), GOB);
    if (q.componentType === "yAxis") return alternar("ministerios", MIN.indexOf(q.value), MIN);
    const [p, m] = q.value;
    // una celda elige ese par; otro clic en la misma celda lo quita
    const ya = estado.presidentes.size === 1 && estado.presidentes.has(p) && estado.ministerios.size === 1 && estado.ministerios.has(m);
    actualizar(ya ? { presidentes: todosLos(GOB), ministerios: todosLos(MIN) } : { presidentes: new Set([p]), ministerios: new Set([m]) });
  });
}

// Barras horizontales apiladas por sexo. Alto fijo (el de su par), así las dos tarjetas miden lo mismo.
function barrasSexo(id, items, { seleccion, total, alClic, ordenar = false, izq = 220 }) {
  const datos = items.map((d) => ({ ...d, mujer: d.filas.filter((x) => x.sexo === "Mujer").length, hombre: d.filas.filter((x) => x.sexo === "Hombre").length }));
  if (ordenar) datos.sort((a, b) => b.mujer + b.hombre - (a.mujer + a.hombre));
  if (!datos.some((d) => d.mujer + d.hombre)) return Obs.vacio(id);
  const gr = Obs.grafico(id);
  const elegidos = seleccion.size < total;
  const op = (d) => (elegidos && !seleccion.has(d.clave) ? 0.25 : 1);
  const angosto = document.getElementById(id).clientWidth < 480;
  const izquierda = angosto ? Math.round(izq * 0.62) : izq;
  const serie = (nombre, campo, color, ultimo) => ({
    name: nombre, type: "bar", stack: "t", barMaxWidth: 22, barCategoryGap: "30%", cursor: "pointer",
    data: datos.map((d) => ({ value: d[campo], itemStyle: { color, opacity: op(d) } })),
    label: ultimo ? { show: true, position: "right", distance: 6, formatter: (q) => num(datos[q.dataIndex].mujer + datos[q.dataIndex].hombre), ...txt({ color: C.texto, fontWeight: 700 }) } : { show: false },
  });
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const d = datos[ps[0].dataIndex]; const t = d.mujer + d.hombre;
        return `<strong>${Obs.escapar(d.etiqueta)}</strong>${d.sub ? ` (${d.sub})` : ""}<br>${plural(t, "ministro", "ministros")}` +
          (t ? `<br>Mujeres: <strong>${num(d.mujer)}</strong> (${pct(d.mujer / t)})<br>Hombres: <strong>${num(d.hombre)}</strong>` : ""); } },
    grid: { left: izquierda, right: 44, top: 4, bottom: 4 },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: datos.map((d) => d.etiqueta), triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), width: izquierda - 10, overflow: "truncate", formatter: (v, i) => (datos[i].sub ? `{n|${v}}\n{a|${datos[i].sub}}` : v),
        rich: { n: txt({ color: C.texto, fontWeight: 700, lineHeight: 18 }), a: txt({ lineHeight: 17 }) } } },
    series: [serie("Mujeres", "mujer", C.mujer, false), serie("Hombres", "hombre", C.hombre, true)],
  }, true);
  gr.off("click");
  gr.on("click", (q) => { gr.dispatchAction({ type: "hideTip" }); alClic(q.componentType === "yAxis" ? datos.find((d) => d.etiqueta === q.value).clave : datos[q.dataIndex].clave); });
}

// Nombramientos por año (año en que la persona juró el cargo), apilados por sexo
function porAnio(gestiones) {
  const id = "g-por-anio";
  if (!gestiones.length) return Obs.vacio(id);
  const desde = anio(GOB[0].inicio), hasta = anio(HOY);
  const lista = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
  const cuenta = (sexo) => lista.map((a) => gestiones.filter((g) => g.sexo === sexo && anio(g.desde) === a).length);
  const m = cuenta("Mujer"), h = cuenta("Hombre");
  const gr = Obs.grafico(id);
  const ancho = document.getElementById(id).clientWidth;
  const paso = ancho < 600 ? 5 : ancho < 900 ? 2 : 1;
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const i = ps[0].dataIndex, t = m[i] + h[i];
        const quienes = GOB.filter((p) => anio(p.inicio) <= lista[i] && anio(p.fin ?? HOY) >= lista[i]).map((p) => p.corto).join(", ");
        return `<strong>${lista[i]}</strong> (${quienes})<br>${plural(t, "nombramiento", "nombramientos")}<br>Mujeres: <strong>${num(m[i])}</strong><br>Hombres: <strong>${num(h[i])}</strong>`; } },
    grid: { left: 44, right: 12, top: 24, bottom: 30 },
    xAxis: { type: "category", data: lista, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (lista[i] - desde) % paso === 0 }) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [
      { name: "Mujeres", type: "bar", stack: "t", data: m, itemStyle: { color: C.mujer }, barCategoryGap: "28%" },
      { name: "Hombres", type: "bar", stack: "t", data: h, itemStyle: { color: C.hombre, borderRadius: [2, 2, 0, 0] },
        label: { show: ancho >= 900, position: "top", formatter: (q) => (m[q.dataIndex] + h[q.dataIndex] || ""), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
}

/* ---------- Pestaña 2: ¿Cada cuánto cambian? ---------- */
function pintarRotacion(s) {
  const filas = GOB.map((g) => rotacionGobierno(g, s.rotacion));
  const elegidas = filas.filter((r) => estado.presidentes.has(r.g.i));
  const conCambios = elegidas.filter((r) => r.cambios > 0);
  const dias = conCambios.reduce((t, r) => t + r.dias, 0), cambios = conCambios.reduce((t, r) => t + r.cambios, 0);
  const ord = [...conCambios].sort((a, b) => a.porCambio - b.porCambio);
  const masRot = ord[0], masEst = ord.at(-1);

  document.getElementById("r-rotacion").innerHTML = cambios
    ? `${alcance() ? "Con estos filtros, h" : "Desde 2001, h"}ubo en promedio <strong>un cambio de ministro cada ${plural(Math.round(dias / cambios), "día", "días")}</strong>.
       ${ord.length > 1 ? `El gobierno con más rotación fue el de ${Obs.escapar(masRot.g.nombre)}: un cambio cada ${plural(Math.round(masRot.porCambio), "día", "días")}.` : ""}`
    : "No hubo cambios de ministro con estos filtros. El gobierno en curso todavía no cambió a ningún ministro.";
  if (!cambios) vacioKpis(["k-promedio", "k-mas-rotacion", "k-mas-estable"]);
  else {
    Obs.kpi("k-promedio", { etiqueta: "Días por cambio", valor: `${num(Math.round(dias / cambios))} días`, pie: contexto(plural(cambios, "cambio", "cambios"), `en ${plural(dias, "día", "días")} de gobierno`) });
    Obs.kpi("k-mas-rotacion", { etiqueta: "Más rotación", valor: `${num(Math.round(masRot.porCambio))} días`, pie: contexto(masRot.g.nombre, `${plural(masRot.cambios, "cambio", "cambios")} en ${plural(masRot.dias, "día", "días")}`) });
    Obs.kpi("k-mas-estable", { etiqueta: "Más estabilidad", valor: `${num(Math.round(masEst.porCambio))} días`, pie: contexto(masEst.g.nombre, `${plural(masEst.cambios, "cambio", "cambios")} en ${plural(masEst.dias, "día", "días")}`) });
  }

  barrasDias("g-dias-gobierno", filas.map((r) => ({ clave: r.g.i, etiqueta: r.g.nombre, sub: anios(r.g), r })),
    { seleccion: estado.presidentes, total: GOB.length, alClic: (i) => alternar("presidentes", i, GOB), izq: 200 });
  barrasDias("g-dias-quinquenio", QUINQ.map((q) => {
    const r = rotacion(s.rotacion.filter((x) => q.gobiernos.includes(x.p)), q.gobiernos.reduce((t, i) => t + GOB[i].dias, 0));
    return { clave: q.nombre, etiqueta: q.nombre, sub: q.gobiernos.map((i) => GOB[i].corto).join(", "), r };
  }), { seleccion: null, izq: 120 });

  tablaOrdenable("t-gobiernos", [
    { clave: "gobierno", titulo: "Gobierno", valor: (r) => r.g.i, html: (r) => `${Obs.escapar(r.g.nombre)}` },
    { clave: "inicio", titulo: "Desde", valor: (r) => r.g.inicio, html: (r) => fecha(r.g.inicio) },
    { clave: "fin", titulo: "Hasta", valor: (r) => r.g.fin ?? HOY, html: (r) => (r.g.enCurso ? "En curso" : fecha(r.g.fin)) },
    { clave: "dias", titulo: "Días de gobierno", num: true, valor: (r) => r.dias, html: (r) => num(r.dias) },
    { clave: "gabinetes", titulo: "Gabinetes", num: true, valor: (r) => r.gabinetes, html: (r) => num(r.gabinetes) },
    { clave: "ministerios", titulo: "Ministerios", num: true, valor: (r) => r.ministerios, html: (r) => num(r.ministerios) },
    { clave: "ministros", titulo: "Ministros", num: true, valor: (r) => r.ministros, html: (r) => num(r.ministros) },
    { clave: "cambios", titulo: "Cambios", num: true, valor: (r) => r.cambios, html: (r) => num(r.cambios) },
    { clave: "porCambio", titulo: "Días por cambio", num: true, valor: (r) => r.porCambio,
      html: (r) => (r.porCambio == null ? `<span class="sin-cambios">Sin cambios</span>` : barrita(r.porCambio, Math.max(...filas.map((x) => x.porCambio ?? 0)))) },
  ], filas, { inicial: { clave: "gobierno", dir: 1 }, claveFila: (r) => r.g.i, elegidas: todos(estado.presidentes, GOB) ? null : estado.presidentes,
    alClic: (k) => alternar("presidentes", +k, GOB), descripcion: "Rotación ministerial de cada gobierno" });
}
const barrita = (v, max) => `<span class="celda-barra"><i style="width:${Math.max(4, (v / max) * 100)}%"></i><b>${num(Math.round(v))}</b></span>`;

// Barras de días por cambio. Sin cambios: rótulo en vez de barra. Alto fijo, igual al de su par.
function barrasDias(id, items, { seleccion, total, alClic, izq }) {
  if (!items.some((d) => d.r.ministros)) return Obs.vacio(id);
  const gr = Obs.grafico(id);
  const angosto = document.getElementById(id).clientWidth < 480;
  const izquierda = angosto ? Math.round(izq * 0.62) : izq;
  const elegidos = seleccion && seleccion.size < total;
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const d = items[ps[0].dataIndex], r = d.r;
        return `<strong>${Obs.escapar(d.etiqueta)}</strong>${d.sub ? ` (${Obs.escapar(d.sub)})` : ""}<br>` +
          (r.porCambio == null ? "Sin cambios de ministro" : `Un cambio cada <strong>${plural(Math.round(r.porCambio), "día", "días")}</strong>`) +
          `<br>${plural(r.cambios, "cambio", "cambios")} en ${plural(r.dias, "día", "días")}<br>${plural(r.ministros, "ministro", "ministros")}, ${plural(r.ministerios, "ministerio", "ministerios")}`; } },
    grid: { left: izquierda, right: 96, top: 4, bottom: 4 },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: items.map((d) => d.etiqueta), triggerEvent: !!alClic, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), width: izquierda - 10, overflow: "truncate", formatter: (v, i) => (items[i].sub && alClic ? `{n|${v}}\n{a|${items[i].sub}}` : v),
        rich: { n: txt({ color: C.texto, fontWeight: 700, lineHeight: 18 }), a: txt({ lineHeight: 17 }) } } },
    series: [{
      type: "bar", barMaxWidth: 24, barCategoryGap: "30%", cursor: alClic ? "pointer" : "default",
      data: items.map((d) => ({ value: d.r.porCambio ?? 0, itemStyle: { color: C.azul, borderRadius: [0, 2, 2, 0], opacity: elegidos && !seleccion.has(d.clave) ? 0.25 : 1 } })),
      label: { show: true, position: "right", distance: 6, ...txt({ color: C.texto, fontWeight: 700 }),
        formatter: (q) => { const r = items[q.dataIndex].r; return r.porCambio == null ? (r.ministros ? "Sin cambios" : "") : `${num(Math.round(r.porCambio))} días`; } },
    }],
  }, true);
  gr.off("click");
  if (alClic) gr.on("click", (q) => { gr.dispatchAction({ type: "hideTip" }); alClic(q.componentType === "yAxis" ? items.find((d) => d.etiqueta === q.value).clave : items[q.dataIndex].clave); });
}

/* ---------- Pestaña 3: ¿Quiénes fueron ministros? ---------- */
function pintarPersonas(s) {
  const g = s.todo;
  const porPersona = new Map();
  for (const x of g) {
    let p = porPersona.get(x.nombre);
    if (!p) porPersona.set(x.nombre, (p = { nombre: x.nombre, sexo: x.sexo, gestiones: 0, ministerios: new Set(), gobiernos: new Set(), dias: 0 }));
    p.gestiones++; p.ministerios.add(x.m); p.gobiernos.add(x.p); p.dias += x.dias;
  }
  const personas = [...porPersona.values()].map((p) => ({ ...p, ministerios: p.ministerios.size, gobiernos: p.gobiernos.size }));
  const repitieron = personas.filter((p) => p.gestiones > 1).length;
  const larga = g.reduce((a, b) => (b.dias > (a?.dias ?? -1) ? b : a), null);

  document.getElementById("r-personas").innerHTML = personas.length
    ? `Desde 2001${Obs.escapar(alcance())}, <strong>${plural(personas.length, "persona dirigió", "personas dirigieron")}</strong> un ministerio;
       ${plural(repitieron, "repitió", "repitieron")} en más de una gestión.` : "No hay personas con estos filtros. Quita alguno para ver datos.";
  if (!personas.length) vacioKpis(["k-gente", "k-repitieron", "k-permanencia"]);
  else {
    Obs.kpi("k-gente", { etiqueta: "Personas", valor: num(personas.length), pie: contexto(plural(personas.filter((p) => p.sexo === "Mujer").length, "mujer", "mujeres"), `y ${plural(personas.filter((p) => p.sexo === "Hombre").length, "hombre", "hombres")}`) });
    Obs.kpi("k-repitieron", { etiqueta: "Repitieron", valor: num(repitieron), pie: contexto(pct(repitieron / personas.length), "tuvieron más de una gestión") });
    Obs.kpi("k-permanencia", { etiqueta: "Más tiempo en un ministerio", valor: `${num(larga.dias)} días`, pie: contexto(larga.nombre, `${MIN[larga.m]}, con ${GOB[larga.p].corto}`) });
  }

  tablaOrdenable("t-permanencia", [
    { clave: "nombre", titulo: "Persona", valor: (x) => x.nombre, html: (x) => Obs.escapar(x.nombre) },
    { clave: "ministerio", titulo: "Ministerio", valor: (x) => MIN[x.m], html: (x) => Obs.escapar(MIN[x.m]) },
    { clave: "gobierno", titulo: "Gobierno", valor: (x) => x.p, html: (x) => Obs.escapar(GOB[x.p].corto) },
    { clave: "dias", titulo: "Días", num: true, valor: (x) => x.dias, html: (x) => `${num(x.dias)}${x.enCurso ? " <span class=\"en-curso\">en el cargo</span>" : ""}` },
  ], g, { inicial: { clave: "dias", dir: -1 }, claveFila: (x) => x.k, elegidas: estado.persona ? new Set(g.filter((x) => x.nombre === estado.persona).map((x) => x.k)) : null,
    alClic: (k) => elegirPersona(GESTIONES.find((x) => x.k === k).nombre), descripcion: "Gestiones ordenadas por días en el cargo" });

  tablaOrdenable("t-gestiones", [
    { clave: "nombre", titulo: "Persona", valor: (p) => p.nombre, html: (p) => Obs.escapar(p.nombre) },
    { clave: "gestiones", titulo: "Gestiones", num: true, valor: (p) => p.gestiones, html: (p) => num(p.gestiones) },
    { clave: "ministerios", titulo: "Ministerios", num: true, valor: (p) => p.ministerios, html: (p) => num(p.ministerios) },
    { clave: "gobiernos", titulo: "Gobiernos", num: true, valor: (p) => p.gobiernos, html: (p) => num(p.gobiernos) },
    { clave: "dias", titulo: "Días en total", num: true, valor: (p) => p.dias, html: (p) => num(p.dias) },
  ], personas, { inicial: { clave: "gestiones", dir: -1 }, desempate: (a, b) => b.dias - a.dias, claveFila: (p) => p.nombre,
    elegidas: estado.persona ? new Set([estado.persona]) : null, alClic: (k) => elegirPersona(k), descripcion: "Personas ordenadas por número de gestiones" });

  ficha();
}

// Ficha de una persona: todas sus gestiones en una línea de tiempo (sin filtros)
function ficha() {
  const id = "g-ficha";
  const nombre = estado.persona;
  const $t = document.getElementById("t-ficha"), $d = document.getElementById("d-ficha");
  if (!nombre) {
    $t.textContent = "Ficha de la persona";
    $d.textContent = "Elige a alguien en una de las tablas o búscalo por su nombre para ver todas sus gestiones.";
    document.getElementById(id).style.height = "120px";
    Obs.grafico(id).resize();
    return Obs.vacio(id, "Ninguna persona elegida");
  }
  const g = GESTIONES.filter((x) => x.nombre === nombre).sort((a, b) => a.desde - b.desde);
  const dias = g.reduce((t, x) => t + x.dias, 0);
  $t.textContent = nombre;
  $d.textContent = `${plural(g.length, "gestión", "gestiones")} en ${plural(new Set(g.map((x) => x.m)).size, "ministerio", "ministerios")}, con ${plural(new Set(g.map((x) => x.p)).size, "presidente", "presidentes")}; ${plural(dias, "día", "días")} en total. Todas sus gestiones, sin filtros.`;
  const el = document.getElementById(id);
  el.style.height = `${g.length * 52 + 70}px`;
  const gr = Obs.grafico(id);
  gr.resize();
  const angosto = el.clientWidth < 600;
  const izq = angosto ? 130 : 300;
  const etiqueta = (x) => `${MIN[x.m]} (${GOB[x.p].corto})`;
  const ini = Math.min(...g.map((x) => x.desde)), fin = Math.max(...g.map((x) => x.hasta ?? HOY));
  const margen = Math.max(60, (fin - ini) * 0.06);
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: false,
    tooltip: { ...Obs.tooltipBase(), formatter: (q) => { const x = g[q.dataIndex];
      return `<strong>${Obs.escapar(MIN[x.m])}</strong><br>Gobierno de ${Obs.escapar(GOB[x.p].nombre)}<br>${fecha(x.desde)} a ${x.enCurso ? "hoy" : fecha(x.hasta)}<br>${plural(x.dias, "día", "días")}, ${plural(x.gabinetes, "gabinete", "gabinetes")}`; } },
    grid: { left: izq, right: 24, top: 8, bottom: 36 },
    xAxis: { type: "value", min: ini - margen, max: fin + margen, splitLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ formatter: (v) => String(anio(v)), showMinLabel: false, showMaxLabel: false }), splitNumber: angosto ? 3 : 6 },
    yAxis: { type: "category", inverse: true, data: g.map(etiqueta), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), width: izq - 12, overflow: "truncate" } },
    series: [{
      type: "custom", data: g.map((x, i) => [i, x.desde, x.hasta ?? HOY]),
      renderItem: (params, api) => {
        const y = api.coord([0, api.value(0)])[1], a = api.coord([api.value(1), 0])[0], b = api.coord([api.value(2), 0])[0];
        const x = g[params.dataIndex];
        return { type: "group", children: [
          { type: "rect", shape: { x: a, y: y - 11, width: Math.max(3, b - a), height: 22, r: 2 }, style: { fill: x.sexo === "Mujer" ? C.mujer : C.hombre } },
          { type: "text", style: { x: Math.max(3, b - a) + a + 8, y, text: `${num(x.dias)} días`, verticalAlign: "middle", fill: C.texto, font: `700 14px ${C.fuente}` } },
        ] };
      },
      encode: { x: [1, 2], y: 0 },
    }],
  }, true);
}

/* ---------- Tabla ordenable por cualquier columna ----------
   columnas: [{ clave, titulo, num, valor(fila), html(fila) }]. Un clic en el título ordena;
   otro clic invierte el orden. Las filas se eligen con clic o con Enter. */
function tablaOrdenable(id, columnas, filas, { inicial, desempate = () => 0, claveFila, elegidas, alClic, descripcion }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave);
  // los valores vacíos (p. ej., «Sin cambios») van siempre al final
  const cmp = (a, b) => { const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null) || desempate(a, b);
    const r = typeof x === "string" ? x.localeCompare(y, "es") : x - y; return r * orden.dir || desempate(a, b); };
  const datos = [...filas].sort(cmp);
  const th = columnas.map((c) => {
    const activo = c.clave === orden.clave;
    const sentido = activo ? (orden.dir === 1 ? "ascending" : "descending") : "none";
    return `<th class="${c.num ? "num" : ""}" aria-sort="${sentido}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = claveFila(f);
    return `<tr tabindex="0" data-k="${Obs.escapar(String(k))}"${elegidas && elegidas.has(k) ? ' class="elegida"' : ""}>${columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("")}</tr>`;
  }).join("");
  el.innerHTML = datos.length
    ? `<table class="tabla ordenable"><caption class="solo-lectores">${descripcion}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
    : `<p class="tabla-vacia">No hay filas con estos filtros. Quita alguno para ver datos.</p>`;
  el.onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (b) {
      const c = columnas.find((x) => x.clave === b.dataset.orden);
      ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
      render();
      el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
      return;
    }
    const fila = e.target.closest("tr[data-k]");
    if (fila && alClic) alClic(fila.dataset.k);
  };
  el.onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) alClic?.(e.target.dataset.k); };
}

/* =========== Filtros =========== */
const todosLos = (lista) => new Set(lista.map((_, i) => i));
// Un clic en una barra: si está todo elegido, queda solo esa; si no, se suma o se quita. Vacío vuelve a todo.
function alternar(campo, v, lista) {
  if (v < 0) return;
  const actual = estado[campo];
  let nuevo = todos(actual, lista) ? new Set([v]) : new Set(actual);
  if (!todos(actual, lista)) nuevo.has(v) ? nuevo.delete(v) : nuevo.add(v);
  if (!nuevo.size) nuevo = todosLos(lista);
  actualizar({ [campo]: nuevo });
}
function elegirPersona(nombre) {
  actualizar({ persona: nombre === estado.persona ? null : nombre });
  if (estado.persona) document.getElementById("ficha").scrollIntoView({ behavior: ANIM ? "smooth" : "auto", block: "nearest" });
}

function pintarAplicados() {
  const chips = [];
  const chip = (texto, accion) => chips.push(`<button type="button" class="chip" data-quitar="${accion}" aria-label="Quitar el filtro ${Obs.escapar(texto)}">${Obs.escapar(texto)}<span aria-hidden="true">×</span></button>`);
  if (!todos(estado.presidentes, GOB)) [...estado.presidentes].sort((a, b) => a - b).forEach((i) => chip(GOB[i].nombre, `p:${i}`));
  if (!todos(estado.ministerios, MIN)) [...estado.ministerios].sort((a, b) => a - b).forEach((i) => chip(MIN[i], `m:${i}`));
  if (estado.sexo !== "todos" && estado.modulo !== "rotacion") chip(estado.sexo === "Mujer" ? "Mujeres" : "Hombres", "s");
  const caja = document.getElementById("aplicados");
  caja.hidden = !chips.length;
  document.getElementById("aplicados-lista").innerHTML = chips.join("");
}

function sincronizarControles() {
  multiPres.sincronizar(estado.presidentes);
  multiMin.sincronizar(estado.ministerios);
  const sexo = document.getElementById("f-sexo"), noAplica = estado.modulo === "rotacion";
  sexo.classList.toggle("no-aplica", noAplica);
  sexo.querySelector(".nota-filtro").hidden = !noAplica;
  sexo.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-pressed", b.dataset.sexo === estado.sexo); b.disabled = noAplica; });
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  document.getElementById("f-persona").value = estado.persona ?? "";
}

function actualizar(parche) {
  const cambioPestana = parche.modulo && parche.modulo !== estado.modulo;
  Object.assign(estado, parche);
  render();
  // al cambiar de pestaña, los gráficos recién visibles toman su ancho real
  if (cambioPestana) requestAnimationFrame(() => { Obs.redimensionar(); render(); });
}

function montarControles() {
  const filtros = document.getElementById("filtros");
  const sexo = document.getElementById("f-sexo");
  multiPres = new Obs.Multiseleccion(filtros, {
    id: "f-presidentes", etiqueta: "Presidente", todos: "Todos los gobiernos",
    opciones: GOB.map((g) => ({ valor: g.i, etiqueta: `${g.nombre} (${anios(g)})` })),
    alCambiar: (sel) => actualizar({ presidentes: sel }),
  });
  multiMin = new Obs.Multiseleccion(filtros, {
    id: "f-ministerios", etiqueta: "Ministerio", todos: "Todos los ministerios",
    opciones: MIN.map((m, i) => ({ valor: i, etiqueta: m })),
    alCambiar: (sel) => actualizar({ ministerios: sel }),
  });
  filtros.appendChild(sexo); // el sexo va al final
  sexo.querySelectorAll("button").forEach((b) => (b.onclick = () => actualizar({ sexo: b.dataset.sexo })));

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    // flechas para moverse entre pestañas (patrón de tablist)
    b.onkeydown = (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const sig = pestanas[(i + d + pestanas.length) % pestanas.length];
      sig.focus(); sig.click();
    };
  });

  document.getElementById("aplicados").onclick = (e) => {
    if (e.target.closest("#quitar-todo")) return actualizar({ presidentes: todosLos(GOB), ministerios: todosLos(MIN), sexo: "todos" });
    const q = e.target.closest("[data-quitar]")?.dataset.quitar;
    if (!q) return;
    if (q === "s") return actualizar({ sexo: "todos" });
    const [c, i] = q.split(":");
    const campo = c === "p" ? "presidentes" : "ministerios", lista = c === "p" ? GOB : MIN;
    const nuevo = new Set(estado[campo]); nuevo.delete(+i);
    actualizar({ [campo]: nuevo.size ? nuevo : todosLos(lista) });
  };

  const nombres = [...new Set(GESTIONES.map((g) => g.nombre))].sort((a, b) => a.localeCompare(b, "es"));
  document.getElementById("l-personas").innerHTML = nombres.map((n) => `<option value="${Obs.escapar(n)}">`).join("");
  const buscar = document.getElementById("f-persona");
  buscar.onchange = () => {
    const v = buscar.value.trim().toLowerCase();
    if (!v) return actualizar({ persona: null });
    const hallado = nombres.find((n) => n.toLowerCase() === v) ?? nombres.find((n) => n.toLowerCase().includes(v));
    if (hallado) elegirPersona(hallado);
  };
}

function leerURL() {
  const q = Obs.parametros();
  const indices = (k, lista) => {
    const v = (q.get(k) || "").split("-").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < lista.length);
    return v.length ? new Set(v) : todosLos(lista);
  };
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  estado.presidentes = indices("presidentes", GOB);
  estado.ministerios = indices("ministerios", MIN);
  if (["Mujer", "Hombre"].includes(q.get("sexo"))) estado.sexo = q.get("sexo");
  if (GESTIONES.some((g) => g.nombre === q.get("persona"))) estado.persona = q.get("persona");
}

Obs.iniciar(TABLERO, async () => {
  const D = await Obs.cargarJSON("datos.json");
  const t = Obs.tema();
  C = { ...t, mujer: t.categorias[1], hombre: t.categorias[0] };
  preparar(D.tablas);
  const [a, m, d] = (D.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";
  document.querySelectorAll(".ley-sexo").forEach((e) => (e.innerHTML = `<span><i style="background:${C.mujer}"></i>Mujeres</span><span><i style="background:${C.hombre}"></i>Hombres</span>`));

  montarControles();
  leerURL();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
