# Auditoría quirúrgica de cableado operativo

**Snapshot auditado:** `f7a48a0dc125425d4aa9bba7ea8970427056e0fd`  
**Fecha de auditoría:** 2026-09-24  
**Método:** inspección estática del árbol Git objetivo, siguiendo imports, call sites, acciones, servicios, RPCs, vistas y pruebas.

> El checkout de trabajo permaneció en `recovery/restore-legacy-surface-contract` / `901fb009ca3d7574ef8717e2891b05c83f7900a1`. No hice checkout del snapshot objetivo: toda afirmación funcional de este documento se refiere a los archivos contenidos en `f7a48a0`. El único archivo creado por este trabajo es este informe. No se ejecutaron pruebas, migraciones, RPCs, escrituras ni consultas a Supabase; no se hicieron commits.

## 1. Executive summary

| Flujo | Estado | Hasta dónde funciona | Punto de corte |
|---|---|---|---|
| Plan semanal inteligente | **PARTIALLY WIRED** | Calcula metas y requerimientos, muestra faltante y puede guardar/comprometer. El commit MRP puede reservar stock central canónico. | El stock de obra y las recepciones pendientes se calculan desde vistas legacy; el faltante no crea RFQ/OC y el consumo canónico no se convierte en avance. |
| Inventario canónico | **PARTIALLY WIRED** | Hay libro de movimientos, balances por ubicación, costo por moneda, RPC transaccional e idempotencia; project inventory lee vistas canónicas. | Las pantallas ordinarias para registrar operaciones siguen en el dominio legacy; buena parte de los comandos canónicos está expuesta por herramientas del agente, no por UI humana. |
| Recepción desde OC visible | **LEGACY PATH / BROKEN** | El botón agrega recepción y registra entradas legacy. | No llama a `inventory_confirm_receipt`; no aumenta `inventory_balances` y no aparece en las pestañas canónicas de Recepciones/Inventario. La eliminación/reversión tiene riesgo de dejar saldo por obra incorrecto. |
| Recepción canónica | **PARTIALLY WIRED** | Hay acciones de crear borrador y confirmar por RPC, que postea movimientos canónicos a una ubicación. | El formulario visible de recepción OC no invoca esas acciones; el acceso disponible está mediado por `manage_inventory_operation`. |
| Pañol / rendiciones | **PARTIALLY WIRED** | Portal tokenizado, evidencia, parser Excel/CSV, propuesta de líneas y RPC de confirmación como consumo canónico. | La pestaña interna del proyecto es de solo lectura; no expone revisión/edición/confirmación. Foto es evidencia, no extracción estructurada. |
| TRANSFER | **PARTIALLY WIRED / LEGACY PATH** | Backend canónico admite transferencias; UI normal ofrece transferencia entre depósitos legacy. | No hay formulario de transferencia canónica identificado. |
| CONSUMPTION | **PARTIALLY WIRED / LEGACY PATH** | Confirmar rendición genera consumo canónico imputado a partida; stock y vista de consumo cambian. | La UI regular SALIDA es legacy; no actualiza avance físico/`execution_entries`. |
| RETURN | **DEAD / ORPHANED para UI humana** | El backend canónico y herramienta del agente contemplan devolución. | No se encontró entrypoint normal en las pantallas revisadas. |
| ADJUSTMENT | **PARTIALLY WIRED / LEGACY PATH** | Ajuste legacy tiene botón. La RPC canónica admite ajuste firmado. | No se encontró UI canónica; el input genérico del agente valida cantidad positiva y no expone un ajuste negativo. |
| Plan semanal ↔ stock ↔ compras ↔ consumo | **BROKEN / PARTIALLY WIRED** | Meta → BOM → disponibilidad estimada → faltante; el MRP reserva stock central. | No hay creación automática de compra, stock de obra no canónico, recepción visible legacy y consumo no cierra el avance. |

**Conclusión:** no se demuestra ningún circuito completo de extremo a extremo `plan → compra → recepción canónica → inventario de obra → consumo → avance`. Hay piezas backend sólidas en el nuevo dominio canónico, pero no constituyen por sí solas un flujo operativo completo de usuario.

### Criterios usados

- **FULLY WIRED:** una persona puede terminar el circuito completo desde sus entrypoints reales y los datos llegan al destino correcto.
- **PARTIALLY WIRED:** existe backend real, pero falta una entrada, salida o conexión.
- **READ ONLY:** la pantalla solo presenta datos.
- **LEGACY PATH:** hay flujo invocable, pero usa el modelo anterior.
- **DEAD / ORPHANED:** hay código, pero no se halló un camino ordinario de usuario que lo invoque.
- **BROKEN:** un camino visible produce omisión, divergencia o inconsistencia demostrable por el código.
- **UNKNOWN:** requiere runtime, configuración externa o estado de datos que no se puede deducir del código.

Los estados pueden combinarse cuando describen dimensiones distintas (por ejemplo, entrypoint legacy y consecuencia rota). “Backend presente” no se consideró evidencia de que la UI lo invoque.

## 2. Plan semanal inteligente

### Trazado real

