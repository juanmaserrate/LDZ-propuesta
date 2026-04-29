/* Slider antes/después — comparación visual */

function BeforeAfter() {
  const [pos, setPos] = React.useState(50);
  const containerRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);

  const handleMove = (clientX) => {
    if (!containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    setPos((x / r.width) * 100);
  };

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      handleMove(cx);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging]);

  return (
    <div className="ba-wrap">
      <div className="ba-frame" ref={containerRef}
           onMouseDown={(e) => { setDragging(true); handleMove(e.clientX); }}
           onTouchStart={(e) => { setDragging(true); handleMove(e.touches[0].clientX); }}>
        {/* AFTER (full background) */}
        <BAScene state="after" />

        {/* BEFORE (clipped from left) */}
        <div className="ba-clip" style={{ width: `${pos}%` }}>
          <BAScene state="before" />
        </div>

        {/* Handle */}
        <div className="ba-handle" style={{ left: `${pos}%` }}>
          <div className="ba-handle-bar"/>
          <div className="ba-handle-knob" aria-label="Arrastrar para comparar">
            <span>‹</span><span>›</span>
          </div>
        </div>

        {/* Labels */}
        <div className="ba-label ba-label-l">
          <span className="mono ba-tag">ANTES</span>
          <span>Logística fragmentada</span>
        </div>
        <div className="ba-label ba-label-r">
          <span className="mono ba-tag on">DESPUÉS</span>
          <span>Red de proximidad</span>
        </div>
      </div>

      <input type="range" min="0" max="100" value={pos}
             onChange={(e) => setPos(+e.target.value)}
             className="ba-range"
             aria-label="Comparar antes y después" />
    </div>
  );
}

function BAScene({ state }) {
  const isAfter = state === "after";
  // 11 grid cells representing districts; we show route lines + hub pins.
  const cells = [
    { x:  90, y: 110 }, { x: 250, y:  90 }, { x: 410, y: 105 }, { x: 580, y:  95 }, { x: 750, y: 120 },
    { x: 130, y: 260 }, { x: 320, y: 245 }, { x: 510, y: 270 }, { x: 690, y: 280 },
    { x: 220, y: 410 }, { x: 460, y: 430 }, { x: 660, y: 420 },
  ];
  const beforeOrigin = { x: 850, y: 480 }; // depósito único, lejos
  const afterHubs = [{ x: 250, y: 200 }, { x: 510, y: 200 }, { x: 660, y: 350 }];

  return (
    <div className={`ba-scene ${isAfter ? "after" : "before"}`}>
      <svg viewBox="0 0 900 500" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="ba-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={isAfter ? "rgba(255,255,255,0.10)" : "rgba(11,26,44,.06)"} strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="900" height="500" fill={isAfter ? "#0E3A6B" : "#EEF3F8"}/>
        <rect width="900" height="500" fill="url(#ba-grid)"/>

        {/* District cells */}
        {cells.map((c, i) => (
          <rect key={i} x={c.x - 50} y={c.y - 36} width="100" height="72" rx="8"
                fill={isAfter ? "rgba(116,172,223,0.18)" : "rgba(151,164,184,0.18)"}
                stroke={isAfter ? "rgba(116,172,223,0.6)" : "rgba(151,164,184,0.55)"}
                strokeWidth="1"/>
        ))}

        {!isAfter && (
          <>
            {/* tangled long routes from a single far depot */}
            {cells.map((c, i) => (
              <path key={i}
                    d={`M ${beforeOrigin.x} ${beforeOrigin.y} Q ${(beforeOrigin.x + c.x)/2 + (i%2 ? 60 : -40)} ${(beforeOrigin.y + c.y)/2 + (i%3 ? -40 : 30)} ${c.x} ${c.y}`}
                    fill="none" stroke="#D85A4A" strokeWidth="1.6" strokeDasharray="3 4" opacity="0.55"/>
            ))}
            <circle cx={beforeOrigin.x} cy={beforeOrigin.y} r="14" fill="#D85A4A" stroke="white" strokeWidth="2"/>
            <text x={beforeOrigin.x} y={beforeOrigin.y + 32} textAnchor="middle" fontSize="11" fill="#0B1A2C" fontFamily="var(--f-mono)" fontWeight="600">DEPÓSITO ÚNICO</text>
            <text x={beforeOrigin.x} y={beforeOrigin.y + 46} textAnchor="middle" fontSize="10" fill="#5A6B82" fontFamily="var(--f-mono)">Tiempo medio: 47 min</text>
          </>
        )}

        {isAfter && (
          <>
            {/* short routes from 3 hubs */}
            {afterHubs.map((h, hi) => {
              const groupCells = cells.filter((c) => {
                const dist = Math.hypot(c.x - h.x, c.y - h.y);
                return dist < 260;
              }).slice(0, 5);
              return groupCells.map((c, i) => (
                <line key={`${hi}-${i}`} x1={h.x} y1={h.y} x2={c.x} y2={c.y}
                      stroke="#F2A93B" strokeWidth="1.6" strokeDasharray="3 3" opacity="0.7"/>
              ));
            })}
            {afterHubs.map((h, i) => (
              <g key={i}>
                <circle cx={h.x} cy={h.y} r="40" fill="rgba(242,169,59,0.18)"/>
                <circle cx={h.x} cy={h.y} r="14" fill="#F2A93B" stroke="white" strokeWidth="2.5"/>
                <text x={h.x} y={h.y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0E3A6B">★</text>
                <text x={h.x} y={h.y + 32} textAnchor="middle" fontSize="10.5" fill="#DCEBF7" fontFamily="var(--f-mono)" letterSpacing="0.5" fontWeight="600">HUB {i+1}</text>
              </g>
            ))}
            <text x="50" y="470" fontSize="11" fill="#74ACDF" fontFamily="var(--f-mono)" fontWeight="600">Tiempo medio: 18 min · CO₂ −38% · 100% cobertura</text>
          </>
        )}
      </svg>
    </div>
  );
}

Object.assign(window, { BeforeAfter });
