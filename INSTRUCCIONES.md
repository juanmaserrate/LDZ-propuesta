# Dashboard Logístico - Actualización de Cupos

## Cambios Realizados

### 1. **Enriquecimiento de datos JSON** (`data/colegios.json`)
Se agregaron los siguientes campos a cada colegio:
- `zona_pliego`: Zona de transporte (Zona 1 a Zona 12)
- `localidad`: Localidad (Lomas de Zamora)
- `orden_pliego`: Número de orden dentro de la zona (1, 2, 3...)
- `orden_localidad`: Número de orden dentro de la localidad

Los **cupos originales se preservaron**:
```json
"cupos": {
  "modulos": 230,
  "comedor": 0,
  "desayuno": 0,
  "dmc": 247,
  "patios": 0,
  "dmc_comedor": 247
}
```

---

## 2. **Actualización del Dashboard** (`js/app.js`)

### Resumen de Cupos por Pliego
Se agregó un resumen visual al inicio de la lista lateral con los **totales de cupos** cuando filtras por zona o localidad:

```
┌─────────────────────────────────────────┐
│     CUPOS TOTALES PLIEGO                │
├─────────────────────────────────────────┤
│  Modulos:        X.XXX                  │
│  Comedor:        X.XXX                  │
│  Desayuno:       X.XXX                  │
│  Patios:         XXX                    │
├─────────────────────────────────────────┤
│  DMC+Comedor:    X.XXX     [DESTACADO]  │
└─────────────────────────────────────────┘
```

### Cupos por Establecimiento
Cada colegio ahora muestra:
- **Número de orden** dentro de la ruta
- **Cupos DMC+Comedor** (a la derecha, en color de zona)
- **Desglose de cupos**: M: 230, C: 0, etc.

**Ejemplo:**
```
┌─────────────────────────────────────┐
│  [1] PP 49                    247    │  ← Orden + Cupos DMC
│  Llaroque 1231                       │
│  Z: Zona 1  Loc: Lomas de Zamora   │
│  M: 230  C: 0                       │  ← Desglose detallado
└─────────────────────────────────────┘
```

---

## 3. **Cómo Usar**

### Opción 1: Abrir archivo local
```bash
# Navega a la carpeta y abre en navegador:
file:///C:/Users/Usuario/.gemini/antigravity/playground/aphelion-eclipse/Proyecto_Lomas_Zonas/index.html
```

### Opción 2: Usar servidor local (recomendado)
```bash
# En la carpeta del proyecto:
python -m http.server 8000

# Luego abre en navegador:
http://localhost:8000
```

---

## 4. **Funcionalidades Disponibles**

### Filtros
- **📍 Escuelas por Localidad**: Ve todos los colegios de Lomas de Zamora
- **📑 Escuelas por Pliego**: Filtra por zona (Zona 1 a Zona 12)
- **Recargar Vista Total**: Vuelve a mostrar todos los 276 colegios

### Información Mostrada
- **Cupos totales agregados** por filtro
- **Cupos desglosados** (Módulos, Comedor, Desayuno, Patios)
- **Orden de visita** en rutas filtradas
- **Mapa interactivo** con paradas numeradas
- **Distancia estimada** de recorrido
- **Pop-ups en el mapa** con detalles completos

---

## 5. **Estructura de Datos**

### Cupos disponibles:
| Campo | Significado |
|-------|------------|
| `modulos` | Cupos mensuales de módulos alimentarios |
| `comedor` | Cupos por día - Comedor |
| `desayuno` | Cupos por día - Desayuno/Merienda |
| `patios` | Cupos - Patios Abiertos/Coros y Orquestas Sábado |
| `dmc` | Módulos (alias) |
| `dmc_comedor` | **DMC + Comedor (total principal)** |

---

## 6. **Ejemplo de Uso**

### Filtrar por Zona 1
1. Haz clic en **"📑 Escuelas por Pliego"**
2. Selecciona **"Zona 1"**
3. El sidebar mostrará:
   - ✅ Título: "Ruta Activa: Zona 1" (24 colegios)
   - ✅ Resumen: Cupos totales de Zona 1
   - ✅ Lista numerada (1-24) con cupos por establecimiento
   - ✅ Mapa con ruta azul optimizada

### Filtrar por Localidad
1. Haz clic en **"📍 Escuelas por Localidad"**
2. Selecciona **"Lomas de Zamora"**
3. Igual que arriba, pero agrupado por localidad

---

## 7. **Totales Globales**

```
Total de colegios: 276
Total cupos DMC+Comedor: 155,547
Total cupos Módulos: 82,334
Total cupos Comedor: 64,622
Total cupos Patios: 892
```

---

## 8. **Próximos Pasos**

### Si quieres:
- 🗺️ **Cambiar a Google Maps**: Reemplazar Leaflet en el HTML
- 📊 **Exportar datos**: Agregar botón de descarga CSV/Excel
- 🎯 **Optimizar rutas**: Implementar algoritmos de TSP (Traveling Salesman)
- 📈 **Análisis de rentabilidad**: Agregar cálculos de costos por cupo
- 🔄 **Sincronizar con Excel**: Auto-actualizar desde nuevas versiones del Excel

---

**Versión:** 1.1 (Con cupos por establecimiento y pliego)
**Fecha de actualización:** 2026-04-05
**Colegios:** 276 distribuidos en 12 zonas
