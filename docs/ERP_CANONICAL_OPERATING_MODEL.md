# ERP — modelo operativo canónico

Fecha: 2026-09-25
Estado del código: `main` en `83333ce69193e3530829fc55f1aff73eedc28382` (Batch 9); Batch 10 documenta los contratos existentes.
Propósito: registrar qué fuente y qué transición gobiernan los flujos tocados por la campaña de reparación. Este documento describe el código; no certifica un despliegue ni una base remota.

## Reglas de autoridad

1. Una proyección o campo de compatibilidad no reemplaza al libro transaccional del dominio.
2. Un preview/cálculo propone; el servidor vuelve a validar con datos actuales antes de confirmar o comprometer.
3. La confirmación humana es explícita cuando la transición cambia stock, estado contractual o dinero.
4. Los RPCs sensibles validan empresa/actor, usan `search_path` fijado y restringen grants; los flujos repetibles llevan idempotencia.
5. Los datos no observados quedan desconocidos. Ningún simulador, importador o proveedor externo debe convertir ausencia de evidencia en un hecho.

## Fuentes canónicas y transiciones

| Dominio | Fuente de verdad / proyección | Transición autorizada |
|---|---|---|
| Stock | `inventory_movements` es el registro de hechos físicos; `inventory_balances` materializa saldos por empresa, producto, ubicación y moneda de costo. Las vistas globales agregan las ubicaciones. | Recepciones confirmadas, rendiciones revisadas, y RPC manual restringido para `TRANSFER`, `RETURN` y `ADJUSTMENT`. No escribir `productos.stock_actual` ni `stock_movimientos` como flujo paralelo. |
| Plan semanal / MRP | Plan y líneas semanales ligadas a partidas; recetas de producción conectan objetivos físicos con materiales; `inventory_reservations` representa promesa de stock central, no un movimiento. | El servidor recalcula requisitos y cobertura con datos frescos, compara la referencia del cliente y compromete plan + reservas en una sola transacción. DRAFT/CLOSED libera reservas según el ciclo de vida. |
| Clima de obra | Eventos, estado de jornada y evidencia asociados a la obra; los pronósticos guardados conservan su batch/snapshot y cobertura. | Clima puede superponerse al preview y aportar evidencia; fallo o cobertura parcial se marca como tal. La jornada requiere confirmación u override humano. El clima no inventa ejecución física. |
| Certificados de obra | `project_certificates` y `project_certificate_items`, conciliados con partidas y mediciones de ejecución. | Resync cuantitativo bloqueado y limitado a borradores; ciclo de elaboración/verificación/aprobación/facturación conserva sus estados. Aprobación de certificado de subcontrato no equivale a pago. |
| Tesorería | `movimientos_tesoreria` es ledger append-only; los saldos materializados se contrastan con el libro. | Cobros, reversas, alta de cuenta con saldo inicial y operaciones bancarias usan transacciones/RPCs atómicas. Una reversa registra contra-movimientos con motivo; no edita ni borra el movimiento original. Moneda de cuenta y documento debe coincidir cuando el flujo no admite conversión explícita. |
| Flujo de caja | Facturas/documentos por cobrar, certificados elegibles, facturas de compra y gastos recurrentes dentro de 30 días. | Certificados aprobados/facturados son proyección; si existe un documento de venta no anulado asociado, ese documento es la única fuente del cobro para evitar duplicación. |
| Licitaciones / subastas | PBC extraído, observaciones y snapshots versionados de análisis; el sandbox mantiene salas, participantes, ofertas, políticas y eventos separados. | Criterios sin evidencia quedan desconocidos/requieren revisión. Auction Bot y Auction Lab son simulaciones: no conectan a DNCP ni envían ofertas reales. |

## Recepción de compra, revisión e inventario

El recorrido de recepción externa queda separado en tres etapas:

1. Un usuario interno autorizado genera un enlace aleatorio de un solo uso, con vencimiento de siete días. La base guarda hash y pista corta, no el secreto. El enlace se limita a una OC de la empresa y a una ubicación activa de su obra.
2. El proveedor envía líneas pendientes y evidencia al bucket privado `warehouse-evidence`. La RPC `submit_receipt_portal` invoca `inventory_create_receipt` y guarda una recepción canónica `DRAFT` más metadatos de evidencia. No inserta directamente en tablas legacy ni publica movimientos de stock.
3. Administración revisa evidencia y vincula productos faltantes con la RPC acotada `inventory_set_receipt_item_product`. La confirmación existente de recepción valida ubicación, cantidades, costo y tenant, y recién entonces publica movimientos `RECEIPT`.

La clave de idempotencia deriva del identificador del enlace y el token se desactiva dentro de la transacción de envío. Se verifica firma binaria además del MIME declarado; límites: 10 archivos, 20 MB por archivo, 50 MB en total. Los archivos cargados se limpian cuando la carga o la RPC completa falla. Los enlaces públicos reciben `no-store`, `no-referrer` y `noindex`.

Una línea sin producto de inventario puede quedar en borrador para revisión, pero no genera un movimiento hasta tener un vínculo válido. Si la OC ya fijó `producto_id`, el portal conserva esa identidad; el revisor no puede reemplazarla por otro producto.

## Inventario y consumo