```text
WeeklyPlanSection
  ├─ previewWeeklyPlanAction
  │    ├─ loadWeeklyPlanContext / fuentes compartidas
  │    ├─ resolveWeeklyWeather (si se activa el overlay climático)
  │    └─ calculateWeeklyPlanRequirements
  └─ saveWeeklyPlanAction
       ├─ DRAFT / flujo ordinario → save_weekly_plan_atomic
       └─ MRP COMMITTED → recalcula → commit_production_plan_atomic
                                  ├─ guarda plan e ítems
                                  └─ reserva inventario central
```

Call sites: `app/(internal)/projects/[id]/weekly-plan-section.tsx:33-34,551,671`; acciones: `app/(internal)/projects/weekly-plan-actions.ts:248,311,402,550,636,737,772`; motor puro: `lib/procurement/weekly-plan-engine.ts:100`.

| Pregunta | Hallazgo estático |
|---|---|
| ¿De dónde toma partidas/metas? | El loader arma targets desde datos del proyecto, `budget_items`, ejecución/avance, materiales asociados y plan semanal. El motor limita cantidades por saldo contractual restante y evita planificar sobre lo ya ejecutado. Fuentes compartidas en `lib/procurement/weekly-plan-shared.ts`; motor en `lib/procurement/weekly-plan-engine.ts:100`. |
| ¿Cómo deriva una meta de producción en materiales? | Si se aplica una receta, la UI transforma unidades de producción a partidas objetivo mediante los componentes de receta (`production_recipe_actions` / `lib/procurement/production-recipe.ts`), y luego el motor expande `budget_item_materials` (coeficiente × desperdicio). Son dos mapeos separados: receta de producción → partidas de presupuesto → BOM/materiales. Sin configuración de receta/BOM no hay una conversión fiable; el motor advierte/falla cerrado donde corresponde. |
| ¿Qué función calcula requerimientos? | `calculateWeeklyPlanRequirements(...)`, compartida por preview, carga/estimación y save MRP; el archivo de acciones comenta explícitamente que preview usa el mismo motor (`weekly-plan-actions.ts:296,402,737`). No son fórmulas independientes de preview vs. persistencia. |
| ¿Consulta inventario real? | Consulta datos persistidos, pero la procedencia y frescura dependen de cada fuente. El stock en obra sale de `stock_por_proyecto`, no de `inventory_stock_by_project` (`weekly-plan-shared.ts:270`). No es una lectura del saldo canónico de obra. |
| ¿Consulta stock central canónico y reservas? | En el modo MRP, la disponibilidad central se carga desde balances/ubicaciones canónicas y se reduce por reservas activas. La cobertura separa obra, central disponible, recepción entrante oportuna y compra sugerida (`lib/procurement/mrp-coverage.ts`). El MRP sí entiende reservas para stock central. |
| ¿Qué usa para recepciones entrantes? | `oc_order_item_recibido` (`weekly-plan-shared.ts:298`), con cantidades ordenadas menos recibidas y fecha esperada para no contar llegadas tardías/no confirmadas como oportunas. El view legacy suma ítems de recepción y no filtra por estado de cabecera (`supabase/migrations/0042_oc_recepciones.sql:31-36`). |
| ¿Calcula faltante? | Sí. Descuenta stock de obra, disponibilidad central no reservada y recepciones previstas que cumplan fecha; calcula necesidad de compra neta. La cobertura evita contar dos veces los materiales entre categorías. El resultado sigue siendo cálculo/indicador, no una transacción de compra. |
| ¿Crea RFQ/OC? | No se encontró llamada de preview/MRP a creación de solicitud de cotización ni orden. El panel muestra necesidad/faltante; compra se tramita por separado. **No hay enlace automático faltante → RFQ/OC.** |
| ¿Guarda borrador? | Sí. `saveWeeklyPlanAction` usa `save_weekly_plan_atomic` en el camino de guardado ordinario; la RPC persiste cabecera e ítems de manera atómica según migraciones `0083`/`0084` y sucesoras. |
| ¿Compromete y qué cambia? | Sí, con la ruta MRP COMMITTED: server recalcula y `commit_production_plan_atomic` llama la escritura del plan y la reserva dentro de una transacción (`20260918000004_mrp_lifecycle_atomic.sql:10-93`). El resultado persiste plan/ítems y reemplaza/libera/reserva cantidades centrales. DRAFT/CLOSED liberan reservas conforme al ciclo. Esto **reserva**, no transfiere ni consume. |
| ¿Todo COMMITTED reserva? | No necesariamente. La ruta MRP con `mrpCommit` invoca el RPC compuesto. El guardado COMMITTED ordinario que cae en `save_weekly_plan_atomic` puede ser solo estado/plan, sin crear reserva MRP. No equiparar etiqueta de estado con reserva. |
| ¿Una recepción posterior modifica factibilidad? | Puede cambiar la cifra entrante que ve el cálculo siguiente. Pero la recepción canónica inicia como DRAFT y sus líneas aparecen en `oc_order_item_recibido`; como el view suma las líneas sin filtrar status, puede bajar el entrante antes de que exista saldo canónico confirmado. Al confirmar, aumenta balance canónico de la ubicación, pero el loader semanal sigue leyendo stock legacy de obra. Es un desacople capaz de producir faltantes ficticios o factibilidad incorrecta. |
| ¿Consumo posterior cambia avance/factibilidad? | Un consumo canónico reduce `inventory_balances` de su ubicación y se refleja en `inventory_consumption_by_budget`; el loader semanal no lee esa vista para recalcular stock de obra y la ruta no incrementa `execution_entries`. Un consumo legacy puede cambiar `stock_por_proyecto`, pero tampoco se encontró el cierre consumo → avance. |
| ¿Climate Workdays modifica cantidades? | No se detectó llamada al módulo Climate Workdays desde el flujo semanal. `resolveWeeklyWeather` y el overlay climático del plan ajustan la recomendación/capacidad por condiciones meteorológicas y pueden persistir batches/snapshots al resolver clima; no cambian la meta contractual ni el cálculo base de materiales. La ruta exacta está en `weekly-plan-shared.ts:485` y el uso en acciones/UI. El efecto operativo exacto del proveedor requiere runtime y queda **UNKNOWN**. |
| ¿Plan realmente integrado al inventario de obra? | Solo parcialmente: el cálculo de obra consulta el ledger legacy; el MRP adicionalmente descuenta/reserva stock central canónico. Los movimientos canónicos de recepción/consumo de obra no alimentan la vista legacy consultada por el plan. |

