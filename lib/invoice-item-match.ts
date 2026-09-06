/**
 * Matching semántico de líneas de factura contra líneas de OC.
 *
 * Una vez identificada la OC a la que pertenece una factura (por código de OC
 * o fallback de monto), este módulo usa GPT-4o-mini para emparejar cada línea
 * de la factura con su línea correspondiente en la OC.
 *
 * El comprador puede escribir "Cemento Portland 50kg" en la OC y el proveedor
 * facturar "Cemento Nacional tipo A" — el modelo entiende que son el mismo
 * producto en ese contexto y los empareja correctamente.
 */

export type OrderItemInput = {
  id: string;
  product: string;
  quantity: number;
  unit: string;
  quantity_invoiced: number;
};

export type InvoiceItemInput = {
  id: string;
  description: string;
  quantity: number | null;
  unit: string | null;
};

export type ItemMatch = {
  invoice_item_id: string;
  order_item_id: string;
  quantity_matched: number;
};

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          invoice_item_index: { type: "number", description: "Índice (0-based) del ítem de la factura" },
          order_item_index: { type: "number", description: "Índice (0-based) del ítem de la OC que corresponde" },
          quantity_matched: { type: "number", description: "Cantidad entregada en esta línea de factura" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["invoice_item_index", "order_item_index", "quantity_matched", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

/**
 * Pide a GPT-4o-mini que empareje ítems de factura con ítems de OC.
 * Solo retorna matches con confidence high o medium; los low se descartan.
 * Si un ítem de factura no tiene match claro, simplemente no aparece.
 */
export async function matchInvoiceItemsToOrderItems(
  orderItems: OrderItemInput[],
  invoiceItems: InvoiceItemInput[]
): Promise<ItemMatch[]> {
  if (orderItems.length === 0 || invoiceItems.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const orderList = orderItems
    .map((o, i) => `${i}. "${o.product}" — pedido: ${o.quantity} ${o.unit}, ya facturado: ${o.quantity_invoiced} ${o.unit}`)
    .join("\n");

  const invoiceList = invoiceItems
    .map((inv, i) => `${i}. "${inv.description}"${inv.quantity != null ? ` — ${inv.quantity} ${inv.unit ?? ""}` : ""}`)
    .join("\n");

  const userMessage = `
Tenés los ítems de una Orden de Compra (OC) y los ítems de una factura recibida para esa OC.
Emparejá cada ítem de la factura con su ítem correspondiente en la OC.
Los nombres pueden diferir (distintos fabricantes, marcas o terminología del proveedor).
Usá el contexto del producto y las cantidades para decidir.

ÍTEMS DE LA OC:
${orderList}

ÍTEMS DE LA FACTURA:
${invoiceList}

Para cada ítem de la factura indicá:
- invoice_item_index: su índice en la lista de factura
- order_item_index: el índice del ítem de la OC que corresponde
- quantity_matched: la cantidad que llega en esta línea de factura (usá la cantidad de la factura si está disponible)
- confidence: "high" si el match es claro, "medium" si es probable, "low" si es una suposición

Si un ítem de la factura no tiene match claro en la OC, no lo incluyas.
`.trim();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "item_matches", schema: MATCH_SCHEMA, strict: true },
        },
        messages: [
          {
            role: "system",
            content:
              "Sos un asistente que empareja líneas de facturas con líneas de órdenes de compra. " +
              "Entendés que el comprador y el proveedor pueden usar nombres distintos para el mismo producto. " +
              "Respondé únicamente con el JSON pedido.",
          },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!response.ok) return [];

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return [];

    const parsed = JSON.parse(content) as {
      matches: Array<{
        invoice_item_index: number;
        order_item_index: number;
        quantity_matched: number;
        confidence: "high" | "medium" | "low";
      }>;
    };

    return (parsed.matches ?? [])
      .filter((m) => m.confidence !== "low")
      .filter(
        (m) =>
          m.invoice_item_index >= 0 &&
          m.invoice_item_index < invoiceItems.length &&
          m.order_item_index >= 0 &&
          m.order_item_index < orderItems.length &&
          m.quantity_matched > 0
      )
      .map((m) => ({
        invoice_item_id: invoiceItems[m.invoice_item_index].id,
        order_item_id: orderItems[m.order_item_index].id,
        quantity_matched: m.quantity_matched,
      }));
  } catch {
    return [];
  }
}
