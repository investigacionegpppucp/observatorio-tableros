/* =========================================================
   Tablero de Cuestiones de confianza — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma el Apps Script (Tableros > Publicar
   tableros) desde el Sheet «Cuestiones de Confianza». Todo se calcula
   desde la pestaña «Hoja 1» (una fila por votación en el Pleno), así los
   filtros se aplican igual a cada gráfico y tabla. De la pestaña «Gobierno»
   solo se toman los días de cada gobierno.

   Definiciones:
     votación  cada vez que el Pleno votó (una fila de «Hoja 1»)
     cuestión  cada pedido de confianza del Ejecutivo. Las votaciones que «no se
               resuelven» se suman a la siguiente del mismo gabinete: las tres
               rondas de René Cornejo y las de Ana Jara son una cuestión cada una.
     días por cuestión  días de gobierno ÷ cuestiones; el total es ponderado.

   Filtros comunes: Gobierno y Motivo (selección múltiple, también con clics en
   los gráficos). Cada gráfico ignora el filtro de su propia categoría y resalta lo
   elegido; las tablas aplican todos los filtros.
   Patrón: un objeto `estado`, una función pura `filtrar()` y una sola `render()`.
   Mismo diseño que Mociones de censura.

   Parámetros de URL:
     ?gobiernos=6&motivos=1&buscar=<texto>&resultado=aprobada|rechazada|plano|noresuelta (sin él: todos)
     (índices, en orden cronológico los gobiernos)
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "cuestiones-confianza";
const ARCHIVOS = [{ clave: "cuestiones_confianza_base", etiqueta: "Cuestiones de confianza (2000-2026)" }];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
// Resultado de cada cuestión (y de cada votación: «noresuelta» solo existe en las votaciones)
const ESTADOS_TODOS = [
  { clave: "aprobada", nombre: "Aprobada", corto: "Aprobadas", css: "--e-aprobada" },
  { clave: "rechazada", nombre: "Rechazada", corto: "Rechazadas", css: "--e-rechazada" },
  { clave: "plano", nombre: "Rechazada de plano", corto: "Rechazadas de plano", css: "--e-plano" },
  { clave: "noresuelta", nombre: "No se resolvió", corto: "No se resolvieron", css: "--e-noresuelta" },
];
let ESTADOS = ESTADOS_TODOS;      // resultados con votaciones (para la tabla)
let ESTADOS_C = ESTADOS_TODOS;    // resultados con cuestiones (para la dona y las barras)
const MOTIVOS_NOMBRE = { "confianza a nuevo gabinete": "Gabinete nuevo", "otros motivos": "Otros motivos" };

// buscar y resultado solo afectan a la tabla de cada votación; resultado "" es «todos»
const RESULTADO_INICIAL = "";
const estado = { gobiernos: null, motivos: null, buscar: "", resultado: RESULTADO_INICIAL };

let C, VOTOS = [], CUES = [], GOB = [], MOT = [], ACTUALIZADO = "";
let multiGob, multiMot;
const ORDEN = {}; // orden elegido de cada tabla: { clave, dir }

/* =========== Utilidades =========== */
const num = (v, dec = 0) => Obs.fmtN(v, dec);
const pct = (v) => Obs.fmtPct(v, 1);
const plural = (k, uno, varios) => `${num(k)} ${k === 1 ? uno : varios}`;
const txt = (x = {}) => ({ fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, ...x });
const todos = (sel, lista) => sel.size === lista.length;
const todosLos = (lista) => new Set(lista.map((_, i) => i));
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const corto = (nombre) => (nombre === "Pedro Pablo Kuczynski" ? "Kuczynski" : nombre.split(" ").at(-1));
const nombreEstado = (clave) => ESTADOS_TODOS.find((e) => e.clave === clave).nombre;
function clasificar(conclusion) {
  const c = sinTildes(conclusion);
  if (c.startsWith("aprob")) return "aprobada";
  if (c.includes("de plano") || c.startsWith("no admit")) return "plano";
  if (c.startsWith("rechaz")) return "rechazada";
  if (!c.startsWith("no se resuel")) console.warn(`Conclusión no reconocida: «${conclusion}» (se cuenta como no resuelta)`);
  return "noresuelta";
}
const numero = (v) => (v == null || String(v).trim() === "" || isNaN(+v) ? null : +v);
function fecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
const fmtFecha = (d) => (d ? d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const cuenta = (xs, lista = ESTADOS_C) => Object.fromEntries(lista.map((e) => [e.clave, xs.filter((x) => x.estado === e.clave).length]));
// rechazadas = rechazadas en el Pleno + rechazadas de plano
const rechazadas = (xs) => xs.filter((x) => x.estado === "rechazada" || x.estado === "plano").length;

/* =========== Datos =========== */
function preparar(T) {
  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  // «Pedro Cateriano  (1)» -> «Pedro Cateriano (1)»
  VOTOS = Obs.expandir(T["Hoja 1"]).map((f) => {
    const favor = numero(f["A FAVOR"]), contra = numero(f["EN CONTRA"]), abst = numero(f["ABSTENCIÓN"]);
    return {
      ord: numero(f.ORD), gobierno: limpio(f.GOBIERNO), gabinete: limpio(f.GABINETE), presentado: limpio(f["PRIMER MINISTRO (CAMBIAR)"]),
      fecha: fecha(f["FECHA (DE PEDIDO DE CONFIANZA)"]),
      // la duración solo donde la base la escribe («7 horas con 35 minutos»): las rondas que no se resolvieron repiten la de la cuestión
      debate: /hora/i.test(limpio(f["TIEMPO DE DEBATE"])) ? numero(f["TIEMPO TOTAL (MINUTOS)"]) : null,
      favor, contra, abst, presentes: favor == null ? null : favor + (contra ?? 0) + (abst ?? 0),
      motivo: MOTIVOS_NOMBRE[sinTildes(limpio(f.TIPO))] ?? limpio(f.TIPO), estado: clasificar(limpio(f["CONCLUSIÓN"])),
      detalle: limpio(f["DETALLE DEL MOTIVO"]), // por qué se planteó (columna del Sheet; solo en las de otros motivos)
    };
  }).filter((v) => v.gobierno && v.fecha).sort((a, b) => a.fecha - b.fecha || a.ord - b.ord);
  VOTOS.forEach((v) => (v.busqueda = sinTildes(`${v.gabinete} ${v.presentado}`)));

  // las votaciones que no se resolvieron se suman a la siguiente del mismo gabinete
  CUES = [];
  let pendientes = [];
  VOTOS.forEach((v) => {
    if (v.estado === "noresuelta") { pendientes.push(v); return; }
    const rondas = [...pendientes.filter((p) => p.gabinete === v.gabinete), v];
    pendientes = pendientes.filter((p) => p.gabinete !== v.gabinete);
    const c = { ...v, rondas };
    rondas.forEach((r) => (r.cuestion = c));
    CUES.push(c);
  });
  pendientes.forEach((p) => { const c = { ...p, rondas: [p] }; p.cuestion = c; CUES.push(c); }); // sin resolver todavía

  ESTADOS = ESTADOS_TODOS.filter((e) => VOTOS.some((v) => v.estado === e.clave));
  ESTADOS_C = ESTADOS_TODOS.filter((e) => CUES.some((c) => c.estado === e.clave));

  // gobiernos en el orden en que gobernaron; sus días, de la pestaña «Gobierno»
  const dias = new Map(Obs.expandir(T.Gobierno ?? {}).map((x) => [limpio(x.Gobierno), numero(x["Días en el gobierno"])]));
  GOB = [...new Set(VOTOS.map((v) => v.gobierno))].map((nombre, i) => ({ i, nombre, corto: corto(nombre), dias: dias.get(nombre) ?? null }));
  GOB.filter((g) => g.dias == null).forEach((g) => console.warn(`Faltan los días de gobierno de ${g.nombre} (pestaña «Gobierno»)`));
  MOT = [...new Set(VOTOS.map((v) => v.motivo))].sort((a, b) => (a === "Gabinete nuevo" ? -1 : b === "Gabinete nuevo" ? 1 : a.localeCompare(b, "es")));
  const indices = (x) => { x.g = GOB.findIndex((g) => g.nombre === x.gobierno); x.m = MOT.indexOf(x.motivo); };
  VOTOS.forEach(indices); CUES.forEach(indices);
}

/* Cada gráfico usa el subconjunto que ignora su propio filtro; las tablas usan `todo` */
function filtrar(e) {
  const enG = (x) => e.gobiernos.has(x.g), enM = (x) => e.motivos.has(x.m);
  return {
    todo: CUES.filter((x) => enG(x) && enM(x)),
    sinGobierno: CUES.filter(enM),
    sinMotivo: CUES.filter(enG),
    votos: VOTOS.filter((x) => enG(x) && enM(x)),
    votosSinGobierno: VOTOS.filter(enM),
  };
}
// Gobiernos elegidos con sus días; solo los que tienen días registrados
const gobiernosEnAlcance = (e) => GOB.filter((g) => e.gobiernos.has(g.i) && g.dias > 0);
function ritmo(gobs, cuestiones) {
  const dias = gobs.reduce((t, g) => t + g.dias, 0);
  return { dias, cuestiones, porCuestion: cuestiones > 0 && dias > 0 ? dias / cuestiones : null };
}

/* =========== Render =========== */
function render() {
  sincronizarControles();
  const s = filtrar(estado);
  cifras(s.todo);
  dona(s.todo);
  porGobierno(s.sinGobierno);
  votaciones(s.votosSinGobierno);
  ritmoGobiernos(s.sinGobierno);
  porMotivo(s.sinMotivo);
  pintarBusqueda(s.votos);
  pintarAplicados();
  escribirURL();
}
function escribirURL() {
  const lista = (sel, l) => (todos(sel, l) ? null : [...sel].sort((a, b) => a - b).join("-"));
  Obs.escribirURL({
    gobiernos: lista(estado.gobiernos, GOB), motivos: lista(estado.motivos, MOT),
    buscar: estado.buscar.trim() || null, resultado: estado.resultado || null,
  });
}

/* ---------- Lecturas: una o dos frases por gráfico que cambian con los filtros ---------- */
const lectura = (id, html) => (document.getElementById(id).innerHTML = html);
const fuerte = (s) => `<strong>${s}</strong>`;
const enumerar = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
// todo dato que cambia con los filtros va destacado (negrita con línea lima, ver comun/estilos.css)
const destacar = (s) => fuerte(Obs.escapar(String(s)));
const nombres = (xs) => enumerar(xs.map(destacar));
const extremos = (lista, campo, mayor = true) => {
  if (!lista.length) return [];
  const v = (mayor ? Math.max : Math.min)(...lista.map((x) => x[campo]));
  return lista.filter((x) => x[campo] === v);
};
const sumar = (lista, k) => lista.reduce((t, x) => t + x[k], 0);

// Texto del alcance elegido, para el resumen
function alcance(filas) {
  const e = estado;
  if (!todos(e.gobiernos, GOB)) return e.gobiernos.size === 1 ? `Durante el gobierno de ${destacar(GOB[[...e.gobiernos][0]].nombre)}` : `En los ${destacar(e.gobiernos.size)} gobiernos elegidos`;
  const anios = filas.map((x) => x.fecha.getUTCFullYear());
  return `Entre ${destacar(Math.min(...anios))} y ${destacar(Math.max(...anios))}`;
}
const motivoTexto = () => (todos(estado.motivos, MOT) ? "" : estado.motivos.size === 1 ? ` (${Obs.minus(MOT[[...estado.motivos][0]])})` : "");

/* ---------- Resumen y cifras clave ---------- */
function cifras(filas) {
  const el = document.getElementById("r-confianza");
  const c = cuenta(filas), rech = rechazadas(filas);
  const votos = filas.reduce((t, x) => t + x.rondas.length, 0);
  const r = ritmo(gobiernosEnAlcance(estado), filas.length);
  if (!filas.length) {
    el.textContent = "No hubo cuestiones de confianza con estos filtros. Quita alguno para ver datos.";
  } else {
    el.innerHTML = `${alcance(filas)}, el Poder Ejecutivo planteó ${fuerte(plural(filas.length, "cuestión de confianza", "cuestiones de confianza"))}${motivoTexto()}. ` +
      `El Congreso aprobó ${fuerte(num(c.aprobada ?? 0))} (${fuerte(pct((c.aprobada ?? 0) / filas.length))}) y rechazó ${fuerte(num(rech))}.`;
  }
  Obs.kpi("k-cuestiones", { etiqueta: "Cuestiones de confianza", valor: num(filas.length),
    pie: votos > filas.length ? `En ${plural(votos, "votación", "votaciones")}: algunas se votaron más de una vez` : `En ${plural(votos, "votación", "votaciones")} del Pleno` });
  Obs.kpi("k-aprobadas", { etiqueta: "Aprobadas", valor: num(c.aprobada ?? 0), pie: filas.length ? `${pct((c.aprobada ?? 0) / filas.length)} de las cuestiones` : "" });
  Obs.kpi("k-rechazadas", { etiqueta: "Rechazadas", valor: num(rech),
    pie: c.plano ? `${plural(c.plano, "rechazada de plano, sin votación", "rechazadas de plano, sin votación")}` : "Todas en una votación del Pleno" });
  Obs.kpi("k-ritmo", { etiqueta: "Una cada", valor: r.porCuestion == null ? "—" : `${num(r.porCuestion)} días`,
    pie: r.porCuestion == null ? "Sin cuestiones con estos filtros" : `Promedio ponderado: ${num(r.dias)} días de gobierno entre ${plural(r.cuestiones, "cuestión", "cuestiones")}` });
}

/* ---------- ¿Cómo terminaron? (dona de cuestiones) ----------
   La leyenda (y cada tramo) también filtra la tabla de cada votación. */
function dona(filas) {
  const id = "g-dona";
  const c = cuenta(filas);
  const elegido = estado.resultado;
  const presentes = ESTADOS_C.filter((e) => c[e.clave]);
  document.getElementById("ley-dona").innerHTML = presentes.map((e) =>
    `<button type="button" data-resultado="${e.clave}" aria-pressed="${elegido === e.clave}"><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</button>`).join("");
  if (!filas.length) { lectura("l-dona", ""); return Obs.vacio(id); }
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "item",
      formatter: (q) => `<strong>${q.name}</strong><br>${plural(q.value, "cuestión", "cuestiones")} (${pct(q.value / filas.length)})` },
    title: { text: num(filas.length), subtext: filas.length === 1 ? "cuestión" : "cuestiones", left: "center", top: "center", itemGap: 0,
      textStyle: { fontFamily: C.fuente, fontSize: 40, fontWeight: 800, color: C.navy }, subtextStyle: txt({ fontSize: 16 }) },
    series: [{ type: "pie", radius: ["56%", "90%"], center: ["50%", "50%"], avoidLabelOverlap: false, label: { show: false }, cursor: "pointer",
      itemStyle: { borderColor: "#fff", borderWidth: 3 }, emphasis: { scale: true, scaleSize: 4 },
      data: presentes.map((e) => ({ name: e.nombre, value: c[e.clave], clave: e.clave,
        itemStyle: { color: C.estado[e.clave], opacity: elegido && elegido !== e.clave ? 0.25 : 1 } })) }],
  }, true);
  document.getElementById(id).setAttribute("aria-label", `${plural(filas.length, "cuestión de confianza", "cuestiones de confianza")}: ` +
    presentes.map((e) => `${e.nombre}, ${num(c[e.clave])}`).join("; ") + ".");
  g.off("click");
  g.on("click", (q) => { g.dispatchAction({ type: "hideTip" }); elegirResultado(q.data.clave, true); });
  // lectura: las aprobadas y, si hay, cuáles se rechazaron
  const rech = filas.filter((x) => x.estado === "rechazada" || x.estado === "plano");
  let t = `De ${filas.length === 1 ? "esta cuestión" : `estas ${fuerte(num(filas.length))} cuestiones`}, ${fuerte(num(c.aprobada ?? 0))} ${c.aprobada === 1 ? "fue aprobada" : "fueron aprobadas"}`;
  if (!rech.length) t += " y ninguna fue rechazada.";
  else if (rech.length <= 6) t += `. Se ${rech.length === 1 ? "rechazó la" : "rechazaron las"} de ${enumerar(rech.map((x) => `${destacar(x.presentado)} (${fmtFecha(x.fecha)})`))}.`;
  else t += ` y ${fuerte(num(rech.length))} fueron rechazadas.`;
  lectura("l-dona", t);
}
// Un resultado elegido en la dona, su leyenda o los botones de la tabla (alternar: otro clic vuelve a «todos»)
function elegirResultado(clave, alternar = false) {
  estado.resultado = alternar && estado.resultado === clave ? "" : clave;
  const s = filtrar(estado);
  dona(s.todo); pintarBusqueda(s.votos); escribirURL();
}

