/* =========================================================
   Tablero de Mociones de censura — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma el Apps Script (Tableros > Publicar
   tableros) desde el Sheet «Censura». Todo se calcula desde la pestaña
   «Mociones de Censura» (una fila por moción y ministro cuestionado), así
   los filtros se aplican igual a cada gráfico y tabla. De la pestaña
   «Gobierno» solo se toman los días de cada gobierno.

   Definiciones:
     moción   el documento que presentan los congresistas (Número de moción)
     proceso  cada ministro cuestionado en una moción (una fila)
     días por proceso  días de gobierno ÷ procesos; el total es ponderado
              (todos los días entre todos los procesos), no el promedio de los gobiernos.

   Filtros comunes: Congreso (período legislativo), Gobierno y Ministerio (selección múltiple,
   también con clics en los gráficos). Cada gráfico ignora el filtro de su
   propia categoría y resalta lo elegido; las tablas aplican todos los filtros.
   Patrón: un objeto `estado`, una función pura `filtrar()` y una sola `render()`.
   Mismo diseño que Mociones de interpelación.

   Parámetros de URL:
     ?congresos=4&gobiernos=6&sectores=9&buscar=<texto>&resultado=aprobada|rechazada|archivada|novotada|proceso
     (índices, en orden cronológico los Congresos y gobiernos y alfabético los ministerios)
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "mociones-censura";
const ARCHIVOS = [{ clave: "mociones_censura_base", etiqueta: "Mociones de censura (2001-2025)" }];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
// Resultado de cada proceso, en el orden de la pila: de lo que llegó más lejos a lo que no se votó
const ESTADOS_TODOS = [
  { clave: "aprobada", nombre: "Censura aprobada", corto: "Aprobadas", css: "--e-aprobada" },
  { clave: "rechazada", nombre: "Censura rechazada", corto: "Rechazadas", css: "--e-rechazada" },
  { clave: "novotada", nombre: "No llegó al Pleno", corto: "No llegaron al Pleno", css: "--e-novotada" },
  { clave: "archivada", nombre: "Archivada", corto: "Archivadas", css: "--e-archivada" },
  { clave: "proceso", nombre: "En proceso", corto: "En proceso", css: "--e-proceso" },
];
let ESTADOS = ESTADOS_TODOS; // solo los que tienen procesos (hoy no hay ninguno en proceso)
// Las barras por Congreso, gobierno y ministerio van en dos tonos: lo que importa es cuántas censuras se aprobaron.
// El detalle de los cuatro resultados está en el gráfico de cuadros y en la burbuja de cada barra.
const DOS = [
  { clave: "aprobada", nombre: "Censura aprobada", css: "--e-aprobada" },
  { clave: "otros", nombre: "Otros resultados", css: "--e-otros" },
];
// Fechas de cada Congreso (período legislativo). El de 2016 fue disuelto el 30/09/2019; el
// interregno hasta la instalación del Congreso complementario (16/03/2020) se cuenta en el de 2016-2020.
const CONGRESOS = {
  "2001-2006": ["2001-07-28", "2006-07-28"], "2006-2011": ["2006-07-28", "2011-07-28"], "2011-2016": ["2011-07-28", "2016-07-28"],
  "2016-2020": ["2016-07-28", "2020-03-16"], "2020-2021": ["2020-03-16", "2021-07-28"], "2021-2026": ["2021-07-28", "2026-07-28"],
  "2026-2031": ["2026-07-28", null],
};
// Inicio de cada gobierno; su fin es el inicio más sus días (pestaña «Gobierno»).
// Sirve para repartir los días de un gobierno entre dos Congresos (Vizcarra: 2016-2020 y 2020-2021).
const INICIO_GOBIERNO = {
  "Alejandro Toledo": "2001-07-28", "Alan García": "2006-07-28", "Ollanta Humala": "2011-07-28", "Pedro Pablo Kuczynski": "2016-07-28",
  "Martín Vizcarra": "2018-03-23", "Francisco Sagasti": "2020-11-17", "Pedro Castillo": "2021-07-28", "Dina Boluarte": "2022-12-07",
  "José Jerí": "2025-10-10", "José María Balcázar": "2026-02-18", "Keiko Fujimori": "2026-07-28",
};
const SECTOR_CORTO = { "Presidencia del Consejo de Ministros": "Presidencia del Consejo", "Vivienda, Saneamiento y Construcción": "Vivienda",
  "Justicia y Derechos Humanos": "Justicia", "Transportes y Comunicaciones": "Transportes", "Desarrollo e Inclusión Social": "Inclusión Social",
  "Mujer y Desarrollo Social": "Mujer" };

// buscar y resultado solo afectan a la tabla de cada proceso
const estado = { periodos: null, gobiernos: null, sectores: null, buscar: "", resultado: "" };

let C, FILAS = [], PER = [], GOB = [], SEC = [], ACTUALIZADO = "";
let multiPer, multiGob, multiSec;
const ORDEN = {}; // orden elegido de cada tabla: { clave, dir }

/* =========== Utilidades =========== */
const num = (v, dec = 0) => Obs.fmtN(v, dec);
const pct = (v) => Obs.fmtPct(v, 1);
const plural = (k, uno, varios) => `${num(k)} ${k === 1 ? uno : varios}`;
const txt = (x = {}) => ({ fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, ...x });
const todos = (sel, lista) => sel.size === lista.length;
const todosLos = (lista) => new Set(lista.map((_, i) => i));
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// «Pedro Pablo Kuczynski» -> «Kuczynski»
const corto = (nombre) => (nombre === "Pedro Pablo Kuczynski" ? "Kuczynski" : nombre.split(" ").at(-1));
const sectorCorto = (s) => SECTOR_CORTO[s] ?? s;
function clasificar(conclusion) {
  const c = sinTildes(conclusion);
  if (c.startsWith("aprob") || c.startsWith("apob")) return "aprobada"; // «Apobada» (sic) en la base
  if (c.startsWith("rechaz")) return "rechazada";
  if (c.startsWith("no lleg") || c.includes("no hubo votacion")) return "novotada";
  if (c.startsWith("en proceso")) return "proceso";
  if (!c.startsWith("archiv")) console.warn(`Conclusión no reconocida: «${conclusion}» (se cuenta como archivada)`);
  return "archivada";
}
const cuentaEstados = (filas) => {
  const c = Object.fromEntries(ESTADOS.map((e) => [e.clave, filas.filter((f) => f.estado === e.clave).length]));
  c.otros = filas.length - (c.aprobada ?? 0);
  return c;
};
const mociones = (filas) => new Set(filas.map((f) => f.mocion)).size;
const aprobadas = (filas) => filas.filter((f) => f.estado === "aprobada").length;

