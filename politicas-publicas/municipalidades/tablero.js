/* =========================================================
   Tablero de Gestión municipal — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script (Tableros >
   Publicar tableros) desde el Sheet de Gestión municipal: una pestaña
   por tema y una fila por municipalidad (RENAMU 2025, INEI). Por ahora
   se usan dos pestañas:
     - «Gestión de residuos»: P11A_5 (tiene camiones recolectores, 1/0),
       P11A_5_1 y P11A_5_2 (camiones operativos y no operativos),
       P40_1 (frecuencia del recojo), P41_1 (kilos recogidos por día)
       y P42_1 (parte del territorio que cubre).
     - «Participación Vecinal»: P100_1 a P100_11 (Sí/No: espacios en
       los que participó la población), P102 (tiene Junta de Delegados
       Vecinales), P102_1_T (miembros) y P102_2 (en actividad o inactiva).
   Departamento ya trae los códigos del mapa (Lima Metropolitana y Lima
   Provincias por separado).
     - «Recursos v3»: si la municipalidad tiene internet (formato largo).
     - «Servicios Sociales v2»: beneficiarios del Vaso de Leche por
       perfil (formato largo: variable = perfil, value = beneficiarios).
     - «Seguridad Ciudadana»: P69_1_T (efectivos de serenazgo), P71A_1 a
       P71A_12 y P71A_T (intervenciones del serenazgo por motivo y total)
       y organizaciones de seguridad (Rondas Urbanas, Rondas Campesinas,
       Comités de Autodefensa).
   Las pestañas de formato largo no traen idmunici: sus filas van en el
   mismo orden que «Gestión de residuos», y se unen por esa posición.

   Patrón: un objeto `estado`, funciones puras para agregar y una sola
   `render()`. Cada municipalidad cuenta una vez.

   Parámetros de URL:
     ?modulo=residuos|participacion
     &region=CUSCO   &tipo=Provincial|Distrital
     &mapa=diario    indicador del mapa
     &embed=1        oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "municipalidades";
const MODULOS = ["residuos", "participacion", "recursos", "sociales", "seguridad"];
const ARCHIVOS = [{ clave: "municipalidades_base", etiqueta: "Registro Nacional de Municipalidades 2025 (selección de preguntas)" }];
const NACIONAL = "NACIONAL";
const TIPOS = ["Todas", "Provincial", "Distrital"];
const NOMBRES = {
  AMAZONAS: "Amazonas", ANCASH: "Áncash", APURIMAC: "Apurímac", AREQUIPA: "Arequipa", AYACUCHO: "Ayacucho", CAJAMARCA: "Cajamarca",
  CALLAO: "Callao", CUSCO: "Cusco", HUANCAVELICA: "Huancavelica", HUANUCO: "Huánuco", ICA: "Ica", JUNIN: "Junín", "LA LIBERTAD": "La Libertad",
  LAMBAYEQUE: "Lambayeque", "LIMA METROPOLITANA": "Lima Metropolitana", "LIMA PROVINCIAS": "Lima Provincias", LORETO: "Loreto",
  "MADRE DE DIOS": "Madre de Dios", MOQUEGUA: "Moquegua", PASCO: "Pasco", PIURA: "Piura", PUNO: "Puno", "SAN MARTIN": "San Martín",
  TACNA: "Tacna", TUMBES: "Tumbes", UCAYALI: "Ucayali",
};
const FRECUENCIAS = ["Diaria", "Interdiaria", "Dos veces por semana", "Una vez por semana", "No realizó recojo"];
const COBERTURAS = ["De 75% a 100%", "De 50% a 74%", "De 25% a 49%", "Menos de 25%"];
const ETIQ_COBERTURA = { "De 75% a 100%": "75 % a 100 %", "De 50% a 74%": "50 % a 74 %", "De 25% a 49%": "25 % a 49 %", "Menos de 25%": "Menos de 25 %" };
// Espacios de participación (P100): los seis primeros son de la gestión; los demás, actividades y organizaciones
const ESPACIOS = [
  ["P100_1", "Plan de Desarrollo Municipal Concertado", "gestion"], ["P100_2", "Presupuesto municipal", "gestion"],
  ["P100_3", "Planes económicos locales", "gestion"], ["P100_4", "Presupuesto participativo", "gestion"],
  ["P100_5", "Cabildo abierto", "gestion"], ["P100_6", "Audiencias de rendición de cuentas", "gestion"],
  ["P100_7", "Acciones de seguridad ciudadana", "organizacion"], ["P100_8", "Comités de gestión alimentaria", "organizacion"],
  ["P100_9", "Comités de ejecución de obras", "organizacion"], ["P100_10", "Juntas vecinales", "organizacion"],
  ["P100_11", "Otros espacios", "organizacion"],
];
// Beneficiarios del Vaso de Leche, por perfil (variable de «Servicios Sociales v2»)
const PERFILES = ["Niños de 0 a 6", "Niños de 7 a 13", "Madres gestantes", "Madres en período de lactancia", "Adultos mayores",
  "Personas con alguna discapacidad", "Personas afectadas con tuberculosis"];
const ETIQ_PERFIL = { "Niños de 0 a 6": "Niños de 0 a 6 años", "Niños de 7 a 13": "Niños de 7 a 13 años",
  "Personas con alguna discapacidad": "Personas con discapacidad", "Personas afectadas con tuberculosis": "Personas con tuberculosis",
  "Madres en período de lactancia": "Madres que dan de lactar" };
// Motivos de las intervenciones del serenazgo (P71A). P71A_4 y P71A_5 no tienen nombre en la base: solo cuentan en el total.
const MOTIVOS = [["P71A_6", "Consumo de alcohol en la vía pública"], ["P71A_7", "Consumo de drogas"], ["P71A_9", "Comercio informal"],
  ["P71A_8", "Accidentes de tránsito"], ["P71A_10", "Violencia familiar"], ["P71A_1", "Robo a transeúntes"], ["P71A_11", "Pandillaje"],
  ["P71A_2", "Robo a domicilio"], ["P71A_3", "Robo de vehículos"], ["P71A_12", "Otro"]];
const ORGS = [["rondasCampesinas", "Rondas campesinas"], ["rondasUrbanas", "Rondas urbanas"], ["comites", "Comités de autodefensa"]];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Indicadores del mapa por pestaña. tipo: "pct" (municipalidades que cumplen / todas),
   "razon" (suma de un campo / suma de otro) o "suma" (total de un campo) */
