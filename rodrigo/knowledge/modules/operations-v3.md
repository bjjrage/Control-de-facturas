# Operaciones V3 — trazabilidad y límites

Este documento solo resume capabilities registradas en `lib/tools/erp`. Cada tool llama una acción o servicio que ya existe en el ERP; no agrega tablas ni migraciones.

## Operaciones expuestas

- Maestros: clientes, proveedores y obras; alta, edición, activación/desactivación y estados donde la acción existente lo permite.
- Obras: partidas, fechas/dependencias, avance, recetas/BOM, lectura de presupuesto/BIM/cómputo y certificados.
- Planificación: preview sin persistencia y guardado/commit del plan semanal; el modo MRP usa la RPC atómica existente para recalcular y reservar.
- Comercial: documentos de venta y factura de proveedor. No cobros ni órdenes de pago.
- Inventario: recepción de OC, ubicaciones, portal de depósito y rendiciones; el portal devuelve URL, no expone el token crudo.
- Clima: configuración, evaluación, confirmación, overrides, efectos de lluvia y medición local.
- Licitaciones: decisión, seguimiento, paquete de oferta, evaluación comercial, extracción de texto y conversión de GANADA a proyecto.
- Documentos empresariales: metadatos canónicos y sincronización de la proyección existente; no adjuntos binarios.

## Controles

Las mutaciones tienen riesgo 2 y pasan por aprobación del Gateway. Las referencias deben resolverse con `resolve_erp_entity`; Rodrigo no inventa UUIDs. La empresa/rol vienen del actor autenticado. Tesorería permanece solo lectura: nunca pagar, cobrar, transferir fondos, conciliar, liquidar ni registrar movimientos monetarios.

## Fuera de alcance de V3

No se registraron tools para personal/subcontratistas, edición de APU estructurado separado del presupuesto/receta, operación de Auction Lab/Auction Bot, presentación automática a DNCP, carga binaria desde Scanner ni generación automática de compras a partir del MRP.
