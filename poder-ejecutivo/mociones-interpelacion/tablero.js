/* =========================================================
   Tablero de Mociones de interpelación — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma el Apps Script (Tableros > Publicar
   tableros) desde el Sheet «6. Mociones de Interpelación». Todo se
   calcula desde la pestaña «General» (una fila por moción y ministro
   cuestionado), así los filtros se aplican igual a cada gráfico y tabla.
   De «Mociones por gobierno» solo se toman los días de cada gobierno.

   Definiciones:
     moción   el documento que presentan los congresistas (Número + Número_Moción)
     proceso  cada ministro cuestionado en una moción (una fila de «General»)
     días por proceso  días de gobierno ÷ procesos; el total es ponderado
              (todos los días entre todos los procesos), no el promedio de los gobiernos.
              Cada gobierno cae entero dentro de un Congreso (ambos cambian el 28 de julio).

   Dos pestañas: Mociones de interpelación (lo que pidió el Congreso) e
   Interpelaciones realizadas (lo que llegó al Pleno; en preparación).
   Filtros comunes: Congreso, Gobierno y Sector (selección múltiple, también
   con clics en los gráficos). Cada gráfico ignora el filtro de su propia
   categoría y resalta lo elegido; las tablas aplican todos los filtros.
   Patrón: un objeto `estado`, una función pura `filtrar()` y una sola `render()`.

   Parámetros de URL:
     ?modulo=realizadas&congresos=4&gobiernos=6-7&sectores=9&buscar=<texto>&resultado=realizada|rechazada|archivada|proceso&buscar_r=<texto>
     (índices, en orden cronológico los Congresos y gobiernos y alfabético los sectores)
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "mociones-interpelacion";
const ARCHIVOS = [{ clave: "mociones_interpelacion_base", etiqueta: "Mociones de interpelación (2001-2026)" }];
const MODULOS = ["mociones", "realizadas"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
// Resultado de cada proceso, en el orden de la pila: de lo que llegó más lejos a lo que sigue abierto
const ESTADOS = [
  { clave: "realizada", nombre: "Interpelación realizada", corto: "Realizadas", css: "--e-realizada" },
  { clave: "rechazada", nombre: "Admisión rechazada", corto: "Rechazadas", css: "--e-rechazada" },
  { clave: "archivada", nombre: "Archivada", corto: "Archivadas", css: "--e-archivada" },
  { clave: "proceso", nombre: "En proceso", corto: "En proceso", css: "--e-proceso" },
];
// Series del gráfico por Congreso
const SERIES = [
  { clave: "procesos", nombre: "Procesos (ministros cuestionados)", corto: "Procesos", css: "--s-procesos" },
  { clave: "mociones", nombre: "Mociones presentadas", corto: "Mociones", css: "--s-mociones" },
  { clave: "realizadas", nombre: "Interpelaciones realizadas", corto: "Realizadas", css: "--s-realizadas" },
];
// Matriz: tramos de procesos por celda
const TRAMOS = [[1, 1, "1"], [2, 2, "2"], [3, 4, "3 a 4"], [5, 9, "5 a 9"], [10, Infinity, "10 o más"]];
// Fechas de cada Congreso (período parlamentario). El de 2016 fue disuelto el 30/09/2019; el
// interregno hasta la instalación del Congreso complementario (16/03/2020) se cuenta en el de 2016-2020.
const CONGRESOS = {
  "2001-2006": ["2001-07-28", "2006-07-28"], "2006-2011": ["2006-07-28", "2011-07-28"], "2011-2016": ["2011-07-28", "2016-07-28"],
  "2016-2020": ["2016-07-28", "2020-03-16"], "2020-2021": ["2020-03-16", "2021-07-28"], "2021-2026": ["2021-07-28", "2026-07-28"],
  "2026-2031": ["2026-07-28", null],
};
// Inicio de cada gobierno; su fin es el inicio más sus días (pestaña «Mociones por gobierno»).
// Sirve para repartir los días de un gobierno entre dos Congresos (Vizcarra: 2016-2020 y 2020-2021).
const INICIO_GOBIERNO = {
  "Alejandro Toledo": "2001-07-28", "Alan García": "2006-07-28", "Ollanta Humala": "2011-07-28", "Pedro Pablo Kuczynski": "2016-07-28",
  "Martín Vizcarra": "2018-03-23", "Pedro Castillo": "2021-07-28", "Dina Boluarte": "2022-12-07", "José Jerí": "2025-10-10",
  "José María Balcázar": "2026-02-18", "Keiko Fujimori": "2026-07-28",
};
const SECTOR_CORTO = { "Presidencia del Consejo de Ministros": "Presidencia del Consejo", "Vivienda, Construcción y Saneamiento": "Vivienda",
  "Trabajo y Promoción del Empleo": "Trabajo", "Mujer y Poblaciones Vulnerables": "Mujer", "Comercio Exterior y Turismo": "Comercio Exterior",
  "Justicia y Derechos Humanos": "Justicia", "Transportes y Comunicaciones": "Transportes", "Desarrollo e Inclusión Social": "Inclusión Social",
  "Desarrollo Agrario y Riego": "Desarrollo Agrario" };

// buscar y resultado solo afectan a la tabla de cada proceso; buscarR, a la de interpelaciones realizadas
const estado = { modulo: "mociones", periodos: null, gobiernos: null, sectores: null, buscar: "", resultado: "", buscarR: "" };

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
// «Pedro Pablo Kuczynski» -> «Kuczynski»; «Keiko Fujimori» -> «K. Fujimori» (no se confunde con Alberto)
const corto = (nombre) => (nombre === "Pedro Pablo Kuczynski" ? "Kuczynski" : nombre === "Keiko Fujimori" ? "K. Fujimori" : nombre.split(" ").at(-1));
const sectorCorto = (s) => SECTOR_CORTO[s] ?? s;
function fecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
function clasificar(conclusion) {
  const c = conclusion.toLowerCase();
  if (c.startsWith("aprobada")) return "realizada";
  if (c.startsWith("admisión rechazada")) return "rechazada";
  if (c.startsWith("en proceso")) return "proceso";
  return "archivada";
}
const numero = (v) => (v == null || String(v).trim() === "" || isNaN(+v) ? null : +v);
const mediana = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cuentaEstados = (filas) => Object.fromEntries(ESTADOS.map((e) => [e.clave, filas.filter((f) => f.estado === e.clave).length]));
const mociones = (filas) => new Set(filas.map((f) => f.clave)).size;

/* =========== Datos =========== */
function preparar(T) {
  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  const periodo = (v) => String(v ?? "").replace(/\s+/g, ""); // «2016 -2021» -> «2016-2021»
  const crudas = Obs.expandir(T.General).map((f) => ({
    num: limpio(f["Número"]), mocion: limpio(f["Número_Moción"]), gobierno: limpio(f.Gobierno), periodo: periodo(f.Periodo_Parlamentario),
    fecha: fecha(f["Fecha_presentación"]), ministro: limpio(f.Ministro_Interpelado), sector: limpio(f.Sector),
    estado: clasificar(limpio(f["Conclusión"])), legis: limpio(f.Periodo_Anual_Sesiones).replace(/\s*-\s*/, "-"),
    sumilla: limpio(f.Sumilla), link: /^https?:\/\//.test(limpio(f.link)) ? limpio(f.link) : "",
    // votación de admisión, pliego e interpelación (pestaña Interpelaciones realizadas)
    admision: fecha(f["Fecha_admisión_debate"]), concurrencia: fecha(f.Fecha_Concurrencia),
    favor: numero(f.A_favor_admision), contra: numero(f.En_contra_admision), abst: numero(f["Abstención_admision"]),
    asistentes: numero(f.Asistentes_admision), preguntas: numero(f.Cantidad_preguntas), observacion: limpio(f["Observación"]),
  })).filter((f) => f.gobierno && f.periodo && f.ministro);
  // texto en el que busca el buscador (sin tildes)
  crudas.forEach((f) => (f.busqueda = sinTildes(`${f.ministro} ${f.mocion} ${f.sumilla}`)));
  // la moción se identifica por su número correlativo y su número oficial
  crudas.forEach((f) => (f.clave = `${f.num}|${f.mocion}`));

  PER = [...new Set(crudas.map((f) => f.periodo))].sort();
  // gobiernos en el orden en que gobernaron: el número correlativo de la primera moción
  const primera = new Map();
  crudas.forEach((f) => { const n = parseFloat(f.num); if (!(primera.get(f.gobierno) <= n)) primera.set(f.gobierno, n); });
  const dias = new Map(Obs.expandir(T["Mociones por gobierno"]).map((x) => [limpio(x.Gobierno), +x["Días"] || null]));
  GOB = [...primera.keys()].sort((a, b) => primera.get(a) - primera.get(b)).map((nombre, i) => {
    const periodos = [...new Set(crudas.filter((f) => f.gobierno === nombre).map((f) => f.periodo))].sort();
    const g = { i, nombre, corto: corto(nombre), periodos, dias: dias.get(nombre) ?? null };
    g.diasPor = repartirDias(g);
    return g;
  });
  GOB.at(-1).enCurso = true;
  SEC = [...new Set(crudas.map((f) => f.sector))].sort((a, b) => a.localeCompare(b, "es"));

  FILAS = crudas.map((f) => ({ ...f, p: PER.indexOf(f.periodo), g: GOB.findIndex((x) => x.nombre === f.gobierno), s: SEC.indexOf(f.sector) }));
}
/* Días de un gobierno en cada Congreso: Map(período -> días). Se cruzan las fechas del gobierno
   (inicio + días) con las de cada Congreso. Si falta alguna fecha, todos los días van al primer
   Congreso en que el gobierno tiene mociones. */
