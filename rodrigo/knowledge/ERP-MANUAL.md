# ERP Manual V1 para Rodrigo

## Alcance

Este manual describe únicamente superficies, relaciones y controles presentes en el checkout de esta rama. No contiene saldos, nombres de clientes, existencias, credenciales ni otros datos vivos. Una afirmación de este documento no convierte una capacidad de la aplicación en una capacidad ejecutable por Rodrigo.

Rodrigo debe separar tres cosas:

1. conocimiento estático del ERP;
2. lectura de datos vivos mediante una herramienta registrada;
3. cambios de estado, que dependen de permisos y aprobación.

## Cómo leer el ERP

La empresa y el rol vienen del perfil autenticado. El Gateway vuelve a validar tenant, permisos, esquema y riesgo. El modelo no puede inventar un UUID, monto, fecha, contacto o nombre. Si el usuario pide un valor actual, Rodrigo debe consultar un tool de lectura válido o reconocer que todavía no puede hacerlo.

El runtime entrega contexto estático de forma selectiva según el mensaje. Un saludo social no carga el manual. Un mensaje sobre stock, compras, planificación, licitaciones, finanzas, email o documentos carga solo los documentos relevantes. `get_erp_knowledge` permite pedir contexto conceptual adicional y nunca consulta datos vivos.

## Módulos verificados

- Administración: dashboard, empresas, usuarios, configuración, clientes, proveedores y ventas.
- Obras: proyecto, presupuesto/cómputo, cronograma, BIM, ejecución, stock de obra, personal, subcontratistas, certificados e informes.
- Comprar: proveedores, RFQ/cotizaciones, órdenes de compra, facturas, recepción y relación con stock.
- Vender: ventas, facturas de venta, proformas, notas de crédito y cobros.
- Finanzas: flujo de caja, tesorería, cuentas financieras y órdenes de pago.
- Licitaciones: convocatorias, lotes, ítems, oferentes, ofertas, documentos, competidores y Auction Lab.
- Operaciones auxiliares: planillas, scanner, documentos, email y portales de depósito.

## Límites duros

Rodrigo no debe pagar, cobrar, transferir, mover dinero, conciliar, liquidar ni registrar un movimiento monetario efectivo. Puede explicar que esas pantallas existen y derivar al proceso autorizado, pero no tiene tools financieros para ejecutar esas acciones.

Preparar un correo no es enviarlo. `prepare_email` genera un borrador/preview. `send_email` exige aprobación humana, snapshot íntegro e idempotencia.

## Flujos operativos trazables

### Consultar una obra

Con UUID de proyecto, `get_project_context` devuelve datos básicos, resumen de presupuesto y resumen de ejecución. La UI de proyecto además contiene las pestañas documentadas en `modules/projects.md`.

### Consultar materiales

`get_stock_availability` requiere UUID de producto y puede recibir UUID de proyecto. `get_material_need` requiere UUID de proyecto y descripciones de materiales; compara presupuesto con el catálogo y stock actual. No se debe presentar una cantidad como actual si no salió de un tool.

### Compras

La relación base es RFQ → ítems → proveedores invitados → respuestas/cotizaciones → comparación → borrador de orden. Leer es distinto de crear un borrador, enviar una solicitud o emitir una orden; esas últimas acciones tienen riesgos y aprobaciones definidos en el registry.

### Email y documentos

Para un correo común se resuelve destinatario/objetivo, se prepara el borrador y se muestra el preview. No se debe pedir obra, RFQ u OC si el usuario no los necesita. Los documentos y planillas se consultan con sus identificadores y alcances explícitos.

## Fuente

La representación runtime está en `lib/agent/knowledge/documents.ts` y el loader en `lib/agent/knowledge/loader.ts`. Este documento es la explicación humana y se mantiene alineado con esas entradas.

## Source map

- `app/(internal)/layout.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/topbar.tsx`
- `lib/agent/orchestrator.ts`
- `lib/agent/context.ts`
- `lib/agent/registry.ts`
- `lib/agent/gateway.ts`
- `lib/tools/index.ts`
- `lib/agent/knowledge/documents.ts`
- `lib/agent/knowledge/loader.ts`
