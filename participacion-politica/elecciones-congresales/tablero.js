/* =========================================================
   Tablero de Elecciones congresales — Observatorio para la Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script, desde el Sheet «[Tableros] Elecciones congresales»,
   que llena procesos/elecciones-congresales/congreso.py. Pestañas:
     votos: anio, camara (Congreso | Senado nacional | Senado regional | Diputados), region (PE = Perú), organizacion,
            tipo (organizacion | blanco | nulo), votos
     escanos: anio, camara (Congreso | Senado | Diputados), organizacion, escanos
     electos: anio, camara, region (NACIONAL = Senado de distrito único), nombre, organizacion, votos, sexo, nota
     mujeres: anio, p_mujer_candidatas, organizaciones_candidatas, electos, mujeres_electas, p_mujer_electas

   Tres pestañas: Por elección, Histórico y Congresistas. Filtros comunes: elección, cámara (solo 2026) y región.
   Parámetros de URL: ?modulo=historico &anio=2021 &camara=senado &region=CUSCO &embed=1
   ========================================================= */

const TABLERO = "elecciones-congresales";
const MODULOS = ["eleccion", "historico", "congresistas"];
const PE = "PE";
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const REGIONES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca",
  CALLAO: "Callao", CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad",
  LAMBAYEQUE: "Lambayeque", "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto",
  "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno", "SAN MARTIN": "San Martín",
  TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali", EXTRANJERO: "Residentes en el extranjero",
};
const NOMBRE_EXTRA = { LIMA: "Lima (con Lima Provincias)", PE: "Perú", NACIONAL: "Distrito único nacional" };

const estado = { modulo: "eleccion", anio: null, camara: "Diputados", region: PE, partido: null, mapa: "ganador" };

let C, ANIOS = [], GEO, VOT = [], ESC = [], ELE = [], MUJ = [];
const mapas = {}, ORDEN = {}, BUSCAR = {};

/* ---------------------------------------------------------
   Formatos
   --------------------------------------------------------- */
