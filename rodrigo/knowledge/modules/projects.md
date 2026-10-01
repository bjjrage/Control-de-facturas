# Módulo: obras y ejecución

## Verificado

La página de proyecto organiza presupuesto, cronograma, BIM, proveedores, cotizaciones, OC, facturas, pagos, ejecución, stock/materiales, personal, subcontratistas, certificados, avance físico e informes. Las acciones existentes permiten crear/editar proyecto, presupuesto, ejecución, unidades, recetas, certificados, BIM, cómputo y pronóstico de avance.

Rodrigo tiene un lector acotado: `get_project_context` recibe `project_id` UUID y devuelve identidad de la obra, resumen de presupuesto y resumen agregado de ejecución. No es un lector universal de todas las pestañas.

## No inferir

El manual no permite afirmar el estado actual de una obra, su avance, presupuesto o certificado sin consultar una fuente viva. Tampoco permite resolver una obra por nombre si no existe un tool de búsqueda.

## Source map

- `app/(internal)/projects/[id]/project-tabs-client.tsx`
- `app/(internal)/projects/actions.ts`
- `app/(internal)/projects/[id]/bim-actions.ts`
- `app/(internal)/projects/[id]/computo-actions.ts`
- `app/(internal)/projects/certificado-actions.ts`
- `lib/tools/projects/get-project-context.ts`
