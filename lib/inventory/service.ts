import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryMovementInput } from "./types";

type ServiceResult<T> = { data: T | null; error: string | null };

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
    .select("empresa_id, location_id, location_name, location_type, project_id, producto_id, producto, unidad, cost_currency, quantity, total_cost")
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
    .select("empresa_id, project_id, producto_id, producto, unidad, cost_currency, quantity, total_cost")
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