const IND = {
  residuos: [
    { id: "camion", nombre: "Tienen camiones recolectores", tipo: "pct", cumple: (m) => m.camion },
    { id: "diario", nombre: "Recogen la basura todos los días", tipo: "pct", cumple: (m) => m.frecuencia === "Diaria" },
    { id: "cobertura", nombre: "El recojo cubre el 75 % o más del territorio", tipo: "pct", cumple: (m) => m.cobertura === "De 75% a 100%" },
    { id: "operativos", nombre: "Camiones que funcionan (del total de camiones)", tipo: "razon", num: (m) => m.operativos, den: (m) => m.operativos + m.noOperativos },
    { id: "toneladas", nombre: "Basura recogida por día (toneladas)", tipo: "suma", unidad: "t", campo: (m) => (m.kilos ?? 0) / 1000 },
  ],
  recursos: [
    { id: "internet", nombre: "Tienen servicio de internet", tipo: "pct", cumple: (m) => m.internet },
  ],
  sociales: [
    { id: "beneficiarios", nombre: "Beneficiarios del Vaso de Leche", tipo: "suma", unidad: "personas", campo: (m) => m.vasoTotal },
    ...PERFILES.map((p, i) => ({ id: `perfil${i}`, nombre: `Beneficiarios: ${(ETIQ_PERFIL[p] ?? p).toLowerCase()}`, tipo: "suma", unidad: "personas", campo: (m) => m.vaso[p] })),
    { id: "adultos", nombre: "Atienden a adultos mayores", tipo: "pct", cumple: (m) => m.vaso["Adultos mayores"] > 0 },
  ],
  seguridad: [
    { id: "serenazgo", nombre: "Tienen serenazgo", tipo: "pct", cumple: (m) => m.serenos > 0 },
    { id: "serenos", nombre: "Efectivos de serenazgo", tipo: "suma", unidad: "efectivos", campo: (m) => m.serenos },
    { id: "intervenciones", nombre: "Intervenciones del serenazgo", tipo: "suma", unidad: "intervenciones", campo: (m) => m.intervenciones },
    { id: "organizacion", nombre: "Tienen alguna organización de seguridad vecinal o comunal", tipo: "pct", cumple: (m) => m.orgs > 0 },
    ...ORGS.map(([k, nombre]) => ({ id: k, nombre: `${nombre} (número)`, tipo: "suma", unidad: "organizaciones", campo: (m) => m[k] })),
  ],
  participacion: [
    ...ESPACIOS.map(([c, nombre]) => ({ id: c.toLowerCase(), nombre: `Participación en: ${nombre.toLowerCase()}`, tipo: "pct", cumple: (m) => m.espacios[c] })),
    { id: "junta", nombre: "Tienen Junta de Delegados Vecinales", tipo: "pct", cumple: (m) => m.junta },
  ],
};
const DEFECTO_MAPA = { residuos: "camion", participacion: "p100_4", recursos: "internet", sociales: "beneficiarios", seguridad: "serenazgo" };

const estado = { modulo: "residuos", ambito: "nacional", region: NACIONAL, tipo: "Todas", mapa: { ...DEFECTO_MAPA } };

let C, GEO, controles, mapa, MUNIS = [];
let buscar = "";

/* ---------------------------------------------------------
   Agregados
   --------------------------------------------------------- */
