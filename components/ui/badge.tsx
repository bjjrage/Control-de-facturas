import { cn } from "@/lib/cn";

type Tone = "ok" | "warn" | "error" | "neutral";

const tones: Record<Tone, string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  error: "bg-[var(--error-bg)] text-[var(--error)]",
  neutral: "bg-[var(--neutral-bg)] text-[var(--muted)]",
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
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none",
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
