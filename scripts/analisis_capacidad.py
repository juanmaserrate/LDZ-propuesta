"""Análisis combinado A + B sobre el PLIEGO VIGENTE:

A) Eficiencia geográfica del pliego: % de escuelas con su proveedor óptimo
   (el más cercano de los 6) y km/día evitables.

B) Dispersión geográfica por proveedor: distancia promedio/mediana/máxima a
   sus escuelas, radio del 80% (área natural) y escuelas fuera de esa área.

Resultado en colegios.json bajo `analisis_capacidad`.
"""
import json, math, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")

URBAN_FACTOR = 1.35     # haversine -> km por calle
ROUND_TRIP = 2.0
DIAS_HABILES = 172
COSTO_KM = 202

def haversine(a, b):
    R = 6371.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = la2 - la1, lo2 - lo1
    h = math.sin(dlat/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(h))

def percentile(xs, p):
    if not xs: return 0
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    if f == c: return xs[int(k)]
    return xs[f] * (c - k) + xs[c] * (k - f)

with open(JSON_PATH, "r", encoding="utf-8") as f:
    d = json.load(f)

provedores = {k: v for k, v in d.get("proveedores_locations", {}).items()
              if v.get("lat") is not None}
prov_by_zone = d.get("proveedores_por_zona", {})
escuelas = [s for s in d["colegios"] if s.get("lat") and s.get("lng")]

# Para cada escuela: distancia al proveedor del pliego y al más cercano disponible
detalle = []  # cada item: {school, prov_pliego, dist_pliego_km, prov_optimo, dist_optimo_km, optimo}
sin_asignar = 0

for s in escuelas:
    zona = s.get("zona") or s.get("zona_pliego")
    prov_pliego_name = prov_by_zone.get(zona)
    if not prov_pliego_name or prov_pliego_name not in provedores:
        sin_asignar += 1
        continue

    p_pliego = provedores[prov_pliego_name]
    dist_pliego = haversine((p_pliego["lat"], p_pliego["lng"]), (s["lat"], s["lng"])) * URBAN_FACTOR

    # Proveedor más cercano (óptimo)
    best_name, best_dist = None, float("inf")
    for name, p in provedores.items():
        d_lin = haversine((p["lat"], p["lng"]), (s["lat"], s["lng"])) * URBAN_FACTOR
        if d_lin < best_dist:
            best_dist, best_name = d_lin, name

    detalle.append({
        "id": s.get("id"),
        "prov_pliego": prov_pliego_name,
        "dist_pliego_km": round(dist_pliego, 3),
        "prov_optimo": best_name,
        "dist_optimo_km": round(best_dist, 3),
        "optimo": (prov_pliego_name == best_name),
        "km_extra_dia": round(max(0, dist_pliego - best_dist) * ROUND_TRIP, 3),
    })

total = len(detalle)
optimos = sum(1 for x in detalle if x["optimo"])
no_optimos = total - optimos
eficiencia_pct = round(optimos / total * 100, 1) if total else 0
km_extra_dia_total = round(sum(x["km_extra_dia"] for x in detalle), 1)
ahorro_anual_potencial = round(km_extra_dia_total * COSTO_KM * DIAS_HABILES)

# Dispersión por proveedor (escenario PLIEGO VIGENTE — escuelas que le toca hoy)
disp_by_prov = defaultdict(list)  # prov_name -> [dist_km, ...]
escuelas_por_prov = defaultdict(int)
cupos_por_prov = defaultdict(lambda: {"dm": 0, "com": 0, "matricula": 0})

# Necesitamos las escuelas con el detalle completo, no solo distancia
escuelas_por_prov_full = defaultdict(list)
for s in escuelas:
    zona = s.get("zona") or s.get("zona_pliego")
    prov_name = prov_by_zone.get(zona)
    if not prov_name or prov_name not in provedores:
        continue
    p = provedores[prov_name]
    dist_km = haversine((p["lat"], p["lng"]), (s["lat"], s["lng"])) * URBAN_FACTOR
    disp_by_prov[prov_name].append(dist_km)
    escuelas_por_prov[prov_name] += 1
    c = s.get("cupos") or {}
    cupos_por_prov[prov_name]["dm"] += c.get("dm", 0) or c.get("modulos", 0)
    cupos_por_prov[prov_name]["com"] += c.get("com", 0) or c.get("comedor", 0)
    cupos_por_prov[prov_name]["matricula"] += s.get("matricula", 0)

