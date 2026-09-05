"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BudgetItem, ExecutionEntry } from "@/lib/types";
import { updateBudgetItemSchedule } from "../actions";

type ViewMode = "day" | "week" | "month";

// Paleta iOS system colors — un hue por rubro raíz. Los sub-ítems heredan el
// del padre, así el ojo agrupa la obra por rubro sin leer los códigos.
const RUBRO_HUES = [
  "#0A84FF", // blue
  "#5E5CE6", // indigo
  "#30D158", // green
  "#FF9F0A", // orange
  "#BF5AF2", // purple
  "#64D2FF", // cyan
  "#FF375F", // pink
  "#66D4CF", // mint
  "#FFD60A", // yellow
  "#AC8E68", // brown
];

const PX_PER_DAY: Record<ViewMode, number> = { day: 42, week: 19, month: 5.2 };
const ROW_H = 36;
const LEFT_W = 264;
const MS_DAY = 86_400_000;

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTHS_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function parseDate(s: string) {
  return new Date(s + "T00:00:00");
}
function toIso(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(dt: Date, n: number) {
  const c = new Date(dt);
  c.setDate(c.getDate() + n);
  return c;
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}
function startOfWeek(dt: Date) {
  const c = new Date(dt);
  const dow = (c.getDay() + 6) % 7; // lunes = 0
  c.setDate(c.getDate() - dow);
  return c;
}

type Row = {
  id: string;
  code: string;
  description: string;
  depth: number;
  hue: string;
  isRubro: boolean;
  start: Date;
  end: Date;
  progress: number;
  unit: string | null;
  quantity: number | null;
  executed: number;
};

type Cell = { x: number; w: number; label: string; dim: boolean };
type Group = { x: number; w: number; label: string };

// ────────────────────────────────────────────────────────────────────────────
// Chart
// ────────────────────────────────────────────────────────────────────────────
function GanttChart({
  rows,
  viewMode,
  fullHeight,
}: {
  rows: Row[];
  viewMode: ViewMode;
  fullHeight?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "l" | "r"; dx: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const pxDay = PX_PER_DAY[viewMode];

  const { min, totalDays, width } = useMemo(() => {
    let lo = rows[0].start;
    let hi = rows[0].end;
    for (const r of rows) {
      if (r.start < lo) lo = r.start;
      if (r.end > hi) hi = r.end;
    }
    const pad = viewMode === "day" ? 2 : viewMode === "week" ? 7 : 20;
    const start = addDays(lo, -pad);
    const days = daysBetween(start, hi) + pad * 2;
    return { min: start, totalDays: days, width: days * pxDay };
  }, [rows, viewMode, pxDay]);

  // Celdas del header + agrupador superior
  const { cells, groups } = useMemo(() => {
    const cs: Cell[] = [];
    const gs: Group[] = [];

    if (viewMode === "day") {
      for (let i = 0; i < totalDays; i++) {
        const dt = addDays(min, i);
        const dow = dt.getDay();
        cs.push({ x: i * pxDay, w: pxDay, label: String(dt.getDate()), dim: dow === 0 || dow === 6 });
      }
      let i = 0;
      while (i < totalDays) {
        const dt = addDays(min, i);
        const m = dt.getMonth();
        let n = 0;
        while (i + n < totalDays && addDays(min, i + n).getMonth() === m) n++;
        gs.push({ x: i * pxDay, w: n * pxDay, label: `${MONTHS_LONG[m]} ${dt.getFullYear()}` });
        i += n;
      }
    } else if (viewMode === "week") {
      let cur = startOfWeek(min);
      if (cur < min) cur = addDays(cur, 7);
      while (daysBetween(min, cur) < totalDays) {
        const off = daysBetween(min, cur);
        cs.push({
          x: off * pxDay,
          w: 7 * pxDay,
          label: `${cur.getDate()} ${MONTHS[cur.getMonth()].toLowerCase()}`,
          dim: false,
        });
        cur = addDays(cur, 7);
      }
      let i = 0;
      while (i < totalDays) {
        const dt = addDays(min, i);
        const m = dt.getMonth();
        let n = 0;
        while (i + n < totalDays && addDays(min, i + n).getMonth() === m) n++;
        gs.push({ x: i * pxDay, w: n * pxDay, label: `${MONTHS_LONG[m]} ${dt.getFullYear()}` });
        i += n;
      }
    } else {
      let i = 0;
      while (i < totalDays) {
        const dt = addDays(min, i);
        const m = dt.getMonth();
        let n = 0;
        while (i + n < totalDays && addDays(min, i + n).getMonth() === m) n++;
        cs.push({ x: i * pxDay, w: n * pxDay, label: MONTHS[m], dim: false });
        i += n;
      }
      let j = 0;
      while (j < totalDays) {
        const dt = addDays(min, j);
        const y = dt.getFullYear();
        let n = 0;
        while (j + n < totalDays && addDays(min, j + n).getFullYear() === y) n++;
        gs.push({ x: j * pxDay, w: n * pxDay, label: String(y) });
        j += n;
      }
    }
    return { cells: cs, groups: gs };
  }, [min, totalDays, pxDay, viewMode]);

  const todayX = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const off = daysBetween(min, t);
    return off >= 0 && off <= totalDays ? off * pxDay : null;
  }, [min, totalDays, pxDay]);

  // Centrar en "hoy" (o en el inicio de la obra) al montar / cambiar de zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = todayX ?? 0;
    el.scrollLeft = Math.max(0, target - el.clientWidth / 2 + LEFT_W / 2);
  }, [todayX, viewMode]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const startDrag = useCallback(
    (e: React.PointerEvent, id: string, mode: "move" | "l" | "r") => {
      e.preventDefault();
      e.stopPropagation();
      const x0 = e.clientX;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      setDrag({ id, mode, dx: 0 });

      const onMove = (ev: PointerEvent) => setDrag({ id, mode, dx: ev.clientX - x0 });
      const onUp = async (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setDrag(null);
        const delta = Math.round((ev.clientX - x0) / pxDay);
        if (delta === 0) return;
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        let s = row.start;
        let en = row.end;
        if (mode === "move") {
          s = addDays(s, delta);
          en = addDays(en, delta);
        } else if (mode === "l") {
          s = addDays(s, delta);
          if (s >= en) return;
        } else {
          en = addDays(en, delta);
          if (en <= s) return;
        }
        await updateBudgetItemSchedule(id, toIso(s), toIso(en), null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [pxDay, rows]
  );

  function barGeom(r: Row) {
    let left = daysBetween(min, r.start) * pxDay;
    let w = (daysBetween(r.start, r.end) + 1) * pxDay;
    if (drag?.id === r.id) {
      if (drag.mode === "move") left += drag.dx;
      else if (drag.mode === "l") {
        left += drag.dx;
        w -= drag.dx;
      } else w += drag.dx;
    }
    return { left, w: Math.max(pxDay * 0.8, w) };
  }

  return (
    <div
      ref={scrollRef}
      className="pg-scroll"
      style={fullHeight ? { height: "100%" } : { maxHeight: 520 }}
    >
      <div style={{ width: LEFT_W + width, position: "relative" }}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="pg-head">
          <div className="pg-head-left">
            <span className="pg-head-left-txt">Tarea</span>
          </div>
          <div style={{ position: "relative", width, flex: "none" }}>
            <div className="pg-groups">
              {groups.map((g, i) => (
                <div key={i} className="pg-group" style={{ left: g.x, width: g.w }}>
                  <span>{g.label}</span>
                </div>
              ))}
            </div>
            <div className="pg-cells">
              {cells.map((c, i) => (
                <div
                  key={i}
                  className={`pg-cell${c.dim ? " dim" : ""}`}
                  style={{ left: c.x, width: c.w }}
                >
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          {/* capa de grilla + finde + hoy, detrás de las filas */}
          <div className="pg-layer" style={{ left: LEFT_W, width }}>
            {cells.map((c, i) => (
              <div key={i}>
                {c.dim ? <div className="pg-weekend" style={{ left: c.x, width: c.w }} /> : null}
                <div className="pg-vline" style={{ left: c.x }} />
              </div>
            ))}
            {todayX !== null ? <div className="pg-today" style={{ left: todayX }} /> : null}
          </div>

          {rows.map((r) => {
            const { left, w } = barGeom(r);
            const isDragging = drag?.id === r.id;
            const wide = w > 96;
            return (
              <div
                key={r.id}
                className={`pg-row${hover === r.id ? " hov" : ""}`}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="pg-left">
                  {r.isRubro ? (
                    <span className="pg-rubro" style={{ color: r.hue }}>
                      <i className="pg-dot" style={{ background: r.hue }} />
                      {r.description}
                    </span>
                  ) : (
                    <span className="pg-item" style={{ paddingLeft: r.depth * 14 }}>
                      <span className="pg-code">{r.code}</span>
                      <span className="pg-desc">{r.description}</span>
                    </span>
                  )}
                </div>

                <div style={{ position: "relative", width, flex: "none" }}>
                  {r.isRubro ? (
                    <div
                      className="pg-summary"
                      style={{ left, width: w, background: r.hue }}
                      title={`${r.description} · ${toIso(r.start)} → ${toIso(r.end)}`}
                    />
                  ) : (
                    <div
                      className={`pg-bar${isDragging ? " dragging" : ""}`}
                      style={
                        {
                          left,
                          width: w,
                          "--hue": r.hue,
                        } as React.CSSProperties
                      }
                      onPointerDown={(e) => startDrag(e, r.id, "move")}
                      title={`${r.code} — ${r.description}\n${toIso(r.start)} → ${toIso(r.end)}\n${r.progress}% ejecutado${
                        r.quantity ? ` (${r.executed} / ${r.quantity} ${r.unit ?? ""})` : ""
                      }`}
                    >
                      <div className="pg-fill" style={{ width: `${r.progress}%` }} />
                      <span className={`pg-label${wide ? "" : " out"}`}>
                        {wide ? r.description : `${r.code}`}
                      </span>
                      {r.progress > 0 && wide ? (
                        <span className="pg-pct">{r.progress}%</span>
                      ) : null}
                      <span
                        className="pg-handle l"
                        onPointerDown={(e) => startDrag(e, r.id, "l")}
                      />
                      <span
                        className="pg-handle r"
                        onPointerDown={(e) => startDrag(e, r.id, "r")}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sheet (overlay que sube desde abajo)
// ────────────────────────────────────────────────────────────────────────────
function GanttSheet({
  onClose,
  children,
  toolbar,
}: {
  onClose: () => void;
  children: React.ReactNode;
  toolbar: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`pg-backdrop${shown ? " in" : ""}`} onClick={onClose}>
      <div className={`pg-sheet${shown ? " in" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="pg-grab" />
        <div className="pg-sheet-head">
          <div>
            <div className="pg-sheet-title">Cronograma de obra</div>
            <div className="pg-sheet-sub">Arrastrá una barra para mover fechas · Esc para cerrar</div>
          </div>
          <div className="pg-sheet-actions">
            {toolbar}
            <button className="pg-close" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>
        <div className="pg-sheet-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Root
// ────────────────────────────────────────────────────────────────────────────
export function ProjectGantt({
  projectId,
  budgetItems,
  execEntries,
}: {
  projectId: string;
  budgetItems: BudgetItem[];
  execEntries: ExecutionEntry[];
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const exec = new Map<string, number>();
    for (const e of execEntries) {
      exec.set(e.budget_item_id, (exec.get(e.budget_item_id) ?? 0) + e.quantity_executed);
    }

    // La jerarquía sale del código ("1.2" cuelga de "1"), no de parent_id —
    // el importador de Excel arma los códigos pero no siempre el parent.
    const rootOf = (code: string) => code.split(".")[0];
    const roots = [...new Set(budgetItems.map((i) => rootOf(i.code)))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    const hueOf = (code: string) => RUBRO_HUES[roots.indexOf(rootOf(code)) % RUBRO_HUES.length];

    const scheduled = budgetItems.filter((i) => i.start_date && i.end_date);
    const out: Row[] = [];

    for (const root of roots) {
      const kids = scheduled
        .filter((i) => rootOf(i.code) === root && i.code !== root)
        .sort((a, b) => a.sort_order - b.sort_order);
      if (kids.length === 0) continue;

      const parent = budgetItems.find((i) => i.code === root);
      const lo = kids.reduce<Date>(
        (m, k) => (parseDate(k.start_date!) < m ? parseDate(k.start_date!) : m),
        parseDate(kids[0].start_date!)
      );
      const hi = kids.reduce<Date>(
        (m, k) => (parseDate(k.end_date!) > m ? parseDate(k.end_date!) : m),
        parseDate(kids[0].end_date!)
      );

      out.push({
        id: parent?.id ?? `rubro-${root}`,
        code: root,
        description: parent?.description ?? `Rubro ${root}`,
        depth: 0,
        hue: hueOf(root),
        isRubro: true,
        start: lo,
        end: hi,
        progress: 0,
        unit: null,
        quantity: null,
        executed: 0,
      });

      for (const k of kids) {
        const q = k.quantity ?? 0;
        const ex = exec.get(k.id) ?? 0;
        out.push({
          id: k.id,
          code: k.code,
          description: k.description,
          depth: (k.code.match(/\./g) ?? []).length,
          hue: hueOf(k.code),
          isRubro: false,
          start: parseDate(k.start_date!),
          end: parseDate(k.end_date!),
          progress: q > 0 ? Math.min(100, Math.round((ex / q) * 100)) : 0,
          unit: k.unit,
          quantity: k.quantity,
          executed: ex,
        });
      }
    }

    // Ítems programados que no cuelgan de ningún rubro con hijos
    const placed = new Set(out.map((r) => r.id));
    for (const i of scheduled) {
      if (placed.has(i.id)) continue;
      const q = i.quantity ?? 0;
      const ex = exec.get(i.id) ?? 0;
      out.push({
        id: i.id,
        code: i.code,
        description: i.description,
        depth: 0,
        hue: hueOf(i.code),
        isRubro: false,
        start: parseDate(i.start_date!),
        end: parseDate(i.end_date!),
        progress: q > 0 ? Math.min(100, Math.round((ex / q) * 100)) : 0,
        unit: i.unit,
        quantity: i.quantity,
        executed: ex,
      });
    }

    return out;
  }, [budgetItems, execEntries]);

  const segmented = (
    <div className="pg-seg">
      {(["day", "week", "month"] as ViewMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setViewMode(m)}
          className={viewMode === m ? "on" : ""}
        >
          {m === "day" ? "Día" : m === "week" ? "Semana" : "Mes"}
        </button>
      ))}
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] py-12 text-center space-y-2">
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {segmented}
        <div className="flex items-center gap-3">
          <span className="pg-legend">
            <i className="pg-legend-bar" />
            relleno = % ejecutado real
          </span>
          <button className="pg-expand" onClick={() => setExpanded(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
            Expandir
          </button>
        </div>
      </div>

      <div className="pg-frame">
        <GanttChart rows={rows} viewMode={viewMode} />
      </div>

      {expanded ? (
        <GanttSheet onClose={() => setExpanded(false)} toolbar={segmented}>
          <GanttChart rows={rows} viewMode={viewMode} fullHeight />
        </GanttSheet>
      ) : null}

      <style>{`
        /* ── Contenedor ─────────────────────────────────────────────────── */
        .pg-frame {
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--panel);
          overflow: hidden;
        }
        .pg-scroll {
          overflow: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border) transparent;
        }
        .pg-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .pg-scroll::-webkit-scrollbar-thumb {
          background: var(--border); border-radius: 99px;
          border: 3px solid var(--panel);
        }
        .pg-scroll::-webkit-scrollbar-track { background: transparent; }

        /* ── Header ─────────────────────────────────────────────────────── */
        .pg-head {
          display: flex; position: sticky; top: 0; z-index: 5;
          height: 52px;
          background: color-mix(in srgb, var(--panel) 86%, transparent);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .pg-head-left {
          width: ${LEFT_W}px; flex: none;
          position: sticky; left: 0; z-index: 6;
          background: var(--panel);
          border-right: 1px solid var(--border);
          display: flex; align-items: flex-end; padding: 0 14px 7px;
        }
        .pg-head-left-txt {
          font-size: 10px; font-weight: 600; letter-spacing: .07em;
          text-transform: uppercase; color: var(--muted);
        }
        .pg-groups { position: absolute; inset: 0 0 auto 0; height: 27px; }
        .pg-group {
          position: absolute; top: 0; height: 27px;
          display: flex; align-items: center; padding-left: 11px;
          font-size: 12px; font-weight: 650; color: var(--foreground);
          letter-spacing: -.01em; white-space: nowrap; overflow: hidden;
        }
        .pg-group::before {
          content: ""; position: absolute; left: 0; top: 7px; bottom: 7px;
          width: 1px; background: var(--border);
        }
        .pg-cells { position: absolute; inset: 27px 0 0 0; }
        .pg-cell {
          position: absolute; top: 0; bottom: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 10.5px; font-variant-numeric: tabular-nums;
          color: var(--muted); white-space: nowrap; overflow: hidden;
        }
        .pg-cell.dim { color: color-mix(in srgb, var(--muted) 55%, transparent); }

        /* ── Grilla de fondo ────────────────────────────────────────────── */
        .pg-layer { position: absolute; top: 0; bottom: 0; pointer-events: none; }
        .pg-vline {
          position: absolute; top: 0; bottom: 0; width: 1px;
          background: color-mix(in srgb, var(--border) 55%, transparent);
        }
        .pg-weekend {
          position: absolute; top: 0; bottom: 0;
          background: color-mix(in srgb, var(--muted) 4%, transparent);
        }
        .pg-today {
          position: absolute; top: 0; bottom: 0; width: 2px;
          background: var(--warn); border-radius: 2px;
          box-shadow: 0 0 12px color-mix(in srgb, var(--warn) 55%, transparent);
        }

        /* ── Filas ──────────────────────────────────────────────────────── */
        .pg-row {
          display: flex; height: ${ROW_H}px; position: relative;
          transition: background .12s ease;
        }
        .pg-row.hov { background: color-mix(in srgb, var(--hover) 60%, transparent); }
        .pg-left {
          width: ${LEFT_W}px; flex: none;
          position: sticky; left: 0; z-index: 2;
          background: var(--panel);
          border-right: 1px solid var(--border);
          display: flex; align-items: center; padding: 0 14px;
          overflow: hidden;
        }
        .pg-row.hov .pg-left { background: color-mix(in srgb, var(--hover) 92%, var(--panel)); }

        .pg-rubro {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
          text-transform: uppercase; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .pg-dot { width: 6px; height: 6px; border-radius: 99px; flex: none; }
        .pg-item {
          display: inline-flex; align-items: baseline; gap: 8px;
          min-width: 0; width: 100%;
        }
        .pg-code {
          font-size: 10.5px; font-variant-numeric: tabular-nums;
          color: var(--muted); flex: none; min-width: 26px;
        }
        .pg-desc {
          font-size: 12.5px; color: var(--foreground);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* ── Barras ─────────────────────────────────────────────────────── */
        .pg-summary {
          position: absolute; top: 50%; height: 5px;
          transform: translateY(-50%);
          border-radius: 99px; opacity: .38;
        }
        .pg-bar {
          position: absolute; top: 50%; height: 22px;
          transform: translateY(-50%);
          border-radius: 7px; cursor: grab;
          background: color-mix(in srgb, var(--hue) 15%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hue) 34%, transparent);
          overflow: hidden;
          display: flex; align-items: center;
          transition: box-shadow .14s ease, transform .14s ease;
        }
        .pg-bar:hover {
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hue) 60%, transparent),
                      0 4px 14px color-mix(in srgb, var(--hue) 26%, transparent);
        }
        .pg-bar.dragging { cursor: grabbing; transform: translateY(-50%) scale(1.012); }
        .pg-fill {
          position: absolute; left: 0; top: 0; bottom: 0;
          background: var(--hue); border-radius: 7px 0 0 7px;
          transition: width .3s cubic-bezier(.32,.72,0,1);
        }
        .pg-label {
          position: relative; z-index: 1;
          padding: 0 9px; font-size: 11.5px; font-weight: 550;
          color: #fff; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; letter-spacing: -.01em;
          text-shadow: 0 1px 3px rgba(0,0,0,.42);
        }
        .pg-label.out {
          color: var(--hue); text-shadow: none;
          font-variant-numeric: tabular-nums;
        }
        .pg-pct {
          position: relative; z-index: 1; margin-left: auto;
          padding: 1px 6px; margin-right: 5px;
          font-size: 9.5px; font-weight: 700;
          font-variant-numeric: tabular-nums;
          border-radius: 99px; color: #fff; flex: none;
          background: rgba(0,0,0,.26);
          text-shadow: 0 1px 2px rgba(0,0,0,.4);
        }
        .pg-handle {
          position: absolute; top: 0; bottom: 0; width: 8px;
          cursor: ew-resize; z-index: 2; opacity: 0;
        }
        .pg-handle.l { left: 0; }
        .pg-handle.r { right: 0; }
        .pg-bar:hover .pg-handle { opacity: 1; }
        .pg-bar:hover .pg-handle::after {
          content: ""; position: absolute; top: 6px; bottom: 6px;
          left: 2.5px; width: 2.5px; border-radius: 99px;
          background: rgba(255,255,255,.72);
        }

        /* ── Toolbar ────────────────────────────────────────────────────── */
        .pg-seg {
          display: inline-flex; gap: 2px; padding: 3px;
          background: var(--panel-2); border-radius: 10px;
          border: 1px solid var(--border);
        }
        .pg-seg button {
          padding: 5px 13px; border-radius: 7px; border: none;
          background: transparent; color: var(--muted);
          font-size: 12px; font-weight: 550; cursor: pointer;
          transition: color .14s ease, background .14s ease;
        }
        .pg-seg button:hover { color: var(--foreground); }
        .pg-seg button.on {
          background: var(--panel);
          color: var(--foreground);
          box-shadow: 0 1px 3px rgba(0,0,0,.34);
        }
        .pg-legend {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; color: var(--muted);
        }
        .pg-legend-bar {
          width: 22px; height: 8px; border-radius: 99px;
          background: linear-gradient(90deg, var(--primary) 58%, color-mix(in srgb, var(--primary) 17%, transparent) 58%);
        }
        .pg-expand {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 9px;
          border: 1px solid var(--border); background: var(--panel-2);
          color: var(--foreground); font-size: 12px; font-weight: 550;
          cursor: pointer; transition: background .14s ease;
        }
        .pg-expand:hover { background: var(--hover); }

        /* ── Sheet ──────────────────────────────────────────────────────── */
        .pg-backdrop {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(0,0,0,0);
          backdrop-filter: blur(0px);
          transition: background .34s ease, backdrop-filter .34s ease;
          display: flex; align-items: flex-end;
        }
        .pg-backdrop.in {
          background: rgba(0,0,0,.52);
          backdrop-filter: blur(7px);
        }
        .pg-sheet {
          width: 100%; height: 94vh;
          background: var(--panel);
          border-top-left-radius: 22px; border-top-right-radius: 22px;
          border: 1px solid var(--border); border-bottom: none;
          box-shadow: 0 -20px 60px rgba(0,0,0,.5);
          display: flex; flex-direction: column;
          transform: translateY(100%);
          transition: transform .42s cubic-bezier(.32,.72,0,1);
        }
        .pg-sheet.in { transform: translateY(0); }
        .pg-grab {
          width: 38px; height: 4px; border-radius: 99px;
          background: var(--border); margin: 9px auto 3px; flex: none;
        }
        .pg-sheet-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; padding: 8px 20px 14px; flex: none; flex-wrap: wrap;
          border-bottom: 1px solid var(--border);
        }
        .pg-sheet-title { font-size: 16px; font-weight: 650; letter-spacing: -.015em; }
        .pg-sheet-sub { font-size: 11.5px; color: var(--muted); margin-top: 1px; }
        .pg-sheet-actions { display: flex; align-items: center; gap: 10px; }
        .pg-close {
          width: 30px; height: 30px; border-radius: 99px;
          border: 1px solid var(--border); background: var(--panel-2);
          color: var(--muted); font-size: 13px; cursor: pointer;
          display: grid; place-items: center;
          transition: background .14s ease, color .14s ease;
        }
        .pg-close:hover { background: var(--hover); color: var(--foreground); }
        .pg-sheet-body { flex: 1; min-height: 0; padding: 0 6px 6px; }

        @media (max-width: 720px) {
          .pg-sheet { height: 96vh; }
        }
      `}</style>
    </div>
  );
}
