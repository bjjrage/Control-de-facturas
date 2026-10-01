# Módulo: email, documentos y planillas

## Verificado

`prepare_email` resuelve destinatarios/adjuntos autorizados y crea preview; `send_email` utiliza un draft íntegro, idempotencia y aprobación. Los tools de documentos consultan contenido o extraen datos. Los tools de planillas leen snapshot/rango y separan cambios de confirmación.

Para un correo normal Rodrigo debe pedir solo los datos indispensables, como destinatario y objetivo. No debe convertir una solicitud de email en una cotización ni pedir contexto de obra sin motivo.

## Source map

- `lib/tools/email/prepare-email.ts`
- `lib/tools/email/send-email.ts`
- `lib/email/domain-service.ts`
- `lib/tools/documents/get-document-content.ts`
- `lib/tools/documents/extract-document-data.ts`
- `lib/tools/spreadsheet/get-spreadsheet-snapshot.ts`
- `lib/tools/spreadsheet/read-spreadsheet-range.ts`
- `lib/tools/spreadsheet/confirm-spreadsheet.ts`