/* ---------- Por gobierno (barras apiladas por resultado, en orden cronológico) ---------- */
function porGobierno(filas) {
  const id = "g-gobiernos";
  const gobs = GOB.filter((g) => filas.some((x) => x.g === g.i)).map((g) => {
    const f = filas.filter((x) => x.g === g.i);
    return { ...g, total: f.length, ...cuenta(f) };
  });
  lecturaGobiernos(gobs);
  if (!gobs.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${gobs.length * 36 + 36}px`;
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 460;
  const izq = angosto ? 96 : 176;
  const elegidos = !todos(estado.gobiernos, GOB);
  const op = (x) => (elegidos && !estado.gobiernos.has(x.i) ? 0.25 : 1);
  const etiquetas = gobs.map((x) => (angosto ? x.corto : x.nombre));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = gobs[ps[0].dataIndex];
        return `<strong>${Obs.escapar(x.nombre)}</strong><br>${plural(x.total, "cuestión", "cuestiones")}` +
          ESTADOS_C.filter((e) => x[e.clave]).map((e) => `<br><span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${C.estado[e.clave]}"></span>${e.nombre}: <strong>${num(x[e.clave])}</strong>`).join(""); } },
    grid: { left: izq, right: 40, top: 4, bottom: 28 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: etiquetas, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), width: izq - 12, overflow: "truncate",
        formatter: (v, i) => (elegidos && estado.gobiernos.has(gobs[i].i) ? `{b|${v}}` : v), rich: { b: txt({ color: C.navy, fontWeight: 800 }) } } },
    series: [
      ...ESTADOS_C.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 18, cursor: "pointer",
        itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 2 },
        data: gobs.map((x) => ({ value: x[e.clave] || null, itemStyle: { opacity: op(x) } })) })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: gobs.map(() => 0),
        label: { show: true, position: "right", formatter: (q) => num(gobs[q.dataIndex].total), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" });
    const i = q.componentType === "yAxis" ? etiquetas.indexOf(q.value) : q.dataIndex;
    if (gobs[i]) alternar("gobiernos", gobs[i].i, GOB);
  });
}
function lecturaGobiernos(gobs) {
  if (!gobs.length) return lectura("l-gobiernos", "");
  const sel = todos(estado.gobiernos, GOB) ? gobs : gobs.filter((x) => estado.gobiernos.has(x.i));
  if (sel.length < gobs.length || gobs.length === 1) {
    if (!sel.length) return lectura("l-gobiernos", "El gobierno elegido no planteó cuestiones de confianza con estos filtros.");
    const n = sumar(sel, "total"), rech = sumar(sel, "rechazada") + sumar(sel, "plano");
    const quien = sel.length === 1 ? `El gobierno de ${destacar(sel[0].nombre)} planteó` : `Los gobiernos de ${nombres(sel.map((x) => x.nombre))} plantearon`;
    return lectura("l-gobiernos", `${quien} ${fuerte(plural(n, "cuestión de confianza", "cuestiones de confianza"))}; ` +
      `${rech ? `${fuerte(num(rech))} ${rech === 1 ? "fue rechazada" : "fueron rechazadas"}` : "ninguna fue rechazada"}.`);
  }
  const alto = extremos(gobs, "total");
  let t = `${nombres(alto.map((x) => x.nombre))} ${alto.length > 1 ? "plantearon" : "planteó"} más cuestiones de confianza: ` +
    `${fuerte(num(alto[0].total))}${alto.length > 1 ? " cada uno" : ""}.`;
  const conRech = gobs.filter((x) => x.rechazada + (x.plano ?? 0) > 0);
  if (conRech.length) t += ` Solo ${conRech.length === 1 ? "un gobierno tuvo" : `${fuerte(num(conRech.length))} gobiernos tuvieron`} cuestiones rechazadas: ${nombres(conRech.map((x) => x.nombre))}.`;
  lectura("l-gobiernos", t);
}

