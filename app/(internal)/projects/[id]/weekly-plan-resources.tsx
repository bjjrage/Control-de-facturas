import { formatNumber } from "@/lib/format";
import type { WeeklyPlanResourceRequirements } from "@/lib/types";

const gs = (n: number) => `Gs. ${n.toLocaleString("es-PY")}`;

/**
 * Mano de obra, equipos y subcontratos que necesita la semana según las
 * recetas (APU) de las partidas planificadas. Si no hay recetas con esos
 * componentes, no se muestra nada (no se inventa).
 */
export function WeeklyPlanResources({ data }: { data: WeeklyPlanResourceRequirements }) {
  if (data.labor.length === 0 && data.equipment.length === 0 && data.subcontracts.length === 0) return null;
  const total = data.total_labor_cost + data.total_equipment_cost + data.total_subcontract_cost;

  return (
    <div className="glass-soft p-4 space-y-3">
      <div>
        <div className="text-xs font-semibold text-[var(--foreground)]">Mano de obra, equipos y subcontratos de la semana</div>
        <div className="text-[11px] text-[var(--muted)]">
          Calculado con las recetas (APU) de las partidas planificadas: meta de la semana × horas (o precio) por unidad.
        </div>
      </div>

      {data.labor.length > 0 ? (
        <Block title="Mano de obra propia" unitLabel="h" rows={data.labor.map((r) => ({ label: r.label, qty: r.horas, amount: r.costo }))} total={data.total_labor_cost} />
      ) : null}
      {data.equipment.length > 0 ? (
        <Block title="Equipos" unitLabel="h" rows={data.equipment.map((r) => ({ label: r.label, qty: r.horas, amount: r.costo }))} total={data.total_equipment_cost} />
      ) : null}
      {data.subcontracts.length > 0 ? (
        <Block title="Subcontratos" rows={data.subcontracts.map((r) => ({ label: r.label, qty: null, amount: r.monto }))} total={data.total_subcontract_cost} />
      ) : null}

      <div className="text-[11px] text-[var(--muted)]">
        Costo estimado de mano de obra, equipos y subcontratos: <strong className="text-[var(--foreground)]">{gs(total)}</strong>
      </div>
    </div>
  );
}

function Block({
  title,
  unitLabel,
  rows,
  total,
}: {
  title: string;
  unitLabel?: string;
  rows: { label: string; qty: number | null; amount: number }[];
  total: number;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-[var(--foreground)] mb-1">{title}</div>
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-0.5 pr-2">{r.label}</td>
              <td className="py-0.5 pr-2 text-right text-[var(--muted)]">{r.qty == null ? "" : `${formatNumber(r.qty, 1)} ${unitLabel ?? ""}`}</td>
              <td className="py-0.5 text-right">{gs(r.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-[var(--border)]">
            <td className="py-0.5 pr-2 font-medium" colSpan={2}>
              Total {title.toLowerCase()}
            </td>
            <td className="py-0.5 text-right font-medium">{gs(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
