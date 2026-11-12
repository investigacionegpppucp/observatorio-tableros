/* =========================================================
   Tablero de Estallido social — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, generado por procesos/estallido-social/procesar.py
   desde el Excel «Estallido social». Tablas:
     fallecidos      una fila por persona fallecida
     diario          serie diaria de la Defensoría (acumulados y puntos de bloqueo)
     heridos         heridos civiles, policías y militares (total)
     heridos_region  heridos atendidos por región, en tres comunicados del Minsa
     acp             acciones de protesta: día, región, provincia, distrito y tipo
     violencia       hechos de violencia
     bloqueos        días y provincias con vías bloqueadas
     emergencia      estados de emergencia no nacionales, por provincia
     inmovilizacion  inmovilización social obligatoria, por provincia
   Las regiones van con los códigos de mapas/peru_regiones.geojson y las
   provincias con su ubigeo (mapas/peru_provincias.geojson).

   Patrón: un objeto `estado`, funciones puras para filtrar y agregar, y
   una sola `render()`.

   Parámetros de URL:
     ?modulo=victimas|protestas|bloqueos|estado
     &region=PUNO   &desde=2022-12  &hasta=2023-03
     &mapa=acciones &nivel=provincial
     &embed=1       oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "estallido-social";
const MODULOS = ["victimas", "protestas", "bloqueos", "estado"];
const ARCHIVOS = [{ clave: "estallido_social_base", etiqueta: "Base del Estallido social (2022-2024)" }];
const NACIONAL = "NACIONAL";
const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca",
  CALLAO: "Callao", CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad",
  LAMBAYEQUE: "Lambayeque", "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto",
  "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno", "SAN MARTIN": "San Martín",
  TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const MESES_C = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
// Tipos de acción de protesta, en orden fijo (el color sigue al tipo)
const TIPOS = ["Movilización/Concentración", "Paro", "Marcha por la paz/vigilia/plantón", "Enfrentamiento con PNP", "Hecho de violencia", "Otro"];
const ETIQ_TIPO = { "Movilización/Concentración": "Movilización o concentración", "Marcha por la paz/vigilia/plantón": "Marcha por la paz, vigilia o plantón" };
const CIRCUNSTANCIAS = ["Enfrentamiento y represión", "A consecuencia del bloqueo de vías"];
const GRUPOS_EDAD = ["Menor de edad", "Entre 18 y 24 años", "Entre 25 y 34 años", "Entre 35 y 44 años", "Entre 45 y 54 años", "De 55 años a más", "Sin información"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const DIA = 86400000;

const estado = { modulo: "victimas", ambito: "nacional", region: NACIONAL, desde: null, hasta: null, mapa: {}, nivel: {}, bloqueo: "provincias", medida: "emergencia", mensaje: "", palabra: "" };
const buscar = { f: "", v: "", e: "" };
// Nivel del mapa por pestaña: los estados de emergencia se declaran por provincia
const NIVEL_INICIAL = { victimas: "regional", protestas: "regional", bloqueos: "regional", estado: "provincial" };
const nivelMapa = () => estado.nivel[estado.modulo] ?? NIVEL_INICIAL[estado.modulo];
let D, C, GEO, controles, MESES_LISTA = [];

/* ---------------------------------------------------------
   Utilidades
   --------------------------------------------------------- */
