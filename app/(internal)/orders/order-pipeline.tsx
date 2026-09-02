import { ORDER_STEPS, orderStep } from "@/lib/reconciliation";

export function OrderPipeline({
  status,
  totalPrice,
  facturadoAmount,
  size = "compact",
}: {
  status: string;
  totalPrice: number;
  facturadoAmount: number;
  size?: "compact" | "full";
}) {
  const step = orderStep({ status, totalPrice, facturadoAmount });

  if (size === "compact") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          {ORDER_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-4 rounded-full ${i <= step ? "bg-[var(--primary)]" : "bg-[var(--hover)]"}`}
            />
          ))}
        </div>
        <span className="text-[11px] text-[var(--muted)]">{ORDER_STEPS[step]}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center">
      {ORDER_STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                i < step
                  ? "bg-[var(--primary)]"
                  : i === step
                    ? "bg-[var(--primary)] ring-2 ring-[var(--primary)]/30"
                    : "bg-[var(--hover)] border border-[var(--border)]"
              }`}
            />
            <span className={`text-[11px] ${i === step ? "text-[var(--foreground)] font-medium" : "text-[var(--muted)]"}`}>
              {label}
            </span>
          </div>
          {i < ORDER_STEPS.length - 1 ? (
            <span className={`mx-2 mb-4 h-px w-10 ${i < step ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
