// READ tool LEVEL 0 — lectura financiera/tesorería. No contiene mutaciones.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetFinanceOverviewInputSchema = z.object({
  provider_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type GetFinanceOverviewInput = z.infer<typeof GetFinanceOverviewInputSchema>;

export interface GetFinanceOverviewOutput {
  treasury: {
    accounts: Array<{ id: string; name: string; type: string; bank: string | null; currency: string; balance: number; reconciled_balance: number | null; active: boolean }>;
    money_mutations_available_to_rodrigo: false;
  };
  payables: { invoices: Array<Record<string, unknown>>; total_by_currency: Record<string, number> };
  payment_orders: Array<Record<string, unknown>>;
  receivables: { sales_documents: Array<Record<string, unknown>>; total_open_by_currency: Record<string, number> };
}

function sumByCurrency(rows: Array<Record<string, unknown>>, amountField: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const currency = String(row.currency ?? "PYG");
    const amount = Number(row[amountField] ?? 0);
    acc[currency] = (acc[currency] ?? 0) + (Number.isFinite(amount) ? amount : 0);
    return acc;
  }, {});
}

async function handler(
  ctx: AgentToolContext,
  input: GetFinanceOverviewInput,
  deps: { db: SupabaseClient }
): Promise<GetFinanceOverviewOutput> {
  const { db } = deps;
  if (input.provider_id) {
    const { data, error } = await db.from("providers").select("id").eq("id", input.provider_id).eq("empresa_id", ctx.empresaId).maybeSingle();
    if (error) throw new Error(`Error validando proveedor: ${error.message}`);
    if (!data) throw new Error("El proveedor no existe o no pertenece a tu empresa.");
  }
  if (input.client_id) {
    const { data, error } = await db.from("clients").select("id").eq("id", input.client_id).eq("empresa_id", ctx.empresaId).maybeSingle();
    if (error) throw new Error(`Error validando cliente: ${error.message}`);
    if (!data) throw new Error("El cliente no existe o no pertenece a tu empresa.");
  }

  const accountsQuery = db.from("cuentas_financieras").select("id, nombre, tipo, banco, moneda, saldo, saldo_conciliado, activo").eq("empresa_id", ctx.empresaId).order("nombre").limit(input.limit);
  const [{ data: accounts, error: accountsError }, { data: invoiceRows, error: invoiceError }, { data: salesRows, error: salesError }] = await Promise.all([
    accountsQuery,
    (() => {
      let query = db.from("invoices").select("id, provider_id, invoice_number, invoice_date, total, currency, status, due_date").eq("empresa_id", ctx.empresaId).order("invoice_date", { ascending: false }).limit(input.limit);
      if (input.provider_id) query = query.eq("provider_id", input.provider_id);
      return query;
    })(),
    (() => {
      let query = db.from("sales_documents").select("id, client_id, code, doc_type, issue_date, due_date, currency, total, cobrado_amount, status").eq("empresa_id", ctx.empresaId).order("issue_date", { ascending: false }).limit(input.limit);
      if (input.client_id) query = query.eq("client_id", input.client_id);
      return query;
    })(),
  ]);
  if (accountsError) throw new Error(`Error leyendo cuentas financieras: ${accountsError.message}`);
  if (invoiceError) throw new Error(`Error leyendo cuentas a pagar: ${invoiceError.message}`);
  if (salesError) throw new Error(`Error leyendo cuentas a cobrar: ${salesError.message}`);

  const invoices: Array<Record<string, unknown>> = ((invoiceRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    open_amount: row.status === "PAGADO" ? 0 : Number(row.total ?? 0),
  }));
  const salesDocuments: Array<Record<string, unknown>> = ((salesRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    open_amount: Math.max(0, Number(row.total ?? 0) - Number(row.cobrado_amount ?? 0)),
  }));

  const invoiceIds = invoices.map((row) => String(row.id));
  const { data: links, error: linkError } = invoiceIds.length
    ? await db.from("payment_order_invoices").select("payment_order_id, invoice_id").eq("empresa_id", ctx.empresaId).in("invoice_id", invoiceIds)
    : { data: [], error: null };
  if (linkError) throw new Error(`Error leyendo órdenes de pago: ${linkError.message}`);
  const paymentOrderIds = ((links ?? []) as Array<Record<string, unknown>>).map((row) => String(row.payment_order_id));
  const { data: paymentOrders, error: paymentError } = paymentOrderIds.length
    ? await db.from("payment_orders").select("id, code, provider_id, status, notes, created_at, executed_at").eq("empresa_id", ctx.empresaId).in("id", paymentOrderIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (paymentError) throw new Error(`Error leyendo órdenes de pago: ${paymentError.message}`);

  return {
    treasury: {
      accounts: ((accounts ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), name: String(row.nombre), type: String(row.tipo), bank: row.banco ? String(row.banco) : null,
        currency: String(row.moneda), balance: Number(row.saldo ?? 0), reconciled_balance: row.saldo_conciliado == null ? null : Number(row.saldo_conciliado), active: Boolean(row.activo),
      })),
      money_mutations_available_to_rodrigo: false,
    },
    payables: { invoices, total_by_currency: sumByCurrency(invoices, "open_amount") },
    payment_orders: (paymentOrders ?? []) as Array<Record<string, unknown>>,
    receivables: { sales_documents: salesDocuments, total_open_by_currency: sumByCurrency(salesDocuments, "open_amount") },
  };
}

registerTool<GetFinanceOverviewInput, GetFinanceOverviewOutput>({
  name: "get_finance_overview",
  description:
    "Lee tesorería, saldos de cuentas, cuentas a pagar, órdenes de pago existentes y cuentas a cobrar. Es estrictamente lectura: Rodrigo nunca puede crear pagos, cobros, transferencias, conciliaciones ni movimientos de dinero.",
  inputSchema: GetFinanceOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const getFinanceOverviewTool = { handler, inputSchema: GetFinanceOverviewInputSchema };
