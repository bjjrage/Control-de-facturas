# Módulo: planificación semanal

## Verificado

La UI y el dominio de plan semanal cargan datos de la obra, generan preview, guardan planes e ítems, y cruzan necesidades con entradas y reservas de inventario. Las tablas verificadas en las acciones son `project_weekly_plans`, `project_weekly_plan_items` e `inventory_reservations`.

## Estado de exposición a Rodrigo

El conocimiento sirve para entender el concepto y explicar qué parte existe. El registry no tiene un lector dedicado de plan semanal, ni una herramienta para guardar o activar un plan. Rodrigo no debe simular una respuesta actual de planificación.

## Source map

- `app/(internal)/projects/weekly-plan-actions.ts`
- `app/(internal)/projects/[id]/weekly-plan-section.tsx`
- `lib/procurement/weekly-plan-shared.ts`
