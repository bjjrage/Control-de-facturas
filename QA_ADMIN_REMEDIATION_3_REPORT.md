# QA ADMIN REMEDIATION 3 — REPORT

**Branch:** `fix/qa-admin-remediation-3` (base: `origin/main` = `a56c0e199deda4a35a658b290d19d7b17ee4efa3`)

- COMMITS CONOCIDOS:
  - `a8d2af8` — implementación (fix: item-level invoice reconciliation and invoice parser hardening).
  - `8194005` — documental (report + handoff).
  - Revisión de seguridad R3-01…R3-04 (commiteada en este ciclo).
- **Estado:** listo para revisión. NO merge, NO deploy, NO migraciones. Se espera autorización.

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

## 7. Tests (§10 + parser + R3)

- `test/invoice-item-reconcile.test.ts` (36): unidades, 1:1 3000/2500, parciales
  acumulados, dos productos, sin líneas, unidad incompatible, ambiguo, over-remanente
  ahora **rechazado** (R3-02), no-división, manual (válido/tenant/unidad/producto/
  duplicado/over-documentado/over-remanente/cantidad/congelado).
- `test/invoice-item-matches-actions.test.ts` (39): vínculo→2500/pendiente 500,
  parciales, no-duplicar, sin líneas, unidad incompatible, over pendiente, producto ajeno,
  tenant ajeno, desvincular sin residuos, eliminar sin fantasmas, pagada congelada,
  corrección→re-imputa automáticamente, auto-match congelado en APTO, más R3-01 (OC
  vinculada/otra OC/empresa ajena/sin vínculo/vínculo eliminado/línea de otra factura/
  error de consulta fail-closed/carrera desvincular-vs-imputar) y R3-02 (exacta/menor/
  mayor/mayor por acción/fracción finita/dos matches sumados/dos facturas compiten/
  reintento idéntico/congelada) y R3-03 (fallo INSERT conserva todo/fallo DELETE
  compensa/error de validación intacto/error de permisos intacto/segunda corrección/
  factura aprobada congelada).
- `test/invoice-arithmetic.test.ts` (14): prompts, línea/total inconsistentes, total null,
  ±1 PYG, mixto válido, subtotal fusionado erróneo, exentos/descuento, ausentes, no positivos.
- `test/invoice-extract-validation.test.ts` (4): validación adjunta, INV-12, null total, errores.
- `lib/__tests__/b11-unmatch-action.spec.ts`: extendido (allowlist + filtros de limpieza).
- Sin correcciones retroactivas: facturas históricas sin desglose muestran «Sin conciliar».

## 8. Validación

| Control | Resultado |
|---|---|
| Suite completa | **2044 PASS / 16 skipped / 8 FAIL** — los 8 FAIL preexistentes (7 archivos de migraciones/schedule/certificados verificados iguales en worktree limpio de HEAD `8194005`; `final-recovery-integrity` flaky bajo carga paralela, pasa solo 11/11) |
| Typecheck | PASS (`npx tsc --noEmit` exit 0) |
| Build | PASS (compiled successfully) |
| Lint (archivos del diff) | **0 errores** (2 warnings preexistentes en `invoices-section.tsx`, archivo no modificado; el error `any` preexistente en `actions.ts:491` fue corregido como parte del diff) |
| E2E 61 pasos | No repetido (según misión) |

## 9. Infraestructura

- Producción DB modificada: NO · Migraciones: NO (0 archivos) · Nuevas Supabase branches: 0
- Deploy: NO · SIFEN: NO · Commits: `a8d2af8` + `8194005` + revisión de seguridad (este ciclo)

## 10. Archivos (estado actual del diff de la revisión de seguridad)

```
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
```

## 11. Riesgos residuales

- Concurrencia check↔insert sin transacción/RPC: convergencia por revalidación +
  auditoría, no atomicidad fuerte (documentado; requiere esquema autorizado para RPC).
- La conciliación automática solo cubre el caso inequívoco; facturas multi-producto con
  descripciones distintas requieren imputación manual explícita (por diseño).
- Exentos/mixtos/descuentos sin desglose van a revisión (brecha de schema documentada).
- `matchInvoiceItemsToOrderItems` (GPT) pasa por `insertValidatedItemMatches` (validado);
  el motor semántico en sí no fue auditado en profundidad.
- Ground truth QA de 40 documentos intacto (sin modificar).
