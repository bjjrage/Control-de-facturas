# Módulo: compras

## Verificado

La cadena de compra se representa como RFQ, ítems, proveedores invitados, respuestas/cotizaciones, comparación y orden de compra. El registry de Rodrigo contiene lectura de cada parte principal, búsqueda de proveedores, creación de borrador RFQ, preparación de OC, envío de RFQ y emisión de OC.

Leer no equivale a ejecutar. Preparar deja un artefacto para revisar. Enviar RFQ y emitir OC están detrás del Gateway y la aprobación definida por el nivel de riesgo.

## Source map

- `lib/tools/procurement/get-rfq.ts`
- `lib/tools/procurement/get-rfq-responses.ts`
- `lib/tools/procurement/compare-quotations.ts`
- `lib/tools/procurement/search-suppliers.ts`
- `lib/tools/procurement/create-rfq-draft.ts`
- `lib/tools/procurement/prepare-purchase-order.ts`
- `lib/tools/procurement/send-rfq.ts`
- `lib/tools/procurement/issue-purchase-order.ts`
- `app/(internal)/rfqs/actions.ts`
- `app/(internal)/orders/actions.ts`
