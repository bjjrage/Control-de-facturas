# Mocks — Caterpillar

Datos de demo para testear **todos** los módulos del plan Caterpillar.

## Cómo usarlo

1. Abrir el SQL Editor en Supabase (proyecto `ezucivipgmbvamhugkbj`)
2. Pegar y ejecutar `seed-caterpillar-demo.sql`
3. El script verifica con un SELECT final cuántos registros quedaron
4. Ejecutar los tests: `npx playwright test --project=e2e --no-deps --grep "Caterpillar"`

## Datos creados

| Módulo | Datos |
|--------|-------|
| Proyectos | 3 proyectos (2 ACTIVO, 1 COMPLETADO) |
| Cómputo métrico | 10 rubros/ítems en Proyecto 1, 4 en Proyecto 2 |
| Ejecución en campo | 6 entradas de avance en Proyecto 1 |
| Personal / mano de obra | 8 partes diarios en Proyecto 1 |
| Subcontratistas | 3 en el catálogo de la empresa |
| Contratos | 2 contratos en Proyecto 1 |
| Certs. subcontratistas | 3 certificados (2 aprobados + 1 pendiente) |
| Certs. al comitente | 3 certificados (2 cerrados + 1 borrador) |
| Stock | 6 productos (5 activos, 1 inactivo) |

## Proyecto de referencia para los tests

- **ID del proyecto principal**: `c1000001-0000-0000-0000-000000000001`
- **Código**: `PRY-2026-001`
- **Nombre**: Edificio Residencial Norte
- **URL**: `https://control-de-facturas-bay.vercel.app/projects/c1000001-0000-0000-0000-000000000001`

## Limpiar datos

Para eliminar todos los datos de demo, ejecutar en el SQL Editor:

```sql
DELETE FROM public.projects
 WHERE empresa_id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd'
   AND code IN ('PRY-2026-001','PRY-2026-002','PRY-2025-009');

DELETE FROM public.subcontractors
 WHERE empresa_id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd'
   AND ruc IN ('80-123456-7','80-234567-8','80-345678-9');

DELETE FROM public.productos
 WHERE empresa_id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd'
   AND sku IN ('CEM-50KG','HIE-10-12','ARE-GRU','LAD-15','PIN-LAT-20','CAP-PVC-110');
```
