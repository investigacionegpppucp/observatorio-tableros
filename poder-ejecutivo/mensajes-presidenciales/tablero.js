/* =========================================================
   Tablero de Mensajes presidenciales — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json, que arma el Apps Script (Tableros > Publicar
   tableros) desde el Sheet «2. Discursos presidenciales». Todo sale de
   la pestaña «General»: una fila por palabra y gobierno, con las veces
   que se usó en cada mensaje (asuncion, segundo, tercero, cuarto, quinto)
   y su tema (Categoria; la mayoría, «Sin categoria»). La base no trae el
   texto de los mensajes.

   Medida: por cada 1.000 palabras. Los gobiernos dieron distinta cantidad
   de mensajes y de distinto largo; el total de palabras (denominador) es la
   suma de todas las palabras de los mensajes elegidos, incluidas las vacías.

   Dos pestañas: ¿De qué temas hablaron? (matriz gobierno × tema, temas más
   mencionados, mapa de árbol tema → palabras) y ¿Qué palabras usaron?
   (tabla con buscador, 20 más usadas, palabras distintivas de un gobierno).
   Filtros comunes: Gobierno, Mensaje y Tema (selección múltiple, también con
   clics en los gráficos). Cada gráfico ignora el filtro de su propia
   categoría y resalta lo elegido. Patrón: `estado`, `filtrar()` y `render()`.

   Parámetros de URL:
     ?modulo=palabras&gobiernos=0-3&mensajes=0-1&temas=4&buscar=<texto>&distintivo=8
     (índices: gobiernos en orden cronológico, mensajes de la asunción al quinto,
     temas en orden alfabético)
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "mensajes-presidenciales";
const ARCHIVOS = [{ clave: "mensajes_presidenciales_base", etiqueta: "Mensajes presidenciales: palabras por gobierno y mensaje" }];
const MODULOS = ["temas", "palabras"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const MENSAJES = [
  { clave: "asuncion", nombre: "Asunción al cargo", corto: "Asunción" },
  { clave: "segundo", nombre: "Segundo mensaje", corto: "2.º mensaje" },
  { clave: "tercero", nombre: "Tercer mensaje", corto: "3.º mensaje" },
  { clave: "cuarto", nombre: "Cuarto mensaje", corto: "4.º mensaje" },
  { clave: "quinto", nombre: "Quinto mensaje", corto: "5.º mensaje" },
];
// Gobiernos en orden cronológico: el Sheet trae solo el apellido
const GOBIERNOS = [
  ["Toledo", "Alejandro Toledo"], ["García", "Alan García"], ["Humala", "Ollanta Humala"], ["Kuczynski", "Pedro Pablo Kuczynski"],
  ["Vizcarra", "Martín Vizcarra"], ["Merino", "Manuel Merino"], ["Sagasti", "Francisco Sagasti"], ["Castillo", "Pedro Castillo"],
  ["Boluarte", "Dina Boluarte"], ["Jerí", "José Jerí"], ["Balcázar", "José María Balcázar"], ["Fujimori", "Keiko Fujimori"],
];
const SIN_TEMA = "sin categoria";
// Al abrir el tablero se ve un solo gobierno (el más reciente); mezclar todos se elige a propósito
const gobiernoDefecto = () => new Set([GOB.length - 1]);
// Familias de temas: dan el color a temas y palabras en todo el tablero (tokens --f-* de estilos.css).
// `claro`: el texto sobre el color base va en tinta oscura.
const FAMILIAS = [
  { nombre: "Economía y desarrollo", temas: ["Economía", "Crecimiento", "Empleo", "Obras"] },
  { nombre: "Servicios sociales", temas: ["Educación", "Salud", "Vivienda", "Servicios Básicos", "Pobreza"] },
  { nombre: "Estado e instituciones", temas: ["Democracia", "Reforma", "Anticorrupción", "Descentralización", "Seguridad"] },
  { nombre: "Grupos de población", temas: ["Mujeres", "Jóvenes"], claro: true },
];
const LIMITE_TABLA = 300; // filas que muestra la tabla de palabras (el resto, con el buscador)
const MIN_DISTINTIVA = 5; // veces mínimas que el gobierno usó una palabra para contarla como distintiva
// Palabras vacías del español: no se muestran en la pestaña de palabras, pero cuentan en el total
const VACIAS = new Set(`a al algo algún alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aquí así aun aún bajo bien
cada casi como cómo con contra cual cuál cuales cuáles cuando cuándo cuanto cuánto cuanta cuantas cuantos de del desde donde dónde dos durante
e el él ella ellas ello ellos en entre era eran es esa esas ese eso esos esta está están estaba estaban estado_ estamos estar estas este esto
estos estoy fue fueron fui ha había habían han has hasta hay haya he hemos hoy la las le les lo los mas más me mi mí mis mucho muchos muy
nada ni no nos nosotros nuestra nuestras nuestro nuestros o os otra otras otro otros para pero poco por porque pues que qué quien quién
quienes se sea sean ser será serán si sí sido siempre sin sino sobre su sus también tan tanto te tenemos tener tengo ti tiene tienen todo
todos toda todas tu tú tus u un una unas uno unos usted ustedes vez vosotros y ya yo cual cuya cuyo cuyas cuyos ésta éste esta mismo misma
mismos mismas cada vez solo sólo sus vamos va van hace hacer hecho ha sido debe deben puede pueden podemos ser son somos fue será hemos
asimismo además mediante según tras luego entonces donde aquel cierto ciertos ciertas tal tales través dentro fuera allí ahí ese esa`.split(/\s+/));
// fuera de la pestaña de palabras: cifras sueltas y direcciones web
const esRuido = (w) => w.length < 3 || VACIAS.has(w) || /^[\d.,%/-]+$/.test(w) || /www|\.(pe|com|org|gob)\b/.test(w);

const estado = { modulo: "temas", gobiernos: null, mensajes: null, temas: null, buscar: "", distintivo: null };

let C, FILAS = [], GOB = [], TEMAS = [], TOT = [], TEMA_FAM = [];
let multiGob, multiMen, multiTem;
const ORDEN = {}; // orden elegido de cada tabla: { clave, dir }

/* =========== Utilidades =========== */
const num = (v, dec = 0) => Obs.fmtN(v, dec);
const pct = (v) => Obs.fmtPct(v, 1);
const plural = (k, uno, varios) => `${num(k)} ${k === 1 ? uno : varios}`;
const txt = (x = {}) => ({ fontFamily: C.fuente, fontSize: 14, color: C.textoSuave, ...x });
const todos = (sel, lista) => sel.size === lista.length;
const todosLos = (lista) => new Set(lista.map((_, i) => i));
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const porMil = (veces, palabras) => (palabras > 0 ? (veces / palabras) * 1000 : null);
const mil = (v) => (v == null ? "—" : num(v, v < 10 ? 1 : 0)); // 3,4 o 27 por cada 1.000

