/* =========================================================
   Tablero de Educación — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script (Tableros >
   Publicar tableros) desde el Sheet «[Tableros] Educación», que llena
   el notebook procesos/educacion/actualizar_educacion.ipynb con los
   cuadros de ESCALE. Una pestaña por indicador, en formato largo:
     nivel, (grado, curso), grupo, categoria, codigo, anio, valor
   grupo: Perú, Región, Área, Sexo, Gestión o Área y sexo.
   Porcentajes de 0 a 1; alumnos por docente, en número de alumnos;
   gasto por alumno, en soles corrientes. Los locales escolares tienen
   un solo nivel, «Educación básica», y solo la serie 2001-2015.
   Un indicador cuya pestaña no viene en datos.json no se muestra.

   Tres módulos (pestañas): Estudiantes, Docentes y Escuelas. Filtros
   comunes arriba: región, «Comparar con» y nivel educativo. En cada
   pestaña: resumen dinámico, cifras clave (con su cambio y su línea),
   evolución de cada indicador (con «Ver por» zona, sexo o gestión, que
   muestra las diferencias en el tiempo) y mapa con
   ranking. Patrón: un objeto `estado`, funciones puras
   para leer los datos y una sola `render()`.

   Parámetros de URL:
     ?modulo=estudiantes|docentes|escuelas
     &region=CUSCO            región elegida (código en mayúsculas)
     &comparar=NACIONAL       Perú (NACIONAL) u otra región; vacío = sin comparación
     &nivel=Secundaria        Inicial, Primaria (por defecto) o Secundaria
     &grado=2p                grado de primaria en logros de aprendizaje (4p por defecto)
     &verpor=atraso:Área      desglose de los gráficos de evolución (indicador:grupo, separados por «-»)
     &mapa=aprendizajes-Matemática-2019   indicador, curso y año del mapa de la pestaña
     &embed=1                 oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "educacion";
const MODULOS = ["estudiantes", "docentes", "escuelas"];
const ARCHIVOS = [{ clave: "educacion_base", etiqueta: "Indicadores de educación por región y año (ESCALE, 2000-2025)" }];
const NACIONAL = "NACIONAL";
const NIVELES = ["Inicial", "Primaria", "Secundaria"];
const CURSOS = ["Lectura", "Matemática", "Ciencias Sociales", "Ciencia y Tecnología"];
const COLOR_CURSO = { Lectura: "--curso-lectura", Matemática: "--curso-matematica", "Ciencias Sociales": "--curso-sociales", "Ciencia y Tecnología": "--curso-ciencia" };
const COLOR_NIVEL = { Inicial: "--nivel-inicial", Primaria: "--nivel-primaria", Secundaria: "--nivel-secundaria" };
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const pct = (v) => Obs.fmtPct(v, 1);
const num1 = (v) => (v == null ? "—" : Obs.fmtN(v, 1));
const soles = (v) => (v == null ? "—" : `S/\u00a0${Obs.fmtN(v, 0)}`);
const BASICA = "Educación básica"; // nivel único de los indicadores de locales escolares

/* Grados evaluados en logros de aprendizaje */
const GRADO = {
  "4p": { nombre: "4.º de primaria", nivel: "Primaria" },
  "2p": { nombre: "2.º de primaria", nivel: "Primaria" },
  "2s": { nombre: "2.º de secundaria", nivel: "Secundaria" },
};
const GRADO_A_SERIE = { "2.º de primaria": "2p", "4.º de primaria": "4p", "2.º de secundaria": "2s" };

/* Indicadores: qué niveles tienen, si es mejor que suba o que baje, y cómo se dicen */
const IND = {
  aprendizajes: { corto: "Logros de aprendizaje", niveles: ["Primaria", "Secundaria"], formato: pct, cursos: true, mejor: "alto" },
  atraso: { corto: "Atraso escolar", niveles: ["Primaria", "Secundaria"], formato: pct, mejor: "bajo",
    frase: (n) => `de los alumnos de ${n} tenía atraso escolar` },
  desaprobados: { corto: "Desaprobados", niveles: ["Primaria", "Secundaria"], formato: pct, hueco: [2020, 2022], mejor: "bajo",
    frase: (n) => `de los alumnos de ${n} desaprobó el año` },
  titulados: { corto: "Docentes titulados", niveles: NIVELES, formato: pct, mejor: "alto",
    frase: (n) => `de los docentes de ${n} tenía título pedagógico` },
  alumnos_docente: { corto: "Alumnos por docente", niveles: NIVELES, formato: num1, numero: true, mejor: "bajo",
    frase: (n) => `alumnos por docente en ${n}` },
  internet: { corto: "Escuelas con internet", niveles: ["Primaria", "Secundaria"], formato: pct, mejor: "alto",
    frase: (n) => `de las escuelas de ${n} tenía acceso a internet` },
  conclusion: { corto: "Conclusión", niveles: ["Primaria", "Secundaria"], formato: pct, mejor: "alto",
    frase: (n) => (n === "primaria" ? "de los adolescentes de 12 a 13 años había terminado la primaria" : "de los jóvenes de 17 a 18 años había terminado la secundaria") },
  asistencia: { corto: "Asistencia a inicial", niveles: ["Inicial"], formato: pct, mejor: "alto",
    frase: () => "de los niños de 3 a 5 años asistía a educación inicial" },
  // fijo: un solo nivel (educación básica), sea cual sea el nivel elegido arriba
  locales_servicios: { corto: "Locales con servicios básicos", niveles: [BASICA], fijo: true, formato: pct, mejor: "alto",
    frase: () => "de los locales escolares públicos tenía agua, desagüe y luz" },
  locales_estado: { corto: "Locales en buen estado", niveles: [BASICA], fijo: true, formato: pct, mejor: "alto",
    frase: () => "de los locales escolares públicos estaba en buen estado" },
  gasto: { corto: "Gasto por alumno", niveles: NIVELES, formato: soles, numero: true, mejor: "alto", columna: "Soles por alumno",
    difTxt: (d) => soles(Math.abs(d)),
    texto: (v, n) => `el gasto público por alumno de ${n} fue de ${v}` },
};
// Un indicador sin su pestaña en datos.json no se muestra
const hay = (ind) => HAY.has(ind);

