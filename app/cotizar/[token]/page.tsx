import { notFound } from "next/navigation";
import Image from "next/image";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { isRfqOpen } from "@/lib/rfq-status";
import { RfqStatus } from "@/lib/types";
import { QuoteForm } from "./quote-form";
import { markOpened } from "./actions";

export default async function CotizarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: rfqProvider } = await admin
    .from("rfq_providers")
    .select("*, rfqs!rfq_providers_rfq_id_fkey(*), providers(name)")
    .eq("token", token)
    .maybeSingle();

  if (!rfqProvider) notFound();

  const rfq = (rfqProvider as unknown as {
    rfqs: {
      id: string;
      code: string;
      client_name: string | null;
      mostrar_cliente_al_proveedor: boolean;
      product: string;
      quantity: number;
      unit: string;
      specifications: string | null;
      required_date: string | null;
      status: RfqStatus;
      expires_at: string;
    };
  }).rfqs;
  const providerName = (rfqProvider as unknown as { providers: { name: string } }).providers.name;

  await markOpened(token);

  const isOpen = isRfqOpen(rfq);

  const { data: rfqAttachments } = await admin
    .from("attachments")
    .select("id, bucket, path, file_name")
    .eq("rfq_id", rfq.id)
    .order("created_at");

  const specFiles = await Promise.all(
    (rfqAttachments ?? []).map(async (a) => {
      const { data } = await admin.storage.from(a.bucket).createSignedUrl(a.path, 3600);
      return { fileName: a.file_name, url: data?.signedUrl ?? null };
    })
  );

  let latestSubmission: { total_price: number; currency: string; submitted_at: string } | null = null;
  if (rfqProvider.status === "RESPONDIDO") {
    const { data: quote } = await admin
      .from("quotes")
      .select("id")
      .eq("rfq_provider_id", rfqProvider.id)
      .maybeSingle();
    if (quote) {
      const { data: version } = await admin
        .from("quote_versions")
        .select("total_price, currency, submitted_at")
        .eq("quote_id", quote.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      latestSubmission = version ?? null;
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6">
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 mb-4">
          <p className="text-[11px] text-[var(--muted)] mb-1">Solicitud {rfq.code}</p>
          <h1 className="text-[15px] font-semibold mb-2">Hola, {providerName}</h1>
          <div className="space-y-1 text-[13px]">
            {rfq.mostrar_cliente_al_proveedor && rfq.client_name ? (
              <div>
                <span className="text-[var(--muted)]">Cliente: </span>
                {rfq.client_name}
              </div>
            ) : null}
            <div>
              <span className="text-[var(--muted)]">Producto: </span>
              {rfq.product}
            </div>
            <div>
              <span className="text-[var(--muted)]">Cantidad: </span>
              {formatNumber(rfq.quantity, 2)} {rfq.unit}
            </div>
            {rfq.specifications ? (
              <div>
                <span className="text-[var(--muted)]">Especificaciones: </span>
                {rfq.specifications}
              </div>
            ) : null}
            {rfq.required_date ? (
              <div>
                <span className="text-[var(--muted)]">Fecha requerida: </span>
                {formatDate(rfq.required_date)}
              </div>
            ) : null}
            {isOpen ? (
              <div>
                <span className="text-[var(--muted)]">Cotizar antes de: </span>
                {formatDateTime(rfq.expires_at)}
              </div>
            ) : null}
          </div>
          {specFiles.length > 0 ? (
            <div className="mt-3 pt-3 border-t border-[var(--border)]">
              <p className="text-[11px] text-[var(--muted)] mb-1">Archivos de referencia</p>
              <ul className="space-y-1">
                {specFiles.map((f, i) =>
                  f.url ? (
                    <li key={i}>
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-[var(--primary)] underline hover:no-underline"
                      >
                        {f.fileName}
                      </a>
                    </li>
                  ) : null
                )}
              </ul>
            </div>
          ) : null}
        </div>

        {latestSubmission ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 mb-4 text-[13px]">
            <p className="font-medium mb-0.5">Ya enviaste una cotización</p>
            <p className="text-[var(--muted)]">
              {formatMoney(latestSubmission.total_price, latestSubmission.currency as never)} ·{" "}
              {formatDate(latestSubmission.submitted_at)}
            </p>
          </div>
        ) : null}

        {isOpen ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <h2 className="text-[14px] font-semibold mb-3">
              {latestSubmission ? "Enviar una nueva versión" : "Enviar cotización"}
            </h2>
            <QuoteForm token={token} />
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Esta solicitud venció o ya fue cerrada. Si querés cotizar igual, contactá a niupack.
          </div>
        )}
      </div>
    </div>
  );
}