### Lo que hace el ejemplo de 100 m²

Si una receta y una BOM configuradas mapean 100 m² a 1.000 ladrillos y 10 bolsas, el motor calcula esa necesidad y compara contra sus fuentes configuradas. Presenta lo que encuentra en stock legacy de obra, central disponible/reservado e inbound esperado, y el neto a comprar. No se genera automáticamente RFQ/OC. Una recepción ingresada mediante el botón de OC actualiza el ledger legacy; una recepción canónica cambia balances canónicos pero no el stock de obra consultado por ese motor. Un consumo canónico resta balance canónico y se imputa a partida, pero no actualiza el avance físico. Por tanto, la cadena se rompe entre varios dominios.

```text
META 100 m²
  → receta (opcional) → partidas presupuesto
  → budget_item_materials / BOM → requerimientos
  → stock obra LEGACY + stock central canónico MRP + inbound OC legacy
  → faltante/compra sugerida
  ✗ no crea RFQ/OC
  → recepción OC visible LEGACY ───────→ stock_movimientos/stock_por_proyecto
  → recepción canónica (tool) ─────────→ inventory_movements/balances/vistas
  → consumo pañol canónico ─────────────→ balance y consumo por budget_item
  ✗ no enlaza ese consumo con execution_entries/avance semanal
```

## 3. Inventario canónico

### Modelo y fuente de verdad dentro del nuevo dominio

```text
inventory_locations
   └─ inventory_balances (saldo/costo por empresa + producto + ubicación + moneda)
          ↑ transacción
inventory_movements (libro confirmado e inmutable)
   └─ inventory_movement_costs (asignación de costos/capas)
          ↓ vistas derivadas
inventory_stock_by_location / inventory_stock_global_quantity
inventory_stock_by_project / inventory_consumption_by_budget
```

El saldo físico canónico está en `inventory_balances`; los movimientos son el ledger auditable. Las vistas global, ubicación, obra y consumo se derivan del ledger/balances (migraciones `20260913230000_inventory_panol.sql:49,258,325,1526-1560` y hardening `20260913235000_inventory_p1_hardening.sql:1075-1113`). `lib/inventory/service.ts:140,155` lee `inventory_stock_by_project` y `inventory_consumption_by_budget`; la página de proyecto usa ese servicio para su pestaña Inventario (`app/(internal)/projects/[id]/page.tsx:313-314`).

| Tema | Resultado |
|---|---|
| Saldo físico | `inventory_balances`, particionado por ubicación/empresa/producto y campos de costo/moneda. El movimiento canónico afecta balance por RPC. |
| Stock global y por obra | Vistas canónicas agregadas desde balances + ubicaciones; el stock de obra requiere la ubicación ligada al proyecto. No incluye automáticamente el ledger legacy. |
| Costo | Se guardan costos/monedas de origen y de compañía, y costos por movimiento/capa; no debe asumirse costo uniforme si hay múltiples monedas o procedencia. |
| FX desconocido | La normalización depende del FX de compañía. Si el costo o conversión falta, el registro puede quedar en estado de revisión requerida; operaciones que necesitan valoración coherente pueden rechazarse. No lo convertí en certeza de runtime. |
| Saldo negativo | Las restricciones y RPC bloquean salidas/transferencias/consumos por encima del balance; constraints evitan cantidad negativa. La validación se infiere del SQL, no se probó contra una DB. |
| Idempotencia/doble movimiento | Clave única por empresa/idempotency key y unicidad de fuente, validación/reintentos y bloqueo transaccional en `inventory_post_movement`. Los movimientos confirmados son inmutables; se corrige con movimiento compensatorio, no editando el confirmado. |
| Tenant | Tablas con RLS, vistas `security_invoker`, validación empresa/actor/relaciones por RPC y checks de tenant en funciones/triggers. Se demuestra diseño en migraciones, no aislamiento efectivo en el proyecto vivo. |
| Proyección legacy | `sync_inventory_legacy_projection` solo sincroniza el total `productos.stock_actual`; la migración indica que no reconstruye el detalle legacy por depósitos/proyecto y no hace bridge/backfill automático (`20260913230000_inventory_panol.sql:516-520,819-842`). No unifica los dos ledgers. |