/* Tarjetas de cada pestaña y qué dice su resumen */
const MOD = {
  estudiantes: {
    evol: [
      { ind: "aprendizajes", titulo: "¿Cuántos alumnos logran los aprendizajes esperados?",
        desc: "Porcentaje de alumnos que alcanza el nivel satisfactorio en la evaluación nacional, por curso." },
      { par: [
        { ind: "atraso", titulo: "¿Cuántos van atrasados?", desc: "Porcentaje de alumnos con dos o más años más que la edad de su grado." },
        { ind: "desaprobados", titulo: "¿Cuántos desaprueban el año?", desc: "Porcentaje de alumnos que no aprobó el año. Entre 2020 y 2022 hubo promoción guiada." },
      ] },
      { par: [
        { ind: "conclusion", titulo: "¿Cuántos terminan el colegio a tiempo?", desc: "Porcentaje de adolescentes de 12 a 13 años que terminó la primaria, o de jóvenes de 17 a 18 años que terminó la secundaria." },
        { ind: "asistencia", titulo: "¿Cuántos niños van a inicial?", desc: "Porcentaje de niños de 3 a 5 años que asiste a educación inicial (tasa neta de asistencia)." },
      ] },
    ],
    indicadores: ["aprendizajes", "atraso", "desaprobados", "conclusion", "asistencia"],
    // se muestran las primeras cuatro con datos para el nivel elegido
    kpis: [["aprendizajes", "Lectura"], ["aprendizajes", "Matemática"], ["asistencia"], ["conclusion"], ["atraso"], ["desaprobados"]],
    resumen: { principal: ["aprendizajes", "Lectura"], tendencia: "atraso", brecha: ["aprendizajes", "Lectura"] },
  },
  docentes: {
    evol: [{ par: [
      { ind: "titulados", titulo: "¿Cuántos docentes tienen título pedagógico?", desc: "Porcentaje de docentes con título pedagógico en la especialidad del nivel que enseñan." },
      { ind: "alumnos_docente", titulo: "¿Cuántos alumnos hay por docente?", desc: "Número de alumnos por cada docente." },
    ] }],
    indicadores: ["titulados", "alumnos_docente"],
    kpis: [["titulados"], ["alumnos_docente"]],
    resumen: { principal: ["titulados"], tendencia: "alumnos_docente", brecha: ["titulados"] },
  },
  escuelas: {
    evol: [
      { par: [
        { ind: "internet", titulo: "¿Cuántas escuelas tienen internet?", desc: "Porcentaje de escuelas con acceso a internet." },
        { ind: "gasto", titulo: "¿Cuánto gasta el Estado por alumno?", desc: "Gasto público en educación por alumno, en soles corrientes (no descuenta la inflación)." },
      ] },
      { par: [
        { ind: "locales_servicios", titulo: "¿Cuántos locales tienen agua, desagüe y luz?", desc: "Porcentaje de locales escolares públicos con los tres servicios básicos. Toda la educación básica, 2001-2015." },
        { ind: "locales_estado", titulo: "¿Cuántos locales están en buen estado?", desc: "Porcentaje de locales escolares públicos en buen estado. Toda la educación básica, 2001-2015." },
      ] },
    ],
    indicadores: ["internet", "gasto", "locales_servicios", "locales_estado"],
    kpis: [["internet"], ["gasto"], ["locales_servicios"], ["locales_estado"], ["internet", "", "Área:Urbana"], ["internet", "", "Área:Rural"]],
    resumen: { principal: ["internet"], tendencia: "gasto", brecha: ["internet"] },
  },
};
const NIVELES_MOD = (m) => NIVELES.filter((n) => MOD[m].indicadores.some((i) => hay(i) && IND[i].niveles.includes(n)));

/* Notas al pie de las tarjetas de algunos indicadores */
const NOTA = {
  conclusion: "Fuente: Encuesta Nacional de Hogares (ENAHO) del INEI.",
  asistencia: "Fuente: Encuesta Nacional de Hogares (ENAHO) del INEI.",
  locales_servicios: "Solo hay serie de 2001 a 2015: ESCALE no publica este indicador desde 2016. Fuente: Censo Escolar (Minedu).",
  locales_estado: "Solo hay serie de 2001 a 2015: ESCALE no publica este indicador desde 2016. No hay dato de 2004, ni de Tumbes en 2010. Fuente: Censo Escolar (Minedu).",
  gasto: "En soles de cada año: no descuenta la inflación. Fuente: SIAF-SP (MEF) y Censo Escolar (Minedu).",
};

/* Datos de ESCALE que no se muestran por ser errores de copia evidentes
   (ver docs/revision-datos-educacion.md). Se quedan en el Sheet tal como vienen.
   [indicador, serie, curso, lugar, año] */
const OCULTOS = [
  ["aprendizajes", "2p", "Matemática", "LIMA METROPOLITANA", 2007], // la misma cifra que Lambayeque (8,0125 %)
  ["titulados", "Inicial", "", "Área y sexo:Rural Femenino", 2022],   // la misma cifra que las urbanas
  ["titulados", "Primaria", "", "Área y sexo:Rural Femenino", 2022],
  ["titulados", "Secundaria", "", "Área y sexo:Rural Femenino", 2022],
];

/* Desgloses: cada uno es un par de categorías. El primer color va a la primera. */
const PARES = {
  Área: { nombre: "Zona", boton: "Zona", cats: [["Urbana", "Zona urbana", "Urbana"], ["Rural", "Zona rural", "Rural"]] },
  Gestión: { nombre: "Tipo de escuela", boton: "Gestión", cats: [["Pública", "Escuela pública", "Pública"], ["Privada", "Escuela privada", "Privada"]] },
  Sexo: { nombre: "Sexo", boton: "Sexo", cats: [["Femenino", "Mujeres", "Mujeres"], ["Masculino", "Hombres", "Hombres"]] },
};
const GRUPOS = Object.keys(PARES);

const estado = {
  modulo: "estudiantes",
  ambito: "nacional",
  region: NACIONAL,
  comparar: "",           // "", NACIONAL o un código de región
  nivel: "Primaria",
  grado: "4p",            // grado de primaria en logros de aprendizaje
  verPor: {},             // indicador -> "Total" o un grupo de PARES
  mapa: {
    estudiantes: { ind: "aprendizajes", curso: "Lectura", anio: null },
    docentes: { ind: "titulados", curso: "", anio: null },
    escuelas: { ind: "internet", curso: "", anio: null },
  },
};
const DEFECTO = JSON.parse(JSON.stringify({ mapa: estado.mapa }));

let C, GEO, controles;
const V = new Map();          // "ind|serie|curso|lugar|anio" -> valor (lugar: código de región, NACIONAL o "Área:Rural")
const ANIOS = new Map();      // "ind|serie|curso|lugar" -> años con dato, ordenados
const NOMBRE_REGION = new Map([[NACIONAL, "Perú"]]);
let REGIONES = [];
const mapas = {};
const HAY = new Set();        // indicadores con datos
const ORDEN = {};             // id de tabla -> { clave, dir }
const BUSCAR = {};            // id de tabla -> texto buscado

/* ---------------------------------------------------------
   Lectura de los datos
   --------------------------------------------------------- */
