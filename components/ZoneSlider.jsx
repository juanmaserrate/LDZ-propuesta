/* ZoneSlider — recorrido manual zona por zona del pliego vigente.
   Leaflet propio (id distinto al Dashboard), CartoDB Positron (claro). */

// Cada zona muestra una de las 12 cards de diagnóstico (mismo orden que el array CONTENT.diagnostico.items)
const ZONE_DIAGNOSTICS = {
  "Zona 1":  { n: "01", t: "Zonas dispersas",          c: "Colegios vecinos quedan en zonas distintas y otros lejanos comparten zona. Las rutas se cruzan y se duplican." },
  "Zona 2":  { n: "02", t: "Tiempos largos de entrega", c: "El recorrido medio actual ronda los 47 minutos por vianda. La cadena térmica se compromete antes de llegar al colegio." },
  "Zona 3":  { n: "03", t: "Auditoría ineficiente",     c: "Un auditor municipal pierde más tiempo en traslados que controlando: pocos colegios cubiertos por jornada." },
  "Zona 4":  { n: "04", t: "Frescura comprometida",     c: "Más minutos en tránsito = más riesgo de cadena de frío rota, alimentos tibios y reclamos de directivos." },
  "Zona 5":  { n: "05", t: "Cruces entre cuadrillas",   c: "Distintos vehículos del operador atraviesan las mismas calles para cubrir colegios de zonas separadas. Kilómetros duplicados sobre el mismo eje." },
  "Zona 6":  { n: "06", t: "Trazabilidad débil",        c: "Ante un reclamo de un directivo, reconstruir qué vianda llegó a qué colegio y en qué condiciones lleva horas: papel, planillas y llamadas cruzadas." },
  "Zona 7":  { n: "07", t: "Combustible y horas extra", c: "Rutas largas inflan el consumo de gasoil y obligan a horas extra de conductores. Costo operativo que el pliego no premia evitar." },
  "Zona 8":  { n: "08", t: "Inequidad horaria",         c: "Colegios de la misma zona reciben la vianda con diferencias de hasta 90 minutos. Algunos comen 11:30, otros casi 13:00." },
  "Zona 9":  { n: "09", t: "Frágil ante imprevistos",   c: "Si falta un vehículo o se corta una calle por obra, no hay grupo cercano que absorba esos colegios. Se cae la entrega del día." },
  "Zona 10": { n: "10", t: "Comunicación fragmentada",  c: "Cada zona maneja su propio canal informal con directivos. El Municipio no tiene un único punto de contacto consolidado por grupo." },
  "Zona 11": { n: "11", t: "Inflexible ante matrícula", c: "Cuando un colegio cambia su matrícula a mitad de año, reasignar cupos exige rehacer la zona entera. El pliego no contempla rebalanceo simple." },
  "Zona 12": { n: "12", t: "Control municipal disperso", c: "El área de Educación necesita supervisar 12 zonas con criterios diferentes. Imposible comparar performance entre zonas con datos homogéneos." },
};

// OSRM con cache: route por las calles entre dos puntos
const _zoneRouteCache = new Map();
async function fetchOSRM(a, b) {
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
  if (_zoneRouteCache.has(key)) return _zoneRouteCache.get(key);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    const coords = (j.routes && j.routes[0] && j.routes[0].geometry.coordinates) || null;
    if (!coords) throw new Error("no route");
    const ll = coords.map(c => [c[1], c[0]]);
    _zoneRouteCache.set(key, ll);
    return ll;
  } catch (_) {
    const fallback = [[a.lat, a.lng], [b.lat, b.lng]];
    _zoneRouteCache.set(key, fallback);
    return fallback;
  }
}

