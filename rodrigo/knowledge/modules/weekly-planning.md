# Módulo: planificación semanal

## Verificado

La UI y el dominio de plan semanal cargan datos de la obra, generan preview, guardan planes e ítems, y cruzan necesidades con entradas y reservas de inventario. Las tablas verificadas son `project_weekly_plans`, `project_weekly_plan_items` e `inventory_reservations`.

## Exposición a Rodrigo

`get_weekly_plan_overview` lee planes actuales. `preview_weekly_plan` usa el motor real sin persistir. `save_weekly_plan` guarda el plan y, con `mrp_commit` más `COMMITTED`, usa el commit/RPC atómico existente para recalcular cobertura y reservar. No genera automáticamente una OC ni una compra.

## Source map

- `app/(internal)/projects/weekly-plan-actions.ts`
- `app/(internal)/projects/[id]/weekly-plan-section.tsx`
- `lib/procurement/weekly-plan-shared.ts`
- `lib/tools/erp/preview-weekly-plan.ts`
- `lib/tools/erp/save-weekly-plan.ts`
