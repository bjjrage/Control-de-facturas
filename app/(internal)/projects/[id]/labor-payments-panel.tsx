"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { destajoAmount } from "@/lib/costing/real-vs-budget";
import { addLaborPayment, deleteLaborPayment, listLaborPaymentsAction, type LaborPayment } from "../caterpillar-actions";

const MODALIDADES: { value: LaborPayment["modalidad"]; label: string }[] = [
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "DESTAJO", label: "Destajo (precio por unidad)" },
];

const MODALIDAD_LABEL = Object.fromEntries(MODALIDADES.map((m) => [m.value, m.label.split(" ")[0]]));

export function LaborPaymentsPanel({
  projectId,
  budgetItems,
}: {
  projectId: string;
  budgetItems: { id: string; code: string; description: string }[];
}) {
  const [payments, setPayments] = useState<LaborPayment[] | null>(null);
  const [open, setOpen] = useState(false);
  const [modalidad, setModalidad] = useState<LaborPayment["modalidad"]>("SEMANAL");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const load = useCallback(() => {
    listLaborPaymentsAction(projectId).then((res) => {
      setPayments(res.data ?? []);
      if (res.error) setError(res.error);
    });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const itemLabel = (id: string | null) => {
    const b = budgetItems.find((x) => x.id === id);
    return b ? `${b.code} — ${b.description}` : "—";
  };
  const total = (payments ?? []).reduce((s, p) => s + p.amount, 0);
  const crews = [...new Set((payments ?? []).map((p) => p.crew_name))];
  const destajoTotal = Number(qty) > 0 && price !== "" ? destajoAmount(Number(qty), Number(price)) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">Pagos de mano de obra</h3>
          <p className="text-[11px] text-[var(--muted)]">
            Lo que se le paga a cada cuadrilla por período, o por destajo (precio por unidad). Se compara contra la mano de obra
            estimada en los APU, en la pestaña Costeo.
          </p>
        </div>
        {!open ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            + Registrar pago
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const res = await addLaborPayment(projectId, formData);
            setPending(false);
            if (res.error) return setError(res.error);
            setError(null);
            setQty("");
            setPrice("");
            setOpen(false);
            load();
            router.refresh();
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">{error}</div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lp_crew">Cuadrilla o persona</Label>
              <Input id="lp_crew" name="crew_name" list="lp_crews" required />
              <datalist id="lp_crews">
                {crews.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="lp_mod">Modalidad</Label>
              <Select id="lp_mod" name="modalidad" value={modalidad} onChange={(e) => setModalidad(e.target.value as LaborPayment["modalidad"])}>
                {MODALIDADES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lp_from">Período desde</Label>
              <Input id="lp_from" name="period_from" type="date" required />
            </div>
            <div>
              <Label htmlFor="lp_to">Período hasta</Label>
              <Input id="lp_to" name="period_to" type="date" required />
            </div>
            {modalidad === "DESTAJO" ? (
              <>
                <div className="col-span-2">
                  <Label htmlFor="lp_item">Partida</Label>
                  <Select id="lp_item" name="budget_item_id" defaultValue="">
                    <option value="">Elegí la partida…</option>
                    {budgetItems.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.description}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="lp_qty">Cantidad ejecutada</Label>
                  <Input id="lp_qty" name="quantity" type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="lp_price">Precio por unidad (Gs.)</Label>
                  <Input id="lp_price" name="unit_price" type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                <p className="col-span-2 text-[12px] text-[var(--muted)]">
                  Monto del destajo: <span className="font-medium text-[var(--foreground)]">{destajoTotal == null ? "—" : formatMoney(destajoTotal, "PYG")}</span>
                </p>
              </>
            ) : (
              <div className="col-span-2">
                <Label htmlFor="lp_amount">Monto pagado (Gs.)</Label>
                <Input id="lp_amount" name="amount" type="number" step="any" min="0" required />
              </div>
            )}
            <div className="col-span-2">
              <Label htmlFor="lp_notes">Notas (opcional)</Label>
              <Textarea id="lp_notes" name="notes" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Registrar pago"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Período</th>
              <th>Cuadrilla</th>
              <th>Modalidad</th>
              <th>Detalle</th>
              <th className="num">Monto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments == null ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)] py-6">
                  Cargando…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)] py-6">
                  Sin pagos de mano de obra registrados.
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">
                    {formatDate(p.period_from)} → {formatDate(p.period_to)}
                  </td>
                  <td className="font-medium">{p.crew_name}</td>
                  <td>{MODALIDAD_LABEL[p.modalidad]}</td>
                  <td className="text-[var(--muted)]">
                    {p.modalidad === "DESTAJO"
                      ? `${itemLabel(p.budget_item_id)} · ${formatNumber(p.quantity ?? 0, 2)} × ${formatMoney(p.unit_price ?? 0, "PYG")}`
                      : (p.notes ?? "—")}
                  </td>
                  <td className="num font-medium">{formatMoney(p.amount, "PYG")}</td>
                  <td>
                    <button
                      type="button"
                      className="text-action text-[12px]"
                      onClick={async () => {
                        if (!window.confirm("¿Borrar este pago?")) return;
                        const res = await deleteLaborPayment(projectId, p.id);
                        if (res.error) return setError(res.error);
                        load();
                        router.refresh();
                      }}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {payments && payments.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right font-semibold">
                  TOTAL PAGADO
                </td>
                <td className="num font-semibold">{formatMoney(total, "PYG")}</td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
