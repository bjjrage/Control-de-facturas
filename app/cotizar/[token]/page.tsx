import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSupplierInvitation } from "@/lib/rfq/offer-submission";
import { MultiItemQuoteForm } from "./multi-item-quote-form";
import { markOpened } from "./actions";
export const dynamic = "force-dynamic";
export default async function CotizarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = createAdminClient();
  let rp;
  try {
    rp = await resolveSupplierInvitation(db, token);
  } catch {
    notFound();
  }
  const { data: items, error } = await db
    .from("rfq_items")
    .select("id,descripcion,cantidad,unidad")
    .eq("rfq_id", rp.rfq_id)
    .eq("empresa_id", rp.empresa_id)
    .order("sort_order");
  if (error) throw new Error(error.message);
  await markOpened(token);
  const { data: attachments } = await db
    .from("attachments")
    .select("id,bucket,path,file_name")
    .eq("rfq_id", rp.rfq_id)
    .eq("empresa_id", rp.empresa_id)
    .eq("bucket", "rfq-attachments");
  const files = await Promise.all(
    (attachments ?? []).map(async (a) => ({
      name: a.file_name,
      url: (await db.storage.from(a.bucket).createSignedUrl(a.path, 120)).data
        ?.signedUrl,
    })),
  );
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-5">
      <h1 className="text-xl font-semibold">
        Solicitud {rp.rfqs.code} — {rp.providers.name}
      </h1>
      <p>{rp.rfqs.product}</p>
      <p>{rp.rfqs.specifications}</p>
      {rp.rfqs.mostrar_cliente_al_proveedor && <p>{rp.rfqs.client_name}</p>}
      <p>
        Link válido hasta {rp.token_expires_at ?? rp.rfqs.expires_at}. Una
        oferta no implica adjudicación ni una orden de compra.
      </p>
      {files.map((f, i) =>
        f.url ? (
          <a
            key={i}
            className="block underline"
            href={f.url}
            target="_blank"
            rel="noreferrer"
          >
            {f.name}
          </a>
        ) : null,
      )}
      {items?.length ? (
        <MultiItemQuoteForm
          token={token}
          items={items.map((i) => ({ ...i, cantidad: Number(i.cantidad) }))}
        />
      ) : (
        <p>
          Solicitud histórica sin ítems estructurados. Contactá al comprador
          para recibir una nueva solicitud.
        </p>
      )}
    </main>
  );
}