const DIA = 864e5;
const aDia = (s) => Date.parse(`${s}T00:00:00Z`) / DIA;
function repartirDias(g) {
  const reparto = new Map();
  const inicio = INICIO_GOBIERNO[g.nombre];
  if (g.dias == null) return reparto;
  if (!inicio || g.periodos.some((p) => !CONGRESOS[p])) {
    if (g.periodos.length > 1) console.warn(`Faltan fechas para repartir los días de ${g.nombre} entre Congresos`);
    reparto.set(g.periodos[0], g.dias);
    return reparto;
  }
  const a = aDia(inicio), b = a + g.dias;
  for (const [p, [desde, hasta]] of Object.entries(CONGRESOS)) {
    const d = Math.min(b, hasta ? aDia(hasta) : Infinity) - Math.max(a, aDia(desde));
    if (d > 0) reparto.set(p, Math.round(d));
  }
  return reparto;
}
const periodoEnCurso = (i) => CONGRESOS[PER[i]] ? CONGRESOS[PER[i]][1] === null : GOB.some((g) => g.enCurso && g.periodos.includes(PER[i]));
const diasEn = (g, periodos) => periodos.reduce((t, p) => t + (g.diasPor.get(PER[p]) ?? 0), 0);
// Gobiernos que entran en el cálculo de días: los elegidos, con sus días dentro de los Congresos elegidos
const gobiernosEnAlcance = (e) => GOB.filter((g) => e.gobiernos.has(g.i)).map((g) => ({ ...g, diasAlcance: diasEn(g, [...e.periodos]) }))
  .filter((g) => g.diasAlcance > 0);
function ritmo(gobs, procesos) {
  const dias = gobs.reduce((t, g) => t + g.diasAlcance, 0);
  return { dias, procesos, porPedido: procesos > 0 && dias > 0 ? dias / procesos : null };
}

/* Cada gráfico usa el subconjunto que ignora su propio filtro; las tablas usan `todo` */
function filtrar(e) {
  const enP = (f) => e.periodos.has(f.p), enG = (f) => e.gobiernos.has(f.g), enS = (f) => e.sectores.has(f.s);
  return {
    todo: FILAS.filter((f) => enP(f) && enG(f) && enS(f)),
    sinPeriodo: FILAS.filter((f) => enG(f) && enS(f)),
    sinGobierno: FILAS.filter((f) => enP(f) && enS(f)),
    sinSector: FILAS.filter((f) => enP(f) && enG(f)),
    sinCruce: FILAS.filter(enP),
  };
}

/* =========== Render =========== */
function render() {
  sincronizarControles();
  const s = filtrar(estado);
  if (estado.modulo === "mociones") pintarMociones(s);
  else pintarRealizadas(s);
  pintarAplicados();
  escribirURL();
}
function escribirURL() {
  const lista = (sel, l) => (todos(sel, l) ? null : [...sel].sort((a, b) => a - b).join("-"));
  Obs.escribirURL({
    modulo: estado.modulo === "mociones" ? null : estado.modulo,
    congresos: lista(estado.periodos, PER), gobiernos: lista(estado.gobiernos, GOB), sectores: lista(estado.sectores, SEC),
    buscar: estado.buscar.trim() || null, resultado: estado.resultado || null, buscar_r: estado.buscarR.trim() || null,
  });
}

/* ---------- Lecturas: una o dos frases por gráfico que cambian con los filtros ----------
   Moción = documento; proceso = ministro cuestionado. Nunca se cuentan unos como los otros;
   «interpelación» solo aparece como resultado. */
const lectura = (id, html) => (document.getElementById(id).innerHTML = html);
const fuerte = (s) => `<strong>${s}</strong>`;
const enumerar = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
// todo dato que cambia con los filtros va destacado (negrita azul con línea lima, ver estilos.css)
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
const terminaron = (real, n) => (real === 0 ? (n === 1 ? "No terminó" : "Ninguno terminó")
  : real === n ? (n === 1 ? "Terminó" : "Todos terminaron") : `${fuerte(pct(real / n))} terminó`);
const sumar = (lista, k) => lista.reduce((t, x) => t + x[k], 0);

// Texto del alcance elegido, para el resumen
function alcance() {
  const e = estado;
  if (!todos(e.gobiernos, GOB)) return e.gobiernos.size === 1 ? `Durante el gobierno de ${destacar(GOB[[...e.gobiernos][0]].nombre)}` : `En los ${destacar(e.gobiernos.size)} gobiernos elegidos`;
  if (!todos(e.periodos, PER)) return e.periodos.size === 1 ? `En el Congreso ${destacar(PER[[...e.periodos][0]])}` : `En los ${destacar(e.periodos.size)} Congresos elegidos`;
  const anios = FILAS.map((f) => f.fecha?.getUTCFullYear()).filter(Boolean);
  return `Entre ${destacar(Math.min(...anios))} y ${destacar(Math.max(...anios))}`;
}
function aQuien() {
  const e = estado;
  if (todos(e.sectores, SEC)) return "contra ministros";
  return e.sectores.size === 1 ? `contra ministros del sector ${destacar(SEC[[...e.sectores][0]])}` : `contra ministros de ${destacar(e.sectores.size)} sectores`;
}

/* =========== Pestaña: Mociones de interpelación =========== */
function pintarMociones(s) {
  cifras(s.todo);
  porCongreso(s.sinPeriodo);
  porGobierno(s.sinGobierno);
  tablaGobiernos(s.todo);
  matriz(s.sinCruce);
  porSector(s.sinSector);
  tablaMinistros(s.todo);
  pintarBusqueda(s.todo);
}
// El buscador y el resultado solo afectan a la tabla de cada proceso
function pintarBusqueda(filas) {
  const b = sinTildes(estado.buscar.trim());
  tablaPedidos(b ? filas.filter((f) => f.busqueda.includes(b)) : filas);
}

function cifras(filas) {
  const el = document.getElementById("r-mociones");
  const moc = mociones(filas), real = filas.filter((f) => f.estado === "realizada").length;
  const r = ritmo(gobiernosEnAlcance(estado), filas.length);
  if (!filas.length) {
    el.textContent = "No hubo mociones de interpelación con estos filtros. Quita alguno para ver datos.";
  } else {
    el.innerHTML = `${alcance()}, ${moc === 1 ? "se presentó" : "se presentaron"} <strong>${plural(moc, "moción de interpelación", "mociones de interpelación")}</strong>, ` +
      `con <strong>${plural(filas.length, "proceso", "procesos")}</strong> ${aQuien()}. ` +
      (real ? `<strong>${num(real)}</strong> ${real === 1 ? "terminó" : "terminaron"} en una interpelación ante el Pleno (${fuerte(pct(real / filas.length))}).`
        : "Ninguno terminó en una interpelación ante el Pleno.");
  }
  Obs.kpi("k-mociones", { etiqueta: "Mociones presentadas", valor: num(moc), pie: "Documentos presentados por los congresistas" });
  Obs.kpi("k-procesos", { etiqueta: "Procesos de interpelación", valor: num(filas.length),
    pie: moc ? `Un proceso por cada ministro cuestionado: ${num(filas.length / moc, 2)} por moción` : "Un proceso por cada ministro cuestionado" });
  Obs.kpi("k-realizadas", { etiqueta: "Interpelaciones realizadas", valor: num(real), pie: filas.length ? `${pct(real / filas.length)} de los procesos llegó al Pleno` : "" });
  Obs.kpi("k-ritmo", { etiqueta: "Un proceso cada", valor: r.porPedido == null ? "—" : `${num(r.porPedido)} días`,
    pie: r.porPedido == null ? "Sin procesos con estos filtros" : `Promedio ponderado: ${num(r.dias)} días de gobierno entre ${plural(r.procesos, "proceso", "procesos")}` });
}

