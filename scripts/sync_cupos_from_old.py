"""Sincroniza el campo `cupos` de cada colegio en `data/colegios.json`
copiandolo desde `data/colegios.js` (formato `window.appData = {...};`),
que contiene los datos correctos del sitio anterior.

Estrategia de matching (por orden de prioridad):
  1. id exacto.
  2. (numero del nombre, numero de la direccion) — robusto frente a
     prefijos distintos ("PP 49" vs "EP 49").
  3. (lat, lng) redondeados a 4 decimales (~10 m).
  4. (nombre normalizado, direccion normalizada).

Si encuentra match, copia el campo `cupos` completo del viejo encima del
actual. Reporta cuantos colegios fueron actualizados y cuantos no
encontraron match.
"""
import json
import os
import re
import unicodedata


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_PATH = os.path.join(ROOT, "data", "colegios.js")
JSON_PATH = os.path.join(ROOT, "data", "colegios.json")


def norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )
    s = re.sub(r"\s+", " ", s)
    return s


def name_num(nombre: str) -> str:
    """Primer numero del nombre (ej. 'EP 49' -> '49')."""
    m = re.search(r"\b(\d+)\b", norm(nombre))
    return m.group(1) if m else ""


def dir_num(direccion: str) -> str:
    """Primer numero de la direccion (ej. 'Llaroque 1231' -> '1231')."""
    m = re.search(r"(\d+)", norm(direccion))
    return m.group(1) if m else ""


def load_old():
    with open(JS_PATH, "r", encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r"^\s*window\.appData\s*=\s*", "", text.strip())
    text = text.rstrip(";").strip()
    return json.loads(text)


def main() -> None:
    old = load_old()
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        cur = json.load(f)

    # Indices del dataset viejo
    old_by_id = {c["id"]: c for c in old["colegios"]}
    old_by_numpair = {}
    old_by_geo = {}
    old_by_namedir = {}
    for c in old["colegios"]:
        k = (name_num(c["nombre"]), dir_num(c["direccion"]))
        if k != ("", ""):
            old_by_numpair.setdefault(k, c)
        if c.get("lat") is not None and c.get("lng") is not None:
            kg = (round(c["lat"], 4), round(c["lng"], 4))
            old_by_geo.setdefault(kg, c)
        kn = (norm(c["nombre"]), norm(c["direccion"]))
        old_by_namedir.setdefault(kn, c)

    updated_id = 0
    updated_numpair = 0
    updated_geo = 0
    updated_namedir = 0
    not_matched = []

    for c in cur["colegios"]:
        match = None
        # 1) id exacto
        if c["id"] in old_by_id:
            match = old_by_id[c["id"]]
            updated_id += 1
        else:
            # 2) (num nombre, num direccion)
            k = (name_num(c["nombre"]), dir_num(c["direccion"]))
            if k != ("", "") and k in old_by_numpair:
                match = old_by_numpair[k]
                updated_numpair += 1
            elif (
                c.get("lat") is not None
                and c.get("lng") is not None
                and (round(c["lat"], 4), round(c["lng"], 4)) in old_by_geo
            ):
                # 3) lat/lng redondeados
                match = old_by_geo[(round(c["lat"], 4), round(c["lng"], 4))]
                updated_geo += 1
            else:
                # 4) nombre normalizado + direccion normalizada
                kn = (norm(c["nombre"]), norm(c["direccion"]))
                if kn in old_by_namedir:
                    match = old_by_namedir[kn]
                    updated_namedir += 1

        if match is not None:
            c["cupos"] = dict(match["cupos"])
        else:
            not_matched.append((c["id"], c["nombre"], c["direccion"]))

    total_updated = updated_id + updated_numpair + updated_geo + updated_namedir
    print(f"Total colegios en JSON actual : {len(cur['colegios'])}")
    print(f"Total colegios en JS viejo    : {len(old['colegios'])}")
    print(f"Match por id exacto           : {updated_id}")
    print(f"Match por (num nombre, num dir): {updated_numpair}")
    print(f"Match por lat/lng (~10 m)     : {updated_geo}")
    print(f"Match por nombre+direccion    : {updated_namedir}")
    print(f"Total actualizados            : {total_updated}")
    print(f"Sin match (cupos preservados) : {len(not_matched)}")
    if not_matched:
        print("\nWarnings — no se encontro match para:")
        for nid, nom, dirx in not_matched:
            print(f"  - {nid:<14} {nom:<14} {dirx}")

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    print(f"\nGuardado: {JSON_PATH}")


if __name__ == "__main__":
    main()
