"""Reemplaza 'colegio'/'colegios' por 'escuela'/'escuelas' SOLO en textos visibles.
NO toca nombres de variables JS (colegiosZona, __colegiosCache, d.colegios) ni paths
(data/colegios.json, data/colegios.js)."""
import re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [
    "index.html",
    "components/Dashboard.jsx",
    "components/DemoComparativa.jsx",
    "components/ZoneSlider.jsx",
    "components/Sections.jsx",
]

# Lista de patrones (regex) -> reemplazo. Cada uno apunta a textos visibles
# y evita los identificadores de código.
PATTERNS = [
    # Frases plurales con "colegios" como palabra suelta
    (r"Colegios vecinos", "Escuelas vecinas"),
    (r"colegios vecinos", "escuelas vecinas"),
    (r"Colegios cercanos", "Escuelas cercanas"),
    (r"colegios cercanos", "escuelas cercanas"),
    (r"colegios próximos", "escuelas próximas"),
    (r"colegios equidistantes", "escuelas equidistantes"),
    (r"colegios cubiertos", "escuelas cubiertas"),
    (r"colegios verificados", "escuelas verificadas"),
    (r"colegios auditados", "escuelas auditadas"),
    (r"colegios reales", "escuelas reales"),
    (r"colegios del pliego", "escuelas del pliego"),
    (r"colegios separadas", "escuelas separadas"),
    (r"más colegios", "más escuelas"),
    (r"3× más colegios", "3× más escuelas"),
    (r"3x más colegios", "3x más escuelas"),
    (r"80\+ colegios", "80+ escuelas"),
    (r"12 colegios", "12 escuelas"),
    (r"4 colegios", "4 escuelas"),
    (r"esos colegios", "esas escuelas"),
    (r"los colegios", "las escuelas"),
    (r"Los colegios", "Las escuelas"),
    (r"de colegios", "de escuelas"),
    (r"Colegios de la misma zona", "Escuelas de la misma zona"),

    # Singulares
    (r"cada colegio", "cada escuela"),
    (r"un colegio", "una escuela"),
    (r"al colegio", "a la escuela"),
    (r"del colegio", "de la escuela"),
    (r"el colegio", "la escuela"),
    (r"qué colegio", "qué escuela"),
    (r"un nuevo colegio", "una nueva escuela"),
    (r"colegio cambia", "escuela cambia"),

    # Frases especiales con punctuation alrededor (en textos de KPIs / cards)
    (r"\$\{subset\.length\} colegios", "${subset.length} escuelas"),
    (r" colegios \|", " escuelas |"),
    (r" colegios ·", " escuelas ·"),
    (r" colegios y ", " escuelas y "),
    (r" colegios sobre ", " escuelas sobre "),
    (r" colegios por ", " escuelas por "),
    (r" colegios cuyo ", " escuelas cuyo "),
    (r" colegios cubiertos por ", " escuelas cubiertas por "),
    (r"^Colegios", "Escuelas"),
    (r">Colegios<", ">Escuelas<"),
    (r"\"Colegios\"", "\"Escuelas\""),
    (r">COLEGIOS<", ">ESCUELAS<"),
    (r"\"COLEGIOS\"", "\"ESCUELAS\""),

    # Comentarios (no afectan la página pero quedan más limpios)
    (r"colegio del pliego", "escuela del pliego"),
    (r"colegio activo", "escuela activa"),
    (r"colegios reales", "escuelas reales"),
    (r"Mapa Leaflet con colegios", "Mapa Leaflet con escuelas"),
    (r"recorre cada colegio", "recorre cada escuela"),

    # "colegios" como palabra final (acaba con espacio o final de string)
    (r"\bcolegios\.", "escuelas."),
    (r"\bcolegios,", "escuelas,"),
    (r"\bColegios\.", "Escuelas."),
    (r"\bColegios,", "Escuelas,"),
]

# Identificadores que NO debe tocar (los detectamos para asegurarnos de
# que ninguno aparezca distinto después del replace).
PROTECTED_IDENTIFIERS = [
    "colegiosZona",
    "__colegiosCache",
    "d.colegios",
    "data/colegios.json",
    "data/colegios.js",
    "data.colegios",
    ".colegios ||",
    "(colegios)",
    "(d.colegios",
    "ColegiosCache",
]

def transform(text):
    out = text
    for pat, rep in PATTERNS:
        out = re.sub(pat, rep, out)
    return out

changes_total = 0
for rel in FILES:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print(f"  (skip, no existe): {rel}")
        continue
    with open(p, "r", encoding="utf-8") as f:
        original = f.read()
    nuevo = transform(original)
    # Sanity check: ningun identificador protegido debe haber sido modificado
    ok = True
    for ident in PROTECTED_IDENTIFIERS:
        if ident in original and ident not in nuevo:
            print(f"  ⚠️ El identificador {ident!r} se vería afectado en {rel}. NO se guarda.")
            ok = False
    if not ok:
        continue
    if nuevo != original:
        n_changes = sum(1 for a, b in zip(original.split("\n"), nuevo.split("\n")) if a != b)
        with open(p, "w", encoding="utf-8") as f:
            f.write(nuevo)
        print(f"  ✔ {rel}: {n_changes} líneas modificadas")
        changes_total += n_changes
    else:
        print(f"  - {rel}: sin cambios")

print(f"\nTotal lineas modificadas: {changes_total}")
