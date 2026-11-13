/* =========================================================
   Tablero de Salud — Observatorio para la Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script, desde el Sheet «[Tableros] Salud»,
   que llena el notebook procesos/salud/actualizar_salud.ipynb. Pestañas (formato largo, con
   `codigo` = región o PE):
     morbilidad: anio, codigo, cap, capitulo, grupo, categoria, personas, diagnosticos
     atenciones: anio, codigo, grupo, categoria, atendidos, atenciones
     establecimientos: codigo, institucion, categoria, n, fecha
     presupuesto: anio, codigo (Lima entera = LIMA), dimension, categoria, pia, pim, devengado
     presupuesto_mensual: anio, mes, pim, devengado_acumulado
     densidad: anio, codigo, profesion, profesionales, poblacion, densidad
     personal: anio, mes, codigo, dimension, categoria, personal
     poblacion: anio, codigo, poblacion

   Tres pestañas: Atenciones, Recursos y Presupuesto. Filtros comunes arriba: ámbito y región,
   año y «Comparar con». Patrón: un objeto `estado`, funciones para leer los datos y una sola render().

   Parámetros de URL: ?modulo=atenciones|recursos|presupuesto &region=CUSCO &comparar=PUNO
   &anio=2024 &cap=10 (grupo de enfermedad) &embed=1
   ========================================================= */

const TABLERO = "salud";
const MODULOS = ["atenciones", "recursos", "presupuesto"];
const NACIONAL = "NACIONAL";
const LIMA = "LIMA";            // Lima entera (solo en el presupuesto)
const OMS = 44.5;               // umbral de la OMS: médicos, enfermeras y obstetras por 10 000 habitantes
const QUIEBRE_HIS = 2023;       // cambio de registro de personas con diagnóstico en el HIS
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho",
  CAJAMARCA: "Cajamarca", CALLAO: "Callao", CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco",
  ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad", LAMBAYEQUE: "Lambayeque",
  "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto",
  "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno",
  "SAN MARTIN": "San Martín", TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};
const CUADRO = {
  TUMBES: [1, 0], LORETO: [4, 0], PIURA: [0, 1], CAJAMARCA: [1, 1], AMAZONAS: [2, 1], "SAN MARTIN": [3, 1],
  LAMBAYEQUE: [0, 2], "LA LIBERTAD": [1, 2], HUANUCO: [2, 2], UCAYALI: [3, 2], ANCASH: [1, 3], PASCO: [2, 3],
  JUNIN: [3, 3], CALLAO: [0, 4], "LIMA METROPOLITANA": [1, 4], "LIMA PROVINCIAS": [2, 4], HUANCAVELICA: [3, 4],
  CUSCO: [4, 4], "MADRE DE DIOS": [5, 4], ICA: [2, 5], AYACUCHO: [3, 5], APURIMAC: [4, 5], PUNO: [5, 5],
  AREQUIPA: [3, 6], MOQUEGUA: [4, 6], TACNA: [4, 7],
};
const EDADES = ["0 a 11 años", "12 a 17 años", "18 a 29 años", "30 a 59 años", "60 años a más"];
const SEXOS = ["Mujeres", "Hombres"];
// Nombres cortos de los capítulos para las barras (el completo va en el tooltip)
const CAP_CORTO = {
  "Enfermedades de la sangre y del sistema inmunitario": "Sangre y sistema inmunitario",
  "Enfermedades endocrinas, nutricionales y metabólicas": "Endocrinas, nutricionales y metabólicas",
  "Síntomas y signos no clasificados en otra parte": "Síntomas y signos sin diagnóstico preciso",
};
const NIVELES = [
  ["Puestos de salud (I-1 y I-2)", ["I-1", "I-2"]],
  ["Centros de salud (I-3 y I-4)", ["I-3", "I-4"]],
  ["Hospitales (II-1, II-2 y III-1)", ["II-1", "II-2", "III-1"]],
  ["Especializados e institutos (II-E, III-2 y III-E)", ["II-E", "III-2", "III-E"]],
  ["Sin categoría", ["Sin categoría"]],
];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

const estado = {
  modulo: "atenciones", ambito: "nacional", region: NACIONAL, comparar: "", anio: null,
  cap: null,                                   // grupo de enfermedad elegido (null: todos)
  evolAt: { ind: "atendidos", verPor: "Total" },
  mapa: { atenciones: "atenciones_hab", recursos: "densidad", presupuesto: "pim_hab" },
  vista: "mapa",
};

let C, GEO, controles, ANIOS = [], ANIO_PARCIAL = null, MES_PARCIAL = null, CAPS = [], PROFESIONES = [];
const MO = new Map(), AT = new Map(), POB = new Map(), PR = new Map(), DEN = new Map(), PER = new Map();
const PER_MES = new Map();     // año -> mes del corte del personal
let EST = [], EST_FECHA = "", PRM = [];
const mapas = {}, ORDEN = {}, BUSCAR = {};

/* ---------------------------------------------------------
   Lectura de los datos
   --------------------------------------------------------- */
const cod = (lugar) => (lugar === NACIONAL ? "PE" : lugar);
const codPres = (lugar) => (lugar === "LIMA METROPOLITANA" || lugar === "LIMA PROVINCIAS" ? LIMA : cod(lugar));
const mo = (lugar, a, cap = "TOTAL", grupo = "total", cat = "Total") => MO.get(`${cod(lugar)}|${a}|${cap}|${grupo}|${cat}`) ?? null;
const at = (lugar, a, grupo = "total", cat = "Total") => AT.get(`${cod(lugar)}|${a}|${grupo}|${cat}`) ?? null;
const pr = (lugar, a, dim = "total", cat = "Total") => PR.get(`${codPres(lugar)}|${a}|${dim}|${cat}`) ?? null;
const den = (lugar, a, prof = "Médicos, enfermeras y obstetras") => DEN.get(`${cod(lugar)}|${a}|${prof}`) ?? null;
const per = (lugar, a, dim = "total", cat = "Total") => PER.get(`${cod(lugar)}|${a}|${dim}|${cat}`) ?? null;
function pob(lugar, a) {
  const c = lugar === LIMA ? LIMA : cod(lugar);
  if (POB.has(`${c}|${a}`)) return POB.get(`${c}|${a}`);
  // sin población del año: la del año más cercano
  const anios = [...POB.keys()].filter((k) => k.startsWith(`${c}|`)).map((k) => +k.split("|")[1]);
  if (!anios.length) return null;
  const cerca = anios.reduce((x, y) => (Math.abs(y - a) < Math.abs(x - a) ? y : x));
  return POB.get(`${c}|${cerca}`);
}
const porHab = (v, lugar, a, por = 1) => { const p = pob(lugar, a); return v != null && p ? (v / p) * por : null; };

const nombre = (c) => (c === NACIONAL ? "Perú" : c === LIMA ? "Lima (departamento)" : NOMBRES[c] ?? c);
const enLugar = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombre(c)}`);
const EnLugar = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombre(c)}`);
const lugarComp = () => (estado.comparar && estado.comparar !== estado.region ? estado.comparar : null);
const parcial = (a) => a === ANIO_PARCIAL;
const etqAnio = (a) => (parcial(a) ? `${a} (hasta ${MESES[MES_PARCIAL - 1]})` : String(a));
const destacar = (s) => `<strong>${s}</strong>`;
const $ = (s, raiz = document) => raiz.querySelector(s);

// Formatos
const pct = (v) => Obs.fmtPct(v, 1);
const n0 = (v) => (v == null ? "—" : Obs.fmtN(v, 0));
const n1 = (v) => (v == null ? "—" : Obs.fmtN(v, 1));
const millones = (v, dec = 1) => (v == null ? "—" : `${Obs.fmtN(v / 1e6, dec)} millones`);
const soles = (v) => (v == null ? "—" : v >= 1e9 ? `S/ ${Obs.fmtN(v / 1e9, 1)} mil millones` : v >= 1e6 ? `S/ ${Obs.fmtN(v / 1e6, 1)} millones` : `S/ ${Obs.fmtN(v, 0)}`);
const solesM = (v) => (v == null ? "—" : `S/ ${Obs.fmtN(v / 1e6, 0)} millones`);
const cuenta = (v) => (v == null ? "—" : v >= 1e6 ? millones(v) : Obs.fmtN(v, 0));
const variacion = (x, y) => (x != null && y ? x / y - 1 : null);

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const botones = (lista, elegida) => lista.map((o) =>
  `<button type="button" data-valor="${Obs.escapar(o.valor)}" aria-pressed="${o.valor === elegida}">${Obs.escapar(o.etiqueta)}</button>`).join("");
