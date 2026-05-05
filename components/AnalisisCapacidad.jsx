/* AnalisisCapacidad — Enfoque A+B sobre el PLIEGO VIGENTE.
   A: eficiencia geográfica del pliego (% escuelas con proveedor óptimo).
   B: dispersión geográfica por proveedor (radio natural, escuelas fuera del área). */

function AnalisisCapacidad() {
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    if (window.__colegiosCache?.analisis_capacidad) {
      setData(window.__colegiosCache.analisis_capacidad);
      return;
    }
    fetch("data/colegios.json?v=5")
      .then(r => r.json())
      .then(d => {
        window.__colegiosCache = d;
        if (d.analisis_capacidad) setData(d.analisis_capacidad);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const fmt = (n) => Math.round(n || 0).toLocaleString("es-AR");
  const fmtMoney = (n) => "$" + Math.round(n || 0).toLocaleString("es-AR");
  const ef = data.eficiencia;

  return (
    <section id="capacidad" className="bg-bone">
      <div className="shell">
        <div className="section-tag"><span className="num">04</span><span className="txt">CAPACIDAD OPERATIVA · PLIEGO VIGENTE</span></div>
        <div className="section-head">
          <h2 className="display-lg">El pliego vigente opera al borde de su capacidad</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Análisis geográfico puro sobre los datos del pliego: distancias reales entre cada
            una de las {data.total_escuelas} escuelas y los {data.total_proveedores} proveedores.
            Sin asumir flotas ni jornadas, los números muestran que el contrato vigente asigna
            mal las escuelas y obliga a recorrer kilómetros evitables todos los días.
          </p>
        </div>

        {/* BLOQUE A — Eficiencia del pliego (KPI hero) */}
        <div className="cap-eficiencia">
          <div className="cap-eficiencia-main">
            <div className="cap-eficiencia-eyebrow">Eficiencia geográfica del pliego</div>
            <div className="cap-eficiencia-pct-wrap">
              <span className="cap-eficiencia-pct">{ef.eficiencia_pct}%</span>
              <span className="cap-eficiencia-pct-sub">de las escuelas asignadas a su proveedor óptimo</span>
            </div>
            <p className="cap-eficiencia-narrative">
              <strong>{ef.escuelas_subóptimas} de {data.total_escuelas} escuelas</strong> están operadas hoy
              por un proveedor que <em>no es el más cercano</em> de los 6 disponibles. La asignación
              actual del pliego es geográficamente ineficiente: hay un proveedor más conveniente para
              el <strong>{ef.ineficiencia_pct}%</strong> de las escuelas.
            </p>
          </div>
          <div className="cap-eficiencia-stats">
            <div className="cap-eficiencia-stat">
              <div className="cap-eficiencia-stat-v">{fmt(ef.km_extra_dia)} km</div>
              <div className="cap-eficiencia-stat-l">recorridos por día evitables<br/><small>(diferencia entre asignación actual y óptima)</small></div>
            </div>
            <div className="cap-eficiencia-stat">
              <div className="cap-eficiencia-stat-v">{fmt(ef.km_pliego_dia)} → {fmt(ef.km_optimo_dia)} km</div>
              <div className="cap-eficiencia-stat-l">km/día actual vs km/día con asignación óptima</div>
            </div>
            <div className="cap-eficiencia-stat highlight">
              <div className="cap-eficiencia-stat-v">{fmtMoney(ef.ahorro_anual_potencial_ars)}</div>
              <div className="cap-eficiencia-stat-l">ahorro anual potencial<br/><small>({data.supuestos.dias_habiles} días × ${data.supuestos.costo_km_ars}/km)</small></div>
            </div>
          </div>
        </div>

        {/* BLOQUE B — Dispersión geográfica por proveedor */}
        <div className="cap-disp-head">
          <div className="eyebrow">Dispersión geográfica</div>
          <h3 className="display-sm">Cómo está repartida la zona de cada proveedor hoy</h3>
          <p style={{ marginTop: 10, fontSize: 14, color: "var(--celeste-100)", lineHeight: 1.55 }}>
            Para cada proveedor calculamos la distancia desde su sede a cada escuela que el pliego
            le asignó. <strong>Distancia máxima alta</strong> = escuelas tiradas lejos del centro de
            operación. <strong>Radio del 80%</strong> = el área natural donde concentra la mayoría
            de su trabajo.
          </p>
        </div>

        <div className="cap-prov-grid">
          {data.proveedores.map(p => {
            const tag = p.concentrado ? "concentrado" : (p.disperso ? "disperso" : "mixto");
            const tagLabel = p.concentrado ? "Concentrado" : (p.disperso ? "Disperso" : "Mixto");
            return (
              <div key={p.proveedor} className={"cap-prov-card cap-tag-" + tag}>
                <div className="cap-prov-head">
                  <div className="cap-prov-name">{p.proveedor}</div>
                  <div className={"cap-prov-flag tag-" + tag}>{tagLabel}</div>
                </div>
                {p.direccion && (
                  <div className="cap-prov-addr">{p.direccion.split(",")[0]}</div>
                )}
                <div className="cap-prov-metrics">
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Escuelas</span>
                    <strong>{p.escuelas} <span className="cap-prov-m-pct">({p.porcentaje_escuelas}%)</span></strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Cupos</span>
                    <strong>{fmt(p.cupos_total)}</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Dist. promedio</span>
                    <strong>{p.dist_avg_km.toFixed(1)} km</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Dist. máxima</span>
                    <strong className={p.dist_max_km > 6 ? "v-warn" : ""}>{p.dist_max_km.toFixed(1)} km</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Radio natural (80%)</span>
                    <strong>{p.radio_natural_km.toFixed(1)} km</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Fuera del área</span>
                    <strong>{p.escuelas_fuera_area} esc.</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Lectura final */}
        <div className="cap-diag">
          <div className="cap-diag-title">Lectura operativa</div>
          <ol>
            <li>
              <strong>El pliego asigna mal al {ef.ineficiencia_pct}% de las escuelas.</strong>
              {" "}De las {data.total_escuelas} escuelas, solo {ef.escuelas_optimas} están con
              el proveedor más cercano disponible. Es un dato puramente geográfico, sin asumir
              flotas ni jornadas.
            </li>
            <li>
              <strong>Los 6 proveedores operan dispersos.</strong> Todos tienen escuelas a más
              de 6 km de su sede. Ninguno opera concentrado en su área natural —el contrato
              vigente los obliga a salir de su zona para llegar a colegios que les quedan lejos.
            </li>
            <li>
              <strong>{fmt(ef.km_extra_dia)} km diarios evitables.</strong> La diferencia entre
              la asignación actual y la óptima son kilómetros que se recorren todos los días sin
              valor agregado: combustible, horas de conductor y desgaste de flota innecesarios.
            </li>
            <li>
              <strong>Lectura para el Municipio:</strong> rezonificar por barrio corrige la
              asignación geográfica y libera <strong>{fmtMoney(ef.ahorro_anual_potencial_ars)}/año</strong> en
              eficiencia operativa. Si además el Municipio evalúa sumar capacidad —nuevos
              proveedores o sucursales—, los proveedores operarían realmente concentrados en
              su área natural y la calidad sería uniforme en todo el partido.
            </li>
          </ol>
        </div>

        <p className="cap-foot">
          <strong>Metodología:</strong> distancia haversine × {data.supuestos.factor_urbano} (factor
          de calle urbana) × {data.supuestos.round_trip} (ida + vuelta). Eficiencia = % de
          escuelas cuyo proveedor del pliego coincide con el proveedor más cercano de los {data.total_proveedores} disponibles.
          Costo por km y días hábiles parametrizables.
        </p>
      </div>
    </section>
  );
}

Object.assign(window, { AnalisisCapacidad });
