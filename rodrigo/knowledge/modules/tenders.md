# Módulo: licitaciones y competidores

## Verificado

La aplicación tiene licitaciones, lotes, ítems, oferentes, ofertas, documentos, seguimiento, radar de competidores, observaciones de costos y Auction Lab/sandbox. También existen flujos de importación y vinculación de licitación a obra.

## Exposición a Rodrigo

`get_tender_overview` lee una licitación, sus lotes, ítems, oferentes y documentos. `manage_tender` puede guardar decisión/seguimiento, preparar el paquete de oferta, persistir evaluación comercial, extraer requisitos/ofertas de texto y convertir una licitación GANADA en obra, siempre con aprobación. No presenta ofertas a DNCP ni opera Auction Lab/Auction Bot.

## Source map

- `app/(internal)/licitaciones/actions.ts`
- `app/(internal)/licitaciones/dashboard-data.ts`
- `app/(internal)/licitaciones/[id]/page.tsx`
- `app/(internal)/licitaciones/competidores/actions.ts`
- `app/(internal)/licitaciones/auction-lab/actions.ts`
- `lib/procurement/competitor-intelligence.ts`
- `lib/auction-sandbox/server.ts`
- `lib/tools/erp/get-tender-overview.ts`
- `lib/tools/erp/manage-tender.ts`
