/* ============================================
   TEMPLATE — Sections genéricas
   Reemplazá los textos placeholder con tu contenido.
   La estructura visual queda igual al diseño original.
   ============================================ */

// Componente: efecto máquina de escribir.
// Va revelando caracteres uno a uno. El cursor parpadea al final.
function Typewriter({ text, speed = 35, startDelay = 200 }) {
  const [shown, setShown] = React.useState(0);
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    setShown(0);
    setDone(false);
    let i = 0;
    let timer;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        i++;
        setShown(i);
        if (i >= text.length) {
          clearInterval(timer);
          setDone(true);
        }
      }, speed);
    }, startDelay);
    return () => { clearTimeout(start); if (timer) clearInterval(timer); };
  }, [text, speed, startDelay]);
  return (
    <span className="typewriter">
      {text.slice(0, shown)}
      <span className={"typewriter-caret" + (done ? " typewriter-caret-blink" : "")}/>
    </span>
  );
}

function Hero({ data }) {
  // Title como texto plano: premium.js lo convierte en SplitText para animar.
  return (
    <section className="hero bg-deep" id="inicio">
      <div className="shell">
        <div className="hero-grid hero-grid-single">
          <div className="hero-copy">
            {data.statusPill && (
              <span className="pill-status" style={{ background: "rgba(255,255,255,.06)", borderColor: "rgba(255,255,255,.14)", color: "var(--celeste-200)" }}>
                <span className="dot"/> {data.statusPill}
              </span>
            )}
            <h1 className="display-xl hero-title-split" style={{ color: "white", marginTop: data.statusPill ? 22 : 0 }}>
              {data.title}
            </h1>
          </div>
        </div>
      </div>
      <div className="flag-bar"/>
    </section>
  );
}

function HeroMap() {
  const mapEl = React.useRef(null);
  const mapRef = React.useRef(null);
  const [schools, setSchools] = React.useState([]);

  // Cargar colegios.json (reutiliza cache global)
  React.useEffect(() => {
    if (window.__colegiosCache) {
      setSchools(window.__colegiosCache.colegios || []);
      return;
    }
    fetch("data/colegios.json?v=21")
      .then(r => r.json())
      .then(d => {
        window.__colegiosCache = d;
        setSchools(d.colegios || []);
      })
      .catch(() => {});
  }, []);

  // Inicializar Leaflet (id propio: heroOverviewMap)
  React.useEffect(() => {
    if (!mapEl.current || mapRef.current || typeof L === "undefined") return;
    const bounds = L.latLngBounds([[-34.82, -58.50], [-34.70, -58.34]]);
    const map = L.map(mapEl.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      dragging: true,
      attributionControl: false,
    });
    map.fitBounds(bounds, { animate: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  }, []);

  // Render puntos celeste cuando lleguen los datos
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined" || !schools.length) return;
    const group = L.layerGroup();
    schools.forEach(s => {
      if (!s.lat || !s.lng) return;
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 3.2,
        color: "#74ACDF",
        weight: 1,
        fillColor: "#74ACDF",
        fillOpacity: 0.85,
      });
      m.bindPopup(`<div style="font-family:Inter,sans-serif;font-size:12px"><strong>${s.nombre || ""}</strong></div>`);
      group.addLayer(m);
    });
    group.addTo(map);
  }, [schools]);

  return (
    <div className="hero-map-wrap">
      <div ref={mapEl} id="heroOverviewMap" className="hero-map"/>
      <div className="hero-map-overlay"/>
    </div>
  );
}

