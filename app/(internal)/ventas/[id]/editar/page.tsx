import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, SalesDocumentItem } from "@/lib/types";
import { SalesForm } from "../../sales-form";
import { updateSalesDocument } from "../../actions";

export default async function EditarVentaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase.from("sales_documents").select("*").eq("id", id).single<SalesDocument>();
  if (!doc) notFound();
  if (doc.status !== "BORRADOR") redirect(`/ventas/${id}`);

  const [{ data: clients }, { data: items }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name").returns<Pick<Client, "id" | "name">[]>(),
    supabase.from("sales_document_items").select("*").eq("sales_document_id", id).order("created_at").returns<SalesDocumentItem[]>(),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href={`/ventas/${id}`} className="inline-flex items-center gap-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeft size={13} /> Volver al documento
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Editar {doc.code}</h1>
      </div>
      <SalesForm
        clients={clients ?? []}
        doc={doc}
        items={items ?? []}
        action={updateSalesDocument.bind(null, id)}
      />
    </div>
  );
}