// Lecturas: los datos que cambian con los filtros van destacados (negrita azul con línea lima)
const lectura = (id, html) => (document.getElementById(id).innerHTML = html);
const fuerte = (s) => `<strong>${s}</strong>`;
const destacar = (s) => fuerte(Obs.escapar(String(s)));
const enumerar = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const nombres = (xs) => enumerar(xs.map(destacar));
const extremos = (lista, campo, mayor = true) => {
  if (!lista.length) return [];
  const v = (mayor ? Math.max : Math.min)(...lista.map((x) => x[campo]));
  return lista.filter((x) => x[campo] === v);
};

/* =========== Color por familia de temas =========== */
const familia = (t) => (t >= 0 ? TEMA_FAM[t] : -1); // -1: palabra sin tema
const colorFam = (k, oscuro = false) => (k < 0 ? C.otros : k >= FAMILIAS.length ? C.otrosTemas : C.familias[k][oscuro ? 1 : 0]);
const tintaFam = (k, oscuro = false) => (!oscuro && FAMILIAS[k]?.claro ? C.navy : "#fff");
// Leyenda centrada: solo las familias presentes (y «Sin tema» si hay palabras sin tema)
function leyendaFamilias(id, ks, sinTema = false) {
  const presentes = [...new Set(ks)].filter((k) => k >= 0).sort((a, b) => a - b);
  const nombre = (k) => (k < FAMILIAS.length ? FAMILIAS[k].nombre : "Otros temas");
  document.getElementById(id).innerHTML = presentes.map((k) => `<span><i style="background:${colorFam(k)}"></i>${nombre(k)}</span>`).join("") +
    (sinTema ? `<span><i style="background:${C.otros}"></i>Sin tema</span>` : "");
}

/* =========== Datos =========== */
function preparar(T) {
  const limpio = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
  const n = (v) => +v || 0;
  const crudas = Obs.expandir(T.General).map((f) => ({
    w: limpio(f.Palabra).toLowerCase(), gob: limpio(f.Gobierno), tema: limpio(f.Categoria),
    n: MENSAJES.map((m) => n(f[m.clave])),
  })).filter((f) => f.w && f.gob);
  // gobiernos en orden cronológico; uno nuevo que no esté en la lista va al final
  const presentes = new Set(crudas.map((f) => f.gob));
  GOB = [...GOBIERNOS.filter(([a]) => presentes.has(a)), ...[...presentes].filter((a) => !GOBIERNOS.some(([x]) => x === a)).map((a) => [a, a])]
    .map(([apellido, nombre], i) => ({ i, apellido, nombre }));
  TEMAS = [...new Set(crudas.map((f) => f.tema).filter((t) => t && t.toLowerCase() !== SIN_TEMA))].sort((a, b) => a.localeCompare(b, "es"));
  // un tema que no esté en ninguna familia queda en «Otros temas»
  TEMA_FAM = TEMAS.map((t) => { const k = FAMILIAS.findIndex((F) => F.temas.some((x) => sinTildes(x) === sinTildes(t))); return k < 0 ? FAMILIAS.length : k; });
  FILAS = crudas.map((f) => ({ w: f.w, n: f.n, g: GOB.findIndex((x) => x.apellido === f.gob), t: TEMAS.indexOf(f.tema), ruido: esRuido(f.w) }));
  // total de palabras de cada gobierno en cada mensaje (todas, incluidas las vacías)
  TOT = GOB.map(() => MENSAJES.map(() => 0));
  FILAS.forEach((f) => f.n.forEach((v, m) => (TOT[f.g][m] += v)));
  GOB.forEach((g) => (g.mensajes = MENSAJES.map((_, m) => TOT[g.i][m] > 0)));
}
// veces de una fila en los mensajes elegidos
const veces = (f, ms) => { let s = 0; for (const m of ms) s += f.n[m]; return s; };
const palabrasDe = (gs, ms) => { let s = 0; for (const g of gs) for (const m of ms) s += TOT[g][m]; return s; };
const mensajesDe = (gs, ms) => { let k = 0; for (const g of gs) for (const m of ms) if (TOT[g][m] > 0) k++; return k; };

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(e) {
  const ms = [...e.mensajes].sort();
  const enG = (f) => e.gobiernos.has(f.g), enT = (f) => (todos(e.temas, TEMAS) ? true : e.temas.has(f.t));
  return {
    ms, gs: [...e.gobiernos].sort((a, b) => a - b),
    todo: FILAS.filter((f) => enG(f) && enT(f)),
    sinTema: FILAS.filter(enG),
    sinGobierno: FILAS.filter(enT),
  };
}

/* =========== Render =========== */
function render() {
  sincronizarControles();
  const s = filtrar(estado);
  if (estado.modulo === "temas") pintarTemas(s);
  else pintarPalabras(s);
  pintarAplicados();
  escribirURL();
}
function escribirURL() {
  const lista = (sel, l) => (todos(sel, l) ? null : [...sel].sort((a, b) => a - b).join("-"));
  const gobs = estado.gobiernos.size === 1 && estado.gobiernos.has(GOB.length - 1) ? null : todos(estado.gobiernos, GOB) ? "todos" : lista(estado.gobiernos, GOB);
  Obs.escribirURL({
    modulo: estado.modulo === "temas" ? null : estado.modulo,
    gobiernos: gobs, mensajes: lista(estado.mensajes, MENSAJES), temas: lista(estado.temas, TEMAS),
    buscar: estado.buscar.trim() || null, distintivo: estado.distintivo,
  });
}

