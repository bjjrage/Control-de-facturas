import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeRfqDocuments } from "@/lib/rfq/document-analysis";
import { getAppOrigin } from "@/lib/app-origin";
import { loadRfqWorkspace } from "@/lib/rfq/service";
import { magicLinkOpen } from "@/lib/rfq/domain";
import type { Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { isRfqOpen } from "@/lib/rfq-status";
import { QuoteShareButtons } from "./quote-share-buttons";
import { AttachmentLink } from "./attachment-link";
import { AddAttachmentDialog } from "./add-attachment-dialog";
import { InternalQuoteDialog } from "./internal-quote-dialog";
import { InviteDialog } from "./invite-dialog";
import { RfqWorkspace } from "./rfq-workspace";
import { AdministrativeRfqDetail } from "./administrative-rfq-detail";
import { HumanAction } from "./human-action";
import { cancelRfq, reopenRfq } from "./actions";
import {
  revokeMagicLinkAction,
  renewMagicLinkAction,
  closeDiscoveryAction,
} from "./workflow-actions";
export default async function RfqDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile([
    "comercial",
    "administracion",
    "admin",
  ]);
  const db = await createClient();
  const { data: header, error } = await db
    .from("rfqs")
    .select("id")
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!header) notFound();
  const data = await loadRfqWorkspace(db, profile.empresa_id, id);
  const analyses = await analyzeRfqDocuments(createAdminClient(), profile.empresa_id, data.items, data.offers);
  if (data.rfq.purpose === "PROCUREMENT") {
    return <AdministrativeRfqDetail params={Promise.resolve({ id })} canonical={data} analyses={analyses} />;
  }
  const [referenceFiles, supplierFiles, orders] = await Promise.all([
    db.from("attachments").select("id,bucket,path,file_name").eq("rfq_id", id).eq("empresa_id", profile.empresa_id).eq("bucket", "rfq-attachments"),
    data.providers.length ? db.from("attachments").select("id,bucket,path,file_name,rfq_provider_id").eq("empresa_id", profile.empresa_id).in("rfq_provider_id", data.providers.map((p) => p.id)) : Promise.resolve({ data: [], error: null }),
    db.from("authorized_orders").select("id,code,provider_name").eq("rfq_id", id).eq("empresa_id", profile.empresa_id),
  ]);
  for (const result of [referenceFiles, supplierFiles, orders]) {
    if (result.error) throw new Error(result.error.message);
  }
  const origin = await getAppOrigin();
  const { data: vendors, error: vendorError } = await db
    .from("providers")
    .select("*")
    .eq("empresa_id", profile.empresa_id)
    .eq("active", true)
    .order("name");
  if (vendorError) throw new Error(vendorError.message);
  const open = isRfqOpen(data.rfq);
  return (
    <main className="max-w-7xl space-y-5">
      <Link href="/rfqs" className="text-action text-[12px] text-[var(--muted)]">
        ← Volver a Cotizaciones
      </Link>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[17px] font-semibold">{data.rfq.code}</h1>
          <Badge tone={open ? "warn" : "neutral"}>{open ? "Abierta" : "Cerrada"}</Badge>
          <span className="text-[12px] text-[var(--muted)]">{data.rfq.purpose === "PROCUREMENT" ? "Compra" : data.rfq.purpose === "COST_DISCOVERY" ? "Descubrimiento de costos — sin compra" : "Histórico sin propósito definido"}</span>
        </div>
        <p className="text-[13px] text-[var(--muted)]">{data.rfq.product}</p>
        <p className="text-[11px] text-[var(--muted)]">{open ? "Vence" : "Vencimiento"}: {formatDateTime(data.rfq.expires_at)}</p>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
        <div><div className="text-[11px] text-[var(--muted)]">Especificaciones</div>{data.rfq.specifications ?? "—"}</div>
        <div><div className="text-[11px] text-[var(--muted)]">Referencia interna</div>{data.rfq.internal_reference ?? "—"}</div>
        <div><div className="text-[11px] text-[var(--muted)]">Fecha requerida</div>{formatDate(data.rfq.required_date)}</div>
        <div><div className="text-[11px] text-[var(--muted)]">Mostrar cliente al proveedor</div>{data.rfq.mostrar_cliente_al_proveedor ? "Sí" : "No"}</div>
        <div className="sm:col-span-2"><div className="text-[11px] text-[var(--muted)]">Observaciones</div>{data.rfq.observations ?? "—"}</div>
      </div>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">Archivos de referencia</h2>
          <AddAttachmentDialog rfqId={id} trigger={<Button variant="secondary" size="sm">Agregar archivo</Button>} />
        </div>
        {!referenceFiles.data?.length && <p className="text-[13px] text-[var(--muted)]">Sin archivos de referencia.</p>}
        {referenceFiles.data?.map((a) => <div key={a.id}><AttachmentLink bucket={a.bucket} path={a.path} fileName={a.file_name ?? "Adjunto"} /></div>)}
      </section>
      {orders.data?.map((order) => <Link key={order.id} href={`/orders/${order.id}`} className="block rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px]">Orden autorizada → {order.code} · {order.provider_name}</Link>)}
      {open && (
        <InviteDialog
          rfqId={id}
          availableProviders={
            (vendors ?? []).filter(
              (v) => !data.providers.some((p) => p.provider_id === v.id),
            ) as Provider[]
          }
          trigger={<Button>Invitar proveedores</Button>}
        />
      )}
      {["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"].includes(
        data.rfq.status,
      ) && (
        <HumanAction
          label="Cancelar solicitud"
          action={cancelRfq.bind(null, id)}
        />
      )}
      {data.rfq.status !== "AUTORIZADO" && !data.rfq.closed_at && !open && (
        <HumanAction
          label="Reabrir solicitud"
          action={reopenRfq.bind(null, id)}
        />
      )}
      <h2 className="text-[14px] font-semibold">Proveedores invitados</h2>
      {data.providers.map((p) => (
        <div key={p.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2 text-[13px]">
          <strong>{p.providers?.name}</strong>
          <span> · {p.status}</span>
          {magicLinkOpen(p, data.rfq) ? (
            <div className="flex flex-wrap gap-3 items-center">
              <QuoteShareButtons url={`${origin}/cotizar/${p.token}`} providerName={p.providers?.name ?? "Proveedor"} phone={p.providers?.phone ?? null} rfqCode={data.rfq.code} />
              <a className="underline" href={`${origin}/cotizar/${p.token}`} target="_blank" rel="noreferrer">Abrir portal del proveedor</a>
            </div>
          ) : (
            <p>Link vencido o revocado</p>
          )}
          <HumanAction
            label="Revocar link"
            action={revokeMagicLinkAction.bind(null, id, p.id)}
          />
          {open && (
            <HumanAction
              label="Renovar link (invalida el anterior)"
              action={renewMagicLinkAction.bind(null, id, p.id)}
            />
          )}
          {supplierFiles.data?.filter((a) => a.rfq_provider_id === p.id).map((a) => <div key={a.id}><AttachmentLink bucket={a.bucket} path={a.path} fileName={a.file_name ?? "Presupuesto del proveedor"} /></div>)}
          {magicLinkOpen(p, data.rfq) && data.items.length > 0 && <InternalQuoteDialog providerId={p.id} providerName={p.providers?.name ?? "Proveedor"} items={data.items} />}
        </div>
      ))}
      {data.rfq.purpose === "COST_DISCOVERY" && !data.rfq.closed_at ? (
        <HumanAction
          label="Finalizar sin OC"
          confirmation="Confirmo cerrar el descubrimiento de costos sin compra"
          action={closeDiscoveryAction.bind(null, id)}
        />
      ) : data.rfq.closed_at ? (
        <p>
          Descubrimiento cerrado por decisión humana: {formatDateTime(data.rfq.closed_at)}.
          Ninguna OC generada.
        </p>
      ) : null}
      <RfqWorkspace
        rfqId={id}
        purpose={data.rfq.purpose}
        projectId={data.rfq.project_id}
        items={data.items}
        offers={data.offers}
        analyses={analyses}
        allocations={data.allocations}
        canAdopt={profile.role === "admin" || profile.role === "administracion"}
      />
      <details>
        <summary>Historial de versiones ({data.history.length})</summary>
        {data.history.map((v) => (
          <p key={String(v.id)}>
            Versión {String(v.version_number)} · {String(v.budget_number)} ·{" "}
            {String(v.total_price)} {String(v.currency)} ·{" "}
            {formatDateTime(String(v.submitted_at))}
          </p>
        ))}
      </details>
    </main>
  );
}
