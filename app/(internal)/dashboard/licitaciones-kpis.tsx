import Link from "next/link";
import { DASHBOARD_ICONS, DashboardIconKey } from "./icon-map";

export type LicitacionKpi = {
  key: string;
  label: string;
  count: number;
  href: string;
  iconKey: DashboardIconKey;
  tone: "warn" | "primary";
};

const TONE_CLASSES: Record<LicitacionKpi["tone"], string> = {
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  primary: "bg-[var(--primary-bg)] text-[var(--primary)]",
};

// KPIs de Licitaciones: solo "qué apareció nuevo" y "qué vence pronto" — sin
// monto potencial ni win rate.
export function LicitacionesKpis({ kpis }: { kpis: LicitacionKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {kpis.map((k) => {
        const Icon = DASHBOARD_ICONS[k.iconKey];
        return (
          <Link
            key={k.key}
            href={k.href}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 hover:bg-[var(--hover)] flex items-center gap-2.5"
          >
            <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${TONE_CLASSES[k.tone]}`}>
              <Icon size={15} />
            </div>
            <div>
              <div className="text-[19px] font-semibold leading-none">{k.count}</div>
              <div className="text-[11px] text-[var(--muted)] mt-1">{k.label}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