/* ---------- Por Congreso (líneas) ----------
   Tres series en un solo eje (mociones, procesos y realizadas: todo son conteos). El Congreso en curso
   va con línea punteada: todavía no termina. */
function porCongreso(filas) {
  const id = "g-congreso";
  const datos = PER.map((p, i) => {
    const f = filas.filter((x) => x.p === i);
    return { procesos: f.length, mociones: mociones(f), realizadas: f.filter((x) => x.estado === "realizada").length,
      gobiernos: GOB.filter((g) => g.diasPor.has(p) || g.periodos.includes(p)).map((g) => g.nombre) };
  });
  document.getElementById("ley-congreso").innerHTML = SERIES.map((x) => `<span><i class="linea" style="background:${C.serie[x.clave]}"></i>${x.nombre}</span>`).join("");
  const enCurso = PER.findIndex((_, i) => periodoEnCurso(i));
  document.getElementById("p-congreso").textContent = enCurso >= 0
    ? `El Congreso ${PER[enCurso]} está en curso: la línea punteada llega hasta la última actualización de los datos.` : "";
  lecturaCongreso(datos, enCurso);
  if (!datos.some((d) => d.procesos)) return Obs.vacio(id);

  const el = document.getElementById(id);
  const elegidos = !todos(estado.periodos, PER);
  // en celular los Congresos se abrevian («2001-06») y los números quedan solo en la burbuja
  const angosto = el.clientWidth < 600;
  const g = Obs.grafico(id);
  // cada serie se parte en dos: continua hasta el último Congreso cerrado y punteada hacia el que está en curso
  const tramo = (vals, punteado) => vals.map((v, i) => (enCurso < 0 ? (punteado ? null : v) : punteado ? (i >= enCurso - 1 ? v : null) : (i <= enCurso - 1 || enCurso === 0 ? v : null)));
  const series = SERIES.flatMap((x) => {
    const vals = datos.map((d) => d[x.clave]);
    // los Congresos elegidos llevan puntos más grandes (y su nombre resaltado en el eje)
    const comun = { type: "line", symbol: "circle", symbolSize: (_, q) => (elegidos && estado.periodos.has(q.dataIndex) ? 14 : 9),
      lineStyle: { width: 2, color: C.serie[x.clave] }, emphasis: { focus: "series" },
      itemStyle: { color: C.serie[x.clave], borderColor: "#fff", borderWidth: 2 } };
    // sin números en los puntos (se encimaban): los valores salen en la burbuja al pasar el cursor
    const label = () => ({ show: false });
    // sin endLabel: las series empiezan o terminan en nulos (da NaN) y la leyenda ya nombra cada línea
    return [
      { ...comun, name: x.nombre, data: tramo(vals, false), label: label(false) },
      { ...comun, name: x.nombre, data: tramo(vals, true), lineStyle: { ...comun.lineStyle, type: [6, 5] }, label: label(true) },
    ];
  });
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.linea, width: 2 } },
      formatter: (ps) => {
        const i = ps[0].dataIndex, d = datos[i];
        return `<strong>Congreso ${PER[i]}</strong>${i === enCurso ? " (en curso)" : ""}<br><span style="opacity:.85">${Obs.escapar(d.gobiernos.join(", "))}</span>` +
          SERIES.map((x) => `<br><span style="display:inline-block;width:10px;height:3px;margin:0 6px 3px 0;background:${C.serie[x.clave]}"></span>${x.nombre}: <strong>${num(d[x.clave])}</strong>`).join("");
      } },
    grid: { left: 44, right: 16, top: 30, bottom: 52 },
    xAxis: { type: "category", data: PER, boundaryGap: true, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto, fontWeight: 700 }), interval: 0, margin: 14, rotate: angosto ? 40 : 0,
        formatter: (v, i) => { const t = angosto ? v.replace(/-\d\d(\d\d)$/, "-$1") : v;
          return (elegidos && estado.periodos.has(i) ? `{s|${t}}` : `{n|${t}}`) + (i === enCurso && !angosto ? "\n{c|en curso}" : ""); },
        rich: { n: txt({ color: C.texto, fontWeight: 700, lineHeight: 20 }), c: txt({ lineHeight: 20 }),
          s: txt({ color: C.navy, fontWeight: 800, lineHeight: 20, backgroundColor: C.lima, padding: [2, 6], borderRadius: 3 }) } } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series,
  }, true);
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
function lecturaCongreso(datos, enCurso) {
  const con = datos.map((d, i) => ({ ...d, i })).filter((d) => d.procesos);
  if (!con.length) return lectura("l-congreso", "");
  // con Congresos elegidos, la lectura habla de ellos y los compara con el total
  if (!todos(estado.periodos, PER)) {
    const sel = con.filter((d) => estado.periodos.has(d.i));
    const suma = sumar;
    const proc = suma(sel, "procesos"), total = suma(con, "procesos");
    if (!proc) return lectura("l-congreso", "En el Congreso elegido no hubo mociones de interpelación con estos filtros.");
    const quien = sel.length === 1 ? `El Congreso ${destacar(PER[sel[0].i])} tuvo` : `Los Congresos ${nombres(sel.map((d) => PER[d.i]))} tuvieron`;
    return lectura("l-congreso", `${quien} ${fuerte(plural(proc, "proceso", "procesos"))} de interpelación, en ${fuerte(plural(suma(sel, "mociones"), "moción", "mociones"))} ` +
      `(${fuerte(pct(proc / total))} del total). ${terminaron(suma(sel, "realizadas"), proc)} en una interpelación, frente a ${fuerte(pct(suma(con, "realizadas") / total))} en todos los Congresos.`);
  }
  if (con.length === 1) {
    const d = con[0];
    return lectura("l-congreso", `Todas estas mociones se presentaron en el Congreso ${destacar(PER[d.i])}: ${fuerte(plural(d.mociones, "moción", "mociones"))} ` +
      `con ${fuerte(plural(d.procesos, "proceso", "procesos"))} de interpelación; ${d.realizadas === 1 ? `${fuerte("uno")} terminó` : `${fuerte(num(d.realizadas))} terminaron`} en una interpelación.`);
  }
  const total = con.reduce((t, d) => t + d.procesos, 0);
  const alto = extremos(con, "procesos");
  const bajo = extremos(con.filter((d) => d.i !== enCurso), "procesos", false).filter((d) => !alto.includes(d));
  const cuantos = fuerte(plural(alto[0].procesos, "proceso", "procesos"));
  let t = alto.length === 1
    ? `El Congreso ${destacar(PER[alto[0].i])} fue el que más procesos de interpelación tuvo: ${cuantos}, en ${fuerte(plural(alto[0].mociones, "moción", "mociones"))} ` +
      `(${fuerte(pct(alto[0].procesos / total))} del total).`
    : `Los Congresos ${nombres(alto.map((d) => PER[d.i]))} fueron los que más procesos de interpelación tuvieron: ${cuantos} cada uno.`;
  if (bajo.length) t += ` ${bajo.length === 1 ? `El que menos, el ${destacar(PER[bajo[0].i])}` : `Los que menos, ${nombres(bajo.map((d) => PER[d.i]))}`}: ` +
    `${fuerte(plural(bajo[0].procesos, "proceso", "procesos"))}${bajo.length > 1 ? " cada uno" : ""}.`;
  lectura("l-congreso", t);
}

