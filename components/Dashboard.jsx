/* Dashboard interactivo embebido — explorador de zonas, KPI dinámicos, mapa */

// Hash deterministico de string a int [0..n)
function _hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
// Color HSL deterministico por localidad, en rango celeste/azul
function colorForLocalidad(loc) {
  if (!loc || loc === "Sin asignar") return "#C8C8D2";
  const h = _hashStr(loc);
  const hue = 195 + (h % 50);            // 195..244 = celeste -> azul
  const sat = 55 + ((h >> 8) % 25);      // 55..79
  const lig = 42 + ((h >> 16) % 18);     // 42..59
  return `hsl(${hue}, ${sat}%, ${lig}%)`;
}

function Dashboard() {
  const [mode, setMode] = React.useState("proposed");   // "current" | "proposed"

  return (
    <div className="dash">
      <div className="dash-header">
        <div>
          <div className="eyebrow">Mapa real interactivo</div>
          <h3 className="display-sm" style={{ marginTop: 8 }}>80+ escuelas del pliego — actuales vs. propuesta</h3>
          <p className="text-mute" style={{ fontSize: 14, marginTop: 6, maxWidth: 540 }}>
            Cambiá entre la zonificación vigente (12 zonas dispersas) y la propuesta de rezonificación: una zona por barrio, respetando la geografía real del partido. Hacé clic en cada escuela para ver su asignación.
          </p>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Cambiar modo de mapa">
          <button role="tab" aria-selected={mode === "current"}  className={mode === "current"  ? "on" : ""} onClick={() => setMode("current")}>Zonificación actual</button>
          <button role="tab" aria-selected={mode === "proposed"} className={mode === "proposed" ? "on" : ""} onClick={() => setMode("proposed")}>Propuesta · Una zona por barrio</button>
        </div>
      </div>

      <RealSchoolsMap mode={mode} />
    </div>
  );
}

