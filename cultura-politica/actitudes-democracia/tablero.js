/* =========================================================
   Tablero de Actitudes hacia la democracia — Observatorio para la
   Democracia y Gobernabilidad (EGPP-PUCP)

   Datos: datos.json con la forma que arma el Apps Script desde las
   pestañas «Importancia de la democracia», «Funcionamiento de la
   democracia» y «Opinión sobre la democracia» del Sheet
   «[Tableros] Cultura Política» (o procesos/actitudes-democracia/procesar.py
   desde el Excel). Una fila por año y región, más la fila nacional:
   AÑO, region, Nivel (Nacional o Regional), total y las proporciones *_p.

   Patrón: un objeto `estado`, funciones puras de consulta y una sola
   función `render()`.

   Parámetros de URL:
     ?modulo=funcionamiento&region=CUSCO&anio=2025&mapa=bien_p
     &embed=1   oculta título y pie (para un iframe)
   ========================================================= */

const TABLERO = "actitudes-democracia";
const ARCHIVOS = [
  { clave: "importancia_democracia_base", etiqueta: "Importancia de la democracia por región y año (2013-2025)" },
  { clave: "funcionamiento_democracia_base", etiqueta: "Funcionamiento de la democracia por región y año (2013-2025)" },
  { clave: "opinion_democracia_base", etiqueta: "Opinión sobre la democracia por región y año (2013-2025)" },
];
const NACIONAL = "NACIONAL";
const MODULOS = ["panorama", "importancia", "funcionamiento", "opinion"];
const ANIM = !matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Los tres temas. `positivo` es el indicador principal; las respuestas van de lo negativo a lo positivo */
const TEMAS = {
  importancia: {
    hoja: "Importancia de la democracia", nombre: "Importancia de la democracia", color: "--serie-1",
    positivo: "muy_importante_p", corto: "Considera importante la democracia", columna: "Importante",
    respuestas: [
      { campo: "nada_p", nombre: "Nada importante", css: "--r-neg2" },
      { campo: "poco_p", nombre: "Poco importante", css: "--r-neg1" },
      { campo: "importante_p", nombre: "Importante", css: "--r-pos1" },
      { campo: "muy_p", nombre: "Muy importante", css: "--r-pos2" },
      { campo: "no_sabe_p", nombre: "No sabe", css: "--r-nosabe" },
    ],
    extra: [{ campo: "nada_poco_p", nombre: "Nada o poco importante" }],
    frase: "considera que la democracia es importante o muy importante",
    pregunta: "¿Qué tan importante es la democracia?",
    evol: "Personas que consideran importante la democracia",
  },
  funcionamiento: {
    hoja: "Funcionamiento de la democracia", nombre: "Funcionamiento de la democracia", color: "--serie-3",
    positivo: "sum_bien_p", corto: "Cree que la democracia funciona bien", columna: "Funciona bien",
    respuestas: [
      { campo: "muy_mal_p", nombre: "Muy mal", css: "--r-neg2" },
      { campo: "mal_p", nombre: "Mal", css: "--r-neg1" },
      { campo: "bien_p", nombre: "Bien", css: "--r-pos1" },
      { campo: "muy_bien_p", nombre: "Muy bien", css: "--r-pos2" },
      { campo: "no_sabe_p", nombre: "No sabe", css: "--r-nosabe" },
    ],
    extra: [{ campo: "sum_mal_p", nombre: "Funciona mal o muy mal" }],
    frase: "cree que la democracia funciona bien o muy bien en el Perú",
    pregunta: "¿Cómo funciona la democracia en el Perú?",
    evol: "Personas que creen que la democracia funciona bien",
  },
  opinion: {
    hoja: "Opinión sobre la democracia", nombre: "Preferencias", color: "--serie-4",
    positivo: "demo_p", corto: "Prefiere la democracia", columna: "Prefiere",
    respuestas: [
      { campo: "demo_p", nombre: "Un gobierno democrático es siempre preferible", css: "--r-pos2" },
      { campo: "mismo_p", nombre: "Me da lo mismo que sea democrático o autoritario", css: "--r-mismo" },
      { campo: "auto_p", nombre: "En algunas circunstancias, es preferible un gobierno autoritario que uno democrático", css: "--r-auto" },
      { campo: "no_sabe_p", nombre: "No sabe", css: "--r-nosabe" },
    ],
    extra: [],
    frase: "considera que un gobierno democrático es siempre preferible",
    pregunta: "¿Con qué frase está más de acuerdo?",
    evol: "Personas que prefieren un gobierno democrático",
  },
};
const CLAVES_TEMA = Object.keys(TEMAS);