// Texto del alcance elegido, para los resúmenes
function alcance(s) {
  const e = estado;
  const quien = todos(e.gobiernos, GOB) ? `los ${destacar(GOB.length)} gobiernos`
    : e.gobiernos.size === 1 ? `${destacar(GOB[s.gs[0]].nombre)}` : `${destacar(e.gobiernos.size)} gobiernos elegidos`;
  const cuales = todos(e.mensajes, MENSAJES) ? "los mensajes" : e.mensajes.size === 1 ? `${MENSAJES[s.ms[0]].clave === "asuncion" ? "el mensaje de" : "el"} ${destacar(Obs.minus(MENSAJES[s.ms[0]].nombre))}` : `${destacar(e.mensajes.size)} tipos de mensaje`;
  return `En ${cuales} de ${quien}`;
}

/* =========== Pestaña: ¿De qué temas hablaron? =========== */
function pintarTemas(s) {
  cifrasTemas(s);
  matriz(s);
  temasMencionados(s);
  arbol(s);
}

// Veces por tema en un conjunto de filas: arreglo indexado por tema
function porTema(filas, ms) {
  const v = TEMAS.map(() => 0);
  for (const f of filas) if (f.t >= 0) v[f.t] += veces(f, ms);
  return v;
}

function cifrasTemas(s) {
  const total = palabrasDe(s.gs, s.ms), men = mensajesDe(s.gs, s.ms);
  const v = porTema(s.sinTema, s.ms);
  const top = v.map((x, t) => ({ t, x })).sort((a, b) => b.x - a.x)[0];
  const el = document.getElementById("r-temas");
  if (!total) el.textContent = "No hay mensajes con estos filtros. Quita alguno para ver datos.";
  else el.innerHTML = `${alcance(s)} se dijeron ${fuerte(plural(total, "palabra", "palabras"))}, en ${fuerte(plural(men, "mensaje", "mensajes"))}. ` +
    (top?.x ? `El tema más mencionado fue ${destacar(TEMAS[top.t])}, con ${fuerte(mil(porMil(top.x, total)))} palabras por cada 1.000.` : "");
  Obs.kpi("k-mensajes", { etiqueta: "Mensajes analizados", valor: num(men), pie: "Asunción al cargo y mensajes del 28 de julio" });
  Obs.kpi("k-palabras", { etiqueta: "Palabras dichas", valor: num(total), pie: "En los mensajes elegidos" });
  Obs.kpi("k-por-mensaje", { etiqueta: "Palabras por mensaje", valor: men ? num(total / men) : "—", pie: "Largo promedio de los mensajes elegidos" });
  Obs.kpi("k-tema", { etiqueta: "Tema más mencionado", texto: top?.x ? TEMAS[top.t] : "—",
    pie: top?.x ? `${mil(porMil(top.x, total))} palabras por cada 1.000` : "" });
}

/* ---------- Gobierno × tema (mapa de calor, por cada 1.000 palabras) ----------
   Ignora los filtros de gobierno y tema (los resalta); aplica el de mensaje. */
