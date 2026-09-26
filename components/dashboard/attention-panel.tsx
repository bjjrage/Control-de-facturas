import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight } from "lucide-react";
import type { AttentionAlert } from "@/lib/dashboard/types";

export function AttentionPanel({ alerts, title = "Requiere atención" }: { alerts: AttentionAlert[]; title?: string }) {
  if (alerts.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--warn)]/30 bg-[var(--panel)] p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--warn-bg)] text-[var(--warn)]">
            <AlertTriangle size={14} />
          </div>
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--foreground)]">
            {title} ({alerts.length})
          </h3>
        </div>
        <span className="text-[11px] text-[var(--muted)]">Acción inmediata recomendada</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {alerts.map((alert) => {
          const isError = alert.tone === "error";
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className={`group flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-[12px] transition-all duration-150 ${isError ? "border-[var(--error)]/30 bg-[var(--error-bg)]/40 text-[var(--foreground)] hover:bg-[var(--error-bg)]/80" : "border-[var(--warn)]/30 bg-[var(--warn-bg)]/40 text-[var(--foreground)] hover:bg-[var(--warn-bg)]/80"}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {isError ? <AlertOctagon size={14} className="shrink-0 text-[var(--error)]" /> : <AlertTriangle size={14} className="shrink-0 text-[var(--warn)]" />}
                <span className="truncate font-medium">{alert.label}</span>
              </div>
              <ArrowRight size={13} className="shrink-0 text-[var(--muted)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--foreground)]" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
