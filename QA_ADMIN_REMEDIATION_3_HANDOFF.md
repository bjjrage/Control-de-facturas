# QA ADMIN REMEDIATION 3 — HANDOFF

Continuación sin depender de la conversación previa. Branch `fix/qa-admin-remediation-3`
pusheada, esperando revisión humana. **Sin merge, deploy ni migraciones.**

## Estado Git

- Base `origin/main`: `a56c0e199deda4a35a658b290d19d7b17ee4efa3` (verificado con
  `git fetch origin` + `git rev-parse`; incluye PR #34, #35, #36; sin drift).
- Branch creada desde esa base; no se trabajó en `main`; no se reutilizaron branches.
- Commits: `a8d2af8` implementación + `8194005` documental + `f7b997c`
  seguridad R3-01…R3-04 + hardening H1…H4 (HEAD final informado en el chat).
- Untracked/stashes ajenos preservados (audit-artifacts, planillas-ejemplo, MAGY temporal).

## FINAL INTEGRITY HARDENING (H1…H4) — ver REPORT §12

- **H1:** `insertValidatedItemMatches` con 12 invariantes propias (factura,
  empresa, estado PENDIENTE/MATCH/REQUIERE_REVISION, titularidad línea→factura,
  vínculo, ítem→OC, unidad, producto con bypass 1:1 real, documentada con
  previos persistidos, remanente, duplicado-antes-que-topes) + `skippedMismatch`
  + 15 tests directos con persistencia real.
- **H2:** sin mecanismo transaccional reutilizable (verificado); migración
  **PENDING** en `supabase/migrations_pending/` (NO auto-aplicable, NO aplicada):
  `create_invoice_item_match` (locks invoices→vínculo→línea→ítem, lecturas
  post-lock, idempotencia + handler unique_violation, gate B11, auditoría
  en-txn) + helpers SQL de unidad/producto. Reutiliza `FOR UPDATE` de approve
  (exclusión mutua) y evita ciclo con unmatch por orden de locks. Funcional
  23/23 en PG real local (PGlite). **Contención real BLOCKED** (sin PG
  multitono: sin binarios, docker daemon caído >4 min, PGlite monoproceso).
- **H3:** UPDATE runtime imposible (sin policy UPDATE en invoice_items);
  mensaje TS exacto ante compensación fallida (test nuevo) + `correct_invoice_item`
  RPC (in-place, revalidación, rollback total) validada 6/6 en PGlite.
- **H4:** 7 tests fallan idéntico en `a56c0e1` y rama (worktree limpio, mismo
  env) → preexistentes ambientales + 1 flaky; rama no toca esos archivos.
  **0 regresiones.** En serial: **2091 PASS / 16 skipped / 0 FAIL**.
- **Veredicto: NO READY FOR PR** (falta contención real + aprobación de
  migración). `REQUIRES MIGRATION APPROVAL: SÍ`. `ATOMICITY VERIFIED: NO`.

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
- **Revisión de seguridad R3-01…R3-04** (ver REPORT §6): imputación solo a la OC
  vinculada verificada en backend (`getHeaderLink` + revalidación post-insert contra
  carrera con desvinculación); topes de cantidad (documentada de la línea sumando sus
  matches + remanente de OC) rechazando excesos en lugar de solo avisar; corrección de
  líneas insert-first con compensación (sin pérdida ante fallo de INSERT/DELETE);
  confirmación aritmética server-side con checkbox auditado en `createInvoice` y
  `resolveInvoiceJob`. El worker bulk ahora pasa por `insertValidatedItemMatches`
  (mismas invariantes que la vía del diálogo).

## Cómo re-verificar

```powershell
git fetch origin
git checkout fix/qa-admin-remediation-3
npx tsc --noEmit
npx vitest run --no-file-parallelism   # 2091 PASS / 16 skipped / 0 FAIL esperados
npm run build
npx eslint "app/(internal)/invoices/**/*.{ts,tsx}" "lib/invoice-*.ts" "worker/index.ts" "test/invoice-*.test.ts"
                                       # 0 errores (2 warnings preexistentes en invoices-section.tsx)
npx vitest run --no-file-parallelism test/invoice-item-match-rpc-pglite.test.ts  # 23/23 (migración PENDING)
```

Nota: los 8 FAIL de la suite corresponden a 7 archivos de migraciones/schedule/
certificados que fallan igual en un worktree limpio de `8194005` (preexistentes, no
tocados por esta rama); `lib/__tests__/final-recovery-integrity.spec.ts` es flaky
bajo carga paralela y pasa solo (11/11).

## Limitación conocida (R3-01)

No existe transacción/RPC autorizada para hacer atómica la comprobación de remanente
con la inserción bajo concurrencia. La garantía actual es: revalidación del vínculo
post-insert (elimina match huérfano si la desvinculación concurrente aterrizó),
auditoría `invoice.item_match_voided_race` y convergencia por trigger. Para atomicidad
estricta se necesitaría una RPC SECURITY DEFINER con transacción (fuera del alcance
autorizado: sin migraciones, sin SQL, sin RLS).

## Pendiente / próximo paso

1. Revisión humana + PR contra `main` (NO crear sin autorización) + merge/deploy autorizados.
2. Re-test focalizado sugerido (post-merge, entorno QA): factura parcial 2500/3000 →
   Facturado 2500/Pendiente 500 en la OC; factura inconsistente → aviso + checkbox +
   revisión; imputación manual a OC distinta de la vinculada → rechazada en backend.
3. NO repetir 61 pasos todavía (según misión). NO tocar Producción.