const pct = (v) => Obs.fmtPct(v, 1);
const n0 = (v) => Obs.fmtN(v, 0);
const nombreRegion = (c) => (c === NACIONAL ? "Perú" : NOMBRES[c] ?? c);
const enLugar = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnLugar = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombreRegion(c)}`);
const destacar = (s) => `<strong>${s}</strong>`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const delTipo = () => (estado.tipo === "Todas" ? "municipalidades" : `municipalidades ${estado.tipo === "Provincial" ? "provinciales" : "distritales"}`);

// Municipalidades de un lugar con el tipo elegido
function filtrar(lugar, tipo = estado.tipo) {
  return MUNIS.filter((m) => (lugar === NACIONAL || m.region === lugar) && (tipo === "Todas" || m.tipo === tipo));
}
// Valor de un indicador para un grupo de municipalidades: { v, num, den }
function valor(ind, munis) {
  if (ind.tipo === "pct") { const num = munis.filter(ind.cumple).length; return { v: munis.length ? num / munis.length : null, num, den: munis.length }; }
  if (ind.tipo === "razon") { const num = munis.reduce((s, m) => s + ind.num(m), 0), den = munis.reduce((s, m) => s + ind.den(m), 0); return { v: den ? num / den : null, num, den }; }
  const v = munis.reduce((s, m) => s + ind.campo(m), 0);
  return { v: munis.length ? v : null, num: v, den: munis.length };
}
const fmtInd = (ind, v) => (v == null ? "—" : ind.tipo === "suma" ? `${Obs.fmtN(v, 0)}${ind.unidad === "t" ? " t" : ""}` : pct(v));
// Porcentaje de un grupo que cumple una condición
const parte = (munis, f) => (munis.length ? munis.filter(f).length / munis.length : 0);

/* Barras de porcentaje con la marca del Perú cuando hay una región elegida */
function barras(id, categorias, munis, peru, { ordenar = false } = {}) {
  const comp = estado.region !== NACIONAL;
  Obs.barras(id, categorias.map(([clave, etiqueta, f]) => ({ clave, etiqueta, valor: parte(munis, f), comp: comp ? parte(peru, f) : null })), {
    formato: pct, nombre: nombreRegion(estado.region), comparacion: comp ? "Perú" : null, ordenar,
  });
}

/* Barras de la parte de un total (por ejemplo, intervenciones por motivo), con la marca del Perú */
function barrasParte(id, categorias, munis, peru, total) {
  const comp = estado.region !== NACIONAL;
  const suma = (lista, f) => lista.reduce((s, m) => s + (f(m) ?? 0), 0);
  const tm = suma(munis, total), tp = suma(peru, total);
  Obs.barras(id, categorias.map(([clave, etiqueta, f]) => ({ clave, etiqueta, valor: tm ? suma(munis, f) / tm : 0, comp: comp && tp ? suma(peru, f) / tp : null })), {
    formato: pct, nombre: nombreRegion(estado.region), comparacion: comp ? "Perú" : null, ordenar: true,
  });
}

/* ---------------------------------------------------------
   Cifras clave
   --------------------------------------------------------- */
function kpis(id, lista) {
  const caja = document.getElementById(id);
  caja.innerHTML = lista.map(({ etiqueta, valor, pie }) =>
    `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">${valor}</span><span class="kpi-pie">${pie}</span></div>`).join("");
}
const pieComp = (f, peru) => (estado.region !== NACIONAL ? `Perú: ${f(peru)}` : "");

/* ---------------------------------------------------------
   Pestaña: Gestión de residuos
   --------------------------------------------------------- */
function pintarResiduos() {
  const munis = filtrar(estado.region), peru = filtrar(NACIONAL);
  const total = munis.length;
  const conCamion = munis.filter((m) => m.camion).length;
  const op = munis.reduce((s, m) => s + m.operativos, 0), no = munis.reduce((s, m) => s + m.noOperativos, 0);
  const diaria = munis.filter((m) => m.frecuencia === "Diaria").length, sinRecojo = munis.filter((m) => m.frecuencia === "No realizó recojo").length;
  const opPeru = valor(IND.residuos[3], peru).v;

  document.getElementById("r-residuos").innerHTML = !total ? "No hay municipalidades para esta selección." :
    `${EnLugar(estado.region)}, ${destacar(`${n0(conCamion)} de ${n0(total)}`)} ${delTipo()} (${pct(conCamion / total)}) tiene camiones recolectores de basura` +
    (op + no ? `; de sus ${n0(op + no)} camiones, ${destacar(n0(op))} funcionan (${pct(op / (op + no))})` : "") + `. ` +
    `${n0(diaria)} recogen la basura todos los días` + (sinRecojo ? ` y ${n0(sinRecojo)} no hicieron recojo.` : ".");

  kpis("k-residuos", [
    { etiqueta: "Tienen camiones recolectores", valor: pct(total ? conCamion / total : null), pie: `${n0(conCamion)} de ${n0(total)}. ${pieComp(pct, parte(peru, (m) => m.camion))}` },
    { etiqueta: "Camiones que funcionan", valor: op + no ? pct(op / (op + no)) : "—", pie: `${n0(op)} de ${n0(op + no)} camiones. ${pieComp(pct, opPeru)}` },
    { etiqueta: "Recogen la basura todos los días", valor: pct(total ? diaria / total : null), pie: `${n0(diaria)} municipalidades. ${pieComp(pct, parte(peru, (m) => m.frecuencia === "Diaria"))}` },
    { etiqueta: "Basura recogida por día", valor: `${Obs.fmtN(munis.reduce((s, m) => s + (m.kilos ?? 0), 0) / 1000, 0)} t`, pie: "Toneladas, suma de lo que reporta cada municipalidad" },
  ]);

  barras("g-frecuencia", FRECUENCIAS.map((f) => [f, f, (m) => m.frecuencia === f]), munis, peru);
  const conRecojo = munis.filter((m) => m.cobertura), peruRecojo = peru.filter((m) => m.cobertura);
  barras("g-cobertura", COBERTURAS.map((c) => [c, ETIQ_COBERTURA[c], (m) => m.cobertura === c]), conRecojo, peruRecojo);
  const tramos = [["0", "Ninguno", (m) => !m.camion], ["1", "1 camión", (m) => m.camion && m.camiones === 1], ["2", "2 camiones", (m) => m.camion && m.camiones === 2],
    ["3", "3 o 4 camiones", (m) => m.camion && m.camiones >= 3 && m.camiones <= 4], ["5", "5 o más", (m) => m.camion && m.camiones >= 5]];
  barras("g-camiones", tramos, munis, peru);
  document.getElementById("e-camiones").innerHTML = op + no
    ? `<p>${EnLugar(estado.region)}, las ${delTipo()} reportan ${destacar(n0(op + no))} camiones recolectores: ${destacar(n0(op))} funcionan y ${n0(no)} no.</p>
       <div class="barra-estado" role="img" aria-label="${pct(op / (op + no))} de los camiones funcionan"><i style="width:${(op / (op + no)) * 100}%;background:${C.unica}"></i><i style="width:${(no / (op + no)) * 100}%;background:${C.otros}"></i></div>
       <div class="ley-estado"><span><b style="background:${C.unica}"></b>Funcionan (${pct(op / (op + no))})</span><span><b style="background:${C.otros}"></b>No funcionan (${pct(no / (op + no))})</span></div>`
    : "<p>Ninguna municipalidad de la selección reporta camiones.</p>";
}