const estado = { modulo: "panorama", region: NACIONAL, anio: null, mapa: {} };

let ANIOS = [], REGIONES = [], C, mapa;
const NOMBRE_REGION = new Map([[NACIONAL, "Perú"]]);
const INDICE = new Map(); // "tema|región|año" -> fila

const pct = (v) => (v == null ? "—" : Obs.fmtPct(v, 1));
const puntos = (d) => `${Obs.fmtN(Math.abs(d * 100), 1)} p. p.`;
const txt = (x = {}) => ({ color: C.textoSuave, fontFamily: C.fuente, fontSize: 14, ...x });
const fila = (tema, reg, anio) => INDICE.get(`${tema}|${reg}|${anio}`) ?? null;
const valor = (tema, campo, reg, anio) => fila(tema, reg, anio)?.[campo] ?? null;
const enAmbito = (reg) => (reg === NACIONAL ? "en el Perú" : `en ${NOMBRE_REGION.get(reg)}`);
const EnAmbito = (reg) => (reg === NACIONAL ? "En el Perú" : `En ${NOMBRE_REGION.get(reg)}`);
const destacar = (s) => `<strong>${s}</strong>`;
/* Cambio con flecha y color: en los tres indicadores, subir es mejor (verde) y bajar, peor (rojo) */
const sentido = (d) => (Math.abs(d) < 0.0005 ? "igual" : d > 0 ? "sube" : "baja");
const flecha = (d) => ({ sube: "▲", baja: "▼", igual: "■" })[sentido(d)];
const cambio = (d, a0) => `<span class="kpi-cambio ${sentido(d)}"><span aria-hidden="true">${flecha(d)}</span> ` +
  (sentido(d) === "igual" ? `Igual que en ${a0}` : `${puntos(d)} ${d > 0 ? "más" : "menos"} que en ${a0}`) + "</span>";
// Códigos del mapa: mayúsculas y sin tildes, como en publica/mapas/peru_regiones.geojson
const codigo = (nombre) => String(nombre).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const temaActual = () => (estado.modulo === "panorama" ? null : estado.modulo);

