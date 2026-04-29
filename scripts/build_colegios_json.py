# -*- coding: utf-8 -*-
"""
Construye data/colegios.json a partir del Excel zonas_pliego.xlsx (sheet MARZO).

- Matchea con data/colegios_old.json por nombre+direccion (normalizados) para reusar lat/lng.
- Si no matchea, usa centroide aproximado de la localidad + jitter random.
- Mantiene aliases cupos.modulos / cupos.dmc / cupos.comedor para compatibilidad.
"""
import json
import os
import re
import random
import unicodedata
import openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(REPO, "zonas_pliego.xlsx")
OLD_JSON = os.path.join(REPO, "data", "colegios_old.json")
OUT_JSON = os.path.join(REPO, "data", "colegios.json")

PROVEEDORES_POR_ZONA = {
    "Zona 1": "ALVAGAMA",
    "Zona 2": "ALVAGAMA",
    "Zona 3": "DISTRIBUIDORA COFEX",
    "Zona 4": "LOGISTICA SOFIA",
    "Zona 5": "DISTRIBUIDORA COFEX",
    "Zona 6": "NEFEZ",
    "Zona 7": "LOGISTICA SOFIA",
    "Zona 8": "CENTURION",
    "Zona 9": "LGE",
    "Zona 10": "LOGISTICA SOFIA",
    "Zona 11": "LOGISTICA SOFIA",
    "Zona 12": "NEFEZ",
}

# Centroides aproximados por localidad (Lomas de Zamora)
LOCALIDAD_COORDS = {
    "banfield": (-34.7440, -58.3980),
    "banfield oeste": (-34.7440, -58.3980),
    "banfield este": (-34.7440, -58.3980),
    "lomas": (-34.7600, -58.4070),
    "lomas centro": (-34.7600, -58.4070),
    "lomas oeste": (-34.7600, -58.4070),
    "lomas este": (-34.7600, -58.4070),
    "lomas de zamora": (-34.7600, -58.4070),
    "temperley": (-34.7720, -58.3970),
    "temperley oeste": (-34.7720, -58.3970),
    "temperley este": (-34.7720, -58.3970),
    "turdera": (-34.7820, -58.4070),
    "llavallol": (-34.7880, -58.4220),
    "villa albertina": (-34.7530, -58.4420),
    "albertina": (-34.7530, -58.4420),
    "ingeniero budge": (-34.7300, -58.4570),
    "budge": (-34.7300, -58.4570),
    "villa fiorito": (-34.7000, -58.4540),
    "fiorito": (-34.7000, -58.4540),
    "villa centenario": (-34.7400, -58.4350),
    "centenario": (-34.7400, -58.4350),
    "villa caraza": (-34.7180, -58.4380),
    "caraza": (-34.7180, -58.4380),
    "santa catalina": (-34.8000, -58.4400),
    "parque barreiro": (-34.7700, -58.4350),
    "san jose": (-34.7720, -58.3870),
}
FALLBACK_COORD = (-34.7600, -58.4070)


def norm(s):
    if s is None:
        return ""
    s = str(s).strip().lower()
    # quitar acentos
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    # colapsar espacios y signos
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# El JSON viejo usa siglas viejas (PP, MS, EE, MT, JI CC).
# El Excel usa siglas nuevas (EP, ES, EEE, ET, JC). Mapear para que matchee.
NAME_REMAP = [
    (r"^ep\s+(\d+)$", r"pp \1"),       # EP -> PP
    (r"^es\s+(\d+)$", r"ms \1"),       # ES -> MS
    (r"^eee\s+(\d+)$", r"ee \1"),      # EEE -> EE
    (r"^et\s+(\d+)$", r"mt \1"),       # ET -> MT
    (r"^jc\s+(\d+)$", r"ji cc \1"),    # JC -> JI CC
    (r"^jin\s+(\d+)$", r"ji \1"),      # JIN -> JI
]


def norm_nombre_for_match(s):
    n = norm(s)
    for pat, repl in NAME_REMAP:
        n2 = re.sub(pat, repl, n)
        if n2 != n:
            return n2
    return n


def norm_dir_for_match(s):
    """Direccion sin numero para fallback."""
    n = norm(s)
    return n


def slug(s):
    s = norm(s)
    s = s.replace(" ", "-")
    return s or "colegio"


def to_int(v):
    if v is None:
        return 0
    try:
        if isinstance(v, str):
            v = v.strip()
            if not v or v in ("-", "—"):
                return 0
            return int(float(v))
        return int(v)
    except Exception:
        return 0


def to_str(v):
    if v is None:
        return ""
    return str(v).strip()


