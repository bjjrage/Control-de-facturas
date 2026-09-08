import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, SalesDocumentItem } from "@/lib/types";
import { SalesForm } from "../sales-form";
import { createSalesDocument } from "../actions";

export default async function NuevaNCPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { from } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .eq("active", true)
    .order("name")
    .returns<Pick<Client, "id" | "name">[]>();

  // Si viene ?from=<facturaId>, pre-cargamos cliente e ítems
  let sourceDoc: SalesDocument | null = null;
  let sourceItems: SalesDocumentItem[] = [];

  if (from) {
    const [{ data: doc }, { data: items }] = await Promise.all([
      supabase
        .from("sales_documents")
        .select("*")
        .eq("id", from)
        .single<SalesDocument>(),
      supabase
        .from("sales_document_items")
        .select("*")
        .eq("sales_document_id", from)
        .order("created_at")
        .returns<SalesDocumentItem[]>(),
    ]);
    sourceDoc  = doc ?? null;
    sourceItems = items ?? [];
  }

  // Acción con source_document_id inyectado via hidden input en SalesForm
  async function action(formData: FormData) {
    "use server";
    return createSalesDocument(formData);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link
          href={sourceDoc ? `/ventas/${sourceDoc.id}` : "/ventas"}
          className="text-action text-[12px] text-[var(--muted)]"
        >
          <ArrowLeft size={13} />{" "}
          {sourceDoc ? `Volver a ${sourceDoc.code}` : "Volver a Ventas"}
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Nueva Nota de Crédito</h1>
        {sourceDoc && (
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            Generada desde{" "}
            <Link href={`/ventas/${sourceDoc.id}`} className="text-action">
              {sourceDoc.code}
            </Link>
            . Ajustá los ítems y montos que querés acreditar.
          </p>
        )}
      </div>

      {(clients ?? []).length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px]">
          Primero cargá un cliente en{" "}
          <Link href="/clientes" className="text-action text-[var(--primary)]">
            Clientes
          </Link>
          .
        </div>
      ) : (
        <SalesForm
          clients={clients ?? []}
          defaultClientId={sourceDoc?.client_id}
          doc={
            sourceDoc
              ? {
                  ...sourceDoc,
                  doc_type: "NOTA_CREDITO",
                  notes: `NC de ${sourceDoc.code}${sourceDoc.notes ? `\n${sourceDoc.notes}` : ""}`,
                }
              : undefined
          }
          items={sourceItems}
          action={action}
          fixedDocType="NOTA_CREDITO"
          extraHiddenFields={sourceDoc ? { source_document_id: sourceDoc.id } : undefined}
        />
      )}
    </div>
  );
}
