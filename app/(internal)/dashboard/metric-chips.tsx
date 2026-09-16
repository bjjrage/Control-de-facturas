import Link from "next/link";
import { DASHBOARD_ICONS } from "./icon-map";
import { MetricChip } from "./data";

const TONE_CLASSES: Record<MetricChip["tone"], string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  error: "bg-[var(--error-bg)] text-[var(--error)]",
};

const TONE_RING: Record<MetricChip["tone"], string> = {
  ok: "",
  warn: "ring-1 ring-[var(--warn)]/25",
  error: "ring-1 ring-[var(--error)]/30",
};

// Mismo glow parejo (box-shadow en todo el perímetro, no drop-shadow que
// solo se nota abajo) que se usa en los chips del panorama de obras.
const TONE_GLOW: Record<MetricChip["tone"], string> = {
  ok: "hover:shadow-[0_0_0_1px_rgba(45,212,191,0.35),0_0_16px_2px_rgba(45,212,191,0.25)]",
  warn: "hover:shadow-[0_0_0_1px_rgba(245,165,36,0.35),0_0_16px_2px_rgba(245,165,36,0.25)]",
  error: "hover:shadow-[0_0_0_1px_rgba(242,104,92,0.35),0_0_16px_2px_rgba(242,104,92,0.25)]",
};

// Fila de KPIs atómicos de una sección (Administración, Licitaciones) —
// mismo tamaño y forma siempre, el valor grande es el número que importa
// (monto o cantidad) y el label chico dice qué es. Reemplaza el chip único
// "por dominio" que resumía 4 métricas en una sola línea de texto: acá cada
// métrica tiene su propio lugar, como en el diseño original.
export function MetricChips({ chips }: { chips: MetricChip[] }) {
  if (chips.length === 0) return null;

  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${chips.length}, minmax(0, 1fr))` }}>
      {chips.map((chip) => {
        const Icon = DASHBOARD_ICONS[chip.iconKey];
        return (
          <Link
            key={chip.key}
            href={chip.href}
            className={`group rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 flex items-center gap-3 transition-shadow duration-200 ${TONE_GLOW[chip.tone]} ${TONE_RING[chip.tone]}`}
          >
            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${TONE_CLASSES[chip.tone]}`}>
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-none truncate">{chip.value}</div>
              <div className="text-[11px] text-[var(--muted)] mt-1 truncate">{chip.label}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
