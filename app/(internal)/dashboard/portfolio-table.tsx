import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export type PortfolioEstado = "Normal" | "Atención" | "Riesgo";

export type PortfolioRow = {
  id: string;
  code: string;
  name: string;
  avancePct: number;
  comprasPct: number | null;
  atrasoDias: number | null;
  estado: PortfolioEstado;
};

const ESTADO_TONE: Record<PortfolioEstado, "ok" | "warn" | "error"> = {
  Normal: "ok",
  Atención: "warn",
  Riesgo: "error",
};

function CostDeviation({ comprasPct }: { comprasPct: number | null }) {
  if (comprasPct === null) return <span className="text-[var(--muted)]">—</span>;
  const desvio = comprasPct - 100;
  if (Math.abs(desvio) < 1) return <span className="text-[var(--muted)]">0%</span>;
  return (
    <span className={desvio > 0 ? "text-[var(--error)]" : "text-[var(--ok)]"}>
      {desvio > 0 ? "+" : ""}
      {desvio.toFixed(1)}%
    </span>
  );
}

function ScheduleDeviation({ atrasoDias }: { atrasoDias: number | null }) {
  if (atrasoDias === null) return <span className="text-[var(--muted)]">—</span>;
  if (atrasoDias <= 0) return <span className="text-[var(--muted)]">en plazo</span>;
  return <span className="text-[var(--error)]">+{atrasoDias} días</span>;
}

// Portafolio de obras — pieza central del workspace Operativo en el
// dashboard. Compacto a propósito: nombre, avance, desvíos y estado, nada
// más. Degrada a "—" cuando el dato no existe en vez de inventarlo.
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
        Todavía no hay obras activas.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <table>
        <thead>
          <tr>
            <th>Obra</th>
            <th>Avance</th>
            <th>Costo</th>
            <th>Plazo</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/projects/${r.id}`} className="text-action font-medium">
                  {r.name}
                </Link>
                <span className="text-[11px] text-[var(--muted)] font-mono ml-1.5">{r.code}</span>
              </td>
              <td className="w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-[var(--hover)] overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", r.avancePct >= 100 ? "bg-[var(--ok)]" : "bg-[var(--primary)]")}
                      style={{ width: `${Math.min(100, r.avancePct)}%` }}
                    />
                  </div>
                  <span className="text-[12px] tabular-nums shrink-0">{r.avancePct}%</span>
                </div>
              </td>
              <td className="num"><CostDeviation comprasPct={r.comprasPct} /></td>
              <td className="num"><ScheduleDeviation atrasoDias={r.atrasoDias} /></td>
              <td>
                <span className="inline-flex items-center gap-1">
                  {r.estado !== "Normal" ? <AlertTriangle size={11} className="text-[var(--warn)]" /> : null}
                  <Badge tone={ESTADO_TONE[r.estado]}>{r.estado}</Badge>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
