# Batch 06 — Tender GANADA → proyecto / baseline contractual

Base: cda349aaff7ebe31467fafa95e39002e90c3b55b (Batch05). Branch: batch/06-tender-project-handoff. PR base: batch/05-inventory-canonical.

## DISCOVERED MODULE SURFACES
Licitación detalle/reimport/convert button; PREBID workspace/actions/lifecycle/versions/outcome/handoff snapshot; DNCP items y análisis legacy; assistant manage_tender y approval boundary; lib/procurement/tender-to-project; RPC legacy convertir_licitacion_a_proyecto_atomico; projects creation/import/edit/detail; contractual fields; budget hierarchy/APU/materials/labor/equipment/subcontracts/pricing; canonical inventory location; certificate generation/elaboration boundary; RLS/ACL/FK/source guards; related tests y catálogo real Preview.

## P1 corregidos
- Conversión usaba licitacion_items y monto legacy, no winning snapshot; admitía parámetros comerciales del caller y mutaba project_id/raw_json del tender congelado.
- Nueva operación humana prebid_create_project(tender,true) resuelve TODO desde DB: actor activo/plan/rol/tenant, GANADA canónica, award confirmado, winning=submitted PRESENTADA, SHA-256 y owner del snapshot.
- Lock de licitación + unique source_tender_id serializan doble click/retry; un solo proyecto/baseline. Conversión legacy sin baseline no se adopta automáticamente: rechaza para reconciliación humana.
- RPC legacy revocada a anon/authenticated/service_role. Adapter operativo solo envía identidad del tender y confirmación; ignora precio/items comerciales del caller.
- Crea proyecto ACTIVO y baseline inmutable con snapshot exacto, versión/hash/award/confirmador; copia Cómputo y jerarquía con nuevos IDs, APU y adopciones verificadas históricas. RFQs, cotizaciones, BIM, planillas y evidencia PREBID no se reparentan.
- Ubicación canónica de obra VACÍA creada en la misma transacción; no legacy depósito/stock, OC/RFQ procurement, Weekly Plan, certificados, pagos ni Forecast automáticos.
- Historia comercial y origen del proyecto protegidos contra UPDATE/DELETE; baseline RLS read-only por tenant/rol. POST no puede forjar baseline.
- Porcentajes contractuales no presentes en winning facts quedan NULL; editor conserva pendientes en vez de convertir blancos en defaults/0. Certificación del proyecto handed-off bloqueada hasta confirmarlos; anticipo desconocido se muestra pendiente.
- Botón humano existente y botón de handoff del workspace usan mismo dominio; proyecto muestra origen y SHA-256, sin rediseñar pantallas.

## Semántica comercial
contract_amount = adjudicación confirmada (puede diferir de oferta).
budget_total inicial = offerAmount del snapshot presentado. Baseline guarda ambos.
Copia fiel de quantity/unit/unit_price originales, incluyendo NULL. No se distribuye el award entre partidas ni se inventa precio de venta cuando no existía desglose contractual. APU/precios/evidencia completos conservados en baseline; ejecución puede planificar/actualizar su copia sin modificar baseline ni PREBID. Parámetros/amendments posteriores requieren acción humana en el modelo existente.
BIM histórico permanece en el snapshot y tender; no se mueve a ejecución automáticamente.

## Validación real
- 104 assertions PostgreSQL PASS: lifecycle Batch04 + handoff, estados inválidos, missing award/winner mediante fault injection rollback-only, confirmación humana, retry, copia fiel, source/quote provenance, baseline inmutable, no reparenting, sin side effects, tenant extranjero y RPC legacy inaccesible.
- Dos transacciones reales authenticated simultáneas: PASS, un proyecto y un baseline. Fixture B06 aislado retenido solo en Preview.
- 123 tests relacionados PASS + 4 nuevos de adapter PASS; full serial 1408 PASS / 16 skipped.
- Typecheck PASS; build final y ledger en manifest.
- Preview xddlzgjwufskgasomval: ledger27 = base20 + B05(5) + B06(2).
- Security Advisor: único finding nuevo de función authenticated definer es prebid_create_project, intencional RPC humana limitada internamente. Sin nuevo anon execute/search_path mutable/RLS ausente del baseline. Findings legacy fuera de scope preservados.
- Browser autenticado: NOT VERIFIED; DB/API privileges y build sí probados. No se declara smoke visual.

## Findings residuales
P0: none. P1: corregidos y Preview verified.
P2: proyectos legacy de handoff no se migran/backfillean automáticamente; desglose contractual de precio de venta por partida desconocido requiere información humana, no reparto inventado. Reconciliación física71x2 sigue aceptada y ajena a este batch.
P3: helper puro de mapping legacy permanece por compatibilidad, sin uso en el flujo operativo; su payload no constituye autoridad de handoff.

IMPLEMENTED / TESTED / PREVIEW VERIFIED: YES.
PRODUCTION VERIFIED: sin despliegue; READ ONLY. No main mutation/merge/producción/migration aplicada editada/Batch08.
