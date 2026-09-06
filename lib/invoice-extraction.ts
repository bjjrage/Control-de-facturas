/**
 * Reads an invoice — either a photo of a paper invoice (GPT-4o-mini vision)
 * or a digital PDF (factura electrónica, read by its embedded text — no
 * vision call needed, cheaper and exact since the text is already real, not
 * a guess) — and returns structured fields. Shared by the single-invoice
 * dialog (app/(internal)/invoices/extract-actions.ts) and the batch upload
 * flow (app/(internal)/invoices/bulk-actions.ts) so the OpenAI call/schema
 * live in exactly one place.
 *
 * `pdf-parse` is imported lazily (inside extractInvoiceFieldsFromPdf, not at
 * module scope) — importing it unconditionally crashes on Vercel because its
 * pdfjs-dist dependency reaches for `@napi-rs/canvas` (a native binary) to
 * polyfill DOMMatrix, which isn't available in that serverless environment.
 * Loading it only when a PDF actually needs parsing keeps every photo-based
 * read (the common case) unaffected by that crash.
 */

export const MAX_INVOICE_FILE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_INVOICE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_INVOICE_FILE_TYPES = [...ACCEPTED_INVOICE_IMAGE_TYPES, "application/pdf"];

export type ExtractedInvoiceItem = {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  subtotal: number | null;
};

export type ExtractedInvoiceFields = {
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
  items: ExtractedInvoiceItem[];
};

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    provider_name: { type: ["string", "null"] },
    provider_tax_id: { type: ["string", "null"], description: "RUC del emisor. Solo la parte base, sin puntos, sin guiones y SIN el dígito verificador final (ej: '80023456-7' -> '80023456')." },
    invoice_number: { type: ["string", "null"] },
    invoice_date: { type: ["string", "null"], description: "Formato YYYY-MM-DD" },
    subtotal: { type: ["number", "null"] },
    vat: { type: ["number", "null"] },
    total: { type: "number", description: "Monto total en guaraníes, sin puntos ni separadores de miles" },
    timbrado: { type: ["string", "null"] },
    order_reference: { type: ["string", "null"], description: "Número de orden de compra mencionado en la descripción, ej: 'OC-2026-0008'. Null si no aparece." },
    product_description: { type: ["string", "null"], description: "Descripción del producto o servicio principal (primera línea del detalle)." },
    items: {
      type: "array",
      description: "Todas las líneas del detalle de la factura. Excluí las filas de subtotal, IVA y total.",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descripción del ítem tal como aparece en la factura" },
          quantity: { type: ["number", "null"], description: "Cantidad. Null si no aparece." },
          unit: { type: ["string", "null"], description: "Unidad de medida (kg, m², unid, bolsa…). Null si no aparece." },
          unit_price: { type: ["number", "null"], description: "Precio unitario en guaraníes, sin separadores de miles. Null si no aparece." },
          subtotal: { type: ["number", "null"], description: "Subtotal de la línea (qty × unit_price) en guaraníes. Null si no aparece." },
        },
        required: ["description", "quantity", "unit", "unit_price", "subtotal"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "provider_name",
    "provider_tax_id",
    "invoice_number",
    "invoice_date",
    "subtotal",
    "vat",
    "total",
    "timbrado",
    "order_reference",
    "product_description",
    "items",
  ],
  additionalProperties: false,
};

const PHOTO_SYSTEM_PROMPT = `Sos un asistente que lee facturas de papel paraguayas (muchas veces manuscritas o de talonario) a partir de una foto.
Extraé los datos exactamente como aparecen. Convertí montos a números planos en guaraníes, sin puntos de miles (ej: "1.500.000" -> 1500000).
Si un dato no aparece o es ilegible, devolvé null en ese campo (excepto "total", que es obligatorio: si no podés leerlo con confianza, poné tu mejor estimación).
Respondé únicamente con el JSON pedido, sin texto adicional.`;

const PDF_SYSTEM_PROMPT = `Sos un asistente que lee el texto extraído de una factura electrónica paraguaya (PDF con texto real, no una foto).
Extraé los datos exactamente como aparecen. Convertí montos a números planos en guaraníes, sin puntos de miles (ej: "1.500.000" -> 1500000).
Si un dato no aparece en el texto, devolvé null en ese campo (excepto "total", que es obligatorio).
Respondé únicamente con el JSON pedido, sin texto adicional.`;

async function callOpenAI(
  systemPrompt: string,
  userContent: unknown
): Promise<{ data: ExtractedInvoiceFields | null; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { data: null, error: "La lectura automática no está configurada (falta OPENAI_API_KEY)." };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "invoice_extraction", schema: EXTRACTION_SCHEMA, strict: true },
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { data: null, error: `No se pudo leer la factura (OpenAI: ${response.status}). ${detail.slice(0, 200)}` };
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { data: null, error: "Respuesta inesperada del lector de facturas." };
    return { data: JSON.parse(content) as ExtractedInvoiceFields, error: null };
  } catch {
    return { data: null, error: "No se pudo leer la factura." };
  }
}

/** Photo of a paper invoice, read via vision. */
export async function extractInvoiceFields(
  bytes: Buffer,
  mimeType: string
): Promise<{ data: ExtractedInvoiceFields | null; error: string | null }> {
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  return callOpenAI(PHOTO_SYSTEM_PROMPT, [
    { type: "text", text: "Extraé los datos de esta factura." },
    { type: "image_url", image_url: { url: dataUrl } },
  ]);
}

/** Digital PDF (factura electrónica), read by its embedded text — no vision call. */
export async function extractInvoiceFieldsFromPdf(
  bytes: Buffer
): Promise<{ data: ExtractedInvoiceFields | null; error: string | null }> {
  let text: string;
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    await parser.destroy();
    text = result.text.trim();
  } catch {
    return { data: null, error: "No se pudo abrir el PDF (¿está dañado o protegido con contraseña?)." };
  }

  if (text.length < 20) {
    return {
      data: null,
      error: "El PDF no tiene texto (parece un escaneo/foto guardada como PDF) — cargalo como imagen en vez de PDF.",
    };
  }

  return callOpenAI(PDF_SYSTEM_PROMPT, `Texto de la factura:\n\n${text.slice(0, 8000)}`);
}

/** Dispatches to the photo or PDF reader depending on the file's mime type. */
export async function extractInvoiceFieldsFromFile(
  bytes: Buffer,
  mimeType: string
): Promise<{ data: ExtractedInvoiceFields | null; error: string | null }> {
  if (mimeType === "application/pdf") return extractInvoiceFieldsFromPdf(bytes);
  return extractInvoiceFields(bytes, mimeType);
}
