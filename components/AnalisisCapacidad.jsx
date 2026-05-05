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
          <h2 className="display-lg">Capacidad operativa con el pliego vigente</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Análisis sobre la situación actual: cada escuela operada por el proveedor que le
            asigna el pliego hoy. <strong>{sobrecargados.length} de {data.total_proveedores} proveedores</strong>
            {" "}operan por encima de una jornada razonable y <strong>{data.n_escuelas_lejanas_total} escuelas</strong>
            {" "}quedan a más de 3 km de su proveedor. Esto fundamenta a la vez la necesidad de
            rezonificar y de sumar capacidad adicional al sistema.
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
              <strong>{data.proveedores[0].proveedor} concentra el {data.proveedores[0].porcentaje_escuelas}% de las escuelas</strong>
              {" "}({data.proveedores[0].escuelas} de {data.total_escuelas}). Aún con flota propia, su jornada teórica
              con un solo vehículo desborda el umbral de 8h, evidenciando que el pliego no equilibró carga.
            </li>
            <li>
              <strong>Los {data.proveedores_sobrecargados.length} proveedores quedan por encima del techo de 8h diarias</strong>
              {" "}cuando se calcula el recorrido real entre su sede y las escuelas que el pliego les asignó. La carga
              está distribuida sin criterio geográfico.
            </li>
            <li>
              <strong>{data.n_escuelas_lejanas_total} escuelas operan a más de 3 km</strong> del proveedor que les
              corresponde — el {Math.round(data.n_escuelas_lejanas_total / data.total_escuelas * 100)}% del padrón. Recorridos largos comprometen la cadena térmica
              y el horario de entrega.
            </li>
            <li>
              <strong>Lectura para el Municipio:</strong> el pliego vigente carga a todos los proveedores por encima
              de su capacidad razonable y deja muchas escuelas mal cubiertas. La rezonificación corrige la asignación
              geográfica, pero la asimetría de cantidad de escuelas por proveedor amerita evaluar sumar capacidad
              adicional —nuevos proveedores o sucursales— para sostener calidad uniforme en todo el partido.
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
