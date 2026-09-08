// Cliente para la API de Goekua (facturación electrónica SIFEN Paraguay)
// Docs: https://goekua.com.py/api-docs.html
// Auth: header x-api-key
// Configurar en Vercel: GOEKUA_API_KEY, GOEKUA_BASE_URL (opcional)

export type GoekuaVatRate = 0 | 5 | 10;

export interface GoekuaItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: GoekuaVatRate;
  total: number;
}

export interface GoekuaCliente {
  ruc: string;           // RUC con dígito verificador p.ej. "80012345-6", o CI "1234567-8"
  businessName: string;  // Razón social
  fantasyName?: string;
  address?: string;
  contributor?: boolean; // true = tiene RUC (contribuyente), false = CI
}

export interface GoekuaUsuario {
  name: string;
  email: string;
  documentType: number;  // 1=CI, 2=RUC, 3=pasaporte
  documentNumber: string;
  phone?: string;
  position?: string;
}

export interface GoekuaEstablecimiento {
  id: number;           // ID del establecimiento en SIFEN (env: GOEKUA_ESTABLISHMENT_ID)
  address: string;      // Dirección física del establecimiento
  denomination: string; // Nombre / denominación del establecimiento
}

export interface GoekuaMedioPago {
  type: number;   // 1=Efectivo, 2=Cheque, 3=Tarjeta débito, 4=Tarjeta crédito, 5=Transferencia
  amount: number;
  description?: string;
}

export interface GoekuaFacturaPayload {
  user: GoekuaUsuario;
  client: GoekuaCliente;
  establishment: GoekuaEstablecimiento;
  items: GoekuaItem[];
  paymentMethods: GoekuaMedioPago[];
  currency: string;           // "PYG"
  currencyRate: number;       // 1 para PYG, tipo de cambio para divisas
  transactionType: number;    // 1=Venta de mercadería, 2=Prestación de servicios, 3=Mixto
  operationConditionType: number; // 1=Contado, 2=Crédito
  emissionType: number;       // 1=Normal, 2=Contingencia
  presenceIndicatorType: number;  // 1=Presencial, 2=Por internet, 3=Telemática, 9=Otro
  documentNumber: string;     // Formato "001-001-0000001"
  pointOfExpedition: string;  // "001"
  timbrado?: string;
}

export interface GoekuaDocumentoResult {
  id: string;
  cdc?: string;
  xmlUrl?: string;
  kudeUrl?: string;
}

export interface GoekuaApiError {
  error: string;
  detail?: string;
}

export function isGoekuaConfigured(): boolean {
  return !!process.env.GOEKUA_API_KEY;
}

function headers() {
  return {
    "x-api-key": process.env.GOEKUA_API_KEY!,
    "Content-Type": "application/json",
  };
}

function baseUrl() {
  return process.env.GOEKUA_BASE_URL ?? "https://api.goekua.com.py";
}

export async function goekuaEmitirFactura(
  payload: GoekuaFacturaPayload
): Promise<GoekuaDocumentoResult | GoekuaApiError> {
  if (!isGoekuaConfigured()) return { error: "GOEKUA_API_KEY no configurada" };
  try {
    const res = await fetch(`${baseUrl()}/api/electronic-document/generate-invoice`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (res.status === 201) {
      const data = await res.json();
      return {
        id:      data.id,
        cdc:     data.cdc     ?? undefined,
        xmlUrl:  data.xmlUrl  ?? undefined,
        kudeUrl: data.kudeUrl ?? undefined,
      };
    }
    const body = await res.text();
    return { error: `Goekua respondió ${res.status}`, detail: body };
  } catch (e) {
    return { error: "Error de red al conectar con Goekua", detail: String(e) };
  }
}

export async function goekuaConsultarDocumento(
  cdc: string
): Promise<GoekuaDocumentoResult | GoekuaApiError> {
  if (!isGoekuaConfigured()) return { error: "GOEKUA_API_KEY no configurada" };
  try {
    const res = await fetch(`${baseUrl()}/api/electronic-document/${cdc}`, {
      headers: { "x-api-key": process.env.GOEKUA_API_KEY! },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      return { id: data.id ?? cdc, cdc, xmlUrl: data.xmlUrl, kudeUrl: data.kudeUrl };
    }
    const body = await res.text();
    return { error: `Goekua respondió ${res.status}`, detail: body };
  } catch (e) {
    return { error: "Error de red al conectar con Goekua", detail: String(e) };
  }
}
