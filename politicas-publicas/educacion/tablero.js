/* =========================================================
   Tablero de Educación — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script (Tableros >
   Publicar tableros) desde el Sheet «[Tableros] Educación», que llena
   el notebook procesos/educacion/actualizar_educacion.ipynb con los
   cuadros de ESCALE. Una pestaña por indicador, en formato largo:
     nivel, (grado, curso), grupo, categoria, codigo, anio, valor
   grupo: Perú, Región, Área, Sexo, Gestión o Área y sexo.
   Porcentajes de 0 a 1; alumnos por docente, en número de alumnos.

   Tres módulos (pestañas): Estudiantes, Docentes y Escuelas. Filtros
   comunes arriba: región y nivel educativo (como en Looker). En logros
   de aprendizaje cada línea es un curso; en primaria se elige el grado
   evaluado (4.º desde 2016, 2.º de 2007 a 2023). Patrón: un objeto
   `estado`, funciones puras para leer los datos y una sola `render()`.

   Parámetros de URL:
     ?modulo=estudiantes|docentes|escuelas
     &region=CUSCO            región elegida (código en mayúsculas)
     &nivel=Secundaria        Inicial, Primaria (por defecto) o Secundaria
     &grado=2p                grado de primaria en logros de aprendizaje (4p por defecto)
     &mapa=aprendizajes-Matemática-2019   indicador, curso y año del mapa de la pestaña
     &brecha=atraso           indicador de la tarjeta de diferencias
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

/* Grados evaluados en logros de aprendizaje */
const GRADO = {
  "4p": { nombre: "4.º de primaria", nivel: "Primaria" },
  "2p": { nombre: "2.º de primaria", nivel: "Primaria" },
  "2s": { nombre: "2.º de secundaria", nivel: "Secundaria" },
};
const GRADO_A_SERIE = { "2.º de primaria": "2p", "4.º de primaria": "4p", "2.º de secundaria": "2s" };

/* Indicadores: qué niveles tienen y cómo se dicen */
const IND = {
  aprendizajes: { corto: "Logros de aprendizaje", niveles: ["Primaria", "Secundaria"], formato: pct, cursos: true },
  atraso: { corto: "Atraso escolar", niveles: ["Primaria", "Secundaria"], formato: pct,
    frase: (n) => `de los alumnos de ${n} tenía atraso escolar` },
  desaprobados: { corto: "Desaprobados", niveles: ["Primaria", "Secundaria"], formato: pct, hueco: [2020, 2022],
    frase: (n) => `de los alumnos de ${n} desaprobó el año` },
  titulados: { corto: "Docentes titulados", niveles: NIVELES, formato: pct,
    frase: (n) => `de los docentes de ${n} tenía título pedagógico` },
  alumnos_docente: { corto: "Alumnos por docente", niveles: NIVELES, formato: num1, numero: true,
    frase: (n) => `alumnos por docente en ${n}` },
  internet: { corto: "Escuelas con internet", niveles: ["Primaria", "Secundaria"], formato: pct,
    frase: (n) => `de las escuelas de ${n} tenía acceso a internet` },
};

/* Tarjetas de cada pestaña */
const MOD = {
  estudiantes: {
    evol: [
      { ind: "aprendizajes", titulo: "¿Cuántos alumnos logran los aprendizajes esperados?",
        desc: "Porcentaje de alumnos que alcanza el nivel satisfactorio en la evaluación nacional, por curso." },
      { par: [
        { ind: "atraso", titulo: "¿Cuántos van atrasados?", desc: "Porcentaje de alumnos con dos o más años más que la edad de su grado." },
        { ind: "desaprobados", titulo: "¿Cuántos desaprueban el año?", desc: "Porcentaje de alumnos que no aprobó el año. Entre 2020 y 2022 hubo promoción guiada." },
      ] },
    ],
    indicadores: ["aprendizajes", "atraso", "desaprobados"],
    kpis: [["aprendizajes", "Lectura"], ["aprendizajes", "Matemática"], ["atraso"], ["desaprobados"]],
  },
  docentes: {
    evol: [{ par: [
      { ind: "titulados", titulo: "¿Cuántos docentes tienen título pedagógico?", desc: "Porcentaje de docentes con título pedagógico en la especialidad del nivel que enseñan." },
      { ind: "alumnos_docente", titulo: "¿Cuántos alumnos hay por docente?", desc: "Número de alumnos por cada docente." },
    ] }],
    indicadores: ["titulados", "alumnos_docente"],
    kpis: [["titulados"], ["alumnos_docente"]],
  },
  escuelas: {
    evol: [{ ind: "internet", titulo: "¿Cuántas escuelas tienen internet?", desc: "Porcentaje de escuelas con acceso a internet." }],
    indicadores: ["internet"],
    kpis: [["internet"], ["internet", "", "Área:Urbana"], ["internet", "", "Área:Rural"]],
  },
};
const NIVELES_MOD = (m) => NIVELES.filter((n) => MOD[m].indicadores.some((i) => IND[i].niveles.includes(n)));

