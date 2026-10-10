# QA ADMIN REMEDIATION 3 — REPORT

> Historical implementation report. The autonomous transactional completion in
> `docs/remediation-3-release.md` and the exact-head Release Certification workflow
> supersede the former pending-migration and check-then-insert limitations below.
> PGlite results below are sequential WASM PostgreSQL tests, not independent-session
> concurrency evidence. Production has not been modified.

**Branch:** `fix/qa-admin-remediation-3` (base: `origin/main` = `a56c0e199deda4a35a658b290d19d7b17ee4efa3`)

- COMMITS CONOCIDOS:
  - `a8d2af8` — implementación (fix: item-level invoice reconciliation and invoice parser hardening).
  - `8194005` — documental (report + handoff).
  - `f7b997c` — revisión de seguridad R3-01…R3-04.
  - Final Integrity Hardening H1…H4 (commits focalizados de este ciclo, ver §12).
- **Estado:** ver §12 (veredicto final). NO merge, NO deploy, NO migraciones aplicadas. Se espera autorización.

---

## 1. Alcance

Resolver BUG-038 (cantidades facturadas por ítem) y PARSER-001 (hardening del extractor)
sin rediseñar el ERP, sin módulos nuevos, sin cambiar reglas comerciales certificadas,
sin migraciones, sin tocar Producción.

## 2. BUG-038 — causa raíz confirmada (investigación §6)

Pipeline real reconstruido Documento → trigger:

1. `extractInvoiceFromPhoto` devuelve campos + `items[]`, pero `createInvoice` los
   **descartaba**: persistía solo cabecera. El diálogo no envía líneas.
2. `linkInvoiceToOrder`/`autoMatchInvoice`/`matchOrder` crean solo
   `invoice_order_matches` (nivel financiero).
3. `quantity_invoiced` solo se recalcula por `trg_recompute_order_item_qty` sobre
   `invoice_item_matches`, tabla que **solo escribe el worker bulk** (flujo masivo, no el
   diálogo QA). `matchInvoiceItemsToOrderItems` (GPT) sin llamadores fuera del worker.
4. Resultado: match de cabecera correcto, `quantity_invoiced = 0` permanente.
5. Encima no existe UI de líneas ni de conciliación manual por ítem en facturas.
6. Desvincular/eliminar solo tocaba la cabecera → riesgo de cantidades fantasma.

Respuestas §6: (1) solo worker bulk persistía líneas; (2) no podían corregirse; (3) sí se
podía vincular sin desglose; (4) no existía conciliación manual por ítem; (5) parciales sin
desglose quedaban en cero; (6/7) desvincular/eliminar dejaba residuos; (8) corrección
imposible sin UPDATE; (9) RLS por `empresa_id` con policies insert/select/delete en ambas
tablas; (10) solo 1:1 con producto+cantidad+unidad compatibles y datos aritméticos válidos.

## 3. BUG-038 — implementación (modelo existente, sin duplicar)

- `lib/invoice-items.ts` (nuevo): `parseInvoiceLinesInput` (sanea entradas),
  `insertInvoiceItems` (mismo shape que el worker), `applyDeterministicItemMatches`
  (solo caso inequívoco 1:1, cantidad propia de la línea, dentro del remanente, sin
  duplicados; **nunca divide totales por precios**), `deleteItemMatchesForLink`,
  `deleteInvoiceItems` (CASCADE + trigger recalculan).
- `lib/invoice-item-reconcile.ts` (nuevo): `suggestInvoiceItemMatches` (puro),
  `validateManualItemMatch` (tenant, estado, unidad, producto salvo 1:1, duplicado,
  cantidad; over-remanente = warning, no error), normalización de unidades/descripciones.
- Integración: `createInvoice` persiste líneas del diálogo (`items_json`) y aplica
  determinístico sobre el vínculo; `linkInvoiceToOrder`/`matchOrder` idem (devuelven
  `itemMatched/itemPending`); `resolveInvoiceJob` persiste líneas del job; `unmatchOrder`
  limpia matches del vínculo; `deleteInvoice` borra líneas (CASCADE + trigger); líneas
  congeladas en APTO_PARA_PAGO/PAGADO en manual, auto-match y UI.
