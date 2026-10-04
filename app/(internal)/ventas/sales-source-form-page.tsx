import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";
import { loadSalesDocumentSource } from "@/lib/sales-post-ot";
import { formatMoney } from "@/lib/format";
import { SalesForm } from "./sales-form";
import { createSalesDocument } from "./actions";

type SearchParams = {
  client?: string | string[];
  from?: string | string[];
  workOrder?: string | string[];
};

const FORM_TITLE: Record<"REMISION" | "FACTURA", string> = {
  REMISION: "Nueva remisión",
  FACTURA: "Nueva factura de venta",
};

const BASE_PATH: Record<"REMISION" | "FACTURA", string> = {
  REMISION: "/remisiones",
  FACTURA: "/facturas-venta",
};

function one(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function SalesSourceFormPage({
  targetType,
  searchParams,
}: {
  targetType: "REMISION" | "FACTURA";
  searchParams: SearchParams;
}) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const fromId = one(searchParams.from);
  const workOrderId = one(searchParams.workOrder);
  const clientId = one(searchParams.client);

  if ((searchParams.from && !fromId) || (searchParams.workOrder && !workOrderId) || (fromId && workOrderId)) {
    notFound();
  }

  const [source, { data: activeClients }] = await Promise.all([
    fromId || workOrderId
      ? loadSalesDocumentSource(supabase, {
          empresaId: profile.empresa_id,
          targetType,
          sourceDocumentId: fromId ?? undefined,
          workOrderId: workOrderId ?? undefined,
        })
      : Promise.resolve(null),
    supabase
      .from("clients")
      .select("id, name")
      .eq("empresa_id", profile.empresa_id)
      .eq("active", true)
      .order("name")
      .returns<Pick<Client, "id" | "name">[]>(),
  ]);

  if ((fromId || workOrderId) && !source) notFound();

  const clients = new Map((activeClients ?? []).map((client) => [client.id, client]));
  if (source) clients.set(source.client.id, { id: source.client.id, name: source.client.name });
  const clientOptions = [...clients.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sourceDocument = source?.sourceDocument;
  const workOrder = source?.workOrder;
  const fixedClientName = source?.acceptance?.client_name_snapshot ?? source?.client.name;
  const backHref = workOrder ? `/ordenes-trabajo/${workOrder.id}` : sourceDocument ? `/ventas/${sourceDocument.id}` : BASE_PATH[targetType];
  const defaultNotes = workOrder && source?.acceptance
    ? `Preparada desde ${workOrder.code}; cotización ${sourceDocument?.code} v${source.acceptance.quotation_version}.`
    : sourceDocument
      ? `Preparada desde ${sourceDocument.code}${sourceDocument.notes ? `\n\n${sourceDocument.notes}` : ""}`
      : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href={backHref} className="text-action text-[12px] text-[var(--muted)]">
          <ArrowLeft size={13} /> {workOrder ? `Volver a ${workOrder.code}` : sourceDocument ? `Volver a ${sourceDocument.code}` : `Volver a ${targetType === "REMISION" ? "Remisiones" : "Facturas de Venta"}`}
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">{FORM_TITLE[targetType]}</h1>
      </div>

      {source ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-[13px] space-y-1">
          {workOrder && source.acceptance ? (
            <>
              <div>
                Preparación desde OT <Link href={`/ordenes-trabajo/${workOrder.id}`} className="text-action font-medium">{workOrder.code}</Link>
                {" · "}cotización aceptada <Link href={`/ventas/${sourceDocument?.id}`} className="text-action">{sourceDocument?.code} v{source.acceptance.quotation_version}</Link>
              </div>
              <div className="text-[12px] text-[var(--muted)]">
                Cliente del registro de aceptación: {source.acceptance.client_name_snapshot}. Valor de la OT: {formatMoney(workOrder.total, workOrder.currency)}.
              </div>
            </>
          ) : sourceDocument ? (
            <div>Preparación desde <Link href={`/ventas/${sourceDocument.id}`} className="text-action font-medium">{sourceDocument.code}</Link>.</div>
          ) : null}
          <p className="text-[12px] text-[var(--muted)]">
            Revisá los datos y guardá para crear un borrador. Esto no emite el documento ni registra cobros.
          </p>
        </div>
      ) : null}

      {clientOptions.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px]">
          Primero cargá un cliente en <Link href="/clientes" className="text-action text-[var(--primary)]">Clientes</Link>.
        </div>
      ) : (
        <SalesForm
          clients={clientOptions}
          defaultClientId={source?.client.id ?? clientId ?? undefined}
          defaultCurrency={source?.sourceDocument.currency}
          defaultDueDate={source?.sourceDocument.due_date}
          defaultNotes={defaultNotes}
          fixedClient={source ? { id: source.client.id, name: fixedClientName ?? source.client.name } : undefined}
          fixedCurrency={source?.sourceDocument.currency}
          items={source?.items}
          fixedDocType={targetType}
          extraHiddenFields={source ? {
            source_document_id: source.sourceDocument.id,
            ...(workOrder ? { work_order_id: workOrder.id } : {}),
          } : undefined}
          action={createSalesDocument}
        />
      )}
    </div>
  );
}