/* ---------- ¿Con cuántos votos? (palitos, de los votos en contra a los votos a favor) ----------
   Una votación por palito, en orden cronológico; el punto lleno (a favor) lleva el color del
   resultado y el vacío (en contra) es gris. La rechazada de plano no tuvo votación: no aparece. */
function votaciones(votos) {
  const id = "g-votaciones";
  const lista = votos.filter((v) => v.favor != null);
  const el = document.getElementById(id);
  document.getElementById("ley-votaciones").innerHTML =
    ESTADOS.filter((e) => lista.some((v) => v.estado === e.clave)).map((e) => `<span><i class="punto" style="background:${C.estado[e.clave]}"></i>A favor: ${Obs.minus(e.nombre)}</span>`).join("") +
    `<span><i class="punto vacio"></i>En contra</span>`;
  lecturaVotaciones(lista);
  if (!lista.length) return Obs.vacio(id);
  el.style.minWidth = `${Math.max(640, lista.length * 18)}px`;
  const g = Obs.grafico(id);
  g.resize();
  const elegidos = !todos(estado.gobiernos, GOB);
  const op = (v) => (elegidos && !estado.gobiernos.has(v.g) ? 0.2 : 1);
  // en el eje, el año solo cuando cambia
  const anios = lista.map((v) => v.fecha.getUTCFullYear());
  const etiquetas = lista.map((v, i) => (i === 0 || anios[i] !== anios[i - 1] ? String(anios[i]) : ""));
  const bajo = lista.map((v) => Math.min(v.favor, v.contra ?? 0));
  const tramo = lista.map((v) => Math.abs(v.favor - (v.contra ?? 0)));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.linea, width: 2 } },
      formatter: (ps) => {
        const v = lista[ps[0].dataIndex];
        const debate = v.debate ? `<br>Debate: ${Math.floor(v.debate / 60)} h ${v.debate % 60} min` : "";
        const quien = v.presentado && sinTildes(v.presentado) !== sinTildes(v.gabinete.replace(/\s*\(\d\)$/, "")) ? `<br>Presentada por ${Obs.escapar(v.presentado)}` : "";
        return `<strong>${Obs.escapar(v.gabinete)}</strong> · ${fmtFecha(v.fecha)}<br><span style="opacity:.85">Gobierno de ${Obs.escapar(v.gobierno)} · ${Obs.escapar(v.motivo)}</span>${quien}` +
          `<br>A favor: <strong>${num(v.favor)}</strong> · En contra: <strong>${num(v.contra)}</strong> · Abstenciones: <strong>${num(v.abst)}</strong>` +
          `<br>Diferencia: <strong>${num(v.favor - v.contra)}</strong> votos${debate}<br><strong>${nombreEstado(v.estado)}</strong>` +
          (v.detalle ? `<div style="max-width:320px;white-space:normal;margin-top:6px;opacity:.9">${Obs.escapar(v.detalle)}</div>` : "") +
          (v.estado === "rechazada" && v.favor > v.contra ? "<br><span style=\"opacity:.85\">Se consigna como rechazada (ver nota al pie)</span>" : "");
      } },
    grid: { left: 44, right: 16, top: 16, bottom: 36 },
    xAxis: { type: "category", data: etiquetas, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto, fontWeight: 700 }), interval: 0, hideOverlap: true } },
    yAxis: { type: "value", name: "votos", nameTextStyle: txt(), splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [
      // el palito: una barra apilada sobre una base invisible
      { type: "bar", stack: "p", silent: true, itemStyle: { color: "transparent" }, data: bajo, barWidth: 3 },
      { type: "bar", stack: "p", silent: true, barWidth: 3, data: tramo.map((t, i) => ({ value: t, itemStyle: { color: C.palito, opacity: op(lista[i]) } })) },
      { name: "En contra", type: "scatter", symbolSize: 10, z: 3,
        data: lista.map((v) => ({ value: v.contra, itemStyle: { color: "#fff", borderColor: C.contra, borderWidth: 2, opacity: op(v) } })) },
      { name: "A favor", type: "scatter", symbolSize: 12, z: 4,
        data: lista.map((v) => ({ value: v.favor, itemStyle: { color: C.estado[v.estado], borderColor: "#fff", borderWidth: 1, opacity: op(v) } })) },
    ],
  }, true);
  el.setAttribute("aria-label", "Votaciones de cuestiones de confianza, votos a favor y en contra: " +
    lista.map((v) => `${v.gabinete} (${fmtFecha(v.fecha)}): ${v.favor} a favor, ${v.contra} en contra`).join("; ") + ".");
  g.off("click");
  g.on("click", (q) => { const v = lista[q.dataIndex]; if (v) { g.dispatchAction({ type: "hideTip" }); alternar("gobiernos", v.g, GOB); } });
}
function lecturaVotaciones(lista) {
  const votadas = lista.filter((v) => v.estado === "aprobada" || v.estado === "rechazada");
  if (!votadas.length) return lectura("l-votaciones", "");
  const apr = votadas.filter((v) => v.estado === "aprobada").map((v) => ({ ...v, margen: v.favor - v.contra }));
  let t = "";
  if (apr.length) {
    const justa = extremos(apr, "margen", false)[0], amplia = extremos(apr, "margen")[0];
    t = `La aprobación más ajustada fue la de ${destacar(justa.gabinete)} (${fmtFecha(justa.fecha)}): ${fuerte(num(justa.favor))} votos a favor y ${fuerte(num(justa.contra))} en contra.`;
    if (amplia !== justa) t += ` La más holgada, la de ${destacar(amplia.gabinete)}: ${fuerte(num(amplia.favor))} a ${fuerte(num(amplia.contra))}.`;
  }
  const nr = lista.filter((v) => v.estado === "noresuelta");
  if (nr.length) t += ` En ${fuerte(plural(nr.length, "votación", "votaciones"))} (en gris) las abstenciones superaron a los votos a favor y no se resolvió la cuestión; hubo que volver a votar.`;
  lectura("l-votaciones", t);
}

