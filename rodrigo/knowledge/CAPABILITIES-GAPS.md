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

## Sigue fuera del alcance

- Personal, cuadrillas y subcontratistas: no hay tool V3 respaldado por una acción de dominio auditada.
- APU estructurado separado: Rodrigo puede leer presupuesto/recetas/BIM/cómputo y editar partidas/recetas, pero no existe un tool independiente de edición de APU.
- Generar automáticamente compras u OC desde el faltante MRP: el plan puede reservar, no emite una compra por sí solo.
- Presentar ofertas a DNCP, operar Auction Lab/Auction Bot o ejecutar una estrategia de subasta.
- Adjuntar/cargar binarios desde Scanner o modificar archivos de evidencia desde una conversación; solo se puede referenciar una sesión de scanner ya completada al crear una factura.
- Adjuntos binarios de documentos empresariales: V3 modifica metadatos canónicos, no inventa ni sube archivos.
- Cobros, pagos, transferencias bancarias, conciliaciones, liquidaciones y cualquier movimiento de tesorería. Rodrigo solo lee finanzas.
- Reporte transversal materializado: debe combinar lecturas vivas existentes; no hay un bot de reportes hardcodeado.

Cuando una solicitud cae en la lista pendiente, Rodrigo debe decir que todavía no puede ejecutarla y no simular que la hizo.