/* Datos de ESCALE que no se muestran por ser errores de copia evidentes
   (ver docs/revision-datos-educacion.md). Se quedan en el Sheet tal como vienen.
   [indicador, serie, curso, lugar, año] */
const OCULTOS = [
  ["aprendizajes", "2p", "Matemática", "LIMA METROPOLITANA", 2007], // la misma cifra que Lambayeque (8,0125 %)
  ["titulados", "Inicial", "", "Área y sexo:Rural Femenino", 2022],   // la misma cifra que las urbanas
  ["titulados", "Primaria", "", "Área y sexo:Rural Femenino", 2022],
  ["titulados", "Secundaria", "", "Área y sexo:Rural Femenino", 2022],
];

/* Orden y nombres de los desgloses */
const DESGLOSES = [
  ["Área", "Urbana", "Zona urbana"], ["Área", "Rural", "Zona rural"],
  ["Gestión", "Pública", "Escuela pública"], ["Gestión", "Privada", "Escuela privada"],
  ["Sexo", "Femenino", "Mujeres"], ["Sexo", "Masculino", "Hombres"],
];

const estado = {
  modulo: "estudiantes",
  ambito: "nacional",
  region: NACIONAL,
  nivel: "Primaria",
  grado: "4p",            // grado de primaria en logros de aprendizaje
  // mapa de cada pestaña: indicador, curso y año (null = el último con datos)
  mapa: {
    estudiantes: { ind: "aprendizajes", curso: "Lectura", anio: null },
    docentes: { ind: "titulados", curso: "", anio: null },
    escuelas: { ind: "internet", curso: "", anio: null },
  },
  brecha: { estudiantes: "aprendizajes", docentes: "titulados", escuelas: "internet" },
};
const DEFECTO = JSON.parse(JSON.stringify({ mapa: estado.mapa, brecha: estado.brecha }));

let C, GEO, controles;
const V = new Map();          // "ind|serie|curso|lugar|anio" -> valor (lugar: código de región, NACIONAL o "Área:Rural")
const ANIOS = new Map();      // "ind|serie|curso|lugar" -> años con dato, ordenados
const NOMBRE_REGION = new Map([[NACIONAL, "Perú"]]);
let REGIONES = [];
const mapas = {};

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
  if (!IND[ind].niveles.includes(estado.nivel)) return null;
  if (!IND[ind].cursos) return estado.nivel;
  return estado.nivel === "Primaria" ? estado.grado : "2s";
};
const cursosDe = (s) => CURSOS.filter((c) => aniosDe("aprendizajes", s, c, NACIONAL).length);
const nivelMin = () => estado.nivel.toLowerCase();
const nombreRegion = (c) => NOMBRE_REGION.get(c) ?? c;
const enLugar = (c) => (c === NACIONAL ? "en el Perú" : `en ${nombreRegion(c)}`);
const EnLugar = (c) => (c === NACIONAL ? "En el Perú" : `En ${nombreRegion(c)}`);
const fmt = (ind, v) => IND[ind].formato(v);
const cifra = (ind, v) => (IND[ind].numero ? `<strong>${num1(v)}</strong>` : `el <strong>${pct(v)}</strong>`);
const sinNivel = (ind) => `${IND[ind].corto} no tiene datos de ${nivelMin()}.`;

/* ---------------------------------------------------------
   Piezas compartidas
   --------------------------------------------------------- */
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const $ = (s, raiz = document) => raiz.querySelector(s);

// Botones de una sola opción
const botones = (opciones, elegida) => opciones.map((o) =>
  `<button type="button" data-valor="${Obs.escapar(o.valor)}" aria-pressed="${o.valor === elegida}"${o.desactivado ? " disabled" : ""}>${Obs.escapar(o.etiqueta)}</button>`).join("");

