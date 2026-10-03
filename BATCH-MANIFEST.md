# Batch 04 — manifiesto vigente

- Rama: `batch/04-prebid-workspace`.
- Base: `be1bd17cf82de5bb64f45e0f28a9a6bd1a18efb3`.
- Decisión autorizada: PREBID pertenece a licitación; ejecución pertenece a proyecto. Motores comunes, sin proyecto ficticio.
- Alcance y allowlist: `BATCH-04-MANIFEST.md`.
- Archivos esperados: 24, enumerados en ese manifiesto.
- Migrations nuevas: 8, aplicadas únicamente a `xddlzgjwufskgasomval` (Preview).
- Publicación autorizada: push de la rama y PR contra main; sin merge ni producción.
- Resultado: listo para auditoría externa. Handoff Tender→Project sigue fuera de este batch.

---

# BATCH MANIFEST — Fase -1 Git freeze (histórico)

## Identidad

- Batch: `phase--1-git-freeze`.
- Rama: `batch/pre-erp-hardening-freeze`.
- Base SHA: `1a71c96279febf6636892143af20f36a0315f5ae`.
- Objetivo: fijar el baseline, proteger main y registrar todo trabajo histórico antes del Plan Maestro.

## Preflight observado

- Rama inicial: `main`.
- HEAD inicial: `1a71c96279febf6636892143af20f36a0315f5ae`.
- `origin/main` después de `git fetch`: `1a71c96279febf6636892143af20f36a0315f5ae`.
- Divergencia `main...origin/main`: `0 0`.
- Estado inicial: contenía únicamente elementos untracked preexistentes (`audit-artifacts/erp-total-reality-audit-2026-09-30/`, `planillas-ejemplo/` y el temporal de Excel `~$MAGY - Cronograma Adenda 1.xlsx`). No se modificaron ni se incorporan en este batch.
- Rama de trabajo creada desde el SHA exacto: `batch/pre-erp-hardening-freeze`.

## Archivos autorizados

- `.githooks/pre-commit`
- `.githooks/pre-push`
- `GIT-FREEZE-POLICY.md`
- `GIT-LEDGER.md`
- `RESCUE-ALLOWLIST.md`
- `APPLIED-CHANGES.md`
- `BATCH-MANIFEST.md`
- `BATCH-MANIFEST.template.md`
- `audit-artifacts/git-freeze-2026-09-30/generate-ledgers.mjs`
- `audit-artifacts/git-freeze-2026-09-30/main-branch-protection.json`

## Commits históricos autorizados

- Ninguno se integra en esta fase.
- Los elementos de `RESCUE-ALLOWLIST.md` sólo quedan clasificados para batches futuros.

## Migraciones

- No se autoriza crear, editar, ejecutar ni aplicar migraciones.

## Alcance

- Incluye tag de baseline, protección local/remota de main, ledger exhaustivo y reglas de rescate/batch.
- Excluye todo cambio funcional del ERP, limpieza de ramas/worktrees/stashes y rescate histórico.

## Verificación requerida antes de integrar

- Expected files: exactamente los diez archivos autorizados.
- Unexpected files: ninguno dentro de `BASE_SHA...BATCH_HEAD`.
- Expected commits: un commit coherente de gobernanza Git.
- Unknown commits: ninguno.
- Migrations: ninguna.
- Regressions: ninguna modificación de código de producto.
- Test coverage: validación estructural de ledger, hooks y protección remota.
- HTML impact: ninguno.
- Verdict pre-commit: **PASS**. Los diez archivos staged coincidieron exactamente con el manifest, `git diff --cached --check` no reportó errores y no hubo código de producto ni migraciones en el diff.

## Cierre de integración

