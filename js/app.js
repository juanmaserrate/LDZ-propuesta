const state = {
  data: null,
  activeFilter: null, // { type: 'pliego'|'localidad', value: '...' }
  map: null,
  markersGroup: null,
  routeLine: null,
  depotMarker: null,
  isDemoActive: false,
  currentSchoolIndex: -1,  // Índice del colegio actual en la ruta
  currentTab: 'mapa',      // 'mapa' | 'analisis-pliego' | 'analisis-zona'
  filteredColegios: [],    // Array de colegios filtrados actualmente
  routeCache: {},          // OSRM cache: key -> {km, coords}
  routePending: {}         // OSRM in-flight promises
};

// === OSRM real-road routing ===
function _routeKey(a, b) {
  return `${(+a.lat).toFixed(5)},${(+a.lng).toFixed(5)}->${(+b.lat).toFixed(5)},${(+b.lng).toFixed(5)}`;
}
function haversineKmRaw(lat1, lng1, lat2, lng2) {
  const R = 6371, dL = (lat2-lat1)*Math.PI/180, dG = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
// Decodifica polyline6 de Valhalla
function decodeValhallaPolyline(str, precision) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  const factor = Math.pow(10, precision || 6);
  while (index < str.length) {
    let byte, shift = 0, result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

function fetchValhallaMulti(points) {
  // points: [{lat,lng},...] -> {km, coords}
  const body = {
    locations: points.map(p => ({ lat: +p.lat, lon: +p.lng, type: 'break' })),
    costing: 'auto',
    directions_options: { units: 'kilometers' }
  };
  return fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json()).then(j => {
    if (!j || !j.trip || !j.trip.legs) throw new Error('valhalla bad');
    let coords = [];
    let km = 0;
    j.trip.legs.forEach((leg, i) => {
      const c = decodeValhallaPolyline(leg.shape, 6);
      coords = coords.concat(i === 0 ? c : c.slice(1));
      km += leg.summary.length;
    });
    return { km, coords };
  });
}

function fetchOSRMRoute(a, b) {
  const key = _routeKey(a, b);
  if (state.routeCache[key]) return Promise.resolve(state.routeCache[key]);
  if (state.routePending[key]) return state.routePending[key];
  const fb = () => {
    const km = haversineKmRaw(+a.lat, +a.lng, +b.lat, +b.lng) * 1.4;
    state.routeCache[key] = { km, coords: [[+a.lat, +a.lng], [+b.lat, +b.lng]] };
    return state.routeCache[key];
  };
  const p = fetchValhallaMulti([a, b]).then(res => {
    state.routeCache[key] = res;
    return res;
  }).catch(fb);
  state.routePending[key] = p;
  return p;
}
function getRouteKm(lat1, lng1, lat2, lng2) {
  const key = _routeKey({lat:lat1,lng:lng1}, {lat:lat2,lng:lng2});
  if (state.routeCache[key]) return state.routeCache[key].km;
  fetchOSRMRoute({lat:lat1,lng:lng1}, {lat:lat2,lng:lng2});
  return haversineKmRaw(lat1, lng1, lat2, lng2) * 1.4;
}
async function prefetchAllFilterRoutes() {
  if (!state.data || !state.data.depot) return;
  state.multiRouteCache = state.multiRouteCache || {};
  const depot = state.data.depot;
  const cols = state.data.colegios.filter(c => c.lat && c.lng);
  // Agrupar por pliego y por localidad
  const groups = {};
  cols.forEach(c => {
    const p = c.zona_pliego;
    const l = c.localidad;
    if (p) (groups['pliego:' + p] = groups['pliego:' + p] || []).push({ c, ord: c.orden_pliego || 9999 });
    if (l) (groups['localidad:' + l] = groups['localidad:' + l] || []).push({ c, ord: c.orden_localidad || 9999 });
  });
  for (const k of Object.keys(groups)) {
    const arr = groups[k].sort((a,b) => a.ord - b.ord).map(x => x.c);
    const raw = [[depot.lat, depot.lng], ...arr.map(c => [parseFloat(c.lat), parseFloat(c.lng)])];
    const cacheKey = k;
    if (state.multiRouteCache[cacheKey]) continue;
    try {
      const pts = raw.map(c => ({ lat: c[0], lng: c[1] }));
      const CHUNK = 20;
      let merged = [];
      for (let i = 0; i < pts.length - 1; i += (CHUNK - 1)) {
        const slice = pts.slice(i, i + CHUNK);
        if (slice.length < 2) break;
        const res = await fetchValhallaMulti(slice);
        merged = merged.concat(i === 0 ? res.coords : res.coords.slice(1));
      }
      if (merged.length) state.multiRouteCache[cacheKey] = merged;
    } catch (e) { console.warn('prefetch filter failed', k, e); }
    // Si el filtro actual coincide, repintar
    if (state.activeFilter && state.multiRouteCache[cacheKey]) {
      try { renderMap(state.filteredColegios || []); } catch(e){}
    }
  }
}

async function prefetchDepotRoutes() {
  if (!state.data || !state.data.depot) return;
  const depot = state.data.depot;
  const cols = state.data.colegios.filter(c => c.lat && c.lng);
  let i = 0;
  const worker = async () => {
    while (i < cols.length) {
      const c = cols[i++];
      await fetchOSRMRoute(depot, { lat: parseFloat(c.lat), lng: parseFloat(c.lng) });
    }
  };
  // Serial para evitar rate-limit del servidor público OSRM
  await worker();
  // Re-render current view to use real distances
  if (typeof renderContent === 'function') renderContent();
}

const UI = {
  loader: document.getElementById('appLoader'),
  navLoc: document.getElementById('nav-loc'),
  navPliego: document.getElementById('nav-pliego'),
  btnTodas: document.querySelector('.btn-todas'),
  list: document.getElementById('listaColegios'),
  kpiColegios: document.getElementById('kpiColegios'),
  kpiDistancia: document.getElementById('kpiDistancia'),
  kpiCupos: document.getElementById('kpiCupos'),
  dropdownLoc: document.getElementById('dropdownLoc'),
  dropdownPliego: document.getElementById('dropdownPliego'),
  btnDemo: document.getElementById('btnDemo'),
  btnStopDemo: document.getElementById('btnStopDemo'),
  overlay: document.getElementById('presentationOverlay'),
  poTitle: document.getElementById('poTitle'),
  poText: document.getElementById('poText'),
};

function initMap() {
  const bounds = L.latLngBounds([-34.88, -58.55], [-34.68, -58.30]);
  state.map = L.map('mapa', {
    zoomControl: false, attributionControl: false,
    maxBounds: bounds, maxBoundsViscosity: 1.0, minZoom: 11
  }).setView([-34.7609, -58.4063], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  // Dark Map
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd'
  }).addTo(state.map);

  state.markersGroup = L.layerGroup().addTo(state.map);
  state.routeLine = L.polyline([], {color: '#4351e8', weight: 4, className: 'animated-route', opacity: 0.8}).addTo(state.map);

  // Connect navigation buttons
  document.getElementById('mapNavPrev').onclick = () => navigateSchool('prev');
  document.getElementById('mapNavNext').onclick = () => navigateSchool('next');
}

function getZoneColor(strVal) {
    const defaultColor = "#10a37f";
    if (!strVal || strVal === "Sin Zona" || strVal === "Todas") return defaultColor;
    const colors = ["#4351e8", "#10a37f", "#e67e22", "#d63031", "#8e44ad", "#0984e3", "#e84393", "#00cec9"];
    let hash = 0; for(let i=0; i<strVal.length; i++){ hash += strVal.charCodeAt(i); }
    return colors[hash % colors.length];
}

function loadData() {
  try {
    if (!window.appData) throw new Error("Datos no encontrados");
    state.data = window.appData;
    state.activeFilter = { type: 'ninguno', value: 'Todas' };
    
    UI.loader.style.opacity = '0';
    setTimeout(() => { UI.loader.style.display = 'none'; }, 500);

    buildNav();
    renderContent();
    prefetchDepotRoutes();
    prefetchAllFilterRoutes();
  } catch (err) { console.error(err); }
}

function buildNav() {
  // Tab Navigation
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  // Dropdown Logic
  document.getElementById('toggleLoc').onclick = function(e) {
      e.stopPropagation();
      UI.dropdownLoc.classList.toggle('open');
      UI.dropdownPliego.classList.remove('open');
  };
  document.getElementById('togglePliego').onclick = function(e) {
      e.stopPropagation();
      UI.dropdownPliego.classList.toggle('open');
      UI.dropdownLoc.classList.remove('open');
  };

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
      UI.dropdownLoc.classList.remove('open');
      UI.dropdownPliego.classList.remove('open');
  });
  UI.navLoc.onclick = (e) => e.stopPropagation();
  UI.navPliego.onclick = (e) => e.stopPropagation();

  const updateButtons = () => {
    UI.navPliego.querySelectorAll('button').forEach(b => b.classList.toggle('active', state.activeFilter.value === b.dataset.val && state.activeFilter.type === 'pliego'));
    UI.navLoc.querySelectorAll('button').forEach(b => b.classList.toggle('active', state.activeFilter.value === b.dataset.val && state.activeFilter.type === 'localidad'));
  };

  state.data.localidades.forEach(l => {
    let b = document.createElement('button');
    b.className = 'pill-btn';
    b.textContent = l; b.dataset.val = l;
    b.onclick = () => { state.activeFilter = { type: 'localidad', value: l }; UI.dropdownLoc.classList.remove('open'); updateButtons(); renderContent(); };
    UI.navLoc.appendChild(b);
  });

  state.data.zonas_pliego.forEach(z => {
    let b = document.createElement('button');
    b.className = 'pill-btn';
    b.textContent = z; b.dataset.val = z;
    b.onclick = () => { state.activeFilter = { type: 'pliego', value: z }; UI.dropdownPliego.classList.remove('open'); updateButtons(); renderContent(); };
    UI.navPliego.appendChild(b);
  });

  UI.btnTodas.onclick = () => { state.activeFilter = { type: 'ninguno', value: 'Todas' }; updateButtons(); renderContent(); };
  UI.btnDemo.onclick = () => playPresentation();
  UI.btnStopDemo.onclick = () => { state.isDemoActive = false; };
  updateButtons();
}

function renderContent() {
  let filtered = [];
  if (state.activeFilter.type === 'ninguno') filtered = state.data.colegios;
  else if (state.activeFilter.type === 'pliego') filtered = state.data.colegios.filter(c => c.zona_pliego === state.activeFilter.value);
  else if (state.activeFilter.type === 'localidad') filtered = state.data.colegios.filter(c => c.localidad === state.activeFilter.value);

  if (state.activeFilter.type === 'pliego') filtered.sort((a,b) => a.orden_pliego - b.orden_pliego);
  else if (state.activeFilter.type === 'localidad') filtered.sort((a,b) => a.orden_localidad - b.orden_localidad);

  // Guardar array filtrado y resetear índice
  state.filteredColegios = filtered;
  state.currentSchoolIndex = -1;
  updateNavButtons();

  UI.kpiColegios.textContent = filtered.length;
  
  // Calculate routing distance and cupos
  let totalDist = 0; let totalCupos = 0;
  let lastPoint = state.data && state.data.depot ? L.latLng(state.data.depot.lat, state.data.depot.lng) : null;
  
  filtered.forEach(c => {
      let mod = parseInt(c.cupos.modulos) || 0;
      let com = parseInt(c.cupos.comedor) || 0;
      totalCupos += (mod + com);
      
      if (c.lat && c.lng) {
          let p = L.latLng(c.lat, c.lng);
          if (lastPoint) totalDist += lastPoint.distanceTo(p);
          lastPoint = p;
      }
  });

  // Calculate return to depot if routing is active
  if (state.activeFilter.type !== 'ninguno' && lastPoint && state.data && state.data.depot) {
      totalDist += lastPoint.distanceTo(L.latLng(state.data.depot.lat, state.data.depot.lng));
  }

  UI.kpiDistancia.textContent = (totalDist / 1000).toFixed(1) + " km";
  UI.kpiCupos.textContent = totalCupos.toLocaleString();

  renderList(filtered);
  renderMap(filtered);
}

function renderList(colegios) {
  UI.list.innerHTML = '';
  if(colegios.length === 0) return;

  const zColor = getZoneColor(state.activeFilter.value);
  const titleStr = state.activeFilter.type === 'ninguno' ? "Vista General Escuelas" : `Ruta Activa: ${state.activeFilter.value}`;

  const title = document.createElement('h3');
  title.className = 'zona-title';
  title.innerHTML = `${titleStr} <span class="zona-title-count">(${colegios.length})</span>`;
  UI.list.appendChild(title);

  // Calcular cupos totales por UdN
  let totalModulos = 0, totalComedor = 0, totalDM = 0, totalPatios = 0, totalDMC = 0;
  colegios.forEach(c => {
    const cupos = c.cupos || {};
    const dmc = cupos.dmc_comedor || 0;
    const com = cupos.comedor || 0;
    totalModulos += (cupos.modulos || 0);
    totalComedor += com;
    totalDM += (dmc - com);
    totalPatios += (cupos.patios || 0);
    totalDMC += dmc;
  });

  // Mostrar resumen de cupos con clases CSS — todas las UdN
  const resumenDiv = document.createElement('div');
  resumenDiv.className = 'cupos-summary';
  resumenDiv.innerHTML = `
    <div class="cupos-summary-title">UNIDADES DE NEGOCIO</div>
    <div class="cupos-summary-grid">
      <div class="cupo-stat cupo-stat--green">
        <span class="cupo-stat-label">Módulos MESA</span>
        <span class="cupo-stat-val">${totalModulos.toLocaleString()}</span>
      </div>
      <div class="cupo-stat cupo-stat--orange">
        <span class="cupo-stat-label">Comedor</span>
        <span class="cupo-stat-val">${totalComedor.toLocaleString()}</span>
      </div>
      <div class="cupo-stat cupo-stat--purple">
        <span class="cupo-stat-label">Desayuno y Merienda</span>
        <span class="cupo-stat-val">${totalDM.toLocaleString()}</span>
      </div>
      ${totalPatios > 0 ? `<div class="cupo-stat" style="border-color:var(--cyan)">
        <span class="cupo-stat-label" style="color:var(--cyan)">Patios Abiertos</span>
        <span class="cupo-stat-val" style="color:var(--cyan)">${totalPatios.toLocaleString()}</span>
      </div>` : ''}
    </div>
    <div class="cupo-stat-total">
      <span class="cupo-stat-label">Desayuno y Merienda</span>
      <span class="cupo-val--highlight">${totalDMC.toLocaleString()}</span>
    </div>
  `;
  UI.list.appendChild(resumenDiv);

  const pList = document.createElement('ul');
  pList.className = 'lista-paradas';

  colegios.forEach((c, idx) => {
      let orderVal = state.activeFilter.type === 'pliego' ? c.orden_pliego : (state.activeFilter.type === 'localidad' ? c.orden_localidad : '-');
      const li = document.createElement('li');
      const isCurrentSchool = idx === state.currentSchoolIndex;
      li.className = 'parada-item' + (isCurrentSchool ? ' parada-item--active' : '');
      li.onclick = () => {
        state.currentSchoolIndex = idx;
        updateNavButtons();
        focusMap(c.lat, c.lng, 16);
      };

      const cupos = c.cupos || {};
      const cupoDMC = (cupos.dmc_comedor || 0);
      const cupoCom = (cupos.comedor || 0);
      const cupoDM = cupoDMC - cupoCom;

      li.innerHTML = `
          <div class="parada-header">
            <span class="parada-index" style="background:${zColor}22; color:${zColor}; border:1px solid ${zColor}">${orderVal}</span>
            <span class="parada-id">${isCurrentSchool ? '<span class="parada-arrow">➤</span> ' : ''}${c.nombre}</span>
            <span class="parada-dmc" style="color:${zColor};">${cupoDMC > 0 ? cupoDMC : '-'}</span>
          </div>
          <div class="parada-dir">${c.direccion}</div>
          <div class="parada-tags">
            <span class="tag tag--default">Z: ${c.zona_pliego}</span>
            <span class="tag tag--default">Loc: ${c.localidad}</span>
            ${cupos.modulos ? '<span class="tag tag--green">Mod:' + cupos.modulos + '</span>' : ''}
            ${cupoCom ? '<span class="tag tag--orange">Com:' + cupoCom + '</span>' : ''}
            ${cupoDM > 0 ? '<span class="tag" style="background:rgba(168,85,247,0.15);color:var(--purple);border-color:var(--purple)">DM:' + cupoDM + '</span>' : ''}
            ${cupos.patios ? '<span class="tag" style="background:rgba(34,211,238,0.15);color:var(--cyan);border-color:var(--cyan)">Pat:' + cupos.patios + '</span>' : ''}
          </div>
      `;
      pList.appendChild(li);
  });

  UI.list.appendChild(pList);
}

