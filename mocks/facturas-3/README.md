# Mocks — Facturas 3

5 RFQs + 5 Facturas de proveedores para prueba manual del flujo completo:

RFQ → Cotización → OC → Factura → Conciliar → Apto para pago → OP

## Proveedores existentes usados
- CoolTech SRL
- Limpieza Pro SA
- Muebles Modernos SA
- Distribuidora Central SA
- TechOffice SRL

## Flujo de prueba
1. Crear cada RFQ con los datos del `seed-rfqs.sql`
2. Crear cada Factura con el PDF mock correspondiente
3. Vincular cada factura a su OC
4. Marcar como apto para pago
5. Crear OP agrupando facturas por proveedor