const clave = (...p) => p.join("|");
const val = (ind, s, curso, lugar, a) => V.get(clave(ind, s, curso, lugar, a)) ?? null;
const aniosDe = (ind, s, curso, lugar) => ANIOS.get(clave(ind, s, curso, lugar)) ?? [];
const ultimo = (ind, s, curso, lugar) => aniosDe(ind, s, curso, lugar).at(-1) ?? null;
const aniosRegionales = (ind, s, curso) => [...new Set(REGIONES.flatMap((r) => aniosDe(ind, s, curso, r.region)))].sort((a, b) => a - b);
// Serie de un indicador para el nivel elegido: el nivel, o el grado evaluado en logros de aprendizaje
const serieDe = (ind) => {
  if (!hay(ind)) return null;
  if (IND[ind].fijo) return IND[ind].niveles[0];
  if (!IND[ind].niveles.includes(estado.nivel)) return null;
  if (!IND[ind].cursos) return estado.nivel;
  return estado.nivel === "Primaria" ? estado.grado : "2s";
};
const cursosDe = (s) => CURSOS.filter((c) => aniosDe("aprendizajes", s, c, NACIONAL).length);
const gruposDe = (ind, s, curso = "") => GRUPOS.filter((g) => PARES[g].cats.every(([c]) => aniosDe(ind, s, curso, `${g}:${c}`).length));
const nivelMin = () => estado.nivel.toLowerCase();
// Nombre del nivel de un indicador: el elegido, o «educación básica» en los de nivel único
const nivelDe = (ind) => (IND[ind].fijo ? IND[ind].niveles[0] : estado.nivel);
const nombreRegion = (c) => NOMBRE_REGION.get(c) ?? c;
const enLugar = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnLugar = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombreRegion(c)}`);
const fmt = (ind, v) => IND[ind].formato(v);
const cifra = (ind, v) => (IND[ind].numero ? `<strong>${fmt(ind, v)}</strong>` : `el <strong>${pct(v)}</strong>`);
// Frase completa con la cifra: «el 94,1 % de los niños…», «había 15,2 alumnos por docente…», «el gasto… fue de S/ 5 417»
const oracion = (ind, v, conNegrita = true) => {
  const info = IND[ind], n = nivelDe(ind).toLowerCase(), f = conNegrita ? destacar(fmt(ind, v)) : fmt(ind, v);
  if (info.texto) return info.texto(f, n);
  return info.numero ? `había ${f} ${info.frase(n)}` : `el ${f} ${info.frase(n)}`;
};
// «frente al 80,0 %», «frente a 15,2», «frente a S/ 4 000»
const frente = (ind, v) => `frente ${IND[ind].numero ? "a" : "al"} ${fmt(ind, v)}`;
const sinNivel = (ind) => `${IND[ind].corto} no tiene datos de ${nivelMin()}.`;
// Lugar de comparación: el elegido en «Comparar con», si no es el mismo que el principal
const lugarComp = () => (estado.comparar && estado.comparar !== estado.region ? estado.comparar : null);
// Diferencia legible: puntos porcentuales o alumnos
const dif = (ind, d) => (IND[ind].difTxt ? IND[ind].difTxt(d) : IND[ind].numero ? `${num1(Math.abs(d))} ${Math.abs(d) === 1 ? "alumno" : "alumnos"}` : `${Obs.fmtN(Math.abs(d) * 100, 1)} ${Math.abs(d * 100) === 1 ? "punto" : "puntos"}`);
// Puesto de una región entre las 26 (1 = valor más alto)
function puesto(ind, s, curso, region, a) {
  const v = val(ind, s, curso, region, a);
  if (v == null) return null;
  const lista = REGIONES.map((r) => val(ind, s, curso, r.region, a)).filter((x) => x != null);
  return { n: lista.filter((x) => x > v).length + 1, de: lista.length };
}

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const $ = (s, raiz = document) => raiz.querySelector(s);
const destacar = (s) => `<strong>${s}</strong>`;

// Botones de una sola opción. Las opciones sin datos (desactivado) no se dibujan: no se muestran apagadas.
const botones = (opciones, elegida) => opciones.filter((o) => !o.desactivado).map((o) =>
  `<button type="button" data-valor="${Obs.escapar(o.valor)}" aria-pressed="${o.valor === elegida}">${Obs.escapar(o.etiqueta)}</button>`).join("");

// Línea pequeña (SVG) para las cifras clave
function chispa(valores, color) {
  const pts = valores.filter((p) => p[1] != null);
  if (pts.length < 2) return "";
  const W = 120, H = 36, a0 = pts[0][0], a1 = pts.at(-1)[0];
  const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), r = hi - lo || 1;
  const x = (a) => 3 + ((a - a0) / (a1 - a0 || 1)) * (W - 6), y = (v) => H - 4 - ((v - lo) / r) * (H - 8);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const [ua, uv] = pts.at(-1);
  return `<svg class="chispa" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="${x(ua).toFixed(1)}" cy="${y(uv).toFixed(1)}" r="3" fill="${color}"/></svg>`;
}

/* Tabla ordenable por cualquier columna, con buscador opcional (filtra filas por texto).
   columnas: [{ clave, titulo, num, valor(f), html(f) }]; filas: objetos */
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

// Líneas por año. series: [{ nombre, color, valores (uno por año de `anios`), punteada, gris }]
function lineas(id, ind, anios, series, aria) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  if (!todos.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const ancho = el.clientWidth;
  // Tope del eje en un múltiplo del intervalo, para que la última marca no quede pegada a la anterior
  const maximo = Math.max(...todos) * 1.05;
  // números: un paso «redondo» (1, 2 o 5 por una potencia de 10) para unas cinco marcas
  const redondo = (x) => { const p = 10 ** Math.floor(Math.log10(x)), r = x / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p; };
  const paso = IND[ind].numero ? redondo(maximo / 5) : maximo > 0.5 ? 0.2 : maximo > 0.2 ? 0.1 : 0.05;
  const tope = IND[ind].numero ? Math.ceil(maximo / paso) * paso : Math.min(1, Math.ceil(maximo / paso - 1e-9) * paso);
  const cada = ancho < 420 ? 5 : ancho < 760 ? 3 : 2;
  const hueco = IND[ind].hueco;
  // Valor al final de cada línea (solo con pocas líneas y espacio)
  const rotular = series.length <= 4 && ancho >= 520;
  const ultimoIdx = (vals) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i; return -1; };
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => {
        const a = +ps[0].axisValue;
        if (hueco && a >= hueco[0] && a <= hueco[1]) return `<strong>${a}</strong><br>No aplica: promoción guiada`;
        const filas = ps.filter((p) => p.value != null).sort((x, y) => y.value - x.value);
        return `<strong>${a}</strong>` + (filas.length ? filas.map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${fmt(ind, p.value)}</strong>`).join("") : "<br>Sin dato");
      } },
    grid: { left: IND[ind].numero ? (maximo >= 1000 ? 52 : 40) : 52, right: rotular ? (IND[ind].difTxt ? 80 : 64) : 18, top: 16, bottom: 30 },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % cada === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, interval: paso, splitLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ formatter: (v) => (IND[ind].numero ? Obs.fmtN(v) : `${Math.round(v * 100)} %`) }) },
    series: series.map((s, i) => {
      const u = ultimoIdx(s.valores);
      return {
        name: s.nombre, type: "line", connectNulls: true, symbol: "circle", symbolSize: s.punteada ? 6 : 8, z: s.gris ? 1 : s.punteada ? 2 : 3,
        data: s.valores.map((v, j) => (j === u && rotular ? { value: v, label: { show: true, position: "right", distance: 8, formatter: () => fmt(ind, v), ...txt({ color: C.texto, fontWeight: 700 }) } } : v)),
        lineStyle: { width: s.punteada ? 2 : 2.5, color: s.color, type: s.punteada ? [6, 4] : "solid" },
        itemStyle: { color: s.punteada ? "#fff" : s.color, borderColor: s.color, borderWidth: s.punteada ? 2 : 1.5 },
        emphasis: { focus: "series" },
        markArea: i === 0 && hueco ? { silent: true, itemStyle: { color: C.hueco },
          label: { show: ancho >= 420, position: "insideTop", distance: 6, ...txt(), formatter: "Promoción guiada" },
          data: [[{ xAxis: String(hueco[0]) }, { xAxis: String(hueco[1]) }]] } : undefined,
      };
    }),
  }, true);
  el.setAttribute("aria-label", aria);
}

