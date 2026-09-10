"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import type { CurrencyCode, Licitacion, LicitacionDecision, LicitacionPerfil } from "@/lib/types";

import {
  guardarPerfilLicitaciones,
  importarLicitacion,
  setLicitacionDecision,
  importarPlanillaCostosHistoricos
} from "./actions";

const DECISION_LABEL: Record<LicitacionDecision, string> = {
  SIN_REVISAR: "Sin revisar",
  DESCARTADA: "Descartada",
  EN_PREPARACION: "En preparación",
  PRESENTADA: "Presentada",
  GANADA: "Ganada",
  PERDIDA: "Perdida",
};

function diasHasta(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

export function LicitacionesSection({
  licitaciones,
  perfil,
}: {
  licitaciones: Partial<Licitacion>[];
  perfil: LicitacionPerfil | null;
}) {
  const [filtro, setFiltro] = useState<"activas" | "todas" | LicitacionDecision>("activas");

  const filtradas = useMemo(() => {
    if (filtro === "todas") return licitaciones;
    if (filtro === "activas") {
      return licitaciones.filter(
        (l) => l.decision !== "DESCARTADA" && l.decision !== "PERDIDA" && l.decision !== "GANADA"
      );
    }
    return licitaciones.filter((l) => l.decision === filtro);
  }, [licitaciones, filtro]);

  const invitadas = licitaciones.filter((l) => l.invitada).length;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <h1 className="text-[17px] font-semibold">Licitaciones</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            {licitaciones.length} seguida{licitaciones.length !== 1 ? "s" : ""}
            {invitadas > 0 ? ` · ${invitadas} con invitación` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/licitaciones/documentos"
            className="inline-flex items-center h-8 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[13px] font-medium hover:bg-[var(--hover)]"
          >
            Bóveda de Documentos
          </Link>
          <ImportarCostosDialog />
          <PerfilDialog perfil={perfil} />
          <ImportarDialog />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([
          ["activas", "Activas"],
          ["SIN_REVISAR", "Sin revisar"],
          ["EN_PREPARACION", "En preparación"],
          ["PRESENTADA", "Presentadas"],
          ["GANADA", "Ganadas"],
          ["PERDIDA", "Perdidas"],
          ["todas", "Todas"],
        ] as [typeof filtro, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={`text-[12px] px-2.5 py-1 rounded-md border transition-colors ${
              filtro === k
                ? "bg-[var(--nav-active)] text-white border-transparent"
                : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-14 text-center text-[13px] text-[var(--muted)]">
          {licitaciones.length === 0
            ? "Todavía no seguís ninguna licitación. Importá una pegando su número de la DNCP."
            : "Nada en este filtro."}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Licitación</th>
                <th>Comitente</th>
                <th className="num">Referencial</th>
                <th>Entrega ofertas</th>
                <th>Estado</th>
                <th>Seguimiento</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((l) => (
                <LicitacionRow key={l.id} lic={l} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LicitacionRow({ lic }: { lic: Partial<Licitacion> }) {
  const router = useRouter();
  const dias = diasHasta(lic.fecha_entrega_ofertas);
  const urgente = dias !== null && dias >= 0 && dias <= 3;
  const vencida = dias !== null && dias < 0;

  return (
    <tr>
      <td className="mono text-[12px] text-[var(--muted)]">{lic.dncp_nro}</td>
      <td>
        <Link href={`/licitaciones/${lic.id}`} className="text-action font-medium">
          {lic.titulo && lic.titulo.length > 70 ? lic.titulo.slice(0, 70) + "…" : lic.titulo}
        </Link>
        {lic.invitada ? (
          <span className="ml-2 inline-block text-[10px] font-semibold uppercase tracking-wide text-[var(--ok)] bg-[var(--ok-bg)] px-1.5 py-0.5 rounded">
            Invitada
          </span>
        ) : null}
      </td>
      <td className="text-[var(--muted)]">{lic.comitente_nombre ?? "—"}</td>
      <td className="num">
        {lic.monto_referencial ? formatMoney(lic.monto_referencial, (lic.moneda ?? "PYG") as CurrencyCode) : "—"}
      </td>
      <td className={vencida ? "text-[var(--muted)]" : urgente ? "text-[var(--error)] font-medium" : ""}>
        {lic.fecha_entrega_ofertas ? (
          <>
            {formatDate(lic.fecha_entrega_ofertas)}
            {dias !== null ? (
              <span className="ml-1 text-[11px]">
                {vencida ? "(cerró)" : dias === 0 ? "(hoy)" : `(${dias}d)`}
              </span>
            ) : null}
          </>
        ) : (
          "—"
        )}
      </td>
      <td>
        <span className="text-[12px] text-[var(--muted)]">{lic.estado_detalle ?? lic.estado ?? "—"}</span>
      </td>
      <td>
        <select
          value={lic.decision ?? "SIN_REVISAR"}
          onChange={async (e) => {
            await setLicitacionDecision(lic.id as string, e.target.value as LicitacionDecision);
            router.refresh();
          }}
          className="text-[12px] rounded border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-1 outline-none"
        >
          {(Object.keys(DECISION_LABEL) as LicitacionDecision[]).map((d) => (
            <option key={d} value={d}>{DECISION_LABEL[d]}</option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function ImportarDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await importarLicitacion(valor.trim());
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOk(`Licitación ${res.nro} importada.`);
    setValor("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Importar de la DNCP</Button>
      </DialogTrigger>
      <DialogContent title="Importar licitación de la DNCP">
        <div className="space-y-3">
          <div>
            <Label htmlFor="imp-nro">Número de licitación o URL</Label>
            <Input
              id="imp-nro"
              value={valor}
              onChange={(e) => setValor((e.target as HTMLInputElement).value)}
              placeholder="391731  ·  ocds-03ad3f-391731  ·  contrataciones.gov.py/…"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Se baja la convocatoria, la planilla de ítems con precio referencial, los oferentes y los documentos.
            </p>
          </div>
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          {ok ? <p className="text-[12px] text-[var(--ok)]">{ok}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cerrar</Button>
            <Button onClick={submit} disabled={busy || !valor.trim()}>
              {busy ? "Importando…" : "Importar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PerfilDialog({ perfil }: { perfil: LicitacionPerfil | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    codigos: (perfil?.codigos_catalogo ?? []).join(", "),
    palabras: (perfil?.palabras_clave ?? []).join(", "),
    monto_min: perfil?.monto_min?.toString() ?? "",
    monto_max: perfil?.monto_max?.toString() ?? "",
    departamentos: (perfil?.departamentos ?? []).join(", "),
  });

  const split = (s: string) =>
    s.split(",").map((x) => x.trim()).filter(Boolean);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await guardarPerfilLicitaciones({
      codigos_catalogo: split(form.codigos),
      palabras_clave: split(form.palabras),
      monto_min: form.monto_min ? Number(form.monto_min) : null,
      monto_max: form.monto_max ? Number(form.monto_max) : null,
      departamentos: split(form.departamentos),
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
        <Button variant="secondary">Perfil de radar</Button>
      </DialogTrigger>
      <DialogContent title="Perfil de radar de licitaciones">
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--muted)]">
            Define qué licitaciones te interesan. El radar (próximamente automático) usa esto para filtrar.
          </p>
          <div>
            <Label htmlFor="pf-cat">Códigos de catálogo N5 (separados por coma)</Label>
            <Input
              id="pf-cat"
              value={form.codigos}
              onChange={(e) => setForm({ ...form, codigos: (e.target as HTMLInputElement).value })}
              placeholder="72131701-002, 72141100-001"
            />
          </div>
          <div>
            <Label htmlFor="pf-kw">Palabras clave en el título</Label>
            <Textarea
              id="pf-kw"
              value={form.palabras}
              onChange={(e) => setForm({ ...form, palabras: (e.target as HTMLTextAreaElement).value })}
              placeholder="empedrado, pavimento, alcantarillado, edificio"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="pf-min">Monto mínimo</Label>
              <Input
                id="pf-min"
                type="number"
                value={form.monto_min}
                onChange={(e) => setForm({ ...form, monto_min: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="pf-max">Monto máximo</Label>
              <Input
                id="pf-max"
                type="number"
                value={form.monto_max}
                onChange={(e) => setForm({ ...form, monto_max: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-dep">Departamentos</Label>
            <Input
              id="pf-dep"
              value={form.departamentos}
              onChange={(e) => setForm({ ...form, departamentos: (e.target as HTMLInputElement).value })}
              placeholder="Central, Cordillera, Paraguarí"
            />
          </div>
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

function ImportarCostosDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [nombreObra, setNombreObra] = useState("");
  const [fechaObra, setFechaObra] = useState(new Date().toISOString().split("T")[0]);
  const [file, setFile] = useState<File | null>(null);

  async function submit() {
    if (!file) {
      setError("Seleccioná un archivo Excel o CSV.");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("nombre_obra", nombreObra.trim() || "Obra Histórica");
    fd.append("fecha_obra", fechaObra);

    const res = await importarPlanillaCostosHistoricos(fd);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOk(`Se importaron exitosamente ${res.importados} observaciones de costo real para calibrar el Cost Engine.`);
    setFile(null);
    setNombreObra("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">+ Calibrar Costos (Excel)</Button>
      </DialogTrigger>
      <DialogContent title="Calibrar Cost Engine con Obras Anteriores">
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--muted)]">
            Subí planillas de cómputo métrico o precios unitarios de obras anteriores (Excel o CSV). El sistema inferirá automáticamente las columnas, categorías de insumo (materiales, equipos, combustibles) y precios unitarios.
          </p>
          <div>
            <Label htmlFor="cost-obra">Nombre o referencia de la obra</Label>
            <Input
              id="cost-obra"
              value={nombreObra}
              onChange={(e) => setNombreObra((e.target as HTMLInputElement).value)}
              placeholder="Ej: Pavimentación Av. Santa Teresa (2024)"
            />
          </div>
          <div>
            <Label htmlFor="cost-fecha">Fecha aproximada de los costos</Label>
            <Input
              id="cost-fecha"
              type="date"
              value={fechaObra}
              onChange={(e) => setFechaObra((e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <Label htmlFor="cost-file">Archivo Excel (.xlsx, .xls) o CSV *</Label>
            <Input
              id="cost-file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) setFile(f);
              }}
            />
          </div>
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          {ok ? <p className="text-[12px] text-[var(--ok)] font-medium">{ok}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cerrar</Button>
            <Button onClick={submit} disabled={busy || !file}>
              {busy ? "Procesando…" : "Importar y Calibrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