/* ---------------------------------------------------------
   Pestaña: Participación vecinal
   --------------------------------------------------------- */
function pintarParticipacion() {
  const munis = filtrar(estado.region), peru = filtrar(NACIONAL);
  const total = munis.length;
  const c = (k) => munis.filter((m) => m.espacios[k]).length;
  const junta = munis.filter((m) => m.junta), activa = junta.filter((m) => m.juntaActiva).length;
  document.getElementById("r-participacion").innerHTML = !total ? "No hay municipalidades para esta selección." :
    `${EnLugar(estado.region)}, ${destacar(`${n0(c("P100_4"))} de ${n0(total)}`)} ${delTipo()} (${pct(c("P100_4") / total)}) hizo presupuesto participativo con la población, ` +
    `y ${n0(c("P100_6"))} (${pct(c("P100_6") / total)}) audiencias de rendición de cuentas. ` +
    `${destacar(n0(junta.length))} (${pct(junta.length / total)}) tiene Junta de Delegados Vecinales${junta.length ? `, y ${n0(activa)} de ellas está en actividad` : ""}.`;

  const pp = (k) => parte(peru, (m) => m.espacios[k]);
  kpis("k-participacion", [
    { etiqueta: "Presupuesto participativo", valor: pct(total ? c("P100_4") / total : null), pie: `${n0(c("P100_4"))} de ${n0(total)}. ${pieComp(pct, pp("P100_4"))}` },
    { etiqueta: "Audiencias de rendición de cuentas", valor: pct(total ? c("P100_6") / total : null), pie: `${n0(c("P100_6"))} de ${n0(total)}. ${pieComp(pct, pp("P100_6"))}` },
    { etiqueta: "Juntas vecinales", valor: pct(total ? c("P100_10") / total : null), pie: `${n0(c("P100_10"))} de ${n0(total)}. ${pieComp(pct, pp("P100_10"))}` },
    { etiqueta: "Junta de Delegados Vecinales", valor: pct(total ? junta.length / total : null), pie: `${n0(activa)} en actividad. ${pieComp(pct, parte(peru, (m) => m.junta))}` },
  ]);

  barras("g-gestion", ESPACIOS.filter((e) => e[2] === "gestion").map(([k, nombre]) => [k, nombre, (m) => m.espacios[k]]), munis, peru, { ordenar: true });
  barras("g-organizacion", ESPACIOS.filter((e) => e[2] === "organizacion").map(([k, nombre]) => [k, nombre, (m) => m.espacios[k]]), munis, peru, { ordenar: true });
  barras("g-junta", [["activa", "Tiene junta en actividad", (m) => m.junta && m.juntaActiva], ["inactiva", "Tiene junta, inactiva", (m) => m.junta && !m.juntaActiva],
    ["no", "No tiene junta", (m) => !m.junta]], munis, peru);
  const miembros = junta.map((m) => m.miembros).filter((x) => x != null).sort((a, b) => a - b);
  const med = miembros.length ? miembros[Math.floor((miembros.length - 1) / 2)] : null;
  document.getElementById("l-junta").innerHTML = med == null ? "" :
    `Las juntas ${estado.region === NACIONAL ? "del Perú" : `de ${nombreRegion(estado.region)}`} tienen, en la mediana, ${destacar(n0(med))} miembros.`;
}

/* ---------------------------------------------------------
   Pestaña: Recursos
   --------------------------------------------------------- */
