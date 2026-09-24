import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryMovementInput } from "./types";

type ServiceResult<T> = { data: T | null; error: string | null };

export interface CreateInventoryReceiptInput {
  empresaId: string;
  orderId: string;
  fecha: string;
  recibidoPor: string;
  deliveryLocationId?: string | null;
  remisionNumber?: string | null;
  idempotencyKey: string;
  createdBy: string;
  notes?: string | null;
  items: Array<{
    orderItemId: string;
    productoId?: string | null;
    quantity: number;
    notes?: string | null;
  }>;
}

export interface CreateInventoryReceiptResult {
  receiptId: string;
  created: boolean;
}

function rpcPayload(input: InventoryMovementInput) {
  return {
    p_empresa_id: input.empresaId,
    p_producto_id: input.productoId,
    p_quantity: input.quantity,
    p_unit: input.unit,
    p_movement_type: input.movementType,
    p_from_location_id: input.fromLocationId ?? null,
    p_to_location_id: input.toLocationId ?? null,
    p_project_id: input.projectId ?? null,
    p_budget_item_id: input.budgetItemId ?? null,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId ?? null,
    p_source_line_id: input.sourceLineId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_cost_currency: input.costCurrency ?? null,
    p_unit_cost: input.unitCost ?? null,
    p_exchange_rate_to_company: input.exchangeRateToCompany ?? null,
    p_created_by: input.createdBy ?? null,
    p_metadata: input.metadata ?? {},
  };
}

export async function postInventoryMovement(
  supabase: SupabaseClient,
  input: InventoryMovementInput
): Promise<ServiceResult<string>> {
  const { data, error } = await supabase.rpc("inventory_post_movement", rpcPayload(input));
  return { data: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function createInventoryReceipt(
  supabase: SupabaseClient,
  args: CreateInventoryReceiptInput
): Promise<ServiceResult<CreateInventoryReceiptResult>> {
  const { data, error } = await supabase.rpc("inventory_create_receipt", {
    p_empresa_id: args.empresaId,
    p_order_id: args.orderId,
    p_fecha: args.fecha,
    p_recibido_por: args.recibidoPor,
    p_delivery_location_id: args.deliveryLocationId ?? null,
    p_remision_number: args.remisionNumber ?? null,
    p_idempotency_key: args.idempotencyKey,
    p_created_by: args.createdBy,
    p_notes: args.notes ?? null,
    p_items: args.items.map((item) => ({
      order_item_id: item.orderItemId,
      producto_id: item.productoId ?? null,
      cantidad_recibida: item.quantity,
      notas: item.notes ?? null,
    })),
  });
  const result = data as { receipt_id?: string; created?: boolean } | null;
  return {
    data: result?.receipt_id
      ? { receiptId: result.receipt_id, created: result.created === true }
      : null,
    error: error?.message ?? null,
  };
}

export async function confirmInventoryReceipt(
  supabase: SupabaseClient,
  args: {
    empresaId: string;
    receiptId: string;
    deliveryLocationId?: string | null;
    idempotencyKey?: string | null;
    confirmedBy: string;
  }
): Promise<ServiceResult<string[]>> {
  const { data, error } = await supabase.rpc("inventory_confirm_receipt", {
    p_empresa_id: args.empresaId,
    p_receipt_id: args.receiptId,
    p_delivery_location_id: args.deliveryLocationId ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
    p_confirmed_by: args.confirmedBy,
  });
  return { data: (data as string[] | null) ?? null, error: error?.message ?? null };
}

export async function saveWarehouseSubmissionLinesAtomic(
  supabase: SupabaseClient,
  args: {
    empresaId: string;
    submissionId: string;
    evidenceId: string;
    lines: Array<{
      rawDescription: string;
      quantity?: number | null;
      unit?: string | null;
      confidence?: number | null;
      uncertaintyReason?: string | null;
      notes?: string | null;
    }>;
  }
): Promise<ServiceResult<{ inserted_count: number; next_line_number: number }>> {
  const { data, error } = await supabase.rpc("inventory_save_submission_lines_atomic", {
    p_empresa_id: args.empresaId,
    p_submission_id: args.submissionId,
    p_evidence_id: args.evidenceId,
    p_lines: args.lines,
  });
  return {
    data: (data as { inserted_count: number; next_line_number: number } | null) ?? null,
    error: error?.message ?? null,
  };
}

export async function confirmWarehouseSubmission(
  supabase: SupabaseClient,
  args: {
    empresaId: string;
    submissionId: string;
    confirmedBy: string;
    idempotencyKey?: string | null;
  }
): Promise<ServiceResult<string[]>> {
  const { data, error } = await supabase.rpc("inventory_confirm_warehouse_submission", {
    p_empresa_id: args.empresaId,
    p_submission_id: args.submissionId,
    p_confirmed_by: args.confirmedBy,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  return { data: (data as string[] | null) ?? null, error: error?.message ?? null };
}

export async function getCanonicalInventorySnapshot(
  supabase: SupabaseClient,
  empresaId: string,
  productoId?: string
) {
  let globalQuery = supabase
    .from("inventory_stock_global_quantity")
    .select("empresa_id, producto_id, producto, unidad, quantity")
    .eq("empresa_id", empresaId);
  let locationsQuery = supabase
    .from("inventory_stock_by_location")
    .select(
      "empresa_id, location_id, location_name, location_type, project_id, producto_id, producto, unidad, cost_currency, quantity, total_cost, cost_status, original_cost_currency, original_unit_cost, original_total_cost, exchange_rate_to_company, cost_source"
    )
    .eq("empresa_id", empresaId);
  if (productoId) {
    globalQuery = globalQuery.eq("producto_id", productoId);
    locationsQuery = locationsQuery.eq("producto_id", productoId);
  }
  const [{ data: global, error: globalError }, { data: locations, error: locationsError }] = await Promise.all([
    globalQuery,
    locationsQuery,
  ]);
  return {
    global: global ?? [],
    locations: locations ?? [],
    error: globalError?.message ?? locationsError?.message ?? null,
  };
}

export async function getProjectInventorySnapshot(
  supabase: SupabaseClient,
  empresaId: string,
  projectId: string,
  productoId?: string
) {
  let query = supabase
    .from("inventory_stock_by_project")
    .select("empresa_id, project_id, producto_id, producto, unidad, cost_currency, cost_status, quantity, total_cost")
    .eq("empresa_id", empresaId)
    .eq("project_id", projectId);
  if (productoId) query = query.eq("producto_id", productoId);
  const { data, error } = await query;
  return { data: data ?? [], error: error?.message ?? null };
}

export async function getBudgetInventoryConsumption(
  supabase: SupabaseClient,
  empresaId: string,
  args: { projectId?: string; budgetItemId?: string; productoId?: string } = {}
) {
  let query = supabase
    .from("inventory_consumption_by_budget")
    .select(
      "empresa_id, project_id, budget_item_id, producto_id, producto, unidad, quantity_consumed, cost_currency, cost_consumed, cost_consumed_company"
    )
    .eq("empresa_id", empresaId);
  if (args.projectId) query = query.eq("project_id", args.projectId);
  if (args.budgetItemId) query = query.eq("budget_item_id", args.budgetItemId);
  if (args.productoId) query = query.eq("producto_id", args.productoId);
  const { data, error } = await query;
  return { data: data ?? [], error: error?.message ?? null };
}
