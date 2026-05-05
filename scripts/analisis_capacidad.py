"""Analiza la carga operativa de cada proveedor en el escenario de la propuesta
(reasignación al proveedor más cercano).

Calcula por proveedor:
- Cantidad de escuelas asignadas
- Cupos totales (DM + COM)
- Matrícula total
- Distancia promedio, mediana y máxima a sus escuelas
- Escuelas a >3 km (lejanas)
- Tiempo estimado de jornada (velocidad urbana + tiempo de entrega)
- Carga relativa (% del total)
- Sobrecarga: si la jornada estimada supera las 8 horas

Identifica también las escuelas que quedan más lejos de cualquier proveedor
para sugerir dónde ubicar 1-2 hubs adicionales.

Resultado se guarda en colegios.json bajo `analisis_capacidad`.
"""
import json, math, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")

URBAN_FACTOR = 1.35     # haversine -> km por calle
ROUND_TRIP = 2.0        # ida + vuelta
VELOCIDAD_KMH = 22      # velocidad urbana promedio
MIN_POR_ENTREGA = 6     # minutos de descarga + handoff por escuela
HORAS_JORNADA_OBJETIVO = 8  # techo razonable
DIST_LEJANA_KM = 3.0    # umbral "escuela lejana"
DIAS_HABILES = 172
COSTO_KM = 202

def haversine(a, b):
    R = 6371.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = la2 - la1, lo2 - lo1
    h = math.sin(dlat/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(h))

with open(JSON_PATH, "r", encoding="utf-8") as f:
    d = json.load(f)

provedores = {k: v for k, v in d.get("proveedores_locations", {}).items()
              if v.get("lat") is not None}
escuelas = [s for s in d["colegios"] if s.get("lat") and s.get("lng")]

# Asignar cada escuela según el PLIEGO VIGENTE: el proveedor que le toca por zona
prov_by_zone = d.get("proveedores_por_zona", {})
escuelas_asignadas = []  # cada item: (escuela, prov_name, distancia_km_lin)
sin_asignar = 0
for s in escuelas:
    zona = s.get("zona") or s.get("zona_pliego")
    prov_name = prov_by_zone.get(zona)
    if not prov_name or prov_name not in provedores:
        sin_asignar += 1
        continue
    p = provedores[prov_name]
    dist = haversine((p["lat"], p["lng"]), (s["lat"], s["lng"]))
    escuelas_asignadas.append((s, prov_name, dist))
print(f"Escuelas sin asignación válida en el pliego: {sin_asignar}")

# Agrupar por proveedor
by_prov = defaultdict(list)
for tup in escuelas_asignadas:
    by_prov[tup[1]].append(tup)

# Métricas por proveedor
analisis = []
total_escuelas = len(escuelas_asignadas)
total_cupos_global = sum(((s.get("cupos") or {}).get("dm", 0) + (s.get("cupos") or {}).get("com", 0))
                          for s, _, _ in escuelas_asignadas)

