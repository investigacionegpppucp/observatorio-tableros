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
// Motivos de las intervenciones del serenazgo (P71A), con los nombres del diccionario del RENAMU 2025
const MOTIVOS = [["P71A_6", "Consumo de alcohol en la vía pública"], ["P71A_7", "Consumo de drogas"], ["P71A_9", "Comercio informal"],
  ["P71A_8", "Accidentes de tránsito"], ["P71A_10", "Violencia familiar"], ["P71A_1", "Robo a transeúntes"], ["P71A_11", "Pandillaje"],
  ["P71A_2", "Robo a domicilio"], ["P71A_3", "Robo de vehículos"], ["P71A_5", "Robo a establecimientos"], ["P71A_4", "Robo de autopartes"], ["P71A_12", "Otro"]];
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

const estado = { modulo: "residuos", ambito: "nacional", region: NACIONAL, tipo: "Todas", mapa: { ...DEFECTO_MAPA }, nivelMapa: "regional" };

let C, GEO, controles, mapa, MUNIS = [];
let buscar = "";
// Filtros propios de la tabla de municipalidades: siguen a la región elegida arriba, pero se pueden cambiar solo para la tabla
const tabla = { region: NACIONAL, provincia: "", regionArriba: NACIONAL };

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
// «SAN JUAN DE LURIGANCHO» -> «San Juan de Lurigancho» (la base viene en mayúsculas y sin tildes)
const MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"]);
const titulo = (s) => String(s ?? "").toLowerCase().split(/(\s+|-)/).map((w, i) => (i && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
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
  Obs.barras(id, categorias.map(([clave, etiqueta, f]) => ({ clave, etiqueta, valor: parte(munis, f), n: munis.filter(f).length, comp: comp ? parte(peru, f) : null })), {
    formato: pct, nombre: nombreRegion(estado.region), comparacion: comp ? "Perú" : null, ordenar,
    detalle: (d) => `${n0(d.n)} de ${n0(munis.length)} municipalidades`,
  });
}

/* Barras de la parte de un total (por ejemplo, intervenciones por motivo), con la marca del Perú */
function barrasParte(id, categorias, munis, peru, total, unidad = "") {
  const comp = estado.region !== NACIONAL;
  const suma = (lista, f) => lista.reduce((s, m) => s + (f(m) ?? 0), 0);
  const tm = suma(munis, total), tp = suma(peru, total);
  Obs.barras(id, categorias.map(([clave, etiqueta, f]) => ({ clave, etiqueta, valor: tm ? suma(munis, f) / tm : 0, n: suma(munis, f), comp: comp && tp ? suma(peru, f) / tp : null })), {
    formato: pct, nombre: nombreRegion(estado.region), comparacion: comp ? "Perú" : null, ordenar: true,
    detalle: (d) => `${n0(d.n)} ${unidad}`,
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
  barrasParte("g-perfiles", PERFILES.map((p) => [p, ETIQ_PERFIL[p] ?? p, (m) => m.vaso[p]]), munis, peru, (m) => m.vasoTotal, "beneficiarios");
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
  barrasParte("g-motivos", MOTIVOS.map(([k, nombre]) => [k, nombre, (m) => m.motivos[k]]), munis, peru, (m) => m.intervenciones, "intervenciones");
  barras("g-orgs", ORGS.map(([k, nombre]) => [k, nombre, (m) => m[k] > 0]), munis, peru, { ordenar: true });
  const tot = ORGS.map(([k, nombre]) => `${n0(munis.reduce((s, m) => s + m[k], 0))} ${nombre.toLowerCase()}`);
  document.getElementById("l-orgs").innerHTML = `En total, ${tot.slice(0, -1).join(", ")} y ${tot.at(-1)}.`;
}

/* ---------------------------------------------------------
   Tabla ordenable (cada columna ordena de mayor a menor o al revés)
   columnas: [{ clave, titulo, num, valor(f), html(f) }]; filas: objetos
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
    ? `<table class="tabla ordenable"><caption class="solo-lectores">${Obs.escapar(descripcion)}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ""}</table>` +
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
const celdaBarra = (texto, v, max, ancho = 90) => `<span class="celda-barra"><i style="width:${Math.max(3, (v / (max || 1)) * ancho)}px"></i><b>${texto}</b></span>`;
const sinTilde = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ---------------------------------------------------------
   Mapa por región, provincia o distrito, con su tabla
   --------------------------------------------------------- */
const NIVELES_MAPA = [["regional", "Regional"], ["provincial", "Provincial"], ["distrital", "Distrital"]];
const mapas = {}, GEOS = {};
// Filtros de la tabla del mapa: siguen a la región elegida arriba
const mt = { region: NACIONAL, provincia: "", buscar: "", regionArriba: NACIONAL, elegida: null };

// Unidades del nivel elegido: { codigo, region, provincia, nombre, tipo, munis }
function unidades(nivel) {
  const munis = filtrar(NACIONAL);
  if (nivel === "regional") return Object.keys(NOMBRES).map((r) => ({ codigo: r, region: r, nombre: nombreRegion(r), munis: munis.filter((m) => m.region === r) }));
  if (nivel === "provincial") {
    const grupos = new Map();
    for (const m of munis) {
      const k = m.id.slice(0, 4);
      if (!grupos.has(k)) grupos.set(k, { codigo: k, region: m.region, provincia: m.provincia, nombre: m.provincia, munis: [] });
      grupos.get(k).munis.push(m);
    }
    return [...grupos.values()];
  }
  return munis.map((m) => ({ codigo: m.id, region: m.region, provincia: m.provincia, nombre: m.distrito, tipo: m.tipo, munis: [m] }));
}

async function geoDe(nivel) {
  if (nivel === "regional") return GEO;
  if (!GEOS[nivel]) {
    const g = await Obs.cargarJSON(`../../mapas/peru_${nivel === "provincial" ? "provincias" : "distritos"}.geojson`);
    // los países vecinos salen del mapa de regiones
    GEOS[nivel] = { ...g, features: [...GEO.features.filter((f) => f.properties.tipo === "pais"), ...g.features] };
  }
  return GEOS[nivel];
}

async function pintarMapa() {
  const lista = IND[estado.modulo];
  const ind = lista.find((i) => i.id === estado.mapa[estado.modulo]) ?? lista[0];
  const nivel = estado.nivelMapa;
  document.getElementById("f-mapa").innerHTML = lista.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  document.querySelectorAll("#f-nivel-mapa button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.nivel === nivel));
  if (mt.regionArriba !== estado.region) Object.assign(mt, { region: estado.region, provincia: "", regionArriba: estado.region, elegida: null });

  const todas = unidades(nivel).map((u) => ({ ...u, ...valor(ind, u.munis) }));
  const filas = todas.filter((u) => u.v != null);
  const peru = valor(ind, filtrar(NACIONAL));
  const binario = nivel === "distrital" && ind.tipo === "pct"; // en un distrito, un indicador de «tienen…» es sí o no
  const escala = ind.tipo === "suma" ? 1 : 100;
  const valores = new Map(filas.map((u) => [u.codigo, u.v * escala]));
  const NOMBRE = new Map(todas.map((u) => [u.codigo, nivel === "regional" ? u.nombre : `${titulo(u.nombre)} (${nombreRegion(u.region)})`]));

  NIVELES_MAPA.forEach(([n]) => (document.getElementById(`mapa-${n}`).hidden = n !== nivel));
  const geo = await geoDe(nivel);
  if (nivel !== estado.nivelMapa) return; // se cambió de nivel mientras cargaba
  const alClic = (cod) => (nivel === "regional" ? elegirRegion(cod) : marcarEnTabla(cod));
  if (!mapas[nivel]) mapas[nivel] = new Obs.Mapa(`mapa-${nivel}`, geo, { alClic: (c) => alClicMapa(c), nombre: (c) => NOMBRE_MAPA.get(c) ?? c });
  NOMBRE_MAPA = NOMBRE;
  alClicMapa = alClic;
  if (binario) {
    const colores = [C.escala[4], C.escala[1]];
    mapas[nivel].pintar({ valores, color: (v) => (v > 0 ? colores[0] : colores[1]), texto: (v) => (v > 0 ? "Sí" : "No"), elegida: nivel === "regional" ? estado.region : mt.elegida });
    Obs.leyendaCategorias("ley-mapa", [["Sí", colores[0]], ["No", colores[1]]]);
  } else {
    const cortes = Obs.cortesCuantiles([...valores.values()]);
    mapas[nivel].pintar({ valores, color: (v) => Obs.colorTramo(v, cortes, C.escala), texto: (v) => fmtInd(ind, v / escala), elegida: nivel === "regional" ? estado.region : mt.elegida });
    Obs.leyendaTramos("ley-mapa", cortes, C.escala, (v) => (ind.tipo === "suma" ? fmtInd(ind, v) : `${Obs.fmtN(v, 0)} %`));
  }

  // Con una región elegida en la tabla, el mapa de provincias o distritos se acerca a ella
  if (nivel !== "regional") {
    const codigos = new Set(todas.filter((u) => mt.region !== NACIONAL && u.region === mt.region).map((u) => (nivel === "provincial" ? u.codigo : u.codigo)));
    const caja = L.latLngBounds([]);
    mapas[nivel].principal.capaRegiones.eachLayer((capa) => { if (codigos.has(capa.feature.properties.region)) caja.extend(capa.getBounds()); });
    if (caja.isValid()) mapas[nivel].principal.fitBounds(caja, { padding: [12, 12] });
  }

  // Lectura
  const unidad = { regional: "región", provincial: "provincia", distrital: "distrito" }[nivel];
  let t;
  if (binario) {
    const base = filas.filter((u) => mt.region === NACIONAL || u.region === mt.region), si = base.filter((u) => u.v > 0).length;
    t = `${ind.nombre}: ${destacar(`${n0(si)} de ${n0(base.length)}`)} ${delTipo()} ${enLugar(mt.region)} (${pct(si / (base.length || 1))}). Cada distrito se pinta según su municipalidad`;
  } else {
    const orden = [...filas].sort((a, b) => b.v - a.v), alto = orden[0], bajo = orden.at(-1);
    t = alto ? `${ind.nombre} (${delTipo()}), por ${unidad}: ${destacar(NOMBRE.get(alto.codigo))} tiene el valor más alto (${fmtInd(ind, alto.v)}) y ${destacar(NOMBRE.get(bajo.codigo))} el más bajo (${fmtInd(ind, bajo.v)})` : "No hay datos para esta selección";
    if (ind.tipo !== "suma" && peru.v != null) t += `; el Perú, ${fmtInd(ind, peru.v)}`;
  }
  document.getElementById("l-mapa").innerHTML = `${t}.`;
  document.getElementById("n-mapa").textContent = nivel === "distrital"
    ? "En el mapa, los distritos creados en los últimos años aún no tienen límite propio y quedan dentro del distrito del que se separaron; sí aparecen en la tabla. En la municipalidad provincial, el distrito es la capital de la provincia."
    : nivel === "provincial" ? "Cada provincia reúne a su municipalidad provincial y a sus municipalidades distritales. Putumayo (Loreto) aún no tiene límite propio en el mapa." : "";

  // Tabla del mapa, con filtros y columnas ordenables
  const regiones = Object.entries(NOMBRES).sort((a, b) => a[1].localeCompare(b[1], "es"));
  const opcion = (v, e, sel) => `<option value="${Obs.escapar(v)}"${v === sel ? " selected" : ""}>${Obs.escapar(e)}</option>`;
  document.getElementById("f-mt-region").innerHTML = opcion(NACIONAL, "Todas las regiones", mt.region) + regiones.map(([k, n]) => opcion(k, n, mt.region)).join("");
  document.getElementById("f-mt-region").closest(".filtro-local").hidden = nivel === "regional";
  const provincias = [...new Set(todas.filter((u) => mt.region === NACIONAL || u.region === mt.region).map((u) => u.provincia))].filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
  if (!provincias.includes(mt.provincia)) mt.provincia = "";
  document.getElementById("f-mt-provincia").innerHTML = opcion("", "Todas las provincias", mt.provincia) + provincias.map((p) => opcion(p, titulo(p), mt.provincia)).join("");
  document.getElementById("f-mt-provincia").closest(".filtro-local").hidden = nivel !== "distrital";
  document.getElementById("f-mt-buscar").closest(".buscador-tabla").hidden = nivel === "regional";
  document.getElementById("f-mt-buscar").value = mt.buscar;
  const q = sinTilde(mt.buscar.trim());
  const visibles = (nivel === "regional" ? todas : todas.filter((u) => (mt.region === NACIONAL || u.region === mt.region) && (!mt.provincia || u.provincia === mt.provincia) &&
    (!q || sinTilde(`${u.nombre} ${u.provincia}`).includes(q)))).filter((u) => u.v != null || nivel === "distrital");
  const max = Math.max(...visibles.map((u) => u.v ?? 0), ind.tipo === "suma" ? 0 : peru.v ?? 0);
  const valorHtml = (u) => (u.v == null ? "—" : binario ? (u.v > 0 ? '<span class="si">Sí</span>' : '<span class="no">No</span>') : celdaBarra(fmtInd(ind, u.v), u.v, max, 50));
  const colValor = { clave: "v", titulo: ind.tipo === "suma" ? (ind.unidad === "t" ? "Toneladas por día" : ind.unidad[0].toUpperCase() + ind.unidad.slice(1)) : binario ? "¿Cumple?" : "Porcentaje", num: !binario, valor: (u) => u.v, html: valorHtml };
  const colRegion = { clave: "region", titulo: "Región", valor: (u) => nombreRegion(u.region), html: (u) => Obs.escapar(nombreRegion(u.region)) };
  const colMunis = { clave: "n", titulo: "Municipalidades", num: true, valor: (u) => u.munis.length, html: (u) => n0(u.munis.length) };
  const columnas = nivel === "regional" ? [colRegion, colMunis, colValor]
    : nivel === "provincial" ? [colRegion, { clave: "nombre", titulo: "Provincia", valor: (u) => u.nombre, html: (u) => `<strong>${Obs.escapar(titulo(u.nombre))}</strong>` }, colMunis, colValor]
      : [colRegion, { clave: "provincia", titulo: "Provincia", valor: (u) => u.provincia, html: (u) => Obs.escapar(titulo(u.provincia)) },
        { clave: "nombre", titulo: "Municipalidad", valor: (u) => u.nombre, html: (u) => `<strong>${Obs.escapar(titulo(u.nombre))}</strong><small class="tipo-muni">${u.tipo}</small>` }, colValor];
  const pie = ind.tipo !== "suma" && peru.v != null ? `<tr class="peru"><td colspan="${columnas.length - 1}">Perú</td><td class="num">${fmtInd(ind, peru.v)}</td></tr>` : "";
  tablaOrdenable("t-regiones", columnas, visibles, { inicial: { clave: "v", dir: -1 }, claveFila: (u) => u.codigo, elegida: nivel === "regional" ? estado.region : mt.elegida,
    pie, descripcion: `${ind.nombre} por ${unidad}`, alClic: nivel === "regional" ? elegirRegion : marcarEnTabla });
  document.getElementById("d-mt").textContent = nivel === "regional" ? "" : `${n0(visibles.length)} ${nivel === "provincial" ? "provincias" : "municipalidades"} en la tabla.`;
}
let NOMBRE_MAPA = new Map(), alClicMapa = () => {};
// En provincias y distritos, un clic en el mapa o en la tabla resalta esa fila y la pinta en el mapa
function marcarEnTabla(cod) {
  mt.elegida = mt.elegida === cod ? null : cod;
  pintarMapa().then(() => document.querySelector(`#t-regiones tr[data-k="${CSS.escape(cod)}"]`)?.scrollIntoView({ block: "nearest" }));
}

/* ---------------------------------------------------------
   Tabla de municipalidades (con filtros y columnas ordenables)
   --------------------------------------------------------- */
const sino = (b) => (b ? '<span class="si">Sí</span>' : '<span class="no">No</span>');
function pintarMunicipalidades() {
  // Si cambió la región elegida arriba, la tabla la sigue
  if (tabla.regionArriba !== estado.region) Object.assign(tabla, { region: estado.region, provincia: "", regionArriba: estado.region });
  const enRegion = filtrar(tabla.region);
  const provincias = [...new Set(enRegion.map((m) => m.provincia))].sort((a, b) => a.localeCompare(b, "es"));
  if (!provincias.includes(tabla.provincia)) tabla.provincia = "";
  const opcion = (v, e, sel) => `<option value="${Obs.escapar(v)}"${v === sel ? " selected" : ""}>${Obs.escapar(e)}</option>`;
  document.getElementById("f-tabla-region").innerHTML = opcion(NACIONAL, "Todas las regiones", tabla.region) +
    Object.entries(NOMBRES).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, n]) => opcion(k, n, tabla.region)).join("");
  document.getElementById("f-tabla-provincia").innerHTML = opcion("", "Todas las provincias", tabla.provincia) + provincias.map((p) => opcion(p, titulo(p), tabla.provincia)).join("");

  const munis = enRegion.filter((m) => !tabla.provincia || m.provincia === tabla.provincia);
  const q = sinTilde(buscar.trim());
  const visibles = munis.filter((m) => !q || m.buscar.includes(q));
  const texto = (clave, tituloCol, f) => ({ clave, titulo: tituloCol, valor: f, html: (m) => Obs.escapar(f(m) ?? "—") });
  const numero = (clave, tituloCol, f, fuerte = false) => ({ clave, titulo: tituloCol, num: true, valor: f, html: (m) => (f(m) == null ? "—" : fuerte ? `<strong>${n0(f(m))}</strong>` : n0(f(m))) });
  const sn = (clave, tituloCol, f) => ({ clave, titulo: tituloCol, valor: (m) => (f(m) ? 1 : 0), html: (m) => sino(f(m)) });
  const ubicacion = [texto("region", "Región", (m) => nombreRegion(m.region)), texto("provincia", "Provincia", (m) => titulo(m.provincia)),
    { clave: "distrito", titulo: "Distrito", valor: (m) => m.distrito, html: (m) => `<strong>${Obs.escapar(titulo(m.distrito))}</strong>` },
    texto("tipo", "Tipo de municipalidad", (m) => m.tipo)];
  const datos = {
    recursos: [sn("internet", "Servicio de internet", (m) => m.internet)],
    sociales: [numero("vaso", "Beneficiarios del Vaso de Leche", (m) => m.vasoTotal, true), numero("ninos", "Niños de 0 a 6", (m) => m.vaso["Niños de 0 a 6"]),
      numero("mayores", "Adultos mayores", (m) => m.vaso["Adultos mayores"]), numero("otros", "Otros", (m) => m.vasoTotal - m.vaso["Niños de 0 a 6"] - m.vaso["Adultos mayores"])],
    seguridad: [numero("serenos", "Efectivos de serenazgo", (m) => m.serenos), numero("interv", "Intervenciones", (m) => m.intervenciones),
      numero("rc", "Rondas campesinas", (m) => m.rondasCampesinas), numero("ru", "Rondas urbanas", (m) => m.rondasUrbanas), numero("ca", "Comités de autodefensa", (m) => m.comites)],
    residuos: [numero("op", "Camiones operativos", (m) => m.operativos), texto("frec", "Frecuencia del recojo", (m) => m.frecuencia), numero("kg", "Kilos por día", (m) => m.kilos)],
    participacion: [sn("pp", "Presupuesto participativo", (m) => m.espacios.P100_4), sn("rc", "Rendición de cuentas", (m) => m.espacios.P100_6),
      numero("esp", "Espacios de gestión (de 6)", (m) => ESPACIOS.filter((e) => e[2] === "gestion" && m.espacios[e[0]]).length),
      { clave: "junta", titulo: "Junta de Delegados", valor: (m) => (m.junta ? (m.juntaActiva ? 2 : 1) : 0),
        html: (m) => (m.junta ? `${m.juntaActiva ? "En actividad" : "Inactiva"}${m.miembros != null ? `, ${n0(m.miembros)} miembros` : ""}` : '<span class="no">No tiene</span>') }],
  }[estado.modulo];
  const donde = tabla.provincia ? `en la provincia de ${titulo(tabla.provincia)} (${nombreRegion(tabla.region)})` : enLugar(tabla.region);
  tablaOrdenable("t-munis-caja", [...ubicacion, ...datos], visibles, { inicial: { clave: "region", dir: 1 }, claveFila: (m) => m.id, descripcion: `Municipalidades ${donde}` });
  document.getElementById("d-munis").textContent = `${n0(munis.length)} ${delTipo()} ${donde}. Elige la región y la provincia, o escribe el nombre del distrito. Haz clic en el título de una columna para ordenar.`;
  document.getElementById("n-munis").textContent = "";
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
    nivel: estado.nivelMapa === "regional" ? null : estado.nivelMapa,
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
      const nombre = limpio(f.Nombre || f.Distrito), distrito = limpio(f.Distrito || f.Nombre);
      porId.set(id, { id, nombre, distrito, provincia: limpio(f.Provincia), region: limpio(f.Departamento), tipo: limpio(f.Tipomuni), espacios: {},
        buscar: `${nombre} ${distrito} ${limpio(f.Provincia)}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") });
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
  if (NIVELES_MAPA.some(([n]) => n === q.get("nivel"))) estado.nivelMapa = q.get("nivel");

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
  document.getElementById("f-nivel-mapa").innerHTML = NIVELES_MAPA.map(([n, e]) => `<button type="button" data-nivel="${n}">${e}</button>`).join("");
  document.getElementById("f-nivel-mapa").onclick = (e) => { const b = e.target.closest("button[data-nivel]"); if (b) { estado.nivelMapa = b.dataset.nivel; mt.elegida = null; render(); } };
  document.getElementById("f-mt-region").onchange = (e) => { Object.assign(mt, { region: e.target.value, provincia: "", elegida: null }); pintarMapa(); };
  document.getElementById("f-mt-provincia").onchange = (e) => { mt.provincia = e.target.value; pintarMapa(); };
  document.getElementById("f-mt-buscar").oninput = (e) => { mt.buscar = e.target.value; clearTimeout(window.__mtb); window.__mtb = setTimeout(pintarMapa, 200); };
  document.getElementById("f-buscar").oninput = (e) => { buscar = e.target.value; pintarMunicipalidades(); };
  document.getElementById("f-tabla-region").onchange = (e) => { Object.assign(tabla, { region: e.target.value, provincia: "" }); pintarMunicipalidades(); };
  document.getElementById("f-tabla-provincia").onchange = (e) => { tabla.provincia = e.target.value; pintarMunicipalidades(); };

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