const $ = (s, raiz = document) => raiz.querySelector(s);
const pct = (v) => Obs.fmtPct(v, 1);
const pct0 = (v) => (v == null ? "—" : `${Obs.fmtN(v * 100, 0)} %`);
const n0 = (v) => (v == null ? "—" : Obs.fmtN(v, 0));
const destacar = (s) => `<strong>${s}</strong>`;
const MINUS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "a", "por", "para", "con"]);
const SIGLAS = new Set(["AN", "FIA", "FREPAP", "APRA", "PPC", "UPP", "FIM", "II", "90"]);
function titulo(s) {
  return String(s ?? "").toLowerCase().split(" ").map((p, i) => (SIGLAS.has(p.toUpperCase()) ? p.toUpperCase() : i && MINUS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}
const nombreRegion = (r) => REGIONES[r] ?? NOMBRE_EXTRA[r] ?? titulo(r);
const enRegion = (r) => (r === PE ? "en el Perú" : `en ${nombreRegion(r)}`);
const EnRegion = (r) => (r === PE ? "En el Perú" : `En ${nombreRegion(r)}`);
const lectura = (id, html) => { document.getElementById(`l-${id}`).innerHTML = html; };
const nota = (id, txt) => { document.getElementById(`n-${id}`).textContent = txt; };

/* ---------------------------------------------------------
   Datos: cámara y región según la elección
   --------------------------------------------------------- */
const es2026 = (a = estado.anio) => a >= 2026;
const camaraEsc = (a = estado.anio) => (es2026(a) ? estado.camara : "Congreso");
const camaraVotos = (a = estado.anio, r = estado.region) => (!es2026(a) ? "Congreso" : estado.camara === "Diputados" ? "Diputados" : r === PE ? "Senado nacional" : "Senado regional");
const nombreCamara = (a = estado.anio) => (es2026(a) ? (estado.camara === "Senado" ? "el Senado" : "la Cámara de Diputados") : "el Congreso");
const deCamara = (a = estado.anio) => (es2026(a) ? (estado.camara === "Senado" ? "del Senado" : "de la Cámara de Diputados") : "del Congreso");
/* Región en los datos de esa elección: hasta 2006 Lima fue un solo distrito; hasta 2020 el extranjero votó con Lima */
function regionDatos(r, a = estado.anio, camaraVoto = camaraVotos(a, r)) {
  if (r === PE) return PE;
  if (a <= 2006 && (r === "LIMA METROPOLITANA" || r === "LIMA PROVINCIAS" || r === "EXTRANJERO")) return "LIMA";
  if (a <= 2020 && r === "EXTRANJERO") return "LIMA METROPOLITANA";
  if (camaraVoto === "Senado nacional" && (r === "LIMA METROPOLITANA" || r === "LIMA PROVINCIAS")) return "LIMA";
  return r;
}
function votosDe(a, r = estado.region) {
  const cam = camaraVotos(a, r), rd = regionDatos(r, a, cam);
  return VOT.filter((v) => v.anio === a && v.camara === cam && v.region === rd);
}
function resumenVotos(a, r = estado.region) {
  const vs = votosDe(a, r);
  if (!vs.length) return null;
  const org = vs.filter((v) => v.tipo === "organizacion" && v.votos > 0).sort((x, y) => y.votos - x.votos);
  const validos = org.reduce((s, v) => s + v.votos, 0), total = vs.reduce((s, v) => s + v.votos, 0);
  const b = vs.filter((v) => v.tipo === "blanco").reduce((s, v) => s + v.votos, 0), n = vs.filter((v) => v.tipo === "nulo").reduce((s, v) => s + v.votos, 0);
  return { org, validos, total, blancos: b / total, nulos: n / total, invalidos: (b + n) / total, listas: org.length };
}
const escanosDe = (a) => ESC.filter((e) => e.anio === a && e.camara === camaraEsc(a));
/* Congresistas de la elección; con región, los de su distrito (el Senado nacional no tiene región) */
function electosDe(a, r = estado.region) {
  const es = ELE.filter((e) => e.anio === a && e.camara === camaraEsc(a));
  if (r === PE) return es;
  const rd = regionDatos(r, a, "Congreso");
  return es.filter((e) => e.region === rd);
}

/* Colores fijos de los partidos principales: los de cada partido según sus logos (Wikipedia).
   Avanza País va en su rosado (su azul se confunde con Somos Perú) y Acción Popular en gris muy oscuro. */
const COLOR_PARTIDO = [
  [/FUERZA (POPULAR|2011)/, "#E9511B"], [/APRISTA/, "#FF0000"], [/^ACCION POPULAR/, "#2B2B2B"], [/POPULAR CRISTIANO/, "#00924B"],
  [/UNION POR EL PERU/, "#3C40A8"], [/SOMOS PERU/, "#20488E"], [/NACIONALISTA|GANA PERU/, "#E34234"], [/FRENTE AMPLIO/, "#006400"],
  [/KAMBIO/, "#E2007A"], [/FRENTE POPULAR AGRICOLA|FREPAP/, "#283896"], [/MORADO/, "#7026A8"], [/PERU LIBRE/, "#E80000"],
  [/RENOVACION POPULAR/, "#0D76A0"], [/AVANZA PAIS/, "#E5057C"], [/JUNTOS POR EL PERU/, "#5CBE12"], [/BUEN GOBIERNO/, "#F9D502"],
  [/OBRAS/, "#2E6213"], [/AHORA NACION/, "#F80000"],
];
// Para los partidos que aún no tienen su color: tonos que no se confunden con los anteriores
const PALETA_EXTRA = ["#a16207", "#9d174d", "#4d7c0f", "#57534e", "#c2410c", "#6d28d9", "#0e7490", "#155e75"];
const sinTildes = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const colorFijo = (org) => COLOR_PARTIDO.find(([re]) => re.test(sinTildes(org)))?.[1] ?? null;
function coloresDe(a) {
  const m = new Map();
  let k = 0;
  escanosDe(a).forEach((e) => m.set(e.organizacion, colorFijo(e.organizacion) ?? PALETA_EXTRA[k++] ?? C.otros));
  return m;
}

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const botones = (lista, elegida) => lista.map((o) =>
  `<button type="button" data-valor="${Obs.escapar(o.valor)}" aria-pressed="${o.valor === elegida}">${Obs.escapar(o.etiqueta)}</button>`).join("");
const tarjeta = (id, tit, desc, { controles = "", cuerpo = null } = {}) => `<article class="tarjeta" id="c-${id}">
  <header><h3>${tit}</h3><p>${desc}</p></header>
  ${controles ? `<div class="controles">${controles}</div>` : ""}
  <p class="lectura" id="l-${id}" aria-live="polite"></p>
  <div class="ley-cat" id="ley-${id}"></div>
  ${cuerpo ?? `<div class="grafico" id="g-${id}"></div>`}
  <p class="nota-tarjeta" id="n-${id}"></p>
</article>`;
const par = (...t) => `<div class="par">${t.join("")}</div>`;
const local = (id, etiqueta, interior) => `<div class="filtro-local" role="group" aria-labelledby="lbl-${id}"><span id="lbl-${id}">${etiqueta}</span>${interior}</div>`;
function kpi(etiqueta, valor, { pie = "" } = {}) {
  return `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">${valor}</span>${pie ? `<span class="kpi-pie">${pie}</span>` : ""}</div>`;
}

/* Líneas por elección (eje de categorías). series: [{ nombre, color, valores, punteada }] */
function lineas(id, anios, series, { formato = pct, eje = pct0, aria = "" } = {}) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  const el = document.getElementById(id);
  if (!todos.length) return Obs.vacio(id);
  const maximo = Math.max(...todos) * 1.08;
  const pot = 10 ** Math.floor(Math.log10(maximo || 1));
  const tope = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((t) => t >= maximo) ?? 10 * pot;
  const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
  const rotular = series.length <= 4 && el.clientWidth >= 520;
  const ultimo = (v) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i; return -1; };
  const ctx = (lineas.ctx ??= document.createElement("canvas").getContext("2d"));
  ctx.font = `700 14px ${C.fuente}`;
  const derecha = 20 + Math.max(0, ...series.map((s) => { const u = ultimo(s.valores); return u < 0 ? 0 : ctx.measureText(`${s.nombre}: ${formato(s.valores[u])}`).width; }));
  const desplazo = new Map();
  if (rotular) {
    const arriba = 16, alto = Math.max(1, el.clientHeight - arriba - 30);
    const fin = series.map((s, i) => { const u = ultimo(s.valores); return u < 0 ? null : { i, y: arriba + alto * (1 - s.valores[u] / tope) }; }).filter(Boolean).sort((a, b) => a.y - b.y);
    const pos = fin.map((f) => f.y);
    for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + 18);
    fin.forEach((f, k) => desplazo.set(f.i, pos[k] - f.y));
  }
  Obs.grafico(id).setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.filter((p) => p.value != null).map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${formato(p.value)}</strong>`).join("") },
    grid: { left: 8, right: rotular ? Math.min(derecha, el.clientWidth * 0.42) : 18, top: 16, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => eje(v) }) },
    series: series.map((s, i) => {
      const u = ultimo(s.valores);
      return {
        name: s.nombre, type: "line", connectNulls: true, symbolSize: 7, symbol: ["circle", "rect", "triangle", "diamond"][i % 4],
        data: s.valores.map((v, j) => (j === u && rotular ? { value: v, label: { show: true, position: "right", distance: 8, offset: [0, desplazo.get(i) ?? 0], formatter: () => `${s.nombre}: ${formato(v)}`, ...txt({ color: C.texto, fontWeight: 700 }) } } : v)),
        lineStyle: { width: 2.5, color: s.color, type: s.punteada ? [6, 4] : ["solid", [8, 4], [2, 4], [10, 3, 2, 3]][i % 4] }, itemStyle: { color: s.color }, emphasis: { focus: "series" },
        markLine: i === 0 ? { silent: true, symbol: "none", animation: false, data: [{ xAxis: String(estado.anio), lineStyle: { color: C.navy, width: 1, opacity: 0.35 }, label: { show: false } }] } : undefined,
      };
    }),
  }, true);
  el.setAttribute("aria-label", aria);
}

/* Tabla ordenable con buscador. columnas: [{ clave, titulo, num, valor(f), html(f) }] */
function tablaOrdenable(id, columnas, datosTabla, { inicial, claveFila, descripcion, buscar = null }) {
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
  const tr = datos.map((f) => `<tr data-texto="${Obs.escapar(columnas.filter((c) => !c.num).map((c) => String(c.valor(f) ?? "")).join(" ").toLowerCase())}">` +
    columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("") + "</tr>").join("");
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
    tablaOrdenable(id, columnas, datosTabla, { inicial, claveFila, descripcion, buscar });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
}

/* ---------------------------------------------------------
   Hemiciclo: un punto por escaño, en filas semicirculares, de izquierda a derecha por organización
   --------------------------------------------------------- */
function hemiciclo(el, grupos, { resaltar = null } = {}) {
  const total = grupos.reduce((s, g) => s + g.n, 0);
  if (!total) { el.innerHTML = ""; return; }
  const filas = total > 100 ? 8 : total > 60 ? 6 : 5;
  const R = 100, r0 = 38;
  const radios = Array.from({ length: filas }, (_, i) => r0 + ((R - r0) * (i + 0.5)) / filas);
  const largo = radios.reduce((s, r) => s + r, 0);
  let cupos = radios.map((r) => Math.round((total * r) / largo));
  cupos[cupos.length - 1] += total - cupos.reduce((s, c) => s + c, 0);
  const puntos = [];
  radios.forEach((r, i) => {
    const n = cupos[i];
    for (let k = 0; k < n; k++) {
      const ang = Math.PI - (Math.PI * (k + 0.5)) / n;
      puntos.push({ x: 110 + r * Math.cos(ang), y: 108 - r * Math.sin(ang), ang });
    }
  });
  puntos.sort((a, b) => b.ang - a.ang);
  const rp = Math.min(5.2, ((R - r0) / filas) * 0.42);
  let i = 0;
  const svg = grupos.flatMap((g) => Array.from({ length: g.n }, (_, k) => {
    const p = puntos[i++], apagado = resaltar && !resaltar(g, k);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rp.toFixed(2)}" fill="${g.color}" opacity="${apagado ? 0.18 : 1}"><title>${Obs.escapar(g.etiqueta)}</title></circle>`;
  })).join("");
  el.innerHTML = `<svg viewBox="0 0 220 116" role="img" aria-label="Hemiciclo: ${grupos.map((g) => `${g.etiqueta} ${g.n}`).join(", ")}">${svg}` +
    `<text x="110" y="104" text-anchor="middle" class="hemi-total">${total}</text><text x="110" y="114" text-anchor="middle" class="hemi-etq">escaños</text></svg>`;
}

