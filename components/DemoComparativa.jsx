/* DemoComparativa — Vista en vivo unica que recorre primero las 12 zonas
   del pliego y luego las localidades de la propuesta R14.
   Replica la mecanica de playPresentation() + renderMap() del repo viejo
   (js/app.js lineas 1877-1986 y 399-525) pero con estetica celeste
   institucional (NO dark mode).

   Mejoras frente a la version anterior:
   - UNA SOLA polyline persistente reutilizada en cada paso (setLatLngs +
     setStyle). No se crea/destruye en cada zona, asi nunca queda una ruta
     vieja superpuesta.
   - Markers en un layerGroup unico que se limpia con clearLayers() en
     cada paso.
   - Pre-fetch en background de TODAS las rutas OSRM (~31) antes de
     arrancar la presentacion. Mientras tanto, se muestra un mini loader
     "Cargando rutas...". El demo arranca igual con fallback de linea
     recta si los fetches todavia no llegaron.
   - Fallback inmediato: cada paso pinta primero la polyline recta
     depot->p1->...->pN->depot. Si la ruta OSRM real llega despues, la
     reemplaza. Asi el demo NUNCA queda sin linea.
   - Sequence guard: cada paso tiene un seq numerico. Si llega la
     respuesta OSRM de un paso anterior, se ignora.
   - Orden pre-calculado: se usa s.orden_pliego / s.orden_localidad
     directamente del JSON. NO se hace nearest-neighbor en el cliente. */

const DEMO_OVERLAY_BASE_MS = 13000; // tiempo base del cartel para el texto más corto (13s)
const DEMO_OVERLAY_PER_CHAR_MS = 30; // ms adicionales por cada caracter por encima del mínimo
const DEMO_OVERLAY_MIN_CHARS = 80;  // referencia: longitud "corta" del diagnóstico
const DEMO_OVERLAY_FADE_MS = 1000;  // duración del fade-out del cartel
const DEMO_REVEAL_MS = 5500;        // tiempo que se ve el ruteo / mapa SIN cartel
// Calcula la duración total del cartel según largo del texto
function overlayDurationForText(text) {
  const len = (text || "").length;
  const extraChars = Math.max(0, len - DEMO_OVERLAY_MIN_CHARS);
  return DEMO_OVERLAY_BASE_MS + extraChars * DEMO_OVERLAY_PER_CHAR_MS;
}
const DEMO_INTRO_MS = 3500;
const DEMO_HIDE_MS = 600;
const DEMO_END_MS = 3000;
const TYPEWRITER_SPEED = 5;    // ms por letra del diagnóstico (casi instantáneo)
const OSRM_TIMEOUT_MS = 4000;
const OSRM_PREFETCH_CONCURRENCY = 2; // limite concurrente para no caer al rate-limit
const OSRM_RETRY_DELAY_MS = 350;

// Depot de fallback (sólo si la zona no tiene proveedor o falta location)
const DEPOT = {
  lat: -34.8353338,
  lng: -58.4233261,
  nombre: "Depósito central — Burzaco",
  direccion: "Ombu 1269",
};

// Diagnóstico por zona (mismo contenido que ZoneSlider.jsx, copiado para no
// crear acoplamiento de carga entre archivos)
const ZONE_DIAGNOSTICS_DEMO = {
  "Zona 1":  { n: "01", t: "Control municipal disperso", c: "El área de Educación necesita supervisar 12 zonas con criterios diferentes. Imposible comparar performance entre zonas con datos homogéneos." },
  "Zona 2":  { n: "02", t: "Tiempos largos de entrega", c: "El recorrido medio actual ronda los 47 minutos por vianda. La cadena térmica se compromete antes de llegar a la escuela." },
  "Zona 3":  { n: "03", t: "Auditoría ineficiente",     c: "Un auditor municipal pierde más tiempo en traslados que controlando: pocas escuelas cubiertas por jornada." },
  "Zona 4":  { n: "04", t: "Frescura comprometida",     c: "Más minutos en tránsito = más riesgo de cadena de frío rota, alimentos tibios y reclamos de directivos." },
  "Zona 5":  { n: "05", t: "Cruces entre cuadrillas",   c: "Distintos vehículos del operador atraviesan las mismas calles para cubrir escuelas de zonas separadas. Kilómetros duplicados sobre el mismo eje." },
  "Zona 6":  { n: "06", t: "Trazabilidad débil",        c: "Ante un reclamo de un directivo, reconstruir qué vianda llegó a qué escuela y en qué condiciones lleva horas: papel, planillas y llamadas cruzadas." },
  "Zona 7":  { n: "07", t: "Combustible y horas extra", c: "Rutas largas inflan el consumo de gasoil y obligan a horas extra de conductores. Costo operativo que el pliego no premia evitar." },
  "Zona 8":  { n: "08", t: "Inequidad horaria",         c: "Escuelas de la misma zona reciben la vianda con diferencias de hasta 90 minutos. Algunas comen 11:30, otras casi 13:00." },
  "Zona 9":  { n: "09", t: "Frágil ante imprevistos",   c: "Si falta un vehículo o se corta una calle por obra, no hay grupo cercano que absorba esas escuelas. Se cae la entrega del día." },
  "Zona 10": { n: "10", t: "Comunicación fragmentada",  c: "Cada zona maneja su propio canal informal con directivos. El Municipio no tiene un único punto de contacto consolidado por grupo." },
  "Zona 11": { n: "11", t: "Inflexible ante matrícula", c: "Cuando una escuela cambia su matrícula a mitad de año, reasignar cupos exige rehacer la zona entera. El pliego no contempla rebalanceo simple." },
  "Zona 12": { n: "12", t: "Zonas dispersas",          c: "Escuelas vecinas quedan en zonas distintas y otras lejanas comparten zona. Las rutas se cruzan y se duplican." },
};

// Frase corta de la propuesta para cada localidad (típica narrativa Real de Catorce)
const PROPUESTA_FRASE = "Una sola unidad logística por barrio. Rutas cortas, control simple.";

// Beneficio puntual por localidad: cada barrio muestra un fundamento potente
// distinto, tomado de los DEMO_BENEFITS. Si la localidad no está mapeada,
// se usa PROPUESTA_FRASE como fallback.
const LOCALIDAD_BENEFICIO = {
  "Banfield":          { titulo: "Trazabilidad inmediata",        desc: "Si falla algo en Banfield Este, el Municipio sabe exactamente a quién llamar. Una zona = un equipo responsable." },
  "Ingeniero Budge":   { titulo: "Auditorías por barrio",          desc: "Un auditor cubre toda la localidad sin trasladarse entre zonas. Más escuelas verificadas por jornada con el mismo equipo." },
  "Llavallol":         { titulo: "Cadena térmica protegida",       desc: "Rutas cortas dentro del barrio. La vianda llega caliente, antes del recreo, sin riesgo de cadena de frío rota." },
  "Lomas Centro":      { titulo: "Tablero municipal en tiempo real", desc: "Estado de cada entrega, temperatura de las viandas y KPIs por escuela disponibles para Educación al instante." },
  "Parque Barón":      { titulo: "Equidad de servicio horario",    desc: "Todas las escuelas del barrio reciben en la misma ventana. Cero diferencias entre escuelas vecinas." },
  "San José":          { titulo: "Métrica reportable al Concejo",  desc: "Indicadores claros y comparables por barrio: cumplimiento, km recorridos, frescura, tiempo medio. Listos para presentar." },
  "Santa Catalina":    { titulo: "Resiliencia ante imprevistos",   desc: "Si una camioneta falla en la localidad, otra del mismo barrio cubre sin desorganizar todo el sistema." },
  "Santa Marta":       { titulo: "Punto único de contacto",        desc: "Un referente operativo por barrio. Directivos, supervisión y Municipio dialogan con una sola contraparte." },
  "Temperley":         { titulo: "Reclamos resueltos en horas",    desc: "Con un equipo asignado por barrio, cada reclamo de directivo o familia tiene una respuesta inmediata y trazable." },
  "Turdera":           { titulo: "Recreo respetado",               desc: "La vianda llega antes del horario de comedor en el 100% de las escuelas. Los chicos comen sin acortar el recreo." },
  "Villa Albertina":   { titulo: "Mejor relación precio/servicio", desc: "El Municipio recibe el mismo precio del pliego con un servicio sustancialmente mejor. Cero costo extra." },
  "Villa Centenario":  { titulo: "Rutas cortas y predecibles",     desc: "Recorridos diseñados barrio por barrio. El conductor conoce sus calles, los tiempos son repetibles." },
  "Villa Fiorito":     { titulo: "Menos kilómetros, menos emisiones", desc: "Reducción estimada de km recorridos. Huella de carbono menor para la flota oficial — un dato comunicable." },
  "Villa Lamadrid":    { titulo: "Sin modificar el contrato vigente", desc: "La rezonificación es una mejora operativa que asume el operador. No requiere reabrir el pliego ni renegociar precios." },
};

function inferLocalidad(s) {
  return ((s.localidad || s.barrio || s.direccion || "") + "").toLowerCase();
}

