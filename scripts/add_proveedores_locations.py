"""Geocodifica las direcciones de los proveedores y las agrega al colegios.json
como `proveedores_locations`. Usa Nominatim de OpenStreetMap."""
import json, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")

PROVEEDORES = {
    "LGE":                 "Madrid 297, Lomas de Zamora, Buenos Aires, Argentina",
    "LOGISTICA SOFIA":     "Av. Hipolito Yrigoyen 15892, Lomas de Zamora, Buenos Aires, Argentina",
    "DISTRIBUIDORA COFEX": "Uriarte 1020, Lomas de Zamora, Buenos Aires, Argentina",
    "ALVAGAMA":            "Juncal 1763, Lomas de Zamora, Buenos Aires, Argentina",
    "CENTURION":           "Lisandro de la Torre 1949, Lomas de Zamora, Buenos Aires, Argentina",
    "NEFEZ":               "Amado Nervo 326, Lomas de Zamora, Buenos Aires, Argentina",  # Panila Sur
}

def geocode(addr):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": addr, "format": "json", "limit": 1, "countrycodes": "ar",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "rezonificacion-ldz/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])

with open(JSON_PATH, "r", encoding="utf-8") as f:
    d = json.load(f)

locations = {}
for prov, addr in PROVEEDORES.items():
    print(f"Geocodificando: {prov} -> {addr}")
    try:
        lat, lng = geocode(addr)
        locations[prov] = {"lat": lat, "lng": lng, "direccion": addr}
        print(f"  OK: ({lat}, {lng})")
    except Exception as e:
        print(f"  FAIL: {e}")
        locations[prov] = {"lat": None, "lng": None, "direccion": addr}
    time.sleep(1.1)  # respetar rate limit Nominatim (1 req/s)

d["proveedores_locations"] = locations

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print("\nResumen:")
for prov, loc in locations.items():
    print(f"  {prov}: ({loc['lat']}, {loc['lng']}) - {loc['direccion']}")
