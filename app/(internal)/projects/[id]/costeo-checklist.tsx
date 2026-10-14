"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import type { CostBudgetData } from "./costeo-actions";
import { ApuTemplatesDialog } from "./apu-templates-dialog";
import { LaborRatesDialog } from "./labor-rates-dialog";
import { ApplyApuTemplatesButton } from "./apply-apu-templates-button";
import { CosteoHelp } from "./costeo-help";
import styles from "./costeo-checklist.module.css";

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
      title: "Partidas",
      state: total > 0 ? "done" : "pending",
      detail: total > 0 ? `${total} con cantidad` : "Sin cantidades",
      help: "Salen del presupuesto o del cómputo métrico (Preparar → Presupuesto / BIM).",
      actions: <Link href={`/projects/${projectId}?tab=presupuesto`} className={buttonClassName({ variant: "secondary", size: "sm" })}>Presupuesto</Link>,
    },
    {
      title: "Recetas APU",
      state: total > 0 && conApu === total ? "done" : conApu > 0 ? "warn" : "pending",
      detail: `${conApu} de ${total} con receta`,
      help: "La receta dice qué materiales, horas de mano de obra, equipos y subcontratos lleva UNA unidad de cada partida. La carga la constructora una sola vez: subí su planilla en Plantillas de APU y después tocá Aplicar.",
      actions: (
        <div className="flex flex-wrap items-start gap-2">
          <ApuTemplatesDialog />
          <ApplyApuTemplatesButton projectId={projectId} onApplied={onChanged} />
        </div>
      ),
    },
    {
      title: "Mano de obra",
      state: data.manoObra.length > 0 ? "done" : conApu > 0 ? "warn" : "pending",
      detail:
        data.manoObra.length > 0
          ? `${data.manoObra.length} categorías · ${data.manoObra.filter((m) => m.vinculadoAJornal).length} vinculadas a jornales`
          : conApu > 0
            ? "Sin mano de obra en las recetas"
            : "Pendiente de recetas",
      help: "El costo por hora de cada categoría (oficial, ayudante…) con sus cargas sociales sale de la tabla de Jornales, que se carga una sola vez para toda la empresa.",
      actions: <LaborRatesDialog />,
    },
    {
      title: "Materiales",
      state: insumosTotal === 0 ? "pending" : insumosConPrecio === insumosTotal ? "done" : "warn",
      detail:
        insumosTotal === 0
          ? "Pendiente de recetas"
          : `${insumosConPrecio} de ${insumosTotal} con precio` +
            (insumosSinRubro > 0 ? ` · ${insumosSinRubro} sin rubro` : ""),
      help: "El precio de un material sale, en este orden, de: el que elijas para esta obra, la cotización más barata de tus proveedores, el historial de compras, o el costo promedio del stock. Para conseguirlo: usá «Cotizar insumos» en Costeo o cargá un precio a mano con «Cambiar» en la lista de insumos de abajo. Los materiales sin rubro necesitan una categoría en Stock para pedir precios a proveedores.",
      actions: (
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/precios" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Precios
          </Link>
          <Link href={`/projects/${projectId}?tab=cotizaciones`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Cotizaciones
          </Link>
        </div>
      ),
    },
    {
      title: "Costo final",
      state: total > 0 && costeadas === total ? "done" : costeadas > 0 ? "warn" : "pending",
      detail: `${costeadas} de ${total} completas`,
      help: "Una partida tiene costo completo cuando tiene receta y todos sus materiales tienen precio. Recién ahí se calcula su costo, su margen contra el precio de venta y el total de la obra.",
    },
  ];

  const next = steps.find((s) => s.state !== "done");

  return (
    <section className={styles.panel} aria-label="Estado del costeo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={styles.heading}>Estado del costeo</h3>
          <p className={styles.subtitle}>
            {progress === 100 && total > 0
              ? "Todas las partidas tienen costo completo."
              : next
                ? `Siguiente: ${next.title}`
                : ""}
          </p>
        </div>
        <Button type="button" variant="secondary" size="icon" onClick={onChanged} disabled={loading} aria-label="Recalcular costeo" title="Recalcular">
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

      <ol className={styles.rows}>
        {steps.map((s) => (
          <li key={s.title} className={styles.row} data-next={s === next || undefined}>
            <div className={styles.identity}><StateIcon state={s.state} /><span className={styles.title}>{s.title}</span><CosteoHelp title={s.title}>{s.help}</CosteoHelp></div>
            <p className={styles.status} data-state={s.state}>{s.detail}</p>
            <div className={styles.actions}>{s.actions ?? <span className={styles.passive}>Cálculo automático</span>}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
