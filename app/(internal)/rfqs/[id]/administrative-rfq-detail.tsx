import Link from "next/link";
import { getAppOrigin } from "@/lib/app-origin";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { isRfqOpen, canReopenRfq, rfqClosedReason } from "@/lib/rfq-status";
import { magicLinkOpen } from "@/lib/rfq/domain";
import { InviteDialog } from "./invite-dialog";
import { AttachmentLink } from "./attachment-link";
import { QuoteShareButtons } from "./quote-share-buttons";
import { AddAttachmentDialog } from "./add-attachment-dialog";
import { cancelRfq, reopenRfq } from "./actions";
import { InternalQuoteDialog } from "./internal-quote-dialog";
import { PurchasingOffers } from "./purchasing-offers";
import styles from "./procurement-panel.module.css";
import type { loadRfqWorkspace } from "@/lib/rfq/service";
import type { QuoteDocumentAnalysisResult } from "@/lib/rfq/document-analysis";

export async function AdministrativeRfqDetail({ params, canonical, analyses }: {
  params: Promise<{ id: string }>;
  canonical: Awaited<ReturnType<typeof loadRfqWorkspace>>;
  analyses: Record<string, QuoteDocumentAnalysisResult>;
}) {
  const { id } = await params;
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const db = await createClient();
  const rfq = canonical.rfq;
  const [vendors, files, orders, project] = await Promise.all([
    db.from("providers").select("*").eq("empresa_id", profile.empresa_id).eq("active", true).order("name"),
    db.from("attachments").select("id,bucket,path,file_name").eq("empresa_id", profile.empresa_id).eq("rfq_id", id).eq("bucket", "rfq-attachments"),
    db.from("authorized_orders").select("id,code,provider_name,total_price,currency").eq("empresa_id", profile.empresa_id).eq("rfq_id", id).order("created_at"),
    rfq.project_id ? db.from("projects").select("id,name,code").eq("empresa_id", profile.empresa_id).eq("id", rfq.project_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [vendors, files, orders, project]) if (result.error) throw new Error(result.error.message);
  const invited = new Set(canonical.providers.map(p => p.provider_id));
  const appUrl = await getAppOrigin();
  const open = isRfqOpen(rfq);
  const closedReason = rfqClosedReason(rfq);
  const versions = canonical.history.map(v => ({
    id: String(v.id), budgetNumber: String(v.budget_number ?? ""),
    total: Number(v.total_price), invoiceAvailable: v.invoice_available === true,
  }));
  return <div className={`${styles.page} space-y-6`}>
    <header className={styles.heading}>
      <div>
        <Link href="/rfqs" className={styles.back}>← Cotizaciones</Link>
        <div className="flex flex-wrap items-center gap-3 mt-3"><h1>{rfq.code}</h1><Badge tone={open ? "warn" : "neutral"}>{open ? "Abierta" : closedReason || "Cerrada"}</Badge></div>
        <p className={styles.request}>{canonical.items.length === 1
          ? `${formatNumber(canonical.items[0].cantidad, Number.isInteger(canonical.items[0].cantidad) ? 0 : 4)} ${canonical.items[0].unidad} de ${canonical.items[0].descripcion}`
          : `${rfq.product} · ${canonical.items.length} ítems`}</p>
        {open && <p className={styles.muted}>Recibe ofertas hasta {formatDateTime(rfq.expires_at)}</p>}
        <p className="mt-2 text-[13px] font-medium">{project.data
          ? <Link className="text-action" href={`/projects/${project.data.id}?tab=cotizaciones`}>Obra: {project.data.code} · {project.data.name} · Entrega en obra</Link>
          : "Compra sin obra asignada"}</p>
      </div>
      <div className={styles.actions}>
        {open && <InviteDialog rfqId={id} availableProviders={(vendors.data ?? []).filter(v => !invited.has(v.id)) as Provider[]}
          trigger={<Button variant="secondary">Invitar proveedores</Button>} />}
        {canReopenRfq(rfq) && <form action={async () => { "use server"; await reopenRfq(id); }}><Button variant="secondary">Reabrir solicitud</Button></form>}
      </div>
    </header>
    <PurchasingOffers key={id} rfqId={id} items={canonical.items} offers={canonical.offers} analyses={analyses}
      allocations={canonical.allocations} versions={versions} orders={orders.data ?? []} />
    <details className={styles.secondarySection} open={!canonical.offers.length}>
      <summary>Proveedores invitados <span className={styles.muted}>({canonical.providers.length})</span></summary>
      <div className={styles.invitedList}>
        {canonical.providers.map(p => <div key={p.id} className={styles.invitedRow}>
          <div><strong>{p.providers?.name}</strong><p className={styles.muted}>{p.status === "RESPONDIDO" ? "Oferta recibida" : "Esperando respuesta"}</p></div>
          <div className={styles.actions}>{magicLinkOpen(p, rfq) && <>
            <QuoteShareButtons url={`${appUrl}/cotizar/${p.token}`} providerName={p.providers?.name ?? "Proveedor"} phone={p.providers?.phone ?? null} rfqCode={rfq.code} />
            <InternalQuoteDialog providerId={p.id} providerName={p.providers?.name ?? "Proveedor"} items={canonical.items} />
          </>}</div>
        </div>)}
        {!canonical.providers.length && <p className={styles.muted}>Invitá proveedores para recibir sus ofertas.</p>}
      </div>
    </details>
    <details className={styles.secondarySection}>
      <summary>Datos y archivos de la solicitud</summary>
      <dl className={`${styles.facts} mt-4`}>
        <div><dt>Especificaciones</dt><dd>{rfq.specifications || "—"}</dd></div>
        <div><dt>Fecha requerida</dt><dd>{formatDate(rfq.required_date)}</dd></div>
        <div><dt>Referencia</dt><dd>{rfq.internal_reference || "—"}</dd></div>
        <div><dt>Observaciones</dt><dd>{rfq.observations || "—"}</dd></div>
      </dl>
      <div className={`${styles.actions} mt-4`}>
        {files.data?.map(a => <AttachmentLink key={a.id} bucket={a.bucket} path={a.path} fileName={a.file_name || "Archivo de referencia"} />)}
        <AddAttachmentDialog rfqId={id} trigger={<Button variant="secondary" size="sm">Agregar archivo</Button>} />
      </div>
      {["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"].includes(rfq.status) && <form className="mt-5" action={async () => { "use server"; await cancelRfq(id); }}><Button variant="danger" size="sm">Cancelar solicitud</Button></form>}
    </details>
  </div>;
}
