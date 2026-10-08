# QA ADMIN REMEDIATION 2 — REPORT

**Branch:** `fix/qa-admin-remediation-2` (base: `origin/main` = `a5e175d4de27b27eca4deafcd5407f78198a5eb0`)

- COMMITS CONOCIDOS:
  - `bd117a008af2ac7bbeb07d9d97e9586b96b5412f` — implementación (fix: budget-item authorization, resident camera recovery and QA climate fixtures).
  - `71e6a386232c7f5c68f1f1db9411792b3fff63a0` — documentación inicial (docs: add QA Admin Remediation 2 report and handoff).
  - Posterior a ellos puede existir un commit documental de revisión; el HEAD final exacto
    se verifica con `git rev-parse HEAD` sobre `fix/qa-admin-remediation-2` y se informa en
    el reporte de entrega del chat (los documentos NO fijan su propio SHA para que no
    quede obsoleto con cada commit nuevo).
**Base:** `origin/main` = `a5e175d4de27b27eca4deafcd5407f78198a5eb0`
**Estado:** listo para revisión. PR contra `main` pendiente de creación/aprobación. NO se
hace merge ni deploy. Se espera autorización humana.

---

## 1. Alcance ejecutado

Corrección quirúrgica de los defectos de la certificación del 07/10/2026
(`run-2026-10-07-final-certification`: 54 PASS / 4 FAIL / 3 BLOQUEADO).
No hubo refactors, cambios de arquitectura ni de reglas de negocio certificadas.

## 2. Defectos — diagnóstico y resolución

### P1 — Pasos 43 / 44 / 59: consumos rechazados — **FIXED**

- **Diagnóstico original:** la revisión de líneas de rendición rechazaba la partida con
  «La partida no pertenece a la obra de esta rendición» y el portal del pañol con
  «La partida no pertenece a esta obra». Además el portal no ofrecía partidas.
- **Causa raíz confirmada:** tres consultas a `budget_items` filtraban por
  `.eq("empresa_id", …)`, columna que **no existe** en esa tabla (verificado en
  `supabase/migrations/20261002231537_production_schema_baseline.sql` —
  `CREATE TABLE budget_items` sin `empresa_id`). PostgREST devolvía error de columna
  inexistente; el código ignoraba el `error`, colapsaba `data` en `null` y respondía
  «no pertenece». Sitios afectados:
  1. `app/(internal)/inventory/actions.ts` (`updateWarehouseSubmissionLine`, líneas ~611-620).
  2. `app/api/warehouse-portal/[token]/route.ts` (acción `consumption`, ~línea 176) — generaba además el mensaje «La salida requiere partida y un intento estable» porque la partida nunca validaba.
  3. `lib/inventory/warehouse-portal-data.ts` `getWarehousePortalContext` (~línea 200) — la lista de partidas del portal quedaba **vacía** («el portal no ofrece partidas»).
- **Corrección:** se quitó el filtro inexistente y se dejó el scoping por `project_id`
  (idéntico al patrón vigente en `lib/procurement/weekly-plan-shared.ts:389-393` y
  `app/avance/[token]/page.tsx`). Aislamiento multitenant **conservado**:
  - la rendición/link/ubicación/proyecto ya se validan contra `empresa_id` upstream;
  - la política RLS `budget_items_select` resuelve belonging vía `projects.empresa_id`;
  - la validación canónica en DB (`inventory_post_movement`, baseline ~línea 4582)
    sigue atando `partida → obra → empresa` con `JOIN projects pr … pr.empresa_id = p_empresa_id`.
  Los errores de consulta ya no se convierten en «partida no encontrada»: respuesta
  distinta y sin escritura (`500` en el portal; mensaje de reintento en la acción).
- **Evidencias:** `results.csv` pasos 43/44/59; `FINAL-REPORT.md` §Fallos; capturas STEP-43/44/59.
- **Estado derivado:** paso 59 se reconciliará automáticamente cuando los consumos
  canónicos pasen (cemento 140 / ladrillo 3500). No se manipularon saldos.