const tarjeta = (id, titulo, desc, { controles = "" } = {}) => `<article class="tarjeta" id="c-${id}">
  <header><h3>${titulo}</h3><p>${desc}</p></header>
  ${controles ? `<div class="controles">${controles}</div>` : ""}
  <p class="aviso-anio" id="av-${id}"></p>
  <p class="lectura" id="l-${id}" aria-live="polite"></p>
  <div class="ley" id="ley-${id}"></div>
  <div class="grafico" id="g-${id}"></div>
  <p class="nota-tarjeta" id="n-${id}"></p>
</article>`;
const par = (...t) => `<div class="par">${t.join("")}</div>`;
const local = (id, etiqueta, interior) => `<div class="filtro-local" role="group" aria-labelledby="lbl-${id}"><span id="lbl-${id}">${etiqueta}</span>${interior}</div>`;
const VP = (attr) => `<div class="segmentado claro" ${attr}></div>`;

function chispa(valores, color) {
  const pts = valores.filter((p) => p[1] != null);
  if (pts.length < 2) return "";
  const W = 120, H = 36, a0 = pts[0][0], a1 = pts.at(-1)[0];
  const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), r = hi - lo || 1;
  const x = (a) => 3 + ((a - a0) / (a1 - a0 || 1)) * (W - 6), y = (v) => H - 4 - ((v - lo) / r) * (H - 8);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const sel = pts.find((p) => p[0] === estado.anio) ?? pts.at(-1);
  return `<svg class="chispa" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="${x(sel[0]).toFixed(1)}" cy="${y(sel[1]).toFixed(1)}" r="3.5" fill="${color}"/></svg>`;
}

/* Aviso cuando el dato no existe en el año elegido; devuelve true si falta */
function sinAnio(id, anios, que) {
  const av = document.getElementById(`av-${id}`), falta = !anios.includes(estado.anio);
  av.textContent = falta && anios.length ? `${que} hay de ${anios[0]} a ${anios.at(-1)}. Elige uno de esos años arriba.` : "";
  document.getElementById(`g-${id}`).hidden = falta;
  if (falta) { document.getElementById(`l-${id}`).textContent = ""; document.getElementById(`ley-${id}`).innerHTML = ""; }
  return falta;
}

/* Barras horizontales del año elegido, con la marca de la comparación.
   items: [{ clave, etiqueta, valor, comp, detalle }] */
function barras(id, items, aria, { formato = pct, alClic = null, seleccion = null, ordenar = true } = {}) {
  const comp = lugarComp();
  const datos = items.filter((d) => d.valor != null).map((d) => ({ ...d, color: C.unica }));
  Obs.barras(id, datos, { formato, nombre: nombre(estado.region), comparacion: comp ? nombre(comp) : null, alClic, seleccion, ordenar,
    detalle: (d) => d.detalle ?? "" });
  document.getElementById(id).setAttribute("aria-label", aria);
  return datos;
}

/* Líneas por año. series: [{ nombre, color, valores (por ANIOS_SERIE), punteada }]
   quiebres: [{ anio, texto }]; referencia: { valor, texto } (línea horizontal) */
function lineas(id, anios, series, { formato = n0, eje = formato, final = eje, quiebres = [], referencia = null, aria = "" } = {}) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  if (!todos.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const ancho = el.clientWidth;
  const cada = ancho < 420 ? 3 : ancho < 760 ? 2 : 1;
  const rotular = series.length <= 4 && ancho >= 520;
  const ultimo = (vals) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i; return -1; };
  // tope redondo: 1, 2 o 5 por la potencia de 10
  const maximo = Math.max(...todos, referencia?.valor ?? 0) * 1.05;
  const pot = 10 ** Math.floor(Math.log10(maximo || 1));
  const tope = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((t) => t >= maximo) ?? 10 * pot;
  const arriba = quiebres.length ? 34 : 16, altoTrazo = Math.max(1, el.clientHeight - arriba - 30);
  // etiquetas del último año separadas al menos 17 px
  const desplazo = new Map();
  if (rotular) {
    const fin = series.map((s, i) => { const u = ultimo(s.valores); return u < 0 ? null : { i, y: arriba + altoTrazo * (1 - s.valores[u] / tope) }; })
      .filter(Boolean).sort((a, b) => a.y - b.y);
    const pos = fin.map((f) => f.y);
    for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + 17);
    fin.forEach((f, k) => desplazo.set(f.i, pos[k] - f.y));
  }
  const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
  // margen derecho según la etiqueta final más larga (14 px, negrita)
  const ctx = (lineas.ctx ??= document.createElement("canvas").getContext("2d"));
  ctx.font = `700 14px ${C.fuente}`;
  const derecha = 20 + Math.max(0, ...series.map((s) => { const u = ultimo(s.valores); return u < 0 ? 0 : ctx.measureText(final(s.valores[u])).width; }));
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${etqAnio(+ps[0].axisValue)}</strong>` + ps.filter((p) => p.value != null).sort((x, y) => y.value - x.value)
        .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${formato(p.value)}</strong>`).join("") },
    grid: { left: 8, right: rotular ? derecha : 18, top: arriba, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % cada === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => eje(v) }) },
    series: series.map((s, i) => {
      const u = ultimo(s.valores);
      return {
        name: s.nombre, type: "line", connectNulls: true, symbol: "circle", symbolSize: 7,
        data: s.valores.map((v, j) => (j === u && rotular ? { value: v, label: { show: true, position: "right", distance: 8, offset: [0, desplazo.get(i) ?? 0], formatter: () => final(v), ...txt({ color: C.texto, fontWeight: 700 }) } } : v)),
        lineStyle: { width: 2.5, color: s.color, type: s.punteada ? [6, 4] : "solid" }, itemStyle: { color: s.color },
        emphasis: { focus: "series" },
        markLine: i === 0 ? { silent: true, symbol: "none", animation: false, data: [
          ...(anios.includes(estado.anio) ? [{ xAxis: String(estado.anio), lineStyle: { color: C.navy, width: 1, type: "solid", opacity: 0.35 }, label: { show: false } }] : []),
          ...quiebres.filter((q) => anios.includes(q.anio)).map((q) => ({ xAxis: String(q.anio), lineStyle: { color: C.textoSuave, type: [4, 4], width: 1 },
            label: { show: ancho >= 520, position: "end", formatter: q.texto, ...txt({ fontSize: 13 }) } })),
          ...(referencia ? [{ yAxis: referencia.valor, lineStyle: { color: C.textoSuave, type: [4, 4], width: 1 },
            label: { show: true, position: "insideStartTop", formatter: referencia.texto, ...txt({ fontSize: 13 }) } }] : []),
        ] } : undefined,
      };
    }),
  }, true);
  el.setAttribute("aria-label", aria);
}

function leyenda(id, entradas) {
  document.getElementById(id).innerHTML = entradas.map(([n, color, punteada]) =>
    `<span><i class="l${punteada ? " punteada" : ""}" style="border-color:${color}"></i>${Obs.escapar(n)}</span>`).join("");
}

