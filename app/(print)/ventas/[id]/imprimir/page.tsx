import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, Empresa, SalesDocument, SalesDocumentItem } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { SALES_DOC_TYPE_LABELS } from "@/lib/sales";
import { getEmpresaTemplate, renderTemplate } from "@/lib/template";
import { LOGO_STORAGE_PATH } from "@/components/layout/branding-constants";
import { PrintTrigger } from "./print-trigger";

// Vista para imprimir / guardar como PDF desde el navegador (Ctrl+P).
// Sin sidebar: se sirve fuera del layout visual pesado.
export default async function ImprimirVentaPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase.from("sales_documents").select("*").eq("id", id).single<SalesDocument>();
  if (!doc) notFound();

  const [{ data: client }, { data: items }, { data: empresa }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", doc.client_id).single<Client>(),
    supabase.from("sales_document_items").select("*").eq("sales_document_id", id).order("created_at").returns<SalesDocumentItem[]>(),
    supabase.from("empresas").select("*").eq("id", profile.empresa_id).single<Empresa>(),
  ]);

  const logoUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${LOGO_STORAGE_PATH}`
    : "";

  const docTypeLabel = SALES_DOC_TYPE_LABELS[doc.doc_type];
  const customTemplate = empresa ? getEmpresaTemplate(empresa, doc.doc_type) : null;

  if (customTemplate && empresa) {
    const renderedHtml = renderTemplate(customTemplate, {
      empresa,
      doc,
      client: client ?? null,
      items: items ?? [],
      logoUrl,
      docTypeLabel,
    });

    return (
      <>
        <PrintTrigger />
        <div
          style={{ colorScheme: "light" }}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </>
    );
  }

  // Plantilla por defecto
  return (
    <div className="mx-auto max-w-2xl bg-white text-black p-8 text-[13px] print:p-0" style={{ colorScheme: "light" }}>
      <PrintTrigger />
      <div className="flex justify-between items-start border-b-2 border-black pb-3">
        <div>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="h-12 max-w-[160px] object-contain mb-1" />
          ) : null}
          <div className="text-[18px] font-bold">{empresa?.nombre ?? "—"}</div>
          {empresa?.ruc ? <div className="text-[12px]">RUC: {empresa.ruc}</div> : null}
          {empresa?.direccion ? <div className="text-[12px]">{empresa.direccion}</div> : null}
          {empresa?.telefono ? <div className="text-[12px]">Tel: {empresa.telefono}</div> : null}
          {empresa?.email_empresa ? <div className="text-[12px]">{empresa.email_empresa}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-[13px] font-semibold text-black/60">{docTypeLabel}</div>
          <div className="text-[20px] font-bold">{doc.code}</div>
          <div className="text-[12px]">Emisión: {formatDate(doc.issue_date)}</div>
          {doc.due_date ? <div className="text-[12px]">Vencimiento: {formatDate(doc.due_date)}</div> : null}
        </div>
      </div>

      <div className="py-3 border-b border-black/30 text-[12px]">
        <div><b>Cliente:</b> {client?.name}</div>
        {client?.tax_id ? <div><b>RUC / CI:</b> {client.tax_id}</div> : null}
        {client?.address ? <div><b>Dirección:</b> {client.address}</div> : null}
      </div>

      <table className="w-full my-3 text-[12px] border-collapse">
        <thead>
          <tr className="border-b border-black">
            <th className="text-left py-1">Descripción</th>
            <th className="text-right py-1">Cant.</th>
            <th className="text-right py-1">Precio unit.</th>
            <th className="text-right py-1">IVA</th>
            <th className="text-right py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((it) => (
            <tr key={it.id} className="border-b border-black/15">
              <td className="py-1">{it.description}</td>
              <td className="text-right py-1">{it.quantity}</td>
              <td className="text-right py-1">{formatMoney(it.unit_price, doc.currency)}</td>
              <td className="text-right py-1">{it.vat_rate === 0 ? "Ex." : `${it.vat_rate}%`}</td>
              <td className="text-right py-1">{formatMoney(it.line_total, doc.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto w-56 text-[12px]">
        <div className="flex justify-between py-0.5">
          <span>Neto gravado</span>
          <span>{formatMoney(doc.subtotal, doc.currency)}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>IVA</span>
          <span>{formatMoney(doc.vat_amount, doc.currency)}</span>
        </div>
        <div className="flex justify-between py-1 border-t border-black font-bold text-[14px]">
          <span>TOTAL</span>
          <span>{formatMoney(doc.total, doc.currency)}</span>
        </div>
      </div>

      {doc.notes ? <div className="mt-4 text-[11px] whitespace-pre-wrap">{doc.notes}</div> : null}
      <div className="mt-6 text-[10px] text-black/50">
        Documento sin validez fiscal — generado por {empresa?.nombre ?? "el sistema"}.
      </div>
    </div>
  );
}
