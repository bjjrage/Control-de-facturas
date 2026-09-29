"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CostBudgetData } from "./costeo-actions";
import { ApuTemplatesDialog } from "./apu-templates-dialog";
import { LaborRatesDialog } from "./labor-rates-dialog";
import { ApplyApuTemplatesButton } from "./apply-apu-templates-button";

type StepState = "done" | "pending" | "warn";

interface Step {
  title: string;
  state: StepState;
  detail: string;
  help: string;
  actions?: React.ReactNode;
}

function StateIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  if (state === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  return <Circle className="h-4 w-4 text-[var(--muted)] shrink-0 mt-0.5" />;
}

/**
 * Instructivo del costeo: qué datos hacen falta para llegar al costo final de
 * la obra, cuáles ya están y qué hacer con los que faltan. El avance total es
 * el porcentaje de partidas con costo completo.
 */
export function CosteoChecklist({
  projectId,
  data,
  loading,
  onChanged,
}: {
  projectId: string;
  data: CostBudgetData;
  loading: boolean;
  onChanged: () => void;
}) {
  const partidas = data.partidas.filter((p) => (p.quantity ?? 0) > 0);
  const total = partidas.length;
  const conApu = partidas.filter((p) => p.cost?.tieneApu).length;
  const costeadas = partidas.filter((p) => p.cost?.costoTotal != null).length;
  const insumosTotal = data.insumos.length;
  const insumosConPrecio = data.insumos.filter((i) => i.precio != null).length;
  const insumosSinRubro = data.insumos.filter((i) => !i.rubro).length;
  const progress = total > 0 ? Math.round((costeadas / total) * 100) : 0;

  const steps: Step[] = [
    {
      title: "1. Partidas con cantidad",
      state: total > 0 ? "done" : "pending",
      detail: total > 0 ? `${total} partidas con cantidad.` : "La obra no tiene partidas con cantidad.",
      help: "Salen del presupuesto o del cómputo métrico (Preparar → Presupuesto / BIM).",
    },
    {
      title: "2. Receta (APU) de cada partida",
      state: total > 0 && conApu === total ? "done" : conApu > 0 ? "warn" : "pending",
      detail: `${conApu} de ${total} partidas tienen receta.`,
      help: "La receta dice qué materiales, horas de mano de obra, equipos y subcontratos lleva UNA unidad de cada partida. La carga la constructora una sola vez: subí su planilla en Plantillas de APU y después tocá Aplicar.",
      actions: (
        <div className="flex flex-wrap items-start gap-2">
          <ApuTemplatesDialog />
          <ApplyApuTemplatesButton projectId={projectId} onApplied={onChanged} />
        </div>
      ),
    },
    {
      title: "3. Costo por hora de la mano de obra",
      state: data.manoObra.length > 0 ? "done" : conApu > 0 ? "warn" : "pending",
      detail:
        data.manoObra.length > 0
          ? `${data.manoObra.length} categorías con costo por hora (${data.manoObra.filter((m) => m.vinculadoAJornal).length} vinculadas a Jornales).`
          : conApu > 0
            ? "Las recetas cargadas no traen mano de obra."
            : "Se define con las recetas.",
      help: "El costo por hora de cada categoría (oficial, ayudante…) con sus cargas sociales sale de la tabla de Jornales, que se carga una sola vez para toda la empresa.",
      actions: <LaborRatesDialog />,
    },
    {
      title: "4. Precio de cada material",
      state: insumosTotal === 0 ? "pending" : insumosConPrecio === insumosTotal ? "done" : "warn",
      detail:
        insumosTotal === 0
          ? "Todavía no hay materiales: se calculan a partir de las recetas."
          : `${insumosConPrecio} de ${insumosTotal} materiales tienen precio.` +
            (insumosSinRubro > 0 ? ` ${insumosSinRubro} sin rubro.` : ""),
      help: "El precio de un material sale, en este orden, de: el que elijas para esta obra, la cotización más barata de tus proveedores, el historial de compras, o el costo promedio del stock. Para conseguirlo: pedí cotizaciones (Comprar → Cotizaciones → Nueva cotización → Desde una obra) o cargá un precio a mano con «Cambiar» en la lista de insumos de abajo. Los materiales sin rubro no se pueden pedir a proveedores: asignales categoría en Stock.",
      actions: (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/precios" className="text-action text-[12px]">
            Lista de precios de materiales →
          </Link>
          <Link href={`/projects/${projectId}?tab=cotizaciones`} className="text-action text-[12px]">
            Cotizaciones de esta obra →
          </Link>
        </div>
      ),
    },
    {
      title: "5. Costo final por partida",
      state: total > 0 && costeadas === total ? "done" : costeadas > 0 ? "warn" : "pending",
      detail: `${costeadas} de ${total} partidas con costo completo.`,
      help: "Una partida tiene costo completo cuando tiene receta y todos sus materiales tienen precio. Recién ahí se calcula su costo, su margen contra el precio de venta y el total de la obra.",
    },
  ];

  const next = steps.find((s) => s.state !== "done");

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">Qué falta para el costeo final</h3>
          <p className="text-[12px] text-[var(--muted)]">
            {progress === 100 && total > 0
              ? "Todas las partidas tienen costo completo."
              : next
                ? `Siguiente paso: ${next.title.replace(/^\d\.\s/, "")}.`
                : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onChanged} className="gap-1.5" title="Recalcular">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-[var(--muted)] mb-1">
          <span>Partidas con costo completo</span>
          <span>
            {costeadas} de {total} · {progress}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-[var(--panel-2)] overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.title} className="flex gap-2.5">
            <StateIcon state={s.state} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-[13px] font-medium">{s.title}</div>
              <div className={`text-[12px] ${s.state === "warn" ? "text-amber-500" : s.state === "done" ? "text-emerald-500" : "text-[var(--muted)]"}`}>{s.detail}</div>
              {s.state !== "done" ? <p className="text-[11px] text-[var(--muted)] max-w-3xl">{s.help}</p> : null}
              {s.actions ? <div className="pt-0.5">{s.actions}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
