"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BackButton } from "@/components/ui/back-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import type { EmpresaDocumento } from "@/lib/types";

import { crearDocumentoEmpresa, eliminarDocumentoEmpresa } from "./actions";

// Documentos típicos de una carpeta de licitación en Paraguay.
const TIPOS_SUGERIDOS = [
  "Certificado de cumplimiento tributario (SET)",
  "Certificado de no ser deudor (SET)",
  "Constancia de IPS",
  "Patente comercial municipal",
  "RUC",
  "Poder del representante legal",
  "Acta de constitución / estatutos",
  "Balance auditado",
  "Certificado de cumplimiento con la seguridad social",
  "Certificado del Registro de Proveedores del Estado",
  "Declaración jurada Art. 40",
];

function diasHasta(iso: string | null): number | null {
  if (!iso) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

function estadoVencimiento(iso: string | null): { label: string; tone: "ok" | "warn" | "error" | "neutral" } {
  const dias = diasHasta(iso);
  if (dias === null) return { label: "Sin vencimiento", tone: "neutral" };
  if (dias < 0) return { label: `Vencido hace ${-dias}d`, tone: "error" };
  if (dias <= 30) return { label: `Vence en ${dias}d`, tone: "warn" };
  return { label: `Vigente (${dias}d)`, tone: "ok" };
}

export function DocumentosSection({ documentos }: { documentos: EmpresaDocumento[] }) {
  const router = useRouter();

  const { vencidos, porVencer, vigentes, sinVenc } = useMemo(() => {
    const v: EmpresaDocumento[] = [];
    const p: EmpresaDocumento[] = [];
    const ok: EmpresaDocumento[] = [];
    const sv: EmpresaDocumento[] = [];
    for (const d of documentos) {
      const dias = diasHasta(d.fecha_vencimiento);
      if (dias === null) sv.push(d);
      else if (dias < 0) v.push(d);
      else if (dias <= 30) p.push(d);
      else ok.push(d);
    }
    return { vencidos: v, porVencer: p, vigentes: ok, sinVenc: sv };
  }, [documentos]);

  function renderTabla(rows: EmpresaDocumento[]) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Documento</th>
              <th>Emisión</th>
              <th>Vencimiento</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const est = estadoVencimiento(d.fecha_vencimiento);
              return (
                <tr key={d.id}>
                  <td>
                    <div className="font-medium">{d.tipo}</div>
                    {d.descripcion ? <div className="text-[11px] text-[var(--muted)]">{d.descripcion}</div> : null}
                  </td>
                  <td>{d.fecha_emision ? formatDate(d.fecha_emision) : "—"}</td>
                  <td>{d.fecha_vencimiento ? formatDate(d.fecha_vencimiento) : "—"}</td>
                  <td><Badge tone={est.tone}>{est.label}</Badge></td>
                  <td>
                    <button
                      onClick={async () => {
                        if (!confirm(`¿Eliminar "${d.tipo}"?`)) return;
                        await eliminarDocumentoEmpresa(d.id);
                        router.refresh();
                      }}
                      className="text-[12px] text-[var(--error)] hover:underline"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <BackButton label="Volver a Licitaciones" />
      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <h1 className="text-[17px] font-semibold">Documentos de la empresa</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Certificados y constancias para la carpeta de licitación, con control de vencimiento.
          </p>
        </div>
        <NuevoDocumentoDialog />
      </div>

      {vencidos.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--error)] mb-2">Vencidos ({vencidos.length})</h2>
          {renderTabla(vencidos)}
        </div>
      ) : null}

      {porVencer.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--warn)] mb-2">Vencen dentro de 30 días ({porVencer.length})</h2>
          {renderTabla(porVencer)}
        </div>
      ) : null}

      {vigentes.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">Vigentes ({vigentes.length})</h2>
          {renderTabla(vigentes)}
        </div>
      ) : null}

      {sinVenc.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">Sin fecha de vencimiento ({sinVenc.length})</h2>
          {renderTabla(sinVenc)}
        </div>
      ) : null}

      {documentos.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-14 text-center text-[13px] text-[var(--muted)]">
          Todavía no cargaste ningún documento. Empezá por el certificado de cumplimiento tributario y la constancia de IPS.
        </div>
      ) : null}
    </div>
  );
}

function NuevoDocumentoDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    tipo: "",
    tipoLibre: "",
    descripcion: "",
    fecha_emision: "",
    fecha_vencimiento: "",
    notas: "",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    const tipo = form.tipo === "__otro__" ? form.tipoLibre : form.tipo;
    const res = await crearDocumentoEmpresa({
      tipo,
      descripcion: form.descripcion || undefined,
      fecha_emision: form.fecha_emision || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      notas: form.notas || undefined,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setForm({ tipo: "", tipoLibre: "", descripcion: "", fecha_emision: "", fecha_vencimiento: "", notas: "" });
    router.refresh();
  }

  const tipoValido = form.tipo === "__otro__" ? form.tipoLibre.trim().length > 0 : form.tipo.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Documento</Button>
      </DialogTrigger>
      <DialogContent title="Nuevo documento de la empresa">
        <div className="space-y-3">
          <div>
            <Label htmlFor="doc-tipo">Tipo *</Label>
            <Select
              id="doc-tipo"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: (e.target as HTMLSelectElement).value })}
            >
              <option value="">Elegí…</option>
              {TIPOS_SUGERIDOS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="__otro__">Otro (escribir)</option>
            </Select>
          </div>
          {form.tipo === "__otro__" ? (
            <div>
              <Label htmlFor="doc-tipo-libre">Nombre del documento</Label>
              <Input
                id="doc-tipo-libre"
                value={form.tipoLibre}
                onChange={(e) => setForm({ ...form, tipoLibre: (e.target as HTMLInputElement).value })}
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="doc-desc">Descripción / número</Label>
            <Input
              id="doc-desc"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: (e.target as HTMLInputElement).value })}
              placeholder="N° de certificado, entidad emisora…"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="doc-emi">Emisión</Label>
              <Input
                id="doc-emi"
                type="date"
                value={form.fecha_emision}
                onChange={(e) => setForm({ ...form, fecha_emision: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="doc-venc">Vencimiento</Label>
              <Input
                id="doc-venc"
                type="date"
                value={form.fecha_vencimiento}
                onChange={(e) => setForm({ ...form, fecha_vencimiento: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="doc-notas">Notas</Label>
            <Textarea
              id="doc-notas"
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: (e.target as HTMLTextAreaElement).value })}
            />
          </div>
          {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || !tipoValido}>{busy ? "Guardando…" : "Guardar"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
