import type { createClient } from "@/lib/supabase/server";
import type {
  Client,
  SalesDocument,
  SalesDocumentItem,
  SalesDocType,
  SalesQuotationAcceptance,
  WorkOrder,
  WorkOrderItem,
} from "@/lib/types";

type SalesSupabase = Awaited<ReturnType<typeof createClient>>;

export type SalesSourceItem = Pick<
  SalesDocumentItem | WorkOrderItem,
  "description" | "quantity" | "unit_price" | "vat_rate"
>;

export type PostOtSnapshot = {
  workOrder: WorkOrder;
  quotation: SalesDocument;
  acceptance: SalesQuotationAcceptance;
  client: Client;
  items: WorkOrderItem[];
};

export type SalesDocumentSource = {
  sourceDocument: SalesDocument;
  workOrder: WorkOrder | null;
  acceptance: SalesQuotationAcceptance | null;
  client: Client;
  items: SalesSourceItem[];
};

export function acceptedWorkOrderSnapshotMatches(input: {
  workOrder: Pick<
    WorkOrder,
    "id" | "empresa_id" | "sales_document_id" | "client_id" | "currency" | "subtotal" | "vat_amount" | "total"
  >;
  quotation: Pick<
    SalesDocument,
    | "id"
    | "empresa_id"
    | "client_id"
    | "currency"
    | "subtotal"
    | "vat_amount"
    | "total"
    | "doc_type"
    | "acceptance_status"
    | "quotation_version"
  >;
  acceptance: Pick<
    SalesQuotationAcceptance,
    | "empresa_id"
    | "sales_document_id"
    | "client_id"
    | "currency_snapshot"
    | "quotation_version"
    | "work_order_id"
    | "subtotal_snapshot"
    | "vat_snapshot"
    | "total_snapshot"
  > | null;
}): boolean {
  const { workOrder, quotation, acceptance } = input;
  return Boolean(
    acceptance &&
      quotation.doc_type === "PROFORMA" &&
      quotation.acceptance_status === "ACCEPTED" &&
      quotation.id === workOrder.sales_document_id &&
      quotation.empresa_id === workOrder.empresa_id &&
      quotation.client_id === workOrder.client_id &&
      quotation.currency === workOrder.currency &&
      acceptance.empresa_id === workOrder.empresa_id &&
      acceptance.sales_document_id === quotation.id &&
      acceptance.client_id === workOrder.client_id &&
      acceptance.currency_snapshot === workOrder.currency &&
      acceptance.subtotal_snapshot === quotation.subtotal &&
      acceptance.vat_snapshot === quotation.vat_amount &&
      acceptance.total_snapshot === quotation.total &&
      acceptance.subtotal_snapshot === workOrder.subtotal &&
      acceptance.vat_snapshot === workOrder.vat_amount &&
      acceptance.total_snapshot === workOrder.total &&
      acceptance.quotation_version === quotation.quotation_version &&
      acceptance.work_order_id === workOrder.id
  );
}

export function acceptedWorkOrderItemsMatch(
  snapshot: SalesQuotationAcceptance["items_snapshot"],
  items: WorkOrderItem[]
): boolean {
  const normalize = (rows: typeof snapshot) =>
    rows
      .map((item) =>
        JSON.stringify([
          item.description,
          item.quantity,
          item.unit_price,
          item.vat_rate,
          item.line_total,
        ])
      )
      .sort();
  return JSON.stringify(normalize(snapshot)) ===
    JSON.stringify(normalize(items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      line_total: item.line_total,
    }))));
}

export function canLinkSalesDocument(sourceType: SalesDocType, targetType: SalesDocType): boolean {
  if (targetType === "REMISION") return sourceType === "PROFORMA";
  if (targetType === "FACTURA") return sourceType === "PROFORMA" || sourceType === "REMISION";
  if (targetType === "NOTA_CREDITO") return sourceType === "FACTURA";
  return false;
}

/**
 * Returns factual descendants only. It follows source_document_id links and
 * deliberately does not infer provenance from names, amounts, dates, or notes.
 */
