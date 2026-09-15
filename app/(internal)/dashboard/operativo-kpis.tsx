import Link from "next/link";
import { DASHBOARD_ICONS, DashboardIconKey } from "./icon-map";

export type OperativoKpi = {
  key: string;
  label: string;
  value: string;
  href: string;
  iconKey: DashboardIconKey;
  tone: "primary" | "warn";
};

const TONE_CLASSES: Record<OperativoKpi["tone"], string> = {
  primary: "bg-[var(--primary-bg)] text-[var(--primary)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
};

// KPIs de Operativo: cuánto portafolio hay y cómo está de salud, de un
// vistazo — sin esto, el resumen ejecutivo solo mostraba la tabla de obras
// y no respondía "¿cuántas obras tengo en total?".
export function OperativoKpis({ kpis }: { kpis: OperativoKpi[] }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
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
            <div className="min-w-0">
              <div className="text-[19px] font-semibold leading-none">{k.value}</div>
              <div className="text-[11px] text-[var(--muted)] mt-1 truncate">{k.label}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