## 4. Recepciones de obra

### Ruta que usa el botón visible de una OC

```text
Orden de compra → Recepción → registrarRecepcion
  → INSERT oc_recepciones + oc_recepcion_items
  → por línea con producto: registrar_stock_movimiento(ENTRADA, project_id de OC)
  → stock_movimientos / proyección productos / stock_por_proyecto
```

La UI importa `registrarRecepcion` desde `app/(internal)/orders/oc-recepcion-actions.ts` y la llama en `recepcion-section.tsx:10,74`; acción y RPC en `oc-recepcion-actions.ts:15,79`. **No llama** a `createCanonicalReceipt` ni a `confirmCanonicalReceipt`. Por tanto, la recepción por esa pantalla no postea `inventory_movements` ni `inventory_balances`; tampoco aparece en las pestañas canónicas que filtran movimientos confirmados.

### Ruta canónica alternativa

```text
manage_inventory_operation
  → createCanonicalReceipt (crea header/líneas DRAFT con ubicación/idempotencia)
  → confirmCanonicalReceipt
  → lib/inventory/service.ts:47 → inventory_confirm_receipt
  → inventory_post_movement(RECEIPT) por línea
  → inventory_movements + inventory_balances + costos/capas
  → Recepciones e Inventario canónicos (solo lectura)
```

Las acciones están en `app/(internal)/inventory/actions.ts:30,241`; el service llama a `inventory_confirm_receipt` (`lib/inventory/service.ts:47`); la función SQL se redefine en `20260913235000_inventory_p1_hardening.sql:867`. `manage_inventory_operation` registra crear/confirmar recepción (`lib/tools/erp/manage-inventory-operation.ts:14,65,77`) y es el camino de herramienta/agent; no es el handler del botón visible OC.

### Riesgos de ciclo

1. **Borrador canónico contado como recibido para inbound.** El alta canónica guarda líneas bajo estado DRAFT. `oc_order_item_recibido` agrega líneas sin filtrar estado (`0042_oc_recepciones.sql:31-36`), y el plan semanal usa ese view. La cifra entrante puede descontarse antes de que el RPC de confirmación aumente balance.
2. **Rollback parcial legacy sin compensación.** `registrarRecepcion` registra stock línea a línea; ante fallo posterior borra la cabecera, pero no se ve una reversión compensatoria de entradas ya aplicadas. El comportamiento exacto ante fallos y constraints requiere integración; el código no implementa compensación visible.
3. **Reversión legacy pierde project_id.** `eliminarRecepcion` invoca el RPC con salida compensatoria pero omite el `p_project_id` que se había usado en la entrada (`oc-recepcion-actions.ts:113-140`). La vista `stock_por_proyecto` agrega por movimientos con proyecto; la inversión sin proyecto puede dejar diferencia en saldo por obra aunque el total global se revierta.
4. **Dos dominios escribibles para el mismo concepto.** Legacy OC y recepción canónica comparten el área funcional/tablas de recepción pero sus efectos de inventario difieren. No se encontró guard que convierta automáticamente o impida representar el mismo hecho en ambos libros; no afirmo una doble escritura canónica inevitable, pero sí una superficie de divergencia/duplicación que debe probarse y resolver.

**Clasificación:** botón visible **LEGACY PATH / BROKEN**; implementación canónica **PARTIALLY WIRED** (backend invocable, no conectada a la UI principal); efecto de runtime en un proyecto real **UNKNOWN**.

## 5. Pañol / rendiciones

### Flujo real

```text
ubicación canónica + portal link
  → /warehouse/[token] (foto, xlsx, xls, csv; múltiples archivos)
  → API tokenizada: evidencia privada + warehouse_submissions/items
  → processWarehouseSubmission
      ├─ foto/archivo no tabular → propuesta de evidencia, sin líneas estructuradas
      └─ xlsx/xls/csv → parsea primera hoja → líneas PROPOSED, NEEDS_REVIEW
  → revisión de línea (producto, cantidad, unidad, partida) [acción/tool, no UI interna]
  → confirmCanonicalWarehouseSubmission
  → inventory_confirm_warehouse_submission
  → inventory_post_movement(CONSUMPTION, ubicación de obra, budget_item_id)
  → inventory_balances + ledger/costo → consumo por partida e Inventario canónico
```

Portal y carga: `app/warehouse/[token]/page.tsx:55`, `app/api/warehouse-portal/[token]/route.ts:122-201`; el token se valida contra ubicación/link activo y se guardan archivos de evidencia en bucket privado. La aplicación valida tipos/tamaños/periodo y marca carga incompleta para cerrar la confirmación si hubo fallo parcial. Configuración del bucket/secrets/expiración y disponibilidad desplegada son **UNKNOWN** sin runtime.

