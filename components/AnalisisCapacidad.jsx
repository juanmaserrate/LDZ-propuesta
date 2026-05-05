/* AnalisisCapacidad — análisis de carga operativa por proveedor en el escenario propuesto.
   Muestra qué proveedores quedan sobrecargados y fundamenta la necesidad de sumar hubs/proveedores. */

function AnalisisCapacidad() {
  const [data, setData] = React.useState(null);
  const [provLocations, setProvLocations] = React.useState({});

  React.useEffect(() => {
    if (window.__colegiosCache?.analisis_capacidad) {
      setData(window.__colegiosCache.analisis_capacidad);
      setProvLocations(window.__colegiosCache.proveedores_locations || {});
      return;
    }
    fetch("data/colegios.json?v=5")
      .then(r => r.json())
      .then(d => {
        window.__colegiosCache = d;
        if (d.analisis_capacidad) setData(d.analisis_capacidad);
        if (d.proveedores_locations) setProvLocations(d.proveedores_locations);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const fmt = (n) => Math.round(n || 0).toLocaleString("es-AR");
  const fmtH = (n) => (n || 0).toFixed(1) + "h";
  const sobrecargados = data.proveedores.filter(p => p.sobrecargado);

  return (
    <section id="capacidad" className="bg-bone">
      <div className="shell">
        <div className="section-tag"><span className="num">04</span><span className="txt">CAPACIDAD OPERATIVA</span></div>
        <div className="section-head">
          <h2 className="display-lg">¿Alcanza con la rezonificación?</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Aun reasignando cada escuela al proveedor más cercano, la propuesta deja en
            evidencia que <strong>{sobrecargados.length} de {data.total_proveedores} proveedores</strong>
            {" "}quedan operando por encima de una jornada razonable. La conclusión es operativa:
            la rezonificación es necesaria pero no suficiente — el Municipio debería evaluar
            sumar hubs adicionales para sostener calidad uniforme.
          </p>
        </div>

        {/* KPIs globales */}
        <div className="cap-kpis">
          <div className="cap-kpi">
            <div className="cap-kpi-v">{sobrecargados.length} <span className="cap-kpi-of">/ {data.total_proveedores}</span></div>
            <div className="cap-kpi-l">Proveedores sobrecargados</div>
          </div>
          <div className="cap-kpi">
            <div className="cap-kpi-v">{data.n_escuelas_lejanas_total}</div>
            <div className="cap-kpi-l">Escuelas a más de 3 km del proveedor más cercano</div>
          </div>
          <div className="cap-kpi">
            <div className="cap-kpi-v">{fmt(data.total_km_dia)} km</div>
            <div className="cap-kpi-l">Total recorrido por la flota / día</div>
          </div>
          <div className="cap-kpi">
            <div className="cap-kpi-v">{fmtH(data.total_horas_jornada)}</div>
            <div className="cap-kpi-l">Horas-vehículo necesarias / día</div>
          </div>
        </div>

        {/* Cards por proveedor */}
        <div className="cap-prov-grid">
          {data.proveedores.map(p => {
            const loc = provLocations[p.proveedor];
            return (
              <div key={p.proveedor} className={"cap-prov-card" + (p.sobrecargado ? " is-overloaded" : "")}>
                <div className="cap-prov-head">
                  <div className="cap-prov-name">{p.proveedor}</div>
                  <div className={"cap-prov-flag " + (p.sobrecargado ? "warn" : "ok")}>
                    {p.sobrecargado ? "Sobrecargado" : "Capacidad ok"}
                  </div>
                </div>
                {loc?.direccion && (
                  <div className="cap-prov-addr">{loc.direccion.split(",")[0]}</div>
                )}
                <div className="cap-prov-metrics">
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Escuelas</span>
                    <strong>{p.escuelas} <span className="cap-prov-m-pct">({p.porcentaje_escuelas}%)</span></strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Cupos diarios</span>
                    <strong>{fmt(p.cupos_total)}</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Jornada estimada</span>
                    <strong className={p.sobrecargado ? "v-warn" : "v-ok"}>{fmtH(p.horas_jornada_est)}</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Km/día</span>
                    <strong>{fmt(p.km_dia)}</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Distancia máx.</span>
                    <strong>{p.distancia_km_max.toFixed(1)} km</strong>
                  </div>
                  <div className="cap-prov-m">
                    <span className="cap-prov-m-k">Escuelas a &gt;3 km</span>
                    <strong>{p.escuelas_lejanas_3km}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Diagnóstico operativo */}
        <div className="cap-diag">
          <div className="cap-diag-title">Lectura operativa</div>
          <ol>
            <li>
              <strong>Centurión concentra el 39% de las escuelas</strong> ({data.proveedores[0].escuelas} de
              {" "}{data.total_escuelas}). Con una sola sede operativa, su jornada estimada supera ampliamente las 8h
              razonables. Necesita <em>varios vehículos en paralelo</em> o un hub satélite.
            </li>
            <li>
              <strong>Cuatro proveedores quedan por encima del techo de 8h diarias</strong>. Aún con la
              rezonificación óptima, su capacidad teórica con un solo vehículo no alcanza para
              cubrir su zona en una sola jornada.
            </li>
            <li>
              <strong>{data.n_escuelas_lejanas_total} escuelas siguen a más de 3 km</strong> de su proveedor
              más cercano. Eso son recorridos largos que afectan la cadena térmica y el horario de entrega.
            </li>
            <li>
              <strong>Lectura para el Municipio:</strong> la rezonificación es una mejora necesaria pero
              no resuelve sola la asimetría de carga. Sumar capacidad adicional —vía nuevos proveedores
              o sucursales— ayudaría a equilibrar la operación y a sostener calidad uniforme en barrios
              hoy mal cubiertos.
            </li>
          </ol>
        </div>

        <p className="cap-foot">
          <strong>Metodología:</strong> velocidad urbana {data.supuestos.velocidad_kmh} km/h,
          {" "}{data.supuestos.min_por_entrega} min por entrega, distancia haversine × {data.supuestos.factor_urbano}
          {" "}(factor de calle), umbral de "lejana" {data.supuestos.dist_lejana_km} km.
          Las horas estimadas asumen <em>un vehículo por proveedor</em> — los proveedores
          que hoy operan con flota mayor no estarán necesariamente sobrecargados, pero sí
          subutilizan capacidad si su zona es chica.
        </p>
      </div>
    </section>
  );
}

Object.assign(window, { AnalisisCapacidad });
