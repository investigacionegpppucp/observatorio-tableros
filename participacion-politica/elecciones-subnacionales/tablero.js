/* =========================================================
   Tablero de Elecciones regionales y municipales — Observatorio para la Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script, desde el Sheet «[Tableros] Elecciones regionales y
   municipales», que llena procesos/elecciones-subnacionales/elecciones.py. Pestañas:
     lugares: una fila por elección y lugar (anio, nivel, ubigeo INEI, electores, emitidos, validos, blancos,
              nulos, listas, nep, primero, segundo y sus votos, participacion, margen, actas_pct, anulada)
     organizaciones: votos de cada organización en regiones y provincias
     oferta: listas y candidatos por elección, nivel, región y tipo de organización
     gobernadores: gobernador electo (ganador final, con la segunda vuelta) por región y elección

   Cuatro pestañas: Resumen, Resultados, Participación y Oferta. Filtros comunes arriba: elección, nivel
   (regional, provincial o distrital) y región. Patrón: un objeto `estado` y una sola render().

   Parámetros de URL: ?modulo=resultados &nivel=provincial &region=08 &anio=2022 &lugar=0801 &embed=1
   ========================================================= */

const TABLERO = "elecciones-subnacionales";
const MODULOS = ["resumen", "resultados", "participacion", "oferta"];
const NIVELES = ["regional", "provincial", "distrital"];
const NIVEL_NOMBRE = { regional: "Elecciones regionales", provincial: "Elecciones provinciales", distrital: "Elecciones distritales" };
const NIVEL_BOTON = { regional: "Regionales", provincial: "Provinciales", distrital: "Distritales" };
const GOBIERNO = { regional: "gobiernos regionales", provincial: "municipalidades provinciales", distrital: "municipalidades distritales" };
const LUGAR = { regional: "región", provincial: "provincia", distrital: "distrito" };
// Nombre de la elección, para que los textos digan siempre de cuál se habla
const ELECCION = { regional: "la elección de gobernadores regionales", provincial: "la elección de alcaldes provinciales", distrital: "la elección de alcaldes distritales" };
const PE = "PE";
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const DEPS = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca", "07": "Callao",
  "08": "Cusco", "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque",
  "15": "Lima", "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura", "21": "Puno",
  "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};
// Nombre del departamento en el mapa de regiones (la elección regional de Lima es la de Lima Provincias)
const sinTilde = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const DEP_GEO = Object.fromEntries(Object.entries(DEPS).map(([c, n]) => [c, c === "15" ? "LIMA PROVINCIAS" : sinTilde(n)]));
const GEO_DEP = Object.fromEntries(Object.entries(DEP_GEO).map(([c, n]) => [n, c]));

const TIPOS = ["Partido político", "Movimiento regional", "Alianza electoral", "Lista independiente", "Organización local"];
const PENDIENTE = "Segunda vuelta pendiente";
const PLURAL = { "Partido político": "partidos políticos", "Movimiento regional": "movimientos regionales", "Alianza electoral": "alianzas electorales",
  "Lista independiente": "listas independientes", "Organización local": "organizaciones locales" };

const estado = {
  modulo: "resumen", nivel: "regional", region: PE, anio: null, lugar: null,
  mapa: { resultados: "ganador", participacion: "participacion" },
};

let C, controles, ANIOS = [], ANIO_DEFECTO;
const GEO = {};
let LUG = [], ORG = [], OF = [], GOB = [];
const POR = new Map();        // anio|nivel -> filas de lugares
const NOMBRE_LUGAR = new Map(); // ubigeo -> nombre para mostrar
const mapas = {}, ORDEN = {}, BUSCAR = {};

/* ---------------------------------------------------------
   Formatos y textos
   --------------------------------------------------------- */