Parser/revisión/confirmación: `app/(internal)/inventory/actions.ts:261,309,439`; servicio RPC `lib/inventory/service.ts:94`; SQL de confirmación `supabase/migrations/20260914020000_inventory_partial_upload_gate.sql:9-73`. La RPC rechaza carga incompleta y líneas aún PROPOSED o incompletas; confirmadas generan consumo desde la ubicación de proyecto y requieren imputación a `budget_item`. Las restricciones de inmutabilidad e idempotencia protegen doble confirmación mediante estado/fuente/idempotency key según migraciones.

| Pregunta | Resultado |
|---|---|
| ¿Quién crea portal/link? | Acción `createWarehousePortalLink` (`inventory/actions.ts:202`), disponible por la operación `create_portal_link` de `manage_inventory_operation` (`lib/tools/erp/manage-inventory-operation.ts:88-89`). Está protegida por plan/rol. No se encontró botón humano en las pestañas de Inventario/Pañol. |
| ¿Rodrigo puede hacerlo? | El tool existe, requiere rol/actor autorizado (administración). No puedo comprobar el rol efectivo de Rodrigo ni autorización/runtime a partir del árbol: **UNKNOWN / condicional**, no prometerlo como capability disponible en producción. |
| ¿Qué formatos admite? | Portal: `image/*`, `.xlsx`, `.xls`, `.csv`, varios archivos; límites también en API. |
| ¿Foto genera consumo? | No por sí sola. Es evidencia/propuesta; no produce líneas estructuradas de producto/cantidad/partida. |
| ¿Excel/CSV se parsea? | Sí, acción intenta parsear la primera hoja/tabla y crear propuestas. No confirma stock automáticamente, no resuelve todo a UUID de producto/partida: requiere revisión. |
| ¿Quién revisa? | `updateWarehouseSubmissionLine` puede enlazar producto, qty, unidad, budget item y marcar CONFIRMED/REJECTED; el tool lo expone. No encontré formulario/acción humana dentro de la sección interna del proyecto que invoque esa función. |
| ¿La pestaña Pañol? | **READ ONLY.** Presenta estados, conteos y líneas; no expone download/evidencia, edición ni confirmar. La sección está en `panol-obra-section.tsx:59+`; el montaje está en `project-tabs-client.tsx:438`. |
| ¿Confirma y descuenta? | Sí, si las propuestas se revisan y cumplen el contrato RPC: genera movimiento `CONSUMPTION`, descuenta balance canónico de ubicación y alimenta vista `inventory_consumption_by_budget`. |
| ¿Afecta avance de ejecución? | No se encontró escritura a `execution_entries` ni al avance semanal como consecuencia del consumo. La imputación `budget_item_id` es trazabilidad/costo de material, no cantidad ejecutada. |
| ¿Inmutabilidad/doble confirmación? | Confirmación bloquea/inmoviliza submission/líneas vinculadas y usa estado/idempotencia/fuente en el RPC. Esto demuestra protecciones de código; no certifica estado actual de DB desplegada. |

### Portal y pestaña interna no son equivalentes

El portal externo permite la carga, pero el usuario interno ve una lista de submissions/line items en la página del proyecto (`page.tsx:406,436`) y un componente de lectura. La pantalla no ofrece la acción para completar el ciclo de revisión. En particular, que `processWarehouseSubmission` y `confirmCanonicalWarehouseSubmission` existan no implica que una persona pueda acceder a ellas desde esa pestaña.

**Clasificación:** recepción de evidencia **PARTIALLY WIRED**; parser Excel/CSV **PARTIALLY WIRED**; foto como evidencia **READ ONLY / PARTIALLY WIRED**; pestaña del proyecto **READ ONLY**; confirmación backend **PARTIALLY WIRED** por falta de UI operacional; funcionamiento del portal desplegado **UNKNOWN**.

## 6. Pestañas Inventario / Recepciones / Pañol

| Pestaña | Consulta / presenta | Mutaciones visibles | Procedencia | Estado |
|---|---|---|---|---|
| Inventario de obra | Página consulta `inventory_stock_by_project` y `inventory_consumption_by_budget` por service; el componente presenta saldo/consumo canónico (`projects/[id]/page.tsx:313-314`, `inventario-obra-section.tsx:27`). | Ninguna en la pestaña. | Canónica. No es fuente del weekly loader. | **READ ONLY** |
| Recepciones de obra | Página filtra `inventory_movements` confirmados de tipo `RECEIPT` y ubicación proyecto (`page.tsx:325`); `RecepcionesObraSection` aclara que muestra las que pasaron `confirmCanonicalReceipt` (`recepciones-obra-section.tsx:22-24`). | Ninguna. | Canónica. No ve la recepción legacy del botón OC. | **READ ONLY** |
| Pañol | `warehouse_submissions`, líneas y conteo de evidencia; filas/estados (`page.tsx:406-436`; `panol-obra-section.tsx:59+`). | Ninguna: no se encontraron botones/handlers de revisión/confirmación. | Canonical warehouse submission. | **READ ONLY** |
| Stock clásico | `stock_movimientos`, productos, vistas/proyecciones legacy; tiene diálogo ENTRADA/SALIDA/AJUSTE/TRANSFERENCIA. | Sí, a través de `registrarMovimiento` → `registrar_stock_movimiento` (`stock/[id]/movimiento-dialog.tsx:10,161,190`; `stock-actions.ts:127,144`). | Legacy. | **LEGACY PATH** |