/* ---------- Por gobierno (barras apiladas por resultado) ---------- */
function porGobierno(filas) {
  const id = "g-gobiernos";
  const gobs = GOB.filter((g) => filas.some((f) => f.g === g.i)).map((g) => {
    const f = filas.filter((x) => x.g === g.i);
    return { ...g, total: f.length, ...cuentaEstados(f) };
  });
  lecturaGobiernos(gobs);
  if (!gobs.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${gobs.length * 40 + 36}px`;
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 460;
  const elegidos = !todos(estado.gobiernos, GOB);
  const op = (x) => (elegidos && !estado.gobiernos.has(x.i) ? 0.25 : 1);
  const etiquetas = gobs.map((x) => (angosto ? x.corto : x.nombre));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = gobs[ps[0].dataIndex];
        return `<strong>${Obs.escapar(x.nombre)}</strong>${x.enCurso ? " (en curso)" : ""}<br>${plural(x.total, "proceso", "procesos")}` +
          ESTADOS.filter((e) => x[e.clave]).map((e) => `<br>${e.nombre}: <strong>${num(x[e.clave])}</strong> (${pct(x[e.clave] / x.total)})`).join(""); } },
    grid: { left: angosto ? 96 : 168, right: 44, top: 4, bottom: 28 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "category", inverse: true, data: etiquetas, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: { ...txt({ color: C.texto }), formatter: (v, i) => (elegidos && estado.gobiernos.has(gobs[i].i) ? `{b|${v}}` : v), rich: { b: txt({ color: C.navy, fontWeight: 800 }) } } },
    series: [
      ...ESTADOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 20, cursor: "pointer",
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
  const tasa = (x) => x.realizada / x.total;
  // con gobiernos elegidos, la lectura habla de ellos y los compara con todos
  const sel = todos(estado.gobiernos, GOB) ? gobs : gobs.filter((x) => estado.gobiernos.has(x.i));
  if (sel.length < gobs.length || gobs.length === 1) {
    if (!sel.length) return lectura("l-gobiernos", "El gobierno elegido no tuvo procesos de interpelación con estos filtros.");
    const proc = sumar(sel, "total"), real = sumar(sel, "realizada");
    const quien = sel.length === 1 ? `Durante el gobierno de ${destacar(sel[0].nombre)}` : `En los gobiernos de ${nombres(sel.map((x) => x.nombre))}`;
    const frente = gobs.length > sel.length ? `, frente a ${fuerte(pct(sumar(gobs, "realizada") / sumar(gobs, "total")))} en todos los gobiernos` : "";
    return lectura("l-gobiernos", `${quien} hubo ${fuerte(plural(proc, "proceso", "procesos"))} de interpelación. ${terminaron(real, proc)} en una interpelación${frente}.`);
  }
  const alto = extremos(gobs, "total");
  let t = `${nombres(alto.map((x) => x.nombre))} ${alto.length > 1 ? "tuvieron" : "tuvo"} más procesos de interpelación: ` +
    `${fuerte(plural(alto[0].total, "proceso", "procesos"))}${alto.length > 1 ? " cada uno" : ""}.`;
  const comparables = gobs.filter((x) => x.total > MINIMO).map((x) => ({ ...x, tasa: tasa(x) }));
  if (comparables.length >= 2) {
    const mas = extremos(comparables, "tasa"), menos = extremos(comparables, "tasa", false);
    if (mas[0].tasa !== menos[0].tasa) t += ` Entre los gobiernos con más de ${fuerte(MINIMO)} procesos, la proporción que terminó en una interpelación fue mayor con ` +
      `${nombres(mas.map((x) => x.nombre))} (${fuerte(pct(mas[0].tasa))}); con ${nombres(menos.map((x) => x.nombre))}, ` +
      `${menos[0].tasa === 0 ? `${fuerte("ninguno")} terminó así` : `fue de ${fuerte(pct(menos[0].tasa))}`}.`;
  }
  lectura("l-gobiernos", t);
}

/* ---------- Días por proceso en cada gobierno (tabla con total ponderado) ---------- */
function tablaGobiernos(filas) {
  const gobs = gobiernosEnAlcance(estado).map((g) => {
    const f = filas.filter((x) => x.g === g.i);
    const r = ritmo([g], f.length);
    // los Congresos del gobierno que entran en la selección
    const enSel = g.periodos.filter((p) => estado.periodos.has(PER.indexOf(p)) && (g.diasPor.get(p) ?? 0) > 0);
    return { ...g, procesos: f.length, porPedido: r.porPedido, enSel };
  });
  const total = ritmo(gobs, gobs.reduce((t, g) => t + g.procesos, 0));
  const columnas = [
    { clave: "gobierno", titulo: "Gobierno", valor: (g) => g.i,
      html: (g) => `<span class="gobierno">${Obs.escapar(g.nombre)}<small>${g.enSel.join(" y ")}${g.enCurso ? ", en curso" : ""}</small></span>` },
    { clave: "procesos", titulo: "Procesos", num: true, valor: (g) => g.procesos, html: (g) => num(g.procesos) },
    { clave: "dias", titulo: "Días", num: true, valor: (g) => g.diasAlcance, html: (g) => num(g.diasAlcance) },
    { clave: "ritmo", titulo: "Días por proceso", num: true, valor: (g) => g.porPedido,
      html: (g) => (g.porPedido == null ? '<span class="sin-dato">Sin procesos</span>' : `<strong>${num(g.porPedido, 1)}</strong>`) },
  ];
  const pie = gobs.length > 1 ? `<tr><td>Total<small>Promedio ponderado</small></td><td class="num">${num(total.procesos)}</td>` +
    `<td class="num">${num(total.dias)}</td><td class="num">${total.porPedido == null ? "—" : num(total.porPedido, 1)}</td></tr>` : "";
  tablaOrdenable("t-gobiernos", columnas, gobs, {
    inicial: { clave: "gobierno", dir: 1 }, desempate: (a, b) => a.i - b.i, claveFila: (g) => g.i,
    elegidas: todos(estado.gobiernos, GOB) ? null : estado.gobiernos, alClic: (k) => alternar("gobiernos", +k, GOB),
    descripcion: "Procesos de interpelación, días de gobierno y días por proceso en cada gobierno", pie,
  });
  // lectura: el ritmo más intenso y el más pausado
  const con = gobs.filter((g) => g.porPedido != null);
  const dias = (g) => fuerte(`${num(g.porPedido, 1)} días`);
  const quien = (g) => `${destacar(g.nombre)}${g.enCurso ? " (gobierno en curso)" : ""}`;
  if (!con.length) lectura("l-ritmo", "");
  else if (con.length === 1) lectura("l-ritmo", `Con ${quien(con[0])} hubo un proceso de interpelación cada ${dias(con[0])}.`);
  else {
    const rapido = extremos(con, "porPedido", false)[0], lento = extremos(con, "porPedido")[0];
    lectura("l-ritmo", `Con ${quien(rapido)} hubo un proceso de interpelación cada ${dias(rapido)}, el ritmo más intenso; con ${quien(lento)}, uno cada ${dias(lento)}. ` +
      `En conjunto, uno cada ${fuerte(`${num(total.porPedido, 1)} días`)}.`);
  }
}

/* ---------- Gobierno × ministerio (mapa de calor) ----------
   Ignora los filtros de gobierno y sector (los resalta); aplica el de Congreso. */
function matriz(filas) {
  const id = "g-matriz";
  lecturaMatriz(filas);
  const gobs = GOB.filter((g) => g.periodos.some((p) => estado.periodos.has(PER.indexOf(p))));
  const cuenta = new Map(), porSector = new Map();
  filas.forEach((f) => { cuenta.set(`${f.g}|${f.s}`, (cuenta.get(`${f.g}|${f.s}`) ?? 0) + 1); porSector.set(f.s, (porSector.get(f.s) ?? 0) + 1); });
  const sectores = [...porSector].sort((a, b) => b[1] - a[1] || SEC[a[0]].localeCompare(SEC[b[0]], "es")).map(([s]) => s);
  const color = (v) => C.matriz[TRAMOS.findIndex(([a, b]) => v >= a && v <= b)];
  document.getElementById("ley-matriz").innerHTML = TRAMOS.map(([, , e], i) => `<span><i style="background:${C.matriz[i]}"></i>${e}</span>`).join("") + "<span>procesos</span>";
  if (!sectores.length || !gobs.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const angosto = el.parentElement.clientWidth < 700, izq = angosto ? 150 : 210;
  el.style.height = `${sectores.length * 32 + 64}px`;
  const g = Obs.grafico(id);
  g.resize();
  const algo = !todos(estado.gobiernos, GOB) || !todos(estado.sectores, SEC);
  const elegida = (gi, si) => estado.gobiernos.has(gi) && estado.sectores.has(si);
  const datos = [];
  gobs.forEach((gb, x) => sectores.forEach((si, y) => {
    const v = cuenta.get(`${gb.i}|${si}`) ?? 0;
    const opacidad = algo && !elegida(gb.i, si) ? 0.22 : 1;
    datos.push({ value: [x, y, v], gi: gb.i, si,
      itemStyle: { color: v ? color(v) : "#f4f6f9", borderColor: "#fff", borderWidth: 2, opacity: opacidad },
      label: { show: v > 0, color: v >= 3 ? "#fff" : C.navy, opacity: opacidad } });
  }));
  const ejeY = sectores.map((si) => `${sectorCorto(SEC[si])} (${porSector.get(si)})`);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: false,
    tooltip: { ...Obs.tooltipBase(), formatter: (q) => {
      const d = datos[q.dataIndex];
      const f = filas.filter((x) => x.g === d.gi && x.s === d.si);
      return `<strong>${Obs.escapar(SEC[d.si])}</strong><br>Gobierno de ${Obs.escapar(GOB[d.gi].nombre)}<br>` +
        (f.length ? `<strong>${plural(f.length, "proceso", "procesos")}</strong>` + ESTADOS.filter((e) => f.some((x) => x.estado === e.clave))
          .map((e) => `<br>${e.nombre}: ${num(f.filter((x) => x.estado === e.clave).length)}`).join("") : "Sin procesos de interpelación");
    } },
    grid: { left: izq, right: 8, top: 40, bottom: 6 },
    xAxis: { type: "category", position: "top", data: gobs.map((x) => x.corto), triggerEvent: true, axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
      axisLabel: txt({ color: C.texto, fontWeight: 700, interval: 0 }) },
    yAxis: { type: "category", inverse: true, data: ejeY, triggerEvent: true, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: txt({ color: C.texto, width: izq - 10, overflow: "truncate" }) },
    series: [{ type: "heatmap", data: datos, cursor: "pointer", label: { show: true, formatter: (q) => num(q.value[2]), fontFamily: C.fuente, fontSize: 14, fontWeight: 700 },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 2 } } }],
  }, true);
  el.setAttribute("aria-label", "Procesos de interpelación por ministerio: " + sectores.map((si) => `${SEC[si]}, ${porSector.get(si)}`).join("; ") + ".");
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" }); // el gráfico se redibuja: sin esto la burbuja queda huérfana
    if (q.componentType === "xAxis") return alternar("gobiernos", gobs[gobs.findIndex((x) => x.corto === q.value)]?.i ?? -1, GOB);
    if (q.componentType === "yAxis") return alternar("sectores", sectores[ejeY.indexOf(q.value)] ?? -1, SEC);
    const d = datos[q.dataIndex];
    // una celda elige ese par; otro clic en la misma celda lo quita
    const ya = estado.gobiernos.size === 1 && estado.gobiernos.has(d.gi) && estado.sectores.size === 1 && estado.sectores.has(d.si);
    actualizar(ya ? { gobiernos: todosLos(GOB), sectores: todosLos(SEC) } : { gobiernos: new Set([d.gi]), sectores: new Set([d.si]) });
  });
}

// Lectura de la matriz: el ministerio con más procesos dentro de lo elegido y el gobierno en que más se lo cuestionó
function lecturaMatriz(filas) {
  const base = filas.filter((f) => estado.gobiernos.has(f.g) && estado.sectores.has(f.s));
  if (!base.length) return lectura("l-matriz", "");
  const contar = (campo) => { const m = new Map(); base.forEach((f) => m.set(f[campo], (m.get(f[campo]) ?? 0) + 1)); return [...m].map(([k, n]) => ({ k, n })); };
  const sectores = extremos(contar("s"), "n");
  let t = sectores.length === 1
    ? `${destacar(SEC[sectores[0].k])} fue el ministerio con más procesos de interpelación: ${fuerte(plural(sectores[0].n, "proceso", "procesos"))}.`
    : `${nombres(sectores.map((x) => SEC[x.k]))} fueron los ministerios con más procesos de interpelación: ${fuerte(plural(sectores[0].n, "proceso", "procesos"))} cada uno.`;
  if (sectores.length === 1 && new Set(base.map((f) => f.g)).size > 1) {
    const enGob = new Map();
    base.filter((f) => f.s === sectores[0].k).forEach((f) => enGob.set(f.g, (enGob.get(f.g) ?? 0) + 1));
    const top = extremos([...enGob].map(([k, n]) => ({ k, n })), "n");
    t += ` Donde más se cuestionó a ese ministerio fue ${top.length === 1 ? "en el gobierno" : "en los gobiernos"} de ${nombres(top.map((x) => GOB[x.k].nombre))} ` +
      `(${fuerte(plural(top[0].n, "proceso", "procesos"))}${top.length > 1 ? " cada uno" : ""}).`;
  }
  lectura("l-matriz", t);
}

/* ---------- Resultado por sector (barras al 100 %) ----------
   El total de procesos de cada ministerio va a la derecha: el porcentaje solo no dice el volumen. */
function porSector(filas) {
  const id = "g-sectores";
  const secs = SEC.map((nombre, i) => { const f = filas.filter((x) => x.s === i); return { i, nombre, total: f.length, ...cuentaEstados(f) }; })
    .filter((x) => x.total).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
  lecturaSectores(secs);
  if (!secs.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  el.style.height = `${secs.length * 34 + 40}px`;
  const g = Obs.grafico(id);
  g.resize();
  const angosto = el.clientWidth < 560;
  const elegidos = !todos(estado.sectores, SEC);
  const op = (x) => (elegidos && !estado.sectores.has(x.i) ? 0.25 : 1);
  const etiquetas = secs.map((x) => (angosto ? sectorCorto(x.nombre) : x.nombre));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const x = secs[ps[0].dataIndex];
        return `<strong>${Obs.escapar(x.nombre)}</strong><br>${plural(x.total, "proceso", "procesos")}` +
          ESTADOS.filter((e) => x[e.clave]).map((e) => `<br>${e.nombre}: <strong>${pct(x[e.clave] / x.total)}</strong> (${num(x[e.clave])})`).join(""); } },
    grid: { left: angosto ? 140 : 290, right: 48, top: 4, bottom: 28 },
    xAxis: { type: "value", max: 100, interval: 25, splitLine: { lineStyle: { color: C.linea } }, axisLabel: { ...txt(), formatter: (v) => `${v} %` } },
    yAxis: [
      { type: "category", inverse: true, data: etiquetas, triggerEvent: true, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
        axisLabel: { ...txt({ color: C.texto }), width: (angosto ? 140 : 290) - 12, overflow: "truncate",
          formatter: (v, i) => (elegidos && estado.sectores.has(secs[i].i) ? `{b|${v}}` : v), rich: { b: txt({ color: C.navy, fontWeight: 800 }) } } },
      // a la derecha, el total de procesos del ministerio
      { type: "category", inverse: true, position: "right", data: secs.map((x) => num(x.total)), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: txt({ color: C.texto, fontWeight: 700 }) },
    ],
    series: ESTADOS.map((e) => ({ name: e.nombre, type: "bar", stack: "t", barWidth: 18, cursor: "pointer",
      itemStyle: { color: C.estado[e.clave], borderColor: "#fff", borderWidth: 2 },
      data: secs.map((x) => ({ value: x[e.clave] ? (x[e.clave] / x.total) * 100 : null, itemStyle: { opacity: op(x) } })),
      // el porcentaje dentro del tramo solo si cabe
      label: { show: !angosto, formatter: (q) => (q.value >= 15 ? `${num(q.value)} %` : ""), fontFamily: C.fuente, fontSize: 14, fontWeight: 700,
        color: e.clave === "realizada" || e.clave === "rechazada" ? "#fff" : C.navy } })),
  }, true);
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" });
    const i = q.componentType === "yAxis" ? etiquetas.indexOf(q.value) : q.dataIndex;
    if (secs[i]) alternar("sectores", secs[i].i, SEC);
  });
}

function lecturaSectores(secs) {
  if (!secs.length) return lectura("l-sectores", "");
  const tasa = (x) => x.realizada / x.total;
  // con ministerios elegidos, la lectura habla de ellos y los compara con todos
  const sel = todos(estado.sectores, SEC) ? secs : secs.filter((x) => estado.sectores.has(x.i));
  if (sel.length < secs.length || secs.length === 1) {
    if (!sel.length) return lectura("l-sectores", "El ministerio elegido no tuvo procesos de interpelación con estos filtros.");
    const proc = sumar(sel, "total");
    const frente = secs.length > sel.length ? `, frente a ${fuerte(pct(sumar(secs, "realizada") / sumar(secs, "total")))} en todos los ministerios` : "";
    return lectura("l-sectores", `${sel.length === 1 ? destacar(sel[0].nombre) : nombres(sel.map((x) => x.nombre))} ${sel.length === 1 ? "tuvo" : "tuvieron"} ` +
      `${fuerte(plural(proc, "proceso", "procesos"))} de interpelación. ${terminaron(sumar(sel, "realizada"), proc)} en una interpelación${frente}.`);
  }
  const comparables = secs.filter((x) => x.total > MINIMO).map((x) => ({ ...x, tasa: tasa(x) }));
  if (comparables.length < 2) {
    // pocos procesos por ministerio: se nombra el que tuvo más
    const x = extremos(secs, "total")[0];
    return lectura("l-sectores", `${destacar(x.nombre)} tuvo más procesos de interpelación (${fuerte(num(x.total))}). ${terminaron(x.realizada, x.total)} en una interpelación.`);
  }
  const mas = extremos(comparables, "tasa"), menos = extremos(comparables, "tasa", false);
  if (mas[0].tasa === menos[0].tasa) return lectura("l-sectores", "");
  lectura("l-sectores", `${nombres(mas.map((x) => x.nombre))} ${mas.length > 1 ? "son los ministerios" : "es el ministerio"} donde una mayor proporción de procesos ` +
    `terminó en una interpelación: ${fuerte(pct(mas[0].tasa))}. En ${nombres(menos.map((x) => x.nombre))}, ` +
    `${menos[0].tasa === 0 ? fuerte("ninguno") : `solo ${fuerte(pct(menos[0].tasa))}`}.);
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
  document.getElementById("h-ministros").textContent = `${plural(personas, "ministro tuvo", "ministros tuvieron")} procesos de interpelación`;
  lecturaMinistros(filas);
  const n = (clave) => ({ clave, num: true, valor: (x) => x[clave], html: (x) => (x[clave] ? num(x[clave]) : '<span class="sin-dato">0</span>') });
  const columnas = [
    { clave: "ministro", titulo: "Ministro", valor: (x) => x.ministro, html: (x) => `<span class="ministro">${Obs.escapar(x.ministro)}<small>${Obs.escapar(SEC[x.s])}</small></span>` },
    { clave: "gobierno", titulo: "Gobierno", valor: (x) => x.g, html: (x) => Obs.escapar(GOB[x.g].nombre) },
    { ...n("procesos"), titulo: "Procesos" },
    ...ESTADOS.map((e) => ({ ...n(e.clave), titulo: e.corto })),
  ];
  tablaOrdenable("t-ministros", columnas, lista, {
    inicial: { clave: "procesos", dir: -1 }, desempate: (a, b) => b.realizada - a.realizada || a.ministro.localeCompare(b.ministro, "es"),
    descripcion: "Ministros con procesos de interpelación, por gobierno y ministerio, según el resultado",
  });
}
// El ministro (persona) con más procesos, sumando todos sus gobiernos y ministerios
function lecturaMinistros(filas) {
  const m = new Map();
  filas.forEach((f) => {
    const x = m.get(f.ministro) ?? { nombre: f.ministro, procesos: 0, realizada: 0, sectores: new Set(), gobs: new Set() };
    x.procesos++; if (f.estado === "realizada") x.realizada++; x.sectores.add(f.sector); x.gobs.add(GOB[f.g].nombre);
    m.set(f.ministro, x);
  });
  const alto = extremos([...m.values()], "procesos");
  if (!alto.length) return lectura("l-ministros", "");
  const n = plural(alto[0].procesos, "proceso", "procesos");
  if (alto.length === 1) {
    const x = alto[0];
    const final = x.realizada === x.procesos ? (x.procesos === 1 ? "terminó" : "todos terminaron") : x.realizada === 0 ? (x.procesos === 1 ? "no terminó" : "ninguno terminó")
      : `${fuerte(num(x.realizada))} ${x.realizada === 1 ? "terminó" : "terminaron"}`;
    return lectura("l-ministros", `${destacar(x.nombre)} (${nombres([...x.sectores])}, gobierno de ${nombres([...x.gobs])}) es el ministro con más procesos de interpelación: ` +
      `${fuerte(n)}; ${final} en una interpelación.`);
  }
  lectura("l-ministros", alto.length <= 3
    ? `${nombres(alto.map((x) => x.nombre))} son los ministros con más procesos de interpelación: ${fuerte(n)} cada uno.`
    : `${fuerte(num(alto.length))} ministros tuvieron ${fuerte(n)} de interpelación, el máximo con estos filtros.`);
}

