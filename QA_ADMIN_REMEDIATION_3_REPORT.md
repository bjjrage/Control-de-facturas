# QA ADMIN REMEDIATION 3 — REPORT

**Branch:** `fix/qa-admin-remediation-3` (base: `origin/main` = `a56c0e199deda4a35a658b290d19d7b17ee4efa3`)

- COMMITS CONOCIDOS:
  - `a8d2af8` — implementación (fix: item-level invoice reconciliation and invoice parser hardening).
  - Puede existir un commit documental posterior: el HEAD final exacto se verifica con
    `git rev-parse HEAD` y se informa en el chat (sin autorreferencia obsoleta).
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

## 5. Tests (§10 + parser)

- `test/invoice-item-reconcile.test.ts` (21): unidades, 1:1 3000/2500, parciales
  acumulados, dos productos, sin líneas, unidad incompatible, ambiguo, over-remanente,
  no-división, manual (válido/tenant/unidad/producto/duplicado/over/cantidad/congelado).
- `test/invoice-item-matches-actions.test.ts` (13): vínculo→2500/pendiente 500,
  parciales, no-duplicar, sin líneas, unidad incompatible, over pendiente, producto ajeno,
  tenant ajeno, desvincular sin residuos, eliminar sin fantasmas, pagada congelada,
  corrección→sin conciliar, auto-match congelado en APTO.
- `test/invoice-arithmetic.test.ts` (14): prompts, línea/total inconsistentes, total null,
  ±1 PYG, mixto válido, subtotal fusionado erróneo, exentos/descuento, ausentes, no positivos.
- `test/invoice-extract-validation.test.ts` (4): validación adjunta, INV-12, null total, errores.
- `lib/__tests__/b11-unmatch-action.spec.ts`: extendido (allowlist + filtros de limpieza).
- Sin correcciones retroactivas: facturas históricas sin desglose muestran «Sin conciliar».

## 6. Validación

| Control | Resultado |
|---|---|
| Suite completa serial | **2019 PASS / 16 skipped / 0 FAIL** (1959 baseline + 60 nuevos) |
| Typecheck | PASS |
| Build | PASS (compiled successfully) |
| Lint comparativo | 0 regresiones nuevas (1 error preexistente en `invoices/actions.ts:453` `any`, idéntico en baseline) |
| E2E 61 pasos | No repetido (según misión) |

## 7. Infraestructura

- Producción DB modificada: NO · Migraciones: NO (0 archivos) · Nuevas Supabase branches: 0
- Deploy: NO · SIFEN: NO · Commits: 1 (+ este documental)

## 8. Archivos

```
M  app/(internal)/invoices/[id]/actions.ts
M  app/(internal)/invoices/[id]/page.tsx
M  app/(internal)/invoices/actions.ts
M  app/(internal)/invoices/extract-actions.ts
M  app/(internal)/invoices/invoice-dialog.tsx
M  app/(internal)/invoices/revision/actions.ts
M  lib/__tests__/b11-unmatch-action.spec.ts
M  lib/invoice-extraction.ts
M  worker/index.ts
A  app/(internal)/invoices/[id]/invoice-lines-section.tsx
A  lib/invoice-arithmetic.ts
A  lib/invoice-item-reconcile.ts
A  lib/invoice-items.ts
A  test/invoice-arithmetic.test.ts
A  test/invoice-extract-validation.test.ts
A  test/invoice-item-matches-actions.test.ts
A  test/invoice-item-reconcile.test.ts
```

## 9. Riesgos residuales

- La conciliación automática solo cubre el caso inequívoco; facturas multi-producto con
  descripciones distintas requieren imputación manual explícita (por diseño).
- Exentos/mixtos/descuentos sin desglose van a revisión (brecha de schema documentada).
- `matchInvoiceItemsToOrderItems` (GPT) sigue sin llamadores fuera del worker.
- Ground truth QA de 40 documentos intacto (sin modificar).