/* =========== Datos =========== */
const DIA = 864e5;
const aDia = (s) => Date.parse(`${s}T00:00:00Z`) / DIA;
function preparar(T) {
  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  const crudas = Obs.expandir(T["Mociones de Censura"]).map((f) => ({
    gobierno: limpio(f.Gobierno), legis: limpio(f.Legislatura).replace(/\s*-\s*/, "-"), // «2021 - 2022» y «2021-2022» son la misma
    mocion: limpio(f["Número de moción"]), sector: limpio(f.Ministerio), ministro: limpio(f["Ministro/a"]),
    estado: clasificar(limpio(f["Conclusión"])),
  })).filter((f) => f.gobierno && f.legis && f.ministro);
  crudas.forEach((f) => (f.busqueda = sinTildes(`${f.ministro} ${f.mocion}`)));
  ESTADOS = ESTADOS_TODOS.filter((e) => crudas.some((f) => f.estado === e.clave));

  // cada legislatura (período anual de sesiones) va al Congreso en que empezó
  crudas.forEach((f) => (f.periodo = congresoDe(f.legis)));
  PER = Object.keys(CONGRESOS).filter((p) => crudas.some((f) => f.periodo === p) || p < crudas.map((f) => f.periodo).sort().at(-1));

  const dias = new Map(Obs.expandir(T.Gobierno ?? {}).map((x) => [limpio(x.Gobierno), +x["Días en gobierno"] || null]));
  const nombres = [...new Set(crudas.map((f) => f.gobierno))];
  const inicio = (n) => INICIO_GOBIERNO[n] ?? "9999";
  nombres.filter((n) => !INICIO_GOBIERNO[n]).forEach((n) => console.warn(`Falta la fecha de inicio del gobierno de ${n}`));
  GOB = nombres.sort((a, b) => inicio(a).localeCompare(inicio(b))).map((nombre, i) => {
    const g = { i, nombre, corto: corto(nombre), dias: dias.get(nombre) ?? null };
    g.diasPor = repartirDias(g);
    return g;
  });
  SEC = [...new Set(crudas.map((f) => f.sector))].sort((a, b) => a.localeCompare(b, "es"));

  FILAS = crudas.map((f) => ({ ...f, l: PER.indexOf(f.periodo), g: GOB.findIndex((x) => x.nombre === f.gobierno), s: SEC.indexOf(f.sector) }));
}
/* Congreso de una legislatura: el que estaba instalado cuando empezó («2009-2010» empieza en julio de 2009).
   La legislatura 2019-2020 empezó en el Congreso de 2016, disuelto el 30/09/2019. */
function congresoDe(legis) {
  const dia = aDia(`${legis.slice(0, 4)}-07-28`);
  const p = Object.entries(CONGRESOS).find(([, [desde, hasta]]) => dia >= aDia(desde) && (!hasta || dia < aDia(hasta)));
  if (!p) console.warn(`Legislatura sin Congreso: «${legis}»`);
  return p?.[0] ?? legis;
}
/* Días de un gobierno en cada Congreso: Map(período -> días), cruzando las fechas del gobierno
   (inicio + días) con las de cada Congreso. */
function repartirDias(g) {
  const reparto = new Map();
  const ini = INICIO_GOBIERNO[g.nombre];
  if (g.dias == null || !ini) return reparto;
  const a = aDia(ini), b = a + g.dias;
  for (const [p, [desde, hasta]] of Object.entries(CONGRESOS)) {
    const d = Math.min(b, hasta ? aDia(hasta) : Infinity) - Math.max(a, aDia(desde));
    if (d > 0) reparto.set(p, Math.round(d));
  }
  return reparto;
}
const diasEn = (g, periodos) => periodos.reduce((t, l) => t + (g.diasPor.get(PER[l]) ?? 0), 0);
// Gobiernos que entran en el cálculo de días: los elegidos, con sus días dentro de los Congresos elegidos
// (con todos los Congresos van los días completos)
const gobiernosEnAlcance = (e) => GOB.filter((g) => e.gobiernos.has(g.i))
  .map((g) => ({ ...g, diasAlcance: todos(e.periodos, PER) ? g.dias ?? 0 : diasEn(g, [...e.periodos]) }))
  .filter((g) => g.diasAlcance > 0);
function ritmo(gobs, procesos) {
  const dias = gobs.reduce((t, g) => t + g.diasAlcance, 0);
  return { dias, procesos, porProceso: procesos > 0 && dias > 0 ? dias / procesos : null };
}

/* Cada gráfico usa el subconjunto que ignora su propio filtro; las tablas usan `todo` */
function filtrar(e) {
  const enL = (f) => e.periodos.has(f.l), enG = (f) => e.gobiernos.has(f.g), enS = (f) => e.sectores.has(f.s);
  return {
    todo: FILAS.filter((f) => enL(f) && enG(f) && enS(f)),
    sinPeriodo: FILAS.filter((f) => enG(f) && enS(f)),
    sinGobierno: FILAS.filter((f) => enL(f) && enS(f)),
    sinSector: FILAS.filter((f) => enL(f) && enG(f)),
  };
}

/* =========== Render =========== */
function render() {
  sincronizarControles();
  const s = filtrar(estado);
  cifras(s.todo);
  cuadros(s.todo);
  porCongreso(s.sinPeriodo);
  porGobierno(s.sinGobierno);
  tablaGobiernos(s.todo);
  porSector(s.sinSector);
  tablaMinistros(s.todo);
  pintarBusqueda(s.todo);
  pintarAplicados();
  escribirURL();
}
function escribirURL() {
  const lista = (sel, l) => (todos(sel, l) ? null : [...sel].sort((a, b) => a - b).join("-"));
  Obs.escribirURL({
    congresos: lista(estado.periodos, PER), gobiernos: lista(estado.gobiernos, GOB), sectores: lista(estado.sectores, SEC),
    buscar: estado.buscar.trim() || null, resultado: estado.resultado || null,
  });
}

