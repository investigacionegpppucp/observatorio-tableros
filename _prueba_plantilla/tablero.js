/* =========================================================
   Plantilla de tablero — Observatorio para la Democracia y
   Gobernabilidad (EGPP-PUCP)

   Para crear un tablero nuevo, copiar esta carpeta a
   publica/<nombre-del-tablero>/ y cambiar lo marcado con CAMBIAR.
   Ver docs/nuevo-tablero.md.

   Patrón: un objeto `estado`, una función pura `filtrar()` y una sola
   función `render()`. Los controles solo modifican `estado`; nunca se
   leen los filtros desde el DOM.

   datos.json (lo genera el script de procesos/<tablero>/):
     regiones: [{ region: "CUSCO", nombre: "Cusco" }, ...]
     anios:    [primero, último]
     dic:      { categoria: ["Categoría A", ...] }
     tablas:   { principal: { anio: [...], region: [...], categoria: [...], n: [...] } }
               (region y categoria son índices de "regiones" y "dic")
   ========================================================= */

const TABLERO = "ejemplo"; // CAMBIAR: nombre de la carpeta (también se usa en el catálogo de descargas)
const UNIDAD = "casos";    // CAMBIAR: qué se cuenta
const ARCHIVOS = [         // CAMBIAR: claves del "Catálogo de bases" en Sheets
  { clave: "ejemplo_base_completa", etiqueta: "Base completa" },
];

const estado = { modulo: "resumen", ambito: "nacional", region: "NACIONAL", desde: null, hasta: null, categorias: new Set() };

let D, FILAS, ANIOS;
const REGION_INDICE = new Map();
let controles, multi, mapa;

const nombreRegion = (cod) => (cod === "NACIONAL" ? "Total nacional" : D.regiones.find((r) => r.region === cod)?.nombre ?? cod);
const enAmbito = (cod) => (cod === "NACIONAL" ? "A nivel nacional" : `En ${nombreRegion(cod)}`);
const periodo = () => (estado.desde === estado.hasta ? `en ${estado.desde}` : `entre ${estado.desde} y ${estado.hasta}`);
const todas = () => estado.categorias.size === D.dic.categoria.length;
// Los gráficos anuales muestran solo los años del período elegido
const aniosPeriodo = () => ANIOS.filter((a) => a >= estado.desde && a <= estado.hasta);
const anual = (filas) => { const m = Obs.sumarPor(filas, "anio"); return aniosPeriodo().map((a) => m.get(a) ?? 0); };

/* Cada gráfico usa el subconjunto que ignora su propio filtro */
function filtrar(filas, e) {
  const enAnios = (f) => f.anio >= e.desde && f.anio <= e.hasta;
  const enCat = (f) => e.categorias.has(f.categoria);
  const i = REGION_INDICE.get(e.region);
  const r = e.region === "NACIONAL" ? () => true : (f) => f.region === i;
  return {
    principal: filas.filter((f) => enAnios(f) && enCat(f) && r(f)),
    todasLasCat: filas.filter((f) => enAnios(f) && r(f)),
    regiones: filas.filter((f) => enAnios(f) && enCat(f)),
  };
}