// Líneas por año. series: [{ nombre, color, valores (uno por año de `anios`), punteada }]
function lineas(id, ind, anios, series, aria) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  if (!todos.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const ancho = el.clientWidth;
  // Tope del eje en un múltiplo del intervalo, para que la última marca no quede pegada a la anterior
  const maximo = Math.max(...todos) * 1.05;
  const paso = IND[ind].numero ? (maximo > 25 ? 10 : 5) : maximo > 0.5 ? 0.2 : maximo > 0.2 ? 0.1 : 0.05;
  const tope = IND[ind].numero ? Math.ceil(maximo / paso) * paso : Math.min(1, Math.ceil(maximo / paso - 1e-9) * paso);
  const cada = ancho < 420 ? 5 : ancho < 760 ? 3 : 2;
  const hueco = IND[ind].hueco;
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM, animationDurationUpdate: 400,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => {
        const a = +ps[0].axisValue;
        if (hueco && a >= hueco[0] && a <= hueco[1]) return `<strong>${a}</strong><br>No aplica: promoción guiada`;
        const filas = ps.filter((p) => p.value != null);
        return `<strong>${a}</strong>` + (filas.length ? filas.map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${fmt(ind, p.value)}</strong>`).join("") : "<br>Sin dato");
      } },
    grid: { left: IND[ind].numero ? 40 : 52, right: 18, top: 16, bottom: 30 },
    xAxis: { type: "category", data: anios.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (anios.length - 1 - i) % cada === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, interval: paso, splitLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ formatter: (v) => (IND[ind].numero ? Obs.fmtN(v) : `${Math.round(v * 100)} %`) }) },
    series: series.map((s, i) => ({
      name: s.nombre, type: "line", data: s.valores, connectNulls: true, symbol: "circle", symbolSize: s.punteada ? 6 : 8, z: s.punteada ? 2 : 3,
      lineStyle: { width: s.punteada ? 2 : 2.5, color: s.color, type: s.punteada ? [6, 4] : "solid" },
      itemStyle: { color: s.punteada ? "#fff" : s.color, borderColor: s.color, borderWidth: s.punteada ? 2 : 1.5 },
      emphasis: { focus: "series" },
      markArea: i === 0 && hueco ? { silent: true, itemStyle: { color: C.hueco },
        label: { show: ancho >= 420, position: "insideTop", distance: 6, ...txt(), formatter: "Promoción guiada" },
        data: [[{ xAxis: String(hueco[0]) }, { xAxis: String(hueco[1]) }]] } : undefined,
    })),
  }, true);
  el.setAttribute("aria-label", aria);
}

function leyenda(id, entradas, { hueco = false, regional = false } = {}) {
  const partes = entradas.map(([nombre, color]) => `<span><i class="l" style="border-color:${color}"></i>${Obs.escapar(nombre)}</span>`);
  if (regional) partes.push(`<span><i class="l punteada" style="border-color:${C.textoSuave}"></i>Perú (línea punteada)</span>`);
  if (hueco) partes.push(`<span><i class="hueco"></i>Promoción guiada (no aplica)</span>`);
  document.getElementById(id).innerHTML = partes.join("");
}

/* ---------------------------------------------------------
   Tarjeta de evolución (una por indicador)
   --------------------------------------------------------- */
function htmlEvol({ ind, titulo, desc }) {
  return `<article class="tarjeta" id="c-${ind}">
    <header><h3>${titulo}</h3><p>${desc}</p></header>
    ${IND[ind].cursos ? `<div class="controles" data-grado-caja><div class="filtro-local" role="group" aria-labelledby="lbl-grado"><span id="lbl-grado">Grado evaluado</span><div class="segmentado claro" data-grado></div></div></div>` : ""}
    <p class="lectura" id="l-${ind}" aria-live="polite"></p>
    <div class="ley" id="ley-${ind}"></div>
    <div class="grafico" id="g-${ind}"></div>
    <p class="nota-tarjeta" id="n-${ind}"></p>
  </article>`;
}

function pintarEvol(ind) {
  const info = IND[ind], lugar = estado.region, regional = lugar !== NACIONAL;
  const s = serieDe(ind);
  const card = document.getElementById(`c-${ind}`);
  const lectura = document.getElementById(`l-${ind}`), nota = document.getElementById(`n-${ind}`);
  nota.textContent = "";
  if (info.cursos) {
    $("[data-grado-caja]", card).hidden = estado.nivel !== "Primaria";
    $("[data-grado]", card).innerHTML = botones([
      { valor: "4p", etiqueta: "4.º grado (2016-2025)" }, { valor: "2p", etiqueta: "2.º grado (2007-2023)" }], estado.grado);
  }
  if (!s) {
    lectura.textContent = sinNivel(ind);
    leyenda(`ley-${ind}`, []);
    return Obs.vacio(`g-${ind}`, `Sin datos de ${nivelMin()}`);
  }
  // Líneas: un curso cada una (logros de aprendizaje) o el nivel elegido; con región, el Perú punteado
  const grupos = info.cursos
    ? cursosDe(s).map((c) => ({ curso: c, nombre: c, color: C.cursos[c] }))
    : [{ curso: "", nombre: estado.nivel, color: C.niveles[estado.nivel] }];
  const todos = grupos.flatMap((x) => [...aniosDe(ind, s, x.curso, NACIONAL), ...aniosDe(ind, s, x.curso, lugar)]);
  const a0 = Math.min(...todos), a1 = Math.max(...todos);
  const anios = Array.from({ length: a1 - a0 + 1 }, (_, i) => a0 + i);
  const series = [];
  for (const x of grupos) {
    series.push({ nombre: regional ? `${x.nombre} (${nombreRegion(lugar)})` : x.nombre, color: x.color, valores: anios.map((a) => val(ind, s, x.curso, lugar, a)) });
    if (regional) series.push({ nombre: `${x.nombre} (Perú)`, color: x.color, punteada: true, valores: anios.map((a) => val(ind, s, x.curso, NACIONAL, a)) });
  }
  leyenda(`ley-${ind}`, grupos.map((x) => [x.nombre, x.color]), { hueco: !!info.hueco, regional });
  lineas(`g-${ind}`, ind, anios, series, `${info.corto}, ${info.cursos ? GRADO[s].nombre : nivelMin()}, ${enLugar(lugar)}, ${a0}-${a1}`);

  // Lectura
  if (info.cursos) {
    const conDato = grupos.filter((x) => aniosDe(ind, s, x.curso, lugar).length);
    if (!conDato.length) { lectura.textContent = `${EnLugar(lugar)} no hay resultados regionales de ${GRADO[s].nombre}.`; return; }
    const a = Math.max(...conDato.map((x) => ultimo(ind, s, x.curso, lugar)));
    const en = conDato.filter((x) => val(ind, s, x.curso, lugar, a) != null).slice(0, 2);
    const [p, q] = en.map((x) => ({ c: x.curso, v: val(ind, s, x.curso, lugar, a), peru: val(ind, s, x.curso, NACIONAL, a) }));
    let t = `${EnLugar(lugar)}, en ${a}, el <strong>${pct(p.v)}</strong> de los alumnos de ${GRADO[s].nombre} logró los aprendizajes esperados en ${p.c}`;
    if (q) t += ` y el <strong>${pct(q.v)}</strong> en ${q.c}`;
    if (regional && p.peru != null) t += `; en el Perú, ${pct(p.peru)}${q?.peru != null ? ` y ${pct(q.peru)}` : ""}`;
    lectura.innerHTML = `${t}.`;
    const notas = [];
    if (s === "2p") notas.push("Desde 2024 ya no se evalúa el 2.º grado de primaria. 2.º y 4.º grado son pruebas distintas: no se comparan entre sí.");
    if (s === "4p") notas.push("4.º y 2.º grado son pruebas distintas: no se comparan entre sí.");
    if (regional && conDato.length < grupos.length) notas.push(`Algunos cursos no tienen resultados para ${nombreRegion(lugar)}.`);
    nota.textContent = notas.join(" ");
    return;
  }
  const a = ultimo(ind, s, "", lugar);
  if (!a) { lectura.textContent = `${EnLugar(lugar)} no hay datos de ${nivelMin()}.`; return; }
  const v = val(ind, s, "", lugar, a);
  let t = info.numero ? `${EnLugar(lugar)} había <strong>${num1(v)}</strong> ${info.frase(nivelMin())} en ${a}` : `${EnLugar(lugar)}, ${cifra(ind, v)} ${info.frase(nivelMin())} en ${a}`;
  if (regional) {
    const p = val(ind, s, "", NACIONAL, a);
    if (p != null) t += `; en el Perú, ${fmt(ind, p)}`;
  } else {
    const a0d = aniosDe(ind, s, "", lugar)[0];
    if (a0d !== a) t += `, frente ${info.numero ? `a ${num1(val(ind, s, "", lugar, a0d))}` : `al ${pct(val(ind, s, "", lugar, a0d))}`} en ${a0d}`;
  }
  lectura.innerHTML = `${t}.`;
}

/* ---------------------------------------------------------
   Mapa por región (uno por pestaña)
   --------------------------------------------------------- */
function htmlMapa(m) {
  return `<article class="tarjeta" id="c-mapa-${m}">
    <header><h3>¿Cómo está cada región?</h3>
      <p>Valor de cada región en el año elegido, para el nivel elegido arriba. Lima Metropolitana y el Callao se muestran ampliados en el recuadro. Haz clic en una región para elegirla en todo el tablero.</p></header>
    <div class="controles">
      ${MOD[m].indicadores.length > 1 ? `<div class="filtro-local" role="group" aria-labelledby="lbl-mi-${m}"><span id="lbl-mi-${m}">Indicador</span><div class="segmentado claro" data-mapa-ind></div></div>` : ""}
      <div class="filtro-local" data-mapa-curso-caja role="group" aria-labelledby="lbl-mc-${m}"><span id="lbl-mc-${m}">Curso</span><div class="segmentado claro" data-mapa-curso></div></div>
      <div class="filtro-local"><label for="f-anio-${m}">Año</label><select id="f-anio-${m}" data-mapa-anio></select></div>
    </div>
    <p class="lectura" id="l-mapa-${m}" aria-live="polite"></p>
    <div class="mapa-y-tabla" id="mt-${m}">
      <div><div id="mapa-${m}"></div><div class="leyenda-mapa" id="ley-mapa-${m}"></div></div>
      <div class="tabla-caja" id="t-mapa-${m}"></div>
    </div>
  </article>`;
}

function pintarMapa(m) {
  const conf = estado.mapa[m], ind = conf.ind, info = IND[ind];
  const card = document.getElementById(`c-mapa-${m}`);
  const s = serieDe(ind);
  if ($("[data-mapa-ind]", card)) $("[data-mapa-ind]", card).innerHTML = botones(MOD[m].indicadores.map((i) => ({ valor: i, etiqueta: IND[i].corto })), ind);
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
  Obs.leyendaTramos(`ley-mapa-${m}`, cortes, C.escala, (v) => (info.numero ? Obs.fmtN(v, 0) : `${Obs.fmtN(v, 0)} %`));

  const peru = val(ind, s, curso, NACIONAL, anio);
  const alto = filas[0], bajo = filas.at(-1);
  const que = info.cursos ? `logros de aprendizaje en ${curso}, ${GRADO[s].nombre}` : `${info.corto.toLowerCase()}, ${nivelMin()}`;
  lectura.innerHTML = `En ${anio} (${que}), <strong>${nombreRegion(alto.region)}</strong> tiene el valor más alto (${fmt(ind, alto.v)}) y ` +
    `<strong>${nombreRegion(bajo.region)}</strong> el más bajo (${fmt(ind, bajo.v)})` + (peru != null ? `; el Perú, ${fmt(ind, peru)}.` : ".");

  Obs.tabla(`t-mapa-${m}`, [{ titulo: "#", campo: "pos" }, { titulo: "Región", campo: "nombre" }, { titulo: info.numero ? "Alumnos por docente" : "Porcentaje", campo: "valor", num: true }],
    filas.map((f, i) => ({ pos: String(i + 1), region: f.region, nombre: nombreRegion(f.region), valor: fmt(ind, f.v) })),
    { alClic: elegirRegion, elegida: estado.region });
  if (peru != null) $(`#t-mapa-${m} tbody`).insertAdjacentHTML("beforeend", `<tr class="peru"><td></td><td>Perú</td><td class="num">${fmt(ind, peru)}</td></tr>`);
  document.getElementById(`t-mapa-${m}`).setAttribute("aria-label", `${info.corto} por región, ${anio}`);
}

/* ---------------------------------------------------------
   Diferencias por zona, gestión y sexo (Perú, último año)
   --------------------------------------------------------- */
function htmlBrecha(m) {
  return `<article class="tarjeta" id="c-brecha-${m}">
    <header><h3>¿Qué diferencias hay entre zonas, escuelas y sexos?</h3>
      <p>Último año con datos, para todo el Perú y el nivel elegido arriba: zona urbana y rural, escuela pública y privada, y mujeres y hombres. Los desgloses no están por región.</p></header>
    ${MOD[m].indicadores.length > 1 ? `<div class="controles"><div class="filtro-local" role="group" aria-labelledby="lbl-bi-${m}"><span id="lbl-bi-${m}">Indicador</span><div class="segmentado claro" data-brecha-ind></div></div></div>` : ""}
    <p class="lectura" id="l-brecha-${m}" aria-live="polite"></p>
    <div class="ley" id="ley-brecha-${m}"></div>
    <div class="grafico" id="g-brecha-${m}"></div>
  </article>`;
}

function pintarBrecha(m) {
  const ind = estado.brecha[m], info = IND[ind];
  const card = document.getElementById(`c-brecha-${m}`);
  if ($("[data-brecha-ind]", card)) $("[data-brecha-ind]", card).innerHTML = botones(MOD[m].indicadores.map((i) => ({ valor: i, etiqueta: IND[i].corto })), ind);
  const lectura = document.getElementById(`l-brecha-${m}`), ley = document.getElementById(`ley-brecha-${m}`);
  const s = serieDe(ind);
  if (!s) { lectura.textContent = sinNivel(ind); ley.innerHTML = ""; return Obs.vacio(`g-brecha-${m}`, `Sin datos de ${nivelMin()}`); }

  // Barras: un curso cada una (logros de aprendizaje) o el nivel elegido, en su último año con desgloses
  const grupos = (info.cursos ? cursosDe(s).map((c) => ({ curso: c, nombre: c, color: C.cursos[c] })) : [{ curso: "", nombre: estado.nivel, color: C.niveles[estado.nivel] }])
    .map((x) => ({ ...x, anio: Math.max(0, ...DESGLOSES.flatMap(([g, c]) => aniosDe(ind, s, x.curso, `${g}:${c}`))) })).filter((x) => x.anio);
  const anio = Math.max(0, ...grupos.map((x) => x.anio));
  const series = grupos.filter((x) => x.anio === anio);
  const cats = DESGLOSES.filter(([g, c]) => series.some((x) => val(ind, s, x.curso, `${g}:${c}`, anio) != null));
  if (!series.length || !cats.length) { lectura.textContent = "No hay desgloses para esta selección."; ley.innerHTML = ""; return Obs.vacio(`g-brecha-${m}`); }

  ley.innerHTML = series.length > 1 ? series.map((x) => `<span><i style="background:${x.color}"></i>${Obs.escapar(x.nombre)}</span>`).join("") : "";
  const el = document.getElementById(`g-brecha-${m}`);
  const angosto = el.clientWidth < 520;
  el.style.height = `${cats.length * (series.length * (angosto ? 26 : 22) + 24) + 20}px`;
  const g = Obs.grafico(`g-brecha-${m}`);
  g.resize();
  const todos = series.flatMap((x) => cats.map(([gr, c]) => val(ind, s, x.curso, `${gr}:${c}`, anio))).filter((v) => v != null);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${ps[0].axisValue}, ${anio}</strong>` + ps.filter((p) => p.value != null).map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${fmt(ind, p.value)}</strong>`).join("") },
    grid: { left: angosto ? 118 : 140, right: 64, top: 4, bottom: 4 },
    xAxis: { type: "value", show: false, max: Math.max(...todos) * 1.15 },
    yAxis: { type: "category", inverse: true, data: cats.map(([, , n]) => n), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ color: C.texto }) },
    series: series.map((x) => ({
      name: x.nombre, type: "bar", barMaxWidth: 16, barGap: "20%", barCategoryGap: "28%",
      itemStyle: { color: x.color, borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", distance: 6, formatter: (p) => fmt(ind, p.value), ...txt({ color: C.texto, fontWeight: 700 }) },
      data: cats.map(([gr, c]) => val(ind, s, x.curso, `${gr}:${c}`, anio)),
    })),
  }, true);
  el.setAttribute("aria-label", `${info.corto} por zona, tipo de escuela y sexo en el Perú, ${anio}`);

  // Lectura: la diferencia entre zona rural y urbana del primer curso o del nivel
  const x = series[0];
  const u = val(ind, s, x.curso, "Área:Urbana", anio), r = val(ind, s, x.curso, "Área:Rural", anio);
  const que = info.cursos ? `${GRADO[s].nombre}, ${x.curso}` : nivelMin();
  if (u != null && r != null) {
    const dif = info.numero ? `${num1(Math.abs(u - r))} alumnos por docente` : `${Obs.fmtN(Math.abs(u - r) * 100, 1)} puntos`;
    lectura.innerHTML = `En ${anio} (${que}), la zona rural tiene ${fmt(ind, r)} y la urbana ${fmt(ind, u)}: una diferencia de <strong>${dif}</strong>.`;
  } else lectura.textContent = `Datos de ${anio} (${que}).`;
}

