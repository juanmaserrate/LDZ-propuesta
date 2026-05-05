/* BloqueAntesDespues — encabezado conceptual que agrupa el Diagnóstico
   (problemas actuales) y la sección de Beneficios (lo que gana el Municipio)
   como dos caras del mismo análisis. */

function BloqueAntesDespues() {
  return (
    <section id="antes-despues" className="bg-bone bloque-intro">
      <div className="shell">
        <div className="bloque-intro-tag mono">EL ANTES Y EL DESPUÉS</div>
        <h2 className="display-lg bloque-intro-title">
          Del diagnóstico del pliego vigente a los beneficios concretos para Lomas
        </h2>
        <p className="bloque-intro-lead">
          Primero la foto de hoy: los problemas operativos del pliego y la ineficiencia
          geográfica medida sobre las distancias reales. Después la otra cara: lo que
          gana el Municipio al rezonificar, cuánto ahorro libera y cómo se siente esa
          mejora en cada barrio.
        </p>
        <div className="bloque-intro-arrows">
          <div className="bloque-intro-step">
            <span className="bloque-intro-step-num mono">A</span>
            <span className="bloque-intro-step-label">Antes · Diagnóstico y eficiencia del pliego</span>
          </div>
          <span className="bloque-intro-arrow" aria-hidden="true">↓</span>
          <div className="bloque-intro-step">
            <span className="bloque-intro-step-num mono">B</span>
            <span className="bloque-intro-step-label">Después · Beneficios, ahorro y comunidad</span>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { BloqueAntesDespues });
