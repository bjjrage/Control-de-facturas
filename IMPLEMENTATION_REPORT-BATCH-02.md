# Implementation Report — Batch 02 Pricing / Flywheel

## Identidad y base

- Batch: `02-PRICING-FLYWHEEL`.
- Rama: `batch/02-pricing-flywheel`.
- Worktree: `C:\Users\User\Desktop\PORYECTOS\Control de Facturas\.worktrees\batch-02-pricing-flywheel`.
- Base: `c60b26787358ad1b698fa8bf3380bd6ccda3c02d` (`origin/main` verificado).
- HEAD funcional auditado antes del commit documental: `70077a94917ae6cc6bd7452dfb45adddcf785c3e`.
- Commits funcionales:
  - `1c705b51050aad0e73272441f3c197dd6c5f2438` — `fix(pricing): separate transactional and market prices`.
  - `70077a94917ae6cc6bd7452dfb45adddcf785c3e` — `fix(flywheel): require invoice line evidence`.

## Archivos del batch

- `BATCH-MANIFEST.md` — conserva el registro histórico de Fase -1 y agrega el manifest de Batch 2.
- `IMPLEMENTATION_REPORT-BATCH-02.md`.
- `app/(internal)/precios/page.tsx`.
- `app/(internal)/precios/prices-section.tsx`.
- `app/(internal)/projects/[id]/costeo-actions.ts`.
- `app/(internal)/projects/[id]/costeo-section.tsx`.
- `lib/costing/cost-budget.ts`.
- `lib/costing/price-list.ts`.
- `lib/costing/project-prices.ts`.
- `lib/costing/__tests__/project-prices.spec.ts`.
- `lib/procurement/flywheel.ts`.
- `lib/procurement/__tests__/flywheel-invoice-evidence.spec.ts`.
- `lib/procurement/__tests__/pricing-flow-through.spec.ts`.
- `test/costing.test.ts`.

## Semántica antes / después

Antes, el selector podía elegir automáticamente la cotización vigente más barata y la lista de precios trataba la observación más reciente como “último precio”, aunque fuera cotización, OC o referencia manual.

Ahora las capas se exponen por separado:

- `lastPurchasePrice`: última observación válida `FACTURA` o `RECEPCION`, con fecha, proveedor y documento disponibles.
- `currentQuote`: cotización vigente de las RFQ del proyecto; sólo señal de mercado.
- `adoptedPrice`: decisión explícita por proyecto desde `project_cost_prices`, con fuente, `quote_version_item_id`, fecha y `updated_by` existentes.
- `estimatedPrice`: salida del Cost Engine calculada sólo con compras efectivas.
- `inventoryCpp`: `productos.costo_promedio`, separado como valuación de stock.
- Referencia APU/manual: permanece visible por separado y no entra al baseline de compra.

La selección de Costeo y Plan Semanal es: precio adoptado → última compra efectiva → estimación basada en compras → CPP. Una cotización nunca participa en la selección automática. El CPP conserva la fuente `CPP`; no se etiqueta como compra.

La Lista de precios prioriza como precio de referencia la última compra efectiva, y expone por separado cotización registrada, referencia APU/manual, CPP y estimación calculada. Las compras sin material vinculado agrupan sólo facturas y recepciones; cotizaciones y órdenes de compra quedan fuera.

## Invoice flywheel

`recordCostObservationFromInvoice` ahora valida descripción, precio unitario, cantidad, unidad y fecha explícitos antes de consultar o escribir datos. Si falta precio de línea, devuelve `MISSING_INVOICE_LINE_UNIT_PRICE` y no realiza consultas ni inserciones. Una OC asociada sólo puede completar el contexto `project_id`; el código ya no lee su producto, cantidad, unidad, precio ni moneda como sustitutos de una línea de factura.

Los callers actuales que no envían precio/cantidad/unidad de línea dejan de crear observaciones automáticamente hasta recibir esa evidencia. No se creó una observación `FACTURA` desde una OC. No se recalificaron observaciones históricas; el batch corrige futuras escrituras y no hace backfill.

## Impacto transversal

- Costeo: muestra fuente usada y presenta compra, cotización, CPP y estimación aparte; adoptar una cotización es una decisión explícita del usuario para el proyecto.
- Plan Semanal: sigue consumiendo el resolver compartido y recibe el precio seleccionado bajo las mismas reglas.
- Flujo de Caja: se probó que el requerimiento material derivado del plan conserva el valor de compra y no baja por la aparición de una cotización.

## Verificación

- Pricing / Costeo / Plan Semanal / Flujo de Caja / Invoice flywheel enfocados: **29 tests PASS**.
- `npx tsc --noEmit`: **PASS**.
- `npx vitest run --maxWorkers=1`: **1.283 PASS, 16 skipped; 146 archivos PASS, 2 skipped**.
- `npx next build --webpack`: **PASS** con URL, anon key, service key y app URL ficticias locales; sin credenciales productivas.
- Diff revisado contra `c60b26787358ad1b698fa8bf3380bd6ccda3c02d`; rutas limitadas al manifest.

## Desvíos y declaraciones

- Sin migrations nuevas o modificadas. El esquema existente cubre `project_cost_prices`; no se detectó una brecha que requiera schema nuevo para este alcance.
- Los callers actuales no proveen líneas detalladas: su escritura automática queda rechazada hasta que tengan evidencia real, en vez de imputar el precio de una OC.
- `QUOTES AUTO-ADOPTED AS PURCHASE PRICE: NO`.
- `CPP LABELED AS LAST PURCHASE: NO`.
- `APU LABELED AS PURCHASE: NO`.
- `OC PRICE RECORDED AS FACTURA WITHOUT INVOICE EVIDENCE: NO`.
- `PRODUCTION MODIFIED: NO`.
- `MIGRATIONS MODIFIED: NO`.
- No se abrió PR, no se mergeó y no se inició otro batch.

Estado: **listo para auditoría externa**.