/* ---------------------------------------------------------
   Pestaña Por elección
   --------------------------------------------------------- */
function pintarKpis() {
  const a = estado.anio, r = estado.region, rv = resumenVotos(a), es = escanosDe(a), el = electosDe(a);
  const ingresan = r === PE ? es.length : new Set(el.map((e) => e.organizacion)).size;
  const mujeres = el.filter((e) => e.sexo === "Mujer").length;
  document.getElementById("k-eleccion").innerHTML =
    kpi(r === PE ? "Escaños" : "Escaños de la región", n0(r === PE ? es.reduce((s, e) => s + e.escanos, 0) : el.length),
      { pie: es2026(a) ? (estado.camara === "Senado" ? (r === PE ? "30 nacionales y 30 regionales" : "senadores regionales") : "Cámara de Diputados") : "Congreso unicameral" }) +
    kpi("Organizaciones que ingresaron", n0(ingresan), { pie: rv ? `de ${n0(rv.listas)} que recibieron votos` : "" }) +
    kpi("Votos en blanco y nulos", pct(rv?.invalidos), { pie: rv ? `blancos ${pct(rv.blancos)} · nulos ${pct(rv.nulos)}` : "" }) +
    kpi("Mujeres electas", el.length ? pct(mujeres / el.length) : "—", { pie: `${n0(mujeres)} de ${n0(el.length)}` });
}

