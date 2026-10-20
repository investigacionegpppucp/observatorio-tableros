/* =========================================================
   comun/mapa.js — mapa regional del Perú (Leaflet 1.9)
   Regiones coloreadas sobre el mar, países vecinos en gris y un
   recuadro ampliado de Lima Metropolitana y el Callao, para que
   Lima no aplaste la escala del resto. No usa teselas externas.
   Uso:
     const mapa = new Obs.Mapa("m-general", geo, { alClic: elegirRegion, nombre: nombreRegion });
     mapa.pintar({ valores, color, texto, elegida });
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
  Obs.leyendaCategorias = (id, entradas) => {
    document.getElementById(id).innerHTML = entradas.map(([etiqueta, color]) =>
      `<span><i style="background:${color}"></i>${Obs.escapar(etiqueta)}</span>`).join("");
  };

  Obs.Mapa = class {
    constructor(id, geo, { alClic = () => {}, nombre = (r) => r } = {}) {
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
    }

    crear(el, opciones) {
      const mapa = L.map(el, { zoomSnap: 0.1, attributionControl: false, scrollWheelZoom: false, zoomControl: false, ...opciones });
      const filtro = (tipo) => ({ ...this.geo, features: this.geo.features.filter((f) => f.properties.tipo === tipo) });
      L.geoJSON(filtro("pais"), { interactive: false, style: { fillColor: "#dfe4eb", fillOpacity: 1, color: "#ffffff", weight: 1 } }).addTo(mapa);
      mapa.capaRegiones = L.geoJSON(filtro("region"), {
        onEachFeature: (f, capa) => capa.on({
          click: () => this.alClic(f.properties.region),
          mouseover: () => { capa.setStyle({ weight: 2.5, color: Obs.tema().navy }); capa.bringToFront(); },
          mouseout: () => this.estilar(capa),
        }),
      }).addTo(mapa);
      return mapa;
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
  };
})();