function render() {
  controles.sincronizar(estado);
  multi.sincronizar(estado.categorias);
  const s = filtrar(FILAS, estado);
  const total = Obs.total(s.principal);

  document.getElementById("r-resumen").innerHTML =
    `${enAmbito(estado.region)} se registraron <strong>${Obs.fmtN(total)} ${UNIDAD}</strong> ${periodo()}.`;
  Obs.kpi("k-1", { etiqueta: "Total", valor: Obs.fmtN(total) });
  Obs.kpi("k-2", { etiqueta: "Promedio por año", valor: Obs.fmtN(total / (estado.hasta - estado.desde + 1)) });
  const [cMax, nMax] = [...Obs.sumarPor(s.principal, "categoria")].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  Obs.kpi("k-3", { etiqueta: `Categoría más frecuente${todas() ? "" : " entre las elegidas"}`, texto: cMax != null ? D.dic.categoria[cMax] : "—", pie: total ? Obs.fmtPct(nMax / total) : "" });

  // Evolución: solo los años del período; el eje se ajusta a ellos
  Obs.lineas("g-evol", aniosPeriodo(), [{ titulo: nombreRegion(estado.region), series: [{ nombre: UNIDAD, color: Obs.tema().unica, valores: anual(s.principal) }] }]);

  // Barras por categoría: ignoran su propio filtro y resaltan lo elegido
  const porR = Obs.sumarPor(s.todasLasCat, "categoria");
  Obs.barras("g-barras", D.dic.categoria.map((etiqueta, c) => ({ clave: c, etiqueta, valor: porR.get(c) ?? 0 })), {
    nombre: nombreRegion(estado.region), seleccion: todas() ? null : estado.categorias, alClic: alternarCategoria,
  });
  document.getElementById("d-barras").textContent = `Número de ${UNIDAD} ${periodo()}.`;

  // Mapa: ignora la región elegida y la resalta
  const porRegion = Obs.sumarPor(s.regiones, (f) => D.regiones[f.region].region);
  const cortes = Obs.cortesCuantiles([...porRegion.values()]);
  mapa.pintar({ valores: porRegion, color: (v) => Obs.colorTramo(v, cortes, Obs.tema().escala), texto: (v) => `${Obs.fmtN(v)} ${UNIDAD}`, elegida: estado.region });
  Obs.leyendaTramos("ley-resumen", cortes, Obs.tema().escala);

  Obs.escribirURL({ region: estado.region === "NACIONAL" ? null : estado.region });
}

function actualizar(parche) {
  Object.assign(estado, parche);
  if (estado.ambito === "nacional") estado.region = "NACIONAL";
  render();
}
const elegirRegion = (cod) => actualizar(cod === estado.region ? { ambito: "nacional" } : { ambito: "regional", region: cod });
function alternarCategoria(c) {
  let nuevo = todas() ? new Set([c]) : new Set(estado.categorias);
  if (!todas()) nuevo.has(c) ? nuevo.delete(c) : nuevo.add(c);
  if (!nuevo.size) nuevo = new Set(D.dic.categoria.map((_, i) => i));
  actualizar({ categorias: nuevo });
}

Obs.iniciar(TABLERO, async () => {
  const [datos, geo] = await Promise.all([Obs.cargarJSON("datos.json"), Obs.cargarGeo()]);
  D = datos;
  FILAS = Obs.expandir(D.tablas.principal);
  ANIOS = Array.from({ length: D.anios[1] - D.anios[0] + 1 }, (_, i) => D.anios[0] + i);
  D.regiones.forEach((r, i) => REGION_INDICE.set(r.region, i));
  Object.assign(estado, { desde: D.anios[0], hasta: D.anios[1], categorias: new Set(D.dic.categoria.map((_, i) => i)) });
  document.getElementById("fuente").textContent = D.fuente;
  document.getElementById("subtitulo").textContent = `${D.anios[0]}-${D.anios[1]}`;

  const p = Obs.parametros();
  const reg = (p.get("region") || "").toUpperCase();
  if (REGION_INDICE.has(reg)) Object.assign(estado, { ambito: "regional", region: reg });

  const filtros = document.getElementById("filtros");
  controles = Obs.controlesComunes(filtros, { regiones: D.regiones, anios: D.anios, alCambiar: actualizar, comparar: false });
  multi = new Obs.Multiseleccion(filtros, {
    id: "f-categorias", etiqueta: "Categorías", todos: "Todas las categorías",
    opciones: D.dic.categoria.map((etiqueta, valor) => ({ valor, etiqueta })),
    alCambiar: (sel) => actualizar({ categorias: sel }),
  });
  mapa = new Obs.Mapa("mapa-resumen", geo, { alClic: elegirRegion, nombre: nombreRegion });
  Obs.descarga({ archivos: ARCHIVOS });
  window.addEventListener("resize", () => { clearTimeout(window.__espera); window.__espera = setTimeout(() => { Obs.redimensionar(); render(); }, 150); });
  render();
});
