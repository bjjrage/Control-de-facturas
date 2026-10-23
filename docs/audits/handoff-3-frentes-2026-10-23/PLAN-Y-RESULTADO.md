# Tres frentes: versión estable, navegación y administración

Fecha: 2026-10-23. Base: main c027ec23. Estado: en preparación; pruebas y publicación pendientes.

## Alcance acordado

- Trabajo en el checkout existente de main, C:\e2e-main. Sin ramas ni worktrees nuevos.
- C: únicamente autoAssignCustomDomains=false en control-de-facturas, autorizado expresamente por el usuario. El alias estable debe conservar c027ec23. No promover otra versión ni invitar usuarios todavía.
- B: validación de claims, perfil activo consultado en cada petición, precarga con permisos para Proyectos/Materiales/Inventario, consultas independientes en paralelo y esqueletos de carga. Medición local con build de producción y backend QA antes/después.
- A: administración de usuarios limitada a la empresa, guardas contra autoexclusión/último administrador/superadmin, eliminación con control de operaciones vinculadas. Plan y módulos por empresa solo para superadmin, incluida protección en la base de datos.
- Migraciones aditivas y compatibles con c027ec23. Aplicación y pruebas primero en QA kyiihlkncatojvlasoag. Producción de datos queda sin modificar durante la preparación.
- Preservar los 227 archivos previos del E2E, sin incluirlos en los commits. Excluidos todos los proyectos y ramas históricos indicados por el usuario.
- No modificar scanner, migraciones de seguridad ya aplicadas ni configuración permanente de protección de main.

## C: estado inicial

El cambio autorizado autoAssignCustomDomains=false fue aceptado por la API de Vercel. Después del cambio, control-de-facturas-bay.vercel.app conserva el deployment dpl_DQAx9nooqPdtGCiu9H1EfDAEMLfV (c027ec23). Esto todavía no prueba el comportamiento ante un build nuevo; queda pendiente la prueba controlada.

## Validación pendiente

Mediciones antes/después, tests de permisos y concurrencia en QA, build/TypeScript/lint, revisión de diferencias, commits exactos, prueba de retención del alias y comprobación de protección de main. No se afirmará que la separación estable funciona hasta completar la prueba.

## Promoción manual

Solo después de aprobar el candidato y sus mediciones: en Vercel > control-de-facturas > Deployments, abrir el deployment exacto probado y elegir Promote to Production. Verificar que el alias estable apunta a ese ID/SHA y volver a comprobar la asignación automática antes de otro push. La promoción no está autorizada en esta etapa.

Referencia: https://vercel.com/docs/deployments/promoting-a-deployment
