/* Mapa estilizado de Lomas de Zamora con polígonos de zonificación.
   No es geográficamente exacto — es una representación esquemática
   pensada para ilustrar la lógica de proximidad por distritos. */

const LZ_DISTRICTS = [
  { id: "centro",       name: "Lomas Centro",          d: "M 380 260 L 470 250 L 500 320 L 460 380 L 380 370 L 360 310 Z", kids: 8420,  current: "C2", proposed: "LA-1" },
  { id: "banfield",     name: "Banfield",              d: "M 470 250 L 560 245 L 590 305 L 570 360 L 500 320 Z",           kids: 11200, current: "R2", proposed: "LA-1" },
  { id: "temperley",    name: "Temperley",             d: "M 500 320 L 570 360 L 580 430 L 510 450 L 460 380 Z",           kids: 9700,  current: "R3", proposed: "LA-2" },
  { id: "turdera",      name: "Turdera",               d: "M 580 430 L 660 420 L 680 490 L 600 510 L 510 450 Z",           kids: 6300,  current: "I1", proposed: "LA-3" },
  { id: "llavallol",    name: "Llavallol",             d: "M 660 420 L 760 405 L 790 480 L 720 530 L 680 490 Z",           kids: 5800,  current: "I2", proposed: "LA-3" },
  { id: "st-catalina",  name: "Santa Catalina",        d: "M 280 380 L 360 310 L 380 370 L 360 460 L 280 470 L 250 420 Z", kids: 7400,  current: "R3", proposed: "LA-2" },
  { id: "fiorito",      name: "Villa Fiorito",         d: "M 250 420 L 280 470 L 360 460 L 380 540 L 290 560 L 230 510 Z", kids: 12400, current: "R3", proposed: "LA-1" },
  { id: "centenario",   name: "Parque Centenario",     d: "M 380 540 L 460 490 L 510 450 L 510 540 L 430 600 Z",           kids: 4900,  current: "I1", proposed: "LA-2" },
  { id: "ingeniero",    name: "Ingeniero Budge",       d: "M 290 560 L 380 540 L 430 600 L 360 660 L 270 640 Z",           kids: 9100,  current: "R3", proposed: "LA-1" },
  { id: "presidente",   name: "Presidente Perón",      d: "M 510 540 L 600 510 L 620 600 L 540 640 L 430 600 Z",           kids: 4200,  current: "R2", proposed: "LA-2" },
  { id: "matanza-bd",   name: "Borde Matanza",         d: "M 360 660 L 430 600 L 540 640 L 500 720 L 380 720 L 320 690 Z", kids: 5500,  current: "I1", proposed: "LA-3" },
];

const HUBS = [
  { id: "h1", x: 470, y: 320, name: "Hub Norte",   serves: ["centro", "banfield", "fiorito"] },
  { id: "h2", x: 540, y: 410, name: "Hub Central", serves: ["temperley", "centenario", "presidente", "st-catalina"] },
  { id: "h3", x: 660, y: 480, name: "Hub Sur",     serves: ["turdera", "llavallol", "matanza-bd", "ingeniero"] },
];

const ZONE_KEY = {
  "C2":   { label: "Comercial densidad 2",  legacy: true,  color: "#C8C8D2" },
  "R2":   { label: "Residencial densidad 2", legacy: true, color: "#B5C2D0" },
  "R3":   { label: "Residencial densidad 3", legacy: true, color: "#9FB0C2" },
  "I1":   { label: "Industrial restringido",  legacy: true, color: "#7E8FA4" },
  "I2":   { label: "Industrial general",      legacy: true, color: "#5C6E83" },
  "LA-1": { label: "Logística Alimenticia 1 — Distribución urbana",  proposed: true, color: "#74ACDF" },
  "LA-2": { label: "Logística Alimenticia 2 — Preparación + acopio", proposed: true, color: "#2563B0" },
  "LA-3": { label: "Logística Alimenticia 3 — Producción + frío",    proposed: true, color: "#0E3A6B" },
};