- Batch head: `891c3ef58b65760d611663c34e79822a1975fa58`.
- PR: `#19`.
- Main resultante: `20beadbcdf59c7fac64b7596aad382994c8511ed`.
- Expected files: 10/10.
- Unexpected files: ninguno.
- Expected commits: 1/1.
- Unknown commits: ninguno.
- Migrations: ninguna.
- Regressions: no se modificó código de producto.
- Test coverage: ledger 72/8/45, sintaxis del generador, JSON, hook y protección remota verificados.
- HTML impact: ninguno.
- Vercel: proyecto principal `control-de-facturas` SUCCESS por Ignored Build Step; el proyecto histórico `control-facturas-surface-recovery` falló y no forma parte del target principal.
- Verdict post-merge: **PASS**.

La actualización de cierre autoriza exclusivamente cambios en `APPLIED-CHANGES.md` y este manifest.

---

# BATCH MANIFEST — Batch 02 Pricing / Flywheel

## Identidad

- Batch: `02-PRICING-FLYWHEEL`.
- Rama: `batch/02-pricing-flywheel`.
- Base SHA: `c60b26787358ad1b698fa8bf3380bd6ccda3c02d`.
- HEAD esperado: cambios exclusivos del Batch 2, sin incorporar historia ajena.
- Objetivo: separar compra efectiva, cotización vigente, precio adoptado, CPP y estimación; impedir que una OC se registre como FACTURA sin evidencia de precio de línea.

## Archivos autorizados

- `BATCH-MANIFEST.md`
- `IMPLEMENTATION_REPORT-BATCH-02.md`
- `lib/costing/cost-budget.ts`
- `lib/costing/project-prices.ts`
- `lib/costing/price-list.ts`
- `lib/procurement/flywheel.ts`
- `app/(internal)/projects/[id]/costeo-actions.ts`
- `app/(internal)/projects/[id]/costeo-section.tsx`
- `app/(internal)/precios/page.tsx`
- `app/(internal)/precios/prices-section.tsx`
- `test/costing.test.ts`
- `lib/costing/__tests__/project-prices.spec.ts`
- `lib/costing/__tests__/set-project-cost-price-action.spec.ts`
- `lib/procurement/__tests__/flywheel-invoice-evidence.spec.ts`
- `lib/procurement/__tests__/pricing-flow-through.spec.ts`

No se autorizan otros archivos. Si la implementación requiere ampliar este listado o modificar schema, detenerse y reportar antes de hacerlo.

## Tests autorizados/esperados

- Tests específicos de pricing, price list, Costeo, Plan Semanal y Flujo de Caja.
- Tests del invoice flywheel con y sin evidencia de precio de línea.
- `npx tsc --noEmit`.
- `npx vitest run --maxWorkers=1`.
- `npx next build --webpack` con variables públicas ficticias locales, sin credenciales productivas.

## Commits históricos autorizados

- Ninguno, salvo entrada exacta en `RESCUE-ALLOWLIST.md`.

## Commits históricos prohibidos

- Todos los commits no indicados arriba.
- Todo merge/rango de ramas `recovery/*`.

## Migraciones

- Estado según `DB_REALITY_MAP`: trabajar con el esquema existente confirmado por Batch 0.
- Migraciones nuevas permitidas: ninguna. Si falta una columna/tabla, detenerse y reportar el gap exacto y la migration mínima propuesta sin crearla.
- Migraciones históricas que no pueden editarse: todas.
- Supabase producción no se modifica; no se aplican migrations.

## Alcance funcional

- Incluye: resolver y exponer por separado compra efectiva (`FACTURA`/`RECEPCION`), cotización, precio adoptado por contexto, CPP, estimación y referencias APU/manual; mantener cotización fuera de la selección automática; exigir evidencia de línea antes de escribir una observación `FACTURA`; regresiones de Costeo, Plan Semanal y Flujo de Caja.
- Excluye: RFQ 2.0, adjudicación, Direct Purchase, inventario canónico, Forecast, mano de obra, Tender → Project, Migration Ledger Repair, Certificate CAS, atomicidad de certificados, cambios de schema, producción, PR y merge.

## Verificación final

