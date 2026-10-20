/* =========================================================
   comun/filtros.js — controles de filtro compartidos
   Patrón único: el tablero guarda todo en un objeto `estado`; los
   controles solo avisan cambios (alCambiar) y se redibujan desde el
   estado (sincronizar). Nunca se lee el estado desde el DOM.
   ========================================================= */
window.Obs = window.Obs || {};

(() => {
  const Obs = window.Obs;
  const opcion = (valor, etiqueta) => `<option value="${Obs.escapar(valor)}">${Obs.escapar(etiqueta)}</option>`;

  /* ---------- Ámbito, región, comparación y período ----------
     regiones: [{ region, nombre }]; anios: [min, max]
     alCambiar(parche): parche es un objeto con las claves de estado que cambian */
  Obs.controlesComunes = (cont, { regiones, anios, alCambiar, comparar = true, periodo = true }) => {
    const ordenadas = [...regiones].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const listaAnios = Array.from({ length: anios[1] - anios[0] + 1 }, (_, i) => anios[0] + i);
    cont.insertAdjacentHTML("beforeend", `
      <div class="filtro">
        <span class="etiqueta" id="lbl-ambito">Ámbito</span>
        <div class="segmentado" role="group" aria-labelledby="lbl-ambito">
          <button type="button" data-ambito="nacional">Nacional</button>
          <button type="button" data-ambito="regional">Regional</button>
        </div>
      </div>
      <div class="filtro" data-control="region">
        <label for="f-region">Región</label>
        <select id="f-region"><option value="" disabled>Elige una región</option>${ordenadas.map((r) => opcion(r.region, r.nombre)).join("")}</select>
      </div>
      ${comparar ? `<div class="filtro">
        <label for="f-comparar">Comparar con</label>
        <select id="f-comparar">${opcion("", "Sin comparación")}${opcion("NACIONAL", "Total nacional")}${ordenadas.map((r) => opcion(r.region, r.nombre)).join("")}</select>
      </div>` : ""}
      ${periodo ? `<div class="filtro">
        <span class="etiqueta" id="lbl-periodo">Período</span>
        <div class="rango" role="group" aria-labelledby="lbl-periodo">
          <select id="f-desde" class="corto" aria-label="Desde">${listaAnios.map((a) => opcion(a, a)).join("")}</select>
          <span>a</span>
          <select id="f-hasta" class="corto" aria-label="Hasta">${listaAnios.map((a) => opcion(a, a)).join("")}</select>
        </div>
      </div>` : ""}`);

    const $ = (s) => cont.querySelector(s);
    cont.querySelectorAll("[data-ambito]").forEach((b) => (b.onclick = () => {
      if (b.dataset.ambito === "nacional") alCambiar({ ambito: "nacional", region: "NACIONAL" });
      else { alCambiar({ ambito: "regional" }); $("#f-region").focus(); }
    }));
    $("#f-region").onchange = (e) => alCambiar({ ambito: "regional", region: e.target.value });
    if (comparar) $("#f-comparar").onchange = (e) => alCambiar({ comparar: e.target.value });
    if (periodo) {
      // si "desde" queda después de "hasta", se corre el otro extremo
      $("#f-desde").onchange = (e) => { const d = +e.target.value; alCambiar({ desde: d, hasta: Math.max(d, +$("#f-hasta").value) }); };
      $("#f-hasta").onchange = (e) => { const h = +e.target.value; alCambiar({ hasta: h, desde: Math.min(h, +$("#f-desde").value) }); };
    }

    return {
      sincronizar(estado) {
        cont.querySelectorAll("[data-ambito]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.ambito === estado.ambito));
        cont.querySelector('[data-control="region"]').hidden = estado.ambito !== "regional";
        $("#f-region").value = estado.region === "NACIONAL" ? "" : estado.region;
        if (comparar) {
          // la región elegida no aparece como opción de comparación
          for (const o of $("#f-comparar").options) o.hidden = o.value !== "" && o.value === estado.region;
          $("#f-comparar").value = estado.comparar;
        }
        if (periodo) { $("#f-desde").value = estado.desde; $("#f-hasta").value = estado.hasta; }
      },
    };
  };

  /* ---------- Selección múltiple ----------
     Marcar todos / Desmarcar todos. Si se cierra vacía, vuelve a "todos".
     opciones: [{ valor, etiqueta }] (valor numérico o texto) */
  Obs.Multiseleccion = class {
    constructor(cont, { id, etiqueta, todos, ninguno = "Elige una o más opciones", opciones, alCambiar }) {
      this.opciones = opciones;
      this.todos = todos;
      this.ninguno = ninguno;
      this.alCambiar = alCambiar;
      this.vacio = false;
      cont.insertAdjacentHTML("beforeend", `
        <div class="filtro" id="${id}">
          <span class="etiqueta" id="${id}-lbl">${etiqueta}</span>
          <details class="desplegable">
            <summary aria-labelledby="${id}-lbl ${id}-res"><span id="${id}-res"></span></summary>
            <div class="desplegable-panel">
              <p class="ayuda-panel">Marca una o más opciones. El tablero se actualiza al instante.</p>
              <div class="desplegable-acciones">
                <button type="button" data-accion="todos">Marcar todos</button>
                <button type="button" data-accion="ninguno">Desmarcar todos</button>
              </div>
              <div class="lista-checks">${opciones.map((o, i) =>
                `<label><input type="checkbox" data-i="${i}"> ${Obs.escapar(o.etiqueta)}</label>`).join("")}</div>
            </div>
          </details>
          <span class="nota-filtro" hidden>No se aplica en este módulo</span>
        </div>`);
      this.el = cont.querySelector(`#${id}`);
      this.det = this.el.querySelector("details");
      this.el.querySelector(".lista-checks").onchange = (e) => {
        const actual = this.vacio ? new Set() : new Set(this.seleccion);
        const v = opciones[+e.target.dataset.i].valor;
        e.target.checked ? actual.add(v) : actual.delete(v);
        this.vacio = actual.size === 0;
        if (this.vacio) this.mostrarVacio(); else alCambiar(actual);
      };
      this.el.querySelector(".desplegable-acciones").onclick = (e) => {
        if (e.target.dataset.accion === "todos") { this.vacio = false; alCambiar(this.todosLosValores()); }
        else if (e.target.dataset.accion === "ninguno") { this.vacio = true; this.mostrarVacio(); }
      };
      this.det.addEventListener("toggle", () => {
        if (!this.det.open && this.vacio) { this.vacio = false; alCambiar(this.todosLosValores()); }
      });
      document.addEventListener("click", (e) => { if (this.det.open && !this.det.contains(e.target)) this.det.open = false; });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.det.open) { this.det.open = false; this.det.querySelector("summary").focus(); }
      });
    }

    todosLosValores() { return new Set(this.opciones.map((o) => o.valor)); }

    mostrarVacio() {
      this.el.querySelectorAll("input").forEach((i) => (i.checked = false));
      this.el.querySelector(`[id$="-res"]`).textContent = this.ninguno;
    }

    // seleccion: Set de valores; noAplica: el filtro se ve apagado con su nota
    sincronizar(seleccion, { noAplica = false, visible = true } = {}) {
      this.seleccion = seleccion;
      this.el.hidden = !visible;
      this.el.classList.toggle("no-aplica", noAplica);
      this.el.querySelector(".nota-filtro").hidden = !noAplica;
      if (noAplica) this.det.open = false;
      if (this.vacio) return;
      this.el.querySelectorAll("input").forEach((i) => (i.checked = seleccion.has(this.opciones[+i.dataset.i].valor)));
      const elegidas = this.opciones.filter((o) => seleccion.has(o.valor));
      this.el.querySelector(`[id$="-res"]`).textContent =
        elegidas.length === this.opciones.length ? this.todos
          : elegidas.length === 1 ? elegidas[0].etiqueta
            : `${elegidas.length} de ${this.opciones.length} elegidas`;
    }
  };
})();