function pintarHemiciclo() {
  const id = "hemiciclo", a = estado.anio, r = estado.region, es = escanosDe(a), col = coloresDe(a);
  const rd = regionDatos(r, a, "Congreso");
  const deLaRegion = (org) => (r === PE ? null : ELE.filter((e) => e.anio === a && e.camara === camaraEsc(a) && e.organizacion === org && e.region === rd).length);
  const grupos = es.map((e) => ({ org: e.organizacion, etiqueta: titulo(e.organizacion), n: e.escanos, color: col.get(e.organizacion), region: deLaRegion(e.organizacion) }));
  hemiciclo(document.getElementById("hemi"), grupos, {
    resaltar: r !== PE || estado.partido ? (g, k) => (estado.partido ? g.org === estado.partido : true) && (r === PE || k < g.region) : null,
  });
  const lista = document.getElementById("hemi-lista");
  lista.innerHTML = `<ul class="partidos">${grupos.map((g) => `<li><button type="button" data-partido="${Obs.escapar(g.org)}" aria-pressed="${estado.partido === g.org}">` +
    `<i style="background:${g.color}"></i><span>${Obs.escapar(g.etiqueta)}</span><strong>${g.n}</strong>${r !== PE ? `<em>${g.region} de ${nombreRegion(r)}</em>` : ""}</button></li>`).join("")}</ul>`;
  // Congresistas del partido elegido (o de la región)
  const quienes = ELE.filter((e) => e.anio === a && e.camara === camaraEsc(a) && (!estado.partido || e.organizacion === estado.partido) && (r === PE || e.region === rd));
  const caja = document.getElementById("hemi-congresistas");
  if (estado.partido || r !== PE) {
    caja.innerHTML = `<h4>${estado.partido ? Obs.escapar(titulo(estado.partido)) : "Congresistas"}${r !== PE ? ` · ${nombreRegion(r)}` : ""} (${quienes.length})</h4>` +
      `<ol class="lista-congresistas">${quienes.sort((x, y) => (y.votos || 0) - (x.votos || 0)).map((e) =>
        `<li><span>${Obs.escapar(e.nombre)}</span><small>${r === PE ? `${nombreRegion(e.region)} · ` : ""}${estado.partido ? "" : `${Obs.escapar(titulo(e.organizacion))} · `}${e.votos ? `${n0(e.votos)} votos` : ""}${e.nota ? ` · ${Obs.escapar(e.nota)}` : ""}</small></li>`).join("")}</ol>`;
  } else caja.innerHTML = `<p class="pista">Haz clic en una organización para ver a sus congresistas.</p>`;
  const top = grupos[0];
  lectura(id, top ? `En ${nombreCamara()} elegido en ${a}, ${destacar(Obs.escapar(top.etiqueta))} obtuvo ${destacar(n0(top.n))} de ${n0(grupos.reduce((s, g) => s + g.n, 0))} escaños; ${destacar(n0(grupos.length))} organizaciones ingresaron.` : "");
  nota(id, es2026(a) && estado.camara === "Senado" && r !== PE ? "Con una región elegida se resaltan sus senadores regionales; los 30 del distrito único nacional no tienen región." :
    r !== PE ? "Se resaltan los escaños de la región elegida." : "");
}

function pintarVotosEscanos() {
  const id = "votos-escanos", a = estado.anio, r = estado.region, rv = resumenVotos(a);
  if (!rv) { Obs.vacio(`g-${id}`); lectura(id, ""); return; }
  const col = coloresDe(a), es = escanosDe(a), el = electosDe(a);
  const totalEsc = r === PE ? es.reduce((s, e) => s + e.escanos, 0) : el.length;
  const escDe = (org) => (r === PE ? es.find((e) => e.organizacion === org)?.escanos ?? 0 : el.filter((e) => e.organizacion === org).length);
  const items = rv.org.slice(0, 14).map((v) => {
    const orgEsc = es.find((e) => e.organizacion === v.organizacion || titulo(e.organizacion) === titulo(v.organizacion))?.organizacion ?? v.organizacion;
    const n = escDe(orgEsc);
    return { clave: v.organizacion, etiqueta: titulo(v.organizacion), valor: v.votos / rv.validos, comp: totalEsc ? n / totalEsc : null, color: col.get(orgEsc) ?? C.otros, detalle: `${n0(v.votos)} votos · ${n0(n)} escaños` };
  });
  Obs.barras(`g-${id}`, items, { formato: pct, nombre: "Votos válidos", comparacion: "Escaños", detalle: (d) => d.detalle });
  const fuera = rv.org.filter((v) => !es.some((e) => titulo(e.organizacion) === titulo(v.organizacion)) && escDe(v.organizacion) === 0);
  const perdidos = fuera.reduce((s, v) => s + v.votos, 0) / rv.validos;
  lectura(id, `${EnRegion(r)}, el ${destacar(pct(perdidos))} de los votos válidos fue a organizaciones que no obtuvieron ningún escaño en ${nombreCamara()}.`);
  nota(id, "Barra: porcentaje de los votos válidos. Marca vertical: porcentaje de los escaños. Desde 2006 hay una valla: para entrar al Congreso un partido necesita el 5 % de los votos válidos y un mínimo de escaños.");
}

