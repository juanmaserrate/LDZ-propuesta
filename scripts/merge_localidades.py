"""Mergea localidades fragmentadas (Banfield Este/Oeste → Banfield, etc.)
para matchear las del repo anterior, y recalcula orden_localidad."""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")
DEPOT = (-34.8353338, -58.4233261)

# Mapping a localidad canónica (siguiendo el repo viejo)
MERGE = {
    "Banfield Este": "Banfield",
    "Banfield Oeste": "Banfield",
    "Banfield": "Banfield",
    "Lomas Centro": "Lomas Centro",
    "Lomas Oeste": "Lomas Centro",
    "Lomas Este": "Lomas Centro",
    "Temperley Este": "Temperley",
    "Temperley Oeste": "Temperley",
    "Temperley": "Temperley",
    "San José Este": "San José",
    "San José Oeste": "San José",
    "San José": "San José",
    "Llavallol Norte": "Llavallol",
    "Llavallol Sur": "Llavallol",
    "Llavallol": "Llavallol",
    "Centenario": "Villa Centenario",
    "Villa Centenario": "Villa Centenario",
    "Ingeniero Budge": "Ingeniero Budge",
    "Parque Barón": "Parque Barón",
    "Santa Marta": "Santa Marta",
    "Turdera": "Turdera",
    "Villa Albertina": "Villa Albertina",
    "Villa Fiorito": "Villa Fiorito",
    "Santa Catalina": "Santa Catalina",
    "Villa Lamadrid": "Villa Lamadrid",
    "Sin asignar": "Sin asignar",
}

def haversine(a, b):
    R = 6371.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = la2 - la1, lo2 - lo1
    h = math.sin(dlat/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(h))

with open(JSON_PATH, "r", encoding="utf-8") as f:
    d = json.load(f)

# 1. Mergear localidades
mapped = 0
for c in d["colegios"]:
    old = c.get("localidad", "Sin asignar")
    new = MERGE.get(old, old)
    if old != new:
        mapped += 1
    c["localidad"] = new

# 2. Lista canónica (excluyendo "Sin asignar")
locs = sorted(set(c["localidad"] for c in d["colegios"] if c["localidad"] != "Sin asignar"))
if any(c["localidad"] == "Sin asignar" for c in d["colegios"]):
    locs.append("Sin asignar")
d["localidades_disponibles"] = locs

# 3. Recalcular orden_localidad por nearest-neighbor desde el depot
by_loc = {}
for c in d["colegios"]:
    by_loc.setdefault(c["localidad"], []).append(c)

for loc, cols in by_loc.items():
    valid = [c for c in cols if c.get("lat") and c.get("lng")]
    remaining = list(valid)
    cur = DEPOT
    order = 1
    while remaining:
        best_i, best_d = 0, float("inf")
        for i, c in enumerate(remaining):
            dd = haversine(cur, (c["lat"], c["lng"]))
            if dd < best_d:
                best_d, best_i = dd, i
        nxt = remaining.pop(best_i)
        nxt["orden_localidad"] = order
        cur = (nxt["lat"], nxt["lng"])
        order += 1

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print(f"Mergeados: {mapped} colegios")
print(f"Localidades canónicas ({len(locs)}):")
for l in locs:
    print(f"  - {l} ({sum(1 for c in d['colegios'] if c['localidad']==l)} colegios)")
