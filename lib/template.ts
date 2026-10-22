import "server-only";

import { Empresa, SalesDocument, SalesDocumentItem, SalesDocType, Client } from "./types";
import { formatDate, formatMoney } from "./format";
import { LOGO_STORAGE_PATH } from "@/components/layout/branding-constants";
import { sanitizeTemplateHtml, substituteTemplateValues } from "./template-sanitizer";

export const TEMPLATE_VARIABLES = `
{{EMPRESA_NOMBRE}}   — Nombre de la empresa emisora
{{EMPRESA_RUC}}      — RUC de la empresa
{{EMPRESA_DIRECCION}} — Dirección de la empresa
{{EMPRESA_TELEFONO}} — Teléfono
{{EMPRESA_EMAIL}}    — Email de la empresa
{{LOGO_URL}}         — URL pública del logo (usalo en un <img src="{{LOGO_URL}}" ...>)
{{DOC_TIPO}}         — Tipo de documento (Proforma / Remisión / Factura)
{{DOC_CODIGO}}       — Número del documento
{{DOC_FECHA_EMISION}} — Fecha de emisión
{{DOC_FECHA_VENCIMIENTO}} — Fecha de vencimiento (puede estar vacío)
{{CLIENTE_NOMBRE}}   — Nombre del cliente
{{CLIENTE_RUC}}      — RUC / CI del cliente
{{CLIENTE_DIRECCION}} — Dirección del cliente
{{ITEMS_HTML}}       — Tabla completa de ítems con columnas: Descripción, Cantidad, Precio unit., IVA, Total
{{NETO}}             — Monto neto gravado (con símbolo de moneda)
{{IVA}}              — IVA total
{{TOTAL}}            — TOTAL del documento
{{NOTAS}}            — Observaciones
`.trim();

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildItemsHtml(items: SalesDocumentItem[], currency: SalesDocument["currency"]): string {
  const rows = items
    .map(
      (it) => `<tr>
      <td style="padding:3px 4px;border-bottom:1px solid #ddd;">${esc(it.description)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid #ddd;text-align:right;">${it.quantity}</td>
      <td style="padding:3px 4px;border-bottom:1px solid #ddd;text-align:right;">${formatMoney(it.unit_price, currency)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid #ddd;text-align:center;">${it.vat_rate === 0 ? "Exenta" : `${it.vat_rate}%`}</td>
      <td style="padding:3px 4px;border-bottom:1px solid #ddd;text-align:right;">${formatMoney(it.line_total, currency)}</td>
    </tr>`
    )
    .join("\n");

  return `<table style="width:100%;border-collapse:collapse;font-size:inherit;">
  <thead>
    <tr style="border-bottom:2px solid currentColor;">
      <th style="padding:4px;text-align:left;">Descripción</th>
      <th style="padding:4px;text-align:right;">Cant.</th>
      <th style="padding:4px;text-align:right;">Precio unit.</th>
      <th style="padding:4px;text-align:center;">IVA</th>
      <th style="padding:4px;text-align:right;">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function getEmpresaTemplate(empresa: Empresa, docType: SalesDocType): string | null {
  if (docType === "PROFORMA") return empresa.template_proforma;
  if (docType === "REMISION") return empresa.template_remision;
  if (docType === "FACTURA") return empresa.template_factura;
  return null;
}

export function renderTemplate(
  template: string,
  {
    empresa,
    doc,
    client,
    items,
    logoUrl,
    docTypeLabel,
  }: {
    empresa: Empresa;
    doc: SalesDocument;
    client: Client | null;
    items: SalesDocumentItem[];
    logoUrl: string;
    docTypeLabel: string;
  }
): string {
  const itemsHtml = buildItemsHtml(items, doc.currency);

  return substituteTemplateValues(
    sanitizeTemplateHtml(template),
    {
      "{{EMPRESA_NOMBRE}}": empresa.nombre ?? "",
      "{{EMPRESA_RUC}}": empresa.ruc ?? "",
      "{{EMPRESA_DIRECCION}}": empresa.direccion ?? "",
      "{{EMPRESA_TELEFONO}}": empresa.telefono ?? "",
      "{{EMPRESA_EMAIL}}": empresa.email_empresa ?? "",
      "{{DOC_TIPO}}": docTypeLabel,
      "{{DOC_CODIGO}}": doc.code,
      "{{DOC_FECHA_EMISION}}": formatDate(doc.issue_date),
      "{{DOC_FECHA_VENCIMIENTO}}": doc.due_date ? formatDate(doc.due_date) : "",
      "{{CLIENTE_NOMBRE}}": client?.name ?? "",
      "{{CLIENTE_RUC}}": client?.tax_id ?? "",
      "{{CLIENTE_DIRECCION}}": client?.address ?? "",
      "{{NETO}}": formatMoney(doc.subtotal, doc.currency),
      "{{IVA}}": formatMoney(doc.vat_amount, doc.currency),
      "{{TOTAL}}": formatMoney(doc.total, doc.currency),
      "{{NOTAS}}": doc.notes ?? "",
    },
    itemsHtml,
    trustedLogoUrl(logoUrl)
  );
}

function trustedLogoUrl(candidate: string): string {
  try {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configuredUrl || !candidate) return "";

    const configured = new URL(configuredUrl);
    const logo = new URL(candidate);
    const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(configured.hostname);
    if (configured.protocol !== "https:" && !(localDevelopmentHost && configured.protocol === "http:")) return "";
    if (configured.username || configured.password || logo.username || logo.password) return "";
    if (logo.origin !== configured.origin) return "";
    if (logo.pathname !== `/storage/v1/object/public/branding/${LOGO_STORAGE_PATH}`) return "";
    if (logo.search || logo.hash) return "";
    return logo.href;
  } catch {
    return "";
  }
}

export function renderTemplatePreview(template: string): string {
  const sampleItems: SalesDocumentItem[] = [
    {
      id: "preview-item-1",
      empresa_id: "preview",
      sales_document_id: "preview",
      description: "Servicio de dise\u00f1o web",
      quantity: 1,
      unit_price: 500000,
      vat_rate: 10,
      line_total: 500000,
      created_at: "",
    },
    {
      id: "preview-item-2",
      empresa_id: "preview",
      sales_document_id: "preview",
      description: "Hosting anual",
      quantity: 1,
      unit_price: 200000,
      vat_rate: 10,
      line_total: 200000,
      created_at: "",
    },
  ];

  return substituteTemplateValues(
    sanitizeTemplateHtml(template),
    {
      "{{EMPRESA_NOMBRE}}": "Empresa Ejemplo S.A.",
      "{{EMPRESA_RUC}}": "80012345-6",
      "{{EMPRESA_DIRECCION}}": "Av. Mariscal L\u00f3pez 1234, Asunci\u00f3n",
      "{{EMPRESA_TELEFONO}}": "+595 21 555-0000",
      "{{EMPRESA_EMAIL}}": "info@empresa.com",
      "{{DOC_TIPO}}": "Factura",
      "{{DOC_CODIGO}}": "F-000001",
      "{{DOC_FECHA_EMISION}}": "03/09/2026",
      "{{DOC_FECHA_VENCIMIENTO}}": "03/10/2026",
      "{{CLIENTE_NOMBRE}}": "Cliente Demo S.R.L.",
      "{{CLIENTE_RUC}}": "9876543-2",
      "{{CLIENTE_DIRECCION}}": "Calle Principal 456, Asunci\u00f3n",
      "{{NETO}}": "Gs. 636.364",
      "{{IVA}}": "Gs. 63.636",
      "{{TOTAL}}": "Gs. 700.000",
      "{{NOTAS}}": "Pago dentro de 30 d\u00edas.",
    },
    buildItemsHtml(sampleItems, "PYG"),
    ""
  );
}