/* ---------- Lecturas: una o dos frases por gráfico que cambian con los filtros ----------
   Moción = documento; proceso = ministro cuestionado. Nunca se cuentan unos como los otros. */
const lectura = (id, html) => (document.getElementById(id).innerHTML = html);
const fuerte = (s) => `<strong>${s}</strong>`;
const enumerar = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
// todo dato que cambia con los filtros va destacado (negrita con línea lima, ver comun/estilos.css)
const destacar = (s) => fuerte(Obs.escapar(String(s)));
const nombres = (xs) => enumerar(xs.map(destacar));
// los que empatan en el valor más alto (o más bajo) de un campo
const extremos = (lista, campo, mayor = true) => {
  if (!lista.length) return [];
  const v = (mayor ? Math.max : Math.min)(...lista.map((x) => x[campo]));
  return lista.filter((x) => x[campo] === v);
};
const MINIMO = 5; // para comparar proporciones se exigen MÁS de estos procesos (con pocos, un caso mueve mucho el porcentaje)
// «Ninguno terminó», «Todos terminaron» o «37,5 % terminó» (empieza la frase)
const terminaron = (apr, n) => (apr === 0 ? (n === 1 ? "No terminó" : "Ninguno terminó")
  : apr === n ? (n === 1 ? "Terminó" : "Todos terminaron") : `${fuerte(pct(apr / n))} terminó`);
const sumar = (lista, k) => lista.reduce((t, x) => t + x[k], 0);

// Texto del alcance elegido, para el resumen
function alcance() {
  const e = estado;
  if (!todos(e.gobiernos, GOB)) return e.gobiernos.size === 1 ? `Durante el gobierno de ${destacar(GOB[[...e.gobiernos][0]].nombre)}` : `En los ${destacar(e.gobiernos.size)} gobiernos elegidos`;
  if (!todos(e.periodos, PER)) return e.periodos.size === 1 ? `En el Congreso ${destacar(PER[[...e.periodos][0]])}` : `En los ${destacar(e.periodos.size)} Congresos elegidos`;
  const anios = FILAS.map((f) => +f.legis.slice(0, 4));
  return `Entre ${destacar(Math.min(...anios))} y ${destacar(Math.max(...anios) + 1)}`;
}
function aQuien() {
  const e = estado;
  if (todos(e.sectores, SEC)) return "contra ministros";
  return e.sectores.size === 1 ? `contra ministros de ${destacar(SEC[[...e.sectores][0]])}` : `contra ministros de ${destacar(e.sectores.size)} ministerios`;
}

/* ---------- Resumen y cifras clave ---------- */
function cifras(filas) {
  const el = document.getElementById("r-censura");
  const moc = mociones(filas), apr = aprobadas(filas);
  const r = ritmo(gobiernosEnAlcance(estado), filas.length);
  if (!filas.length) {
    el.textContent = "No hubo mociones de censura con estos filtros. Quita alguno para ver datos.";
  } else {
    el.innerHTML = `${alcance()}, ${moc === 1 ? "se presentó" : "se presentaron"} <strong>${plural(moc, "moción de censura", "mociones de censura")}</strong>, ` +
      `con <strong>${plural(filas.length, "proceso", "procesos")}</strong> ${aQuien()}. ` +
      (apr ? `<strong>${num(apr)}</strong> ${apr === 1 ? "terminó" : "terminaron"} en una censura aprobada por el Pleno (${fuerte(pct(apr / filas.length))}).`
        : "Ninguno terminó en una censura aprobada por el Pleno.");
  }
  Obs.kpi("k-mociones", { etiqueta: "Mociones presentadas", valor: num(moc), pie: "Documentos presentados por los congresistas" });
  Obs.kpi("k-procesos", { etiqueta: "Procesos de censura", valor: num(filas.length),
    pie: moc && filas.length > moc ? `Un proceso por cada ministro cuestionado: ${plural(filas.length - moc, "moción incluyó", "mociones incluyeron")} a más de uno`
      : "Un proceso por cada ministro cuestionado" });
  Obs.kpi("k-aprobadas", { etiqueta: "Censuras aprobadas", valor: num(apr), pie: filas.length ? `${pct(apr / filas.length)} de los procesos` : "" });
  Obs.kpi("k-ritmo", { etiqueta: "Un proceso cada", valor: r.porProceso == null ? "—" : `${num(r.porProceso)} días`,
    pie: r.porProceso == null ? "Sin procesos con estos filtros" : `Promedio ponderado: ${num(r.dias)} días de gobierno entre ${plural(r.procesos, "proceso", "procesos")}` });
}

/* ---------- ¿Cómo terminaron? (gráfico de cuadros) ----------
   Un cuadro por proceso, agrupados por resultado y, dentro, del más reciente al más antiguo.
   Es el único gráfico con los cuatro colores. La leyenda también filtra la tabla de cada proceso. */
