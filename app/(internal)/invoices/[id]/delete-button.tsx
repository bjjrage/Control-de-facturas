"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceStatus } from "@/lib/types";
import { deleteInvoice } from "./actions";

export function canHardDeleteInvoice(status: InvoiceStatus) {
  return status !== "APTO_PARA_PAGO" && status !== "PAGADO";
}

/**
 * Admin-only hard delete. Used both on the invoice detail page (full button,
 * navigates back to the list afterward) and inline in the Facturas list rows
 * (compact icon, just refreshes the current list in place).
 */
export function DeleteInvoiceButton({
  invoiceId,
  status,
  redirectTo,
  compact,
  onDeleted,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  redirectTo?: string;
  compact?: boolean;
  onDeleted?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (!confirm("¿Eliminar esta factura? No se puede deshacer.")) return;
    setPending(true);
    const result = await deleteInvoice(invoiceId);
    if (result?.error) {
      alert(`No se pudo eliminar: ${result.error}`);
      setPending(false);
      return;
    }
    if (redirectTo) {
      router.push(redirectTo);
    } else if (onDeleted) {
      onDeleted();
      setPending(false);
    } else {
      router.refresh();
      setPending(false);
    }
  }

  if (!canHardDeleteInvoice(status)) return null;

  if (compact) {
    return (
      <Button
        type="button"
        variant="danger"
        size="icon"
        disabled={pending}
        onClick={handleClick}
        title="Eliminar factura"
      >
        <Trash2 size={14} />
      </Button>
    );
  }

  return (
    <Button variant="danger" disabled={pending} onClick={handleClick}>
      {pending ? "Eliminando…" : "Eliminar factura"}
    </Button>
  );
}
