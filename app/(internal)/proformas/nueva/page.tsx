import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";
import { SalesForm } from "@/app/(internal)/ventas/sales-form";
import { createSalesDocument } from "@/app/(internal)/ventas/actions";

export default async function NuevaProformaPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { client } = await searchParams;
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .eq("active", true)
    .order("name")
    .returns<Pick<Client, "id" | "name">[]>();

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/proformas" className="text-action text-[12px] text-[var(--muted)]">
          <ArrowLeft size={13} /> Volver a Proformas
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Nueva proforma</h1>
      </div>
      {(clients ?? []).length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px]">
          Primero cargá un cliente en <Link href="/clientes" className="text-action text-[var(--primary)]">Clientes</Link>.
        </div>
      ) : (
        <SalesForm clients={clients ?? []} defaultClientId={client} fixedDocType="PROFORMA" action={createSalesDocument} />
      )}
    </div>
  );
}