function cuadros(filas) {
  const cuenta = cuentaEstados(filas);
  const elegido = estado.resultado;
  document.getElementById("ley-cuadros").innerHTML = ESTADOS.filter((e) => cuenta[e.clave]).map((e) =>
    `<button type="button" data-resultado="${e.clave}" aria-pressed="${elegido === e.clave}">` +
    `<i style="background:${C.estado[e.clave]}"></i>${e.nombre}<b>${num(cuenta[e.clave])}</b><small>${pct(cuenta[e.clave] / filas.length)}</small></button>`).join("");
  const el = document.getElementById("g-cuadros");
  if (!filas.length) { el.innerHTML = ""; lectura("l-cuadros", ""); return; }
  const orden = (f) => ESTADOS.findIndex((e) => e.clave === f.estado);
  const lista = [...filas].sort((a, b) => orden(a) - orden(b) || b.legis.localeCompare(a.legis) || (+b.mocion || 0) - (+a.mocion || 0));
  const esc = Obs.escapar;
  el.innerHTML = lista.map((f) => {
    const e = ESTADOS[orden(f)];
    const t = `${e.nombre}: moción ${f.mocion} (${f.legis}), ${f.ministro}, ${f.sector}`;
    return `<span title="${esc(t)}" style="background:${C.estado[f.estado]}"${elegido && elegido !== f.estado ? ' class="apagado"' : ""}></span>`;
  }).join("");
  el.setAttribute("aria-label", `${plural(filas.length, "proceso de censura", "procesos de censura")}: ` +
    ESTADOS.filter((e) => cuenta[e.clave]).map((e) => `${e.nombre}, ${num(cuenta[e.clave])}`).join("; ") + ".");
  // lectura: las aprobadas primero y luego los demás resultados, de más a menos
  const apr = cuenta.aprobada ?? 0;
  const resto = ESTADOS.filter((e) => e.clave !== "aprobada" && cuenta[e.clave]).sort((a, b) => cuenta[b.clave] - cuenta[a.clave]);
  const verbo = { rechazada: (n) => `${n === 1 ? "fue rechazado" : "fueron rechazados"} en el Pleno`, novotada: (n) => `no ${n === 1 ? "llegó" : "llegaron"} a votarse`,
    archivada: (n) => `${n === 1 ? "se archivó" : "se archivaron"}`, proceso: (n) => `${n === 1 ? "sigue" : "siguen"} en trámite` };
  const partes = resto.map((e) => `${fuerte(num(cuenta[e.clave]))} ${verbo[e.clave](cuenta[e.clave])}`);
  lectura("l-cuadros", `De ${filas.length === 1 ? "este proceso" : `estos ${fuerte(num(filas.length))} procesos`}, ` +
    (apr ? `${fuerte(num(apr))} ${apr === 1 ? "terminó" : "terminaron"} en una censura aprobada (${fuerte(pct(apr / filas.length))})` : `${fuerte("ninguno")} terminó en una censura aprobada`) +
    (partes.length ? `; ${enumerar(partes)}.` : "."));
}

/* ---------- Por Congreso (barras en dos tonos) ----------
   Barras y no líneas: los Congresos son períodos de distinta duración, no puntos de una serie continua.
   Dos tonos: censuras aprobadas y el resto; la burbuja trae los cuatro resultados.
   Van en orden cronológico, con el total encima. */
function porCongreso(filas) {
  const id = "g-congreso";
  const datos = PER.map((p, i) => {
    const f = filas.filter((x) => x.l === i);
    return { procesos: f.length, aprobadas: aprobadas(f), mociones: mociones(f), gobiernos: [...new Set(f.map((x) => x.gobierno))], ...cuentaEstados(f) };
  });
  lecturaLegis(datos);
  if (!datos.some((d) => d.procesos)) return Obs.vacio(id);

  const el = document.getElementById(id);
  const elegidos = !todos(estado.periodos, PER);
  const op = (i) => (elegidos && !estado.periodos.has(i) ? 0.25 : 1);
  const angosto = el.clientWidth < 600;
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => {
        const i = ps[0].dataIndex, d = datos[i];
        return `<strong>Congreso ${PER[i]}</strong>` + (d.gobiernos.length ? `<br><span style="opacity:.85">${Obs.escapar(d.gobiernos.join(", "))}</span>` : "") +
          `<br>${plural(d.procesos, "proceso", "procesos")} en ${plural(d.mociones, "moción", "mociones")}` +
          ESTADOS.filter((e) => d[e.clave]).map((e) => `<br><span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${C.estado[e.clave]}"></span>${e.nombre}: <strong>${num(d[e.clave])}</strong> (${pct(d[e.clave] / d.procesos)})`).join("");
      } },
    grid: { left: 40, right: 16, top: 28, bottom: angosto ? 52 : 40 },
    xAxis: { type: "category", data: PER, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto, fontWeight: 700 }), interval: 0, rotate: angosto ? 40 : 0, margin: 14,
        // en celular los Congresos se abrevian («2001-06»)
        formatter: (v, i) => { const t = angosto ? v.replace(/-\d\d(\d\d)$/, "-$1") : v;
          return elegidos && estado.periodos.has(i) ? `{s|${t}}` : t; },
        rich: { s: txt({ color: C.navy, fontWeight: 800, backgroundColor: C.lima, padding: [2, 6], borderRadius: 3 }) } } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [
      ...DOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barMaxWidth: 56, cursor: "pointer",
        itemStyle: { color: C.dos[e.clave], borderColor: "#fff", borderWidth: 2 },
        data: datos.map((d, i) => ({ value: d[e.clave] || null, itemStyle: { opacity: op(i) } })) })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: datos.map(() => 0),
        label: { show: true, position: "top", formatter: (q) => num(datos[q.dataIndex].procesos), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
  el.setAttribute("aria-label", "Procesos de censura por Congreso: " + PER.map((p, i) => `${p}, ${datos[i].procesos} (${datos[i].aprobadas} aprobadas)`).join("; ") + ".");
  // clic en cualquier parte de la columna de un Congreso (o en su nombre) lo elige
  g.off("click");
  g.on("click", (q) => { if (q.componentType === "xAxis") alternar("periodos", PER.indexOf(q.value), PER); });
  g.getZr().off("click");
  g.getZr().on("click", (ev) => {
    const punto = [ev.offsetX, ev.offsetY];
    if (!g.containPixel("grid", punto)) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, punto[0]) ?? -1);
    if (i >= 0 && i < PER.length) { g.dispatchAction({ type: "hideTip" }); alternar("periodos", i, PER); }
  });
  el.style.cursor = "pointer";
}
function lecturaLegis(datos) {
  const con = datos.map((d, i) => ({ ...d, i })).filter((d) => d.procesos);
  if (!con.length) return lectura("l-congreso", "");
  const total = sumar(con, "procesos");
  // con Congresos elegidos, la lectura habla de ellos y los compara con el total
  if (!todos(estado.periodos, PER)) {
    const sel = con.filter((d) => estado.periodos.has(d.i));
    const proc = sumar(sel, "procesos");
    if (!proc) return lectura("l-congreso", "En el Congreso elegido no hubo mociones de censura con estos filtros.");
    const quien = sel.length === 1 ? `El Congreso ${destacar(PER[sel[0].i])} tuvo` : `Los Congresos ${nombres(sel.map((d) => PER[d.i]))} tuvieron`;
    return lectura("l-congreso", `${quien} ${fuerte(plural(proc, "proceso", "procesos"))} de censura (${fuerte(pct(proc / total))} del total). ` +
      `${terminaron(sumar(sel, "aprobadas"), proc)} en una censura aprobada, frente a ${fuerte(pct(sumar(con, "aprobadas") / total))} en todos los Congresos.`);
  }
  if (con.length === 1) {
    const d = con[0];
    return lectura("l-congreso", `Todos estos procesos se presentaron en el Congreso ${destacar(PER[d.i])}: ${fuerte(plural(d.procesos, "proceso", "procesos"))}, ` +
      `de los que ${d.aprobadas === 1 ? `${fuerte("uno")} terminó` : `${fuerte(num(d.aprobadas))} terminaron`} en una censura aprobada.`);
  }
  const alto = extremos(con, "procesos");
  const cuantos = fuerte(plural(alto[0].procesos, "proceso", "procesos"));
  let t = alto.length === 1
    ? `El Congreso ${destacar(PER[alto[0].i])} fue el que más procesos de censura tuvo: ${cuantos} (${fuerte(pct(alto[0].procesos / total))} del total), ` +
      `con ${fuerte(plural(alto[0].aprobadas, "censura aprobada", "censuras aprobadas"))}.`
    : `Los Congresos ${nombres(alto.map((d) => PER[d.i]))} fueron los que más procesos de censura tuvieron: ${cuantos} cada uno.`;
  // las censuras aprobadas en el Congreso con más procesos frente a todos los anteriores
  if (alto.length === 1 && alto[0].i > 0) {
    const antes = sumar(con.filter((d) => d.i < alto[0].i), "aprobadas");
    if (alto[0].aprobadas > antes) t += ` Es más que las ${fuerte(num(antes))} aprobadas en todos los Congresos anteriores juntos.`;
  }
  lectura("l-congreso", t);
}