/* Tabla ordenable con buscador. columnas: [{ clave, titulo, num, valor(f), html(f) }] */
function tablaOrdenable(id, columnas, filas, { inicial, claveFila, elegida = null, alClic = null, descripcion, buscar = null, claseFila = () => "" }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const cmp = (a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  };
  const datos = [...filas].sort(cmp);
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    const sentido = activo ? (orden.dir === 1 ? "ascending" : "descending") : "none";
    return `<th class="${c.num ? "num" : ""}" aria-sort="${sentido}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = claveFila(f);
    const clases = [claseFila(f), k === elegida ? "elegida" : ""].filter(Boolean).join(" ");
    return `<tr tabindex="0" data-k="${Obs.escapar(String(k))}" data-texto="${Obs.escapar(columnas.filter((c) => !c.num).map((c) => String(c.valor(f) ?? "")).join(" ").toLowerCase())}"${clases ? ` class="${clases}"` : ""}>` +
      columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("") + "</tr>";
  }).join("");
  const caja = buscar ? `<div class="buscador-tabla"><label for="${id}-buscar">Buscar</label><input id="${id}-buscar" type="search" placeholder="${buscar}" autocomplete="off" value="${Obs.escapar(BUSCAR[id] ?? "")}"></div>` : "";
  el.innerHTML = caja + `<div class="tabla-desliza"><table class="tabla ordenable"><caption class="solo-lectores">${descripcion}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>` +
    `<p class="tabla-vacia" hidden>Ninguna fila coincide con la búsqueda.</p></div>`;
  const filtrar = () => {
    const q = (BUSCAR[id] ?? "").trim().toLowerCase();
    let visibles = 0;
    el.querySelectorAll("tbody tr").forEach((r) => { const ok = !q || r.dataset.texto.includes(q); r.hidden = !ok; visibles += ok; });
    el.querySelector(".tabla-vacia").hidden = visibles > 0;
  };
  filtrar();
  const input = el.querySelector("input[type=search]");
  if (input) input.oninput = () => { BUSCAR[id] = input.value; filtrar(); };
  el.querySelector("thead").onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (!b) return;
    const c = columnas.find((x) => x.clave === b.dataset.orden);
    ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
    tablaOrdenable(id, columnas, filas, { inicial, claveFila, elegida, alClic, descripcion, buscar, claseFila });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
  if (alClic) {
    el.querySelector("tbody").onclick = (e) => { const r = e.target.closest("tr[data-k]"); if (r) alClic(r.dataset.k); };
    el.querySelector("tbody").onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) alClic(e.target.dataset.k); };
  }
}

/* ---------------------------------------------------------
   Indicadores (cifras clave, mapa y evolución)
   valor(lugar, año) -> número o null; formato; mejor: alto|bajo|null; anios()
   --------------------------------------------------------- */
const capNombre = (c) => CAPS.find((x) => x.cap === c)?.capitulo ?? "";
const capCorto = (c) => CAP_CORTO[capNombre(c)] ?? capNombre(c);
function cuotaCap(lugar, a, cap, grupo = "total", cat = "Total") {
  const x = mo(lugar, a, cap, grupo, cat), t = mo(lugar, a, "TOTAL", grupo, cat);
  return x && t?.p ? x.p / t.p : null;
}
const IND = {
  atendidos: { corto: "Personas atendidas", valor: (l, a) => at(l, a)?.a ?? null, formato: cuenta, eje: (v) => millones(v, 0).replace(" millones", " M"), cuenta: true },
  atenciones: { corto: "Atenciones", valor: (l, a) => at(l, a)?.c ?? null, formato: cuenta, eje: (v) => millones(v, 0).replace(" millones", " M"), cuenta: true },
  por_persona: { corto: "Atenciones por persona", valor: (l, a) => { const x = at(l, a); return x?.a ? x.c / x.a : null; }, formato: n1 },
  atenciones_hab: { corto: "Atenciones por habitante", valor: (l, a) => porHab(at(l, a)?.c, l, a), formato: n1, mejor: null },
  cap_cuota: { corto: "Personas con el grupo elegido", valor: (l, a) => cuotaCap(l, a, estado.cap ?? "10"), formato: pct },
  densidad: { corto: "Médicos, enfermeras y obstetras", valor: (l, a) => den(l, a)?.d ?? null, formato: n1, mejor: "alto", unidad: "por 10 000 habitantes" },
  medicos: { corto: "Médicos", valor: (l, a) => den(l, a, "Médicos")?.d ?? null, formato: n1, mejor: "alto", unidad: "por 10 000 habitantes" },
  est_hab: { corto: "Establecimientos por 10 000 habitantes", valor: (l) => { const n = estTotal(l); return porHab(n, l, ANIOS.at(-1), 10000); }, formato: n1, sinAnio: true },
  pim: { corto: "Presupuesto (PIM)", valor: (l, a) => pr(l, a)?.pim ?? null, formato: soles },
  pim_hab: { corto: "Presupuesto por habitante", valor: (l, a) => porHab(pr(l, a)?.pim, codPres(l) === LIMA ? LIMA : l, a), formato: (v) => (v == null ? "—" : `S/ ${Obs.fmtN(v, 0)}`) },
  ejecucion: { corto: "Ejecución del presupuesto", valor: (l, a) => { const x = pr(l, a); return x?.pim ? x.devengado / x.pim : null; }, formato: pct, mejor: "alto" },
};
const MOD = {
  atenciones: { mapa: ["atenciones_hab", "cap_cuota"] },
  recursos: { mapa: ["densidad", "medicos", "est_hab"] },
  presupuesto: { mapa: ["pim_hab", "ejecucion"] },
};

function estTotal(lugar, filtro = () => true) {
  const c = cod(lugar);
  return EST.filter((f) => f.codigo === c && filtro(f)).reduce((s, f) => s + f.n, 0);
}

/* ---------------------------------------------------------
   Pestaña Atenciones
   --------------------------------------------------------- */
const aniosAt = () => ANIOS.filter((a) => at(NACIONAL, a));
const aniosMo = () => ANIOS.filter((a) => mo(NACIONAL, a));

function pintarEnfermedades() {
  const id = "enfermedades", comp = lugarComp(), a = estado.anio;
  if (sinAnio(id, aniosMo(), "Datos de morbilidad")) return;
  const items = CAPS.map(({ cap, capitulo }) => {
    const x = mo(estado.region, a, cap);
    return { clave: cap, etiqueta: CAP_CORTO[capitulo] ?? capitulo, valor: cuotaCap(estado.region, a, cap), comp: comp ? cuotaCap(comp, a, cap) : null,
      detalle: x ? `${n0(x.p)} personas<br>${n0(x.d)} diagnósticos registrados (consultas)` : "" };
  });
  const datos = barras(`g-${id}`, items, `Personas atendidas por grupo de enfermedad, ${enLugar(estado.region)}, ${a}`,
    { seleccion: estado.cap ? new Set([estado.cap]) : null, alClic: (c) => { estado.cap = estado.cap === c ? null : c; render(); } });
  const top = [...datos].sort((x, y) => y.valor - x.valor)[0];
  document.getElementById(`l-${id}`).innerHTML = top
    ? `${EnLugar(estado.region)}, en ${etqAnio(a)}, el grupo más frecuente fue ${destacar(Obs.minus(capNombre(top.clave)))}: el ${destacar(pct(top.valor))} de las personas atendidas con un diagnóstico.` : "";
  document.getElementById(`n-${id}`).textContent = "Una persona puede estar en varios grupos. Los diagnósticos cuentan consultas, no personas: en las enfermedades que requieren muchas consultas (cáncer, diabetes, salud mental) son muchos más que las personas.";
}

function pintarEvolAtenciones() {
  const id = "evol-atenciones", e = estado.evolAt, card = document.getElementById(`c-${id}`);
  const opcionesInd = [{ valor: "atendidos", etiqueta: "Personas atendidas" }, { valor: "atenciones", etiqueta: "Atenciones" },
    { valor: "morbilidad", etiqueta: estado.cap ? `Personas con ${Obs.minus(capCorto(estado.cap))}` : "Personas con algún diagnóstico" }];
  $("[data-ea-ind]", card).innerHTML = botones(opcionesInd, e.ind);
  $("[data-ea-verpor]", card).innerHTML = botones(["Total", "Sexo", "Edad"].map((v) => ({ valor: v, etiqueta: v })), e.verPor);
  const esMo = e.ind === "morbilidad", anios = esMo ? aniosMo() : aniosAt();
  const grupo = e.verPor === "Sexo" ? "sexo" : e.verPor === "Edad" ? "edad" : "total";
  const cats = grupo === "sexo" ? SEXOS : grupo === "edad" ? EDADES : ["Total"];
  const valor = (l, a, cat) => esMo ? mo(l, a, estado.cap ?? "TOTAL", grupo, cat)?.p ?? null : at(l, a, grupo, cat)?.[e.ind === "atendidos" ? "a" : "c"] ?? null;
  const comp = lugarComp();
  const series = cats.map((cat, i) => ({ nombre: cat === "Total" ? nombre(estado.region) : cat, color: grupo === "total" ? C.unica : C.series[i % C.series.length],
    valores: anios.map((a) => valor(estado.region, a, cat)) }));
  if (comp && comp !== NACIONAL && grupo === "total") series.push({ nombre: nombre(comp), color: C.textoSuave, punteada: true, valores: anios.map((a) => valor(comp, a, "Total")) });
  leyenda(`ley-${id}`, series.map((s) => [s.nombre, s.color, s.punteada]));
  const quiebres = [...(esMo ? [{ anio: QUIEBRE_HIS, texto: "Cambio de registro" }] : []), ...(ANIO_PARCIAL && anios.includes(ANIO_PARCIAL) ? [{ anio: ANIO_PARCIAL, texto: "Parcial" }] : [])];
  lineas(`g-${id}`, anios, series, { formato: cuenta, eje: (v) => (v >= 1e6 ? `${Obs.fmtN(v / 1e6, 0)} M` : Obs.fmtN(v, 0)), final: (v) => (v >= 1e6 ? `${Obs.fmtN(v / 1e6, 1)} M` : Obs.fmtN(v, 0)), quiebres,
    aria: `${opcionesInd.find((o) => o.valor === e.ind).etiqueta}, ${enLugar(estado.region)}, cada año` });
  const s = series[0], i1 = anios.length - 1 - (parcial(anios.at(-1)) ? 1 : 0);
  const v1 = s.valores[i1], v0 = s.valores[0];
  document.getElementById(`l-${id}`).innerHTML = v1 != null && v0 != null && grupo === "total"
    ? `${EnLugar(estado.region)} pasó de ${destacar(cuenta(v0))} en ${anios[0]} a ${destacar(cuenta(v1))} en ${anios[i1]}.` : "";
  document.getElementById(`n-${id}`).textContent = (esMo ? "Desde 2023 el HIS registra más personas con diagnóstico por un cambio en el registro, no porque haya más enfermos. " : "") +
    (ANIO_PARCIAL ? `${ANIO_PARCIAL} llega hasta ${MESES[MES_PARCIAL - 1]}: no es comparable con años completos.` : "");
}

function pintarQuien() {
  const a = estado.anio, comp = lugarComp(), cap = estado.cap;
  for (const [id, grupo, cats] of [["edad", "edad", EDADES], ["sexo", "sexo", SEXOS]]) {
    const anios = cap ? aniosMo() : aniosAt();
    if (sinAnio(id, anios, "Datos")) continue;
    const cuota = (l, cat) => {
      if (cap) { const x = mo(l, a, cap, grupo, cat), t = mo(l, a, cap); return x && t?.p ? x.p / t.p : null; }
      const x = at(l, a, grupo, cat), t = at(l, a); return x && t?.a ? x.a / t.a : null;
    };
    const items = cats.map((cat) => ({ clave: cat, etiqueta: cat, valor: cuota(estado.region, cat), comp: comp ? cuota(comp, cat) : null,
      detalle: cap ? `${n0(mo(estado.region, a, cap, grupo, cat)?.p)} personas` : `${n0(at(estado.region, a, grupo, cat)?.a)} personas` }));
    barras(`g-${id}`, items, `${cap ? `Personas con ${Obs.minus(capCorto(cap))}` : "Personas atendidas"} por ${grupo}, ${enLugar(estado.region)}, ${a}`, { ordenar: false });
    document.getElementById(`l-${id}`).innerHTML = cap ? `Personas con ${destacar(Obs.minus(capCorto(cap)))}.` : "Todas las personas atendidas.";
  }
}

/* ---------------------------------------------------------
   Pestaña Recursos
   --------------------------------------------------------- */
const aniosDen = () => ANIOS.filter((a) => den(NACIONAL, a));
const aniosPer = () => ANIOS.filter((a) => per(NACIONAL, a));

function pintarEstablecimientos() {
  const comp = lugarComp();
  const insts = [...new Set(EST.map((f) => f.institucion))];
  const total = (l) => estTotal(l) || null;
  const cuota = (l, filtro) => { const t = total(l); return t ? estTotal(l, filtro) / t : null; };
  barras("g-est-inst", insts.map((i) => ({ clave: i, etiqueta: i, valor: cuota(estado.region, (f) => f.institucion === i),
    comp: comp ? cuota(comp, (f) => f.institucion === i) : null, detalle: `${n0(estTotal(estado.region, (f) => f.institucion === i))} establecimientos` })),
  `Establecimientos por institución, ${enLugar(estado.region)}`);
  barras("g-est-nivel", NIVELES.map(([n, cats]) => ({ clave: n, etiqueta: n, valor: cuota(estado.region, (f) => cats.includes(f.categoria)),
    comp: comp ? cuota(comp, (f) => cats.includes(f.categoria)) : null, detalle: `${n0(estTotal(estado.region, (f) => cats.includes(f.categoria)))} establecimientos` })),
  `Establecimientos por tipo, ${enLugar(estado.region)}`, { ordenar: false });
  const t = total(estado.region), priv = cuota(estado.region, (f) => f.institucion === "Privado");
  document.getElementById("l-est-inst").innerHTML = t ? `${EnLugar(estado.region)} hay ${destacar(n0(t))} establecimientos activos; el ${destacar(pct(priv))} es privado.` : "";
  const puestos = cuota(estado.region, (f) => ["I-1", "I-2"].includes(f.categoria));
  document.getElementById("l-est-nivel").innerHTML = t ? `El ${destacar(pct(puestos))} son puestos de salud, la atención más básica.` : "";
  for (const id of ["est-inst", "est-nivel"]) document.getElementById(`n-${id}`).textContent = `Establecimientos activos en RENIPRESS al ${EST_FECHA}. No cambia con el año elegido arriba.`;
}

function pintarDensidad() {
  const id = "densidad", anios = aniosDen(), comp = lugarComp();
  const profs = [["Médicos, enfermeras y obstetras", C.unica], ["Enfermeras", C.series[1]], ["Médicos", C.series[2]], ["Obstetras", C.series[3]]];
  const series = profs.map(([p, color]) => ({ nombre: p, color, valores: anios.map((a) => den(estado.region, a, p)?.d ?? null) }));
  if (comp) series.push({ nombre: `${nombre(comp)} (médicos, enfermeras y obstetras)`, color: C.textoSuave, punteada: true, valores: anios.map((a) => den(comp, a)?.d ?? null) });
  leyenda(`ley-${id}`, series.map((s) => [s.nombre, s.color, s.punteada]));
  lineas(`g-${id}`, anios, series, { formato: n1, eje: (v) => Obs.fmtN(v, 0), referencia: { valor: OMS, texto: `OMS: ${Obs.fmtN(OMS, 1)}` },
    aria: `Profesionales de salud por 10 000 habitantes, ${enLugar(estado.region)}, cada año` });
  const x = den(estado.region, estado.anio);
  document.getElementById(`l-${id}`).innerHTML = x
    ? `${EnLugar(estado.region)}, en ${estado.anio}, hay ${destacar(n1(x.d))} médicos, enfermeras y obstetras por cada 10 000 habitantes; la OMS recomienda al menos ${n1(OMS)}.` : "";
  document.getElementById(`n-${id}`).textContent = "Todo el sistema de salud (público y privado), a diciembre de cada año. 2013-2017: Lima entera.";
}

function pintarProfesiones() {
  const id = "profesiones", comp = lugarComp(), a = estado.anio;
  if (sinAnio(id, aniosDen(), "Datos de profesionales")) return;
  const items = PROFESIONES.filter((p) => p !== "Médicos, enfermeras y obstetras").map((p) => {
    const x = den(estado.region, a, p);
    return { clave: p, etiqueta: p, valor: x?.d ?? null, comp: comp ? den(comp, a, p)?.d ?? null : null, detalle: x?.n != null ? `${n0(x.n)} profesionales` : "" };
  });
  barras(`g-${id}`, items, `Profesionales por 10 000 habitantes, ${enLugar(estado.region)}, ${a}`, { formato: n1 });
  const t = den(estado.region, a);
  document.getElementById(`l-${id}`).innerHTML = t?.n ? `${EnLugar(estado.region)} trabajan ${destacar(n0(t.n))} médicos, enfermeras y obstetras.` : "";
}

function pintarPersonal() {
  const comp = lugarComp(), a = estado.anio;
  for (const [id, dim, top] of [["regimen", "regimen", 99], ["grupo", "grupo", 12]]) {
    if (sinAnio(id, aniosPer(), "Datos de personal del Minsa y los gobiernos regionales")) continue;
    const cats = [...new Set([...PER.keys()].filter((k) => k.startsWith(`PE|${a}|${dim}|`)).map((k) => k.split("|")[3]))];
    const t = per(estado.region, a), tc = comp ? per(comp, a) : null;
    const items = cats.map((c) => ({ clave: c, etiqueta: c, valor: t ? (per(estado.region, a, dim, c) ?? 0) / t : null,
      comp: tc ? (per(comp, a, dim, c) ?? 0) / tc : null, detalle: `${n0(per(estado.region, a, dim, c))} personas` }))
      .sort((x, y) => y.valor - x.valor).slice(0, top);
    barras(`g-${id}`, items, `Personal del Minsa y los gobiernos regionales por ${dim}, ${enLugar(estado.region)}, ${a}`);
    document.getElementById(`l-${id}`).innerHTML = t && id === "regimen" ? `${EnLugar(estado.region)}, a ${PER_MES.get(a)} de ${a}, trabajan ${destacar(n0(t))} personas en el Minsa y los gobiernos regionales.` : "";
    document.getElementById(`n-${id}`).textContent = "Solo el Minsa y los gobiernos regionales; no incluye EsSalud, las sanidades ni el sector privado.";
  }
}

/* ---------------------------------------------------------
   Pestaña Presupuesto
   --------------------------------------------------------- */
const aniosPr = () => ANIOS.filter((a) => pr(NACIONAL, a));

function pintarEvolPresupuesto() {
  const id = "evol-pres", anios = aniosPr(), comp = lugarComp();
  const series = [{ nombre: "Presupuesto (PIM)", color: C.unica, valores: anios.map((a) => pr(estado.region, a)?.pim ?? null) },
    { nombre: "Gastado (devengado)", color: C.series[2], valores: anios.map((a) => pr(estado.region, a)?.devengado ?? null) }];
  if (comp && comp !== NACIONAL) series.push({ nombre: `${nombre(comp)} (PIM)`, color: C.textoSuave, punteada: true, valores: anios.map((a) => pr(comp, a)?.pim ?? null) });
  leyenda(`ley-${id}`, series.map((s) => [s.nombre, s.color, s.punteada]));
  lineas(`g-${id}`, anios, series, { formato: solesM, eje: (v) => `S/ ${Obs.fmtN(v / 1e9, 0)} mil mill.`, final: (v) => `S/ ${Obs.fmtN(v / 1e9, 1)} mil mill.`,
    quiebres: ANIO_PARCIAL && anios.includes(ANIO_PARCIAL) ? [{ anio: ANIO_PARCIAL, texto: "En curso" }] : [],
    aria: `Presupuesto de salud, ${enLugar(estado.region)}, cada año` });
  const x0 = pr(estado.region, anios[0]), cerrado = anios.filter((a) => !parcial(a)).at(-1), x1 = pr(estado.region, cerrado);
  document.getElementById(`l-${id}`).innerHTML = x0 && x1
    ? `El presupuesto de salud ${enLugar(estado.region)} pasó de ${destacar(soles(x0.pim))} en ${anios[0]} a ${destacar(soles(x1.pim))} en ${cerrado} (en soles de cada año, sin ajustar por inflación).` : "";
  document.getElementById(`n-${id}`).textContent = (codPres(estado.region) === LIMA ? "En el presupuesto, Lima va entera (el MEF solo da el departamento). " : "") +
    (ANIO_PARCIAL ? `${ANIO_PARCIAL} está en curso: su gasto llega hasta ${MESES[MES_PARCIAL - 1]}.` : "");
}

function pintarComposicion() {
  const comp = lugarComp(), a = estado.anio;
  for (const [id, dim] of [["pliego", "pliego"], ["generica", "generica"]]) {
    if (sinAnio(id, aniosPr(), "Datos de presupuesto")) continue;
    const cats = [...new Set([...PR.keys()].filter((k) => k.startsWith(`PE|${a}|${dim}|`)).map((k) => k.split("|")[3]))];
    const t = pr(estado.region, a), tc = comp ? pr(comp, a) : null;
    const items = cats.map((c) => {
      const x = pr(estado.region, a, dim, c);
      return { clave: c, etiqueta: c, valor: t?.pim && x ? x.pim / t.pim : null, comp: tc?.pim ? (pr(comp, a, dim, c)?.pim ?? 0) / tc.pim : null,
        detalle: x ? `PIM: ${soles(x.pim)}<br>Gastado: ${soles(x.devengado)} (${pct(x.pim ? x.devengado / x.pim : null)})` : "" };
    }).filter((d) => d.valor);
    barras(`g-${id}`, items, `Presupuesto de salud por ${dim}, ${enLugar(estado.region)}, ${a}`);
    const top = [...items].sort((x, y) => y.valor - x.valor)[0];
    document.getElementById(`l-${id}`).innerHTML = top ? `${top.etiqueta}: ${destacar(pct(top.valor))} del presupuesto.` : "";
  }
  document.getElementById("n-pliego").textContent = "Las transferencias del SIS a los gobiernos regionales pueden contarse dos veces al sumar pliegos.";
}

function pintarAvance() {
  const id = "avance", card = document.getElementById(`c-${id}`), a = ANIO_PARCIAL;
  card.hidden = !a || estado.region !== NACIONAL;
  if (card.hidden) return;
  const filas = PRM.filter((f) => f.anio === a).sort((x, y) => x.mes - y.mes);
  const previo = PRM.filter((f) => f.anio === a - 1).sort((x, y) => x.mes - y.mes);
  const meses = Array.from({ length: 12 }, (_, i) => i + 1);
  const serie = (lista) => meses.map((m) => { const f = lista.find((x) => x.mes === m); return f && f.pim ? f.devengado_acumulado / f.pim : null; });
  const series = [{ nombre: String(a), color: C.unica, valores: serie(filas) }];
  if (previo.length) series.push({ nombre: String(a - 1), color: C.textoSuave, punteada: true, valores: serie(previo) });
  leyenda(`ley-${id}`, series.map((s) => [s.nombre, s.color, s.punteada]));
  const g = Obs.grafico(`g-${id}`);
  const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>A ${MESES[+ps[0].dataIndex]}</strong>` + ps.filter((p) => p.value != null)
      .map((p) => `<br>${p.marker}${p.seriesName}: <strong>${pct(p.value)}</strong> gastado`).join("") },
    grid: { left: 56, right: 24, top: 16, bottom: 30 },
    xAxis: { type: "category", data: MESES.map((m) => m.slice(0, 3)), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "value", min: 0, max: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => `${Math.round(v * 100)} %` }) },
    series: series.map((s) => ({ name: s.nombre, type: "line", data: s.valores, symbol: "circle", symbolSize: 6, connectNulls: false,
      lineStyle: { width: 2.5, color: s.color, type: s.punteada ? [6, 4] : "solid" }, itemStyle: { color: s.color } })),
  }, true);
  const ult = filas.at(-1), mismo = previo.find((f) => f.mes === ult?.mes);
  document.getElementById(`l-${id}`).innerHTML = ult
    ? `A ${MESES[ult.mes - 1]} de ${a} se gastó el ${destacar(pct(ult.devengado_acumulado / ult.pim))} del presupuesto de salud` +
      (mismo ? `; a la misma altura de ${a - 1}, el ${pct(mismo.devengado_acumulado / mismo.pim)}.` : ".") : "";
}

