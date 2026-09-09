"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";

import { markPaymentOrderExecuted } from "../actions";

type Cuenta = { id: string; nombre: string; moneda: string };

export function ExecuteButton({ opId, cuentas = [] }: { opId: string; cuentas?: Cuenta[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState("");

  async function confirmar() {
    setLoading(true);
    setError(null);
    const result = await markPaymentOrderExecuted(opId, cuentaId || null);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Registrar pago</Button>
      </DialogTrigger>
      <DialogContent title="Registrar pago de la OP">
        <div className="space-y-3">
          <p className="text-[13px] text-[var(--muted)]">
            Todas las facturas de esta OP pasan a <span className="font-medium text-[var(--foreground)]">PAGADO</span>.
          </p>
          {cuentas.length > 0 ? (
            <div>
              <Label htmlFor="op-cuenta">Sale de la cuenta</Label>
              <Select
                id="op-cuenta"
                value={cuentaId}
                onChange={(e) => setCuentaId((e.target as HTMLSelectElement).value)}
              >
                <option value="">— No asentar en tesorería —</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                ))}
              </Select>
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Si elegís una cuenta, el pago descuenta del saldo de tesorería.
              </p>
            </div>
          ) : null}
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>Cancelar</Button>
            <Button onClick={confirmar} disabled={loading}>
              {loading ? "Registrando…" : "Confirmar pago"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
