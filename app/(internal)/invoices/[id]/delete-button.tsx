"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteInvoice } from "./actions";

/**
 * Admin-only hard delete. Used both on the invoice detail page (full button,
 * navigates back to the list afterward) and inline in the Facturas list rows
 * (compact icon, just refreshes the current list in place).
 */
export function DeleteInvoiceButton({
  invoiceId,
  redirectTo,
  compact,
}: {
  invoiceId: string;
  redirectTo?: string;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (!confirm("¿Eliminar esta factura? No se puede deshacer.")) return;
    setPending(true);
    await deleteInvoice(invoiceId);
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
        title="Eliminar factura"
        className="text-[var(--muted)] hover:text-[var(--error)] disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    );
  }

  return (
    <Button variant="danger" disabled={pending} onClick={handleClick}>
      {pending ? "Eliminando…" : "Eliminar factura"}
    </Button>
  );
}
