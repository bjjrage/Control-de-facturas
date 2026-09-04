import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Provider } from "@/lib/types";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { SelectionForm } from "./selection-form";

type SearchParams = { provider?: string };

export default async function NuevaOpPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { provider: providerId } = await searchParams;

  const { data: providers } = await supabase
    .from("providers")
    .select("id, name")
    .eq("active", true)
    .order("name")
    .returns<Pick<Provider, "id" | "name">[]>();

  // Invoices already in a payment_order (can't be used again)
  const { data: usedLinks } = await supabase
    .from("payment_order_invoices")
    .select("invoice_id");
  const usedIds = new Set((usedLinks ?? []).map((r) => r.invoice_id as string));

  let invoices: {
    id: string;
    invoice_number: string;
    invoice_date: string;
    total: number;
    currency: string;
    oc_code: string | null;
  }[] = [];

  if (providerId) {
    // Facturas APTO_PARA_PAGO del proveedor no incluidas en ninguna OP
    const { data: rawInvoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, total, currency")
      .eq("provider_id", providerId)
      .eq("status", "APTO_PARA_PAGO")
      .order("invoice_date", { ascending: false });

    const eligible = (rawInvoices ?? []).filter((i) => !usedIds.has(i.id as string));

    if (eligible.length > 0) {
      const eligibleIds = eligible.map((i) => i.id as string);
      const { data: matches } = await supabase
        .from("invoice_order_matches")
        .select("invoice_id, authorized_orders(code)")
        .in("invoice_id", eligibleIds);

      const ocByInvoice = new Map<string, string>();
      for (const m of matches ?? []) {
        const raw = m.authorized_orders;
        const order = (Array.isArray(raw) ? raw[0] : raw) as { code: string } | null | undefined;
        if (order) ocByInvoice.set(m.invoice_id as string, order.code);
      }

      invoices = eligible.map((i) => ({
        id: i.id as string,
        invoice_number: i.invoice_number as string,
        invoice_date: i.invoice_date as string,
        total: i.total as number,
        currency: i.currency as string,
        oc_code: ocByInvoice.get(i.id as string) ?? null,
      }));
    }
  }

  const selectedProvider = (providers ?? []).find((p) => p.id === providerId);

  return (
    <div className="max-w-3xl space-y-5">
      <BackButton />
      <h1 className="text-[17px] font-semibold mt-1">Nueva Orden de Pago</h1>

      <form method="get" className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="provider">Proveedor</Label>
            <Select id="provider" name="provider" defaultValue={providerId ?? ""} className="w-full">
              <option value="">Seleccionar proveedor…</option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">Ver facturas</Button>
        </div>
      </form>

      {providerId && selectedProvider ? (
        invoices.length > 0 ? (
          <div className="space-y-3">
            <div className="text-[13px] text-[var(--muted)]">
              Facturas aptas para pago de <span className="font-medium text-[var(--foreground)]">{selectedProvider.name}</span>
            </div>
            <SelectionForm invoices={invoices} providerId={providerId} />
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-10 text-center text-[13px] text-[var(--muted)]">
            No hay facturas aptas para pago de {selectedProvider.name} sin OP asignada.
          </div>
        )
      ) : null}
    </div>
  );
}