/* ---------------------------------------------------------
   Cifras clave y resumen
   --------------------------------------------------------- */
function cifraClave(ind, curso = "", lugarFijo = null) {
  const s = serieDe(ind);
  const lugar = lugarFijo ?? estado.region;
  if (!s) return null;
  const a = ultimo(ind, s, curso, lugar);
  return a ? { ind, s, curso, lugar, a, v: val(ind, s, curso, lugar, a) } : { ind, s, curso, lugar, a: null, v: null };
}

function pintarCifras(m) {
  const regional = estado.region !== NACIONAL;
  const caja = document.getElementById(`k-${m}`);
  const kpis = MOD[m].kpis;
  caja.className = `kpis kpis-${kpis.length}`;
  caja.innerHTML = kpis.map((_, i) => `<div class="kpi" id="k-${m}-${i}"></div>`).join("");
  kpis.forEach(([ind, curso = "", lugarFijo = null], i) => {
    const info = IND[ind], x = cifraClave(ind, curso, lugarFijo);
    const zona = lugarFijo ? ` en zona ${lugarFijo.split(":")[1].toLowerCase()} (Perú)` : "";
    const etiqueta = info.cursos ? `Logran los aprendizajes en ${curso}${x?.s ? ` (${GRADO[x.s].nombre})` : ""}` : `${info.corto} (${nivelMin()})${zona}`;
    if (!x || !x.a) return Obs.kpi(`k-${m}-${i}`, { etiqueta, valor: "—", pie: x ? "Sin datos" : `Sin datos de ${nivelMin()}` });
    const p = regional && !lugarFijo ? val(ind, x.s, curso, NACIONAL, x.a) : null;
    Obs.kpi(`k-${m}-${i}`, { etiqueta, valor: fmt(ind, x.v), pie: `${x.a}${p != null ? `. Perú: ${fmt(ind, p)}` : ""}` });
  });
}