export function salesDocumentsInSourceChain<T extends Pick<SalesDocument, "id" | "source_document_id">>(
  rootDocumentId: string,
  documents: T[]
): T[] {
  const bySource = new Map<string, T[]>();
  for (const document of documents) {
    if (!document.source_document_id || document.id === rootDocumentId) continue;
    const children = bySource.get(document.source_document_id) ?? [];
    children.push(document);
    bySource.set(document.source_document_id, children);
  }

  const found: T[] = [];
  const visited = new Set<string>([rootDocumentId]);
  let frontier = [rootDocumentId];
  while (frontier.length) {
    const next: string[] = [];
    for (const parentId of frontier) {
      for (const child of bySource.get(parentId) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        found.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return found;
}

export async function loadPostOtSnapshot(
  supabase: SalesSupabase,
  workOrderId: string,
  empresaId: string
): Promise<PostOtSnapshot | null> {
  const { data: workOrder } = await supabase
    .from("work_orders")
    .select("*")
    .eq("id", workOrderId)
    .eq("empresa_id", empresaId)
    .maybeSingle<WorkOrder>();
  if (!workOrder) return null;

  const [{ data: quotation }, { data: acceptance }, { data: client }, { data: items }] = await Promise.all([
    supabase
      .from("sales_documents")
      .select("*")
      .eq("id", workOrder.sales_document_id)
      .eq("empresa_id", empresaId)
      .maybeSingle<SalesDocument>(),
    supabase
      .from("sales_quotation_acceptances")
      .select("*")
      .eq("sales_document_id", workOrder.sales_document_id)
      .eq("work_order_id", workOrder.id)
      .eq("empresa_id", empresaId)
      .maybeSingle<SalesQuotationAcceptance>(),
    supabase
      .from("clients")
      .select("*")
      .eq("id", workOrder.client_id)
      .eq("empresa_id", empresaId)
      .maybeSingle<Client>(),
    supabase
      .from("work_order_items")
      .select("*")
      .eq("work_order_id", workOrder.id)
      .eq("empresa_id", empresaId)
      .order("created_at")
      .returns<WorkOrderItem[]>(),
  ]);

  if (!quotation || !acceptance || !client || !items?.length) return null;
  if (!acceptedWorkOrderSnapshotMatches({ workOrder, quotation, acceptance })) return null;
  if (!acceptedWorkOrderItemsMatch(acceptance.items_snapshot, items)) return null;
  return { workOrder, quotation, acceptance, client, items };
}

export async function loadPostOtSnapshotForQuotation(
  supabase: SalesSupabase,
  quotationId: string,
  empresaId: string
): Promise<PostOtSnapshot | null> {
  const { data: workOrder } = await supabase
    .from("work_orders")
    .select("id")
    .eq("sales_document_id", quotationId)
    .eq("empresa_id", empresaId)
    .maybeSingle<Pick<WorkOrder, "id">>();
  return workOrder ? loadPostOtSnapshot(supabase, workOrder.id, empresaId) : null;
}

export async function loadSalesDocumentSource(
  supabase: SalesSupabase,
  input: {
    empresaId: string;
    targetType: SalesDocType;
    workOrderId?: string;
    sourceDocumentId?: string;
  }
): Promise<SalesDocumentSource | null> {
  if (input.workOrderId && input.sourceDocumentId) return null;
  if (input.workOrderId) {
    const snapshot = await loadPostOtSnapshot(supabase, input.workOrderId, input.empresaId);
    if (!snapshot || snapshot.quotation.status === "ANULADA" || !canLinkSalesDocument("PROFORMA", input.targetType)) return null;
    return {
      sourceDocument: snapshot.quotation,
      workOrder: snapshot.workOrder,
      acceptance: snapshot.acceptance,
      client: snapshot.client,
      items: snapshot.items,
    };
  }

  if (!input.sourceDocumentId) return null;
  const { data: sourceDocument } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", input.sourceDocumentId)
    .eq("empresa_id", input.empresaId)
    .maybeSingle<SalesDocument>();
  if (
    !sourceDocument ||
    sourceDocument.status === "ANULADA" ||
    !canLinkSalesDocument(sourceDocument.doc_type, input.targetType)
  ) {
    return null;
  }

  if (sourceDocument.doc_type === "PROFORMA") {
    const snapshot = await loadPostOtSnapshotForQuotation(supabase, sourceDocument.id, input.empresaId);
    if (!snapshot || snapshot.quotation.status === "ANULADA") return null;
    return {
      sourceDocument: snapshot.quotation,
      workOrder: snapshot.workOrder,
      acceptance: snapshot.acceptance,
      client: snapshot.client,
      items: snapshot.items,
    };
  }

  const [{ data: client }, { data: items }] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .eq("id", sourceDocument.client_id)
      .eq("empresa_id", input.empresaId)
      .maybeSingle<Client>(),
    supabase
      .from("sales_document_items")
      .select("*")
      .eq("sales_document_id", sourceDocument.id)
      .eq("empresa_id", input.empresaId)
      .order("created_at")
      .returns<SalesDocumentItem[]>(),
  ]);
  if (!client || !items?.length) return null;
  return { sourceDocument, workOrder: null, acceptance: null, client, items };
}

export async function loadSalesDocumentDescendants(
  supabase: SalesSupabase,
  rootDocumentId: string,
  empresaId: string
): Promise<{ documents: SalesDocument[]; error: string | null }> {
  const found: SalesDocument[] = [];
  const visited = new Set<string>([rootDocumentId]);
  let frontier = [rootDocumentId];

  while (frontier.length) {
    const { data, error } = await supabase
      .from("sales_documents")
      .select("*")
      .eq("empresa_id", empresaId)
      .in("source_document_id", frontier)
      .order("issue_date", { ascending: false })
      .returns<SalesDocument[]>();
    if (error) return { documents: [], error: error.message };

    const next: string[] = [];
    for (const document of data ?? []) {
      if (visited.has(document.id)) continue;
      visited.add(document.id);
      found.push(document);
      next.push(document.id);
    }
    frontier = next;
  }

  return { documents: found, error: null };
}

/** Re-read the complete factual chain at issuance; never infer a missing link. */
export async function validateSalesEmission(
  supabase: SalesSupabase,
  document: Pick<SalesDocument, "id" | "empresa_id" | "client_id" | "currency" | "doc_type" | "source_document_id">,
  empresaId: string
): Promise<{ error: string | null }> {
  if (document.empresa_id !== empresaId) return { error: "Documento de otra empresa." };
  let child = document;
  const visited = new Set<string>([child.id]);
  while (child.source_document_id) {
    if (visited.has(child.source_document_id)) return { error: "Cadena de origen circular." };
    visited.add(child.source_document_id);
    const { data: source, error } = await supabase.from("sales_documents").select("*")
      .eq("id", child.source_document_id).eq("empresa_id", empresaId).maybeSingle<SalesDocument>();
    if (error || !source || source.empresa_id !== empresaId) return { error: "No se puede emitir: falta el documento de origen de esta empresa." };
    if (source.status === "ANULADA") return { error: "No se puede emitir: el origen esta anulado." };
    if (!canLinkSalesDocument(source.doc_type, child.doc_type) || source.client_id !== child.client_id || source.currency !== child.currency) {
      return { error: "No se puede emitir: tipo, cliente o moneda incompatibles con el origen." };
    }
    if (child.doc_type === "NOTA_CREDITO" && !["EMITIDA", "COBRADA_PARCIAL", "COBRADA"].includes(source.status)) {
      return { error: "La nota de credito requiere una factura emitida." };
    }
    if (source.doc_type === "PROFORMA") {
      if (!await loadPostOtSnapshotForQuotation(supabase, source.id, empresaId)) {
        return { error: "No se puede emitir: la version aceptada, OT o snapshot de la proforma no es valido." };
      }
      return { error: null };
    }
    child = source;
  }
  // Standalone/manual documents remain supported. Linked remisiones must trace to an accepted quote.
  if (document.source_document_id && child.doc_type === "REMISION") {
    return { error: "No se puede emitir: la remision de origen no tiene una proforma aceptada y OT." };
  }
  return { error: null };
}