function pintarRecursos() {
  const munis = filtrar(estado.region), peru = filtrar(NACIONAL), total = munis.length;
  const con = munis.filter((m) => m.internet).length;
  document.getElementById("r-recursos").innerHTML = !total ? "No hay municipalidades para esta selección." :
    `${EnLugar(estado.region)}, ${destacar(`${n0(con)} de ${n0(total)}`)} ${delTipo()} (${pct(con / total)}) tiene servicio de internet` +
    (total - con ? `; ${n0(total - con)} no lo tiene${total - con === 1 ? "" : "n"}.` : ".");
  kpis("k-recursos", [
    { etiqueta: "Tienen servicio de internet", valor: pct(total ? con / total : null), pie: `${n0(con)} de ${n0(total)}. ${pieComp(pct, parte(peru, (m) => m.internet))}` },
    { etiqueta: "Sin servicio de internet", valor: n0(total - con), pie: `${pct(total ? (total - con) / total : null)} de las ${delTipo()}` },
  ]);
}

/* ---------------------------------------------------------
   Pestaña: Servicios sociales (Vaso de Leche)
   --------------------------------------------------------- */
function pintarSociales() {
  const munis = filtrar(estado.region), peru = filtrar(NACIONAL), total = munis.length;
  const ben = munis.reduce((s, m) => s + m.vasoTotal, 0);
  const atienden = munis.filter((m) => m.vasoTotal > 0).length;
  const ninos = munis.reduce((s, m) => s + m.vaso["Niños de 0 a 6"], 0), mayores = munis.reduce((s, m) => s + m.vaso["Adultos mayores"], 0);
  document.getElementById("r-sociales").innerHTML = !total ? "No hay municipalidades para esta selección." :
    `${EnLugar(estado.region)}, las ${delTipo()} reportan ${destacar(n0(ben))} beneficiarios del Vaso de Leche` +
    (ben ? `. Los niños de 0 a 6 años son el ${destacar(pct(ninos / ben))}, y los adultos mayores, el ${pct(mayores / ben)}` : "") +
    (atienden === total ? ". Todas reportan beneficiarios." : `. ${n0(atienden)} de ${n0(total)} reportan beneficiarios.`);
  const pPeru = (p) => { const b = peru.reduce((s, m) => s + m.vasoTotal, 0); return b ? peru.reduce((s, m) => s + m.vaso[p], 0) / b : null; };
  kpis("k-sociales", [
    { etiqueta: "Beneficiarios del Vaso de Leche", valor: n0(ben), pie: `${n0(atienden)} municipalidades reportan beneficiarios` },
    { etiqueta: "Niños de 0 a 6 años", valor: ben ? pct(ninos / ben) : "—", pie: `${n0(ninos)} beneficiarios. ${pieComp(pct, pPeru("Niños de 0 a 6"))}` },
    { etiqueta: "Adultos mayores", valor: ben ? pct(mayores / ben) : "—", pie: `${n0(mayores)} beneficiarios. ${pieComp(pct, pPeru("Adultos mayores"))}` },
    { etiqueta: "Beneficiarios por municipalidad", valor: atienden ? n0(ben / atienden) : "—", pie: "Promedio, entre las que reportan beneficiarios" },
  ]);
  barrasParte("g-perfiles", PERFILES.map((p) => [p, ETIQ_PERFIL[p] ?? p, (m) => m.vaso[p]]), munis, peru, (m) => m.vasoTotal);
  barras("g-atienden", PERFILES.map((p) => [p, ETIQ_PERFIL[p] ?? p, (m) => m.vaso[p] > 0]), munis, peru, { ordenar: true });
}

/* ---------------------------------------------------------
   Pestaña: Vigilancia y seguridad
   --------------------------------------------------------- */
function pintarSeguridad() {
  const munis = filtrar(estado.region), peru = filtrar(NACIONAL), total = munis.length;
  const conSerenazgo = munis.filter((m) => m.serenos > 0).length;
  const serenos = munis.reduce((s, m) => s + m.serenos, 0), interv = munis.reduce((s, m) => s + m.intervenciones, 0);
  const conOrg = munis.filter((m) => m.orgs > 0).length;
  const motivos = MOTIVOS.map(([k, nombre]) => [nombre, munis.reduce((s, m) => s + m.motivos[k], 0)]).sort((a, b) => b[1] - a[1]);
  document.getElementById("r-seguridad").innerHTML = !total ? "No hay municipalidades para esta selección." :
    `${EnLugar(estado.region)}, ${destacar(`${n0(conSerenazgo)} de ${n0(total)}`)} ${delTipo()} (${pct(conSerenazgo / total)}) tiene serenazgo, con ${destacar(n0(serenos))} efectivos en total. ` +
    (interv ? `El serenazgo hizo ${n0(interv)} intervenciones; el motivo más frecuente fue ${destacar(motivos[0][0].toLowerCase())} (${pct(motivos[0][1] / interv)}). ` : "") +
    `${n0(conOrg)} (${pct(conOrg / total)}) tiene alguna ronda o comité de autodefensa.`;
  kpis("k-seguridad", [
    { etiqueta: "Tienen serenazgo", valor: pct(total ? conSerenazgo / total : null), pie: `${n0(conSerenazgo)} de ${n0(total)}. ${pieComp(pct, parte(peru, (m) => m.serenos > 0))}` },
    { etiqueta: "Efectivos de serenazgo", valor: n0(serenos), pie: conSerenazgo ? `${n0(serenos / conSerenazgo)} por municipalidad con serenazgo` : "" },
    { etiqueta: "Intervenciones del serenazgo", valor: n0(interv), pie: "Suma de lo que reporta cada municipalidad" },
    { etiqueta: "Con rondas o comités de autodefensa", valor: pct(total ? conOrg / total : null), pie: `${n0(conOrg)} de ${n0(total)}. ${pieComp(pct, parte(peru, (m) => m.orgs > 0))}` },
  ]);
  barrasParte("g-motivos", MOTIVOS.map(([k, nombre]) => [k, nombre, (m) => m.motivos[k]]), munis, peru, (m) => m.intervenciones);
  barras("g-orgs", ORGS.map(([k, nombre]) => [k, nombre, (m) => m[k] > 0]), munis, peru, { ordenar: true });
  const tot = ORGS.map(([k, nombre]) => `${n0(munis.reduce((s, m) => s + m[k], 0))} ${nombre.toLowerCase()}`);
  document.getElementById("l-orgs").innerHTML = `En total, ${tot.slice(0, -1).join(", ")} y ${tot.at(-1)}.`;
}

