# -*- coding: utf-8 -*-
"""
Normaliza el campo `localidad` de data/colegios.json.

- Mapea typos / variantes a un set canónico (~20 barrios).
- Si el valor original es vacío, "#N/A" o claramente no es una localidad
  (ej. una direccion como "BENITO PEREZ GALDO 1004"), intenta inferir desde
  la direccion si menciona alguna localidad conocida; si no, deja
  "Sin asignar".
- Agrega top-level `localidades_disponibles` con la lista ordenada de las
  localidades canonicas presentes (con "Sin asignar" siempre al final si
  hay).
"""
import json
import os
import re
import unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(REPO, "data", "colegios.json")


def _strip_accents(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _norm(s):
    if s is None:
        return ""
    return _strip_accents(str(s)).strip().lower()


# Reglas en orden de prioridad. La primera que matchee gana.
# Cada regla: (predicate_fn, canonical_value)
def _build_rules():
    def has(*subs):
        def f(t):
            return any(sub in t for sub in subs)
        return f

    def exact(*vals):
        def f(t):
            return t in vals
        return f

    rules = [
        # FIORITO
        (has("fiorito"), "Villa Fiorito"),
        # INGENIERO BUDGE
        (has("ing. budge", "ingeniero budge", "ing budge"), "Ingeniero Budge"),
        (has("budge"), "Ingeniero Budge"),
        # SANTA CATALINA
        (has("santa catalina"), "Santa Catalina"),
        # VILLA ALBERTINA
        (has("villa albertina"), "Villa Albertina"),
        (has("albertina"), "Villa Albertina"),
        # CENTENARIO / VILLA CENTENARIO
        (has("villa centenario"), "Villa Centenario"),
        (exact("centenario"), "Villa Centenario"),
        (has("centenario"), "Villa Centenario"),
        # PARQUE BARON
        (has("parque baron"), "Parque Barón"),
        # SANTA MARTA
        (has("santa marta"), "Santa Marta"),
        # VILLA LAMADRID
        (has("villa lamadrid"), "Villa Lamadrid"),
        (has("lamadrid"), "Villa Lamadrid"),
        # LOMAS (orden importante: especificos primero)
        (has("lomas centro"), "Lomas Centro"),
        (has("lomas oeste"), "Lomas Oeste"),
        (has("lomas este"), "Lomas Este"),
        (has("lomas de zamora"), "Lomas Centro"),
        (exact("lomas"), "Lomas Centro"),
        # BANFIELD (especificos primero)
        (has("banfield este"), "Banfield Este"),
        (has("banfield oeste"), "Banfield Oeste"),
        (has("bandfield"), "Banfield Este"),
        (has("banfield"), "Banfield Este"),
        # TEMPERLEY (especificos primero)
        (has("temperley este"), "Temperley Este"),
        (has("temperley oeste"), "Temperley Oeste"),
        (has("temperley"), "Temperley Este"),
        # TURDERA
        (has("turdera"), "Turdera"),
        # LLAVALLOL (especificos primero)
        (has("llavallol norte"), "Llavallol Norte"),
        (has("llavallol sur"), "Llavallol Sur"),
        (has("llavallol"), "Llavallol Sur"),
        # SAN JOSE (especificos primero)
        (has("san jose este"), "San José Este"),
        (has("san jose oeste"), "San José Oeste"),
        (has("san jose"), "San José Este"),
    ]
    return rules


RULES = _build_rules()


def normalize_value(raw_localidad, direccion=""):
    """Devuelve la localidad canonica para el valor crudo dado.

    Si raw_localidad esta vacio, "#N/A" o no matchea ninguna regla,
    intenta inferir desde `direccion`. Si tampoco matchea, devuelve
    "Sin asignar".
    """
    src = (raw_localidad or "").strip()
    src_norm = _norm(src)

    # Casos vacios / NA / tipicos basura
    is_empty = (not src) or src_norm in ("", "#n/a", "n/a", "na", "-", "—")
    # Heuristica: si parece una direccion (contiene un numero al final tipo
    # "PARIS 1755" o "BENITO PEREZ GALDO 1004") la tratamos como invalida
    looks_like_address = bool(re.search(r"\d{2,}\s*$", src.strip()))

    if not is_empty and not looks_like_address:
        for pred, canon in RULES:
            if pred(src_norm):
                return canon

    # Fallback: inferir desde direccion
    dir_norm = _norm(direccion)
    if dir_norm:
        for pred, canon in RULES:
            if pred(dir_norm):
                return canon

    return "Sin asignar"


def main():
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    colegios = data.get("colegios", [])
    cambios = 0
    contadores = {}

    for c in colegios:
        original = c.get("localidad", "")
        canon = normalize_value(original, c.get("direccion", ""))
        if canon != original:
            cambios += 1
        c["localidad"] = canon
        contadores[canon] = contadores.get(canon, 0) + 1

    # Lista ordenada: alfabetica, con "Sin asignar" al final si existe
    todas = sorted([k for k in contadores.keys() if k != "Sin asignar"])
    if "Sin asignar" in contadores:
        todas.append("Sin asignar")

    data["localidades_disponibles"] = todas

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("Total colegios:", len(colegios))
    print("Cambios aplicados:", cambios)
    print("Localidades canonicas (%d):" % len(todas))
    for k in todas:
        print("  %-20s -> %d" % (k, contadores[k]))


if __name__ == "__main__":
    main()
