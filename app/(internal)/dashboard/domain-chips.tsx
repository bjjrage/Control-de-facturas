import Link from "next/link";
import { DASHBOARD_ICONS } from "./icon-map";
import { DomainChip, DomainTone } from "./data";

const TONE_CLASSES: Record<DomainTone, string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  error: "bg-[var(--error-bg)] text-[var(--error)]",
};

const TONE_RING: Record<DomainTone, string> = {
  ok: "",
  warn: "ring-1 ring-[var(--warn)]/25",
  error: "ring-1 ring-[var(--error)]/30",
};

// Un chip por área de negocio, todos exactamente del mismo tamaño — la señal
// más urgente de esa área, nada más. Reemplaza el banner gigante de
// "Requiere atención" + los KPIs sueltos de tamaños distintos que había
// antes: acá la jerarquía es horizontal y simétrica, no una pila de cajas de
// alturas distintas compitiendo entre sí.
export function DomainChips({ chips }: { chips: DomainChip[] }) {
  if (chips.length === 0) return null;

  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${chips.length}, minmax(0, 1fr))` }}>
      {chips.map((chip) => {
        const Icon = DASHBOARD_ICONS[chip.iconKey];
        return (
          <Link
            key={chip.key}
            href={chip.href}
            className={`group rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 flex items-center gap-3 transition-all duration-150 hover:border-[var(--foreground)]/15 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_-8px_rgba(255,255,255,0.12)] ${TONE_RING[chip.tone]}`}
          >
            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${TONE_CLASSES[chip.tone]}`}>
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold truncate">{chip.label}</div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate">{chip.status}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
