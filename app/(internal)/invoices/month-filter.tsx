"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

function ymToLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const label = new Intl.DateTimeFormat("es-PY", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1)
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shift(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Rango de meses para el dropdown: 24 atrás + 2 adelante desde hoy. */
function monthOptions(current: string) {
  const now = new Date();
  const set = new Set<string>();
  for (let i = 24; i >= -2; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  if (current && current !== "all") set.add(current);
  return [...set].sort().reverse();
}

export function MonthFilter({ month }: { month: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = month ?? "all";

  function go(next: string) {
    const p = new URLSearchParams(params.toString());
    if (next === "all") p.delete("month");
    else p.set("month", next);
    router.push(`/invoices?${p.toString()}`);
  }

  const base = current === "all"
    ? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    : current;

  return (
    <div className="flex items-end gap-1.5">
      <div>
        <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Mes</label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            className="h-8 w-8 px-0"
            onClick={() => go(shift(base, -1))}
            aria-label="Mes anterior"
          >
            <ChevronLeft size={15} />
          </Button>
          <Select
            value={current === "all" ? "all" : current}
            onChange={(e) => go(e.target.value)}
            className="w-44"
          >
            <option value="all">Todas las fechas</option>
            {monthOptions(current).map((ym) => (
              <option key={ym} value={ym}>
                {ymToLabel(ym)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            className="h-8 w-8 px-0"
            onClick={() => go(shift(base, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}
