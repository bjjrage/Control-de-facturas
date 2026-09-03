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
export type InvoiceJobOutcome = "matched" | "created_unmatched" | "needs_manual" | "error";

export interface ExtractedInvoiceFields {
  provider_name: string | null;
  provider_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  timbrado: string | null;
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