function leyenda(id, entradas, { hueco = false, comparacion = null, referencia = null } = {}) {
  const partes = entradas.map(([nombre, color]) => `<span><i class="l" style="border-color:${color}"></i>${Obs.escapar(nombre)}</span>`);
  if (comparacion) partes.push(`<span><i class="l punteada" style="border-color:${C.textoSuave}"></i>${Obs.escapar(comparacion)} (línea punteada)</span>`);
  if (referencia) partes.push(`<span><i class="l punteada" style="border-color:${C.otros}"></i>${Obs.escapar(referencia)}</span>`);
  if (hueco) partes.push(`<span><i class="hueco"></i>Promoción guiada (no aplica)</span>`);
  document.getElementById(id).innerHTML = partes.join("");
}

/* ---------------------------------------------------------
   Tarjeta de evolución (una por indicador)
   --------------------------------------------------------- */
function htmlEvol({ ind, titulo, desc }) {
  const info = IND[ind];
  return `<article class="tarjeta" id="c-${ind}">
    <header><h3>${titulo}</h3><p>${desc}</p></header>
    <div class="controles">
      ${info.cursos ? `<div class="filtro-local" data-grado-caja role="group" aria-labelledby="lbl-grado"><span id="lbl-grado">Grado evaluado</span><div class="segmentado claro" data-grado></div></div>` : ""}
      <div class="filtro-local" role="group" aria-labelledby="lbl-vp-${ind}"><span id="lbl-vp-${ind}">Ver por</span><div class="segmentado claro" data-verpor="${ind}"></div></div>
    </div>
    <p class="lectura" id="l-${ind}" aria-live="polite"></p>
    <div class="ley" id="ley-${ind}"></div>
    <div class="grafico" id="g-${ind}"></div>
    <p class="nota-tarjeta" id="n-${ind}"></p>
  </article>`;
}

