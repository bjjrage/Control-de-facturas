# Applied changes ledger

## Baseline pre ERP hardening

- Baseline: `1a71c96279febf6636892143af20f36a0315f5ae`.
- Tag: `baseline-pre-erp-hardening-2026-09-30`, creado localmente y publicado en `origin`.
- Estado: establecido y verificado contra `origin/main` después de `git fetch`.
- Protección remota: PR obligatorio, conversaciones resueltas, force-push/deletion bloqueados y regla aplicada a administradores.
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