/* Escala continua (sin cortes), de un celeste visible (no se confunde con «sin datos») al azul más oscuro */
const escalaContinua = () => ["#c3cdf7", ...C.escala];
/* Mezcla un color con blanco: p = proporción del color original */
const mezclar = (h, p) => `rgb(${hexRGB(h).map((c) => Math.round(255 - (255 - c) * p)).join(",")})`;
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorContinuo(t) {
  const cs = escalaContinua().map(hexRGB);
  const x = Math.max(0, Math.min(1, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${cs[i].map((c, k) => Math.round(c + (cs[i + 1][k] - c) * f)).join(",")})`;
}

/* ---------------------------------------------------------
   Panorama: los tres indicadores juntos
   --------------------------------------------------------- */
function pintarPanorama() {
  const r = estado.region, a = estado.anio, a0 = ANIOS[0];
  const v = Object.fromEntries(CLAVES_TEMA.map((t) => [t, valor(t, TEMAS[t].positivo, r, a)]));
  document.getElementById("r-panorama").innerHTML = `${EnAmbito(r)}, en ${a}, ${destacar(pct(v.importancia))} de las personas de 18 años y más considera importante la democracia, ` +
    `${destacar(pct(v.funcionamiento))} cree que funciona bien o muy bien y ${destacar(pct(v.opinion))} la prefiere a cualquier otra forma de gobierno.`;
  document.getElementById("k-panorama").innerHTML = CLAVES_TEMA.map((t) => {
    const T = TEMAS[t], antes = valor(t, T.positivo, r, a0);
    const d = v[t] != null && antes != null && a !== a0 ? v[t] - antes : null;
    return `<button type="button" class="kpi boton-kpi" data-t="${t}" style="--c:${C.tema[t]}"><span class="kpi-etiqueta">${T.corto}</span><span class="kpi-valor">${pct(v[t])}</span>` +
      `${d == null ? `<span class="kpi-pie">${NOMBRE_REGION.get(r)}, ${a}</span>` : cambio(d, a0)}<span class="ir">Ver detalle</span></button>`;
  }).join("");
  document.querySelectorAll("#k-panorama button").forEach((b) => (b.onclick = () => actualizar({ modulo: b.dataset.t })));

  // Los tres indicadores en el tiempo; con una región, el Perú en línea punteada
  const conRef = r !== NACIONAL;
  document.getElementById("t-tres").textContent = `Evolución de las actitudes hacia la democracia, ${a0}-${ANIOS.at(-1)}`;
  document.getElementById("d-tres").textContent = `Porcentaje de personas de 18 años y más, ${enAmbito(r)}.`;
  document.getElementById("ley-tres").innerHTML = CLAVES_TEMA.map((t) => `<span><i class="l" style="border-color:${C.tema[t]}"></i>${TEMAS[t].corto}</span>`).join("") +
    (conRef ? `<span><i class="l punteada"></i>Perú</span>` : "");
  const serie = (t, reg, ref) => ({
    name: ref ? `${TEMAS[t].corto} (Perú)` : TEMAS[t].corto, type: "line", data: ANIOS.map((x) => valor(t, TEMAS[t].positivo, reg, x)),
    symbol: ref ? "none" : "circle", symbolSize: 7, z: ref ? 1 : 3, lineStyle: { width: ref ? 1.5 : 2.5, type: ref ? "dashed" : "solid", color: C.tema[t] }, itemStyle: { color: C.tema[t] },
    endLabel: ref ? undefined : { show: true, formatter: (p) => pct(p.value), ...txt({ color: C.tema[t], fontWeight: 800 }) },
  });
  const g = Obs.grafico("g-tres");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis",
      formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: 48, right: 64, top: 16, bottom: 30 },
    xAxis: { type: "category", data: ANIOS.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } }, axisLabel: txt() },
    yAxis: { type: "value", min: 0, max: 1, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Math.round(x * 100) + " %" }) },
    series: [
      ...CLAVES_TEMA.map((t) => serie(t, r, false)),
      ...(conRef ? CLAVES_TEMA.map((t) => serie(t, NACIONAL, true)) : []),
      { type: "line", data: [], markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.texto, opacity: 0.25, type: "solid" }, data: [{ xAxis: String(a) }] } },
    ],
  }, true);
  clicAnio(g);

}

/* Panorama: tabla con los tres indicadores por región (al lado del mapa) */
function pintarTablaRegiones() {
  const r = estado.region, a = estado.anio;
  const filas = REGIONES.map((reg) => ({ reg, ...Object.fromEntries(CLAVES_TEMA.map((t) => [t, valor(t, TEMAS[t].positivo, reg, a)])) }));
  const peru = Object.fromEntries(CLAVES_TEMA.map((t) => [t, valor(t, TEMAS[t].positivo, NACIONAL, a)]));
  tablaOrdenable("t-regiones", [
    { clave: "reg", titulo: "Región", valor: (f) => NOMBRE_REGION.get(f.reg), html: (f) => Obs.escapar(NOMBRE_REGION.get(f.reg)) },
    ...CLAVES_TEMA.map((t) => ({ clave: t, titulo: TEMAS[t].columna, num: true, valor: (f) => f[t], html: (f) => pct(f[t]) })),
  ], filas, {
    inicial: { clave: "importancia", dir: -1 }, claveFila: (f) => f.reg, elegida: r === NACIONAL ? null : r, alClic: elegirRegion,
    descripcion: `Actitudes hacia la democracia por región, ${a}`,
    pie: `<tr class="peru"><td>Perú</td>${CLAVES_TEMA.map((t) => `<td class="num c-${t}">${pct(peru[t])}</td>`).join("")}</tr>`,
  });
}

/* ---------------------------------------------------------
   Un tema: importancia, funcionamiento u opinión
   --------------------------------------------------------- */
function pintarTema(t) {
  const T = TEMAS[t], r = estado.region, a = estado.anio, a0 = ANIOS[0];
  const f = fila(t, r, a);
  const v = f?.[T.positivo] ?? null, antes = valor(t, T.positivo, r, a0);
  document.getElementById("m-tema").setAttribute("aria-labelledby", `tab-${t}`);
  document.getElementById("r-tema").innerHTML = f
    ? `${EnAmbito(r)}, en ${a}, ${destacar(pct(v))} de las personas de 18 años y más ${T.frase}` + (antes != null && a !== a0 ? `; en ${a0} era ${pct(antes)}.` : ".")
    : `No hay datos ${enAmbito(r)} en ${a}.`;
  // Cifras: el indicador, el cambio y el lugar entre las regiones
  const regs = REGIONES.map((reg) => ({ reg, v: valor(t, T.positivo, reg, a) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v);
  const d = v != null && antes != null && a !== a0 ? v - antes : null;
  const puesto = regs.findIndex((x) => x.reg === r) + 1;
  const tarjeta = (etiqueta, val, pie) => `<div class="kpi"><span class="kpi-etiqueta">${etiqueta}</span><span class="kpi-valor">${val}</span><span class="kpi-pie">${pie}</span></div>`;
  document.getElementById("k-tema").innerHTML =
    tarjeta(T.corto, pct(v), `${NOMBRE_REGION.get(r)}, ${a}`) +
    tarjeta(`Cambio desde ${a0}`, d == null ? "—" : `<span class="${sentido(d)}"><span class="flecha-kpi" aria-hidden="true">${flecha(d)}</span>${d > 0 ? "+" : d < 0 ? "−" : ""}${Obs.fmtN(Math.abs(d * 100), 1)} p. p.</span>`,
      d == null ? "Es el primer año con datos" : `En ${a0}: ${pct(antes)}`) +
    (r === NACIONAL
      ? tarjeta("La región con el valor más alto", Obs.escapar(NOMBRE_REGION.get(regs[0]?.reg) ?? "—"), regs[0] ? `${pct(regs[0].v)}; la más baja es ${Obs.escapar(NOMBRE_REGION.get(regs.at(-1).reg))} (${pct(regs.at(-1).v)})` : "")
      : tarjeta("Puesto entre las regiones", puesto ? `${puesto}.º de ${regs.length}` : "—", puesto === 1 ? "La más alta del país" : regs[0] ? `La primera es ${Obs.escapar(NOMBRE_REGION.get(regs[0].reg))} (${pct(regs[0].v)})` : ""));
  document.querySelector("#k-tema .kpi:nth-child(3) .kpi-valor")?.classList.toggle("texto", r === NACIONAL);

  // Evolución: el ámbito elegido; con una región, el Perú en gris
  const conRef = r !== NACIONAL;
  document.getElementById("t-evol").textContent = `${T.evol}, ${a0}-${ANIOS.at(-1)}`;
  document.getElementById("d-evol").textContent = `Porcentaje de personas de 18 años y más, ${enAmbito(r)}.`;
  document.getElementById("ley-evol").innerHTML = conRef
    ? `<span><i class="l" style="border-color:${C.tema[t]}"></i>${Obs.escapar(NOMBRE_REGION.get(r))}</span><span><i class="l" style="border-color:${C.gris}"></i>Perú</span>` : "";
  const principal = ANIOS.map((x) => valor(t, T.positivo, r, x)), ref = conRef ? ANIOS.map((x) => valor(t, T.positivo, NACIONAL, x)) : [];
  const tope = Math.min(1, Math.ceil((Math.max(...principal.concat(ref).filter((x) => x != null)) + 0.08) * 10) / 10);
  const k = ANIOS.indexOf(a);
  const g = Obs.grafico("g-evol");
  g.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", formatter: (ps) => `<strong>${ps[0].axisValue}</strong>` + ps.map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: 52, right: 24, top: 30, bottom: 30 },
    xAxis: { type: "category", data: ANIOS.map(String), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linea } },
      axisLabel: txt({ interval: (i) => (ANIOS.length - 1 - i) % (document.getElementById("g-evol").clientWidth < 420 ? 3 : 2) === 0 }) },
    yAxis: { type: "value", min: 0, max: tope, splitLine: { lineStyle: { color: C.linea } }, axisLabel: txt({ formatter: (x) => Math.round(x * 100) + " %" }) },
    series: [
      ...(conRef ? [{ name: "Perú", type: "line", data: ref, symbol: "circle", symbolSize: 6, z: 1, lineStyle: { width: 2, color: C.gris }, itemStyle: { color: C.gris } }] : []),
      { name: NOMBRE_REGION.get(r), type: "line", data: principal, symbol: "circle", symbolSize: 8, z: 3, lineStyle: { width: 2.5, color: C.tema[t] }, itemStyle: { color: C.tema[t], borderColor: "#fff", borderWidth: 2 },
        markPoint: principal[k] != null ? { symbol: "circle", symbolSize: 14, itemStyle: { color: C.tema[t], borderColor: "#fff", borderWidth: 3 },
          label: { show: true, position: "top", distance: 8, formatter: () => pct(principal[k]), ...txt({ color: C.texto, fontWeight: 700 }) },
          data: [{ coord: [String(a), principal[k]] }] } : undefined },
    ],
  }, true);
  clicAnio(g);

  // Respuestas por año (barras apiladas al 100 %)
  document.getElementById("t-resp").textContent = T.pregunta;
  document.getElementById("d-resp").textContent = `Respuestas de las personas de 18 años y más ${enAmbito(r)}, por año.`;
  document.getElementById("ley-resp").innerHTML = T.respuestas.map((x) => `<span><i style="background:${C.resp[x.css]}"></i>${x.nombre}</span>`).join("");
  const filas = [...ANIOS].reverse().map((x) => fila(t, r, x)).filter(Boolean);
  const el = document.getElementById("g-resp");
  el.style.height = `${filas.length * 30 + 40}px`;
  const gr = Obs.grafico("g-resp");
  gr.resize();
  const claro = new Set(["--r-neg1", "--r-pos1", "--r-nosabe", "--r-mismo"]);
  gr.setOption({
    textStyle: { fontFamily: C.fuente }, animation: ANIM,
    tooltip: { ...Obs.tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
      formatter: (ps) => `<strong>${ps[0].name}</strong>` + ps.map((p) => `<br>${p.marker}${p.seriesName}: <strong>${pct(p.value)}</strong>`).join("") },
    grid: { left: 44, right: 24, top: 4, bottom: 30 },
    xAxis: { type: "value", min: 0, max: 1, interval: 0.25, splitLine: { show: false }, axisLabel: txt({ formatter: (x) => Math.round(x * 100) + " %" }) },
    yAxis: { type: "category", inverse: true, data: filas.map((x) => String(x.anio)), axisTick: { show: false }, axisLine: { show: false }, triggerEvent: true,
      axisLabel: { ...txt(), formatter: (x) => (+x === a ? `{b|${x}}` : x), rich: { b: txt({ color: C.texto, fontWeight: 800 }) } } },
    series: T.respuestas.map((x) => ({
      name: x.nombre, type: "bar", stack: "r", barWidth: 18, cursor: "pointer",
      itemStyle: { color: C.resp[x.css], borderColor: "#fff", borderWidth: 1 },
      label: { show: true, formatter: (p) => (p.value >= 0.08 ? Obs.fmtN(p.value * 100, 0) : ""), ...txt({ fontSize: 12, fontWeight: 700, color: claro.has(x.css) ? C.texto : "#fff" }) },
      data: filas.map((y) => y[x.campo]),
    })),
  }, true);
  gr.off("click");
  gr.on("click", (p) => { const anio = +(p.componentType === "yAxis" ? p.value : p.name); if (ANIOS.includes(anio)) actualizar({ anio }); });

  // Lado a lado, el gráfico de evolución crece para que su tarjeta mida lo mismo que la de respuestas
  const gEvol = document.getElementById("g-evol");
  const izq = gEvol.closest(".tarjeta"), der = el.closest(".tarjeta");
  const ladoALado = getComputedStyle(izq.parentElement).gridTemplateColumns.split(" ").length > 1;
  gEvol.style.height = "";
  if (ladoALado) gEvol.style.height = `${Math.max(gEvol.offsetHeight, gEvol.offsetHeight + der.offsetHeight - izq.offsetHeight)}px`;
  g.resize();
}

/* Clic en cualquier punto de la columna de un año */
function clicAnio(g) {
  g.getZr().off("click");
  g.getZr().on("click", (e) => {
    if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const i = Math.round(g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
    if (ANIOS[i] && ANIOS[i] !== estado.anio) actualizar({ anio: ANIOS[i] });
  });
  // El cursor de mano indica que cada año se puede elegir
  g.getZr().off("mousemove");
  g.getZr().on("mousemove", (e) => g.getZr().setCursorStyle(g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]) ? "pointer" : "default"));
}

/* ---------------------------------------------------------
   Mapa coroplético (escala continua) y ranking de regiones
   --------------------------------------------------------- */
function indicadoresMapa() {
  const t = temaActual();
  if (!t) return CLAVES_TEMA.map((x) => ({ id: x, tema: x, campo: TEMAS[x].positivo, nombre: `${TEMAS[x].corto}` }));
  const T = TEMAS[t];
  return [{ id: T.positivo, tema: t, campo: T.positivo, nombre: T.corto }, ...T.extra.map((x) => ({ id: x.campo, tema: t, campo: x.campo, nombre: x.nombre })),
    ...T.respuestas.filter((x) => x.campo !== T.positivo).map((x) => ({ id: x.campo, tema: t, campo: x.campo, nombre: `Responde «${x.nombre}»` }))];
}
function pintarMapa() {
  const lista = indicadoresMapa();
  const ind = lista.find((i) => i.id === estado.mapa[estado.modulo]) ?? lista[0];
  const sel = document.getElementById("f-mapa");
  sel.innerHTML = lista.map((i) => `<option value="${i.id}"${i.id === ind.id ? " selected" : ""}>${Obs.escapar(i.nombre)}</option>`).join("");
  const a = estado.anio;
  document.getElementById("t-mapa").textContent = `${ind.nombre} por región, ${a}`;
  const pano = !temaActual();
  document.getElementById("d-mapa").textContent = pano
    ? `Porcentaje de personas de 18 años y más. El mapa muestra el indicador elegido; la tabla, los tres indicadores.`
    : `Porcentaje de personas de 18 años y más en cada región.`;
  const regs = REGIONES.map((reg) => ({ reg, v: valor(ind.tema, ind.campo, reg, a) })).filter((x) => x.v != null);
  const vs = regs.map((x) => x.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const valores = new Map(regs.map((x) => [x.reg, x.v]));
  document.getElementById("ley-mapa").innerHTML = regs.length
    ? `<div class="ley-continua"><span>${pct(min)}</span><i style="background:linear-gradient(90deg,${escalaContinua().join(",")})"></i><span>${pct(max)}</span></div>` : "";
  const orden = [...regs].sort((x, y) => y.v - x.v);
  const peru = valor(ind.tema, ind.campo, NACIONAL, a);
  document.getElementById("l-mapa").innerHTML = orden.length
    ? `En ${a}, va de ${destacar(pct(min))} en ${Obs.escapar(NOMBRE_REGION.get(orden.at(-1).reg))} a ${destacar(pct(max))} en ${Obs.escapar(NOMBRE_REGION.get(orden[0].reg))}. En el Perú es ${pct(peru)}.` : "";
  document.getElementById("g-regiones").hidden = pano;
  document.getElementById("t-regiones").hidden = !pano;
  // En pantallas angostas, la tabla muestra solo el indicador elegido para el mapa
  document.getElementById("t-regiones").dataset.ind = ind.tema;
  if (pano) pintarTablaRegiones();
  else {
    pintarRanking(orden, peru, ind);
  }
  mapa.pintar({ valores, color: (v) => colorContinuo(max > min ? (v - min) / (max - min) : 1), texto: (v) => pct(v), elegida: estado.region === NACIONAL ? null : estado.region });
}

/* Ranking compacto en HTML: una fila por región, del valor más alto al más bajo,
   con una línea punteada en el valor del Perú. Con una región elegida, las demás van en tono claro */
function pintarRanking(orden, peru, ind) {
  const el = document.getElementById("g-regiones");
  const tope = Math.max(...orden.map((x) => x.v), peru ?? 0) || 1;
  const base = C.tema[ind.tema], claro = mezclar(base, 0.3), hay = estado.region !== NACIONAL;
  const ancho = (v) => `${((v / tope) * 100).toFixed(2)}%`;
  el.style.setProperty("--ref-n", peru != null ? peru / tope : 0);
  el.classList.toggle("sin-ref", peru == null);
  el.innerHTML = (peru != null ? `<p class="ranking-ref"><i></i>Perú: ${pct(peru)}</p>` : "") +
    `<ol aria-label="${Obs.escapar(ind.nombre)} por región, de mayor a menor">` + orden.map((x) => {
      const elegida = x.reg === estado.region;
      return `<li><button type="button" data-k="${x.reg}"${elegida ? ' class="elegida" aria-pressed="true"' : ""}>` +
        `<span class="nombre">${Obs.escapar(NOMBRE_REGION.get(x.reg))}</span>` +
        `<span class="pista-barra"><i style="width:${ancho(x.v)};background:${!hay || elegida ? base : claro}"></i></span>` +
        `<span class="valor">${pct(x.v)}</span></button></li>`;
    }).join("") + "</ol>";
  el.querySelector("ol").onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) elegirRegion(b.dataset.k); };
}

/* ---------------------------------------------------------
   Tabla ordenable
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
  el.innerHTML = `<table class="tabla ordenable"><caption class="solo-lectores">${Obs.escapar(descripcion)}. Los títulos de columna ordenan la tabla.</caption><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ""}</table>`;
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

/* ---------------------------------------------------------
   Estado y render
   --------------------------------------------------------- */
const $ = (s) => document.querySelector(s);
function render() {
  $("#f-region").value = estado.region;
  $("#f-anio").value = estado.anio;
  document.querySelectorAll(".modulos button").forEach((b) => {
    const activo = b.dataset.modulo === estado.modulo;
    b.setAttribute("aria-selected", activo);
    b.tabIndex = activo ? 0 : -1;
  });
  $("#m-panorama").hidden = estado.modulo !== "panorama";
  $("#m-tema").hidden = estado.modulo === "panorama";
  if (estado.modulo === "panorama") pintarPanorama(); else pintarTema(estado.modulo);
  pintarMapa();
  Obs.escribirURL({
    modulo: estado.modulo === "panorama" ? null : estado.modulo,
    region: estado.region === NACIONAL ? null : estado.region,
    anio: estado.anio === ANIOS.at(-1) ? null : estado.anio,
    mapa: estado.mapa[estado.modulo] ?? null,
  });
}
function actualizar(parche) { Object.assign(estado, parche); render(); }
const elegirRegion = (cod) => actualizar({ region: cod === estado.region || cod === NACIONAL ? NACIONAL : cod });

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo("../../mapas/peru_regiones.geojson")]);
  const t = Obs.tema();
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  C = { ...t, gris: "#9aa3b0", tema: Object.fromEntries(CLAVES_TEMA.map((x) => [x, v(TEMAS[x].color)])),
    resp: Object.fromEntries(["--r-neg2", "--r-neg1", "--r-pos1", "--r-pos2", "--r-nosabe", "--r-auto", "--r-mismo"].map((n) => [n, v(n)])) };

  const nombreBonito = (n) => (n === "San Martin" ? "San Martín" : n);
  for (const tema of CLAVES_TEMA) {
    const tabla = datos.tablas[TEMAS[tema].hoja];
    if (!tabla) continue;
    for (const f of Obs.expandir(tabla)) {
      const nac = f.Nivel === "Nacional" || f.region === "Nacional";
      const nombre = nombreBonito(String(f.region).trim());
      const cod = nac ? NACIONAL : codigo(nombre);
      if (!nac) NOMBRE_REGION.set(cod, nombre);
      INDICE.set(`${tema}|${cod}|${+f["AÑO"]}`, { ...f, anio: +f["AÑO"] });
    }
  }
  ANIOS = [...new Set([...INDICE.values()].map((f) => f.anio))].sort((a, b) => a - b);
  REGIONES = [...NOMBRE_REGION.keys()].filter((r) => r !== NACIONAL).sort((a, b) => NOMBRE_REGION.get(a).localeCompare(NOMBRE_REGION.get(b), "es"));
  estado.anio = ANIOS.at(-1);

  const [aa, mm, dd] = String(datos.actualizado || "").split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  $("#actualizado").textContent = aa ? `${dd} de ${MESES[mm - 1]} de ${aa}` : "—";

  const opcion = (val, e) => `<option value="${Obs.escapar(val)}">${Obs.escapar(e)}</option>`;
  $("#f-region").innerHTML = opcion(NACIONAL, "Perú (nacional)") + REGIONES.map((r) => opcion(r, NOMBRE_REGION.get(r))).join("");
  $("#f-anio").innerHTML = [...ANIOS].reverse().map((a) => opcion(a, a)).join("");
  $("#f-region").onchange = (e) => actualizar({ region: e.target.value });
  $("#f-anio").onchange = (e) => actualizar({ anio: +e.target.value });
  $("#f-mapa").onchange = (e) => { estado.mapa[estado.modulo] = e.target.value; render(); };

  // Estado inicial desde la URL
  const p = Obs.parametros();
  if (MODULOS.includes(p.get("modulo"))) estado.modulo = p.get("modulo");
  const reg = codigo(p.get("region") || "");
  if (NOMBRE_REGION.has(reg)) estado.region = reg;
  if (ANIOS.includes(+p.get("anio"))) estado.anio = +p.get("anio");
  if (p.get("mapa")) estado.mapa[estado.modulo] = p.get("mapa");

  // Pestañas: clic y flechas
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

  mapa = new Obs.Mapa("mapa-regiones", geo, { alClic: elegirRegion, nombre: (r) => NOMBRE_REGION.get(r) ?? r });
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
