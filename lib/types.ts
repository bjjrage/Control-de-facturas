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

export type StockMovimientoTipo = "ENTRADA" | "SALIDA" | "AJUSTE";

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
  referencia_tipo: string | null;
  referencia_id: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OcRecepcionItem {
  id: string;
  recepcion_id: string;
  empresa_id: string;
  order_item_id: string;
  producto_id: string | null;
  cantidad_recibida: number;
  notas: string | null;
  created_at: string;
}

export interface OcRecepcion {
  id: string;
  empresa_id: string;
  order_id: string;
  fecha: string;
  recibido_por: string;
  notas: string | null;
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

export type SalesDocType = "PROFORMA" | "REMISION" | "FACTURA";
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
