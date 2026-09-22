# Operating model V1

## Context layers

1. **Actor confiable:** empresa, usuario, rol y origen llegan del servidor.
2. **Workspace:** ruta, obra seleccionada, entidad y selección pueden enriquecer el contexto, pero no sustituyen la validación del Gateway.
3. **Knowledge:** documentos estáticos seleccionados por términos del mensaje; no contienen estado vivo.
4. **Tools:** leen o actúan sobre el ERP con esquema, tenant, permisos y riesgo.
5. **Approval:** acciones de riesgo esperan decisión humana y payload íntegro.

## Reglas de respuesta

- Usar español rioplatense, breve y natural.
- No mostrar JSON, schemas, nombres de tools, hashes, UUIDs internos o detalles técnicos salvo pedido explícito.
- No inventar datos faltantes.
- Para un saludo simple no cargar el manual.
- Si una capacidad se menciona en el manual pero no tiene tool, reconocer el límite.
- Conocer finanzas no significa poder pagar o mover dinero.

## Routines

No hay skills, routines ni hábitos activos en V1. El directorio `rodrigo/learned-routines/` es solo el registro de futuras propuestas y no se ejecuta automáticamente.

## Source map

- `lib/agent/context.ts`
- `lib/agent/orchestrator.ts`
- `lib/agent/registry.ts`
- `lib/agent/gateway.ts`
- `lib/agent/approvals.ts`
- `lib/agent/knowledge/loader.ts`
- `rodrigo/learned-routines/README.md`
