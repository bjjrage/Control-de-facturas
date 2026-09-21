# Capacidades que el manual describe pero Rodrigo todavía no puede ejecutar

Esta lista es deliberadamente explícita. La presencia de una pantalla, tabla o acción no alcanza: debe existir un tool registrado, con scoping y política de riesgo.

## Cerrado en V3

- Clientes, proveedores y obras: alta/edición/activación o estado según las acciones existentes.
- Partidas, programación, avance y recetas/BOM de producción.
- Preview, guardado y commit del plan semanal; el commit MRP reserva mediante la RPC atómica existente.
- Certificados: crear, editar líneas de borrador y transiciones Elaborado/Verificado/Aprobado.
- Documentos comerciales: crear/editar/emitir; facturas de proveedor; no cobros.
- Inventario físico: recepciones, ubicaciones, portal de depósito y rendiciones, además del movimiento canónico.
- Clima: configuración, evaluación y decisiones de jornada existentes.
- Licitaciones: decisión, seguimiento, paquete/evaluación, extracción de texto y conversión de GANADA a proyecto.
- Metadatos de documentos empresariales con sincronización de su proyección existente.
- Lectura de presupuesto, modelos BIM e importaciones de cómputo.

## Auditoría V4

### IMPLEMENTED

- Lectura de partes de personal, subcontratistas, contratos, certificados de subcontratistas y staff declarado en certificados: `get_labor_subcontractor_overview`.
- Escrituras de partes/contratos y aprobar/rechazar certificados de subcontratistas: `manage_labor_subcontractor`, riesgo 2.
- Lectura del APU/BOM material real basado en `budget_item_materials`, con costo promedio y desperdicio calculable: `get_apu_overview`.
- Actualización del componente material APU/BOM mediante `saveBudgetItemMaterialAction`: `manage_apu_material`, riesgo 2.
- Lectura segura de sesiones completadas del scanner: `get_scanner_session_overview`.
- Lectura redacted del Auction Lab real: `get_auction_overview`.
- Lectura compuesta de avance, planificación semanal, certificados y clima: `get_project_operational_overview`.
- Lectura de stock global/depósitos/obras, reservas MRP, movimientos y consumos: `get_inventory_overview`.
- Lectura de ventas, facturas/documentos comerciales, cotizaciones/proformas y órdenes de trabajo relacionadas: `get_billing_overview`.
- Resolución humana ampliada para subcontratistas, partidas, certificados, documentos de venta, órdenes de trabajo y salas de subasta.

### PARTIAL

- APU: el ERP modela materiales/BOM y costos promedio; no se encontró una tabla/servicio estructurado para mano de obra, equipos o rendimientos de esos componentes.
- MRP → compras: Rodrigo puede leer plan, faltantes, stock, reservas, inbound y proveedores, y preparar RFQ/OC draft existentes. La emisión de OC/RFQ sigue siendo una mutación aprobable; no existe un workflow automático único.
- DNCP: lectura de convocatoria, lotes, ítems, oferentes, documentos de llamado y vault empresarial; la presentación formal no está implementada.
- Auction Lab/Bot: lectura segura y operaciones reales de iniciar, pausar/reanudar, postura asistida, ceder propuesta y finalizar están expuestas con aprobación; configurar una policy nueva, crear sala y operar un modo automático siguen fuera del tool conversacional.
- Scanner/adjuntos: puede consultar una sesión y referenciar archivos ya completados; no carga binarios ni crea/asocia adjuntos desde conversación.
- Billing/sales: lectura ampliada y mutaciones de documentos existentes; no se expone registrar cobros y la integración SIFEN/presentación formal no se inventa.
- Reporting transversal: se habilita por composición de lecturas reales; no existe un reporte materializado hardcodeado.

### NOT ALLOWED

- Pagos, cobros, transferencias bancarias, conciliaciones, liquidaciones, settlements, desembolsos y cualquier movimiento monetario.
- Tokens, hashes, PINes, secretos de scanner/Auction Lab o filesystem arbitrario.

Todas las mutaciones V4 nuevas quedan en riesgo 2 y pasan por Gateway/approval. Las tools de preparación reversible preexistentes (`prepare_email`, RFQ/OC draft y snapshot de planilla) no emiten ni confirman estado operativo; su semántica queda documentada como preparación, no como ejecución.

## Sigue fuera del alcance

- APU estructurado de mano de obra, equipos y rendimientos: el modelo real solo expone el componente material/BOM.
- Generar automáticamente una compra u OC final desde faltantes MRP: el plan puede reservar y los tools pueden preparar drafts, pero no emiten sin aprobación.
- Presentación formal de ofertas a DNCP, creación de sala Auction Lab, configuración de policy nueva y operación automática del Auction Bot.
- Carga, reemplazo o asociación conversacional de binarios desde Scanner/adjuntos empresariales; solo se leen sesiones/metadata ya existentes.
- Integración SIFEN/presentación formal desde la conversación.
- Cobros, pagos, transferencias bancarias, conciliaciones, liquidaciones y cualquier movimiento de tesorería. Rodrigo solo lee finanzas.
- Reporte transversal materializado: debe combinar lecturas vivas existentes; no hay un bot de reportes hardcodeado.

Cuando una solicitud cae en la lista pendiente, Rodrigo debe decir que todavía no puede ejecutarla y no simular que la hizo.
