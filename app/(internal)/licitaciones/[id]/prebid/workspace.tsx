"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/browser";
import { convertirLicitacionAProyecto } from "../../actions";
import { formatMoney } from "@/lib/format";
import type { MaterialPriceDetail } from "@/lib/costing/project-prices";
import { DEFAULT_COST_SETTINGS, normalizeCostSettings, type CostSettingsV2 } from "@/lib/workspace/costs";
import {
  loadPrebidWorkspaceAction, saveWorkspaceBudgetItemAction, importTenderComputoAction,
  saveWorkspaceApuLineAction, deleteWorkspaceApuLineAction, adoptWorkspacePriceAction, createWorkspaceDiscoveryAction,
  savePrebidSettingsAction, savePrebidVersionAction, recordPrebidOutcomeAction,
  getWorkspaceBimUploadAction, registerWorkspaceBimAction, applyWorkspaceBimQuantityAction,
} from "@/lib/workspace/actions";

type Data = NonNullable<Awaited<ReturnType<typeof loadPrebidWorkspaceAction>>["data"]>;
const inputClass = "";
const apuCategories = [{kind:"MATERIAL" as const,label:"Materiales"},{kind:"LABOR" as const,label:"Mano de obra"},{kind:"EQUIPMENT" as const,label:"Equipos"},{kind:"SUBCONTRACT" as const,label:"Subcontratos"}];
const tabs = ["Cómputo", "BIM", "APU", "Costeo y evidencia", "Presupuesto / Oferta", "Versiones y resultado"];
export function PrebidWorkspace({ data }: { data: Data }) {
  const router = useRouter(); const context = data.facts.context;
  const [tab, setTab] = useState(tabs[0]); const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(""); const [settings, setSettings] = useState<CostSettingsV2>(()=>normalizeCostSettings(data.facts.settings ?? DEFAULT_COST_SETTINGS));
  const [addingItem, setAddingItem] = useState(false);
  const [itemId, setItemId] = useState(data.facts.items[0]?.id ?? "");
  const [apuKind,setApuKind] = useState<"MATERIAL"|"LABOR"|"EQUIPMENT"|"SUBCONTRACT">("MATERIAL");
  const [selectedProviders,setSelectedProviders] = useState<string[]>([]); const [selectedElements,setSelectedElements] = useState<string[]>([]);
  const readOnly = data.readOnly;
  function run(work:()=>Promise<{ error: string|null; data?: unknown }>) {
    setMessage(""); startTransition(async()=>{try { const r=await work(); if(r.error) setMessage(r.error); else {setMessage("Guardado.");router.refresh();} }catch(e){setMessage(e instanceof Error?e.message:"Error.");}});
  }
  const disabled = readOnly || pending;
  const money = (n:number|null|undefined)=>n==null?"Pendiente":formatMoney(n,"PYG");
  const offer = data.costs.offer;
  return <main className="max-w-7xl space-y-5 text-[13px] [&_label]:block [&_label]:space-y-1.5 [&_label]:text-[12px] [&_label]:text-[var(--muted)]" data-testid="prebid-workspace">
    <Link href={`/licitaciones/${context.id}`} className="text-sm underline">Volver a licitación</Link>
    <header className="space-y-1"><h1 className="text-xl font-semibold">{data.owner.titulo}</h1>
      <p>Workspace PREBID · {data.offer?.estado ?? "BORRADOR"} · PYG</p>
      {readOnly && <p className="text-sm">Snapshot comercial conservado. Cómputo, costos y evidencia en modo lectura.</p>}
      {data.readyForProjectHandoff && <p className="font-semibold text-[var(--ok)]">READY FOR PROJECT HANDOFF · Monto adjudicado confirmado: {money(Number(data.offer?.awarded_amount))}</p>}
      {data.handoffProject ? <Link href={`/projects/${data.handoffProject.id}`} className="underline">Abrir obra {data.handoffProject.code}</Link> : data.readyForProjectHandoff && <Button disabled={pending} onClick={() => {
        if (!confirm("¿Crear la obra desde el snapshot ganador y la adjudicación confirmada? La historia de la licitación se conserva.")) return;
        startTransition(async () => { const r = await convertirLicitacionAProyecto(context.id, true); if (r.error) setMessage(r.error); else if (r.projectId) router.push(`/projects/${r.projectId}`); });
      }}>Crear obra desde oferta ganadora</Button>}
    </header>
    <nav aria-label="Etapas PREBID" className="flex flex-wrap gap-2">{tabs.map(t=><Button key={t} variant={tab===t?"primary":"secondary"} onClick={()=>setTab(t)}>{t}</Button>)}</nav>
    {message && <p role="status" className="erp-surface-strong rounded-lg p-4">{message}</p>}

    {tab===tabs[0] && <section className="erp-surface rounded-xl space-y-4 p-4 sm:p-5"><h2 className="font-semibold">Cómputo métrico de la licitación</h2>
      <div className="erp-toolbar flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={disabled} onClick={()=>run(()=>importTenderComputoAction(context.id))}>Importar ítems de licitación</Button>
        <Button variant="secondary" disabled={disabled} onClick={()=>run(async()=>{
          const r=await fetch("/api/planillas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({modulo:"computo_presupuesto",contexto:context})});
          const body=await r.json();if(!r.ok)return {error:body.error};router.push(`/planillas/${body.id}?volver=${encodeURIComponent(`/licitaciones/${context.id}/prebid`)}`);return {error:null};
        })}>Abrir planilla de Cómputo</Button></div>
      <div className="erp-table-shell overflow-x-auto"><table className="w-full text-sm"><caption className="px-3 py-2 text-left font-semibold">Partidas del cómputo · {data.facts.items.length}</caption><thead><tr><th>Código</th><th>Partida</th><th>Unidad</th><th>Cantidad</th><th /></tr></thead><tbody>{data.facts.items.map(item=><tr key={item.id} className="border-b"><td>{item.code}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.quantity}</td><td><Button disabled={disabled} variant="secondary" onClick={()=>{setItemId(item.id);setTab(tabs[2]);}}>APU</Button></td></tr>)}</tbody></table>{!data.facts.items.length && <p className="p-4 text-[var(--muted)]">Todavía no hay partidas. Importá los ítems existentes o agregá una partida manual.</p>}</div>
      <Button variant="secondary" aria-expanded={addingItem} onClick={()=>setAddingItem(v=>!v)} disabled={disabled}>{addingItem?"Cerrar alta":"+ Agregar partida"}</Button>
      {addingItem && <form className="erp-surface-strong rounded-lg grid max-w-5xl items-end gap-3 p-4 sm:grid-cols-[7rem_minmax(12rem,1fr)_5rem_8rem_auto]" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run(()=>saveWorkspaceBudgetItemAction(context,{code:String(f.get("code")),description:String(f.get("description")),unit:String(f.get("unit")),quantity:Number(f.get("quantity"))}));}}>
        <label>Código<Input name="code" required disabled={disabled} className={inputClass}/></label><label>Descripción<Input name="description" required disabled={disabled} className={inputClass}/></label>
        <label>Unidad<Input name="unit" required disabled={disabled} className={inputClass}/></label><label>Cantidad<Input name="quantity" type="number" min="0.0001" step="any" required disabled={disabled} className={inputClass}/></label><Button type="submit" disabled={disabled}>Agregar partida</Button>
      </form>}</section>}

    {tab===tabs[1] && <section className="erp-surface rounded-xl space-y-4 p-4 sm:p-5"><h2 className="font-semibold">BIM de la licitación</h2><p className="text-sm">Importá IFC y confirmá qué elementos corresponden a una partida. Se conservan cantidad, unidad y procedencia de la medición.</p>
      <label>Modelo IFC<input type="file" accept=".ifc" disabled={disabled} onChange={e=>{const file=e.target.files?.[0];if(!file)return;run(async()=>{
        const slot=await getWorkspaceBimUploadAction(context,file.name);if(slot.error||!slot.data)return {error:slot.error};
        const {parseIfcFile}=await import("@/lib/bim/ifc-parser.client");const parsed=await parseIfcFile(file,setMessage);
        const db=createClient();const upload=await db.storage.from("bim-models").upload(slot.data.storagePath,file,{upsert:false,contentType:"application/octet-stream"});
        if(upload.error)return {error:upload.error.message};return registerWorkspaceBimAction(context,file.name,slot.data.storagePath,parsed.schema,parsed.elements);
      });}} /></label>
      {data.facts.bim_models.map(m=><p key={m.id}>{m.file_name} · {m.element_count} elementos · {m.status}</p>)}
      <label>Partida destino<Select value={itemId} onChange={e=>setItemId(e.target.value)} disabled={disabled} className={inputClass}>{data.facts.items.map(i=><option key={i.id} value={i.id}>{i.code} · {i.description} ({i.unit})</option>)}</Select></label>
      <div className="max-h-96 overflow-auto">{data.facts.bim_elements.map(el=><label key={el.id} className="flex gap-2 border-b py-1"><input type="checkbox" disabled={disabled||el.quantity_value==null} checked={selectedElements.includes(el.id)} onChange={e=>setSelectedElements(ids=>e.target.checked?[...ids,el.id]:ids.filter(id=>id!==el.id))}/><span>{el.name??el.ifc_type} · {el.quantity_value??"Sin medición"} {el.quantity_unit} · {el.quantity_property}</span></label>)}</div>
      <Button disabled={disabled||!itemId||!selectedElements.length} onClick={()=>run(()=>applyWorkspaceBimQuantityAction(context,itemId,selectedElements))}>Confirmar correspondencia y cantidad</Button>
    </section>}

    {tab===tabs[2] && <section className="erp-surface rounded-xl space-y-4 p-4 sm:p-5"><h2 className="font-semibold">APU</h2>
      <p className="text-[var(--muted)]">Cada componente expresa el consumo o las horas necesarios para ejecutar una unidad de la partida.</p><label className="max-w-xl">Partida<Select className={inputClass} value={itemId} onChange={e=>setItemId(e.target.value)}>{data.facts.items.map(i=><option key={i.id} value={i.id}>{i.code} · {i.description}</option>)}</Select></label>
      <div className="segmented-control flex flex-wrap gap-1" aria-label="Categoría APU">{apuCategories.map(c=><button type="button" key={c.kind} aria-pressed={apuKind===c.kind} onClick={()=>setApuKind(c.kind)} className={`segmented-item px-3 py-2 ${apuKind===c.kind?"segmented-item-active":""}`}>{c.label}</button>)}</div>
      {[{kind:"MATERIAL" as const,rows:data.facts.materials},{kind:"LABOR" as const,rows:data.facts.labor},{kind:"EQUIPMENT" as const,rows:data.facts.equipment},{kind:"SUBCONTRACT" as const,rows:data.facts.subcontracts}].filter(g=>g.kind===apuKind).map(group=><div key={group.kind} className="erp-table-shell overflow-x-auto"><table><thead><tr><th>Componente</th><th>Consumo / horas por unidad</th><th>Desperdicio %</th><th>Costo de referencia</th><th>Acción</th></tr></thead><tbody>{group.rows.filter(l=>l.budget_item_id===itemId).map(l=><tr key={l.id}><td>{data.products.find(p=>p.id===l.producto_id)?.nombre??l.rol??l.tipo_equipo??l.descripcion}</td><td>{l.cantidad_por_unidad_ejecutada??l.horas_por_unidad_ejecutada??1}</td><td>{l.desperdicio_pct??"—"}</td><td>{l.costo_hora??l.precio_por_unidad??"Precio del insumo: ver Costeo"}</td><td><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>run(()=>deleteWorkspaceApuLineAction(context,group.kind,l.id))}>Quitar</Button></td></tr>)}</tbody></table>{!group.rows.some(l=>l.budget_item_id===itemId)&&<p className="p-4 text-[var(--muted)]">{itemId?"Sin componentes en esta categoría.":"Agregá una partida en Cómputo para definir su APU."}</p>}</div>)}
      <form className="erp-surface-strong rounded-lg grid max-w-5xl items-end gap-3 p-4 sm:grid-cols-[minmax(12rem,1fr)_10rem_9rem_auto]" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(!itemId)return;run(()=>saveWorkspaceApuLineAction(context,apuKind==="MATERIAL"?{kind:apuKind,budgetItemId:itemId,productoId:String(f.get("product")),quantity:Number(f.get("quantity")),wastePct:Number(f.get("waste"))}:apuKind==="SUBCONTRACT"?{kind:apuKind,budgetItemId:itemId,description:String(f.get("description")),cost:Number(f.get("cost"))}:{kind:apuKind,budgetItemId:itemId,description:String(f.get("description")),quantity:Number(f.get("quantity")),cost:Number(f.get("cost"))}));}}>
        {apuKind==="MATERIAL"?<label>Insumo<Select name="product" required disabled={disabled} className={inputClass}>{data.products.map(p=><option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>)}</Select></label>:<label>Descripción<Input name="description" required disabled={disabled} className={inputClass}/></label>}
        {apuKind!=="SUBCONTRACT"&&<label>{apuKind==="MATERIAL"?"Consumo por unidad":"Horas por unidad"}<Input name="quantity" type="number" min="0.0001" step="any" required disabled={disabled} className={inputClass}/></label>}
        {apuKind==="MATERIAL"?<label>Desperdicio %<Input name="waste" type="number" min="0" max="100" defaultValue="0" step="any" disabled={disabled} className={inputClass}/></label>:<label>{apuKind==="SUBCONTRACT"?"Costo por unidad":"Costo hora"}<Input name="cost" type="number" min="0" step="any" required disabled={disabled} className={inputClass}/></label>}
        <Button disabled={disabled||!itemId} type="submit">Guardar APU</Button>
      </form>
    </section>}

    {tab===tabs[3] && <section className="erp-surface rounded-xl space-y-4 p-4 sm:p-5"><h2 className="font-semibold">Costeo y evidencia de precios</h2><p className="max-w-3xl text-[var(--muted)]">Revisá el costo de cada partida y la fuente del precio de sus materiales. Si falta evidencia, seleccioná proveedores y solicitá una cotización de referencia. Luego revisá la respuesta y adoptá el precio que usarás en la oferta.</p><ol className="flex flex-wrap gap-2 text-[12px]">{["1. Costo actual","2. Fuente / evidencia","3. Solicitar precio faltante","4. Revisar cotización","5. Adoptar precio"].map(step=><li key={step} className="erp-pill px-3 py-1.5">{step}</li>)}</ol>
      <table className="w-full text-sm"><thead><tr><th>Partida</th><th>Costo unitario</th><th>Costo directo</th><th>Estado</th></tr></thead><tbody>{data.facts.items.map(i=><tr key={i.id} className="border-b"><td>{i.code} · {i.description}</td><td>{money(data.costs.costs[i.id]?.costoUnitario)}</td><td>{money(data.costs.costs[i.id]?.costoTotal)}</td><td>{data.costs.costs[i.id]?.faltantes.length?"Falta precio":data.costs.costs[i.id]?.tieneApu?"Con APU":"Sin APU / capítulo"}</td></tr>)}</tbody></table>
      {!readOnly&&data.facts.products.length>0&&<fieldset className="erp-surface-strong p-3"><legend>Proveedores para solicitar precios</legend><div className="flex flex-wrap gap-3">{data.providers.map(p=><label key={p.id}><input type="checkbox" checked={selectedProviders.includes(p.id)} onChange={e=>setSelectedProviders(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/> {p.name}</label>)}</div></fieldset>}
      {!data.facts.products.length && <p className="erp-surface-strong rounded-lg p-4 text-[var(--muted)]">Agregá materiales al APU para revisar sus precios y solicitar cotizaciones. Las solicitudes de referencia no autorizan una compra.</p>}
      {data.facts.products.map(product=>{const options=(data.priceOptions as Record<string,MaterialPriceDetail>)[product.id];const price=data.costs.prices[product.id];return <article key={product.id} className="erp-surface-strong rounded-lg p-4 space-y-3"><h3>{product.nombre} · {product.unidad}</h3><p>Precio para costeo: {money(price?.precio)} · {price?.fuente??"FALTA EVIDENCIA"}{price?.adopted?" · adoptado por humano":""}</p>
        {!readOnly&&<><p className="text-sm">Última compra: {money(options?.lastPurchasePrice?.precio)} · CPP: {money(options?.costoPromedio)} · Cotización vigente: {money(options?.currentQuote?.precio)}. La cotización requiere adopción humana.</p>
          <Button disabled={pending||!selectedProviders.length} onClick={()=>run(()=>createWorkspaceDiscoveryAction(context,product.id,selectedProviders))}>Solicitar cotización de referencia</Button>
          <form className="flex max-w-md flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run(()=>adoptWorkspacePriceAction(context,{productoId:product.id,fuente:"MANUAL",precio:Number(f.get("price"))}));}}><label>Precio manual<Input name="price" type="number" min="0.0001" step="any" required className={inputClass}/></label><Button type="submit" disabled={pending}>Adoptar manual</Button></form>
          <table className="w-full text-sm"><thead><tr><th>RFQ</th><th>Proveedor</th><th>Precio cotizado</th><th>Vigencia</th><th /></tr></thead><tbody>{options?.quotes.map(q=><tr key={q.quoteVersionItemId}><td>{q.rfqCode}</td><td>{q.providerName}</td><td>{money(q.precio)}</td><td>{q.venceEl??"Revisar"}</td><td><Button disabled={pending} onClick={()=>run(()=>adoptWorkspacePriceAction(context,{productoId:product.id,fuente:"COTIZACION",quoteVersionItemId:q.quoteVersionItemId}))}>Adoptar precio</Button></td></tr>)}</tbody></table>
        </>}
      </article>})}
      <h3>Solicitudes de precio de esta licitación</h3>{data.facts.rfqs.map(r=><p key={r.id}><Link href={`/rfqs/${r.id}`} className="underline">{r.code} · Ver cotizaciones y comparación</Link></p>)}
    </section>}

    {tab===tabs[4] && <section className="erp-surface rounded-xl space-y-4 p-4 sm:p-5"><h2 className="font-semibold">Presupuesto / Oferta</h2><p className="text-sm">Los porcentajes usan el costo directo como base; los montos fijos se suman en PYG. El margen se calcula sobre venta.</p>
      {!offer && <p role="alert" className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] p-3">Costeo incompleto. Completá cantidades, APU y evidencia antes de presentar. La composición puede editarse, pero todavía no hay una oferta calculada.</p>}<div className="erp-surface-strong rounded-lg p-4"><p className="erp-kicker">Costo directo guardado</p><p className="mt-1 text-xl font-semibold">{money(offer?.directCost)}</p></div>
      <form className="max-w-5xl space-y-4" onSubmit={e=>{e.preventDefault();run(()=>savePrebidSettingsAction(context.id,settings));}}>
        {([['indirect','Indirectos']] as const).map(([key,label])=><ChargeInput key={key} label={label} charge={settings[key]} disabled={disabled} base={offer?.directCost??null} onChange={charge=>setSettings(s=>({...s,[key]:charge}))}/>) }
        <fieldset className="space-y-3 border rounded p-3"><legend>Gastos generales por concepto</legend>
          <p className="text-sm">Conceptos libres: administracion central, oficina de obra, logistica, seguros, garantias, servicios, movilidad u otros.</p>
          <div className="erp-table-shell overflow-x-auto"><table><thead><tr><th>Concepto</th><th>Modo / valor / resultado</th><th>Acción</th></tr></thead><tbody>{settings.generalItems.map(row=><tr key={row.id}><td className="min-w-48"><Input aria-label={`Concepto ${row.id}`} required disabled={disabled} maxLength={200} value={row.concept} onChange={e=>setSettings(s=>({...s,generalItems:s.generalItems.map(r=>r.id===row.id?{...r,concept:e.target.value}:r)}))}/></td><td><ChargeInput label={row.concept||'Gasto general'} charge={row} disabled={disabled} base={offer?.directCost??null} onChange={charge=>setSettings(s=>({...s,generalItems:s.generalItems.map(r=>r.id===row.id?{...r,...charge}:r)}))}/></td><td><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={()=>setSettings(s=>({...s,generalItems:s.generalItems.filter(r=>r.id!==row.id)}))}>Quitar</Button></td></tr>)}</tbody></table></div>
          <Button type="button" variant="secondary" disabled={disabled||settings.generalItems.length>=100} onClick={()=>setSettings(s=>({...s,generalItems:[...s.generalItems,{id:crypto.randomUUID(),concept:'',mode:'FIXED',value:0}]}))}>Agregar gasto general</Button>
        </fieldset>
        {([["financing","Financiación"],["risk","Riesgo"]] as const).map(([key,label])=><ChargeInput key={key} label={label} charge={settings[key]} disabled={disabled} base={offer?.directCost??null} onChange={charge=>setSettings(s=>({...s,[key]:charge}))}/>)}
        <label className="max-w-56">Margen sobre venta %<Input type="number" min="0" max="99" step="any" required disabled={disabled} value={settings.marginPct} onChange={e=>setSettings(s=>({...s,marginPct:Number(e.target.value)}))} className={inputClass}/></label>
        <p>Oferta = costo total / (1 - margen sobre venta / 100). Margen = oferta - costo total.</p>
        <Button type="submit" disabled={disabled}>Guardar composición</Button>
      </form>
      {offer&&<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Costos directos",offer.directCost],["Indirectos",offer.indirect],["Gastos generales",offer.general],["Financiación",offer.financing],["Riesgo",offer.risk],["Costo total",offer.totalCost],["Margen",offer.margin],["PRESUPUESTO / OFERTA",data.selectedVersion?.snapshot.offerAmount??offer.offerAmount]].map(([label,value])=><div key={String(label)} className="erp-surface-strong rounded-lg p-3"><dt>{label}</dt><dd className="font-semibold">{money(Number(value))}</dd></div>)}</dl>}
      {offer&&<table className="w-full text-sm"><caption>Gastos generales guardados</caption><thead><tr><th>Concepto</th><th>Base</th><th>% / monto</th><th>Resultado</th></tr></thead><tbody>{offer.generalItems.map(row=><tr key={row.id}><td>{row.concept}</td><td>{row.base==null?'Monto fijo':money(row.base)}</td><td>{row.mode==='PERCENT'?`${row.value}%`:money(row.value)}</td><td>{money(row.result)}</td></tr>)}</tbody></table>}
      <div className="erp-toolbar flex flex-wrap items-center gap-2"><Button disabled={disabled||!data.costs.complete||!data.hash} onClick={()=>run(()=>savePrebidVersionAction(context.id,false,data.hash!))} variant="secondary">Guardar versión</Button><Button disabled={disabled||!data.costs.complete||!data.hash} onClick={()=>{if(window.confirm("Presentar esta oferta y congelar cómputo, APU, costos y evidencia comercial?"))run(()=>savePrebidVersionAction(context.id,true,data.hash!));}}>PRESENTAR</Button></div>
    </section>}

    {tab===tabs[5] && <section className="erp-surface rounded-xl space-y-4 p-4 sm:p-5"><h2 className="font-semibold">Versiones y resultado humano</h2>
      <Link href={`/licitaciones/${context.id}/prebid`} className="underline">Oferta actual</Link>
      {data.versions.map(v=><p key={v.id}><Link className="underline" href={`?version=${v.id}`}>Versión {v.version} · {v.estado} · {v.created_at}</Link><span className="block text-xs break-all">SHA-256: {v.snapshot_sha256}</span></p>)}
      {data.selectedVersion&&<Button variant="secondary" onClick={()=>{const blob=new Blob([JSON.stringify(data.selectedVersion,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`oferta-${context.id}-v${data.selectedVersion!.version}.json`;a.click();URL.revokeObjectURL(url);}}>Descargar snapshot de oferta</Button>}
      {data.offer?.estado==="PRESENTADA"&&!data.selectedVersion?.estado?.includes("BORRADOR")&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const state=String(f.get("state")) as "GANADA"|"PERDIDA";if(window.confirm(`Confirmar resultado humano ${state}?`))run(()=>recordPrebidOutcomeAction(context.id,state,state==="GANADA"?Number(f.get("amount")):undefined));}}>
        <label>Resultado<Select name="state" className={inputClass}><option value="GANADA">GANADA</option><option value="PERDIDA">PERDIDA</option></Select></label>
        <label>Monto adjudicado confirmado (obligatorio para GANADA)<Input name="amount" type="number" min="0.01" step="0.01" className={inputClass}/></label><Button disabled={pending} type="submit">Confirmar resultado</Button>
      </form>}
      {data.offer?.estado==="PERDIDA"&&<p>PERDIDA · oferta presentada, costos, evidencia, cotizaciones y competencia conservados.</p>}
      {data.handoff&&<Button variant="secondary" onClick={()=>{const blob=new Blob([JSON.stringify(data.handoff,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`handoff-ganador-${context.id}.json`;a.click();URL.revokeObjectURL(url);}}>Descargar snapshot ganador y adjudicación</Button>}
      {data.offer?.estado==="GANADA"&&<p>GANADA · snapshot ganador: {data.offer.winning_version_id}. El handoff a ejecución queda preparado para el siguiente flujo.</p>}
    </section>}
  </main>;
}

function ChargeInput({label,charge,base,disabled,onChange}:{label:string;charge:{mode:'PERCENT'|'FIXED';value:number};base:number|null;disabled:boolean;onChange:(charge:{mode:'PERCENT'|'FIXED';value:number})=>void}) {
  const result=charge.mode==='FIXED'?charge.value:base==null?null:base*charge.value/100;
  return <div className="erp-surface-strong rounded-lg grid items-end gap-3 p-3 sm:grid-cols-[minmax(12rem,18rem)_8rem_minmax(8rem,auto)]">
    <label>{label} modo<Select aria-label={`${label} modo`} disabled={disabled} value={charge.mode} onChange={e=>onChange({mode:e.target.value as 'PERCENT'|'FIXED',value:0})} className={inputClass}><option value="PERCENT">Porcentaje del costo directo</option><option value="FIXED">Monto fijo PYG</option></Select></label>
    <label>{label} {charge.mode==='PERCENT'?'%':'monto PYG'}<Input required type="number" min="0" max={charge.mode==='PERCENT'?100:1e15} step="any" disabled={disabled} value={charge.value} onChange={e=>onChange({...charge,value:Number(e.target.value)})} className={inputClass}/></label>
    <div className="pb-2 text-[12px]"><span className="text-[var(--muted)]">Resultado</span><p className="font-semibold">{result==null?"—":formatMoney(result,"PYG")}</p></div>
  </div>;
}