for prov_name, items in by_prov.items():
    n = len(items)
    dists_lin = sorted(d_lin for _, _, d_lin in items)
    dists_km = [d_lin * URBAN_FACTOR for d_lin in dists_lin]
    cupos_dm = sum((s.get("cupos") or {}).get("dm", 0) for s, _, _ in items)
    cupos_com = sum((s.get("cupos") or {}).get("com", 0) for s, _, _ in items)
    cupos_total = cupos_dm + cupos_com
    matricula = sum(s.get("matricula", 0) for s, _, _ in items)
    lejanas = sum(1 for d in dists_km if d > DIST_LEJANA_KM)

    # Tiempo estimado: km totales (con factor urbano y round-trip) / velocidad + entregas
    km_totales_dia = sum(d_lin * URBAN_FACTOR * ROUND_TRIP for d_lin in dists_lin)
    horas_recorrido = km_totales_dia / VELOCIDAD_KMH
    horas_entregas = (n * MIN_POR_ENTREGA) / 60.0
    horas_totales = horas_recorrido + horas_entregas

    sobrecargado = horas_totales > HORAS_JORNADA_OBJETIVO

    def median_v(xs):
        if not xs: return 0
        xs = sorted(xs); n2 = len(xs)
        return xs[n2//2] if n2%2 else (xs[n2//2-1]+xs[n2//2])/2

    analisis.append({
        "proveedor": prov_name,
        "escuelas": n,
        "porcentaje_escuelas": round(n / total_escuelas * 100, 1),
        "cupos_dm": cupos_dm,
        "cupos_com": cupos_com,
        "cupos_total": cupos_total,
        "porcentaje_cupos": round(cupos_total / total_cupos_global * 100, 1) if total_cupos_global else 0,
        "matricula": matricula,
        "distancia_km_promedio": round(sum(dists_km)/len(dists_km), 2) if dists_km else 0,
        "distancia_km_mediana": round(median_v(dists_km), 2),
        "distancia_km_max": round(max(dists_km), 2) if dists_km else 0,
        "escuelas_lejanas_3km": lejanas,
        "km_dia": round(km_totales_dia, 1),
        "horas_jornada_est": round(horas_totales, 2),
        "sobrecargado": sobrecargado,
    })

analisis.sort(key=lambda x: -x["escuelas"])

# Identificar escuelas que aún quedan lejos (>3 km del proveedor más cercano)
escuelas_lejanas = [(s, prov, dist*URBAN_FACTOR) for s, prov, dist in escuelas_asignadas if dist*URBAN_FACTOR > DIST_LEJANA_KM]
escuelas_lejanas.sort(key=lambda x: -x[2])

# Sugerir nuevos hubs: si hay un cluster de escuelas lejanas, su centroide es el hub
# Para simplificar, calculamos centroide de las top-30 escuelas más lejanas
top_lejanas = escuelas_lejanas[:30]
if top_lejanas:
    cx = sum(s["lat"] for s, _, _ in top_lejanas) / len(top_lejanas)
    cy = sum(s["lng"] for s, _, _ in top_lejanas) / len(top_lejanas)
    hub_sugerido = {
        "lat": round(cx, 6),
        "lng": round(cy, 6),
        "n_escuelas_servidas_potenciales": len(top_lejanas),
        "ahorro_potencial_km_dia": round(sum(d for _, _, d in top_lejanas) * 2 * 0.6, 1),  # 60% reducción
    }
else:
    hub_sugerido = None

# Resumen general
total_km_dia = sum(a["km_dia"] for a in analisis)
total_horas = sum(a["horas_jornada_est"] for a in analisis)
proveedores_sobrecargados = [a for a in analisis if a["sobrecargado"]]

resultado = {
    "total_escuelas": total_escuelas,
    "total_proveedores": len(analisis),
    "total_km_dia": round(total_km_dia, 1),
    "total_horas_jornada": round(total_horas, 1),
    "proveedores": analisis,
    "proveedores_sobrecargados": [a["proveedor"] for a in proveedores_sobrecargados],
    "n_escuelas_lejanas_total": len(escuelas_lejanas),
    "hub_adicional_sugerido": hub_sugerido,
    "supuestos": {
        "velocidad_kmh": VELOCIDAD_KMH,
        "min_por_entrega": MIN_POR_ENTREGA,
        "horas_jornada_objetivo": HORAS_JORNADA_OBJETIVO,
        "dist_lejana_km": DIST_LEJANA_KM,
        "factor_urbano": URBAN_FACTOR,
    },
}

d["analisis_capacidad"] = resultado

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

# Imprimir reporte
print("="*70)
print("ANÁLISIS DE CAPACIDAD POR PROVEEDOR (escenario propuesta)")
print("="*70)
for a in analisis:
    flag = " ⚠️ SOBRECARGADO" if a["sobrecargado"] else ""
    print(f"\n{a['proveedor']}{flag}")
    print(f"  Escuelas: {a['escuelas']} ({a['porcentaje_escuelas']}%)  Cupos: {a['cupos_total']:,}  Matrícula: {a['matricula']:,}")
    print(f"  Distancia avg/med/max: {a['distancia_km_promedio']:.2f} / {a['distancia_km_mediana']:.2f} / {a['distancia_km_max']:.2f} km")
    print(f"  Escuelas a >3 km: {a['escuelas_lejanas_3km']}")
    print(f"  Km/día: {a['km_dia']:.0f}  Horas estimadas: {a['horas_jornada_est']:.1f}h")

print("\n" + "="*70)
print(f"Proveedores sobrecargados: {len(proveedores_sobrecargados)}")
print(f"Escuelas a >3km del proveedor más cercano: {len(escuelas_lejanas)}")
if hub_sugerido:
    print(f"Hub sugerido: ({hub_sugerido['lat']}, {hub_sugerido['lng']})")
    print(f"  Cubriría hasta {hub_sugerido['n_escuelas_servidas_potenciales']} escuelas hoy lejanas")
