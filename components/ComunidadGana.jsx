/* ComunidadGana — Sección "Lo que gana la comunidad".
   Tono comunicacional alineado al "Gobierno de la Comunidad" del
   Municipio de Lomas de Zamora: vecinos, comunidad educativa,
   Estado presente, derechos garantizados, construir junto a.
   12 cards organizadas en 3 ejes: Chicos / Escuelas / Familias. */

function ComunidadGana() {
  const ejes = [
    {
      eyebrow: "PARA LOS CHICOS Y CHICAS",
      titulo: "Una vianda que respeta el tiempo de la infancia",
      lead: "El derecho a comer caliente, en hora y entre compañeros — sin perder ni un minuto del recreo ni de la clase siguiente.",
      icon: "smile",
      cards: [
        {
          icon: "clock",
          title: "La vianda llega antes del recreo",
          desc: "Los chicos comen sin acortar el tiempo de juego y sin demorar la clase que sigue. La rutina escolar se respeta tal como las maestras la planificaron.",
        },
        {
          icon: "thermometer",
          title: "Comida fresca y a temperatura justa",
          desc: "Recorridos cortos, dentro del barrio: la cadena de frío se preserva, la comida llega como salió de la cocina. Mejor sabor, mejor nutrición para nuestros pibes.",
        },
        {
          icon: "users",
          title: "Igualdad entre escuelas vecinas",
          desc: "Cada escuela del barrio recibe en la misma franja horaria. Se termina la inequidad de chicos comiendo a las 11:30 mientras otros esperan a las 13:00.",
        },
        {
          icon: "shield",
          title: "Más días con vianda asegurada",
          desc: "Si una camioneta falla, otra del mismo barrio cubre. El derecho a la alimentación de cada chico no se cae por un imprevisto operativo.",
        },
      ],
    },
    {
      eyebrow: "PARA DOCENTES Y DIRECTIVOS",
      titulo: "Una sola contraparte, conocida, cercana al barrio",
      lead: "La comunidad educativa de Lomas trabaja todos los días para sostener la escuela pública. Que la logística no le sume tareas: que se la simplifique.",
      icon: "message",
      cards: [
        {
          icon: "user-check",
          title: "Un solo interlocutor por barrio",
          desc: "Las directoras dejan de coordinar con varios proveedores en paralelo. Una sola contraparte conocida por zona, con nombre y número directo.",
        },
        {
          icon: "zap",
          title: "Reclamos resueltos en horas, no días",
          desc: "Cuando algo falta o no llega bien, la respuesta es inmediata: el equipo está cerca y conoce a la escuela. Sin escaladas largas ni planillas cruzadas.",
        },
        {
          icon: "list-checks",
          title: "Tiempo de aula recuperado",
          desc: "Menos minutos perdidos coordinando logística, más minutos para enseñar. La energía del equipo docente vuelve a donde tiene que estar: en los chicos.",
        },
        {
          icon: "compass",
          title: "Acompañamiento institucional sostenido",
          desc: "Equipos estables que conocen a la comunidad de cada escuela, sus tiempos, sus necesidades. Continuidad del vínculo año a año, sin empezar de cero.",
        },
      ],
    },
    {
      eyebrow: "PARA LAS FAMILIAS",
      titulo: "Estado presente, palpable, cerca del vecino",
      lead: "Que cada vecino y vecina de Lomas pueda mirar el sistema y entender cómo funciona. Que sienta que su barrio tiene un servicio propio, con respuesta cuando hace falta.",
      icon: "sun",
      cards: [
        {
          icon: "scale",
          title: "Cada peso del SAE, mejor aprovechado",
          desc: "La inversión que el Estado destina a la alimentación escolar rinde más cuando la logística es eficiente. Los recursos públicos llegan a la mesa de los chicos, no se diluyen en kilómetros evitables.",
        },
        {
          icon: "eye",
          title: "Trazabilidad para mamás y papás",
          desc: "Ante una duda sobre la vianda del día, hay una vía clara de respuesta. La familia no queda en el aire: el barrio tiene su equipo y su canal de contacto.",
        },
        {
          icon: "navigation",
          title: "Un servicio que se siente cerca",
          desc: "Cada barrio tiene su equipo, su camioneta, sus horarios. El vecino reconoce el servicio como propio. Estado presente, no solo en el discurso: en la calle, todos los días.",
        },
        {
          icon: "shield",
          title: "Más capacidad de control municipal",
          desc: "El área de Educación del Municipio puede auditar más escuelas con el mismo equipo. Garantía de calidad para las familias, con recursos públicos cuidados.",
        },
      ],
    },
  ];

  // DemoBenefitIcon vive en DemoComparativa.jsx y queda expuesto en window.
  const Icon = (window.DemoBenefitIcon) ? window.DemoBenefitIcon : (() => null);

  return (
    <section id="comunidad" className="bg-bone com-section">
      <div className="shell">
        <div className="section-tag">
          <span className="num">05</span>
          <span className="txt">LO QUE GANA LA COMUNIDAD</span>
        </div>
        <div className="section-head">
          <h2 className="display-lg">
            Lo que gana la comunidad
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Rezonificar por barrio no es un cambio técnico abstracto: es una mejora
            concreta para los chicos que comen, para las escuelas que los reciben
            y para las familias que los acompañan. Una propuesta alineada con el
            <strong> Gobierno de la Comunidad</strong>: Estado presente, derechos
            garantizados, vecinos cerca.
          </p>
        </div>

        {ejes.map((eje, ei) => (
          <div className="com-eje" key={ei}>
            <div className="com-eje-head">
              <div className="com-eje-icon" aria-hidden="true">
                <Icon name={eje.icon}/>
              </div>
              <div className="com-eje-text">
                <div className="eyebrow com-eje-eyebrow">{eje.eyebrow}</div>
                <h3 className="display-sm com-eje-titulo">{eje.titulo}</h3>
                <p className="com-eje-lead">{eje.lead}</p>
              </div>
            </div>
            <div className="com-grid">
              {eje.cards.map((c, i) => (
                <div className="com-card" key={i} style={{ "--i": i }}>
                  <div className="com-card-icon">
                    <Icon name={c.icon}/>
                  </div>
                  <div className="com-card-title">{c.title}</div>
                  <div className="com-card-desc">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="com-cierre">
          <div className="com-cierre-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>
            </svg>
          </div>
          <p className="com-cierre-text">
            Lomas se construye junto a su gente. Esta propuesta respeta esa lógica:
            llevar la decisión técnica al lugar donde la comunidad la siente —
            <strong> el barrio</strong> — para que el SAE deje de ser un sistema
            lejano y se convierta en un servicio cercano, controlable, palpable.
          </p>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { ComunidadGana });
