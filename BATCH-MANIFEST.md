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
- Verdict pre-commit: **PASS**. Los diez archivos staged coinciden exactamente con el manifest, `git diff --cached --check` no reportó errores y no hay código de producto ni migraciones en el diff. La integración sigue sujeta a auditoría post-commit.
