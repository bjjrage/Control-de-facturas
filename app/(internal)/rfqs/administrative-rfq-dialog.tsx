"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { NeedOrigin } from "@/lib/procurement/need-origin";
import { createRfq, getPurchaseFormOptions, type PurchaseFormOptions } from "./actions";
import styles from "./purchase-dialog.module.css";

type InitialItem = { descripcion: string; cantidad: number; unidad: string; producto_id: string | null };
type Line = Omit<InitialItem, "cantidad"> & { key: string; cantidad: string };
const newLine = (): Line => ({ key: crypto.randomUUID(), descripcion: "", cantidad: "", unidad: "", producto_id: null });
const makeLines = (items?: InitialItem[]): Line[] => items?.length
  ? items.map((item) => ({ ...item, key: crypto.randomUUID(), cantidad: String(item.cantidad) })) : [newLine()];
const TYPES = {
  RFQ: { label: "RFQ", description: "Comparar varios proveedores", submit: "Crear RFQ" },
  COT: { label: "Cotización", description: "Cotizar con un proveedor", submit: "Crear cotización" },
};

/** One procurement entry point, shared by Administration, a project and weekly needs. */
export function AdministrativeRfqDialog({ trigger, defaultOpen, projectId, projectName, initialItems, needOrigin }: {
  trigger: React.ReactNode;
  defaultOpen?: boolean;
  projectId?: string;
  projectName?: string;
  initialItems?: InitialItem[];
  needOrigin?: NeedOrigin;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [quoteType, setQuoteType] = useState<keyof typeof TYPES>("RFQ");
  const [destination, setDestination] = useState(projectId ?? "");
  const [lines, setLines] = useState(() => makeLines(initialItems));
  const [options, setOptions] = useState<PurchaseFormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedProject = projectId ?? (destination === "CENTRAL" ? "" : destination);
  const locked = pending || !!createdId;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getPurchaseFormOptions().then((result) => {
      if (!alive) return;
      setOptions(result.data);
      setLoadError(result.error);
    }).catch(() => { if (alive) setLoadError("No se pudieron cargar los destinos y materiales."); });
    return () => { alive = false; };
  }, [open]);

  function changeOpen(next: boolean) {
    if (submitting.current) return;
    setOpen(next);
    if (!next) {
      const url = new URL(window.location.href);
      url.searchParams.delete("nueva");
      url.searchParams.delete("obra");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }
  function update(key: string, value: Partial<Line>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...value } : line));
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent title="Nueva solicitud de compra" className={styles.dialog}>
      <form className={styles.form} onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || createdId) return;
        const fd = new FormData(event.currentTarget);
        fd.set("purpose", "PROCUREMENT");
        fd.set("quote_type", needOrigin ? "RFQ" : quoteType);
        fd.set("project_id", selectedProject);
        fd.set("purchase_destination", selectedProject ? "PROJECT" : "CENTRAL");
        fd.set("product", lines.map((line) => line.descripcion).join(", ").slice(0, 1000));
        fd.set("quantity", lines.length === 1 ? lines[0].cantidad : "1");
        fd.set("unit", lines.length === 1 ? lines[0].unidad : "lote");
        fd.set("items", JSON.stringify(lines.map(({ descripcion, cantidad, unidad, producto_id }) => ({
          descripcion, cantidad: Number(cantidad), unidad, producto_id,
        }))));
        if (needOrigin) fd.set("need_origin", JSON.stringify(needOrigin));
        submitting.current = true;
        setPending(true);
        setError(null);
        try {
          const result = await createRfq(fd);
          if (result.error) {
            setError(result.error);
            if (result.id) { setCreatedId(result.id); router.refresh(); }
            return;
          }
          setOpen(false);
          setLines(makeLines(initialItems));
          setFileNames([]);
          router.refresh();
          router.push(projectId ? `/projects/${projectId}/rfqs/${result.id}` : "/rfqs/" + result.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo crear la solicitud.");
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}>
        <div className={styles.body}>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
          {createdId && <p role="status">La solicitud ya existe. <Link className="text-action" href={"/rfqs/" + createdId}>Abrir solicitud y completar sus archivos</Link></p>}
          <section className={styles.block} aria-label="Destino de la compra">
            {projectId ? <>
              <span className={styles.caption}>Compra para la obra</span>
              <strong>{projectName ?? options?.projects.find((project) => project.id === projectId)?.name ?? "Obra actual"}</strong>
              <span className={styles.caption}>Entrega en obra{needOrigin ? " · Pedido del plan semanal" : ""}</span>
            </> : <>
              <Label htmlFor="purchase-destination">Destino de la compra</Label>
              <Select id="purchase-destination" value={destination} required disabled={locked || !options}
                onChange={(event) => setDestination(event.target.value)}>
                <option value="">{options ? "Elegí una obra o depósito" : "Cargando destinos…"}</option>
                {options?.projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.name}</option>)}
                {options?.central && <option value="CENTRAL">Depósito central — {options.central.name}</option>}
              </Select>
              {options && !options.central && <span className={styles.caption}>Depósito central sin configurar. Podés comprar directamente para una obra.</span>}
            </>}
          </section>
          {!needOrigin && <div className={styles.types}>
            {(["RFQ", "COT"] as const).map((type) => <button key={type} type="button" disabled={locked}
              aria-pressed={quoteType === type} onClick={() => setQuoteType(type)} className={styles.type}>
              <strong>{TYPES[type].label}</strong><span>{TYPES[type].description}</span>
            </button>)}
          </div>}
          <div className={styles.items}>
            {lines.map((line, index) => <section className={styles.block} key={line.key} aria-label={"Ítem " + (index + 1)}>
              <div className={styles.line}>
                <div><Label htmlFor={"purchase-product-" + line.key}>Producto</Label>
                  <Input id={"purchase-product-" + line.key} required value={line.descripcion} disabled={locked || !!needOrigin}
                    onChange={(event) => update(line.key, { descripcion: event.target.value, producto_id: null })} /></div>
                <div><Label htmlFor={"purchase-quantity-" + line.key}>Cantidad</Label>
                  <Input id={"purchase-quantity-" + line.key} type="number" step="0.0001" min="0.0001" required
                    disabled={locked || !!needOrigin} value={line.cantidad} onChange={(event) => update(line.key, { cantidad: event.target.value })} /></div>
                <div><Label htmlFor={"purchase-unit-" + line.key}>Unidad</Label>
                  <Input id={"purchase-unit-" + line.key} required placeholder="kg, un, m²" value={line.unidad} disabled={locked || !!needOrigin}
                    onChange={(event) => update(line.key, { unidad: event.target.value, producto_id: null })} /></div>
              </div>
              {!needOrigin && !!options?.products.length && <div>
                <Label htmlFor={"purchase-catalog-" + line.key}>Material del catálogo (opcional)</Label>
                <Select id={"purchase-catalog-" + line.key} value={line.producto_id ?? ""} disabled={locked} onChange={(event) => {
                  const product = options.products.find((item) => item.id === event.target.value);
                  update(line.key, product ? { producto_id: product.id, descripcion: product.nombre, unidad: product.unidad } : { producto_id: null });
                }}><option value="">Producto o servicio sin vincular</option>
                  {options.products.map((product) => <option key={product.id} value={product.id}>{product.nombre} · {product.unidad}</option>)}
                </Select>
              </div>}
              {!needOrigin && lines.length > 1 && <Button type="button" variant="ghost" disabled={locked}
                onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Quitar ítem {index + 1}</Button>}
            </section>)}
            {!needOrigin && <Button type="button" variant="secondary" disabled={locked} onClick={() => setLines((current) => [...current, newLine()])}>Agregar ítem</Button>}
          </div>
          {!needOrigin && <div><Label htmlFor="purchase-date">Fecha requerida</Label><Input id="purchase-date" name="required_date" type="date" disabled={locked} /></div>}
          <details className={styles.details}><summary>Más detalles</summary>
            <div className="space-y-3 pt-3">
              <div><Label htmlFor="purchase-specifications">Especificaciones</Label><Textarea id="purchase-specifications" name="specifications" disabled={locked} /></div>
              <div><Label htmlFor="purchase-reference">Referencia interna</Label><Input id="purchase-reference" name="internal_reference" disabled={locked} /></div>
              <div><Label htmlFor="purchase-observations">Observaciones</Label><Textarea id="purchase-observations" name="observations" disabled={locked} /></div>
            </div>
          </details>
          <div className={styles.attachments}>
            <input ref={fileInput} type="file" name="attachments" multiple accept="application/pdf,image/png,image/jpeg" hidden
              disabled={locked} onChange={(event) => setFileNames(Array.from(event.target.files ?? []).map((file) => file.name))} />
            <Button type="button" variant="secondary" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={14} /> Adjuntar referencia</Button>
            {fileNames.length > 0 && <span className={styles.caption}>{fileNames.join(", ")}</span>}
          </div>
        </div>
        <div className={styles.footer}>
          <p>La compra requiere selección y autorización humanas.</p>
          <div><Button type="button" variant="secondary" disabled={pending} onClick={() => changeOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={locked || (!projectId && (!options || !destination))}>{pending ? "Creando…" : TYPES[needOrigin ? "RFQ" : quoteType].submit}</Button></div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