function matriz(s) {
  const id = "g-matriz";
  const gobs = GOB.filter((g) => palabrasDe([g.i], s.ms) > 0);
  const cuenta = new Map(); // "g|t" -> veces
  for (const f of FILAS) if (f.t >= 0) { const v = veces(f, s.ms); if (v) cuenta.set(`${f.g}|${f.t}`, (cuenta.get(`${f.g}|${f.t}`) ?? 0) + v); }
  const valor = (g, t) => porMil(cuenta.get(`${g}|${t}`) ?? 0, palabrasDe([g], s.ms));
  // temas de más a menos mencionados en todos los gobiernos mostrados
  const totalGobs = palabrasDe(gobs.map((g) => g.i), s.ms);
  // temas agrupados por familia y, dentro de cada una, de más a menos mencionados
  const temas = TEMAS.map((_, t) => ({ t, v: gobs.reduce((a, g) => a + (cuenta.get(`${g.i}|${t}`) ?? 0), 0) / (totalGobs || 1) }))
    .sort((a, b) => TEMA_FAM[a.t] - TEMA_FAM[b.t] || b.v - a.v).map((x) => x.t);
  // tramos por quintiles de los valores no nulos
  const vals = gobs.flatMap((g) => temas.map((t) => valor(g.i, t))).filter((v) => v > 0).sort((a, b) => a - b);
  const corte = (q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
  const cortes = vals.length ? [corte(0.2), corte(0.4), corte(0.6), corte(0.8)] : [];
  const tramo = (v) => cortes.filter((c) => v > c).length;
  document.getElementById("ley-matriz").innerHTML = vals.length
    ? [0, 1, 2, 3, 4].map((i) => `<span><i style="background:${C.matriz[i]}"></i>${i === 0 ? `hasta ${mil(cortes[0])}` : i === 4 ? `más de ${mil(cortes[3])}` : `${mil(cortes[i - 1])} a ${mil(cortes[i])}`}</span>`).join("") +
      "<span>por cada 1.000 palabras</span>" : "";
  leyendaFamilias("fam-matriz", temas.map((t) => TEMA_FAM[t]));
  lecturaMatriz(gobs, temas, valor);
  if (!gobs.length || !vals.length) return Obs.vacio(id);
  const el = document.getElementById(id);
  const angosto = el.parentElement.clientWidth < 700, izq = angosto ? 150 : 190;
  el.style.height = `${temas.length * 32 + 64}px`;
  const g = Obs.grafico(id);
  g.resize();
  const algo = !todos(estado.gobiernos, GOB) || !todos(estado.temas, TEMAS);
  const elegida = (gi, ti) => estado.gobiernos.has(gi) && estado.temas.has(ti);
  const datos = [];
  gobs.forEach((gb, x) => temas.forEach((t, y) => {
    const v = valor(gb.i, t), op = algo && !elegida(gb.i, t) ? 0.22 : 1;
    datos.push({ value: [x, y, v ?? 0], gi: gb.i, ti: t,
      itemStyle: { color: v > 0 ? C.matriz[tramo(v)] : "#f4f6f9", borderColor: "#fff", borderWidth: 2, opacity: op },
      label: { show: v > 0, color: v > 0 && tramo(v) >= 2 ? "#fff" : C.navy, opacity: op } });
  }));
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: false,
    tooltip: { ...Obs.tooltipBase(), formatter: (q) => {
      const d = datos[q.dataIndex], n = cuenta.get(`${d.gi}|${d.ti}`) ?? 0;
      return `<strong>${Obs.escapar(TEMAS[d.ti])}</strong><br>${Obs.escapar(GOB[d.gi].nombre)}<br>` +
        (n ? `<strong>${mil(d.value[2])}</strong> por cada 1.000 palabras<br>${plural(n, "palabra", "palabras")} del tema` : "Ninguna palabra de este tema");
    } },
    grid: { left: izq, right: 8, top: 40, bottom: 6 },
    xAxis: { type: "category", position: "top", data: gobs.map((x) => x.apellido), triggerEvent: true, axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
      axisLabel: txt({ color: C.texto, fontWeight: 700, interval: 0 }) },
    yAxis: { type: "category", inverse: true, data: temas.map((t) => TEMAS[t]), triggerEvent: true, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { ...txt({ color: C.texto }), formatter: (v) => `{f${TEMA_FAM[TEMAS.indexOf(v)]}|} ${v}`,
        rich: Object.fromEntries([...FAMILIAS, {}].map((_, k) => [`f${k}`, { width: 10, height: 10, borderRadius: 2, backgroundColor: colorFam(k) }])) } },
    series: [{ type: "heatmap", data: datos, cursor: "pointer", label: { show: true, formatter: (q) => mil(q.value[2]), fontFamily: C.fuente, fontSize: 14, fontWeight: 700 },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 2 } } }],
  }, true);
  el.setAttribute("aria-label", "Palabras de cada tema por cada 1.000 palabras, por gobierno. La tabla de la pestaña de palabras tiene los mismos datos.");
  g.off("click");
  g.on("click", (q) => {
    g.dispatchAction({ type: "hideTip" });
    if (q.componentType === "xAxis") return alternar("gobiernos", GOB.findIndex((x) => x.apellido === q.value), GOB);
    if (q.componentType === "yAxis") return alternar("temas", TEMAS.indexOf(q.value), TEMAS);
    const d = datos[q.dataIndex];
    const ya = estado.gobiernos.size === 1 && estado.gobiernos.has(d.gi) && estado.temas.size === 1 && estado.temas.has(d.ti);
    actualizar(ya ? { gobiernos: todosLos(GOB), temas: todosLos(TEMAS) } : { gobiernos: new Set([d.gi]), temas: new Set([d.ti]) });
  });
}
function lecturaMatriz(gobs, temas, valor) {
  const celdas = gobs.flatMap((g) => temas.map((t) => ({ g: g.i, t, v: valor(g.i, t) ?? 0 }))).filter((c) => c.v > 0);
  // solo lo elegido, si hay filtros de gobierno o tema
  const sel = celdas.filter((c) => estado.gobiernos.has(c.g) && estado.temas.has(c.t));
  if (!sel.length) return lectura("l-matriz", "");
  const top = sel.reduce((a, b) => (b.v > a.v ? b : a));
  let t = `La combinación más alta es ${destacar(TEMAS[top.t])} con ${destacar(GOB[top.g].nombre)}: ${fuerte(mil(top.v))} palabras por cada 1.000.`;
  // el tema principal de cada gobierno elegido, si son pocos
  const gsel = [...new Set(sel.map((c) => c.g))];
  if (gsel.length > 1 && gsel.length <= 4) {
    t += " " + gsel.map((g) => { const c = sel.filter((x) => x.g === g).reduce((a, b) => (b.v > a.v ? b : a)); return `Con ${destacar(GOB[g].apellido)}, el tema principal fue ${destacar(TEMAS[c.t])}`; }).join("; ") + ".";
  }
  lectura("l-matriz", t);
}

/* ---------- Temas más mencionados (barras) ----------
   Ignora el filtro de tema (lo resalta); un clic elige el tema. */
function temasMencionados(s) {
  const total = palabrasDe(s.gs, s.ms);
  const v = porTema(s.sinTema, s.ms);
  const items = v.map((x, t) => ({ clave: t, etiqueta: TEMAS[t], valor: porMil(x, total), n: x, color: colorFam(TEMA_FAM[t]) })).filter((d) => d.n > 0);
  leyendaFamilias("fam-temas", items.map((d) => TEMA_FAM[d.clave]));
  if (!items.length) lectura("l-temas", "");
  else {
    const orden = [...items].sort((a, b) => b.valor - a.valor), a = orden[0], z = orden.at(-1);
    lectura("l-temas", `${destacar(a.etiqueta)} fue el tema más mencionado: ${fuerte(mil(a.valor))} palabras por cada 1.000` +
      (orden.length > 1 ? `, ${fuerte(num(a.valor / z.valor, 1))} veces más que ${destacar(z.etiqueta)}, el menos mencionado (${fuerte(mil(z.valor))}).` : "."));
  }
  Obs.barras("g-temas", items, {
    formato: (x) => mil(x), nombre: "Por cada 1.000 palabras",
    seleccion: todos(estado.temas, TEMAS) ? null : estado.temas, alClic: (k) => alternar("temas", +k, TEMAS),
  });
}

/* ---------- Tema → palabras (mapa de árbol) ----------
   Tamaño: veces que se usaron las palabras. Primero se ven los temas; un clic
   entra a las palabras del tema (las 25 más usadas; el resto, juntas). */
