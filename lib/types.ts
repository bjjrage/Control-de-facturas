// Hand-written types mirroring supabase/migrations/*.sql. If a live Supabase
// project is available, these can be regenerated with:
//   npx supabase gen types typescript --local > lib/database.types.ts

export type UserRole = "comercial" | "administracion" | "admin";

export type RfqStatus =
  | "BORRADOR"
  | "COTIZANDO"
  | "OFERTAS_RECIBIDAS"
  | "OFERTA_SELECCIONADA"
  | "AUTORIZADO"
  | "FACTURADO"
  | "CONCILIADO"
  | "APTO_PARA_PAGO"
  | "PAGADO"
  | "CANCELADO"
  | "RECHAZADO"
  | "DIFERENCIA"
  | "REQUIERE_REVISION";

export type RfqProviderStatus = "PENDIENTE" | "ABIERTO" | "RESPONDIDO";

export type OrderStatus =
  | "AUTORIZADO"
  | "FACTURADO"
  | "CONCILIADO"
  | "APTO_PARA_PAGO"
  | "PAGADO";

export type InvoiceStatus =
  | "PENDIENTE"
  | "MATCH"
  | "REQUIERE_REVISION"
  | "APROBADO_EXCEPCION"
  | "APTO_PARA_PAGO"
  | "PAGADO";

export type CurrencyCode = "PYG" | "USD" | "EUR" | "BRL" | "ARS";

export type SelectionReason =
  | "MENOR_PLAZO"
  | "MEJOR_CALIDAD"
  | "PROVEEDOR_HABITUAL"
  | "DISPONIBILIDAD"
  | "INCLUYE_ADICIONALES"
  | "CONDICIONES_PAGO"
  | "REQUERIMIENTO_CLIENTE"
  | "OTRO";

export const SELECTION_REASON_LABELS: Record<SelectionReason, string> = {
  MENOR_PLAZO: "Menor plazo de entrega",
  MEJOR_CALIDAD: "Mejor calidad",
  PROVEEDOR_HABITUAL: "Proveedor habitual",
  DISPONIBILIDAD: "Disponibilidad",
  INCLUYE_ADICIONALES: "Incluye adicionales",
  CONDICIONES_PAGO: "Mejores condiciones de pago",
  REQUERIMIENTO_CLIENTE: "Requerimiento del cliente",
  OTRO: "Otro",
};

export interface Empresa {
  id: string;
  nombre: string;
  slug: string | null;
  active: boolean;
  modulo_compras: boolean;
  modulo_ventas: boolean;
  created_at: string;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  email_empresa: string | null;
  template_proforma: string | null;
  template_remision: string | null;
  template_factura: string | null;
  plan: "basico" | "pro" | "caterpillar";
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  active: boolean;
  empresa_id: string;
  is_super_admin: boolean;
  created_at: string;
}

export interface Provider {
  id: string;
  empresa_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  active: boolean;
  created_at: string;
}

