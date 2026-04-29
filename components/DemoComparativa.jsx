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

const DEMO_STEP_MS = 5400;     // duración total de cada paso (zona o localidad)
const DEMO_OVERLAY_MS = 1400;  // tiempo que se ve el cartel grande tapando el mapa
const DEMO_REVEAL_MS = 4000;   // tiempo que se ve el ruteo / mapa SIN cartel
const DEMO_INTRO_MS = 2500;
const DEMO_HIDE_MS = 350;
const DEMO_END_MS = 2400;
const OSRM_TIMEOUT_MS = 4000;
const OSRM_PREFETCH_CONCURRENCY = 3; // limite concurrente para no caer al rate-limit
const OSRM_RETRY_DELAY_MS = 350;

const DEPOT = {
  lat: -34.8353338,
  lng: -58.4233261,
  nombre: "Real de Catorce - Burzaco",
  direccion: "Ombu 1269",
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
  const depotMarkerRef = React.useRef(null);
  const stopRef = React.useRef(false);
  const seqRef = React.useRef(0);
  const routeCacheRef = React.useRef(new Map()); // key -> latlngs[]

  const [schools, setSchools] = React.useState([]);
  const [zones, setZones] = React.useState([]);
  const [localidades, setLocalidades] = React.useState([]);
  const [running, setRunning] = React.useState(false);
  const [overlay, setOverlay] = React.useState({ visible: false, title: "", sub: "", color: "var(--celeste-700)" });
  const [stage, setStage] = React.useState({ phase: "idle" });
  const [legend, setLegend] = React.useState(null);
  const [isFs, setIsFs] = React.useState(false);
  const [prefetch, setPrefetch] = React.useState({ active: false, done: 0, total: 0 });

  // Datos
  React.useEffect(() => {
    if (window.__colegiosCache) {
      setSchools(window.__colegiosCache.colegios || []);
      setZones(window.__colegiosCache.zonas_disponibles || []);
      setLocalidades(window.__colegiosCache.localidades_disponibles || []);
      return;
    }
    fetch("data/colegios.json?v=3")
      .then(r => r.json())
      .then(d => {
        window.__colegiosCache = d;
        setSchools(d.colegios || []);
        setZones(d.zonas_disponibles || []);
        setLocalidades(d.localidades_disponibles || []);
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

    // Depot marker (siempre visible) - cuadradito ambar al estilo del original
    const depotIcon = L.divIcon({
      className: "demo-depot-icon",
      html: '<div class="demo-depot-pin">⌂</div>',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
    const dm = L.marker([DEPOT.lat, DEPOT.lng], { icon: depotIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(`<strong>${DEPOT.nombre}</strong><br><span style="color:#5C7796">${DEPOT.direccion}</span>`);
    depotMarkerRef.current = dm;

    // Marker layer unico persistente
    const mg = L.layerGroup().addTo(map);
    markersGroupRef.current = mg;

    // Polyline UNICA persistente. Se reusa en cada paso con setLatLngs() y setStyle().
    // Color literal hex porque las SVG vars de CSS no resuelven en stroke.
    const rl = L.polyline([], {
      color: "#1A4A8C",
      weight: 4,
      opacity: 0.85,
      dashArray: "10 8",
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    routeLineRef.current = rl;

    mapRef.current = map;
  }, []);

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

  // Render base: pinta TODOS los colegios como circleMarkers tenues.
  // Se llama al inicio y al final del demo (vista total).
  const renderBase = React.useCallback(() => {
    const map = mapRef.current;
    const mg = markersGroupRef.current;
    const rl = routeLineRef.current;
    if (!map || !mg) return;
    mg.clearLayers();
    if (rl) rl.setLatLngs([]);
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

  // OSRM multi-waypoint con cache, timeout y retry suave.
  // Devuelve un array [[lat,lng], ...] o null si todo fallo.
  const fetchOSRMRoute = async (waypoints, retries = 1) => {
    if (waypoints.length < 2) return null;
    const cache = routeCacheRef.current;
    const key = _cacheKey(waypoints);
    if (cache.has(key)) return cache.get(key);

    // OSRM publico tolera ~10 puntos por request. Partir en chunks.
    const CHUNK = 10;
    const chunks = [];
    if (waypoints.length <= CHUNK) {
      chunks.push(waypoints);
    } else {
      let i = 0;
      while (i < waypoints.length - 1) {
        const end = Math.min(i + CHUNK, waypoints.length);
        chunks.push(waypoints.slice(i, end));
        if (end >= waypoints.length) break;
        i = end - 1; // overlap del ultimo punto
      }
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const all = [];
        for (const ch of chunks) {
          const coordsStr = ch.map(p => `${p.lng},${p.lat}`).join(";");
          const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), OSRM_TIMEOUT_MS);
          const r = await fetch(url, { signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) throw new Error("status " + r.status);
          const j = await r.json();
          const coords = (j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates) || null;
          if (!coords) throw new Error("no route");
          const latlngs = coords.map(c => [c[1], c[0]]);
          if (all.length && latlngs.length) {
            all.push(...latlngs.slice(1));
          } else {
            all.push(...latlngs);
          }
        }
        if (all.length) {
          cache.set(key, all);
          return all;
        }
      } catch (e) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, OSRM_RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
      }
    }
    return null;
  };

  // Construye la lista de jobs de prefetch: zonas + localidades.
  // Cada job: { key, waypoints }
  const _buildAllRouteJobs = () => {
    const jobs = [];
    // Zonas: orden por orden_pliego ascendente
    const zonaList = (zones && zones.length ? zones : Array.from(new Set(schools.map(s => s.zona))).sort());
    zonaList.forEach(z => {
      const subset = schools.filter(s => (s.zona || s.zona_pliego) === z && s.lat && s.lng);
      if (!subset.length) return;
      const ordered = sortByOrden(subset, "orden_pliego");
      const wp = [DEPOT, ...ordered.map(s => ({ lat: s.lat, lng: s.lng })), DEPOT];
      jobs.push({ key: _cacheKey(wp), waypoints: wp });
    });
    // Localidades (excluye Sin asignar)
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
          await fetchOSRMRoute(job.waypoints, 1);
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

  // Highlight subset + dibuja UN SOLO recorrido depot -> 1 -> 2 -> ... -> depot.
  // - Reusa el markersGroupRef.current (clearLayers + add).
  // - Reusa el routeLineRef.current (setLatLngs + setStyle).
  // - Pinta primero linea recta como fallback, luego intenta upgrade a OSRM.
  // Devuelve cuando los markers/linea recta estan pintados (no espera OSRM).
  const highlightAndRoute = (subset, color, orderKey) => {
    const map = mapRef.current;
    const mg = markersGroupRef.current;
    const rl = routeLineRef.current;
    if (!map || !mg || !rl) return;

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

    // Pines numerados sobre cada colegio activo
    const pts = [[DEPOT.lat, DEPOT.lng]];
    ordered.forEach((s, idx) => {
      const ord = s[orderKey] || (idx + 1);
      const icon = L.divIcon({
        className: "demo-pin-icon",
        html: `<div class="demo-pin" style="background:${color}">${ord}</div>`,
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
      return;
    }

    // Fallback inmediato: linea recta uniendo todos los puntos.
    const straight = [
      [DEPOT.lat, DEPOT.lng],
      ...ordered.map(s => [s.lat, s.lng]),
      [DEPOT.lat, DEPOT.lng],
    ];
    try {
      rl.setStyle({ color });
      rl.setLatLngs(straight);
    } catch (_) {}

    // Intento de upgrade a ruta OSRM real (cache primero).
    const waypoints = [DEPOT, ...ordered.map(s => ({ lat: s.lat, lng: s.lng })), DEPOT];
    const key = _cacheKey(waypoints);
    const cached = routeCacheRef.current.get(key);
    if (cached && cached.length) {
      try { rl.setLatLngs(cached); } catch (_) {}
      return;
    }
    // Async upgrade
    fetchOSRMRoute(waypoints, 0).then(latlngs => {
      // Sequence guard: si el usuario ya paso al siguiente paso, ignorar
      if (mySeq !== seqRef.current) return;
      if (stopRef.current) return;
      if (!latlngs || !latlngs.length) return;
      try { rl.setLatLngs(latlngs); } catch (_) {}
    }).catch(() => {});
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    seqRef.current += 1; // invalida respuestas OSRM en vuelo
    setRunning(false);
    setOverlay({ visible: false, title: "", sub: "", color: "var(--celeste-700)" });
    setStage({ phase: "idle" });
    setLegend(null);
    renderBase();
    const map = mapRef.current;
    if (map) map.fitBounds([[-34.84, -58.50], [-34.69, -58.34]], { animate: true });
    await exitFs();
  };

  const showMsg = async (title, sub, color, ms = DEMO_INTRO_MS) => {
    if (stopRef.current) return;
    setOverlay({ visible: true, title, sub, color });
    await sleep(ms);
    if (stopRef.current) return;
    setOverlay(o => ({ ...o, visible: false }));
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
      // Stage 1 - Pliego vigente
      setStage({ phase: "pliego" });
      await showMsg(
        "Propuesta municipal vigente",
        "Ruteo basado en zonas de pliego (Zona 1 a Zona 12)",
        "var(--celeste-700)"
      );
      if (stopRef.current) return;

      // Orden numerico estable Zona 1, Zona 2, ..., Zona 12
      const zonaList = (zones && zones.length ? zones.slice() : []).sort((a, b) => {
        const na = parseInt((a.match(/\d+/) || ["0"])[0], 10);
        const nb = parseInt((b.match(/\d+/) || ["0"])[0], 10);
        return na - nb;
      });
      const totalZ = zonaList.length;

      for (let i = 0; i < zonaList.length; i++) {
        if (stopRef.current) break;
        const z = zonaList[i];
        const subset = schools.filter(s => (s.zona || s.zona_pliego) === z);
        if (!subset.length) continue;
        const k = kpisOf(subset);
        try {
          highlightAndRoute(subset, "#1A4A8C", "orden_pliego");
        } catch (e) {
          console.warn("highlightAndRoute zona err", z, e);
        }
        setLegend({
          name: z,
          kpis: k,
          ritmo: "zonas dispersas del pliego",
          idx: i + 1,
          total: totalZ,
          color: "var(--celeste-700)",
          phase: "pliego",
          schools: subset.length,
        });
        setOverlay({
          visible: true,
          title: z,
          sub: `${subset.length} colegios | ${k.total.toLocaleString("es-AR")} cupos | zonas del pliego`,
          color: "var(--celeste-700)",
        });
        // Mostrar cartel grande breve, después ocultarlo y dejar el ruteo en vista
        await sleep(DEMO_OVERLAY_MS);
        if (stopRef.current) break;
        setOverlay(o => ({ ...o, visible: false }));
        await sleep(DEMO_REVEAL_MS);
        if (stopRef.current) break;
      }

      if (stopRef.current) return;

      // Stage 2 - Propuesta R14: una zona por barrio
      setStage({ phase: "propuesta" });
      await showMsg(
        "Propuesta Real de Catorce",
        "Ruteo barrio por barrio: una zona logistica por localidad",
        "var(--celeste-800)"
      );
      if (stopRef.current) return;

      const locNames = (localidades && localidades.length
        ? localidades
        : Array.from(new Set(schools.map(s => s.localidad).filter(Boolean))).sort()
      ).filter(l => l && l !== "Sin asignar").slice().sort();

      for (let i = 0; i < locNames.length; i++) {
        if (stopRef.current) break;
        const loc = locNames[i];
        const subset = schools.filter(s => s.localidad === loc);
        if (!subset.length) continue;
        const k = kpisOf(subset);
        const color = _demoColorForLoc(loc);
        try {
          highlightAndRoute(subset, color, "orden_localidad");
        } catch (e) {
          console.warn("highlightAndRoute loc err", loc, e);
        }
        setLegend({
          name: loc,
          kpis: k,
          ritmo: "una zona por barrio",
          idx: i + 1,
          total: locNames.length,
          color,
          phase: "propuesta",
          schools: subset.length,
        });
        setOverlay({
          visible: true,
          title: loc,
          sub: `${subset.length} colegios | ${k.total.toLocaleString("es-AR")} cupos | una zona por barrio`,
          color,
        });
        await sleep(DEMO_OVERLAY_MS);
        if (stopRef.current) break;
        setOverlay(o => ({ ...o, visible: false }));
        await sleep(DEMO_REVEAL_MS);
        if (stopRef.current) break;
      }

      if (stopRef.current) return;
      setLegend(null);
      await showMsg(
        "Analisis comparativo finalizado",
        "12 zonas dispersas vs. una zona por barrio | vista de conjunto restaurada",
        "var(--celeste-800)",
        DEMO_END_MS
      );
    } catch (err) {
      console.error("Error en demo:", err);
    } finally {
      stopRef.current = false;
      seqRef.current += 1;
      setRunning(false);
      setStage({ phase: "idle" });
      setLegend(null);
      renderBase();
      const map = mapRef.current;
      if (map) map.fitBounds([[-34.84, -58.50], [-34.69, -58.34]], { animate: true });
      await exitFs();
    }
  };

  const phaseLabel =
    stage.phase === "pliego" ? "* Pliego vigente | ritmo nervioso" :
    stage.phase === "propuesta" ? "* Propuesta R14 | una zona por barrio" :
    "* Vista en vivo";
  const phaseColor =
    stage.phase === "pliego" ? "var(--celeste-700)" :
    stage.phase === "propuesta" ? "var(--celeste-800)" :
    "var(--ink-500)";

  const prefetchPct = prefetch.total ? Math.round((prefetch.done / prefetch.total) * 100) : 0;

  return (
    <div className="demo-wrap">
      <div className="demo-head">
        <div className="demo-badge" style={{ color: phaseColor, borderColor: phaseColor }}>
          {phaseLabel}
        </div>
        <div className="demo-controls">
          {!running ? (
            <button className="btn btn-primary" onClick={play}>&#9654; Iniciar demo comparativa</button>
          ) : (
            <button className="btn btn-ghost demo-stop" onClick={stop}>&#9632; Detener</button>
          )}
        </div>
      </div>

      <div className={"demo-stage" + (legend ? " has-legend" : "")}>
        <div ref={frameEl} className={"demo-frame" + (isFs ? " is-fs" : "")}>
          <div ref={mapEl} id="demoComparativaMap" className="demo-map"/>
          {prefetch.active && running && (
            <div className="demo-prefetch mono">
              Cargando rutas... {prefetch.done} / {prefetch.total} ({prefetchPct}%)
            </div>
          )}
          {legend && (
            <aside className={"demo-legend" + (isFs ? " floating" : "")}>
              <div className="demo-legend-head" style={{ color: legend.color }}>
                <span className="demo-legend-dot" style={{ background: legend.color }}/>
                <strong>{legend.name}</strong>
                <span className="demo-legend-idx mono">{legend.idx} / {legend.total}</span>
              </div>
              <div className="demo-legend-ritmo mono">{legend.ritmo}</div>
              <div className="demo-legend-kpis">
                <div className="demo-kpi"><span className="k">Colegios</span><strong>{legend.schools}</strong></div>
                <div className="demo-kpi"><span className="k">Modulos</span><strong>{legend.kpis.modulos.toLocaleString("es-AR")}</strong></div>
                <div className="demo-kpi"><span className="k">Comedor</span><strong>{legend.kpis.comedor.toLocaleString("es-AR")}</strong></div>
                <div className="demo-kpi"><span className="k">DyM/DMC</span><strong>{legend.kpis.dmc.toLocaleString("es-AR")}</strong></div>
                <div className="demo-kpi total"><span className="k">Total cupos</span><strong>{legend.kpis.total.toLocaleString("es-AR")}</strong></div>
              </div>
            </aside>
          )}
          {overlay.visible && (
            <div className="demo-overlay">
              <div className="demo-overlay-title" style={{ color: overlay.color }}>{overlay.title}</div>
              <div className="demo-overlay-sub">{overlay.sub}</div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function DemoBenefitIcon({ name }) {
  const common = { width: 32, height: 32, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "users")  return (<svg {...common}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14a4 4 0 0 1 6 4"/></svg>);
  if (name === "shield") return (<svg {...common}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>);
  if (name === "leaf")   return (<svg {...common}><path d="M11 20a8 8 0 0 0 8-8c0-4.5-3-8-8-9-1 5-5 6-5 11a6 6 0 0 0 5 6"/><path d="M6 18c2-3 5-5 9-6"/></svg>);
  if (name === "spark")  return (<svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>);
  if (name === "road")   return (<svg {...common}><path d="M5 21 8 3"/><path d="m16 3 3 18"/><path d="M12 5v3"/><path d="M12 12v3"/><path d="M12 19v2"/></svg>);
  if (name === "chart")  return (<svg {...common}><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-7"/></svg>);
  return null;
}

const DEMO_BENEFITS = [
  { icon: "users",  title: "Auditorias por barrio",      desc: "Un auditor cubre toda una localidad sin trasladarse. Mas colegios verificados por jornada con el mismo equipo." },
  { icon: "shield", title: "Trazabilidad inmediata",     desc: "Si falla algo en Banfield Este, el municipio sabe a quien llamar. Una zona = un equipo responsable." },
  { icon: "leaf",   title: "Cadena termica protegida",   desc: "Rutas cortas dentro del barrio. La vianda llega caliente, antes del recreo, sin riesgo de cadena de frio rota." },
  { icon: "spark",  title: "Equidad de servicio",        desc: "Todos los colegios de un barrio reciben en la misma ventana horaria. Cero diferencias entre escuelas vecinas." },
  { icon: "road",   title: "Resiliencia operativa",      desc: "Si una camioneta falla en una localidad, otra del mismo barrio cubre sin desorganizar el sistema." },
  { icon: "chart",  title: "Metrica reportable",         desc: "Indicadores claros por barrio para presentar al Concejo Deliberante: cumplimiento, km recorridos, frescura, tiempo medio." },
];

function DemoComparativaSection({ data, onlyDemo, onPrevPage, onNextPage }) {
  const d = data || {
    tag: "DEMO COMPARATIVA",
    title: "Pliego vigente vs. propuesta Real de Catorce",
    lead: "Una sola vista en vivo: primero recorre las 12 zonas del pliego con ritmo nervioso, despues la propuesta barrio por barrio - una zona logistica por localidad.",
  };
  return (
    <section id="demo-comparativa" className="bg-bone">
      <div className="shell">
        <div className="section-tag"><span className="num">02b</span><span className="txt">{d.tag}</span></div>
        <div className="section-head">
          <h2 className="display-lg">{d.title}</h2>
          <p className="lead" style={{ marginTop: 18 }}>{d.lead}</p>
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

function BenefitsPage({ onPrevPage }) {
  return (
    <section id="beneficios" className="bg-paper">
      <div className="shell">
        <div className="section-tag"><span className="num">03</span><span className="txt">BENEFICIOS</span></div>
        <div className="section-head">
          <h2 className="display-lg">Lo que gana el municipio</h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Seis frentes concretos en los que la rezonificación por barrio mejora el servicio sin sumar gasto municipal.
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
        <div style={{
          marginTop: 36, padding: "22px 24px",
          background: "var(--celeste-50)", border: "1px solid var(--celeste-200)",
          borderRadius: "var(--r-md)", textAlign: "center",
        }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>CIERRE DEL RECORRIDO</div>
          <p style={{ fontSize: 16, color: "var(--ink-700)", margin: 0, lineHeight: 1.6 }}>
            Una rezonificación por barrio convierte logística en servicio público auditable.
            Sigue explorando: mapa interactivo, diagnóstico operativo y calculadora abajo.
          </p>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { DemoComparativa, DemoComparativaSection, BenefitsPage, DEMO_BENEFITS, DemoBenefitIcon });