function arbol(s) {
  const id = "g-arbol";
  const porT = TEMAS.map(() => new Map());
  for (const f of s.todo) if (f.t >= 0) { const v = veces(f, s.ms); if (v) porT[f.t].set(f.w, (porT[f.t].get(f.w) ?? 0) + v); }
  const datos = porT.map((m, t) => {
    const lista = [...m].sort((a, b) => b[1] - a[1]);
    const k = TEMA_FAM[t];
    const estilo = (oscuro) => ({ itemStyle: { color: colorFam(k, oscuro) }, label: { color: tintaFam(k, oscuro) } });
    const hijos = lista.slice(0, 25).map(([w, v], i) => ({ name: w, value: v, ...estilo(i % 2 === 1) }));
    const resto = lista.slice(25);
    if (resto.length) hijos.push({ name: `otras ${resto.length} palabras`, value: resto.reduce((a, [, v]) => a + v, 0), itemStyle: { color: C.otros }, label: { color: C.navy } });
    return { name: TEMAS[t], value: lista.reduce((a, [, v]) => a + v, 0), children: hijos, ...estilo(false), upperLabel: { color: tintaFam(k) } };
  }).filter((d) => d.value > 0);
  leyendaFamilias("fam-arbol", datos.map((d) => TEMA_FAM[TEMAS.indexOf(d.name)]));
  if (!datos.length) { lectura("l-arbol", ""); return Obs.vacio(id); }
  const total = datos.reduce((a, d) => a + d.value, 0);
  const top = datos.reduce((a, b) => (b.value > a.value ? b : a));
  const palabraTop = top.children[0];
  lectura("l-arbol", `En ${destacar(top.name)}, la palabra más usada fue ${destacar(`«${palabraTop.name}»`)}: ${fuerte(plural(palabraTop.value, "vez", "veces"))} ` +
    `(${fuerte(pct(palabraTop.value / top.value))} de las palabras del tema).`);
  const g = Obs.grafico(id);
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), formatter: (q) => {
      const ruta = q.treePathInfo ?? [], tema = ruta[1]?.name;
      const base = ruta.length > 2 ? ruta[1].value : total;
      return `<strong>${Obs.escapar(q.name)}</strong>${ruta.length > 2 ? `<br>Tema: ${Obs.escapar(tema)}` : ""}<br>${plural(q.value, "vez", "veces")}` +
        (ruta.length > 2 ? `<br>${pct(q.value / base)} del tema` : "");
    } },
    series: [{
      type: "treemap", name: "Todos los temas", data: datos, roam: false, nodeClick: "zoomToNode", leafDepth: 1, top: 36, bottom: 8, left: 0, right: 0,
      breadcrumb: { show: true, top: 0, left: 0, height: 28, itemStyle: { color: C.navy, borderColor: C.navy, textStyle: { fontFamily: C.fuente, fontSize: 14 } },
        emphasis: { itemStyle: { color: C.azul } } },
      label: { show: true, fontFamily: C.fuente, fontSize: 14, fontWeight: 700, overflow: "truncate", lineHeight: 19,
        formatter: (q) => `${q.name}\n{n|${num(q.value)}}`, rich: { n: { fontFamily: C.fuente, fontSize: 14, fontWeight: 400 } } },
      upperLabel: { show: true, height: 26, fontFamily: C.fuente, fontSize: 14, fontWeight: 700, backgroundColor: "transparent" },
      itemStyle: { borderColor: "#fff", borderRadius: 4 },
      levels: [
        { upperLabel: { show: false }, itemStyle: { borderWidth: 0, gapWidth: 4 } }, // raíz: solo la ruta de arriba la nombra
        { itemStyle: { borderWidth: 0, gapWidth: 2, borderRadius: 4 } },
        { itemStyle: { borderWidth: 0, borderRadius: 3 } },
      ],
    }],
  }, true);
}

/* =========== Pestaña: ¿Qué palabras usaron? =========== */
// Palabras (sin las vacías) de un conjunto de filas: Map(palabra -> { n[5], total, t })
function agrupar(filas, ms) {
  const m = new Map();
  for (const f of filas) {
    if (f.ruido) continue;
    const x = m.get(f.w) ?? { w: f.w, n: MENSAJES.map(() => 0), total: 0, t: -1 };
    for (const k of ms) { x.n[k] += f.n[k]; x.total += f.n[k]; }
    if (f.t >= 0) x.t = f.t;
    m.set(f.w, x);
  }
  return [...m.values()].filter((x) => x.total > 0);
}

function pintarPalabras(s) {
  const total = palabrasDe(s.gs, s.ms);
  const lista = agrupar(s.todo, s.ms);
  cifrasPalabras(s, lista, total);
  tablaPalabras(s, lista, total);
  masUsadas(lista, total);
  distintivas(s);
}

function cifrasPalabras(s, lista, total) {
  const top = lista.reduce((a, b) => (!a || b.total > a.total ? b : a), null);
  const el = document.getElementById("r-palabras");
  if (!lista.length) el.textContent = "No hay palabras con estos filtros. Quita alguno para ver datos.";
  else el.innerHTML = `${alcance(s)} se usaron ${fuerte(plural(lista.length, "palabra distinta", "palabras distintas"))}, sin contar las palabras vacías. ` +
    `La más usada fue ${destacar(`«${top.w}»`)}: ${fuerte(plural(top.total, "vez", "veces"))}, ${fuerte(mil(porMil(top.total, total)))} por cada 1.000 palabras.`;
  Obs.kpi("k-distintas", { etiqueta: "Palabras distintas", valor: num(lista.length), pie: "Sin palabras vacías ni cifras sueltas" });
  Obs.kpi("k-top", { etiqueta: "Palabra más usada", texto: top ? top.w : "—", pie: top ? `${plural(top.total, "vez", "veces")}; ${mil(porMil(top.total, total))} por cada 1.000 palabras` : "" });
  Obs.kpi("k-dichas", { etiqueta: "Palabras dichas", valor: num(total), pie: "En los mensajes elegidos" });
}