## 7. Movimientos

| Movimiento | Backend | Entry point UI encontrado | ¿Afecta balances canónicos? | ¿Dónde vuelve a aparecer? | Estado |
|---|---|---|---|---|---|
| **RECEIPT** | `inventory_confirm_receipt` compone `inventory_post_movement(RECEIPT)`; además existe RPC legacy `registrar_stock_movimiento(ENTRADA)`. | El botón de la OC usa `registrarRecepcion` → RPC legacy. Canónico: `manage_inventory_operation`, no esa pantalla. | Legacy: no. Canónico confirmado: sí, `inventory_balances`. | Legacy en recepción OC/stock clásico; canónico confirmado en Recepciones e Inventario de obra. | **LEGACY PATH / PARTIALLY WIRED** |
| **TRANSFER** | `inventory_post_movement(TRANSFER)` mueve saldo entre ubicaciones conservando cantidad total y cost layers; legacy RPC tiene `TRANSFERENCIA` entre depósitos. | UI stock clásica tiene transferencia; no se encontró UI canónica. Herramienta del agente permite movimiento canónico. | Legacy: no. Canónico: sí, resta origen y suma destino. | Ledger/vistas de ambos dominios, pero no se consolidan entre sí. | **PARTIALLY WIRED / LEGACY PATH** |
| **CONSUMPTION** | `inventory_post_movement(CONSUMPTION)`; confirmación de Pañol llama movimiento y liga `project_id`/`budget_item_id`. Legacy SALIDA usa su RPC. | Pañol canónico vía herramienta de operación; UI stock clásica para legacy SALIDA. | Pañol canónico: sí. SALIDA legacy: no. | Canónico en Inventario/`inventory_consumption_by_budget`; legacy en stock/proyecto legacy. Ninguna de las rutas actualiza `execution_entries`. | **PARTIALLY WIRED / LEGACY PATH** |
| **RETURN** | El enum/RPC/tool genérico canónico admite devolución como movimiento de ubicación a ubicación. | No se encontró botón o formulario normal. | Sí cuando el RPC canónico es invocado. | Ledger/balance canónicos; sin pantalla de operación identificada. | **DEAD / ORPHANED para UI humana** |
| **ADJUSTMENT** | RPC canónico permite ajuste de balance; puede requerir cantidad firmada. Legacy RPC y UI tienen AJUSTE con semántica legacy. El input del tool genérico valida `quantity > 0`. | Ajuste legacy en diálogo stock; no UI canónica. | Legacy: no. Canónico: sí por RPC; ajuste negativo no accesible por ese schema de tool. | Legacy stock clásico vs vistas canónicas, sin sincronización de detalle. | **PARTIALLY WIRED / LEGACY PATH** |

Una escritura canónica se registra en `inventory_movements`, ajusta `inventory_balances`, persiste información de costo en las estructuras correspondientes y se refleja en vistas derivadas. La escritura legacy añade `stock_movimientos` y modifica/proyecta `productos.stock_actual`; la vista de obra `stock_por_proyecto` se arma desde los movimientos legacy asociados a proyecto (`0043_stock.sql`, `0053_stock_por_proyecto.sql`). Son libros separados.

## 8. Legacy vs canonical

| Concepto | Legacy | Canónico | Qué usa UI/cálculo hoy |
|---|---|---|---|
| Catálogo/total producto | `productos.stock_actual`, escrituras incrementales del RPC legacy | Proyección de total de `inventory_balances` por `sync_inventory_legacy_projection` | Conviven; no debe tomarse el campo total como prueba de equivalencia por ubicación/proyecto. |
| Libro de movimientos | `stock_movimientos` con ENTRADA/SALIDA/AJUSTE/TRANSFERENCIA | `inventory_movements` con RECEIPT/TRANSFER/CONSUMPTION/RETURN/ADJUSTMENT | Diálogo `/stock` escribe legacy; herramientas/backend nuevos escriben canónico. |
| Depósitos / ubicaciones | `depositos`, stock por depósito legacy | `inventory_locations`, balances por ubicación | UI stock usa depósitos legacy; portal y vistas nuevas usan ubicaciones canónicas. |
| Saldo por proyecto/obra | `stock_por_proyecto`, derivado de `stock_movimientos` con proyecto | `inventory_stock_by_project`, derivado de balance/ubicaciones | Plan semanal usa legacy; pestaña Inventario de proyecto usa canónico. |
| Recepción OC | `oc_recepciones` + `oc_recepcion_items` + RPC legacy ENTRADA | Tablas compartidas de receipt enlazadas con movement ID; confirmar por `inventory_confirm_receipt` | Botón OC usa legacy; pestaña Recepciones solo canónico. |
| Cantidad recibida/inbound | `oc_order_item_recibido` suma ítems de recepción | No se halló una vista de inbound separada que filtre confirmación canónica | Weekly plan consulta view legacy y puede contar líneas DRAFT. |
| Consumo/partida | Legacy SALIDA y `stock_consumo_obra`/vistas legacy | Movimiento CONSUMPTION con `project_id` y `budget_item_id`; `inventory_consumption_by_budget` | Stock clásico escribe legacy; Pañol confirmado canónico; Inventario de proyecto lee canónico. |
| Ajuste/transferencia | Diálogo stock operativo | RPC canónica/tool disponible, con UI normal ausente | La ruta humana predominante es legacy. |
| Costos/monedas | Costos legacy guardados junto al movimiento, sin capas/ledger canónico equivalente demostrado | Costos por moneda/compañía, movimientos/capas y revisión | No hay evidencia de reconciliación automática de costo entre dominios. |
| Compatibilidad | Las pantallas existentes continúan funcionando con su proyección | `sync_inventory_legacy_projection` sincroniza total de producto, no movimiento ni detalle por depósito/obra | La convivencia no representa una migración completa ni backfill automático. |