function pintarResumen(m) {
  const lugar = estado.region, el = document.getElementById(`r-${m}`);
  // Dos cifras de indicadores distintos (la del primer gráfico ya la dice su propia lectura)
  const vistos = new Set();
  const partes = MOD[m].kpis.filter(([ind, , fijo]) => !fijo && !vistos.has(ind) && vistos.add(ind))
    .map(([ind, curso = ""]) => cifraClave(ind, curso)).filter((x) => x && x.a).slice(0, 2);
  if (!partes.length) { el.textContent = `${EnLugar(lugar)} no hay datos de ${nivelMin()} en esta pestaña.`; return; }
  const [x, y] = partes;
  const parte = (z) => (IND[z.ind].cursos
    ? `el <strong>${pct(z.v)}</strong> de los alumnos de ${GRADO[z.s].nombre} logró los aprendizajes esperados en ${z.curso}`
    : IND[z.ind].numero ? `había <strong>${num1(z.v)}</strong> ${IND[z.ind].frase(nivelMin())}` : `${cifra(z.ind, z.v)} ${IND[z.ind].frase(nivelMin())}`);
  let t = `${EnLugar(lugar)}, en ${x.a}, ${parte(x)}`;
  if (y) t += y.ind === x.ind ? ` y el <strong>${pct(y.v)}</strong> en ${y.curso}${y.a !== x.a ? ` (${y.a})` : ""}` : `, y ${parte(y)}${y.a !== x.a ? ` en ${y.a}` : ""}`;
  el.innerHTML = `${t}.`;
}

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
function actualizar(parche) {
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = NACIONAL;
  // Si la pestaña no tiene el nivel elegido (inicial en Estudiantes o Escuelas), se pasa a primaria
  if (!NIVELES_MOD(estado.modulo).includes(estado.nivel)) estado.nivel = "Primaria";
  render();
}
function elegirRegion(cod) {
  if (cod === estado.region) actualizar({ ambito: "nacional", region: NACIONAL });
  else actualizar({ ambito: "regional", region: cod });
}

