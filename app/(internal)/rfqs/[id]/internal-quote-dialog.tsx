"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MultiItemQuoteForm, type PortalRfqItem } from "@/app/cotizar/[token]/multi-item-quote-form";
import styles from "@/app/cotizar/[token]/quote-form.module.css";

export function InternalQuoteDialog({ providerId, providerName, items }: {
  providerId: string; providerName: string; items: PortalRfqItem[];
}) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="secondary" size="sm">Cargar presupuesto</Button></DialogTrigger>
    <DialogContent title={`Cargar presupuesto · ${providerName}`} className={styles.dialog}>
      <MultiItemQuoteForm token={providerId} items={items} internal onClose={() => setOpen(false)} />
    </DialogContent>
  </Dialog>;
}
