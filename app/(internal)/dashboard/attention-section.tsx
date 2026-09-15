import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { DASHBOARD_ICONS, DashboardIconKey } from "./icon-map";

export type AttentionItem = {
  key: string;
  text: string;
  href: string;
  iconKey: DashboardIconKey;
  severity: "warn" | "error";
};

const SEVERITY_CLASSES: Record<AttentionItem["severity"], string> = {
  warn: "text-[var(--warn)]",
  error: "text-[var(--error)]",
};

// No es un activity feed: cada fila es un evento accionable derivado de datos
// reales (atraso de obra, pago vencido, licitación por vencer). Si no hay
// nada accionable, la sección directamente no se muestra.
export function AttentionSection({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)]">
      {items.map((item) => {
        const Icon = DASHBOARD_ICONS[item.iconKey];
        return (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-[var(--hover)] transition-colors"
          >
            <AlertTriangle size={13} className={`shrink-0 ${SEVERITY_CLASSES[item.severity]}`} />
            <Icon size={13} className="shrink-0 text-[var(--muted)]" />
            <span className="flex-1 min-w-0 text-[13px] truncate">{item.text}</span>
            <ChevronRight size={13} className="shrink-0 text-[var(--muted)]" />
          </Link>
        );
      })}
    </div>
  );
}
