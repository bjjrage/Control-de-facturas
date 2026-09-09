"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { construirProyeccion, type FlujoItem } from "@/lib/flujo-caja";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  CuentaFinanciera,
  CurrencyCode,
  GastoRecurrente,
  GastoRecurrenteCategoria,
  GastoRecurrentePeriodicidad,
  Project,
} from "@/lib/types";

import {
  crearGastoRecurrente,
  eliminarGastoRecurrente,
  setGastoRecurrenteActivo,
} from "./gastos-actions";

type ProyectoLite = Pick<Project, "id" | "name" | "code" | "status" | "comitente">;

const CATEGORIA_LABEL: Record<GastoRecurrenteCategoria, string> = {
  ALQUILER: "Alquiler",
  SUELDOS: "Sueldos",
  SEGUROS: "Seguros",
  PRESTAMO: "Préstamo",
  SERVICIOS: "Servicios",
  IMPUESTOS: "Impuestos",
  HONORARIOS: "Honorarios",
  OTRO: "Otro",
};

const PERIODICIDAD_LABEL: Record<GastoRecurrentePeriodicidad, string> = {
  MENSUAL: "Mensual",
  BIMESTRAL: "Bimestral",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

const TIPO_LABEL: Record<FlujoItem["tipo"], string> = {
  cobro_factura: "Cobro de factura",
  cobro_certificado: "Cobro de certificado",
  pago_factura: "Pago de factura",
  gasto_recurrente: "Gasto recurrente",
};

const CURRENCIES: CurrencyCode[] = ["PYG", "USD", "EUR", "BRL", "ARS"];

export function FlujoCajaSection({
  saldoPorMoneda,
  items,
  gastos,
  cuentas,
  proyectos,
  hayCuentas,
}: {
  saldoPorMoneda: [CurrencyCode, number][];
  items: FlujoItem[];
  gastos: GastoRecurrente[];
  cuentas: CuentaFinanciera[];
  proyectos: ProyectoLite[];
  hayCuentas: boolean;
}) {
  const monedas = useMemo(() => {
    const s = new Set<CurrencyCode>(saldoPorMoneda.map(([m]) => m));
    for (const i of items) s.add(i.moneda);
    return [...s];
  }, [saldoPorMoneda, items]);

  const [moneda, setMoneda] = useState<CurrencyCode>(saldoPorMoneda[0]?.[0] ?? "PYG");
  const [gran, setGran] = useState<"semana" | "mes">("mes");
  const [projectId, setProjectId] = useState<string>("");

  const saldoInicial = useMemo(
    () => saldoPorMoneda.find(([m]) => m === moneda)?.[1] ?? 0,
    [saldoPorMoneda, moneda]
  );

  const proyeccion = useMemo(
    () => construirProyeccion(saldoInicial, items, moneda, gran, projectId || null),
    [saldoInicial, items, moneda, gran, projectId]
  );

  const proyectoById = useMemo(() => new Map(proyectos.map((p) => [p.id, p])), [proyectos]);

  if (!hayCuentas) {
    return (
      <div className="max-w-3xl mt-1">
        <h1 className="text-[17px] font-semibold">Flujo de caja</h1>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--muted)]">
          Todavía no hay cuentas financieras. Creá tus bancos y cajas en{" "}
          <Link href="/tesoreria" className="text-action">Tesorería</Link> para ver la proyección de caja.
        </div>
      </div>
    );
  }

  const maxAbs = Math.max(
    1,
    ...proyeccion.periodos.map((p) => Math.abs(p.saldoAcumulado)),
    Math.abs(saldoInicial)
  );

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <h1 className="text-[17px] font-semibold">Flujo de caja</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Saldo actual:{" "}
            {saldoPorMoneda.length > 0
              ? saldoPorMoneda.map(([m, t]) => formatMoney(t, m)).join(" · ")
              : "—"}
          </p>
        </div>
        <GastosDialog cuentas={cuentas} proyectos={proyectos} />
      </div>

      {/* Controles */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="fc-moneda">Moneda</Label>
          <Select
            id="fc-moneda"
            value={moneda}
            onChange={(e) => setMoneda((e.target as HTMLSelectElement).value as CurrencyCode)}
            className="w-28"
          >
            {monedas.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="fc-gran">Ver por</Label>
          <Select
            id="fc-gran"
            value={gran}
            onChange={(e) => setGran((e.target as HTMLSelectElement).value as "semana" | "mes")}
            className="w-32"
          >
            <option value="mes">Mes (6)</option>
            <option value="semana">Semana (12)</option>
          </Select>
        </div>
        {proyectos.length > 0 ? (
          <div>
            <Label htmlFor="fc-proj">Obra</Label>
            <Select
              id="fc-proj"
              value={projectId}
              onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todas</option>
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {proyeccion.primerPeriodoNegativo ? (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error-bg)] px-4 py-3 text-[13px]">
          <span className="font-semibold text-[var(--error)]">Alerta de caja.</span>{" "}
          Con lo proyectado, el saldo en {moneda} se vuelve negativo en{" "}
          <span className="font-semibold">
            {proyeccion.periodos.find((p) => p.clave === proyeccion.primerPeriodoNegativo)?.etiqueta}
          </span>.
        </div>
      ) : null}

      {/* Tabla de proyección */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Período</th>
              <th className="num">Entradas</th>
              <th className="num">Salidas</th>
              <th className="num">Neto</th>
              <th className="num">Saldo proyectado</th>
              <th className="w-40">Nivel</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-[var(--muted)]">Saldo actual</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num font-semibold">{formatMoney(saldoInicial, moneda)}</td>
              <td>
                <BarraSaldo valor={saldoInicial} max={maxAbs} />
              </td>
            </tr>
            {proyeccion.periodos.map((p) => {
              const neg = p.saldoAcumulado < 0;
              return (
                <tr key={p.clave} className={neg ? "bg-[var(--error-bg)]/40" : ""}>
                  <td className="font-medium">{p.etiqueta}</td>
                  <td className="num text-[var(--ok)]">{p.entradas > 0 ? formatMoney(p.entradas, moneda) : "—"}</td>
                  <td className="num text-[var(--error)]">{p.salidas > 0 ? "−" + formatMoney(p.salidas, moneda) : "—"}</td>
                  <td className={`num ${p.neto >= 0 ? "" : "text-[var(--error)]"}`}>
                    {p.neto >= 0 ? "" : "−"}{formatMoney(Math.abs(p.neto), moneda)}
                  </td>
                  <td className={`num font-semibold ${neg ? "text-[var(--error)]" : ""}`}>
                    {formatMoney(p.saldoAcumulado, moneda)}
                  </td>
                  <td>
                    <BarraSaldo valor={p.saldoAcumulado} max={maxAbs} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)]">
              <td className="font-semibold">Total ventana</td>
              <td className="num font-semibold text-[var(--ok)]">{formatMoney(proyeccion.totalEntradas, moneda)}</td>
              <td className="num font-semibold text-[var(--error)]">−{formatMoney(proyeccion.totalSalidas, moneda)}</td>
              <td className="num font-semibold">
                {formatMoney(proyeccion.totalEntradas - proyeccion.totalSalidas, moneda)}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Sin fecha */}
      {proyeccion.sinFecha.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">
            Sin fecha de vencimiento ({proyeccion.sinFecha.length})
          </h2>
          <p className="text-[12px] text-[var(--muted)] mb-2">
            No entran en la proyección hasta que tengan fecha. Cargá el vencimiento en la factura para ubicarlos.
          </p>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead>
                <tr><th>Concepto</th><th>Tipo</th><th className="num">Monto</th></tr>
              </thead>
              <tbody>
                {proyeccion.sinFecha.map((i) => (
                  <tr key={i.ref_id}>
                    <td>{i.descripcion}</td>
                    <td>{TIPO_LABEL[i.tipo]}</td>
                    <td className={`num ${i.monto >= 0 ? "text-[var(--ok)]" : "text-[var(--error)]"}`}>
                      {i.monto >= 0 ? "" : "−"}{formatMoney(Math.abs(i.monto), i.moneda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Detalle por período */}
      <details className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold">Detalle de movimientos proyectados</summary>
        <div className="px-4 pb-4 overflow-x-auto">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Obra</th><th className="num">Monto</th></tr>
            </thead>
            <tbody>
              {proyeccion.periodos.flatMap((p) =>
                [...p.items]
                  .sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""))
                  .map((i) => (
                    <tr key={i.ref_id}>
                      <td>{formatDate(i.fecha)}</td>
                      <td>{i.descripcion}</td>
                      <td>{TIPO_LABEL[i.tipo]}</td>
                      <td className="text-[var(--muted)]">
                        {i.project_id ? proyectoById.get(i.project_id)?.name ?? "—" : "—"}
                      </td>
                      <td className={`num ${i.monto >= 0 ? "text-[var(--ok)]" : "text-[var(--error)]"}`}>
                        {i.monto >= 0 ? "" : "−"}{formatMoney(Math.abs(i.monto), i.moneda)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </details>

      {/* Gastos recurrentes */}
      <div>
        <h2 className="text-[14px] font-semibold mb-2">Gastos recurrentes ({gastos.filter((g) => g.activo).length})</h2>
        {gastos.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-8 text-center text-[13px] text-[var(--muted)]">
            Sin gastos recurrentes. Cargá alquiler, sueldos, seguros y préstamos para que la proyección no mienta por abajo.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Descripción</th><th>Categoría</th><th>Periodicidad</th>
                  <th className="num">Monto</th><th></th>
                </tr>
              </thead>
              <tbody>
                {gastos.map((g) => (
                  <GastoRow key={g.id} gasto={g} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BarraSaldo({ valor, max }: { valor: number; max: number }) {
  const pct = Math.min(100, (Math.abs(valor) / max) * 100);
  const neg = valor < 0;
  return (
    <div className="relative h-3 w-full rounded bg-[var(--panel-2)] overflow-hidden">
      <div
        className={`absolute top-0 bottom-0 ${neg ? "right-1/2 bg-[var(--error)]" : "left-1/2 bg-[var(--ok)]"}`}
        style={{ width: `${pct / 2}%` }}
      />
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--border)]" />
    </div>
  );
}

function GastoRow({ gasto }: { gasto: GastoRecurrente }) {
  const router = useRouter();
  return (
    <tr className={gasto.activo ? "" : "opacity-50"}>
      <td className="font-medium">{gasto.descripcion}</td>
      <td>{CATEGORIA_LABEL[gasto.categoria]}</td>
      <td>{PERIODICIDAD_LABEL[gasto.periodicidad]}</td>
      <td className="num">{formatMoney(gasto.monto_estimado, gasto.moneda)}</td>
      <td className="flex gap-2 items-center">
        {!gasto.activo ? <Badge tone="neutral">Inactivo</Badge> : null}
        <button
          onClick={async () => { await setGastoRecurrenteActivo(gasto.id, !gasto.activo); router.refresh(); }}
          className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {gasto.activo ? "Desactivar" : "Reactivar"}
        </button>
        <button
          onClick={async () => {
            if (!confirm(`¿Eliminar "${gasto.descripcion}"?`)) return;
            await eliminarGastoRecurrente(gasto.id);
            router.refresh();
          }}
          className="text-[12px] text-[var(--error)] hover:underline"
        >
          Eliminar
        </button>
      </td>
    </tr>
  );
}

function GastosDialog({ cuentas, proyectos }: { cuentas: CuentaFinanciera[]; proyectos: ProyectoLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    descripcion: "",
    categoria: "ALQUILER" as GastoRecurrenteCategoria,
    monto_estimado: "",
    moneda: "PYG" as CurrencyCode,
    periodicidad: "MENSUAL" as GastoRecurrentePeriodicidad,
    dia_del_mes: "",
    cuenta_id: "",
    project_id: "",
    proximo_vencimiento: "",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await crearGastoRecurrente({
      descripcion: form.descripcion,
      categoria: form.categoria,
      monto_estimado: Number(form.monto_estimado),
      moneda: form.moneda,
      periodicidad: form.periodicidad,
      dia_del_mes: form.dia_del_mes ? Number(form.dia_del_mes) : null,
      cuenta_id: form.cuenta_id || null,
      project_id: form.project_id || null,
      proximo_vencimiento: form.proximo_vencimiento || null,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setForm({ ...form, descripcion: "", monto_estimado: "", dia_del_mes: "", proximo_vencimiento: "" });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Gasto recurrente</Button>
      </DialogTrigger>
      <DialogContent title="Nuevo gasto recurrente">
        <div className="space-y-3">
          <div>
            <Label htmlFor="gr-desc">Descripción *</Label>
            <Input
              id="gr-desc"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: (e.target as HTMLInputElement).value })}
              placeholder="Alquiler oficina / Sueldos administración"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="gr-cat">Categoría</Label>
              <Select
                id="gr-cat"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: (e.target as HTMLSelectElement).value as GastoRecurrenteCategoria })}
              >
                {(Object.keys(CATEGORIA_LABEL) as GastoRecurrenteCategoria[]).map((c) => (
                  <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <Label htmlFor="gr-per">Periodicidad</Label>
              <Select
                id="gr-per"
                value={form.periodicidad}
                onChange={(e) => setForm({ ...form, periodicidad: (e.target as HTMLSelectElement).value as GastoRecurrentePeriodicidad })}
              >
                {(Object.keys(PERIODICIDAD_LABEL) as GastoRecurrentePeriodicidad[]).map((p) => (
                  <option key={p} value={p}>{PERIODICIDAD_LABEL[p]}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="gr-monto">Monto estimado</Label>
              <Input
                id="gr-monto"
                type="number"
                value={form.monto_estimado}
                onChange={(e) => setForm({ ...form, monto_estimado: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div className="w-24">
              <Label htmlFor="gr-moneda">Moneda</Label>
              <Select
                id="gr-moneda"
                value={form.moneda}
                onChange={(e) => setForm({ ...form, moneda: (e.target as HTMLSelectElement).value as CurrencyCode })}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="w-28">
              <Label htmlFor="gr-dia">Día del mes</Label>
              <Input
                id="gr-dia"
                type="number"
                min="1"
                max="31"
                value={form.dia_del_mes}
                onChange={(e) => setForm({ ...form, dia_del_mes: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="gr-prox">Próximo vencimiento (opcional)</Label>
            <Input
              id="gr-prox"
              type="date"
              value={form.proximo_vencimiento}
              onChange={(e) => setForm({ ...form, proximo_vencimiento: (e.target as HTMLInputElement).value })}
              className="w-44"
            />
          </div>
          {proyectos.length > 0 ? (
            <div>
              <Label htmlFor="gr-proj">Imputar a obra (opcional)</Label>
              <Select
                id="gr-proj"
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
          {cuentas.length > 0 ? (
            <div>
              <Label htmlFor="gr-cuenta">Cuenta habitual (opcional)</Label>
              <Select
                id="gr-cuenta"
                value={form.cuenta_id}
                onChange={(e) => setForm({ ...form, cuenta_id: (e.target as HTMLSelectElement).value })}
              >
                <option value="">— Ninguna —</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </Select>
            </div>
          ) : null}
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || !form.descripcion.trim() || !form.monto_estimado}>
              {busy ? "Creando…" : "Crear"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