- Expected files: exactamente las 15 rutas listadas en “Archivos autorizados”.
- Unexpected files: ninguno.
- Expected commits:
  1. `1c705b51050aad0e73272441f3c197dd6c5f2438` — pricing.
  2. `70077a94917ae6cc6bd7452dfb45adddcf785c3e` — invoice flywheel.
  3. `52b71fae9126aea375461d809216f6c79a804a70` — documentación de auditoría inicial.
  4. `b91b780b013e306540d6a40f5b5f47c975150401` — corrección P1 de provenance.
- Unknown commits: ninguno; la rama parte directamente del SHA base verificado.
- Migrations: ninguna modificada o agregada.
- P1 de provenance: corregido; la cotización adoptada se valida server-side contra empresa, proyecto/RFQ, producto, quote/provider y versión vigente, y el precio factual se obtiene de DB.
- Regressions: ninguna detectada; verificación post-P1: 1.296 PASS / 16 skipped en ejecución serial.
- Test coverage: casos canónicos 1–6; Costeo, Plan Semanal, Flujo de Caja, `tsc` y build PASS.
- HTML impact: UI de pricing/costeo identifica fuentes y decisiones adoptadas.
- Verdict: PASS local; listo para auditoría externa. No mergear desde este batch.

## Batch 03 — RFQ 2.0 FULL AUTOPILOT

Base: `53898dffe0a47a517bfeb31722af2f633a31486f`.
Branch: `batch/03-rfq-2-core`.
Estado: hardening final completo; rama publicada; PR #23 abierto contra `main`; sin merge.
Scope: propósito explícito, modelo canónico RFQ, magic link, versionado, evidencia/reconciliación, comparativo, propuestas, asignación y autorización humanas, preview y confirmación exacta de 1..N OCs; integración con Costeo, MRP y compra directa preservando Pricing Batch 02.
Baseline: DB-INFRA incorporado quirúrgicamente; 148 migrations históricas archivadas con 148/148 SHA256 PASS. Baseline SHA256 `A532E54FB9C3D9A10C4CC2A68C5247057D71DC70D62EA4F4AD2B91B6723C32C5`.
Migrations nuevas: ocho, solo aplicadas a Preview; versiones y hashes inmutables en `IMPLEMENTATION_REPORT-BATCH-03.md`. Producción fuera de alcance.
Preview: `batch-03-rfq-2-validation`, UUID `2325db99-ecb4-4e66-991e-57ff21fbbfb3`, ref `afedslxxtttyqunqmutz`, `ACTIVE_HEALTHY`; nueve migrations en ledger y nueve tablas representativas presentes.
Hardening final: SHA-256 determinístico para snapshots de OC; protección de concurrencia y confirmación idempotente validadas; COST_DISCOVERY bloqueado server-side; provenance, tenant, magic links, versiones y adjuntos validados adversarialmente.
Tests: enfocados RFQ/pricing/procurement 112/112 PASS; suite serial completa 1,345 PASS / 16 skipped; `tsc` y build Webpack PASS.
TypeScript: `npx tsc --noEmit` PASS. Build: `npx next build --webpack` PASS; 58 rutas estáticas.
Navegador real en Preview: invitaciones, proveedor/link, correcciones/versiones, adopción humana, asignación 4+5, autorización, preview/confirmación de dos OCs, COST_DISCOVERY sin compra y compra directa PASS. Pruebas de aislamiento tenant, enlaces, adjuntos y permisos PASS.
Security Advisor: ninguna ruta RFQ anónima nueva; diez RPC RFQ accesibles a `authenticated` aparecen como SECURITY DEFINER por diseño y fueron probadas con guards de actor/empresa. Findings legacy documentados en el reporte.
Producción: no modificada; verificación de solo lectura confirma ledger únicamente en baseline `20261002231537` y `rfqs.purpose` ausente.
Invariantes: el sistema propone, el humano decide; ninguna selección o autorización crea OCs; confirmar el preview exacto es la única vía para generarlas; COST_DISCOVERY no genera OCs.
Límite operativo: la entrega del magic link es manual; no se configuró correo saliente. Las imágenes/escaneos requieren reconciliación humana.
No abrir PR ni mergear desde este batch; listo para auditoría externa.
