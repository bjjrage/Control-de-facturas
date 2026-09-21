# Business glossary V1

| Termino | Significado verificado en código |
| --- | --- |
| Empresa / tenant | Alcance de datos derivado del perfil autenticado y aplicado por el Gateway y los handlers. |
| Obra / proyecto | Registro `projects`; puede tener presupuesto, ejecución, compras, stock, personal, certificados y otros módulos de proyecto. |
| Budget item | Línea de `budget_items` vinculada a una obra; se usa para cantidades, precios y necesidades de material. |
| Producto / material | Registro de catálogo `productos`, con unidad y existencias; se consulta mediante los tools de stock/necesidad. |
| Depósito | Ubicación de stock relacionada con `stock_por_deposito` y `depositos`. |
| RFQ | Solicitud de cotización; se relaciona con `rfqs`, `rfq_items`, `rfq_suppliers` y respuestas. |
| Cotización / respuesta | Respuesta de proveedor a una RFQ; la comparación lee `rfq_responses` y `rfq_items`. |
| OC | Orden de compra autorizada (`authorized_orders`) o un borrador de preparación; no equivale a un email ni a una factura. |
| Plan semanal | Plan de obra persistido en `project_weekly_plans` y sus ítems; también puede generar reservas de inventario. |
| Licitación | Convocatoria pública con lotes, ítems, oferentes, ofertas y documentos en el módulo de licitaciones. |
| Certificado | Flujo de certificación de avance de una obra; sus acciones requieren estado y permisos propios. |
| Caja / tesorería | Superficies financieras de flujo de caja, cuentas y órdenes de pago; no son tools ejecutables por Rodrigo. |
| Draft de email | Borrador interno generado por `prepare_email`, con preview y posibilidad de revisión. |
| Approval | Registro de aprobación humana para tools de riesgo 2 o superior; el Gateway controla su consumo. |
| Conocimiento estático | Descripción de código y relaciones, sin tenant data, saldos ni estado actual. |

## Source map

- `lib/agent/context.ts`
- `lib/agent/gateway.ts`
- `lib/tools/projects/get-project-context.ts`
- `lib/tools/stock/get-stock-availability.ts`
- `lib/tools/procurement/get-material-need.ts`
- `lib/tools/procurement/get-rfq.ts`
- `lib/tools/procurement/get-rfq-responses.ts`
- `app/(internal)/projects/weekly-plan-actions.ts`
- `app/(internal)/pagos/actions.ts`
- `lib/tools/email/prepare-email.ts`
