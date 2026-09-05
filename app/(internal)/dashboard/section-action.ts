"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Rfq } from "@/lib/types";
import { isRfqOpen } from "@/lib/rfq-status";

export type DashboardData = {
  firstName: string;
  role: string;
  moduloCompras: boolean;
  moduloVentas: boolean;
  showRfqStats: boolean;
  showInvoiceStats: boolean;
  showSalesStats: boolean;
  openRfqs: number;
  awaitingSelection: number;
  pending: number;
  review: number;
  apto: number;
  porCobrar: number;
  vencidas: number;
  recentRfqs: Rfq[];
};

export async function getDashboardData(): Promise<DashboardData> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const isAdminOrAdministracion = profile.role === "administracion" || profile.role === "admin";
  const showRfqStats = (profile.role === "comercial" || profile.role === "admin") && profile.modulo_compras;
  const showInvoiceStats = isAdminOrAdministracion && profile.modulo_compras;
  const showSalesStats = isAdminOrAdministracion && profile.modulo_ventas;
  const today = new Date().toISOString().slice(0, 10);
  const noop = Promise.resolve({ data: null, count: null });

  const [
    { data: biddingRfqs },
    { count: awaitingSelection },
    { count: pending },
    { count: review },
    { count: apto },
    { data: recentRfqs },
    { count: porCobrar },
    { count: vencidas },
  ] = await Promise.all([
    showRfqStats
      ? supabase.from("rfqs").select("status, expires_at").in("status", ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"])
      : noop,
    showRfqStats
      ? supabase.from("rfqs").select("id", { count: "exact", head: true }).eq("status", "OFERTAS_RECIBIDAS")
      : noop,
    showInvoiceStats
      ? supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "PENDIENTE")
      : noop,
    showInvoiceStats
      ? supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "REQUIERE_REVISION")
      : noop,
    showInvoiceStats
      ? supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "APTO_PARA_PAGO")
      : noop,
    profile.modulo_compras
      ? supabase.from("rfqs").select("*").order("created_at", { ascending: false }).limit(8).returns<Rfq[]>()
      : noop,
    showSalesStats
      ? supabase.from("sales_documents").select("id", { count: "exact", head: true }).in("status", ["EMITIDA", "COBRADA_PARCIAL"])
      : noop,
    showSalesStats
      ? supabase.from("sales_documents").select("id", { count: "exact", head: true }).in("status", ["EMITIDA", "COBRADA_PARCIAL"]).lt("due_date", today)
      : noop,
  ]);

  return {
    firstName: profile.full_name.split(" ")[0],
    role: profile.role,
    moduloCompras: profile.modulo_compras,
    moduloVentas: profile.modulo_ventas,
    showRfqStats,
    showInvoiceStats,
    showSalesStats,
    openRfqs: showRfqStats ? (biddingRfqs ?? []).filter(isRfqOpen).length : 0,
    awaitingSelection: awaitingSelection ?? 0,
    pending: pending ?? 0,
    review: review ?? 0,
    apto: apto ?? 0,
    porCobrar: porCobrar ?? 0,
    vencidas: vencidas ?? 0,
    recentRfqs: (recentRfqs as Rfq[] | null) ?? [],
  };
}