const n0 = (v) => Obs.fmtN(v, 0);
const pct = (v) => Obs.fmtPct(v, 1);
const nombreRegion = (c) => (c === NACIONAL ? "Perú" : NOMBRES[c] ?? c);
const enLugar = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnLugar = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombreRegion(c)}`);
const destacar = (s) => `<strong>${s}</strong>`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const aFecha = (s) => (s ? new Date(`${s}T00:00:00Z`) : null);
const fmtFecha = (s) => { const d = aFecha(s); return d ? `${d.getUTCDate()} ${MESES_C[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—"; };
const fmtMes = (m) => { const [a, mm] = m.split("-").map(Number); return `${MESES[mm - 1]} de ${a}`; };
const mesDe = (s) => s.slice(0, 7);
const sinTildeTxt = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// «SAN JUAN DE LURIGANCHO» -> «San Juan de Lurigancho»
const MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"]);
const titulo = (s) => String(s ?? "").toLowerCase().split(/(\s+|-)/).map((w, i) => (i && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
// Primer y último día del período elegido
const inicioPeriodo = () => `${estado.desde}-01`;
const finPeriodo = () => { const [a, m] = estado.hasta.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const enPeriodo = (f) => f && f >= inicioPeriodo() && f <= finPeriodo();
const enRegion = (r) => estado.region === NACIONAL || r === estado.region;
const periodoTxt = () => (estado.desde === estado.hasta ? `en ${fmtMes(estado.desde)}` : `entre ${fmtMes(estado.desde)} y ${fmtMes(estado.hasta)}`);
// Lunes de la semana de una fecha
const semana = (s) => { const d = aFecha(s); const dia = (d.getUTCDay() + 6) % 7; return new Date(d - dia * DIA).toISOString().slice(0, 10); };
function semanas() {
  const out = [];
  for (let d = aFecha(semana(inicioPeriodo())); d <= aFecha(finPeriodo()); d = new Date(+d + 7 * DIA)) out.push(d.toISOString().slice(0, 10));
  return out;
}
function dias() {
  const out = [];
  for (let d = aFecha(inicioPeriodo()); d <= aFecha(finPeriodo()); d = new Date(+d + DIA)) out.push(d.toISOString().slice(0, 10));
  return out;
}
/* Primer y último índice con datos en alguna serie: las líneas de tiempo no se alargan más allá de los datos.
   `extra` suma puntos al final (para que una línea escalonada baje a cero) */
function conDatos(n, series, extra = 0) {
  let ini = n, fin = -1;
  series.forEach((s) => s.forEach((v, i) => { if (v) { ini = Math.min(ini, i); fin = Math.max(fin, i); } }));
  return fin < 0 ? [0, 0] : [ini, Math.min(n, fin + 1 + extra)];
}
// Etiqueta de fecha del eje: con el año en enero o en el primer punto
const etiquetaEje = (s, i) => { const d = aFecha(s); return `${d.getUTCDate()} ${MESES_C[d.getUTCMonth()]}${d.getUTCMonth() === 0 || i === 0 ? `\n${d.getUTCFullYear()}` : ""}`; };
const contar = (filas, clave) => { const m = new Map(); filas.forEach((f) => { const k = typeof clave === "function" ? clave(f) : f[clave]; m.set(k, (m.get(k) ?? 0) + 1); }); return m; };

/* Filas de una tabla en el período y la región elegidos */
const filtrar = (tabla, campo = "fecha", { region = true } = {}) => D[tabla].filter((f) => enPeriodo(f[campo]) && (!region || enRegion(f.region)));
// Medidas de excepción: las que estuvieron vigentes en algún día del período
const vigentes = (tabla) => D[tabla].filter((f) => f.inicio <= finPeriodo() && (f.fin ?? f.inicio) >= inicioPeriodo() && enRegion(f.region));

/* Líneas por semana, una por categoría (una sola escala) */
function columnasSemana(id, filas, campoFecha, categorias, claveCat) {
  let sem = semanas();
  const idx = new Map(sem.map((s, i) => [s, i]));
  const series = categorias.map(([cat, nombre, color]) => {
    const v = sem.map(() => 0);
    filas.filter((f) => claveCat(f) === cat).forEach((f) => { const i = idx.get(semana(f[campoFecha])); if (i != null) v[i] += 1; });
    return { name: nombre, type: "line", data: v, symbol: "circle", symbolSize: 5, showSymbol: false, lineStyle: { width: 2.5, color }, itemStyle: { color }, emphasis: { focus: "series" } };
  });
  if (!filas.length) return Obs.vacio(id);
  const [ini, fin] = conDatos(sem.length, series.map((x) => x.data));
  sem = sem.slice(ini, fin);
  series.forEach((x) => (x.data = x.data.slice(ini, fin)));
  const g = Obs.grafico(id);
  const ancho = document.getElementById(id).clientWidth;
  const cada = Math.max(1, Math.ceil(sem.length / Math.max(4, Math.floor(ancho / 90))));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 300,
    legend: categorias.length > 1 ? { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: txt() } : undefined,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.linea } },
      formatter: (ps) => { const tot = ps.reduce((s, p) => s + (p.value ?? 0), 0);
        return `<strong>Semana del ${fmtFecha(sem[ps[0].dataIndex])}</strong>` + ps.filter((p) => p.value).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${n0(p.value)}</strong>`).join("") + (ps.length > 1 ? `<br>Total: <strong>${n0(tot)}</strong>` : ""); } },
    grid: { left: 40, right: 24, top: categorias.length > 1 ? (ancho < 600 ? 72 : 40) : 12, bottom: 44 },
    xAxis: { type: "category", data: sem, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => i % cada === 0, formatter: etiquetaEje }) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series,
  }, true);
}

/* Barras de conteo (de mayor a menor salvo `ordenar: false`), con el porcentaje del total en el tooltip */
function barrasConteo(id, pares, { ordenar = true, nombre = "", total = null } = {}) {
  const t = total ?? pares.reduce((s, [, , v]) => s + v, 0);
  Obs.barras(id, pares.map(([clave, etiqueta, valor]) => ({ clave, etiqueta, valor })), {
    formato: n0, nombre, ordenar, detalle: (d) => (t ? `${pct(d.valor / t)} del total` : ""),
  });
}

/* Escala continua (sin cortes): del celeste más claro al azul más oscuro */
const escalaContinua = () => ["#f1f5fd", ...C.escala];
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorContinuo(t) {
  const cs = escalaContinua().map(hexRGB);
  const x = Math.max(0, Math.min(1, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${cs[i].map((c, k) => Math.round(c + (cs[i + 1][k] - c) * f)).join(",")})`;
}
const leyendaContinua = (max, unidad = "") =>
  `<div class="ley-continua"><span>0</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${n0(max)}${unidad ? ` ${unidad}` : ""}</span></div>`;

/* Composición: una barra al 100 % y, debajo, cada parte con su número y su porcentaje.
   items: [{ clave, etiqueta, valor, color }]; con alClic, cada parte es un botón */
function composicion(id, items, { alClic = null, elegida = null, unidad = "" } = {}) {
  const el = document.getElementById(id);
  const total = items.reduce((s, x) => s + x.valor, 0);
  if (!total) { el.innerHTML = `<p class="vacio-comp">Sin datos para esta selección</p>`; return; }
  const etiqueta = (x) => `${x.etiqueta}: ${n0(x.valor)} ${unidad} (${pct(x.valor / total)})`;
  el.innerHTML = `<div class="barra-comp" aria-hidden="true">${items.filter((x) => x.valor).map((x) =>
      `<i style="flex:${x.valor} 1 0;background:${x.color}" title="${Obs.escapar(etiqueta(x))}"${elegida && elegida !== x.clave ? ' class="tenue"' : ""}></i>`).join("")}</div>` +
    `<ul class="partes">${items.map((x) => {
      const dentro = `<b style="background:${x.color}"></b><span class="parte-nombre">${Obs.escapar(x.etiqueta)}</span><strong>${n0(x.valor)}</strong><em>${pct(x.valor / total)}</em>`;
      return `<li>${alClic && x.valor ? `<button type="button" data-k="${Obs.escapar(x.clave)}" aria-pressed="${elegida === x.clave}">${dentro}</button>` : `<div>${dentro}</div>`}</li>`;
    }).join("")}</ul>`;
  if (alClic) el.querySelectorAll("button[data-k]").forEach((b) => (b.onclick = () => alClic(b.dataset.k)));
}

/* Cifras clave */
function kpis(id, lista) {
  document.getElementById(id).innerHTML = lista.map(({ etiqueta, valor, pie }) =>
    `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">${valor}</span><span class="kpi-pie">${pie}</span></div>`).join("");
}

/* ---------------------------------------------------------
   Pestaña: Fallecidos y heridos
   --------------------------------------------------------- */
function pintarVictimas() {
  const f = filtrar("fallecidos");
  const enfr = f.filter((x) => x.circunstancia === CIRCUNSTANCIAS[0]).length, vias = f.length - enfr;
  const menores = f.filter((x) => x.grupo === "Menor de edad").length;
  const porRegion = [...contar(f, "region")].sort((a, b) => b[1] - a[1]);
  document.getElementById("r-victimas").innerHTML = f.length
    ? `${EnLugar(estado.region)}, ${periodoTxt()}, murieron ${destacar(`${n0(f.length)} ${f.length === 1 ? "persona" : "personas"}`)} en el contexto de las protestas: ` +
      `${n0(enfr)} en enfrentamientos y represión, y ${n0(vias)} a consecuencia del bloqueo de vías.` +
      (menores ? ` ${n0(menores)} ${menores === 1 ? "era menor" : "eran menores"} de edad.` : "") +
      (estado.region === NACIONAL && porRegion.length ? ` La región con más fallecidos fue ${destacar(nombreRegion(porRegion[0][0]))} (${n0(porRegion[0][1])}).` : "")
    : `${EnLugar(estado.region)} no se registraron fallecidos ${periodoTxt()}.`;
  const H = Object.fromEntries(D.heridos.map((h) => [h.tipo, h.n]));
  kpis("k-victimas", [
    { etiqueta: "Personas fallecidas", valor: n0(f.length), pie: `${n0(enfr)} en enfrentamientos y ${n0(vias)} por bloqueos` },
    { etiqueta: "Menores de edad fallecidos", valor: n0(menores), pie: f.length ? `${pct(menores / f.length)} de los fallecidos` : "" },
    { etiqueta: "Heridos civiles", valor: n0(H.Civiles ?? 0), pie: "Total nacional, al 18 de agosto de 2023" },
    { etiqueta: "Heridos policías y militares", valor: n0((H.Policías ?? 0) + (H.Militares ?? 0)), pie: `${n0(H.Policías ?? 0)} policías y ${n0(H.Militares ?? 0)} militares` },
  ]);
  const colores = [C.categorias[1], C.categorias[0]];
  columnasSemana("g-fallecidos", f, "fecha", CIRCUNSTANCIAS.map((c, i) => [c, c, colores[i]]), (x) => x.circunstancia);
  document.getElementById("ley-fallecidos").innerHTML = "";
  barrasConteo("g-edad", GRUPOS_EDAD.map((g) => [g, g, f.filter((x) => x.grupo === g).length]), { ordenar: false, nombre: "Fallecidos" });
  const sexo = contar(f, "sexo");
  document.getElementById("l-sexo").innerHTML = f.length ? `${destacar(n0(sexo.get("Masculino") ?? 0))} eran hombres y ${destacar(n0(sexo.get("Femenino") ?? 0))} mujeres; de ${n0(sexo.get("No se menciona") ?? 0)} la fuente no dice el sexo.` : "";
  barrasConteo("g-heridos", D.heridos.map((h) => [h.tipo, h.tipo, h.n]), { ordenar: false, nombre: "Heridos" });

  const q = sinTildeTxt(buscar.f.trim());
  const filas = f.filter((x) => !q || sinTildeTxt(`${x.nombre} ${nombreRegion(x.region)} ${x.provincia}`).includes(q));
  tablaOrdenable("t-fallecidos", [
    { clave: "fecha", titulo: "Fecha", valor: (x) => x.fecha, html: (x) => fmtFecha(x.fecha) },
    { clave: "nombre", titulo: "Nombre", valor: (x) => x.nombre, html: (x) => `<strong>${Obs.escapar(x.nombre)}</strong>` },
    { clave: "edad", titulo: "Edad", num: true, valor: (x) => x.edad, html: (x) => (x.edad == null ? "—" : n0(x.edad)) },
    { clave: "lugar", titulo: "Lugar", valor: (x) => `${nombreRegion(x.region)} ${x.provincia ?? ""}`, html: (x) => `${Obs.escapar(nombreRegion(x.region))}${x.provincia ? `<small>${Obs.escapar(x.provincia)}</small>` : ""}` },
    { clave: "circ", titulo: "Circunstancia", valor: (x) => x.circunstancia, html: (x) => Obs.escapar(x.circunstancia) },
    { clave: "fuente", titulo: "Fuente", valor: (x) => x.fuente, html: (x) => (x.enlace ? `<a class="enlace" href="${Obs.escapar(x.enlace)}" target="_blank" rel="noopener">${Obs.escapar(x.fuente)}</a>` : Obs.escapar(x.fuente ?? "—")) },
  ], filas, { inicial: { clave: "fecha", dir: 1 }, claveFila: (x) => `${x.fecha}${x.nombre}`, descripcion: `Personas fallecidas ${enLugar(estado.region)}` });
  document.getElementById("t-lista").textContent = f.length === 1 ? "La persona fallecida" : `Las ${n0(f.length)} personas fallecidas`;
}

/* ---------------------------------------------------------
   Pestaña: Movilizaciones y paros
   --------------------------------------------------------- */
const colorTipo = (t) => (t === "Otro" ? C.otros : C.categorias[TIPOS.indexOf(t)]);
function pintarProtestas() {
  const a = filtrar("acp");
  const tipos = contar(a, "tipo");
  const diasCon = new Set(a.map((x) => x.fecha)).size;
  const lugares = new Set(a.map((x) => x.provincia ?? x.region)).size;
  document.getElementById("r-protestas").innerHTML = a.length
    ? `${EnLugar(estado.region)}, ${periodoTxt()}, se registraron ${destacar(`${n0(a.length)} acciones de protesta`)} en ${n0(diasCon)} días: ` +
      `${n0(tipos.get(TIPOS[0]) ?? 0)} movilizaciones o concentraciones, ${n0(tipos.get("Paro") ?? 0)} paros y ${n0(tipos.get("Enfrentamiento con PNP") ?? 0)} enfrentamientos con la Policía.`
    : `${EnLugar(estado.region)} no se registraron acciones de protesta ${periodoTxt()}.`;
  const max = [...contar(a, "fecha")].sort((x, y) => y[1] - x[1])[0];
  kpis("k-protestas", [
    { etiqueta: "Acciones de protesta", valor: n0(a.length), pie: `En ${n0(diasCon)} días` },
    { etiqueta: "Movilizaciones o concentraciones", valor: n0(tipos.get(TIPOS[0]) ?? 0), pie: a.length ? `${pct((tipos.get(TIPOS[0]) ?? 0) / a.length)} de las acciones` : "" },
    { etiqueta: "Paros", valor: n0(tipos.get("Paro") ?? 0), pie: a.length ? `${pct((tipos.get("Paro") ?? 0) / a.length)} de las acciones` : "" },
    { etiqueta: "El día con más acciones", valor: max ? n0(max[1]) : "—", pie: max ? fmtFecha(max[0]) : "" },
  ]);
  columnasSemana("g-acp", a, "fecha", TIPOS.map((t) => [t, ETIQ_TIPO[t] ?? t, colorTipo(t)]), (x) => x.tipo);
  const tipoMapa = (estado.mapa.protestas ?? "").startsWith("tipo") ? TIPOS[+estado.mapa.protestas.slice(4)] : null;
  composicion("g-tipos", TIPOS.map((t) => ({ clave: t, etiqueta: ETIQ_TIPO[t] ?? t, valor: tipos.get(t) ?? 0, color: colorTipo(t) })), {
    unidad: "acciones", elegida: tipoMapa,
    alClic: (t) => { const i = TIPOS.indexOf(t); estado.mapa.protestas = tipoMapa === t || i > 3 ? "acciones" : `tipo${i}`; render(); },
  });
  document.getElementById("d-tipos").textContent = `Acciones de protesta ${enLugar(estado.region)}, ${periodoTxt()}.`;
  // Dónde: regiones; con una región, sus provincias; en Lima Metropolitana, sus distritos
  let grupos, que;
  if (estado.region === NACIONAL) { grupos = contar(a, (x) => nombreRegion(x.region)); que = "regiones"; }
  else if (estado.region === "LIMA METROPOLITANA") { grupos = contar(a.filter((x) => x.distrito), "distrito"); que = "distritos de Lima Metropolitana"; }
  else { grupos = contar(a, (x) => PROV.get(x.provincia) ?? "Sin provincia"); que = `provincias de ${nombreRegion(estado.region)}`; }
  document.getElementById("t-lugares").textContent = estado.region === "LIMA METROPOLITANA" ? "¿En qué distritos de Lima?" : "¿Dónde hubo más acciones?";
  document.getElementById("d-lugares").textContent = `Acciones de protesta en las ${que} con más acciones, ${periodoTxt()}.`;
  barrasConteo("g-lugares", [...grupos].map(([k, v]) => [k, k, v]).sort((x, y) => y[2] - x[2]).slice(0, 15), { nombre: "Acciones", total: a.length });
}

/* ---------------------------------------------------------
   Pestaña: Bloqueos y violencia
   --------------------------------------------------------- */
function pintarBloqueos() {
  const b = filtrar("bloqueos"), v = filtrar("violencia");
  const provincias = new Set(b.map((x) => x.provincia ?? x.region)).size;
  const diario = D.diario.filter((x) => enPeriodo(x.fecha) && x.bloqueos != null);
  const pico = [...diario].sort((x, y) => y.bloqueos - x.bloqueos)[0];
  document.getElementById("r-bloqueos").innerHTML = (b.length
    ? `${EnLugar(estado.region)}, ${periodoTxt()}, hubo vías bloqueadas en ${destacar(`${n0(provincias)} provincias`)}, que sumaron ${n0(b.length)} días con bloqueos.`
    : `${EnLugar(estado.region)} no se registraron bloqueos de vías ${periodoTxt()}.`) +
    (v.length ? ` Se registraron ${destacar(`${n0(v.length)} hechos de violencia`)} contra bienes públicos o privados.` : "");
  kpis("k-bloqueos", [
    { etiqueta: "Provincias con vías bloqueadas", valor: n0(provincias), pie: `${n0(b.length)} días con bloqueos, sumando todas` },
    { etiqueta: "Puntos de bloqueo en el peor día", valor: pico ? n0(pico.bloqueos) : "—", pie: pico ? `${fmtFecha(pico.fecha)}. Total nacional (Defensoría)` : "Sin datos en el período" },
    { etiqueta: "Hechos de violencia", valor: n0(v.length), pie: `${n0(v.filter((x) => x.bien === "Público").length)} contra bienes públicos` },
    { etiqueta: "Contra bienes privados", valor: n0(v.filter((x) => x.bien === "Privado").length), pie: v.length ? `${pct(v.filter((x) => x.bien === "Privado").length / v.length)} de los hechos` : "" },
  ]);
  // Bloqueos por día: provincias con bloqueos (por región) o puntos de bloqueo (Defensoría, nacional)
  document.getElementById("f-bloqueo").innerHTML = [["provincias", "Provincias con bloqueos"], ["puntos", "Puntos de bloqueo"]]
    .map(([k, e]) => `<button type="button" data-b="${k}" aria-pressed="${estado.bloqueo === k}">${e}</button>`).join("");
  let dd = dias();
  let valores = estado.bloqueo === "provincias"
    ? (() => { const m = contar(b, "fecha"); return dd.map((d) => m.get(d) ?? null); })()
    : (() => { const m = new Map(diario.map((x) => [x.fecha, x.bloqueos])); return dd.map((d) => m.get(d) ?? null); })();
  document.getElementById("d-bloqueos").textContent = estado.bloqueo === "provincias"
    ? `Provincias que tuvieron al menos una vía bloqueada cada día ${enLugar(estado.region)}.`
    : "Puntos de bloqueo en todo el país que reportó cada día la Defensoría del Pueblo (no se separan por región).";
  if (!valores.some((x) => x)) Obs.vacio("g-bloqueos");
  else {
    const [ini, fin] = conDatos(dd.length, [valores]);
    dd = dd.slice(ini, fin); valores = valores.slice(ini, fin);
    const g = Obs.grafico("g-bloqueos");
    const ancho = document.getElementById("g-bloqueos").clientWidth;
    const cada = Math.max(1, Math.ceil(dd.length / Math.max(4, Math.floor(ancho / 90))));
    g.setOption({
      textStyle: { fontFamily: C.fuente }, animation: ANIM,
      tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
        formatter: (ps) => `<strong>${fmtFecha(dd[ps[0].dataIndex])}</strong><br>${estado.bloqueo === "provincias" ? "Provincias con bloqueos" : "Puntos de bloqueo"}: <strong>${ps[0].value == null ? "sin dato" : n0(ps[0].value)}</strong>` },
      grid: { left: 40, right: 24, top: 12, bottom: 44 },
      xAxis: { type: "category", data: dd, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
        axisLabel: txt({ interval: (i) => i % cada === 0, formatter: etiquetaEje }) },
      yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
      series: [{ type: "bar", data: valores, barCategoryGap: "10%", itemStyle: { color: C.unica } }],
    }, true);
  }
  composicion("g-bien", [
    { clave: "Público", etiqueta: "Bienes públicos", valor: v.filter((x) => x.bien === "Público").length, color: C.categorias[0] },
    { clave: "Privado", etiqueta: "Bienes privados", valor: v.filter((x) => x.bien === "Privado").length, color: C.categorias[1] },
    { clave: "", etiqueta: "Sin dato", valor: v.filter((x) => !x.bien).length, color: C.otros },
  ], { unidad: "hechos" });
  const grupos = estado.region === NACIONAL ? contar(v, (x) => nombreRegion(x.region)) : contar(v, (x) => x.lugar ?? "Sin provincia");
  document.getElementById("d-violencia-lugar").textContent = estado.region === NACIONAL ? "Hechos de violencia por región." : `Hechos de violencia por provincia de ${nombreRegion(estado.region)}.`;
  barrasConteo("g-violencia-lugar", [...grupos].map(([k, x]) => [k, k, x]).sort((p, q) => q[2] - p[2]).slice(0, 15), { nombre: "Hechos", total: v.length });

  const q = sinTildeTxt(buscar.v.trim());
  const filas = v.filter((x) => !q || sinTildeTxt(`${x.hecho} ${x.lugar} ${nombreRegion(x.region)} ${x.actor}`).includes(q));
  tablaOrdenable("t-violencia-tabla", [
    { clave: "fecha", titulo: "Fecha", valor: (x) => x.fecha, html: (x) => fmtFecha(x.fecha) },
    { clave: "lugar", titulo: "Lugar", valor: (x) => `${nombreRegion(x.region)} ${x.lugar ?? ""}`, html: (x) => `${Obs.escapar(nombreRegion(x.region))}${x.lugar ? `<small>${Obs.escapar(x.lugar)}</small>` : ""}` },
    { clave: "hecho", titulo: "Hecho", valor: (x) => x.hecho, html: (x) => Obs.escapar(x.hecho) },
    { clave: "bien", titulo: "Bien", valor: (x) => x.bien, html: (x) => Obs.escapar(x.bien ?? "—") },
    { clave: "actor", titulo: "Quién", valor: (x) => x.actor, html: (x) => Obs.escapar(x.actor ?? "—") },
  ], filas, { inicial: { clave: "fecha", dir: 1 }, claveFila: (x) => `${x.fecha}${x.hecho}`, descripcion: `Hechos de violencia ${enLugar(estado.region)}` });
  document.getElementById("t-violencia").textContent = v.length === 1 ? "El hecho de violencia" : `Los ${n0(v.length)} hechos de violencia`;
}

/* ---------------------------------------------------------
   Pestaña: Estados de emergencia
   --------------------------------------------------------- */
const finInmov = (x) => new Date(+aFecha(x.inicio) + ((x.dias ?? 1) - 1) * DIA).toISOString().slice(0, 10);
function pintarEstado() {
  const ee = vigentes("emergencia"), im = D.inmovilizacion.map((x) => ({ ...x, fin: finInmov(x) })).filter((x) => x.inicio <= finPeriodo() && x.fin >= inicioPeriodo() && enRegion(x.region));
  const provEE = new Set(ee.map((x) => x.provincia ?? x.lugar)), provIM = new Set(im.map((x) => x.provincia ?? x.lugar));
  const regEE = new Set(ee.map((x) => x.region));
  document.getElementById("r-estado").innerHTML = (ee.length
    ? `${EnLugar(estado.region)}, ${periodoTxt()}, ${destacar(`${n0(provEE.size)} provincias`)} de ${n0(regEE.size)} ${regEE.size === 1 ? "región" : "regiones"} estuvieron en estado de emergencia, con ${n0(ee.length)} declaratorias y prórrogas.`
    : `${EnLugar(estado.region)} no hubo estados de emergencia vigentes ${periodoTxt()}.`) +
    (im.length ? ` En ${destacar(`${n0(provIM.size)} provincias`)} se dispuso la inmovilización social obligatoria.` : "") +
    (mensajesPeriodo().length ? ` Dina Boluarte dio ${n0(mensajesPeriodo().length)} ${mensajesPeriodo().length === 1 ? "mensaje" : "mensajes"} a la nación en ese período.` : "");
  const largo = ee.length ? Math.max(...ee.map((x) => x.dias ?? 0)) : 0;
  kpis("k-estado", [
    { etiqueta: "Provincias en estado de emergencia", valor: n0(provEE.size), pie: `De ${n0(regEE.size)} ${regEE.size === 1 ? "región" : "regiones"}` },
    { etiqueta: "Declaratorias y prórrogas", valor: n0(ee.length), pie: "Por provincia" },
    { etiqueta: "Provincias con inmovilización social", valor: n0(provIM.size), pie: `${n0(im.length)} medidas` },
    { etiqueta: "El estado de emergencia más largo", valor: largo ? `${n0(largo)} días` : "—", pie: "Contando las prórrogas" },
  ]);
  // ¿Cuándo y dónde? Semanas × regiones (o provincias de la región elegida); el color cuenta las provincias bajo la medida
  document.getElementById("f-medida").innerHTML = [["emergencia", "Estado de emergencia"], ["inmovilizacion", "Inmovilización social"]]
    .map(([k, e]) => `<button type="button" data-m="${k}" aria-pressed="${estado.medida === k}">${e}</button>`).join("");
  const lista = estado.medida === "emergencia" ? ee : im;
  const nombreMedida = estado.medida === "emergencia" ? "estado de emergencia" : "inmovilización social obligatoria";
  const porRegion = estado.region === NACIONAL;
  const claveFila = (x) => (porRegion ? x.region : x.provincia ?? x.lugar);
  const etiquetaFila = (k) => (porRegion ? nombreRegion(k) : PROV.get(k) ?? k);
  const provDe = (x) => x.provincia ?? x.lugar;
  let sem = semanas();
  const finSem = (s) => new Date(+aFecha(s) + 6 * DIA).toISOString().slice(0, 10);
  const enSemana = (x, s) => x.inicio <= finSem(s) && (x.fin ?? x.inicio) >= s;
  let claves = [...new Set(lista.map(claveFila))];
  let conteo = claves.map((k) => sem.map((s) => new Set(lista.filter((x) => claveFila(x) === k && enSemana(x, s)).map(provDe)).size));
  let totalSem = sem.map((s) => new Set(lista.filter((x) => enSemana(x, s)).map(provDe)).size);
  document.getElementById("d-estado").textContent = porRegion
    ? `Cada fila es una región y cada columna, una semana. El color indica cuántas de sus provincias estaban en ${nombreMedida}.`
    : `Cada fila es una provincia de ${nombreRegion(estado.region)} y cada columna, una semana: el color marca las semanas en que rigió la medida.`;
  const lEstado = document.getElementById("l-estado");
  if (!lista.length) {
    Obs.vacio("g-estado", `Sin ${nombreMedida} ${periodoTxt()}`);
    document.getElementById("g-estado").style.height = "";
    document.getElementById("ley-estado").innerHTML = ""; lEstado.textContent = "";
  } else {
    const [ini, fin] = conDatos(sem.length, [totalSem]);
    sem = sem.slice(ini, fin); totalSem = totalSem.slice(ini, fin); conteo = conteo.map((c) => c.slice(ini, fin));
    // Orden: primero las que entraron antes y, a igual fecha, las que sumaron más
    const orden = claves.map((k, i) => ({ k, c: conteo[i], primera: conteo[i].findIndex((v) => v), suma: conteo[i].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.primera - b.primera || b.suma - a.suma);
    claves = orden.map((o) => o.k); conteo = orden.map((o) => o.c);
    const maxC = Math.max(1, ...conteo.flat());
    const iPico = totalSem.indexOf(Math.max(...totalSem));
    const regPico = new Set(lista.filter((x) => enSemana(x, sem[iPico])).map((x) => x.region)).size;
    lEstado.innerHTML = `La medida alcanzó su mayor extensión la semana del ${destacar(fmtFecha(sem[iPico]))}, con ${destacar(`${n0(totalSem[iPico])} ${totalSem[iPico] === 1 ? "provincia" : "provincias"}`)}` +
      (porRegion ? ` de ${n0(regPico)} ${regPico === 1 ? "región" : "regiones"}` : "") + ` en ${nombreMedida}.`;
    const el = document.getElementById("g-estado");
    el.style.height = `${Math.max(200, claves.length * 26 + 70)}px`;
    const g = Obs.grafico("g-estado");
    g.resize();
    const ancho = el.clientWidth;
    const cada = Math.max(1, Math.ceil(sem.length / Math.max(3, Math.floor((ancho - 140) / 80))));
    const datos = [];
    conteo.forEach((c, y) => c.forEach((v, x) => v && datos.push([x, y, v])));
    g.setOption({
      textStyle: { fontFamily: C.fuente }, animation: ANIM,
      tooltip: { ...Obs.tooltipBase(), formatter: (p) => `<strong>${Obs.escapar(etiquetaFila(claves[p.value[1]]))}</strong><br>Semana del ${fmtFecha(sem[p.value[0]])}` +
        (porRegion ? `<br><strong>${n0(p.value[2])}</strong> ${p.value[2] === 1 ? "provincia" : "provincias"} en ${nombreMedida}` : `<br>En ${nombreMedida}`) },
      grid: { left: 130, right: 16, top: 8, bottom: 44 },
      xAxis: { type: "category", data: sem, splitArea: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
        axisLabel: txt({ interval: (i) => i % cada === 0, formatter: etiquetaEje }) },
      yAxis: { type: "category", data: claves.map(etiquetaFila), inverse: true, axisTick: { show: false }, axisLine: { show: false },
        splitLine: { show: true, lineStyle: { color: C.linea, opacity: 0.5 } }, axisLabel: txt({ color: C.texto, width: 120, overflow: "truncate" }), triggerEvent: porRegion },
      visualMap: { show: false, min: 1, max: Math.max(2, maxC), inRange: { color: maxC > 1 ? C.escala.slice(1) : [C.escala[3], C.escala[3]] } },
      series: [{ type: "heatmap", data: datos, cursor: porRegion ? "pointer" : "default", itemStyle: { borderColor: "#fff", borderWidth: 1, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: C.texto, borderWidth: 1 } } }],
    }, true);
    g.off("click");
    if (porRegion) g.on("click", (p) => { const y = p.componentType === "yAxis" ? claves.findIndex((k) => etiquetaFila(k) === p.value) : p.value?.[1]; if (y >= 0 && claves[y]) elegirRegion(claves[y]); });
    document.getElementById("ley-estado").innerHTML = porRegion && maxC > 1
      ? `<div class="ley-continua"><span>1</span><i style="background:linear-gradient(90deg,${C.escala.slice(1).join(",")})"></i><span>${n0(maxC)} provincias</span></div>` : "";
  }
  const q = sinTildeTxt(buscar.e.trim());
  const filas = [...ee.map((x) => ({ ...x, tipo: "Estado de emergencia" })), ...im.map((x) => ({ ...x, tipo: "Inmovilización social obligatoria" }))]
    .filter((x) => !q || sinTildeTxt(`${x.lugar} ${nombreRegion(x.region)}`).includes(q));
  tablaOrdenable("t-medidas-tabla", [
    { clave: "tipo", titulo: "Medida", valor: (x) => x.tipo, html: (x) => Obs.escapar(x.tipo) },
    { clave: "lugar", titulo: "Provincia", valor: (x) => x.lugar, html: (x) => `<strong>${Obs.escapar(x.lugar ?? "—")}</strong><small>${Obs.escapar(nombreRegion(x.region))}</small>` },
    { clave: "inicio", titulo: "Inicio", valor: (x) => x.inicio, html: (x) => fmtFecha(x.inicio) },
    { clave: "fin", titulo: "Fin", valor: (x) => x.fin, html: (x) => fmtFecha(x.fin) },
    { clave: "dias", titulo: "Días", num: true, valor: (x) => x.dias, html: (x) => (x.dias == null ? "—" : n0(x.dias)) },
  ], filas, { inicial: { clave: "inicio", dir: 1 }, claveFila: (x) => `${x.tipo}${x.inicio}${x.lugar}`, descripcion: `Medidas de excepción ${enLugar(estado.region)}` });
  document.getElementById("t-medidas").textContent = `Las ${n0(filas.length)} medidas, una por una`;
  pintarDiscursos();
}

/* Mensajes a la nación de Dina Boluarte (no cambian con la región).
   Temas: clasificación del Observatorio para este tablero */
const TEMAS = [
  ["Diálogo y unidad", "diálogo dialogar conversar concertación consensos consensuado acuerdo entendimiento unidad unido juntos paz calma tranquilidad tregua reconciliación hermanos hermanas perdón puentes"],
  ["Elecciones y reformas", "elecciones elección electoral adelanto adelantar anticipadas congreso congresistas parlamento reforma reformas constitución constitucional constitucionales constituyente asamblea ley leyes voto transición generales plancha"],
  ["Orden y violencia", "violencia orden ordenada desorden caos policía fuerzas armadas seguridad control emergencia excepción declaratoria actos violentistas extremistas radicales azuzadores municiones aeropuertos confrontación odio"],
  ["Víctimas y derechos", "vida muerte muertes fallecidos fallecimiento víctimas sangres condolencias lamento familias familia familiares derechos derecho humanos justicia investigaciones investigue salud dolor"],
  ["Demandas sociales", "demandas demanda pobreza pobres excluidos exclusiones necesidades preocupaciones indignación protesta agua educación agricultura heladas desarrollo crecimiento económico economía regiones sur puno apurímac andahuaylas"],
].map(([nombre, palabras], i) => ({ nombre, palabras: new Set(palabras.split(" ")), i }));
const temaDe = (w) => TEMAS.find((t) => t.palabras.has(w)) ?? null;
const colorTema = (t) => (t ? C.categorias[t.i] : "#5b6577");
const mensajesPeriodo = () => D.mensajes.filter((m) => enPeriodo(m.fecha));
const muertosHasta = (f) => D.fallecidos.filter((x) => x.fecha <= f).length;
function pintarDiscursos() {
  const ms = mensajesPeriodo();
  if (estado.mensaje && !ms.some((m) => m.fecha === estado.mensaje)) estado.mensaje = "";
  const lm = document.getElementById("lm");
  const lPal = document.getElementById("l-palabra");
  if (!ms.length) {
    lm.innerHTML = `<p class="vacio-comp">No hubo mensajes a la nación en el período elegido. Los mensajes registrados van del 7 de diciembre de 2022 al 29 de enero de 2023.</p>`;
    ["nube", "ley-temas", "d-temas"].forEach((id) => (document.getElementById(id).innerHTML = ""));
    Obs.vacio("g-temas"); Obs.vacio("g-evolucion"); lPal.textContent = "";
    return;
  }
  // Línea de tiempo de los mensajes
  lm.innerHTML = `<button type="button" class="todos" data-f="" aria-pressed="${!estado.mensaje}"><i class="punto"></i><strong>Todos</strong><span>${n0(ms.length)} mensajes</span></button>` +
    ms.map((m, i) => { const muertos = muertosHasta(m.fecha);
      return `<button type="button" data-f="${m.fecha}" aria-pressed="${estado.mensaje === m.fecha}"><i class="punto"></i><strong>${fmtFecha(m.fecha)}</strong><span>${n0(m.palabras)} palabras</span><span class="muertes">${muertos ? `${n0(muertos)} ${muertos === 1 ? "fallecido" : "fallecidos"}` : "Sin fallecidos aún"}</span></button>`; }).join("");
  lm.querySelectorAll("button").forEach((b) => (b.onclick = () => { estado.mensaje = b.dataset.f; render(); }));

  // Conteos por mensaje
  const fms = ms.map((m) => m.fecha);
  const largo = new Map(ms.map((m) => [m.fecha, m.palabras]));
  const porPal = new Map();
  D.palabras.forEach((p) => { if (largo.has(p.fecha)) { if (!porPal.has(p.palabra)) porPal.set(p.palabra, new Map()); porPal.get(p.palabra).set(p.fecha, p.n); } });
  const elegidos = estado.mensaje ? [estado.mensaje] : fms;
  const total = elegidos.reduce((s, f) => s + largo.get(f), 0);
  const veces = (w, fechas = elegidos) => fechas.reduce((s, f) => s + (porPal.get(w)?.get(f) ?? 0), 0);

  // Nube: las 40 palabras más dichas, las grandes al centro
  const chico = document.getElementById("nube").clientWidth < 500;
  const top = [...porPal.keys()].map((w) => [w, veces(w)]).filter(([, v]) => v).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, chico ? 24 : 40);
  const vmax = top[0]?.[1] ?? 1, vmin = top.at(-1)?.[1] ?? 1;
  const tam = (v) => Math.round(15 + (chico ? 15 : 27) * Math.sqrt((v - vmin) / Math.max(1, vmax - vmin)));
  const centro = []; top.forEach((x, i) => (i % 2 ? centro.push(x) : centro.unshift(x)));
  const q = sinTildeTxt(estado.palabra.trim());
  const buscada = q ? [...porPal.keys()].find((w) => sinTildeTxt(w) === q) : null;
  document.getElementById("t-nube").textContent = estado.mensaje ? `Sus palabras el ${fmtFecha(estado.mensaje)}` : "Sus palabras en todos los mensajes";
  const nube = document.getElementById("nube");
  nube.innerHTML = centro.map(([w, v]) => `<button type="button" data-w="${Obs.escapar(w)}" aria-pressed="${w === buscada}" style="font-size:${tam(v)}px;color:${colorTema(temaDe(w))}" title="${Obs.escapar(w)}: ${n0(v)} ${v === 1 ? "vez" : "veces"}">${Obs.escapar(w)}</button>`).join("");
  nube.querySelectorAll("button").forEach((b) => (b.onclick = () => { estado.palabra = estado.palabra === b.dataset.w ? "" : b.dataset.w; document.getElementById("f-palabra").value = estado.palabra; render(); }));
  document.getElementById("ley-temas").innerHTML = [...TEMAS.map((t) => [t.nombre, colorTema(t)]), ["Otras palabras", colorTema(null)]].map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");

  // Temas del mensaje elegido, frente al promedio de todos
  const pesoTema = (t, fechas) => { const tot = fechas.reduce((s, f) => s + largo.get(f), 0); let n = 0; t.palabras.forEach((w) => (n += veces(w, fechas))); return tot ? (100 * n) / tot : 0; };
  const temasSel = TEMAS.map((t) => pesoTema(t, elegidos)), temasTodos = TEMAS.map((t) => pesoTema(t, fms));
  document.getElementById("t-temas").textContent = estado.mensaje ? `¿De qué temas habló el ${fmtFecha(estado.mensaje)}?` : "¿De qué temas habló?";
  document.getElementById("d-temas").textContent = estado.mensaje ? "Palabras de cada tema por cada 100 palabras del mensaje. La raya marca el promedio de todos los mensajes." : "Palabras de cada tema por cada 100 palabras de los mensajes.";
  const gt = Obs.grafico("g-temas");
  gt.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => { const i = ps[0].dataIndex; return `<strong>${TEMAS[i].nombre}</strong><br>${estado.mensaje ? "Este mensaje" : "Todos los mensajes"}: <strong>${Obs.fmtN(temasSel[i], 1)}</strong> de cada 100 palabras` + (estado.mensaje ? `<br>Promedio de todos: ${Obs.fmtN(temasTodos[i], 1)}` : ""); } },
    grid: { left: 150, right: 40, top: 4, bottom: 8 },
    xAxis: { type: "value", show: false, max: Math.max(...temasSel, ...temasTodos) * 1.15 },
    yAxis: { type: "category", inverse: true, data: TEMAS.map((t) => t.nombre), axisTick: { show: false }, axisLine: { show: false }, axisLabel: txt({ color: C.texto }) },
    series: [
      { type: "bar", barMaxWidth: 22, data: temasSel.map((v, i) => ({ value: v, itemStyle: { color: C.categorias[i], borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: "right", fontFamily: C.fuente, fontSize: 14, fontWeight: 700, color: C.texto, formatter: (p) => Obs.fmtN(p.value, 1) } },
      ...(estado.mensaje ? [{ type: "scatter", symbol: "rect", symbolSize: [3, 30], data: temasTodos, itemStyle: { color: C.texto }, z: 5, tooltip: { show: false } }] : []),
    ],
  }, true);

  // Evolución de los temas (y la palabra buscada) de un mensaje a otro
  if (q && !buscada) lPal.innerHTML = `No dijo «${Obs.escapar(estado.palabra.trim())}» en sus mensajes ${periodoTxt()}.`;
  else if (buscada) {
    const lista = fms.map((f) => [f, porPal.get(buscada).get(f) ?? 0]).filter(([, v]) => v);
    const tema = temaDe(buscada);
    lPal.innerHTML = `Dijo ${destacar(`«${Obs.escapar(buscada)}»`)} ${n0(veces(buscada, fms))} ${veces(buscada, fms) === 1 ? "vez" : "veces"}: ` + lista.map(([f, v]) => `${n0(v)} el ${fmtFecha(f)}`).join(", ") + "." +
      (tema ? ` Es del tema «${tema.nombre}».` : "");
  } else lPal.textContent = "";
  document.getElementById("lista-palabras").innerHTML = [...porPal.keys()].sort((a, b) => a.localeCompare(b, "es")).map((w) => `<option value="${Obs.escapar(w)}">`).join("");
  const ge = Obs.grafico("g-evolucion");
  const angosto = document.getElementById("g-evolucion").clientWidth < 560;
  const iSel = fms.indexOf(estado.mensaje);
  const serie = (nombre, datos, color, extra = {}) => ({ name: nombre, type: "line", data: datos, symbol: "circle", symbolSize: 9, lineStyle: { width: 2.5, color }, itemStyle: { color }, emphasis: { focus: "series" }, ...extra });
  ge.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    legend: { top: 0, left: 0, icon: "circle", itemWidth: 10, itemHeight: 10, textStyle: txt() },
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => { const f = fms[ps[0].dataIndex];
        return `<strong>Mensaje del ${fmtFecha(f)}</strong><br>${n0(largo.get(f))} palabras · ${n0(muertosHasta(f))} fallecidos hasta ese día` +
          [...ps].sort((a, b) => b.value - a.value).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${Obs.fmtN(p.value, 1)}</strong>`).join(""); } },
    grid: { left: 40, right: 24, top: angosto ? 96 : 56, bottom: 44 },
    xAxis: { type: "category", data: fms, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: 0, formatter: (f) => { const t = angosto ? `${+f.slice(8)}/${+f.slice(5, 7)}\n’${f.slice(2, 4)}` : fmtFecha(f).replace(" 20", "\n20"); return f === estado.mensaje ? `{b|${t}}` : t; },
        rich: { b: { fontWeight: 800, color: C.texto, fontSize: 14, fontFamily: C.fuente } } }) },
    yAxis: { type: "value", name: "por cada 100 palabras", nameTextStyle: txt({ align: "left" }), splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    series: [
      ...TEMAS.map((t) => serie(t.nombre, fms.map((f) => pesoTema(t, [f])), C.categorias[t.i],
        t.i === 0 && iSel >= 0 ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.navy ?? C.texto, width: 1, type: "solid", opacity: 0.4 }, data: [{ xAxis: iSel }] } } : {})),
      ...(buscada ? [serie(`«${buscada}»`, fms.map((f) => (100 * (porPal.get(buscada).get(f) ?? 0)) / largo.get(f)), C.texto, { lineStyle: { width: 3, type: "dashed", color: C.texto }, symbol: "diamond", symbolSize: 12, z: 10 })] : []),
    ],
  }, true);
  ge.off("click");
  ge.on("click", (p) => { const f = fms[p.dataIndex]; estado.mensaje = estado.mensaje === f ? "" : f; render(); });
}

/* ---------------------------------------------------------
   Tabla ordenable (cada columna ordena de mayor a menor o al revés)
   --------------------------------------------------------- */
const ORDEN = {}; // id de tabla -> { clave, dir }
function tablaOrdenable(id, columnas, filas, { inicial, claveFila = () => "", elegida = null, pie = "", descripcion, alClic = null }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const datos = [...filas].sort((a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null); // los vacíos, al final
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  });
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    return `<th class="${c.num ? "num" : ""}" aria-sort="${activo ? (orden.dir === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const LIMITE = 400;
  const tr = datos.slice(0, LIMITE).map((f) => {
    const k = String(claveFila(f));
    return `<tr data-k="${Obs.escapar(k)}"${alClic ? ' tabindex="0"' : ""}${k && k === elegida ? ' class="elegida"' : ""}>` + columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(f)}</td>`).join("") + "</tr>";
  }).join("");
  el.innerHTML = datos.length
    ? `<table class="tabla ordenable centrada"><caption class="solo-lectores">${Obs.escapar(descripcion)}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ""}</table>` +
      (datos.length > LIMITE ? `<p class="pista" style="padding:8px 12px">Se muestran ${LIMITE} de ${n0(datos.length)}. Usa los filtros para ver las demás.</p>` : "")
    : '<p class="pista" style="padding:12px">Ninguna fila coincide con los filtros.</p>';
  if (!datos.length) return;
  el.querySelector("thead").onclick = (e) => {
    const b = e.target.closest("button[data-orden]");
    if (!b) return;
    const c = columnas.find((x) => x.clave === b.dataset.orden);
    ORDEN[id] = orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: c.num ? -1 : 1 };
    tablaOrdenable(id, columnas, filas, { inicial, claveFila, elegida, pie, descripcion, alClic });
    el.querySelector(`button[data-orden="${c.clave}"]`)?.focus();
  };
  if (alClic) {
    const ir = (e) => { const r = e.target.closest("tbody tr[data-k]"); if (r && (e.type === "click" || e.key === "Enter")) alClic(r.dataset.k); };
    el.querySelector("tbody").onclick = ir;
    el.querySelector("tbody").onkeydown = ir;
  }
}
const sinTilde = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ---------------------------------------------------------
   Mapa por región o provincia, con su tabla
   --------------------------------------------------------- */
// Indicadores del mapa: filas del período (todas las regiones) y si se pueden ver por provincia
const IND = {
  victimas: [
    { id: "fallecidos", nombre: "Personas fallecidas", provincial: true, filas: () => filtrar("fallecidos", "fecha", { region: false }),
      categorias: () => CIRCUNSTANCIAS.map((c, i) => [c, c, [C.categorias[1], C.categorias[0]][i]]), categoria: (x) => x.circunstancia },
    { id: "heridos", nombre: "Heridos atendidos (comunicados del Minsa)", suma: "heridos",
      filas: () => D.heridos_region.filter((x) => x.inicio <= finPeriodo() && x.fin >= inicioPeriodo()) },
  ],
  protestas: [
    { id: "acciones", nombre: "Acciones de protesta", provincial: true, filas: () => filtrar("acp", "fecha", { region: false }) },
    ...TIPOS.slice(0, 4).map((t, i) => ({ id: `tipo${i}`, nombre: ETIQ_TIPO[t] ?? t, provincial: true, filas: () => filtrar("acp", "fecha", { region: false }).filter((x) => x.tipo === t) })),
  ],
  bloqueos: [
    { id: "bloqueos", nombre: "Días con vías bloqueadas", provincial: true, filas: () => filtrar("bloqueos", "fecha", { region: false }) },
    { id: "violencia", nombre: "Hechos de violencia", provincial: true, filas: () => filtrar("violencia", "fecha", { region: false }) },
  ],
  estado: [
    { id: "emergencia", nombre: "Declaratorias y prórrogas de estado de emergencia", provincial: true, color: () => C.categorias[0],
      filas: () => D.emergencia.filter((x) => x.inicio <= finPeriodo() && (x.fin ?? x.inicio) >= inicioPeriodo()) },
    { id: "inmovilizacion", nombre: "Medidas de inmovilización social obligatoria", provincial: true, color: () => C.categorias[1],
      filas: () => D.inmovilizacion.filter((x) => x.inicio <= finPeriodo() && finInmov(x) >= inicioPeriodo()) },
  ],
};
const mapas = {}, GEOS = {}, CENTROS = {};
// Provincia de una fila: los fallecidos traen el nombre en «provincia» y el código en «ubigeo»
const codProvincia = (x) => ("ubigeo" in x ? x.ubigeo : x.provincia);
let PROV = new Map(), NOMBRE_MAPA = new Map();

async function geoDe(nivel) {
  if (nivel === "regional") return GEO;
  if (!GEOS[nivel]) {
    const g = await Obs.cargarJSON("../../mapas/peru_provincias.geojson");
    GEOS[nivel] = { ...g, features: [...GEO.features.filter((f) => f.properties.tipo === "pais"), ...g.features] };
  }
  return GEOS[nivel];
}

async function pintarMapa() {
  const lista = IND[estado.modulo];
  const ind = lista.find((i) => i.id === estado.mapa[estado.modulo]) ?? lista[0];
  const nivel = ind.provincial ? nivelMapa() : "regional";
  document.getElementById("f-mapa").innerHTML = lista.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  document.getElementById("f-nivel-mapa").innerHTML = [["regional", "Región"], ["provincial", "Provincia"]]
    .filter(([n]) => n === "regional" || ind.provincial).map(([n, e]) => `<button type="button" data-nivel="${n}" aria-pressed="${n === nivel}">${e}</button>`).join("");
  const filas = ind.filas();
  const suma = (lista) => (ind.suma ? lista.reduce((s, x) => s + (x[ind.suma] ?? 0), 0) : lista.length);
  const grupos = new Map();
  for (const x of filas) {
    const k = nivel === "regional" ? x.region : codProvincia(x);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(x);
  }
  const unidades = [...grupos].map(([k, l]) => ({ codigo: k, region: nivel === "regional" ? k : l[0].region, v: suma(l) }));
  NOMBRE_MAPA = new Map(unidades.map((u) => [u.codigo, nivel === "regional" ? nombreRegion(u.codigo) : `${PROV.get(u.codigo) ?? u.codigo} (${nombreRegion(u.region)})`]));
  ["regional", "provincial"].forEach((n) => (document.getElementById(`mapa-${n}`).hidden = n !== nivel));
  const geo = await geoDe(nivel);
  if (!mapas[nivel]) mapas[nivel] = new Obs.Mapa(`mapa-${nivel}`, geo, { alClic: (c) => (nivel === "regional" ? elegirRegion(c) : null), nombre: (c) => NOMBRE_MAPA.get(c) ?? PROV.get(c) ?? NOMBRES[c] ?? c });
  // Fallecidos: burbujas (área proporcional al número). Lo demás: coroplético con escala continua
  const conBurbujas = estado.modulo === "victimas";
  const elegidaMapa = nivel === "regional" ? estado.region : null;
  document.getElementById("d-mapa").textContent = (conBurbujas
    ? "Cada burbuja es una región o provincia: cuanto más grande, más casos en el período elegido."
    : `Cada ${nivel === "regional" ? "región" : "provincia"} se colorea según el indicador elegido, en el período elegido: cuanto más oscura, más casos.`) +
    " Lima Metropolitana y el Callao se muestran ampliados en el recuadro.";
  if (conBurbujas) {
    // Fondo claro y parejo; el valor se lee en las burbujas (área proporcional al número)
    const valores = new Map(geo.features.filter((f) => f.properties.tipo !== "pais").map((f) => [f.properties.region, 0]));
    unidades.forEach((u) => valores.set(u.codigo, u.v));
    mapas[nivel].pintar({ valores, color: () => "#e8ecf2", texto: (v) => n0(v), elegida: nivel === "regional" ? estado.region : null });
    const centros = (CENTROS[nivel] ??= Obs.centroides(geo));
    const cats = ind.categorias ? ind.categorias() : [[null, ind.nombre, ind.color ? ind.color() : C.unica]];
    const porCat = (u) => cats.map(([c, nombre, color]) => ({ nombre, color, v: c == null ? u.v : suma(grupos.get(u.codigo).filter((x) => ind.categoria(x) === c)) }));
    const maxB = Math.max(1, ...unidades.flatMap((u) => porCat(u).map((b) => b.v)));
    const rMax = nivel === "regional" ? 30 : 22;
    const radio = (v) => rMax * Math.sqrt(v / maxB);
    mapas[nivel].burbujas(unidades.filter((u) => centros.has(u.codigo)).flatMap((u) => {
      const partes = porCat(u);
      const texto = `<strong>${Obs.escapar(NOMBRE_MAPA.get(u.codigo))}</strong><br>` + (cats.length > 1
        ? partes.map((b) => `<span style="color:${b.color}">●</span> ${Obs.escapar(b.nombre)}: <b>${n0(b.v)}</b>`).join("<br>") + `<br>Total: <b>${n0(u.v)}</b>`
        : `${Obs.escapar(ind.nombre)}: <b>${n0(u.v)}</b>`);
      const [lat, lon] = centros.get(u.codigo);
      return partes.filter((b) => b.v).map((b) => ({ lat, lon, radio: radio(b.v), color: b.color, texto, alClic: () => elegirRegion(u.region) }));
    }));
    // Leyenda: tamaños de referencia y colores
    const refs = [...new Set([maxB, Math.round(maxB / 4), Math.round(maxB / 20)].filter((v) => v >= 1))];
    document.getElementById("ley-mapa").innerHTML = unidades.length
      ? `<div class="ley-burbujas">${refs.map((v) => { const r = Math.max(3, radio(v)); return `<span><svg width="${2 * r + 2}" height="${2 * r + 2}" aria-hidden="true"><circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="none" stroke="#5b6577" stroke-width="1.2"/></svg>${n0(v)}</span>`; }).join("")}</div>` +
        (cats.length > 1 ? `<div class="ley">${cats.map(([, n, c]) => `<span><i style="background:${c}"></i>${Obs.escapar(n)}</span>`).join("")}</div>` : "")
      : "";
  } else {
    const maxV = Math.max(1, ...unidades.map((u) => u.v));
    // Sin registros es cero, salvo los heridos del Minsa, que no cubren todas las regiones
    const valores = new Map(ind.suma ? [] : geo.features.filter((f) => f.properties.tipo !== "pais").map((f) => [f.properties.region, 0]));
    unidades.forEach((u) => valores.set(u.codigo, u.v));
    mapas[nivel].pintar({ valores, color: (v) => colorContinuo(v / maxV), texto: (v) => n0(v), elegida: elegidaMapa });
    mapas[nivel].burbujas([]);
    document.getElementById("ley-mapa").innerHTML = unidades.length ? leyendaContinua(maxV) : "";
  }
  const total = unidades.reduce((s, u) => s + u.v, 0);
  const orden = [...unidades].sort((a, b) => b.v - a.v);
  document.getElementById("l-mapa").innerHTML = orden.length
    ? `${ind.nombre}, ${periodoTxt()}: ${destacar(n0(total))} en ${n0(orden.length)} ${nivel === "regional" ? (orden.length === 1 ? "región" : "regiones") : (orden.length === 1 ? "provincia" : "provincias")}. ` +
      `La que más tiene es ${destacar(NOMBRE_MAPA.get(orden[0].codigo))} (${n0(orden[0].v)}, ${pct(orden[0].v / total)}).`
    : `No hay registros de «${ind.nombre.toLowerCase()}» ${periodoTxt()}.`;
  document.getElementById("n-mapa").textContent = ind.id === "heridos" ? "En los comunicados del Minsa, «Lima» se muestra como Lima Metropolitana." : "";
  const columnas = [
    { clave: "region", titulo: "Región", valor: (u) => nombreRegion(u.region), html: (u) => Obs.escapar(nombreRegion(u.region)) },
    ...(nivel === "provincial" ? [{ clave: "prov", titulo: "Provincia", valor: (u) => PROV.get(u.codigo) ?? u.codigo, html: (u) => `<strong>${Obs.escapar(PROV.get(u.codigo) ?? u.codigo)}</strong>` }] : []),
    { clave: "v", titulo: "Número", num: true, valor: (u) => u.v, html: (u) => n0(u.v) },
    { clave: "p", titulo: "% del total", num: true, valor: (u) => u.v / (total || 1), html: (u) => pct(u.v / (total || 1)) },
  ];
  tablaOrdenable("t-mapa", columnas, unidades, { inicial: { clave: "v", dir: -1 }, claveFila: (u) => u.codigo, elegida: nivel === "regional" ? estado.region : null,
    descripcion: `${ind.nombre} por ${nivel === "regional" ? "región" : "provincia"}`, alClic: nivel === "regional" ? elegirRegion : null });
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  if (estado.desde > estado.hasta) estado.hasta = estado.desde;
  render();
}
function elegirRegion(cod) {
  if (cod === NACIONAL || cod === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: cod });
}

function render() {
  controles.sincronizar(estado);
  document.getElementById("f-desde").value = estado.desde;
  document.getElementById("f-hasta").value = estado.hasta;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  document.querySelectorAll(".abajo").forEach((el) => (el.hidden = el.dataset.modulo !== estado.modulo));
  ({ victimas: pintarVictimas, protestas: pintarProtestas, bloqueos: pintarBloqueos, estado: pintarEstado })[estado.modulo]();
  pintarMapa();
  Obs.escribirURL({
    modulo: estado.modulo === "victimas" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    desde: estado.desde === MESES_LISTA[0] ? null : estado.desde,
    hasta: estado.hasta === MESES_LISTA.at(-1) ? null : estado.hasta,
    mapa: estado.mapa[estado.modulo] ?? null,
    nivel: estado.nivel[estado.modulo] && estado.nivel[estado.modulo] !== NIVEL_INICIAL[estado.modulo] ? estado.nivel[estado.modulo] : null,
    medida: estado.modulo === "estado" && estado.medida !== "emergencia" ? estado.medida : null,
    mensaje: estado.modulo === "estado" && estado.mensaje ? estado.mensaje : null,
    palabra: estado.modulo === "estado" && estado.palabra ? estado.palabra : null,
  });
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar(TABLERO, async () => {
  const [datos, geo, prov] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson"), Obs.cargarJSON("../../mapas/peru_provincias.geojson")]);
  GEO = geo;
  C = Obs.tema();
  D = Object.fromEntries(Object.entries(datos.tablas).map(([k, t]) => [k, Obs.expandir(t)]));
  PROV = new Map(prov.features.map((f) => [f.properties.region, titulo(f.properties.nombre)]));

  // Meses del período: de la primera a la última fecha con datos
  const fechas = [...D.acp.map((x) => x.fecha), ...D.fallecidos.map((x) => x.fecha), ...D.bloqueos.map((x) => x.fecha), ...D.emergencia.map((x) => x.inicio)].filter(Boolean).sort();
  for (let [a, m] = fechas[0].split("-").map(Number); `${a}-${String(m).padStart(2, "0")}` <= mesDe(fechas.at(-1)); m === 12 ? (a++, m = 1) : m++) MESES_LISTA.push(`${a}-${String(m).padStart(2, "0")}`);
  Object.assign(estado, { desde: MESES_LISTA[0], hasta: MESES_LISTA.at(-1) });
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  // Estado inicial desde la URL
  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const reg = (q.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) Object.assign(estado, { ambito: "regional", region: reg });
  if (MESES_LISTA.includes(q.get("desde"))) estado.desde = q.get("desde");
  if (MESES_LISTA.includes(q.get("hasta"))) estado.hasta = q.get("hasta");
  if (IND[estado.modulo].some((i) => i.id === q.get("mapa"))) estado.mapa[estado.modulo] = q.get("mapa");
  if (["regional", "provincial"].includes(q.get("nivel"))) estado.nivel[estado.modulo] = q.get("nivel");
  if (q.get("medida") === "inmovilizacion") estado.medida = "inmovilizacion";
  if (D.mensajes.some((m) => m.fecha === q.get("mensaje"))) estado.mensaje = q.get("mensaje");
  estado.palabra = (q.get("palabra") || "").slice(0, 40);
  document.getElementById("f-palabra").value = estado.palabra;
  document.getElementById("f-palabra").oninput = (e) => { estado.palabra = e.target.value; clearTimeout(window.__p); window.__p = setTimeout(render, 250); };

  // Filtros: región (Obs.controlesComunes) y período por meses
  const filtros = document.getElementById("filtros");
  controles = Obs.controlesComunes(filtros, { regiones: Object.entries(NOMBRES).map(([region, nombre]) => ({ region, nombre })), anios: [2022, 2024], alCambiar: actualizar, comparar: false, periodo: false });
  const opcion = (m) => `<option value="${m}">${MESES_C[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`;
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <span class="etiqueta" id="lbl-periodo">Período</span>
      <div class="rango" role="group" aria-labelledby="lbl-periodo">
        <select id="f-desde" class="corto" aria-label="Desde">${MESES_LISTA.map(opcion).join("")}</select><span>a</span>
        <select id="f-hasta" class="corto" aria-label="Hasta">${MESES_LISTA.map(opcion).join("")}</select>
      </div>
    </div>`);
  document.getElementById("f-desde").onchange = (e) => actualizar({ desde: e.target.value });
  document.getElementById("f-hasta").onchange = (e) => { const h = e.target.value; actualizar({ hasta: h, desde: estado.desde > h ? h : estado.desde }); };

  document.getElementById("f-mapa").onchange = (e) => { estado.mapa[estado.modulo] = e.target.value; render(); };
  document.getElementById("f-nivel-mapa").onclick = (e) => { const b = e.target.closest("button[data-nivel]"); if (b) { estado.nivel[estado.modulo] = b.dataset.nivel; render(); } };
  document.getElementById("f-medida").onclick = (e) => { const b = e.target.closest("button[data-m]"); if (b) { estado.medida = b.dataset.m; render(); } };
  document.getElementById("f-bloqueo").onclick = (e) => { const b = e.target.closest("button[data-b]"); if (b) { estado.bloqueo = b.dataset.b; render(); } };
  [["f-buscar-f", "f", pintarVictimas], ["f-buscar-v", "v", pintarBloqueos], ["f-buscar-e", "e", pintarEstado]].forEach(([id, k, f]) => {
    document.getElementById(id).oninput = (e) => { buscar[k] = e.target.value; clearTimeout(window.__b); window.__b = setTimeout(f, 200); };
  });

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => { // flechas para moverse entre pestañas
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso) return;
      const sig = pestanas[(i + paso + pestanas.length) % pestanas.length];
      sig.focus();
      sig.click();
    };
  });

  Obs.descarga({ archivos: ARCHIVOS });
  let espera, anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });
  render();
});