/* ---------- Barras en dos tonos (por gobierno y por ministerio) ----------
   No al 100 %: varios gobiernos y ministerios tienen un solo proceso y saldrían con 0 % o 100 %. */
function barrasApiladas(id, items, { campo, lista, etiqueta, izq }) {
  const el = document.getElementById(id);
  el.style.height = `${items.length * 38 + 36}px`;
  const g = Obs.grafico(id);
  g.resize();
  const elegidos = !todos(estado[campo], lista);
  const op = (x) => (elegidos && !estado[campo].has(x.i) ? 0.25 : 1);
  const etiquetas = items.map(etiqueta);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = items[ps[0].dataIndex];
        return `<strong>${Obs.escapar(x.nombre)}</strong><br>${plural(x.total, "proceso", "procesos")}` +
          ESTADOS.filter((e) => x[e.clave]).map((e) => `<br><span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${C.estado[e.clave]}"></span>${e.nombre}: <strong>${num(x[e.clave])}</strong> (${pct(x[e.clave] / x.total)})`).join(""); } },
    grid: { left: izq, right: 40, top: 4, bottom: 28 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: etiquetas, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), width: izq - 12, overflow: "truncate",
        formatter: (v, i) => (elegidos && estado[campo].has(items[i].i) ? `{b|${v}}` : v), rich: { b: txt({ color: C.navy, fontWeight: 800 }) } } },
    series: [
      ...DOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 20, cursor: "pointer",
        itemStyle: { color: C.dos[e.clave], borderColor: "#fff", borderWidth: 2 },
        data: items.map((x) => ({ value: x[e.clave] || null, itemStyle: { opacity: op(x) } })) })),
      // barra vacía al final de la pila: solo lleva el total como rótulo
      { name: "total", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: items.map(() => 0),
        label: { show: true, position: "right", formatter: (q) => num(items[q.dataIndex].total), ...txt({ color: C.texto, fontWeight: 700 }) } },
    ],
  }, true);
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" });
    const i = q.componentType === "yAxis" ? etiquetas.indexOf(q.value) : q.dataIndex;
    if (items[i]) alternar(campo, items[i].i, lista);
  });
}

function porGobierno(filas) {
  const id = "g-gobiernos";
  const gobs = GOB.filter((g) => filas.some((f) => f.g === g.i)).map((g) => {
    const f = filas.filter((x) => x.g === g.i);
    return { ...g, total: f.length, ...cuentaEstados(f) };
  });
  lecturaGobiernos(gobs);
  if (!gobs.length) return Obs.vacio(id);
  const angosto = document.getElementById(id).clientWidth < 460;
  barrasApiladas(id, gobs, { campo: "gobiernos", lista: GOB, etiqueta: (x) => (angosto ? x.corto : x.nombre), izq: angosto ? 96 : 176 });
}
function lecturaGobiernos(gobs) {
  if (!gobs.length) return lectura("l-gobiernos", "");
  const tasa = (x) => x.aprobada / x.total;
  // con gobiernos elegidos, la lectura habla de ellos y los compara con todos
  const sel = todos(estado.gobiernos, GOB) ? gobs : gobs.filter((x) => estado.gobiernos.has(x.i));
  if (sel.length < gobs.length || gobs.length === 1) {
    if (!sel.length) return lectura("l-gobiernos", "El gobierno elegido no tuvo procesos de censura con estos filtros.");
    const proc = sumar(sel, "total"), apr = sumar(sel, "aprobada");
    const quien = sel.length === 1 ? `Durante el gobierno de ${destacar(sel[0].nombre)}` : `En los gobiernos de ${nombres(sel.map((x) => x.nombre))}`;
    const frente = gobs.length > sel.length ? `, frente a ${fuerte(pct(sumar(gobs, "aprobada") / sumar(gobs, "total")))} en todos los gobiernos` : "";
    return lectura("l-gobiernos", `${quien} hubo ${fuerte(plural(proc, "proceso", "procesos"))} de censura. ${terminaron(apr, proc)} en una censura aprobada${frente}.`);
  }
  const alto = extremos(gobs, "total");
  let t = `${nombres(alto.map((x) => x.nombre))} ${alto.length > 1 ? "tuvieron" : "tuvo"} más procesos de censura: ` +
    `${fuerte(plural(alto[0].total, "proceso", "procesos"))}${alto.length > 1 ? " cada uno" : ""}.`;
  const comparables = gobs.filter((x) => x.total > MINIMO).map((x) => ({ ...x, tasa: tasa(x) }));
  if (comparables.length >= 2) {
    const mas = extremos(comparables, "tasa"), menos = extremos(comparables, "tasa", false);
    if (mas[0].tasa !== menos[0].tasa) t += ` Entre los gobiernos con más de ${fuerte(MINIMO)} procesos, la proporción de censuras aprobadas fue mayor con ` +
      `${nombres(mas.map((x) => x.nombre))} (${fuerte(pct(mas[0].tasa))}); con ${nombres(menos.map((x) => x.nombre))}, ` +
      `${menos[0].tasa === 0 ? `no se aprobó ${fuerte("ninguna")}` : `fue de ${fuerte(pct(menos[0].tasa))}`}.`;
  }
  lectura("l-gobiernos", t);
}

