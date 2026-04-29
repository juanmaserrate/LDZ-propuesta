"""Reubica colegios cuyas coordenadas estén lejos del centroide de su
localidad asignada. Usa centroide mediano (robusto a outliers) y mueve
los que estén a >2 km, agregando un jitter pequeño para no superponer."""
import json, math, os, random
random.seed(42)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")
DEPOT = (-34.8353338, -58.4233261)
THRESH_KM = 2.0  # más de esto se reubica

def hav(a, b):
    R=6371; la1,lo1=math.radians(a[0]),math.radians(a[1]); la2,lo2=math.radians(b[0]),math.radians(b[1])
    return 2*R*math.asin(math.sqrt(math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2))

def median(xs):
    s = sorted(xs); n = len(s)
    return s[n//2] if n%2 else (s[n//2-1]+s[n//2])/2

with open(JSON_PATH, "r", encoding="utf-8") as f:
    d = json.load(f)

# Centroide mediano por localidad usando solo los puntos densos (eliminando los más lejanos del cluster)
from collections import defaultdict
loc_pts = defaultdict(list)
for c in d["colegios"]:
    if c.get("lat") and c.get("lng") and c.get("localidad") and c["localidad"] != "Sin asignar":
        loc_pts[c["localidad"]].append(c)

# Calcular centroide robusto: mediana de lat y lng, pero filtrando puntos con outliers iterativamente
centroids = {}
for loc, pts in loc_pts.items():
    if len(pts) < 3:
        centroids[loc] = (median([p["lat"] for p in pts]), median([p["lng"] for p in pts]))
        continue
    # Iterate: median, drop top 20% farthest, recompute
    cx, cy = median([p["lat"] for p in pts]), median([p["lng"] for p in pts])
    dists = sorted([(hav((cx,cy),(p["lat"],p["lng"])), p) for p in pts], key=lambda x: x[0])
    keep = [p for _, p in dists[:int(len(dists)*0.8) or 1]]
    cx2, cy2 = median([p["lat"] for p in keep]), median([p["lng"] for p in keep])
    centroids[loc] = (cx2, cy2)

# Reubicar outliers
moved = 0
for c in d["colegios"]:
    if not c.get("lat") or not c.get("lng"): continue
    loc = c.get("localidad")
    if not loc or loc == "Sin asignar" or loc not in centroids: continue
    cx, cy = centroids[loc]
    dist = hav((cx, cy), (c["lat"], c["lng"]))
    if dist > THRESH_KM:
        # Jitter ~150-250m radial random angle
        ang = random.uniform(0, 2*math.pi)
        rad = random.uniform(0.001, 0.0025)  # ~110-275m
        c["lat"] = round(cx + math.cos(ang)*rad, 7)
        c["lng"] = round(cy + math.sin(ang)*rad, 7)
        c["coord_realocada"] = True
        moved += 1

# Recalcular orden_localidad
def nn_order(items, start):
    rem = list(items); cur = start; order = 1
    while rem:
        best_i, best_d = 0, float("inf")
        for i, it in enumerate(rem):
            dd = hav(cur, (it["lat"], it["lng"]))
            if dd < best_d: best_d, best_i = dd, i
        nxt = rem.pop(best_i)
        nxt["orden_localidad"] = order
        cur = (nxt["lat"], nxt["lng"])
        order += 1

by_loc = defaultdict(list)
for c in d["colegios"]:
    if c.get("lat") and c.get("lng"):
        by_loc[c["localidad"]].append(c)
for loc, items in by_loc.items():
    nn_order(items, DEPOT)

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print(f"Reubicados: {moved} colegios outliers (>{THRESH_KM} km del centroide robusto)")
print(f"Centroides usados:")
for loc, (cx, cy) in sorted(centroids.items()):
    print(f"  {loc}: ({cx:.5f}, {cy:.5f})")
