# ERP Surface Certification

Fecha de trabajo: 2026-09-22  
Branch: `fix/erp-surface-recovery`  
Base: `origin/main` (`9f686c13d00781fcf5dddd9bd83aa651076bb27d`) + `origin/feature/frictionless-workbook-interpretation-v1` (`5aefd69ed8000c00b5ef8662e41182255c972b20`)

## Root cause

La pérdida de discoverability fue una regresión de integración entre `ALL_TABS`, los branches de `ProjectTabsClient` y `PROJECT_TAB_GROUPS` del sidebar después de la migración de tabs horizontales a sidebar (`bb6ae17`). El merge visual `00d5134` amplió la superficie tocada por navegación sin introducir un contrato compartido. La integración canónica de inventario (`1ed50cb`) dejó renderers reales para Inventario, Recepciones y Pañol, pero no una fuente de verdad que obligara a publicar sus entradas. Plan semanal sufría el mismo problema: motor y componente presentes, sin tab propia.

## Recovered

- Registry canónico en `lib/projects/project-features.ts`.
- Sidebar y validación server-side de tabs derivados del registry.
- Plan semanal como superficie Preparar → Plan semanal, sin duplicarlo dentro de Avance físico.
- Inventario, Recepciones y Pañol visibles desde Ejecutar.
- Inventario global visible en Administración; `/stock` queda rotulado como Catálogo de materiales.
- BIM con jerarquía “MODELO BIM / IFC”, CTA accesible “Subir modelo IFC”, `accept=".ifc"`, visor existente y una sola instancia de Cómputo.
- Workbook canonical import con reparación estructural, join contractual 1:1 y aserciones golden fuertes.
- Strings mojibake corregidos en la superficie de Workbook y errores del interpreter que se muestran al usuario.

## Intentionally hidden / embedded

- `?tab=stock`: legacy superseded por Inventario canónico; el renderer/código existente no se eliminó, pero dejó de ser una entrada válida del registry.
- Planilla embebida: se abre desde Presupuesto mediante `GenerarPlanillaButton`; no se creó un tab paralelo.
- Climate Workdays: permanece contextual dentro de Cronograma.
- Auction/DNCP: permanece en Licitaciones y no se expone dentro del contexto conversacional de Rodrigo.

## Surface counts

| Estado | Conteo |
|---|---:|
| USER_SURFACE project-scoped activa | 18 |
| USER_SURFACE global activa auditada | 25 |
| EMBEDDED_SUBFEATURE | 3 |
| LEGACY_SUPERSEDED | 1 |
| USER_SURFACE orphaned conocidas | 0 |

## Tests and checks

| Check | Result |
|---|---|
| Project surface contract | PASS — 6 tests |
| Workbook canonical/import-plan directed tests | PASS — 25 tests, 1 skipped por ausencia de OpenAI |
| Golden deterministic audit | PASS — fixture local, 15 hojas / 7.456 celdas / 53 partidas / 53 matches |
| Workbook golden live con GPT | BLOCKED IN ENVIRONMENT — `OPENAI_API_KEY` no está disponible |
| Typecheck | PASS — `npx.cmd tsc --noEmit` |
| Focal lint de archivos tocados | PASS — 0 errores; 3 warnings preexistentes en BIM |
| Lint global | BLOCKED — baseline repo: 470 errores / 297 warnings fuera del cambio |
| Suite global | PASS WITH ENVIRONMENT FAILURES — 106 archivos OK, 1.034 tests OK; 3 tests fallan por Supabase/.env ausentes |
| Build producción | BLOCKED IN ENVIRONMENT — compila y typecheckea; prerender requiere variables Supabase en `/reset-password` |
| E2E localhost | PASS — `/login` carga con contenido, sin overlay ni errores de página; warning no bloqueante de proporción del logo |
| Authenticated E2E / workbook flow | BLOCKED IN ENVIRONMENT — `E2E_PASSWORD` no está definido |
| Preview deployment E2E | BLOCKED IN ENVIRONMENT — requiere autenticación/configuración de Vercel y variables de runtime |

El intento real de `npx.cmd vercel --yes` creó el proyecto remoto [`control-facturas-surface-recovery`](https://vercel.com/marceloechauri-4623s-projects/control-facturas-surface-recovery/6NJBMEELkaKLxT2E4UsBt5iHgUfi) y alcanzó el build remoto, pero Vercel generó una configuración de Services cuyo `buildCommand` sólo ejecutaba el worker; por eso terminó sin `.next` (`deploy_failed`) y no existe una preview verificable. `vercel env ls` confirmó que no hay variables configuradas para ese proyecto. El archivo `vercel.json` generado automáticamente fue descartado del branch.

El golden live queda configurado para exigir `budgetItems.length === 53`, `certificate.status === SAFE_TO_APPLY`, `certificate.itemCount === 53`, `matchedBudgetItems === 53`, `budgetTotal === 3482791500` y `measurement.status === DETECTED_NOT_APPLIED`. No fue ejecutado porque no existe la credencial en este entorno.

## Git isolation

- Worktree: `C:\Users\User\Desktop\PORYECTOS\control-facturas-surface-recovery`
- Branch: `fix/erp-surface-recovery`
- Checkout principal: no se modificó; conserva `data/construction-v1-backfill-checkpoint.json`, `forensic-operative-audit/` y `mock-data/niu-pack/`.
- `main`: no mergeado.
- Producción: no desplegada.
- Commit(s): `f7a48a0` (`fix: recover ERP project surfaces and workbook import`).
- Preview URL: se intenta con `npx vercel --yes`; nunca usar `--prod`.

## Certification gate

El estado queda `BLOCKED BY EXTERNAL CREDENTIALS` para la certificación completa: faltan `OPENAI_API_KEY`, variables Supabase, `E2E_PASSWORD` y configuración de Vercel. Las comprobaciones locales, focales y determinísticas sí quedaron ejecutadas en el worktree aislado.
