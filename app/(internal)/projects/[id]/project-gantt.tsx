"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "frappe-gantt/dist/frappe-gantt.css";
import type { GanttTaskInput, default as GanttType } from "frappe-gantt";
import { BudgetItem, ExecutionEntry } from "@/lib/types";
import { updateBudgetItemSchedule } from "../actions";

type ViewMode = "Day" | "Week" | "Month";

export function ProjectGantt({
  projectId,
  budgetItems,
  execEntries,
}: {
  projectId: string;
  budgetItems: BudgetItem[];
  execEntries: ExecutionEntry[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<GanttType | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("Week");

  const execByItem = new Map<string, number>();
  for (const e of execEntries) {
    execByItem.set(e.budget_item_id, (execByItem.get(e.budget_item_id) ?? 0) + e.quantity_executed);
  }

  // El progreso SIEMPRE se deriva de execution_entries. Nunca es un campo
  // editable — es el diferenciador del cronograma: el capataz carga avance
  // en obra, la barra se actualiza sola.
  function progressOf(item: BudgetItem): number {
    if (!item.quantity || item.quantity <= 0) return 0;
    const executed = execByItem.get(item.id) ?? 0;
    return Math.min(100, Math.round((executed / item.quantity) * 100));
  }

  const tasks: GanttTaskInput[] = budgetItems
    .filter((i) => i.start_date && i.end_date)
    .map((i) => ({
      id: i.id,
      name: `${i.code} — ${i.description}`,
      start: i.start_date as string,
      end: i.end_date as string,
      progress: progressOf(i),
      dependencies: i.depends_on ?? "",
      custom_class: i.parent_id ? "gantt-sub" : "gantt-rubro",
    }));

  useEffect(() => {
    if (!ref.current || tasks.length === 0) return;
    ref.current.innerHTML = "";

    let cancelled = false;
    import("frappe-gantt").then(({ default: Gantt }) => {
      if (cancelled || !ref.current) return;
      ganttRef.current = new Gantt(ref.current, tasks, {
        view_mode: viewMode,
        language: "es",
        bar_height: 22,
        padding: 16,
        readonly_progress: true, // el progreso es derivado, nunca se arrastra a mano
        on_date_change: async (task: { id: string }, start: Date, end: Date) => {
          const toIso = (d: Date) => d.toISOString().slice(0, 10);
          const item = budgetItems.find((b) => b.id === task.id);
          await updateBudgetItemSchedule(task.id, toIso(start), toIso(end), item?.depends_on ?? null);
        },
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tasks), viewMode]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-12 text-center space-y-2">
        <p className="text-[13px] text-[var(--muted)]">
          Cargá fecha de inicio y fin en los ítems del presupuesto para ver el cronograma.
        </p>
        <Link href={`/projects/${projectId}?tab=presupuesto`} className="text-action text-[12px]">
          Ir a Presupuesto
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["Day", "Week", "Month"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-2.5 py-1 rounded text-[12px] font-medium border transition-colors ${
                viewMode === m
                  ? "bg-[var(--primary)] text-white border-transparent"
                  : "bg-[var(--panel-2)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--foreground)]"
              }`}
            >
              {m === "Day" ? "Día" : m === "Week" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--primary)]" />
          barra llena = % ejecutado real según los partes de avance
        </div>
      </div>

      <div className="pgantt-wrap rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 overflow-x-auto">
        <div ref={ref} />
      </div>

      <style>{`
        .pgantt-wrap .bar-wrapper .bar { fill: var(--panel-2); stroke: var(--border); }
        .pgantt-wrap .bar-wrapper .bar-progress { fill: var(--primary); }
        .pgantt-wrap .bar-wrapper.gantt-sub .bar-progress { fill: var(--muted); opacity: 0.6; }
        .pgantt-wrap .bar-wrapper .bar-label { fill: var(--foreground); }
        .pgantt-wrap .grid-header { fill: var(--panel-2); stroke: var(--border); }
        .pgantt-wrap .grid-row { fill: var(--panel); }
        .pgantt-wrap .row-line { stroke: var(--border); }
        .pgantt-wrap .tick { stroke: var(--border); }
        .pgantt-wrap .today-highlight { fill: var(--accent-bg, rgba(212,113,26,0.08)); }
        .pgantt-wrap text { fill: var(--muted); font-family: inherit; }
      `}</style>
    </div>
  );
}