const $ = (s, raiz = document) => raiz.querySelector(s);
const pct = (v) => Obs.fmtPct(v, 1);
const pts = (v) => (v == null ? "—" : `${Obs.fmtN(v * 100, 1)} pts`);
const pct0 = (v) => (v == null ? "—" : `${Obs.fmtN(v * 100, 0)} %`);
const n0 = (v) => (v == null ? "—" : Obs.fmtN(v, 0));
const n1 = (v) => (v == null ? "—" : Obs.fmtN(v, 1));
const cuenta = (v) => (v == null ? "—" : v >= 1e6 ? `${Obs.fmtN(v / 1e6, 1)} millones` : Obs.fmtN(v, 0));
const destacar = (s) => `<strong>${s}</strong>`;
const MINUS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "a", "por", "para", "con"]);
function titulo(s) {
  return String(s ?? "").toLowerCase().split(" ").map((p, i) => (i && MINUS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ")
    .replace(/\b(Ii|Iii|Iv|An|Apra|Fia|Ppc|Mas)\b/g, (x) => x.toUpperCase());
}
const nombreRegion = (c) => (c === PE ? "Perú" : DEPS[c] ?? c);
const enRegion = (c) => (c === PE ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnRegion = (c) => (c === PE ? "En el Perú" : `En ${nombreRegion(c)}`);
const ANIO_PARCIAL = () => Math.max(...LUG.filter((f) => f.actas_pct < 100).map((f) => f.anio), 0) || null;
const etqAnio = (a) => (a === ANIO_PARCIAL() ? `${a} (conteo en curso)` : String(a));
const colorTipo = (t) => (t === PENDIENTE ? "#b9c2cf" : C.categorias[TIPOS.indexOf(t)] ?? C.otros);
const pill = (t) => (t ? `<span class="pill" style="background:${colorTipo(t)}">${Obs.escapar(t)}</span>` : "");
const nombreLugar = (u) => (String(u).length === 2 ? nombreRegion(u) : NOMBRE_LUGAR.get(u) ?? u);

/* ---------------------------------------------------------
   Datos: filtros y agregados
   --------------------------------------------------------- */
const dep = (f) => f.dep;
function filas(anio = estado.anio, nivel = estado.nivel, region = estado.region) {
  const t = POR.get(`${anio}|${nivel}`) ?? [];
  return region === PE ? t : t.filter((f) => dep(f) === region);
}
function agregado(fs) {
  const ok = fs.filter((f) => !f.anulada);
  if (!ok.length) return null;
  const s = (k) => ok.reduce((x, f) => x + (+f[k] || 0), 0);
  const prom = (k) => { const v = ok.map((f) => f[k]).filter((x) => x !== "" && x != null); return v.length ? v.reduce((a, b) => a + +b, 0) / v.length : null; };
  const electores = s("electores"), emitidos = s("emitidos");
  return {
    lugares: ok.length, electores, emitidos, validos: s("validos"), listas: s("listas"),
    participacion: electores ? emitidos / electores : null,
    invalidos: emitidos ? (s("blancos") + s("nulos")) / emitidos : null,
    blancos: emitidos ? s("blancos") / emitidos : null, nulos: emitidos ? s("nulos") / emitidos : null,
    listasProm: prom("listas"), nep: prom("nep"), margen: prom("margen"),
  };
}
/* Ganador de cada lugar: en la elección regional, el ganador final (con la segunda vuelta) */
function ganadores(anio = estado.anio, nivel = estado.nivel, region = estado.region) {
  if (nivel === "regional") {
    return GOB.filter((g) => g.anio === anio && (region === PE || g.ubigeo === region)).map((g) => ({
      ubigeo: g.ubigeo, org: g.ganador_fue === "pendiente" ? "" : g.ganador,
      tipo: g.ganador_fue === "pendiente" ? PENDIENTE : g.tipo_ganador, g,
    }));
  }
  return filas(anio, nivel, region).filter((f) => !f.anulada && f.primero).map((f) => ({ ubigeo: f.ubigeo, org: f.primero, tipo: f.tipo_primero }));
}
function cuotaTipos(anio, nivel = estado.nivel, region = estado.region) {
  const gs = ganadores(anio, nivel, region).filter((g) => g.tipo !== PENDIENTE);
  if (!gs.length) return null;
  const m = new Map(TIPOS.map((t) => [t, 0]));
  gs.forEach((g) => m.set(g.tipo, (m.get(g.tipo) ?? 0) + 1));
  return { total: gs.length, cuota: (t) => m.get(t) / gs.length, n: (t) => m.get(t) };
}
function ofertaDe(anio, nivel = estado.nivel, region = estado.region) {
  const fs = OF.filter((f) => f.anio === anio && f.nivel === nivel && (region === PE || f.ubigeo === region));
  if (!fs.length) return null;
  const s = (k) => fs.reduce((x, f) => x + (f[k] === "" ? 0 : +f[k] || 0), 0);
  const hay = (k) => fs.some((f) => f[k] !== "" && f[k] != null);
  return { listas: s("listas"), candidatos: s("candidatos"), mujeres: s("mujeres"), cabezas: s("cabezas"), cabezasMujeres: s("cabezas_mujeres"),
    jovenes: hay("jovenes") ? s("jovenes") : null, nativos: hay("nativos") ? s("nativos") : null,
    porTipo: (t) => fs.filter((f) => f.tipo === t).reduce((x, f) => x + +f.listas, 0) };
}

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const botones = (lista, elegida) => lista.map((o) =>
  `<button type="button" data-valor="${Obs.escapar(o.valor)}" aria-pressed="${o.valor === elegida}">${Obs.escapar(o.etiqueta)}</button>`).join("");
const tarjeta = (id, tit, desc, { controles = "", clase = "", tabla = false } = {}) => `<article class="tarjeta ${clase}" id="c-${id}">
  <header><h3>${tit}</h3><p>${desc}</p></header>
  ${controles ? `<div class="controles">${controles}</div>` : ""}
  <p class="aviso-anio" id="av-${id}"></p>
  <p class="lectura" id="l-${id}" aria-live="polite"></p>
  <div class="ley-cat" id="ley-${id}"></div>
  <div class="${tabla ? "tabla-caja" : "grafico"}" id="g-${id}"></div>
  <p class="nota-tarjeta" id="n-${id}"></p>
</article>`;
const par = (...t) => `<div class="par">${t.join("")}</div>`;
const local = (id, etiqueta, interior) => `<div class="filtro-local" role="group" aria-labelledby="lbl-${id}"><span id="lbl-${id}">${etiqueta}</span>${interior}</div>`;
const leyendaTipos = (id, tipos) => { document.getElementById(id).innerHTML = tipos.map((t) => `<span><i${t === PENDIENTE ? ' class="rayado"' : ""} style="background:${colorTipo(t)}"></i>${Obs.escapar(t)}</span>`).join(""); };
const lectura = (id, html) => { document.getElementById(`l-${id}`).innerHTML = html; };
const nota = (id, txt) => { document.getElementById(`n-${id}`).textContent = txt; };

function kpi(etiqueta, valor, { pie = "", texto = false } = {}) {
  return `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor${texto ? " texto" : ""}">${valor}</span>${pie ? `<span class="kpi-pie">${pie}</span>` : ""}</div>`;
}

/* Líneas por elección. series: [{ nombre, color, valores (por ANIOS), punteada }] */
function lineas(id, series, { formato = pct, eje = pct0, aria = "" } = {}) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  const el = document.getElementById(id);
  if (!todos.length) { el.style.height = ""; return Obs.vacio(id); }
  el.style.height = "";
  const maximo = Math.max(...todos) * 1.08;
  const pot = 10 ** Math.floor(Math.log10(maximo || 1));
  const tope = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((t) => t >= maximo) ?? 10 * pot;
  const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
  const rotular = series.length <= 4 && el.clientWidth >= 520;
  const ctx = (lineas.ctx ??= document.createElement("canvas").getContext("2d"));
  ctx.font = `700 14px ${C.fuente}`;
  const ultimo = (v) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i; return -1; };
  const derecha = 20 + Math.max(0, ...series.map((s) => { const u = ultimo(s.valores); return u < 0 ? 0 : ctx.measureText(`${s.nombre}, ${ANIOS[u]}: ${formato(s.valores[u])}`).width; }));
  // Etiquetas finales separadas al menos 18 px, para que no se encimen cuando las líneas terminan cerca
  const desplazo = new Map();
  if (rotular) {
    const arriba = 16, alto = Math.max(1, el.clientHeight - arriba - 30);
    const fin = series.map((s, i) => { const u = ultimo(s.valores); return u < 0 ? null : { i, y: arriba + alto * (1 - s.valores[u] / tope) }; })
      .filter(Boolean).sort((a, b) => a.y - b.y);
    const pos = fin.map((f) => f.y);
    for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + 18);
    fin.forEach((f, k) => desplazo.set(f.i, pos[k] - f.y));
  }
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${etqAnio(+ps[0].axisValue)}</strong>` + ps.filter((p) => p.value != null)
        .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${formato(p.value)}</strong>`).join("") },
    grid: { left: 8, right: rotular ? Math.min(derecha, el.clientWidth * 0.42) : 18, top: 16, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: ANIOS.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => eje(v) }) },
    series: series.map((s, i) => {
      const u = ultimo(s.valores);
      return {
        name: s.nombre, type: "line", connectNulls: true, symbolSize: 7,
        symbol: ["circle", "rect", "triangle", "diamond"][i % 4],
        data: s.valores.map((v, j) => (j === u && rotular ? { value: v, label: { show: true, position: "right", distance: 8, offset: [0, desplazo.get(i) ?? 0], formatter: () => `${s.nombre}, ${ANIOS[j]}: ${formato(v)}`, ...txt({ color: C.texto, fontWeight: 700 }) } } : v)),
        lineStyle: { width: 2.5, color: s.color, type: s.punteada ? [6, 4] : ["solid", [8, 4], [2, 4], [10, 3, 2, 3]][i % 4] }, itemStyle: { color: s.color }, emphasis: { focus: "series" },
        markLine: i === 0 ? { silent: true, symbol: "none", animation: false, data: [{ xAxis: String(estado.anio), lineStyle: { color: C.navy, width: 1, type: "solid", opacity: 0.35 }, label: { show: false } }] } : undefined,
      };
    }),
  }, true);
  el.setAttribute("aria-label", aria);
}

/* Columnas apiladas por elección. capas: [{ nombre, color, valores (por ANIOS) }] */
function apiladas(id, capas, { formato = n0, aria = "", cien = false } = {}) {
  const el = document.getElementById(id);
  let vivas = capas.filter((c) => c.valores.some((v) => v));
  if (!vivas.length) return Obs.vacio(id);
  const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
  const totales = ANIOS.map((_, i) => vivas.reduce((s, c) => s + (c.valores[i] || 0), 0));
  const cuentas = vivas;
  if (cien) vivas = vivas.map((c) => ({ ...c, valores: c.valores.map((v, i) => (totales[i] ? (v || 0) / totales[i] : 0)) }));
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${etqAnio(+ps[0].axisValue)}</strong>` + ps.filter((p) => p.value).map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${cien ? `${pct0(p.value)} (${n0(cuentas[p.seriesIndex].valores[p.dataIndex])})` : formato(p.value)}</strong>`).join("") +
        `<br>Total: <strong>${n0(totales[ps[0].dataIndex])}</strong>` },
    grid: { left: 8, right: 12, top: 24, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: ANIOS.map(String), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "value", max: cien ? 1 : null, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => (cien ? pct0(v) : n0(v)) }) },
    series: vivas.map((c, k) => ({
      name: c.nombre, type: "bar", stack: "t", barMaxWidth: 44, itemStyle: { color: c.color, opacity: 1 },
      data: c.valores.map((v, i) => ({ value: v || 0, itemStyle: { opacity: cien || ANIOS[i] === estado.anio ? 1 : 0.55 } })),
      label: cien ? { show: el.clientWidth >= 520, position: "inside", formatter: (p) => (p.value >= 0.12 ? pct0(p.value) : ""), color: "#fff", fontFamily: C.fuente, fontSize: 13, fontWeight: 700 }
        : k === vivas.length - 1 ? { show: true, position: "top", formatter: (p) => n0(totales[p.dataIndex]), ...txt({ color: C.texto, fontWeight: 700 }) } : undefined,
    })),
  }, true);
  el.setAttribute("aria-label", aria);
}