export interface Rfq {
  id: string;
  empresa_id: string;
  code: string;
  quote_type: "RFQ" | "COT";
  created_by: string;
  client_name: string | null;
  mostrar_cliente_al_proveedor: boolean;
  product: string;
  quantity: number;
  unit: string;
  specifications: string | null;
  required_date: string | null;
  internal_reference: string | null;
  observations: string | null;
  project_id: string | null;
  status: RfqStatus;
  expires_at: string;
  selected_rfq_provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RfqProvider {
  id: string;
  empresa_id: string;
  rfq_id: string;
  provider_id: string;
  token: string;
  status: RfqProviderStatus;
  invited_at: string;
  opened_at: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  empresa_id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  rfq_provider_id: string | null;
  rfq_id: string | null;
  quote_version_id: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  empresa_id: string;
  rfq_provider_id: string;
  created_at: string;
}

export interface QuoteVersion {
  id: string;
  empresa_id: string;
  quote_id: string;
  version_number: number;
  budget_number: string;
  unit_price: number;
  total_price: number;
  currency: CurrencyCode;
  invoice_available: boolean;
  vat_included: boolean;
  delivery_time: string;
  offer_validity: string;
  payment_terms: string | null;
  observations: string | null;
  pdf_attachment_id: string | null;
  submitted_at: string;
  created_at: string;
}

export type OrderOrigin = "rfq" | "manual" | "invoice";

export interface AuthorizedOrderItem {
  id: string;
  order_id: string;
  empresa_id: string;
  product: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  quantity_invoiced: number;
  sort_order: number;
  created_at: string;
}

export type StockMovimientoTipo = "ENTRADA" | "SALIDA" | "AJUSTE" | "TRANSFERENCIA";

export interface Deposito {
  id: string;
  empresa_id: string;
  nombre: string;
  es_principal: boolean;
  project_id: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockPorDeposito {
  id: string;
  empresa_id: string;
  producto_id: string;
  deposito_id: string;
  stock_actual: number;
  updated_at: string;
}

export interface CategoriaProducto {
  id: string;
  empresa_id: string;
  nombre: string;
  orden: number;
  created_at: string;
  updated_at: string;
}

export interface Producto {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion: string | null;
  unidad: string;
  contenido_por_unidad: number | null;
  unidad_base: string | null;
  sku: string | null;
  categoria_id: string | null;
  stock_actual: number;
  stock_minimo: number;
  costo_promedio: number;
  activo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockMovimiento {
  id: string;
  empresa_id: string;
  producto_id: string;
  tipo: StockMovimientoTipo;
  cantidad: number;
  stock_resultante: number;
  costo_unitario: number | null;
  costo_total: number | null;
  costo_promedio_resultante: number | null;
  project_id: string | null;
  budget_item_id: string | null;
  deposito_id: string | null;
  deposito_destino_id: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
}

// ============================================================================
// Inventario / pañol canónico (migración 0080)
// ============================================================================

export type InventoryMovementType = "RECEIPT" | "TRANSFER" | "CONSUMPTION" | "RETURN" | "ADJUSTMENT";
export type InventoryLocationType = "CENTRAL" | "PROJECT" | "AUXILIARY";
export type InventoryMovementStatus = "DRAFT" | "CONFIRMED" | "VOIDED";
export type WarehouseSubmissionStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "NEEDS_REVIEW"
  | "READY"
  | "CONFIRMED"
  | "VOIDED";
export type WarehouseSubmissionLineState = "PROPOSED" | "CONFIRMED" | "REJECTED";

export interface InventoryLocation {
  id: string;
  empresa_id: string;
  location_type: InventoryLocationType;
  name: string;
  project_id: string | null;
  parent_location_id: string | null;
  is_primary: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryBalance {
  id: string;
  empresa_id: string;
  producto_id: string;
  location_id: string;
  cost_currency: CurrencyCode | null;
  quantity: number;
  total_cost: number;
  cost_status: "COMPUTABLE" | "REVISION_REQUERIDA";
  original_cost_currency: string | null;
  original_unit_cost: number | null;
  original_total_cost: number | null;
  exchange_rate_to_company: number | null;
  cost_source: string | null;
  updated_at: string;
}

export interface InventoryMovement {
  id: string;
  empresa_id: string;
  producto_id: string;
  quantity: number;
  unit: string;
  movement_type: InventoryMovementType;
  from_location_id: string | null;
  to_location_id: string | null;
  project_id: string | null;
  budget_item_id: string | null;
  source_type: string;
  source_id: string | null;
  source_line_id: string | null;
  status: InventoryMovementStatus;
  idempotency_key: string;
  cost_currency: CurrencyCode | null;
  unit_cost: number | null;
  cost_total: number | null;
  exchange_rate_to_company: number | null;
  cost_total_company: number | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  confirmed_by: string | null;
  created_at: string;
  confirmed_at: string;
}

export interface WarehousePortalLink {
  id: string;
  empresa_id: string;
  location_id: string;
  token_hint: string;
  active: boolean;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface WarehouseSubmission {
  id: string;
  empresa_id: string;
  location_id: string;
  project_id: string;
  portal_link_id: string | null;
  period_start: string;
  period_end: string;
  remision_number: string | null;
  notes: string | null;
  status: WarehouseSubmissionStatus;
  upload_incomplete?: boolean;
  processing_error: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  confirmed_by: string | null;
  processing_started_at: string | null;
  processed_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WarehouseSubmissionEvidence {
  id: string;
  empresa_id: string;
  submission_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  uploaded_external: boolean;
  extraction_status: "NOT_PROCESSED" | "PROCESSING" | "PROPOSED" | "FAILED" | "REVIEWED";
  extraction_result: Record<string, unknown> | null;
  extraction_error: string | null;
  confidence: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface WarehouseSubmissionLine {
  id: string;
  empresa_id: string;
  submission_id: string;
  line_number: number;
  raw_description: string;
  producto_id: string | null;
  quantity: number | null;
  unit: string | null;
  budget_item_id: string | null;
  state: WarehouseSubmissionLineState;
  uncertainty_reason: string | null;
  confidence: number | null;
  source_evidence_id: string | null;
  inventory_movement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OcRecepcionItem {
  id: string;
  recepcion_id: string;
  empresa_id: string;
  order_item_id: string;
  producto_id: string | null;
  cantidad_recibida: number;
  notas: string | null;
  inventory_movement_id: string | null;
  created_at: string;
}

export interface OcRecepcion {
  id: string;
  empresa_id: string;
  order_id: string;
  fecha: string;
  recibido_por: string;
  notas: string | null;
  delivery_location_id: string | null;
  status: "DRAFT" | "CONFIRMED" | "VOIDED";
  remision_number: string | null;
  idempotency_key: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
  oc_recepcion_items?: OcRecepcionItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  empresa_id: string;
  product_description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  subtotal: number | null;
  sort_order: number;
  created_at: string;
}

export interface InvoiceItemMatch {
  id: string;
  invoice_item_id: string;
  order_item_id: string;
  empresa_id: string;
  quantity_matched: number;
  created_at: string;
}

export interface AuthorizedOrder {
  id: string;
  empresa_id: string;
  rfq_id: string | null;
  provider_id: string;
  quote_version_id: string | null;
  code: string;
  created_from: OrderOrigin;
  provider_name: string;
  client_name: string | null;
  product: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  facturado_amount: number;
  currency: CurrencyCode;
  vat_included: boolean;
  authorized_by: string;
  authorized_at: string;
  is_cheapest: boolean;
  selection_reason: SelectionReason | null;
  selection_reason_detail: string | null;
  project_id: string | null;
  status: OrderStatus;
  created_at: string;
}

export interface Invoice {
  id: string;
  empresa_id: string;
  provider_id: string;
  invoice_number: string;
  invoice_date: string;
  currency: CurrencyCode;
  subtotal: number | null;
  vat: number | null;
  total: number;
  timbrado: string | null;
  attachment_id: string | null;
  observations: string | null;
  status: InvoiceStatus;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceOrderMatch {
  id: string;
  empresa_id: string;
  invoice_id: string;
  authorized_order_id: string;
  created_at: string;
}

export interface InvoiceException {
  id: string;
  empresa_id: string;
  invoice_id: string;
  approved_by: string;
  approved_at: string;
  reason: string;
  comment: string | null;
  difference_amount: number;
  difference_pct: number;
  created_at: string;
}

export type InvoiceJobStatus = "queued" | "processing" | "done" | "needs_review" | "failed";
export type InvoiceJobOutcome = "matched" | "created_unmatched" | "needs_manual" | "duplicate" | "error";

export interface ExtractedInvoiceFields {
  provider_name: string | null;
  provider_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  timbrado: string | null;
  order_reference: string | null;
  product_description: string | null;
}

export interface InvoiceJob {
  id: string;
  empresa_id: string;
  created_by: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  batch_date: string;
  status: InvoiceJobStatus;
  attempts: number;
  extracted: ExtractedInvoiceFields | null;
  provider_id: string | null;
  invoice_id: string | null;
  outcome: InvoiceJobOutcome | null;
  message: string | null;
  error: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  empresa_id: string | null;
  actor_id: string | null;
  actor_type: "internal" | "provider" | "system";
  actor_label: string | null;
  action: string;
  rfq_id: string | null;
  rfq_provider_id: string | null;
  invoice_id: string | null;
  authorized_order_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================================
// Módulo Ventas / Facturación (migración 0020)
// ============================================================================

export type SalesDocType = "PROFORMA" | "REMISION" | "FACTURA" | "NOTA_CREDITO";
export type SalesDocStatus = "BORRADOR" | "EMITIDA" | "COBRADA_PARCIAL" | "COBRADA" | "ANULADA";
export type ReceiptMethod = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "TARJETA" | "OTRO";

export interface Client {
  id: string;
  empresa_id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  payment_terms: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SalesDocument {
  id: string;
  empresa_id: string;
  client_id: string;
  code: string;
  doc_type: SalesDocType;
  issue_date: string;
  due_date: string | null;
  currency: CurrencyCode;
  subtotal: number;
  vat_amount: number;
  total: number;
  cobrado_amount: number;
  status: SalesDocStatus;
  notes: string | null;
  cdc: string | null;
  xml_url: string | null;
  kude_url: string | null;
  source_document_id: string | null;
  // Aceptación electrónica de cotizaciones (migración 0090). Solo PROFORMA.
  quotation_version: number;
  acceptance_status: QuotationAcceptanceStatus;
  acceptance_expires_at: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  accepted_by_doc: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SalesDocumentItem {
  id: string;
  empresa_id: string;
  sales_document_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: 0 | 5 | 10;
  line_total: number;
  created_at: string;
}

// ============================================================================
// Aceptación electrónica de cotizaciones + Órdenes de Trabajo (migración 0090)
// ============================================================================

export type QuotationAcceptanceStatus =
  | "DRAFT"
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

export type WorkOrderStatus = "PENDIENTE" | "EN_CURSO" | "COMPLETADA" | "CANCELADA";

export type WorkOrderApprovalMode = "RESPONSIBLE_APPROVAL" | "DIRECT_TO_PRODUCTION";

export type WorkOrderWorkflowStatus = "PENDING_INTERNAL_APPROVAL" | "READY_FOR_PRODUCTION";

export type RoutingPolicyScope = "TENANT_DEFAULT" | "CLIENT" | "PROJECT";

export interface WorkOrderRoutingPolicy {
  id: string;
  empresa_id: string;
  scope: RoutingPolicyScope;
  client_id: string | null;
  project_id: string | null;
  mode: WorkOrderApprovalMode;
  responsible_role: UserRole;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Registro inmutable de aceptación (migración 0091, PUNTO 1).
 * Una fila por cotización aceptada: fuente de verdad del acto de aceptar,
 * separada de la OT (documento interno derivado) y de los eventos (timeline).
 * Fotografía totales, cliente, versión e ítems: aunque la proforma cambie
 * después (no puede: guard de inmutabilidad), el registro no cambia.
 */
export interface SalesQuotationAcceptance {
  id: string;
  empresa_id: string;
  sales_document_id: string;
  quotation_version: number;
  client_id: string;
  client_name_snapshot: string;
  subtotal_snapshot: number;
  vat_snapshot: number;
  total_snapshot: number;
  currency_snapshot: CurrencyCode;
  channel: "PORTAL";
  recipient_email: string | null;
  acceptor_name: string;
  acceptor_doc: string | null;
  acceptor_notes: string | null;
  ip: string | null;
  user_agent: string | null;
  token_id: string | null;
  token_prefix: string | null;
  items_snapshot: { description: string; quantity: number; unit_price: number; vat_rate: number; line_total: number }[];
  work_order_id: string | null;
  accepted_at: string;
  created_at: string;
}

export interface SalesQuotationToken {
  id: string;
  empresa_id: string;
  sales_document_id: string;
  quotation_version: number;
  // Solo hash SHA-256 hex + prefijo de correlación (migración 0091). El raw
  // de 256-bit vive únicamente en la URL y en memoria al generarse.
  token_hash: string;
  token_prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  // Dirección para la que se PREPARÓ un mailto: (≠ email enviado: no hay
  // provider SMTP, nunca se registra EMAIL_SENT).
  prepared_for_email: string | null;
  prepared_at: string | null;
  notes: string | null;
}

export type QuotationEventType =
  | "CREATED"
  | "EMAIL_PREPARED"
  | "LINK_COPIED"
  | "VIEWED"
  | "ACCEPTED"
  | "REJECTED"
  | "REVOKED"
  | "EXPIRED"
  | "VERSION_SUPERSEDED"
  | "WORK_ORDER_CREATED"
  | "WORKFLOW_RESOLVED"
  | "OT_STATUS_CHANGED";

export interface SalesQuotationEvent {
  id: string;
  empresa_id: string;
  sales_document_id: string;
  token_id: string | null;
  event_type: QuotationEventType;
  actor_label: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface WorkOrder {
  id: string;
  empresa_id: string;
  code: string;
  sales_document_id: string;
  client_id: string;
  project_id: string | null;
  currency: CurrencyCode;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: WorkOrderStatus;
  // Workflow interno por configuración (migración 0091).
  approval_mode: WorkOrderApprovalMode;
  workflow_status: WorkOrderWorkflowStatus;
  responsible_role: UserRole;
  routing_policy_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderItem {
  id: string;
  empresa_id: string;
  work_order_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: 0 | 5 | 10;
  line_total: number;
  created_at: string;
}

// ============================================================================
// Módulo Pagos / Órdenes de Pago (migración 0025)
// ============================================================================

export type PaymentOrderStatus = "EMITIDA" | "EJECUTADA";

export interface PaymentOrder {
  id: string;
  empresa_id: string;
  code: string;
  provider_id: string;
  status: PaymentOrderStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  executed_at: string | null;
}

export interface PaymentOrderInvoice {
  id: string;
  empresa_id: string;
  payment_order_id: string;
  invoice_id: string;
  created_at: string;
}

// ============================================================================
// Tesorería (migración 0055)
// ============================================================================

export type CuentaFinancieraTipo = "BANCO" | "CAJA" | "TARJETA" | "OTRO";

export type MovimientoTesoreriaTipo =
  | "COBRO"
  | "PAGO"
  | "TRANSFERENCIA_IN"
  | "TRANSFERENCIA_OUT"
  | "INGRESO"
  | "EGRESO"
  | "AJUSTE"
  | "SALDO_INICIAL";

export interface CuentaFinanciera {
  id: string;
  empresa_id: string;
  nombre: string;
  tipo: CuentaFinancieraTipo;
  banco: string | null;
  numero_cuenta: string | null;
  moneda: CurrencyCode;
  saldo: number;
  saldo_conciliado: number | null;
  activo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MovimientoTesoreria {
  id: string;
  empresa_id: string;
  cuenta_id: string;
  fecha: string;
  monto: number; // + entra, - sale
  tipo: MovimientoTesoreriaTipo;
  motivo: string | null;
  payment_order_id: string | null;
  sales_receipt_id: string | null;
  transferencia_id: string | null;
  project_id: string | null;
  conciliado: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Transferencia {
  id: string;
  empresa_id: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  monto_origen: number;
  monto_destino: number;
  tipo_cambio: number;
  fecha: string;
  motivo: string | null;
  created_by: string | null;
  created_at: string;
}

export type GastoRecurrenteCategoria =
  | "ALQUILER"
  | "SUELDOS"
  | "SEGUROS"
  | "PRESTAMO"
  | "SERVICIOS"
  | "IMPUESTOS"
  | "HONORARIOS"
  | "OTRO";

export type GastoRecurrentePeriodicidad =
  | "MENSUAL"
  | "BIMESTRAL"
  | "TRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL";

// ============================================================================
// Licitaciones (migración 0058)
// ============================================================================

export type LicitacionDecision =
  | "SIN_REVISAR"
  | "DESCARTADA"
  | "EN_PREPARACION"
  | "PRESENTADA"
  | "GANADA"
  | "PERDIDA";

export interface Licitacion {
  id: string;
  empresa_id: string;
  dncp_nro: string;
  ocid: string;
  titulo: string;
  comitente_nombre: string | null;
  comitente_id: string | null;
  categoria: string | null;
  categoria_detalle: string | null;
  procurement_method: string | null;
  procurement_method_detalle: string | null;
  award_criteria_detalle: string | null;
  monto_referencial: number | null;
  monto_disponible: number | null;
  moneda: string;
  fecha_publicacion: string | null;
  fecha_consultas_fin: string | null;
  fecha_entrega_ofertas: string | null;
  fecha_apertura: string | null;
  lugar_apertura: string | null;
  estado: string | null;
  estado_detalle: string | null;
  invitada: boolean;
  decision: LicitacionDecision;
  decision_notas: string | null;
  project_id: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface LicitacionLote {
  id: string;
  licitacion_id: string;
  empresa_id: string;
  lote_dncp_id: string | null;
  numero: number | null;
  titulo: string | null;
  monto_referencial: number | null;
}

export interface LicitacionItem {
  id: string;
  licitacion_id: string;
  empresa_id: string;
  lote_id: string | null;
  codigo_catalogo: string | null;
  codigo_unspsc: string | null;
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario_referencial: number | null;
  item_normalizado_id: string | null;
  sort_order: number;
}

export interface LicitacionOferente {
  id: string;
  licitacion_id: string;
  empresa_id: string;
  ruc: string | null;
  nombre: string;
  tamano: string | null;
  monto_ofertado: number | null;
  gano: boolean;
  lotes_ganados: string[] | null;
  fuente: "API" | "ACTA_PDF" | "CUADRO_PDF" | "MANUAL";
}

export interface LicitacionDocumento {
  id: string;
  licitacion_id: string;
  empresa_id: string;
  tipo: string | null;
  tipo_detalle: string | null;
  titulo: string | null;
  url_dncp: string | null;
  storage_path: string | null;
  descargado_at: string | null;
}

export interface LicitacionPerfil {
  empresa_id: string;
  codigos_catalogo: string[];
  palabras_clave: string[];
  monto_min: number | null;
  monto_max: number | null;
  departamentos: string[];
  activo: boolean;
  updated_at: string;
}

export interface EmpresaDocumento {
  id: string;
  empresa_id: string;
  tipo: string;
  descripcion: string | null;
  storage_path: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GastoRecurrente {
  id: string;
  empresa_id: string;
  descripcion: string;
  categoria: GastoRecurrenteCategoria;
  monto_estimado: number;
  moneda: CurrencyCode;
  periodicidad: GastoRecurrentePeriodicidad;
  dia_del_mes: number | null;
  cuenta_id: string | null;
  project_id: string | null;
  proximo_vencimiento: string | null;
  activo: boolean;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Módulo Construcción (migración 0028)
// ============================================================================

export type ProjectStatus = "ACTIVO" | "PAUSADO" | "COMPLETADO" | "CANCELADO";

export interface Project {
  id: string;
  empresa_id: string;
  name: string;
  code: string;
  client: string | null;
  location: string | null;
  latitude?: number | null;
  longitude?: number | null;
  precipitation_threshold_mm?: number;
  weather_tracking_enabled?: boolean;
  weather_station_id?: string | null;
  weather_station_name?: string | null;
  weather_source?: string;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  budget_total: number;
  created_by: string | null;
  created_at: string;
  execution_token: string;
  // Datos de contrato (obra pública) — migración 0039. Todos opcionales; solo
  // se usan si la obra certifica al comitente.
  comitente: string | null;
  contract_number: string | null;
  contract_amount: number;
  plazo_dias: number | null;
  orden_inicio_date: string | null;
  fiscalizacion_nombre: string | null;
  fiscalizacion_contrato: string | null;
  anticipo_pct: number;
  devolucion_anticipo_pct: number;
  retencion_pct: number;
  iva_pct: number;
}

export interface BudgetItem {
  id: string;
  project_id: string;
  parent_id: string | null;
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  subtotal: number;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
  depends_on: string | null;
  quantity_per_unit: number | null;
  material_requirement?: "REQUIRES_BOM" | "NO_MATERIAL" | "UNKNOWN" | null;
  created_at: string;
}

export interface ExecutionEntry {
  id: string;
  project_id: string;
  budget_item_id: string;
  entry_date: string;
  quantity_executed: number;
  notes: string | null;
  photo_paths: string[];
  recorded_by: string | null;
  created_at: string;
  submitted_by_portal: boolean;
}

export type BimModelStatus = "PROCESANDO" | "LISTO" | "ERROR";

export interface BimModel {
  id: string;
  project_id: string;
  file_name: string;
  storage_path: string;
  schema: string | null;
  status: BimModelStatus;
  error_message: string | null;
  element_count: number;
  uploaded_by: string | null;
  created_at: string;
}

export type BimQuantityType = "length" | "area" | "volume" | "count" | "weight";
export type BimQuantitySource = "IFC_QTO" | "IFC_PROPERTY" | "GEOMETRY";

export interface BimElement {
  id: string;
  bim_model_id: string;
  project_id: string;
  ifc_guid: string;
  ifc_type: string;
  express_id: number | null;
  name: string | null;
  building_storey: string | null;
  material: string | null;
  properties: Record<string, unknown>;
  quantity_type: BimQuantityType | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  quantity_source: BimQuantitySource | null;
  quantity_property: string | null;
  created_at: string;
  group_id: string | null;
}

export interface BimElementGroup {
  id: string;
  bim_model_id: string;
  project_id: string;
  ifc_type: string;
  material: string | null;
  normalized_name: string;
  quantity_type: BimQuantityType | null;
  quantity_unit: string | null;
  total_quantity: number | null;
  element_count: number;
  created_at: string;
}

export type BimGroupMatchMethod = "SEMANTIC" | "MANUAL";
export type BimGroupMatchStatus = "SUGGESTED" | "REVIEW" | "REVIEW_REQUIRED" | "NO_MATCH" | "CONFIRMED" | "REJECTED";

export interface BimGroupMatch {
  id: string;
  group_id: string;
  budget_item_id: string | null;
  method: BimGroupMatchMethod;
  score: number | null;
  reason: string | null;
  status: BimGroupMatchStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Cómputo métrico (Excel/PDF) — segundo origen de cantidades para el mismo
// pipeline de matching semántico que BIM, para proyectos sin modelo IFC. Ver
// supabase/migrations/0075_computo_import.sql. Sin capa de agrupación: acá
// una fila ya es un ítem, no hace falta sumar elementos técnicamente iguales.
// ---------------------------------------------------------------------------
export type ComputoSourceType = "EXCEL" | "PDF";
export type ComputoImportStatus = "PROCESANDO" | "LISTO" | "BAJA_CONFIANZA" | "ERROR";

export interface ComputoConfidenceSummary {
  textLayerOk: boolean;
  llmConfidence: number | null;
  sanityIssues: string[];
}

export interface ComputoImport {
  id: string;
  project_id: string;
  source_type: ComputoSourceType;
  file_name: string;
  storage_path: string;
  status: ComputoImportStatus;
  error_message: string | null;
  confidence_summary: ComputoConfidenceSummary | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface ComputoItem {
  id: string;
  computo_import_id: string;
  project_id: string;
  row_index: number;
  description: string;
  quantity_value: number | null;
  quantity_unit: string | null;
  raw_row: Record<string, unknown>;
  row_confidence: number | null;
  created_at: string;
}

// Mismo vocabulario de estados que BimGroupMatchStatus — a propósito el mismo
// significado (SUGGESTED/REVIEW/REVIEW_REQUIRED/NO_MATCH/CONFIRMED/REJECTED).
export type ComputoItemMatchStatus = BimGroupMatchStatus;

export interface ComputoItemMatch {
  id: string;
  computo_item_id: string;
  budget_item_id: string | null;
  method: BimGroupMatchMethod;
  score: number | null;
  reason: string | null;
  status: ComputoItemMatchStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export type BimMatchMethod = "DETERMINISTIC" | "SEMANTIC" | "MANUAL";
export type BimMatchStatus = "PROPUESTO" | "CONFIRMADO" | "DESCARTADO";

export interface BimBudgetMatch {
  id: string;
  bim_element_id: string;
  budget_item_id: string;
  method: BimMatchMethod;
  score: number | null;
  status: BimMatchStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

// ============================================================================
// Módulo Construcción — Caterpillar (migración 0030)
// ============================================================================

export interface DailyLaborEntry {
  id: string;
  project_id: string;
  entry_date: string;
  worker_name: string;
  hours: number;
  hourly_cost: number;
  labor_cost: number;
  task_description: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface Subcontractor {
  id: string;
  empresa_id: string;
  name: string;
  ruc: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  specialty: string | null;
  created_at: string;
}

export type SubcontractorContractStatus = "ACTIVO" | "CERRADO" | "CANCELADO";

export interface SubcontractorContract {
  id: string;
  project_id: string;
  subcontractor_id: string;
  budget_item_id: string | null;
  contracted_amount: number;
  retention_pct: number;
  description: string | null;
  signed_date: string | null;
  status: SubcontractorContractStatus;
  public_token: string;
  created_at: string;
}

export type SubcontractorCertificateStatus = "PENDIENTE" | "APROBADO" | "RECHAZADO" | "PAGADO";

export interface SubcontractorCertificate {
  id: string;
  contract_id: string;
  project_id: string;
  certificate_number: number;
  submitted_at: string;
  period_start: string | null;
  period_end: string | null;
  claimed_pct: number;
  claimed_amount: number;
  approved_pct: number | null;
  approved_amount: number | null;
  retention_pct: number;
  retention_amount: number;
  net_payable: number;
  status: SubcontractorCertificateStatus;
  ai_flags: { flags: string[]; risk_level: "low" | "medium" | "high"; summary: string } | null;
  notes: string | null;
  submitted_by_portal: boolean;
  created_at: string;
}

// ============================================================================
// Certificados de ejecución de obra — cobro al comitente (migración 0039)
// ============================================================================

export type ProjectCertificateStatus =
  | "BORRADOR"
  | "ELABORADO"
  | "VERIFICADO"
  | "APROBADO"
  | "FACTURADO";

export interface ProjectCertificate {
  id: string;
  project_id: string;
  numero: number;
  period_start: string;
  period_end: string;
  status: ProjectCertificateStatus;
  monto_anterior: number;
  monto_presente: number;
  monto_acumulado: number;
  // Facturación (migración 0040)
  ajustes: number;
  devolucion_anticipo: number;
  retencion: number;
  penalidad_avance: number;
  penalidad_presentacion: number;
  monto_liquido: number;
  devolucion_anticipo_pct_snap: number | null;
  retencion_pct_snap: number | null;
  elaborado_por: string | null;
  elaborado_at: string | null;
  verificado_por: string | null;
  verificado_at: string | null;
  aprobado_por: string | null;
  aprobado_at: string | null;
  facturado_at: string | null;
  factura_numero: string | null;
  notes: string | null;
  created_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCertificateItem {
  id: string;
  certificate_id: string;
  budget_item_id: string | null;
  codigo: string | null;
  descripcion: string;
  unidad: string | null;
  qty_contractual: number;
  precio_unitario: number;
  qty_anterior: number;
  qty_presente: number;
  qty_acumulada: number;
  monto_anterior: number;
  monto_presente: number;
  monto_acumulado: number;
  sort_order: number;
  created_at: string;
}

// Anexos del certificado (migración 0041)

export type WeatherCode = "B" | "LL" | "HH" | "O";

export interface ProjectWeatherLog {
  id: string;
  project_id: string;
  log_date: string;
  code: WeatherCode;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface ProjectSchedulePlan {
  id: string;
  project_id: string;
  label: string;
  is_active: boolean;
  created_at: string;
}

export interface ProjectSchedulePlanMonth {
  id: string;
  plan_id: string;
  month_index: number;
  programado_pct: number;
}

export interface ProjectCertificateStaff {
  id: string;
  certificate_id: string;
  nombre: string;
  rol: string;
  sort_order: number;
  created_at: string;
}

export interface ProjectUnit {
  id: string;
  project_id: string;
  nombre: string;
  sort_order: number;
  activo: boolean;
  created_at: string;
}

export interface ProjectCertificateUnitProgress {
  id: string;
  certificate_id: string;
  unit_id: string;
  pct_avance: number;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Climate Workdays
// ============================================================================

export type ProjectWorkdayClassification =
  | "WORKABLE"
  | "NON_WORKABLE_RAIN"
  | "NON_WORKABLE_RAIN_EFFECT"
  | "NON_WORKABLE_OTHER";

export type ClimateReasonCode =
  | "TERRAIN_SATURATED"
  | "ACCESS_BLOCKED"
  | "FLOODED_EXCAVATION"
  | "UNSAFE_CONDITIONS"
  | "MATERIAL_IMPACT"
  | "OTHER";

export type ClimateEvidenceType =
  | "RAIN_GAUGE_PHOTO"
  | "SITE_CONDITION_PHOTO"
  | "WEATHER_SOURCE"
  | "RESIDENT_NOTE"
  | "OTHER";

export interface ClimateEvent {
  id: string;
  empresa_id: string;
  project_id: string;
  event_date: string;
  source: string;
  external_station_id: string | null;
  external_station_name: string | null;
  external_station_latitude: number | null;
  external_station_longitude: number | null;
  external_station_distance_km: number | null;
  external_observed_at: string | null;
  external_precipitation_mm: number | null;
  local_precipitation_mm: number | null;
  contract_threshold_mm: number | null;
  external_threshold_exceeded: boolean;
  local_threshold_exceeded: boolean;
  threshold_exceeded: boolean;
  local_source: string;
  provider_fallback_reason: string | null;
  raw_source_payload: Record<string, unknown> | null;
  status: "OBSERVED" | "PROPOSED" | "CONFIRMED" | "OVERRIDDEN";
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkdayStatus {
  id: string;
  empresa_id: string;
  project_id: string;
  work_date: string;
  classification: ProjectWorkdayClassification;
  climate_event_id: string | null;
  parent_workday_status_id: string | null;
  reason_code: ClimateReasonCode | null;
  notes: string | null;
  source: "AUTOMATIC" | "MANUAL" | "RESIDENT" | "SYSTEM";
  decision_status: "PROPOSED" | "CONFIRMED";
  proposed_automatically: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClimateEvidence {
  id: string;
  empresa_id: string;
  project_id: string;
  climate_event_id: string | null;
  workday_status_id: string | null;
  evidence_type: ClimateEvidenceType;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  captured_at: string | null;
  uploaded_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ClimateForecastMetrics {
  calendar_days_elapsed: number;
  workable_days_elapsed: number;
  rain_lost_days: number;
  rain_effect_lost_days: number;
  other_lost_days: number;
  effective_available_days: number;
  gross_schedule_variance: number;
  weather_adjusted_variance: number;
}

export interface SalesReceipt {
  id: string;
  empresa_id: string;
  sales_document_id: string;
  amount: number;
  receipt_date: string;
  method: ReceiptMethod;
  reference: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

// ============================================================================
// Proyección Inteligente de Avance de Obra (migración 0054)
// ============================================================================

export interface BudgetItemMaterial {
  id: string;
  empresa_id: string;
  project_id: string;
  budget_item_id: string;
  producto_id: string;
  cantidad_por_unidad_ejecutada: number;
  desperdicio_pct: number;
  created_at: string;
  updated_at: string;
}

export type OperationalStatus = "NORMAL" | "PARTIAL" | "BLOCKED" | "DEGRADED" | "UNAVAILABLE";

export type VelocityConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNOBSERVED";

export interface DailyWeatherForecast {
  date: string; // YYYY-MM-DD
  precipitation_sum_mm: number;
  precipitation_hours: number;
  precipitation_probability_max?: number;
  wind_gusts_max_kmh: number;
  temperature_max_c?: number;
  temperature_min_c?: number;
  weather_code: number;
}

export interface MaterialRequirementDetail {
  producto_id: string;
  producto_nombre: string;
  producto_codigo?: string | null;
  unidad_medida: string;
  cantidad_unitaria: number;
  desperdicio_pct: number;
  demanda_bruta: number;
  stock_disponible: number;
  oc_inbound: number;
  deficit_compra_neta: number;
  cubierto_por_stock: number;
  cubierto_por_inbound: number;
  costo_unitario: number | null; // null si no tiene antecedente de costo
  valor_consumo_proyectado: number;
  caja_adicional_requerida: number;
  requiere_atencion_costo: boolean;
}

export interface ForecastItemResult {
  budget_item_id: string;
  item_code: string;
  item_description: string;
  unit: string;
  quantity_presupuestada: number;
  quantity_ejecutada_previa: number;
  remaining_quantity: number;
  base_daily_velocity: number;
  velocity_observations_count: number;
  velocity_window_days: number;
  velocity_confidence: VelocityConfidence;
  workability_factor: number; // 0.0 a 1.0 (or null if climate unavailable)
  operational_status: OperationalStatus;
  operational_reasoning: string;
  projected_quantity: number;
  new_projected_cumulative_quantity: number;
  new_projected_progress_pct: number;
  materials: MaterialRequirementDetail[];
  valor_fisico_proyectado: number; // contractual client value
}

export interface ProgressForecastRunSummary {
  id?: string;
  project_id: string;
  horizon_days: number; // Minimum 7
  start_date: string;
  end_date: string;
  total_projected_physical_value: number;
  total_material_consumption_value: number;
  total_covered_by_stock_value: number;
  total_covered_by_inbound_value: number;
  total_additional_cash_required: number;
  currency: string;
  days_in_horizon: number;
  workable_days_count: number;
  partially_blocked_days_count: number;
  fully_blocked_days_count: number;
  items: ForecastItemResult[];
  llm_analysis_used: boolean;
  is_degraded: boolean;
  llm_summary?: string;
  climate_metrics?: ClimateForecastMetrics;
}

// ============================================================================
// Plan Semanal de Obra / Lookahead Operacional (Migration 0082)
// ============================================================================

export type WeeklyPlanStatus = "DRAFT" | "COMMITTED" | "CLOSED";

export type WeeklyPlanInputMode = "QUANTITY" | "CONTRACT_PERCENTAGE_POINTS";

export interface ProjectWeeklyPlan {
  id: string;
  empresa_id: string;
  project_id: string;
  start_date: string;
  end_date: string;
  status: WeeklyPlanStatus;
  notes?: string | null;
  weather_snapshot_batch_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWeeklyPlanItem {
  id: string;
  plan_id: string;
  budget_item_id: string;
  front_label?: string | null;
  input_mode: WeeklyPlanInputMode;
  input_value: number;
  target_quantity: number;
  unit: string;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlanItemCalculation {
  budget_item_id: string;
  front_label?: string | null;
  item_code: string;
  item_description: string;
  unit: string;
  contractual_quantity: number;
  previously_executed_quantity: number;
  remaining_quantity: number;
  unit_price: number;
  input_mode: WeeklyPlanInputMode;
  input_value: number;
  requested_quantity: number;
  target_quantity: number; // capped at remaining_quantity
  was_capped: boolean;
  item_current_progress_pct: number;
  item_target_progress_pct: number;
  item_increment_pp: number;
  contractual_value_target: number; // target_quantity * unit_price
  is_labor_or_service: boolean;
  bom_configured: boolean;
  materials_warning?: string | null; // e.g. "MATERIALES NO CONFIGURADOS"
  advisory_capacity_warning?: string | null; // e.g. aggressive target compared to recent velocity
  materials: MaterialRequirementDetail[];
  // Weather overlay projections per item
  weather_adjusted_capacity?: number | null;
  weather_gap_quantity?: number | null;
  weather_workability_factor?: number | null;
}

export interface WeeklyPlanCalculationSummary {
  plan_id?: string;
  project_id: string;
  start_date: string;
  end_date: string;
  status: WeeklyPlanStatus;
  global_contractual_value: number;
  global_previously_executed_value: number;
  global_current_progress_pct: number;
  global_target_progress_pct: number;
  global_increment_pp: number;
  total_plan_contractual_value: number;
  total_material_consumption_value: number;
  total_covered_by_stock_value: number;
  total_covered_by_inbound_value: number;
  total_additional_cash_required: number;
  currency: string;
  items: WeeklyPlanItemCalculation[];
  unconfigured_materials_count: number;
  // Weather overlay properties
  weather_overlay_enabled?: boolean;
  weather_snapshot_id?: string | null;
  weather_provider?: string;
  weather_forecasts_count?: number;
  weather_days_affected_count?: number;
  weather_plan_days_count?: number;
  weather_covered_days_count?: number;
  weather_coverage_is_partial?: boolean;
  weather_adjusted_material_consumption_value?: number | null;
  weather_adjusted_additional_cash_required?: number | null;
  weather_summary?: string | null;
  weather_failed_closed?: boolean;
}

export type ProductionRecipeSource = "EXCEL" | "BIM" | "MANUAL";

export interface ProductionRecipe {
  id: string;
  empresa_id: string;
  project_id: string | null;
  code: string;
  name: string;
  production_unit: string;
  description?: string | null;
  contract_total_quantity?: number | null;
  source_type: ProductionRecipeSource;
  source_file_name?: string | null;
  source_version?: string | null;
  active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionRecipeComponent {
  id: string;
  recipe_id: string;
  budget_item_id: string;
  quantity_per_production_unit: number;
  unit: string;
  sort_order: number;
  created_at: string;
}

export type InventoryReservationStatus = "ACTIVE" | "RELEASED" | "CONSUMED";

export interface InventoryReservation {
  id: string;
  empresa_id: string;
  location_id: string;
  producto_id: string;
  project_id: string;
  weekly_plan_id: string | null;
  quantity: number;
  status: InventoryReservationStatus;
  needed_by_date: string | null;
  idempotency_key: string | null;
  created_by?: string | null;
  created_at: string;
  released_at: string | null;
}
