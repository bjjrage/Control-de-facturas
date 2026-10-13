"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/browser";
import { createRfq } from "./actions";
import {
  createCostRfqsFromProject,
  listProjectsForCostRfqAction,
  type CostRfqCreationResult,
} from "../projects/[id]/costeo-actions";
import type { RfqPurpose } from "@/lib/rfq/domain";
import type { NeedOrigin } from "@/lib/procurement/need-origin";
type Line = {
  descripcion: string;
  cantidad: string;
  unidad: string;
  producto_id: string | null;
};
const empty = (): Line => ({
  descripcion: "",
  cantidad: "",
  unidad: "",
  producto_id: null,
});
export function RfqDialog({
  trigger,
  defaultOpen,
  projectId,
  defaultFromProject,
  initialItems,
  needOrigin,
}: {
  trigger: React.ReactNode;
  defaultOpen?: boolean;
  projectId?: string;
  defaultFromProject?: string;
  needOrigin?: NeedOrigin;
  initialItems?: {
    descripcion: string;
    cantidad: number;
    unidad: string;
    producto_id: string | null;
  }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [purpose, setPurpose] = useState<RfqPurpose | "">(needOrigin ? "PROCUREMENT" : "");
  const [mode, setMode] = useState<"manual" | "obra">(
    defaultFromProject ? "obra" : "manual",
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [quoteType, setQuoteType] = useState<"RFQ" | "COT">("RFQ");
  const [obraResult, setObraResult] = useState<CostRfqCreationResult | null>(null);
  const [project, setProject] = useState(defaultFromProject ?? projectId ?? "");
  const [projects, setProjects] = useState<
    { id: string; name: string; code: string }[]
  >([]);
  const [products, setProducts] = useState<
    { id: string; nombre: string; unidad: string }[]
  >([]);
  const [lines, setLines] = useState<Line[]>(
    () =>
      initialItems?.map((i) => ({ ...i, cantidad: String(i.cantidad) })) ?? [
        empty(),
      ],
  );
  useEffect(() => {
    if (!open) return;
    let alive = true;
    createClient()
      .from("productos")
      .select("id,nombre,unidad")
      .eq("activo", true)
      .order("nombre")
      .then((r) => {
        if (alive) setProducts(r.data ?? []);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  useEffect(() => {
    if (!open || mode !== "obra" || projectId) return;
    let alive = true;
    listProjectsForCostRfqAction().then((r) => {
      if (!alive) return;
      if (r.error) setError(r.error);
      else setProjects(r.data ?? []);
    }).catch(() => { if (alive) setError("No se pudieron cargar las obras."); });
    return () => { alive = false; };
  }, [open, mode, projectId]);
  async function loadProjects() {
    setMode("obra");
  }
  const update = (index: number, value: Partial<Line>) =>
    setLines((l) =>
      l.map((row, i) => (i === index ? { ...row, ...value } : row)),
    );
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (submitting.current) return;
      setOpen(next);
      if (!next) {
        const url = new URL(window.location.href);
        url.searchParams.delete("nueva");
        url.searchParams.delete("obra");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva cotización" className="max-w-3xl">
        <Label htmlFor="rfq-purpose">Propósito</Label>
        <Select
          id="rfq-purpose"
          disabled={!!needOrigin}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as RfqPurpose)}
          required
        >
          <option value="">Elegí el propósito</option>
          <option value="COST_DISCOVERY">Descubrir costos — sin compra</option>
          <option value="PROCUREMENT">
            Comprar — asignación y confirmación humanas
          </option>
        </Select>
        <div className="flex gap-2 my-3" hidden={!!needOrigin}>
          <Button variant="secondary" onClick={() => setMode("manual")}>
            {lines.length === 1 ? "Un producto" : "Varios productos"}
          </Button>
          <Button variant="secondary" onClick={loadProjects}>
            Desde una obra
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        {mode === "obra" ? (
          <div className="space-y-3">
            <p>
              Genera solicitudes de precios por rubro después de tu
              confirmación. Este circuito exige propósito Descubrir costos y no
              crea órdenes de compra.
            </p>
            {!projectId && <><Label htmlFor="rfq-project">Obra</Label>
            <Select
              id="rfq-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">Elegí una obra</option>
              {projectId && <option value={projectId}>Obra actual</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </Select></>}
            <Button
              disabled={pending || !project || purpose !== "COST_DISCOVERY" || !!obraResult}
              onClick={async () => {
                if (submitting.current) return;
                submitting.current = true;
                setPending(true);
                setError("");
                try {
                  const r = await createCostRfqsFromProject(project);
                  if (r.error) setError(r.error);
                  else {
                    setObraResult(r.data);
                    router.refresh();
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : "No se pudieron crear las solicitudes.");
                } finally {
                  submitting.current = false;
                  setPending(false);
                }
              }}
            >
              Confirmar creación de solicitudes de precios
            </Button>
            {obraResult && <div role="status" className="rounded-lg border border-[var(--border)] p-3 space-y-2 text-[12px]">
              {obraResult.sinInsumos ? <p>Esa obra no tiene insumos. Revisá las recetas de sus partidas en Costeo.</p> : <>
                {obraResult.creadas.length === 0 && <p>No se creó ningún pedido.</p>}
                {obraResult.creadas.map((r) => <p key={r.rfqId}><Link className="underline" href={`/rfqs/${r.rfqId}`}>{r.code}</Link> · {r.rubro} · {r.items} ítems · {r.proveedores} proveedores</p>)}
                {obraResult.rubrosSinProveedores.map((r) => <p key={r.rubro}>Sin proveedores para {r.rubro}: {r.items} ítems.</p>)}
                {obraResult.insumosSinRubro.length > 0 && <p>Sin rubro: {obraResult.insumosSinRubro.join(", ")}</p>}
              </>}
            </div>}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (submitting.current || createdId) return;
              const fd = new FormData(event.currentTarget);
              submitting.current = true;
              if(needOrigin) fd.set("need_origin",JSON.stringify(needOrigin));
              setPending(true);
              setError("");
              try {
                fd.set("purpose", purpose);
                fd.set(
                  "product",
                  lines
                    .map((l) => l.descripcion)
                    .join(", ")
                    .slice(0, 1000),
                );
                fd.set("quantity", "1");
                fd.set("unit", "lote");
                fd.set("quote_type", quoteType);
                fd.set(
                  "items",
                  JSON.stringify(
                    lines.map((l) => ({ ...l, cantidad: Number(l.cantidad) })),
                  ),
                );
                const r = await createRfq(fd);
                if (r.error) {
                  setError(r.error);
                  if (r.id) { setCreatedId(r.id); router.refresh(); }
                }
                else {
                  setOpen(false);
                  setLines(initialItems?.map((i) => ({ ...i, cantidad: String(i.cantidad) })) ?? [empty()]);
                  setPurpose(needOrigin ? "PROCUREMENT" : "");
                  router.refresh();
                  router.push("/rfqs/" + r.id);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "Error al crear RFQ");
              } finally {
                submitting.current = false;
                setPending(false);
              }
            }}
          >
            {projectId && (
              <input type="hidden" name="project_id" value={projectId} />
            )}
            {createdId ? <p role="status">La solicitud ya existe. <Link className="underline" href={`/rfqs/${createdId}`}>Abrir solicitud creada y completar sus archivos</Link></p> : null}
            {!needOrigin && <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={quoteType === "RFQ" ? "primary" : "secondary"} onClick={() => setQuoteType("RFQ")}>RFQ — pedir precios</Button>
              <Button type="button" variant={quoteType === "COT" ? "primary" : "secondary"} onClick={() => setQuoteType("COT")}>Cotización — un proveedor</Button>
            </div>}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th>Cantidad</th>
                    <th>Unidad</th>
                    <th>Producto de catálogo (opcional)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => (
                    <tr key={index}>
                      <td>
                        <Input
                          aria-label={`Descripción ${index + 1}`}
                          disabled={!!needOrigin}
                          value={l.descripcion}
                          onChange={(e) =>
                            update(index, { descripcion: e.target.value })
                          }
                          required
                        />
                      </td>
                      <td>
                        <Input
                          aria-label={`Cantidad ${index + 1}`}
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          disabled={!!needOrigin}
                          value={l.cantidad}
                          onChange={(e) =>
                            update(index, { cantidad: e.target.value })
                          }
                          required
                        />
                      </td>
                      <td>
                        <Input
                          aria-label={`Unidad ${index + 1}`}
                          disabled={!!needOrigin}
                          value={l.unidad}
                          onChange={(e) =>
                            update(index, { unidad: e.target.value })
                          }
                          required
                        />
                      </td>
                      <td>
                        <Select
                          aria-label={`Producto ${index + 1}`}
                          disabled={!!needOrigin}
                          value={l.producto_id ?? ""}
                          onChange={(e) => {
                            const p = products.find(
                              (p) => p.id === e.target.value,
                            );
                            update(index, {
                              producto_id: p?.id ?? null,
                              ...(p
                                ? { descripcion: p.nombre, unidad: p.unidad }
                                : {}),
                            });
                          }}
                        >
                          <option value="">Sin producto de catálogo</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!!needOrigin || lines.length === 1}
                          onClick={() =>
                            setLines((rows) =>
                              rows.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!!needOrigin}
              onClick={() => setLines((rows) => [...rows, empty()])}
            >
              Agregar ítem
            </Button>
            <Label htmlFor="rfq-specifications">Especificaciones</Label>
            <Textarea id="rfq-specifications" name="specifications" />
            <Label>Fecha requerida</Label>
            <Input name="required_date" type="date" />
            <Label>Referencia interna</Label>
            <Input name="internal_reference" />
            <Label>Observaciones</Label>
            <Textarea name="observations" />
            <Label>Archivos de referencia</Label>
            <Input
              name="attachments"
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
            />
            <Button disabled={pending || !purpose || !!createdId}>
              {pending ? "Creando…" : quoteType === "COT" ? "Crear cotización" : "Crear RFQ"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