/* ---------- Cada proceso de interpelación (la tabla del informe de Looker) ----------
   Recibe las filas ya filtradas por el buscador; los botones de resultado solo la afectan a ella. */
const fmtFecha = (d) => (d ? d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
function tablaPedidos(filas) {
  const cuenta = cuentaEstados(filas);
  const opciones = [{ clave: "", corto: "Todos", n: filas.length }, ...ESTADOS.map((e) => ({ clave: e.clave, corto: e.corto, n: cuenta[e.clave] }))];
  document.getElementById("f-resultado").innerHTML = opciones.map((o) =>
    `<button type="button" data-resultado="${o.clave}" aria-pressed="${estado.resultado === o.clave}">${o.corto}<small>${num(o.n)}</small></button>`).join("");
  const lista = estado.resultado ? filas.filter((f) => f.estado === estado.resultado) : filas;
  const nombre = ESTADOS.find((e) => e.clave === estado.resultado)?.nombre;
  document.getElementById("h-pedidos").textContent = lista.length
    ? `${plural(lista.length, "proceso", "procesos")} de interpelación, en ${plural(mociones(lista), "moción", "mociones")}${nombre ? `: ${Obs.minus(nombre)}` : ""}`
    : "Cada proceso de interpelación";
  const esc = Obs.escapar;
  const columnas = [
    { clave: "fecha", titulo: "Presentada", valor: (f) => (f.fecha ? +f.fecha : null), html: (f) => `<span class="fecha">${fmtFecha(f.fecha)}</span>` },
    { clave: "mocion", titulo: "Moción", valor: (f) => parseFloat(f.num),
      html: (f) => `<span class="doc" title="${esc(`Motivo: ${f.sumilla}`)}">${f.link ? `<a href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.mocion)}</a>` : esc(f.mocion)}</span>` },
    { clave: "gobierno", titulo: "Gobierno", valor: (f) => f.g, html: (f) => esc(GOB[f.g].nombre) },
    { clave: "legis", titulo: "Legislatura", valor: (f) => f.legis, html: (f) => `<span class="fecha">${esc(f.legis)}</span>` },
    { clave: "sector", titulo: "Ministerio", valor: (f) => f.sector, html: (f) => esc(f.sector) },
    { clave: "ministro", titulo: "Ministro", valor: (f) => f.ministro, html: (f) => `<span class="ministro">${esc(f.ministro)}</span>` },
    { clave: "resultado", titulo: "Resultado", valor: (f) => ESTADOS.findIndex((e) => e.clave === f.estado),
      html: (f) => `<span class="resultado"><i style="background:${C.estado[f.estado]}"></i>${ESTADOS.find((e) => e.clave === f.estado).nombre}</span>` },
  ];
  tablaOrdenable("t-pedidos", columnas, lista, {
    inicial: { clave: "fecha", dir: -1 }, desempate: (a, b) => parseFloat(b.num) - parseFloat(a.num) || a.ministro.localeCompare(b.ministro, "es"),
    descripcion: "Cada proceso de interpelación: fecha de presentación, moción, gobierno, legislatura, ministerio, ministro, y resultado; el motivo sale al pasar el cursor por el número de moción",
    vacia: estado.buscar.trim() ? `Nada coincide con «${esc(estado.buscar.trim())}» con estos filtros. Prueba con un apellido o un número de moción.` : null,
  });
}

