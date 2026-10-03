"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RfqDialog } from "@/app/(internal)/rfqs/rfq-dialog";
import { OrderDialog } from "@/app/(internal)/orders/order-dialog";
import { createClient } from "@/lib/supabase/browser";
import type { Provider } from "@/lib/types";
import { refreshWeeklyPlanNeedsAction, type NeedRefreshResult } from "../weekly-plan-need-actions";
import type { NeedOrigin } from "@/lib/procurement/need-origin";

export function NeedToBuy({projectId,planId,disabled,seen}: {
  projectId:string; planId?:string; disabled:boolean; seen:Record<string,unknown>;
}) {
  const [current,setCurrent]=useState<NeedRefreshResult|null>(null);
  const [providers,setProviders]=useState<Provider[]>([]);
  const [open,setOpen]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const needs=current?.needs.filter(n=>Number(n.quantity)>0) ?? [];
  const available=needs.filter(n=>!n.decision || (n.decision.kind==="DIRECT_PURCHASE" && !n.decision.order_id));
  const ids=available.map(n=>n.id);
  const origin:NeedOrigin|undefined=current && planId && ids.length ? {
    planId,snapshotId:current.snapshot_id,needIds:ids,seen,
  }:undefined;
  const items=current?.coverage.lines.filter(l=>available.some(n=>n.producto_id===l.producto_id))
    .map(l=>({producto_id:l.producto_id,descripcion:l.producto_nombre,cantidad:l.comprar,unidad:l.unidad_medida})) ?? [];
  const shown = Array.isArray(seen.coverage) ? seen.coverage as Array<{producto_id:string;comprar:number}> : [];
  const changed = current?.coverage.lines.some(l=>shown.find(s=>s.producto_id===l.producto_id)?.comprar!==l.comprar);
  return <section className="space-y-2">
    <p>Necesidad de compra: verificá las fuentes actuales y elegí cotizar o compra directa. El cálculo no crea RFQ ni OC.</p>
    {!planId && <p>Guardá el plan para conservar la necesidad y su provenance.</p>}
    {disabled && <p>Guardá y recalculá las metas actuales antes de comprar.</p>}
    <Button variant="secondary" disabled={!planId || disabled || pending} onClick={async()=>{
      setPending(true);setError("");setCurrent(null);
      try {const result=await refreshWeeklyPlanNeedsAction(planId!,seen);
        if(result.error) setError(result.error); else setCurrent(result.data);
      } catch(e){setError(e instanceof Error?e.message:"No se pudo verificar la necesidad");}
      finally {setPending(false);}
    }}>Verificar necesidad actual</Button>
    {current && !disabled && <div>
      <p>Necesidad verificada: obra + central disponible + suministro autorizado a tiempo. Revisá las cantidades actuales antes de continuar.</p>
      {changed && <p role="status">El faltante cambió desde el cálculo mostrado. Las acciones usarán las cantidades actuales de abajo.</p>}
      {current.coverage.lines.map(l=>{const n=current.needs.find(n=>n.producto_id===l.producto_id);return <p key={l.producto_id}>
        {l.producto_nombre}: requerido {l.requerido}, obra {l.cubierto_obra}, central {l.cubierto_central}, entrante {l.cubierto_inbound}, faltante {l.comprar} {l.unidad_medida}.
        {n?.decision?.rfq_id && <> RFQ existente: <a href={"/rfqs/"+n.decision.rfq_id}>Abrir</a>.</>}
        {n?.decision?.direct_purchase_preview_id && <> Compra directa iniciada. Reabrí el preview con COMPRA DIRECTA o revisá la OC en Compras.</>}
      </p>})}
      {current.history?.map(d=><p key={d.id}>Decisión anterior: {d.kind}. {d.rfq_id && <a href={"/rfqs/"+d.rfq_id}>RFQ</a>} {d.order_id && <a href={"/orders/"+d.order_id}>OC confirmada</a>}</p>)}
      {origin && <>
        <RfqDialog key={"rfq-"+current.snapshot_id} projectId={projectId} initialItems={items} needOrigin={origin}
          trigger={<Button variant="secondary">COTIZAR</Button>}/>
        <Button variant="secondary" disabled={pending} onClick={async()=>{
          setPending(true);setError("");
          try {const r=await createClient().from("providers").select("*").eq("active",true).order("name");
            if(r.error)setError(r.error.message);else{setProviders(r.data ?? []);setOpen(true);}}
          catch(e){setError(e instanceof Error?e.message:"No se pudieron consultar proveedores");}finally{setPending(false);}
        }}>COMPRA DIRECTA</Button>
        {open && <OrderDialog key={"direct-"+current.snapshot_id} providers={providers} projectId={projectId} defaultOpen
          needOrigin={origin} initialItems={items.map(i=>({product:i.descripcion,quantity:i.cantidad,unit:i.unidad,producto_id:i.producto_id}))}
          onClosed={()=>{setOpen(false);setCurrent(null);}}/>}
      </>}
      {!needs.length && <p>Sin faltante: no se inicia ninguna compra.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
