/* =========================================================
   comun/base.js — utilidades compartidas por todos los tableros
   Carga de datos, formato peruano, parámetros de URL, modo
   incrustado (?embed=1) y aviso de altura al sitio que contiene
   el iframe.
   ========================================================= */
window.Obs = window.Obs || {};

(() => {
  const Obs = window.Obs;

  /* ---------- Formato peruano ---------- */
  Obs.fmtN = (n, dec = 0) =>
    n == null || Number.isNaN(n) ? "—"
      : n.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  // 0.123 -> "12,3 %" (con espacio duro antes de «%»)
  Obs.fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? "—" : Obs.fmtN(v * 100, dec) + " %");
  Obs.minus = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  Obs.escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ---------- Datos ----------
     datos.json guarda cada tabla en columnas: { anio: [...], region: [...], n: [...] }.
     expandir() la convierte en filas: [{ anio, region, n }, ...]. */
  Obs.cargarJSON = async (url) => {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`no se pudo leer ${url} (${r.status})`);
    return r.json();
  };
  Obs.expandir = (tabla) => {
    const cols = Object.keys(tabla);
    const n = tabla[cols[0]].length;
    const filas = new Array(n);
    for (let i = 0; i < n; i++) {
      const f = {};
      for (const c of cols) f[c] = tabla[c][i];
      filas[i] = f;
    }
    return filas;
  };
  // Suma de un campo agrupando por una clave: Map(clave -> suma)
  Obs.sumarPor = (filas, clave, campo = "n") => {
    const m = new Map();
    for (const f of filas) {
      const k = typeof clave === "function" ? clave(f) : f[clave];
      m.set(k, (m.get(k) ?? 0) + f[campo]);
    }
    return m;
  };
  Obs.total = (filas, campo = "n") => filas.reduce((s, f) => s + f[campo], 0);

  /* ---------- Parámetros de URL ---------- */
  Obs.parametros = () => new URLSearchParams(location.search);
  // Refleja el estado en la URL (para compartir una vista) sin recargar
  Obs.escribirURL = (valores) => {
    const p = Obs.parametros();
    for (const [k, v] of Object.entries(valores)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    history.replaceState(null, "", q ? `?${q}` : location.pathname);
  };

  /* ---------- Modo incrustado y altura ---------- */
  Obs.esEmbed = () => Obs.parametros().get("embed") === "1";

  // Avisa al sitio que contiene el iframe la altura del tablero.
  // El fragmento de webflow/insertar-tablero.html escucha este mensaje.
  Obs.informarAltura = () => {
    if (window.parent === window) return;
    let ultima = 0;
    const enviar = () => {
      const altura = Math.ceil(document.documentElement.scrollHeight);
      if (altura === ultima) return;
      ultima = altura;
      window.parent.postMessage({ tipo: "observatorio-altura", tablero: Obs.tablero, altura }, "*");
    };
    new ResizeObserver(enviar).observe(document.body);
    enviar();
  };

  /* ---------- Errores visibles ---------- */
  Obs.mostrarError = (mensaje) => {
    let caja = document.getElementById("error-carga");
    if (!caja) {
      caja = document.createElement("div");
      caja.id = "error-carga";
      caja.className = "aviso error-carga";
      caja.setAttribute("role", "alert");
      (document.querySelector("main") ?? document.body).prepend(caja);
    }
    caja.textContent = `No se pudo cargar el tablero: ${mensaje}`;
  };
  window.addEventListener("error", (e) => Obs.mostrarError(e.message || "error desconocido"));
  window.addEventListener("unhandledrejection", (e) => Obs.mostrarError(e.reason?.message || String(e.reason)));

  // Punto de entrada común: marca el modo incrustado, revisa las librerías y arranca el tablero
  Obs.iniciar = async (tablero, arrancar) => {
    Obs.tablero = tablero;
    if (Obs.esEmbed()) document.body.classList.add("embed");
    if (typeof echarts === "undefined" || typeof L === "undefined") {
      return Obs.mostrarError("no cargaron las librerías de gráficos (comun/lib).");
    }
    await arrancar();
    Obs.informarAltura();
  };
})();