// Color HSL deterministico por localidad. Reusa window.colorForLocalidad
// definido en Dashboard.jsx (que carga antes en index.html).
function _demoColorForLoc(loc) {
  if (typeof window !== "undefined" && typeof window.colorForLocalidad === "function") {
    return window.colorForLocalidad(loc);
  }
  if (!loc || loc === "Sin asignar") return "#9AA8BC";
  let h = 2166136261;
  for (let i = 0; i < loc.length; i++) {
    h ^= loc.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = h >>> 0;
  const hue = 195 + (h % 50);
  const sat = 55 + ((h >> 8) % 25);
  const lig = 42 + ((h >> 16) % 18);
  return `hsl(${hue}, ${sat}%, ${lig}%)`;
}

function kpisOf(subset) {
  let modulos = 0, comedor = 0, dmc = 0;
  subset.forEach(s => {
    const c = s.cupos || {};
    modulos += (c.modulos || 0);
    comedor += (c.comedor || 0);
    dmc += (c.dmc || 0);
  });
  return { modulos, comedor, dmc, total: modulos + comedor + dmc };
}

// Cupos por unidad de negocio (para overlay enriquecido).
// Devuelve todos los campos relevantes con fallback a 0.
function kpisByUnit(subset) {
  const acc = {
    dm: 0, com: 0,
    patologias_dm: 0, patologias_com: 0,
    patios_dm: 0, lc_dm: 0,
    dmc: 0, modulos: 0, comedor: 0,
  };
  subset.forEach(s => {
    const c = s.cupos || {};
    acc.dm             += (c.dm             || c.modulos || 0);
    acc.com            += (c.com            || c.comedor || 0);
    acc.patologias_dm  += (c.patologias_dm  || 0);
    acc.patologias_com += (c.patologias_com || 0);
    acc.patios_dm      += (c.patios_dm      || 0);
    acc.lc_dm          += (c.lc_dm          || 0);
    acc.dmc            += (c.dmc            || 0);
    acc.modulos        += (c.modulos        || 0);
    acc.comedor        += (c.comedor        || 0);
  });
  return acc;
}

// Formato corto en es-AR (10.234)
const fmt = (n) => (n || 0).toLocaleString("es-AR");

// Ordena un subset por el campo `orderKey` ascendente.
// Los que no tienen orden valido (0 o undefined) van al final.
function sortByOrden(subset, orderKey) {
  return subset.slice().sort((a, b) => {
    const oa = a[orderKey] || 9999;
    const ob = b[orderKey] || 9999;
    return oa - ob;
  });
}

function DemoComparativa() {
  const mapEl = React.useRef(null);
  const frameEl = React.useRef(null);
  const mapRef = React.useRef(null);
  const markersGroupRef = React.useRef(null);
  const routeLineRef = React.useRef(null);
  const routeGlowRef = React.useRef(null);
  const depotMarkerRef = React.useRef(null);
  const stopRef = React.useRef(false);
  const seqRef = React.useRef(0);
  const routeCacheRef = React.useRef(new Map()); // key -> latlngs[]
  // Controles manuales del demo
  const pausedRef = React.useRef(false);   // pausa el avance
  const skipRef = React.useRef(false);     // saltar al paso siguiente
  const goBackRef = React.useRef(false);   // volver al paso anterior

  const [schools, setSchools] = React.useState([]);
  const [zones, setZones] = React.useState([]);
  const [localidades, setLocalidades] = React.useState([]);
  const [provByZone, setProvByZone] = React.useState({});
  const [provLocations, setProvLocations] = React.useState({});
  const [running, setRunning] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [stepIdx, setStepIdx] = React.useState(0);   // 1-based para UI
  const [stepTotal, setStepTotal] = React.useState(0);
  const [stepSubphase, setStepSubphase] = React.useState(null); // "cartel" | "ruteo" | null
  const [overlay, setOverlay] = React.useState({
    visible: false,
    title: "",
    sub: "",                  // typewriter (diagnóstico/frase)
    prov: null,               // { name, dir }
    chips: null,              // [{ label, value }, ...]
    color: "var(--celeste-700)",
  });
  const [twText, setTwText] = React.useState("");        // texto ya tipeado
  const [twActive, setTwActive] = React.useState(false); // muestra el caret
  const [stage, setStage] = React.useState({ phase: "idle" });
  const [legend, setLegend] = React.useState(null);
  const [isFs, setIsFs] = React.useState(false);
  const [prefetch, setPrefetch] = React.useState({ active: false, done: 0, total: 0 });
  // flashKey: incrementa en cada cambio de zona/localidad para disparar el flash overlay
  const [flashKey, setFlashKey] = React.useState(0);
  // breathKey: incrementa al cambiar de fase para disparar el breath del frame
  const [breathKey, setBreathKey] = React.useState(0);
  const twTimerRef = React.useRef(null);

  // Datos
  React.useEffect(() => {
    if (window.__colegiosCache) {
      const d = window.__colegiosCache;
      setSchools(d.colegios || []);
      setZones(d.zonas_disponibles || []);
      setLocalidades(d.localidades_disponibles || []);
      setProvByZone(d.proveedores_por_zona || {});
      setProvLocations(d.proveedores_locations || {});
      return;
    }
    fetch("data/colegios.json?v=6")
      .then(r => r.json())
      .then(d => {
        window.__colegiosCache = d;
        setSchools(d.colegios || []);
        setZones(d.zonas_disponibles || []);
        setLocalidades(d.localidades_disponibles || []);
        setProvByZone(d.proveedores_por_zona || {});
        setProvLocations(d.proveedores_locations || {});
      })
      .catch(() => {});
  }, []);

  // Init Leaflet (una sola vez)
  React.useEffect(() => {
    if (!mapEl.current || mapRef.current || typeof L === "undefined") return;
    const map = L.map(mapEl.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      dragging: false,
      attributionControl: false,
    });
    map.fitBounds([[-34.84, -58.50], [-34.69, -58.34]], { animate: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19,
    }).addTo(map);

    // Depot marker (siempre visible). SVG truck institucional + halo pulsante.
    const depotIcon = L.divIcon({
      className: "demo-depot-icon",
      html:
        '<div class="demo-depot-pin">' +
          '<span class="demo-depot-halo"></span>' +
          '<svg class="demo-depot-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2" y="7" width="11" height="9" rx="1.4"/>' +
            '<path d="M13 10h4l4 4v2h-8z"/>' +
            '<circle cx="7" cy="18" r="2"/>' +
            '<circle cx="18" cy="18" r="2"/>' +
          '</svg>' +
        '</div>',
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
    const dm = L.marker([DEPOT.lat, DEPOT.lng], { icon: depotIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(`<strong>${DEPOT.nombre}</strong><br><span style="color:#5C7796">${DEPOT.direccion}</span>`);
    depotMarkerRef.current = dm;

    // Marker layer unico persistente
    const mg = L.layerGroup().addTo(map);
    markersGroupRef.current = mg;

    // Polyline GLOW (debajo). Misma geometria, mas ancha y borrosa, da profundidad luminosa.
    const glow = L.polyline([], {
      color: "#1A4A8C",
      weight: 14,
      opacity: 0.32,
      lineCap: "round",
      lineJoin: "round",
      className: "demo-route-glow",
    }).addTo(map);
    routeGlowRef.current = glow;

    // Polyline UNICA persistente. Se reusa en cada paso con setLatLngs() y setStyle().
    // Color literal hex porque las SVG vars de CSS no resuelven en stroke.
    const rl = L.polyline([], {
      color: "#1A4A8C",
      weight: 4,
      opacity: 0.92,
      dashArray: "10 8",
      lineCap: "round",
      lineJoin: "round",
      className: "demo-route-main",
    }).addTo(map);
    routeLineRef.current = rl;

    mapRef.current = map;
  }, []);

  // Breath: al cambiar breathKey, agrega clase `is-breathing` por 600ms.
  React.useEffect(() => {
    if (!breathKey) return;
    const el = frameEl.current;
    if (!el) return;
    el.classList.remove("is-breathing");
    // Forzar reflow para reiniciar animacion
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add("is-breathing");
    const t = setTimeout(() => {
      if (el) el.classList.remove("is-breathing");
    }, 650);
    return () => clearTimeout(t);
  }, [breathKey]);

  // Counter animation: cuando cambia legend.name, anima los KPIs del aside
  // de 0 al valor final en 600ms. Respeta prefers-reduced-motion.
  const legendNameRef = React.useRef(null);
  React.useEffect(() => {
    if (!legend || !legend.name) { legendNameRef.current = null; return; }
    if (legend.name === legendNameRef.current) return;
    legendNameRef.current = legend.name;
    const reduced = (typeof window !== "undefined" && window.matchMedia)
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    const nodes = document.querySelectorAll(".demo-legend .demo-kpi-num");
    if (!nodes || !nodes.length) return;
    if (reduced) return; // no animar
    const DURATION = 600;
    const start = performance.now();
    const targets = Array.from(nodes).map(n => {
      const t = parseInt(n.getAttribute("data-target") || "0", 10) || 0;
      return { n, target: t };
    });
    targets.forEach(t => { t.n.textContent = "0"; });
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    let raf = 0;
    const tick = (now) => {
      const elapsed = Math.min(1, (now - start) / DURATION);
      const k = ease(elapsed);
      targets.forEach(({ n, target }) => {
        const v = Math.round(target * k);
        n.textContent = v.toLocaleString("es-AR");
      });
      if (elapsed < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [legend && legend.name]);

  // Fullscreen change handler
  React.useEffect(() => {
    const onFs = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const inFs = !!fsEl && frameEl.current && fsEl === frameEl.current;
      setIsFs(inFs);
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 200);
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  // Atajos de teclado para controlar el demo
  // ← / →  : paso anterior / siguiente
  // Espacio: pausar / continuar
  // Solo activos cuando el demo está corriendo. Ignorar si el foco está en
  // un input/textarea/select.
  React.useEffect(() => {
    if (!running) return;
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevStepRef.current && prevStepRef.current();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skipStepRef.current && skipStepRef.current();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePauseRef.current && togglePauseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  // Render base: pinta TODOS los colegios como circleMarkers tenues.
  // Se llama al inicio y al final del demo (vista total).
  const renderBase = React.useCallback(() => {
    const map = mapRef.current;
    const mg = markersGroupRef.current;
    const rl = routeLineRef.current;
    const gl = routeGlowRef.current;
    if (!map || !mg) return;
    mg.clearLayers();
    if (rl) rl.setLatLngs([]);
    if (gl) gl.setLatLngs([]);
    schools.forEach(s => {
      if (!s.lat || !s.lng) return;
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 2.5, color: "#DCEBF7", weight: 1, fillColor: "#DCEBF7", fillOpacity: 0.4,
      });
      mg.addLayer(m);
    });
  }, [schools]);

  React.useEffect(() => { renderBase(); }, [renderBase]);

  // Llave de cache por waypoints
  const _cacheKey = (waypoints) =>
    waypoints.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");

  // OSRM segmentado con cache: un request por par de waypoints consecutivos.
  // Garantiza que cada pin esté unido al siguiente porque cada segmento es
  // una ruta dedicada. Si un segmento falla, se inserta línea recta como
  // fallback, así nunca queda un pin "fuera" del recorrido.
  // Devuelve un array [[lat,lng], ...] o null si waypoints insuficiente.
  const fetchOSRMRoute = async (waypoints, retries = 0) => {
    if (waypoints.length < 2) return null;
    const cache = routeCacheRef.current;
    const key = _cacheKey(waypoints);
    if (cache.has(key)) return cache.get(key);

    const all = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i], b = waypoints[i + 1];
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      let segmentOk = false;
      // Intento principal + retries por segmento (default 0)
      for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), OSRM_TIMEOUT_MS);
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) throw new Error("status " + r.status);
          const j = await r.json();
          const coords = j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates;
          if (!coords) throw new Error("no route");
          const latlngs = coords.map(c => [c[1], c[0]]);
          if (all.length && latlngs.length) {
            all.push(...latlngs.slice(1));
          } else {
            all.push(...latlngs);
          }
          segmentOk = true;
          break;
        } catch (_) {
          clearTimeout(t);
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, OSRM_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
        }
      }
      if (!segmentOk) {
        // Fallback: línea recta entre los dos waypoints para no dejar pins sueltos
        if (all.length) {
          all.push([b.lat, b.lng]);
        } else {
          all.push([a.lat, a.lng], [b.lat, b.lng]);
        }
      }
      // Rate-limit guard: 80ms entre requests para no saturar OSRM público
      await new Promise(r => setTimeout(r, 80));
    }
    if (!all.length) return null;
    cache.set(key, all);
    return all;
  };

  // Resuelve el "depot efectivo" de una zona (proveedor de la zona, o fallback Burzaco).
  const _depotForZone = (z) => {
    const provName = provByZone[z];
    const loc = provName && provLocations[provName];
    if (loc && loc.lat && loc.lng) {
      return { lat: loc.lat, lng: loc.lng, nombre: provName, direccion: loc.direccion || "" };
    }
    return DEPOT;
  };

  // Construye la lista de jobs de prefetch: zonas + localidades.
  // Cada job: { key, waypoints }
  const _buildAllRouteJobs = () => {
    const jobs = [];
    // Zonas: orden por orden_pliego ascendente, depot = proveedor de la zona
    const zonaList = (zones && zones.length ? zones : Array.from(new Set(schools.map(s => s.zona))).sort());
    zonaList.forEach(z => {
      const subset = schools.filter(s => (s.zona || s.zona_pliego) === z && s.lat && s.lng);
      if (!subset.length) return;
      const ordered = sortByOrden(subset, "orden_pliego");
      const dep = _depotForZone(z);
      const wp = [dep, ...ordered.map(s => ({ lat: s.lat, lng: s.lng })), dep];
      jobs.push({ key: _cacheKey(wp), waypoints: wp });
    });
    // Localidades (excluye Sin asignar). Usa depot Burzaco (no hay un proveedor por barrio).
    const locList = (localidades && localidades.length
      ? localidades
      : Array.from(new Set(schools.map(s => s.localidad).filter(Boolean))).sort()
    ).filter(l => l && l !== "Sin asignar");
    locList.forEach(loc => {
      const subset = schools.filter(s => s.localidad === loc && s.lat && s.lng);
      if (!subset.length) return;
      const ordered = sortByOrden(subset, "orden_localidad");
      const wp = [DEPOT, ...ordered.map(s => ({ lat: s.lat, lng: s.lng })), DEPOT];
      jobs.push({ key: _cacheKey(wp), waypoints: wp });
    });
    return jobs;
  };

  // Prefetch concurrente con un pool simple. No bloquea: el demo puede
  // arrancar igual y los pasos consultan la cache cuando llega la respuesta.
  const prefetchAllRoutes = async () => {
    const jobs = _buildAllRouteJobs();
    setPrefetch({ active: true, done: 0, total: jobs.length });
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (idx < jobs.length) {
        const myIdx = idx++;
        const job = jobs[myIdx];
        if (!job) return;
        if (stopRef.current) return;
        if (!routeCacheRef.current.has(job.key)) {
          await fetchOSRMRoute(job.waypoints, 0);
        }
        done++;
        setPrefetch(p => ({ ...p, done }));
      }
    };
    const pool = [];
    for (let i = 0; i < OSRM_PREFETCH_CONCURRENCY; i++) pool.push(worker());
    await Promise.all(pool);
    setPrefetch(p => ({ ...p, active: false }));
  };

  // Anima la polyline existente: stroke-dasharray = totalLength,
  // stroke-dashoffset de totalLength → 0 vía clase CSS. Tambien anima el path
  // glow (mismo recorrido, debajo) para profundidad luminosa.
  const _animatePolylineDraw = () => {
    const rl = routeLineRef.current;
    const gl = routeGlowRef.current;
    const animatePath = (poly, klass) => {
      if (!poly || !poly._path) return;
      const path = poly._path;
      try {
        const total = path.getTotalLength();
        if (!total || !isFinite(total)) return;
        path.classList.remove(klass);
        path.style.strokeDasharray = total + " " + total;
        path.style.strokeDashoffset = total;
        // Forzar reflow para que el navegador respete el estado inicial
        // antes de aplicar la animación.
        // eslint-disable-next-line no-unused-expressions
        path.getBoundingClientRect();
        path.classList.add(klass);
      } catch (_) { /* path puede no estar en DOM aún */ }
    };
    animatePath(rl, "demo-route-anim");
    animatePath(gl, "demo-route-anim-glow");
  };

  // Highlight subset + dibuja UN SOLO recorrido depot -> 1 -> 2 -> ... -> depot.
  // - Reusa el markersGroupRef.current (clearLayers + add).
  // - Reusa el routeLineRef.current (setLatLngs + setStyle).
  // - Pinta primero linea recta como fallback, luego intenta upgrade a OSRM.
  // - depotOverride: { lat, lng, nombre, direccion } - reemplaza el depot Burzaco
  //   por el proveedor de la zona (stage 1) o lo deja como Burzaco (stage 2).
  // Devuelve cuando los markers/linea recta estan pintados (no espera OSRM).
  const highlightAndRoute = (subset, color, orderKey, depotOverride) => {
    const map = mapRef.current;
    const mg = markersGroupRef.current;
    const rl = routeLineRef.current;
    const gl = routeGlowRef.current;
    if (!map || !mg || !rl) return;

    const dep = depotOverride || DEPOT;

    // Mover el marker depot a la nueva posición y reescribir su popup
    const dm = depotMarkerRef.current;
    if (dm) {
      try {
        dm.setLatLng([dep.lat, dep.lng]);
        dm.setPopupContent(
          `<strong>${dep.nombre || "Depot"}</strong><br>` +
          `<span style="color:#5C7796">${dep.direccion || ""}</span>`
        );
      } catch (_) {}
    }

    // sequence guard: incrementa para invalidar respuestas OSRM previas
    seqRef.current += 1;
    const mySeq = seqRef.current;

    mg.clearLayers();

    const subsetIds = new Set(subset.map(s => s.id || (s.lat + ":" + s.lng)));

    // Inactivos tenues
    schools.forEach(s => {
      if (!s.lat || !s.lng) return;
      const sid = s.id || (s.lat + ":" + s.lng);
      if (subsetIds.has(sid)) return;
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 2.5, color: "#DCEBF7", weight: 1, fillColor: "#DCEBF7", fillOpacity: 0.4,
      });
      mg.addLayer(m);
    });

    // Subset ordenado por orden_* pre-calculado
    const validSubset = subset.filter(s => s.lat && s.lng);
    const ordered = sortByOrden(validSubset, orderKey);

    // Pines numerados sobre cada colegio activo, con animation-delay escalonado
    // (idx * 100ms) — la animación pinPop bounce + halo expansivo definidos en CSS.
    // El ultimo pin de la zona recibe `is-last` para el ring pulsante perpetuo.
    const pts = [[dep.lat, dep.lng]];
    const lastIdx = ordered.length - 1;
    ordered.forEach((s, idx) => {
      const ord = s[orderKey] || (idx + 1);
      const delay = idx * 100;
      const isLast = idx === lastIdx;
      const cls = "demo-pin" + (isLast ? " is-last" : "");
      const icon = L.divIcon({
        className: "demo-pin-icon",
        html: `<div class="${cls}" style="background:${color};animation-delay:${delay}ms;--pin-color:${color}"><span class="demo-pin-halo"></span><span class="demo-pin-num">${ord}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const mk = L.marker([s.lat, s.lng], { icon, zIndexOffset: 1000 - (ord || 0) });
      mg.addLayer(mk);
      pts.push([s.lat, s.lng]);
    });

    // Bounds
    if (pts.length > 1) {
      try {
        map.fitBounds(L.latLngBounds(pts).pad(0.25), {
          padding: [40, 40],
          maxZoom: 15,
          animate: true,
          duration: 0.5,
        });
      } catch (_) {}
    }

    if (!ordered.length) {
      rl.setLatLngs([]);
      if (gl) gl.setLatLngs([]);
      return;
    }

    // Fallback inmediato: linea recta uniendo todos los puntos.
    const straight = [
      [dep.lat, dep.lng],
      ...ordered.map(s => [s.lat, s.lng]),
      [dep.lat, dep.lng],
    ];
    try {
      rl.setStyle({ color });
      rl.setLatLngs(straight);
      if (gl) {
        gl.setStyle({ color });
        gl.setLatLngs(straight);
      }
    } catch (_) {}
    // Animar el dibujo de la línea recta de fallback en cuanto Leaflet renderiza
    setTimeout(() => {
      if (mySeq === seqRef.current && !stopRef.current) _animatePolylineDraw();
    }, 30);

    // Intento de upgrade a ruta OSRM real (cache primero).
    const waypoints = [dep, ...ordered.map(s => ({ lat: s.lat, lng: s.lng })), dep];
    const key = _cacheKey(waypoints);
    const cached = routeCacheRef.current.get(key);
    if (cached && cached.length) {
      try {
        rl.setLatLngs(cached);
        if (gl) gl.setLatLngs(cached);
        setTimeout(() => {
          if (mySeq === seqRef.current && !stopRef.current) _animatePolylineDraw();
        }, 30);
      } catch (_) {}
      return;
    }
    // Async upgrade
    fetchOSRMRoute(waypoints, 0).then(latlngs => {
      // Sequence guard: si el usuario ya paso al siguiente paso, ignorar
      if (mySeq !== seqRef.current) return;
      if (stopRef.current) return;
      if (!latlngs || !latlngs.length) return;
      try {
        rl.setLatLngs(latlngs);
        if (gl) gl.setLatLngs(latlngs);
        setTimeout(() => {
          if (mySeq === seqRef.current && !stopRef.current) _animatePolylineDraw();
        }, 30);
      } catch (_) {}
    }).catch(() => {});
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // sleep interrumpible: chequea stop / skip / goBack cada 100ms.
  // Si stopRef se activa: termina inmediatamente.
  // Si skipRef o goBackRef se activan: termina (consumen el sleep restante).
  // Mientras pausedRef esté activo, congela el reloj (no avanza).
  const interruptibleSleep = async (ms) => {
    const STEP = 100;
    let elapsed = 0;
    while (elapsed < ms) {
      if (stopRef.current) return;
      if (skipRef.current || goBackRef.current) return;
      // Si está pausado, no acumulamos tiempo. Nos quedamos en bucle hasta
      // que el usuario reanude o detenga / skip / back.
      while (pausedRef.current && !stopRef.current && !skipRef.current && !goBackRef.current) {
        await sleep(STEP);
      }
      if (stopRef.current) return;
      if (skipRef.current || goBackRef.current) return;
      const chunk = Math.min(STEP, ms - elapsed);
      await sleep(chunk);
      elapsed += chunk;
    }
  };

  // Handlers de los controles manuales
  const togglePause = () => {
    if (!running) return;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };
  const skipStep = () => {
    if (!running) return;
    // Si está pausado, también queremos avanzar: salimos de la pausa.
    pausedRef.current = false;
    setPaused(false);
    skipRef.current = true;
  };
  const prevStep = () => {
    if (!running) return;
    pausedRef.current = false;
    setPaused(false);
    goBackRef.current = true;
  };

  // Refs a los handlers para usarlos desde listeners de teclado
  // (evita capturar versiones obsoletas en useEffect)
  const togglePauseRef = React.useRef(togglePause);
  const skipStepRef = React.useRef(skipStep);
  const prevStepRef = React.useRef(prevStep);
  React.useEffect(() => {
    togglePauseRef.current = togglePause;
    skipStepRef.current = skipStep;
    prevStepRef.current = prevStep;
  });

  // Reveal: muestra el texto completo de una sola vez (la animación CSS de
  // entrada se dispara con `key` en el render). NO es typewriter.
  const _clearTwTimer = () => {
    if (twTimerRef.current) {
      clearTimeout(twTimerRef.current);
      twTimerRef.current = null;
    }
  };
  const typewrite = (text) => new Promise(resolve => {
    _clearTwTimer();
    setTwText(text || "");
    setTwActive(false);
    resolve();
  });

  const enterFs = async () => {
    const el = frameEl.current;
    if (!el) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch (_) {}
    setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 400);
  };
  const exitFs = async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } catch (_) {}
  };

  const stop = async () => {
    stopRef.current = true;
    pausedRef.current = false;
    skipRef.current = false;
    goBackRef.current = false;
    seqRef.current += 1; // invalida respuestas OSRM en vuelo
    _clearTwTimer();
    setTwText("");
    setTwActive(false);
    setRunning(false);
    setPaused(false);
    setStepIdx(0);
    setStepTotal(0);
    setStepSubphase(null);
    setOverlay({ visible: false, title: "", sub: "", prov: null, chips: null, color: "var(--celeste-700)" });
    setStage({ phase: "idle" });
    setLegend(null);
    renderBase();
    const map = mapRef.current;
    if (map) map.fitBounds([[-34.84, -58.50], [-34.69, -58.34]], { animate: true });
    await exitFs();
  };

  const showMsg = async (title, sub, color, ms = DEMO_INTRO_MS) => {
    if (stopRef.current) return;
    setOverlay({ visible: true, leaving: false, title, sub, prov: null, chips: null, color });
    setTwText(""); setTwActive(false);
    // Mantener visible durante (ms - fade), luego empezar a desvanecer.
    // Usar sleep interrumpible para que skip / back / pausar respondan.
    const stayMs = Math.max(0, ms - DEMO_OVERLAY_FADE_MS);
    await interruptibleSleep(stayMs);
    if (stopRef.current) return;
    setOverlay(o => ({ ...o, leaving: true }));
    await sleep(DEMO_OVERLAY_FADE_MS);
    if (stopRef.current) return;
    setOverlay(o => ({ ...o, visible: false, leaving: false }));
    await sleep(DEMO_HIDE_MS);
  };

  const play = async () => {
    if (running) return;
    stopRef.current = false;
    seqRef.current = 0;
    setRunning(true);
    await enterFs();

    // Lanzar prefetch en background. NO esperamos: el demo arranca igual.
    prefetchAllRoutes();

    try {
      // Construir un único array de pasos que abarca ambos stages.
      // Cada paso lleva su tipo (pliego/propuesta) y todos los datos
      // necesarios para renderizarlo. Eso permite navegación con skip/back
      // entre stages con un único índice global.
      const zonaList = (zones && zones.length ? zones.slice() : []).sort((a, b) => {
        const na = parseInt((a.match(/\d+/) || ["0"])[0], 10);
        const nb = parseInt((b.match(/\d+/) || ["0"])[0], 10);
        return na - nb;
      });
      const locNames = (localidades && localidades.length
        ? localidades
        : Array.from(new Set(schools.map(s => s.localidad).filter(Boolean))).sort()
      ).filter(l => l && l !== "Sin asignar").slice().sort();

      const allSteps = [];
      zonaList.forEach(z => {
        const subset = schools.filter(s => (s.zona || s.zona_pliego) === z);
        if (!subset.length) return;
        allSteps.push({ phase: "pliego", name: z, subset });
      });
      locNames.forEach(loc => {
        const subset = schools.filter(s => s.localidad === loc);
        if (!subset.length) return;
        allSteps.push({ phase: "propuesta", name: loc, subset });
      });

      const totalSteps = allSteps.length;
      setStepTotal(totalSteps);

      // === STATE MACHINE: cada step se subdivide en (cartel, ruteo) ===
      // Las flechas y los atajos navegan entre subphase, no entre steps completos.
      //
      // Matriz de transiciones:
      //   cartel + skip  -> ruteo de la MISMA zona
      //   cartel + back  -> ruteo de la zona ANTERIOR (en step 0 se queda)
      //   ruteo  + skip  -> cartel de la SIGUIENTE zona
      //   ruteo  + back  -> cartel de la MISMA zona
      //
      // El intro de stage (pliego/propuesta) sólo se muestra al avanzar
      // naturalmente o al entrar al stage por primera vez. Si back cruza
      // de stage 2 -> stage 1, NO se re-muestra el intro (sería confuso).
      let i = 0;
      let subphase = "cartel"; // "cartel" | "ruteo"
      let lastPhase = null;

      while (i < totalSteps) {
        if (stopRef.current) break;
        const step = allSteps[i];

        // Cambio de stage: al entrar a una nueva fase mostramos el cartel
        // intro correspondiente. Sólo se muestra cuando lastPhase != step.phase
        // y solo cuando estamos entrando por subphase=cartel (avance natural
        // o cruce de stage). Si volvemos atrás cruzando stages, el bloque de
        // back ya seteó lastPhase para EVITAR el intro al retroceder.
        if (step.phase !== lastPhase && subphase === "cartel") {
          if (step.phase === "pliego") {
            setStage({ phase: "pliego" });
            setBreathKey(k => k + 1);
            await showMsg(
              "Propuesta municipal vigente",
              "Ruteo basado en zonas de pliego (Zona 1 a Zona 12)",
              "var(--celeste-700)"
            );
          } else if (step.phase === "propuesta") {
            setStage({ phase: "propuesta" });
            setBreathKey(k => k + 1);
            await showMsg(
              "Propuesta de rezonificación",
              "Agrupar por coherencia logística",
              "var(--celeste-800)"
            );
          }
          if (stopRef.current) break;
          lastPhase = step.phase;
          // Si el usuario skipeó / volvió durante el intro, consumimos el flag
          // para que la sub-fase cartel siguiente no se salte de inmediato.
          if (skipRef.current) skipRef.current = false;
          if (goBackRef.current) goBackRef.current = false;
        } else if (step.phase !== lastPhase) {
          // Subphase = ruteo y cruzamos stage: actualizar el badge y el
          // lastPhase pero SIN mostrar intro (es un retorno hacia atrás).
          if (step.phase === "pliego") setStage({ phase: "pliego" });
          else if (step.phase === "propuesta") setStage({ phase: "propuesta" });
          setBreathKey(k => k + 1);
          lastPhase = step.phase;
        }

        // Datos derivados del step (compartidos entre cartel y ruteo)
        const isPliego = step.phase === "pliego";
        const subset = step.subset;
        const ku = kpisByUnit(subset);
        const k = kpisOf(subset);
        let depForStep, color, orderKey, diagText, provInfo, beneficioBonus;
        if (isPliego) {
          const z = step.name;
          const provName = provByZone[z] || null;
          const provLoc = provName && provLocations[provName];
          depForStep = (provLoc && provLoc.lat && provLoc.lng)
            ? { lat: provLoc.lat, lng: provLoc.lng, nombre: provName, direccion: provLoc.direccion || "" }
            : DEPOT;
          color = "var(--celeste-700)";
          orderKey = "orden_pliego";
          const diag = ZONE_DIAGNOSTICS_DEMO[z];
          diagText = (diag && diag.c) || "";
          provInfo = provName ? { name: provName, dir: (provLoc && provLoc.direccion) || "" } : null;
          beneficioBonus = null;
        } else {
          const loc = step.name;
          depForStep = DEPOT;
          color = _demoColorForLoc(loc);
          orderKey = "orden_localidad";
          const beneficio = LOCALIDAD_BENEFICIO[loc];
          diagText = (beneficio && beneficio.desc) || PROPUESTA_FRASE;
          provInfo = null;
          beneficioBonus = beneficio ? { titulo: beneficio.titulo, desc: beneficio.desc } : null;
        }
        const chips = [
          { label: "DM",            value: fmt(ku.dm) },
          { label: "COM",           value: fmt(ku.com) },
          { label: "Patologías DM", value: fmt(ku.patologias_dm) },
          { label: "Patologías COM",value: fmt(ku.patologias_com) },
          { label: "Patios DM",     value: fmt(ku.patios_dm) },
          { label: "LC DM",         value: fmt(ku.lc_dm) },
        ];

        // Legend lateral siempre visible con info del step actual
        setLegend({
          name: step.name,
          kpis: k,
          ritmo: isPliego ? "zonas dispersas del pliego" : "una zona por barrio",
          idx: i + 1,
          total: totalSteps,
          color: isPliego ? "var(--celeste-700)" : color,
          phase: step.phase,
          schools: subset.length,
        });
        setStepIdx(i + 1);
        setStepSubphase(subphase);

        if (subphase === "cartel") {
          // === SUB-FASE A: Cartel ===
          setOverlay({
            visible: true,
            leaving: false,
            title: step.name,
            sub: "",
            prov: provInfo,
            chips,
            color,
            bonus: beneficioBonus,
          });
          typewrite(diagText);

          const overlayMs = overlayDurationForText(diagText);
          await interruptibleSleep(Math.max(0, overlayMs - DEMO_OVERLAY_FADE_MS));
          if (stopRef.current) break;

          // BACK desde cartel: ir al ruteo de la zona ANTERIOR
          if (goBackRef.current) {
            goBackRef.current = false;
            if (i === 0) {
              // No hay anterior. Quedarse en el cartel del step 0.
              // (Re-loop: el while reentra y vuelve a mostrar el cartel.)
              continue;
            }
            // Fade out rápido del cartel antes de saltar
            setOverlay(o => ({ ...o, leaving: true }));
            await sleep(DEMO_OVERLAY_FADE_MS);
            setOverlay(o => ({ ...o, visible: false, leaving: false }));
            _clearTwTimer();
            setTwActive(false);
            i = i - 1;
            subphase = "ruteo";
            continue;
          }

          // SKIP desde cartel: ir directo al ruteo de la MISMA zona
          if (skipRef.current) {
            skipRef.current = false;
            setOverlay(o => ({ ...o, leaving: true }));
            await sleep(DEMO_OVERLAY_FADE_MS);
            setOverlay(o => ({ ...o, visible: false, leaving: false }));
            _clearTwTimer();
            setTwActive(false);
            subphase = "ruteo";
            continue;
          }

          // Avance natural: fade out del cartel y entrar al ruteo
          setOverlay(o => ({ ...o, leaving: true }));
          await sleep(DEMO_OVERLAY_FADE_MS);
          if (stopRef.current) break;
          setOverlay(o => ({ ...o, visible: false, leaving: false }));
          _clearTwTimer();
          setTwActive(false);
          subphase = "ruteo";
          continue;
        }

        // === SUB-FASE B: Ruteo ===
        try {
          highlightAndRoute(subset, isPliego ? "#1A4A8C" : color, orderKey, depForStep);
          setFlashKey(k => k + 1);
        } catch (e) {
          console.warn("highlightAndRoute err", step.name, e);
        }

        await interruptibleSleep(DEMO_REVEAL_MS);
        if (stopRef.current) break;

        // BACK desde ruteo: volver al cartel de la MISMA zona
        if (goBackRef.current) {
          goBackRef.current = false;
          subphase = "cartel";
          continue;
        }

        // SKIP desde ruteo: ir al cartel de la SIGUIENTE zona
        if (skipRef.current) {
          skipRef.current = false;
          i = i + 1;
          subphase = "cartel";
          continue;
        }

        // Avance natural
        i = i + 1;
        subphase = "cartel";
      }

      if (stopRef.current) return;
      setLegend(null);
    } catch (err) {
      console.error("Error en demo:", err);
    } finally {
      stopRef.current = false;
      pausedRef.current = false;
      skipRef.current = false;
      goBackRef.current = false;
      seqRef.current += 1;
      _clearTwTimer();
      setTwText("");
      setTwActive(false);
      setRunning(false);
      setPaused(false);
      setStepIdx(0);
      setStepTotal(0);
      setStepSubphase(null);
      setStage({ phase: "idle" });
      setLegend(null);
      // Restaurar el depot a Burzaco al cerrar
      const dm = depotMarkerRef.current;
      if (dm) {
        try {
          dm.setLatLng([DEPOT.lat, DEPOT.lng]);
          dm.setPopupContent(`<strong>${DEPOT.nombre}</strong><br><span style="color:#5C7796">${DEPOT.direccion}</span>`);
        } catch (_) {}
      }
      renderBase();
      const map = mapRef.current;
      if (map) map.fitBounds([[-34.84, -58.50], [-34.69, -58.34]], { animate: true });
      await exitFs();
    }
  };

  const phaseLabel =
    stage.phase === "pliego" ? "Pliego vigente · ritmo nervioso" :
    stage.phase === "propuesta" ? "Propuesta de rezonificación · una zona por barrio" :
    "Vista en vivo";
  const phaseColor =
    stage.phase === "pliego" ? "var(--celeste-700)" :
    stage.phase === "propuesta" ? "var(--amber-deep)" :
    "var(--ink-500)";
  const phaseDotColor =
    stage.phase === "pliego" ? "var(--celeste-500)" :
    stage.phase === "propuesta" ? "var(--amber)" :
    "var(--ink-400)";

  const overlayEyebrow =
    stage.phase === "pliego" ? "Zona de pliego vigente · diagnostico" :
    stage.phase === "propuesta" ? "Barrio agrupado · propuesta R14" :
    null;

  const prefetchPct = prefetch.total ? Math.round((prefetch.done / prefetch.total) * 100) : 0;

  return (
    <div className="demo-wrap">
      <div className="demo-head">
        <div
          className={"demo-badge demo-badge-" + (stage.phase || "idle")}
          style={{ color: phaseColor, borderColor: phaseColor }}
          key={stage.phase}
        >
          <span className="demo-badge-dot" style={{ background: phaseDotColor }}/>
          <span className="demo-badge-txt">{phaseLabel}</span>
        </div>
        <div className="demo-controls">
          <button
            className="btn btn-ghost demo-fs-btn"
            onClick={() => (isFs ? exitFs() : enterFs())}
            title={isFs ? "Salir de pantalla completa" : "Pantalla completa"}
            aria-label={isFs ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFs ? "↙ Salir pantalla completa" : "⛶ Pantalla completa"}
          </button>
          {!running ? (
            <button className="btn btn-primary demo-play-btn" onClick={play}>&#9654; Iniciar demo comparativa</button>
          ) : (
            <button className="btn btn-ghost demo-stop" onClick={stop}>&#9632; Detener</button>
          )}
        </div>
      </div>

      <div className={"demo-stage" + (legend ? " has-legend" : "")}>
        <div
          ref={frameEl}
          className={"demo-frame" + (isFs ? " is-fs" : "") + (running ? " is-running" : "")}
        >
          <div ref={mapEl} id="demoComparativaMap" className="demo-map"/>
          {/* Flash overlay editorial: se reinicia con cada cambio de paso (key=flashKey). */}
          {flashKey > 0 && running && (
            <span className="demo-flash" key={"flash-" + flashKey} aria-hidden="true"/>
          )}
          {/* Controles flotantes del paso (dentro del frame, visible en fullscreen) */}
          {running && (
            <div className="demo-step-controls" role="group" aria-label="Controles del paso">
              <button
                className="demo-step-btn"
                onClick={prevStep}
                title="Paso anterior (Flecha izquierda)"
                aria-label="Paso anterior"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="19 20 9 12 19 4 19 20"/>
                  <line x1="5" y1="19" x2="5" y2="5"/>
                </svg>
              </button>
              <button
                className="demo-step-btn demo-step-btn-main"
                onClick={togglePause}
                title={paused ? "Continuar (Espacio)" : "Pausar (Espacio)"}
                aria-label={paused ? "Continuar" : "Pausar"}
              >
                {paused ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="6 4 20 12 6 20 6 4"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="5" y="4" width="4" height="16"/>
                    <rect x="15" y="4" width="4" height="16"/>
                  </svg>
                )}
              </button>
              <button
                className="demo-step-btn"
                onClick={skipStep}
                title="Paso siguiente (Flecha derecha)"
                aria-label="Paso siguiente"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="5 4 15 12 5 20 5 4"/>
                  <line x1="19" y1="5" x2="19" y2="19"/>
                </svg>
              </button>
              {stepTotal > 0 && (
                <span className="demo-step-counter mono" aria-live="polite">
                  <b>{stepIdx}{stepSubphase ? (stepSubphase === "cartel" ? "A" : "B") : ""}</b>
                  <span className="demo-step-counter-of"> / {stepTotal}</span>
                </span>
              )}
              <span className="demo-step-hint mono" aria-hidden="true">← · espacio · →</span>
            </div>
          )}
          {prefetch.active && running && (
            <div className="demo-prefetch">
              <span className="demo-prefetch-spinner" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.18"/>
                  <path d="M21 12a9 9 0 0 1-9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
                </svg>
              </span>
              <span className="demo-prefetch-text mono">
                Cargando rutas <b>{prefetch.done}</b> / {prefetch.total}
                <span className="demo-prefetch-pct"> · {prefetchPct}%</span>
              </span>
              <span className="demo-prefetch-bar" aria-hidden="true">
                <span className="demo-prefetch-bar-fill" style={{ width: prefetchPct + "%" }}/>
              </span>
            </div>
          )}
          {legend && (
            <aside className={"demo-legend" + (isFs ? " floating" : "")} key={"legend-" + (legend.name || "")}>
              <div className="demo-legend-head" style={{ color: legend.color }}>
                <span className="demo-legend-dot" style={{ background: legend.color }}/>
                <strong>{legend.name}</strong>
                <span className="demo-legend-idx mono">{legend.idx} / {legend.total}</span>
              </div>
              <div className="demo-legend-ritmo mono">{legend.ritmo}</div>
              <div className={"demo-legend-kpis demo-legend-phase-" + (legend.phase || "idle")}>
                <div className="demo-kpi"><span className="k">Colegios</span><strong className="demo-kpi-num" data-target={legend.schools}>{legend.schools}</strong></div>
                <div className="demo-kpi"><span className="k">Modulos</span><strong className="demo-kpi-num" data-target={legend.kpis.modulos}>{legend.kpis.modulos.toLocaleString("es-AR")}</strong></div>
                <div className="demo-kpi"><span className="k">Comedor</span><strong className="demo-kpi-num" data-target={legend.kpis.comedor}>{legend.kpis.comedor.toLocaleString("es-AR")}</strong></div>
                <div className="demo-kpi"><span className="k">DyM/DMC</span><strong className="demo-kpi-num" data-target={legend.kpis.dmc}>{legend.kpis.dmc.toLocaleString("es-AR")}</strong></div>
                <div className="demo-kpi total"><span className="k">Total cupos</span><strong className="demo-kpi-num" data-target={legend.kpis.total}>{legend.kpis.total.toLocaleString("es-AR")}</strong></div>
              </div>
            </aside>
          )}
          {overlay.visible && (
            <div className={"demo-overlay" + (overlay.leaving ? " demo-overlay-leaving" : "")}>
              {overlayEyebrow && overlay.chips && (
                <div className="demo-overlay-eyebrow">{overlayEyebrow}</div>
              )}
              {overlay.bonus && overlay.bonus.titulo && (
                <div className="demo-overlay-bonus" key={"bonus-" + overlay.bonus.titulo}>
                  <span className="demo-overlay-bonus-dot" aria-hidden="true">●</span>
                  <span className="demo-overlay-bonus-tag">BENEFICIO POR BARRIO</span>
                  <span className="demo-overlay-bonus-sep">·</span>
                  <span className="demo-overlay-bonus-titulo">{overlay.bonus.titulo}</span>
                </div>
              )}
              <div className="demo-overlay-title" style={{ color: overlay.color }} key={overlay.title}>{overlay.title}</div>
              {/* sub clásico (intros) */}
              {overlay.sub && (
                <div className="demo-overlay-sub">{overlay.sub}</div>
              )}
              {/* diagnóstico de zona o frase de barrio (fade-in suave) */}
              {twText && (
                <div className="demo-overlay-diag" key={twText}>
                  {twText}
                </div>
              )}
              {/* línea del proveedor (sólo zonas) */}
              {overlay.prov && (
                <div className="demo-overlay-prov">
                  Proveedor: <b>{overlay.prov.name}</b>
                </div>
              )}
              {/* chips de cupos por unidad de negocio (entrada en cascada via --i) */}
              {overlay.chips && overlay.chips.length > 0 && (
                <div className="demo-overlay-chips">
                  {overlay.chips.map((c, i) => (
                    <span key={i} className="demo-overlay-chip" style={{ "--i": i }}>
                      {c.label}: <b>{c.value}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function DemoBenefitIcon({ name }) {
  const c = { width: 32, height: 32, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "users":         return (<svg {...c}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14a4 4 0 0 1 6 4"/></svg>);
    case "shield":        return (<svg {...c}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>);
    case "leaf":          return (<svg {...c}><path d="M11 20a8 8 0 0 0 8-8c0-4.5-3-8-8-9-1 5-5 6-5 11a6 6 0 0 0 5 6"/><path d="M6 18c2-3 5-5 9-6"/></svg>);
    case "spark":         return (<svg {...c}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>);
    case "road":          return (<svg {...c}><path d="M5 21 8 3"/><path d="m16 3 3 18"/><path d="M12 5v3"/><path d="M12 12v3"/><path d="M12 19v2"/></svg>);
    case "chart":         return (<svg {...c}><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-7"/></svg>);
    case "clock":         return (<svg {...c}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>);
    case "truck":         return (<svg {...c}><rect x="2" y="7" width="11" height="9" rx="1"/><path d="M13 10h4l4 4v2h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>);
    case "route":         return (<svg {...c}><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8 5h7a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h7"/></svg>);
    case "thermometer":   return (<svg {...c}><path d="M14 14V5a2 2 0 0 0-4 0v9a4 4 0 1 0 4 0Z"/></svg>);
    case "snowflake":     return (<svg {...c}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4M12 6l-2-2 2-2 2 2-2 2zM12 22l-2-2 2-2 2 2-2 2zM6 12l-2-2-2 2 2 2 2-2zM22 12l-2-2-2 2 2 2 2-2z"/></svg>);
    case "flame":         return (<svg {...c}><path d="M12 22a7 7 0 0 0 7-7c0-3-2-5-3-8-1.5 2-3 3-5 3s-3-2-2-5c-3 3-4 6-4 10a7 7 0 0 0 7 7Z"/></svg>);
    case "alert":         return (<svg {...c}><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="0.7" fill="currentColor"/></svg>);
    case "list-checks":   return (<svg {...c}><path d="M3 5h13M3 12h13M3 19h13"/><path d="m18 4 1.5 1.5L22 3"/><path d="m18 11 1.5 1.5L22 10"/><path d="m18 18 1.5 1.5L22 17"/></svg>);
    case "message":       return (<svg {...c}><path d="M21 12a8 8 0 1 1-3-6.2L21 5l-1 4a8 8 0 0 1 1 3Z"/></svg>);
    case "eye":           return (<svg {...c}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>);
    case "mail":          return (<svg {...c}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>);
    case "zap":           return (<svg {...c}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>);
    case "target":        return (<svg {...c}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>);
    case "ruler":         return (<svg {...c}><path d="M3 17 17 3l4 4L7 21l-4-4Z"/><path d="M7 13l2 2M9 11l2 2M11 9l2 2M13 7l2 2"/></svg>);
    case "scale":         return (<svg {...c}><path d="M12 3v18M3 7h18"/><path d="M6 7l-3 7a3 3 0 0 0 6 0L6 7Zm12 0-3 7a3 3 0 0 0 6 0L18 7Z"/></svg>);
    case "file":          return (<svg {...c}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 13h6M9 17h4"/></svg>);
    case "calendar":      return (<svg {...c}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>);
    case "trending":      return (<svg {...c}><path d="M3 17 9 11l4 4 8-9"/><path d="M14 6h7v7"/></svg>);
    case "refresh":       return (<svg {...c}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>);
    case "lock":          return (<svg {...c}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>);
    case "badge":         return (<svg {...c}><path d="M12 3 3 7l9 4 9-4-9-4Z"/><path d="m3 12 9 4 9-4M3 17l9 4 9-4"/></svg>);
    case "layers":        return (<svg {...c}><path d="m12 2 10 6-10 6L2 8l10-6Z"/><path d="m2 14 10 6 10-6"/></svg>);
    case "navigation":    return (<svg {...c}><path d="M3 11 21 3l-8 18-3-7-7-3Z"/></svg>);
    case "smile":         return (<svg {...c}><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><circle cx="9" cy="10" r="0.7" fill="currentColor"/><circle cx="15" cy="10" r="0.7" fill="currentColor"/></svg>);
    case "gauge":         return (<svg {...c}><path d="M21 12a9 9 0 1 0-18 0"/><path d="m12 12 5-3"/></svg>);
    case "user-check":    return (<svg {...c}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="m17 11 2 2 4-4"/></svg>);
    case "droplet":       return (<svg {...c}><path d="M12 3s7 7 7 12a7 7 0 1 1-14 0c0-5 7-12 7-12Z"/></svg>);
    case "sun":           return (<svg {...c}><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>);
    case "compass":       return (<svg {...c}><circle cx="12" cy="12" r="9"/><path d="m9 15 3-9 3 9-3-3-3 3Z"/></svg>);
    default: return null;
  }
}

const DEMO_BENEFITS = [
  // Control y auditoría
  { icon: "user-check", title: "Auditorías por barrio",        desc: "Un auditor cubre toda una localidad sin trasladarse entre zonas. Más escuelas verificadas por jornada con el mismo equipo municipal." },
  { icon: "shield",     title: "Trazabilidad inmediata",       desc: "Si falla algo en Banfield Este, el Municipio sabe exactamente a quién llamar. Una zona = un equipo responsable, sin diluir responsabilidad." },
  { icon: "chart",      title: "Métrica reportable al Concejo", desc: "Indicadores claros y comparables por barrio: cumplimiento, km recorridos, frescura, tiempo medio. Listos para presentar." },
  { icon: "list-checks", title: "Inspecciones bromatológicas más simples", desc: "Bromatología puede revisar todas las escuelas de un barrio en una sola jornada con un mismo recorrido." },
  { icon: "message",    title: "Punto único de contacto",      desc: "Cada barrio tiene un referente operativo. Directivos, supervisión y Municipio dialogan con una sola contraparte por zona." },
  { icon: "eye",        title: "Tablero municipal en tiempo real", desc: "Estado de cada entrega, temperatura de las viandas y KPIs por escuela disponibles para el área de Educación al instante." },

  // Calidad de la vianda y de la entrega
  { icon: "thermometer", title: "Cadena térmica protegida",     desc: "Rutas cortas dentro del barrio. La vianda llega caliente, antes del recreo, sin riesgo de cadena de frío rota." },
  { icon: "leaf",        title: "Frescura comprobable",         desc: "Menos minutos en tránsito = más nutrientes preservados. La vianda llega como salió de la cocina." },
  { icon: "clock",       title: "Equidad de servicio horario",  desc: "Todas las escuelas de un barrio reciben en la misma ventana. Cero diferencias entre escuelas vecinas (no más 11:30 vs 13:00)." },
  { icon: "droplet",     title: "Menos viandas devueltas",      desc: "Llegando a tiempo y a temperatura, las devoluciones por mal estado bajan al mínimo. Menos comida desperdiciada." },
  { icon: "smile",       title: "Recreo respetado",             desc: "La vianda está antes del horario de comedor en el 100% de las escuelas. Los chicos comen sin acortar el recreo ni la clase siguiente." },

  // Operativa y resiliencia
  { icon: "refresh",    title: "Resiliencia ante imprevistos", desc: "Si una camioneta falla en una localidad, otra del mismo barrio cubre sin desorganizar todo el sistema municipal." },
  { icon: "route",      title: "Rutas cortas y predecibles",   desc: "Recorridos diseñados barrio por barrio: el conductor conoce sus calles, los tiempos son repetibles, los retrasos se detectan al instante." },
  { icon: "truck",      title: "Menos tránsito en avenidas",   desc: "Camionetas concentradas en sus barrios, no cruzando el partido. Menos congestión municipal y menos riesgo de incidentes." },
  { icon: "alert",      title: "Cobertura ante eventos",       desc: "Cortes de calle, obras o lluvias: cada barrio tiene rutas alternativas internas conocidas. La entrega no se cae." },

  // Sustentabilidad y costos
  { icon: "sun",        title: "Menos kilómetros = menos emisiones", desc: "Reducción estimada de 38% en km recorridos. Huella de carbono menor para la flota oficial del SAE — un dato comunicable." },
  { icon: "gauge",      title: "Eficiencia en combustible",    desc: "Rutas optimizadas reducen consumo de gasoil. El proveedor opera con menor costo y eso protege la sustentabilidad del contrato." },
  { icon: "clock",      title: "Menos horas extra de conductores", desc: "Recorridos más cortos terminan en tiempo. Menos fatiga del personal, menor riesgo laboral, menor sobrecosto operativo." },
  { icon: "scale",      title: "Mejor relación precio/servicio", desc: "El Municipio recibe el mismo precio del pliego con un servicio sustancialmente mejor. Cero costo extra para el erario." },

  // Vínculo con la comunidad educativa
  { icon: "users",      title: "Relación directa con directivos", desc: "Cada barrio tiene un equipo conocido por las escuelas. Comunicación fluida, problemas resueltos sin escalar a Municipio." },
  { icon: "spark",      title: "Visibilidad política positiva", desc: "Un servicio bien gestionado se traduce en percepción positiva del Municipio en cada barrio. Cero costo extra para el erario." },
  { icon: "trending",   title: "Encuestas de satisfacción por zona", desc: "Mediciones específicas por localidad permiten al Municipio detectar y corregir focos de insatisfacción con precisión quirúrgica." },
  { icon: "zap",        title: "Reclamos resueltos en horas, no días", desc: "Con un equipo asignado por barrio, cada reclamo de directivo o familia tiene una respuesta inmediata y trazable." },

  // Adaptabilidad y largo plazo
  { icon: "ruler",      title: "Flexibilidad ante cambios de matrícula", desc: "Si una escuela suma o pierde alumnos, el rebalanceo es inmediato dentro del barrio. No hay que rehacer toda la zona del pliego." },
  { icon: "layers",     title: "Escalable a nuevos servicios",  desc: "Una vez optimizado el reparto alimenticio, el mismo modelo aplica a kits escolares, materiales de educación física, libros, etc." },
  { icon: "calendar",   title: "Datos históricos por barrio",   desc: "Año tras año el Municipio acumula serie temporal por localidad: tendencias de matrícula, consumo, incidencias. Decisiones basadas en evidencia." },
  { icon: "badge",      title: "Alineado con normativa SAE",    desc: "Cumple con todas las exigencias del Servicio Alimentario Escolar provincial: trazabilidad, cadena de frío, registro nutricional." },
  { icon: "compass",    title: "Continuidad del servicio",      desc: "Si un proveedor rota, el conocimiento del barrio queda documentado y se transfiere sin pérdida de calidad." },

  // Sin renegociar el pliego
  { icon: "lock",       title: "Sin modificar el contrato vigente", desc: "La rezonificación es una mejora operativa que asume el operador. No requiere reabrir el pliego ni renegociar precios." },
  { icon: "target",     title: "Implementación gradual",        desc: "Pilotos por barrios permiten validar y ajustar antes del despliegue total. Sin sorpresas, sin riesgo para el Municipio." },
];

function DemoComparativaSection({ data, onlyDemo, onPrevPage, onNextPage }) {
  const d = data || {
    tag: "DEMO COMPARATIVA",
    title: "Pliego vigente vs. propuesta de rezonificación",
    lead: "",
  };
  return (
    <section id="demo-comparativa" className="bg-bone demo-section">
      <div className="shell">
        <div className="section-tag demo-section-tag">
          <span className="demo-section-tag-dot" aria-hidden="true"/>
          <span className="num">02b</span><span className="txt">{d.tag}</span>
        </div>
        <div className="section-head demo-section-head">
          <span className="demo-section-bignum" aria-hidden="true">01</span>
          <h2 className="display-lg">{d.title}</h2>
          {d.lead && <p className="lead" style={{ marginTop: 18 }}>{d.lead}</p>}
        </div>
        <DemoComparativa/>

        {!onlyDemo && (
          <div className="demo-benefits">
            <div className="eyebrow" style={{ textAlign: "center", marginBottom: 8 }}>Mejoras al rezonificar por barrio</div>
            <h3 className="display-sm" style={{ textAlign: "center", marginBottom: 28 }}>Lo que gana el municipio</h3>
            <div className="demo-benefits-grid">
              {DEMO_BENEFITS.map((b, i) => (
                <div className="demo-benefit-card" key={i}>
                  <div className="demo-benefit-icon"><DemoBenefitIcon name={b.icon}/></div>
                  <div className="demo-benefit-title">{b.title}</div>
                  <div className="demo-benefit-desc">{b.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function AhorroSimulator() {
  // Datos calculados desde colegios.json (cache global)
  const [ahorroData, setAhorroData] = React.useState(null);
  React.useEffect(() => {
    if (window.__colegiosCache?.simulador_ahorro) {
      setAhorroData(window.__colegiosCache.simulador_ahorro);
      return;
    }
    fetch("data/colegios.json?v=6")
      .then(r => r.json())
      .then(data => {
        window.__colegiosCache = data;
        if (data.simulador_ahorro) setAhorroData(data.simulador_ahorro);
      })
      .catch(() => {});
  }, []);

  // Slider: nivel de implementación (0% a 100% del techo real)
  const [pctImpl, setPctImpl] = React.useState(70);

  if (!ahorroData) {
    return (
      <div className="ahorro-sim">
        <div className="ahorro-sim-head">
          <div className="eyebrow" style={{ marginBottom: 6 }}>SIMULADOR</div>
          <h3 className="display-sm" style={{ margin: 0 }}>Cargando datos…</h3>
        </div>
      </div>
    );
  }

  const KM_ACTUAL = ahorroData.km_dia_actual;
  const KM_PROPUESTA_TECHO = ahorroData.km_dia_propuesta;
  const AHORRO_TECHO = ahorroData.ahorro_km_dia;
  const AHORRO_PCT_TECHO = ahorroData.ahorro_pct;
  const COSTO_KM = ahorroData.supuestos.costo_km_ars;
  const DIAS_HABILES = ahorroData.supuestos.dias_habiles;

  // Implementación parcial: el ahorro escala linealmente con el nivel de implementación
  const reduccionKmDia = Math.round(AHORRO_TECHO * (pctImpl / 100));
  const ahorroPctEfectivo = (AHORRO_PCT_TECHO * pctImpl / 100);
  const ahorroDia = reduccionKmDia * COSTO_KM;
  const ahorroAnual = ahorroDia * DIAS_HABILES;
  const fmt = (n) => "$" + Math.round(n || 0).toLocaleString("es-AR");
  const fmtKm = (n) => Math.round(n).toLocaleString("es-AR");

  return (
    <div className="ahorro-sim">
      <div className="ahorro-sim-head">
        <div className="ahorro-sim-formula">
          <div className="ahorro-sim-formula-title">Cómo se calcula (datos reales)</div>
          <ol>
            <li>
              Para cada escuela calculamos la distancia hasta su <em>proveedor del pliego actual</em> y
              hasta el <em>proveedor más cercano</em> (la propuesta).
              Total: <strong className="acc-green">{fmtKm(KM_ACTUAL)} km/día</strong> hoy →
              {" "}<strong className="acc-green">{fmtKm(KM_PROPUESTA_TECHO)} km/día</strong> con rezonificación.
            </li>
            <li>
              El ahorro máximo posible es <strong className="acc-green">{fmtKm(AHORRO_TECHO)} km/día ({AHORRO_PCT_TECHO.toFixed(1)}%)</strong>,
              al implementar la propuesta al 100%.
            </li>
            <li>
              Con un grado de implementación del <strong>{pctImpl}%</strong>, el ahorro efectivo es
              {" "}<strong className="acc-green">{fmtKm(reduccionKmDia)} km/día ({ahorroPctEfectivo.toFixed(1)}%)</strong>.
            </li>
            <li>
              A <strong>${COSTO_KM}/km</strong> de costo operativo y <strong>{DIAS_HABILES} días hábiles</strong>:
              {" "}<strong className="acc-green">{fmtKm(reduccionKmDia)} × ${COSTO_KM} × {DIAS_HABILES} = {fmt(ahorroAnual)}</strong> al año.
            </li>
          </ol>
          <div className="ahorro-sim-method">
            <strong>Metodología:</strong> distancia haversine proveedor↔escuela × 1.35 (factor de calle urbana) × 2 (ida + vuelta).
          </div>
        </div>
      </div>
      <div className="ahorro-sim-grid">
        <div className="ahorro-sim-control">
          <div className="ahorro-sim-control-row">
            <span className="mono ahorro-sim-label">Grado de implementación</span>
            <span className="ahorro-sim-pct">{pctImpl}%</span>
          </div>
          <input
            type="range" min="0" max="100" step="5"
            value={pctImpl}
            onChange={e => setPctImpl(parseInt(e.target.value, 10))}
            className="ahorro-sim-slider"
            aria-label="Grado de implementación de la propuesta"
          />
          <div className="ahorro-sim-ticks">
            <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>
        <div className="ahorro-sim-result">
          <div className="ahorro-sim-row">
            <span className="ahorro-sim-row-k">Km ahorrados/día</span>
            <strong className="ahorro-sim-row-v">{reduccionKmDia.toLocaleString("es-AR")} km</strong>
          </div>
          <div className="ahorro-sim-row">
            <span className="ahorro-sim-row-k">Ahorro/día</span>
            <strong className="ahorro-sim-row-v">{fmt(ahorroDia)}</strong>
          </div>
          <div className="ahorro-sim-row total">
            <span className="ahorro-sim-row-k">Ahorro anual estimado</span>
            <strong className="ahorro-sim-total">{fmt(ahorroAnual)}</strong>
          </div>
        </div>
      </div>

      <div className="ahorro-sim-note">
        <div className="ahorro-sim-note-title">¿Por qué el techo es {AHORRO_PCT_TECHO.toFixed(1)}%?</div>
        <p>
          Este número <strong>no es una estimación</strong>: surge de calcular la
          distancia real entre cada una de las {ahorroData.escuelas_consideradas} escuelas
          y los <strong>6 proveedores reales del pliego</strong> (Alvagama, Cofex,
          Logística Sofía, Centurión, LGE, Panila Sur). El pliego actual asigna escuelas
          a proveedores que en muchos casos no están geográficamente cercanos; la
          propuesta corrige eso reasignando cada escuela al proveedor más cercano.
        </p>
        <p>
          El techo natural lo marca la geografía: cuando todas las escuelas ya están
          asignadas a su proveedor óptimo, no hay más km que recortar sin cambios
          estructurales (consolidar proveedores, modificar precios, sumar flota
          municipal). Esa parte excede esta propuesta, que está diseñada para
          ejecutarse <strong>sin renegociar el pliego</strong>.
        </p>
        <p className="ahorro-sim-note-foot">
          La barrita simula <strong>implementación parcial</strong>: muchas
          rezonificaciones se hacen por etapas (no todas las escuelas migran de
          proveedor el primer día). Vas a poder ver, por ejemplo, qué pasa si en el
          primer trimestre se aplica al 50%: ya hay un ahorro material que justifica
          seguir avanzando.
        </p>
      </div>
    </div>
  );
}

function BenefitsPage({ onPrevPage }) {
  return (
    <section id="beneficios" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">B1</span><span className="txt">BENEFICIOS PARA EL MUNICIPIO</span></div>
        <div className="section-head">
          <h2 className="display-lg">Lo que gana el municipio</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Treinta razones concretas por las cuales la rezonificación por barrio mejora el servicio sin sumar gasto municipal.
          </p>
        </div>
        <div className="demo-benefits" style={{ marginTop: 28 }}>
          <div className="demo-benefits-grid">
            {DEMO_BENEFITS.map((b, i) => (
              <div className="demo-benefit-card" key={i}>
                <div className="demo-benefit-icon"><DemoBenefitIcon name={b.icon}/></div>
                <div className="demo-benefit-title">{b.title}</div>
                <div className="demo-benefit-desc">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Sección dedicada al simulador de costos (sacada de BenefitsPage). */
function AhorroSimulatorSection() {
  return (
    <section id="simulador" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">B2</span><span className="txt">SIMULADOR DE COSTOS</span></div>
        <div className="section-head">
          <h2 className="display-lg">Simulá el ahorro de kilómetros</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Movés la barrita y el simulador calcula, en tiempo real, cuántos kilómetros y
            cuánta plata se ahorra el sistema cuando se aplica la rezonificación. Los
            números se basan en las distancias reales entre las 289 escuelas y los 6 proveedores.
          </p>
        </div>
        <AhorroSimulator/>
      </div>
    </section>
  );
}

Object.assign(window, { DemoComparativa, DemoComparativaSection, BenefitsPage, DEMO_BENEFITS, DemoBenefitIcon, AhorroSimulator, AhorroSimulatorSection });
