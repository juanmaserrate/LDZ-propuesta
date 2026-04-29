# -*- coding: utf-8 -*-
"""
Asigna `orden_pliego` y `orden_localidad` a cada colegio en data/colegios.json.

- Para cada Zona N (zona_pliego), ordena los colegios por nearest-neighbor
  desde el depot (Burzaco). El primero que se visita queda con orden 1.
- Para cada localidad, mismo nearest-neighbor desde el depot.
- Sobrescribe el JSON in-place.
"""
import json
import math
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(REPO, "data", "colegios.json")

DEPOT = {"lat": -34.8353338, "lng": -58.4233261}


def haversine(a, b):
    """Distancia en metros entre dos puntos {lat,lng}."""
    R = 6371000.0
    la1 = math.radians(a["lat"])
    la2 = math.radians(b["lat"])
    dlat = math.radians(b["lat"] - a["lat"])
    dlng = math.radians(b["lng"] - a["lng"])
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def nearest_neighbor_order(items, start):
    """Devuelve los items en orden greedy nearest-neighbor empezando en `start`.
    Cada item debe tener lat/lng. No muta los items."""
    remaining = [i for i in items if i.get("lat") and i.get("lng")]
    ordered = []
    cur = {"lat": start["lat"], "lng": start["lng"]}
    while remaining:
        best_idx = 0
        best_d = float("inf")
        for i, it in enumerate(remaining):
            d = haversine(cur, it)
            if d < best_d:
                best_d = d
                best_idx = i
        nxt = remaining.pop(best_idx)
        ordered.append(nxt)
        cur = {"lat": nxt["lat"], "lng": nxt["lng"]}
    return ordered


def main():
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    colegios = data.get("colegios", [])

    # Indice por id para escritura rapida
    by_id = {c.get("id"): c for c in colegios if c.get("id")}

    # 1) orden_pliego: por cada Zona N
    grupos_zona = {}
    for c in colegios:
        z = c.get("zona") or c.get("zona_pliego")
        if not z:
            continue
        grupos_zona.setdefault(z, []).append(c)

    n_pliego = 0
    for z, items in grupos_zona.items():
        ordered = nearest_neighbor_order(items, DEPOT)
        for idx, it in enumerate(ordered, start=1):
            it["orden_pliego"] = idx
            n_pliego += 1
        # marcar 0 (o saltear) los sin coords
        for it in items:
            if "orden_pliego" not in it:
                it["orden_pliego"] = 0

    # 2) orden_localidad: por cada localidad (excepto vacia/Sin asignar mantiene 0)
    grupos_loc = {}
    for c in colegios:
        loc = c.get("localidad")
        if not loc:
            continue
        grupos_loc.setdefault(loc, []).append(c)

    n_loc = 0
    for loc, items in grupos_loc.items():
        ordered = nearest_neighbor_order(items, DEPOT)
        for idx, it in enumerate(ordered, start=1):
            it["orden_localidad"] = idx
            n_loc += 1
        for it in items:
            if "orden_localidad" not in it:
                it["orden_localidad"] = 0

    # Asegurar default 0 para los que quedaron sin asignar
    for c in colegios:
        c.setdefault("orden_pliego", 0)
        c.setdefault("orden_localidad", 0)

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("OK")
    print("  orden_pliego asignados   :", n_pliego)
    print("  orden_localidad asignados:", n_loc)
    print("  total colegios           :", len(colegios))
    print("  zonas                    :", len(grupos_zona))
    print("  localidades              :", len(grupos_loc))


if __name__ == "__main__":
    main()
