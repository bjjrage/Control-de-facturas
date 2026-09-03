import Link from "next/link";
import { FileText, Tag, AlertCircle, CheckCircle2, LucideIcon } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Rfq } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { isRfqOpen, rfqClosedReason } from "@/lib/rfq-status";

type StatColor = "primary" | "teal" | "purple" | "orange" | "ok";

const STAT_COLOR_CLASSES: Record<StatColor, string> = {
  primary: "bg-[var(--primary-bg)] text-[var(--primary)]",
  teal: "bg-[var(--accent-teal-bg)] text-[var(--accent-teal)]",
  purple: "bg-[var(--accent-purple-bg)] text-[var(--accent-purple)]",
  orange: "bg-[var(--accent-orange-bg)] text-[var(--accent-orange)]",
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
};

function StatCard({
  label,
  value,
  href,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  color: StatColor;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 hover:bg-[var(--hover)] flex items-center gap-3"
    >
      <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${STAT_COLOR_CLASSES[color]}`}>
        <Icon size={19} />
      </div>
      <div>
        <div className="text-[22px] font-semibold leading-none mb-1">{value}</div>
        <div className="text-[12px] text-[var(--muted)]">{label}</div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const stats: { label: string; value: number; href: string; icon: LucideIcon; color: StatColor }[] = [];

  const showRfqStats = profile.role === "comercial" || profile.role === "admin";
  const showInvoiceStats = profile.role === "administracion" || profile.role === "admin";
  const noop = Promise.resolve({ data: null, count: null } as { data: null; count: number | null });

  // Una sola tanda de queries en paralelo en vez de 2-3 tandas secuenciales.
  const [
    { data: biddingRfqs },
    { count: awaitingSelection },
    { count: pending },
    { count: review },
    { count: apto },
    { data: recentRfqs },
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
    supabase.from("rfqs").select("*").order("created_at", { ascending: false }).limit(8).returns<Rfq[]>(),
  ]);

  if (showRfqStats) {
    const open = (biddingRfqs ?? []).filter(isRfqOpen).length;
    stats.push({ label: "Solicitudes abiertas", value: open, href: "/rfqs?open=1", icon: FileText, color: "primary" });
    stats.push({ label: "Con ofertas para elegir", value: awaitingSelection ?? 0, href: "/rfqs", icon: Tag, color: "teal" });
  }
  if (showInvoiceStats) {
    // month=all: el KPI cuenta todas las facturas del estado sin importar la
    // fecha, así que el link debe llevar a la misma vista (sin filtro de mes).
    stats.push({ label: "Facturas pendientes", value: pending ?? 0, href: "/invoices?month=all&status=PENDIENTE", icon: FileText, color: "purple" });
    stats.push({ label: "Requieren revisión", value: review ?? 0, href: "/invoices?month=all&status=REQUIERE_REVISION", icon: AlertCircle, color: "orange" });
    stats.push({ label: "Aptas para pago", value: apto ?? 0, href: "/invoices?month=all&status=APTO_PARA_PAGO", icon: CheckCircle2, color: "ok" });
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-[17px] font-semibold">Hola, {profile.full_name.split(" ")[0]}</h1>
      {stats.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      ) : null}

      <div>
        <h2 className="text-[14px] font-semibold mb-2">Solicitudes recientes</h2>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Estado</th>
                <th>Creada</th>
              </tr>
            </thead>
            <tbody>
              {(recentRfqs ?? []).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/rfqs/${r.id}`} className="font-medium hover:underline">
                      {r.code}
                    </Link>
                  </td>
                  <td>{r.product}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={isRfqOpen(r) ? "warn" : "neutral"}>{isRfqOpen(r) ? "Abierta" : "Cerrada"}</Badge>
                      {rfqClosedReason(r) ? (
                        <span className="text-[11px] text-[var(--muted)]">{rfqClosedReason(r)}</span>
                      ) : null}
                    </span>
                  </td>
                  <td>{formatDate(r.created_at)}</td>
                </tr>
              ))}
              {(recentRfqs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-[var(--muted)] py-6">
                    Todavía no hay solicitudes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
