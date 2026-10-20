/* =========================================================
   comun/graficos.js — gráficos compartidos (ECharts 5.6)
   Colores y fuente salen de tema.css; aquí solo hay forma.
   Reglas: texto mínimo de 14 px, una sola escala por eje, colores
   categóricos en orden fijo (el color sigue a la categoría, no a
   su posición) y etiquetas directas solo donde ayudan.
   ========================================================= */
window.Obs = window.Obs || {};

(() => {
  const Obs = window.Obs;
  const graficos = {};

  /* ---------- Tema: lee las variables de tema.css ---------- */
  Obs.tema = () => {
    if (Obs._tema) return Obs._tema;
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    Obs._tema = {
      navy: v("--navy"), azul: v("--azul"), lima: v("--lima"), rojo: v("--rojo"),
      linea: v("--linea"), texto: v("--texto"), textoSuave: v("--texto-suave"), fondo: v("--fondo"),
      unica: v("--serie-unica"), otros: v("--serie-otros"),
      categorias: [1, 2, 3, 4, 5].map((i) => v(`--serie-${i}`)),
      escala: [1, 2, 3, 4, 5].map((i) => v(`--escala-${i}`)),
      fuente: v("--fuente"),
    };
    return Obs._tema;
  };

  // Asigna a cada categoría un color fijo según su orden en el diccionario,
  // así el color no cambia cuando un filtro quita o agrega series.
  Obs.colorCategoria = (indice) => {
    const t = Obs.tema();
    return indice < t.categorias.length ? t.categorias[indice] : t.otros;
  };

  Obs.grafico = (id) => {
    if (!graficos[id]) {
      const el = document.getElementById(id);
      graficos[id] = echarts.init(el, null, { renderer: "svg" });
      // nombre accesible: el título de la tarjeta (los datos también están en tooltips y tablas)
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", el.closest(".tarjeta")?.querySelector("h3")?.textContent ?? "Gráfico");
    }
    return graficos[id];
  };
  Obs.redimensionar = () => Object.values(graficos).forEach((g) => g.resize());

  const tooltipBase = () => ({
    confine: true,
    backgroundColor: Obs.tema().navy,
    borderWidth: 0,
    padding: [8, 12],
    textStyle: { color: "#fff", fontFamily: Obs.tema().fuente, fontSize: 14 },
    extraCssText: "border-radius:2px;box-shadow:0 2px 8px rgba(4,35,85,.2);",
  });
  Obs.tooltipBase = tooltipBase;
  const texto = (extra = {}) => ({ fontFamily: Obs.tema().fuente, fontSize: 14, color: Obs.tema().texto, ...extra });

  Obs.vacio = (id, mensaje = "Sin datos para esta selección") => {
    const t = Obs.tema();
    Obs.grafico(id).setOption({
      graphic: { type: "text", left: "center", top: "middle", style: { text: mensaje, fill: t.textoSuave, font: `600 15px ${t.fuente}` } },
      series: [], xAxis: [], yAxis: [], grid: [],
    }, true);
  };

  /* ---------- Barras horizontales ----------
     items: [{ clave, etiqueta, valor, comp }]
     opciones:
       formato     función para mostrar el valor (por defecto, entero)
       nombre      nombre de la serie principal (región elegida) para el tooltip
       comparacion nombre de la región de comparación; si existe, se dibuja su marca
       seleccion   Set de claves resaltadas; las demás se atenúan
       alClic      función(clave) al hacer clic en una barra
       color       color de las barras
       limite      número máximo de filas (el resto se omite) */
  Obs.barras = (id, items, opciones = {}) => {
    const t = Obs.tema();
    const { formato = (v) => Obs.fmtN(v), nombre = "", comparacion = null, seleccion = null, alClic = null, color = t.unica, limite = null, ordenar = true } = opciones;
    let datos = items.filter((d) => d.valor != null && (d.valor > 0 || d.comp > 0));
    if (ordenar) datos.sort((a, b) => b.valor - a.valor);
    if (limite) datos = datos.slice(0, limite);
    if (!datos.length) return Obs.vacio(id);

    const el = document.getElementById(id);
    const angosto = el.clientWidth < 480;
    el.style.height = `${Math.max(160, datos.length * (angosto ? 44 : 34) + 16)}px`;
    const g = Obs.grafico(id);
    g.resize();
    const ancho = Math.min(230, Math.round(el.clientWidth * (angosto ? 0.44 : 0.38)));
    const tope = Math.max(...datos.flatMap((d) => [d.valor, d.comp ?? 0])) * 1.18;
    g.__claves = datos.map((d) => d.clave);

    g.setOption({
      textStyle: { fontFamily: t.fuente },
      animationDurationUpdate: 400,
      tooltip: {
        ...tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
        formatter: (ps) => {
          const d = datos[ps[0].dataIndex];
          return `<strong>${Obs.escapar(d.etiqueta)}</strong><br>${nombre ? nombre + ": " : ""}<strong>${formato(d.valor)}</strong>` +
            (comparacion && d.comp != null ? `<br>${comparacion}: ${formato(d.comp)}` : "");
        },
      },
      grid: { left: ancho, right: 70, top: 4, bottom: 4 },
      xAxis: { type: "value", max: tope, show: false },
      yAxis: {
        type: "category", data: datos.map((d) => d.etiqueta), inverse: true,
        axisTick: { show: false }, axisLine: { lineStyle: { color: t.linea } },
        axisLabel: { ...texto(), width: ancho - 10, overflow: "break", lineHeight: 18 },
      },
      series: [
        {
          type: "bar", barMaxWidth: 18, barCategoryGap: "36%", cursor: alClic ? "pointer" : "default",
          data: datos.map((d) => ({
            value: d.valor,
            itemStyle: { color, borderRadius: [0, 2, 2, 0], opacity: seleccion && !seleccion.has(d.clave) ? 0.25 : 1 },
          })),
          label: { show: true, position: "right", distance: 8, formatter: (p) => formato(p.value), ...texto({ fontWeight: 700 }) },
        },
        {
          // marca vertical de la región de comparación
          type: "scatter", symbol: "rect", symbolSize: [3, 22], z: 5, silent: true,
          itemStyle: { color: t.navy },
          data: datos.map((d) => (comparacion ? d.comp ?? null : null)),
        },
      ],
    }, true);
    g.off("click");
    if (alClic) g.on("click", (p) => p.componentSubType === "bar" && alClic(g.__claves[p.dataIndex]));
  };

  /* ---------- Columnas por año ----------
     Recibe solo los años del período elegido: el eje se ajusta a ellos. */
  Obs.columnas = (id, anios, valores, opciones = {}) => {
    const t = Obs.tema();
    const { formato = (v) => Obs.fmtN(v), nombre = "", alClic = null } = opciones;
    if (!valores.some((v) => v > 0)) return Obs.vacio(id);
    const maximo = Math.max(...valores);
    const g = Obs.grafico(id);
    g.setOption({
      textStyle: { fontFamily: t.fuente },
      tooltip: { ...tooltipBase(), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(4,35,85,.05)" } },
        formatter: (ps) => `<strong>${ps[0].name}</strong><br>${nombre ? nombre + ": " : ""}<strong>${formato(ps[0].value)}</strong>` },
      grid: { left: 52, right: 12, top: 28, bottom: 30 },
      xAxis: { type: "category", data: anios, axisTick: { show: false }, axisLine: { lineStyle: { color: t.linea } }, axisLabel: texto({ color: t.textoSuave }) },
      yAxis: { type: "value", splitLine: { lineStyle: { color: t.linea } }, axisLabel: { ...texto({ color: t.textoSuave }), formatter: (v) => Obs.fmtN(v) } },
      series: [{
        type: "bar", barCategoryGap: "22%", cursor: alClic ? "pointer" : "default",
        data: anios.map((a, i) => ({
          value: valores[i],
          itemStyle: { color: t.unica, borderRadius: [2, 2, 0, 0] },
          // con pocos años se rotulan todas las columnas; con muchos, solo el máximo
          label: { show: anios.length <= 12 || valores[i] === maximo, position: "top", formatter: (p) => formato(p.value), ...texto({ fontWeight: 700 }) },
        })),
      }],
    }, true);
    g.off("click");
    if (alClic) g.on("click", (p) => alClic(anios[p.dataIndex]));
  };

  /* ---------- Líneas por año ----------
     paneles: [{ titulo, series: [{ nombre, valores, color }] }]
     Con más de un panel (p. ej., región y comparación) se dibujan en
     pequeños múltiplos, cada uno con su propia escala: nunca dos
     escalas en un mismo eje. */
  Obs.lineas = (id, anios, paneles, opciones = {}) => {
    const t = Obs.tema();
    const { formato = (v) => Obs.fmtN(v), altoPanel = 300 } = opciones;
    const conDatos = paneles.filter((p) => p.series.some((s) => s.valores.some((v) => v > 0)));
    if (!conDatos.length) return Obs.vacio(id);
    const el = document.getElementById(id);
    const titulo = conDatos.length > 1 ? 30 : 0;
    const nombres = [...new Set(conDatos.flatMap((p) => p.series.map((s) => s.nombre)))];
    const leyenda = nombres.length > 1 ? Math.ceil(nombres.length / (el.clientWidth < 600 ? 2 : 4)) * 24 + 8 : 0;
    el.style.height = `${leyenda + conDatos.length * (altoPanel + titulo) + 10}px`;
    const g = Obs.grafico(id);
    g.resize();
    const etiquetasDirectas = nombres.length <= 4 && el.clientWidth >= 600;
    const derecha = etiquetasDirectas && nombres.length > 1 ? 150 : 16;

    const grid = [], xAxis = [], yAxis = [], series = [], graphic = [];
    conDatos.forEach((panel, k) => {
      const top = leyenda + k * (altoPanel + titulo) + titulo + 10;
      grid.push({ left: 56, right: derecha, top, height: altoPanel - 40 });
      xAxis.push({
        gridIndex: k, type: "category", data: anios, boundaryGap: anios.length === 1,
        axisTick: { show: false }, axisLine: { lineStyle: { color: t.linea } }, axisLabel: texto({ color: t.textoSuave }),
      });
      yAxis.push({ gridIndex: k, type: "value", splitLine: { lineStyle: { color: t.linea } }, axisLabel: { ...texto({ color: t.textoSuave }), formatter: (v) => Obs.fmtN(v) } });
      if (titulo) graphic.push({ type: "text", left: 0, top: top - titulo, style: { text: panel.titulo, fill: t.navy, font: `700 15px ${t.fuente}` } });
      panel.series.forEach((s) => {
        series.push({
          name: s.nombre, type: "line", xAxisIndex: k, yAxisIndex: k, data: s.valores,
          // un punto en cada año
          symbol: "circle", symbolSize: 7, showSymbol: true, lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color },
          emphasis: { focus: "series" },
          endLabel: etiquetasDirectas && nombres.length > 1 ? { show: true, formatter: s.nombre, ...texto({ color: t.texto, width: derecha - 14, overflow: "truncate" }) } : undefined,
        });
      });
    });
    g.setOption({
      textStyle: { fontFamily: t.fuente },
      animationDurationUpdate: 400,
      legend: nombres.length > 1 ? { top: 0, left: 0, data: nombres, icon: "rect", itemWidth: 14, itemHeight: 4, itemGap: 16, textStyle: texto({ color: t.textoSuave }) } : undefined,
      tooltip: {
        ...tooltipBase(), trigger: "axis",
        formatter: (ps) => `<strong>${ps[0].name}</strong>` + ps
          .filter((p) => p.value != null).sort((a, b) => b.value - a.value)
          .map((p) => `<br>${p.marker}${Obs.escapar(p.seriesName)}: <strong>${formato(p.value)}</strong>`).join(""),
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid, xAxis, yAxis, series, graphic,
    }, true);
  };

  /* ---------- Cifra clave ---------- */
  Obs.kpi = (id, { etiqueta, valor, texto: textoValor, pie = "" }) => {
    document.getElementById(id).innerHTML =
      `<span class="kpi-etiqueta">${etiqueta}</span>
       <span class="kpi-valor ${textoValor ? "texto" : ""}">${textoValor ? Obs.escapar(textoValor) : valor}</span>
       <span class="kpi-pie">${pie}</span>`;
  };

  /* ---------- Tabla con totales ----------
     columnas: [{ titulo, campo, num }]; filas: objetos */
  Obs.tabla = (id, columnas, filas, { total = null, alClic = null, elegida = null } = {}) => {
    const el = document.getElementById(id);
    const th = columnas.map((c) => `<th class="${c.num ? "num" : ""}">${c.titulo}</th>`).join("");
    const td = (f) => columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.num ? Obs.fmtN(f[c.campo]) : Obs.escapar(f[c.campo])}</td>`).join("");
    const cuerpo = filas.map((f) => `<tr${f.region ? ` data-region="${f.region}"` : ""}${f.region && f.region === elegida ? ' class="elegida"' : ""}>${td(f)}</tr>`).join("");
    const pie = total ? `<tfoot><tr>${columnas.map((c, i) => `<td class="${c.num ? "num" : ""}">${i === 0 ? "Total" : c.num ? Obs.fmtN(total[c.campo]) : ""}</td>`).join("")}</tr></tfoot>` : "";
    el.innerHTML = `<table class="tabla"><thead><tr>${th}</tr></thead><tbody>${cuerpo}</tbody>${pie}</table>`;
    if (alClic) el.querySelector("tbody").onclick = (e) => {
      const tr = e.target.closest("tr[data-region]");
      if (tr) alClic(tr.dataset.region);
    };
  };
})();