- UI: diálogo con tabla editable de líneas + aviso aritmético; detalle de factura con
  sección «Líneas y conciliación por ítem» (agregar/corregir/eliminar líneas, imputar/
  quitar manual con selector de ítem de OC, estados «Sin conciliar», aviso de remanente).
- B11 intacto: guard DB de vínculos liquidados respetado (cabecera primero); spec B11
  extendido con allowlist de las 4 tablas y filtros de limpieza acotados.
- UI de OC sin cambios visuales salvo que `quantity_invoiced` ahora sí refleja matches.

## 4. PARSER-001 — implementación

- Prompts foto/PDF: null ante ilegible **incluido el total**; prohibido estimar/inventar/
  completar. Schema acepta `total` null.
- `lib/invoice-arithmetic.ts` (nuevo): validador determinístico — líneas
  (qty×pu=subtotal), amarre suma-líneas vs subtotal/total, subtotal+IVA=total (±1 PYG),
  IVA 5/10, exentos, mixtos, descuentos no desagregados → REVISION; total null/no
  positivo → REVISION. Estados VALIDA/REVISION (sin persistencia nueva).
- `extractInvoiceFromPhoto` adjunta `validation`; el diálogo muestra el aviso y envía
  las líneas; el worker deriva a `needs_review` con motivo explícito ante inconsistencia
  (los mixtos/exentos sin desglose ahora van a revisión en vez de crearse).

## 6. Revisión de seguridad R3-01…R3-04

Auditoría posterior a la implementación inicial: cuatro debilidades detectadas y
corregidas sobre el mismo modelo (sin migraciones, sin RLS, sin SQL).

### R3-01 — Imputación solo a la OC vinculada (backend)

- **Debilidad:** `createInvoiceItemMatch` validaba el ítem de OC por `empresa_id`, pero
  no exigía que perteneciera a la OC **vinculada** a la factura: un usuario podría
  imputar a cualquier OC del tenant.
- **Fix:** `getHeaderLink` (`lib/invoice-items.ts`) verifica el vínculo vigente
  `invoice_order_matches` (falla cerrado ante error de consulta); la acción exige
  `order_item.order_id === link.orderId` antes de insertar; se revalida el vínculo
  tras insertar y, si cambió (carrera con desvinculación), se elimina el match huérfano
  y se auditа `invoice.item_match_voided_race` (convergencia por trigger).
- **Límite documentado:** sin transacción/RPC no hay atomicidad estricta check↔insert;
  la garantía es convergencia + auditoría, no aislamiento fuerte.

### R3-02 — Integridad de cantidades a nivel acción

- **Debilidad:** el validador solo avisaba (warning) cuando la cantidad superaba el
  remanente de la OC; no existía tope por cantidad **documentada** de la línea ni
  consideraba matches existentes de la misma línea hacia otros ítems.
- **Fix (`validateManualItemMatch`):** cantidad nula/no finita rechazada; suma de
  matches existentes de la línea + nueva imputación ≤ cantidad documentada; nueva
  imputación ≤ remanente de OC; unidad incompatible rechazada; duplicados rechazados.
  No se encontró mecanismo que autorice exceder cantidades (`invoice_exceptions` solo
  cubre sobrefacturación financiera), así que el exceso **se rechaza**, no se avisa.
- **Insert compartido:** `insertValidatedItemMatches` (usado por diálogo, corrección y
  worker bulk) re-verifica vínculo, topes documentado/remanente y duplicados en cada
  propuesta; lo omitido vuelve a pendiente, nunca se contabiliza.
- **Esquema:** el tipo es `numeric` sin regla de enteros; se aceptan fracciones
  finitas (p. ej. 2500.5) y se rechazan NaN/Infinity/negativas/cero.

### R3-03 — Corrección de líneas sin pérdida (insert-first)