function pintarMapa() {
  const id = "mapa", a = estado.anio, card = document.getElementById(`c-${id}`), modo = estado.mapa;
  $("[data-mapa]", card).innerHTML = botones([{ valor: "ganador", etiqueta: "Organización más votada" }, { valor: "invalidos", etiqueta: "Votos en blanco y nulos" }], modo);
  const col = coloresDe(a), valores = new Map(), regsMapa = Object.keys(REGIONES).filter((r) => r !== "EXTRANJERO");
  for (const r of regsMapa) {
    const rv = resumenVotos(a, r);
    if (!rv) continue;
    const geo = r === "LIMA METROPOLITANA" || r === "LIMA PROVINCIAS" ? r : r;
    valores.set(geo, modo === "ganador" ? { org: rv.org[0]?.organizacion, pct: rv.org[0] ? rv.org[0].votos / rv.validos : null } : rv.invalidos);
  }
  if (!mapas[id]) mapas[id] = new Obs.Mapa(`mapa-${id}`, GEO, { alClic: (g) => actualizar({ region: estado.region === g ? PE : g, partido: null }), nombre: (g) => nombreRegion(g) });
  if (modo === "ganador") {
    const orgs = [...new Set([...valores.values()].map((v) => v.org))];
    const colorOrg = (o) => col.get(o) ?? col.get([...col.keys()].find((k) => titulo(k) === titulo(o))) ?? C.otros;
    mapas[id].pintar({ valores, color: (v) => colorOrg(v.org), texto: (v) => `${Obs.escapar(titulo(v.org))}<br>${pct(v.pct)}`, elegida: estado.region === PE ? null : estado.region });
    document.getElementById(`ley-${id}`).innerHTML = orgs.map((o) => `<span><i style="background:${colorOrg(o)}"></i>${Obs.escapar(titulo(o))}</span>`).join("");
    const cuenta = new Map(); valores.forEach((v) => cuenta.set(v.org, (cuenta.get(v.org) ?? 0) + 1));
    const [mas, n] = [...cuenta].sort((x, y) => y[1] - x[1])[0] ?? [];
    lectura(id, mas ? `${destacar(Obs.escapar(titulo(mas)))} fue la más votada en ${destacar(n0(n))} de ${n0(valores.size)} regiones.` : "");
  } else {
    const rango = Obs.rango(valores.values());
    mapas[id].pintar({ valores, color: (v) => Obs.colorContinuo(v, rango, C.escala), texto: (v) => pct(v), elegida: estado.region === PE ? null : estado.region });
    Obs.leyendaContinua(`ley-${id}`, rango, C.escala, pct, mapas[id]);
    const orden = [...valores].sort((x, y) => y[1] - x[1]);
    lectura(id, orden.length ? `Los votos en blanco y nulos fueron más altos en ${destacar(nombreRegion(orden[0][0]))} (${pct(orden[0][1])}) y más bajos en ${destacar(nombreRegion(orden.at(-1)[0]))} (${pct(orden.at(-1)[1])}).` : "");
  }
  nota(id, (a <= 2006 ? "Hasta 2006 Lima fue un solo distrito electoral: Lima Metropolitana y Lima Provincias muestran el mismo valor. " : "") +
    (es2026(a) && estado.camara === "Senado" ? "Senado: votos de la elección de senadores regionales (distrito múltiple)." : "") +
    (a >= 2021 ? " Los residentes en el extranjero no aparecen en el mapa: elígelos en el filtro de región." : ""));
}

/* ---------------------------------------------------------
   Pestaña Histórico
   --------------------------------------------------------- */
function pintarMatriz() {
  const id = "matriz", r = estado.region;
  // Columnas: cada elección (2026: Diputados y Senado)
  const cols = ANIOS.flatMap((a) => (es2026(a) ? [{ a, cam: "Diputados", etq: `${a} D` }, { a, cam: "Senado", etq: `${a} S` }] : [{ a, cam: "Congreso", etq: String(a) }]));
  const valor = (org, c) => {
    if (r === PE) return ESC.find((e) => e.anio === c.a && e.camara === c.cam && e.organizacion === org)?.escanos ?? 0;
    const rd = regionDatos(r, c.a, "Congreso");
    return ELE.filter((e) => e.anio === c.a && e.camara === c.cam && e.organizacion === org && e.region === rd).length;
  };
  const orgs = [...new Set(ESC.map((e) => e.organizacion))].map((o) => ({ o, t: cols.reduce((s, c) => s + valor(o, c), 0) })).filter((x) => x.t > 0).sort((x, y) => y.t - x.t);
  const max = Math.max(1, ...orgs.flatMap((x) => cols.map((c) => valor(x.o, c))));
  const fondo = (v) => (v ? Obs.colorContinuo(v, [0, max], C.escala) : "transparent");
  document.getElementById(`g-${id}`).innerHTML = orgs.length ? `<div class="tabla-desliza"><table class="tabla matriz"><thead><tr><th>Organización</th>${cols.map((c) => `<th class="num">${c.etq}</th>`).join("")}</tr></thead><tbody>` +
    orgs.map((x) => `<tr><td>${Obs.escapar(titulo(x.o))}</td>${cols.map((c) => { const v = valor(x.o, c); return `<td class="num"${v ? ` style="background:${fondo(v)};color:${Obs.colorOscuro(fondo(v)) ? "#fff" : "inherit"}"` : ""}>${v || ""}</td>`; }).join("")}</tr>`).join("") +
    "</tbody></table></div>" : `<p class="pista">No hay escaños de esta región en los datos.</p>`;
  lectura(id, `${destacar(n0(orgs.length))} organizaciones obtuvieron al menos un escaño ${enRegion(r)} entre 2001 y 2026.`);
  nota(id, "Los nombres de las organizaciones son los de cada elección: una misma organización puede aparecer con nombres distintos (por ejemplo, Fuerza 2011 y Fuerza Popular). 2026: D = Diputados, S = Senado.");
}

