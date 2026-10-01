# Rescue allowlist

Sólo los elementos marcados **PERMITIDO** pueden recuperarse de historia. La inclusión autoriza exclusivamente los archivos/hunks descritos y no autoriza merge de rama, cherry-pick por rango ni aplicación de stash.

## 746549c2b007e327daacbfce67b77bf6439a9aff — BIM routing

- Origen: `codex/bim-tab-routing`.
- Estado: **PERMITIDO** para `batch/04-planning-bim`.
- Permitido: comparar y rescatar los hunks de routing/acceso BIM en `app/(internal)/projects/[id]/page.tsx`, `app/(internal)/projects/[id]/project-tabs-client.tsx` y los tests BIM relacionados.
- Requiere revisión separada: `components/layout/sidebar.tsx`, `lib/access-policy.ts` y `lib/auth.ts`.
- Prohibido: merge completo de la rama o incorporar cambios globales de auth sin manifest y auditoría específica.

## eb52c146696d4182a96939711ec1ec299ccb98c5 — test de cómputo

- Origen: `feature/computo-metrico-import`.
- Estado: **PERMITIDO** para `batch/04-planning-bim`.
- Permitido: rescatar/adaptar únicamente `lib/computo/__tests__/computo-actions.spec.ts` contra el contrato actual.
- Prohibido: asumir que el test histórico sigue siendo válido sin ejecutar y revisar sus fixtures.

## d77d61d — ajuste negativo de Tesorería

- Origen: commit histórico ya contenido y posteriormente revertido en main.
- Estado: **PERMITIDO COMO REFERENCIA** para `batch/01-integrity`.
- Permitido: consultar el diff y reimplementar el comportamiento con tests actuales.
- Prohibido: cherry-pick directo; el commit fue revertido por una razón histórica que debe revalidarse.

## 0879e006f3b478ebae01bd22b341ff444282471c — migración de inventario

- Origen: `fix/inventory-partial-upload-resolution`.
- Estado: **NO PERMITIDO TODAVÍA**.
- Motivo: altera una migración histórica; requiere primero `batch/00-db-reality` y evidencia del esquema aplicado.
- Acción: revisar el diff como evidencia, sin copiar ni editar la migración existente.

## 595abc7f01b6d7c8c4b5d1bac798cd0f0f86e1d0 — Scanner→factura

- Origen: `feature/scanner-invoice-integration`.
- Estado: **SUPERSEDED — NO RESCATAR**.
- Motivo: main contiene una implementación posterior que valida `scanner_session_id`, tenant, estado y contexto del lado servidor.

## 432d82f5bdb9bf58fa14ce7f59150d5105217178 — Auction Lab polling

- Origen: `feature/auction-lab`.
- Estado: **SUPERSEDED — NO RESCATAR**.
- Motivo: main contiene una implementación posterior del controlador y del sandbox.

## Ramas recovery

- `recovery/erp-functional-rebuild`: **NO PERMITIDO COMO MERGE NI RANGO**.
- `recovery/restore-legacy-surface-contract`: **NO PERMITIDO COMO MERGE NI RANGO**.
- Cualquier rescate futuro requiere una entrada nueva con SHA, archivo/hunk, batch y justificación exactos.