**Punto exacto de convivencia:** migración de inventario declara que legacy (`productos`, `stock_movimientos`, `stock_por_proyecto`, `oc_recepciones`) permanece para pantallas antiguas y que el saldo nuevo vive por ubicación. El mecanismo de compatibilidad proyecta `productos.stock_actual`, pero no unifica ni reconstruye `stock_por_proyecto` (`20260913230000_inventory_panol.sql:7-9,516-520,819-842`). Así puede haber totales de catálogo que parecen coincidir mientras saldos de obra, depósitos y libros de movimientos divergen.

## 9. Pruebas encontradas y alcance

**No ejecuté ninguna prueba.** La clasificación es por contenido estático.

| Tipo | Archivos encontrados | Qué demuestran / no demuestran |
|---|---|---|
| UNIT | `test/weekly-plan.test.ts`, `test/weekly-plan-blocks.test.ts`, `test/mrp-coverage.test.ts`, `test/progress-forecast.test.ts`, `test/production-recipe.test.ts`, `lib/inventory/__tests__/domain.spec.ts`, tests del parser/evidence | Cálculos puros, transformación/validación y reglas de dominio con fixtures; no invocan UI completa, Auth, RLS ni garantizan integridad de una DB desplegada. |
| CONTRACT / source | `lib/inventory/__tests__/migration-contract.spec.ts`, `test/inventory-p1-hardening.test.ts`, tests de UX/UI y migraciones de weekly/MRP | Comprueban nombres/patrones/contratos o detalles de código/migración. No demuestran que la migración corrió ni que roles/datos reales permiten el flujo. |
| INTEGRATION / live DB | `test/weekly-plan-atomic-db.test.ts`, `test/mrp-rpc-live.test.ts`, `test/mrp-lifecycle-live.test.ts`, `test/weekly-plan-rls-auth.test.ts`, `test/weekly-plan-e2e.ts` | Hay pruebas/scripts que llaman la API Management/REST y escriben fixtures o ejecutan RPC/SQL. Apuntan en código a project ref de producción `ezucivipgmbvamhugkbj`; **no se ejecutaron**. No se reproduce ningún secreto ni dato de autenticación aquí. `weekly-plan-e2e.ts` es guion SQL/clima, no prueba browser de E2E. |
| E2E browser | No se identificó una prueba de navegador que complete los circuitos indicados | Sin evidencia automatizada de pantalla → acción → DB → vista para recepción canónica, revisión/confirmación interna de Pañol o plan → compra → recepción → consumo → avance. |

Tests live contra un ref de producción embebido son un riesgo P0 de seguridad operativa: antes de volver a habilitarlos deberían cambiar a entorno aislado sintético y fallar cerrado si el project ref no es el autorizado. Esto es recomendación; no modifiqué harness ni ejecuté esos tests.

## 10. Gaps priorizados (sin arreglos)

