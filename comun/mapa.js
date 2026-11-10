/* =========================================================
   comun/mapa.js — mapa regional del Perú (Leaflet 1.9)
   Regiones coloreadas sobre el mar, países vecinos en gris y un
   recuadro ampliado de Lima Metropolitana y el Callao, para que
   Lima no aplaste la escala del resto. No usa teselas externas.
   Uso:
     const mapa = new Obs.Mapa("m-general", geo, { alClic: elegirRegion, nombre: nombreRegion });
     mapa.pintar({ valores, color, texto, elegida });
   Opcional, para los residentes en el extranjero (no tienen polígono):
     new Obs.Mapa(id, geo, { ..., globo: { alClic: () => elegir("EXTRANJERO") } });
     mapa.pintarGlobo({ color, titulo, texto, elegido, aria });  // color null = sin datos
   ========================================================= */
window.Obs = window.Obs || {};

(() => {
  const Obs = window.Obs;
  const LIMITES_PERU = [[-18.4, -81.4], [-0.03, -68.6]];
  const LIMITES_LIMA = [[-12.52, -77.2], [-11.58, -76.62]];
  const ETIQUETAS = [
    { texto: "Ecuador", lat: -1.9, lon: -78.6, clase: "etiqueta-pais" },
    { texto: "Colombia", lat: 0.9, lon: -72.4, clase: "etiqueta-pais" },
    { texto: "Brasil", lat: -6.6, lon: -68.4, clase: "etiqueta-pais" },
    { texto: "Bolivia", lat: -16.2, lon: -67.4, clase: "etiqueta-pais" },
    { texto: "Chile", lat: -19.4, lon: -69.3, clase: "etiqueta-pais" },
    { texto: "Océano<br>Pacífico", lat: -7.6, lon: -81.6, clase: "etiqueta-mar" },
  ];

  // GeoJSON compartido por todos los tableros
  Obs.cargarGeo = (ruta = "../mapas/peru_regiones.geojson") => (Obs._geo ??= Obs.cargarJSON(ruta));

  /* Cortes en 5 tramos por cuantiles, redondeados: con conteos muy desiguales
     (Lima Metropolitana frente al resto) los cortes iguales dejarían casi todo
     el mapa en el primer tramo. */
  Obs.cortesCuantiles = (valores, n = 5) => {
    const v = [...valores].filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return [];
    const redondear = (x) => {
      if (x < 10) return Math.round(x);
      const m = 10 ** Math.floor(Math.log10(x) - 1);
      return Math.round(x / m) * m;
    };
    const cortes = [v[0]];
    for (let i = 1; i < n; i++) cortes.push(redondear(v[Math.floor((i / n) * (v.length - 1))]));
    cortes.push(v[v.length - 1]);
    const unicos = [...new Set(cortes)];
    return unicos.slice(0, -1).map((a, i) => [a, unicos[i + 1]]);
  };
  Obs.colorTramo = (v, cortes, escala) => {
    const i = cortes.findIndex(([a, b], k) => v >= a && (v < b || k === cortes.length - 1));
    return escala[Math.max(0, i) + (escala.length - cortes.length)];
  };
  Obs.leyendaTramos = (id, cortes, escala, formato = Obs.fmtN) => {
    document.getElementById(id).innerHTML = cortes.map(([a, b], i) =>
      `<span><i style="background:${escala[i + escala.length - cortes.length]}"></i>${formato(a)} a ${formato(b)}</span>`).join("");
  };
  /* Escala continua (sin tramos): cada valor tiene su propio tono, interpolado entre los
     colores de la escala, del más claro (mínimo) al más oscuro (máximo). */
  /* Con { log: true } (conteos muy desiguales, como Lima frente al resto) el tono sigue
     el logaritmo del valor, para que las regiones con pocos casos no queden todas iguales. */
  Obs.rango = (valores, { log = false } = {}) => {
    const v = [...valores].filter((x) => x != null && Number.isFinite(x));
    if (!v.length) return null;
    const r = [Math.min(...v), Math.max(...v)];
    r.log = log;
    return r;
  };
  // Posición de 0 a 1 de un valor dentro del rango
  Obs.posicionRango = (v, rango) => {
    const f = rango.log ? Math.log1p : (x) => x;
    const a = f(Math.max(0, rango[0])), b = f(rango[1]);
    return b > a ? Math.max(0, Math.min(1, (f(v) - a) / (b - a))) : 1;
  };
  const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  Obs.colorContinuo = (v, rango, escala) => {
    if (!rango) return escala.at(-1);
    const t = Obs.posicionRango(v, rango);
    const cs = escala.map(hexRGB);
    const x = t * (cs.length - 1);
    const i = Math.min(cs.length - 2, Math.floor(x)), f = x - i;
    return `rgb(${cs[i].map((c, k) => Math.round(c + (cs[i + 1][k] - c) * f)).join(",")})`;
  };
  // ¿El texto encima de este color debe ir en blanco?
  Obs.colorOscuro = (c) => {
    const m = String(c).match(/\d+/g);
    const [r, g, b] = c.startsWith("#") ? hexRGB(c) : m.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
  };
  /* Barra degradada con el mínimo y el máximo. Con `mapa`, al pasar el mouse por una región
     una marca indica dónde cae su valor en la barra. */
  Obs.leyendaContinua = (id, rango, escala, formato = Obs.fmtN, mapa = null) => {
    const el = document.getElementById(id);
    if (!rango) { el.innerHTML = ""; return; }
    const [a, b] = rango;
    el.innerHTML = `<div class="ley-continua"><span>${formato(a)}</span>` +
      `<i style="background:linear-gradient(90deg,${escala.join(",")})"><b class="ley-marca" hidden></b></i><span>${formato(b)}</span></div>`;
    if (mapa) mapa.leyenda = { el: el.querySelector(".ley-marca"), rango };
  };
  Obs.leyendaCategorias = (id, entradas) => {
    document.getElementById(id).innerHTML = entradas.map(([etiqueta, color]) =>
      `<span><i style="background:${color}"></i>${Obs.escapar(etiqueta)}</span>`).join("");
  };

  /* Centro de cada región o provincia (centroide de su polígono más grande): Map(código -> [lat, lon]) */
  Obs.centroides = (geo) => {
    const area = (anillo) => { let a = 0; for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) a += anillo[j][0] * anillo[i][1] - anillo[i][0] * anillo[j][1]; return a / 2; };
    const centro = (anillo) => {
      let a = 0, x = 0, y = 0;
      for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        const f = anillo[j][0] * anillo[i][1] - anillo[i][0] * anillo[j][1];
        a += f; x += (anillo[j][0] + anillo[i][0]) * f; y += (anillo[j][1] + anillo[i][1]) * f;
      }
      return a ? [y / (3 * a), x / (3 * a)] : [anillo[0][1], anillo[0][0]];
    };
    const m = new Map();
    for (const f of geo.features) {
      if (f.properties.tipo === "pais") continue;
      const g = f.geometry;
      const poligonos = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      const mayor = poligonos.reduce((a, b) => (Math.abs(area(b[0])) > Math.abs(area(a[0])) ? b : a));
      m.set(f.properties.region, centro(mayor[0]));
    }
    return m;
  };

  Obs.Mapa = class {
    constructor(id, geo, { alClic = () => {}, nombre = (r) => r, globo = null } = {}) {
      this.id = id;
      this.geo = geo;
      this.alClic = alClic;
      this.nombre = nombre;
      const el = document.getElementById(id);
      el.classList.add("mapa-geo");
      el.innerHTML = `<div class="recuadro-lima"><span>Lima y Callao</span><div class="mapa-lima"></div></div>`;
      this.principal = this.crear(el, { zoomControl: true, minZoom: 3, maxZoom: 9, zoomDelta: 0.5 });
      this.principal.zoomControl.setPosition("topright");
      ETIQUETAS.forEach((e) => L.marker([e.lat, e.lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: e.clase, html: e.texto, iconSize: [120, 34], iconAnchor: [60, 17] }),
      }).addTo(this.principal));
      this.lima = this.crear(el.querySelector(".mapa-lima"), { dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
      this.principal.on("dblclick", () => this.principal.fitBounds(LIMITES_PERU, { padding: [8, 8] }));
      if (globo) {
        this.globo = document.createElement("button");
        this.globo.type = "button";
        this.globo.className = "globo";
        this.globo.onclick = globo.alClic;
        el.append(this.globo);
      }
    }

    // Botón con un globo terráqueo, arriba a la izquierda, sobre el océano
    pintarGlobo({ color = null, titulo = "Extranjero", texto = "", elegido = false, aria = titulo }) {
      const fondo = color ?? "#ccd3dd";
      this.globo.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="${fondo}"/>` +
        `<g fill="none" stroke="#fff" stroke-width="1.8"><circle cx="20" cy="20" r="11"/><ellipse cx="20" cy="20" rx="4.8" ry="11"/>` +
        `<path d="M9 20h22M10.6 14.5h18.8M10.6 25.5h18.8"/></g></svg>` +
        `<span><strong>${Obs.escapar(titulo)}</strong><em>${Obs.escapar(color ? texto : "Sin datos")}</em></span>`;
      this.globo.disabled = !color;
      this.globo.setAttribute("aria-pressed", elegido);
      this.globo.setAttribute("aria-label", aria);
    }

    crear(el, opciones) {
      const mapa = L.map(el, { zoomSnap: 0.1, attributionControl: false, scrollWheelZoom: false, zoomControl: false, ...opciones });
      const filtro = (tipo) => ({ ...this.geo, features: this.geo.features.filter((f) => f.properties.tipo === tipo) });
      L.geoJSON(filtro("pais"), { interactive: false, style: { fillColor: "#dfe4eb", fillOpacity: 1, color: "#ffffff", weight: 1 } }).addTo(mapa);
      mapa.capaRegiones = L.geoJSON(filtro("region"), {
        onEachFeature: (f, capa) => capa.on({
          click: () => this.alClic(f.properties.region),
          mouseover: () => { capa.setStyle({ weight: 2.5, color: Obs.tema().navy }); capa.bringToFront(); this.marcar(this.ultimo?.valores.get(f.properties.region)); },
          mouseout: () => { this.estilar(capa); this.marcar(null); },
        }),
      }).addTo(mapa);
      return mapa;
    }

    // Marca en la leyenda continua el valor de la región bajo el mouse
    marcar(v) {
      const l = this.leyenda;
      if (!l || !l.el.isConnected) return;
      const ok = typeof v === "number" && Number.isFinite(v);
      l.el.hidden = !ok;
      if (ok) l.el.style.left = `${Obs.posicionRango(v, l.rango) * 100}%`;
    }

    estilar(capa) {
      const r = capa.feature.properties.region;
      const elegida = r === this.ultimo.elegida;
      const v = this.ultimo.valores.get(r);
      capa.setStyle({
        fillColor: v != null ? this.ultimo.color(v) : "#ccd3dd", fillOpacity: 1,
        color: elegida ? Obs.tema().navy : "#ffffff", weight: elegida ? 3 : 0.9,
      });
      if (elegida) capa.bringToFront();
    }

    /* valores: Map(código de región -> valor); color: valor -> color;
       texto: valor -> texto del tooltip; elegida: código resaltado */
    pintar({ valores, color, texto = (v) => Obs.fmtN(v), elegida = null }) {
      this.ultimo = { valores, color, elegida };
      for (const [mapa, conEtiqueta] of [[this.principal, true], [this.lima, false]]) {
        mapa.capaRegiones.eachLayer((capa) => {
          const r = capa.feature.properties.region;
          this.estilar(capa);
          capa.unbindTooltip();
          const valor = valores.has(r) ? texto(valores.get(r)) : "sin datos";
          if (conEtiqueta && r === elegida) {
            capa.bindTooltip(`${this.nombre(r)}<b>${valor}</b>`, { permanent: true, direction: "top", className: "tip-elegida", offset: [0, -4] }).openTooltip();
          } else {
            capa.bindTooltip(`<strong>${this.nombre(r)}</strong><br>${valor}`, { sticky: true, direction: "top", className: "tip-mapa", offset: [0, -8] });
          }
        });
        mapa.invalidateSize();
      }
      this.principal.fitBounds(LIMITES_PERU, { padding: [8, 8] });
      this.lima.fitBounds(LIMITES_LIMA, { padding: [2, 2] });
    }

    /* Burbujas sobre el mapa (también en el recuadro de Lima).
       lista: [{ lat, lon, radio, color, texto, alClic }]; se dibujan de la más grande a la más chica */
    burbujas(lista = []) {
      const orden = [...lista].sort((a, b) => b.radio - a.radio);
      for (const [mapa, escala] of [[this.principal, 1], [this.lima, 0.8]]) {
        if (mapa.capaBurbujas) mapa.removeLayer(mapa.capaBurbujas);
        mapa.capaBurbujas = L.layerGroup(orden.map((b) => {
          const c = L.circleMarker([b.lat, b.lon], { radius: Math.max(3, b.radio * escala), fillColor: b.color, fillOpacity: 0.6, color: "#ffffff", weight: 1, bubblingMouseEvents: false });
          c.bindTooltip(b.texto, { direction: "top", className: "tip-mapa", offset: [0, -4] });
          c.on("mouseover", () => c.setStyle({ weight: 2.5, color: Obs.tema().navy, fillOpacity: 0.85 }));
          c.on("mouseout", () => c.setStyle({ weight: 1, color: "#ffffff", fillOpacity: 0.6 }));
          if (b.alClic) c.on("click", b.alClic);
          return c;
        })).addTo(mapa);
      }
    }
  };
})();
