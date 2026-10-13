"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MultiItemQuoteForm, type PortalRfqItem } from "@/app/cotizar/[token]/multi-item-quote-form";

export function InternalQuoteDialog({ providerId, providerName, items }: {
  providerId: string; providerName: string; items: PortalRfqItem[];
}) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="secondary" size="sm">Cargar presupuesto</Button></DialogTrigger>
    <DialogContent title={`Cargar precios de ${providerName}`} className="max-w-3xl">
      <p className="text-[12px] text-[var(--muted)]">Se registra la carga interna y se conserva el documento original del proveedor.</p>
      <MultiItemQuoteForm token={providerId} items={items} internal />
    </DialogContent>
  </Dialog>;
}