/* ---------- Tabla de palabras con buscador ---------- */
function tablaPalabras(s, lista, total) {
  const b = sinTildes(estado.buscar.trim());
  const halladas = b ? lista.filter((x) => sinTildes(x.w).includes(b)) : lista;
  document.getElementById("h-palabras").textContent = b
    ? `${plural(halladas.length, "palabra coincide", "palabras coinciden")} con «${estado.buscar.trim()}»`
    : `${plural(lista.length, "palabra distinta", "palabras distintas")} en los mensajes elegidos`;
  const cel = (v) => (v ? num(v) : '<span class="sin-dato">0</span>');
  // solo los mensajes que dio algún gobierno elegido (sin columnas en cero)
  const ms = s.ms.filter((m) => palabrasDe(s.gs, [m]) > 0);
  const titulo = (m, i) => (ms.length > 1 && i === ms.length - 1 && s.gs.length === 1 ? `${MENSAJES[m].corto} (último)` : MENSAJES[m].corto);
  contextoTabla(s, ms);
  const columnas = [
    { clave: "w", titulo: "Palabra", valor: (x) => x.w, html: (x) => `<span class="palabra">${Obs.escapar(x.w)}${x.t >= 0 ? `<small><i style="background:${colorFam(familia(x.t))}"></i>${Obs.escapar(TEMAS[x.t])}</small>` : ""}</span>` },
    ...ms.map((m, i) => ({ clave: `m${m}`, titulo: titulo(m, i), num: true, valor: (x) => x.n[m], html: (x) => cel(x.n[m]) })),
    { clave: "total", titulo: "Total", num: true, valor: (x) => x.total, html: (x) => `<strong>${num(x.total)}</strong>` },
    { clave: "mil", titulo: "Por cada 1.000", num: true, valor: (x) => x.total, html: (x) => mil(porMil(x.total, total)) },
  ];
  // si el orden elegido era de un mensaje que ya no está, vuelve al total
  if (ORDEN["t-palabras"] && !columnas.some((c) => c.clave === ORDEN["t-palabras"].clave)) delete ORDEN["t-palabras"];
  tablaOrdenable("t-palabras", columnas, halladas, {
    inicial: { clave: "total", dir: -1 }, desempate: (a, z) => a.w.localeCompare(z.w, "es"), limite: LIMITE_TABLA,
    descripcion: "Palabras de los mensajes elegidos, con las veces que se usaron en cada mensaje, el total y por cada 1.000 palabras",
    vacia: b ? `Ninguna palabra coincide con «${Obs.escapar(estado.buscar.trim())}» con estos filtros.` : null,
  });
  document.getElementById("p-palabras").textContent = halladas.length > LIMITE_TABLA
    ? `Se muestran las ${num(LIMITE_TABLA)} primeras de ${num(halladas.length)} según el orden elegido. Usa el buscador para encontrar cualquier otra.` : "";
}

// Qué mensajes compara la tabla: del primero (asunción) al último de cada gobierno
function contextoTabla(s, ms) {
  const el = document.getElementById("c-palabras");
  if (!ms.length) return (el.innerHTML = "");
  const quienes = (m) => s.gs.filter((g) => TOT[g][m] > 0);
  if (s.gs.length === 1) {
    const g = GOB[s.gs[0]], ult = ms.at(-1);
    el.innerHTML = ms.length === 1
      ? (g.mensajes.filter(Boolean).length === 1
        ? `${destacar(g.nombre)} dio un solo mensaje: el de ${destacar(Obs.minus(MENSAJES[ms[0]].nombre))}.`
        : `Con el filtro de mensaje, la tabla muestra solo el ${destacar(Obs.minus(MENSAJES[ms[0]].nombre))} de ${destacar(g.nombre)}.`)
      : `Las columnas van del primer mensaje de ${destacar(g.nombre)} (${destacar(Obs.minus(MENSAJES[ms[0]].nombre))}) a su último mensaje (${destacar(Obs.minus(MENSAJES[ult].nombre))}).`;
    return;
  }
  el.innerHTML = `Cada columna suma solo los gobiernos elegidos que dieron ese mensaje: ` +
    ms.map((m) => `${MENSAJES[m].corto}, ${fuerte(plural(quienes(m).length, "gobierno", "gobiernos"))}`).join("; ") +
    `. Elige un gobierno en el filtro para ver sus mensajes del primero al último.`;
}

/* ---------- Las 20 palabras más usadas (barras) ----------
   Un clic en una palabra la busca en la tabla. */
function masUsadas(lista, total) {
  const top = [...lista].sort((a, b) => b.total - a.total || a.w.localeCompare(b.w, "es")).slice(0, 20);
  if (top.length > 1) {
    const a = top[0], z = top.at(-1);
    lectura("l-top", `${destacar(`«${a.w}»`)} encabeza la lista con ${fuerte(mil(porMil(a.total, total)))} usos por cada 1.000 palabras; ` +
      `la vigésima, ${destacar(`«${z.w}»`)}, tiene ${fuerte(mil(porMil(z.total, total)))}.`);
  } else lectura("l-top", "");
  Obs.barras("g-top", top.map((x) => ({ clave: x.w, etiqueta: x.w, valor: porMil(x.total, total) })), {
    formato: (v) => mil(v), nombre: "Por cada 1.000 palabras", ordenar: false,
    alClic: (w) => { estado.buscar = w; document.getElementById("f-buscar").value = w; pintarBusqueda(); document.getElementById("t-palabras").scrollIntoView({ behavior: ANIM ? "smooth" : "auto", block: "nearest" }); },
  });
}

/* ---------- Palabras distintivas de un gobierno ----------
   Palabras que el gobierno elegido usó al menos el doble que todos los demás
   gobiernos juntos (por cada 1.000 palabras), de más a menos usadas. Solo palabras que el gobierno usó al menos MIN_DISTINTIVA veces. */
