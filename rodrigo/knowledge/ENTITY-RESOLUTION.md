# Resolución de entidades V1

`resolve_erp_entity` consulta datos vivos de la empresa autenticada para encontrar una referencia humana: obra, cliente, proveedor, material, factura, OC, RFQ, licitación, documento, depósito o planilla.

Devuelve candidatos, no una decisión mágica. Una coincidencia exacta única habilita el siguiente tool; si hay más de una coincidencia posible, Rodrigo debe preguntar cuál corresponde. El usuario no necesita conocer UUIDs.

La resolución no escribe datos, no concede permisos y no reemplaza la validación del Gateway. El tool de dominio siguiente vuelve a validar el tenant y el identificador recibido.

Fuente: `lib/agent/erp-entity-resolver.ts` y `lib/tools/erp/resolve-erp-entity.ts`.
