/* BloqueAntesDespues — encabezado conceptual que agrupa el Diagnóstico
   (problemas actuales) y la sección de Beneficios (lo que gana el Municipio)
   como dos caras del mismo análisis. */

function BloqueAntesDespues() {
  return (
    <section id="antes-despues" className="bg-bone bloque-intro">
      <div className="shell">
        <div className="bloque-intro-tag mono">EL ANTES Y EL DESPUÉS</div>
        <h2 className="display-lg bloque-intro-title">
          De los problemas concretos del pliego a los beneficios concretos para Lomas
        </h2>
        <p className="bloque-intro-lead">
          Primero vemos qué le pasa al sistema hoy: doce diagnósticos operativos
          que el pliego vigente no resuelve. Después, la otra cara de la misma moneda:
          treinta razones por las que reagrupar por barrio devuelve esos costos al
          Municipio en forma de mejor servicio, sin tocar el contrato.
        </p>
        <div className="bloque-intro-arrows">
          <div className="bloque-intro-step">
            <span className="bloque-intro-step-num mono">01</span>
            <span className="bloque-intro-step-label">Problemas actuales</span>
          </div>
          <span className="bloque-intro-arrow" aria-hidden="true">↓</span>
          <div className="bloque-intro-step">
            <span className="bloque-intro-step-num mono">02</span>
            <span className="bloque-intro-step-label">Lo que gana el Municipio</span>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { BloqueAntesDespues });
