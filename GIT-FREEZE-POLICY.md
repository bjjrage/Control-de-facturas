# Git freeze y control anti-regresión

## Baseline

- SHA autorizado: `1a71c96279febf6636892143af20f36a0315f5ae`.
- Tag inmutable: `baseline-pre-erp-hardening-2026-09-30`.
- Tag previo conservado: `release-2026-09-29-costeo`.
- La rama `batch/pre-erp-hardening-freeze` nació directamente del SHA autorizado.

Los tags de baseline y cierre no se mueven. Si un tag está equivocado, se documenta y se crea otro; nunca se reemplaza silenciosamente.

## Protección de main

Los hooks versionados de `.githooks/` bloquean localmente:

- commits directos sobre `main`;
- push directo a `main`;
- eliminación de `main`;
- actualización no fast-forward de `main`.

El repositorio local usa `core.hooksPath=.githooks`. La protección remota de GitHub quedó configurada y verificada el 30/09/2026: exige PR, descarta aprobaciones obsoletas, exige resolver conversaciones, bloquea force-push y deletion, y se aplica a administradores. No se exigieron status checks porque todavía no se definió el conjunto estable de checks obligatorios para todos los batches.

## Preflight obligatorio

Antes de cada batch ejecutar:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git log -1 --oneline
git fetch origin
git rev-parse origin/main
```

Detener el trabajo si el worktree no está limpio, la rama no es `batch/*`, el HEAD/base no coincide con el main esperado, `origin/main` no es conocido o aparecen commits no registrados entre el base y la rama.

## Operaciones prohibidas durante un batch

```text
git merge <rama histórica>
git rebase sobre rama histórica
git stash pop
git stash apply
git reset --hard
git clean -fd
git pull con merge automático
git cherry-pick <SHA no autorizado>
git push --force
```

Las ramas `recovery/erp-functional-rebuild` y `recovery/restore-legacy-surface-contract` jamás se integran completas ni por rango. Sólo se permite rescatar commit, archivo o hunk exacto incluido en `RESCUE-ALLOWLIST.md`.

## Ciclo de un batch

1. Crear rama corta desde el `origin/main` verificado.
2. Completar `BATCH-MANIFEST.md` antes de editar.
3. Limitar archivos, migraciones y commits históricos al manifest.
4. Hacer commits coherentes y específicos.
5. Auditar `BASE_SHA...BATCH_HEAD` y clasificar archivos, commits y migraciones.
6. Ejecutar tests declarados y auditoría Codex read-only.
7. Bloquear integración si existe un `UNKNOWN COMMIT` o archivo inesperado.
8. Integrar únicamente después de PASS.
9. Crear `closed-batch-<id>` sin mover tags anteriores.
10. Actualizar `APPLIED-CHANGES.md` y `GIT-LEDGER.md` con el SHA final.