function HeroVisual({ percent, centerLabel, satellites }) {
  return (
    <div className="hv-card">
      <div className="hv-head">
        <div className="hv-dot"/>
        <span className="mono" style={{ fontSize: 11, letterSpacing: ".14em", color: "var(--celeste-300)" }}>VISTA EN VIVO · {centerLabel}</span>
      </div>
      <div className="hv-body">
        <svg viewBox="0 0 460 300" xmlns="http://www.w3.org/2000/svg">
          <circle cx="230" cy="150" r="118" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1"/>
          <circle cx="230" cy="150" r="92"  fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1"/>
          <circle cx="230" cy="150" r="60"  fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1"/>
          <circle cx="230" cy="150" r="92" fill="none" stroke="rgba(116,172,223,.18)" strokeWidth="14"/>
          <circle cx="230" cy="150" r="92" fill="none" stroke="#74ACDF" strokeWidth="14"
                  strokeDasharray={`${(percent/100) * 2 * Math.PI * 92} ${2 * Math.PI * 92}`}
                  strokeLinecap="round"
                  transform="rotate(-90 230 150)"/>
          <text x="230" y="142" textAnchor="middle" fontSize="48" fontWeight="700" fill="white" fontFamily="var(--f-display)" letterSpacing="-2">{percent}%</text>
          <text x="230" y="170" textAnchor="middle" fontSize="11" fill="var(--celeste-300)" fontFamily="var(--f-mono)" letterSpacing="2">{centerLabel}</text>

          {satellites.map((s, i) => {
            const r = 145;
            const x = 230 + r * Math.cos(s.a * Math.PI / 180);
            const y = 150 + r * Math.sin(s.a * Math.PI / 180);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="28" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.14)"/>
                <text x={x} y={y - 1} textAnchor="middle" fontSize="13" fontWeight="600" fill="white" fontFamily="var(--f-display)">{s.label}</text>
                <text x={x} y={y + 13} textAnchor="middle" fontSize="9" fill="var(--celeste-300)" fontFamily="var(--f-mono)" letterSpacing="1">{s.sub.toUpperCase()}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="hv-foot">
        <span className="mono">Modelo proyectado · escenario base</span>
      </div>
    </div>
  );
}

function Diagnostico({ data }) {
  return (
    <section id="diagnostico" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">A1</span><span className="txt">{data.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">{data.title}</h2>
          <p className="lead" style={{ marginTop: 18 }}>{data.lead}</p>
        </div>
        <div className="diag-cards">
          {data.items.map(i => (
            <div key={i.n} className="diag-card">
              <div className="diag-n mono">{i.n}</div>
              <div className="diag-t">{i.t}</div>
              <div className="diag-c">{i.c}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Propuesta({ data }) {
  return (
    <section id="propuesta" className="bg-bone">
      <div className="shell">
        <div className="section-tag"><span className="num">03</span><span className="txt">{data.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">{data.title}</h2>
          <p className="lead" style={{ marginTop: 18 }} dangerouslySetInnerHTML={{ __html: data.lead }}/>
        </div>

        <div className="prop-grid">
          {data.cards.map(p => (
            <div className="prop-card" key={p.code}>
              <div className="prop-code mono" style={{ background: p.color }}>{p.code}</div>
              <div className="prop-title">{p.title}</div>
              <div className="prop-desc">{p.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Beneficios({ data }) {
  return (
    <section id="beneficios" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">05</span><span className="txt">{data.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">{data.title}</h2>
          {data.lead ? <p className="lead" style={{ marginTop: 18 }}>{data.lead}</p> : null}
        </div>

        <div className="benef-grid">
          {data.items.map((b, i) => (
            <div key={i} className="benef-card">
              <BenefIcon name={b.icon}/>
              <div className="benef-tag mono">{b.tag}</div>
              <div className="benef-t">{b.title}</div>
              <div className="benef-d">{b.desc}</div>
              <div className="benef-stat">
                <span className="bs-v">{b.stat}</span>
                <span className="bs-l">{b.statL}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BenefIcon({ name }) {
  const common = { width: 36, height: 36, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "leaf")   return (<svg {...common}><path d="M11 20a8 8 0 0 0 8-8c0-4.5-3-8-8-9-1 5-5 6-5 11a6 6 0 0 0 5 6"/><path d="M6 18c2-3 5-5 9-6"/></svg>);
  if (name === "shield") return (<svg {...common}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>);
  if (name === "road")   return (<svg {...common}><path d="M5 21 8 3"/><path d="m16 3 3 18"/><path d="M12 5v3"/><path d="M12 12v3"/><path d="M12 19v2"/></svg>);
  if (name === "spark")  return (<svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>);
  if (name === "chart")  return (<svg {...common}><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-7"/></svg>);
  if (name === "users")  return (<svg {...common}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14a4 4 0 0 1 6 4"/></svg>);
  return null;
}

function ImpactoUrbano({ data }) {
  return (
    <section id="impacto" className="bg-deep">
      <div className="shell">
        <div className="section-tag">
          <span className="num" style={{ background: "rgba(255,255,255,.05)", borderColor: "rgba(255,255,255,.12)", color: "var(--celeste-200)" }}>05</span>
          <span className="txt" style={{ color: "var(--celeste-300)" }}>{data.tag}</span>
        </div>

        <div className="section-head" style={{ marginBottom: 56 }}>
          <h2 className="display-lg" style={{ color: "white" }}>{data.title}</h2>
          <p className="lead" style={{ marginTop: 18 }}>{data.lead}</p>
        </div>

        <BeforeAfter/>

        <div className="impacto-kpis">
          {data.kpis.map((k, i) => (
            <div key={i} className="impacto-kpi-card">
              <div className="v">{k.v}</div>
              <div className="l">{k.l}</div>
              <div className="d">{k.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CalculadoraSection({ data }) {
  return (
    <section id="calculadora" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">04</span><span className="txt">{data.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">{data.title}</h2>
          <p className="lead" style={{ marginTop: 18 }}>{data.lead}</p>
        </div>
        <ImpactCalculator/>
      </div>
    </section>
  );
}

function DashboardSection({ data }) {
  return (
    <section id="dashboard" className="bg-bone">
      <div className="shell">
        <div className="section-tag"><span className="num">03</span><span className="txt">{data.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">{data.title}</h2>
          <p className="lead" style={{ marginTop: 18 }}>{data.lead}</p>
        </div>
        <Dashboard/>
      </div>
    </section>
  );
}

function Cierre({ data }) {
  return (
    <section id="cierre" className="bg-deep" style={{ paddingBottom: 0 }}>
      <div className="shell">
        <div className="cierre-grid">
          <div>
            <div className="eyebrow on-dark">{data.eyebrow}</div>
            <h2 className="display-lg" style={{ color: "white", marginTop: 14 }}>{data.title}</h2>
            <p className="lead" style={{ marginTop: 24 }}>{data.lead}</p>
          </div>
          <div className="step-list">
            {data.steps.map(s => (
              <div key={s.n} className="step">
                <div className="step-n mono">{s.n}</div>
                <div>
                  <div className="step-t">{s.t}</div>
                  <div className="step-d">{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Footer data={data.footer}/>
    </section>
  );
}

function Footer({ data }) {
  return (
    <footer className="foot" style={{ marginTop: 80 }}>
      <div className="shell">
        <div className="row row-3" style={{ gap: 40 }}>
          <div>
            <div className="brand-lock" style={{ marginBottom: 16 }}>
              <div className="brand-mark" style={{ background: "white", color: "var(--celeste-900)" }}>{data.brandMark}</div>
              <div className="brand-text">
                <span className="b1" style={{ color: "white" }}>{data.brandName}</span>
                <span className="b2" style={{ color: "var(--celeste-300)" }}>{data.brandTagline}</span>
              </div>
            </div>
            <p style={{ color: "var(--celeste-200)", fontSize: 14, lineHeight: 1.6, maxWidth: 360 }}>{data.about}</p>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 11, color: "var(--celeste-300)", letterSpacing: ".14em", marginBottom: 14 }}>SECCIONES</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {data.links.map((l, i) => <li key={i}><a href={l.href}>{l.label}</a></li>)}
            </ul>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 11, color: "var(--celeste-300)", letterSpacing: ".14em", marginBottom: 14 }}>{data.contactTitle}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, color: "var(--celeste-200)", fontSize: 14 }}>
              {data.contact.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        </div>
        <div className="fine">
          <span>{data.legalLeft}</span>
          <span>{data.legalRight}</span>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { Hero, Diagnostico, Propuesta, Beneficios, ImpactoUrbano, CalculadoraSection, DashboardSection, Cierre, Footer });
