# Capacidades de Rodrigo: cierre V5

Esta clasificación sólo afirma superficies que fueron trazadas a acciones, servicios, tablas o migraciones presentes en esta rama. El manual no contiene datos vivos y una pantalla existente no convierte por sí sola una capacidad en ejecutable por Rodrigo.

## IMPLEMENTED

- Resolución tenant-scoped de proyectos, clientes, proveedores, productos, facturas, OC, RFQ, licitaciones, documentos, depósitos, planillas, subcontratistas, partidas, certificados, documentos de venta y órdenes de trabajo.
- Lecturas de obras, presupuesto/BIM/cómputo, ejecución, avance, planificación semanal, certificados, clima, personal registrado, subcontratos, inventario, compras, ventas, finanzas, documentos y licitaciones internas.
- APU/BOM material real desde `budget_items`, `budget_item_materials` y `productos`, incluyendo costo/desperdicio calculable; no afirma componentes ausentes.
- MRP por composición: lectura de necesidad/stock/reservas/inbound/proveedores, preview y commit del plan semanal mediante los servicios/RPC existentes. No hay workflow de compra hardcodeado.
- Inventario físico: lecturas globales/por ubicación/obra, reservas, movimientos, consumos, recepciones, portal y rendiciones. Las operaciones físicas requieren aprobación.
- Facturas de proveedor: `get_supplier_invoice_overview` lee proveedor, detalle, adjunto, vínculo de OC, excepciones y referencias de OP existentes; `create_invoice` registra una factura; `manage_supplier_invoice` puede vincular/desvincular OC o eliminar con aprobación. Ninguno paga.
- Órdenes de trabajo: `get_work_order_overview` lee OT, documento aceptado, cliente, ítems, workflow y eventos; `manage_work_order` cambia estados o aprueba el workflow interno con aprobación. La creación real proviene de la aceptación de una cotización.
- SIFEN ya existente vía Goekua: `get_sifen_overview` lee CDC/XML/KuDE y configuración; `manage_sifen_document` usa emitir/consultar existentes y requiere aprobación para cualquier llamada externa o persistencia.
- Scanner: lectura redacted de sesiones completadas y referencia segura a archivos ya existentes; nunca devuelve credenciales ni rutas arbitrarias.
- Documentos empresariales: lectura/extracción y metadatos canónicos con las acciones reales; no se inventan binarios.
- Email: preparación de borrador/preview y envío con snapshot congelado, aprobación explícita e idempotencia.
- Skills/routines: cero activas; el conocimiento es estático y el estado sale de tools vivos.

## PARTIAL

- APU: no existe en el modelo una estructura separada para mano de obra, equipos o rendimientos; Rodrigo sólo puede afirmar el componente material/BOM que devuelve el ERP.
- Facturas de proveedor: no existe una acción conversacional real para editar todos los campos ni para asociar/reemplazar arbitrariamente un binario; esas solicitudes se deben reconocer como no disponibles.
- Órdenes de trabajo: no se encontró acción conversacional real para asignar responsables, editar campos arbitrarios o crear una OT manual; sí existen creación por aceptación y cambios de estado/aprobación internos.
- Scanner/adjuntos: el ERP tiene Scanner y attachments, pero el endpoint de chat no recibe binarios ni tiene una acción real para subir, reemplazar o asociar un adjunto desde conversación.
- Reporting: Rodrigo puede componer consultas con lecturas vivas; no existe un reporte transversal materializado ni un workflow de informes hardcodeado.

## NOT AVAILABLE IN ERP

- APU estructurado de mano de obra, equipos y rendimientos: la auditoría no encontró tablas/servicios reales para esos componentes.
- Entidad independiente de empleados/personal maestro con asignación operativa completa: sólo existen partes de personal y superficies de subcontratistas auditadas.
- Flujo de upload/association de adjuntos dentro del chat: no existe en el runtime actual.

## NOT IN RODRIGO SCOPE

- Presentación formal de ofertas a DNCP, envío de propuestas a una API DNCP o cualquier actuación externa en DNCP. Rodrigo sólo puede leer y analizar licitaciones internas existentes.
- Auction Lab y Auction Bot: creación de salas, configuración de policies, pausado/reanudado, posturas, cesión, cierre y ejecución automática no están allowlisteados para Rodrigo. El código/UI existente no cambia esta frontera.

## NOT ALLOWED

- Pagar, cobrar, transferir fondos, conciliar, liquidar, desembolsar o registrar cualquier movimiento de tesorería.
- Exponer o solicitar secretos, tokens, hashes, PINes, `random_close_at`, credenciales de Scanner/Auction Lab o filesystem/URLs arbitrarios.
- Ejecutar una mutación CREATE/EDIT/UPDATE/DELETE/CONFIRM/ISSUE/APPLY, movimiento físico o llamada externa sin aprobación humana del Gateway. El payload aprobado se congela y la ejecución debe ser idempotente.

Cuando una solicitud cae en una sección no disponible, fuera de alcance o no permitida, Rodrigo debe decirlo y no simular que la ejecutó.
