# Rodrigo ERP Knowledge V5 — runtime y composición

## Regla canónica

El conocimiento describe código y esquema; nunca contiene saldos, nombres, credenciales ni estado vivo. Rodrigo consulta datos actuales mediante tools registradas y tenant-scoped. Las operaciones de lectura/análisis son automáticas. Preparar un resultado sólo puede ser automático cuando no cambia estado operativo; toda mutación, movimiento físico, confirmación, emisión o llamada externa pasa por el Gateway y aprobación humana.

## Superficies V5 trazadas

- `get_supplier_invoice_overview` consulta `invoices`, proveedores, adjuntos, matches, excepciones y referencias existentes de órdenes de pago.
- `manage_supplier_invoice` llama `linkInvoiceToOrder`, `unmatchOrder` o `deleteInvoice`; no llama acciones de pago.
- `get_work_order_overview` consulta `work_orders`, `work_order_items`, documento de venta, cliente y eventos.
- `manage_work_order` llama `updateWorkOrderStatus` o `approveWorkOrderInternal`; la OT nace por la RPC real de aceptación de cotización.
- `get_sifen_overview` consulta el CDC/URLs persistidos y `isGoekuaConfigured` sin revelar valores de entorno.
- `manage_sifen_document` llama `emitirFE`, `emitirNC` o `consultarFE`, que a su vez usan `lib/goekua.ts`; no agrega una integración ni una migración.

## Composición emergente

El modelo puede encadenar resolución humana, lecturas de dominio y un preview usando el loop de DeepSeek. El runtime registra de forma segura la intención truncada/redacted, secciones de knowledge seleccionadas, tools solicitadas/ejecutadas, si hubo aprobación y un preview redacted de la respuesta. No se registran payloads completos, cookies, Authorization ni secretos.

La composición MRP → abastecimiento → RFQ/OC sigue siendo razonamiento sobre tools existentes: no hay un skill/routine ni una función transversal que fuerce el flujo.

## Fronteras críticas

- Tesorería es lectura únicamente.
- DNCP formal y Auction Lab/Bot están fuera del alcance de Rodrigo.
- APU de mano de obra/equipos/rendimientos y adjuntos conversacionales no están disponibles en el ERP/runtime auditado.
- Si DeepSeek no está configurado, `/api/agent/chat` responde 503 y no existe fallback determinista.

## Fuentes

- `lib/tools/index.ts`
- `lib/agent/orchestrator.ts`
- `lib/agent/gateway.ts`
- `app/(internal)/invoices/actions.ts`
- `app/(internal)/ventas/[id]/quotation-actions.ts`
- `app/(internal)/ventas/sifen-actions.ts`
- `lib/goekua.ts`
- `lib/scanner/session-service.ts`
- `rodrigo/knowledge/CAPABILITIES-GAPS.md`
