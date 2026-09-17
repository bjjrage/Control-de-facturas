import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { isValidPortalTokenFormat, portalQuotationState, tokenExpiresAt } from "@/lib/quotation";
import { hashQuotationToken } from "@/lib/quotation-tokens";
import { AcceptForm, RejectForm } from "./accept-form";

type TokenRow = {
  id: string;
  empresa_id: string;
  sales_document_id: string;
  quotation_version: number;
  token_prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

type DocRow = {
  id: string;
  empresa_id: string;
  client_id: string;
  code: string;
  doc_type: string;
  issue_date: string;
  due_date: string | null;
  currency: "PYG" | "USD" | "EUR" | "BRL" | "ARS";
  subtotal: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  quotation_version: number;
  acceptance_status: "DRAFT" | "PENDING_ACCEPTANCE" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  acceptance_expires_at: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
};

export default async function CotizacionPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPortalTokenFormat(token)) notFound();

  const admin = createAdminClient();
  // El raw de la URL se hashea antes de consultar: el secreto nunca llega a
  // la DB en claro (solo existe token_hash). El token es la única capacidad
  // pública: con él solo se lee ESTA cotización, nunca por IDs manipulados.
  const { data: tok } = await admin
    .from("sales_quotation_tokens")
    .select("id, empresa_id, sales_document_id, quotation_version, token_prefix, created_at, expires_at, revoked_at")
    .eq("token_hash", hashQuotationToken(token))
    .maybeSingle<TokenRow>();
  if (!tok) notFound();

  const { data: doc } = await admin
    .from("sales_documents")
    .select(
      "id, empresa_id, client_id, code, doc_type, issue_date, due_date, currency, subtotal, vat_amount, total, notes, quotation_version, acceptance_status, acceptance_expires_at, accepted_at, accepted_by_name"
    )
    .eq("id", tok.sales_document_id)
    .maybeSingle<DocRow>();
  if (!doc || doc.doc_type !== "PROFORMA") notFound();
  // Aislamiento de tenant: el token solo resuelve su propio documento.
  if (doc.empresa_id !== tok.empresa_id) notFound();

  const [{ data: client }, { data: empresa }, { data: items }] = await Promise.all([
    admin.from("clients").select("id, name").eq("id", doc.client_id).maybeSingle<{ id: string; name: string }>(),
    admin.from("empresas").select("id, nombre, ruc, telefono, email_empresa").eq("id", tok.empresa_id).maybeSingle<{ id: string; nombre: string; ruc: string | null; telefono: string | null; email_empresa: string | null }>(),
    admin
      .from("sales_document_items")
      .select("id, description, quantity, unit_price, vat_rate, line_total")
      .eq("sales_document_id", tok.sales_document_id)
      .order("created_at"),
  ]);

  // Auditoría best-effort de visualización (nunca rompe la página).
  // Se envía el hash, jamás el token en claro.
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    await admin.rpc("log_quotation_view", {
      p_token_hash: hashQuotationToken(token),
      p_ip: forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
      p_user_agent: h.get("user-agent") ?? null,
    });
  } catch {
    // best-effort
  }

  const state = portalQuotationState(tok, doc);
  const effectiveExpiry = tokenExpiresAt(tok, doc);
  const itemList = (items ?? []) as { id: string; description: string; quantity: number; unit_price: number; vat_rate: number; line_total: number }[];

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-[11px] text-[var(--muted)] mb-1">
            Cotización {doc.code} · versión {doc.quotation_version}
          </p>
          <h1 className="text-[16px] font-semibold mb-1">{empresa?.nombre ?? "Cotización"}</h1>
          <div className="text-[13px] text-[var(--muted)] space-y-0.5">
            <div>Cliente: {(client as { name?: string } | null)?.name ?? "-"}</div>
            <div>Emitida: {formatDate(doc.issue_date)}</div>
            {effectiveExpiry ? <div>Válida hasta: {formatDateTime(effectiveExpiry)}</div> : null}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th className="num">Cant.</th>
                <th className="num">Precio unit.</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {itemList.map((it) => (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{formatMoney(it.unit_price, doc.currency)}</td>
                  <td className="num">{formatMoney(it.line_total, doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 border-t border-[var(--border)] ml-auto w-64 text-[13px] space-y-1">
            <div className="flex justify-between text-[var(--muted)]">
              <span>Neto</span>
              <span className="num">{formatMoney(doc.subtotal, doc.currency)}</span>
            </div>
            <div className="flex justify-between text-[var(--muted)]">
              <span>IVA</span>
              <span className="num">{formatMoney(doc.vat_amount, doc.currency)}</span>
            </div>
            <div className="flex justify-between font-semibold text-[15px]">
              <span>Total</span>
              <span className="num">{formatMoney(doc.total, doc.currency)}</span>
            </div>
          </div>
        </div>

        {doc.notes ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px]">
            <div className="text-[11px] text-[var(--muted)] mb-1">Observaciones</div>
            {doc.notes}
          </div>
        ) : null}

        {state === "PENDING_ACCEPTANCE" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
            <h2 className="text-[14px] font-semibold">Aceptación electrónica de la cotización</h2>
            <AcceptForm token={token} />
            <RejectForm token={token} />
          </div>
        ) : null}

        {state === "ACCEPTED" ? (
          <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-5 text-[13px] text-[var(--ok)]">
            <p className="font-semibold mb-1">Cotización aceptada ✓</p>
            <p>
              {doc.accepted_by_name ? `Aceptada por ${doc.accepted_by_name}` : "Aceptada"}
              {doc.accepted_at ? ` el ${formatDateTime(doc.accepted_at)}` : ""}. La empresa ya fue
              notificada y te contactará con los próximos pasos.
            </p>
          </div>
        ) : null}

        {state === "REJECTED" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Esta cotización figura como no aceptada. Si fue un error, contactá a la empresa para pedir
            una nueva versión.
          </div>
        ) : null}

        {state === "EXPIRED" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Esta cotización venció{effectiveExpiry ? ` (${formatDateTime(effectiveExpiry)})` : ""}. Contactá a
            la empresa para pedir una versión vigente.
          </div>
        ) : null}

        {state === "STALE" ? (
          <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-bg)] p-5 text-[13px]">
            La empresa actualizó esta cotización (ahora va por la versión {doc.quotation_version}) y este
            enlace corresponde a una versión anterior. Pedí el nuevo enlace antes de aceptar.
          </div>
        ) : null}

        {state === "REVOKED" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Este enlace fue revocado por la empresa. Si necesitás revisar la cotización, pedí el enlace
            vigente.
          </div>
        ) : null}

        {state === "DRAFT" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Esta cotización todavía no está habilitada para aceptación. Contactá a la empresa.
          </div>
        ) : null}

        <p className="text-[11px] text-[var(--muted)] text-center px-6">
          Estás aceptando únicamente la cotización {doc.code}. La Orden de Trabajo es un documento interno
          de la empresa y no requiere tu aprobación.
          {empresa?.telefono || empresa?.email_empresa
            ? ` Dudas: ${[empresa.telefono, empresa.email_empresa].filter(Boolean).join(" · ")}`
            : ""}
        </p>
      </div>
    </div>
  );
}