- **Debilidad:** `updateInvoiceItem` implementaba baja+alta: si el INSERT posterior
  fallaba, la línea original ya se había eliminado (pérdida irreversible + matches
  CASCADE borrados).
- **Fix:** inserta primero la versión corregida; recién entonces elimina la original;
  si el DELETE falla, compensa borrando la versión nueva y auditа
  `invoice.item_correction_failed` (nunca informa éxito parcial). Tras corrección
  exitosa se revalida la conciliación de forma determinística (solo caso inequívoco):
  si sigue correspondiendo, se re-imputa automáticamente; si no, queda sin conciliar
  (el trigger recalcula).

### R3-04 — Confirmación aritmética explícita y auditada

- **Debilidad:** el diálogo y `resolveInvoiceJob` confiaban en el estado del cliente:
  no se recalculaba la aritmética server-side al momento de crear la factura.
- **Fix:** `createInvoice` y `resolveInvoiceJob` recalculan `validateInvoiceArithmetic`
  sobre los valores **finales** que se intentan guardar; ante discrepancias exigen
  checkbox `arithmetic_confirmed` (enviado por el diálogo), y la confirmación queda
  auditada en `invoice.created` (`detail.arithmetic_review: "confirmed"`). La carga
  manual legítima con valores consistentes no pide nada extra.

## 12. FINAL INTEGRITY HARDENING (H1…H4)

### H1 — Servicio compartido con invariantes propias

`insertValidatedItemMatches` (`lib/invoice-items.ts`) ya no confía en sus
llamadores: verifica factura existente/de la empresa/en estado editable
(PENDIENTE/MATCH/REQUIERE_REVISION, misma regla que `itemMutationsAllowed`),
titularidad exacta línea→factura (`line.invoice_id === invoiceId`), vínculo de
cabecera, pertenencia del ítem a la OC vinculada, unidad compatible y
correspondencia de producto (réplica de las reglas TS, con bypass 1:1
calculado con conteos reales), cantidad documentada válida, suma de matches
**previamente persistidos** (leídos de DB, fail-closed) + batch ≤ documentado,
remanente, y duplicados (antes que los topes: reintento = idempotencia).
Contador nuevo `skippedMismatch`; `applyDeterministicItemMatches` lo suma a
pendientes. 15 tests nuevos (servicio directo con persistencia real del fake +
trigger): línea de otra factura/empresa, ítem de otra OC, sin vínculo, freeze,
completar hasta documentado, exceso, batches, error de consulta fail-closed,
reintento, worker con refs inconsistentes.

### H2 — Concurrencia y RPC transaccional mínima

Investigación DB: sin mecanismo transaccional reutilizable para matches
(trigger canónico AFTER recomputa SUM; UNIQUE por par; CHECK qty>0; FK con
CASCADE; RLS por `current_empresa_id()`; sin constraint de sumas). Hallazgo
favorable: `mark_invoice_apto_para_pago` ya bloquea la fila de invoices
(`FOR UPDATE`) y el gate B11 `private.b11_require_financial_actor` es el
patrón canónico — la RPC propuesta los reutiliza.
Migración **PENDING** (solo versionada en `supabase/migrations_pending/`,
jamás auto-aplicable; NO aplicada en ningún remoto):
`create_invoice_item_match` (12 verificaciones con locks en orden fijo
invoices→vínculo→línea→ítem, lecturas post-lock, duplicado idempotente +
handler `unique_violation` para la carrera, auditoría en-txn) y helpers
SQL réplica de unidad/producto. Orden de locks evita el ciclo con unmatch;
re-verificación de estado post-lock da exclusión mutua con aprobación.
Escritores directos restantes: solo borrados (dirección segura, convergentes
por trigger); el cutover post-aprobación migra los dos inserts a la RPC.
Validación funcional en PostgreSQL real local (PGlite):
`test/invoice-item-match-rpc-pglite.test.ts` **23/23** (incl. 42501
cross-tenant, rol denegado, vía service_role, rollback). Concurrencia real
con locks: **BLOCKED** (sin PG multitono local: sin binarios pg, docker
daemon caído tras intento de arranque >4 min, PGlite monoproceso). Pasos
detallados en `migrations_pending/README.md`.