function ZoneMap({ mode = "proposed", hovered, setHovered, selected, setSelected, showHubs = true }) {
  // mode: "current" | "proposed"
  return (
    <div className="zone-map">
      <svg viewBox="0 0 900 800" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mapa esquemático de Lomas de Zamora con zonificación">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#DCE4EE" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#F2A93B" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#F2A93B" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#F2A93B" stopOpacity="0" />
          </radialGradient>
          <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3"/>
          </filter>
        </defs>

        {/* Background */}
        <rect width="900" height="800" fill="#F0F7FC" />
        <rect width="900" height="800" fill="url(#grid)" />

        {/* River Riachuelo (esquemático) */}
        <path d="M 100 100 Q 220 180 280 240 T 440 200 T 620 180 T 820 130"
              fill="none" stroke="#B8D7EE" strokeWidth="14" strokeLinecap="round" opacity="0.55"/>
        <path d="M 100 100 Q 220 180 280 240 T 440 200 T 620 180 T 820 130"
              fill="none" stroke="#74ACDF" strokeWidth="2" strokeLinecap="round" opacity="0.5" strokeDasharray="2 6"/>
        <text x="120" y="92" className="map-label" fill="#5A6B82" fontSize="11" fontFamily="var(--f-mono)">Riachuelo</text>

        {/* Highway corridor */}
        <line x1="40" y1="780" x2="860" y2="200" stroke="#97A4B8" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.6"/>
        <text x="780" y="210" fontSize="10" fill="#5A6B82" fontFamily="var(--f-mono)" letterSpacing="1">AU RICCHERI</text>

        <line x1="60" y1="380" x2="850" y2="540" stroke="#97A4B8" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.6"/>
        <text x="60" y="372" fontSize="10" fill="#5A6B82" fontFamily="var(--f-mono)" letterSpacing="1">AV. H. YRIGOYEN</text>

        {/* Districts */}
        {LZ_DISTRICTS.map(d => {
          const zoneCode = mode === "current" ? d.current : d.proposed;
          const zone = ZONE_KEY[zoneCode];
          const isHover = hovered === d.id;
          const isSel   = selected === d.id;
          return (
            <g key={d.id} onMouseEnter={() => setHovered(d.id)}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => setSelected(isSel ? null : d.id)}
                          style={{ cursor: "pointer" }}>
              <path d={d.d}
                    fill={zone.color}
                    fillOpacity={isHover || isSel ? 0.95 : 0.78}
                    stroke={isSel ? "#0E3A6B" : (isHover ? "#1A4A8C" : "#FFFFFF")}
                    strokeWidth={isSel ? 3 : (isHover ? 2 : 1.5)}
                    style={{ transition: "all .25s ease" }} />
              {/* district label */}
              <DistrictLabel d={d} isLight={zone.color === "#0E3A6B" || zone.color === "#2563B0" || zone.color === "#5C6E83"} />
            </g>
          );
        })}

        {/* Distribution hubs (only in proposed mode) */}
        {mode === "proposed" && showHubs && HUBS.map(h => (
          <g key={h.id}>
            <circle cx={h.x} cy={h.y} r="48" fill="url(#hub-glow)" />
            <circle cx={h.x} cy={h.y} r="13" fill="#F2A93B" stroke="white" strokeWidth="2.5" filter="url(#soft-shadow)"/>
            <circle cx={h.x} cy={h.y} r="13" fill="#F2A93B" stroke="white" strokeWidth="2.5"/>
            <text x={h.x} y={h.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0E3A6B" fontFamily="var(--f-display)">★</text>
            <text x={h.x} y={h.y + 30} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#0E3A6B" fontFamily="var(--f-mono)" letterSpacing="0.5">{h.name.toUpperCase()}</text>
          </g>
        ))}

        {/* Connection lines from hubs to districts (only proposed) */}
        {mode === "proposed" && showHubs && HUBS.map(h =>
          h.serves.map(distId => {
            const dist = LZ_DISTRICTS.find(x => x.id === distId);
            if (!dist) return null;
            const c = districtCentroid(dist);
            return (
              <line key={`${h.id}-${distId}`}
                    x1={h.x} y1={h.y} x2={c.x} y2={c.y}
                    stroke="#F2A93B" strokeWidth="1.2" strokeDasharray="3 3"
                    opacity="0.55"/>
            );
          })
        )}

        {/* Compass + scale */}
        <g transform="translate(820, 720)">
          <circle r="22" fill="white" stroke="#DCE4EE"/>
          <path d="M 0 -14 L 4 4 L 0 0 L -4 4 Z" fill="#0E3A6B"/>
          <text y="20" textAnchor="middle" fontSize="9" fontFamily="var(--f-mono)" fill="#5A6B82">N</text>
        </g>

        <g transform="translate(60, 750)">
          <line x1="0" y1="0" x2="80" y2="0" stroke="#5A6B82" strokeWidth="1.5"/>
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#5A6B82" strokeWidth="1.5"/>
          <line x1="80" y1="-4" x2="80" y2="4" stroke="#5A6B82" strokeWidth="1.5"/>
          <text x="40" y="18" textAnchor="middle" fontSize="10" fontFamily="var(--f-mono)" fill="#5A6B82">2 km</text>
        </g>
      </svg>
    </div>
  );
}

function DistrictLabel({ d, isLight }) {
  const c = districtCentroid(d);
  return (
    <text x={c.x} y={c.y}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill={isLight ? "#FFFFFF" : "#0E3A6B"}
          fontFamily="var(--f-body)"
          style={{ pointerEvents: "none", textShadow: isLight ? "none" : "0 1px 2px rgba(255,255,255,0.6)" }}>
      {d.name}
    </text>
  );
}

// Approx centroid — average of path move-to coords
function districtCentroid(d) {
  const nums = d.d.match(/[\d.]+/g).map(Number);
  let xs = [], ys = [];
  for (let i = 0; i < nums.length; i += 2) {
    xs.push(nums[i]); ys.push(nums[i+1]);
  }
  return {
    x: xs.reduce((a,b) => a+b, 0) / xs.length,
    y: ys.reduce((a,b) => a+b, 0) / ys.length,
  };
}

Object.assign(window, { ZoneMap, LZ_DISTRICTS, HUBS, ZONE_KEY, districtCentroid });