function pintarEvolHistorico() {
  const r = estado.region, anios = ANIOS;
  const cam = (a) => (es2026(a) ? "Diputados" : "Congreso");
  const ingresan = (a, reg) => (reg === PE ? ESC.filter((e) => e.anio === a && e.camara === cam(a)).length
    : new Set(ELE.filter((e) => e.anio === a && e.camara === cam(a) && e.region === regionDatos(reg, a, "Congreso")).map((e) => e.organizacion)).size);
  const guardar = estado.camara;
  estado.camara = "Diputados";
  const postulan = (a, reg) => resumenVotos(a, reg)?.listas ?? null;
  lineas("g-partidos", anios, [
    { nombre: "Recibieron votos", color: C.categorias[0], valores: anios.map((a) => postulan(a, r)) },
    { nombre: "Ingresaron", color: C.categorias[1], valores: anios.map((a) => ingresan(a, r)) },
  ], { formato: n0, eje: n0, aria: "Organizaciones que recibieron votos y que ingresaron, por elección" });
  const inv = (a, reg) => resumenVotos(a, reg)?.invalidos ?? null;
  lineas("g-invalidos", anios, [{ nombre: r === PE ? "Perú" : nombreRegion(r), color: C.categorias[0], valores: anios.map((a) => inv(a, r)) }]
    .concat(r !== PE ? [{ nombre: "Perú", color: C.textoSuave, punteada: true, valores: anios.map((a) => inv(a, PE)) }] : []), { aria: "Votos en blanco y nulos por elección" });
  estado.camara = guardar;
  const elect = (a, reg) => { const es = ELE.filter((e) => e.anio === a && (reg === PE || e.region === regionDatos(reg, a, "Congreso"))); return es.length ? es.filter((e) => e.sexo === "Mujer").length / es.length : null; };
  lineas("g-mujeres", anios, [
    { nombre: "Candidatas (Perú)", color: C.categorias[2], valores: anios.map((a) => MUJ.find((m) => m.anio === a)?.p_mujer_candidatas ?? null) },
    { nombre: r === PE ? "Electas" : `Electas en ${nombreRegion(r)}`, color: C.categorias[1], valores: anios.map((a) => elect(a, r)) },
  ], { aria: "Mujeres candidatas y electas por elección" });
  const p0 = postulan(2001, r), i0 = ingresan(2001, r), pU = postulan(ANIOS.at(-1), r), iU = ingresan(ANIOS.at(-1), r);
  lectura("partidos", `${EnRegion(r)}, en 2001 recibieron votos ${destacar(n0(p0))} organizaciones e ingresaron ${destacar(n0(i0))}; en ${ANIOS.at(-1)}, ${destacar(n0(pU))} y ${destacar(n0(iU))}.`);
  nota("partidos", "2026: Cámara de Diputados." + (r !== PE ? " En una región, «ingresaron» son las organizaciones que obtuvieron escaños en ella." : ""));
  const x = inv(estado.anio, r);
  lectura("invalidos", x != null ? `${EnRegion(r)}, en ${estado.anio}, ${destacar(pct(x))} de los votos al Congreso fueron en blanco o nulos.` : "");
  nota("invalidos", "Porcentaje de los votos emitidos. 2026: Cámara de Diputados.");
  const m = MUJ.find((y) => y.anio === estado.anio), e = elect(estado.anio, r);
  lectura("mujeres", e != null ? `En ${estado.anio}, las mujeres fueron ${m?.p_mujer_candidatas ? `el ${destacar(pct(m.p_mujer_candidatas))} de los candidatos y ` : ""}el ${destacar(pct(e))} de los electos ${enRegion(r)}.` : "");
  nota("mujeres", "Candidatas: solo para el total del Perú; aún no hay datos de 2026. Electas: congresistas que juraron (2026: senadores y diputados). Desde 2021 rige la paridad y alternancia en las listas.");
}

/* ---------------------------------------------------------
   Pestaña Congresistas
   --------------------------------------------------------- */