### H3 — Corrección atómica

Evaluado UPDATE directo: **imposible en runtime** (sin policy UPDATE en
`invoice_items`: solo ii_delete/insert/select — verificado en migraciones).
Vía TS mantiene insert-first pero con regla de errores exacta: si la
compensación falla, el mensaje dice "revisión humana / nada válido" y NO
afirma restauración (test nuevo). Vía transaccional real:
`correct_invoice_item` (misma migración PENDING): UPDATE in-place (mismo id,
sin CASCADE), revalidación de matches con bajas explícitas auditadas, tope
anti-sobre-imputación, rollback total ante cualquier error — validada en
PGlite (6/6: happy path, rollback, drop obsoleto + trigger, freeze,
inexistente, validación).

### H4 — Diferencial de baseline real

Comparación contra `a56c0e1` (main pre-Remediation 3) en worktree temporal
limpio, mismo Node/vitest/dependencias (junction a node_modules): los 7 tests
fallan **idéntico** (mismo modo STACK_TRACE_ERROR en beforeEach PGlite) en
baseline y rama; la rama no toca ninguno de esos 7 archivos
(`git diff origin/main...HEAD --name-only` verificado). Clasificación: 7
preexistentes ambientales (PGlite/WASM bajo carga) + 1 flaky (segundo test de
final-recovery bajo paralelismo; pasa 11/11 solo). **0 regresiones.**
Corolario: en serial (`--no-file-parallelism`, mandato §11) la suite da
**2091 PASS / 16 skipped / 0 FAIL** — los ambientales también pasan.

### Validación final

| Control | Resultado |
|---|---|
| Suite serial completa | **2091 PASS / 16 skipped / 0 FAIL** (191 archivos) |
| Tests nuevos del ciclo | H1: 15 · RPC PGlite: 23 · H3: 1 (total rama +39) |
| Focalizados §8/§11 | 82/82 (parser, B11 ×3, payment-terms, multitenant) |
| Typecheck | PASS |
| Build | PASS (22.8s) |
| Lint (archivos del diff) | 0 errores (warnings preexistentes) |
| Migración aplicada | NINGUNA (PENDING versionada, 0 ramas Preview, 0 cambios RLS) |
| Producción modificada | NO · Deploy: NO · SIFEN: NO |

### Veredicto

- READY FOR PR REVIEW: **NO** — falta verificación de concurrencia real con
  locks (BLOCKED) y la migración requiere aprobación antes del cutover.
- REQUIRES MIGRATION APPROVAL: **SÍ** (para atomicidad fuerte; el runtime
  actual no depende de ella).
- ATOMICITY VERIFIED: **NO** (lógica secuencial 23/23 en PG real; contención
  pendiente de PG multitono).
- Criterio §15: 1–4, 6–11 cumplidos y evidenciados; 5 parcial (diseño +
  funcional, sin prueba de contención); 12 cumplido (migración preparada sin
  aplicar).

## 7. Tests (§10 + parser + R3 + H1…H4)

- `test/invoice-item-reconcile.test.ts` (36): unidades, 1:1 3000/2500, parciales
  acumulados, dos productos, sin líneas, unidad incompatible, ambiguo, over-remanente
  ahora **rechazado** (R3-02), no-división, manual (válido/tenant/unidad/producto/
  duplicado/over-documentado/over-remanente/cantidad/congelado).