/* ---------- Días por cuestión en cada gobierno (barras) ----------
   Una barra por gobierno, en orden cronológico. El total ponderado (todos los días entre
   todas las cuestiones, no el promedio de los gobiernos) va en la lectura. */
function ritmoGobiernos(filas) {
  const id = "g-ritmo";
  const gobs = gobiernosEnAlcance({ ...estado, gobiernos: todosLos(GOB) }).map((g) => {
    const f = filas.filter((x) => x.g === g.i);
    return { ...g, cuestiones: f.length, porCuestion: ritmo([g], f.length).porCuestion };
  }).filter((g) => g.porCuestion != null);
  const enAlcance = gobs.filter((g) => estado.gobiernos.has(g.i));
  const total = ritmo(enAlcance, sumar(enAlcance, "cuestiones"));
  lecturaRitmo(enAlcance, total);
  if (!gobs.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${gobs.length * 46 + 40}px`;
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 460;
  const izq = angosto ? 96 : 176;
  const elegidos = !todos(estado.gobiernos, GOB);
  const etiquetas = gobs.map((x) => (angosto ? x.corto : x.nombre));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = gobs[ps[0].dataIndex];
        return `<strong>${Obs.escapar(x.nombre)}</strong><br>Una cuestión cada <strong>${num(x.porCuestion, 1)} días</strong>` +
          `<br>${plural(x.cuestiones, "cuestión", "cuestiones")} en ${num(x.dias)} días de gobierno`; } },
    grid: { left: izq, right: 56, top: 8, bottom: 28 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: etiquetas, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), width: izq - 12, overflow: "truncate",
        formatter: (v, i) => (elegidos && estado.gobiernos.has(gobs[i].i) ? `{b|${v}}` : v), rich: { b: txt({ color: C.navy, fontWeight: 800 }) } } },
    series: [{ type: "bar", barWidth: 20, cursor: "pointer",
      data: gobs.map((x) => ({ value: Math.round(x.porCuestion), itemStyle: { color: C.ritmo, borderRadius: [0, 3, 3, 0], opacity: elegidos && !estado.gobiernos.has(x.i) ? 0.25 : 1 } })),
      label: { show: true, position: "right", formatter: (q) => num(q.value), ...txt({ color: C.texto, fontWeight: 700 }) },
    }],
  }, true);
  el.setAttribute("aria-label", "Días por cuestión de confianza en cada gobierno: " + gobs.map((x) => `${x.nombre}, ${num(x.porCuestion)}`).join("; ") + ".");
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" });
    const i = q.componentType === "yAxis" ? etiquetas.indexOf(q.value) : q.dataIndex;
    if (gobs[i]) alternar("gobiernos", gobs[i].i, GOB);
  });
}
function lecturaRitmo(con, total) {
  const dias = (g) => fuerte(`${num(g.porCuestion, 1)} días`);
  if (!con.length) return lectura("l-ritmo", "");
  if (con.length === 1) return lectura("l-ritmo", `Con ${destacar(con[0].nombre)} hubo una cuestión de confianza cada ${dias(con[0])}.`);
  const rapido = extremos(con, "porCuestion", false)[0], lento = extremos(con, "porCuestion");
  lectura("l-ritmo", `Con ${destacar(rapido.nombre)} hubo una cuestión de confianza cada ${dias(rapido)}, el ritmo más intenso; ` +
    `con ${nombres(lento.map((g) => g.nombre))}, una cada ${dias(lento[0])}. En conjunto, una cada ${fuerte(`${num(total.porCuestion, 1)} días`)}.`);
}

/* ---------- Por motivo (barras al 100 % y la lista de las cuestiones por otros motivos) ---------- */
function porMotivo(filas) {
  const id = "g-motivos";
  const mots = MOT.map((nombre, i) => { const f = filas.filter((x) => x.m === i); return { i, nombre, total: f.length, ...cuenta(f) }; }).filter((x) => x.total);
  lecturaMotivos(mots);
  listaOtros(filas.filter((x) => x.motivo !== "Gabinete nuevo"));
  if (!mots.length) return Obs.vacio(id);
  const g = Obs.grafico(id);
  const elegidos = !todos(estado.motivos, MOT);
  const op = (x) => (elegidos && !estado.motivos.has(x.i) ? 0.25 : 1);
  // en celular, sin el total al lado del nombre (va en la burbuja)
  const angosto = document.getElementById(id).clientWidth < 460;
  const etiquetas = mots.map((x) => (angosto ? x.nombre : `${x.nombre} (${x.total})`));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = mots[ps[0].dataIndex];
        return `<strong>${Obs.escapar(x.nombre)}</strong><br>${plural(x.total, "cuestión", "cuestiones")}` +
          ESTADOS_C.filter((e) => x[e.clave]).map((e) => `<br><span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${C.estado[e.clave]}"></span>${e.nombre}: <strong>${num(x[e.clave])}</strong> (${pct(x[e.clave] / x.total)})`).join(""); } },
    grid: { left: angosto ? 118 : 170, right: 16, top: 4, bottom: 4 },
    xAxis: { type: "value", max: 100, show: false },
    yAxis: { type: "category", inverse: true, data: etiquetas, triggerEvent: true, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { ...txt({ color: C.texto, fontWeight: 700 }), formatter: (v, i) => (elegidos && estado.motivos.has(mots[i].i) ? `{b|${v}}` : v),
        rich: { b: txt({ color: C.navy, fontWeight: 800 }) } } },
    series: ESTADOS_C.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 34, cursor: "pointer",
      itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 2 },
      data: mots.map((x) => ({ value: x[e.clave] ? (x[e.clave] / x.total) * 100 : null, n: x[e.clave], itemStyle: { opacity: op(x) } })),
      // el número de cuestiones dentro del tramo, si cabe
      label: { show: true, formatter: (q) => (q.value >= 8 ? num(q.data.n) : ""), color: "#fff", fontFamily: C.fuente, fontSize: 15, fontWeight: 800 } })),
  }, true);
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" });
    const i = q.componentType === "yAxis" ? etiquetas.indexOf(q.value) : q.dataIndex;
    if (mots[i]) alternar("motivos", mots[i].i, MOT);
  });
}
// Cada cuestión por otros motivos: son pocas y son los episodios que más dicen
function listaOtros(otros) {
  document.getElementById("h-otros").textContent = otros.length ? (otros.length === 1 ? "La cuestión por otros motivos" : `Las ${otros.length} cuestiones por otros motivos`) : "";
  const esc = Obs.escapar;
  document.getElementById("lista-otros").innerHTML = otros.map((x) => {
    const votos = x.favor == null ? "Sin votación" : `${num(x.favor)} a ${num(x.contra)}`;
    // el detalle sale al pasar el cursor (o al llegar con el teclado); para lectores de pantalla va en el texto
    return `<li${x.detalle ? ' tabindex="0" class="con-detalle"' : ""}><i style="background:${C.estado[x.estado]}" aria-hidden="true"></i>` +
      `<span class="quien">${esc(x.presentado)}<small>${fmtFecha(x.fecha)} · gobierno de ${esc(x.gobierno)}</small></span>` +
      `<span class="votos"><b>${nombreEstado(x.estado)}</b>${votos}</span>` +
      (x.detalle ? `<span class="detalle" role="note">${esc(x.detalle)}</span>` : "") + "</li>";
  }).join("");
}
function lecturaMotivos(mots) {
  const tasa = (x) => (x.rechazada + (x.plano ?? 0)) / x.total;
  const gab = mots.find((x) => x.nombre === "Gabinete nuevo"), otros = mots.find((x) => x.nombre !== "Gabinete nuevo");
  if (!gab || !otros) return lectura("l-motivos", mots.length ? `${fuerte(plural(mots[0].total, "cuestión", "cuestiones"))}, todas por ${Obs.minus(destacar(mots[0].nombre))}.` : "");
  const rech = (x) => x.rechazada + (x.plano ?? 0);
  const frase = (x) => (rech(x) ? `${rech(x) === 1 ? "se rechazó una" : `se rechazaron ${fuerte(num(rech(x)))}`} (${fuerte(pct(tasa(x)))})` : "no se rechazó ninguna");
  lectura("l-motivos", `De las ${fuerte(num(gab.total))} cuestiones por un gabinete nuevo, ${frase(gab)}; ` +
    `de las ${fuerte(num(otros.total))} por otros motivos, ${frase(otros)}.`);
}