function distintivas(s) {
  const id = "g-distintivas";
  const sel = document.getElementById("f-distintivo");
  const candidatos = GOB.filter((g) => palabrasDe([g.i], s.ms) > 0);
  // por defecto: el gobierno elegido en el filtro (si es uno) o el que más habló
  if (estado.distintivo == null || !candidatos.some((g) => g.i === estado.distintivo)) {
    estado.distintivo = s.gs.length === 1 && candidatos.some((g) => g.i === s.gs[0]) ? s.gs[0]
      : candidatos.reduce((a, b) => (palabrasDe([b.i], s.ms) > palabrasDe([a.i], s.ms) ? b : a), candidatos[0])?.i ?? null;
  }
  sel.innerHTML = candidatos.map((g) => `<option value="${g.i}">${Obs.escapar(g.nombre)}</option>`).join("");
  sel.value = estado.distintivo ?? "";
  if (estado.distintivo == null) { lectura("l-distintivas", ""); return Obs.vacio(id); }
  const foco = estado.distintivo, otros = candidatos.filter((g) => g.i !== foco).map((g) => g.i);
  const Nf = palabrasDe([foco], s.ms), No = palabrasDe(otros, s.ms);
  const enFoco = agrupar(s.sinGobierno.filter((f) => f.g === foco), s.ms);
  const enOtros = new Map(agrupar(s.sinGobierno.filter((f) => f.g !== foco), s.ms).map((x) => [x.w, x.total]));
  const lista = enFoco.filter((x) => x.total >= MIN_DISTINTIVA).map((x) => {
    const o = enOtros.get(x.w) ?? 0, ef = porMil(x.total, Nf), er = porMil(o, No) ?? 0;
    return { w: x.w, t: x.t, n: x.total, o, foco: ef, resto: er, dif: ef - er };
  }).filter((x) => x.foco >= 2 * x.resto).sort((a, b) => b.foco - a.foco || b.dif - a.dif).slice(0, 15);
  document.getElementById("p-distintivas").textContent = No ? "" : "No hay otros gobiernos con mensajes en esta selección para comparar.";
  if (!lista.length || !No) { lectura("l-distintivas", ""); return Obs.vacio(id, "No hay palabras distintivas con estos filtros"); }
  const a = lista[0], solo = lista.filter((x) => x.o === 0);
  lectura("l-distintivas", `${destacar(`«${a.w}»`)} es la palabra distintiva más usada por ${destacar(GOB[foco].nombre)}: la usó ${fuerte(mil(a.foco))} veces por cada 1.000 palabras, ` +
    (a.o ? `frente a ${fuerte(mil(a.resto))} en el resto de gobiernos.` : "y ningún otro gobierno la usó.") +
    (solo.length ? ` ${fuerte(plural(solo.length, "de estas palabras solo aparece", "de estas palabras solo aparecen"))} en sus mensajes.` : ""));
  Obs.barras(id, lista.map((x) => ({ clave: x.w, etiqueta: x.w, valor: x.foco, comp: x.resto })), {
    formato: (v) => mil(v), nombre: GOB[foco].apellido, comparacion: "Resto de gobiernos", ordenar: false,
  });
  // burbuja con el detalle de cada palabra
  Obs.grafico(id).setOption({ tooltip: { formatter: (ps) => {
    const x = lista[ps[0].dataIndex];
    return `<strong>«${Obs.escapar(x.w)}»</strong><br>${Obs.escapar(GOB[foco].nombre)}: <strong>${mil(x.foco)}</strong> por cada 1.000 (${plural(x.n, "vez", "veces")})` +
      `<br>Resto de gobiernos: ${mil(x.resto)} por cada 1.000 (${plural(x.o, "vez", "veces")})`;
  } } });
}

function pintarBusqueda() {
  const s = filtrar(estado);
  tablaPalabras(s, agrupar(s.todo, s.ms), palabrasDe(s.gs, s.ms));
  escribirURL();
}

/* =========== Tabla ordenable ===========
   columnas: [{ clave, titulo, num, valor(fila), html(fila) }]
   Sin alClic, las filas no se pueden elegir. `limite`: cuántas filas se dibujan. */
function tablaOrdenable(id, columnas, filas, { inicial, desempate = () => 0, claveFila, elegidas, alClic, descripcion, pie = "", vacia = null, limite = Infinity }) {
  const el = document.getElementById(id);
  const orden = (ORDEN[id] ??= { ...inicial });
  const col = columnas.find((c) => c.clave === orden.clave);
  const cmp = (a, b) => { const x = col.valor(a), y = col.valor(b);
    if (x == null || y == null) return (x == null) - (y == null) || desempate(a, b);
    const r = typeof x === "string" ? x.localeCompare(y, "es") : x - y; return r * orden.dir || desempate(a, b); };
  const datos = [...filas].sort(cmp).slice(0, limite);
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
  // con un solo gobierno elegido (lo habitual), un clic en otro lo reemplaza en vez de mezclarlos
  const reemplaza = todos(actual, lista) || (campo === "gobiernos" && actual.size === 1 && !actual.has(v));
  let nuevo = reemplaza ? new Set([v]) : new Set(actual);
  if (!reemplaza) nuevo.has(v) ? nuevo.delete(v) : nuevo.add(v);
  if (!nuevo.size) nuevo = todosLos(lista);
  actualizar({ [campo]: nuevo });
}

function pintarAplicados() {
  const chips = [];
  const chip = (texto, accion) => chips.push(`<button type="button" class="chip" data-quitar="${accion}" aria-label="Quitar el filtro ${Obs.escapar(texto)}">${Obs.escapar(texto)}<span aria-hidden="true">×</span></button>`);
  const ordenados = (sel) => [...sel].sort((a, b) => a - b);
  if (!todos(estado.gobiernos, GOB)) ordenados(estado.gobiernos).forEach((i) => chip(GOB[i].nombre, `g:${i}`));
  if (!todos(estado.mensajes, MENSAJES)) ordenados(estado.mensajes).forEach((i) => chip(MENSAJES[i].nombre, `m:${i}`));
  if (!todos(estado.temas, TEMAS)) ordenados(estado.temas).forEach((i) => chip(TEMAS[i], `t:${i}`));
  document.getElementById("aplicados").hidden = !chips.length;
  document.getElementById("aplicados-lista").innerHTML = chips.join("");
}

