# Applied changes ledger

## Baseline pre ERP hardening

- Baseline: `1a71c96279febf6636892143af20f36a0315f5ae`.
- Tag: `baseline-pre-erp-hardening-2026-09-30`, creado localmente y publicado en `origin`.
- Estado: establecido y verificado contra `origin/main` después de `git fetch`.
- Protección remota: PR obligatorio, conversaciones resueltas, force-push/deletion bloqueados y regla aplicada a administradores.

## PHASE -1 — GIT FREEZE

- Base: `1a71c96279febf6636892143af20f36a0315f5ae`.
- Batch head auditado: `891c3ef58b65760d611663c34e79822a1975fa58`.
- PR: `#19`.
- Main final de la integración: `20beadbcdf59c7fac64b7596aad382994c8511ed`.
- Resultado: **ABSORBED BY `20beadbcdf59c7fac64b7596aad382994c8511ed`**.
- Commits históricos rescatados: ninguno.
- Migraciones: ninguna.
- Auditoría: PASS — 10 archivos esperados, 0 inesperados, 0 commits desconocidos.
- Batches integrados después del baseline: ninguno.

## Registro por batch

Cada integración debe agregar:

```text
BATCH <id>
BASE: <sha>
FINAL: <sha>
TAG: closed-batch-<id>
COMMITS HISTÓRICOS:
- <sha>: ABSORBED BY <nuevo sha> / SUPERSEDED / REJECTED / PENDING REVIEW
TESTS:
- <comando y resultado>
AUDITORÍA:
- PASS/FAIL, unexpected files, unknown commits y migraciones
```

No hay cambios de producto absorbidos en esta fase de freeze.