/* ---------------------------------------------------------
   Mapa y ranking de regiones
   --------------------------------------------------------- */
function pintarMapa() {
  const lista = IND[estado.modulo];
  const ind = lista.find((i) => i.id === estado.mapa[estado.modulo]) ?? lista[0];
  const sel = document.getElementById("f-mapa");
  sel.innerHTML = lista.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  const filas = Object.keys(NOMBRES).map((r) => ({ region: r, ...valor(ind, filtrar(r)) })).filter((f) => f.v != null).sort((a, b) => b.v - a.v);
  const peru = valor(ind, filtrar(NACIONAL));
  const escala = ind.tipo === "suma" ? 1 : 100; // cortes en puntos porcentuales
  const valores = new Map(filas.map((f) => [f.region, f.v * escala]));
  if (!mapa) mapa = new Obs.Mapa("mapa", GEO, { alClic: elegirRegion, nombre: nombreRegion });
  const cortes = Obs.cortesCuantiles([...valores.values()]);
  mapa.pintar({ valores, color: (v) => Obs.colorTramo(v, cortes, C.escala), texto: (v) => fmtInd(ind, v / escala), elegida: estado.region });
  Obs.leyendaTramos("ley-mapa", cortes, C.escala, (v) => (ind.tipo === "suma" ? fmtInd(ind, v) : `${Obs.fmtN(v, 0)} %`));

  const alto = filas[0], bajo = filas.at(-1);
  let t = `${ind.nombre} (${delTipo()}): ${destacar(nombreRegion(alto.region))} tiene el valor más alto (${fmtInd(ind, alto.v)}) y ${destacar(nombreRegion(bajo.region))} el más bajo (${fmtInd(ind, bajo.v)})`;
  if (ind.tipo !== "suma") t += `; el Perú, ${fmtInd(ind, peru.v)}`;
  if (estado.region !== NACIONAL) {
    const pos = filas.findIndex((f) => f.region === estado.region);
    if (pos >= 0) t += `. ${nombreRegion(estado.region)} está en el puesto ${destacar(`${pos + 1} de ${filas.length}`)}`;
  }
  document.getElementById("l-mapa").innerHTML = `${t}.`;

  const max = Math.max(...filas.map((f) => f.v), ind.tipo === "suma" ? 0 : peru.v ?? 0);
  const fila = (f, pos, clase = "") => `<tr data-k="${f.region}" tabindex="0" class="${[clase, f.region === estado.region ? "elegida" : ""].join(" ").trim()}">
      <td class="num">${pos ?? ""}</td><td>${Obs.escapar(nombreRegion(f.region))}</td>
      <td class="num">${n0(ind.tipo === "pct" ? f.den : f.den)}</td>
      <td class="num"><span class="celda-barra"><i style="width:${Math.max(3, (f.v / max) * 90)}px"></i><b>${fmtInd(ind, f.v)}</b></span></td></tr>`;
  const cuerpo = filas.map((f, i) => fila(f, i + 1));
  if (ind.tipo !== "suma") {
    const pos = filas.filter((f) => f.v > peru.v).length;
    cuerpo.splice(pos, 0, fila({ region: NACIONAL, ...peru }, null, "peru"));
  }
  const caja = document.getElementById("t-regiones");
  caja.innerHTML = `<table class="tabla"><caption class="solo-lectores">${Obs.escapar(ind.nombre)} por región</caption><thead><tr><th class="num">#</th><th>Región</th><th class="num">Municipalidades</th><th class="num">${ind.tipo === "suma" ? (ind.unidad === "t" ? "Toneladas por día" : ind.unidad[0].toUpperCase() + ind.unidad.slice(1)) : "Porcentaje"}</th></tr></thead><tbody>${cuerpo.join("")}</tbody></table>`;
  const ir = (e) => { const r = e.target.closest("tr[data-k]"); if (r && (e.type === "click" || e.key === "Enter")) elegirRegion(r.dataset.k); };
  caja.querySelector("tbody").onclick = ir;
  caja.querySelector("tbody").onkeydown = ir;
}

/* ---------------------------------------------------------
   Tabla de municipalidades (con buscador)
   --------------------------------------------------------- */
