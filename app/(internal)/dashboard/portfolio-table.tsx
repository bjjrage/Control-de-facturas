import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PortfolioEstado = "Normal" | "Atención" | "Riesgo";

export type PortfolioRow = {
  id: string;
  code: string;
  name: string;
  avancePct: number;
  comprasPct: number | null;
  atrasoDias: number | null;
  estado: PortfolioEstado;
  presupuesto: number;
};

// Gradiente por estado en vez de color plano — la barra de avance lee de un
// vistazo si la obra viene bien (verde), necesita ojo (ámbar) o está en
// riesgo (rojo), sin depender solo del texto de "Estado" al lado.
const AVANCE_GRADIENT: Record<PortfolioEstado, string> = {
  Normal: "linear-gradient(90deg, #2563eb, #38bdf8)",
  Atención: "linear-gradient(90deg, #d97706, #fbbf24)",
  Riesgo: "linear-gradient(90deg, #b91c1c, #f2685c)",
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
// `totalCount` es el total real de obras activas — cuando hay más que las
// filas mostradas (recortadas a 5), se muestra el link a /projects.
export function PortfolioTable({ rows, totalCount }: { rows: PortfolioRow[]; totalCount: number }) {
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
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.min(100, r.avancePct)}%`,
                        background:
                          r.avancePct >= 100
                            ? "linear-gradient(90deg, #0f9e6f, #34d399)"
                            : AVANCE_GRADIENT[r.estado],
                      }}
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
      {totalCount > rows.length ? (
        <Link
          href="/projects"
          className="block px-3.5 py-2.5 text-[12px] text-action border-t border-[var(--border)] hover:bg-[var(--hover)]"
        >
          Ver las {totalCount} obras →
        </Link>
      ) : null}
    </div>
  );
}
