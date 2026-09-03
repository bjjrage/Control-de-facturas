import { Empresa, SalesDocument, SalesDocumentItem, SalesDocType, Client } from "./types";
import { formatDate, formatMoney } from "./format";

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
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  return template
    .replaceAll("{{EMPRESA_NOMBRE}}", esc(empresa.nombre))
    .replaceAll("{{EMPRESA_RUC}}", esc(empresa.ruc))
    .replaceAll("{{EMPRESA_DIRECCION}}", esc(empresa.direccion))
    .replaceAll("{{EMPRESA_TELEFONO}}", esc(empresa.telefono))
    .replaceAll("{{EMPRESA_EMAIL}}", esc(empresa.email_empresa))
    .replaceAll("{{LOGO_URL}}", logoUrl)
    .replaceAll("{{DOC_TIPO}}", esc(docTypeLabel))
    .replaceAll("{{DOC_CODIGO}}", esc(doc.code))
    .replaceAll("{{DOC_FECHA_EMISION}}", esc(formatDate(doc.issue_date)))
    .replaceAll("{{DOC_FECHA_VENCIMIENTO}}", doc.due_date ? esc(formatDate(doc.due_date)) : "")
    .replaceAll("{{CLIENTE_NOMBRE}}", esc(client?.name))
    .replaceAll("{{CLIENTE_RUC}}", esc(client?.tax_id))
    .replaceAll("{{CLIENTE_DIRECCION}}", esc(client?.address))
    .replaceAll("{{ITEMS_HTML}}", itemsHtml)
    .replaceAll("{{NETO}}", formatMoney(doc.subtotal, doc.currency))
    .replaceAll("{{IVA}}", formatMoney(doc.vat_amount, doc.currency))
    .replaceAll("{{TOTAL}}", formatMoney(doc.total, doc.currency))
    .replaceAll("{{NOTAS}}", esc(doc.notes));
}
