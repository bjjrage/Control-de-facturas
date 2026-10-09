# QA ADMIN REMEDIATION 3 — HANDOFF

Continuación sin depender de la conversación previa. Branch `fix/qa-admin-remediation-3`
pusheada, esperando revisión humana. **Sin merge, deploy ni migraciones.**

## Estado Git

- Base `origin/main`: `a56c0e199deda4a35a658b290d19d7b17ee4efa3` (verificado con
  `git fetch origin` + `git rev-parse`; incluye PR #34, #35, #36; sin drift).
- Branch creada desde esa base; no se trabajó en `main`; no se reutilizaron branches.
- Commits: `a8d2af8` implementación + documental (este archivo y REPORT).
  HEAD final exacto: `git rev-parse HEAD` sobre la branch (informado en el chat).
- Untracked/stashes ajenos preservados (audit-artifacts, planillas-ejemplo, MAGY temporal).

## Qué se hizo y por qué

- BUG-038: el diálogo de facturas descartaba `items[]` del extractor y solo creaba el
  match financiero; `quantity_invoiced` depende de `invoice_item_matches` (trigger),
  tabla que solo escribía el worker bulk. Fix: persistir líneas revisadas, crear matches
  solo en el caso inequívoco 1:1 con cantidad propia, UI de líneas + imputación manual,
  limpieza en desvincular/eliminar, congelado en APTO/PAGADO. Reglas §7/§8 cumplidas
  (dos niveles, sin conciliar ≠ cero, división total/precio prohibida y ausente).
- PARSER-001: prompts con null total, validador aritmético determinístico
  (`lib/invoice-arithmetic.ts`), aviso en diálogo, worker a `needs_review` ante
  inconsistencia. Reglas §13–§15: null/estados/aritmética sin persistencia nueva.

## Cómo re-verificar

```powershell
git fetch origin
git checkout fix/qa-admin-remediation-3
npx tsc --noEmit
npx vitest run --no-file-parallelism   # 2019 PASS / 16 skipped / 0 FAIL esperados
npm run build
npx eslint <archivos del diff>         # solo error preexistente invoices/actions.ts:453
```

## Pendiente / próximo paso

1. Revisión humana + PR contra `main` (NO crear sin autorización) + merge/deploy autorizados.
2. Re-test focalizado sugerido (post-merge, entorno QA): factura parcial 2500/3000 →
   Facturado 2500/Pendiente 500 en la OC; factura inconsistente → aviso + revisión.
3. NO repetir 61 pasos todavía (según misión). NO tocar Producción.