### P2 — Paso 46 (y dependiente 49): cámara del residente — **FIXED** (causa raíz demostrada)

- **Diagnóstico original:** cámara «esperando acceso» en Chrome e IAB; sin captura ni
  fallback; el reporte no se envió.
- **Causa raíz demostrada:** en `components/captura-verificada.tsx` el fallback
  «Subir foto» solo aparecía si `getUserMedia` **rechazaba** (`camError === "no-camara"`).
  Una solicitud pendiente indefinida (permiso sin resolver, IAB, Playwright, HW) dejaba
  la UI sin recuperación; además el componente no usaba la clasificación canónica de
  errores `lib/scanner/camera-helpers.ts` (ya probada en `test/scanner-live-camera.test.ts`).
- **Corrección:** `raceCameraRequest()` corre `getUserMedia` contra un timeout de 10 s;
  marca `sin-respuesta` y libera el stream si la solicitud resuelve tarde (sin dejar la
  cámara ocupada). Errores clasificados con `parseCameraError` (NotAllowed,
  NotFound, NotReadable, Overconstrained, Security). El fallback «Subir foto» ahora es
  visible ante **cualquier** estado de fracaso, y el botón muestra «Esperando cámara…»
  durante la espera. Procedencia intacta y honesta: `source: "camara" | "archivo"`,
  fecha/hora/GPS reales; no se falsifica nada; sin la foto no se puede enviar
  (regla del pluviómetro conservada).