function sincronizarControles() {
  controles.sincronizar(estado);
  const disponibles = NIVELES_MOD(estado.modulo);
  document.querySelectorAll("#f-nivel button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.nivel === estado.nivel);
    b.disabled = !disponibles.includes(b.dataset.nivel);
    b.title = b.disabled ? "Esta pestaña no tiene datos de inicial" : "";
  });
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
}

function actualizarURL() {
  const m = estado.modulo, mp = estado.mapa[m], dm = DEFECTO.mapa[m];
  Obs.escribirURL({
    modulo: m === "estudiantes" ? null : m,
    region: estado.region === NACIONAL ? null : estado.region,
    nivel: estado.nivel === "Primaria" ? null : estado.nivel,
    grado: estado.grado === "4p" ? null : estado.grado,
    mapa: mp.ind === dm.ind && mp.curso === dm.curso && mp.anio == null ? null : [mp.ind, mp.curso, mp.anio ?? ""].join("-").replace(/-+$/, ""),
    brecha: estado.brecha[m] === DEFECTO.brecha[m] ? null : estado.brecha[m],
  });
}

function render() {
  sincronizarControles();
  const m = estado.modulo;
  pintarResumen(m);
  pintarCifras(m);
  for (const t of MOD[m].evol) (t.par ?? [t]).forEach((x) => pintarEvol(x.ind));
  pintarMapa(m);
  pintarBrecha(m);
  actualizarURL();
}