function pintarCongresistas() {
  const r = estado.region;
  const filas = ELE.filter((e) => r === PE || e.region === regionDatos(r, e.anio, "Congreso"));
  tablaOrdenable("g-lista", [
    { clave: "anio", titulo: "Elección", num: true, valor: (f) => f.anio, html: (f) => String(f.anio) },
    { clave: "camara", titulo: "Cámara", valor: (f) => f.camara, html: (f) => f.camara },
    { clave: "region", titulo: "Región", valor: (f) => nombreRegion(f.region), html: (f) => Obs.escapar(nombreRegion(f.region)) },
    { clave: "nombre", titulo: "Congresista", valor: (f) => f.nombre, html: (f) => Obs.escapar(f.nombre) + (f.nota ? `<br><small>${Obs.escapar(f.nota)}</small>` : "") },
    { clave: "org", titulo: "Organización", valor: (f) => titulo(f.organizacion), html: (f) => Obs.escapar(titulo(f.organizacion)) },
    { clave: "votos", titulo: "Votos preferenciales", num: true, valor: (f) => f.votos || null, html: (f) => (f.votos ? n0(f.votos) : "—") },
  ], filas, { inicial: { clave: "anio", dir: -1 }, claveFila: (f) => `${f.anio}-${f.nombre}`, descripcion: "Congresistas por elección", buscar: "Nombre, organización o región" });
  lectura("lista", `${destacar(n0(filas.length))} congresistas ${r === PE ? "" : `de ${nombreRegion(r)} `}juraron entre 2001 y 2026.`);
  nota("lista", "Congresistas que juraron al inicio de cada periodo (fuente provisional: Wikipedia). Votos preferenciales: los de su distrito electoral.");

  // Más votados de la elección elegida
  const a = estado.anio, es = electosDe(a).filter((e) => e.votos);
  const col = coloresDe(a);
  Obs.barras("g-masvotados", es.sort((x, y) => y.votos - x.votos).slice(0, 15).map((e) => ({ clave: e.nombre, etiqueta: e.nombre, valor: e.votos, color: col.get(e.organizacion) ?? C.otros,
    detalle: `${titulo(e.organizacion)} · ${nombreRegion(e.region)}` })), { formato: n0, ordenar: false, detalle: (d) => d.detalle });
  lectura("masvotados", es.length ? `${destacar(Obs.escapar(es[0].nombre))} (${Obs.escapar(titulo(es[0].organizacion))}) fue el más votado ${r === PE ? "" : `de ${nombreRegion(r)} `}en la elección ${deCamara()} de ${a}, con ${destacar(n0(es[0].votos))} votos preferenciales.` : "");
  nota("masvotados", es2026(a) && estado.camara === "Senado" ? "Senado: los del distrito único nacional compiten con los votos de todo el país." : "");

  // Reelectos: aparecen en más de una elección (mismo nombre)
  const clave = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
  const grupos = new Map();
  ELE.forEach((e) => { const k = clave(e.nombre); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(e); });
  const reel = [...grupos.values()].filter((g) => new Set(g.map((e) => e.anio)).size > 1 && (r === PE || g.some((e) => e.region === regionDatos(r, e.anio, "Congreso"))))
    .map((g) => ({ nombre: g[0].nombre, veces: new Set(g.map((e) => e.anio)).size, anios: [...new Set(g.map((e) => e.anio))].sort().join(", "), orgs: [...new Set(g.map((e) => titulo(e.organizacion)))].join(" → ") }));
  tablaOrdenable("g-reelectos", [
    { clave: "nombre", titulo: "Congresista", valor: (f) => f.nombre, html: (f) => Obs.escapar(f.nombre) },
    { clave: "veces", titulo: "Veces", num: true, valor: (f) => f.veces, html: (f) => String(f.veces) },
    { clave: "anios", titulo: "Elecciones", valor: (f) => f.anios, html: (f) => f.anios },
    { clave: "orgs", titulo: "Organizaciones", valor: (f) => f.orgs, html: (f) => Obs.escapar(f.orgs) },
  ], reel, { inicial: { clave: "veces", dir: -1 }, claveFila: (f) => f.nombre, descripcion: "Congresistas reelectos", buscar: "Nombre u organización" });
  lectura("reelectos", `${destacar(n0(reel.length))} congresistas ${r === PE ? "" : `con paso por ${nombreRegion(r)} `}fueron elegidos en más de una elección entre 2001 y 2026.`);
  nota("reelectos", "Se cuenta como la misma persona cuando el nombre coincide; puede haber nombres escritos distinto entre elecciones.");
}

/* ---------------------------------------------------------
   Resumen, estado y render
   --------------------------------------------------------- */
function pintarResumen() {
  const a = estado.anio, rv = resumenVotos(a), es = escanosDe(a);
  const txt = {
    eleccion: rv ? `${EnRegion(estado.region)}, en la elección ${deCamara()} de ${a}, ${destacar(pct(rv.invalidos))} de los votos fueron en blanco o nulos. ` +
      (estado.region === PE ? `Ingresaron ${destacar(n0(es.length))} organizaciones ${es2026(a) ? (estado.camara === "Senado" ? "al Senado" : "a la Cámara de Diputados") : "al Congreso"}.`
        : `Sus ${n0(electosDe(a).length)} escaños fueron para ${destacar(n0(new Set(electosDe(a).map((e) => e.organizacion)).size))} organizaciones.`) : "",
    historico: `Cómo cambió el Congreso ${enRegion(estado.region)} de 2001 a 2026: escaños por organización, organizaciones, votos en blanco y nulos, y mujeres.`,
    congresistas: `Los congresistas ${estado.region === PE ? "" : `de ${nombreRegion(estado.region)} `}que juraron entre 2001 y 2026, los más votados y los que fueron reelegidos.`,
  }[estado.modulo];
  document.getElementById(`r-${estado.modulo}`).innerHTML = txt;
}

