import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { DASHBOARD_ICONS, DashboardIconKey } from "./icon-map";

type KpiTone = "warn" | "error" | "ok" | "neutral";

const TONE_CLASSES: Record<KpiTone, string> = {
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  error: "bg-[var(--error-bg)] text-[var(--error)]",
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  neutral: "bg-[var(--neutral-bg)] text-[var(--muted)]",
};

export type AdminKpi = {
  key: string;
  label: string;
  amountPyg: number | null;
  count: number;
  href: string;
  iconKey: DashboardIconKey;
  tone: KpiTone;
};

function KpiCard({ kpi }: { kpi: AdminKpi }) {
  const Icon = DASHBOARD_ICONS[kpi.iconKey];
  return (
    <Link
      href={kpi.href}
      className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 hover:bg-[var(--hover)] flex items-start gap-2.5"
    >
      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${TONE_CLASSES[kpi.tone]}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-tight truncate">
          {kpi.amountPyg !== null ? formatMoney(kpi.amountPyg, "PYG") : "—"}
        </div>
        <div className="text-[11px] text-[var(--muted)] mt-0.5">
          {kpi.label} · {kpi.count}
        </div>
      </div>
    </Link>
  );
}

// KPIs de Administración: solo lo accionable financieramente — nunca "Caja".
export function AdminKpis({ kpis }: { kpis: AdminKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {kpis.map((k) => (
        <KpiCard key={k.key} kpi={k} />
      ))}
    </div>
  );
}
