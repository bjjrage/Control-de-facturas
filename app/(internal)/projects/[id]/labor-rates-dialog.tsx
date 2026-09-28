"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listLaborRatesAction,
  saveLaborRateAction,
  deleteLaborRateAction,
  type LaborRate,
} from "./apu-actions";

function money(n: number): string {
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

const EMPTY_FORM = { id: "", categoria: "", costoHoraBase: "", cargasSocialesPct: "" };

export function LaborRatesDialog() {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<LaborRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function refresh() {
    setLoading(true);
    listLaborRatesAction().then((res) => {
      if (res.data) setRates(res.data);
      setLoading(false);
    });
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const base = Number(form.costoHoraBase);
  const pct = form.cargasSocialesPct.trim() === "" ? 0 : Number(form.cargasSocialesPct);
  const preview = Number.isFinite(base) && base >= 0 && Number.isFinite(pct) ? base * (1 + pct / 100) : null;

  async function handleSave() {
    setError(null);
    if (!form.categoria.trim()) return setError("Poné el nombre de la categoría.");
    if (!(base >= 0) || form.costoHoraBase.trim() === "") return setError("Costo hora base inválido.");
    if (!(pct >= 0 && pct <= 200)) return setError("Cargas sociales entre 0 y 200 %.");
    setSaving(true);
    const res = await saveLaborRateAction({
      id: form.id || undefined,
      categoria: form.categoria,
      costoHoraBase: base,
      cargasSocialesPct: pct,
    });
    setSaving(false);
    if (res.error) return setError(res.error);
    setForm(EMPTY_FORM);
    refresh();
    router.refresh();
  }

  async function handleDelete(rate: LaborRate) {
    if (!window.confirm(`¿Borrar la categoría "${rate.categoria}"? Las líneas de APU enlazadas conservan su último costo.`)) return;
    const res = await deleteLaborRateAction(rate.id);
    if (res.error) return setError(res.error);
    refresh();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Jornales
        </Button>
      </DialogTrigger>
      <DialogContent title="Jornales (empresa)" className="max-w-2xl">
        <div className="space-y-4 text-[12px]">
          <p className="text-[var(--muted)]">
            Costo hora por categoría de la mano de obra propia, con cargas sociales (IPS, aguinaldo, vacaciones). Las
            líneas de mano de obra del APU cuyo rol coincide con una categoría toman este costo, y se actualizan solas
            cuando lo cambiás acá.
          </p>

          <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                  <th className="py-1.5 px-2">Categoría</th>
                  <th className="py-1.5 px-2 text-right">Costo hora base</th>
                  <th className="py-1.5 px-2 text-right">Cargas sociales</th>
                  <th className="py-1.5 px-2 text-right">Costo hora real</th>
                  <th className="py-1.5 px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {loading ? (
                  <tr><td colSpan={5} className="py-3 px-2 text-[var(--muted)]">Cargando…</td></tr>
                ) : rates.length === 0 ? (
                  <tr><td colSpan={5} className="py-3 px-2 text-[var(--muted)]">Sin categorías cargadas todavía.</td></tr>
                ) : (
                  rates.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5 px-2">{r.categoria}</td>
                      <td className="py-1.5 px-2 text-right">{money(r.costo_hora_base)}</td>
                      <td className="py-1.5 px-2 text-right">{r.cargas_sociales_pct}%</td>
                      <td className="py-1.5 px-2 text-right font-medium">{money(r.costo_hora)}</td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          title="Editar"
                          onClick={() =>
                            setForm({
                              id: r.id,
                              categoria: r.categoria,
                              costoHoraBase: String(r.costo_hora_base),
                              cargasSocialesPct: String(r.cargas_sociales_pct),
                            })
                          }
                          className="mr-2 text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          <Pencil size={13} />
                        </button>
                        <button type="button" title="Borrar" onClick={() => handleDelete(r)} className="text-[var(--muted)] hover:text-[var(--error)]">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
            <div className="font-medium">{form.id ? "Editar categoría" : "Nueva categoría"}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Categoría</label>
                <Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Oficial albañil" className="h-8 text-xs" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Costo hora base (Gs.)</label>
                <Input type="number" min="0" step="any" value={form.costoHoraBase} onChange={(e) => setForm({ ...form, costoHoraBase: e.target.value })} className="h-8 text-xs" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Cargas sociales (%)</label>
                <Input type="number" min="0" max="200" step="any" value={form.cargasSocialesPct} onChange={(e) => setForm({ ...form, cargasSocialesPct: e.target.value })} placeholder="0" className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted)]">
                Costo hora real: {preview === null ? "—" : <span className="font-medium text-[var(--foreground)]">{money(preview)}</span>}
              </span>
              <div className="flex gap-2">
                {form.id ? (
                  <Button type="button" variant="secondary" onClick={() => setForm(EMPTY_FORM)} className="h-8 text-xs">
                    Cancelar
                  </Button>
                ) : null}
                <Button type="button" onClick={handleSave} disabled={saving} className="h-8 text-xs">
                  {saving ? "Guardando…" : form.id ? "Guardar cambios" : "Agregar"}
                </Button>
              </div>
            </div>
            {error ? <p className="text-[11px] text-[var(--error)]">{error}</p> : null}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="h-8 text-xs">
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