/* ---------- Cada votación (tabla a todo el ancho) ----------
   Una votación por fila. Los botones de resultado y la dona eligen el mismo resultado;
   el buscador solo afecta a esta tabla. */
function pintarBusqueda(votos) {
  const b = sinTildes(estado.buscar.trim());
  tablaVotaciones(b ? votos.filter((v) => v.busqueda.includes(b)) : votos);
}
function tablaVotaciones(votos) {
  const c = cuenta(votos, ESTADOS);
  const r = estado.resultado;
  const opciones = [{ clave: "", corto: "Todas", n: votos.length }, ...ESTADOS.map((e) => ({ clave: e.clave, corto: e.corto, n: c[e.clave] }))];
  document.getElementById("f-resultado").innerHTML = opciones.map((o) =>
    `<button type="button" data-resultado="${o.clave}" aria-pressed="${r === o.clave}">${o.corto}<small>${num(o.n)}</small></button>`).join("");
  const lista = r ? votos.filter((v) => v.estado === r) : votos;
  const cues = new Set(lista.map((v) => v.cuestion)).size;
  document.getElementById("h-votaciones").textContent = lista.length
    ? `${plural(lista.length, "votación", "votaciones")}${cues !== lista.length ? `, en ${plural(cues, "cuestión de confianza", "cuestiones de confianza")}` : ""}${r ? `: ${Obs.minus(nombreEstado(r))}` : ""}`
    : "Cada votación";
  const esc = Obs.escapar;
  const cifra = (clave, titulo, clase = "") => ({ clave, titulo, num: true, valor: (v) => v[clave],
    html: (v) => (v[clave] == null ? '<span class="sin-dato">—</span>' : `<span class="${clase}">${num(v[clave])}</span>`) });
  const columnas = [
    { clave: "fecha", titulo: "Fecha", valor: (v) => +v.fecha, html: (v) => `<span class="fecha">${fmtFecha(v.fecha)}</span>` },
    { clave: "gobierno", titulo: "Gobierno", valor: (v) => v.g, html: (v) => esc(v.gobierno) },
    { clave: "gabinete", titulo: "Gabinete", valor: (v) => v.gabinete,
      html: (v) => `<span class="ministro">${esc(v.gabinete)}${v.presentado && sinTildes(v.presentado) !== sinTildes(v.gabinete.replace(/\s*\(\d\)$/, "")) ? `<small>Presentada por ${esc(v.presentado)}</small>` : ""}</span>` },
    { clave: "motivo", titulo: "Motivo", valor: (v) => v.motivo, html: (v) => esc(v.motivo) },
    cifra("favor", "A favor", "voto-favor"),
    cifra("contra", "En contra"),
    cifra("abst", "Abstenciones"),
    { clave: "debate", titulo: "Debate", num: true, valor: (v) => v.debate,
      html: (v) => (v.debate ? `${Math.floor(v.debate / 60)} h ${String(v.debate % 60).padStart(2, "0")} min` : '<span class="sin-dato">—</span>') },
    { clave: "resultado", titulo: "Resultado", valor: (v) => ESTADOS_TODOS.findIndex((e) => e.clave === v.estado),
      html: (v) => `<span class="resultado"><i style="background:${C.estado[v.estado]}"></i>${nombreEstado(v.estado)}</span>` },
  ];
  tablaOrdenable("t-votaciones", columnas, lista, {
    inicial: { clave: "fecha", dir: -1 }, desempate: (a, b) => b.ord - a.ord,
    descripcion: "Cada votación de una cuestión de confianza: fecha, gobierno, gabinete, motivo, votos a favor, en contra y abstenciones, duración del debate y resultado",
    vacia: estado.buscar.trim() ? `Nada coincide con «${esc(estado.buscar.trim())}» con estos filtros. Prueba con un apellido.` : null,
  });
}