/* Las tarjetas de cada pestaña se arman una vez; sus botones solo cambian `estado` */
function tarjetas() {
  for (const m of MODULOS) {
    const caja = document.getElementById(`c-${m}`);
    caja.innerHTML = MOD[m].evol.map((t) => (t.par ? `<div class="par">${t.par.map(htmlEvol).join("")}</div>` : htmlEvol(t))).join("") + htmlMapa(m) + htmlBrecha(m);
    caja.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-valor]");
      if (!b || b.disabled) return;
      const grupo = b.parentElement, v = b.dataset.valor;
      if (grupo.hasAttribute("data-grado")) estado.grado = v;
      else if (grupo.hasAttribute("data-mapa-ind")) estado.mapa[m] = { ind: v, curso: IND[v].cursos ? "Lectura" : "", anio: null };
      else if (grupo.hasAttribute("data-mapa-curso")) estado.mapa[m] = { ...estado.mapa[m], curso: v };
      else if (grupo.hasAttribute("data-brecha-ind")) estado.brecha[m] = v;
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
  C = { ...Obs.tema(), hueco: token("--hueco"),
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
  if (NOMBRE_REGION.has(reg) && reg !== NACIONAL) Object.assign(estado, { ambito: "regional", region: reg });
  if (NIVELES.includes(q.get("nivel"))) estado.nivel = q.get("nivel");
  if (["4p", "2p"].includes(q.get("grado"))) estado.grado = q.get("grado");
  const [mi, mc, ma] = (q.get("mapa") || "").split("-");
  if (MOD[estado.modulo].indicadores.includes(mi)) estado.mapa[estado.modulo] = { ind: mi, curso: CURSOS.includes(mc) ? mc : IND[mi].cursos ? "Lectura" : "", anio: +(IND[mi].cursos ? ma : mc) || null };
  if (MOD[estado.modulo].indicadores.includes(q.get("brecha"))) estado.brecha[estado.modulo] = q.get("brecha");
  if (!NIVELES_MOD(estado.modulo).includes(estado.nivel)) estado.nivel = "Primaria";

  // Filtros comunes: región (Obs.controlesComunes) y nivel educativo
  const filtros = document.getElementById("filtros");
  controles = Obs.controlesComunes(filtros, { regiones: REGIONES, anios: [2000, 2025], alCambiar: actualizar, comparar: false, periodo: false });
  filtros.insertAdjacentHTML("beforeend", `
    <div class="filtro">
      <span class="etiqueta" id="lbl-nivel">Nivel educativo</span>
      <div class="segmentado" id="f-nivel" role="group" aria-labelledby="lbl-nivel">
        ${NIVELES.map((n) => `<button type="button" data-nivel="${n}">${n}</button>`).join("")}
      </div>
    </div>`);
  document.getElementById("f-nivel").onclick = (e) => {
    const b = e.target.closest("button[data-nivel]");
    if (b && !b.disabled) actualizar({ nivel: b.dataset.nivel });
  };
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