const sino = (b) => (b ? '<span class="si">Sí</span>' : '<span class="no">No</span>');
function pintarMunicipalidades() {
  const munis = filtrar(estado.region);
  const q = buscar.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const visibles = munis.filter((m) => !q || m.buscar.includes(q)).sort((a, b) => a.region.localeCompare(b.region) || a.provincia.localeCompare(b.provincia) || (a.tipo === "Provincial" ? -1 : b.tipo === "Provincial" ? 1 : a.nombre.localeCompare(b.nombre)));
  const LIMITE = 300;
  const filas = visibles.slice(0, LIMITE);
  const base = (m) => `<td><strong>${Obs.escapar(m.nombre)}</strong></td><td>${Obs.escapar(m.provincia)}${estado.region === NACIONAL ? `, ${Obs.escapar(nombreRegion(m.region))}` : ""}</td><td>${m.tipo}</td>`;
  let cabeza, cuerpo;
  if (estado.modulo === "recursos") {
    cabeza = "<th>Municipalidad</th><th>Provincia</th><th>Tipo</th><th>Servicio de internet</th>";
    cuerpo = filas.map((m) => `<tr>${base(m)}<td>${sino(m.internet)}</td></tr>`);
  } else if (estado.modulo === "sociales") {
    cabeza = "<th>Municipalidad</th><th>Provincia</th><th>Tipo</th><th class=\"num\">Beneficiarios del Vaso de Leche</th><th class=\"num\">Niños de 0 a 6</th><th class=\"num\">Adultos mayores</th><th class=\"num\">Otros</th>";
    cuerpo = filas.map((m) => `<tr>${base(m)}<td class="num"><strong>${n0(m.vasoTotal)}</strong></td><td class="num">${n0(m.vaso["Niños de 0 a 6"])}</td><td class="num">${n0(m.vaso["Adultos mayores"])}</td>` +
      `<td class="num">${n0(m.vasoTotal - m.vaso["Niños de 0 a 6"] - m.vaso["Adultos mayores"])}</td></tr>`);
  } else if (estado.modulo === "seguridad") {
    cabeza = "<th>Municipalidad</th><th>Provincia</th><th>Tipo</th><th class=\"num\">Efectivos de serenazgo</th><th class=\"num\">Intervenciones</th><th class=\"num\">Rondas campesinas</th><th class=\"num\">Rondas urbanas</th><th class=\"num\">Comités de autodefensa</th>";
    cuerpo = filas.map((m) => `<tr>${base(m)}<td class="num">${n0(m.serenos)}</td><td class="num">${n0(m.intervenciones)}</td><td class="num">${n0(m.rondasCampesinas)}</td><td class="num">${n0(m.rondasUrbanas)}</td><td class="num">${n0(m.comites)}</td></tr>`);
  } else if (estado.modulo === "residuos") {
    cabeza = "<th>Municipalidad</th><th>Provincia</th><th>Tipo</th><th class=\"num\">Camiones (funcionan)</th><th>Frecuencia del recojo</th><th>Cobertura</th><th class=\"num\">Kilos por día</th>";
    cuerpo = filas.map((m) => `<tr>${base(m)}<td class="num">${m.camion ? `${n0(m.camiones)} (${n0(m.operativos)})` : "0"}</td><td>${Obs.escapar(m.frecuencia ?? "—")}</td><td>${m.cobertura ? ETIQ_COBERTURA[m.cobertura] : "—"}</td><td class="num">${m.kilos != null ? n0(m.kilos) : "—"}</td></tr>`);
  } else {
    cabeza = "<th>Municipalidad</th><th>Provincia</th><th>Tipo</th><th>Presupuesto participativo</th><th>Rendición de cuentas</th><th class=\"num\">Espacios de gestión (de 6)</th><th>Junta de Delegados</th>";
    cuerpo = filas.map((m) => `<tr>${base(m)}<td>${sino(m.espacios.P100_4)}</td><td>${sino(m.espacios.P100_6)}</td><td class="num">${ESPACIOS.filter((e) => e[2] === "gestion" && m.espacios[e[0]]).length}</td>` +
      `<td>${m.junta ? `${m.juntaActiva ? "En actividad" : "Inactiva"}${m.miembros != null ? `, ${n0(m.miembros)} miembros` : ""}` : '<span class="no">No tiene</span>'}</td></tr>`);
  }
  document.getElementById("t-munis-caja").innerHTML = visibles.length
    ? `<table class="tabla"><caption class="solo-lectores">Municipalidades ${enLugar(estado.region)}</caption><thead><tr>${cabeza}</tr></thead><tbody>${cuerpo.join("")}</tbody></table>`
    : '<p class="pista" style="padding:12px">Ninguna municipalidad coincide con la búsqueda.</p>';
  document.getElementById("d-munis").textContent = `${n0(munis.length)} ${delTipo()} ${enLugar(estado.region)}. Escribe el nombre para encontrar una.`;
  document.getElementById("n-munis").textContent = visibles.length > LIMITE ? `Se muestran ${LIMITE} de ${n0(visibles.length)}. Escribe un nombre o elige una región para ver las demás.` : "";
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  render();
}
function elegirRegion(cod) {
  if (cod === NACIONAL || cod === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: cod });
}