function pintarEvol(ind) {
  const info = IND[ind], lugar = estado.region, comp = lugarComp();
  const s = serieDe(ind);
  const card = document.getElementById(`c-${ind}`);
  const lectura = document.getElementById(`l-${ind}`), nota = document.getElementById(`n-${ind}`);
  nota.textContent = "";
  if (info.cursos) {
    $("[data-grado-caja]", card).hidden = estado.nivel !== "Primaria";
    $("[data-grado]", card).innerHTML = botones([
      { valor: "4p", etiqueta: "4.º grado (2016-2025)" }, { valor: "2p", etiqueta: "2.º grado (2007-2023)" }], estado.grado);
  }
  // Sin datos para el nivel elegido (o sin la pestaña en datos.json), la tarjeta no se muestra
  card.hidden = !s;
  if (!s) return;
  // «Ver por»: total o un desglose (solo para el Perú)
  const cursosS = info.cursos ? cursosDe(s) : [""];
  const grupos = GRUPOS.filter((g) => cursosS.some((c) => gruposDe(ind, s, c).includes(g)));
  let vp = estado.verPor[ind] ?? "Total";
  if (vp !== "Total" && !grupos.includes(vp)) vp = "Total";
  $(`[data-verpor="${ind}"]`, card).innerHTML = botones([{ valor: "Total", etiqueta: "Total" },
    ...GRUPOS.map((g) => ({ valor: g, etiqueta: PARES[g].boton, desactivado: !grupos.includes(g) }))], vp);

  // Líneas
  let lineasDef, conComp = null, referencia = null;
  let leyendaVp = null;
  if (vp !== "Total" && info.cursos) {
    // Logros por curso: cada curso con su color; el primer grupo continuo y el segundo punteado
    const [k1, k2] = PARES[vp].cats;
    lineasDef = cursosS.filter((c) => gruposDe(ind, s, c).includes(vp)).flatMap((c) => [
      { curso: c, lugar: `${vp}:${k1[0]}`, nombre: `${c}, ${k1[2].toLowerCase()}`, color: C.cursos[c] },
      { curso: c, lugar: `${vp}:${k2[0]}`, nombre: `${c}, ${k2[2].toLowerCase()}`, color: C.cursos[c], punteada: true }]);
    leyendaVp = [k1[1], k2[1]];
  } else if (vp !== "Total") {
    lineasDef = PARES[vp].cats.map(([c, nombre], i) => ({ curso: "", lugar: `${vp}:${c}`, nombre, color: C.pares[i] }));
    lineasDef.push({ curso: "", lugar: NACIONAL, nombre: "Perú, total", color: C.otros, punteada: true, gris: true });
    referencia = "Perú, total";
  } else {
    const base = info.cursos ? cursosDe(s).map((c) => ({ curso: c, nombre: c, color: C.cursos[c] })) : [{ curso: "", nombre: nivelDe(ind), color: info.fijo ? C.unica : C.niveles[estado.nivel] }];
    lineasDef = [];
    for (const x of base) {
      lineasDef.push({ ...x, lugar, nombre: comp ? `${x.nombre} (${nombreRegion(lugar)})` : x.nombre, corto: x.nombre });
      if (comp) lineasDef.push({ ...x, lugar: comp, nombre: `${x.nombre} (${nombreRegion(comp)})`, punteada: true });
    }
    if (comp) conComp = nombreRegion(comp);
  }
  const todos = lineasDef.flatMap((x) => aniosDe(ind, s, x.curso, x.lugar));
  if (!todos.length) {
    lectura.textContent = `${EnLugar(lugar)} no hay datos para esta selección.`;
    leyenda(`ley-${ind}`, []);
    return Obs.vacio(`g-${ind}`);
  }
  const a0 = Math.min(...todos), a1 = Math.max(...todos);
  const anios = Array.from({ length: a1 - a0 + 1 }, (_, i) => a0 + i);
  const series = lineasDef.map((x) => ({ ...x, valores: anios.map((a) => val(ind, s, x.curso, x.lugar, a)) }));
  if (leyendaVp) {
    document.getElementById(`ley-${ind}`).innerHTML = [...new Set(series.map((x) => x.curso))].map((c) => `<span><i class="l" style="border-color:${C.cursos[c]}"></i>${Obs.escapar(c)}</span>`).join("") +
      `<span><i class="l" style="border-color:${C.textoSuave}"></i>${leyendaVp[0]} (línea continua)</span><span><i class="l punteada" style="border-color:${C.textoSuave}"></i>${leyendaVp[1]} (línea punteada)</span>`;
  } else leyenda(`ley-${ind}`, series.filter((x) => !x.punteada).map((x) => [x.nombre, x.color]), { hueco: !!info.hueco, comparacion: conComp, referencia });
  lineas(`g-${ind}`, ind, anios, series, `${info.corto}, ${info.cursos ? GRADO[s].nombre : nivelDe(ind).toLowerCase()}, ${vp !== "Total" ? `por ${PARES[vp].nombre.toLowerCase()}, Perú` : enLugar(lugar)}, ${a0}-${a1}`);


  // Lectura
  if (vp !== "Total") {
    const [c1, c2] = PARES[vp].cats;
    const cu = series[0].curso; // en logros, el primer curso con ese desglose
    const a = Math.min(ultimo(ind, s, cu, `${vp}:${c1[0]}`), ultimo(ind, s, cu, `${vp}:${c2[0]}`));
    const v1 = val(ind, s, cu, `${vp}:${c1[0]}`, a), v2 = val(ind, s, cu, `${vp}:${c2[0]}`, a);
    const p1 = aniosDe(ind, s, cu, `${vp}:${c1[0]}`)[0];
    const d0 = val(ind, s, cu, `${vp}:${c1[0]}`, p1) - val(ind, s, cu, `${vp}:${c2[0]}`, p1);
    lectura.innerHTML = `En el Perú, en ${a}${cu ? `, en ${cu}` : ""}: ${c1[1].toLowerCase()}, ${destacar(fmt(ind, v1))}; ${c2[1].toLowerCase()}, ${destacar(fmt(ind, v2))}. ` +
      `La diferencia es de ${destacar(dif(ind, v1 - v2))}` + (p1 !== a && !Number.isNaN(d0) ? `, frente a ${dif(ind, d0)} en ${p1}.` : ".");
    nota.textContent = `Los desgloses son del Perú: ESCALE no los publica por región.${ind === "titulados" && vp === "Sexo" ? " En docentes titulados, el sexo es el de los docentes." : ""}${NOTA[ind] ? ` ${NOTA[ind]}` : ""}`;
    return;
  }
  if (info.cursos) {
    const base = cursosDe(s);
    const conDato = base.filter((c) => aniosDe(ind, s, c, lugar).length);
    if (!conDato.length) { lectura.textContent = `${EnLugar(lugar)} no hay resultados regionales de ${GRADO[s].nombre}.`; return; }
    const a = Math.max(...conDato.map((c) => ultimo(ind, s, c, lugar)));
    const [p, q] = conDato.filter((c) => val(ind, s, c, lugar, a) != null).slice(0, 2).map((c) => ({ c, v: val(ind, s, c, lugar, a), k: comp ? val(ind, s, c, comp, a) : null }));
    let t = `${EnLugar(lugar)}, en ${a}, el ${destacar(pct(p.v))} de los alumnos de ${GRADO[s].nombre} logró los aprendizajes esperados en ${p.c}`;
    if (q) t += ` y el ${destacar(pct(q.v))} en ${q.c}`;
    if (comp && p.k != null) t += `; ${enLugar(comp)}, ${pct(p.k)}${q?.k != null ? ` y ${pct(q.k)}` : ""}`;
    lectura.innerHTML = `${t}.`;
    const notas = [];
    if (s === "2p") notas.push("Desde 2024 ya no se evalúa el 2.º grado de primaria. 2.º y 4.º grado son pruebas distintas: no se comparan entre sí.");
    if (s === "4p") notas.push("4.º y 2.º grado son pruebas distintas: no se comparan entre sí.");
    if (lugar !== NACIONAL && conDato.length < base.length) notas.push(`Algunos cursos no tienen resultados para ${nombreRegion(lugar)}.`);
    nota.textContent = notas.join(" ");
    return;
  }
  nota.textContent = NOTA[ind] ?? "";
  const a = ultimo(ind, s, "", lugar);
  if (!a) { lectura.textContent = `${EnLugar(lugar)} no hay datos de ${nivelDe(ind).toLowerCase()}.`; return; }
  const v = val(ind, s, "", lugar, a);
  let t = `${EnLugar(lugar)}${info.numero && !info.texto ? "" : ","} ${oracion(ind, v)} en ${a}`;
  const k = comp ? val(ind, s, "", comp, a) : null;
  if (k != null) t += `; ${enLugar(comp)}, ${fmt(ind, k)}`;
  else {
    const a0d = aniosDe(ind, s, "", lugar)[0];
    if (a0d !== a) t += `, ${frente(ind, val(ind, s, "", lugar, a0d))} en ${a0d}`;
  }
  lectura.innerHTML = `${t}.`;
}

/* ---------------------------------------------------------
   Mapa por región (uno por pestaña)
   --------------------------------------------------------- */
function htmlMapa(m) {
  return `<article class="tarjeta" id="c-mapa-${m}">
    <header><h3>¿Cómo está cada región?</h3>
      <p>Valor de cada región en el año elegido, para el nivel elegido arriba. Lima Metropolitana y el Callao se muestran ampliados en el recuadro. Haz clic en una región del mapa o de la tabla para elegirla en todo el tablero.</p></header>
    <div class="controles">
      ${MOD[m].indicadores.length > 1 ? `<div class="filtro-local" role="group" aria-labelledby="lbl-mi-${m}"><span id="lbl-mi-${m}">Indicador</span><div class="segmentado claro" data-mapa-ind></div></div>` : ""}
      <div class="filtro-local" data-mapa-curso-caja role="group" aria-labelledby="lbl-mc-${m}"><span id="lbl-mc-${m}">Curso</span><div class="segmentado claro" data-mapa-curso></div></div>
      <div class="filtro-local"><label for="f-anio-${m}">Año</label><select id="f-anio-${m}" data-mapa-anio></select></div>
    </div>
    <p class="lectura" id="l-mapa-${m}" aria-live="polite"></p>
    <div class="mapa-y-tabla" id="mt-${m}">
      <div><div id="mapa-${m}"></div><div class="leyenda-mapa" id="ley-mapa-${m}"></div></div>
      <div id="t-mapa-${m}"></div>
    </div>
  </article>`;
}

