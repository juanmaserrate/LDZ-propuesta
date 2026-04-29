/* Calculadora de impacto — slider de cobertura + KPIs derivados */

function ImpactCalculator() {
  const [coverage, setCoverage] = React.useState(75);    // % de cobertura objetivo
  const [shifts, setShifts]     = React.useState(2);     // 1, 2, 3 turnos
  const [refrig, setRefrig]     = React.useState(true);  // cadena de frío

  // Datos base: 84.920 chicos en edad escolar en LZ (placeholder)
  const TOTAL_KIDS = 84920;
  const reachedKids = Math.round(TOTAL_KIDS * (coverage / 100));

  // Personal directo: 1 cada 240 chicos atendidos por turno (placeholder razonable)
  const direct = Math.round((reachedKids / 240) * shifts);
  // Indirecto multiplicador 1.6
  const indirect = Math.round(direct * 1.6);

  // Inversión: $4.200 por chico/año (insumos + logística), prorrateado a infraestructura
  const annualSpendARS = reachedKids * 4200 * (refrig ? 1.18 : 1);
  // Tasas e ingresos brutos a municipio: 3.2% del gasto operativo
  const municipalRevenue = annualSpendARS * 0.032;

  // Tiempo de entrega: baseline 47, mejora con cobertura
  const deliveryMin = Math.max(12, Math.round(47 - (coverage / 100) * 32 + (shifts === 3 ? -2 : 0)));

  // CO2 reducción
  const co2 = Math.min(46, Math.round(coverage * 0.42 + (refrig ? 4 : 0) - (shifts === 3 ? 0 : 2)));

  const fmt = (n) => n.toLocaleString("es-AR");
  const fmtARS = (n) => "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });

  return (
    <div className="calc">
      <div className="calc-controls card-elev">
        <div className="eyebrow">Calculadora de impacto</div>
        <h4 className="display-sm" style={{ marginTop: 8, marginBottom: 22 }}>Ajustá las variables del despliegue</h4>

        <div className="ctrl">
          <div className="ctrl-head">
            <label htmlFor="cov">Cobertura territorial</label>
            <span className="mono ctrl-val">{coverage}%</span>
          </div>
          <input id="cov" type="range" min="20" max="100" step="5" value={coverage}
                 onChange={(e) => setCoverage(+e.target.value)}/>
          <div className="ctrl-foot mono">
            <span>Mínimo viable</span><span>Cobertura total</span>
          </div>
        </div>

        <div className="ctrl">
          <div className="ctrl-head">
            <label>Turnos operativos</label>
            <span className="mono ctrl-val">{shifts} {shifts === 1 ? "turno" : "turnos"}</span>
          </div>
          <div className="seg">
            {[1,2,3].map(n => (
              <button key={n} className={shifts === n ? "on" : ""} onClick={() => setShifts(n)}>{n} {n===1?"turno":"turnos"}</button>
            ))}
          </div>
        </div>

        <div className="ctrl">
          <div className="ctrl-head">
            <label>Cadena de frío refrigerada</label>
            <button className={`tog ${refrig ? "on" : ""}`} onClick={() => setRefrig(!refrig)} aria-pressed={refrig}>
              <span/>
            </button>
          </div>
          <div className="ctrl-help">Habilita raciones frescas y lácteos diarios. +18% inversión, +cobertura nutricional.</div>
        </div>
      </div>

      <div className="calc-output">
        <OutputCard label="Chicos alcanzados" value={fmt(reachedKids)} unit={`de ${fmt(TOTAL_KIDS)}`} accent="celeste"/>
        <OutputCard label="Tiempo medio de entrega" value={deliveryMin} unit="min" accent="amber"/>
        <OutputCard label="Empleo local directo" value={fmt(direct)} unit="puestos"/>
        <OutputCard label="Empleo indirecto" value={fmt(indirect)} unit="puestos asociados"/>
        <OutputCard label="Inversión operativa anual" value={fmtARS(annualSpendARS)} unit="ARS / año" wide/>
        <OutputCard label="Recaudación al municipio" value={fmtARS(municipalRevenue)} unit="tasas + IIBB / año" accent="green" wide/>
        <OutputCard label="Reducción de CO₂" value={`−${co2}`} unit="% vs. base actual" accent="green"/>
      </div>
    </div>
  );
}

function OutputCard({ label, value, unit, accent, wide }) {
  return (
    <div className={`out-card ${wide ? "wide" : ""} ${accent || ""}`}>
      <div className="out-l mono">{label}</div>
      <div className="out-v">{value}<span className="u">{unit}</span></div>
    </div>
  );
}

Object.assign(window, { ImpactCalculator });