/* ---------------------------------------------------------
   Mapa o cuadrícula, con ranking (uno por pestaña)
   --------------------------------------------------------- */
function htmlMapa(m) {
  return `<article class="tarjeta" id="c-mapa-${m}">
    <header><h3>¿Cómo está cada región?</h3>
      <p>Valor de cada región en el año elegido arriba. Haz clic en una región del mapa o de la tabla para elegirla en todo el tablero.</p></header>
    <div class="controles">
      ${local(`mi-${m}`, "Indicador", `<div class="segmentado claro" data-mapa-ind></div>`)}
      ${local(`mv-${m}`, "Ver como", `<div class="segmentado claro" data-vista></div>`)}
    </div>
    <p class="aviso-anio" id="av-mapa-${m}"></p>
    <p class="lectura" id="l-mapa-${m}" aria-live="polite"></p>
    <div class="mapa-y-tabla" id="mt-${m}">
      <div><div id="mapa-${m}"></div><div class="cuadricula" id="cuad-${m}" role="group" aria-label="Regiones en cuadrícula"></div><div class="leyenda-mapa" id="ley-mapa-${m}"></div></div>
      <div id="t-mapa-${m}"></div>
    </div>
    <p class="nota-tarjeta" id="n-mapa-${m}"></p>
  </article>`;
}