function render() {
  controles.sincronizar(estado);
  document.querySelectorAll("#f-tipo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tipo === estado.tipo));
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  ({ residuos: pintarResiduos, participacion: pintarParticipacion, recursos: pintarRecursos, sociales: pintarSociales, seguridad: pintarSeguridad })[estado.modulo]();
  pintarMapa();
  pintarMunicipalidades();
  Obs.escribirURL({
    modulo: estado.modulo === "residuos" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    tipo: estado.tipo === "Todas" ? null : estado.tipo,
    mapa: estado.mapa[estado.modulo] === DEFECTO_MAPA[estado.modulo] ? null : estado.mapa[estado.modulo],
  });
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  GEO = geo;
  C = Obs.tema();

  // Una municipalidad por idmunici, con lo que se usa de cada pestaña
  const limpio = (v) => (v == null ? "" : String(v).trim());
  const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  const si = (v) => limpio(v) === "Sí";
  const porId = new Map();
  const base = (f) => {
    const id = limpio(f.idmunici);
    if (!porId.has(id)) {
      const nombre = limpio(f.Nombre || f.Distrito);
      porId.set(id, { id, nombre, provincia: limpio(f.Provincia), region: limpio(f.Departamento), tipo: limpio(f.Tipomuni), espacios: {},
        buscar: `${nombre} ${limpio(f.Provincia)}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") });
    }
    return porId.get(id);
  };
  for (const f of Obs.expandir(datos.tablas["Gestión de residuos"])) {
    const m = base(f);
    Object.assign(m, { camion: num(f.P11A_5) === 1, operativos: num(f.P11A_5_1) ?? 0, noOperativos: num(f.P11A_5_2) ?? 0,
      frecuencia: limpio(f.P40_1) || null, kilos: num(f.P41_1), cobertura: limpio(f.P42_1) || null });
    m.camiones = m.operativos + m.noOperativos;
  }
  for (const f of Obs.expandir(datos.tablas["Participación Vecinal"])) {
    const m = base(f);
    for (const [k] of ESPACIOS) m.espacios[k] = si(f[k]);
    Object.assign(m, { junta: si(f.P102), miembros: num(f.P102_1_T), juntaActiva: limpio(f.P102_2) === "En actividad" });
  }
  // Pestañas sin idmunici: van en el mismo orden que «Gestión de residuos»
  const orden = [...porId.values()];
  const rec = Obs.expandir(datos.tablas["Recursos v3"] ?? { value: [] });
  orden.forEach((m, i) => (m.internet = limpio(rec[i]?.value) === "Sí"));
  const vistos = {};
  orden.forEach((m) => (m.vaso = Object.fromEntries(PERFILES.map((p) => [p, 0]))));
  for (const f of Obs.expandir(datos.tablas["Servicios Sociales v2"] ?? { variable: [] })) {
    const p = limpio(f.variable), i = (vistos[p] = (vistos[p] ?? -1) + 1);
    if (orden[i] && p in orden[i].vaso) orden[i].vaso[p] = num(f.value) ?? 0;
  }
  orden.forEach((m) => (m.vasoTotal = PERFILES.reduce((s, p) => s + m.vaso[p], 0)));
  for (const f of Obs.expandir(datos.tablas["Seguridad Ciudadana"])) {
    const m = base(f);
    Object.assign(m, { serenos: num(f.P69_1_T) ?? 0, intervenciones: num(f.P71A_T) ?? 0, motivos: Object.fromEntries(MOTIVOS.map(([k]) => [k, num(f[k]) ?? 0])),
      rondasUrbanas: num(f["Rondas Urbanas"]) ?? 0, rondasCampesinas: num(f["Rondas Campesinas"]) ?? 0, comites: num(f["Comités de Autodefensa"]) ?? 0 });
    m.orgs = m.rondasUrbanas + m.rondasCampesinas + m.comites;
  }
  MUNIS = orden.filter((m) => NOMBRES[m.region]);

  // Estado inicial desde la URL
  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const reg = (q.get("region") || "").toUpperCase();
  if (NOMBRES[reg]) Object.assign(estado, { ambito: "regional", region: reg });
  if (TIPOS.includes(q.get("tipo"))) estado.tipo = q.get("tipo");
  if (IND[estado.modulo].some((i) => i.id === q.get("mapa"))) estado.mapa[estado.modulo] = q.get("mapa");

  // Filtros: región (Obs.controlesComunes) y tipo de municipalidad
  const filtros = document.getElementById("filtros");
  const regiones = Object.entries(NOMBRES).map(([region, nombre]) => ({ region, nombre }));
  controles = Obs.controlesComunes(filtros, { regiones, anios: [2025, 2025], alCambiar: actualizar, comparar: false, periodo: false });
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <span class="etiqueta" id="lbl-tipo">Tipo de municipalidad</span>
      <div class="segmentado" id="f-tipo" role="group" aria-labelledby="lbl-tipo">
        ${TIPOS.map((t) => `<button type="button" data-tipo="${t}">${t === "Todas" ? "Todas" : t === "Provincial" ? "Provinciales" : "Distritales"}</button>`).join("")}
      </div>
    </div>`);
  document.getElementById("f-tipo").onclick = (e) => { const b = e.target.closest("button[data-tipo]"); if (b) actualizar({ tipo: b.dataset.tipo }); };
  document.getElementById("f-mapa").onchange = (e) => { estado.mapa[estado.modulo] = e.target.value; render(); };
  document.getElementById("f-buscar").oninput = (e) => { buscar = e.target.value; pintarMunicipalidades(); };

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