/* =========== Pestaña: Interpelaciones realizadas =========== */
// Aquí solo cuentan los procesos que terminaron en una interpelación ante el Pleno
const realizadas = (filas) => filas.filter((f) => f.estado === "realizada");
// «Ministro/a renunció luego de la interpelación» en la observación
const renuncioDespues = (f) => /renunci/i.test(f.observacion) && /luego|despu/i.test(f.observacion);

function pintarRealizadas(s) {
  const filas = realizadas(s.todo);
  const el = document.getElementById("r-realizadas");
  const personas = new Set(filas.map((f) => f.ministro)).size;
  el.innerHTML = filas.length
    ? `${alcance()}, ${fuerte(plural(filas.length, "proceso", "procesos"))}${todos(estado.sectores, SEC) ? "" : ` ${aQuien()}`} ` +
      `${filas.length === 1 ? "terminó" : "terminaron"} en una interpelación ante el Pleno: ` +
      `${fuerte(plural(personas, "ministro", "ministros"))} ${personas === 1 ? "respondió" : "respondieron"} un pliego de preguntas. Fue ${fuerte(pct(filas.length / (s.todo.length || 1)))} de los procesos de interpelación.`
    : "No hubo interpelaciones realizadas con estos filtros. Quita alguno para ver datos.";
  cifrasRealizadas(filas);
  pintarBusquedaR(filas);
  votacion(filas);
  porAnio(filas);
  porMinisterioReal(realizadas(s.sinSector));
}

