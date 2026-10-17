"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { createCostRfqsFromProject, type CostRfqCreationResult } from "./costeo-actions";

export function CostRfqDialog({ projectId, onCreated }: { projectId: string; onCreated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CostRfqCreationResult | null>(null);
  const submitting = useRef(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!submitting.current) setOpen(next); }}>
    <DialogTrigger asChild><Button variant="secondary">Cotizar insumos</Button></DialogTrigger>
    <DialogContent title={<span className="inline-flex items-center gap-1.5">Cotizar insumos<InfoTooltip label="Cotizar insumos" content="Agrupa los materiales del presupuesto por rubro. La solicitud sirve para Costeo y no crea órdenes de compra." /></span>}>
      {error && <p role="alert" className="mt-3 text-[13px] text-[var(--error)]">{error}</p>}
      {result && <div role="status" className="my-3 rounded-lg border-2 border-[var(--border)] bg-[var(--panel-2)] p-3 text-[13px] space-y-2">
        {result.sinInsumos ? <p>La obra todavía no tiene materiales en sus recetas APU.</p> : <>
          {!result.creadas.length && <p>No se creó ningún pedido de precios.</p>}
          {result.creadas.map((rfq) => <p key={rfq.rfqId}><Link className="text-action" href={"/rfqs/" + rfq.rfqId}>{rfq.code}</Link> · {rfq.rubro} · {rfq.items} ítems · {rfq.proveedores} proveedores</p>)}
          {result.rubrosSinProveedores.map((rubro) => <p key={rubro.rubro}>Sin proveedores para {rubro.rubro}: {rubro.items} ítems.</p>)}
          {!!result.insumosSinRubro.length && <p>Materiales sin rubro: {result.insumosSinRubro.join(", ")}</p>}
        </>}
      </div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cerrar</Button>
        <Button type="button" disabled={pending || !!result?.creadas.length} onClick={async () => {
          if (submitting.current) return;
          submitting.current = true;
          setPending(true);
          setError(null);
          try {
            const response = await createCostRfqsFromProject(projectId);
            if (response.error) setError(response.error);
            else {
              setResult(response.data);
              if (response.data?.creadas.length) { router.refresh(); onCreated?.(); }
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudieron pedir los precios.");
          } finally { submitting.current = false; setPending(false); }
        }}>{pending ? "Solicitando…" : "Solicitar precios"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