- Las entradas, salidas, transferencias y ajustes se registran mediante el servicio canónico; las escrituras humanas admitidas son únicamente transferencia, devolución y ajuste autorizado.
- Todo movimiento manual lleva actor, clave UUID de idempotencia y empresa; el ajuste necesita motivo. La base valida pertenencia del producto/ubicaciones y evita saldo negativo.
- Una rendición de depósito sólo puede confirmarse con evidencia completa y líneas confirmadas. Su confirmación canónica produce `CONSUMPTION` ligado a la línea, ubicación, obra y partida; no se permite fabricar un consumo paralelo con ese origen.
- Las rendiciones y recepciones confirmadas y sus líneas son inmutables. Una corrección se registra como hecho compensatorio, no como edición retroactiva.
- El dashboard de administración obtiene alertas de stock desde la vista de cantidad global canónica (`inventory_stock_global_quantity`) y suma ubicaciones. Los campos históricos de stock se conservan por compatibilidad y no deben usarse como saldo autoritativo.

## Semanal / MRP / clima

Los objetivos del plan semanal se resuelven contra partidas, ejecución y recetas/BOM. El preview calcula materiales y asigna cobertura entre stock de obra, stock central e inbound con fecha confirmada. Para comprometer un plan, `saveWeeklyPlanAction` vuelve a cargar datos del servidor, recomputa el cálculo y rechaza si la referencia enviada por el cliente difiere. La RPC `commit_production_plan_atomic` guarda el plan y sus reservas juntas, con bloqueo/idempotencia; si la reserva no alcanza, no queda un plan parcialmente comprometido.

El modo clima vincula el overlay a un snapshot/batch y expone días solicitados, cubiertos y cobertura parcial. Un fallo del proveedor no se presenta como pronóstico favorable. La jornada puede confirmarse, sobrescribirse con intervención humana o registrarse manualmente con su evidencia.

## Tesorería, dashboard y caja

El ledger de tesorería impide UPDATE/DELETE ordinarios; la reversa bloquea el cobro, crea movimientos opuestos y marca motivo/actor/relación en la misma transacción. La creación de cuenta y saldo inicial también es atómica. Los RPCs aplican tenant, permisos, `search_path` y grants explícitos.

Los KPIs de stock comparan mínimo contra saldo canónico agregado por ubicación, nunca contra `productos.stock_actual`. El flujo de caja proyecta cobros de ventas, certificados sin documento de venta activo, pagos de compras y gastos recurrentes. El enlace certificado → documento de venta evita contar dos veces el mismo ingreso. Los importes se agregan y muestran por moneda; no se suman monedas distintas como si fueran equivalentes.

## Licitaciones y límites del sandbox

El extractor de PBC conserva los criterios sin número o evidencia como desconocidos; la matriz de cumplimiento puede exigir revisión y no afirma un cumplimiento positivo por default. El motor de oferta y el Auction Bot/Lab ofrecen análisis/simulación; el texto visible aclara que no son operaciones en DNCP. Las políticas del sandbox quedan versionadas y las vistas no exponen el cierre aleatorio privado ni hashes de tokens.

Esto no habilita conexión real, presentación de oferta ni automatización de decisiones comerciales sin revisión y autorización separadas.

## Alcance, validación pendiente y exclusiones

- Batch 9 agrega `20260925034114_restore_receipt_portal_canonical.sql`. Se validó estáticamente y con pruebas focales/typecheck/lint; esta campaña no aplicó esa migración a Supabase remoto ni ejecutó pruebas contra producción.
- El código y la documentación no sustituyen la certificación de migraciones desde cero en el proyecto aislado aprobado. No se declara aquí que Auth, RLS, Storage o RPCs remotos estén certificados.
- El proyecto de producción y sus datos quedan fuera de alcance. No hay deploy ni cambios manuales a Supabase en Batch 10.
- Scanner físico iPhone/WebKit permanece diferido; este contrato no habilita captura de dispositivo.
- Los consumidores legacy o agentes que todavía lean campos históricos deben migrarse explícitamente antes de tratarlos como fuentes canónicas.

## Referencias de código

- Inventario: `supabase/migrations/20260913230000_inventory_panol.sql`, `20260913235000_inventory_p1_hardening.sql`, `20260924212056_inventory_manual_movement_contract.sql` y `20260924225450_batch4_lock_inventory_legacy_paths_and_confirm_state.sql`.
- Recepción canónica y portal: `supabase/migrations/20260924074417_canonical_purchase_receipt_flow.sql` y `20260925034114_restore_receipt_portal_canonical.sql`.
- MRP: `app/(internal)/projects/weekly-plan-actions.ts`, `lib/procurement/mrp-coverage.ts`, `lib/procurement/production-recipe.ts` y `supabase/migrations/20260917000004_production_recipes.sql` / `20260917000005_mrp_reservations.sql`.
- Tesorería: `supabase/migrations/20260925022101_batch5_admin_treasury_atomicity.sql`; dashboard/caja: `app/(internal)/dashboard/data.ts`, `lib/dashboard/cashflow.ts`.
- Contratos focales: `lib/dashboard/__tests__/batch5-admin-contract.spec.ts`, `lib/__tests__/batch6-operations-contract.spec.ts`, `lib/__tests__/batch7-tender-surface-contract.spec.ts` y `lib/inventory/__tests__/receipt-portal.spec.ts`.
