# QA ADMIN REMEDIATION 2 — HANDOFF

Documento para continuar sin depender de la conversación previa.
Estado al cierre: branch `fix/qa-admin-remediation-2` pusheada, esperando revisión humana
y PR. **No hay merge ni deploy autorizados todavía.**

---

## Estado Git

- SHA inicial de `origin/main` (base del batch): `a5e175d4de27b27eca4deafcd5407f78198a5eb0`
  (ya traía PR #34 Remediation 1 y PR #35 BUG-002).
- Nueva branch: `fix/qa-admin-remediation-2` (creada desde el `origin/main` anterior; NO se
  reutilizó la branch de Remediation 1; push a `origin/fix/qa-admin-remediation-2`).
- SHA final de `main`: **igual al inicial** (no se tocó main).
- HEAD de la branch: `bd117a008af2ac7bbeb07d9d97e9586b96b5412f`.
- Commits: 1 → `bd117a0 fix: budget-item authorization, resident camera recovery and QA climate fixtures`.
- Archivos modificados: los 4 listados en el Report §6. Nuevos: 3 tests + 2 fixtures.
- Archivos no relacionados preservados: `audit-artifacts/batch-0.5-nonprod-2026-10-01/`,
  `audit-artifacts/erp-total-reality-audit-2026-09-30/`, `planillas-ejemplo/`,
  `~$MAGY - Cronograma Adenda 1.xlsx` (untracked, sin tocar).
- PR creado: **NO** (pendiente de aprobación para abrir PR a main).
- Nota: trabajo previo no committeado de otros agentes no fue borrado ni reseteado; hubo
  stashes históricos ajenos que quedaron intactos (`git stash` solo con push/pop propios,
  verificados).

## Cómo reproducir la validación

```powershell
git fetch origin
git checkout fix/qa-admin-remediation-2
npx tsc --noEmit                                   # PASS
npx vitest run --no-file-parallelism               # 1939 PASS / 16 skipped / 0 FAIL
npx eslint "app/(internal)/inventory/actions.ts" "app/api/warehouse-portal/[token]/route.ts" `
  "lib/inventory/warehouse-portal-data.ts" "components/captura-verificada.tsx" `
  test/inventory-budget-item-authorization.test.ts test/resident-camera-recovery.test.ts `
  test/qa-climate-hh-annex-fixture.test.ts          # 1 error preexistente (144 prefer-const), igual al baseline
npm run build                                      # PASS
```

- `npm test` (paralelo) puede mostrar ~6 fallos de timeout PGlite en esta máquina
  (`schedule-*`, en `lib/__tests__/final-recovery-integrity.spec.ts`,
  `certificate-workbook-import.spec.ts`, `mrp-reservation-migration.spec.ts`,
  `provider-payment-terms-migration.test.ts`); son flakiness de paralelismo,
  46/46 pasan con `--no-file-parallelism`, verificado con y sin los cambios.

## Defectos — resumen técnico (detalle completo en QA_ADMIN_REMEDIATION_2_REPORT.md)

### P1 (43/44/59) FIXED — `budget_items` vs `empresa_id`

- `budget_items` NO tiene `empresa_id` (baseline `supabase/migrations/20261002231537_production_schema_baseline.sql`).
- Tres consultas filtraban por esa columna → PostgREST `error` → código lo ignoraba →
  «no pertenece» / listas vacías.
- Fix: scoping por `project_id` + manejo separado del error de consulta. Puntos:
  1. `app/(internal)/inventory/actions.ts` `updateWarehouseSubmissionLine` (acción que usa la UI de revisión de rendiciones, `/inventory/submissions/[id]`).
  2. `app/api/warehouse-portal/[token]/route.ts` POST `action=consumption` (portal pañol `/warehouse/[token]`).
  3. `lib/inventory/warehouse-portal-data.ts` `getWarehousePortalContext` (carga partidas del portal).
- Tenancy intacto: submission/link ya validan empresa; RLS `budget_items_select`
  (vía `projects.empresa_id`) y `inventory_post_movement` (JOIN projects) siguen atando
  partida → obra → empresa. Tests: `test/inventory-budget-item-authorization.test.ts`.
- Reconciliación esperada tras fix (movimientos canónicos, sin tocar saldos):
  cemento 140 bolsas / ladrillo 3500 u, con los traslados ya hechos por QA (20/1000 a obra).

### P2 (46/49) FIXED — cámara siempre con recuperación legítima

- `components/captura-verificada.tsx`: `raceCameraRequest` (timeout 10 s → estado
  `sin-respuesta` + liberación de stream tardío), clasificación con
  `lib/scanner/camera-helpers.ts` (`parseCameraError`, `checkCameraEnvironment`),
  fallback «Subir foto» visible ante cualquier fracaso, botón «Esperando cámara…`.
- Consumidores sin cambios: `app/avance/[token]/avance-form.tsx` (parte diario) y
  `resident-workflows.tsx` (Registrar lluvia). Procedencia `source: "camara"|"archivo"`
  sin falsificación; fecha/hora/GPS reales.
- Tests: `test/resident-camera-recovery.test.ts`.

### HH (51) FIXTURE / PROCEDIMIENTO — no bug

- Motor correcto (`lib/projects/contract-climate.ts:154`): con `requireEvidence=true`
  (PBC v2 cargado en paso 50), la HH exige fila real de `climate_evidence` para la
  jornada HH (o su evento). La corrida solo tenía «referencia documental» en notas.
- Mecanismo vigente en producto: `addClimateEvidence`
  (`app/(internal)/projects/climate-actions.ts:382`) + panel
  `app/(internal)/projects/[id]/climate-workdays-panel.tsx`.
- Fixture añadido: `test/fixtures/qa-admin/climate-pbc-hh.json` (parámetros PBC del
  Master + escenario 10-04 LL 35mm / 10-05 HH / 10-06 B) y
  `test/fixtures/qa-admin/DOC_EVIDENCIA_HH_QA.pdf` (documento sintético, identificado
  «FIXTURE SINTÉTICO DE QA»). Test: `test/qa-climate-hh-annex-fixture.test.ts`.
- Procedimiento próximo run: adjuntar el documento HH a la jornada HH vía UI
  (icono de evidencia del día en el libro climático; botón «Agregar evidencia» con
  evidenceType OTHER), que crea la fila en `climate_evidence` ligada a la jornada.

### Anexo climático (53) EXPECTED — no cambiar el motor

- `contract-climate.ts:115` rechaza `periodEnd > asOf`: «Elegí un período válido, hasta
  la fecha de corte.» Corre RUN vs fixture: certificado 01–31/10 vs corte 07/10.
- Procedimiento: calcular el anexo con período ≤ corte (p. ej. 01–06/10). Test nuevo fija
  este contrato (BLOQUEADO → período válido → COMPLETE).

### Paso 38 REQUIRES DECISION — diagnosticado, sin fix

- Con match de cabecera (`invoice_order_matches`), `facturado_amount` se recalcula
  (correcto: 3.5M / saldo 700k), pero `authorized_order_items.quantity_invoiced` solo se
  actualiza por trigger `recompute_order_item_quantity_invoiced()` con
  `invoice_item_matches`, que nunca se escribe desde el código (pipeline de
  item-matching GPT `lib/invoice-item-match.ts` sin llamadores).
- Resultado: columna ítems “Facturado 0 / Pendiente 3000” en la OC mientras el resumen
  financiero dice otra cosa. Corrección mínima candidata (alcance próximo batch):
  1) conectar el pipeline de item-matching en `linkInvoiceToOrder`, o
  2) derivar `quantity_invoiced` de recepción/conciliación (discusión del Master).

## Riesgos residuales

- La validación E2E en UI de la cadena 43→44→59, 46→49 requiere entorno QA autorizado
  post-deploy de la branch (Producción no desplegada en este batch).
- Paso 38 queda abierto con causa confirmada (ver arriba).
- Specs PGlite con timeout 5 s pueden fallar por carga de máquina en `npm test` (paralelo);
  usar `--no-file-parallelism` para lectura estable.

## Próximo paso recomendado

1. Revisión humana de la branch + apertura de PR y merge autorizado.
2. Deploy a Vercel Preview/Staging y corrida focalizada de las cadenas:
   - 43 → 44 → 59 (consumo por portal pañol y por revisión de rendición; validar
     consumos canónicos únicos, luego stock 140/3500).
   - 46 → 49 (cámara real y fallback; verificar envío del reporte y separación de
     evidencias).
   - 51 (adjuntar `DOC_EVIDENCIA_HH_QA.pdf` a la jornada HH y recalcular período
     01–06/10) → 53 (anexo con período al corte histórico).
3. Después de esas cadenas, repetir la corrida integral de 61 pasos.
No comenzar una tarea nueva distinta.