- **Revisión independiente (cierre del PR #36):** el input de fallback contenía
  `capture="environment"`, que en navegadores móviles puede obligar a re-abrir la cámara
  justo cuando la cámara ya está fallando. Corregido: `capture` eliminado del input de
  fallback (queda `type="file" accept="image/*" multiple`); se conserva la aparición del
  fallback ante error/timeout y la procedencia `camara`/`archivo`. Verificado con
  Playwright (emulación móvil): el input NO presenta `capture` y permite seleccionar una
  imagen existente.
- **Evidencia:** `dom/STEP-46.md` (botón «Abrir cámara» activo, «Enviar» deshabilitado
  sin fallback visible).

### Paso 51 — evidencia HH — **FIXTURE / PROCEDIMIENTO QA** (no bug)

- **Motivo exacto del FAIL:** `lib/projects/contract-climate.ts:154` — con
  `requireEvidence=true` (parámetros cargados en paso 50), la HH exige evidencia
  vinculada a la jornada HH o a su evento climático; la corrida solo llevó
  «referencia documental» en notas, **sin** fila en `climate_evidence`.
- **Verificado:** `addClimateEvidence` (`app/(internal)/projects/climate-actions.ts:382`)
  y el panel `climate-workdays-panel.tsx` permiten adjuntar evidencia por jornada —
  el producto SÍ tiene el mecanismo; el fixture no la cargó.
- **Fix preparado:** fixture ejecutable `test/fixtures/qa-admin/climate-pbc-hh.json`
  + documento sintético `DOC_EVIDENCIA_HH_QA.pdf` (marcado «FIXTURE SINTÉTICO DE QA»)
  + test con el motor real: sin evidencia → HH PENDING «Falta evidencia exigida por el
  PBC.» (reproduce el FAIL); con evidencia adjunta → 2 elegibles, computables 0,
  extensión 0, COMPLETE.
- **No se tocó:** `requireEvidence`, `requireCausality`, tolerancia (2 mensual) ni fórmula.

### Paso 53 — anexo climático fuera de corte — **EXPECTED** (comportamiento correcto del motor)

- Verificado en engine (`contract-climate.ts:115`): `periodEnd > asOf` →
  `«Elegí un período válido, hasta la fecha de corte.»` Periodo fixture 01–31/10 con
  corte 07/10 incluye fechas futuras → rechazo correcto. Se documenta y **no se modifica
  el motor**. El test nuevo fija el contrato: periodo 01–06/10 con `asOf` 07/10 → COMPLETE.
- **Procedimiento para la próxima corrida:** el anexo del certificado debe calcularse con
  el período vigente al corte (01–06/10 o equivalente al día de ejecución), no el mes completo del certificado económico.

### Paso 38 — cantidades facturadas en cero — **INVESTIGADO — REQUIRES DECISION**

- **READ-ONLY. Causa confirmada:** el match usado por QA es nivel-cabecera
  (`invoice_order_matches`, `app/(internal)/invoices/actions.ts:382` `linkInvoiceToOrder`).
  `authorized_order_items.quantity_invoiced` solo se recalcula con el trigger
  `recompute_order_item_quantity_invoiced()` ante cambios en **`invoice_item_matches`**,
  tabla que **ningún código de aplicación escribe** (el pipeline de item-matching GPT
  `matchInvoiceItemsToOrderItems` es código muerto, sin llamadores). El resumen
  financiero (`facturado_amount` 3.500.000 / saldo 700.000) es correcto; la columna
  de ítems “Facturado 0 / Pendiente 3000” es incorrecta e incompleta con el pipeline vigente.
- **Alcance:** NO se corrigió (prohibido ampliar el batch sin aprobación). Riesgo residual
  documentado para decisión del Master.

## 3. Validación (re-verificada en la fase de revisión/PR)

| Control | Resultado |
|---|---|
| Tests focalizados nuevos | 50 PASS (12 imputación + 19 auditoría multitenant portal + 15 cámara + 4 clima/HH/anexo) |
| Tests de inventario / clima / security / cámara existentes | PASS |
| Suite completa serial (`vitest run --no-file-parallelism`) | **1959 PASS / 16 skipped / 0 FAIL** (baseline 1909 + 50 nuevos) |
| Suite completa paralela (`npm test`) — registro separado | 6 specs PGlite (schedule-*, final-recovery-integrity, certificate-workbook-import, mrp-reservation-migration, provider-payment-terms-migration) alcanzan timeout de 5 s por paralelismo en esta máquina; los 6 pasan 46/46 en serie y no tocan archivos del batch (verificado con stash). NO se aumentaron timeouts ni se deshabilitaron pruebas |
| Typecheck (`tsc --noEmit`) | PASS (exit 0) |
| Build (`next build`) | PASS (compiled successfully, sin warnings) |
| Lint comparativo (archivos del batch) | 1 error preexistente en `warehouse-portal-data.ts:113` (`prefer-const`, línea no tocada, idéntico en baseline). **NEW LINT REGRESSIONS = 0** |
| Cámara — verificación visual Playwright (harness temporal no comiteado, bundle compilado del componente real, sin datos en DB) | **20/20 PASS**: desktop 10 + `MOBILE EMULATION: PASS` (iPhone 14: los 10 casos). Cámara disponible/permitida, denied, notfound, busy, pendiente indefinida (timeout 10 s), respuesta tardía con `track.stop` del stream, fallback «Subir foto» funcional con `source:"archivo"` y metadatos reales, input de fallback **sin `capture=`** y con selección de imagen existente verificada, entorno no soportado, reintento, viewport 390×844. `PHYSICAL MOBILE DEVICE: NOT TESTED` |

## 4. Aislamiento multitenant (auditoría focalizada de la fase de revisión)

Cadena completa verificada READ-ONLY contra la baseline SQL y la ruta de API —
el portal usa service_role, por lo que la protección son las validaciones explícitas,
no la RLS:

1. Token resuelto por **hash** (`hashWarehousePortalToken`); enlaces inactivos o vencidos
   se rechazan tanto en la ruta (`resolveLink`) como en la RPC (`inventory_portal_consumption`).
2. La ubicación del enlace se resuelve con `.eq("empresa_id", link.empresa_id)` — la obra
   y la empresa derivan del enlace, nunca de parámetros del cliente (la ruta no lee
   `project_id`/`empresa_id` de form-data).
3. La partida se valida contra `location.project_id` (ruta, ahora sin columna inexistente)
   **y** en SQL canónico con `JOIN projects pr … pr.empresa_id = p_empresa_id`.
4. El producto se valida activo y de `link.empresa_id` en la ruta; en SQL vuelve a
   validarse («El material no pertenece a la empresa») y también exige unidad coincidente.
5. `p_empresa_id` de la RPC sale de `link.empresa_id` (server-side); la RPC solo corre con
   service_role (REVOKE a PUBLIC/anon/authenticated; GRANT a service_role).
6. `inventory_post_movement` (SECURITY DEFINER, search_path=''):
   - no service_role → exige `current_empresa_id() == p_empresa_id` y rol interno;
   - cantidad null/0/negativa → reject; CONSUMPTION exige solo ubicación origen;
   - ubicación origen ajena al tenant o inactiva → reject; el consumo debe salir del
     pañol de la obra contextual (from_project == context_project);
   - partida → obra → empresa vía JOIN (reject «La partida no pertenece al proyecto y
     tenant indicados»);
   - **idempotencia**: clave obligatoria, advisory lock por `empresa:clave`, movement
     existente con misma clave y mismos datos devuelve el MISMO id (sin duplicado), y
     con datos distintos rechaza («La idempotency_key ya fue usada para otra operación»
     / «El origen ya fue aplicado con otra operación» con `source_id+source_line_id` = link+attempt);
   - stock insuficiente en la ubicación origen → reject (sin saldos negativos).
7. Casos negativos codificados en `test/inventory-portal-multitenant-audit.test.ts`
   (19 aserciones READ-ONLY contra los archivos fuente y SQL): token inválido/vencido/
   revocado, producto de otra empresa, partida de otra obra/otra empresa, ubicación
   ajena al enlace, consumo sin partida, cantidad inválida, repetición de intento
   (idempotencia), y relación de empresa inconsistente en cada eslabón.

**Vulnerabilidades detectadas: 0.** No se modificó RLS ni funciones SQL.

## 5. Infraestructura (§14)

- Producción DB modificada: **NO** · Migraciones aplicadas: **NO**
- Nuevas Supabase branches: **0** · Deploy a Producción: **NO**
- SIFEN utilizado: **NO** · Costos adicionales creados: **NO**

## 6. Archivos del cambio

```
M  app/(internal)/inventory/actions.ts
M  app/api/warehouse-portal/[token]/route.ts
M  components/captura-verificada.tsx
M  lib/inventory/warehouse-portal-data.ts
A  QA_ADMIN_REMEDIATION_2_HANDOFF.md
A  QA_ADMIN_REMEDIATION_2_REPORT.md
A  test/fixtures/qa-admin/DOC_EVIDENCIA_HH_QA.pdf
A  test/fixtures/qa-admin/climate-pbc-hh.json
A  test/inventory-budget-item-authorization.test.ts
A  test/inventory-portal-multitenant-audit.test.ts  (fase de revisión: auditoría READ-ONLY del portal)
A  test/qa-climate-hh-annex-fixture.test.ts
A  test/resident-camera-recovery.test.ts
```

Work tree previos preservados sin tocar (no commiteados):
`audit-artifacts/*`, `planillas-ejemplo/`, `~$MAGY - Cronograma Adenda 1.xlsx`.

## 7. Estado por defecto

| Ítem | Estado |
|---|---|
| P1 consumos 43/44/59 | FIXED |
| P2 cámara 46/49 | FIXED |
| HH 51 | FIXTURE (motor correcto, fixture + doc sintético añadidos) |
| Anexo climático 53 | EXPECTED (corte histórico correcto; procedimiento documentado) |
| Paso 38 | REQUIRES DECISION (diagnóstico confirmado, sin fix) |