def coord_for_localidad(loc):
    base = LOCALIDAD_COORDS.get(norm(loc))
    if base is None:
        # fallback con jitter para no superponer
        lat, lng = FALLBACK_COORD
        return (lat + random.uniform(-0.003, 0.003),
                lng + random.uniform(-0.003, 0.003), "fallback")
    lat, lng = base
    # jitter chico tambien por localidad para no apilar todos
    return (lat + random.uniform(-0.003, 0.003),
            lng + random.uniform(-0.003, 0.003), "localidad")


def load_old_index():
    """Indice por (nombre, direccion) -> (lat,lng) del JSON viejo,
    usando ya las siglas viejas tal cual estan."""
    by_name_dir = {}
    by_name = {}
    by_dir = {}
    if not os.path.exists(OLD_JSON):
        return by_name_dir, by_name, by_dir
    with open(OLD_JSON, "r", encoding="utf-8") as f:
        old = json.load(f)
    for c in old.get("colegios", []):
        if not c.get("lat") or not c.get("lng"):
            continue
        nn = norm(c.get("nombre"))
        nd = norm(c.get("direccion"))
        coords = (c["lat"], c["lng"])
        by_name_dir[(nn, nd)] = coords
        by_name.setdefault(nn, coords)
        if nd:
            by_dir.setdefault(nd, coords)
    return by_name_dir, by_name, by_dir


def main():
    random.seed(42)  # determinista
    by_name_dir, by_name, by_dir = load_old_index()

    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["MARZO"]

    colegios = []
    matched = 0
    fallback_loc = 0
    fallback_def = 0
    used_ids = set()

    for row in ws.iter_rows(min_row=2, values_only=True):
        proveedor, zona, escuela, matricula, dm, com, pat_dm, pat_com, \
            patios_dm, lc_dm, lc_com, cue, cocina, jornada, cgm, direccion, \
            entre, localidad = row[:18]

        # Validar zona
        try:
            z = int(zona) if zona is not None else None
        except Exception:
            z = None
        if z is None or not (1 <= z <= 12):
            continue
        nombre = to_str(escuela)
        if not nombre:
            continue

        zona_str = "Zona %d" % z
        prov_zona = PROVEEDORES_POR_ZONA[zona_str]
        # Normalizar CENTURION -> tilde si viene con tilde en xlsx
        prov_xlsx = to_str(proveedor).upper().replace("CENTURIÓN", "CENTURION")

        dm_v = to_int(dm)
        com_v = to_int(com)

        # Match coords - aplica remap PP/MS/EE/MT/JI CC al nombre del Excel
        nname = norm_nombre_for_match(nombre)
        ndir = norm(direccion)
        coords = by_name_dir.get((nname, ndir))
        if coords is None:
            coords = by_name.get(nname)
        if coords is None and ndir:
            coords = by_dir.get(ndir)
        if coords is not None:
            lat, lng = coords
            matched += 1
        else:
            lat, lng, src = coord_for_localidad(localidad)
            if src == "localidad":
                fallback_loc += 1
            else:
                fallback_def += 1

        # ID unico
        base_id = slug(nombre)
        cid = base_id
        n = 2
        while cid in used_ids:
            cid = "%s-%d" % (base_id, n)
            n += 1
        used_ids.add(cid)

        colegio = {
            "id": cid,
            "nombre": nombre,
            "direccion": to_str(direccion),
            "entre_calles": to_str(entre),
            "localidad": to_str(localidad),
            "zona": zona_str,
            "zona_pliego": zona_str,  # alias para componentes viejos
            "proveedor": prov_zona,
            "matricula": to_int(matricula),
            "lat": round(float(lat), 7),
            "lng": round(float(lng), 7),
            "cupos": {
                "dm": dm_v,
                "com": com_v,
                "patologias_dm": to_int(pat_dm),
                "patologias_com": to_int(pat_com),
                "patios_dm": to_int(patios_dm),
                "lc_dm": to_int(lc_dm),
                "lc_com": to_int(lc_com),
                # Aliases backwards-compat
                "modulos": dm_v,
                "dmc": dm_v,
                "comedor": com_v,
                "dmc_comedor": dm_v + com_v,
                "patios": to_int(patios_dm),
            },
            "cocina_o_vianda": to_str(cocina) or "NO RECIBE",
            "tipo_jornada": to_str(jornada),
            "cgm": to_str(cgm),
            "cue": to_int(cue),
        }
        colegios.append(colegio)

    out = {
        "zonas_disponibles": ["Zona %d" % i for i in range(1, 13)],
        "proveedores_por_zona": PROVEEDORES_POR_ZONA,
        "colegios": colegios,
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    total = len(colegios)
    print("Total colegios procesados:", total)
    print("  Match con old (coordenadas reusadas):", matched)
    print("  Fallback localidad centroide:", fallback_loc)
    print("  Fallback default Lomas Centro:", fallback_def)
    print("Output:", OUT_JSON)


if __name__ == "__main__":
    main()
