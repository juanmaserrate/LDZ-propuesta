import json

with open('data/colegios.js', 'r', encoding='utf-8') as f:
    data = json.loads(f.read().replace('window.appData = ', '').rstrip(';\n'))

for c in data['colegios']:
    if c['localidad'] == 'Lomas Centro':
        print(f"{c['nombre']} - {c['direccion']}")
