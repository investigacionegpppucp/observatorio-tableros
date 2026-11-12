/* =========================================================
   Tablero de Coronavirus — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma procesos/coronavirus/procesar.py desde
   el Excel de COVID-19 del Minsa (corte a agosto de 2024). Tablas:
     positivos, fallecidos  una fila por región (y NACIONAL), con total,
                            hombres, mujeres, grupos de edad y población
     vacunados              lo mismo, por dosis
     fabricantes            vacunas por región, dosis y fabricante

   Patrón: un objeto `estado`, funciones puras de consulta y una sola
   función `render()`.

   Parámetros de URL:
     ?modulo=vacunas&region=PUNO&dosis=3&mapa=cobertura&verpor=sexo&medida=pct
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "coronavirus";
const ARCHIVOS = [{ clave: "coronavirus_base", etiqueta: "COVID-19: casos positivos, fallecidos y vacunados por región (corte a agosto de 2024)" }];
const NACIONAL = "NACIONAL";
const MODULOS = ["positivos", "fallecidos", "vacunas"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const EDADES = [
  ["menor", "Menores de 18 años"], ["e_18_29", "De 18 a 29 años"], ["e_30_44", "De 30 a 44 años"], ["e_45_59", "De 45 a 59 años"],
  ["e_60_75", "De 60 a 75 años"], ["m_75", "Más de 75 años"], ["no_indica", "Sin dato"],
];
const OTRAS = 5; // desde la 5.ª dosis se agrupan: casi nadie recibió más
const nombreDosis = (d) => (d === OTRAS ? "5.ª dosis o más" : `${d}.ª dosis`);
const cortoDosis = (d) => (d === OTRAS ? "5.ª o más" : `${d}.ª`);
const SEXOS = [["mujeres", "Mujeres", "--serie-4"], ["hombres", "Hombres", "--serie-5"]];
const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca", CALLAO: "Callao",
  CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad", LAMBAYEQUE: "Lambayeque",
  "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto", "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua",
  PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno", "SAN MARTIN": "San Martín", TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};

const estado = { modulo: "positivos", region: NACIONAL, dosis: 1, mapa: {}, verPor: "edad", medida: "numero" };
let D = {}, C, mapa, REGIONES = [], DOSIS = [];

const n0 = (v) => Obs.fmtN(v, 0);
const pct = (v) => (v == null || !isFinite(v) ? "—" : Obs.fmtPct(v, 1));
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const nombreRegion = (c) => (c === NACIONAL ? "Perú" : NOMBRES[c] ?? c);
const enAmbito = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnAmbito = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombreRegion(c)}`);
const destacar = (s) => `<strong>${s}</strong>`;
const lista = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const $ = (s) => document.querySelector(s);

/* ---------- Consultas ---------- */
const caso = (tabla, reg) => D[tabla].find((f) => f.region === reg) ?? null;
// Personas vacunadas con una dosis. «5.ª o más» son quienes recibieron la 5.ª (quien tiene la 6.ª ya tuvo la 5.ª)
function vacuna(reg, dosis) {
  const filas = D.vacunados.filter((f) => f.region === reg && f.dosis === dosis);
  if (!filas.length) return null;
  const s = { region: reg, dosis, poblacion: filas[0].poblacion };
  for (const k of ["total", "hombres", "mujeres", ...EDADES.map((e) => e[0])]) s[k] = filas.reduce((a, f) => a + f[k], 0);
  return s;
}
const tasaPos = (f) => (f ? (100 * f.total) / f.poblacion : null); // por cada 100 habitantes
const tasaFal = (f) => (f ? (10000 * f.total) / f.poblacion : null); // por cada 10 000
const letalidad = (reg) => { const p = caso("positivos", reg), f = caso("fallecidos", reg); return p && f ? f.total / p.total : null; };
const grupoMayorClave = (f) => EDADES.slice(0, 6).reduce((m, [k]) => (f[k] > f[m] ? k : m), "menor");
const grupoMayor = (f) => EDADES.find(([k]) => k === grupoMayorClave(f))[1];
const mayores = (f) => (f ? (f.e_60_75 + f.m_75) / f.total : null);
const cobertura = (reg, d) => { const v = vacuna(reg, d); return v ? v.total / v.poblacion : null; };