| Prioridad | Gap probado por código | Consecuencia |
|---|---|---|
| **P0** | `test/*live*`, `weekly-plan-atomic-db.test.ts` y `weekly-plan-e2e.ts` contienen llamada al proyecto Supabase de producción/ref productivo. | Un comando de prueba puede insertar/eliminar datos o correr RPC/SQL contra producción. No correr; aislar por proyecto Free/sintético y hacer guard del ref. |
| **P0** | El botón visible de recepción OC escribe ledger legacy, mientras que receipt tab e inventario de proyecto muestran solo movimientos/balances canónicos. El mismo hecho operativo puede no figurar donde el usuario espera y queda sin una única fuente. | Divergencia de stock/recepción y posibilidad de operación duplicada al usar otra ruta. |
| **P0** | `eliminarRecepcion` compensa entradas legacy sin `p_project_id`; `registrarRecepcion` ante error parcial no revierte movimientos ya posteados. | Saldo por proyecto inconsistente o entradas huérfanas en fallo parcial. |
| **P1** | Weekly plan usa `stock_por_proyecto` legacy; Pañol/recepción canónicos modifican balances/vistas nuevas. | El siguiente plan puede no ver consumo/recepción canónicos de obra y estimar faltante/cobertura incorrectos. |
| **P1** | Inbound `oc_order_item_recibido` no filtra status, mientras una receipt canónica recién creada ya inserta líneas DRAFT. | Un borrador puede restar cantidades del inbound aunque aún no haya movimiento confirmado/stock físico. |
| **P1** | Faltante MRP solo se presenta/reserva; no crea RFQ/OC. | La necesidad calculada no se transforma en proceso de adquisición. |
| **P1** | Consumo por partida no actualiza avance `execution_entries` ni recalcula/consume reservas del plan con un vínculo de producción demostrado. | Inventario consumido y avance reportado no cierran el mismo circuito. |
| **P2** | No hay UI interna para crear portal/location ni administrar/revisar/confirmar submissions; acceso está en acciones y tool del agente. | Flujo depende de capacidades/roles del agente o llamadas no visibles para usuario operacional. |
| **P2** | No se encontró UI canónica normal para TRANSFER, RETURN y ADJUSTMENT; schema genérico limita adjustment a positivo. | Operaciones canónicas incompletas/inaccesibles desde pantallas regulares. |
| **P2** | Pestañas Inventario, Recepciones y Pañol son de solo lectura. | No se puede completar el ciclo desde el contexto de obra aunque allí se inspeccionan sus resultados. |
| **P3** | Estados READY/NEEDS_REVIEW y evidencia no están acompañados por una consola interna de inspección clara; proceso identificado termina NEEDS_REVIEW y no se halló transición normal a READY. | UX ambigua, baja observabilidad y dependencia de tool para conocer/reparar casos atascados. |

P0 se usa aquí para integridad operacional/posibilidad de daño o harness de producción; P1 para corte de flujo principal; P2 para capacidad backend sin UI/acción humana; P3 para claridad y observabilidad.

## 11. Camino mínimo a FULLY WIRED (propuesta, no implementada)

1. **Cerrar la superficie de pruebas.** Mover tests live a proyecto aislado con fixtures sintéticos; añadir allowlist explícita del project ref y abortar si apunta al ref productivo. No ejecutar ni provisionar en esta auditoría.
2. **Elegir un único libro de inventario operativo.** Hacer que la recepción visible OC llame a create/confirm canónico con ubicación, mapping producto, costo/moneda e idempotencia. Definir una estrategia explícita de migración/lectura legacy; evitar un segundo write silencioso.
3. **Hacer la reversión segura.** Convertir recepción legacy, si debe permanecer temporalmente, en transacción/compensación atómica y preservar proyecto/ubicación en reversos; no borrar header después de efectos parciales sin revertirlos.
4. **Corregir la semántica de inbound.** Solo contar receipts confirmadas (o separar `received_confirmed` de draft/proposed) en el view consumido por weekly plan; las líneas DRAFT no deben afectar factibilidad.
5. **Unificar stock del Plan Semanal con canónico.** Cargar saldo de obra desde `inventory_stock_by_project`; conciliar cantidades por unidad y descontar reservas activas apropiadas, inbound confirmado y fecha, sin mezclar unidades/doble conteo. Proveer backfill/reconciliación legacy antes de cambiar fuente.
6. **Conectar el déficit con Compras.** Desde resultado neto, permitir generar requisición/RFQ/OC con trazabilidad al plan y partidas/materiales; exigir aprobación explícita y evitar que preview escriba compras.
7. **Exponer operaciones humanas del Pañol.** UI autenticada para evidencia, propuesta parsed, mapping/revisión, editar/confirmar/rechazar y error/reintento; permisos administrativos claros. Confirmar consumo solo después de revisión completa y con idempotencia.
8. **Cerrar consumo → ejecución.** Definir si consumo por partida equivale a avance (normalmente no automáticamente); si existe vínculo causal, registrar aparte la cantidad ejecutada validada, evitando inferir m² desde consumo sin rendimiento/criterio de aprobación.
9. **Exponer UI canónica de movimientos faltantes.** Transfer, return y adjustment con ubicación origen/destino, costo, motivo, permisos y confirmación; admitir signo correcto de ajuste según contrato sin eludir no-negative/idempotency.
10. **Probar el flujo completo en sandbox.** E2E autenticado, dos tenants ficticios, proyecto aislado y cero servicios externos reales: plan → reserva → orden aprobada → receipt confirmada → stock de obra → consumo Pañol → visibilidad y actualización de avance según regla explícita.

## 12. Límites / hechos no demostrables por lectura

- No afirmo que la migración esté aplicada en producción o en preview: solo que el SQL está en el snapshot.
- No se inspeccionó ni escribió ninguna base de datos; no se comprobó RLS real, Auth, Storage bucket, tokens, roles efectivos ni contenido de fixtures.
- Disponibilidad real del portal, permisos efectivos de Rodrigo, respuestas de Open-Meteo, errores bajo concurrencia y estados/datos actuales son **UNKNOWN**.
- No se ejecutó ningún test local ni remoto. En particular, se evitó todo test con project ref productivo.
- La creación de este informe no modifica la funcionalidad del ERP ni constituye corrección de los gaps.