/* ---------- Días por proceso en cada gobierno (tabla con total ponderado) ---------- */
function tablaGobiernos(filas) {
  const gobs = gobiernosEnAlcance(estado).map((g) => {
    const f = filas.filter((x) => x.g === g.i);
    return { ...g, procesos: f.length, porProceso: ritmo([g], f.length).porProceso };
  });
  const total = ritmo(gobs, gobs.reduce((t, g) => t + g.procesos, 0));
  const columnas = [
    { clave: "gobierno", titulo: "Gobierno", valor: (g) => g.i, html: (g) => `<span class="gobierno">${Obs.escapar(g.nombre)}</span>` },
    { clave: "procesos", titulo: "Procesos", num: true, valor: (g) => g.procesos, html: (g) => num(g.procesos) },
    { clave: "dias", titulo: "Días", num: true, valor: (g) => g.diasAlcance, html: (g) => num(g.diasAlcance) },
    { clave: "ritmo", titulo: "Días por proceso", num: true, valor: (g) => g.porProceso,
      html: (g) => (g.porProceso == null ? '<span class="sin-dato">Sin procesos</span>' : `<strong>${num(g.porProceso, 1)}</strong>`) },
  ];
  const pie = gobs.length > 1 ? `<tr><td>Total<small>Promedio ponderado</small></td><td class="num">${num(total.procesos)}</td>` +
    `<td class="num">${num(total.dias)}</td><td class="num">${total.porProceso == null ? "—" : num(total.porProceso, 1)}</td></tr>` : "";
  tablaOrdenable("t-gobiernos", columnas, gobs, {
    inicial: { clave: "gobierno", dir: 1 }, desempate: (a, b) => a.i - b.i, claveFila: (g) => g.i,
    elegidas: todos(estado.gobiernos, GOB) ? null : estado.gobiernos, alClic: (k) => alternar("gobiernos", +k, GOB),
    descripcion: "Procesos de censura, días de gobierno y días por proceso en cada gobierno", pie,
  });
  // lectura: el ritmo más intenso y el más pausado
  const con = gobs.filter((g) => g.porProceso != null);
  const dias = (g) => fuerte(`${num(g.porProceso, 1)} días`);
  if (!con.length) lectura("l-ritmo", "");
  else if (con.length === 1) lectura("l-ritmo", `Con ${destacar(con[0].nombre)} hubo un proceso de censura cada ${dias(con[0])}.`);
  else {
    const rapido = extremos(con, "porProceso", false)[0], lento = extremos(con, "porProceso")[0];
    lectura("l-ritmo", `Con ${destacar(rapido.nombre)} hubo un proceso de censura cada ${dias(rapido)}, el ritmo más intenso; con ${destacar(lento.nombre)}, uno cada ${dias(lento)}. ` +
      `En conjunto, uno cada ${fuerte(`${num(total.porProceso, 1)} días`)}.`);
  }
}

/* ---------- Por ministerio (barras apiladas por resultado) ---------- */
function porSector(filas) {
  const id = "g-sectores";
  const secs = SEC.map((nombre, i) => { const f = filas.filter((x) => x.s === i); return { i, nombre, total: f.length, ...cuentaEstados(f) }; })
    .filter((x) => x.total).sort((a, b) => b.total - a.total || b.aprobada - a.aprobada || a.nombre.localeCompare(b.nombre, "es"));
  lecturaSectores(secs);
  if (!secs.length) return Obs.vacio(id);
  const angosto = document.getElementById(id).clientWidth < 560;
  barrasApiladas(id, secs, { campo: "sectores", lista: SEC, etiqueta: (x) => (angosto ? sectorCorto(x.nombre) : x.nombre), izq: angosto ? 130 : 290 });
}
function lecturaSectores(secs) {
  if (!secs.length) return lectura("l-sectores", "");
  const sel = todos(estado.sectores, SEC) ? secs : secs.filter((x) => estado.sectores.has(x.i));
  if (sel.length < secs.length || secs.length === 1) {
    if (!sel.length) return lectura("l-sectores", "El ministerio elegido no tuvo procesos de censura con estos filtros.");
    const proc = sumar(sel, "total");
    return lectura("l-sectores", `${sel.length === 1 ? destacar(sel[0].nombre) : nombres(sel.map((x) => x.nombre))} ${sel.length === 1 ? "tuvo" : "tuvieron"} ` +
      `${fuerte(plural(proc, "proceso", "procesos"))} de censura. ${terminaron(sumar(sel, "aprobada"), proc)} en una censura aprobada.`);
  }
  const total = sumar(secs, "total");
  const alto = extremos(secs, "total");
  let t = alto.length === 1
    ? `${destacar(alto[0].nombre)} fue el ministerio con más procesos de censura: ${fuerte(plural(alto[0].total, "proceso", "procesos"))} ` +
      `(${fuerte(pct(alto[0].total / total))} del total), con ${fuerte(plural(alto[0].aprobada, "censura aprobada", "censuras aprobadas"))}.`
    : `${nombres(alto.map((x) => x.nombre))} fueron los ministerios con más procesos de censura: ${fuerte(plural(alto[0].total, "proceso", "procesos"))} cada uno.`;
  const apr = sumar(secs, "aprobada");
  const conApr = secs.filter((x) => x.aprobada);
  if (apr && conApr.length > 1) t += ` Las ${fuerte(num(apr))} censuras aprobadas se reparten entre ${fuerte(plural(conApr.length, "ministerio", "ministerios"))}.`;
  lectura("l-sectores", t);
}

/* ---------- Ministros (tabla) ----------
   Una fila por ministro, gobierno y ministerio, como en el informe de Looker. */