function actualizar(parche) {
  Object.assign(estado, parche);
  render();
}
function sincronizar() {
  $("#f-anio").value = estado.anio;
  $("#f-region").value = estado.region;
  $("#c-camara").hidden = !es2026();
  document.querySelectorAll("#f-camara button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.camara === estado.camara));
  document.querySelectorAll(".modulos button").forEach((b) => { const ac = b.dataset.modulo === estado.modulo; b.setAttribute("aria-selected", ac); b.tabIndex = ac ? 0 : -1; });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  const extra = estado.partido ? ` · ${destacar(Obs.escapar(titulo(estado.partido)))} <button type="button" class="chip-limpiar" data-quitar>Quitar</button>` : "";
  document.getElementById("viendo").innerHTML = `Mostrando: ${destacar(`${a2(estado.anio)}, ${nombreRegion(estado.region)}`)}${extra}`;
}
const a2 = (a) => (es2026(a) ? `${a}, ${estado.camara === "Senado" ? "Senado" : "Diputados"}` : String(a));
function actualizarURL() {
  Obs.escribirURL({ modulo: estado.modulo === "eleccion" ? null : estado.modulo, anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
    camara: es2026() && estado.camara === "Senado" ? "senado" : null, region: estado.region === PE ? null : estado.region });
}
function render() {
  sincronizar();
  pintarResumen();
  const m = estado.modulo;
  if (m === "eleccion") { pintarKpis(); pintarHemiciclo(); pintarVotosEscanos(); pintarMapa(); }
  if (m === "historico") { pintarMatriz(); pintarEvolHistorico(); }
  if (m === "congresistas") pintarCongresistas();
  actualizarURL();
}

function tarjetas() {
  document.getElementById("c-eleccion").innerHTML =
    tarjeta("hemiciclo", "¿Cómo quedó el Congreso?", "Escaños de cada organización. Haz clic en una organización para ver a sus congresistas.",
      { cuerpo: `<div class="hemi-caja"><div class="hemi" id="hemi"></div><div class="hemi-lado"><div id="hemi-lista"></div><div id="hemi-congresistas"></div></div></div>` }) +
    tarjeta("votos-escanos", "¿Cuántos votos y cuántos escaños sacó cada organización?", "Porcentaje de los votos válidos (barra) y de los escaños (marca) de cada organización.") +
    tarjeta("mapa", "¿Cómo votó cada región?", "Organización más votada o votos en blanco y nulos en cada región. Haz clic en una región para elegirla en todo el tablero.",
      { controles: local("vm", "Ver", '<div class="segmentado claro" data-mapa></div>'), cuerpo: `<div class="mapa-solo"><div id="mapa-mapa"></div></div>` });
  document.getElementById("c-historico").innerHTML =
    tarjeta("matriz", "Escaños de cada organización, de 2001 a 2026", "Número de escaños por organización en cada elección. Más oscuro, más escaños.", { cuerpo: `<div id="g-matriz"></div>` }) +
    par(tarjeta("partidos", "¿Cuántas organizaciones compiten y cuántas entran?", "Organizaciones que recibieron votos y que obtuvieron escaños, en cada elección."),
      tarjeta("invalidos", "¿Cuántos votan en blanco o nulo?", "Votos en blanco y nulos entre los votos emitidos, en cada elección.")) +
    tarjeta("mujeres", "¿Cuántas mujeres postulan y cuántas llegan?", "Porcentaje de mujeres entre los candidatos y entre los electos, en cada elección.");
  document.getElementById("c-congresistas").innerHTML =
    tarjeta("lista", "Congresistas de cada elección", "Busca por nombre, organización o región.", { cuerpo: `<div class="tabla-caja" id="g-lista"></div>` }) +
    par(tarjeta("masvotados", "¿Quiénes fueron los más votados?", "Congresistas con más votos preferenciales en la elección elegida (los 15 primeros)."),
      tarjeta("reelectos", "¿Quiénes repiten?", "Congresistas elegidos en más de una elección.", { cuerpo: `<div class="tabla-caja" id="g-reelectos"></div>` }));
  document.getElementById("c-eleccion").addEventListener("click", (e) => {
    const p = e.target.closest("button[data-partido]");
    if (p) return actualizar({ partido: estado.partido === p.dataset.partido ? null : p.dataset.partido });
    const b = e.target.closest("[data-mapa] button[data-valor]");
    if (b) actualizar({ mapa: b.dataset.valor });
  });
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  GEO = geo;
  C = Obs.tema();
  const T = (p) => (datos.tablas[p] ? Obs.expandir(datos.tablas[p]) : []);
  VOT = T("votos").map((f) => ({ ...f, anio: +f.anio, votos: +f.votos }));
  ESC = T("escanos").map((f) => ({ ...f, anio: +f.anio, escanos: +f.escanos }));
  ELE = T("electos").map((f) => ({ ...f, anio: +f.anio, votos: f.votos === "" ? null : +f.votos }));
  MUJ = T("mujeres").map((f) => ({ ...f, anio: +f.anio, p_mujer_candidatas: f.p_mujer_candidatas === "" ? null : +f.p_mujer_candidatas }));
  ANIOS = [...new Set(ESC.map((e) => e.anio))].sort((x, y) => x - y);
  estado.anio = ANIOS.at(-1);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  if (ANIOS.includes(+q.get("anio"))) estado.anio = +q.get("anio");
  if (q.get("camara") === "senado") estado.camara = "Senado";
  if (REGIONES[q.get("region")]) estado.region = q.get("region");

  document.getElementById("filtros").innerHTML = `
    <div class="filtro"><label for="f-anio">Elección</label>
      <select id="f-anio" class="corto">${[...ANIOS].reverse().map((a) => `<option value="${a}">${a}</option>`).join("")}</select></div>
    <div class="filtro" id="c-camara"><span class="etiqueta" id="lbl-camara">Cámara</span>
      <div class="segmentado" id="f-camara" role="group" aria-labelledby="lbl-camara"><button type="button" data-camara="Senado">Senado</button><button type="button" data-camara="Diputados">Diputados</button></div></div>
    <div class="filtro"><label for="f-region">Región</label>
      <select id="f-region"><option value="${PE}">Todo el Perú</option>${Object.entries(REGIONES).sort((x, y) => x[1].localeCompare(y[1], "es")).map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></div>
    <p class="viendo" id="viendo" aria-live="polite"></p>`;
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value, partido: null });
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-camara").onclick = (e) => { const b = e.target.closest("button[data-camara]"); if (b) actualizar({ camara: b.dataset.camara, partido: null }); };
  $("#viendo").onclick = (e) => { if (e.target.closest("[data-quitar]")) actualizar({ partido: null }); };
  tarjetas();
  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => { const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!paso) return; const s = pestanas[(i + paso + pestanas.length) % pestanas.length]; s.focus(); s.click(); };
  });
  let espera, anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => { if (window.innerWidth === anchoPrevio) return; anchoPrevio = window.innerWidth; clearTimeout(espera); espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