function cifrasRealizadas(filas) {
  const conVotos = filas.filter((f) => f.favor != null);
  const fav = mediana(conVotos.map((f) => f.favor)), asis = mediana(filas.map((f) => f.asistentes));
  const preg = filas.filter((f) => f.preguntas != null);
  const veces = new Map(); filas.forEach((f) => veces.set(f.ministro, (veces.get(f.ministro) ?? 0) + 1));
  const repetidos = [...veces.values()].filter((v) => v > 1).length;
  Obs.kpi("k-real", { etiqueta: "Interpelaciones realizadas", valor: num(filas.length), pie: "Ministros que acudieron al Pleno a responder" });
  Obs.kpi("k-votos", { etiqueta: "Votos a favor de la admisión", valor: fav == null ? "—" : num(fav),
    pie: fav == null ? "Sin votaciones registradas" : `Mediana${asis != null ? `, con ${num(asis)} asistentes` : ""}; ${plural(conVotos.length, "votación", "votaciones")} con dato` });
  Obs.kpi("k-preguntas", { etiqueta: "Preguntas por pliego", valor: preg.length ? num(mediana(preg.map((f) => f.preguntas))) : "—",
    pie: preg.length ? `Mediana; el pliego más largo tuvo ${num(Math.max(...preg.map((f) => f.preguntas)))}` : "Sin pliegos con dato" });
  Obs.kpi("k-ministros", { etiqueta: "Ministros interpelados", valor: num(veces.size),
    pie: repetidos ? `${plural(repetidos, "lo fue", "lo fueron")} más de una vez` : "Ninguno, más de una vez" });
}

/* ---------- Cada interpelación realizada (tabla con buscador) ---------- */
function pintarBusquedaR(filas) {
  const b = sinTildes(estado.buscarR.trim());
  tablaRealizadas(b ? filas.filter((f) => f.busqueda.includes(b)) : filas);
}
function tablaRealizadas(lista) {
  const esc = Obs.escapar;
  document.getElementById("h-realizadas").textContent = lista.length
    ? `${plural(lista.length, "interpelación realizada", "interpelaciones realizadas")}, a ${plural(new Set(lista.map((f) => f.ministro)).size, "ministro", "ministros")}`
    : "Cada interpelación realizada";
  // lectura: los ministros que renunciaron después de responder
  const ren = lista.filter(renuncioDespues);
  if (!ren.length) lectura("l-realizadas", "");
  else if (ren.length === 1) {
    const f = ren[0];
    lectura("l-realizadas", `${destacar(f.ministro)} (${destacar(f.sector)}, gobierno de ${destacar(GOB[f.g].nombre)}) renunció después de responder la interpelación.`);
  } else {
    const porGob = new Map(); ren.forEach((f) => porGob.set(f.g, (porGob.get(f.g) ?? 0) + 1));
    const top = extremos([...porGob].map(([k, n]) => ({ k, n })), "n");
    const personas = new Set(ren.map((f) => f.ministro)).size;
    const donde = porGob.size === 1 ? ` Todas, durante el gobierno de ${destacar(GOB[top[0].k].nombre)}.`
      : top.length === 1 ? ` ${fuerte(num(top[0].n))} de ellas, durante el gobierno de ${destacar(GOB[top[0].k].nombre)}.` : "";
    lectura("l-realizadas", `En ${fuerte(plural(ren.length, "interpelación", "interpelaciones"))} el ministro renunció después de responder ` +
      `(${fuerte(plural(personas, "persona", "personas"))}).${donde}`);
  }
  // votación de admisión en columnas propias: a favor resalta; asistentes en gris (no es un voto)
  const cifra = (clave, titulo, clase = "") => ({ clave, titulo, num: true, valor: (f) => f[clave],
    html: (f) => (f[clave] == null ? '<span class="sin-dato">—</span>' : `<span class="${clase}">${num(f[clave])}</span>`) });
  const columnas = [
    { clave: "mocion", titulo: "Moción", valor: (f) => parseFloat(f.num),
      html: (f) => `<span class="doc">${f.link ? `<a href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.mocion)}</a>` : esc(f.mocion)}</span><small>Presentada el ${fmtFecha(f.fecha)}</small>` },
    { clave: "fecha", titulo: "Interpelación", valor: (f) => (f.concurrencia ? +f.concurrencia : null), html: (f) => `<span class="fecha">${fmtFecha(f.concurrencia)}</span>` },
    { clave: "gobierno", titulo: "Gobierno", valor: (f) => f.g, html: (f) => esc(GOB[f.g].nombre) },
    { clave: "sector", titulo: "Ministerio", valor: (f) => f.sector, html: (f) => esc(f.sector) },
    { clave: "ministro", titulo: "Ministro", valor: (f) => f.ministro, html: (f) => `<span class="ministro">${esc(f.ministro)}</span>` },
    cifra("favor", "A favor", "voto-favor"),
    cifra("contra", "En contra"),
    cifra("abst", "Abstenciones"),
    cifra("preguntas", "Preguntas"),
  ];
  tablaOrdenable("t-realizadas", columnas, lista, {
    inicial: { clave: "fecha", dir: -1 }, desempate: (a, b) => parseFloat(b.num) - parseFloat(a.num) || a.ministro.localeCompare(b.ministro, "es"),
    descripcion: "Cada interpelación realizada: moción, fecha de la interpelación, gobierno, ministerio, ministro, votos a favor, en contra y abstenciones en la admisión, y preguntas del pliego",
    vacia: estado.buscarR.trim() ? `Nada coincide con «${esc(estado.buscarR.trim())}» con estos filtros. Prueba con un apellido o un número de moción.` : null,
  });
}

/* ---------- Votación de admisión (puntos en el tiempo) ----------
   Un punto por votación con los votos a favor; la burbuja suma en contra, abstenciones
   y asistentes. Una moción contra varios ministros se vota una vez: se dibuja una sola vez. */
function votacion(filas) {
  const id = "g-votos";
  const unicas = new Map();
  filas.filter((f) => f.favor != null && (f.admision || f.concurrencia)).forEach((f) => {
    const x = unicas.get(f.clave);
    if (x) x.ministros.push(f.ministro); else unicas.set(f.clave, { ...f, cuando: f.admision ?? f.concurrencia, ministros: [f.ministro] });
  });
  const votos = [...unicas.values()].sort((a, b) => a.cuando - b.cuando);
  const sinVoto = new Set(filas.filter((f) => f.favor == null).map((f) => f.clave)).size;
  document.getElementById("p-votos").textContent = sinVoto
    ? `${plural(sinVoto, "moción admitida no tiene", "mociones admitidas no tienen")} la votación registrada (o se admitieron sin votación en el Pleno) y no aparecen aquí.` : "";
  lecturaVotos(votos);
  if (!votos.length) return Obs.vacio(id, "Sin votaciones registradas con estos filtros");
  const g = Obs.grafico(id);
  const pasoAnios = document.getElementById(id).clientWidth < 600 ? 5 : 2;
  const tip = (x) => `<strong>${Obs.escapar(enumerar(x.ministros))}</strong><br>${Obs.escapar(x.sector)}, gobierno de ${Obs.escapar(x.gobierno)}<br>` +
    `Votación del ${fmtFecha(x.cuando)} (moción ${Obs.escapar(x.mocion)})<br>A favor: <strong>${num(x.favor)}</strong>` +
    (x.contra != null ? `<br>En contra: ${num(x.contra)}` : "") + (x.abst != null ? `<br>Abstenciones: ${num(x.abst)}` : "") +
    (x.asistentes != null ? `<br>Asistentes: ${num(x.asistentes)}` : "");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "item", formatter: (q) => tip(q.data.x) },
    grid: { left: 72, right: 16, top: 16, bottom: 64 },
    // nombres de los ejes: sin ellos no se entiende qué mide cada uno
    xAxis: { type: "time", name: "Fecha de la votación", nameLocation: "middle", nameGap: 36, nameTextStyle: txt({ color: C.texto, fontWeight: 700 }),
      // años cada 2 (cada 5 en pantallas angostas), desde el 1 de enero del primer año
      min: Date.UTC(votos[0].cuando.getUTCFullYear(), 0, 1), max: Date.UTC(votos.at(-1).cuando.getUTCFullYear() + 1, 0, 1),
      minInterval: pasoAnios * 365 * 864e5, maxInterval: pasoAnios * 366 * 864e5,
      axisLine: { lineStyle: { color: C.linea } }, splitLine: { show: false }, axisLabel: { ...txt(), formatter: "{yyyy}", hideOverlap: true } },
    yAxis: { type: "value", min: 0, name: "Votos a favor", nameLocation: "middle", nameGap: 44, nameRotate: 90, nameTextStyle: txt({ color: C.texto, fontWeight: 700 }),
      splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [{ name: "Votos a favor", type: "scatter", symbolSize: pasoAnios === 5 ? 11 : 16, itemStyle: { color: C.estado.realizada, borderColor: "#fff", borderWidth: 1.5, opacity: 0.85 },
      emphasis: { scale: 1.4, itemStyle: { opacity: 1, borderColor: C.navy, borderWidth: 2 } },
      data: votos.map((x) => ({ value: [+x.cuando, x.favor], x })) }],
  }, true);
}
function lecturaVotos(votos) {
  if (!votos.length) return lectura("l-votos", "");
  const quien = (x) => `${nombres(x.ministros)} (${destacar(x.sector)}, ${destacar(x.cuando.getUTCFullYear())})`;
  const med = mediana(votos.map((x) => x.favor));
  if (votos.length === 1) return lectura("l-votos", `La moción se admitió con ${fuerte(plural(votos[0].favor, "voto", "votos"))} a favor.`);
  const alto = votos.reduce((a, b) => (b.favor > a.favor ? b : a)), bajo = votos.reduce((a, b) => (b.favor < a.favor ? b : a));
  let t = `La mitad de las mociones se admitió con ${fuerte(`${num(med)} votos a favor`)} o más. La admisión más amplia fue la de ${quien(alto)}, con ${fuerte(num(alto.favor))}; ` +
    `la más ajustada, la de ${quien(bajo)}, con ${fuerte(num(bajo.favor))}.`;
  // el Congreso con la mediana más alta
  const porP = PER.map((p) => ({ p, v: votos.filter((x) => x.periodo === p).map((x) => x.favor) })).filter((x) => x.v.length >= 3).map((x) => ({ ...x, m: mediana(x.v) }));
  if (porP.length >= 2) { const top = extremos(porP, "m"); t += ` ${top.length === 1 ? "El Congreso" : "Los Congresos"} ${nombres(top.map((x) => x.p))} ${top.length === 1 ? "admitió" : "admitieron"} con más votos: ${fuerte(num(top[0].m))} en la mediana.`; }
  lectura("l-votos", t);
}

