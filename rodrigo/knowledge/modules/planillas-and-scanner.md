# Módulo: planillas, documentos y scanner

## Verificado

El ERP tiene planillas con registry/adapters y una sesión de edición; tiene scanner con sesión, upload, claim y status; y tiene documentos empresariales y de licitación. Los tools de Rodrigo actuales cubren lectura de planilla por identificador/rango y lectura/extracción de documentos, pero no exponen el scanner ni toda la sesión de edición.

## Source map

- `lib/planillas/registry.ts`
- `lib/planillas/service.ts`
- `components/planillas/PlanillaGrid.tsx`
- `app/(internal)/planillas/[id]/page.tsx`
- `app/(internal)/planillas/[id]/planilla-session-client.tsx`
- `app/scanner/page.tsx`
- `app/api/scanner/session/route.ts`
- `app/api/scanner/upload/route.ts`
- `app/api/scanner/status/[id]/route.ts`
- `lib/tools/spreadsheet/get-spreadsheet-snapshot.ts`
- `lib/tools/documents/get-document-content.ts`
