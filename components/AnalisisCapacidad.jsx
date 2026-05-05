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
    fetch("data/colegios.json?v=20")
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
        <div className="section-tag"><span className="num">A2</span><span className="txt">EFICIENCIA GEOGRÁFICA DEL PLIEGO</span></div>
        <div className="section-head">
          <h2 className="display-lg">El pliego vigente recorre kilómetros evitables todos los días</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Análisis geográfico puro sobre las {data.total_escuelas} escuelas y los {data.total_proveedores} proveedores.
            <strong> No analizamos cómo opera internamente cada empresa</strong> (cantidad de vehículos,
            jornadas, rutas internas), solo la distancia entre cada sede y las escuelas que el pliego
            le asignó. Los números muestran que el contrato vigente no respeta la geografía:
            el operador termina cubriendo escuelas que están más cerca de otro proveedor del mismo pliego.
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
              <strong>{ef.escuelas_suboptimas} de {data.total_escuelas} escuelas</strong> están operadas hoy
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

        {/* BLOQUE B — Distancias geográficas por proveedor (solo datos, sin juicio) */}
        <div className="cap-disp-head">
          <div className="eyebrow">Distancias geográficas</div>
          <h3 className="display-sm">Cuán lejos quedan las escuelas de cada sede</h3>
          <p style={{ marginTop: 10, fontSize: 14, color: "var(--celeste-100)", lineHeight: 1.55 }}>
            Distancias en línea recta corregidas por factor de calle urbana. Cada empresa decide
            cómo divide su flota; estos datos muestran únicamente <strong>cuánto territorio
            geográfico cubre cada uno</strong> según el pliego actual.
          </p>
        </div>

        <div className="cap-prov-grid">
          {data.proveedores.map(p => (
            <div key={p.proveedor} className="cap-prov-card cap-tag-mixto">
              <div className="cap-prov-head">
                <div className="cap-prov-name">{p.proveedor}</div>
                <div className="cap-prov-flag tag-mixto">{p.escuelas} escuelas</div>
              </div>
              {p.direccion && (
                <div className="cap-prov-addr">{p.direccion.split(",")[0]}</div>
              )}
              <div className="cap-prov-metrics">
                <div className="cap-prov-m">
                  <span className="cap-prov-m-k">% del padrón</span>
                  <strong>{p.porcentaje_escuelas}%</strong>
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
                  <strong>{p.dist_max_km.toFixed(1)} km</strong>
                </div>
                <div className="cap-prov-m">
                  <span className="cap-prov-m-k">Radio del 80%</span>
                  <strong>{p.radio_natural_km.toFixed(1)} km</strong>
                </div>
                <div className="cap-prov-m">
                  <span className="cap-prov-m-k">Esc. fuera del 80%</span>
                  <strong>{p.escuelas_fuera_area}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Lectura final — solo datos geográficos, sin juicios sobre la operación */}
        <div className="cap-diag">
          <div className="cap-diag-title">Qué dicen los números</div>
          <ol>
            <li>
              <strong>El pliego asigna fuera del óptimo geográfico al {ef.ineficiencia_pct}% de las escuelas.</strong>
              {" "}De las {data.total_escuelas} escuelas, solo {ef.escuelas_optimas} están con
              el proveedor más cercano de los {data.total_proveedores} disponibles. La asignación responde a
              criterios del pliego, no a la geografía real del partido.
            </li>
            <li>
              <strong>Todos los proveedores tienen escuelas asignadas a más de 6 km de su sede.</strong>
              {" "}Eso aplica para los 6 operadores y son distancias que la flota tiene que cubrir
              todos los días, independientemente de cómo internamente la empresa divida sus rutas.
            </li>
            <li>
              <strong>{fmt(ef.km_extra_dia)} km diarios son geográficamente evitables.</strong>
              {" "}Esa es la diferencia entre la asignación actual y una asignación al proveedor
              más cercano. Son kilómetros que recorre la flota total del SAE sin valor agregado.
            </li>
            <li>
              <strong>Lectura para el Municipio:</strong> rezonificar por barrio reduce los
              kilómetros estructurales del sistema y libera hasta
              <strong> {fmtMoney(ef.ahorro_anual_potencial_ars)}/año</strong> en eficiencia operativa.
              Es un argumento puramente geográfico, sin necesidad de revisar cómo cada empresa
              organiza su flota.
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
