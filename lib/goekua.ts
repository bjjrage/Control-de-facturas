// Provider DTOs: https://goekua.com.py/api-docs.html (audited 2026-10-04).
export interface GoekuaUsuario { name: string; lastName: string; email: string; documentType: number; documentNumber: string; }
export interface GoekuaEstablecimiento { idSifen: string; address: string; houseNumber: number; cityId: number; phone: string; email: string; denomination: string; }
export interface GoekuaCliente { ruc: string; businessName: string; address: string; email?: string; phone?: string; isContributor: boolean; }
export interface GoekuaItem { code: string; description: string; measureUnit: number; amount: number; unitPrice: number; unitDiscountPercentage: number; unitNetDiscount: number; taxPercentage: number; taxRate: 0 | 5 | 10; ivaType: 1 | 3; }
export interface GoekuaMedioPago { paymentType: number; charge: number; currency: string; currencyRate: number; }
export interface GoekuaFacturaPayload {
  user: GoekuaUsuario; client: GoekuaCliente; establishment: GoekuaEstablecimiento; items: GoekuaItem[]; paymentMethods: GoekuaMedioPago[];
  currency: string; currencyRate: number; transactionType: number; operationConditionType: number; emissionType: number;
  presenceIndicatorType: number; pointOfExpedition: string; documentNumber: string;
  expirationDate?: string;
}
export interface GoekuaCreditNotePayload {
  cdcElectronicDocumentAttached: string; emissionMotive: GoekuaEmissionMotive; user: GoekuaUsuario; establishment: GoekuaEstablecimiento;
  items: { code: string; amount: number; unitPrice: number }[]; pointOfExpedition: string; documentNumber: string;
}
// Goekua dMotEmi catalog; labels from the SIFEN v150 manual, E401.
export const GOEKUA_NC_MOTIVES = {
  1: "Devolución y ajuste de precios", 2: "Devolución", 3: "Descuento", 4: "Bonificación",
  5: "Crédito incobrable", 6: "Recupero de costo", 7: "Recupero de gasto", 8: "Ajuste de precio",
} as const;
export type GoekuaEmissionMotive = keyof typeof GOEKUA_NC_MOTIVES;
export function isGoekuaEmissionMotive(value: unknown): value is GoekuaEmissionMotive { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8; }
export const GOEKUA_RECONCILIATION_REQUIRED = "El documento ya fue enviado a Goekua y tiene ID de proveedor, pero todavía no se dispone del CDC. Requiere conciliación antes de reintentar.";
// Shape check, not proof of DNIT approval. Only an explicit provider CDC field supplies identity.
export function isFiscalCdc(value: unknown): value is string { return typeof value === "string" && /^\d{44}$/.test(value); }
export interface GoekuaDocumentoResult { id: string; cdc?: string; xmlUrl?: string; kudeUrl?: string; }
export interface GoekuaConsultaResult { cdc: string; kudeUrl?: string; }
export interface GoekuaApiError { error: string; detail?: string; }
export function isGoekuaConfigured(): boolean { return !!process.env.GOEKUA_API_KEY; }
function headers() { return { "x-api-key": process.env.GOEKUA_API_KEY!, "Content-Type": "application/json" }; }
function baseUrl() { return process.env.GOEKUA_BASE_URL ?? "https://api.goekua.com.py"; }
async function createDocument(path: string, payload: GoekuaFacturaPayload | GoekuaCreditNotePayload): Promise<GoekuaDocumentoResult | GoekuaApiError> {
  if (!isGoekuaConfigured()) return { error: "GOEKUA_API_KEY no configurada" };
  try {
    const res = await fetch(`${baseUrl()}/api/electronic-document/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(payload) });
    if (res.status !== 201) return { error: `Goekua respondió ${res.status}`, detail: await res.text() };
    const data = await res.json();
    if (typeof data.id !== "string" || !data.id.trim()) return { error: "Goekua respondió sin identificador; requiere conciliación, no reintentar automáticamente." };
    // Documented response: {id}. Keep optional CDC/URLs only if actually returned.
    return { id: data.id, ...(isFiscalCdc(data.cdc) ? { cdc: data.cdc } : {}),
      ...(typeof data.xmlUrl === "string" ? { xmlUrl: data.xmlUrl } : {}), ...(typeof data.kudeUrl === "string" ? { kudeUrl: data.kudeUrl } : {}) };
  } catch (error) { return { error: "Error de red al conectar con Goekua; resultado incierto, requiere conciliación antes de reintentar", detail: String(error) }; }
}
export async function goekuaEmitirFactura(payload: GoekuaFacturaPayload) { return createDocument("generate-invoice", payload); }
export async function goekuaEmitirNotaCredito(payload: GoekuaCreditNotePayload) { return createDocument("generate-credit-note", payload); }
export async function goekuaConsultarDocumento(cdc: string): Promise<GoekuaConsultaResult | GoekuaApiError> {
  if (!isFiscalCdc(cdc)) return { error: "La consulta requiere un CDC fiscal real de 44 dígitos, no un ID de proveedor." };
  if (!isGoekuaConfigured()) return { error: "GOEKUA_API_KEY no configurada" };
  try {
    const res = await fetch(`${baseUrl()}/api/electronic-document/${cdc}`, { headers: headers(), cache: "no-store" });
    if (!res.ok) return { error: `Goekua respondió ${res.status}`, detail: await res.text() };
    const data = await res.json();
    if (!isFiscalCdc(data.cdc) || data.cdc !== cdc) return { error: "Goekua devolvió un CDC ausente o distinto del consultado." };
    // The official response has inline xml, not xmlUrl. Do not store XML in a URL column.
    return { cdc, ...(typeof data.kudeUrl === "string" ? { kudeUrl: data.kudeUrl } : {}) };
  } catch (error) { return { error: "Error de red al consultar Goekua", detail: String(error) }; }
}