function pintarMapa(m) {
  const conf = estado.mapa[m];
  const card = document.getElementById(`c-mapa-${m}`);
  // Indicadores con datos para el nivel elegido; si el del mapa no tiene, se pasa al primero que sí
  const conDatos = MOD[m].indicadores.filter((i) => serieDe(i));
  if (conDatos.length && !conDatos.includes(conf.ind)) Object.assign(conf, { ind: conDatos[0], curso: IND[conDatos[0]].cursos ? "Lectura" : "", anio: null });
  const ind = conf.ind, info = IND[ind];
  const s = serieDe(ind);
  if ($("[data-mapa-ind]", card)) $("[data-mapa-ind]", card).innerHTML = botones(MOD[m].indicadores.map((i) => ({ valor: i, etiqueta: IND[i].corto, desactivado: !conDatos.includes(i) })), ind);
  $("[data-mapa-curso-caja]", card).hidden = !info.cursos;
  const lectura = document.getElementById(`l-mapa-${m}`), cuerpo = document.getElementById(`mt-${m}`);
  if (!s) {
    lectura.textContent = sinNivel(ind); cuerpo.hidden = true;
    $("[data-mapa-anio]", card).innerHTML = "";
    return;
  }
  let curso = "";
  if (info.cursos) {
    const disponibles = cursosDe(s).filter((c) => aniosRegionales(ind, s, c).length);
    if (!disponibles.includes(conf.curso)) conf.curso = disponibles[0] ?? "Lectura";
    curso = conf.curso;
    $("[data-mapa-curso]", card).innerHTML = botones(CURSOS.map((c) => ({ valor: c, etiqueta: c, desactivado: !disponibles.includes(c) })), curso);
  }
  const anios = aniosRegionales(ind, s, curso);
  const anio = anios.includes(conf.anio) ? conf.anio : anios.at(-1);
  $("[data-mapa-anio]", card).innerHTML = [...anios].reverse().map((a) => `<option value="${a}"${a === anio ? " selected" : ""}>${a}</option>`).join("");

  const filas = REGIONES.map((r) => ({ region: r.region, v: val(ind, s, curso, r.region, anio) })).filter((f) => f.v != null).sort((a, b) => b.v - a.v);
  cuerpo.hidden = !filas.length;
  if (!filas.length) { lectura.textContent = "No hay datos regionales para esta selección."; return; }
  const escala = info.numero ? 1 : 100; // los cortes van en puntos porcentuales
  const valores = new Map(filas.map((f) => [f.region, f.v * escala]));
  if (!mapas[m]) mapas[m] = new Obs.Mapa(`mapa-${m}`, GEO, { alClic: elegirRegion, nombre: nombreRegion });
  const cortes = Obs.cortesCuantiles([...valores.values()]);
  mapas[m].pintar({ valores, color: (v) => Obs.colorTramo(v, cortes, C.escala), texto: (v) => fmt(ind, v / escala), elegida: estado.region });
  Obs.leyendaTramos(`ley-mapa-${m}`, cortes, C.escala, (v) => (info.difTxt ? soles(v) : info.numero ? Obs.fmtN(v, 0) : `${Obs.fmtN(v, 0)} %`));

  const peru = val(ind, s, curso, NACIONAL, anio);
  const alto = filas[0], bajo = filas.at(-1);
  const que = info.cursos ? `logros de aprendizaje en ${curso}, ${GRADO[s].nombre}` : `${info.corto.toLowerCase()}, ${nivelDe(ind).toLowerCase()}`;
  let t = `En ${anio} (${que}), ${destacar(nombreRegion(alto.region))} tiene el valor más alto (${fmt(ind, alto.v)}) y ` +
    `${destacar(nombreRegion(bajo.region))} el más bajo (${fmt(ind, bajo.v)})` + (peru != null ? `; el Perú, ${fmt(ind, peru)}` : "");
  if (estado.region !== NACIONAL) {
    const p = puesto(ind, s, curso, estado.region, anio);
    if (p) t += `. ${nombreRegion(estado.region)} está en el puesto ${destacar(`${p.n} de ${p.de}`)}`;
  }
  lectura.innerHTML = `${t}.`;

  // Ranking: barra en cada fila y el Perú en su puesto
  const max = Math.max(...filas.map((f) => f.v), peru ?? 0);
  const lista = filas.map((f, i) => ({ region: f.region, nombre: nombreRegion(f.region), v: f.v, pos: i + 1 }));
  if (peru != null) lista.push({ region: NACIONAL, nombre: "Perú", v: peru, pos: null });
  tablaOrdenable(`t-mapa-${m}`, [
    { clave: "pos", titulo: "#", num: true, valor: (f) => (f.pos ?? filas.filter((x) => x.v > f.v).length + 0.5), html: (f) => (f.pos ? String(f.pos) : "") },
    { clave: "nombre", titulo: "Región", valor: (f) => f.nombre, html: (f) => Obs.escapar(f.nombre) },
    { clave: "v", titulo: info.columna ?? (info.numero ? "Alumnos por docente" : "Porcentaje"), num: true, valor: (f) => f.v,
      html: (f) => `<span class="celda-barra"><i style="width:${Math.max(3, (f.v / max) * 100)}%"></i><b>${fmt(ind, f.v)}</b></span>` },
  ], lista, { inicial: { clave: "v", dir: -1 }, claveFila: (f) => f.region, elegida: estado.region, alClic: elegirRegion, buscar: "Nombre de la región",
    claseFila: (f) => (f.region === NACIONAL ? "peru" : ""), descripcion: `${info.corto} por región, ${anio}` });
}

/* ---------------------------------------------------------
   Cifras clave y resumen
   --------------------------------------------------------- */
function cifraClave(ind, curso = "", lugarFijo = null) {
  const s = serieDe(ind);
  const lugar = lugarFijo ?? estado.region;
  if (!s) return null;
  const anios = aniosDe(ind, s, curso, lugar);
  const a = anios.at(-1) ?? null;
  return { ind, s, curso, lugar, a, v: a ? val(ind, s, curso, lugar, a) : null, previo: anios.at(-2) ?? null, anios };
}