function tablaMinistros(filas) {
  const grupos = new Map();
  filas.forEach((f) => {
    const k = `${f.ministro}|${f.g}|${f.s}`;
    if (!grupos.has(k)) grupos.set(k, { ministro: f.ministro, g: f.g, s: f.s, procesos: 0, ...Object.fromEntries(ESTADOS.map((e) => [e.clave, 0])) });
    const x = grupos.get(k); x.procesos++; x[f.estado]++;
  });
  const lista = [...grupos.values()];
  const personas = new Set(lista.map((x) => x.ministro)).size;
  document.getElementById("h-ministros").textContent = `${plural(personas, "ministro tuvo", "ministros tuvieron")} procesos de censura`;
  lecturaMinistros(filas);
  const n = (clave) => ({ clave, num: true, valor: (x) => x[clave], html: (x) => (x[clave] ? num(x[clave]) : '<span class="sin-dato">0</span>') });
  const columnas = [
    { clave: "ministro", titulo: "Ministro", valor: (x) => x.ministro, html: (x) => `<span class="ministro">${Obs.escapar(x.ministro)}<small>${Obs.escapar(SEC[x.s])}</small></span>` },
    { clave: "gobierno", titulo: "Gobierno", valor: (x) => x.g, html: (x) => Obs.escapar(GOB[x.g].nombre) },
    { ...n("procesos"), titulo: "Procesos" },
    ...ESTADOS.map((e) => ({ ...n(e.clave), titulo: e.corto })),
  ];
  tablaOrdenable("t-ministros", columnas, lista, {
    inicial: { clave: "procesos", dir: -1 }, desempate: (a, b) => b.aprobada - a.aprobada || a.ministro.localeCompare(b.ministro, "es"),
    descripcion: "Ministros con procesos de censura, por gobierno y ministerio, según el resultado",
  });
}
// El ministro (persona) con más procesos, sumando todos sus gobiernos y ministerios
function lecturaMinistros(filas) {
  const m = new Map();
  filas.forEach((f) => {
    const x = m.get(f.ministro) ?? { nombre: f.ministro, procesos: 0, aprobada: 0, sectores: new Set(), gobs: new Set() };
    x.procesos++; if (f.estado === "aprobada") x.aprobada++; x.sectores.add(f.sector); x.gobs.add(GOB[f.g].nombre);
    m.set(f.ministro, x);
  });
  const lista = [...m.values()];
  const alto = extremos(lista, "procesos");
  if (!alto.length) return lectura("l-ministros", "");
  const n = plural(alto[0].procesos, "proceso", "procesos");
  let t;
  if (alto.length === 1) {
    const x = alto[0];
    const final = x.aprobada === x.procesos ? (x.procesos === 1 ? "terminó" : "todos terminaron") : x.aprobada === 0 ? (x.procesos === 1 ? "no terminó" : "ninguno terminó")
      : `${fuerte(num(x.aprobada))} ${x.aprobada === 1 ? "terminó" : "terminaron"}`;
    t = `${destacar(x.nombre)} (${nombres([...x.sectores])}, gobierno de ${nombres([...x.gobs])}) es el ministro con más procesos de censura: ${fuerte(n)}; ${final} en una censura aprobada.`;
  } else {
    t = alto.length <= 3
      ? `${nombres(alto.map((x) => x.nombre))} son los ministros con más procesos de censura: ${fuerte(n)} cada uno.`
      : `${fuerte(num(alto.length))} ministros tuvieron ${fuerte(n)} de censura, el máximo con estos filtros.`;
  }
  // cada moción cuenta como un proceso, aunque varias pidan censurar al mismo ministro
  const varias = lista.filter((x) => x.aprobada > 1);
  if (varias.length) t += ` Cada moción cuenta por separado: por eso ${varias.length === 1 ? `${destacar(varias[0].nombre)} suma` : `${nombres(varias.map((x) => x.nombre))} suman`} ` +
    "más de una moción de censura aprobada.";
  lectura("l-ministros", t);
}

/* ---------- Cada proceso de censura (la tabla del informe de Looker) ----------
   Recibe las filas ya filtradas por el buscador; los botones de resultado solo la afectan a ella. */
function pintarBusqueda(filas) {
  const b = sinTildes(estado.buscar.trim());
  tablaPedidos(b ? filas.filter((f) => f.busqueda.includes(b)) : filas);
}
function tablaPedidos(filas) {
  const cuenta = cuentaEstados(filas);
  const opciones = [{ clave: "", corto: "Todos", n: filas.length }, ...ESTADOS.map((e) => ({ clave: e.clave, corto: e.corto, n: cuenta[e.clave] }))];
  document.getElementById("f-resultado").innerHTML = opciones.map((o) =>
    `<button type="button" data-resultado="${o.clave}" aria-pressed="${estado.resultado === o.clave}">${o.corto}<small>${num(o.n)}</small></button>`).join("");
  const lista = estado.resultado ? filas.filter((f) => f.estado === estado.resultado) : filas;
  const nombre = ESTADOS.find((e) => e.clave === estado.resultado)?.nombre;
  document.getElementById("h-pedidos").textContent = lista.length
    ? `${plural(lista.length, "proceso", "procesos")} de censura, en ${plural(mociones(lista), "moción", "mociones")}${nombre ? `: ${Obs.minus(nombre)}` : ""}`
    : "Cada proceso de censura";
  const esc = Obs.escapar;
  const columnas = [
    { clave: "mocion", titulo: "Moción", valor: (f) => +f.legis.slice(0, 4) * 1e6 + (+f.mocion || 0), html: (f) => `<span class="doc">${esc(f.mocion)}</span>` },
    { clave: "legis", titulo: "Legislatura", valor: (f) => f.legis, html: (f) => `<span class="fecha">${esc(f.legis)}</span>` },
    { clave: "gobierno", titulo: "Gobierno", valor: (f) => f.g, html: (f) => esc(GOB[f.g].nombre) },
    { clave: "sector", titulo: "Ministerio", valor: (f) => f.sector, html: (f) => esc(f.sector) },
    { clave: "ministro", titulo: "Ministro", valor: (f) => f.ministro, html: (f) => `<span class="ministro">${esc(f.ministro)}</span>` },
    { clave: "resultado", titulo: "Resultado", valor: (f) => ESTADOS.findIndex((e) => e.clave === f.estado),
      html: (f) => `<span class="resultado"><i style="background:${C.estado[f.estado]}"></i>${ESTADOS.find((e) => e.clave === f.estado).nombre}</span>` },
  ];
  tablaOrdenable("t-pedidos", columnas, lista, {
    inicial: { clave: "mocion", dir: -1 }, desempate: (a, b) => a.ministro.localeCompare(b.ministro, "es"),
    descripcion: "Cada proceso de censura: moción, legislatura, gobierno, ministerio, ministro y resultado",
    vacia: estado.buscar.trim() ? `Nada coincide con «${esc(estado.buscar.trim())}» con estos filtros. Prueba con un apellido o un número de moción.` : null,
  });
}

