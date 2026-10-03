import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/app-origin";
import { loadRfqWorkspace } from "@/lib/rfq/service";
import { magicLinkOpen } from "@/lib/rfq/domain";
import type { Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { InviteDialog } from "./invite-dialog";
import { RfqWorkspace } from "./rfq-workspace";
import { HumanAction } from "./human-action";
import { cancelRfq, reopenRfq } from "./actions";
import {
  revokeMagicLinkAction,
  renewMagicLinkAction,
  closeDiscoveryAction,
} from "./workflow-actions";
import { MultiItemQuoteForm } from "@/app/cotizar/[token]/multi-item-quote-form";
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
  const origin = await getAppOrigin();
  const { data: vendors, error: vendorError } = await db
    .from("providers")
    .select("*")
    .eq("empresa_id", profile.empresa_id)
    .eq("active", true)
    .order("name");
  if (vendorError) throw new Error(vendorError.message);
  const open =
    ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"].includes(data.rfq.status) &&
    Date.parse(data.rfq.expires_at) > Date.now();
  return (
    <main className="max-w-7xl space-y-5">
      <Link href="/rfqs" className="underline">
        Volver a solicitudes
      </Link>
      <h1 className="text-xl font-semibold">
        {data.rfq.code} — {data.rfq.product}
      </h1>
      <p>
        Propósito: {data.rfq.purpose ?? "Histórico sin definir"} · Estado:{" "}
        {data.rfq.status} · Vence: {data.rfq.expires_at}
      </p>
      <p>{data.rfq.specifications}</p>
      <p>
        El sistema propone. El humano asigna, autoriza y confirma la compra.
      </p>
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
      <h2 className="font-semibold">Proveedores y links individuales</h2>
      {data.providers.map((p) => (
        <div key={p.id} className="border rounded p-3 space-y-2">
          <strong>{p.providers?.name}</strong>
          <span> · {p.status}</span>
          {magicLinkOpen(p, data.rfq) ? (
            <a
              className="block underline break-all"
              href={`${origin}/cotizar/${p.token}`}
              target="_blank"
              rel="noreferrer"
            >
              Link del proveedor
            </a>
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
          {open && !p.token_revoked_at && (
            <details>
              <summary>
                Cargar nueva versión desde documento del proveedor
              </summary>
              <MultiItemQuoteForm token={p.id} items={data.items} internal />
            </details>
          )}
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
          Descubrimiento cerrado por decisión humana: {data.rfq.closed_at}.
          Ninguna OC generada.
        </p>
      ) : null}
      <RfqWorkspace
        rfqId={id}
        purpose={data.rfq.purpose}
        projectId={data.rfq.project_id}
        items={data.items}
        offers={data.offers}
        allocations={data.allocations}
        canAdopt={profile.role === "admin" || profile.role === "administracion"}
      />
      <details>
        <summary>Historial de versiones ({data.history.length})</summary>
        {data.history.map((v) => (
          <p key={String(v.id)}>
            Versión {String(v.version_number)} · {String(v.budget_number)} ·{" "}
            {String(v.total_price)} {String(v.currency)} ·{" "}
            {String(v.submitted_at)} · {String(v.id)}
          </p>
        ))}
      </details>
    </main>
  );
}