function pintarCifras(m) {
  const comp = lugarComp();
  const caja = document.getElementById(`k-${m}`);
  // las primeras cuatro cifras con datos para el nivel elegido
  const kpis = MOD[m].kpis.filter(([ind, , lugarFijo]) => { const s = serieDe(ind); return s && aniosDe(ind, s, "", lugarFijo ?? NACIONAL).length + (IND[ind].cursos ? 1 : 0); }).slice(0, 4);
  caja.className = `kpis kpis-${kpis.length}`;
  caja.innerHTML = kpis.map(([ind, curso = "", lugarFijo = null]) => {
    const info = IND[ind], x = cifraClave(ind, curso, lugarFijo);
    const zona = lugarFijo ? ` en zona ${lugarFijo.split(":")[1].toLowerCase()}, Perú` : "";
    const etiqueta = info.cursos ? `Logran los aprendizajes en ${curso}${x?.s ? ` (${GRADO[x.s].nombre})` : ""}` : `${info.corto} (${nivelDe(ind).toLowerCase()})${zona}`;
    if (!x || !x.a) return `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">—</span><span class="kpi-pie">${x ? "Sin datos" : `Sin datos de ${nivelMin()}`}</span></div>`;
    // Cambio frente a la medición anterior, con su sentido (mejora o empeora según el indicador)
    let cambio = "";
    if (x.previo) {
      const d = x.v - val(ind, x.s, curso, x.lugar, x.previo);
      const quieto = Math.abs(d) < (info.numero ? 0.05 : 0.0005);
      const mejora = info.mejor === "alto" ? d > 0 : d < 0;
      const clase = quieto ? "igual" : mejora ? "mejora" : "empeora";
      const flecha = quieto ? "=" : d > 0 ? "▲" : "▼";
      const palabra = quieto ? "sin cambio" : mejora ? "mejora" : "empeora";
      cambio = `<span class="kpi-cambio ${clase}"><span aria-hidden="true">${flecha}</span> ${quieto ? "Igual" : dif(ind, d)} frente a ${x.previo}<span class="solo-lectores"> (${palabra})</span></span>`;
    }
    const k = comp && !lugarFijo ? val(ind, x.s, curso, comp, x.a) : null;
    const color = info.cursos ? C.cursos[curso] : info.fijo ? C.unica : C.niveles[estado.nivel];
    return `<div class="kpi">
      <span class="kpi-etiqueta">${etiqueta}</span>
      <div class="kpi-cuerpo"><span class="kpi-valor">${fmt(ind, x.v)}</span>${chispa(x.anios.map((a) => [a, val(ind, x.s, curso, x.lugar, a)]), color)}</div>
      ${cambio}
      <span class="kpi-pie">${x.a}${x.lugar !== NACIONAL && !lugarFijo ? `, ${nombreRegion(x.lugar)}` : ""}${k != null ? `. ${nombreRegion(comp)}: ${fmt(ind, k)}` : ""}</span>
    </div>`;
  }).join("");
}

/* Resumen dinámico de la pestaña: la cifra principal, la tendencia, la mayor diferencia y, con una región, su puesto */
function pintarResumen(m) {
  const lugar = estado.region, comp = lugarComp(), el = document.getElementById(`r-${m}`), R = MOD[m].resumen;
  const frases = [];
  // Cifra principal: la de la pestaña o, si no tiene datos para el nivel, la del primer indicador que sí
  const [ip, cp = ""] = serieDe(R.principal[0]) ? R.principal : [MOD[m].indicadores.find((i) => serieDe(i) && !IND[i].cursos) ?? R.principal[0]];
  const sp = serieDe(ip);
  if (sp) {
    const a = ultimo(ip, sp, cp, lugar);
    if (a) {
      const v = val(ip, sp, cp, lugar, a);
      let t = IND[ip].cursos ? `${EnLugar(lugar)}, en ${a}, el ${destacar(pct(v))} de los alumnos de ${GRADO[sp].nombre} logró los aprendizajes esperados en ${cp}`
        : `${EnLugar(lugar)}, en ${a}, ${oracion(ip, v)}`;
      const k = comp ? val(ip, sp, cp, comp, a) : null;
      if (k != null) t += `, frente a ${fmt(ip, k)} ${enLugar(comp)}`;
      frases.push(`${t}.`);
      if (lugar !== NACIONAL) {
        const p = puesto(ip, sp, cp, lugar, a);
        if (p) frases.push(`Está en el puesto ${destacar(`${p.n} de ${p.de}`)} entre las regiones.`);
      }
    }
  }
  const it = R.tendencia, st = serieDe(it);
  if (st && !IND[it].cursos) {
    const anios = aniosDe(it, st, "", lugar);
    if (anios.length > 1) {
      const a0 = anios[0], a1 = anios.at(-1), v0 = val(it, st, "", lugar, a0), v1 = val(it, st, "", lugar, a1);
      const verbo = Math.abs(v1 - v0) < 0.0005 ? "se mantuvo en" : v1 > v0 ? "subió de" : "bajó de";
      frases.push(`${IND[it].corto} ${verbo === "se mantuvo en" ? `se mantuvo en ${fmt(it, v1)}` : `${verbo} ${fmt(it, v0)} en ${a0} a ${destacar(fmt(it, v1))} en ${a1}`}.`);
    }
  }
  const [ib, cb = ""] = R.brecha, sb = serieDe(ib);
  if (sb) {
    const a = Math.min(ultimo(ib, sb, cb, "Área:Urbana") ?? 0, ultimo(ib, sb, cb, "Área:Rural") ?? 0);
    const u = val(ib, sb, cb, "Área:Urbana", a), r = val(ib, sb, cb, "Área:Rural", a);
    if (u != null && r != null) {
      const que = IND[ib].cursos ? `logró los aprendizajes en ${cb}` : IND[ib].frase(nivelDe(ib).toLowerCase()).replace(/^de (los|las) \S+ de \S+ /, "");
      frases.push(`En zona rural, ${IND[ib].numero ? "" : "el "}${destacar(fmt(ib, r))} ${que}, frente ${IND[ib].numero ? "a" : "al"} ${fmt(ib, u)} en la urbana (Perú, ${a}).`);
    }
  }
  el.innerHTML = frases.length ? frases.join(" ") : `${EnLugar(lugar)} no hay datos de ${nivelMin()} en esta pestaña.`;
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  const antes = estado.ambito;
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  // Al elegir una región, se compara con el Perú si no había otra comparación
  if (antes === "nacional" && estado.ambito === "regional" && !("comparar" in parche) && !estado.comparar) estado.comparar = NACIONAL;
  if (estado.ambito === "nacional" && estado.comparar === NACIONAL) estado.comparar = "";
  // Si la pestaña no tiene el nivel elegido (inicial en Estudiantes o Escuelas), se pasa a primaria
  if (!NIVELES_MOD(estado.modulo).includes(estado.nivel)) estado.nivel = "Primaria";
  render();
}
function elegirRegion(cod) {
  if (cod === NACIONAL || cod === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: cod });
}

function sincronizarControles() {
  controles.sincronizar(estado);
  const disponibles = NIVELES_MOD(estado.modulo);
  document.querySelectorAll("#f-nivel button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.nivel === estado.nivel);
    // el nivel sin datos en la pestaña (inicial, fuera de Docentes) no se muestra
    b.hidden = !disponibles.includes(b.dataset.nivel);
  });
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  // Qué se está viendo, en una línea
  const partes = [estado.nivel, estado.region === NACIONAL ? "Perú" : nombreRegion(estado.region)];
  const comp = lugarComp();
  document.getElementById("viendo").innerHTML = `Mostrando: ${destacar(partes.join(", "))}${comp ? ` frente a ${destacar(nombreRegion(comp))}` : ""}`;
}

