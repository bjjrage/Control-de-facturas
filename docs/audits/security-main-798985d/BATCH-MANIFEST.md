# Batch: correcciones de seguridad de main 798985d

Base autorizada y origin/main verificado: `798985d355fb8ed96796237e6f198c172db98709`.
Rama local: `batch/security-main-798985d`.

## Alcance autorizado

Autorización posterior del usuario: hacer commit, publicar esta rama en un PR contra main, aplicar y probar las dos migraciones en el proyecto QA `kyiihlkncatojvlasoag` y revisar checks. Sigue prohibido mergear, desplegar a producción o modificar otros proyectos. La app de pruebas se ejecutará localmente contra ese QA; la evidencia posterior se documentará por separado.

Corregir SEC-01 scanner, SEC-02 versión de Next, SEC-03 Gmail y SEC-04 plantillas del informe de auditoría. Publicar únicamente el candidato de esta rama y su evidencia en un PR contra main, según la autorización posterior. No modificar producción, otras ramas/proyectos, ni realizar merge o deploy. No incorporar commits históricos. Preservar archivos ajenos de los checkouts existentes.

## Archivos previstos

Ampliación autorizada el 22/10/2026: recuperar únicamente el cambio de estilo de las tarjetas de bloques del Plan Semanal que quedó local en `weekly-block-card-style`, sobre el candidato vigente del PR #41. Reutilizar `costeo-checklist.module.css` sin modificarlo; cambiar solo clases/presentación del componente y agregar `weekly-plan-blocks.module.css`. No incorporar la página de preview ni cambios de lógica, scanner, migraciones u otras ramas. Publicar el resultado verificado en este PR, sin merge ni despliegue. Verificación: build/TypeScript, suites existentes de Plan Semanal y navegador autenticado local contra QA en escritorio/móvil, temas oscuro/claro y estados hover/foco.

- `app/(internal)/projects/[id]/weekly-plan-section.tsx` y `weekly-plan-blocks.module.css`: hunks visuales exactos del trabajo preservado.
- `docs/audits/security-main-798985d/UI_TARJETAS_RESULTADO.md`: evidencia y límites del cambio visual; actualizar referencias del resultado de QA para distinguir los candidatos.

- `package.json`, `package-lock.json`: Next y configuración ESLint compatible; dependencias necesarias para sanear HTML.
- `app/api/scanner/status/[id]/route.ts`, helpers de autorización/servicio scanner, `app/(internal)/invoices/actions.ts` para validar la referencia consumida al crear factura, y `lib/tools/erp/get-scanner-session-overview.ts`/pruebas para mantener lecturas explícitas de columnas seguras.
- `app/(internal)/agent/approval-actions.ts`, helpers de aprobación/envío Gmail y sus pruebas.
- `lib/template.ts`, `lib/template-gen.ts`, helper de saneamiento de plantillas, acciones/editor de configuración, impresión y sus pruebas.
- Nuevas migraciones generadas con CLI para cerrar escritura directa de sesiones scanner y decisiones de aprobación. Mantener RPCs backend y flujos válidos.
- `docs/audits/security-main-798985d/**`: evidencia, resultado y migraciones pendientes de aplicar.

## Verificación prevista

Pruebas locales negativas de rol/tenant/propiedad y rutas manipuladas de scanner, incluyendo RLS/grants en PGlite y lectura segura del overview; autoridad de aprobaciones y rol actual Gmail; XSS de HTML en renderer/preview; ejecución de migraciones en base efímera local cuando esté disponible; regresión Vitest, tipado y build. No usar credenciales productivas ni llamar a proveedores reales. Revisar diff contra la base y dejar constancia de cualquier limitación verificable.

Las migraciones se verifican localmente y en el proyecto QA autorizado; no se aplican a producción.

## Archivos finales del candidato

- app/(internal)/agent/approval-actions.ts
- app/(internal)/configuracion/actions.ts
- app/(internal)/configuracion/template-editor.tsx
- app/(internal)/invoices/actions.ts
- app/(internal)/projects/[id]/weekly-plan-section.tsx
- app/(internal)/projects/[id]/weekly-plan-blocks.module.css
- app/api/scanner/session/route.ts
- app/api/scanner/status/[id]/route.ts
- app/api/scanner/upload/route.ts
- docs/audits/security-main-798985d/BATCH-MANIFEST.md
- docs/audits/security-main-798985d/RESULTADO.md
- docs/audits/security-main-798985d/QA_RESULTADO.md
- docs/audits/security-main-798985d/UI_TARJETAS_RESULTADO.md
- docs/audits/security-main-798985d/gmail-result.md
- docs/audits/security-main-798985d/scanner-result.md
- docs/audits/security-main-798985d/templates-result.md
- lib/agent/__tests__/approval-actions-security.spec.ts
- lib/agent/__tests__/approval-execution.spec.ts
- lib/agent/__tests__/gateway.spec.ts
- lib/agent/__tests__/orchestrator.spec.ts
- lib/agent/approvals.ts
- lib/email/__tests__/gmail-approval-authority-db.spec.ts
- lib/email/domain-service.ts
- lib/scanner/__tests__/session-authorization-db.spec.ts
- lib/scanner/__tests__/status-route.spec.ts
- lib/scanner/session-access.ts
- lib/template-gen.ts
- lib/template-sanitizer.test.ts
- lib/template-sanitizer.ts
- lib/template.ts
- lib/tools/erp/__tests__/erp-tools.spec.ts
- lib/tools/erp/get-scanner-session-overview.ts
- package-lock.json
- package.json
- supabase/migrations/20261022231201_scanner_session_authorization.sql
- supabase/migrations/20261022231211_sec03_gmail_approval_authority.sql
- test/scan-sessions-security.test.ts
- test/scanner-ui-integration.test.ts

## Cierre local

Build y tipado aprobados; Vitest consolidado de seguridad: 2.496 PASS, 16 omitidos, cero fallos pendientes. Sin hallazgos de lint nuevos frente a la base. Las dos migraciones se aplicaron únicamente a QA; nueve pruebas seleccionadas de integración aprobadas sobre d85bfb4. La ampliación visual posterior se validó con un nuevo build/TypeScript, 85/85 tests existentes y navegador autenticado contra QA; backend y migraciones sin cambios frente a 0535e5a0. No hay commits históricos añadidos ni integración de otras ramas. El PR #41 reúne el fix y los hunks visuales recuperados; resultado detallado en RESULTADO.md, QA_RESULTADO.md y UI_TARJETAS_RESULTADO.md.
