"""Calcula el ahorro real de km/día entre el pliego actual y la propuesta
(reasignar cada escuela al proveedor más cercano).

Usa distancia haversine (línea recta) entre las coordenadas. Para urbano la
distancia real por calle es ~1.35× la haversine; aplicamos ese factor para
aproximar el km real.

Guarda los resultados en `data/colegios.json` bajo `simulador_ahorro`.
"""
import json, math, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")

# Factor de corrección haversine → km por calle (urbano)
URBAN_FACTOR = 1.35
# Asumimos 1 viaje por día por escuela (ida + vuelta al proveedor)
# Cada vianda viaja desde el proveedor a la escuela y la camioneta vuelve vacía
ROUND_TRIP = 2.0
DIAS_HABILES = 172
COSTO_KM = 202  # ARS/km de referencia (combustible + mantenimiento + conductor pro-rateado)

def haversine_km(a, b):
    R = 6371.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = la2 - la1, lo2 - lo1
    h = math.sin(dlat/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(h))

with open(JSON_PATH, "r", encoding="utf-8") as f:
    d = json.load(f)

provedores = d.get("proveedores_locations", {})
prov_by_zone = d.get("proveedores_por_zona", {})
escuelas = d["colegios"]

# Filtramos escuelas con coordenadas y zona válidas
escuelas_validas = [s for s in escuelas if s.get("lat") and s.get("lng")]
print(f"Escuelas con coordenadas: {len(escuelas_validas)} de {len(escuelas)}")
print(f"Proveedores: {len(provedores)}")

# Escenario A — Pliego actual: cada escuela usa el proveedor de su zona
km_actual_total = 0
escuelas_actual_count = 0
for s in escuelas_validas:
    zona = s.get("zona") or s.get("zona_pliego")
    prov_name = prov_by_zone.get(zona)
    prov = provedores.get(prov_name)
    if not prov or prov.get("lat") is None:
        continue
    d_lin = haversine_km((prov["lat"], prov["lng"]), (s["lat"], s["lng"]))
    km_actual_total += d_lin * URBAN_FACTOR * ROUND_TRIP
    escuelas_actual_count += 1

# Escenario B — Propuesta: cada escuela usa el proveedor más cercano
km_propuesta_total = 0
asignaciones_propuesta = defaultdict(int)
prov_items = [(name, p) for name, p in provedores.items()
              if p.get("lat") is not None and p.get("lng") is not None]

for s in escuelas_validas:
    if not prov_items:
        continue
    best_name, best_dist = None, float("inf")
    for name, p in prov_items:
        d_lin = haversine_km((p["lat"], p["lng"]), (s["lat"], s["lng"]))
        if d_lin < best_dist:
            best_dist, best_name = d_lin, name
    km_propuesta_total += best_dist * URBAN_FACTOR * ROUND_TRIP
    asignaciones_propuesta[best_name] += 1

ahorro_km_dia = km_actual_total - km_propuesta_total
ahorro_pct = (ahorro_km_dia / km_actual_total * 100) if km_actual_total > 0 else 0

# Guardar resumen en el JSON para que el front lo lea
d["simulador_ahorro"] = {
    "metodologia": "Distancia haversine proveedor↔escuela × 1.35 (factor urbano) × 2 (ida+vuelta)",
    "supuestos": {
        "factor_urbano": URBAN_FACTOR,
        "round_trip": ROUND_TRIP,
        "dias_habiles": DIAS_HABILES,
        "costo_km_ars": COSTO_KM,
    },
    "escuelas_consideradas": escuelas_actual_count,
    "km_dia_actual": round(km_actual_total, 1),
    "km_dia_propuesta": round(km_propuesta_total, 1),
    "ahorro_km_dia": round(ahorro_km_dia, 1),
    "ahorro_pct": round(ahorro_pct, 2),
    "ahorro_anual_ars": round(ahorro_km_dia * COSTO_KM * DIAS_HABILES),
    "asignaciones_propuesta": dict(asignaciones_propuesta),
}

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print()
print("=" * 56)
print(f"Pliego actual:    {km_actual_total:>10.1f} km/día")
print(f"Propuesta:        {km_propuesta_total:>10.1f} km/día")
print(f"Ahorro absoluto:  {ahorro_km_dia:>10.1f} km/día")
print(f"Ahorro %:         {ahorro_pct:>10.2f}%")
print(f"Ahorro anual:     ${ahorro_km_dia * COSTO_KM * DIAS_HABILES:>14,.0f}")
print("=" * 56)
print("Asignaciones por proveedor (propuesta):")
for prov, n in sorted(asignaciones_propuesta.items(), key=lambda x: -x[1]):
    print(f"  {prov}: {n} escuelas")
