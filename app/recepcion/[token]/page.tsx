import { notFound } from "next/navigation";
import { getReceiptPortalContext } from "@/lib/inventory/receipt-portal-data";
import { ReceiptPortalForm } from "./receipt-portal-form";

export const dynamic = "force-dynamic";

export default async function ReceiptPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getReceiptPortalContext(token);
  if (!context) notFound();

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto max-w-xl space-y-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-[11px] text-[var(--muted)]">Recepción de mercadería</p>
          <h1 className="mt-1 text-xl font-semibold">OC {context.order.code}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Proveedor: {context.order.providerName}</p>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Cargá las cantidades recibidas y la evidencia. La empresa revisará el borrador; no afecta el inventario hasta su confirmación.
          </p>
        </section>
        <ReceiptPortalForm token={token} order={context.order} />
      </div>
    </main>
  );
}
