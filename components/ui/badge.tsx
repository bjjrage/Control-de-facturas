import { cn } from "@/lib/cn";

type Tone = "ok" | "warn" | "error" | "neutral";

const tones: Record<Tone, string> = {
  ok: "bg-[var(--ok-bg)]/72 text-[#effdf8] ring-1 ring-[var(--ok)]/20",
  warn: "bg-[var(--warn-bg)]/72 text-[#fff8e8] ring-1 ring-[var(--warn)]/20",
  error: "bg-[var(--error-bg)]/72 text-[#fff1ef] ring-1 ring-[var(--error)]/20",
  neutral: "bg-white/[0.055] text-[var(--muted)] ring-1 ring-white/[0.06]",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[0.01em]",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  BORRADOR: "neutral",
  COTIZANDO: "warn",
  OFERTAS_RECIBIDAS: "warn",
  OFERTA_SELECCIONADA: "ok",
  AUTORIZADO: "ok",
  FACTURADO: "warn",
  CONCILIADO: "ok",
  APTO_PARA_PAGO: "ok",
  PAGADO: "ok",
  CANCELADO: "error",
  RECHAZADO: "error",
  DIFERENCIA: "error",
  REQUIERE_REVISION: "error",
  PENDIENTE: "neutral",
  MATCH: "ok",
  APROBADO_EXCEPCION: "warn",
  ABIERTO: "warn",
  RESPONDIDO: "ok",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>
  );
}
