# INFORME DE AUDITORÍA Y HARDENING — GATE 0

**Fecha**: 2026-09-09  
**Proyecto**: Control de Facturas → Construction Intelligence  
**Módulo**: Gate 0 — Cierre de Auditoría & Hardening Crítico  

---

## 1. Hallazgos Críticos Confirmados (Blockers Resueltos)

### A. Fuga Multi-Tenant en Órdenes de Pago (`payment_orders` y `payment_order_invoices`)
* **Ubicación original**: `supabase/migrations/0025_payment_orders.sql`.
* **Problema**: Las políticas RLS (`payment_orders_select`, `payment_orders_insert`, `payment_orders_update` y todas las de `payment_order_invoices`) solo validaban el rol interno del usuario (`administracion`, `admin`), omitiendo la cláusula `empresa_id = public.current_empresa_id()`.
* **Impacto**: Cualquier usuario con rol administrativo o administrador de la Empresa A podía listar, crear, modificar y desvincular órdenes de pago y facturas de la Empresa B.
* **Resolución**:
  - Se eliminaron las políticas no protegidas en `0059_gate0_security_and_integrity_hardening.sql`.
  - Se implementaron políticas RLS con filtro compuesto: `empresa_id = public.current_empresa_id() AND public.is_internal_role(...)`.
  - Se agregó trigger `trg_payment_orders_empresa` para autocompletar `empresa_id` desde el llamador.
  - Se agregó trigger `trg_payment_order_invoices_empresa` que valida estrictamente que la factura (`invoices.empresa_id`) y la orden de pago pertenezcan a la misma empresa.

### B. Fuga Multi-Tenant en Buckets de Storage
* **Ubicación original**: `supabase/migrations/0005_storage.sql` y `0015_invoice_jobs.sql`.
* **Problema**: Las políticas sobre `storage.objects` para los buckets `invoice-files`, `quote-pdfs` y `rfq-attachments` solo filtraban por rol, permitiendo que usuarios autenticados de un tenant leyeran o subieran archivos a rutas de otros tenants.
* **Resolución**:
  - Reemplazo de políticas en `0059_gate0_security_and_integrity_hardening.sql` para exigir validación contra `public.attachments`, `public.invoice_jobs`, `public.rfqs` o prefijo de carpeta coincidente con `public.current_empresa_id()`.

### C. Atomicidad e Integridad del Libro Mayor de Tesorería
* **Ubicación original**: `app/(internal)/pagos/actions.ts:markPaymentOrderExecuted` y `app/(internal)/ventas/actions.ts:registrarCobro`.
* **Problema**: Las operaciones se realizaban en múltiples llamadas secuenciales de red cliente-servidor sin transacción atómica en base de datos. Un fallo en el asiento de tesorería dejaba facturas en `PAGADO` u órdenes en `EJECUTADA` sin reflejarse en los saldos bancarios ni en el libro mayor.
* **Resolución**:
  - Creación de la función RPC atómica `public.ejecutar_orden_pago_atomica` con lock de fila `FOR UPDATE`.
  - Creación de la función RPC atómica `public.registrar_cobro_atomico`.
  - Actualización de las Server Actions para delegar la transacción en Postgres con garantía ACID.

### D. Salvaguarda Contable: Bloqueo de Borrado de Facturas Pagadas
* **Ubicación original**: `app/(internal)/invoices/[id]/actions.ts:deleteInvoice`.
* **Problema**: Un administrador podía eliminar físicamente facturas que ya habían sido pagadas o que formaban parte de órdenes de pago ejecutadas.
* **Resolución**:
  - Se incorporó la validación en `deleteInvoice` para rechazar eliminaciones de facturas en estado `PAGADO` o en OPs ejecutadas.
  - Se agregó el trigger en base de datos `trg_invoice_delete_integrity` que impide el borrado a nivel relacional incluso si se omite la capa de aplicación.

---

## 2. Invariantes Validados

La suite de verificación `scripts/verify-gate0-invariants.ts` comprobó satisfactoriamente:

1. **Invariantes Monetarias y de Tolerancia**:
   - Tolerancia de sobrefacturación fijada en 5% (`OVERBILL_TOLERANCE_PCT = 5`).
   - Evaluación exacta de estados: `MATCH` (en presupuesto y hasta +5%), `REQUIERE_REVISION` (>5%), `APROBADO_EXCEPCION`.
2. **Invariantes de Multi-Tenancy**:
   - Cero registros con `empresa_id` nulo en `payment_orders` y `payment_order_invoices`.
   - Cero enlaces cruzados entre empresas en `payment_order_invoices`.
   - Aislamiento verificado en las 12 tablas principales de dominio.
3. **Invariantes de Ledger de Tesorería**:
   - Para todas las cuentas financieras activas, se comprobó la identidad:
     $$\text{cuentas\_financieras.saldo} = \sum \text{movimientos\_tesoreria.monto}$$