/* Mapa Leaflet con colegios reales del pliego de LZ */
function RealSchoolsMap({ mode }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const [schools, setSchools] = React.useState([]);
  const [localidades, setLocalidades] = React.useState([]);

  React.useEffect(() => {
    fetch("data/colegios.json?v=2")
      .then(r => r.json())
      .then(d => {
        setSchools(d.colegios || d.schools || []);
        setLocalidades(d.localidades_disponibles || []);
      })
      .catch(() => setSchools([]));
  }, []);

  React.useEffect(() => {
    if (!ref.current || mapRef.current || typeof L === "undefined") return;
    const map = L.map(ref.current, { zoomControl: true, scrollWheelZoom: false }).setView([-34.762, -58.405], 12);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  }, []);

  const ZONE_COLORS_CURRENT = ["#C8C8D2","#B5C2D0","#9FB0C2","#7E8FA4","#5C6E83","#A8B5C5","#8C9CB0","#74ACDF","#2563B0","#0E3A6B","#1A4A8C","#4A8FCB"];

  React.useEffect(() => {
    if (!mapRef.current || !schools.length || typeof L === "undefined") return;
    if (layerRef.current) mapRef.current.removeLayer(layerRef.current);
    const group = L.layerGroup();
    schools.forEach(s => {
      if (!s.lat || !s.lng) return;
      let color;
      if (mode === "current") {
        const zNum = parseInt((s.zona_pliego || s.zona || "").replace(/\D/g, ""), 10) || 1;
        color = ZONE_COLORS_CURRENT[(zNum - 1) % 12];
      } else {
        color = colorForLocalidad(s.localidad);
      }
      const marker = L.circleMarker([s.lat, s.lng], {
        radius: 6, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.92,
      });
      marker.bindPopup(
        `<div style="font-family:Inter,sans-serif;min-width:180px"><strong>${s.nombre}</strong><br/>` +
        `<span style="color:#5A6B82;font-size:12px">${s.localidad || ""}</span><br/>` +
        `<span style="font-size:12px">Pliego actual: <b>${s.zona_pliego || s.zona || "—"}</b></span><br/>` +
        `<span style="font-size:12px">Propuesta: <b>${s.localidad || "Sin asignar"}</b></span><br/>` +
        `<span style="font-size:11px;color:#5A6B82">DMC: ${(s.cupos && (s.cupos.dmc_comedor || s.cupos.dmc)) || 0}</span></div>`
      );
      group.addLayer(marker);
    });
    group.addTo(mapRef.current);
    layerRef.current = group;
  }, [schools, mode]);

  // Lista de localidades para la leyenda (fallback: derivada de schools)
  const legendLocs = localidades.length
    ? localidades
    : Array.from(new Set(schools.map(s => s.localidad).filter(Boolean))).sort();

  return (
    <div style={{ marginTop: 28 }}>
      <div className="eyebrow" style={{ display: "block", marginBottom: 10 }}>
        Mapa real · {schools.length} escuelas del pliego de Lomas de Zamora
      </div>
      <div ref={ref} style={{
        height: 460, borderRadius: "var(--r-md)", overflow: "hidden",
        border: "1px solid var(--line)", background: "var(--celeste-50)"
      }}/>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-500)", fontFamily: "var(--f-mono)" }}>
        {mode === "current"
          ? "Coloreado por zona del pliego actual (12 zonas dispersas)."
          : "Coloreado por barrio: cada localidad es su propia zona logística."}
      </div>
      {mode === "proposed" && legendLocs.length > 0 && (
        <div className="dash-legend">
          <div className="dash-legend-title mono">Localidades · una zona por barrio</div>
          <div className="dash-legend-grid">
            {legendLocs.map(loc => (
              <div className="dash-legend-item" key={loc}>
                <span className="dash-legend-sw" style={{ background: colorForLocalidad(loc) }}/>
                <span className="dash-legend-l">{loc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ mode }) {
  const codes = mode === "current"
    ? ["C2", "R2", "R3", "I1", "I2"]
    : ["LA-1", "LA-2", "LA-3"];
  return (
    <div className="legend">
      <div className="legend-title mono">{mode === "current" ? "Zonificación vigente (Cód. ord.)" : "Categorías propuestas"}</div>
      <div className="legend-rows">
        {codes.map(c => (
          <div className="legend-row" key={c}>
            <span className="sw" style={{ background: ZONE_KEY[c].color }}/>
            <span className="lc mono">{c}</span>
            <span className="ll">{ZONE_KEY[c].label}</span>
          </div>
        ))}
        {mode === "proposed" && (
          <div className="legend-row">
            <span className="sw star">★</span>
            <span className="lc mono">HUB</span>
            <span className="ll">Centro de distribución y preparación</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DistrictPanel({ district, mode }) {
  const cur = ZONE_KEY[district.current];
  const pro = ZONE_KEY[district.proposed];
  const hub = HUBS.find(h => h.serves.includes(district.id));

  return (
    <div className="card-elev district-panel">
      <div className="dp-head">
        <div className="eyebrow">Distrito seleccionado</div>
        <div className="display-sm" style={{ marginTop: 6 }}>{district.name}</div>
      </div>

      <div className="dp-stat">
        <div className="dp-stat-v mono">{district.kids.toLocaleString("es-AR")}</div>
        <div className="dp-stat-l">niños y niñas en edad escolar</div>
      </div>

      <div className="dp-zone">
        <div className="zone-tile">
          <span className="zt-tag mono">ACTUAL</span>
          <span className="zt-code mono" style={{ color: cur.color === "#C8C8D2" ? "#5A6B82" : cur.color }}>{district.current}</span>
          <span className="zt-label">{cur.label}</span>
        </div>
        <div className="zone-arrow">→</div>
        <div className="zone-tile prop">
          <span className="zt-tag mono">PROPUESTA</span>
          <span className="zt-code mono">{district.proposed}</span>
          <span className="zt-label">{pro.label}</span>
        </div>
      </div>

      {hub && (
        <div className="dp-hub">
          <div className="hub-pin">★</div>
          <div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-500)", letterSpacing: ".1em", textTransform: "uppercase" }}>Asignado a</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{hub.name}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiBlock({ totalKids, beforeAvgMin, afterAvgMin, reachedKids, co2reduction, mode }) {
  const isProp = mode === "proposed";
  return (
    <div className="kpi-block">
      <div className="eyebrow">Impacto agregado · Lomas de Zamora</div>
      <div className="kpi-row">
        <div>
          <div className="kpi-v">{totalKids.toLocaleString("es-AR")}</div>
          <div className="kpi-l">chicos alcanzados</div>
        </div>
        <div>
          <div className="kpi-v">{isProp ? afterAvgMin : beforeAvgMin}<span className="u">min</span></div>
          <div className="kpi-l">tiempo medio de entrega</div>
          <div className="kpi-d" style={{ color: isProp ? "var(--green)" : "var(--coral)" }}>
            {isProp ? `↓ ${beforeAvgMin - afterAvgMin} min vs. actual` : `referencia base`}
          </div>
        </div>
        <div>
          <div className="kpi-v">{isProp ? co2reduction : 0}<span className="u">%</span></div>
          <div className="kpi-l">reducción de CO₂ logístico</div>
          <div className="kpi-d" style={{ color: isProp ? "var(--green)" : "var(--ink-500)" }}>
            {isProp ? "flota eléctrica + ruteo corto" : "sin acción"}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, colorForLocalidad });
