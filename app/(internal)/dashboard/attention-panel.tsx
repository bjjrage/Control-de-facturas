import Link from "next/link";
import { AlertTriangle, AlertOctagon, ArrowRight } from "lucide-react";
import type { AttentionAlert } from "@/lib/dashboard/types";

export function AttentionPanel({ alerts }: { alerts: AttentionAlert[] }) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--warn)]/30 bg-[var(--panel)] p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-[var(--warn-bg)] text-[var(--warn)] flex items-center justify-center shrink-0">
            <AlertTriangle size={14} />
          </div>
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--foreground)]">
            Requiere Atención ({alerts.length})
          </h3>
        </div>
        <span className="text-[11px] text-[var(--muted)]">Acción inmediata recomendada</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {alerts.map((alert) => {
          const isError = alert.tone === "error";
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className={`group flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2.5 text-[12px] transition-all duration-150 ${
                isError
                  ? "border-[var(--error)]/30 bg-[var(--error-bg)]/40 hover:bg-[var(--error-bg)]/80 text-[var(--foreground)]"
                  : "border-[var(--warn)]/30 bg-[var(--warn-bg)]/40 hover:bg-[var(--warn-bg)]/80 text-[var(--foreground)]"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isError ? (
                  <AlertOctagon size={14} className="text-[var(--error)] shrink-0" />
                ) : (
                  <AlertTriangle size={14} className="text-[var(--warn)] shrink-0" />
                )}
                <span className="font-medium truncate">{alert.label}</span>
              </div>
              <ArrowRight
                size={13}
                className="text-[var(--muted)] group-hover:text-[var(--foreground)] group-hover:translate-x-0.5 transition-all shrink-0"
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