function pintarMapa(m) {
  const card = document.getElementById(`c-mapa-${m}`), clave = estado.mapa[m], I = IND[clave], a = estado.anio;
  const etq = (k) => (k === "cap_cuota" ? (estado.cap ? `Personas con ${Obs.minus(capCorto(estado.cap))}` : "Personas con enfermedades respiratorias") : IND[k].corto);
  $("[data-mapa-ind]", card).innerHTML = botones(MOD[m].mapa.map((k) => ({ valor: k, etiqueta: etq(k) })), clave);
  $("[data-vista]", card).innerHTML = botones([{ valor: "mapa", etiqueta: "Mapa" }, { valor: "cuadricula", etiqueta: "Cuadrícula" }], estado.vista);
  const presupuesto = m === "presupuesto";
  // En el presupuesto Lima va entera: las dos Limas toman el valor del departamento
  const regiones = presupuesto ? Object.keys(NOMBRES).filter((r) => !r.startsWith("LIMA ")).concat(LIMA) : Object.keys(NOMBRES);
  const filas = regiones.map((r) => ({ region: r, v: I.valor(r, a) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v);
  const cuerpo = document.getElementById(`mt-${m}`), lectura = document.getElementById(`l-mapa-${m}`);
  cuerpo.hidden = !filas.length;
  document.getElementById(`av-mapa-${m}`).textContent = filas.length ? "" : `No hay datos regionales de este indicador en ${a}.`;
  if (!filas.length) { lectura.textContent = ""; return; }
  const valores = new Map(filas.flatMap((x) => (x.region === LIMA ? [["LIMA METROPOLITANA", x.v], ["LIMA PROVINCIAS", x.v]] : [[x.region, x.v]])));
  const rango = Obs.rango(valores.values());
  const colorDe = (v) => Obs.colorContinuo(v, rango, C.escala);
  const enMapa = estado.vista === "mapa";
  document.getElementById(`mapa-${m}`).hidden = !enMapa;
  document.getElementById(`cuad-${m}`).hidden = enMapa;
  const corto = (v) => (I.formato === pct ? `${Obs.fmtN(v * 100, 0)} %` : I.formato(v));
  if (enMapa) {
    if (!mapas[m]) mapas[m] = new Obs.Mapa(`mapa-${m}`, GEO, { alClic: elegirRegion, nombre });
    mapas[m].pintar({ valores, color: colorDe, texto: (v) => I.formato(v), elegida: estado.region });
  } else {
    document.getElementById(`cuad-${m}`).innerHTML = Object.entries(CUADRO).sort((x, y) => x[1][1] - y[1][1] || x[1][0] - y[1][0]).map(([r, [c, fi]]) => {
      const v = valores.get(r), fondo = v != null ? colorDe(v) : null;
      return `<button type="button" data-region="${r}" style="grid-column:${c + 1};grid-row:${fi + 1};${fondo ? `background:${fondo}` : ""}" class="${fondo ? (Obs.colorOscuro(fondo) ? "oscuro" : "claro") : "sin-dato"}" aria-pressed="${r === estado.region}" aria-label="${nombre(r)}: ${v != null ? I.formato(v) : "sin datos"}">` +
        `${Obs.escapar(nombre(r).length > 11 ? abreviar(r) : nombre(r))}<span>${v != null ? corto(v) : "—"}</span></button>`;
    }).join("");
  }
  Obs.leyendaContinua(`ley-mapa-${m}`, rango, C.escala, I.formato, enMapa ? mapas[m] : null);

  const peru = I.valor(NACIONAL, a), alto = filas[0], bajo = filas.at(-1);
  let t = `En ${etqAnio(a)} (${Obs.minus(etq(clave))}${I.unidad ? `, ${I.unidad}` : ""}), ${destacar(nombre(alto.region))} tiene el valor más alto (${I.formato(alto.v)}) y ` +
    `${destacar(nombre(bajo.region))} el más bajo (${I.formato(bajo.v)})` + (peru != null ? `; el Perú, ${I.formato(peru)}` : "");
  const yo = presupuesto ? (codPres(estado.region) === LIMA ? LIMA : estado.region) : estado.region;
  const p = filas.findIndex((x) => x.region === yo);
  if (estado.region !== NACIONAL && p >= 0) t += `. ${nombre(yo)} está en el puesto ${destacar(`${p + 1} de ${filas.length}`)}`;
  lectura.innerHTML = `${t}.`;
  const lista = filas.map((x, i) => ({ region: x.region, nombre: nombre(x.region), v: x.v, pos: i + 1 }));
  if (peru != null) lista.push({ region: NACIONAL, nombre: "Perú", v: peru, pos: null });
  tablaOrdenable(`t-mapa-${m}`, [
    { clave: "pos", titulo: "#", num: true, valor: (x) => (x.pos ?? filas.filter((y) => y.v > x.v).length + 0.5), html: (x) => (x.pos ? String(x.pos) : "") },
    { clave: "nombre", titulo: "Región", valor: (x) => x.nombre, html: (x) => Obs.escapar(x.nombre) },
    { clave: "v", titulo: "Valor", num: true, valor: (x) => x.v, html: (x) => I.formato(x.v) },
  ], lista, { inicial: { clave: "v", dir: -1 }, claveFila: (x) => x.region, elegida: yo, alClic: (r) => elegirRegion(r === LIMA ? "LIMA METROPOLITANA" : r),
    buscar: "Nombre de la región", claseFila: (x) => (x.region === NACIONAL ? "peru" : ""), descripcion: `${etq(clave)} por región, ${a}` });
  document.getElementById(`n-mapa-${m}`).textContent = presupuesto ? "Lima va entera: el MEF solo da el departamento donde se gasta." :
    clave === "est_hab" ? `Establecimientos activos al ${EST_FECHA}, con la población de ${ANIOS.at(-1)}.` :
    clave === "atenciones_hab" ? "Atenciones de consulta externa en establecimientos del Minsa y los gobiernos regionales, entre la población de la región." : "";
}
const abreviar = (r) => ({ "LIMA METROPOLITANA": "Lima Met.", "LIMA PROVINCIAS": "Lima Prov.", "MADRE DE DIOS": "Madre de D.", HUANCAVELICA: "Huancav." })[r] ?? nombre(r);

/* ---------------------------------------------------------
   Cifras clave y resumen
   --------------------------------------------------------- */
function kpi(etiqueta, valor, { pie = "", cambio = "", serie = null } = {}) {
  return `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span>
    <div class="kpi-cuerpo"><span class="kpi-valor${typeof valor === "string" && valor.length > 14 ? " texto" : ""}">${valor}</span>${serie ? chispa(serie, C.unica) : ""}</div>
    ${cambio}<span class="kpi-pie">${pie}</span></div>`;
}
function cambioPct(x, y, a, mejor = null) {
  if (x == null || y == null || parcial(a)) return "";
  const d = variacion(x, y);
  if (d == null) return "";
  const quieto = Math.abs(d) < 0.0005, mejora = mejor === "alto" ? d > 0 : mejor === "bajo" ? d < 0 : null;
  const clase = quieto ? "igual" : mejora == null ? "igual" : mejora ? "mejora" : "empeora";
  return `<span class="kpi-cambio ${clase}"><span aria-hidden="true">${quieto ? "=" : d > 0 ? "▲" : "▼"}</span> ${quieto ? "Igual" : `${Obs.fmtN(Math.abs(d) * 100, 1)} %`} frente a ${a - 1}</span>`;
}
const pieLugar = (a) => `${etqAnio(a)}${estado.region !== NACIONAL ? `, ${nombre(estado.region)}` : ""}`;
const vsComp = (f) => { const c = lugarComp(); const v = c ? f(c) : null; return v != null ? `. ${nombre(c)}: ${v}` : ""; };

function pintarCifras(m) {
  const l = estado.region, a = estado.anio, el = document.getElementById(`k-${m}`);
  if (m === "atenciones") {
    const x = at(l, a), xp = at(l, a - 1);
    const top = CAPS.filter((c) => c.cap !== "18" && c.cap !== "99").map((c) => [c, cuotaCap(l, a, c.cap)]).filter((z) => z[1]).sort((p, q) => q[1] - p[1])[0];
    el.innerHTML =
      kpi("Personas atendidas", x ? cuenta(x.a) : "—", { pie: pieLugar(a) + vsComp((c) => cuenta(at(c, a)?.a)), cambio: cambioPct(x?.a, xp?.a, a), serie: aniosAt().map((y) => [y, at(l, y)?.a ?? null]) }) +
      kpi("Atenciones por persona", x?.a ? n1(x.c / x.a) : "—", { pie: `${x ? cuenta(x.c) : "—"} atenciones en ${etqAnio(a)}` + vsComp((c) => n1(IND.por_persona.valor(c, a))) }) +
      kpi("Grupo de enfermedad más frecuente", top ? Obs.escapar(CAP_CORTO[top[0].capitulo] ?? top[0].capitulo) : "—", { pie: top ? `El ${pct(top[1])} de las personas atendidas, ${etqAnio(a)}` : "Sin datos" });
  } else if (m === "recursos") {
    const t = estTotal(l), d = den(l, a), p = per(l, a);
    el.innerHTML =
      kpi("Establecimientos de salud activos", t ? n0(t) : "—", { pie: `Al ${EST_FECHA}${l !== NACIONAL ? `, ${nombre(l)}` : ""}` + vsComp((c) => n0(estTotal(c))) }) +
      kpi("Médicos, enfermeras y obstetras por 10 000 habitantes", d ? n1(d.d) : "—", { pie: `${d ? `OMS: al menos ${n1(OMS)}. ` : ""}${pieLugar(a)}` + vsComp((c) => n1(den(c, a)?.d)),
        cambio: cambioPct(d?.d, den(l, a - 1)?.d, a, "alto"), serie: aniosDen().map((y) => [y, den(l, y)?.d ?? null]) }) +
      kpi("Personal del Minsa y los gobiernos regionales", p ? n0(p) : "—", { pie: p ? `A ${PER_MES.get(a)} de ${a}${l !== NACIONAL ? `, ${nombre(l)}` : ""}` + vsComp((c) => n0(per(c, a))) : `Hay datos de ${aniosPer()[0]} a ${aniosPer().at(-1)}`,
        cambio: cambioPct(p, per(l, a - 1), a) });
  } else {
    const x = pr(l, a), xp = pr(l, a - 1), lugarPr = codPres(l) === LIMA ? LIMA : l;
    el.innerHTML =
      kpi("Presupuesto de salud (PIM)", x ? soles(x.pim) : "—", { pie: pieLugar(a) + (lugarPr === LIMA ? " (Lima entera)" : "") + vsComp((c) => soles(pr(c, a)?.pim)), cambio: cambioPct(x?.pim, xp?.pim, a),
        serie: aniosPr().map((y) => [y, pr(l, y)?.pim ?? null]) }) +
      kpi(parcial(a) ? `Gastado hasta ${MESES[MES_PARCIAL - 1]}` : "Gastado (ejecución)", x?.pim ? pct(x.devengado / x.pim) : "—", { pie: x ? `${soles(x.devengado)} de ${soles(x.pim)}` : "" }) +
      kpi("Presupuesto por habitante", x ? IND.pim_hab.formato(IND.pim_hab.valor(l, a)) : "—", { pie: pieLugar(a) + vsComp((c) => IND.pim_hab.formato(IND.pim_hab.valor(c, a))) });
  }
}

function pintarResumen(m) {
  const l = estado.region, a = estado.anio, el = document.getElementById(`r-${m}`), partes = [];
  if (m === "atenciones") {
    const x = at(l, a);
    if (x) partes.push(`${EnLugar(l)}, en ${etqAnio(a)}, ${destacar(cuenta(x.a))} personas se atendieron en consulta externa de los establecimientos del Minsa y los gobiernos regionales, con ${destacar(cuenta(x.c))} atenciones (${n1(x.c / x.a)} por persona).`);
    const resp = cuotaCap(l, a, "10");
    if (resp) partes.push(`El ${pct(resp)} de quienes recibieron un diagnóstico tuvo una enfermedad respiratoria.`);
  } else if (m === "recursos") {
    const d = den(l, a), t = estTotal(l);
    if (d) partes.push(`${EnLugar(l)}, en ${a}, hay ${destacar(n1(d.d))} médicos, enfermeras y obstetras por cada 10 000 habitantes, ${d.d >= OMS ? "por encima" : "por debajo"} del mínimo de ${n1(OMS)} que recomienda la OMS.`);
    if (t) partes.push(`Hay ${destacar(n0(t))} establecimientos de salud activos.`);
  } else {
    const x = pr(l, a);
    if (x) partes.push(`${EnLugar(codPres(l) === LIMA ? LIMA : l)}, en ${etqAnio(a)}, el presupuesto de salud es de ${destacar(soles(x.pim))} y se ha gastado el ${destacar(pct(x.devengado / x.pim))}.`);
  }
  el.innerHTML = partes.length ? partes.join(" ") : `${EnLugar(l)} no hay datos en ${a} para esta pestaña.`;
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  const antes = estado.ambito;
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  if (antes === "nacional" && estado.ambito === "regional" && !("comparar" in parche) && !estado.comparar) estado.comparar = NACIONAL;
  if (estado.ambito === "nacional" && estado.comparar === NACIONAL) estado.comparar = "";
  render();
}
function elegirRegion(c) {
  if (c === NACIONAL || c === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: c });
}

function sincronizarControles() {
  controles.sincronizar(estado);
  $("#f-anio").value = estado.anio;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  const comp = lugarComp();
  document.getElementById("viendo").innerHTML = `Mostrando: ${destacar(`${nombre(estado.region)}, ${etqAnio(estado.anio)}`)}${comp ? ` frente a ${destacar(nombre(comp))}` : ""}` +
    (estado.modulo === "atenciones" && estado.cap ? `. Grupo de enfermedad: ${destacar(Obs.escapar(capCorto(estado.cap)))} <button type="button" class="chip-limpiar" data-quitar-cap>Quitar</button>` : "");
}

function actualizarURL() {
  Obs.escribirURL({
    modulo: estado.modulo === "atenciones" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    comparar: (estado.region === NACIONAL ? estado.comparar : estado.comparar === NACIONAL ? null : estado.comparar || "ninguna") || null,
    anio: estado.anio === ANIO_DEFECTO ? null : estado.anio,
    cap: estado.cap,
  });
}

function render() {
  sincronizarControles();
  const m = estado.modulo;
  pintarResumen(m);
  pintarCifras(m);
  if (m === "atenciones") { pintarEnfermedades(); pintarEvolAtenciones(); pintarQuien(); }
  if (m === "recursos") { pintarEstablecimientos(); pintarDensidad(); pintarProfesiones(); pintarPersonal(); }
  if (m === "presupuesto") { pintarEvolPresupuesto(); pintarComposicion(); pintarAvance(); }
  igualarPares();
  pintarMapa(m);
  actualizarURL();
}

/* En un par de tarjetas lado a lado, los gráficos de barras toman la misma altura */
function igualarPares() {
  document.querySelectorAll(`#c-${estado.modulo} .par`).forEach((p) => {
    const gs = [...p.querySelectorAll(":scope > .tarjeta:not([hidden]) .grafico:not([hidden])")].filter((g) => g.style.height);
    if (gs.length !== 2 || Math.abs(gs[0].getBoundingClientRect().left - gs[1].getBoundingClientRect().left) < 50) return;
    const alto = Math.max(...gs.map((g) => parseFloat(g.style.height)));
    gs.forEach((g) => { if (parseFloat(g.style.height) < alto) { g.style.height = `${alto}px`; Obs.grafico(g.id).resize(); } });
  });
}

function tarjetas() {
  document.getElementById("c-atenciones").innerHTML =
    tarjeta("enfermedades", "¿Por qué se atiende la gente?", "Porcentaje de las personas atendidas con un diagnóstico que tuvo cada grupo de enfermedad, en el año elegido. Haz clic en un grupo para verlo en los demás gráficos.") +
    tarjeta("evol-atenciones", "¿Cómo ha cambiado?", "Personas atendidas, atenciones o personas con el grupo de enfermedad elegido, cada año.",
      { controles: local("ea-ind", "Indicador", VP("data-ea-ind")) + local("ea-vp", "Ver por", VP("data-ea-verpor")) }) +
    par(tarjeta("edad", "¿Quiénes se atienden, por edad?", "Porcentaje de las personas en cada grupo de edad, en el año elegido."),
      tarjeta("sexo", "¿Y por sexo?", "Porcentaje de mujeres y hombres, en el año elegido.")) +
    htmlMapa("atenciones");
  document.getElementById("c-recursos").innerHTML =
    par(tarjeta("est-inst", "¿De quién son los establecimientos?", "Porcentaje de los establecimientos de salud activos de cada institución."),
      tarjeta("est-nivel", "¿Qué tipo de establecimientos hay?", "Porcentaje de los establecimientos activos por nivel de atención.")) +
    tarjeta("densidad", "¿Cuántos profesionales de salud hay por habitante?", "Médicos, enfermeras y obstetras por cada 10 000 habitantes, cada año. La línea punteada es el mínimo que recomienda la OMS.") +
    tarjeta("profesiones", "¿Qué otros profesionales hay?", "Profesionales de cada carrera por cada 10 000 habitantes, en el año elegido.") +
    par(tarjeta("regimen", "¿Con qué contrato trabajan?", "Porcentaje del personal del Minsa y los gobiernos regionales por régimen laboral."),
      tarjeta("grupo", "¿Qué hacen?", "Porcentaje del personal del Minsa y los gobiernos regionales por grupo ocupacional.")) +
    htmlMapa("recursos");
  document.getElementById("c-presupuesto").innerHTML =
    tarjeta("evol-pres", "¿Cuánto se ha invertido en salud cada año?", "Presupuesto institucional modificado (PIM) y gasto devengado de la función Salud, en millones de soles de cada año.") +
    par(tarjeta("pliego", "¿Quién gasta?", "Porcentaje del presupuesto de salud de cada entidad, en el año elegido."),
      tarjeta("generica", "¿En qué se gasta?", "Porcentaje del presupuesto de salud por tipo de gasto, en el año elegido.")) +
    tarjeta("avance", "¿Cómo avanza el gasto este año?", "Porcentaje del presupuesto de salud gastado (devengado) hasta cada mes del año en curso. Solo para el Perú.") +
    htmlMapa("presupuesto");

  for (const m of MODULOS) {
    const caja = document.getElementById(`c-${m}`);
    caja.addEventListener("click", (e) => {
      const reg = e.target.closest(".cuadricula button[data-region]");
      if (reg) return elegirRegion(reg.dataset.region);
      const b = e.target.closest("button[data-valor]");
      if (!b) return;
      const g = b.parentElement, v = b.dataset.valor;
      if (g.hasAttribute("data-ea-ind")) estado.evolAt.ind = v;
      else if (g.hasAttribute("data-ea-verpor")) estado.evolAt.verPor = v;
      else if (g.hasAttribute("data-mapa-ind")) estado.mapa[m] = v;
      else if (g.hasAttribute("data-vista")) estado.vista = v;
      else return;
      render();
    });
  }
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
let ANIO_DEFECTO;
Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  GEO = geo;
  C = { ...Obs.tema(), series: ["--serie-1", "--serie-2", "--serie-3", "--serie-4", "--serie-5"].map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()) };
  const T = (p) => (datos.tablas[p] ? Obs.expandir(datos.tablas[p]) : []);
  const lugar = (c) => (c === "PE" ? "PE" : c);
  const anios = new Set();
  const capsVistos = new Map();
  for (const f of T("morbilidad")) {
    const cap = String(f.cap).padStart(2, "0");
    MO.set(`${lugar(f.codigo)}|${+f.anio}|${cap}|${f.grupo}|${f.categoria}`, { p: +f.personas, d: +f.diagnosticos });
    capsVistos.set(cap, f.capitulo);
    anios.add(+f.anio);
  }
  // Total de personas con algún diagnóstico: suma de los grupos (una persona puede estar en varios)
  for (const [k, v] of [...MO]) {
    const [c, a, , g, cat] = k.split("|"), kt = `${c}|${a}|TOTAL|${g}|${cat}`;
    const t = MO.get(kt) ?? { p: 0, d: 0 };
    MO.set(kt, { p: t.p + v.p, d: t.d + v.d });
  }
  CAPS = [...capsVistos].filter(([c]) => c !== "99").sort().map(([cap, capitulo]) => ({ cap, capitulo }));
  for (const f of T("atenciones")) { AT.set(`${lugar(f.codigo)}|${+f.anio}|${f.grupo}|${f.categoria}`, { a: +f.atendidos, c: +f.atenciones }); anios.add(+f.anio); }
  for (const f of T("poblacion")) POB.set(`${f.codigo}|${+f.anio}`, +f.poblacion);
  for (const f of T("presupuesto")) { PR.set(`${f.codigo}|${+f.anio}|${f.dimension}|${f.categoria}`, { pia: +f.pia, pim: +f.pim, devengado: +f.devengado }); anios.add(+f.anio); }
  for (const f of T("densidad")) {
    DEN.set(`${f.codigo}|${+f.anio}|${f.profesion}`, { n: f.profesionales === "" || f.profesionales == null ? null : +f.profesionales, d: +f.densidad });
    anios.add(+f.anio);
  }
  PROFESIONES = [...new Set(T("densidad").map((f) => f.profesion))];
  for (const f of T("personal")) { PER.set(`${f.codigo}|${+f.anio}|${f.dimension}|${f.categoria}`, +f.personal); PER_MES.set(+f.anio, String(f.mes).toLowerCase()); anios.add(+f.anio); }
  EST = T("establecimientos").map((f) => ({ ...f, n: +f.n }));
  const fe = EST[0]?.fecha ? String(EST[0].fecha).slice(0, 10).split("-").map(Number) : null;
  EST_FECHA = fe ? `${fe[2]} de ${MESES[fe[1] - 1]} de ${fe[0]}` : "—";
  PRM = T("presupuesto_mensual").map((f) => ({ anio: +f.anio, mes: +f.mes, pim: +f.pim, devengado_acumulado: +f.devengado_acumulado }));
  const ultimoMes = PRM.filter((f) => f.anio === Math.max(...PRM.map((x) => x.anio))).reduce((s, f) => Math.max(s, f.mes), 0);
  if (PRM.length && ultimoMes < 12) { ANIO_PARCIAL = Math.max(...PRM.map((x) => x.anio)); MES_PARCIAL = ultimoMes; }
  ANIOS = [...anios].sort((x, y) => x - y);
  ANIO_DEFECTO = ANIO_PARCIAL && ANIOS.includes(ANIO_PARCIAL - 1) ? ANIO_PARCIAL - 1 : ANIOS.at(-1);
  estado.anio = ANIO_DEFECTO;

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const reg = (q.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) Object.assign(estado, { ambito: "regional", region: reg, comparar: NACIONAL });
  const cmpq = (q.get("comparar") || "").toUpperCase();
  if (cmpq === "NINGUNA") estado.comparar = "";
  else if (NOMBRES[cmpq] || cmpq === NACIONAL) estado.comparar = cmpq;
  if (ANIOS.includes(+q.get("anio"))) estado.anio = +q.get("anio");
  if (CAPS.some((c) => c.cap === q.get("cap"))) estado.cap = q.get("cap");

  const filtros = document.getElementById("filtros");
  const regiones = Object.keys(NOMBRES).map((r) => ({ region: r, nombre: NOMBRES[r] }));
  controles = Obs.controlesComunes(filtros, { regiones, anios: [ANIOS[0], ANIOS.at(-1)], alCambiar: actualizar, comparar: true, periodo: false });
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <label for="f-anio">Año</label>
      <select id="f-anio" class="corto">${[...ANIOS].reverse().map((a) => `<option value="${a}">${a}${parcial(a) ? " (en curso)" : ""}</option>`).join("")}</select>
    </div>
    <p class="viendo" id="viendo" aria-live="polite"></p>`);
  document.getElementById("f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  document.getElementById("viendo").onclick = (e) => { if (e.target.closest("[data-quitar-cap]")) { estado.cap = null; render(); } };
  MODULOS.forEach((m) => document.getElementById(`r-${m}`).insertAdjacentHTML("beforebegin",
    `<p class="pista-arriba">Elige la región, el año y con quién comparar arriba. Haz clic en una región del mapa o de la tabla para elegirla en todo el tablero.</p>`));
  tarjetas();

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => {
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso) return;
      const sig = pestanas[(i + paso + pestanas.length) % pestanas.length];
      sig.focus();
      sig.click();
    };
  });
  let espera, anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });
  render();
});
