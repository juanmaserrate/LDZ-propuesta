/* CuposPorBarrio — Reproduce el modulo "Cupos por Barrio" del sitio
   anterior (https://juanmaserrate.github.io/Rezonificacion-LDZ/) pero con
   la estetica del sitio nuevo (paleta celeste, navy, eyebrow Newsreader,
   cards blancas con borde, hover lift, tilt y reveal-on-scroll globales).

   Para cada localidad: una card grande con badge ||, contador de escuelas,
   5 KPI cards horizontales (Modulos, Comedor, DM s/Comedor, Patios,
   Desayuno y Merienda) y una tabla con todas las escuelas del barrio
   ordenadas por orden_localidad. */

function CuposPorBarrio() {
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    if (window.__colegiosCache?.colegios) {
      setData(window.__colegiosCache);
      return;
    }
    fetch("data/colegios.json?v=20")
      .then((r) => r.json())
      .then((d) => {
        window.__colegiosCache = d;
        setData(d);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const fmt = (n) => Math.round(n || 0).toLocaleString("es-AR");

  // Agrupacion por localidad
  const grupos = {};
  for (const c of data.colegios) {
    const loc = c.localidad || "Sin asignar";
    if (!grupos[loc]) grupos[loc] = [];
    grupos[loc].push(c);
  }
  // Orden: alfabetico de barrios reales primero, "Sin asignar" al final
  const barrios = Object.keys(grupos)
    .filter((l) => l !== "Sin asignar")
    .sort((a, b) => a.localeCompare(b, "es"));
  if (grupos["Sin asignar"] && grupos["Sin asignar"].length > 0) {
    barrios.push("Sin asignar");
  }

  // Totales por barrio
  const sumar = (arr, k) =>
    arr.reduce((acc, c) => acc + (c.cupos?.[k] || 0), 0);

  const KPI = ({ etiqueta, valor, color, modifier }) => (
    <div className={`cupos-kpi cupos-kpi--${modifier}`}>
      <div className="cupos-kpi-bar" style={{ background: color }} />
      <div className="cupos-kpi-eyebrow">{etiqueta}</div>
      <div className="cupos-kpi-valor" style={{ color }}>
        {fmt(valor)}
      </div>
    </div>
  );

  return (
    <section id="cupos-barrio" className="bg-bone cupos-section">
      <div className="shell">
        <div className="section-tag">
          <span className="num">B4</span>
          <span className="txt">CUPOS POR BARRIO</span>
        </div>
        <div className="section-head">
          <h2 className="display-lg">Cupos por barrio · padron completo</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            La distribucion de cupos del SAE escuela por escuela, agrupada
            por barrio. Modulos, comedor, dieta sin comedor, patios abiertos
            y desayuno y merienda — el padron completo del pliego, leido
            desde la geografia real del partido.
          </p>
        </div>

        {barrios.map((loc) => {
          const escs = grupos[loc].slice().sort(
            (a, b) =>
              (a.orden_localidad ?? 9999) - (b.orden_localidad ?? 9999)
          );
          const totales = {
            modulos: sumar(escs, "modulos"),
            comedor: sumar(escs, "comedor"),
            dmc: sumar(escs, "dmc"),
            patios: sumar(escs, "patios"),
            dmc_comedor: sumar(escs, "dmc_comedor"),
          };

          return (
            <article className="cupos-barrio-card" key={loc}>
              <header className="cupos-barrio-head">
                <div className="cupos-barrio-badge">
                  <span className="cupos-barrio-bars" aria-hidden="true">
                    ||
                  </span>
                  <span className="cupos-barrio-name">{loc}</span>
                </div>
                <div className="cupos-barrio-count">
                  {escs.length} escuela{escs.length !== 1 ? "s" : ""}
                </div>
              </header>

              <div className="cupos-kpis">
                <KPI
                  etiqueta="MODULOS MESA"
                  valor={totales.modulos}
                  color="var(--green)"
                  modifier="modulos"
                />
                <KPI
                  etiqueta="COMEDOR / DIA"
                  valor={totales.comedor}
                  color="var(--amber)"
                  modifier="comedor"
                />
                <KPI
                  etiqueta="DM SIN COMEDOR / DIA"
                  valor={totales.dmc}
                  color="var(--celeste-300)"
                  modifier="dmc"
                />
                <KPI
                  etiqueta="PATIOS ABIERTOS"
                  valor={totales.patios}
                  color="var(--celeste-400)"
                  modifier="patios"
                />
                <KPI
                  etiqueta="DESAYUNO Y MERIENDA"
                  valor={totales.dmc_comedor}
                  color="var(--celeste-200)"
                  modifier="dym"
                />
              </div>

              <div className="cupos-tabla-wrap">
                <table className="cupos-tabla">
                  <thead>
                    <tr>
                      <th className="cupos-col-num">#</th>
                      <th className="cupos-col-esc">Establecimiento</th>
                      <th className="cupos-col-n">Modulos</th>
                      <th className="cupos-col-n">Comedor</th>
                      <th className="cupos-col-n">DM s/C</th>
                      <th className="cupos-col-n">Patios</th>
                      <th className="cupos-col-n">DyM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escs.map((c, i) => {
                      const cu = c.cupos || {};
                      return (
                        <tr key={c.id}>
                          <td className="cupos-col-num">{i + 1}</td>
                          <td className="cupos-col-esc">
                            <span className="cupos-esc-nombre">{c.nombre}</span>
                            {c.direccion && (
                              <span className="cupos-esc-dir">
                                {c.direccion}
                              </span>
                            )}
                          </td>
                          <td className="cupos-col-n cupos-n-modulos">
                            {fmt(cu.modulos || 0)}
                          </td>
                          <td className="cupos-col-n cupos-n-comedor">
                            {fmt(cu.comedor || 0)}
                          </td>
                          <td className="cupos-col-n cupos-n-dmc">
                            {fmt(cu.dmc || 0)}
                          </td>
                          <td className="cupos-col-n cupos-n-patios">
                            {(cu.patios || 0) > 0 ? fmt(cu.patios) : "—"}
                          </td>
                          <td className="cupos-col-n cupos-n-dym">
                            {fmt(cu.dmc_comedor || 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

Object.assign(window, { CuposPorBarrio });