function ZoneSlider({ onNextPage, onPrevPage }) {
  const mapEl = React.useRef(null);
  const mapRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const routeLayerRef = React.useRef(null);
  const provMarkerRef = React.useRef(null);
  const seqRef = React.useRef(0);
  const [schools, setSchools] = React.useState([]);
  const [zones, setZones] = React.useState([]);
  const [provByZone, setProvByZone] = React.useState({});
  const [provLocations, setProvLocations] = React.useState({});
  const [idx, setIdx] = React.useState(0);

  // Cargar colegios.json una sola vez (cache global)
  React.useEffect(() => {
    if (window.__colegiosCache) {
      const d = window.__colegiosCache;
      setSchools(d.colegios || []);
      setZones(d.zonas_disponibles || []);
      setProvByZone(d.proveedores_por_zona || {});
      setProvLocations(d.proveedores_locations || {});
      return;
    }
    fetch("data/colegios.json?v=4")
      .then(r => r.json())
      .then(d => {
        window.__colegiosCache = d;
        setSchools(d.colegios || []);
        setZones(d.zonas_disponibles || []);
        setProvByZone(d.proveedores_por_zona || {});
        setProvLocations(d.proveedores_locations || {});
      })
      .catch(() => {});
  }, []);

  // Inicializar Leaflet (id propio: "zoneSliderMap")
  React.useEffect(() => {
    if (!mapEl.current || mapRef.current || typeof L === "undefined") return;
    const map = L.map(mapEl.current, { zoomControl: true, scrollWheelZoom: false })
                 .setView([-34.762, -58.405], 12);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  }, []);

  const currentZone = zones[idx];
  const colegiosZona = React.useMemo(
    () => schools.filter(s => (s.zona || s.zona_pliego) === currentZone),
    [schools, currentZone]
  );

  // Render markers + proveedor + rutas OSRM al cambiar de zona
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined" || !currentZone) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
    if (provMarkerRef.current) map.removeLayer(provMarkerRef.current);

    const mySeq = ++seqRef.current;
    const group = L.layerGroup();
    const routeLayer = L.layerGroup();
    const pts = [];

    // Marker del proveedor
    const provName = provByZone[currentZone];
    const provLoc = provName && provLocations[provName];
    if (provLoc && provLoc.lat && provLoc.lng) {
      const provIcon = L.divIcon({
        className: "zone-prov-icon",
        html: `<div class="zone-prov-pin">📦</div>`,
        iconSize: [40, 40], iconAnchor: [20, 20],
      });
      const pm = L.marker([provLoc.lat, provLoc.lng], { icon: provIcon, zIndexOffset: 1000 })
        .bindPopup(`<strong>${provName}</strong><br/><span style="color:#5A6B82;font-size:12px">${provLoc.direccion || ""}</span>`);
      pm.addTo(map);
      provMarkerRef.current = pm;
      pts.push([provLoc.lat, provLoc.lng]);
    } else {
      provMarkerRef.current = null;
    }

    // Marcadores de colegios + polyline recta inmediata como fallback
    const fallbackLines = [];
    colegiosZona.forEach(s => {
      if (!s.lat || !s.lng) return;
      pts.push([s.lat, s.lng]);
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 8, color: "#fff", weight: 2, fillColor: "#2563B0", fillOpacity: 0.95,
      });
      const c = s.cupos || {};
      const dm = c.dm || c.modulos || 0;
      const com = c.com || c.comedor || 0;
      const mat = s.matricula || 0;
      m.bindPopup(
        `<div style="font-family:Inter,sans-serif;min-width:220px">` +
        `<strong>${s.nombre}</strong><br/>` +
        `<span style="color:#5A6B82;font-size:12px">${s.direccion || ""}</span><br/>` +
        `<span style="font-size:12px">Localidad: <b>${s.localidad || "—"}</b></span><br/>` +
        `<span style="font-size:12px">Proveedor: <b>${provName || "—"}</b></span><br/>` +
        `<span style="font-size:11px;color:#5A6B82">Matrícula: ${mat} · DM: ${dm} · COM: ${com}</span>` +
        `</div>`
      );
      group.addLayer(m);

      if (provLoc && provLoc.lat && provLoc.lng) {
        // Línea recta de fallback inmediato
        const straight = L.polyline([[provLoc.lat, provLoc.lng], [s.lat, s.lng]], {
          color: "#2563B0", weight: 2, opacity: 0.45, dashArray: "4 6",
        });
        routeLayer.addLayer(straight);
        fallbackLines.push({ marker: m, school: s, straightLine: straight });
      }
    });

    group.addTo(map);
    routeLayer.addTo(map);
    layerRef.current = group;
    routeLayerRef.current = routeLayer;

    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts).pad(0.25), { animate: true });
    }
    setTimeout(() => map.invalidateSize(), 50);

    // Upgrade async a rutas OSRM por las calles
    if (provLoc && provLoc.lat && provLoc.lng) {
      fallbackLines.forEach(({ school, straightLine }) => {
        fetchOSRM(provLoc, { lat: school.lat, lng: school.lng }).then(latlngs => {
          if (mySeq !== seqRef.current || routeLayerRef.current !== routeLayer) return;
          if (!latlngs || !latlngs.length) return;
          // Reemplazar la línea recta por la ruta OSRM real
          routeLayer.removeLayer(straightLine);
          const route = L.polyline(latlngs, {
            color: "#2563B0", weight: 3, opacity: 0.75, lineCap: "round", lineJoin: "round",
          });
          routeLayer.addLayer(route);
        }).catch(() => {});
      });
    }
  }, [colegiosZona, currentZone, provByZone, provLocations]);

  // Teclas izq/der
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        if (idx === 0) {
          if (typeof onPrevPage === "function") onPrevPage();
        } else {
          setIdx(i => Math.max(0, i - 1));
        }
      }
      if (e.key === "ArrowRight") {
        if (idx >= zones.length - 1 && zones.length > 0) {
          if (typeof onNextPage === "function") onNextPage();
        } else {
          setIdx(i => Math.min(zones.length - 1, i + 1));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zones.length, idx, onNextPage, onPrevPage]);

  // Totales de cupos (basados en los nuevos campos del Excel)
  const totals = colegiosZona.reduce((acc, s) => {
    const c = s.cupos || {};
    acc.dm += c.dm || c.modulos || 0;
    acc.com += c.com || c.comedor || 0;
    acc.patologias_dm += c.patologias_dm || 0;
    acc.patologias_com += c.patologias_com || 0;
    acc.patios_dm += c.patios_dm || 0;
    acc.lc_dm += c.lc_dm || 0;
    acc.matricula += s.matricula || 0;
    return acc;
  }, { dm: 0, com: 0, patologias_dm: 0, patologias_com: 0, patios_dm: 0, lc_dm: 0, matricula: 0 });
  const totalCupos = totals.dm + totals.com;
  const proveedor = provByZone[currentZone] || "—";

  const prev = () => {
    if (idx === 0) {
      if (typeof onPrevPage === "function") onPrevPage();
      return;
    }
    setIdx(i => Math.max(0, i - 1));
  };
  const next = () => {
    if (idx >= zones.length - 1 && zones.length > 0) {
      if (typeof onNextPage === "function") onNextPage();
      return;
    }
    setIdx(i => Math.min(zones.length - 1, i + 1));
  };

  const diag = ZONE_DIAGNOSTICS[currentZone];

  return (
    <div className="zone-slider" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header con badge "pliego vigente" + navegación */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 16, marginBottom: 18
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{
            background: "var(--celeste-100)", color: "var(--celeste-800)",
            border: "1px solid var(--celeste-300)", padding: "6px 12px",
            borderRadius: 999, fontFamily: "var(--f-mono)", fontSize: 11,
            letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600,
          }}>
            ● Pliego vigente · {currentZone || "—"}
          </span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-500)" }}>
            Zona {idx + 1} / {zones.length || 12}
          </span>
          <span style={{
            background: "var(--ink-700, #243248)", color: "white",
            padding: "6px 12px", borderRadius: 999, fontFamily: "var(--f-mono)",
            fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
            fontWeight: 600,
          }}>
            Proveedor: {proveedor}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={prev}
                  disabled={idx === 0 && typeof onPrevPage !== "function"}
                  style={{ opacity: (idx === 0 && typeof onPrevPage !== "function") ? 0.4 : 1 }}>
            ◀ Anterior
          </button>
          <select value={idx} onChange={e => setIdx(parseInt(e.target.value, 10))}
                  style={{
                    padding: "8px 12px", border: "1px solid var(--celeste-300)",
                    borderRadius: "var(--r-sm)", fontFamily: "var(--f-mono)",
                    fontSize: 13, background: "white", color: "var(--celeste-900)",
                    cursor: "pointer",
                  }}>
            {zones.map((z, i) => <option key={z} value={i}>{z}</option>)}
          </select>
          <button className="btn btn-primary" onClick={next}>
            {idx >= zones.length - 1 && zones.length > 0 && typeof onNextPage === "function"
              ? "Siguiente página ▶"
              : "Siguiente ▶"}
          </button>
        </div>
      </div>

      {/* Layout mapa + panel resumen (altura adaptativa al viewport) */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 20, alignItems: "stretch", flex: "1 1 auto", minHeight: 0,
      }} className="zone-slider-grid">
        <div style={{ position: "relative", minHeight: 0, height: "100%" }}>
          <div ref={mapEl} id="zoneSliderMap" style={{
            position: "absolute", inset: 0, zIndex: 1,
            borderRadius: "var(--r-md)", overflow: "hidden",
            border: "1px solid var(--celeste-200)", boxShadow: "var(--sh-sm)",
            background: "#F0F7FC",
          }}/>
          {diag && (
            <div className="zone-diag-card">
              <div className="zone-diag-num">{diag.n}</div>
              <div className="zone-diag-title">{diag.t}</div>
              <div className="zone-diag-desc">{diag.c}</div>
            </div>
          )}
        </div>

        <aside style={{
          background: "white", border: "1px solid var(--celeste-200)",
          borderRadius: "var(--r-md)", padding: 18, boxShadow: "var(--sh-sm)",
          display: "flex", flexDirection: "column", minHeight: 0, height: "100%",
          overflow: "auto",
        }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Detalle de zona</div>
          <h4 style={{
            fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 700,
            color: "var(--celeste-900)", margin: "0 0 4px 0", letterSpacing: "-0.02em",
          }}>{currentZone || "—"}</h4>
          <div style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 14 }}>
            Tal cual la define el pliego municipal vigente.
          </div>

          <div style={{
            background: "var(--celeste-50)", padding: "8px 12px",
            borderRadius: "var(--r-sm)", marginBottom: 12,
            fontSize: 12, color: "var(--ink-700)",
          }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: ".1em", color: "var(--ink-500)" }}>PROVEEDOR</span>
            <div style={{ fontWeight: 700, color: "var(--celeste-900)", fontSize: 14 }}>{proveedor}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ background: "var(--celeste-50)", padding: 10, borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--ink-500)", fontFamily: "var(--f-mono)", letterSpacing: ".1em" }}>COLEGIOS</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--celeste-800)" }}>{colegiosZona.length}</div>
            </div>
            <div style={{ background: "var(--celeste-50)", padding: 10, borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10, color: "var(--ink-500)", fontFamily: "var(--f-mono)", letterSpacing: ".1em" }}>CUPOS TOTALES</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--celeste-800)" }}>{totalCupos.toLocaleString("es-AR")}</div>
            </div>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6,
            fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--ink-700)",
          }}>
            <div>DM: <b>{totals.dm.toLocaleString("es-AR")}</b></div>
            <div>COM: <b>{totals.com.toLocaleString("es-AR")}</b></div>
            <div>Patologías DM: <b>{totals.patologias_dm.toLocaleString("es-AR")}</b></div>
            <div>Patologías COM: <b>{totals.patologias_com.toLocaleString("es-AR")}</b></div>
            <div>Patios DM: <b>{totals.patios_dm.toLocaleString("es-AR")}</b></div>
            <div>LC DM: <b>{totals.lc_dm.toLocaleString("es-AR")}</b></div>
          </div>

          <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid var(--celeste-100)",
                        fontSize: 11, color: "var(--ink-500)", fontFamily: "var(--f-mono)",
                        letterSpacing: ".08em" }}>
            ↓ Detalle escuela por escuela debajo
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 880px) {
          .zone-slider-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function ZoneSliderSection({ data, onNextPage, onPrevPage }) {
  return (
    <section id="recorrido" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">01</span><span className="txt">{data.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">¿Cuál es la situación actual?</h2>
        </div>
        <ZoneSlider onNextPage={onNextPage} onPrevPage={onPrevPage}/>
      </div>
    </section>
  );
}

Object.assign(window, { ZoneSlider, ZoneSliderSection });