function actualizarURL() {
  const m = estado.modulo, mp = estado.mapa[m], dm = DEFECTO.mapa[m];
  const vp = Object.entries(estado.verPor).filter(([, g]) => g !== "Total").map(([i, g]) => `${i}:${g}`).join("-");
  Obs.escribirURL({
    modulo: m === "estudiantes" ? null : m,
    region: estado.region === NACIONAL ? null : estado.region,
    comparar: (estado.region === NACIONAL ? estado.comparar : estado.comparar === NACIONAL ? null : estado.comparar || "ninguna") || null,
    nivel: estado.nivel === "Primaria" ? null : estado.nivel,
    grado: estado.grado === "4p" ? null : estado.grado,
    verpor: vp || null,
    mapa: mp.ind === dm.ind && mp.curso === dm.curso && mp.anio == null ? null : [mp.ind, mp.curso, mp.anio ?? ""].join("-").replace(/-+$/, ""),
  });
}

function render() {
  sincronizarControles();
  const m = estado.modulo;
  pintarResumen(m);
  pintarCifras(m);
  for (const t of MOD[m].evol) (t.par ?? [t]).forEach((x) => pintarEvol(x.ind));
  pintarMapa(m);
  actualizarURL();
}

/* Las tarjetas de cada pestaña se arman una vez; sus botones solo cambian `estado` */
function tarjetas() {
  for (const m of MODULOS) {
    const caja = document.getElementById(`c-${m}`);
    caja.innerHTML = MOD[m].evol.map((t) => (t.par ? `<div class="par">${t.par.map(htmlEvol).join("")}</div>` : htmlEvol(t))).join("") + htmlMapa(m);
    caja.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-valor]");
      if (!b) return;
      const grupo = b.parentElement, v = b.dataset.valor;
      if (grupo.hasAttribute("data-grado")) estado.grado = v;
      else if (grupo.dataset.verpor) estado.verPor[grupo.dataset.verpor] = v;
      else if (grupo.hasAttribute("data-mapa-ind")) estado.mapa[m] = { ind: v, curso: IND[v].cursos ? "Lectura" : "", anio: null };
      else if (grupo.hasAttribute("data-mapa-curso")) estado.mapa[m] = { ...estado.mapa[m], curso: v };
      else return;
      render();
    });
    caja.addEventListener("change", (e) => {
      if (e.target.matches("[data-mapa-anio]")) { estado.mapa[m] = { ...estado.mapa[m], anio: +e.target.value }; render(); }
    });
  }
}

/* ---------------------------------------------------------
   Inicio
   --------------------------------------------------------- */
Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  GEO = geo;
  const css = getComputedStyle(document.documentElement);
  const token = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(), hueco: token("--hueco"), pares: [token("--par-1"), token("--par-2")],
    cursos: Object.fromEntries(Object.entries(COLOR_CURSO).map(([k, v]) => [k, token(v)])),
    niveles: Object.fromEntries(Object.entries(COLOR_NIVEL).map(([k, v]) => [k, token(v)])) };

  const OCULTO = new Set(OCULTOS.map((o) => clave(...o)));
  const listas = new Map();
  for (const ind of Object.keys(IND)) {
    const tabla = datos.tablas[ind];
    if (!tabla) continue;
    for (const f of Obs.expandir(tabla)) {
      if (f.valor == null || f.anio == null) continue;
      const s = ind === "aprendizajes" ? GRADO_A_SERIE[f.grado] : f.nivel;
      if (!s) continue;
      const curso = ind === "aprendizajes" ? f.curso ?? "" : "";
      let lugar;
      if (f.grupo === "Perú") lugar = NACIONAL;
      else if (f.grupo === "Región") { lugar = f.codigo; NOMBRE_REGION.set(f.codigo, f.categoria); }
      else lugar = `${f.grupo}:${f.categoria}`;
      const a = +f.anio;
      if (OCULTO.has(clave(ind, s, curso, lugar, a))) continue;
      V.set(clave(ind, s, curso, lugar, a), +f.valor);
      HAY.add(ind);
      const k = clave(ind, s, curso, lugar);
      if (!listas.has(k)) listas.set(k, new Set());
      listas.get(k).add(a);
    }
  }
  for (const [k, set] of listas) ANIOS.set(k, [...set].sort((a, b) => a - b));
  REGIONES = [...NOMBRE_REGION].filter(([c]) => c !== NACIONAL).map(([region, nombre]) => ({ region, nombre }));

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  document.getElementById("actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  // Estado inicial desde la URL
  const q = Obs.parametros();
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  const reg = (q.get("region") || "").toUpperCase();
  if (NOMBRE_REGION.has(reg) && reg !== NACIONAL) Object.assign(estado, { ambito: "regional", region: reg, comparar: NACIONAL });
  const cmpq = (q.get("comparar") || "").toUpperCase();
  if (cmpq === "NINGUNA") estado.comparar = "";
  else if (NOMBRE_REGION.has(cmpq)) estado.comparar = cmpq;
  if (NIVELES.includes(q.get("nivel"))) estado.nivel = q.get("nivel");
  if (["4p", "2p"].includes(q.get("grado"))) estado.grado = q.get("grado");
  for (const par of (q.get("verpor") || "").split("-")) {
    const [i, g] = par.split(":");
    if (IND[i] && GRUPOS.includes(g)) estado.verPor[i] = g;
  }
  const [mi, mc, ma] = (q.get("mapa") || "").split("-");
  if (MOD[estado.modulo].indicadores.includes(mi)) estado.mapa[estado.modulo] = { ind: mi, curso: CURSOS.includes(mc) ? mc : IND[mi].cursos ? "Lectura" : "", anio: +(IND[mi].cursos ? ma : mc) || null };
  if (!NIVELES_MOD(estado.modulo).includes(estado.nivel)) estado.nivel = "Primaria";

  // Filtros comunes: región y comparación (Obs.controlesComunes) y nivel educativo
  const filtros = document.getElementById("filtros");
  controles = Obs.controlesComunes(filtros, { regiones: REGIONES, anios: [2000, 2025], alCambiar: actualizar, comparar: true, periodo: false });
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <span class="etiqueta" id="lbl-nivel">Nivel educativo</span>
      <div class="segmentado" id="f-nivel" role="group" aria-labelledby="lbl-nivel">
        ${NIVELES.map((n) => `<button type="button" data-nivel="${n}">${n}</button>`).join("")}
      </div>
    </div>
    <p class="viendo" id="viendo" aria-live="polite"></p>`);
  document.getElementById("f-nivel").onclick = (e) => {
    const b = e.target.closest("button[data-nivel]");
    if (b && !b.hidden) actualizar({ nivel: b.dataset.nivel });
  };
  // Pista de uso al inicio de cada pestaña
  MODULOS.forEach((m) => document.getElementById(`r-${m}`).insertAdjacentHTML("beforebegin",
    `<p class="pista-arriba">Elige el nivel y la región arriba. Haz clic en una región del mapa o de la tabla para elegirla en todo el tablero.</p>`));
  tarjetas();

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
    if (window.innerWidth === anchoPrevio) return; // en celular, la barra del navegador cambia solo el alto
    anchoPrevio = window.innerWidth;
    clearTimeout(espera);
    espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150);
  });

  render();
});
