"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Send, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatNumber, formatDateTime } from "@/lib/format";
import {
  getCostBudgetAction,
  createCostRfqsFromProject,
  setProjectCostPriceAction,
  clearProjectCostPriceAction,
  type CostBudgetData,
  type CostBudgetInsumo,
  type CostRfqCreationResult,
} from "./costeo-actions";
import { LaborRatesDialog } from "./labor-rates-dialog";
import { ApuTemplatesDialog } from "./apu-templates-dialog";
import { ApplyApuTemplatesButton } from "./apply-apu-templates-button";

const FUENTE_LABEL: Record<string, string> = {
  COTIZACION: "Cotización",
  ESTIMACION: "Historial",
  HISTORICO: "Costo promedio",
  MANUAL: "Manual",
};

function gs(n: number | null | undefined): string {
  return n == null ? "—" : formatMoney(n, "PYG");
}

function qty(n: number): string {
  return formatNumber(n, Number.isInteger(n) ? 0 : 2);
}

export function CosteoSection({ projectId }: { projectId: string }) {
  const [data, setData] = useState<CostBudgetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rfqPending, setRfqPending] = useState(false);
  const [rfqResult, setRfqResult] = useState<CostRfqCreationResult | null>(null);
  const router = useRouter();

  const load = useCallback(() => {
    setLoading(true);
    getCostBudgetAction(projectId).then((res) => {
      setData(res.data);
      setError(res.error);
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerateRfqs() {
    if (!window.confirm("Se va a crear un RFQ por rubro con los insumos de la obra y se invita a los proveedores de cada rubro. ¿Seguimos?")) return;
    setRfqPending(true);
    const res = await createCostRfqsFromProject(projectId);
    setRfqPending(false);
    if (res.error) return setError(res.error);
    setRfqResult(res.data);
    load();
    router.refresh();
  }

  if (loading && !data) return <p className="text-[13px] text-[var(--muted)]">Calculando presupuesto de costo…</p>;
  if (error && !data) return <p className="text-[13px] text-[var(--error)]">{error}</p>;
  if (!data) return null;

  const { totals } = data;
  const partidasConCantidad = data.partidas.filter((p) => (p.quantity ?? 0) > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={handleGenerateRfqs} disabled={rfqPending} className="gap-1.5">
          {rfqPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Generar RFQ por rubro
        </Button>
        <ApuTemplatesDialog />
        <LaborRatesDialog />
        <ApplyApuTemplatesButton projectId={projectId} />
        <Button type="button" variant="ghost" onClick={load} className="gap-1.5" title="Recalcular">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}

      {rfqResult ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-[12px] space-y-1">
          {rfqResult.sinInsumos ? (
            <p>No hay insumos para cotizar: cargá el APU de materiales de las partidas (o aplicá plantillas) primero.</p>
          ) : (
            <>
              <p>
                {rfqResult.creadas.length === 0
                  ? "No se creó ningún RFQ."
                  : `Se crearon ${rfqResult.creadas.length} RFQ: ${rfqResult.creadas.map((c) => `${c.code} (${c.rubro}, ${c.proveedores} proveedores)`).join(", ")}.`}
              </p>
              {rfqResult.rubrosSinProveedores.length > 0 ? (
                <p className="text-amber-500">
                  Sin proveedores de ese rubro: {rfqResult.rubrosSinProveedores.map((r) => r.rubro).join(", ")}. Asigná el rubro en
                  Proveedores y volvé a generar.
                </p>
              ) : null}
              {rfqResult.insumosSinRubro.length > 0 ? (
                <p className="text-amber-500">
                  Insumos sin categoría (no se pudieron mandar a ningún rubro): {rfqResult.insumosSinRubro.join(", ")}. Asignales
                  categoría en Stock.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Costo total" value={gs(totals.costoTotal)} note={totals.completo ? "Presupuesto de costo completo" : "Parcial: ver avisos abajo"} warn={!totals.completo} />
        <Kpi label="Venta total" value={gs(totals.ventaTotal)} note="Presupuesto al cliente" />
        <Kpi
          label="Margen"
          value={gs(totals.margen)}
          note={totals.margenPct == null ? "—" : `${totals.margenPct.toFixed(1)}% sobre la venta${totals.completo ? "" : " (parcial)"}`}
          warn={totals.margen < 0}
        />
      </div>

      {!totals.completo ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px]">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <div>
            {totals.partidasSinApu > 0 ? <p>{totals.partidasSinApu} partida(s) sin APU: su costo no está incluido.</p> : null}
            {totals.partidasIncompletas > 0 ? (
              <p>{totals.partidasIncompletas} partida(s) con insumos sin precio: no se suman como Gs. 0. Cotizalas o cargá un precio manual.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Section title="Solicitudes de precio de la obra">
        {data.rfqs.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">Todavía no generaste RFQ de costeo para esta obra.</p>
        ) : (
          <Table head={["Código", "Rubro", "Estado", "Respondieron", "Vence", ""]}>
            {data.rfqs.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.code}</td>
                <td>{r.product}</td>
                <td>{r.status}</td>
                <td className="num">
                  {r.respondieron} / {r.invitados}
                </td>
                <td className="text-[var(--muted)]">{formatDateTime(r.expiresAt)}</td>
                <td>
                  <Link href={`/rfqs/${r.id}`} className="text-action text-[12px]">
                    Ver →
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Insumos (materiales)">
        {data.insumos.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">Sin materiales en el APU de las partidas.</p>
        ) : (
          <Table head={["Insumo", "Rubro", "Cantidad", "Precio unitario", "Fuente", "Subtotal", ""]}>
            {data.insumos.map((i) => (
              <tr key={i.productoId}>
                <td>{i.nombre}</td>
                <td className="text-[var(--muted)]">{i.rubro ?? "Sin rubro"}</td>
                <td className="num whitespace-nowrap">
                  {qty(i.cantidad)} {i.unidad}
                </td>
                <td className="num">{i.precio ? gs(i.precio.precio) : <span className="text-amber-500">Sin precio</span>}</td>
                <td className="text-[12px]">
                  {i.precio ? FUENTE_LABEL[i.precio.fuente] : "—"}
                  {i.quotes.length > 0 ? <span className="text-[var(--muted)]"> · {i.quotes.length} cotiz.</span> : null}
                </td>
                <td className="num">{gs(i.subtotal)}</td>
                <td>
                  <PriceChooser projectId={projectId} insumo={i} onSaved={load} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="Mano de obra propia">
          {data.manoObra.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">Sin mano de obra propia en el APU.</p>
          ) : (
            <Table head={["Categoría", "Horas", "Costo/hora", "Subtotal"]}>
              {data.manoObra.map((m) => (
                <tr key={`${m.label}-${m.costoHora}`}>
                  <td>
                    {m.label}
                    {!m.vinculadoAJornal ? <span className="text-[11px] text-[var(--muted)]"> (costo propio)</span> : null}
                  </td>
                  <td className="num">{qty(m.horas)}</td>
                  <td className="num">{gs(m.costoHora)}</td>
                  <td className="num">{gs(m.subtotal)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
        <Section title="Subcontratos">
          {data.subcontratos.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">Sin subcontratos en el APU.</p>
          ) : (
            <Table head={["Descripción", "Total"]}>
              {data.subcontratos.map((s) => (
                <tr key={s.descripcion}>
                  <td>{s.descripcion}</td>
                  <td className="num">{gs(s.total)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
        <Section title="Equipos">
          {data.equipos.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">Sin equipos en el APU.</p>
          ) : (
            <Table head={["Equipo", "Horas", "Subtotal"]}>
              {data.equipos.map((e) => (
                <tr key={`${e.label}-${e.costoHora}`}>
                  <td>{e.label}</td>
                  <td className="num">{qty(e.horas)}</td>
                  <td className="num">{gs(e.subtotal)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>

      <Section title="Por partida">
        <Table head={["Código", "Descripción", "Cantidad", "Costo unit.", "Costo total", "Venta unit.", "Margen"]}>
          {partidasConCantidad.map((p) => {
            const c = p.cost;
            return (
              <tr key={p.id}>
                <td className="font-medium">{p.code}</td>
                <td>{p.description}</td>
                <td className="num whitespace-nowrap">
                  {qty(p.quantity ?? 0)} {p.unit ?? ""}
                </td>
                <td className="num">
                  {!c || !c.tieneApu ? (
                    <span className="text-[var(--muted)]">Sin APU</span>
                  ) : c.costoUnitario == null ? (
                    <span className="text-amber-500">Falta precio</span>
                  ) : (
                    gs(c.costoUnitario)
                  )}
                </td>
                <td className="num">{c?.costoTotal == null ? "—" : gs(c.costoTotal)}</td>
                <td className="num">{gs(p.unitPrice)}</td>
                <td className="num">
                  {c?.margenUnitario == null ? (
                    "—"
                  ) : (
                    <span className={c.margenUnitario < 0 ? "text-[var(--error)]" : "text-emerald-500"}>
                      {gs(c.margenUnitario)}
                      {c.margenPct != null ? ` (${Math.round(c.margenPct)}%)` : ""}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>
    </div>
  );
}

function Kpi({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">{label}</div>
      <div className="text-[16px] font-bold mt-1">{value}</div>
      <div className={`text-[11px] mt-0.5 ${warn ? "text-amber-500" : "text-[var(--muted)]"}`}>{note}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function PriceChooser({ projectId, insumo, onSaved }: { projectId: string; insumo: CostBudgetInsumo; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function run(fn: () => Promise<{ error: string | null }>) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (res.error) return setError(res.error);
    setError(null);
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="text-[12px] text-[var(--primary)] underline hover:no-underline">
          Cambiar
        </button>
      </DialogTrigger>
      <DialogContent title={`Precio de ${insumo.nombre}`} className="max-w-xl">
        <div className="space-y-3 text-[12px]">
          <p className="text-[var(--muted)]">
            Actual: {insumo.precio ? `${gs(insumo.precio.precio)} (${FUENTE_LABEL[insumo.precio.fuente]})` : "sin precio"}. Si no
            elegís nada, se usa la cotización vigente más barata; si no hay, el historial de precios; si no, el costo promedio del
            stock.
          </p>

          <div>
            <div className="font-medium mb-1">Cotizaciones recibidas</div>
            {insumo.quotes.length === 0 ? (
              <p className="text-[var(--muted)]">Ninguna todavía.</p>
            ) : (
              <ul className="space-y-1">
                {insumo.quotes.map((q) => {
                  const vencida = q.venceEl != null && q.venceEl < today;
                  return (
                    <li key={q.quoteVersionItemId} className="flex items-center justify-between gap-2">
                      <span>
                        {q.providerName} · {gs(q.precio)} · {q.rfqCode}
                        {vencida ? <span className="text-amber-500"> · vencida</span> : null}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-7 text-[11px]"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            setProjectCostPriceAction({
                              projectId,
                              productoId: insumo.productoId,
                              precio: q.precio,
                              fuente: "COTIZACION",
                              quoteVersionItemId: q.quoteVersionItemId,
                            })
                          )
                        }
                      >
                        Usar
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {insumo.quotesOtraMoneda > 0 ? (
              <p className="mt-1 text-amber-500">
                {insumo.quotesOtraMoneda} cotización(es) en otra moneda: no se comparan sin tipo de cambio. Cargá el precio en Gs.
                manual.
              </p>
            ) : null}
          </div>

          <div className="text-[var(--muted)]">
            Historial: {gs(insumo.estimate)} · Costo promedio: {gs(insumo.costoPromedio)}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] text-[var(--muted)]">Precio manual (Gs. por {insumo.unidad || "unidad"})</label>
              <Input type="number" min="0" step="any" value={manual} onChange={(e) => setManual(e.target.value)} className="h-8" />
            </div>
            <Button
              type="button"
              className="h-8 text-xs"
              disabled={pending || !(Number(manual) > 0)}
              onClick={() => run(() => setProjectCostPriceAction({ projectId, productoId: insumo.productoId, precio: Number(manual), fuente: "MANUAL" }))}
            >
              Usar manual
            </Button>
          </div>

          {error ? <p className="text-[var(--error)]">{error}</p> : null}

          <div className="flex justify-between">
            <Button type="button" variant="ghost" className="h-8 text-xs" disabled={pending} onClick={() => run(() => clearProjectCostPriceAction(projectId, insumo.productoId))}>
              Volver al sugerido
            </Button>
            <Button type="button" variant="secondary" className="h-8 text-xs" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