/* ---------- Realizadas por año (columnas) ---------- */
function porAnio(filas) {
  const todas = realizadas(FILAS).filter((f) => f.concurrencia);
  const a0 = Math.min(...todas.map((f) => f.concurrencia.getUTCFullYear())), a1 = Math.max(...todas.map((f) => f.concurrencia.getUTCFullYear()));
  const anios = Array.from({ length: a1 - a0 + 1 }, (_, i) => a0 + i);
  const valores = anios.map((a) => filas.filter((f) => f.concurrencia?.getUTCFullYear() === a).length);
  const con = anios.map((a, i) => ({ a, n: valores[i] })).filter((x) => x.n);
  if (!con.length) lectura("l-anios", "");
  else {
    const top = extremos(con, "n");
    lectura("l-anios", `${top.length === 1 ? `${destacar(top[0].a)} fue el año` : `${nombres(top.map((x) => x.a))} fueron los años`} con más interpelaciones: ` +
      `${fuerte(plural(top[0].n, "ministro interpelado", "ministros interpelados"))}${top.length > 1 ? " en cada uno" : ""}.` +
      (con.length > 1 ? ` Hubo interpelaciones en ${fuerte(plural(con.length, "año", "años"))} de ${fuerte(num(anios.length))}.` : ""));
  }
  Obs.columnas("g-anios", anios.map(String), valores, { nombre: "Interpelaciones realizadas" });
}

/* ---------- Realizadas por ministerio (barras) ----------
   Ignora el filtro de sector y resalta lo elegido; un clic elige el ministerio. */
function porMinisterioReal(filas) {
  const cuenta = new Map();
  filas.forEach((f) => cuenta.set(f.s, (cuenta.get(f.s) ?? 0) + 1));
  const items = [...cuenta].map(([s, n]) => ({ clave: s, etiqueta: sectorCorto(SEC[s]), valor: n }));
  if (!items.length) lectura("l-min-real", "");
  else {
    const top = extremos(items, "valor"), total = filas.length;
    lectura("l-min-real", `${nombres(top.map((x) => SEC[x.clave]))} ${top.length === 1 ? "fue el ministerio" : "fueron los ministerios"} con más interpelaciones: ` +
      `${fuerte(plural(top[0].valor, "ministro interpelado", "ministros interpelados"))}${top.length > 1 ? " cada uno" : ""} (${fuerte(pct(top[0].valor / total))} del total).`);
  }
  Obs.barras("g-min-real", items, {
    nombre: "Interpelaciones realizadas", color: C.estado.realizada,
    seleccion: todos(estado.sectores, SEC) ? null : estado.sectores, alClic: (k) => alternar("sectores", +k, SEC),
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
  if (!todos(estado.periodos, PER)) ordenados(estado.periodos).forEach((i) => chip(`Congreso ${PER[i]}`, `p:${i}`));
  if (!todos(estado.gobiernos, GOB)) ordenados(estado.gobiernos).forEach((i) => chip(GOB[i].nombre, `g:${i}`));
  if (!todos(estado.sectores, SEC)) ordenados(estado.sectores).forEach((i) => chip(SEC[i], `s:${i}`));
  document.getElementById("aplicados").hidden = !chips.length;
  document.getElementById("aplicados-lista").innerHTML = chips.join("");
}

function sincronizarControles() {
  multiPer.sincronizar(estado.periodos);
  multiGob.sincronizar(estado.gobiernos);
  multiSec.sincronizar(estado.sectores);
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  const buscar = document.getElementById("f-buscar");
  if (buscar.value !== estado.buscar) buscar.value = estado.buscar;
  const buscarR = document.getElementById("f-buscar-r");
  if (buscarR.value !== estado.buscarR) buscarR.value = estado.buscarR;
}

function actualizar(parche) {
  const cambioPestana = parche.modulo && parche.modulo !== estado.modulo;
  Object.assign(estado, parche);
  render();
  // al cambiar de pestaña, los gráficos recién visibles toman su ancho real
  if (cambioPestana) requestAnimationFrame(() => { Obs.redimensionar(); render(); });
}

const CAMPOS = { p: ["periodos", () => PER], g: ["gobiernos", () => GOB], s: ["sectores", () => SEC] };

function montarControles() {
  const filtros = document.getElementById("filtros");
  multiPer = new Obs.Multiseleccion(filtros, {
    id: "f-periodos", etiqueta: "Congreso", todos: "Todos los Congresos",
    opciones: PER.map((p, i) => ({ valor: i, etiqueta: periodoEnCurso(i) ? `${p} (en curso)` : p })),
    alCambiar: (sel) => actualizar({ periodos: sel }),
  });
  multiGob = new Obs.Multiseleccion(filtros, {
    id: "f-gobiernos", etiqueta: "Gobierno", todos: "Todos los gobiernos",
    opciones: GOB.map((g) => ({ valor: g.i, etiqueta: g.nombre })),
    alCambiar: (sel) => actualizar({ gobiernos: sel }),
  });
  multiSec = new Obs.Multiseleccion(filtros, {
    id: "f-sectores", etiqueta: "Sector", todos: "Todos los sectores",
    opciones: SEC.map((s, i) => ({ valor: i, etiqueta: s })),
    alCambiar: (sel) => actualizar({ sectores: sel }),
  });

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
  const buscarR = document.getElementById("f-buscar-r");
  buscarR.oninput = () => {
    estado.buscarR = buscarR.value;
    clearTimeout(buscarR.__espera);
    buscarR.__espera = setTimeout(() => { pintarBusquedaR(realizadas(filtrar(estado).todo)); escribirURL(); }, 150);
  };
  const resultado = document.getElementById("f-resultado");
  resultado.onclick = (e) => {
    const b = e.target.closest("button[data-resultado]");
    if (!b) return;
    estado.resultado = b.dataset.resultado;
    pintarBusqueda(filtrar(estado).todo);
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
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  estado.periodos = indices("congresos", PER);
  estado.gobiernos = indices("gobiernos", GOB);
  estado.sectores = indices("sectores", SEC);
  estado.buscar = q.get("buscar") ?? "";
  estado.buscarR = q.get("buscar_r") ?? "";
  if (ESTADOS.some((e) => e.clave === q.get("resultado"))) estado.resultado = q.get("resultado");
}

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(),
    estado: Object.fromEntries(ESTADOS.map((e) => [e.clave, v(e.css)])),
    serie: Object.fromEntries(SERIES.map((x) => [x.clave, v(x.css)])),
    matriz: [1, 2, 3, 4, 5].map((i) => v(`--m-${i}`)) };
  preparar(datos.tablas);
  ACTUALIZADO = datos.actualizado || "";
  const [a, m, d] = ACTUALIZADO.split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";
  document.querySelectorAll(".ley-estados").forEach((el) => (el.innerHTML = ESTADOS.map((e) => `<span><i style="background:${C.estado[e.clave]}"></i>${e.nombre}</span>`).join("")));

  montarControles();
  leerURL();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