function renderMap(colegios) {
  state.markersGroup.clearLayers();
  state.routeLine.setLatLngs([]);
  if (state.depotMarker) state.map.removeLayer(state.depotMarker);

  let bounds = L.latLngBounds();
  let hasValidData = false;
  
  if (state.data && state.data.depot) {
      state.depotMarker = L.marker([state.data.depot.lat, state.data.depot.lng], {
        icon: L.divIcon({ className: 'custom-marker', html: `<div style="background:#e67e22;width:24px;height:24px;border-radius:6px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,0.5);"><span style="color:white;font-size:10px">⌂</span></div>`, iconSize: [24,24], iconAnchor: [12,12] })
      }).addTo(state.map);
      state.depotMarker.bindPopup("<div class='dark-popup'><strong style='color:#ffffff'>🏢 Depósito Burzaco</strong><br>Ombú 1269</div>");
      bounds.extend([state.data.depot.lat, state.data.depot.lng]);
  }

  let routeCoords = state.data && state.data.depot ? [[state.data.depot.lat, state.data.depot.lng]] : [];
  let rawRouteCoords = state.data && state.data.depot ? [[state.data.depot.lat, state.data.depot.lng]] : [];

  // Track shared locations to prevent overlap
  const coordCache = {};

  colegios.forEach(c => {
    if (c.lat && c.lng) {
      let lat = parseFloat(c.lat);
      let lng = parseFloat(c.lng);

      // Jitter logic: More aggressive shift for shared addresses
      // Note: 1e-4 is approx 11 meters. 0.0004 is approx 45 meters.
      const key = `${lat.toFixed(5)}|${lng.toFixed(5)}`;
      if (coordCache[key]) {
          const count = coordCache[key];
          const angle = (count - 1) * (Math.PI / 2.5); // Stagger angle
          const radius = 0.00045 * count; // ~50m offset per instance
          lat += Math.cos(angle) * radius;
          lng += Math.sin(angle) * radius;
          coordCache[key]++;
      } else {
          coordCache[key] = 1;
      }

      const color = getZoneColor(state.activeFilter.type === 'ninguno' ? c.zona_pliego : state.activeFilter.value);
      let isBig = state.activeFilter.type !== "ninguno";
      let orderVal = state.activeFilter.type === 'pliego' ? c.orden_pliego : c.orden_localidad;

      let icon;
      if (isBig) {
        icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="background:${color};width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:0 6px 15px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:12px;">${orderVal}</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13]
        });
      } else {
        // Vista total: pin minimalista monocromo
        const pinColor = '#e2e8f0';
        const pinStroke = '#0f172a';
        icon = L.divIcon({
          className: 'custom-marker',
          html: `<svg width="22" height="28" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));">
            <path d="M11 0.8 C5.4 0.8 1 5.2 1 10.7 C1 18.5 11 27.2 11 27.2 C11 27.2 21 18.5 21 10.7 C21 5.2 16.6 0.8 11 0.8 Z" fill="${pinColor}" stroke="${pinStroke}" stroke-width="1.4"/>
            <circle cx="11" cy="10.7" r="3.4" fill="${pinStroke}"/>
          </svg>`,
          iconSize: [22, 28], iconAnchor: [11, 27]
        });
      }

      // Z-Index: ensure sequence is logical, earlier stops stay visible
      const m = L.marker([lat, lng], { 
          icon: icon,
          zIndexOffset: state.activeFilter.type !== "ninguno" ? (1000 - orderVal) : 0 
      });
      let popupContent = `
        <div style="font-family:'Outfit',sans-serif;color:var(--text-dark);padding:2px;">
            <strong style="color:${color};font-size:1.05rem;display:block;margin-bottom:4px;">${c.nombre} ${isBig ? `(#${orderVal})` : ''}</strong>
            <div style="font-size:0.85rem;color:var(--text-light);margin-bottom:8px;">${c.direccion}</div>
            <div style="font-size:0.8rem;background:rgba(255,255,255,0.05);padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1)">
                <strong>Pliego:</strong> ${c.zona_pliego}<br>
                <strong>Localidad:</strong> ${c.localidad}<br>
                Módulos(${c.cupos.modulos}) | Comedor(${c.cupos.comedor}) | DyM(${c.cupos.dmc_comedor||0})${c.cupos.patios ? ' | Patios('+c.cupos.patios+')' : ''}
            </div>
        </div>
      `;
      m.bindPopup(popupContent, {className: 'dark-popup'});
      state.markersGroup.addLayer(m);
      bounds.extend([lat, lng]);
      routeCoords.push([lat, lng]);
      rawRouteCoords.push([parseFloat(c.lat), parseFloat(c.lng)]);
      hasValidData = true;
    }
  });

  if (state.activeFilter.type !== "ninguno" && hasValidData) {
      // Cache por conjunto de waypoints
      state.multiRouteCache = state.multiRouteCache || {};
      const cacheKey = `${state.activeFilter.type}:${state.activeFilter.value}`;
      const cached = state.multiRouteCache[cacheKey];
      if (cached) {
        state.routeLine.setLatLngs(cached);
      } else {
        state.routeLine.setLatLngs(routeCoords); // fallback inmediato
        state._routeSeq = (state._routeSeq || 0) + 1;
        const mySeq = state._routeSeq;
        (async () => {
          try {
            const pts = rawRouteCoords.map(c => ({ lat: c[0], lng: c[1] }));
            const CHUNK = 20;
            let merged = [];
            for (let i = 0; i < pts.length - 1; i += (CHUNK - 1)) {
              const slice = pts.slice(i, i + CHUNK);
              if (slice.length < 2) break;
              const res = await fetchValhallaMulti(slice);
              if (state._routeSeq !== mySeq) return;
              merged = merged.concat(i === 0 ? res.coords : res.coords.slice(1));
            }
            if (merged.length) {
              state.multiRouteCache[cacheKey] = merged;
              state.routeLine.setLatLngs(merged); state.routeLine.redraw && state.routeLine.redraw();
            }
          } catch (e) { console.warn('Valhalla route failed', e); }
        })();
      }
      state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  } else if (state.activeFilter.type === "ninguno" && hasValidData) {
      // Focus map to Lomas de Zamora specifically for total view
      state.map.setView([-34.7500, -58.4200], 12);
  }
}

function focusMap(lat, lng, zoom) { if (lat && lng) state.map.setView([lat, lng], zoom); }

function navigateSchool(direction) {
  if (state.filteredColegios.length === 0) return;

  if (direction === 'next') {
    state.currentSchoolIndex = Math.min(state.currentSchoolIndex + 1, state.filteredColegios.length - 1);
  } else if (direction === 'prev') {
    state.currentSchoolIndex = Math.max(state.currentSchoolIndex - 1, 0);
  }

  // Obtener colegio actual y centrar mapa
  const colegio = state.filteredColegios[state.currentSchoolIndex];
  if (colegio && colegio.lat && colegio.lng) {
    state.map.setView([parseFloat(colegio.lat), parseFloat(colegio.lng)], 16);
  }

  // Actualizar estado de botones
  updateNavButtons();

  // Re-renderizar lista para mostrar indicador
  renderContent();
}

function updateNavButtons() {
  const btnPrev = document.getElementById('mapNavPrev');
  const btnNext = document.getElementById('mapNavNext');

  btnPrev.disabled = state.currentSchoolIndex === 0;
  btnNext.disabled = state.currentSchoolIndex === state.filteredColegios.length - 1;
}

function switchTab(tabName) {
  state.currentTab = tabName;

  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  const mapaSection = document.getElementById('mapaSection');
  const analisisContainer = document.getElementById('analisisContainer');
  const presentacionContainer = document.getElementById('presentacionContainer');
  const localidadContainer = document.getElementById('localidadContainer');
  const porQueContainer = document.getElementById('porQueContainer');

  mapaSection.style.display = 'none';
  analisisContainer.style.display = 'none';
  presentacionContainer.style.display = 'none';
  localidadContainer.style.display = 'none';
  porQueContainer.style.display = 'none';

  if (tabName === 'mapa') {
    mapaSection.style.display = 'flex';
  } else if (tabName === 'analisis-pliego') {
    analisisContainer.style.display = 'block';
    renderAnalysisPiego(state.filteredColegios);
  } else if (tabName === 'analisis-zona') {
    analisisContainer.style.display = 'block';
    renderAnalisisZona(state.filteredColegios);
  } else if (tabName === 'analisis-localidad') {
    localidadContainer.style.display = 'block';
    renderAnalisisLocalidad();
  } else if (tabName === 'presentacion') {
    presentacionContainer.style.display = 'block';
    renderPresentacion();
  } else if (tabName === 'por-que') {
    porQueContainer.style.display = 'block';
    renderPorQue();
  }
}

function renderAnalysisPiego(colegios) {
  const container = document.getElementById('analisisContainer');
  container.innerHTML = '';

  const porLocalidad = {};
  colegios.forEach(c => {
    const loc = c.localidad || 'Sin Localidad';
    if (!porLocalidad[loc]) porLocalidad[loc] = [];
    porLocalidad[loc].push(c);
  });

  Object.keys(porLocalidad).sort().forEach((localidad, groupIdx) => {
    const escuelas = porLocalidad[localidad];
    let totalMod = 0, totalCom = 0, totalDM = 0, totalPatios = 0, totalDMC = 0;
    escuelas.forEach(e => {
      const cupos = e.cupos || {};
      const dmc = cupos.dmc_comedor || 0;
      const com = cupos.comedor || 0;
      totalMod += (cupos.modulos || 0);
      totalCom += com;
      totalDM += (dmc - com);
      totalPatios += (cupos.patios || 0);
      totalDMC += dmc;
    });

    const tabla = document.createElement('div');
    tabla.className = 'analisis-tabla animate-in';
    tabla.style.animationDelay = `${groupIdx * 80}ms`;

    tabla.innerHTML = `
      <div class="analisis-header">
        <span class="analisis-header-title">
          <span class="zone-indicator" style="background:var(--blue);"></span>
          ${localidad}
        </span>
        <span class="analisis-header-badge">${escuelas.length} escuelas</span>
      </div>
      <div class="analisis-stats-row">
        <div class="analisis-stat-card analisis-stat-card--green">
          <div class="analisis-stat-label">Módulos MESA</div>
          <div class="analisis-stat-value analisis-stat-value--green">${totalMod.toLocaleString()}</div>
        </div>
        <div class="analisis-stat-card analisis-stat-card--orange">
          <div class="analisis-stat-label">Comedor/día</div>
          <div class="analisis-stat-value analisis-stat-value--orange">${totalCom.toLocaleString()}</div>
        </div>
        <div class="analisis-stat-card" style="--accent:var(--purple)">
          <div class="analisis-stat-label">DM sin Comedor/día</div>
          <div class="analisis-stat-value" style="color:var(--purple)">${totalDM.toLocaleString()}</div>
        </div>
        ${totalPatios > 0 ? `<div class="analisis-stat-card" style="--accent:var(--cyan)">
          <div class="analisis-stat-label">Patios Abiertos</div>
          <div class="analisis-stat-value" style="color:var(--cyan)">${totalPatios.toLocaleString()}</div>
        </div>` : ''}
        <div class="analisis-stat-card analisis-stat-card--blue">
          <div class="analisis-stat-label">Desayuno y Merienda</div>
          <div class="analisis-stat-value analisis-stat-value--blue">${totalDMC.toLocaleString()}</div>
        </div>
      </div>
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Establecimiento</th>
              <th>Módulos</th>
              <th>Comedor</th>
              <th>DM s/C</th>
              <th>Patios</th>
              <th>DyM</th>
            </tr>
          </thead>
          <tbody>
            ${escuelas.map((e, idx) => {
              const cupos = e.cupos || {};
              const dmc = cupos.dmc_comedor || 0;
              const com = cupos.comedor || 0;
              const dm = dmc - com;
              return `<tr>
                <td class="cell-idx">${idx + 1}</td>
                <td class="cell-name">${e.nombre}</td>
                <td class="cell-mod">${(cupos.modulos || 0).toLocaleString()}</td>
                <td class="cell-com">${com.toLocaleString()}</td>
                <td style="text-align:right; font-family:var(--font-mono); font-weight:500; color:var(--purple)">${dm.toLocaleString()}</td>
                <td style="text-align:right; font-family:var(--font-mono); font-weight:500; color:var(--cyan)">${(cupos.patios || 0) > 0 ? (cupos.patios || 0).toLocaleString() : '-'}</td>
                <td class="cell-dmc">${dmc.toLocaleString()}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td style="font-weight:700; color:var(--text-secondary);">TOTAL</td>
              <td class="cell-mod">${totalMod.toLocaleString()}</td>
              <td class="cell-com">${totalCom.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--purple)">${totalDM.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--cyan)">${totalPatios > 0 ? totalPatios.toLocaleString() : '-'}</td>
              <td class="cell-dmc">${totalDMC.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    container.appendChild(tabla);
  });
}

function renderAnalisisZona(colegios) {
  const container = document.getElementById('analisisContainer');
  container.innerHTML = '';

  const porZona = {};
  colegios.forEach(c => {
    const zona = c.zona_pliego || 'Sin Zona';
    if (!porZona[zona]) porZona[zona] = [];
    porZona[zona].push(c);
  });

  Object.keys(porZona).sort().forEach((zona, groupIdx) => {
    const escuelas = porZona[zona];
    const zColor = getZoneColor(zona);
    let totalMod = 0, totalCom = 0, totalDM = 0, totalPatios = 0, totalDMC = 0;
    escuelas.forEach(e => {
      const cupos = e.cupos || {};
      const dmc = cupos.dmc_comedor || 0;
      const com = cupos.comedor || 0;
      totalMod += (cupos.modulos || 0);
      totalCom += com;
      totalDM += (dmc - com);
      totalPatios += (cupos.patios || 0);
      totalDMC += dmc;
    });

    const tabla = document.createElement('div');
    tabla.className = 'analisis-tabla animate-in';
    tabla.style.animationDelay = `${groupIdx * 80}ms`;

    tabla.innerHTML = `
      <div class="analisis-header">
        <span class="analisis-header-title">
          <span class="zone-indicator" style="background:${zColor};"></span>
          ${zona}
        </span>
        <span class="analisis-header-badge">${escuelas.length} escuelas</span>
      </div>
      <div class="analisis-stats-row">
        <div class="analisis-stat-card analisis-stat-card--green">
          <div class="analisis-stat-label">Módulos MESA</div>
          <div class="analisis-stat-value analisis-stat-value--green">${totalMod.toLocaleString()}</div>
        </div>
        <div class="analisis-stat-card analisis-stat-card--orange">
          <div class="analisis-stat-label">Comedor/día</div>
          <div class="analisis-stat-value analisis-stat-value--orange">${totalCom.toLocaleString()}</div>
        </div>
        <div class="analisis-stat-card" style="--accent:var(--purple)">
          <div class="analisis-stat-label">DM sin Comedor/día</div>
          <div class="analisis-stat-value" style="color:var(--purple)">${totalDM.toLocaleString()}</div>
        </div>
        ${totalPatios > 0 ? `<div class="analisis-stat-card" style="--accent:var(--cyan)">
          <div class="analisis-stat-label">Patios Abiertos</div>
          <div class="analisis-stat-value" style="color:var(--cyan)">${totalPatios.toLocaleString()}</div>
        </div>` : ''}
        <div class="analisis-stat-card analisis-stat-card--blue">
          <div class="analisis-stat-label">Desayuno y Merienda</div>
          <div class="analisis-stat-value analisis-stat-value--blue">${totalDMC.toLocaleString()}</div>
        </div>
      </div>
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Establecimiento</th>
              <th>Módulos</th>
              <th>Comedor</th>
              <th>DM s/C</th>
              <th>Patios</th>
              <th>DyM</th>
            </tr>
          </thead>
          <tbody>
            ${escuelas.map((e, idx) => {
              const cupos = e.cupos || {};
              const dmc = cupos.dmc_comedor || 0;
              const com = cupos.comedor || 0;
              const dm = dmc - com;
              return `<tr>
                <td class="cell-idx">${idx + 1}</td>
                <td class="cell-name">${e.nombre}</td>
                <td class="cell-mod">${(cupos.modulos || 0).toLocaleString()}</td>
                <td class="cell-com">${com.toLocaleString()}</td>
                <td style="text-align:right; font-family:var(--font-mono); font-weight:500; color:var(--purple)">${dm.toLocaleString()}</td>
                <td style="text-align:right; font-family:var(--font-mono); font-weight:500; color:var(--cyan)">${(cupos.patios || 0) > 0 ? (cupos.patios || 0).toLocaleString() : '-'}</td>
                <td class="cell-dmc">${dmc.toLocaleString()}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td style="font-weight:700; color:var(--text-secondary);">TOTAL</td>
              <td class="cell-mod">${totalMod.toLocaleString()}</td>
              <td class="cell-com">${totalCom.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--purple)">${totalDM.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--cyan)">${totalPatios > 0 ? totalPatios.toLocaleString() : '-'}</td>
              <td class="cell-dmc">${totalDMC.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    container.appendChild(tabla);
  });
}

function renderAnalisisLocalidad() {
  const container = document.getElementById('localidadContainer');
  container.innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const colegios = state.data.colegios;
  const depot = state.data.depot;

  // ═══ PRECIOS DEL PLIEGO - Licitación Pública 2025/336 ═══
  // Nota: NO-2025-05251379-GDEBA-DSAEMDCGP (14 feb 2025)
  const PRECIO_DM = 478;           // $/cupo/día — Desayuno y Merienda
  const PRECIO_COMEDOR = 988;      // $/cupo/día — Comedor
  const PRECIO_PATIOS = 478;       // $/cupo/sábado — Patios Abiertos / Coros y Orquestas
  const PRECIO_MODULO = 15065;     // $/módulo/mes — MESA Bonaerense
  const PRECIO_DM_LC = 955;        // $/cupo/día — DM Listo Consumo
  const PRECIO_COM_LC = 1671;      // $/cupo/día — Comedor Listo Consumo
  const PRECIO_DM_PAT = 690;       // $/cupo/día — DM Patologías Específicas
  const PRECIO_COM_PAT = 1127;     // $/cupo/día — Comedor Patologías Específicas

  // ═══ PARÁMETROS TEMPORALES DEL PLIEGO ═══
  const DIAS_HABILES = 172;        // Días hábiles del contrato
  const SABADOS = 39;              // Sábados Patios Abiertos
  const MESES = 9;                 // Junio 2025 a Febrero 2026

  // ═══ CUPOS GLOBALES OFICIALES (Art. 1 del pliego) ═══
  const CUPOS_DM_GLOBAL = 90962;       // Desayuno y Merienda/día
  const CUPOS_COM_GLOBAL = 64919;      // Comedor/día
  const CUPOS_MESA_GLOBAL = 82531;     // Módulos MESA
  const CUPOS_PATIOS_GLOBAL = 944;     // Patios Abiertos/sábado
  const CUPOS_DM_LC = 2552;            // DM Listo Consumo/día
  const CUPOS_COM_LC = 3105;           // Comedor Listo Consumo/día
  const CUPOS_DM_PAT = 117;            // DM Patologías/día
  const CUPOS_COM_PAT = 95;            // Comedor Patologías/día

  // ═══ PRESUPUESTO OFICIAL DESGLOSADO (Art. 1) ═══
  const PO_DM_COMEDOR = 18_457_093_992;   // DM + Comedor servicio normal
  const PO_MESA = 11_163_255_390;          // MESA Bonaerense
  const PO_PATIOS = 17_598_048;            // Patios Abiertos
  const PO_PATOLOGIAS = 32_256_787;        // Patologías Específicas
  const PO_LISTO_CONSUMO = 1_293_498_824;  // Listo Consumo
  const PO_TOTAL = 30_963_703_041;         // PRESUPUESTO OFICIAL TOTAL

  // ═══ PARÁMETROS LOGÍSTICOS ═══
  const MAX_PARADAS = 15, MIN_POR_PARADA = 20;

  // ═══ COSTOS REALES - Sprinter 515 2014 (Auditoría Panel Expertos) ═══
  const COSTO_COMBUSTIBLE_KM = 69;      // $400/litro ÷ 5.8 km/litro
  const COSTO_AMORTIZACION_KM = 23;     // $3.5M ÷ 6 años ÷ 25.000 km/año
  const COSTO_MANTENIMIENTO_KM = 72;    // $150k/mes × 12 ÷ 25.000 km/año
  const COSTO_SEGUROS_KM = 38;          // $80k/mes × 12 ÷ 25.000 km/año
  const COSTO_OPERATIVO_KM = COSTO_COMBUSTIBLE_KM + COSTO_AMORTIZACION_KM + COSTO_MANTENIMIENTO_KM + COSTO_SEGUROS_KM; // $202/km

  // ═══ SALARIOS POR EQUIPO - Chofer + 2 Auxiliares (cada camioneta = su propio equipo) ═══
  const SALARIO_CHOFER_MES = 1_800_000;
  const SALARIO_AUXILIAR_MES = 900_000;
  const SALARIO_BRUTO_EQUIPO_MES = SALARIO_CHOFER_MES + (SALARIO_AUXILIAR_MES * 2); // $3.6M/mes
  const CARGAS_SOCIALES = 1.57;          // Cargas sociales (aportes patronales, SAC, vacaciones)
  const SALARIO_REAL_EQUIPO_MES = SALARIO_BRUTO_EQUIPO_MES * CARGAS_SOCIALES; // $5.652.000/mes
  const SALARIO_REAL_EQUIPO_DIA = SALARIO_REAL_EQUIPO_MES / 22; // $256.909/día por equipo

  // ═══ FACTOR CORRECCIÓN DISTANCIA - Haversine → ruta real ═══
  const FACTOR_RUTA = 1.4;

  // ═══ COSTOS FIJOS DE ESTRUCTURA (nutricionista, admin, contabilidad, sistemas) ═══
  const COSTOS_ESTRUCTURA_MES = 10_000_000; // $10M/mes
  const COSTOS_ESTRUCTURA_DIA = COSTOS_ESTRUCTURA_MES / 22; // $454.545/día

  // RETENCIÓN IMPOSITIVA sobre facturación bruta (IIBB + Ganancias neto estimado)
  const RETENCION_IMPOSITIVA = 0.052; // 5.2%

  // Distancia ruta real (OSRM cacheada, fallback haversine*1.4)
  const haversineKm = (lat1,lng1,lat2,lng2) => getRouteKm(lat1,lng1,lat2,lng2);

  // Agrupar por localidad
  const locRaw = {};
  colegios.forEach(c => {
    const loc = c.localidad || 'Sin Localidad';
    if (!locRaw[loc]) locRaw[loc] = { escuelas: [], mod:0, com:0, dm:0, pat:0, dmc:0, dists:[] };
    const cu = c.cupos || {}, dmc = cu.dmc_comedor||0, com = cu.comedor||0;
    locRaw[loc].escuelas.push(c);
    locRaw[loc].mod += cu.modulos||0;
    locRaw[loc].com += com;
    locRaw[loc].dm += (dmc - com);
    locRaw[loc].pat += cu.patios||0;
    locRaw[loc].dmc += dmc;
    locRaw[loc].dists.push(haversineKm(depot.lat, depot.lng, parseFloat(c.lat), parseFloat(c.lng)));
  });

  // Total camionetas para distribuir costos de estructura
  const totalCamionetas_sys = Object.keys(locRaw).reduce((s, loc) => s + Math.ceil(locRaw[loc].escuelas.length / MAX_PARADAS), 0);

  // Calcular métricas con modelo corregido
  const locList_temp = Object.keys(locRaw).map(loc => {
    const d = locRaw[loc], n = d.escuelas.length;
    const distProm = d.dists.reduce((s,v)=>s+v,0)/n;
    const cam = Math.ceil(n / MAX_PARADAS);
    return { loc, distProm, cam, kmDia: distProm * 2 * cam };
  });

  const locList = locList_temp.map(l => {
    const d = locRaw[l.loc], n = d.escuelas.length;
    const distProm = l.distProm;
    const distMax = Math.max(...d.dists), distMin = Math.min(...d.dists);
    const factDiariaDM = d.dm * PRECIO_DM;
    const factDiariaComedor = d.com * PRECIO_COMEDOR;
    const factDiaria = factDiariaDM + factDiariaComedor;
    const factModMes = d.mod * PRECIO_MODULO;
    const factPatSab = d.pat * PRECIO_PATIOS;
    const factTotal = (factDiaria * DIAS_HABILES) + (factModMes * MESES) + (factPatSab * SABADOS);
    const cam = l.cam;
    const parPorCam = Math.ceil(n / cam);
    const tiempoMin = parPorCam * MIN_POR_PARADA;
    const tiempoHs = (tiempoMin / 60).toFixed(1);
    const kmDia = l.kmDia;
    // Costo operativo vehicular por km
    const costoOperativoDia = kmDia * COSTO_OPERATIVO_KM;
    // Costo salarios: CADA camioneta tiene su propio equipo (chofer + 2 aux) con cargas sociales
    const costoSalariosDia = cam * SALARIO_REAL_EQUIPO_DIA;
    // Costos estructura proporcional por camionetas
    const costoEstructuraDia = (cam / totalCamionetas_sys) * COSTOS_ESTRUCTURA_DIA;
    // Retención impositiva sobre facturación diaria
    const retencionDia = factDiaria * RETENCION_IMPOSITIVA;
    // Costo total diario logístico
    const costoDia = costoOperativoDia + costoSalariosDia + costoEstructuraDia;
    const costoContrato = costoDia * DIAS_HABILES;
    // Margen = facturación - costos - retenciones
    const margenDia = factDiaria - costoDia - retencionDia;
    const rentPct = factDiaria > 0 ? (margenDia / factDiaria) * 100 : 0;
    const dmcPorCam = Math.round(d.dmc / cam);
    const costoKmPromedio = kmDia > 0 ? costoDia / kmDia : 0;
    return { loc: l.loc, n, mod:d.mod, com:d.com, dm:d.dm, pat:d.pat, dmc:d.dmc, escuelas:d.escuelas,
      distProm, distMax, distMin, factDiariaDM, factDiariaComedor, factDiaria, factModMes, factPatSab,
      factTotal, cam, parPorCam, tiempoMin, tiempoHs, kmDia, costoOperativoDia, costoSalariosDia,
      costoEstructuraDia, retencionDia, costoDia, costoContrato, margenDia, rentPct, dmcPorCam, costoKmPromedio };
  });

  // Score compuesto
  const maxFact = Math.max(...locList.map(l=>l.factTotal));
  const maxDist = Math.max(...locList.map(l=>l.distProm));
  const maxEfi = Math.max(...locList.map(l=>l.dmcPorCam));

  const scored = locList.map(l => {
    const sF = (l.factTotal / maxFact) * 40;
    const sD = ((maxDist - l.distProm) / maxDist) * 30;
    const sE = (l.dmcPorCam / maxEfi) * 30;
    return { ...l, score: sF+sD+sE, sF, sD, sE };
  }).sort((a,b) => b.score - a.score);

  const totalFactContrato = scored.reduce((s,l) => s + l.factTotal, 0);
  const fMoney = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  const fPct = (n) => n.toFixed(1) + '%';

  // Colores para el ranking
  const rankColors = ['#10b981','#6366f1','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#f97316','#64748b','#a855f7','#84cc16'];

  let html = '';

  // Card por cada localidad, ordenada por score
  scored.forEach((l, idx) => {
    const color = rankColors[idx % rankColors.length];
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`;
    const pctTotal = ((l.factTotal / totalFactContrato) * 100).toFixed(1);

    // Top 5 escuelas por DMC
    const topEscuelas = [...l.escuelas].sort((a,b) => (b.cupos.dmc_comedor||0) - (a.cupos.dmc_comedor||0)).slice(0,5);

    // Factores que explican el ranking
    const fortalezas = [];
    const debilidades = [];

    // Facturación
    const factRank = [...scored].sort((a,b) => b.factTotal - a.factTotal).findIndex(x => x.loc === l.loc) + 1;
    if (factRank <= 3) fortalezas.push(`${factRank}° en facturación total (${fMoney(l.factTotal)})`);
    else if (factRank >= scored.length - 2) debilidades.push(`${factRank}° en facturación (bajo volumen de cupos)`);

    // Eficiencia
    const efiRank = [...scored].sort((a,b) => b.dmcPorCam - a.dmcPorCam).findIndex(x => x.loc === l.loc) + 1;
    if (efiRank <= 3) fortalezas.push(`${efiRank}° en eficiencia: ${l.dmcPorCam.toLocaleString()} DyM/camioneta con solo ${l.cam} cam.`);
    else if (efiRank >= scored.length - 2) debilidades.push(`${efiRank}° en eficiencia (${l.dmcPorCam.toLocaleString()} DyM/cam — requiere ${l.cam} camionetas para ${l.n} escuelas)`);

    // Cercanía
    const distRank = [...scored].sort((a,b) => a.distProm - b.distProm).findIndex(x => x.loc === l.loc) + 1;
    if (distRank <= 3) fortalezas.push(`${distRank}° más cercana al depósito (${l.distProm.toFixed(1)} km prom.)`);
    else if (distRank >= scored.length - 2) debilidades.push(`${distRank}° en cercanía (${l.distProm.toFixed(1)} km prom. — mayor costo logístico)`);

    // Cupos
    const cupoRank = [...scored].sort((a,b) => b.dmc - a.dmc).findIndex(x => x.loc === l.loc) + 1;
    if (cupoRank <= 3) fortalezas.push(`${cupoRank}° en volumen de cupos: ${l.dmc.toLocaleString()} DyM/día`);

    // Rentabilidad
    if (l.rentPct >= 50) fortalezas.push(`Margen logístico alto: ${fPct(l.rentPct)}`);
    else if (l.rentPct < 30) debilidades.push(`Margen logístico ajustado: ${fPct(l.rentPct)}`);

    html += `
    <div class="pres-slide animate-in" style="animation-delay:${idx * 80}ms">
      <div class="analisis-header" style="padding:16px 20px;">
        <span class="analisis-header-title" style="font-size:1.2rem;">
          <span style="font-size:1.4rem; margin-right:6px;">${medal}</span>
          <span class="zone-indicator" style="background:${color};"></span>
          ${l.loc}
          <span style="font-size:0.85rem; color:var(--text-muted); margin-left:10px; font-weight:400;">Score: <strong style="color:${color}">${l.score.toFixed(1)}</strong>/100</span>
        </span>
        <span class="analisis-header-badge" style="font-size:0.9rem;">${l.n} escuelas · ${pctTotal}% facturación</span>
      </div>

      <div class="pres-slide-body" style="padding:16px 20px;">

        <!-- Score breakdown bar -->
        <div style="display:flex; gap:4px; height:28px; border-radius:8px; overflow:hidden; margin-bottom:16px; background:var(--bg-elevated);">
          <div style="width:${(l.sF/100*100).toFixed(1)}%; background:var(--green); display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:700; color:#fff; min-width:30px;" title="Facturación ${l.sF.toFixed(1)}/40">💰 ${l.sF.toFixed(1)}</div>
          <div style="width:${(l.sD/100*100).toFixed(1)}%; background:var(--orange); display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:700; color:#fff; min-width:30px;" title="Cercanía ${l.sD.toFixed(1)}/30">📍 ${l.sD.toFixed(1)}</div>
          <div style="width:${(l.sE/100*100).toFixed(1)}%; background:var(--cyan); display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:700; color:#fff; min-width:30px;" title="Eficiencia ${l.sE.toFixed(1)}/30">⚡ ${l.sE.toFixed(1)}</div>
        </div>

        <!-- UdN Grid -->
        <div class="analisis-stats-row" style="margin-bottom:14px;">
          <div class="analisis-stat-card analisis-stat-card--green">
            <div class="analisis-stat-label">📦 Módulos MESA</div>
            <div class="analisis-stat-value analisis-stat-value--green">${l.mod.toLocaleString()}</div>
          </div>
          <div class="analisis-stat-card analisis-stat-card--orange">
            <div class="analisis-stat-label">🍽️ Comedor/día</div>
            <div class="analisis-stat-value analisis-stat-value--orange">${l.com.toLocaleString()}</div>
          </div>
          <div class="analisis-stat-card" style="--accent:var(--purple)">
            <div class="analisis-stat-label">☕ DM sin Comedor/día</div>
            <div class="analisis-stat-value" style="color:var(--purple)">${l.dm.toLocaleString()}</div>
          </div>
          ${l.pat > 0 ? `<div class="analisis-stat-card" style="--accent:var(--cyan)">
            <div class="analisis-stat-label">⚽ Patios/sáb</div>
            <div class="analisis-stat-value" style="color:var(--cyan)">${l.pat.toLocaleString()}</div>
          </div>` : ''}
          <div class="analisis-stat-card analisis-stat-card--blue">
            <div class="analisis-stat-label">Desayuno y Merienda</div>
            <div class="analisis-stat-value analisis-stat-value--blue">${l.dmc.toLocaleString()}</div>
          </div>
        </div>

        <!-- Dos columnas: Facturación + Logística -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px;">
          <!-- Facturación -->
          <div style="background:var(--bg-elevated); border-radius:var(--radius-md); padding:14px; border:1px solid var(--glass-border);">
            <div style="font-weight:700; font-size:0.75rem; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:10px;">💰 FACTURACIÓN</div>
            <div style="display:flex; flex-direction:column; gap:6px; font-family:var(--font-mono); font-size:0.85rem;">
              <div style="display:flex; justify-content:space-between;"><span style="color:var(--orange)">Comedor/día</span><span>${fMoney(l.factDiariaComedor)}</span></div>
              <div style="display:flex; justify-content:space-between;"><span style="color:var(--purple)">DM s/Comedor</span><span>${fMoney(l.factDiariaDM)}</span></div>
              <div style="display:flex; justify-content:space-between;"><span style="color:var(--green)">Módulos/mes</span><span>${fMoney(l.factModMes)}</span></div>
              ${l.factPatSab > 0 ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--cyan)">Patios/sáb</span><span>${fMoney(l.factPatSab)}</span></div>` : ''}
              <div style="display:flex; justify-content:space-between; border-top:1px solid var(--glass-border); padding-top:6px; font-weight:700;"><span style="color:var(--blue)">Total Contrato</span><span style="color:var(--blue)">${fMoney(l.factTotal)}</span></div>
            </div>
          </div>
          <!-- Logística -->
          <div style="background:var(--bg-elevated); border-radius:var(--radius-md); padding:14px; border:1px solid var(--glass-border);">
            <div style="font-weight:700; font-size:0.75rem; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:10px;">🚛 LOGÍSTICA</div>
            <div style="display:flex; flex-direction:column; gap:6px; font-family:var(--font-mono); font-size:0.85rem;">
              <div style="display:flex; justify-content:space-between;"><span>Camionetas</span><span style="color:var(--blue); font-weight:700;">${l.cam}</span></div>
              <div style="display:flex; justify-content:space-between;"><span>Paradas/cam.</span><span>${l.parPorCam}</span></div>
              <div style="display:flex; justify-content:space-between;"><span>Tiempo ruta</span><span style="color:var(--orange)">${l.tiempoHs}hs (${l.tiempoMin}min)</span></div>
              <div style="display:flex; justify-content:space-between;"><span>Dist. promedio</span><span>${l.distProm.toFixed(1)} km</span></div>
              <div style="display:flex; justify-content:space-between;"><span>Km/día est.</span><span>${l.kmDia.toFixed(0)} km</span></div>
              <!-- Desglose de costos CORREGIDO (Panel Expertos) -->
              <div style="border-top:1px solid var(--glass-border); padding-top:6px; margin-top:6px;">
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;"><span>Operativo (${COSTO_OPERATIVO_KM}$/km)</span><span style="color:var(--orange)">${fMoney(l.costoOperativoDia)}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;"><span>Salarios ×${l.cam} equipos (c/CS)</span><span style="color:var(--purple)">${fMoney(l.costoSalariosDia)}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;"><span>Estructura proporcional</span><span style="color:var(--cyan)">${fMoney(l.costoEstructuraDia)}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;"><span>Ret. impositiva (5.2%)</span><span style="color:var(--red)">-${fMoney(l.retencionDia)}</span></div>
                <div style="display:flex; justify-content:space-between; border-top:1px solid var(--glass-border); padding-top:4px; font-weight:700;"><span>Costo Total/día</span><span style="color:var(--red)">${fMoney(l.costoDia)}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted);"><span>Costo promedio/km</span><span>${Math.round(l.costoKmPromedio)}$/km</span></div>
              </div>
              <div style="display:flex; justify-content:space-between; font-weight:700; border-top:1px solid var(--glass-border); padding-top:6px; margin-top:6px;"><span>Margen logístico</span><span style="color:${l.rentPct >= 50 ? 'var(--green)' : l.rentPct >= 30 ? 'var(--orange)' : 'var(--red)'}">${fPct(l.rentPct)}</span></div>
            </div>
          </div>
        </div>

        <!-- Fortalezas / Debilidades -->
        ${(fortalezas.length > 0 || debilidades.length > 0) ? `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px;">
          ${fortalezas.length > 0 ? `<div style="background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.2); border-radius:var(--radius-md); padding:12px;">
            <div style="font-weight:700; font-size:0.75rem; color:var(--green); margin-bottom:8px;">✅ FORTALEZAS</div>
            ${fortalezas.map(f => `<div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px;">• ${f}</div>`).join('')}
          </div>` : ''}
          ${debilidades.length > 0 ? `<div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2); border-radius:var(--radius-md); padding:12px;">
            <div style="font-weight:700; font-size:0.75rem; color:var(--red); margin-bottom:8px;">⚠️ PUNTOS DÉBILES</div>
            ${debilidades.map(d => `<div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px;">• ${d}</div>`).join('')}
          </div>` : ''}
        </div>` : ''}

        <!-- Top 5 escuelas -->
        <div class="analisis-table-wrapper">
          <div style="font-weight:700; font-size:0.75rem; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:8px;">🏫 TOP 5 ESCUELAS POR CUPOS</div>
          <table class="analisis-data-table">
            <thead><tr><th>#</th><th>Establecimiento</th><th>Módulos</th><th>Comedor</th><th>DM s/C</th><th>Patios</th><th>DyM</th></tr></thead>
            <tbody>
              ${topEscuelas.map((e,i) => {
                const cu = e.cupos||{}, dmc=cu.dmc_comedor||0, com=cu.comedor||0, dm=dmc-com;
                return `<tr>
                  <td class="cell-idx">${i+1}</td>
                  <td class="cell-name">${e.nombre}</td>
                  <td class="cell-mod">${(cu.modulos||0).toLocaleString()}</td>
                  <td class="cell-com">${com.toLocaleString()}</td>
                  <td style="text-align:right; font-family:var(--font-mono); color:var(--purple)">${dm.toLocaleString()}</td>
                  <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan)">${(cu.patios||0) > 0 ? cu.patios.toLocaleString() : '-'}</td>
                  <td class="cell-dmc">${dmc.toLocaleString()}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

      </div>
    </div>`;
  });

  // ============================================================
  // ANÁLISIS POR ZONAS DEL PLIEGO (12 zonas municipales)
  // ============================================================
  const zonaRaw = {};
  colegios.forEach(c => {
    const z = c.zona_pliego || 'Sin Zona';
    if (!zonaRaw[z]) zonaRaw[z] = { escuelas:[], mod:0, com:0, dm:0, pat:0, dmc:0, dists:[], localidades:new Set() };
    const cu = c.cupos||{}, dmc=cu.dmc_comedor||0, com=cu.comedor||0;
    zonaRaw[z].escuelas.push(c);
    zonaRaw[z].mod += cu.modulos||0;
    zonaRaw[z].com += com;
    zonaRaw[z].dm += (dmc - com);
    zonaRaw[z].pat += cu.patios||0;
    zonaRaw[z].dmc += dmc;
    zonaRaw[z].dists.push(haversineKm(depot.lat, depot.lng, parseFloat(c.lat), parseFloat(c.lng)));
    zonaRaw[z].localidades.add(c.localidad || 'Sin Localidad');
  });

  const totalCamZonas = Object.keys(zonaRaw).reduce((s,z) => s + Math.ceil(zonaRaw[z].escuelas.length / MAX_PARADAS), 0);

  const zonaList = Object.keys(zonaRaw).sort().map(z => {
    const d = zonaRaw[z], n = d.escuelas.length;
    const distProm = d.dists.reduce((s,v)=>s+v,0)/n;
    const distMax = Math.max(...d.dists), distMin = Math.min(...d.dists);
    const dispersion = distMax - distMin;
    const cam = Math.ceil(n / MAX_PARADAS);
    const kmDia = distProm * 2 * cam;
    const factDiaria = (d.dm * PRECIO_DM) + (d.com * PRECIO_COMEDOR);
    const factTotal = (factDiaria * DIAS_HABILES) + (d.mod * PRECIO_MODULO * MESES) + (d.pat * PRECIO_PATIOS * SABADOS);
    const costoOpDia = kmDia * COSTO_OPERATIVO_KM;
    const costoSalDia = cam * SALARIO_REAL_EQUIPO_DIA;
    const costoEstrDia = (cam / totalCamZonas) * COSTOS_ESTRUCTURA_DIA;
    const retencionDia = factDiaria * RETENCION_IMPOSITIVA;
    const costoDia = costoOpDia + costoSalDia + costoEstrDia;
    const margenDia = factDiaria - costoDia - retencionDia;
    const rentPct = factDiaria > 0 ? (margenDia / factDiaria) * 100 : 0;
    return { zona:z, n, mod:d.mod, com:d.com, dm:d.dm, pat:d.pat, dmc:d.dmc, localidades:d.localidades.size,
      locsNames:[...d.localidades].sort(), distProm, distMax, distMin, dispersion, cam, kmDia,
      factDiaria, factTotal, costoOpDia, costoSalDia, costoEstrDia, retencionDia, costoDia, margenDia, rentPct };
  });

  // Score zonas del pliego
  const maxFactZ = Math.max(...zonaList.map(z=>z.factTotal));
  const maxDistZ = Math.max(...zonaList.map(z=>z.distProm));
  const maxEfiZ = Math.max(...zonaList.map(z=>Math.round(z.dmc/z.cam)));
  const scoredZonas = zonaList.map(z => {
    const dmcCam = Math.round(z.dmc / z.cam);
    const sF = (z.factTotal / maxFactZ) * 40;
    const sD = ((maxDistZ - z.distProm) / maxDistZ) * 30;
    const sE = (dmcCam / maxEfiZ) * 30;
    return { ...z, dmcCam, score:sF+sD+sE, sF, sD, sE };
  }).sort((a,b) => b.score - a.score);

  // ============================================
  // COMPARACIÓN: Localidades vs Zonas del Pliego
  // ============================================
  const totalKmLoc = scored.reduce((s,l) => s + l.kmDia, 0);
  const totalKmZonas = scoredZonas.reduce((s,z) => s + z.kmDia, 0);
  const totalCostoLoc = scored.reduce((s,l) => s + l.costoDia, 0);
  const totalCostoZonas = scoredZonas.reduce((s,z) => s + z.costoDia, 0);
  const totalCamLoc = scored.reduce((s,l) => s + l.cam, 0);
  const totalCamZonasCalc = scoredZonas.reduce((s,z) => s + z.cam, 0);
  const dispPromLoc = scored.reduce((s,l) => s + (l.distMax - l.distMin), 0) / scored.length;
  const dispPromZonas = scoredZonas.reduce((s,z) => s + z.dispersion, 0) / scoredZonas.length;
  const ahorroPct = totalCostoZonas > 0 ? ((totalCostoZonas - totalCostoLoc) / totalCostoZonas * 100) : 0;

  // ============================================================
  // HTML: Sección Conclusión Rezonificación
  // ============================================================
  html += `
  <div class="pres-slide animate-in" style="animation-delay:${scored.length * 80 + 100}ms; border: 2px solid var(--green);">
    <div class="pres-slide-header" style="background:linear-gradient(135deg, rgba(16,185,129,0.15), rgba(99,102,241,0.1));">
      <h2 class="pres-slide-title">📊 Conclusión: ¿Por qué Rezonificar por Localidad?</h2>
      <span class="pres-slide-badge" style="background:var(--green);">PROPUESTA R14</span>
    </div>
    <div class="pres-slide-body" style="padding:20px;">
      <p class="pres-intro" style="margin-bottom:18px;">Las zonas del pliego mezclan hasta <strong>${Math.max(...scoredZonas.map(z=>z.localidades))} localidades</strong> por zona. La re-zonificación por localidad agrupa escuelas geográficamente contiguas, reduciendo dispersión y optimizando rutas.</p>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
        <div style="background:var(--bg-elevated); border-radius:var(--radius-md); padding:16px; border:2px solid var(--green);">
          <div style="font-weight:700; color:var(--green); margin-bottom:12px; font-size:0.9rem;">🏘️ REZONIFICACIÓN POR LOCALIDAD</div>
          <div style="display:flex; flex-direction:column; gap:8px; font-family:var(--font-mono); font-size:0.9rem;">
            <div style="display:flex; justify-content:space-between;"><span>Km/día totales</span><span style="font-weight:700;">${totalKmLoc.toFixed(0)} km</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Costo logístico/día</span><span style="font-weight:700;">${fMoney(totalCostoLoc)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Camionetas</span><span style="font-weight:700;">${totalCamLoc}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Dispersión prom.</span><span style="font-weight:700;">${dispPromLoc.toFixed(1)} km</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Grupos</span><span style="font-weight:700;">12 localidades</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Locs. por grupo</span><span style="font-weight:700; color:var(--green);">1 (homogéneo)</span></div>
          </div>
        </div>
        <div style="background:var(--bg-elevated); border-radius:var(--radius-md); padding:16px; border:2px solid var(--orange);">
          <div style="font-weight:700; color:var(--orange); margin-bottom:12px; font-size:0.9rem;">🏛️ ZONAS DEL PLIEGO MUNICIPAL</div>
          <div style="display:flex; flex-direction:column; gap:8px; font-family:var(--font-mono); font-size:0.9rem;">
            <div style="display:flex; justify-content:space-between;"><span>Km/día totales</span><span style="font-weight:700;">${totalKmZonas.toFixed(0)} km</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Costo logístico/día</span><span style="font-weight:700;">${fMoney(totalCostoZonas)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Camionetas</span><span style="font-weight:700;">${totalCamZonasCalc}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Dispersión prom.</span><span style="font-weight:700;">${dispPromZonas.toFixed(1)} km</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Grupos</span><span style="font-weight:700;">12 zonas</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Locs. por grupo</span><span style="font-weight:700; color:var(--orange);">Hasta ${Math.max(...scoredZonas.map(z=>z.localidades))} (mezcladas)</span></div>
          </div>
        </div>
      </div>

      ${ahorroPct > 0 ? `
      <div style="background:rgba(16,185,129,0.1); border:1px solid var(--green); border-radius:var(--radius-md); padding:14px; margin-bottom:16px; text-align:center;">
        <div style="font-size:1.4rem; font-weight:800; color:var(--green);">Ahorro estimado: ${ahorroPct.toFixed(1)}% en costos logísticos</div>
        <div style="font-size:0.85rem; color:var(--text-muted);">Diferencia diaria: ${fMoney(totalCostoZonas - totalCostoLoc)} — Ahorro contrato (172 días): ${fMoney((totalCostoZonas - totalCostoLoc) * DIAS_HABILES)}</div>
      </div>` : ''}

      <div style="background:var(--bg-elevated); border-radius:var(--radius-md); padding:14px; border:1px solid var(--glass-border);">
        <div style="font-weight:700; font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">⚖️ ¿POR QUÉ ES MEJOR REZONIFICAR?</div>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:0.85rem; color:var(--text-secondary);">
          <div>✅ <strong>Menor dispersión:</strong> Cada grupo tiene escuelas geográficamente contiguas. Las zonas del pliego mezclan localidades lejanas entre sí.</div>
          <div>✅ <strong>Rutas más eficientes:</strong> Menos km muertos entre escuelas = menor consumo de combustible y menor desgaste vehicular.</div>
          <div>✅ <strong>Mejor gestión de flota:</strong> Cada camioneta cubre un área compacta. Se facilita el control, seguimiento y reemplazo ante imprevistos.</div>
          <div>✅ <strong>Optimización de tiempos:</strong> Rutas compactas reducen el tiempo total, permitiendo cubrir más escuelas con la misma dotación.</div>
          <div>⚠️ <strong>Importante:</strong> La re-zonificación es una herramienta de <strong>gestión interna</strong>. En la oferta al Municipio se debe respetar las 12 zonas del pliego tal cual están definidas.</div>
        </div>
      </div>

      <div style="margin-top:14px; padding:12px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:var(--radius-md);">
        <div style="font-weight:700; font-size:0.8rem; color:var(--blue); margin-bottom:8px;">📋 NOTA METODOLÓGICA — Pliego Licitación Pública 2025/336</div>
        <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.5;">
          <strong>Precios del pliego:</strong> DM $${PRECIO_DM} · Comedor $${PRECIO_COMEDOR} · Módulo MESA $${PRECIO_MODULO.toLocaleString()}/mes · Patios $${PRECIO_PATIOS}/sáb · DM Listo Consumo $${PRECIO_DM_LC} · Com. Listo Consumo $${PRECIO_COM_LC} · DM Patologías $${PRECIO_DM_PAT} · Com. Patologías $${PRECIO_COM_PAT}.<br>
          <strong>Cupos globales Art.1:</strong> DM ${CUPOS_DM_GLOBAL.toLocaleString()} · Comedor ${CUPOS_COM_GLOBAL.toLocaleString()} · MESA ${CUPOS_MESA_GLOBAL.toLocaleString()} · Patios ${CUPOS_PATIOS_GLOBAL.toLocaleString()} · LC DM ${CUPOS_DM_LC.toLocaleString()} · LC Com ${CUPOS_COM_LC.toLocaleString()} · Pat. DM ${CUPOS_DM_PAT} · Pat. Com ${CUPOS_COM_PAT}.<br>
          <strong>Presupuesto oficial:</strong> ${fMoney(PO_TOTAL)} (DM+Com $${(PO_DM_COMEDOR/1e9).toFixed(1)}B · MESA $${(PO_MESA/1e9).toFixed(1)}B · LC $${(PO_LISTO_CONSUMO/1e6).toFixed(0)}M · Patologías $${(PO_PATOLOGIAS/1e6).toFixed(0)}M · Patios $${(PO_PATIOS/1e6).toFixed(0)}M).<br>
          <strong>Modelo logístico:</strong> Salarios $3.6M/mes × 1.57 CS = $5.65M/equipo · Distancia Haversine × 1.4 · Estructura $10M/mes · Ret. 5.2%.<br>
          <strong>⚠️ Este análisis cubre SOLO costos logísticos de transporte (3-5% del total). No incluye mercadería (55-65%) ni elaboración (10-15%).</strong>
        </div>
      </div>
    </div>
  </div>`;

  // ============================================================
  // HTML: Ranking Zonas del Pliego
  // ============================================================
  html += `
  <div class="pres-slide animate-in" style="animation-delay:${scored.length * 80 + 200}ms; border: 2px solid var(--orange);">
    <div class="pres-slide-header" style="background:linear-gradient(135deg, rgba(230,126,34,0.15), rgba(214,48,49,0.1));">
      <h2 class="pres-slide-title">🏛️ Análisis por Zonas del Pliego Municipal</h2>
      <span class="pres-slide-badge" style="background:var(--orange);">PLIEGO 2025336 — 12 ZONAS</span>
    </div>
    <div class="pres-slide-body" style="padding:20px;">
      <p class="pres-intro" style="margin-bottom:14px;">Ranking de las 12 zonas oficiales del Municipio ordenadas por score compuesto (40% facturación + 30% cercanía + 30% eficiencia). Cada zona mezcla múltiples localidades.</p>

      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Zona</th>
              <th>Esc.</th>
              <th>Localidades</th>
              <th>Módulos</th>
              <th>Com.</th>
              <th>DM s/C</th>
              <th>Pat.</th>
              <th>Cam.</th>
              <th>Km/día</th>
              <th>Disp.</th>
              <th>Costo/día</th>
              <th>Fact./día</th>
              <th>Margen</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            ${scoredZonas.map((z, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
              return `<tr style="${i < 3 ? 'background:rgba(16,185,129,0.05);' : ''}">
                <td style="text-align:center; font-weight:700;">${medal}</td>
                <td style="font-weight:700; color:var(--blue);">${z.zona}</td>
                <td style="text-align:center;">${z.n}</td>
                <td style="font-size:0.75rem; color:var(--text-muted); max-width:120px; overflow:hidden; text-overflow:ellipsis;" title="${z.locsNames.join(', ')}">${z.localidades} locs</td>
                <td class="cell-mod">${z.mod.toLocaleString()}</td>
                <td class="cell-com">${z.com.toLocaleString()}</td>
                <td style="text-align:right; font-family:var(--font-mono); color:var(--purple);">${z.dm.toLocaleString()}</td>
                <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan);">${z.pat > 0 ? z.pat.toLocaleString() : '-'}</td>
                <td style="text-align:center; font-weight:700;">${z.cam}</td>
                <td style="text-align:right; font-family:var(--font-mono);">${z.kmDia.toFixed(0)}</td>
                <td style="text-align:right; font-family:var(--font-mono); color:${z.dispersion > 5 ? 'var(--red)' : 'var(--green)'};">${z.dispersion.toFixed(1)}km</td>
                <td style="text-align:right; font-family:var(--font-mono); color:var(--red);">${fMoney(z.costoDia)}</td>
                <td style="text-align:right; font-family:var(--font-mono); color:var(--green);">${fMoney(z.factDiaria)}</td>
                <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:${z.rentPct >= 50 ? 'var(--green)' : z.rentPct >= 30 ? 'var(--orange)' : 'var(--red)'};">${z.rentPct.toFixed(1)}%</td>
                <td style="text-align:center; font-weight:700; color:var(--blue);">${z.score.toFixed(1)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Detalle por zona: qué localidades mezcla -->
      <div style="margin-top:16px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
        ${scoredZonas.map((z, i) => `
          <div style="background:var(--bg-elevated); border-radius:var(--radius-md); padding:10px; border:1px solid var(--glass-border);">
            <div style="font-weight:700; font-size:0.8rem; color:var(--blue); margin-bottom:6px;">${z.zona} — Score ${z.score.toFixed(1)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">${z.n} escuelas · ${z.cam} cam. · ${z.localidades} localidades</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">${z.locsNames.join(', ')}</div>
            <div style="margin-top:6px; font-family:var(--font-mono); font-size:0.8rem;">
              <span style="color:var(--green);">Fact: ${fMoney(z.factDiaria)}/día</span> ·
              <span style="color:var(--red);">Costo: ${fMoney(z.costoDia)}/día</span> ·
              <span style="color:${z.rentPct >= 50 ? 'var(--green)' : 'var(--orange)'}; font-weight:700;">Margen: ${z.rentPct.toFixed(1)}%</span>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Conclusión zonas pliego -->
      <div style="margin-top:16px; background:rgba(230,126,34,0.08); border:1px solid rgba(230,126,34,0.3); border-radius:var(--radius-md); padding:14px;">
        <div style="font-weight:700; font-size:0.85rem; color:var(--orange); margin-bottom:10px;">📋 CONCLUSIÓN — ZONAS DEL PLIEGO</div>
        <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.6;">
          <div style="margin-bottom:6px;">🎯 <strong>Zonas recomendadas para ofertar:</strong> Las 3 primeras del ranking (${scoredZonas.slice(0,3).map(z=>z.zona).join(', ')}) combinan alta facturación, cercanía al depósito y buena eficiencia logística.</div>
          <div style="margin-bottom:6px;">⚠️ <strong>Dispersión geográfica:</strong> Las zonas del pliego mezclan localidades distantes (hasta ${Math.max(...scoredZonas.map(z=>z.dispersion)).toFixed(1)} km de dispersión), lo que genera km muertos en las rutas.</div>
          <div style="margin-bottom:6px;">📊 <strong>Regla del 2/3:</strong> Se puede ofertar en hasta ${Math.floor(scoredZonas.length * 2 / 3)} zonas sin superar el límite de 2/3 de los cupos del distrito.</div>
          <div>💡 <strong>Estrategia:</strong> Ofertar por las zonas del pliego con mejor score, y DENTRO de cada zona adjudicada, organizar las rutas por clusters de localidad para optimizar la distribución.</div>
        </div>
      </div>
    </div>
  </div>`;

  container.innerHTML = html;
}

function renderPresentacion() {
  const container = document.getElementById('presentacionContainer');
  container.innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const colegios = state.data.colegios;
  const depot = state.data.depot;

  // ═══ PRECIOS DEL PLIEGO - Licitación Pública 2025/336 ═══
  const PRECIO_DM = 478, PRECIO_COMEDOR = 988, PRECIO_PATIOS = 478, PRECIO_MODULO = 15065;
  const PRECIO_DM_LC = 955, PRECIO_COM_LC = 1671, PRECIO_DM_PAT = 690, PRECIO_COM_PAT = 1127;
  const DIAS_HABILES = 172, SABADOS = 39, MESES = 9, MAX_PARADAS = 15, MIN_POR_PARADA = 20;
  // Cupos globales (Art. 1)
  const CUPOS_DM_LC = 2552, CUPOS_COM_LC = 3105, CUPOS_DM_PAT = 117, CUPOS_COM_PAT = 95;
  // Presupuesto oficial desglosado
  const PO_TOTAL = 30_963_703_041;
  const PO_DM_COMEDOR = 18_457_093_992;
  const PO_MESA = 11_163_255_390;
  const PO_PATIOS = 17_598_048;
  const PO_PATOLOGIAS = 32_256_787;
  const PO_LISTO_CONSUMO = 1_293_498_824;

  // COSTOS REALES - Sprinter 515 2014 (Auditoría Panel Expertos)
  const COSTO_COMBUSTIBLE_KM = 69;
  const COSTO_AMORTIZACION_KM = 23;
  const COSTO_MANTENIMIENTO_KM = 72;
  const COSTO_SEGUROS_KM = 38;
  const COSTO_OPERATIVO_KM = COSTO_COMBUSTIBLE_KM + COSTO_AMORTIZACION_KM + COSTO_MANTENIMIENTO_KM + COSTO_SEGUROS_KM; // $202/km

  // SALARIOS POR EQUIPO con cargas sociales
  const SALARIO_BRUTO_EQUIPO_MES_P = 1_800_000 + (900_000 * 2); // $3.6M/mes
  const CARGAS_SOCIALES_P = 1.57;
  const SALARIO_REAL_EQUIPO_MES_P = SALARIO_BRUTO_EQUIPO_MES_P * CARGAS_SOCIALES_P; // $5.652M/mes
  const SALARIO_REAL_EQUIPO_DIA_P = SALARIO_REAL_EQUIPO_MES_P / 22; // $256.909/día por equipo

  // FACTOR CORRECCIÓN DISTANCIA y ESTRUCTURA
  const FACTOR_RUTA_P = 1.4;
  const COSTOS_ESTRUCTURA_MES_P = 10_000_000;
  const COSTOS_ESTRUCTURA_DIA_P = COSTOS_ESTRUCTURA_MES_P / 22;
  const RETENCION_IMPOSITIVA_P = 0.052;

  // Haversine distance in km (con factor ruta)
  function haversineKm(lat1, lng1, lat2, lng2) { return getRouteKm(lat1, lng1, lat2, lng2); }
  function _unusedHaversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * FACTOR_RUTA_P;
  }

  // === AGRUPAR POR LOCALIDAD ===
  const locData = {};
  colegios.forEach(c => {
    const loc = c.localidad || 'Sin Localidad';
    if (!locData[loc]) locData[loc] = { escuelas: [], modulos: 0, comedor: 0, dmSolo: 0, dmc: 0, patios: 0, distancias: [] };
    const cupos = c.cupos || {};
    const mod = cupos.modulos || 0;
    const com = cupos.comedor || 0;
    const dmc = cupos.dmc_comedor || 0;
    const dmSolo = dmc - com;
    const dist = haversineKm(depot.lat, depot.lng, parseFloat(c.lat), parseFloat(c.lng));

    locData[loc].escuelas.push(c);
    locData[loc].modulos += mod;
    locData[loc].comedor += com;
    locData[loc].dmSolo += dmSolo;
    locData[loc].dmc += dmc;
    locData[loc].patios += (cupos.patios || 0);
    locData[loc].distancias.push(dist);
  });

  // Total camionetas para estructura
  const totalCamPres = Object.keys(locData).reduce((s, loc) => s + Math.ceil(locData[loc].escuelas.length / MAX_PARADAS), 0);

  // === CALCULAR MÉTRICAS POR LOCALIDAD ===
  const locAnalisis = Object.keys(locData).map(loc => {
    const d = locData[loc];
    const nEscuelas = d.escuelas.length;
    const distPromedio = d.distancias.reduce((s,v) => s+v, 0) / d.distancias.length;
    const distMax = Math.max(...d.distancias);
    const distMin = Math.min(...d.distancias);

    // Facturación por UdN
    const factDiariaDM = d.dmSolo * PRECIO_DM;
    const factDiariaComedor = d.comedor * PRECIO_COMEDOR;
    const factDiaria = factDiariaDM + factDiariaComedor;
    const factModulosMensual = d.modulos * PRECIO_MODULO;
    const factPatiosSabado = d.patios * PRECIO_PATIOS;
    const factTotalContrato = (factDiaria * DIAS_HABILES) + (factModulosMensual * MESES) + (factPatiosSabado * SABADOS);

    // Logística corregida
    const camionetas = Math.ceil(nEscuelas / MAX_PARADAS);
    const paradasPorCamioneta = Math.ceil(nEscuelas / camionetas);
    const tiempoRutaMin = paradasPorCamioneta * MIN_POR_PARADA;
    const tiempoRutaHs = (tiempoRutaMin / 60).toFixed(1);

    // Costo logístico corregido (Panel Expertos)
    const kmDiarioEstimado = distPromedio * 2 * camionetas;
    const costoOperativoDiario = kmDiarioEstimado * COSTO_OPERATIVO_KM;
    const costoSalariosDiario = camionetas * SALARIO_REAL_EQUIPO_DIA_P;
    const costoEstructuraDiario = (camionetas / totalCamPres) * COSTOS_ESTRUCTURA_DIA_P;
    const retencionDiaria = factDiaria * RETENCION_IMPOSITIVA_P;
    const costoLogisticoDiario = costoOperativoDiario + costoSalariosDiario + costoEstructuraDiario;
    const costoLogisticoContrato = costoLogisticoDiario * DIAS_HABILES;

    // Rentabilidad
    const margenDiario = factDiaria - costoLogisticoDiario - retencionDiaria;
    const rentabilidadPct = factDiaria > 0 ? ((margenDiario / factDiaria) * 100) : 0;

    // Cupo promedio por escuela
    const cupoPromedio = Math.round(d.dmc / nEscuelas);

    return {
      localidad: loc,
      escuelas: nEscuelas,
      modulos: d.modulos,
      comedor: d.comedor,
      dmSolo: d.dmSolo,
      dmc: d.dmc,
      patios: d.patios,
      distPromedio: distPromedio,
      distMax: distMax,
      distMin: distMin,
      factDiariaDM: factDiariaDM,
      factDiariaComedor: factDiariaComedor,
      factDiaria: factDiaria,
      factModulosMensual: factModulosMensual,
      factPatiosSabado: factPatiosSabado,
      factTotalContrato: factTotalContrato,
      camionetas: camionetas,
      paradasPorCamioneta: paradasPorCamioneta,
      tiempoRutaMin: tiempoRutaMin,
      tiempoRutaHs: tiempoRutaHs,
      kmDiarioEstimado: kmDiarioEstimado,
      costoOperativoDiario: costoOperativoDiario,
      costoSalariosDiario: costoSalariosDiario,
      costoEstructuraDiario: costoEstructuraDiario,
      retencionDiaria: retencionDiaria,
      costoLogisticoDiario: costoLogisticoDiario,
      costoLogisticoContrato: costoLogisticoContrato,
      margenDiario: margenDiario,
      rentabilidadPct: rentabilidadPct,
      cupoPromedio: cupoPromedio
    };
  });

  // Totales globales
  const totalEscuelas = locAnalisis.reduce((s,l) => s + l.escuelas, 0);
  const totalModulos = locAnalisis.reduce((s,l) => s + l.modulos, 0);
  const totalComedor = locAnalisis.reduce((s,l) => s + l.comedor, 0);
  const totalDM = locAnalisis.reduce((s,l) => s + l.dmSolo, 0);
  const totalPatios = locAnalisis.reduce((s,l) => s + l.patios, 0);
  const totalDMC = locAnalisis.reduce((s,l) => s + l.dmc, 0);
  const totalFactDiaria = locAnalisis.reduce((s,l) => s + l.factDiaria, 0);
  const totalFactContrato = locAnalisis.reduce((s,l) => s + l.factTotalContrato, 0);
  const totalCamionetas = locAnalisis.reduce((s,l) => s + l.camionetas, 0);
  const totalFactModulos = locAnalisis.reduce((s,l) => s + l.factModulosMensual, 0);
  const totalFactPatios = locAnalisis.reduce((s,l) => s + l.factPatiosSabado, 0);

  // Rankings
  const byRentabilidad = [...locAnalisis].sort((a,b) => b.factTotalContrato - a.factTotalContrato);
  const byCupos = [...locAnalisis].sort((a,b) => b.dmc - a.dmc);
  const byDistancia = [...locAnalisis].sort((a,b) => a.distPromedio - b.distPromedio);
  const byCosto = [...locAnalisis].sort((a,b) => a.costoLogisticoContrato - b.costoLogisticoContrato);
  const byMargen = [...locAnalisis].sort((a,b) => b.rentabilidadPct - a.rentabilidadPct);

  // Formato moneda
  const fMoney = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  const fPct = (n) => n.toFixed(1) + '%';

  // ===========================
  // SLIDE 1: RESUMEN EJECUTIVO
  // ===========================
  let html = `
  <div class="pres-slide animate-in" style="animation-delay:0ms">
    <div class="pres-slide-header">
      <h2 class="pres-slide-title">Resumen Ejecutivo — Propuesta de Rezonificación</h2>
      <span class="pres-slide-badge">REAL R14 | Lomas de Zamora 2025</span>
    </div>
    <div class="pres-slide-body">
      <p class="pres-intro">Pliego Licitación Pública 2025/336 — SAE Lomas de Zamora. Período: 1 jun 2025 al 28 feb 2026. El pliego divide el distrito en <strong>12 zonas</strong> con <strong>8 tipos de prestación</strong>. Nuestra propuesta reagrupa las 276 escuelas por <strong>12 localidades geográficas</strong>, optimizando rutas desde Ombú 1269, Burzaco.</p>
      <div class="pres-kpi-grid">
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--blue)">${totalEscuelas}</div>
          <div class="pres-kpi-label">Escuelas</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--orange)">${totalComedor.toLocaleString()}</div>
          <div class="pres-kpi-label">🍽️ Comedor/día</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--purple)">${totalDM.toLocaleString()}</div>
          <div class="pres-kpi-label">☕ DM sin Comedor/día</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--green)">${totalModulos.toLocaleString()}</div>
          <div class="pres-kpi-label">📦 Módulos MESA/mes</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--cyan)">${totalPatios.toLocaleString()}</div>
          <div class="pres-kpi-label">⚽ Patios Abiertos/sáb</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--blue)">${totalDMC.toLocaleString()}</div>
          <div class="pres-kpi-label">Desayuno y Merienda/día</div>
        </div>
      </div>
      <div class="pres-kpi-grid" style="margin-top:12px">
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--orange); font-size:1.4rem">${fMoney(totalFactDiaria)}</div>
          <div class="pres-kpi-label">Fact. Diaria (DM s/C + Com)</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--green); font-size:1.4rem">${fMoney(totalFactModulos)}</div>
          <div class="pres-kpi-label">Módulos MESA/mes</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--cyan); font-size:1.4rem">${fMoney(totalFactPatios)}</div>
          <div class="pres-kpi-label">Patios/sábado</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--purple); font-size:1.6rem">${fMoney(totalFactContrato)}</div>
          <div class="pres-kpi-label">💰 Facturación Total Contrato</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--red)">${totalCamionetas}</div>
          <div class="pres-kpi-label">🚛 Camionetas Necesarias</div>
        </div>
      </div>
      <!-- Prestaciones adicionales del pliego NO modeladas por escuela -->
      <div style="margin-top:12px; background:var(--bg-elevated); border-radius:var(--radius-md); padding:14px; border:1px solid var(--glass-border);">
        <div style="font-weight:700; font-size:0.75rem; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:10px;">📋 PRESTACIONES ADICIONALES DEL PLIEGO (no asignadas por escuela)</div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px; font-family:var(--font-mono); font-size:0.8rem;">
          <div style="text-align:center;"><div style="color:var(--orange); font-weight:700;">Listo Consumo DM</div><div>${CUPOS_DM_LC.toLocaleString()} cupos/día</div><div style="color:var(--text-muted);">$${PRECIO_DM_LC}/cupo</div><div style="color:var(--green);">${fMoney(CUPOS_DM_LC * PRECIO_DM_LC * DIAS_HABILES)}</div></div>
          <div style="text-align:center;"><div style="color:var(--orange); font-weight:700;">Listo Consumo Com.</div><div>${CUPOS_COM_LC.toLocaleString()} cupos/día</div><div style="color:var(--text-muted);">$${PRECIO_COM_LC.toLocaleString()}/cupo</div><div style="color:var(--green);">${fMoney(CUPOS_COM_LC * PRECIO_COM_LC * DIAS_HABILES)}</div></div>
          <div style="text-align:center;"><div style="color:var(--purple); font-weight:700;">Patologías DM</div><div>${CUPOS_DM_PAT} cupos/día</div><div style="color:var(--text-muted);">$${PRECIO_DM_PAT}/cupo</div><div style="color:var(--green);">${fMoney(CUPOS_DM_PAT * PRECIO_DM_PAT * DIAS_HABILES)}</div></div>
          <div style="text-align:center;"><div style="color:var(--purple); font-weight:700;">Patologías Com.</div><div>${CUPOS_COM_PAT} cupos/día</div><div style="color:var(--text-muted);">$${PRECIO_COM_PAT.toLocaleString()}/cupo</div><div style="color:var(--green);">${fMoney(CUPOS_COM_PAT * PRECIO_COM_PAT * DIAS_HABILES)}</div></div>
        </div>
      </div>
      <!-- Presupuesto oficial desglosado -->
      <div style="margin-top:10px; display:grid; grid-template-columns:repeat(5,1fr); gap:8px; font-family:var(--font-mono); font-size:0.75rem; text-align:center;">
        <div style="background:var(--bg-elevated); padding:8px; border-radius:var(--radius-sm);"><div style="color:var(--blue); font-weight:700;">DM + Comedor</div><div>${fMoney(PO_DM_COMEDOR)}</div></div>
        <div style="background:var(--bg-elevated); padding:8px; border-radius:var(--radius-sm);"><div style="color:var(--green); font-weight:700;">MESA Bonaerense</div><div>${fMoney(PO_MESA)}</div></div>
        <div style="background:var(--bg-elevated); padding:8px; border-radius:var(--radius-sm);"><div style="color:var(--orange); font-weight:700;">Listo Consumo</div><div>${fMoney(PO_LISTO_CONSUMO)}</div></div>
        <div style="background:var(--bg-elevated); padding:8px; border-radius:var(--radius-sm);"><div style="color:var(--purple); font-weight:700;">Patologías</div><div>${fMoney(PO_PATOLOGIAS)}</div></div>
        <div style="background:var(--bg-elevated); padding:8px; border-radius:var(--radius-sm);"><div style="color:var(--cyan); font-weight:700;">Patios Abiertos</div><div>${fMoney(PO_PATIOS)}</div></div>
      </div>
      <div class="pres-note" style="margin-top:10px;">
        <strong>Presupuesto oficial total: ${fMoney(PO_TOTAL)}</strong> — Precios s/Nota NO-2025-05251379-GDEBA (14/02/2025). Período: ${DIAS_HABILES} días hábiles · ${SABADOS} sábados · ${MESES} meses.
      </div>
    </div>
  </div>`;

  // ===========================
  // SLIDE 2: RANKING RENTABILIDAD
  // ===========================
  html += `
  <div class="pres-slide animate-in" style="animation-delay:100ms">
    <div class="pres-slide-header">
      <h2 class="pres-slide-title">Ranking de Rentabilidad por Localidad — Desglose por UdN</h2>
      <span class="pres-slide-badge">FACTURACIÓN TOTAL CONTRATO</span>
    </div>
    <div class="pres-slide-body">
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Localidad</th>
              <th>Esc.</th>
              <th>Comedor/día</th>
              <th>DM s/C</th>
              <th>Módulos/mes</th>
              <th>Patios/sáb</th>
              <th>Fact. Total Contrato</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            ${byRentabilidad.map((l, i) => `<tr>
              <td class="cell-idx">${i+1}</td>
              <td class="cell-name">${l.localidad}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.escuelas}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--orange)">${fMoney(l.factDiariaComedor)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--purple)">${fMoney(l.factDiariaDM)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--green)">${fMoney(l.factModulosMensual)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan)">${l.factPatiosSabado > 0 ? fMoney(l.factPatiosSabado) : '-'}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--blue); font-weight:700">${fMoney(l.factTotalContrato)}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${((l.factTotalContrato/totalFactContrato)*100).toFixed(1)}%</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td style="font-weight:700">TOTAL</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700">${totalEscuelas}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--orange)">${fMoney(locAnalisis.reduce((s,l)=>s+l.factDiariaComedor,0))}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--purple)">${fMoney(locAnalisis.reduce((s,l)=>s+l.factDiariaDM,0))}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--green)">${fMoney(totalFactModulos)}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--cyan)">${fMoney(totalFactPatios)}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--blue)">${fMoney(totalFactContrato)}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>`;

  // ===========================
  // SLIDE 3: ANÁLISIS DE CUPOS
  // ===========================
  html += `
  <div class="pres-slide animate-in" style="animation-delay:200ms">
    <div class="pres-slide-header">
      <h2 class="pres-slide-title">Análisis de Cupos por Localidad</h2>
      <span class="pres-slide-badge">VOLUMEN OPERATIVO</span>
    </div>
    <div class="pres-slide-body">
      <div class="pres-top3-grid">
        <div class="pres-top3-card" style="border-top:3px solid var(--green)">
          <div class="pres-top3-rank">MÁS CUPOS</div>
          <div class="pres-top3-name">${byCupos[0].localidad}</div>
          <div class="pres-top3-value" style="color:var(--green)">${byCupos[0].dmc.toLocaleString()} DyM/día</div>
          <div class="pres-top3-detail">${byCupos[0].escuelas} escuelas — ${byCupos[0].cupoPromedio} cupos/escuela prom.</div>
        </div>
        <div class="pres-top3-card" style="border-top:3px solid var(--orange)">
          <div class="pres-top3-rank">MENOS CUPOS</div>
          <div class="pres-top3-name">${byCupos[byCupos.length-1].localidad}</div>
          <div class="pres-top3-value" style="color:var(--orange)">${byCupos[byCupos.length-1].dmc.toLocaleString()} DyM/día</div>
          <div class="pres-top3-detail">${byCupos[byCupos.length-1].escuelas} escuelas — ${byCupos[byCupos.length-1].cupoPromedio} cupos/escuela prom.</div>
        </div>
        <div class="pres-top3-card" style="border-top:3px solid var(--blue)">
          <div class="pres-top3-rank">MÁS CONCENTRADA</div>
          <div class="pres-top3-name">${[...locAnalisis].sort((a,b)=>b.cupoPromedio-a.cupoPromedio)[0].localidad}</div>
          <div class="pres-top3-value" style="color:var(--blue)">${[...locAnalisis].sort((a,b)=>b.cupoPromedio-a.cupoPromedio)[0].cupoPromedio} cupos/escuela</div>
          <div class="pres-top3-detail">Mayor densidad de cupos por establecimiento</div>
        </div>
      </div>
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead><tr><th>#</th><th>Localidad</th><th>Esc.</th><th>Módulos</th><th>Comedor</th><th>DM s/C</th><th>Patios</th><th>DyM Total</th><th>Cupo/Esc</th></tr></thead>
          <tbody>
            ${byCupos.map((l,i) => `<tr>
              <td class="cell-idx">${i+1}</td>
              <td class="cell-name">${l.localidad}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.escuelas}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--green)">${l.modulos.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--orange)">${l.comedor.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--purple)">${l.dmSolo.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan)">${l.patios > 0 ? l.patios.toLocaleString() : '-'}</td>
              <td class="cell-dmc">${l.dmc.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--text-secondary)">${l.cupoPromedio}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

  // ===========================
  // SLIDE 4: DISTANCIA Y COSTOS
  // ===========================
  html += `
  <div class="pres-slide animate-in" style="animation-delay:300ms">
    <div class="pres-slide-header">
      <h2 class="pres-slide-title">Costos Logísticos — Distancia desde Ombú 1269</h2>
      <span class="pres-slide-badge">ANÁLISIS DE PROXIMIDAD</span>
    </div>
    <div class="pres-slide-body">
      <div class="pres-top3-grid">
        <div class="pres-top3-card" style="border-top:3px solid var(--green)">
          <div class="pres-top3-rank">MÁS CERCANA</div>
          <div class="pres-top3-name">${byDistancia[0].localidad}</div>
          <div class="pres-top3-value" style="color:var(--green)">${byDistancia[0].distPromedio.toFixed(1)} km prom.</div>
          <div class="pres-top3-detail">Menor costo de combustible y tiempo</div>
        </div>
        <div class="pres-top3-card" style="border-top:3px solid var(--red)">
          <div class="pres-top3-rank">MÁS LEJANA</div>
          <div class="pres-top3-name">${byDistancia[byDistancia.length-1].localidad}</div>
          <div class="pres-top3-value" style="color:var(--red)">${byDistancia[byDistancia.length-1].distPromedio.toFixed(1)} km prom.</div>
          <div class="pres-top3-detail">Mayor costo logístico</div>
        </div>
        <div class="pres-top3-card" style="border-top:3px solid var(--blue)">
          <div class="pres-top3-rank">MENOR COSTO TOTAL</div>
          <div class="pres-top3-name">${byCosto[0].localidad}</div>
          <div class="pres-top3-value" style="color:var(--blue)">${fMoney(byCosto[0].costoLogisticoContrato)}</div>
          <div class="pres-top3-detail">Costo logístico total del contrato</div>
        </div>
      </div>
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead><tr><th>#</th><th>Localidad</th><th>Cam.</th><th>Dist. Prom</th><th>Km/día</th><th>Operativo/día</th><th>Salarios/día</th><th>Estructura/día</th><th>Total/día</th><th>Ret. Imp.</th><th>Margen</th></tr></thead>
          <tbody>
            ${byDistancia.map((l,i) => `<tr>
              <td class="cell-idx">${i+1}</td>
              <td class="cell-name">${l.localidad}</td>
              <td style="text-align:center; font-weight:700;">${l.camionetas}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--green)">${l.distPromedio.toFixed(1)} km</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.kmDiarioEstimado.toFixed(0)} km</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--orange)">${fMoney(l.costoOperativoDiario)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--purple)">${fMoney(l.costoSalariosDiario)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan)">${fMoney(l.costoEstructuraDiario)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--red); font-weight:700">${fMoney(l.costoLogisticoDiario)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--text-muted)">-${fMoney(l.retencionDiaria)}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:${l.rentabilidadPct >= 50 ? 'var(--green)' : l.rentabilidadPct >= 30 ? 'var(--orange)' : 'var(--red)'}">${l.rentabilidadPct.toFixed(1)}%</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pres-note"><strong>Modelo corregido (Panel Expertos):</strong> Vehículo $${COSTO_OPERATIVO_KM}/km · Salarios: $3.6M/mes × <strong>1.57 cargas sociales</strong> = $5.65M/mes <strong>por equipo</strong> · Distancia: Haversine × <strong>1.4 factor ruta</strong> · Estructura: $10M/mes · Ret. impositiva: 5.2%. <strong>Solo costos logísticos (3-5% del total).</strong></div>
    </div>
  </div>`;

  // ===========================
  // SLIDE 5: PLAN DE REPARTO
  // ===========================
  html += `
  <div class="pres-slide animate-in" style="animation-delay:400ms">
    <div class="pres-slide-header">
      <h2 class="pres-slide-title">Plan de Reparto — Camionetas y Tiempos</h2>
      <span class="pres-slide-badge">OPERACIÓN DIARIA</span>
    </div>
    <div class="pres-slide-body">
      <div class="pres-kpi-grid" style="margin-bottom:20px">
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--blue)">${totalCamionetas}</div>
          <div class="pres-kpi-label">Camionetas Totales</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--green)">${MAX_PARADAS}</div>
          <div class="pres-kpi-label">Máx. Paradas/Camioneta</div>
        </div>
        <div class="pres-kpi">
          <div class="pres-kpi-value" style="color:var(--orange)">${MIN_POR_PARADA} min</div>
          <div class="pres-kpi-label">Ventana por Parada</div>
        </div>
      </div>
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead><tr><th>#</th><th>Localidad</th><th>Escuelas</th><th>Camionetas</th><th>Paradas/Cam.</th><th>Tiempo Ruta</th><th>DyM Atendido</th><th>DyM/Camioneta</th></tr></thead>
          <tbody>
            ${locAnalisis.sort((a,b) => b.camionetas - a.camionetas).map((l,i) => `<tr>
              <td class="cell-idx">${i+1}</td>
              <td class="cell-name">${l.localidad}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.escuelas}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--blue); font-weight:700">${l.camionetas}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.paradasPorCamioneta}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--orange)">${l.tiempoRutaHs}hs (${l.tiempoRutaMin}min)</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.dmc.toLocaleString()}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan)">${Math.round(l.dmc/l.camionetas).toLocaleString()}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td style="font-weight:700">TOTAL</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700">${totalEscuelas}</td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--blue)">${totalCamionetas}</td>
              <td></td><td></td>
              <td style="text-align:right; font-family:var(--font-mono); font-weight:700">${totalDMC.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>`;

  // ===========================
  // SLIDE 6: RANKING FINAL SCORE
  // ===========================
  // Score compuesto: 40% facturación + 30% cercanía + 30% eficiencia (cupos/camioneta)
  const maxFact = Math.max(...locAnalisis.map(l => l.factTotalContrato));
  const maxDist = Math.max(...locAnalisis.map(l => l.distPromedio));
  const maxCupoCam = Math.max(...locAnalisis.map(l => l.dmc / l.camionetas));

  const scored = locAnalisis.map(l => {
    const scoreFact = (l.factTotalContrato / maxFact) * 40;
    const scoreDist = ((maxDist - l.distPromedio) / maxDist) * 30;
    const scoreEfi = ((l.dmc / l.camionetas) / maxCupoCam) * 30;
    return { ...l, score: scoreFact + scoreDist + scoreEfi, scoreFact, scoreDist, scoreEfi };
  }).sort((a,b) => b.score - a.score);

  html += `
  <div class="pres-slide animate-in" style="animation-delay:500ms">
    <div class="pres-slide-header">
      <h2 class="pres-slide-title">Ranking Final — Score de Conveniencia</h2>
      <span class="pres-slide-badge">40% FACTURACIÓN + 30% CERCANÍA + 30% EFICIENCIA</span>
    </div>
    <div class="pres-slide-body">
      <div class="pres-top3-grid">
        ${scored.slice(0,3).map((l,i) => `
        <div class="pres-top3-card" style="border-top:3px solid ${['var(--green)','var(--blue)','var(--orange)'][i]}">
          <div class="pres-top3-rank">${['🥇 1° LUGAR','🥈 2° LUGAR','🥉 3° LUGAR'][i]}</div>
          <div class="pres-top3-name">${l.localidad}</div>
          <div class="pres-top3-value" style="color:${['var(--green)','var(--blue)','var(--orange)'][i]}">${l.score.toFixed(1)} pts</div>
          <div class="pres-top3-detail">Fact: ${fMoney(l.factTotalContrato)} | Dist: ${l.distPromedio.toFixed(1)}km | ${l.camionetas} cam.</div>
        </div>`).join('')}
      </div>
      <div class="analisis-table-wrapper">
        <table class="analisis-data-table">
          <thead><tr><th>#</th><th>Localidad</th><th>Score Total</th><th>Facturación (40%)</th><th>Cercanía (30%)</th><th>Eficiencia (30%)</th><th>Fact. Contrato</th><th>Dist. Prom</th><th>Cam.</th></tr></thead>
          <tbody>
            ${scored.map((l,i) => `<tr style="${i < 3 ? 'background:rgba(99,102,241,0.06)' : ''}">
              <td class="cell-idx">${i+1}</td>
              <td class="cell-name" style="font-weight:${i<3?'700':'500'}">${l.localidad}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--blue); font-weight:700; font-size:1.05em">${l.score.toFixed(1)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--green)">${l.scoreFact.toFixed(1)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--orange)">${l.scoreDist.toFixed(1)}</td>
              <td style="text-align:right; font-family:var(--font-mono); color:var(--cyan)">${l.scoreEfi.toFixed(1)}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${fMoney(l.factTotalContrato)}</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.distPromedio.toFixed(1)} km</td>
              <td style="text-align:right; font-family:var(--font-mono)">${l.camionetas}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pres-note">
        <strong>Conclusión:</strong> ${scored[0].localidad} es la localidad más conveniente con un score de ${scored[0].score.toFixed(1)}/100, combinando alta facturación (${fMoney(scored[0].factTotalContrato)}), proximidad al depósito (${scored[0].distPromedio.toFixed(1)} km prom.) y eficiencia operativa (${Math.round(scored[0].dmc/scored[0].camionetas).toLocaleString()} DyM/camioneta). Las 3 localidades del podio concentran el ${((scored.slice(0,3).reduce((s,l)=>s+l.factTotalContrato,0)/totalFactContrato)*100).toFixed(1)}% de la facturación total del contrato.
      </div>
    </div>
  </div>`;

  container.innerHTML = html;
}

async function playPresentation() {
    if (state.isDemoActive) return;
    state.isDemoActive = true;
    UI.btnDemo.style.display = 'none';
    UI.btnStopDemo.style.display = 'inline-block';

    // Pantalla completa y scroll al mapa
    window.scrollTo({ top: 0, behavior: 'smooth' });
    switchTab('mapa');
    try {
      const el = document.querySelector('.map-container');
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      // Leaflet necesita recalcular el tamaño al entrar en fullscreen
      setTimeout(() => state.map && state.map.invalidateSize(), 400);
    } catch(e) { /* si el usuario cancela, seguimos igual */ }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const showMsg = async (title, text, color = "var(--blue)") => {
        if (!state.isDemoActive) return;
        UI.poTitle.textContent = title;
        UI.poTitle.style.color = color;
        UI.poText.textContent = text;
        UI.overlay.style.opacity = '1';
        UI.overlay.style.pointerEvents = 'all';
        await sleep(2500);
        UI.overlay.style.opacity = '0';
        UI.overlay.style.pointerEvents = 'none';
        await sleep(600);
    };

    const showLabel = (title, subtitle, color = "var(--blue)") => {
        if (!state.isDemoActive) return;
        UI.poTitle.textContent = title;
        UI.poTitle.style.color = color;
        UI.poText.textContent = subtitle;
        UI.overlay.style.opacity = '1';
        UI.overlay.style.pointerEvents = 'all';
    };

    const hideLabel = () => {
        UI.overlay.style.opacity = '0';
        UI.overlay.style.pointerEvents = 'none';
    };

    try {
        // Stage 1: Municipal Proposal (Pliegos)
        await showMsg("Propuesta Municipal", "Ruteo basado en Zonas de Pliego (Zonas 1 a 12)");

        for (const zona of state.data.zonas_pliego) {
            if (!state.isDemoActive) break;
            state.activeFilter = { type: 'pliego', value: zona };
            renderContent();
            const fc = state.filteredColegios;
            const n = fc.length;
            const mod = fc.reduce((s,c) => s + (c.cupos.modulos || 0), 0);
            const com = fc.reduce((s,c) => s + (c.cupos.comedor || 0), 0);
            const dym = fc.reduce((s,c) => s + (c.cupos.dmc_comedor || 0), 0);
            const dmsc = dym - com;
            const pat = fc.reduce((s,c) => s + (c.cupos.patios || 0), 0);
            showLabel(zona, `${n} esc · Módulos: ${mod.toLocaleString()} · Comedor: ${com.toLocaleString()} · DyM: ${dym.toLocaleString()} · DM s/C: ${dmsc.toLocaleString()}${pat > 0 ? ' · Patios: ' + pat.toLocaleString() : ''}`, getZoneColor(zona));
            await sleep(2800);
            hideLabel();
            await sleep(400);
        }

        // Stage 2: Our Proposal (Localities)
        if (state.isDemoActive) {
            await showMsg("Optimización Real R14", "Ruteo dinámico por Localidades Reales", "#10b981");
            for (const loc of state.data.localidades) {
                if (!state.isDemoActive) break;
                state.activeFilter = { type: 'localidad', value: loc };
                renderContent();
                const fc = state.filteredColegios;
                const n = fc.length;
                const mod = fc.reduce((s,c) => s + (c.cupos.modulos || 0), 0);
                const com = fc.reduce((s,c) => s + (c.cupos.comedor || 0), 0);
                const dym = fc.reduce((s,c) => s + (c.cupos.dmc_comedor || 0), 0);
                const dmsc = dym - com;
                const pat = fc.reduce((s,c) => s + (c.cupos.patios || 0), 0);
                showLabel(loc, `${n} esc · Módulos: ${mod.toLocaleString()} · Comedor: ${com.toLocaleString()} · DyM: ${dym.toLocaleString()} · DM s/C: ${dmsc.toLocaleString()}${pat > 0 ? ' · Patios: ' + pat.toLocaleString() : ''}`, "#10b981");
                await sleep(2800);
                hideLabel();
                await sleep(400);
            }
        }

        // End
        if (state.isDemoActive) {
            await showMsg("Análisis Estratégico", "Comparativa finalizada. Vista de conjunto restaurada.");
        }
    } catch (err) {
        console.error("Error en demo:", err);
    } finally {
        state.isDemoActive = false;
        hideLabel();
        UI.btnDemo.style.display = 'inline-block';
        UI.btnStopDemo.style.display = 'none';
        state.activeFilter = { type: 'ninguno', value: 'Todas' };
        renderContent();
        // Salir de pantalla completa
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            setTimeout(() => state.map && state.map.invalidateSize(), 400);
          }
        } catch(e) {}
    }
}

// ═══════════════════════════════════════════════════════════════════
// ¿POR QUÉ REZONIFICAR? — Vista profunda con módulos interactivos
// ═══════════════════════════════════════════════════════════════════
function renderPorQue() {
  const container = document.getElementById('porQueContainer');
  const fMoney = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  const fPct = (n) => (n * 100).toFixed(1) + '%';

  // Datos base del pliego (constantes)
  const NUM_ZONAS_PLIEGO = 12;
  const NUM_LOCALIDADES = (state.data && state.data.colegios)
    ? new Set(state.data.colegios.map(c => c.localidad).filter(Boolean)).size : 12;
  const TOTAL_COLEGIOS = state.data ? state.data.colegios.length : 276;

  container.innerHTML = `
    <div class="porque-wrap" style="max-width:1400px;margin:0 auto;padding:30px 24px;">

      <!-- HERO -->
      <div class="pq-hero" style="text-align:center;margin-bottom:50px;animation:fadeInUp 0.6s ease-out;">
        <div style="display:inline-block;padding:6px 16px;background:rgba(67,81,232,0.15);border:1px solid rgba(67,81,232,0.4);border-radius:999px;font-size:0.7rem;font-weight:700;letter-spacing:0.15em;color:var(--blue);text-transform:uppercase;margin-bottom:18px;">Análisis Estratégico R14</div>
        <h1 style="font-size:2.8rem;font-weight:800;color:var(--text-light);margin:0 0 14px;letter-spacing:-0.02em;">¿Por qué Rezonificar?</h1>
        <p style="font-size:1.1rem;color:var(--text-muted);max-width:760px;margin:0 auto;line-height:1.6;">
          Las <strong style="color:var(--orange)">12 zonas oficiales del pliego</strong> agrupan colegios por número, no por geografía real.
          La <strong style="color:var(--green)">rezonificación por localidad</strong> genera un doble ahorro:
          <strong style="color:var(--cyan)">para el Municipio</strong> (mejor servicio, menos penalidades, menor riesgo)
          y <strong style="color:var(--blue)">para Real de Catorce</strong> (menor costo logístico operativo).
        </p>
      </div>

      <!-- KPI HEADLINE -->
      <div class="pq-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:50px;">
        ${[
          {label:'Zonas Pliego', val: NUM_ZONAS_PLIEGO, color:'var(--orange)', icon:'📋'},
          {label:'Localidades Reales', val: NUM_LOCALIDADES, color:'var(--green)', icon:'🏘️'},
          {label:'Colegios Totales', val: TOTAL_COLEGIOS, color:'var(--blue)', icon:'🏫'},
          {label:'Beneficio Municipio', val:'+Calidad', color:'var(--cyan)', icon:'🏛️'}
        ].map((k,i) => `
          <div class="pq-kpi" style="background:var(--bg-elevated);border:1px solid var(--glass-border);border-radius:14px;padding:22px;animation:fadeInUp 0.5s ease-out ${0.1 + i*0.08}s both;position:relative;overflow:hidden;">
            <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${k.color};"></div>
            <div style="font-size:1.6rem;margin-bottom:8px;">${k.icon}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">${k.label}</div>
            <div style="font-size:2rem;font-weight:800;color:${k.color};font-family:var(--font-mono);">${k.val}</div>
          </div>
        `).join('')}
      </div>

      <!-- MÓDULO 1: PROBLEMA -->
      <div class="pq-module" data-mod="1" style="background:var(--bg-elevated);border:1px solid var(--glass-border);border-radius:18px;padding:32px;margin-bottom:24px;animation:fadeInUp 0.5s ease-out 0.4s both;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
          <div style="width:44px;height:44px;background:rgba(214,48,49,0.15);border:1px solid rgba(214,48,49,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">⚠️</div>
          <div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">Módulo 1</div>
            <h2 style="margin:0;font-size:1.5rem;color:var(--text-light);">El Problema: Las 12 Zonas del Pliego</h2>
          </div>
        </div>
        <p style="color:var(--text-muted);line-height:1.7;margin-bottom:20px;">
          El pliego define zonas con un criterio administrativo (Z1, Z2... Z12) que <strong style="color:#d63031">no responde a la geografía real</strong> del partido. Una sola zona puede contener colegios de localidades distintas, separadas por kilómetros y barreras urbanas (autopistas, vías).
        </p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">
          ${[
            {t:'Cruces innecesarios', d:'Camionetas atraviesan localidades enteras sin entregar'},
            {t:'Ruteo subóptimo', d:'Schools cercanos quedan en zonas distintas'},
            {t:'Tiempos muertos', d:'Mayor km recorrido = más combustible y horas-hombre'}
          ].map(p=>`
            <div style="background:rgba(214,48,49,0.08);border:1px solid rgba(214,48,49,0.25);border-radius:10px;padding:16px;">
              <div style="font-weight:700;color:#ff6b6b;font-size:0.95rem;margin-bottom:6px;">${p.t}</div>
              <div style="font-size:0.85rem;color:var(--text-muted);">${p.d}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- MÓDULO 2: SIMULADOR DE AHORRO -->
      <div class="pq-module" style="background:var(--bg-elevated);border:1px solid var(--glass-border);border-radius:18px;padding:32px;margin-bottom:24px;animation:fadeInUp 0.5s ease-out 0.6s both;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
          <div style="width:44px;height:44px;background:rgba(16,163,127,0.15);border:1px solid rgba(16,163,127,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🎚️</div>
          <div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">Módulo 2 — Simulador</div>
            <h2 style="margin:0;font-size:1.5rem;color:var(--text-light);">Simulá tu Ahorro de Km</h2>
          </div>
        </div>
        <p style="color:var(--text-muted);margin-bottom:20px;">Ajustá el factor de optimización para ver cómo impacta en costos logísticos anuales:</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;align-items:center;">
          <div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span style="font-size:0.85rem;color:var(--text-muted);">Reducción de km/día</span>
              <span id="pqSlideVal" style="font-family:var(--font-mono);font-weight:800;color:var(--green);font-size:1.1rem;">10%</span>
            </div>
            <input id="pqSlider" type="range" min="0" max="25" value="10" step="1" style="width:100%;accent-color:var(--green);">
            <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-muted);margin-top:6px;">
              <span>0%</span><span>25%</span>
            </div>
          </div>
          <div id="pqSimResult" style="background:var(--bg-base);border:1px solid var(--glass-border);border-radius:12px;padding:20px;"></div>
        </div>
      </div>

      <!-- MÓDULO 3: ¿QUÉ IMPLICA ESA REDUCCIÓN? -->
      <div class="pq-module" style="background:var(--bg-elevated);border:1px solid var(--glass-border);border-radius:18px;padding:32px;margin-bottom:24px;animation:fadeInUp 0.5s ease-out 0.65s both;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
          <div style="width:44px;height:44px;background:rgba(232,144,67,0.15);border:1px solid rgba(232,144,67,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🔍</div>
          <div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">Módulo 3</div>
            <h2 style="margin:0;font-size:1.5rem;color:var(--text-light);">¿Qué implica esa reducción diaria?</h2>
          </div>
        </div>

        <p style="color:var(--text-muted);line-height:1.7;margin-bottom:24px;">
          La reducción de km/día es el corazón del argumento de rezonificar. Cuando agrupás colegios por
          <strong style="color:var(--green)">proximidad geográfica real</strong> en lugar de por número administrativo,
          cada camioneta deja de cruzar el partido, no vuelve sobre sus pasos y evita autopistas y barreras urbanas.
        </p>

        <!-- Bloque ejemplo concreto -->
        <div style="background:rgba(67,81,232,0.08);border:1px solid rgba(67,81,232,0.3);border-left:4px solid var(--blue);border-radius:10px;padding:18px;margin-bottom:24px;">
          <div style="font-size:0.7rem;color:var(--blue);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:8px;">Ejemplo concreto</div>
          <div style="color:var(--text-light);line-height:1.6;font-size:0.95rem;">
            Si la <strong>Zona 4 del pliego</strong> tiene 3 colegios en Banfield y 2 en Villa Fiorito (separadas 8 km),
            una sola camioneta hoy hace ~30 km extra cruzando ida y vuelta. Rezonificando, esos 5 colegios se reparten
            entre dos rutas locales y cada una hace su recorrido compacto.
          </div>
        </div>

        <!-- Tabla de impactos -->
        <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:12px;">¿Qué pasa con esos 180 km menos por día? <span style="color:var(--green);">(escenario 10%)</span></div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:28px;">
          ${[
            {v:'Combustible', d:'~25 litros menos/día (Sprinter ~7 km/l)', c:'var(--orange)'},
            {v:'Amortización', d:'Camionetas duran más, se reemplazan menos seguido', c:'var(--purple)'},
            {v:'Mantenimiento', d:'Menos frenos, neumáticos, aceite, embrague', c:'var(--blue)'},
            {v:'Tiempo de chofer', d:'~3-4 horas-camioneta menos/día', c:'var(--cyan)'},
            {v:'Riesgo de siniestros', d:'Menos exposición vial = menor probabilidad de accidentes', c:'var(--green)'},
            {v:'Huella de carbono', d:'Menor emisión de CO₂ por la flota', c:'var(--green)'}
          ].map(x => `
            <div style="background:var(--bg-base);border:1px solid var(--glass-border);border-left:3px solid ${x.c};border-radius:8px;padding:12px 14px;">
              <div style="font-weight:700;color:${x.c};font-size:0.88rem;margin-bottom:3px;">${x.v}</div>
              <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.4;">${x.d}</div>
            </div>
          `).join('')}
        </div>

        <!-- Implicancias operativas -->
        <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:12px;">Implicancias operativas (más allá del dinero)</div>
        <ul style="color:var(--text-muted);line-height:1.8;padding-left:20px;margin:0 0 24px;">
          <li><strong style="color:var(--text-light)">Mejor cumplimiento de horarios:</strong> rutas más cortas = menor riesgo de llegar tarde (crítico porque las viandas tienen ventana de entrega antes del recreo).</li>
          <li><strong style="color:var(--text-light)">Capacidad liberada:</strong> los 180 km/día se pueden reinvertir en cubrir más colegios, atender contingencias o reducir flota.</li>
          <li><strong style="color:var(--text-light)">Trazabilidad:</strong> cada localidad con responsable definido facilita auditorías municipales.</li>
          <li><strong style="color:var(--text-light)">Menor desgaste del personal:</strong> jornadas más predecibles, menos estrés, menor rotación.</li>
          <li><strong style="color:var(--text-light)">Resiliencia ante imprevistos:</strong> si una camioneta falla, otra de la misma localidad puede cubrir sin desorganizar todo el sistema.</li>
        </ul>

        <!-- Por qué importa para R14 -->
        <div style="background:linear-gradient(135deg, rgba(16,163,127,0.12), rgba(67,81,232,0.12));border:1px solid rgba(16,163,127,0.35);border-radius:12px;padding:20px;">
          <div style="font-size:0.7rem;color:var(--green);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:8px;">Por qué importa al licitar</div>
          <div style="color:var(--text-light);line-height:1.7;font-size:0.95rem;">
            El pliego paga <strong>por ración entregada</strong>, no por km recorrido. Cada km ahorrado es
            <strong style="color:var(--green)">margen directo a la rentabilidad</strong> sin afectar la facturación.
            En un contrato de <strong style="color:var(--green);font-family:var(--font-mono)">$30.963 millones</strong>,
            optimizar 7-12% del costo logístico directo es la diferencia entre operar con margen sano u operar al límite.
          </div>
        </div>
      </div>

      <!-- MÓDULO 4: BENEFICIOS -->
      <div class="pq-module" style="background:var(--bg-elevated);border:1px solid var(--glass-border);border-radius:18px;padding:32px;margin-bottom:24px;animation:fadeInUp 0.5s ease-out 0.7s both;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
          <div style="width:44px;height:44px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">✨</div>
          <div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">Módulo 4</div>
            <h2 style="margin:0;font-size:1.5rem;color:var(--text-light);">Beneficios de la Rezonificación</h2>
          </div>
        </div>
        <div class="pq-benefits" style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
          ${[
            {i:'🚚',t:'Menor kilometraje',d:'Rutas más compactas geográficamente. Estimado 10-15% menos km/día.',c:'var(--green)'},
            {i:'⏱️',t:'Tiempos optimizados',d:'Menos cruces entre localidades = más ventana operativa para entregas.',c:'var(--blue)'},
            {i:'⛽',t:'Ahorro de combustible',d:'Directamente proporcional al km. A $202/km, cada km ahorrado suma.',c:'var(--orange)'},
            {i:'🛠️',t:'Menos desgaste de flota',d:'Amortización y mantenimiento bajan al recorrer menos.',c:'var(--purple)'},
            {i:'👥',t:'Mejor jornada laboral',d:'Choferes y auxiliares con rutas más predecibles y menos saturadas.',c:'var(--cyan)'},
            {i:'📦',t:'Trazabilidad clara',d:'Cada localidad con responsable definido facilita auditorías y control.',c:'var(--green)'}
          ].map((b,i)=>`
            <div class="pq-benefit-card" style="background:var(--bg-base);border:1px solid var(--glass-border);border-left:3px solid ${b.c};border-radius:10px;padding:16px;display:flex;gap:14px;align-items:flex-start;cursor:pointer;transition:transform 0.2s, border-color 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.borderColor='${b.c}'" onmouseout="this.style.transform='translateY(0)';this.style.borderColor='var(--glass-border)';this.style.borderLeftColor='${b.c}'">
              <div style="font-size:1.6rem;line-height:1;">${b.i}</div>
              <div>
                <div style="font-weight:700;color:var(--text-light);margin-bottom:4px;">${b.t}</div>
                <div style="font-size:0.85rem;color:var(--text-muted);line-height:1.5;">${b.d}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- MÓDULO 5: ¿A QUIÉN BENEFICIA? -->
      <div class="pq-module" style="background:var(--bg-elevated);border:1px solid var(--glass-border);border-radius:18px;padding:32px;margin-bottom:24px;animation:fadeInUp 0.5s ease-out 0.75s both;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
          <div style="width:44px;height:44px;background:rgba(34,211,238,0.15);border:1px solid rgba(34,211,238,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🤝</div>
          <div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">Módulo 5 — Análisis de impacto</div>
            <h2 style="margin:0;font-size:1.5rem;color:var(--text-light);">¿A quién beneficia la rezonificación?</h2>
          </div>
        </div>

        <p style="color:var(--text-muted);line-height:1.7;margin-bottom:24px;">
          La rezonificación no es un cambio interno aislado: genera valor compartido entre el
          <strong style="color:var(--cyan)">Municipio de Lomas de Zamora</strong> (que contrata el servicio) y
          <strong style="color:var(--blue)">Real de Catorce</strong> (operador). Ambos ganan, en dimensiones distintas.
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

          <!-- COLUMNA MUNICIPIO -->
          <div style="background:linear-gradient(180deg, rgba(34,211,238,0.10), rgba(34,211,238,0.02));border:1px solid rgba(34,211,238,0.35);border-radius:14px;padding:24px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid rgba(34,211,238,0.25);">
              <div style="font-size:1.8rem;">🏛️</div>
              <div>
                <div style="font-size:0.7rem;color:var(--cyan);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Stakeholder 1</div>
                <div style="font-size:1.15rem;font-weight:800;color:var(--text-light);">Municipio de Lomas de Zamora</div>
              </div>
            </div>
            <div style="font-size:0.78rem;color:var(--cyan);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:10px;">Por qué le conviene</div>
            <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;">
              ${[
                {t:'Cumplimiento garantizado',d:'Rutas más cortas y predecibles bajan el riesgo de incumplimiento de horarios. Las viandas llegan antes del recreo, sin demoras.'},
                {t:'Trazabilidad por barrio',d:'Cada localidad tiene una camioneta y equipo asignado. Auditoría territorial directa: el funcionario sabe a quién llamar si falla un colegio de Banfield, Temperley o Fiorito.'},
                {t:'Calidad del servicio constante',d:'Menos km = menos exposición a tráfico, menos demoras imprevistas, menos reclamos de directivos escolares y familias.'},
                {t:'Servicio resiliente ante contingencias',d:'Si una camioneta falla, otra de la misma localidad puede cubrir sin desorganizar todo el sistema.'},
                {t:'Visibilidad política y social',d:'Un servicio bien gestionado se traduce en percepción positiva del Municipio en cada barrio. Cero costo extra para el erario.'},
                {t:'Sustentabilidad ambiental',d:'Menor consumo de combustible reduce huella de carbono de la flota oficial del SAE — un dato comunicable.'},
                {t:'Sin renegociar el contrato',d:'No requiere modificar el pliego ni los precios. Es una mejora operativa que el operador asume.'}
              ].map(b=>`
                <li style="display:flex;gap:10px;align-items:flex-start;">
                  <div style="color:var(--cyan);font-weight:900;flex-shrink:0;margin-top:2px;">✓</div>
                  <div>
                    <div style="font-weight:700;color:var(--text-light);font-size:0.92rem;margin-bottom:2px;">${b.t}</div>
                    <div style="font-size:0.83rem;color:var(--text-muted);line-height:1.5;">${b.d}</div>
                  </div>
                </li>
              `).join('')}
            </ul>
          </div>

          <!-- COLUMNA R14 -->
          <div style="background:linear-gradient(180deg, rgba(67,81,232,0.10), rgba(67,81,232,0.02));border:1px solid rgba(67,81,232,0.35);border-radius:14px;padding:24px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid rgba(67,81,232,0.25);">
              <div style="font-size:1.8rem;">🚚</div>
              <div>
                <div style="font-size:0.7rem;color:var(--blue);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Stakeholder 2</div>
                <div style="font-size:1.15rem;font-weight:800;color:var(--text-light);">Real de Catorce (R14)</div>
              </div>
            </div>
            <div style="font-size:0.78rem;color:var(--blue);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:10px;">Por qué le conviene</div>
            <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;">
              ${[
                {t:'Margen operativo más alto',d:'El pliego paga por ración entregada, no por km. Cada km ahorrado va directo a rentabilidad: 7-12% del costo logístico directo.'},
                {t:'Menor desgaste de flota',d:'Amortización y mantenimiento bajan al recorrer menos. Las Sprinter duran más antes de reemplazo.'},
                {t:'Capacidad liberada',d:'Los km/día ahorrados permiten cubrir más colegios con la misma flota, atender contingencias o reducir cantidad de camionetas necesarias.'},
                {t:'Mejor jornada de los equipos',d:'Choferes y auxiliares con rutas más predecibles, menos estrés y menor rotación de personal — reduce costos de selección y capacitación.'},
                {t:'Menor riesgo de penalidades',d:'Mejores tiempos de entrega bajan la probabilidad de multas o descuentos por incumplimiento.'},
                {t:'Diferenciación competitiva',d:'Demostrar capacidad de optimización geográfica posiciona a R14 como operador moderno frente a futuras licitaciones.'},
                {t:'Datos para escalar',d:'La estructura por localidad genera métricas claras (km/loc, costo/loc, ración/loc) que sirven para replicar el modelo en otros partidos.'}
              ].map(b=>`
                <li style="display:flex;gap:10px;align-items:flex-start;">
                  <div style="color:var(--blue);font-weight:900;flex-shrink:0;margin-top:2px;">✓</div>
                  <div>
                    <div style="font-weight:700;color:var(--text-light);font-size:0.92rem;margin-bottom:2px;">${b.t}</div>
                    <div style="font-size:0.83rem;color:var(--text-muted);line-height:1.5;">${b.d}</div>
                  </div>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>

        <!-- Bloque conclusión win-win -->
        <div style="margin-top:24px;background:linear-gradient(135deg, rgba(34,211,238,0.12), rgba(67,81,232,0.12));border:1px solid rgba(67,81,232,0.35);border-radius:12px;padding:20px;display:flex;gap:16px;align-items:center;">
          <div style="font-size:2.2rem;">🤝</div>
          <div>
            <div style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.1em;font-weight:800;margin-bottom:4px;">Win-Win Estructural</div>
            <div style="color:var(--text-muted);line-height:1.6;font-size:0.92rem;">
              El Municipio obtiene <strong style="color:var(--cyan)">mejor servicio sin pagar más</strong>, y R14 obtiene
              <strong style="color:var(--blue)">mayor rentabilidad sin renegociar</strong>. La rezonificación es una decisión
              puramente logística que crea valor en ambos lados sin transferirlo de uno a otro.
            </div>
          </div>
        </div>
      </div>

      <!-- FAQ sin contenedor -->
      <div class="pq-faq" style="margin-bottom:24px;animation:fadeInUp 0.5s ease-out 0.8s both;">
          ${[
            {q:'¿Cómo se garantiza que ningún colegio quede sin servicio?', a:'Cada colegio mantiene su asignación de cupos del pliego. Solo cambia la <strong>secuencia de ruta</strong> y el equipo que lo atiende, agrupando por proximidad geográfica real.'},
            {q:'¿Qué pasa con las zonas con pocos colegios?', a:'Se consolidan con localidades vecinas en una sola ruta. Esto evita enviar una camioneta por solo 2-3 colegios.'}
          ].map((f,i)=>`
            <div class="pq-faq-item" style="border-bottom:1px solid var(--glass-border);">
              <button class="pq-faq-q" data-i="${i}" style="width:100%;background:none;border:none;color:var(--text-light);font-size:1rem;font-weight:600;text-align:left;padding:18px 0;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-family:inherit;">
                <span>${f.q}</span>
                <span class="pq-faq-icon" style="color:var(--blue);font-size:1.4rem;transition:transform 0.3s;">−</span>
              </button>
              <div class="pq-faq-a pq-faq-open" style="overflow:hidden;transition:max-height 0.3s ease-out;">
                <p style="color:var(--text-muted);line-height:1.7;padding:0 0 18px;margin:0;">${f.a}</p>
              </div>
            </div>
          `).join('')}
      </div>

      <!-- CTA FINAL -->
      <div style="background:linear-gradient(135deg, rgba(67,81,232,0.15), rgba(16,163,127,0.15));border:1px solid rgba(67,81,232,0.3);border-radius:18px;padding:40px;text-align:center;animation:fadeInUp 0.5s ease-out 0.9s both;">
        <h2 style="margin:0 0 12px;color:var(--text-light);font-size:1.6rem;">Explorá los datos completos</h2>
        <p style="color:var(--text-muted);margin-bottom:24px;">Revisá las pestañas de análisis para ver el desglose por barrio, pliego y costos estimados.</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <button class="pill-btn" onclick="switchTab('analisis-pliego')">🏘️ Cupos por Barrio</button>
          <button class="pill-btn" onclick="switchTab('analisis-zona')">📋 Cupos por Pliego</button>
          <button class="pill-btn" onclick="switchTab('presentacion')">📊 Análisis de Rezonificación</button>
          <button class="pill-btn" onclick="switchTab('analisis-localidad')">💰 Desglose + Costos</button>
        </div>
      </div>

    </div>
  `;

  // ── Wire up del comparador (deshabilitado) ──
  if (false) {
  function renderCompareView(view) {
    const cv = document.getElementById('pqCompareView');
    const cols = (state.data && state.data.colegios) || [];
    const groups = {};
    cols.forEach(c => {
      const k = view === 'pliego' ? (c.zona_pliego || 'Sin zona') : (c.localidad || 'Sin loc.');
      if (!groups[k]) groups[k] = 0;
      groups[k]++;
    });
    const rows = Object.entries(groups).sort((a,b) => b[1] - a[1]);
    const max = Math.max(...rows.map(r => r[1]));
    const color = view === 'pliego' ? 'var(--orange)' : 'var(--green)';
    cv.innerHTML = `
      <div style="background:var(--bg-base);border:1px solid var(--glass-border);border-radius:12px;padding:20px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:14px;font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">
          <span>${view === 'pliego' ? 'Zona del Pliego' : 'Localidad'}</span>
          <span>${rows.length} grupos · ${cols.length} colegios</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;">
          ${rows.map(([k,v]) => `
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:140px;font-size:0.85rem;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${k}</div>
              <div style="flex:1;height:22px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;position:relative;">
                <div style="height:100%;width:${(v/max)*100}%;background:linear-gradient(90deg, ${color}, ${color}aa);border-radius:6px;transition:width 0.5s ease-out;"></div>
              </div>
              <div style="width:50px;text-align:right;font-family:var(--font-mono);font-weight:700;color:${color};">${v}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  renderCompareView('pliego');
  } // fin if(false)

  // ── Simulador de ahorro logístico R14 ──
  const COSTO_KM = 202;
  const KM_DIA_BASE = 1800;
  const DIAS_HABILES = 172;
  function updateSim(pct) {
    const reduccionKmDia = KM_DIA_BASE * (pct / 100);
    const ahorroDia = reduccionKmDia * COSTO_KM;
    const ahorroAnual = ahorroDia * DIAS_HABILES;
    const r = document.getElementById('pqSimResult');
    r.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-family:var(--font-mono);">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;"><span style="color:var(--text-muted)">Km ahorrados/día</span><span style="color:var(--green);font-weight:700">${reduccionKmDia.toFixed(0)} km</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;"><span style="color:var(--text-muted)">Ahorro/día</span><span style="color:var(--green);font-weight:700">${fMoney(ahorroDia)}</span></div>
        <div style="border-top:1px solid var(--glass-border);padding-top:12px;display:flex;justify-content:space-between;align-items:baseline;"><span style="color:var(--text-light);font-size:0.85rem">Ahorro anual estimado</span><span style="color:var(--green);font-size:1.6rem;font-weight:800">${fMoney(ahorroAnual)}</span></div>
      </div>
    `;
  }
  const slider = document.getElementById('pqSlider');
  const slideVal = document.getElementById('pqSlideVal');
  slider.oninput = () => {
    slideVal.textContent = slider.value + '%';
    updateSim(parseInt(slider.value));
  };
  updateSim(10);

  // ── FAQ: abrir todas por defecto ──
  document.querySelectorAll('.pq-faq-open').forEach(a => { a.style.maxHeight = a.scrollHeight + 'px'; });
  document.querySelectorAll('.pq-faq-q').forEach(q => {
    q.onclick = () => {
      const a = q.nextElementSibling;
      const icon = q.querySelector('.pq-faq-icon');
      const open = a.style.maxHeight && a.style.maxHeight !== '0px';
      if (open) {
        a.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '+';
      } else {
        a.style.maxHeight = a.scrollHeight + 'px';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '−';
      }
    };
  });
}

window.onload = () => { initMap(); loadData(); };
