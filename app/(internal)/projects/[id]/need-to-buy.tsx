"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RfqDialog } from "@/app/(internal)/rfqs/rfq-dialog";
import { OrderDialog } from "@/app/(internal)/orders/order-dialog";
import { createClient } from "@/lib/supabase/browser";
import type { Provider } from "@/lib/types";
export function NeedToBuy({
  projectId,
  items,
}: {
  projectId: string;
  items: {
    producto_id: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
  }[];
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="space-y-2">
      <p>
        Necesidad de compra: elegí cotizar o compra directa. El faltante no crea
        RFQ ni OC automáticamente.
      </p>
      <RfqDialog
        projectId={projectId}
        initialItems={items}
        trigger={<Button variant="secondary">COTIZAR</Button>}
      />
      <Button
        variant="secondary"
        onClick={async () => {
          const r = await createClient()
            .from("providers")
            .select("*")
            .eq("active", true)
            .order("name");
          if (r.error) setError(r.error.message);
          else {
            setProviders(r.data ?? []);
            setOpen(true);
          }
        }}
      >
        COMPRA DIRECTA
      </Button>
      {open && (
        <OrderDialog
          key="need-direct"
          providers={providers}
          projectId={projectId}
          defaultOpen
          initialItems={items.map((i) => ({
            product: i.descripcion,
            quantity: i.cantidad,
            unit: i.unidad,
            producto_id: i.producto_id,
          }))}
          onClosed={() => setOpen(false)}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