/* =========== Tabla ordenable ===========
   columnas: [{ clave, titulo, num, valor(fila), html(fila) }]
   Sin alClic, las filas no se pueden elegir. `pie` es el HTML de una fila de totales. */
function tablaOrdenable(id, columnas, filas, { inicial, desempate = () => 0, claveFila, elegidas, alClic, descripcion, pie = "", vacia = null }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave);
  // los vacíos (p. ej., «Sin cuestiones») van siempre al final
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
    const k = alClic ? claveFila(f) : null;
    const atributos = alClic ? ` tabindex="0" data-k="${Obs.escapar(String(k))}"${elegidas && elegidas.has(k) ? ' class="elegida"' : ""}` : "";
    return `<tr${atributos}>${columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("")}</tr>`;
  }).join("");
  el.innerHTML = datos.length
    ? `<table class="tabla ordenable"><caption class="solo-lectores">${descripcion}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ""}</table>`
    : `<p class="tabla-vacia">${vacia ?? "No hay filas con estos filtros. Quita alguno para ver datos."}</p>`;
  el.onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (b) {
      const c = columnas.find((x) => x.clave === b.dataset.orden);
      ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
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
// Un clic en un gráfico: si está todo elegido, queda solo ese; si no, se suma o se quita. Vacío vuelve a todo.
function alternar(campo, v, lista) {
  if (v == null || v < 0) return;
  const actual = estado[campo];
  let nuevo = todos(actual, lista) ? new Set([v]) : new Set(actual);
  if (!todos(actual, lista)) nuevo.has(v) ? nuevo.delete(v) : nuevo.add(v);
  if (!nuevo.size) nuevo = todosLos(lista);
  actualizar({ [campo]: nuevo });
}

function pintarAplicados() {
  const chips = [];
  const chip = (texto, accion) => chips.push(`<button type="button" class="chip" data-quitar="${accion}" aria-label="Quitar el filtro ${Obs.escapar(texto)}">${Obs.escapar(texto)}<span aria-hidden="true">×</span></button>`);
  const ordenados = (sel) => [...sel].sort((a, b) => a - b);
  if (!todos(estado.gobiernos, GOB)) ordenados(estado.gobiernos).forEach((i) => chip(GOB[i].nombre, `g:${i}`));
  if (!todos(estado.motivos, MOT)) ordenados(estado.motivos).forEach((i) => chip(MOT[i], `m:${i}`));
  document.getElementById("aplicados").hidden = !chips.length;
  document.getElementById("aplicados-lista").innerHTML = chips.join("");
}

function sincronizarControles() {
  multiGob.sincronizar(estado.gobiernos);
  multiMot.sincronizar(estado.motivos);
  const buscar = document.getElementById("f-buscar");
  if (buscar.value !== estado.buscar) buscar.value = estado.buscar;
}

function actualizar(parche) {
  Object.assign(estado, parche);
  render();
}

const CAMPOS = { g: ["gobiernos", () => GOB], m: ["motivos", () => MOT] };

function montarControles() {
  const filtros = document.getElementById("filtros");
  multiGob = new Obs.Multiseleccion(filtros, {
    id: "f-gobiernos", etiqueta: "Gobierno", todos: "Todos los gobiernos",
    opciones: GOB.map((g) => ({ valor: g.i, etiqueta: g.nombre })),
    alCambiar: (sel) => actualizar({ gobiernos: sel }),
  });
  multiMot = new Obs.Multiseleccion(filtros, {
    id: "f-motivos", etiqueta: "Motivo", todos: "Todos los motivos",
    opciones: MOT.map((m, i) => ({ valor: i, etiqueta: m })),
    alCambiar: (sel) => actualizar({ motivos: sel }),
  });

  document.getElementById("aplicados").onclick = (e) => {
    if (e.target.closest("#quitar-todo")) return actualizar({ gobiernos: todosLos(GOB), motivos: todosLos(MOT) });
    const q = e.target.closest("[data-quitar]")?.dataset.quitar;
    if (!q) return;
    const [c, i] = q.split(":");
    const [campo, lista] = CAMPOS[c];
    const nuevo = new Set(estado[campo]); nuevo.delete(+i);
    actualizar({ [campo]: nuevo.size ? nuevo : todosLos(lista()) });
  };

  // el buscador solo redibuja la tabla de cada votación
  const buscar = document.getElementById("f-buscar");
  buscar.oninput = () => {
    estado.buscar = buscar.value;
    clearTimeout(buscar.__espera);
    buscar.__espera = setTimeout(() => { pintarBusqueda(filtrar(estado).votos); escribirURL(); }, 150);
  };
  // los botones de resultado de la tabla eligen el mismo resultado que la dona
  const resultado = document.getElementById("f-resultado");
  resultado.onclick = (e) => {
    const b = e.target.closest("button[data-resultado]");
    if (!b) return;
    elegirResultado(b.dataset.resultado);
    resultado.querySelector(`button[data-resultado="${b.dataset.resultado}"]`)?.focus(); // los botones se redibujan
  };
  document.getElementById("ley-dona").onclick = (e) => {
    const b = e.target.closest("button[data-resultado]");
    if (!b) return;
    elegirResultado(b.dataset.resultado, true);
    document.getElementById("ley-dona").querySelector(`button[data-resultado="${b.dataset.resultado}"]`)?.focus();
  };
}

function leerURL() {
  const q = Obs.parametros();
  const indices = (k, lista) => {
    const v = (q.get(k) || "").split("-").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < lista.length);
    return v.length ? new Set(v) : todosLos(lista);
  };
  estado.gobiernos = indices("gobiernos", GOB);
  estado.motivos = indices("motivos", MOT);
  estado.buscar = q.get("buscar") ?? "";
  const res = q.get("resultado");
  estado.resultado = ESTADOS.some((e) => e.clave === res) ? res : RESULTADO_INICIAL;
}

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(), estado: Object.fromEntries(ESTADOS_TODOS.map((e) => [e.clave, v(e.css)])), contra: v("--voto-contra"), palito: v("--palito"), ritmo: v("--ritmo") };
  preparar(datos.tablas);
  ACTUALIZADO = datos.actualizado || "";
  const [a, m, d] = ACTUALIZADO.split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";
  document.querySelectorAll(".ley-estados").forEach((el) => (el.innerHTML = ESTADOS_C.map((e) => `<span><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("")));

  montarControles();
  leerURL();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
