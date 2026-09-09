"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  CuentaFinanciera,
  CuentaFinancieraTipo,
  CurrencyCode,
  MovimientoTesoreria,
  MovimientoTesoreriaTipo,
  Project,
} from "@/lib/types";

import {
  actualizarCuenta,
  crearCuenta,
  registrarMovimientoManual,
  registrarTransferencia,
  setCuentaActiva,
} from "./actions";

type ProyectoLite = Pick<Project, "id" | "name" | "code" | "status">;

const TIPO_LABEL: Record<CuentaFinancieraTipo, string> = {
  BANCO: "Banco",
  CAJA: "Caja",
  TARJETA: "Tarjeta",
  OTRO: "Otro",
};

const MOV_LABEL: Record<MovimientoTesoreriaTipo, string> = {
  COBRO: "Cobro",
  PAGO: "Pago",
  TRANSFERENCIA_IN: "Transferencia recibida",
  TRANSFERENCIA_OUT: "Transferencia enviada",
  INGRESO: "Ingreso",
  EGRESO: "Egreso",
  AJUSTE: "Ajuste",
  SALDO_INICIAL: "Saldo inicial",
};

const CURRENCIES: CurrencyCode[] = ["PYG", "USD", "EUR", "BRL", "ARS"];

export function TesoreriaSection({
  cuentas,
  movimientos,
  proyectos,
}: {
  cuentas: CuentaFinanciera[];
  movimientos: MovimientoTesoreria[];
  proyectos: ProyectoLite[];
}) {
  const [showInactivas, setShowInactivas] = useState(false);

  const cuentaById = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas]);
  const activas = cuentas.filter((c) => c.activo);
  const visibles = showInactivas ? cuentas : activas;

  const totalesPorMoneda = useMemo(() => {
    const m = new Map<CurrencyCode, number>();
    for (const c of activas) m.set(c.moneda, (m.get(c.moneda) ?? 0) + c.saldo);
    return [...m.entries()];
  }, [activas]);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <h1 className="text-[17px] font-semibold">Tesorería</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            {activas.length} cuenta{activas.length !== 1 ? "s" : ""} activa{activas.length !== 1 ? "s" : ""}
            {totalesPorMoneda.length > 0
              ? " · " + totalesPorMoneda.map(([mon, tot]) => formatMoney(tot, mon)).join(" · ")
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {activas.length >= 2 ? <TransferenciaDialog cuentas={activas} /> : null}
          <NuevaCuentaDialog />
        </div>
      </div>

      {/* Cuentas */}
      {visibles.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-12 text-center text-[13px] text-[var(--muted)]">
          Todavía no hay cuentas financieras. Creá tu primer banco o caja.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((c) => (
            <CuentaCard key={c.id} cuenta={c} proyectos={proyectos} />
          ))}
        </div>
      )}

      {cuentas.some((c) => !c.activo) ? (
        <button
          onClick={() => setShowInactivas((v) => !v)}
          className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {showInactivas ? "Ocultar" : "Mostrar"} cuentas inactivas
        </button>
      ) : null}

      {/* Movimientos recientes */}
      <div>
        <h2 className="text-[14px] font-semibold mb-2">Movimientos recientes</h2>
        {movimientos.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-10 text-center text-[13px] text-[var(--muted)]">
            Sin movimientos.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cuenta</th>
                  <th>Tipo</th>
                  <th>Detalle</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => {
                  const cuenta = cuentaById.get(m.cuenta_id);
                  const entra = m.monto > 0;
                  return (
                    <tr key={m.id}>
                      <td>{formatDate(m.fecha)}</td>
                      <td>{cuenta?.nombre ?? "—"}</td>
                      <td>{MOV_LABEL[m.tipo]}</td>
                      <td className="text-[var(--muted)]">{m.motivo ?? "—"}</td>
                      <td className={`num font-semibold ${entra ? "text-[var(--ok)]" : "text-[var(--error)]"}`}>
                        {entra ? "+" : "−"} {formatMoney(Math.abs(m.monto), cuenta?.moneda ?? "PYG")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Tarjeta de cuenta
// ──────────────────────────────────────────────

function CuentaCard({ cuenta, proyectos }: { cuenta: CuentaFinanciera; proyectos: ProyectoLite[] }) {
  const router = useRouter();
  const negativo = cuenta.saldo < 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-[14px]">{cuenta.nombre}</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">
            {TIPO_LABEL[cuenta.tipo]}
            {cuenta.banco ? ` · ${cuenta.banco}` : ""}
            {cuenta.numero_cuenta ? ` · ${cuenta.numero_cuenta}` : ""}
          </div>
        </div>
        {!cuenta.activo ? <Badge tone="neutral">Inactiva</Badge> : null}
      </div>

      <div>
        <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Saldo</div>
        <div className={`text-[20px] font-semibold tabular-nums ${negativo ? "text-[var(--error)]" : ""}`}>
          {formatMoney(cuenta.saldo, cuenta.moneda)}
        </div>
        {cuenta.saldo_conciliado != null ? (
          <div className="text-[11px] text-[var(--muted)] mt-0.5">
            Conciliado: {formatMoney(cuenta.saldo_conciliado, cuenta.moneda)}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 mt-auto pt-1">
        {cuenta.activo ? (
          <MovimientoDialog cuenta={cuenta} proyectos={proyectos} />
        ) : null}
        <EditarCuentaDialog cuenta={cuenta} />
        <button
          onClick={async () => {
            await setCuentaActiva(cuenta.id, !cuenta.activo);
            router.refresh();
          }}
          className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {cuenta.activo ? "Desactivar" : "Reactivar"}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Diálogo: nueva cuenta
// ──────────────────────────────────────────────

function NuevaCuentaDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    tipo: "BANCO" as CuentaFinancieraTipo,
    banco: "",
    numero_cuenta: "",
    moneda: "PYG" as CurrencyCode,
    saldo_inicial: "",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await crearCuenta({
      nombre: form.nombre,
      tipo: form.tipo,
      banco: form.banco || undefined,
      numero_cuenta: form.numero_cuenta || undefined,
      moneda: form.moneda,
      saldo_inicial: form.saldo_inicial ? Number(form.saldo_inicial) : undefined,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setForm({ nombre: "", tipo: "BANCO", banco: "", numero_cuenta: "", moneda: "PYG", saldo_inicial: "" });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Cuenta</Button>
      </DialogTrigger>
      <DialogContent title="Nueva cuenta financiera">
        <div className="space-y-3">
          <div>
            <Label htmlFor="cf-nombre">Nombre *</Label>
            <Input
              id="cf-nombre"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: (e.target as HTMLInputElement).value })}
              placeholder="Itaú cta. cte. / Caja obra Capiatá"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="cf-tipo">Tipo</Label>
              <Select
                id="cf-tipo"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: (e.target as HTMLSelectElement).value as CuentaFinancieraTipo })}
              >
                {(Object.keys(TIPO_LABEL) as CuentaFinancieraTipo[]).map((t) => (
                  <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                ))}
              </Select>
            </div>
            <div className="w-28">
              <Label htmlFor="cf-moneda">Moneda</Label>
              <Select
                id="cf-moneda"
                value={form.moneda}
                onChange={(e) => setForm({ ...form, moneda: (e.target as HTMLSelectElement).value as CurrencyCode })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="cf-banco">Banco</Label>
              <Input
                id="cf-banco"
                value={form.banco}
                onChange={(e) => setForm({ ...form, banco: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="cf-nro">Nº de cuenta</Label>
              <Input
                id="cf-nro"
                value={form.numero_cuenta}
                onChange={(e) => setForm({ ...form, numero_cuenta: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="cf-saldo">Saldo inicial</Label>
            <Input
              id="cf-saldo"
              type="number"
              value={form.saldo_inicial}
              onChange={(e) => setForm({ ...form, saldo_inicial: (e.target as HTMLInputElement).value })}
              placeholder="0"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Se registra como un movimiento &quot;Saldo inicial&quot;. Podés dejarlo en cero y cargar los movimientos después.
            </p>
          </div>
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || !form.nombre.trim()}>
              {busy ? "Creando…" : "Crear cuenta"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────
// Diálogo: editar cuenta
// ──────────────────────────────────────────────

function EditarCuentaDialog({ cuenta }: { cuenta: CuentaFinanciera }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: cuenta.nombre,
    tipo: cuenta.tipo,
    banco: cuenta.banco ?? "",
    numero_cuenta: cuenta.numero_cuenta ?? "",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await actualizarCuenta(cuenta.id, {
      nombre: form.nombre,
      tipo: form.tipo,
      banco: form.banco,
      numero_cuenta: form.numero_cuenta,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Editar</Button>
      </DialogTrigger>
      <DialogContent title={`Editar ${cuenta.nombre}`}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ec-nombre">Nombre</Label>
            <Input
              id="ec-nombre"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div>
            <Label htmlFor="ec-tipo">Tipo</Label>
            <Select
              id="ec-tipo"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: (e.target as HTMLSelectElement).value as CuentaFinancieraTipo })}
            >
              {(Object.keys(TIPO_LABEL) as CuentaFinancieraTipo[]).map((t) => (
                <option key={t} value={t}>{TIPO_LABEL[t]}</option>
              ))}
            </Select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="ec-banco">Banco</Label>
              <Input
                id="ec-banco"
                value={form.banco}
                onChange={(e) => setForm({ ...form, banco: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="ec-nro">Nº de cuenta</Label>
              <Input
                id="ec-nro"
                value={form.numero_cuenta}
                onChange={(e) => setForm({ ...form, numero_cuenta: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            El saldo no se edita acá — se corrige con un movimiento de ajuste.
          </p>
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────
// Diálogo: movimiento manual (ingreso / egreso / ajuste)
// ──────────────────────────────────────────────

function MovimientoDialog({ cuenta, proyectos }: { cuenta: CuentaFinanciera; proyectos: ProyectoLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    tipo: "EGRESO" as "INGRESO" | "EGRESO" | "AJUSTE",
    monto: "",
    fecha: new Date().toISOString().slice(0, 10),
    motivo: "",
    project_id: "",
    ajusteSigno: "-" as "+" | "-",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    const montoRaw = Number(form.monto);
    const monto = form.tipo === "AJUSTE" ? (form.ajusteSigno === "-" ? -Math.abs(montoRaw) : Math.abs(montoRaw)) : montoRaw;
    const res = await registrarMovimientoManual({
      cuenta_id: cuenta.id,
      tipo: form.tipo,
      monto,
      fecha: form.fecha,
      motivo: form.motivo,
      project_id: form.project_id || null,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setForm({ ...form, monto: "", motivo: "", project_id: "" });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">+ Movimiento</Button>
      </DialogTrigger>
      <DialogContent title={`Movimiento — ${cuenta.nombre}`}>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="mv-tipo">Tipo</Label>
              <Select
                id="mv-tipo"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: (e.target as HTMLSelectElement).value as typeof form.tipo })}
              >
                <option value="INGRESO">Ingreso</option>
                <option value="EGRESO">Egreso</option>
                <option value="AJUSTE">Ajuste</option>
              </Select>
            </div>
            {form.tipo === "AJUSTE" ? (
              <div className="w-20">
                <Label htmlFor="mv-signo">Signo</Label>
                <Select
                  id="mv-signo"
                  value={form.ajusteSigno}
                  onChange={(e) => setForm({ ...form, ajusteSigno: (e.target as HTMLSelectElement).value as "+" | "-" })}
                >
                  <option value="-">−</option>
                  <option value="+">+</option>
                </Select>
              </div>
            ) : null}
            <div className="flex-1">
              <Label htmlFor="mv-monto">Monto ({cuenta.moneda})</Label>
              <Input
                id="mv-monto"
                type="number"
                value={form.monto}
                onChange={(e) => setForm({ ...form, monto: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="mv-fecha">Fecha</Label>
            <Input
              id="mv-fecha"
              type="date"
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: (e.target as HTMLInputElement).value })}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="mv-motivo">Motivo *</Label>
            <Input
              id="mv-motivo"
              value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: (e.target as HTMLInputElement).value })}
              placeholder="Alquiler oficina / Aporte de socio / Diferencia de conciliación"
            />
          </div>
          {proyectos.length > 0 ? (
            <div>
              <Label htmlFor="mv-proj">Imputar a obra (opcional)</Label>
              <Select
                id="mv-proj"
                value={form.project_id}
                onChange={(e) => setForm({ ...form, project_id: (e.target as HTMLSelectElement).value })}
              >
                <option value="">— Sin imputar —</option>
                {proyectos.map((p) => (
                  <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || !form.monto || !form.motivo.trim()}>
              {busy ? "Registrando…" : "Registrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────
// Diálogo: transferencia entre cuentas
// ──────────────────────────────────────────────

function TransferenciaDialog({ cuentas }: { cuentas: CuentaFinanciera[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    origen: cuentas[0]?.id ?? "",
    destino: cuentas[1]?.id ?? "",
    monto_origen: "",
    monto_destino: "",
    fecha: new Date().toISOString().slice(0, 10),
    motivo: "",
  });

  const cOrigen = cuentas.find((c) => c.id === form.origen);
  const cDestino = cuentas.find((c) => c.id === form.destino);
  const distintaMoneda = cOrigen && cDestino && cOrigen.moneda !== cDestino.moneda;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await registrarTransferencia({
      cuenta_origen_id: form.origen,
      cuenta_destino_id: form.destino,
      monto_origen: Number(form.monto_origen),
      monto_destino: distintaMoneda && form.monto_destino ? Number(form.monto_destino) : undefined,
      fecha: form.fecha,
      motivo: form.motivo || undefined,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setForm({ ...form, monto_origen: "", monto_destino: "", motivo: "" });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Transferencia</Button>
      </DialogTrigger>
      <DialogContent title="Transferencia entre cuentas">
        <div className="space-y-3">
          <div>
            <Label htmlFor="tr-origen">Desde</Label>
            <Select
              id="tr-origen"
              value={form.origen}
              onChange={(e) => setForm({ ...form, origen: (e.target as HTMLSelectElement).value })}
            >
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.moneda}) · {formatMoney(c.saldo, c.moneda)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tr-destino">Hacia</Label>
            <Select
              id="tr-destino"
              value={form.destino}
              onChange={(e) => setForm({ ...form, destino: (e.target as HTMLSelectElement).value })}
            >
              {cuentas.filter((c) => c.id !== form.origen).map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
              ))}
            </Select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="tr-monto">Monto {cOrigen ? `(${cOrigen.moneda})` : ""}</Label>
              <Input
                id="tr-monto"
                type="number"
                value={form.monto_origen}
                onChange={(e) => setForm({ ...form, monto_origen: (e.target as HTMLInputElement).value })}
              />
            </div>
            {distintaMoneda ? (
              <div className="flex-1">
                <Label htmlFor="tr-monto-dest">Se acredita ({cDestino?.moneda})</Label>
                <Input
                  id="tr-monto-dest"
                  type="number"
                  value={form.monto_destino}
                  onChange={(e) => setForm({ ...form, monto_destino: (e.target as HTMLInputElement).value })}
                />
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="tr-fecha">Fecha</Label>
            <Input
              id="tr-fecha"
              type="date"
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: (e.target as HTMLInputElement).value })}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="tr-motivo">Motivo</Label>
            <Input
              id="tr-motivo"
              value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: (e.target as HTMLInputElement).value })}
              placeholder="Reposición caja obra / Compra de dólares"
            />
          </div>
          {distintaMoneda && form.monto_origen && form.monto_destino ? (
            <p className="text-[11px] text-[var(--muted)]">
              Tipo de cambio: {(Number(form.monto_destino) / Number(form.monto_origen)).toFixed(4)}
            </p>
          ) : null}
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button
              onClick={submit}
              disabled={busy || !form.monto_origen || form.origen === form.destino || (distintaMoneda && !form.monto_destino)}
            >
              {busy ? "Transfiriendo…" : "Transferir"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