// Aviso junto a los filtros: qué gobierno se está viendo, o que se están mezclando todos
function pintarAviso() {
  const el = document.getElementById("aviso-gobierno");
  const g = [...estado.gobiernos];
  el.classList.toggle("mezcla", todos(estado.gobiernos, GOB) || g.length > 1);
  el.innerHTML = g.length === 1
    ? `Estás viendo los mensajes de <strong>${Obs.escapar(GOB[g[0]].nombre)}</strong>. Elige otro gobierno en el filtro, o varios para compararlos.`
    : todos(estado.gobiernos, GOB)
      ? `Estás viendo los <strong>${GOB.length} gobiernos juntos</strong>: las cifras suman mensajes de distintos presidentes. Elige uno en el filtro Gobierno para ver solo sus mensajes.`
      : `Estás viendo <strong>${g.length} gobiernos juntos</strong>: las cifras suman sus mensajes. Elige uno solo para ver sus mensajes del primero al último.`;
}

function sincronizarControles() {
  multiGob.sincronizar(estado.gobiernos);
  pintarAviso();
  multiMen.sincronizar(estado.mensajes);
  multiTem.sincronizar(estado.temas);
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  MODULOS.forEach((m) => (document.getElementById(`m-${m}`).hidden = m !== estado.modulo));
  const buscar = document.getElementById("f-buscar");
  if (buscar.value !== estado.buscar) buscar.value = estado.buscar;
}

function actualizar(parche) {
  const cambioPestana = parche.modulo && parche.modulo !== estado.modulo;
  // al cambiar el filtro de gobierno, las palabras distintivas siguen al gobierno elegido
  if (parche.gobiernos) estado.distintivo = parche.gobiernos.size === 1 ? [...parche.gobiernos][0] : estado.distintivo;
  Object.assign(estado, parche);
  render();
  if (cambioPestana) requestAnimationFrame(() => { Obs.redimensionar(); render(); });
}

const CAMPOS = { g: ["gobiernos", () => GOB], m: ["mensajes", () => MENSAJES], t: ["temas", () => TEMAS] };

function montarControles() {
  const filtros = document.getElementById("filtros");
  multiGob = new Obs.Multiseleccion(filtros, {
    id: "f-gobiernos", etiqueta: "Gobierno", todos: "Todos los gobiernos (juntos)",
    opciones: GOB.map((g) => ({ valor: g.i, etiqueta: g.nombre })), alCambiar: (sel) => actualizar({ gobiernos: sel }),
  });
  multiMen = new Obs.Multiseleccion(filtros, {
    id: "f-mensajes", etiqueta: "Mensaje", todos: "Todos los mensajes",
    opciones: MENSAJES.map((m, i) => ({ valor: i, etiqueta: m.nombre })), alCambiar: (sel) => actualizar({ mensajes: sel }),
  });
  multiTem = new Obs.Multiseleccion(filtros, {
    id: "f-temas", etiqueta: "Tema", todos: "Todos los temas",
    opciones: TEMAS.map((t, i) => ({ valor: i, etiqueta: t })), alCambiar: (sel) => actualizar({ temas: sel }),
  });

  filtros.insertAdjacentHTML("beforeend", '<p class="aviso-gobierno" id="aviso-gobierno" aria-live="polite"></p>');

  const pestanas = [...document.querySelectorAll(".modulos button")];
  pestanas.forEach((b, i) => {
    b.onclick = () => actualizar({ modulo: b.dataset.modulo });
    b.onkeydown = (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const sig = pestanas[(i + d + pestanas.length) % pestanas.length];
      sig.focus(); sig.click();
    };
  });

  document.getElementById("aplicados").onclick = (e) => {
    if (e.target.closest("#quitar-todo")) return actualizar({ gobiernos: todosLos(GOB), mensajes: todosLos(MENSAJES), temas: todosLos(TEMAS) });
    const q = e.target.closest("[data-quitar]")?.dataset.quitar;
    if (!q) return;
    const [c, i] = q.split(":");
    const [campo, lista] = CAMPOS[c];
    const nuevo = new Set(estado[campo]); nuevo.delete(+i);
    actualizar({ [campo]: nuevo.size ? nuevo : todosLos(lista()) });
  };

  const buscar = document.getElementById("f-buscar");
  buscar.oninput = () => {
    estado.buscar = buscar.value;
    clearTimeout(buscar.__espera);
    buscar.__espera = setTimeout(pintarBusqueda, 150);
  };
  document.getElementById("f-distintivo").onchange = (e) => { estado.distintivo = +e.target.value; distintivas(filtrar(estado)); escribirURL(); };
}

function leerURL() {
  const q = Obs.parametros();
  const indices = (k, lista) => {
    const v = (q.get(k) || "").split("-").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < lista.length);
    return v.length ? new Set(v) : todosLos(lista);
  };
  if (MODULOS.includes(q.get("modulo"))) estado.modulo = q.get("modulo");
  estado.gobiernos = q.get("gobiernos") === "todos" ? todosLos(GOB) : q.get("gobiernos") ? indices("gobiernos", GOB) : gobiernoDefecto();
  estado.mensajes = indices("mensajes", MENSAJES);
  estado.temas = indices("temas", TEMAS);
  estado.buscar = q.get("buscar") ?? "";
  const d = +q.get("distintivo");
  if (q.get("distintivo") != null && Number.isInteger(d) && d >= 0 && d < GOB.length) estado.distintivo = d;
}

Obs.iniciar(TABLERO, async () => {
  const datos = await Obs.cargarJSON("datos.json");
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...Obs.tema(), matriz: [1, 2, 3, 4, 5].map((i) => v(`--m-${i}`)), familias: [1, 2, 3, 4].map((i) => [v(`--f-${i}`), v(`--f-${i}-osc`)]), otrosTemas: "#6b7686" };
  preparar(datos.tablas);
  const [a, m, d] = String(datos.actualizado || "").split("-").map(Number);
  document.getElementById("actualizado").textContent = a ? new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";

  montarControles();
  leerURL();
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
}, { mapa: false });
