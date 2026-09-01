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

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export interface Provider {
  id: string;
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
  rfq_provider_id: string;
  created_at: string;
}

export interface QuoteVersion {
  id: string;
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
  pdf_attachment_id: string;
  submitted_at: string;
  created_at: string;
}

export interface AuthorizedOrder {
  id: string;
  rfq_id: string;
  provider_id: string;
  quote_version_id: string;
  rfq_code: string;
  provider_name: string;
  client_name: string | null;
  product: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
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
  invoice_id: string;
  authorized_order_id: string;
  created_at: string;
}

export interface InvoiceException {
  id: string;
  invoice_id: string;
  approved_by: string;
  approved_at: string;
  reason: string;
  comment: string | null;
  difference_amount: number;
  difference_pct: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
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
