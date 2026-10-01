# BATCH MANIFEST — Fase -1 Git freeze

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
