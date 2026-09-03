"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function parseYm(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return { y, m };
}
function toYm(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}
function shift(ym: string, delta: number) {
  const { y, m } = parseYm(ym);
  const d = new Date(y, m - 1 + delta, 1);
  return toYm(d.getFullYear(), d.getMonth() + 1);
}

export function MonthFilter({ month }: { month: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const now = new Date();
  const currentYm = toYm(now.getFullYear(), now.getMonth() + 1);
  const selected = month && month !== "all" ? month : null;
  const anchor = selected ?? currentYm;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parseYm(anchor).y);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function go(next: string | "all") {
    const p = new URLSearchParams(params.toString());
    if (next === "all") p.delete("month");
    else p.set("month", next);
    setOpen(false);
    router.push(`/invoices?${p.toString()}`);
  }

  const label = selected
    ? `${MONTHS[parseYm(selected).m - 1]} ${parseYm(selected).y}`
    : "Todas las fechas";

  return (
    <div ref={wrapRef} className="relative">
      <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Mes</label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          className="h-8 w-8 px-0"
          disabled={!selected}
          onClick={() => go(shift(anchor, -1))}
          aria-label="Mes anterior"
        >
          <ChevronLeft size={15} />
        </Button>

        <button
          type="button"
          onClick={() => {
            setViewYear(parseYm(anchor).y);
            setOpen((o) => !o);
          }}
          className="h-8 w-48 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px] flex items-center justify-between hover:border-[var(--primary)]"
        >
          <span>{label}</span>
          <Calendar size={14} className="text-[var(--muted)]" />
        </button>

        <Button
          type="button"
          variant="secondary"
          className="h-8 w-8 px-0"
          disabled={!selected}
          onClick={() => go(shift(anchor, 1))}
          aria-label="Mes siguiente"
        >
          <ChevronRight size={15} />
        </Button>

        <button
          type="button"
          onClick={() => go(selected ? "all" : currentYm)}
          className={`h-8 rounded-md border px-3 text-[12px] font-medium transition-colors ${
            !selected
              ? "border-[var(--primary)] bg-[var(--primary)] text-white"
              : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--primary)]"
          }`}
        >
          Todas
        </button>
      </div>

      {open ? (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg">
          <div className="flex items-center justify-between px-1 py-1">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="h-7 w-7 rounded hover:bg-[var(--hover)] flex items-center justify-center"
              aria-label="Año anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-semibold">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="h-7 w-7 rounded hover:bg-[var(--hover)] flex items-center justify-center"
              aria-label="Año siguiente"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 p-1">
            {MONTHS_SHORT.map((m, i) => {
              const ym = toYm(viewYear, i + 1);
              const isSelected = ym === selected;
              const isCurrent = ym === currentYm;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => go(ym)}
                  className={`h-8 rounded text-[12px] transition-colors ${
                    isSelected
                      ? "bg-[var(--primary)] text-white font-medium"
                      : isCurrent
                        ? "bg-[var(--primary-bg)] text-[var(--primary)]"
                        : "hover:bg-[var(--hover)]"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => go("all")}
            className={`mt-1 w-full h-8 rounded text-[12px] transition-colors ${
              !selected ? "bg-[var(--primary)] text-white font-medium" : "hover:bg-[var(--hover)] text-[var(--muted)]"
            }`}
          >
            Todas las fechas
          </button>
        </div>
      ) : null}
    </div>
  );
}