- `test/invoice-item-matches-actions.test.ts` (55): vínculo→2500/pendiente 500,
  parciales, no-duplicar, sin líneas, unidad incompatible, over pendiente, producto ajeno,
  tenant ajeno, desvincular sin residuos, eliminar sin fantasmas, pagada congelada,
  corrección→re-imputa automáticamente, auto-match congelado en APTO, más R3-01 (OC
  vinculada/otra OC/empresa ajena/sin vínculo/vínculo eliminado/línea de otra factura/
  error de consulta fail-closed/carrera desvincular-vs-imputar) y R3-02 (exacta/menor/
  mayor/mayor por acción/fracción finita/dos matches sumados/dos facturas compiten/
  reintento idéntico/congelada) y R3-03 (fallo INSERT conserva todo/fallo DELETE
  compensa/error de validación intacto/error de permisos intacto/segunda corrección/
  factura aprobada congelada), más H1 (15: servicio compartido directo con
  persistencia real — titularidad, freeze, topes con previos, batches, mismatch,
  fail-closed, idempotencia, worker inconsistente) y H3 (compensación fallida:
  mensaje exacto sin falsa restauración).
- `test/invoice-item-match-rpc-pglite.test.ts` (23, NUEVO): migración PENDING sobre
  PostgreSQL real local — helpers SQL, create (happy/trigger/auditoría, topes,
  titularidad, vínculo, freeze, unidad, idempotencia, acumulado, 42501, roles,
  service_role) y correct (in-place, rollback, drop obsoleto, freeze, validación).
- `test/invoice-arithmetic.test.ts` (14): prompts, línea/total inconsistentes, total null,
  ±1 PYG, mixto válido, subtotal fusionado erróneo, exentos/descuento, ausentes, no positivos.
- `test/invoice-extract-validation.test.ts` (4): validación adjunta, INV-12, null total, errores.
- `lib/__tests__/b11-unmatch-action.spec.ts`: extendido (allowlist + filtros de limpieza).
- Sin correcciones retroactivas: facturas históricas sin desglose muestran «Sin conciliar».

## 8. Validación (final — supersede tablas anteriores)

Ver tabla "Validación final" en §12. Resumen: suite serial **2091 PASS /
16 skipped / 0 FAIL**; typecheck PASS; build PASS; lint 0 errores; E2E 61
pasos no repetido (según misión).

## 9. Infraestructura

- Producción DB modificada: NO · Migraciones aplicadas: NO · Migración PENDING
  versionada: 1 (`migrations_pending/`, no auto-aplicable) · Nuevas Supabase branches: 0
- Deploy: NO · SIFEN: NO · Commits: `a8d2af8` + `8194005` + `f7b997c` + hardening (este ciclo)

## 10. Archivos (diff acumulado de la rama + hardening)

```
M  QA_ADMIN_REMEDIATION_3_HANDOFF.md
M  QA_ADMIN_REMEDIATION_3_REPORT.md
M  app/(internal)/invoices/[id]/actions.ts
M  app/(internal)/invoices/[id]/invoice-lines-section.tsx
M  app/(internal)/invoices/actions.ts
M  app/(internal)/invoices/invoice-dialog.tsx
M  app/(internal)/invoices/revision/actions.ts
M  app/(internal)/invoices/revision/revision-dialog.tsx
M  lib/invoice-item-reconcile.ts
M  lib/invoice-items.ts
M  test/invoice-item-matches-actions.test.ts
M  test/invoice-item-reconcile.test.ts
M  worker/index.ts
A  supabase/migrations_pending/20261010000000_invoice_item_match_atomic_PENDING.sql
A  supabase/migrations_pending/README.md
A  test/invoice-item-match-rpc-pglite.test.ts
```

## 11. Riesgos residuales

- Concurrencia check↔insert en runtime (sin RPC aplicada): mitigada por H1 +
  revalidación + auditoría, pero sin atomicidad fuerte hasta cutover post-aprobación.
- Contención real con locks: NO verificada (BLOCKED); diseño documentado y funcional 23/23.
- La conciliación automática solo cubre el caso inequívoco; facturas multi-producto con
  descripciones distintas requieren imputación manual explícita (por diseño).
- Exentos/mixtos/descuentos sin desglose van a revisión (brecha de schema documentada).
- `matchInvoiceItemsToOrderItems` (GPT) pasa por `insertValidatedItemMatches` (validado);
  el motor semántico en sí no fue auditado en profundidad.
- Ground truth QA de 40 documentos intacto (sin modificar).