/* Tabla ordenable con buscador. columnas: [{ clave, titulo, num, valor(f), html(f) }] */
function tablaOrdenable(id, columnas, datosTabla, { inicial, claveFila, elegida = null, alClic = null, descripcion, buscar = null }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const cmp = (a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || x === "" || y == null || y === "") return (x == null || x === "") - (y == null || y === "");
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  };
  const datos = [...datosTabla].sort(cmp);
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    return `<th class="${c.num ? "num" : ""}" aria-sort="${activo ? (orden.dir === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = claveFila(f);
    return `<tr tabindex="0" data-k="${Obs.escapar(String(k))}" data-texto="${Obs.escapar(columnas.filter((c) => !c.num).map((c) => String(c.valor(f) ?? "")).join(" ").toLowerCase())}"${k === elegida ? ' class="elegida"' : ""}>` +
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
    tablaOrdenable(id, columnas, datosTabla, { inicial, claveFila, elegida, alClic, descripcion, buscar });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
  if (alClic) {
    el.querySelector("tbody").onclick = (e) => { const r = e.target.closest("tr[data-k]"); if (r) alClic(r.dataset.k); };
    el.querySelector("tbody").onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) alClic(e.target.dataset.k); };
  }
}

/* ---------------------------------------------------------
   Mapas: uno por pestaña y nivel (cada nivel tiene su propio mapa)
   valores: Map(ubigeo -> valor); color(valor); texto(valor)
   --------------------------------------------------------- */
const claveGeo = (u, nivel) => (nivel === "regional" ? DEP_GEO[u] : u);
/* Geo de un nivel, solo con la región elegida (si hay una): así no se confunde con las vecinas */
const GEO_FILTRADO = new Map();
function geoDe(nivel, region) {
  const k = `${nivel}|${region}`;
  if (!GEO_FILTRADO.has(k)) {
    const base = GEO[nivel];
    const enRegion = (f) => (nivel === "regional" ? f.properties.region === DEP_GEO[region] : String(f.properties.region).startsWith(region));
    GEO_FILTRADO.set(k, region === PE ? base : { ...base, features: base.features.filter((f) => f.properties.tipo === "region" && enRegion(f)) });
  }
  return GEO_FILTRADO.get(k);
}
/* Límites más marcados, en blanco, encima del mapa: regiones (en provincias y distritos) y provincias (en distritos) */
function agregarLimites(mapa, nivel, region) {
  const capas = [];
  const filtrar = (geo, prefijo) => geo.features.filter((f) => f.properties.tipo === "region" && (region === PE || prefijo(f)));
  if (nivel !== "regional") capas.push([filtrar(GEO.regional, (f) => GEO_DEP[f.properties.region] === region || (region === "15" && f.properties.region.startsWith("LIMA"))), 1.6]);
  if (nivel === "distrital") capas.push([filtrar(GEO.provincial, (f) => String(f.properties.region).startsWith(region)), 1.0]);
  for (const lm of [mapa.principal, mapa.lima]) {
    if (!lm.getPane("limites")) { const pane = lm.createPane("limites"); pane.style.zIndex = 450; pane.style.pointerEvents = "none"; }
    for (const [features, peso] of capas) {
      L.geoJSON({ type: "FeatureCollection", features }, { pane: "limites", interactive: false, style: { fill: false, color: "#ffffff", weight: peso, opacity: 1 } }).addTo(lm);
    }
  }
}
function pintarMapaGeo(m, { valores, color, texto }) {
  const nivel = estado.nivel, region = estado.region, caja = document.getElementById(`mapa-${m}`);
  const clave = `${nivel}-${region}`;
  caja.querySelectorAll(":scope > .mapa-nivel").forEach((d) => (d.hidden = d.dataset.clave !== clave));
  let div = caja.querySelector(`.mapa-nivel[data-clave="${clave}"]`);
  if (!div) {
    div = document.createElement("div");
    div.className = "mapa-nivel"; div.dataset.clave = clave; div.id = `mapa-${m}-${clave}`;
    caja.append(div);
  }
  const k = `${m}-${clave}`;
  if (!mapas[k]) {
    mapas[k] = new Obs.Mapa(div.id, geoDe(nivel, region), {
      alClic: (g) => elegirLugar(nivel === "regional" ? GEO_DEP[g] : g),
      nombre: (g) => (nivel === "regional" ? (g === "LIMA METROPOLITANA" ? "Lima Metropolitana" : nombreRegion(GEO_DEP[g])) : nombreLugar(g)),
      // Límites entre provincias o distritos más suaves; los de regiones (y provincias en el mapa distrital) van en blanco encima
      borde: nivel === "regional" ? "#ffffff" : "#d9dee5",
    });
    agregarLimites(mapas[k], nivel, region);
  }
  const v = new Map([...valores].map(([u, x]) => [claveGeo(u, nivel), x]));
  // Capitales de provincia en el mapa distrital: no eligen alcalde distrital (gris, con su propio texto)
  const CAPITAL = "capital";
  if (nivel === "distrital") geoDe(nivel, region).features.forEach((f) => { const c = f.properties.region; if (f.properties.tipo === "region" && c.endsWith("01") && !v.has(c)) v.set(c, CAPITAL); });
  const colorF = (x) => (x === CAPITAL ? "#ccd3dd" : color(x));
  const textoF = (x) => (x === CAPITAL ? "Capital de provincia: no elige alcalde distrital" : texto(x));
  document.getElementById(`leymapa-${m}`).innerHTML = nivel === "distrital"
    ? '<span><i style="background:#ccd3dd"></i>Capital de provincia: no elige alcalde distrital (la gobierna la municipalidad provincial)</span>' : "";
  const elegida = nivel === "regional" ? null : estado.lugar;
  // Con una región elegida, el mapa no vuelve a mostrar todo el Perú al repintarse
  const M = mapas[k], fb = M.principal.fitBounds;
  if (region !== PE) M.principal.fitBounds = () => M.principal;
  M.pintar({ valores: v, color: colorF, texto: textoF, elegida });
  M.principal.fitBounds = fb;
  // Con una región elegida, el mapa muestra solo esa región y se acerca a ella
  const recuadro = div.querySelector(".recuadro-lima");
  if (recuadro) recuadro.hidden = region !== PE;
  if (region !== PE) {
    const capas = [];
    mapas[k].principal.capaRegiones.eachLayer((c) => capas.push(c));
    // Regiones chicas (Callao) necesitan más acercamiento que el máximo del mapa del Perú
    mapas[k].principal.setMaxZoom(12);
    if (capas.length) mapas[k].principal.fitBounds(L.featureGroup(capas).getBounds(), { padding: [16, 16], animate: false });
  }
  return mapas[k];
}
const htmlMapa = (m) => `<div class="mapa-solo"><div id="mapa-${m}"></div><p class="ley-cat" id="leymapa-${m}"></p></div>`;

/* ---------------------------------------------------------
   Pestaña Resumen
   --------------------------------------------------------- */
function pintarResumenKpis() {
  const a = estado.anio, ag = agregado(filas()), c = cuotaTipos(a), o = ofertaDe(a);
  const mov = c ? c.cuota("Movimiento regional") : null;
  document.getElementById("k-resumen").innerHTML =
    kpi("Electores", cuenta(ag?.electores), { pie: `${{ regional: "elección regional", provincial: "elección provincial", distrital: "elección distrital" }[estado.nivel]}, ${estado.region === PE ? "todo el Perú" : nombreRegion(estado.region)}` }) +
    kpi("Participación", pct(ag?.participacion), { pie: "votos emitidos entre electores" }) +
    kpi("Listas en competencia", n0(o?.listas ?? ag?.listas), { pie: `en ${n0(ag?.lugares)} ${ag?.lugares === 1 ? LUGAR[estado.nivel] : LUGAR[estado.nivel] === "región" ? "regiones" : LUGAR[estado.nivel] + "s"}` }) +
    kpi("Ganados por movimientos regionales", pct0(mov), { pie: c ? `${n0(c.n("Movimiento regional"))} de ${n0(c.total)} ${GOBIERNO[estado.nivel]}` : "" });
}

function pintarMapaGanador(m, id) {
  const gs = ganadores();
  // El mapa muestra todo el Perú (con una región elegida, se resalta o se acerca a ella)
  const valores = new Map(ganadores(estado.anio, estado.nivel, PE).map((g) => [g.ubigeo, g]));
  const tipos = [...new Set(gs.map((g) => g.tipo))].sort((x, y) => TIPOS.indexOf(x) - TIPOS.indexOf(y));
  leyendaTipos(`ley-${id}`, tipos);
  pintarMapaGeo(m, { valores, color: (g) => colorTipo(g.tipo), texto: (g) => (g.tipo === PENDIENTE ? PENDIENTE : `${Obs.escapar(titulo(g.org))}<br>${Obs.escapar(g.tipo)}`) });
  return gs;
}

function pintarReparto(gs) {
  const el = document.getElementById("reparto"), total = gs.length;
  const cuenta = TIPOS.concat(PENDIENTE).map((t) => ({ t, n: gs.filter((g) => g.tipo === t).length })).filter((x) => x.n);
  el.innerHTML = total ? `<p class="reparto-total"><strong>${n0(total)}</strong> ${GOBIERNO[estado.nivel]} ${enRegion(estado.region)}</p>` +
    `<div class="reparto-barra" role="img" aria-label="${cuenta.map((x) => `${x.t}: ${x.n}`).join(", ")}">${cuenta.map((x) =>
      `<span class="${x.t === PENDIENTE ? "rayado" : ""}" style="flex:${x.n};background:${colorTipo(x.t)}"></span>`).join("")}</div>` +
    `<ul class="reparto-lista">${cuenta.map((x) => `<li><i class="${x.t === PENDIENTE ? "rayado" : ""}" style="background:${colorTipo(x.t)}"></i><span>${Obs.escapar(x.t)}</span><strong>${n0(x.n)}</strong><em>${pct0(x.n / total)}</em></li>`).join("")}</ul>` : "";
}

function pintarGanadorTipo() {
  const id = "ganador-tipo", gs = pintarMapaGanador("resumen", id), c = cuotaTipos(estado.anio);
  const pend = gs.filter((g) => g.tipo === PENDIENTE).length;
  pintarReparto(gs);
  if (!c) { lectura(id, ""); return; }
  const orden = TIPOS.filter((t) => c.n(t)).sort((x, y) => c.n(y) - c.n(x));
  lectura(id, `${EnRegion(estado.region)}, en ${ELECCION[estado.nivel]} de ${etqAnio(estado.anio)}, ${orden.map((t, i) => `${i === orden.length - 1 && i ? "y " : ""}${destacar(PLURAL[t])} ganaron ${destacar(`${n0(c.n(t))}`)} (${pct0(c.cuota(t))})`).join(", ")} de ${n0(c.total)} ${GOBIERNO[estado.nivel]}` +
    (pend ? `. En ${destacar(n0(pend))} regiones falta la segunda vuelta` : "") + ".");
  nota(id, estado.nivel === "regional" ? "Ganador final: en las regiones con segunda vuelta, quien la ganó (fuente provisional: Wikipedia). Lima Metropolitana no elige gobernador." :
    "Las capitales de provincia no tienen alcalde distrital: las gobierna la municipalidad provincial (en gris en el mapa de distritos).");
}

function pintarEvolTipos() {
  const id = "evol-tipos";
  const series = TIPOS.map((t, i) => ({ nombre: PLURAL[t].charAt(0).toUpperCase() + PLURAL[t].slice(1),
    color: C.categorias[i], valores: ANIOS.map((a) => { const c = cuotaTipos(a); return c ? c.cuota(t) : null; }) }))
    .filter((s) => s.valores.some((v) => v));
  apiladas(`g-${id}`, TIPOS.map((t, i) => ({ nombre: t, color: C.categorias[i], valores: ANIOS.map((a) => cuotaTipos(a)?.n(t) ?? 0) })),
    { cien: true, aria: `Porcentaje de ${GOBIERNO[estado.nivel]} ganados por tipo de organización, por elección, ${enRegion(estado.region)}` });
  leyendaTipos(`ley-${id}`, series.map((s) => TIPOS[C.categorias.indexOf(s.color)]));
  const p = (a, t) => cuotaTipos(a)?.cuota(t);
  const a0 = ANIOS.find((a) => p(a, "Movimiento regional") != null), a1 = estado.anio;
  if (a0 != null && p(a1, "Movimiento regional") != null) {
    lectura(id, `Los movimientos regionales ganaron el ${destacar(pct0(p(a0, "Movimiento regional")))} de los ${GOBIERNO[estado.nivel]} en ${a0} y el ${destacar(pct0(p(a1, "Movimiento regional")))} en ${etqAnio(a1)}; los partidos políticos, el ${destacar(pct0(p(a0, "Partido político")))} y el ${destacar(pct0(p(a1, "Partido político")))}.`);
  }
  nota(id, "Porcentaje sobre los gobiernos con ganador conocido. En las regiones donde falta la segunda vuelta, todavía no se cuentan.");
}

function pintarTopOrganizaciones(id = "top-org", limite = 10) {
  const gs = ganadores().filter((g) => g.org);
  const m = new Map();
  gs.forEach((g) => { const x = m.get(g.org) ?? { n: 0, tipo: g.tipo }; x.n++; m.set(g.org, x); });
  const items = [...m].map(([org, x]) => ({ clave: org, etiqueta: titulo(org), valor: x.n, color: colorTipo(x.tipo), detalle: x.tipo }));
  const total = gs.length;
  Obs.barras(`g-${id}`, items, { formato: n0, limite, detalle: (d) => d.detalle });
  document.getElementById(`g-${id}`).setAttribute("aria-label", `Organizaciones que más ${GOBIERNO[estado.nivel]} ganaron, ${enRegion(estado.region)}, ${estado.anio}`);
  const top = items.sort((x, y) => y.valor - x.valor)[0];
  lectura(id, top ? `${destacar(Obs.escapar(top.etiqueta))} ganó ${destacar(n0(top.valor))} de ${n0(total)} ${GOBIERNO[estado.nivel]} ${enRegion(estado.region)} en ${etqAnio(estado.anio)}.` : "");
  leyendaTipos(`ley-${id}`, [...new Set(items.slice(0, limite).map((d) => d.detalle))]);
}

/* ---------------------------------------------------------
   Pestaña Resultados
   --------------------------------------------------------- */
const IND_RES = {
  ganador: { corto: "Ganador por tipo" },
  margen: { corto: "Diferencia con el segundo", valor: (f) => f.margen, formato: pts },
  nep: { corto: "Número efectivo de partidos", valor: (f) => f.nep, formato: n1 },
};
function pintarMapaResultados() {
  const id = "mapa-res", card = document.getElementById(`c-${id}`), k = estado.mapa.resultados;
  $("[data-mapa-res]", card).innerHTML = botones(Object.entries(IND_RES).map(([valor, x]) => ({ valor, etiqueta: x.corto })), k);
  if (k === "ganador") { pintarMapaGanador("resultados", id); lectura(id, "Haz clic en un lugar para ver su votación abajo."); return; }
  const I = IND_RES[k], ok = (f) => !f.anulada && I.valor(f) !== "" && I.valor(f) != null, fs = filas().filter(ok);
  const valores = new Map(filas(estado.anio, estado.nivel, PE).filter(ok).map((f) => [f.ubigeo, +I.valor(f)]));
  const rango = Obs.rango(valores.values());
  document.getElementById(`ley-${id}`).innerHTML = "";
  const mapa = pintarMapaGeo("resultados", { valores, color: (v) => Obs.colorContinuo(v, rango, C.escala), texto: (v) => I.formato(v) });
  Obs.leyendaContinua(`ley-${id}`, rango, C.escala, I.formato, mapa);
  const orden = [...fs].sort((x, y) => I.valor(y) - I.valor(x));
  const nom = (f) => (estado.nivel === "regional" ? nombreRegion(f.dep) : nombreLugar(f.ubigeo));
  if (orden.length === 1) lectura(id, `${I.corto} en ${ELECCION[estado.nivel]} de ${etqAnio(estado.anio)}: ${destacar(Obs.escapar(nom(orden[0])))}, ${I.formato(+I.valor(orden[0]))}.`);
  else if (orden.length) lectura(id, `${I.corto} en ${ELECCION[estado.nivel]} de ${etqAnio(estado.anio)}: el valor más alto está en ${destacar(Obs.escapar(nom(orden[0])))} (${I.formato(+I.valor(orden[0]))}) y el más bajo en ${destacar(Obs.escapar(nom(orden.at(-1))))} (${I.formato(+I.valor(orden.at(-1)))}).`);
}

function lugarElegido() {
  const fs = filas();
  if (estado.lugar) { const f = fs.find((x) => x.ubigeo === estado.lugar); if (f) return f; }
  if (estado.nivel === "regional" && estado.region !== PE) return fs[0] ?? null;
  return null;
}

function pintarDetalle() {
  const id = "detalle", f = lugarElegido(), card = document.getElementById(`c-${id}`);
  const h3 = $("h3", card), desc = $("header p", card), ficha = document.getElementById("ficha");
  if (!f) {
    h3.textContent = `¿Qué organizaciones ganaron más ${GOBIERNO[estado.nivel]}?`;
    desc.textContent = `Número de ${GOBIERNO[estado.nivel]} que ganó cada organización ${enRegion(estado.region)}, en la elección elegida (las 9 primeras). Haz clic en un lugar del mapa o de la tabla para ver su votación.`;
    ficha.innerHTML = "";
    nota(id, "");
    return pintarTopOrganizaciones(id, 9);
  }
  const nombreF = estado.nivel === "regional" ? nombreRegion(f.dep) : nombreLugar(f.ubigeo);
  h3.textContent = `¿Cómo votó ${nombreF}?`;
  desc.textContent = `Porcentaje de los votos válidos de cada organización en ${etqAnio(estado.anio)}${estado.nivel === "regional" ? " (primera vuelta)" : ""}.`;
  document.getElementById(`ley-${id}`).innerHTML = "";
  const g = estado.nivel === "regional" ? GOB.find((x) => x.anio === estado.anio && x.ubigeo === f.ubigeo) : null;
  let final = "";
  if (g) {
    final = g.ganador_fue === "pendiente" ? `Segunda vuelta pendiente entre ${titulo(g.primero)} y ${titulo(g.segundo)}` :
      g.ganador_fue === "segundo" ? `${titulo(g.ganador)} (ganó la segunda vuelta; fue segundo en la primera)` : g.segunda_vuelta ? `${titulo(g.ganador)} (ganó la segunda vuelta; fue primero en la primera)` : titulo(g.ganador);
  }
  ficha.innerHTML = f.anulada ? `<div><span>Elección</span><strong>Anulada o sin datos</strong></div>` :
    `<div><span>${g ? "Ganador final" : "Ganador"}</span><strong>${Obs.escapar(final || titulo(f.primero))}</strong></div>` +
    `<div><span>Diferencia con el segundo</span><strong>${pts(f.margen)}</strong></div>` +
    `<div><span>Participación · listas</span><strong>${pct(f.participacion)} · ${n0(f.listas)}</strong></div>`;
  let items;
  if (estado.nivel === "distrital") {
    items = [["primero", "tipo_primero", "votos_primero"], ["segundo", "tipo_segundo", "votos_segundo"]].filter(([o]) => f[o])
      .map(([o, t, v]) => ({ clave: f[o], etiqueta: titulo(f[o]), valor: f.validos ? f[v] / f.validos : null, color: colorTipo(f[t]), detalle: `${n0(f[v])} votos · ${f[t]}` }));
  } else {
    items = ORG.filter((o) => o.anio === estado.anio && o.nivel === estado.nivel && o.ubigeo === f.ubigeo)
      .map((o) => ({ clave: o.organizacion, etiqueta: titulo(o.organizacion), valor: f.validos ? o.votos / f.validos : null, color: colorTipo(o.tipo), detalle: `${n0(o.votos)} votos · ${o.tipo}${o.tipo_estimado === true ? " (estimado)" : ""}` }));
  }
  Obs.barras(`g-${id}`, items, { formato: pct, limite: 12, detalle: (d) => d.detalle });
  leyendaTipos(`ley-${id}`, [...new Set(items.slice(0, 12).map((d) => d.detalle.split(" · ")[1].replace(" (estimado)", "")))]);
  lectura(id, f.anulada ? "" : `${destacar(Obs.escapar(titulo(f.primero)))} sacó el ${destacar(pct(f.pct_primero))} de los votos válidos` +
    (f.segundo ? `, frente al ${pct(f.pct_segundo)} de ${Obs.escapar(titulo(f.segundo))}` : "") + ".");
  nota(id, estado.nivel === "distrital" ? "En los distritos solo se muestran las dos organizaciones más votadas." :
    f.actas_pct < 100 ? `Conteo al ${n1(f.actas_pct)} % de actas.` : "");
}

function pintarTablaResultados() {
  const id = "tabla-res", fs = filas();
  const card = document.getElementById(`c-${id}`);
  // Solo con todo el Perú: con una región elegida, lo mismo ya está en el mapa y la votación de arriba
  card.hidden = estado.region !== PE;
  if (card.hidden) return;
  if (estado.nivel === "regional") {
    $("h3", card).textContent = "¿Quién gobierna cada región?";
    $("header p", card).textContent = "Ganador final de cada región, su votación en primera vuelta y si su partido ya gobernaba la región.";
    const gs = GOB.filter((g) => g.anio === estado.anio);
    const fue = (g) => (g.ganador_fue === "pendiente" ? "Pendiente" : !g.segunda_vuelta ? "No hubo" : g.ganador_fue === "segundo" ? "Ganó el 2.º de la 1.ª vuelta" : "Ganó el 1.º de la 1.ª vuelta");
    tablaOrdenable(`g-${id}`, [
      { clave: "region", titulo: "Región", valor: (g) => nombreRegion(g.ubigeo), html: (g) => Obs.escapar(nombreRegion(g.ubigeo)) },
      { clave: "electo", titulo: "Gobernador electo", valor: (g) => g.electo || "", html: (g) => Obs.escapar(g.electo || "—") },
      { clave: "ganador", titulo: "Organización ganadora", valor: (g) => titulo(g.ganador), html: (g) => (g.ganador_fue === "pendiente" ? "Segunda vuelta pendiente" : Obs.escapar(titulo(g.ganador))) },
      { clave: "tipo", titulo: "Tipo de organización", valor: (g) => (g.ganador_fue === "pendiente" ? "" : g.tipo_ganador), html: (g) => (g.ganador_fue === "pendiente" ? "—" : pill(g.tipo_ganador)) },
      { clave: "p1", titulo: "% en 1.ª vuelta", num: true, valor: (g) => +(g.ganador_fue === "segundo" ? g.pct_segundo : g.pct_primero), html: (g) => (g.ganador_fue === "pendiente" ? `${pct(g.pct_primero)} (1.º)` : pct(+(g.ganador_fue === "segundo" ? g.pct_segundo : g.pct_primero))) },
      { clave: "sv", titulo: "Segunda vuelta", valor: fue, html: (g) => fue(g) },
      { clave: "repite", titulo: "¿Mismo partido que antes?", valor: (g) => g.repite_partido, html: (g) => (g.repite_partido ? (g.repite_partido === "sí" ? "Sí" : "No") : "—") },
    ], gs, { inicial: { clave: "region", dir: 1 }, claveFila: (g) => g.ubigeo, elegida: estado.region, alClic: (u) => elegirLugar(u), buscar: "Región u organización", descripcion: `Gobernadores electos, ${estado.anio}` });
    lectura(id, (() => {
      const rem = gs.filter((g) => g.ganador_fue === "segundo").length, rep = gs.filter((g) => g.repite_partido === "sí").length, conDato = gs.filter((g) => g.repite_partido).length;
      return `En ${etqAnio(estado.anio)}, ${destacar(n0(rem))} gobernadores ganaron la segunda vuelta tras quedar segundos en la primera` + (conDato ? ` y en ${destacar(`${n0(rep)} de ${n0(conDato)}`)} regiones ganó el mismo partido que gobernaba.` : ".");
    })());
    nota(id, "Ganador final y gobernador anterior: fuente provisional, Wikipedia. «¿Mismo partido que antes?» compara los nombres de las organizaciones.");
    return;
  }
  $("h3", card).textContent = `¿Quién ganó en cada ${LUGAR[estado.nivel]}?`;
  $("header p", card).textContent = `Organización ganadora, su porcentaje de votos válidos y la diferencia con el segundo, ${enRegion(estado.region)}.`;
  tablaOrdenable(`g-${id}`, [
    { clave: "lugar", titulo: titulo(LUGAR[estado.nivel]), valor: (f) => nombreLugar(f.ubigeo), html: (f) => Obs.escapar(nombreLugar(f.ubigeo)) + (estado.region === PE ? `<br><small>${Obs.escapar(nombreRegion(f.dep))}</small>` : "") },
    { clave: "ganador", titulo: "Organización ganadora", valor: (f) => titulo(f.primero), html: (f) => (f.anulada ? "Anulada o sin datos" : Obs.escapar(titulo(f.primero))) },
    { clave: "tipo", titulo: "Tipo de organización", valor: (f) => (f.anulada ? "" : f.tipo_primero), html: (f) => (f.anulada ? "—" : pill(f.tipo_primero)) },
    { clave: "p1", titulo: "% de votos", num: true, valor: (f) => (f.anulada ? null : +f.pct_primero), html: (f) => (f.anulada ? "—" : pct(f.pct_primero)) },
    { clave: "margen", titulo: "Diferencia", num: true, valor: (f) => (f.anulada ? null : +f.margen), html: (f) => (f.anulada ? "—" : pts(f.margen)) },
  ], fs, { inicial: { clave: "margen", dir: 1 }, claveFila: (f) => f.ubigeo, elegida: estado.lugar, alClic: (u) => elegirLugar(u), buscar: `Nombre ${estado.nivel === "provincial" ? "de la provincia" : "del distrito"} u organización`, descripcion: `Ganadores por ${LUGAR[estado.nivel]}, ${estado.anio}` });
  const ajustadas = fs.filter((f) => !f.anulada && f.margen !== "" && +f.margen < 0.02).length;
  lectura(id, `${EnRegion(estado.region)}, en ${destacar(n0(ajustadas))} ${LUGAR[estado.nivel] === "provincia" ? "provincias" : "distritos"} el ganador sacó menos de 2 puntos de ventaja.`);
  nota(id, "");
}

function pintarCompetencia() {
  const series = (k) => [{ nombre: nombreRegion(estado.region), color: C.categorias[0], valores: ANIOS.map((a) => agregado(filas(a))?.[k] ?? null) }]
    .concat(estado.region !== PE ? [{ nombre: "Perú", color: C.textoSuave, punteada: true, valores: ANIOS.map((a) => agregado(filas(a, estado.nivel, PE))?.[k] ?? null) }] : []);
  lineas("g-margen", series("margen"), { formato: pts, eje: (v) => `${Obs.fmtN(v * 100, 0)} pts`, aria: "Diferencia promedio entre el primero y el segundo, por elección" });
  lineas("g-nep", series("nep"), { formato: n1, eje: n1, aria: "Número efectivo de partidos promedio, por elección" });
  const a = estado.anio, x = agregado(filas());
  if (x) {
    lectura("margen", `En ${etqAnio(a)}, el ganador le sacó en promedio ${destacar(`${Obs.fmtN(x.margen * 100, 1)} puntos`)} al segundo.`);
    lectura("nep", `En promedio, el voto se repartió como entre ${destacar(n1(x.nep))} organizaciones de igual tamaño.`);
  }
  nota("margen", `Promedio simple de ${{ regional: "las regiones: cada una", provincial: "las provincias: cada una", distrital: "los distritos: cada uno" }[estado.nivel]} pesa igual. Puntos porcentuales de los votos válidos. En la elección regional, primera vuelta.`);
  nota("nep", `Si sale 2, el voto se concentró en dos organizaciones; si sale 6, se repartió entre muchas. Se calcula en cada lugar y se saca el promedio simple: cada ${LUGAR[estado.nivel]} pesa igual.`);
}

/* ---------------------------------------------------------
   Pestaña Participación
   --------------------------------------------------------- */
const IND_PAR = {
  participacion: { corto: "Participación", valor: (f) => f.participacion, formato: pct },
  invalidos: { corto: "Votos en blanco y nulos", valor: (f) => (f.emitidos ? (f.blancos + f.nulos) / f.emitidos : null), formato: pct },
};
function pintarParticipacionKpis() {
  const ag = agregado(filas());
  document.getElementById("k-participacion").innerHTML =
    kpi("Electores", cuenta(ag?.electores), { pie: `electores hábiles, elección ${{ regional: "regional", provincial: "provincial", distrital: "distrital" }[estado.nivel]}` }) +
    kpi("Votantes", cuenta(ag?.emitidos), { pie: "votos emitidos" }) +
    kpi("Participación", pct(ag?.participacion), { pie: `ausentismo: ${pct(ag ? 1 - ag.participacion : null)}` }) +
    kpi("Votos en blanco y nulos", pct(ag?.invalidos), { pie: `blancos ${pct(ag?.blancos)} · nulos ${pct(ag?.nulos)}` });
}
function pintarMapaParticipacion() {
  const id = "mapa-par", card = document.getElementById(`c-${id}`), k = estado.mapa.participacion, I = IND_PAR[k];
  $("[data-mapa-par]", card).innerHTML = botones(Object.entries(IND_PAR).map(([valor, x]) => ({ valor, etiqueta: x.corto })), k);
  const ok = (f) => !f.anulada && I.valor(f) != null && I.valor(f) !== "", fs = filas().filter(ok);
  const valores = new Map(filas(estado.anio, estado.nivel, PE).filter(ok).map((f) => [f.ubigeo, +I.valor(f)]));
  const rango = Obs.rango(valores.values());
  const mapa = pintarMapaGeo("participacion", { valores, color: (v) => Obs.colorContinuo(v, rango, C.escala), texto: (v) => I.formato(v) });
  Obs.leyendaContinua(`ley-${id}`, rango, C.escala, I.formato, mapa);
  const orden = [...fs].sort((x, y) => I.valor(y) - I.valor(x));
  const nom = (f) => (estado.nivel === "regional" ? nombreRegion(f.dep) : nombreLugar(f.ubigeo));
  if (orden.length === 1) lectura(id, `${I.corto} en ${ELECCION[estado.nivel]} de ${etqAnio(estado.anio)}: ${destacar(Obs.escapar(nom(orden[0])))}, ${I.formato(+I.valor(orden[0]))}.`);
  else if (orden.length) lectura(id, `${I.corto} en ${ELECCION[estado.nivel]} de ${etqAnio(estado.anio)}: la más alta fue en ${destacar(Obs.escapar(nom(orden[0])))} (${I.formato(+I.valor(orden[0]))}) y la más baja en ${destacar(Obs.escapar(nom(orden.at(-1))))} (${I.formato(+I.valor(orden.at(-1)))}).`);
  nota(id, estado.anio === ANIO_PARCIAL() ? "Mientras el conteo no llegue al 100 %, la participación se calcula sobre las actas contabilizadas." : "");
}
function pintarRankingParticipacion() {
  const id = "ranking-par", I = IND_PAR[estado.mapa.participacion], card = document.getElementById(`c-${id}`);
  let items;
  if (estado.region === PE) {
    // Por departamento: suma de los lugares del nivel elegido
    items = Object.keys(DEPS).map((d) => {
      const ag = agregado(filas(estado.anio, estado.nivel, d));
      return ag && { clave: d, etiqueta: nombreRegion(d), valor: estado.mapa.participacion === "participacion" ? ag.participacion : ag.invalidos };
    }).filter(Boolean);
    $("h3", card).textContent = `${I.corto} por región`;
    $("header p", card).textContent = `Cada región ordenada de mayor a menor, en ${etqAnio(estado.anio)}. Haz clic en una para elegirla.`;
  } else {
    items = filas().filter((f) => !f.anulada).map((f) => ({ clave: f.ubigeo, etiqueta: estado.nivel === "regional" ? nombreRegion(f.dep) : nombreLugar(f.ubigeo), valor: +I.valor(f) }));
    $("h3", card).textContent = `${I.corto} en ${nombreRegion(estado.region)}`;
    $("header p", card).textContent = estado.nivel === "regional" ? "Valor de la región en la elección elegida." : `Cada ${LUGAR[estado.nivel]}, de mayor a menor.`;
  }
  const peru = agregado(filas(estado.anio, estado.nivel, PE));
  const ref = peru && (estado.mapa.participacion === "participacion" ? peru.participacion : peru.invalidos);
  Obs.barras(`g-${id}`, items.map((d) => ({ ...d, color: C.unica })), { formato: pct, limite: estado.region === PE ? 25 : 40, alto: window.innerWidth > 1100 ? 640 : null, compacto: true,
    alClic: (k) => (estado.region === PE ? actualizar({ region: k, lugar: null }) : elegirLugar(k)),
    seleccion: estado.lugar ? new Set([estado.lugar]) : null });
  document.getElementById(`g-${id}`).setAttribute("aria-label", `${I.corto} por lugar, ${estado.anio}`);
  lectura(id, ref != null ? `Perú: ${destacar(pct(ref))}.` : "");
  nota(id, items.length > 25 ? `Son ${items.length}: desliza la lista para ver todas.` : "");
}

function pintarEvolParticipacion() {
  const ser = (fn) => [{ nombre: nombreRegion(estado.region), color: C.categorias[0], valores: ANIOS.map((a) => fn(agregado(filas(a)))) }]
    .concat(estado.region !== PE ? [{ nombre: "Perú", color: C.textoSuave, punteada: true, valores: ANIOS.map((a) => fn(agregado(filas(a, estado.nivel, PE)))) }] : []);
  lineas("g-evol-par", ser((x) => x?.participacion ?? null), { aria: "Participación por elección" });
  lineas("g-evol-inv", [
    { nombre: "Blancos", color: C.categorias[4], valores: ANIOS.map((a) => agregado(filas(a))?.blancos ?? null) },
    { nombre: "Nulos", color: C.categorias[1], valores: ANIOS.map((a) => agregado(filas(a))?.nulos ?? null) },
  ], { aria: "Votos en blanco y nulos por elección" });
  const p = (a) => agregado(filas(a))?.participacion;
  const a0 = ANIOS[0], a1 = estado.anio;
  if (p(a0) != null && p(a1) != null) lectura("evol-par", `${EnRegion(estado.region)}, la participación pasó de ${destacar(pct(p(a0)))} en ${a0} a ${destacar(pct(p(a1)))} en ${etqAnio(a1)}.`);
  const x = agregado(filas());
  if (x) lectura("evol-inv", `${EnRegion(estado.region)}, en ${etqAnio(a1)}, ${destacar(pct(x.invalidos))} de los votos fueron en blanco o nulos.`);
  nota("evol-inv", "Porcentaje de los votos emitidos.");
}

/* ---------------------------------------------------------
   Pestaña Oferta
   --------------------------------------------------------- */
function pintarOfertaKpis() {
  const o = ofertaDe(estado.anio), sinCand = !o?.candidatos;
  document.getElementById("k-oferta").innerHTML =
    kpi("Listas en competencia", n0(o?.listas), { pie: GOBIERNO[estado.nivel] }) +
    kpi("Candidatos", sinCand ? "—" : n0(o.candidatos), { pie: sinCand ? "aún no hay datos de esta elección" : estado.nivel === "regional" ? "gobernador, vice y consejeros" : "alcaldes y regidores" }) +
    kpi("Mujeres candidatas", sinCand ? "—" : pct(o.mujeres / o.candidatos), { pie: "de todos los candidatos" }) +
    kpi("Mujeres que encabezan lista", sinCand || !o.cabezas ? "—" : pct(o.cabezasMujeres / o.cabezas), { pie: estado.nivel === "regional" ? "candidatas a gobernadora" : "candidatas a alcaldesa" });
}
function pintarListas() {
  const id = "listas";
  apiladas(`g-${id}`, TIPOS.map((t, i) => ({ nombre: t, color: C.categorias[i], valores: ANIOS.map((a) => ofertaDe(a)?.porTipo(t) ?? 0) })),
    { aria: `Listas por tipo de organización, por elección, ${enRegion(estado.region)}` });
  leyendaTipos(`ley-${id}`, TIPOS.filter((t) => ANIOS.some((a) => ofertaDe(a)?.porTipo(t))));
  const x = ofertaDe(estado.anio), ag = agregado(filas());
  if (x && ag) lectura(id, `En ${etqAnio(estado.anio)} se presentaron ${destacar(n0(x.listas))} listas a ${GOBIERNO[estado.nivel]} ${enRegion(estado.region)}: ${destacar(n1(ag.listasProm))} por ${LUGAR[estado.nivel]} en promedio.`);
  nota(id, estado.anio === ANIO_PARCIAL() ? "En 2026 el tipo de organización de las listas nuevas es estimado." : "");
}
function pintarMujeres() {
  const id = "mujeres";
  const serie = (fn) => ANIOS.map((a) => { const o = ofertaDe(a); return o ? fn(o) : null; });
  const series = [{ nombre: "Encabezan lista", color: C.categorias[1], valores: serie((o) => (o.cabezas ? o.cabezasMujeres / o.cabezas : null)) }];
  if (estado.nivel !== "regional") series.unshift({ nombre: "Todas las candidaturas", color: C.categorias[0], valores: serie((o) => (o.candidatos ? o.mujeres / o.candidatos : null)) });
  lineas(`g-${id}`, series, { aria: "Porcentaje de mujeres candidatas por elección" });
  const o = ofertaDe(estado.anio);
  if (o?.cabezas) lectura(id, `En ${etqAnio(estado.anio)}, ${destacar(pct(o.cabezasMujeres / o.cabezas))} de las listas a ${GOBIERNO[estado.nivel]} ${enRegion(estado.region)} estuvieron encabezadas por una mujer` + (o.candidatos && estado.nivel !== "regional" ? `, aunque las mujeres fueron el ${destacar(pct(o.mujeres / o.candidatos))} de todos los candidatos.` : "."));
  else lectura(id, "Aún no hay datos de candidatos de esta elección.");
  nota(id, estado.nivel === "regional" ? "En la elección regional solo se muestran las candidaturas a gobernador: la lista de consejeros no está completa para todos los años." : "La cuota de género exige mujeres en las listas, pero no en el primer lugar.");
}
function pintarJovenes() {
  const id = "jovenes";
  const serie = (k) => ANIOS.map((a) => { const o = ofertaDe(a); return o && o[k] != null && o.candidatos ? o[k] / o.candidatos : null; });
  // La cuota de comunidades nativas solo rige en las listas regionales y provinciales
  const conNativos = estado.nivel !== "distrital";
  lineas(`g-${id}`, [{ nombre: "Jóvenes", color: C.categorias[2], valores: serie("jovenes") }]
    .concat(conNativos ? [{ nombre: "Nativos", color: C.categorias[3], valores: serie("nativos") }] : []),
  { aria: "Porcentaje de candidatos jóvenes y de comunidades nativas por elección" });
  const o = ofertaDe(estado.anio);
  lectura(id, o?.jovenes != null && o.candidatos ? `En ${etqAnio(estado.anio)}, el ${destacar(pct(o.jovenes / o.candidatos))} de los candidatos fue joven` + (conNativos && o.nativos != null ? ` y el ${destacar(pct(o.nativos / o.candidatos))}, de comunidades nativas.` : ".") : "No hay datos de jóvenes en esta elección.");
  nota(id, "Según las cuotas electorales que registra Infogob. No todos los años tienen estos datos." + (conNativos ? "" : " La cuota de comunidades nativas no rige en las elecciones distritales."));
}

/* ---------------------------------------------------------
   Resumen de cada pestaña y aviso del corte
   --------------------------------------------------------- */
function pintarResumen() {
  const m = estado.modulo, el = document.getElementById(`r-${m}`), ag = agregado(filas()), a = estado.anio;
  if (!ag) { el.textContent = `No hay datos de esta elección ${enRegion(estado.region)}.`; return; }
  const c = cuotaTipos(a);
  const txt = {
    resumen: `${EnRegion(estado.region)}, en ${ELECCION[estado.nivel]} de ${etqAnio(a)}, ${destacar(cuenta(ag.electores))}${ag.electores >= 1e6 ? " de" : ""} electores eligieron ${n0(ag.lugares)} ${GOBIERNO[estado.nivel]}. Votó el ${destacar(pct(ag.participacion))}` +
      (c ? ` y los partidos políticos ganaron el ${destacar(pct0(c.cuota("Partido político")))} de los gobiernos.` : "."),
    resultados: `Quién ganó en cada ${LUGAR[estado.nivel]} y por cuánto en ${ELECCION[estado.nivel]} de ${etqAnio(a)}, ${enRegion(estado.region)}.`,
    participacion: `${EnRegion(estado.region)}, en ${ELECCION[estado.nivel]} de ${etqAnio(a)}, votó el ${destacar(pct(ag.participacion))} de los electores y ${destacar(pct(ag.invalidos))} de los votos fueron en blanco o nulos.`,
    oferta: `Cuántas listas y candidatos se presentaron en ${ELECCION[estado.nivel]} ${enRegion(estado.region)}, y cuántas mujeres, jóvenes y personas de comunidades nativas.`,
  }[m];
  el.innerHTML = txt + notaNivel(a);
}
/* Quiénes no votan en cada elección, para que las cifras no se lean mal */
function notaNivel(a) {
  if (estado.nivel === "regional" && (estado.region === PE || estado.region === "15")) {
    const lm = (POR.get(`${a}|provincial`) ?? []).find((f) => f.ubigeo === "1501");
    return `<span class="nota-nivel">Lima Metropolitana no elige gobernador regional${lm?.electores ? `: sus ${cuenta(lm.electores)} de electores no se cuentan aquí` : ""}. En Lima, la elección regional es la de Lima Provincias.</span>`;
  }
  if (estado.nivel === "distrital") return `<span class="nota-nivel">Las capitales de provincia no eligen alcalde distrital: las gobierna la municipalidad provincial. Sus electores no se cuentan aquí.</span>`;
  return "";
}
function pintarAvisoCorte() {
  const el = document.getElementById("aviso-corte"), a = estado.anio;
  if (a !== ANIO_PARCIAL()) { el.hidden = true; return; }
  const fs = filas(a, estado.nivel, PE), inc = fs.filter((f) => f.actas_pct < 100).length;
  const pend = GOB.filter((g) => g.anio === a && g.ganador_fue === "pendiente").length;
  el.hidden = false;
  el.innerHTML = `${destacar(`Elecciones ${a}: resultados preliminares de la ONPE.`)} El conteo no ha terminado en ${n0(inc)} de ${n0(fs.length)} ${LUGAR[estado.nivel] === "región" ? "regiones" : LUGAR[estado.nivel] + "s"}` +
    (pend ? ` y ${n0(pend)} regiones van a segunda vuelta` : "") + ". Las cifras cambiarán.";
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  Object.assign(estado, parche);
  if ("nivel" in parche || "anio" in parche || "region" in parche) {
    if (estado.lugar && !filas().some((f) => f.ubigeo === estado.lugar)) estado.lugar = null;
  }
  render();
}
function elegirLugar(u) {
  if (!u) return;
  if (estado.nivel === "regional") return actualizar({ region: estado.region === u ? PE : u, lugar: null });
  actualizar({ lugar: estado.lugar === u ? null : u, modulo: estado.modulo === "resumen" ? "resultados" : estado.modulo });
}

function sincronizarControles() {
  $("#f-anio").value = estado.anio;
  $("#f-region").value = estado.region;
  document.querySelectorAll("#f-nivel button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.nivel === estado.nivel));
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  const lugar = estado.lugar ? ` · ${destacar(Obs.escapar(nombreLugar(estado.lugar)))} <button type="button" class="chip-limpiar" data-quitar-lugar>Quitar</button>` : "";
  document.getElementById("viendo").innerHTML = `Mostrando: ${destacar(`${NIVEL_NOMBRE[estado.nivel]}, ${nombreRegion(estado.region)}, ${etqAnio(estado.anio)}`)}${lugar}`;
}

function actualizarURL() {
  Obs.escribirURL({
    modulo: estado.modulo === "resumen" ? null : estado.modulo,
    nivel: estado.nivel === "regional" ? null : estado.nivel,
    region: estado.region === PE ? null : estado.region,
    anio: estado.anio === ANIO_DEFECTO ? null : estado.anio,
    lugar: estado.lugar,
  });
}

function render() {
  sincronizarControles();
  pintarAvisoCorte();
  pintarResumen();
  const m = estado.modulo;
  if (m === "resumen") { pintarResumenKpis(); pintarGanadorTipo(); pintarEvolTipos(); pintarTopOrganizaciones(); }
  if (m === "resultados") { pintarMapaResultados(); pintarDetalle(); pintarTablaResultados(); pintarCompetencia(); }
  if (m === "participacion") { pintarParticipacionKpis(); pintarMapaParticipacion(); pintarRankingParticipacion(); pintarEvolParticipacion(); }
  if (m === "oferta") { pintarOfertaKpis(); pintarListas(); pintarMujeres(); pintarJovenes(); }
  actualizarURL();
}

function tarjetas() {
  document.getElementById("c-resumen").innerHTML =
    tarjeta("ganador-tipo", "¿Quién gobierna cada lugar?", "Tipo de organización que ganó en cada lugar, en la elección elegida. Haz clic en un lugar para ver su votación en Resultados.")
      .replace('<div class="grafico" id="g-ganador-tipo"></div>', `<div class="mapa-lado">${htmlMapa("resumen")}<aside class="reparto" id="reparto"></aside></div>`) +
    tarjeta("evol-tipos", "Gobiernos ganados por cada tipo de organización, de 2002 a 2026", "Porcentaje de los gobiernos que ganó cada tipo de organización, en cada elección.") +
    tarjeta("top-org", "¿Qué organizaciones ganaron más gobiernos?", "Número de gobiernos que ganó cada organización en la elección elegida (las 10 primeras).");
  document.getElementById("c-resultados").innerHTML =
    tarjeta("mapa-res", "¿Quién ganó y por cuánto?", "Ganador de cada lugar, la diferencia con el segundo o cuán repartido estuvo el voto. Haz clic en un lugar para ver su votación.",
      { controles: local("mr", "Ver", '<div class="segmentado claro" data-mapa-res></div>') }).replace('<div class="grafico" id="g-mapa-res"></div>', htmlMapa("resultados"))
      .replace(/^/, '<div class="dos-col">') +
    tarjeta("detalle", "", "").replace('<p class="lectura" id="l-detalle"', '<div class="ficha" id="ficha"></div><p class="lectura" id="l-detalle"') + "</div>" +
    par(tarjeta("margen", "¿Qué tan reñidas fueron?", "Diferencia promedio entre el primero y el segundo, en puntos de los votos válidos."),
      tarjeta("nep", "¿Entre cuántas se repartió el voto?", "Número efectivo de partidos, promedio de los lugares.")) +
    tarjeta("tabla-res", "", "", { tabla: true });
  document.getElementById("c-participacion").innerHTML =
    tarjeta("mapa-par", "¿Dónde se vota más?", "Participación o votos en blanco y nulos de cada lugar, en la elección elegida.",
      { controles: local("mp", "Ver", '<div class="segmentado claro" data-mapa-par></div>') }).replace('<div class="grafico" id="g-mapa-par"></div>', htmlMapa("participacion"))
      .replace(/^/, '<div class="dos-col">') + tarjeta("ranking-par", "", "").replace('<div class="grafico" id="g-ranking-par"></div>', '<div class="desliza"><div class="grafico" id="g-ranking-par"></div></div>') + "</div>" +
    par(tarjeta("evol-par", "¿Vota más o menos gente que antes?", "Votos emitidos entre electores hábiles, en cada elección."),
      tarjeta("evol-inv", "¿Cuántos votan en blanco o nulo?", "Votos en blanco y nulos entre votos emitidos, en cada elección."));
  document.getElementById("c-oferta").innerHTML =
    tarjeta("listas", "¿Cuántas listas se presentan?", "Listas inscritas por tipo de organización, en cada elección.") +
    par(tarjeta("mujeres", "¿Cuántas mujeres postulan?", "Porcentaje de mujeres entre los candidatos, en cada elección."),
      tarjeta("jovenes", "¿Y jóvenes y nativos?", "Porcentaje de candidatos jóvenes y de comunidades nativas, en cada elección."));

  for (const m of MODULOS) {
    document.getElementById(`c-${m}`).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-valor]");
      if (!b) return;
      const g = b.parentElement;
      if (g.hasAttribute("data-mapa-res")) estado.mapa.resultados = b.dataset.valor;
      else if (g.hasAttribute("data-mapa-par")) estado.mapa.participacion = b.dataset.valor;
      else return;
      render();
    });
  }
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar(TABLERO, async () => {
  const [datos, gr, gp, gd] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson"),
    Obs.cargarJSON("../../mapas/peru_provincias.geojson"), Obs.cargarJSON("../../mapas/peru_distritos.geojson")]);
  Object.assign(GEO, { regional: gr, provincial: gp, distrital: gd });
  C = Obs.tema();
  const T = (p) => (datos.tablas[p] ? Obs.expandir(datos.tablas[p]) : []);
  const depPorNombre = Object.fromEntries(Object.entries(DEPS).map(([c, n]) => [sinTilde(n), c]));
  const num = ["electores", "emitidos", "validos", "blancos", "nulos", "listas", "votos_primero", "votos_segundo", "actas_pct", "participacion", "pct_primero", "pct_segundo", "margen", "nep"];
  LUG = T("lugares").map((f) => {
    const x = { ...f, anio: +f.anio, ubigeo: String(f.ubigeo ?? "") };
    num.forEach((k) => { x[k] = f[k] === "" || f[k] == null ? null : +f[k]; });
    x.anulada = f.anulada === true || f.anulada === "TRUE" || f.anulada === "true";
    x.segunda_vuelta = f.segunda_vuelta === true || f.segunda_vuelta === "TRUE" || f.segunda_vuelta === "true";
    x.dep = x.ubigeo ? x.ubigeo.slice(0, 2) : depPorNombre[sinTilde(String(f.region))] ?? "";
    return x;
  });
  for (const f of LUG) {
    const k = `${f.anio}|${f.nivel}`;
    if (!POR.has(k)) POR.set(k, []);
    POR.get(k).push(f);
    if (f.ubigeo && f.nivel !== "regional" && !NOMBRE_LUGAR.has(f.ubigeo)) NOMBRE_LUGAR.set(f.ubigeo, titulo(f.nivel === "provincial" ? f.provincia : f.distrito));
  }
  for (const f of gp.features) if (!NOMBRE_LUGAR.has(f.properties.region)) NOMBRE_LUGAR.set(f.properties.region, titulo(f.properties.nombre));
  for (const f of gd.features) if (!NOMBRE_LUGAR.has(f.properties.region)) NOMBRE_LUGAR.set(f.properties.region, titulo(f.properties.nombre));
  ORG = T("organizaciones").map((f) => ({ ...f, anio: +f.anio, votos: +f.votos, ubigeo: String(f.ubigeo ?? "") }));
  OF = T("oferta").map((f) => ({ ...f, anio: +f.anio, ubigeo: String(f.ubigeo ?? "") }));
  GOB = T("gobernadores").map((f) => ({ ...f, anio: +f.anio, ubigeo: String(f.ubigeo ?? ""), pct_primero: +f.pct_primero, pct_segundo: +f.pct_segundo,
    segunda_vuelta: f.segunda_vuelta === true || f.segunda_vuelta === "TRUE" || f.segunda_vuelta === "true" }));
  ANIOS = [...new Set(LUG.map((f) => f.anio))].sort((x, y) => x - y);
  ANIO_DEFECTO = ANIOS.at(-1);
  estado.anio = ANIO_DEFECTO;

  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  if (NIVELES.includes(q.get("nivel"))) estado.nivel = q.get("nivel");
  if (DEPS[q.get("region")]) estado.region = q.get("region");
  if (ANIOS.includes(+q.get("anio"))) estado.anio = +q.get("anio");
  if (q.get("lugar")) estado.lugar = q.get("lugar");

  const filtrosEl = document.getElementById("filtros");
  filtrosEl.innerHTML = `
    <div class="filtro"><label for="f-anio">Elección</label>
      <select id="f-anio" class="corto">${[...ANIOS].reverse().map((a) => `<option value="${a}">${etqAnio(a)}</option>`).join("")}</select></div>
    <div class="filtro"><span class="etiqueta" id="lbl-nivel">Tipo de elección</span>
      <div class="segmentado" id="f-nivel" role="group" aria-labelledby="lbl-nivel">${NIVELES.map((n) => `<button type="button" data-nivel="${n}">${NIVEL_BOTON[n]}</button>`).join("")}</div></div>
    <div class="filtro"><label for="f-region">Región</label>
      <select id="f-region"><option value="${PE}">Todo el Perú</option>${Object.entries(DEPS).sort((x, y) => x[1].localeCompare(y[1], "es")).map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></div>
    <p class="viendo" id="viendo" aria-live="polite"></p>`;
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value, lugar: null });
  $("#f-nivel").onclick = (e) => { const b = e.target.closest("button[data-nivel]"); if (b) actualizar({ nivel: b.dataset.nivel, lugar: null }); };
  $("#viendo").onclick = (e) => { if (e.target.closest("[data-quitar-lugar]")) actualizar({ lugar: null }); };
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
