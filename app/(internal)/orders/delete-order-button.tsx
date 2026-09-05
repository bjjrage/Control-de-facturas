"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteOrder } from "./actions";

/**
 * Admin-only hard delete. La server action ya valida que no tenga facturas
 * vinculadas — acá solo se oculta el botón cuando facturado_amount > 0 para
 * no invitar a un click que va a fallar.
 */
export function DeleteOrderButton({
  orderId,
  redirectTo,
  compact,
}: {
  orderId: string;
  redirectTo?: string;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    if (!confirm("¿Eliminar esta orden de compra? No se puede deshacer.")) return;
    setPending(true);
    setError(null);
    const result = await deleteOrder(orderId);
    if (result?.error) {
      setError(result.error);
      setPending(false);
      return;
    }
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.refresh();
      setPending(false);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        title={error ?? "Eliminar orden"}
        className="text-[var(--muted)] hover:text-[var(--error)] disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="danger" disabled={pending} onClick={handleClick}>
        {pending ? "Eliminando…" : "Eliminar"}
      </Button>
      {error ? <span className="text-[12px] text-[var(--error)]">{error}</span> : null}
    </div>
  );
}