/* =========== Tabla ordenable ===========
   columnas: [{ clave, titulo, num, valor(fila), html(fila) }]
   Sin alClic, las filas no se pueden elegir. `pie` es el HTML de una fila de totales. */
function tablaOrdenable(id, columnas, filas, { inicial, desempate = () => 0, claveFila, elegidas, alClic, descripcion, pie = "", vacia = null }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave);
  // los vacíos (p. ej., «Sin procesos») van siempre al final
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
  if (!todos(estado.periodos, PER)) ordenados(estado.periodos).forEach((i) => chip(`Congreso ${PER[i]}`, `l:${i}`));
  if (!todos(estado.gobiernos, GOB)) ordenados(estado.gobiernos).forEach((i) => chip(GOB[i].nombre, `g:${i}`));
  if (!todos(estado.sectores, SEC)) ordenados(estado.sectores).forEach((i) => chip(SEC[i], `s:${i}`));
  document.getElementById("aplicados").hidden = !chips.length;
  document.getElementById("aplicados-lista").innerHTML = chips.join("");
}

function sincronizarControles() {
  multiPer.sincronizar(estado.periodos);
  multiGob.sincronizar(estado.gobiernos);
  multiSec.sincronizar(estado.sectores);
  const buscar = document.getElementById("f-buscar");
  if (buscar.value !== estado.buscar) buscar.value = estado.buscar;
}

function actualizar(parche) {
  Object.assign(estado, parche);
  render();
}

const CAMPOS = { l: ["periodos", () => PER], g: ["gobiernos", () => GOB], s: ["sectores", () => SEC] };

function montarControles() {
  const filtros = document.getElementById("filtros");
  multiPer = new Obs.Multiseleccion(filtros, {
    id: "f-periodos", etiqueta: "Congreso", todos: "Todos los Congresos",
    opciones: PER.map((p, i) => ({ valor: i, etiqueta: p })),
    alCambiar: (sel) => actualizar({ periodos: sel }),
  });
  multiGob = new Obs.Multiseleccion(filtros, {
    id: "f-gobiernos", etiqueta: "Gobierno", todos: "Todos los gobiernos",
    opciones: GOB.map((g) => ({ valor: g.i, etiqueta: g.nombre })),
    alCambiar: (sel) => actualizar({ gobiernos: sel }),
  });
  multiSec = new Obs.Multiseleccion(filtros, {
    id: "f-sectores", etiqueta: "Ministerio", todos: "Todos los ministerios",
    opciones: SEC.map((s, i) => ({ valor: i, etiqueta: s })),
    alCambiar: (sel) => actualizar({ sectores: sel }),
  });

  document.getElementById("aplicados").onclick = (e) => {
    if (e.target.closest("#quitar-todo")) return actualizar({ periodos: todosLos(PER), gobiernos: todosLos(GOB), sectores: todosLos(SEC) });
    const q = e.target.closest("[data-quitar]")?.dataset.quitar;
    if (!q) return;
    const [c, i] = q.split(":");
    const [campo, lista] = CAMPOS[c];
    const nuevo = new Set(estado[campo]); nuevo.delete(+i);
    actualizar({ [campo]: nuevo.size ? nuevo : todosLos(lista()) });
  };

  // el buscador y los botones de resultado solo redibujan la tabla de cada proceso
  const buscar = document.getElementById("f-buscar");
  buscar.oninput = () => {
    estado.buscar = buscar.value;
    clearTimeout(buscar.__espera);
    buscar.__espera = setTimeout(() => { pintarBusqueda(filtrar(estado).todo); escribirURL(); }, 150);
  };
  // la leyenda del gráfico de cuadros elige un resultado (otro clic lo quita) y filtra la tabla de cada proceso
  document.getElementById("ley-cuadros").onclick = (e) => {
    const b = e.target.closest("button[data-resultado]");
    if (!b) return;
    estado.resultado = estado.resultado === b.dataset.resultado ? "" : b.dataset.resultado;
    const filas = filtrar(estado).todo;
    cuadros(filas); pintarBusqueda(filas); escribirURL();
    document.getElementById("ley-cuadros").querySelector(`button[data-resultado="${b.dataset.resultado}"]`)?.focus();
  };
  const resultado = document.getElementById("f-resultado");
  resultado.onclick = (e) => {
    const b = e.target.closest("button[data-resultado]");
    if (!b) return;
    estado.resultado = b.dataset.resultado;
    const filas = filtrar(estado).todo;
    cuadros(filas); pintarBusqueda(filas);
    escribirURL();
    resultado.querySelector(`button[data-resultado="${estado.resultado}"]`)?.focus(); // los botones se redibujan
  };
}

function leerURL() {
  const q = Obs.parametros();
  const indices = (k, lista) => {
    const v = (q.get(k) || "").split("-").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < lista.length);
    return v.length ? new Set(v) : todosLos(lista);
  };
  estado.periodos = indices("congresos", PER);
  estado.gobiernos = indices("gobiernos", GOB);
  estado.sectores = indices("sectores", SEC);
  estado.buscar = q.get("buscar") ?? "";
  if (ESTADOS.some((e) => e.clave === q.get("resultado"))) estado.resultado = q.get("resultado");
}

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(),
    estado: Object.fromEntries(ESTADOS_TODOS.map((e) => [e.clave, v(e.css)])),
    dos: Object.fromEntries(DOS.map((e) => [e.clave, v(e.css)])) };
  preparar(datos.tablas);
  ACTUALIZADO = datos.actualizado || "";
  const [a, m, d] = ACTUALIZADO.split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";
  document.querySelectorAll(".ley-dos").forEach((el) => (el.innerHTML = DOS.map((e) => `<span><i style="background:${C.dos[e.clave]}"></i>${e.nombre}</span>`).join("")));

  montarControles();
  leerURL();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
