/* =========================================================
   comun/descarga.js — ventana "Descargar datos"
   Casillas con las bases del tablero + nombre, correo, institución
   (opcional), perfil y consentimiento (Ley 29733). Envía el pedido
   a Apps Script, que lo registra en la hoja "Registro de descargas"
   y manda los Excel por correo (apps-script/Codigo.gs).
   Uso:
     Obs.descarga({ archivos: [{ clave: "protestas_completa", etiqueta: "Base completa" }, ...] });
   El botón que la abre debe tener id="abrir-descarga".
   ========================================================= */
window.Obs = window.Obs || {};

(() => {
  const Obs = window.Obs;
  const PERFILES = ["Estudiante", "Docente o investigador/a", "Sector público", "Sociedad civil u ONG", "Periodista", "Sector privado", "Otro"];

  Obs.descarga = ({ archivos }) => {
    const abrir = document.getElementById("abrir-descarga");
    if (!abrir) return;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog class="dl" id="dl" aria-labelledby="dl-titulo">
        <form id="dl-form" novalidate>
          <div class="dl-cabeza">
            <h2 id="dl-titulo">Descargar datos</h2>
            <button type="button" class="dl-cerrar" id="dl-cerrar" aria-label="Cerrar">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </div>
          <div class="dl-pasos">
            <fieldset>
              <legend>Bases en Excel</legend>
              ${archivos.map((a) => `<label class="dl-check"><input type="checkbox" name="archivos" value="${a.clave}"> ${Obs.escapar(a.etiqueta)}</label>`).join("")}
              <p class="dl-error" id="dl-error-archivos"></p>
            </fieldset>
          </div>
          <div class="dl-pasos dl-campo">
            <label for="dl-nombre">Nombre y apellido</label>
            <input id="dl-nombre" name="nombre" autocomplete="name" required>
            <p class="dl-error" id="dl-error-nombre"></p>
          </div>
          <div class="dl-pasos dl-campo">
            <label for="dl-correo">Correo electrónico</label>
            <input id="dl-correo" name="correo" type="email" autocomplete="email" inputmode="email" required>
            <p class="dl-error" id="dl-error-correo"></p>
          </div>
          <div class="dl-pasos dl-fila">
            <div class="dl-campo">
              <label for="dl-institucion">Institución <span class="opcional">(opcional)</span></label>
              <input id="dl-institucion" name="institucion" autocomplete="organization">
            </div>
            <div class="dl-campo">
              <label for="dl-perfil">Perfil</label>
              <select id="dl-perfil" name="perfil" required>
                <option value="">Elige</option>${PERFILES.map((p) => `<option>${p}</option>`).join("")}
              </select>
              <p class="dl-error" id="dl-error-perfil"></p>
            </div>
          </div>
          <!-- campo trampa para robots: las personas no lo ven -->
          <input type="text" name="sitio" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
          <div class="dl-pasos">
            <label class="dl-acepto"><input type="checkbox" name="acepto" required>
              Acepto que el Observatorio registre estos datos con fines estadísticos, conforme a la Ley 29733 de Protección de Datos Personales.</label>
            <p class="dl-error" id="dl-error-acepto"></p>
          </div>
          <button class="boton boton-lima dl-enviar dl-pasos" type="submit" id="dl-enviar">Enviar a mi correo</button>
          <div class="dl-listo" id="dl-listo" hidden tabindex="-1" role="status"><p></p></div>
        </form>
      </dialog>`);

    const dl = document.getElementById("dl");
    const form = document.getElementById("dl-form");
    const listo = document.getElementById("dl-listo");
    const elegidos = () => [...form.querySelectorAll('input[name="archivos"]:checked')].map((i) => i.value);
    const pasos = (ver) => form.querySelectorAll(".dl-pasos").forEach((e) => (e.hidden = !ver));

    abrir.onclick = () => { pasos(true); listo.hidden = true; dl.showModal(); };
    document.getElementById("dl-cerrar").onclick = () => dl.close();
    dl.addEventListener("click", (e) => { if (e.target === dl) dl.close(); });
    dl.addEventListener("close", () => abrir.focus());

    function error(id, mensaje) {
      document.getElementById(`dl-error-${id}`).textContent = mensaje;
      const campo = form.elements[id];
      if (campo?.setAttribute) campo.setAttribute("aria-invalid", mensaje ? "true" : "false");
      return !mensaje;
    }
    function validar(enfocar = true) {
      const resultados = [
        ["archivos", error("archivos", elegidos().length ? "" : "Elige al menos una base.")],
        ["nombre", error("nombre", form.nombre.value.trim() ? "" : "Escribe tu nombre y apellido.")],
        ["correo", error("correo", !form.correo.value.trim() ? "Escribe tu correo." : form.correo.validity.valid ? "" : "Revisa el correo: falta la @ o el dominio.")],
        ["perfil", error("perfil", form.perfil.value ? "" : "Elige tu perfil.")],
        ["acepto", error("acepto", form.acepto.checked ? "" : "Marca esta casilla para continuar.")],
      ];
      const primero = resultados.find(([, ok]) => !ok)?.[0];
      if (primero && enfocar) (primero === "archivos" ? form.querySelector('input[name="archivos"]') : form.elements[primero]).focus();
      return !primero;
    }
    // el mensaje de error se va en cuanto se corrige
    form.addEventListener("input", () => { if (form.querySelector(".dl-error:not(:empty)")) validar(false); });

    function terminar(mensaje, conError) {
      pasos(conError);
      listo.hidden = false;
      listo.classList.toggle("con-error", conError);
      listo.querySelector("p").innerHTML = mensaje;
      listo.focus();
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validar()) return;
      if (form.sitio.value) return; // robot
      const url = Obs.config?.registroUrl;
      if (!url) return terminar("El envío por correo aún no está conectado. Vuelve a intentarlo más adelante.", true);
      const boton = document.getElementById("dl-enviar");
      boton.disabled = true;
      boton.textContent = "Enviando…";
      const pedido = {
        tablero: Obs.tablero, archivos: elegidos(),
        nombre: form.nombre.value.trim(), correo: form.correo.value.trim(),
        institucion: form.institucion.value.trim(), perfil: form.perfil.value,
        acepto: true, pagina: document.referrer || location.href,
      };
      try {
        // text/plain evita la consulta previa de CORS, que Apps Script no responde
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(pedido) });
        const res = await r.json();
        if (res.ok) terminar(`<strong>Listo.</strong> Te enviamos ${pedido.archivos.length === 1 ? "el archivo" : "los archivos"} a <strong>${Obs.escapar(pedido.correo)}</strong>. Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.`, false);
        else terminar(Obs.escapar(res.mensaje || "No se pudo procesar el pedido."), true);
      } catch {
        terminar("No se pudo enviar el pedido. Revisa tu conexión y vuelve a intentarlo.", true);
      } finally {
        boton.disabled = false;
        boton.textContent = "Enviar a mi correo";
      }
    });
  };
})();