proveedores_analisis = []
for prov_name, dists in disp_by_prov.items():
    if not dists: continue
    p_loc = provedores[prov_name]
    dist_avg = sum(dists) / len(dists)
    dist_med = percentile(dists, 0.5)
    dist_max = max(dists)
    radio_80 = percentile(dists, 0.8)  # 80% de las escuelas están dentro de este radio
    fuera_area = sum(1 for d in dists if d > radio_80)
    cupos_t = cupos_por_prov[prov_name]
    proveedores_analisis.append({
        "proveedor": prov_name,
        "direccion": p_loc.get("direccion", ""),
        "lat": p_loc["lat"],
        "lng": p_loc["lng"],
        "escuelas": len(dists),
        "porcentaje_escuelas": round(len(dists) / total * 100, 1) if total else 0,
        "dist_avg_km": round(dist_avg, 2),
        "dist_med_km": round(dist_med, 2),
        "dist_max_km": round(dist_max, 2),
        "radio_natural_km": round(radio_80, 2),
        "escuelas_fuera_area": fuera_area,
        "concentrado": dist_max <= 3.0,  # todas dentro de 3 km = bien concentrado
        "disperso": dist_max > 6.0,      # alguna a más de 6 km = muy disperso
        "cupos_dm": cupos_t["dm"],
        "cupos_com": cupos_t["com"],
        "cupos_total": cupos_t["dm"] + cupos_t["com"],
        "matricula": cupos_t["matricula"],
    })

proveedores_analisis.sort(key=lambda x: -x["escuelas"])

# Resumen global
total_km_optimo = round(sum(x["dist_optimo_km"] for x in detalle) * ROUND_TRIP, 1)
total_km_pliego = round(sum(x["dist_pliego_km"] for x in detalle) * ROUND_TRIP, 1)

resultado = {
    "metodologia": "Distancia haversine × 1.35 (factor calle urbana). Eficiencia = % escuelas asignadas al proveedor más cercano disponible.",
    "total_escuelas": total,
    "total_proveedores": len(provedores),
    # Bloque A — eficiencia del pliego
    "eficiencia": {
        "escuelas_optimas": optimos,
        "escuelas_subóptimas": no_optimos,
        "eficiencia_pct": eficiencia_pct,
        "ineficiencia_pct": round(100 - eficiencia_pct, 1),
        "km_extra_dia": km_extra_dia_total,
        "km_pliego_dia": total_km_pliego,
        "km_optimo_dia": total_km_optimo,
        "ahorro_anual_potencial_ars": ahorro_anual_potencial,
    },
    # Bloque B — dispersión por proveedor
    "proveedores": proveedores_analisis,
    "supuestos": {
        "factor_urbano": URBAN_FACTOR,
        "round_trip": ROUND_TRIP,
        "dias_habiles": DIAS_HABILES,
        "costo_km_ars": COSTO_KM,
    },
}

d["analisis_capacidad"] = resultado

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print("="*70)
print(f"EFICIENCIA DEL PLIEGO VIGENTE")
print(f"  Escuelas: {total}")
print(f"  Asignadas al optimo: {optimos} ({eficiencia_pct}%)")
print(f"  Subptimas: {no_optimos} ({round(100-eficiencia_pct,1)}%)")
print(f"  Km extra/dia recorridos: {km_extra_dia_total} km")
print(f"  Ahorro anual potencial: ${ahorro_anual_potencial:,}")
print("")
print("DISPERSION GEOGRAFICA POR PROVEEDOR")
print("="*70)
for p in proveedores_analisis:
    tag = "CONCENTRADO" if p["concentrado"] else ("DISPERSO" if p["disperso"] else "MIXTO")
    print(f"  {p['proveedor']:22} {p['escuelas']:>4} esc | avg {p['dist_avg_km']:>5.2f} med {p['dist_med_km']:>5.2f} max {p['dist_max_km']:>5.2f} km | radio80%={p['radio_natural_km']:>5.2f} | {tag}")