/* ---------- Escala continua ---------- */
const escalaContinua = () => ["#c3cdf7", ...C.escala]; // el tono más claro es visible: no se confunde con «sin datos»
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mezclar = (h, p) => `rgb(${hexRGB(h).map((c) => Math.round(255 - (255 - c) * p)).join(",")})`;
function colorContinuo(t) {
  const cs = escalaContinua().map(hexRGB);
  const x = Math.max(0, Math.min(1, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${cs[i].map((c, k) => Math.round(c + (cs[i + 1][k] - c) * f)).join(",")})`;
}

/* ---------- Piezas ---------- */
function kpis(id, lista) {
  $(id).innerHTML = lista.map(({ etiqueta, valor, pie, texto }) => `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor${texto ? " texto" : ""}">${valor}</span><span class="kpi-pie">${pie}</span></div>`).join("");
}
function composicion(id, items) {
  const total = items.reduce((s, x) => s + x.valor, 0);
  $(id).innerHTML = `<div class="barra-comp" aria-hidden="true">${items.filter((x) => x.valor).map((x) => `<i style="flex:${x.valor} 1 0;background:${x.color}"></i>`).join("")}</div>` +
    `<ul class="partes">${items.map((x) => `<li><div><b style="background:${x.color}"></b><span>${x.etiqueta}</span><strong>${n0(x.valor)}</strong><em>${pct(x.valor / (total || 1))}</em></div></li>`).join("")}</ul>`;
}
/* Desglose por grupo de edad o por sexo («Ver por»), en número o porcentaje («Mostrar») */
const grupos = (f) => (estado.verPor === "sexo"
  ? SEXOS.map(([k, e, c]) => ({ clave: k, etiqueta: e, color: C.css(c) }))
  : EDADES.filter(([k]) => k !== "no_indica" || f?.[k]).map(([k, e]) => ({ clave: k, etiqueta: e })));
function desglose(id, f, nombre) {
  if (!f || !f.total) return Obs.vacio(id);
  const enPct = estado.medida === "pct";
  Obs.barras(id, grupos(f).map((g) => ({ ...g, valor: enPct ? f[g.clave] / f.total : f[g.clave] })), {
    formato: enPct ? pct : n0, nombre, ordenar: false,
    detalle: (d) => (enPct ? `${n0(f[d.clave])} personas` : `${pct(d.valor / f.total)} del total`),
  });
}
// Botones de una sola opción (como en Educación)
const botones = (opciones, elegida) => opciones.map(([v, e]) => `<button type="button" data-valor="${v}" aria-pressed="${v === elegida}">${e}</button>`).join("");
const VER_POR = [["edad", "Grupo de edad"], ["sexo", "Sexo"]];
const MEDIDAS = [["numero", "Número"], ["pct", "Porcentaje"]];
function pintarControles() {
  document.querySelectorAll("[data-verpor]").forEach((el) => (el.innerHTML = botones(VER_POR, estado.verPor)));
  document.querySelectorAll("[data-medida]").forEach((el) => (el.innerHTML = botones(MEDIDAS, estado.medida)));
  $("#f-dosis").innerHTML = DOSIS.map((d) => `<button type="button" data-dosis="${d}" aria-pressed="${d === estado.dosis}">${cortoDosis(d)}</button>`).join("");
  $("#filtro-dosis").hidden = estado.modulo !== "vacunas";
}

/* ---------------------------------------------------------
   Contagios o fallecidos
   --------------------------------------------------------- */
function pintarCaso(tabla) {
  const r = estado.region, f = caso(tabla, r), pos = tabla === "positivos";
  $("#m-caso").setAttribute("aria-labelledby", `tab-${tabla}`);
  const tasa = pos ? tasaPos(f) : tasaFal(f);
  const regs = REGIONES.map((reg) => ({ reg, v: pos ? tasaPos(caso(tabla, reg)) : tasaFal(caso(tabla, reg)) })).sort((a, b) => b.v - a.v);
  const puesto = regs.findIndex((x) => x.reg === r) + 1;
  const may = mayores(f);
  const nom = pos ? "Casos positivos" : "Fallecidos";
  $("#r-caso").innerHTML = pos
    ? `${EnAmbito(r)} se registraron ${destacar(`${n0(f.total)} casos positivos`)} de COVID-19 hasta agosto de 2024: ${destacar(Obs.fmtN(tasa, 1))} por cada 100 habitantes. ${pct(f.mujeres / f.total)} fueron mujeres, y el grupo con más casos fue el de ${grupoMayor(f).toLowerCase().replace(/^de /, "")} (${pct(f[grupoMayorClave(f)] / f.total)}).`
    : `${EnAmbito(r)} fallecieron ${destacar(`${n0(f.total)} personas`)} por COVID-19 hasta marzo de 2024: ${destacar(Obs.fmtN(tasa, 1))} por cada 10 000 habitantes. ${pct(may)} tenían 60 años o más, y ${pct(f.hombres / f.total)} eran hombres.`;
  // Cifras clave: total, tasa, la región con la tasa más alta (o el puesto de la elegida) y letalidad o mayores
  const unidad = pos ? "casos por cada 100 habitantes" : "fallecidos por cada 10 000 habitantes";
  const lets = REGIONES.map((reg) => ({ reg, v: letalidad(reg) })).sort((x, y) => y.v - x.v);
  // Regiones que comparten el valor más alto al redondear a un decimal (p. ej., tres con 7.2 %)
  const empatadas = lets.filter((x) => pct(x.v) === pct(lets[0].v));
  const nac = r === NACIONAL, tasaPeru = pos ? tasaPos(caso(tabla, NACIONAL)) : tasaFal(caso(tabla, NACIONAL));
  kpis("#k-caso", [
    { etiqueta: pos ? "Casos positivos" : "Fallecidos", valor: n0(f.total), pie: pos ? "Hasta agosto de 2024" : "Hasta marzo de 2024" },
    { etiqueta: pos ? "Por cada 100 habitantes" : "Por cada 10 000 habitantes", valor: Obs.fmtN(tasa, 1), pie: nac ? "Promedio del Perú" : `Perú: ${Obs.fmtN(tasaPeru, 1)}` },
    nac
      ? { etiqueta: pos ? "Más casos registrados por habitante" : "Más fallecidos por habitante", valor: nombreRegion(regs[0].reg), texto: true, pie: `${Obs.fmtN(regs[0].v, 1)} ${unidad}` }
      : { etiqueta: "Puesto entre las regiones", valor: `${puesto}.º de ${regs.length}`, pie: puesto === 1 ? "La tasa más alta del país" : `La más alta: ${nombreRegion(regs[0].reg)} (${Obs.fmtN(regs[0].v, 1)})` },
    pos
      ? (nac
        ? { etiqueta: "Mayor letalidad registrada", valor: lista(empatadas.map((x) => nombreRegion(x.reg))), texto: true, pie: `${pct(lets[0].v)} de los casos positivos falleció` }
        : { etiqueta: "Letalidad", valor: pct(letalidad(r)), pie: `Perú: ${pct(letalidad(NACIONAL))}` })
      : { etiqueta: "De 60 años a más", valor: pct(may), pie: `${n0(f.e_60_75 + f.m_75)} personas` },
  ]);
  pintarMeses(pos ? null : r);
  // Desglose (Ver por: edad o sexo) y letalidad por el mismo corte
  const porSexo = estado.verPor === "sexo";
  $("#t-desg").textContent = `${nom} ${porSexo ? "según sexo" : "por grupo de edad"}`;
  $("#d-desg").textContent = `${estado.medida === "pct" ? "Porcentaje del total" : "Número de personas"}, ${enAmbito(r)}.`;
  desglose("g-desg", f, nom);
  const p = caso("positivos", r), fa = caso("fallecidos", r);
  const gs = grupos(p).filter((g) => g.clave !== "no_indica" && p[g.clave]);
  const lt = gs.map((g) => ({ ...g, valor: fa[g.clave] / p[g.clave] }));
  $("#t-let").textContent = `Letalidad ${porSexo ? "según sexo" : "por grupo de edad"}`;
  $("#d-let").textContent = `Fallecidos por cada 100 casos positivos, ${enAmbito(r)}.`;
  const lH = fa.hombres / p.hombres, lM = fa.mujeres / p.mujeres;
  $("#l-let").innerHTML = porSexo
    ? `Por cada 100 hombres con caso positivo fallecieron ${destacar(Obs.fmtN(100 * lH, 1))}; por cada 100 mujeres, ${destacar(Obs.fmtN(100 * lM, 1))}.` +
      (lH > lM * 1.2 ? " La letalidad registrada fue mayor entre los hombres." : lM > lH * 1.2 ? " La letalidad registrada fue mayor entre las mujeres." : "")
    : `La letalidad registrada va de ${destacar(pct(lt[0].valor))} en ${lt[0].etiqueta.toLowerCase()} a ${destacar(pct(lt.at(-1).valor))} en ${lt.at(-1).etiqueta.toLowerCase()}.`;
  Obs.barras("g-let", lt, { formato: pct, nombre: "Letalidad", ordenar: false, color: C.css("--baja"),
    detalle: (d) => `${n0(fa[d.clave])} fallecidos de ${n0(p[d.clave])} casos` });
}

/* Fallecidos por mes (solo en la pestaña Fallecidos) */
const MESES_CORTO = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m, largo = false) => { const [a, n] = m.split("-").map(Number); return `${(largo ? MESES_LARGO : MESES_CORTO)[n - 1]} ${largo ? "de " : ""}${a}`; };
function pintarMeses(r) {
  const tarjeta = $("#c-mes");
  const filas = r ? (D.fallecidos_mes ?? []).filter((f) => f.region === r) : [];
  tarjeta.hidden = !filas.length;
  if (!filas.length) return;
  const pico = filas.reduce((m, f) => (f.total > m.total ? f : m), filas[0]);
  $("#t-mes").textContent = `Fallecidos por mes, ${nombreMes(filas[0].mes)}-${nombreMes(filas.at(-1).mes)}`;
  $("#d-mes").textContent = `Personas fallecidas por COVID-19 cada mes, según la fecha de fallecimiento, ${enAmbito(r)}.`;
  const ola2 = filas.filter((f) => f.mes >= "2022-01").reduce((s, f) => s + f.total, 0), tot = filas.reduce((s, f) => s + f.total, 0);
  $("#l-mes").innerHTML = `El mes con más fallecidos fue ${destacar(nombreMes(pico.mes, true))}, con ${destacar(n0(pico.total))}. ` +
    `Desde enero de 2022 fallecieron ${n0(ola2)} personas (${pct(ola2 / (tot || 1))} del total).`;
  const g = Obs.grafico("g-mes");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${nombreMes(filas[ps[0].dataIndex].mes, true)}</strong><br>Fallecidos: <strong>${n0(ps[0].value)}</strong>` },
    grid: { left: 56, right: 16, top: 16, bottom: 30 },
    xAxis: { type: "category", data: filas.map((f) => f.mes), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: 0, formatter: (m) => (m.endsWith("-01") || m === filas[0].mes ? m.slice(0, 4) : "") }) },
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (v) => (v >= 1000 ? `${Obs.fmtN(v / 1000, 0)} mil` : v) }) },
    series: [{ type: "bar", barCategoryGap: "18%", data: filas.map((f) => ({ value: f.total, itemStyle: { color: f.mes === pico.mes ? C.navy : C.unica, borderRadius: [2, 2, 0, 0] } })) }],
  }, true);
}

/* ---------------------------------------------------------
   Vacunación
   --------------------------------------------------------- */
function pintarVacunas() {
  const r = estado.region, d = estado.dosis;
  const v1 = vacuna(r, 1), v = vacuna(r, d), v3 = vacuna(r, 3);
  $("#r-vacunas").innerHTML = `${EnAmbito(r)}, ${destacar(`${n0(v1.total)} personas`)} recibieron al menos una dosis de la vacuna contra la COVID-19: ${destacar(pct(v1.total / v1.poblacion))} de la población. ` +
    `Con tres dosis hay ${n0(v3?.total ?? 0)} personas (${pct(cobertura(r, 3))}), y con cuatro, ${pct(cobertura(r, 4))}.`;
  kpis("#k-vacunas", [
    { etiqueta: "Con al menos una dosis", valor: pct(cobertura(r, 1)), pie: `${n0(v1.total)} personas` },
    { etiqueta: "Con dos dosis", valor: pct(cobertura(r, 2)), pie: `${n0(vacuna(r, 2)?.total ?? 0)} personas` },
    { etiqueta: "Con tres dosis", valor: pct(cobertura(r, 3)), pie: `${n0(v3?.total ?? 0)} personas` },
    { etiqueta: "Con cuatro dosis", valor: pct(cobertura(r, 4)), pie: `${n0(vacuna(r, 4)?.total ?? 0)} personas` },
  ]);
  // Cobertura por dosis: la dosis elegida en color pleno; las demás en un tono claro (cifras legibles)
  $("#d-dosis").textContent = `Porcentaje de la población ${enAmbito(r)} que recibió cada dosis.`;
  const claro = mezclar(C.unica, 0.3);
  Obs.barras("g-dosis", DOSIS.map((x) => ({ clave: x, etiqueta: nombreDosis(x), valor: cobertura(r, x) ?? 0, color: x === d ? C.unica : claro })), {
    formato: pct, nombre: nombreRegion(r), ordenar: false, alClic: (x) => actualizar({ dosis: +x }),
    detalle: (x) => `${n0(vacuna(r, x.clave)?.total ?? 0)} personas`,
  });
  // Quienes recibieron la dosis elegida, por grupo de edad o sexo
  $("#t-desg-v").textContent = `Personas con la ${nombreDosis(d).toLowerCase()}, ${estado.verPor === "sexo" ? "según sexo" : "por grupo de edad"}`;
  $("#d-desg-v").textContent = `${estado.medida === "pct" ? "Porcentaje del total" : "Número de personas"}, ${enAmbito(r)}.`;
  desglose("g-desg-v", v, "Personas");
  // Fabricantes por dosis
  const fab = D.fabricantes.filter((f) => f.region === r);
  const marcas = [...new Set(fab.map((f) => f.fabricante))].sort((a, b) => fab.filter((f) => f.fabricante === b).reduce((s, f) => s + f.total, 0) - fab.filter((f) => f.fabricante === a).reduce((s, f) => s + f.total, 0));
  const colores = Object.fromEntries(marcas.map((m, i) => [m, [...C.categorias, C.otros][i % 6]]));
  const titulo = (m) => m.charAt(0) + m.slice(1).toLowerCase().replace("zeneca", "Zeneca");
  $("#d-fab").textContent = `Vacunas aplicadas en cada dosis, según el fabricante, ${enAmbito(r)}.`;
  $("#ley-fab").innerHTML = marcas.map((m) => `<span><i style="background:${colores[m]}"></i>${titulo(m)}</span>`).join("");
  if (!fab.length) Obs.vacio("g-fab");
  else {
    const dosisFab = DOSIS.filter((x) => fab.some((f) => (x === OTRAS ? f.dosis >= OTRAS : f.dosis === x)));
    const val = (m, x) => fab.filter((f) => f.fabricante === m && (x === OTRAS ? f.dosis >= OTRAS : f.dosis === x)).reduce((s, f) => s + f.total, 0);
    const g = Obs.grafico("g-fab");
    g.setOption({
      textStyle: { fontFamily: C.fuente }, animation: ANIM,
      tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
        formatter: (ps) => { const t = ps.reduce((s, p) => s + (p.value || 0), 0);
          return `<strong>${ps[0].name}</strong>` + ps.filter((p) => p.value).map((p) => `<br>${p.marker}${p.seriesName}: <strong>${n0(p.value)}</strong> (${pct(p.value / t)})`).join(""); } },
      grid: { left: 124, right: 24, top: 4, bottom: 30 },
      xAxis: { type: "value", splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => (x >= 1e6 ? `${Obs.fmtN(x / 1e6, 0)} mill.` : x >= 1e3 ? `${Obs.fmtN(x / 1e3, 0)} mil` : x) }) },
      yAxis: { type: "category", inverse: true, data: dosisFab.map(nombreDosis), axisTick: { show: false }, axisLine: { show: false }, triggerEvent: true,
        axisLabel: { ...txt(), formatter: (x) => (x === nombreDosis(d) ? `{b|${x}}` : x), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
      series: marcas.map((m) => ({ name: titulo(m), type: "bar", stack: "f", barWidth: 18, itemStyle: { color: colores[m], borderColor: "#fff", borderWidth: 1 }, data: dosisFab.map((x) => val(m, x)) })),
    }, true);
    g.off("click");
  }
}

/* ---------------------------------------------------------
   Mapa coroplético (escala continua) y ranking de regiones
   --------------------------------------------------------- */
function indicadores() {
  const d = estado.dosis;
  if (estado.modulo === "positivos") return [
    { id: "tasa", nombre: "Casos positivos por cada 100 habitantes", valor: (r) => tasaPos(caso("positivos", r)), fmt: (v) => Obs.fmtN(v, 1) },
    { id: "total", nombre: "Casos positivos", valor: (r) => caso("positivos", r)?.total, fmt: n0 },
    { id: "letalidad", nombre: "Letalidad (fallecidos por cada 100 casos positivos)", valor: letalidad, fmt: pct },
    { id: "mayores", nombre: "Casos positivos de 60 años a más (%)", valor: (r) => mayores(caso("positivos", r)), fmt: pct },
  ];
  if (estado.modulo === "fallecidos") return [
    { id: "tasa", nombre: "Fallecidos por cada 10 000 habitantes", valor: (r) => tasaFal(caso("fallecidos", r)), fmt: (v) => Obs.fmtN(v, 1) },
    { id: "total", nombre: "Fallecidos", valor: (r) => caso("fallecidos", r)?.total, fmt: n0 },
    { id: "letalidad", nombre: "Letalidad (fallecidos por cada 100 casos positivos)", valor: letalidad, fmt: pct },
    { id: "mayores", nombre: "Fallecidos de 60 años a más (%)", valor: (r) => mayores(caso("fallecidos", r)), fmt: pct },
  ];
  return [
    { id: "cobertura", nombre: `Población con la ${nombreDosis(d).toLowerCase()} (%)`, valor: (r) => cobertura(r, d), fmt: pct },
    { id: "total", nombre: `Personas con la ${nombreDosis(d).toLowerCase()}`, valor: (r) => vacuna(r, d)?.total, fmt: n0 },
  ];
}
function pintarMapa() {
  const lista = indicadores();
  const ind = lista.find((i) => i.id === estado.mapa[estado.modulo]) ?? lista[0];
  $("#f-mapa").innerHTML = lista.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  $("#t-mapa").textContent = `${ind.nombre}, por región`;
  const regs = REGIONES.map((reg) => ({ reg, v: ind.valor(reg) })).filter((x) => x.v != null);
  const vs = regs.map((x) => x.v), min = Math.min(...vs), max = Math.max(...vs);
  mapa.pintar({ valores: new Map(regs.map((x) => [x.reg, x.v])), color: (v) => colorContinuo(max > min ? (v - min) / (max - min) : 1), texto: ind.fmt, elegida: estado.region === NACIONAL ? null : estado.region });
  $("#ley-mapa").innerHTML = `<div class="ley-continua"><span>${ind.fmt(min)}</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${ind.fmt(max)}</span></div>`;
  const orden = [...regs].sort((a, b) => b.v - a.v), peru = ind.valor(NACIONAL);
  $("#l-mapa").innerHTML = `Va de ${destacar(ind.fmt(min))} en ${nombreRegion(orden.at(-1).reg)} a ${destacar(ind.fmt(max))} en ${nombreRegion(orden[0].reg)}.` + (peru != null ? ` En el Perú: ${ind.fmt(peru)}.` : "");
  Obs.ranking("g-regiones", regs.map((x) => ({ clave: x.reg, etiqueta: nombreRegion(x.reg), valor: x.v })), {
    formato: ind.fmt, nombre: ind.nombre, elegida: estado.region === NACIONAL ? null : estado.region, alClic: elegirRegion,
    referencia: peru != null ? { valor: peru, etiqueta: "Perú" } : null,
  });
}

/* ---------------------------------------------------------
   Tabla de regiones
   --------------------------------------------------------- */
const ORDEN = {};
function tablaOrdenable(id, columnas, filas, { inicial, claveFila = () => "", elegida = null, pie = "", descripcion, alClic = null }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave) ?? columnas[0];
  const datos = [...filas].sort((a, b) => {
    const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * orden.dir;
  });
  const th = columnas.map((c) => {
    const activo = c.clave === col.clave;
    return `<th class="${c.num ? "num" : ""} c-${c.clave}" aria-sort="${activo ? (orden.dir === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-orden="${c.clave}">${c.titulo}<span class="flecha" aria-hidden="true">${activo ? (orden.dir === 1 ? "▲" : "▼") : "▲▼"}</span></button></th>`;
  }).join("");
  const tr = datos.map((f) => {
    const k = String(claveFila(f));
    return `<tr data-k="${Obs.escapar(k)}"${alClic ? ' tabindex="0"' : ""}${k && k === elegida ? ' class="elegida"' : ""}>` + columnas.map((c) => `<td class="${c.num ? "num" : ""} c-${c.clave}">${c.html(f)}</td>`).join("") + "</tr>";
  }).join("");
  el.innerHTML = `<table class="tabla ordenable centrada"><caption class="solo-lectores">${Obs.escapar(descripcion)}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ""}</table>`;
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
function pintarTabla() {
  const col = [
    { clave: "pos", titulo: "Casos por 100 hab.", f: (r) => tasaPos(caso("positivos", r)), fmt: (v) => Obs.fmtN(v, 1) },
    { clave: "fal", titulo: "Fallecidos por 10 000 hab.", f: (r) => tasaFal(caso("fallecidos", r)), fmt: (v) => Obs.fmtN(v, 1) },
    { clave: "let", titulo: "Letalidad", f: letalidad, fmt: pct },
    { clave: "v1", titulo: "Con 1 dosis", f: (r) => cobertura(r, 1), fmt: pct },
    { clave: "v3", titulo: "Con 3 dosis", f: (r) => cobertura(r, 3), fmt: pct },
  ];
  const filas = REGIONES.map((reg) => ({ reg, ...Object.fromEntries(col.map((c) => [c.clave, c.f(reg)])) }));
  tablaOrdenable("t-regiones", [
    { clave: "reg", titulo: "Región", valor: (f) => nombreRegion(f.reg), html: (f) => nombreRegion(f.reg) },
    ...col.map((c) => ({ clave: c.clave, titulo: c.titulo, num: true, valor: (f) => f[c.clave], html: (f) => c.fmt(f[c.clave]) })),
  ], filas, {
    inicial: { clave: "fal", dir: -1 }, claveFila: (f) => f.reg, elegida: estado.region === NACIONAL ? null : estado.region, alClic: elegirRegion,
    descripcion: "COVID-19 por región", pie: `<tr class="peru"><td>Perú</td>${col.map((c) => `<td class="num c-${c.clave}">${c.fmt(c.f(NACIONAL))}</td>`).join("")}</tr>`,
  });
  // En celular, la tabla muestra solo las columnas de la pestaña elegida
  $("#t-regiones").dataset.tab = estado.modulo;
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function render() {
  $("#f-region").value = estado.region;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  $("#m-caso").hidden = estado.modulo === "vacunas";
  $("#m-vacunas").hidden = estado.modulo !== "vacunas";
  pintarControles();
  if (estado.modulo === "vacunas") pintarVacunas(); else pintarCaso(estado.modulo);
  pintarMapa();
  pintarTabla();
  Obs.escribirURL({
    modulo: estado.modulo === "positivos" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    dosis: estado.modulo === "vacunas" && estado.dosis !== 1 ? estado.dosis : null,
    mapa: estado.mapa[estado.modulo] ?? null,
    verpor: estado.verPor === "edad" ? null : estado.verPor,
    medida: estado.medida === "numero" ? null : estado.medida,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (cod) => actualizar({ region: cod === estado.region || cod === NACIONAL ? NACIONAL : cod });

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  const css = getComputedStyle(document.documentElement);
  C = { ...Obs.tema(), css: (n) => css.getPropertyValue(n).trim() };
  D = Object.fromEntries(Object.entries(datos.tablas).map(([k, t]) => [k, Obs.expandir(t)]));
  REGIONES = Object.keys(NOMBRES).filter((r) => D.positivos.some((f) => f.region === r)).sort((a, b) => nombreRegion(a).localeCompare(nombreRegion(b), "es"));
  DOSIS = [...new Set(D.vacunados.map((f) => Math.min(f.dosis, OTRAS)))].sort((a, b) => a - b);
  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  $("#actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (v, e) => `<option value="${Obs.escapar(v)}">${Obs.escapar(e)}</option>`;
  $("#f-region").innerHTML = opcion(NACIONAL, "Perú (nacional)") + REGIONES.map((r) => opcion(r, nombreRegion(r))).join("");
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-mapa").onchange = (e) => { estado.mapa[estado.modulo] = e.target.value; render(); };

  // Estado inicial desde la URL
  const p = Obs.parametros();
  if (MODULOS.includes(p.get("modulo"))) estado.modulo = p.get("modulo");
  const reg = String(p.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) estado.region = reg;
  if (DOSIS.includes(+p.get("dosis"))) estado.dosis = +p.get("dosis");
  if (p.get("mapa")) estado.mapa[estado.modulo] = p.get("mapa");
  if (VER_POR.some(([v]) => v === p.get("verpor"))) estado.verPor = p.get("verpor");
  if (MEDIDAS.some(([v]) => v === p.get("medida"))) estado.medida = p.get("medida");

  // Botones: Ver por, Mostrar y Dosis
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-verpor] button, [data-medida] button, #f-dosis button");
    if (!b) return;
    if (b.closest("[data-verpor]")) actualizar({ verPor: b.dataset.valor });
    else if (b.closest("[data-medida]")) actualizar({ medida: b.dataset.valor });
    else actualizar({ dosis: +b.dataset.dosis });
  });

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

  mapa = new Obs.Mapa("mapa-regiones", geo, { alClic: elegirRegion, nombre: nombreRegion });
  Obs.descarga({ archivos: ARCHIVOS });
  let anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === anchoPrevio) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(window.__espera);
    window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });
  render();
});
