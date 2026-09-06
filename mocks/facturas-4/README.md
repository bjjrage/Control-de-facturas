# Mocks — Facturas 4

Set de prueba para el **parseo automático** y el **matching por ítem** (worker).

## Cómo usar

1. **Aplicar las OCs multi-ítem** (una vez):
   ```
   npx supabase db query --file mocks/facturas-4/seed-multi-ocs.sql --linked --project-ref ezucivipgmbvamhugkbj
   ```
   Crea `OC-MULTI-001/002/003`, cada una con 3 filas en `authorized_order_items`.

2. **Regenerar los PDFs** (si hace falta):
   ```
   node mocks/facturas-4/generate.mjs
   ```

3. **Subir las facturas** desde la app (Facturas → carga masiva) y ver cómo el
   worker las parsea, identifica el proveedor por RUC, matchea la OC por el
   texto "Referencia OC: OC-XXX" y —en las multi-ítem— empareja cada línea.

## OCs abiertas usadas

| OC | Proveedor | Ítems | Total |
|----|-----------|-------|-------|
| OC-DEMO-011 | CoolTech SRL | 1 (header) | 14.850.000 |
| OC-DEMO-013 | Limpieza Pro SA | 1 (header) | 7.700.000 |
| OC-DEMO-015 | TechOffice SRL | 1 (header) | 19.800.000 |
| OC-MOCK-004 | Distribuidora Central SA | 1 (header) | 3.800.000 |
| **OC-MULTI-001** | Distribuidora Central SA | **3** (`authorized_order_items`) | 13.200.000 |
| **OC-MULTI-002** | TechOffice SRL | **3** | 36.300.000 |
| **OC-MULTI-003** | Muebles Modernos SA | **3** | 31.400.000 |

## Facturas (`pdfs/`)

### Individuales — 1 ítem, factura por el total de la OC
| Archivo | OC | Total |
|---------|----|----|
| `factura-individual-01-cooltech.pdf` | OC-DEMO-011 | 14.850.000 |
| `factura-individual-02-distribuidora.pdf` | OC-MOCK-004 | 3.800.000 |

### Entregas parciales — 2 facturas que suman el total de la OC
| Archivo | OC | Total | Parte |
|---------|----|----|-------|
| `factura-parcial-limpieza-01.pdf` | OC-DEMO-013 | 3.849.999 | meses 1–3 |
| `factura-parcial-limpieza-02.pdf` | OC-DEMO-013 | 3.850.002 | meses 4–6 |
| `factura-parcial-techoffice-01.pdf` | OC-DEMO-015 | 9.900.000 | 1/2 |
| `factura-parcial-techoffice-02.pdf` | OC-DEMO-015 | 9.900.000 | 2/2 |

### Multi-ítem — varias líneas, nombres DISTINTOS a los de la OC
Prueban el matching semántico: el proveedor factura "Cemento CP-40" y la OC dice
"Cemento Portland tipo I". El worker (segundo llamado a GPT) tiene que emparejarlos.
Cada OC-MULTI tiene un escenario coherente (no se sobre-factura):

| Archivo | OC | Ítems | Total | Escenario |
|---------|----|----|----|-----------|
| `factura-multi-item-01a-distribuidora-parcial.pdf` | OC-MULTI-001 | 2 | 6.600.000 | parcial 1/2: 60/100 cemento + 20/20 arena |
| `factura-multi-item-01b-distribuidora-parcial.pdf` | OC-MULTI-001 | 2 | 6.600.000 | parcial 2/2: 40/100 cemento + 40/40 varilla → completa la OC |
| `factura-multi-item-02-techoffice-completa.pdf` | OC-MULTI-002 | 3 | 36.300.000 | entrega completa de los 3 ítems |
| `factura-multi-item-03-muebles-con-faltante.pdf` | OC-MULTI-003 | 3 | 28.400.000 | faltante: llegan 8 sillas de 10 (backorder), OC queda abierta con 2 pendientes |

> **OC-MULTI-001** hay que subirla en dos pasos: primero la `01a`, después la
> `01b`. Cada línea de cemento debe acumular (60 + 40 = 100) en `quantity_invoiced`.

### Equivalencias de nombres (OC ↔ factura)

**OC-MULTI-001 (Distribuidora Central SA)**
| Ítem OC | Nombre en la factura |
|---------|----------------------|
| Cemento Portland tipo I 50kg | Cemento CP-40 x 50kg (bolsa) |
| Hierro de construcción Ø12mm barra 12m | Varilla corrugada Ø12 x 12m |
| Arena lavada gruesa | Arena fina para revoque (m³) |

**OC-MULTI-002 (TechOffice SRL)**
| Ítem OC | Nombre en la factura |
|---------|----------------------|
| Notebook Dell Latitude 15" i5 16GB | Laptop Dell Latitude 5540 Core i5 16GB |
| Monitor LED 24" Full HD | Pantalla 24" 1920x1080 IPS |
| Kit teclado + mouse inalámbrico | Combo teclado + ratón inalámbrico Logitech |

**OC-MULTI-003 (Muebles Modernos SA)**
| Ítem OC | Nombre en la factura |
|---------|----------------------|
| Escritorio ejecutivo en L 160x140 | Mesa de oficina en L 1.60 x 1.40 m |
| Silla ergonómica malla con apoyabrazos | Sillón operativo respaldo mesh con brazos |
| Estante metálico 5 niveles 200x90 | Estantería metálica 5 estantes 2.00 x 0.90 |

## Qué verificar después de subir

- **Auto-match de OC**: cada factura queda vinculada a su OC (por el texto "Referencia OC").
- **`invoice_items`**: el worker guardó una fila por línea de la factura.
- **`invoice_item_matches`**: para las multi-ítem, cada línea quedó emparejada a la línea correcta de la OC.
- **`authorized_order_items.quantity_invoiced`**: se actualizó (trigger) — en las parciales debe reflejar la cantidad entregada, no el total.
- Detalle de la OC (`/orders/<id>`): la tabla de ítems muestra "Facturado" y "Pendiente" por línea.
