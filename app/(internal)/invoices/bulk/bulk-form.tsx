"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { sanitizeFileName } from "@/lib/storage";
import { createClient } from "@/lib/supabase/browser";
import { InvoiceJob, InvoiceJobStatus, InvoiceJobOutcome } from "@/lib/types";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const STATUS_LABEL: Record<InvoiceJobStatus, string> = {
  queued: "En cola",
  processing: "Leyendo…",
  done: "Listo",
  needs_review: "Revisar a mano",
  failed: "Error",
};

const OUTCOME_TONE: Record<InvoiceJobOutcome, "ok" | "warn" | "error"> = {
  matched: "ok",
  created_unmatched: "warn",
  needs_manual: "warn",
  error: "error",
};
const OUTCOME_LABEL: Record<InvoiceJobOutcome, string> = {
  matched: "Conciliada",
  created_unmatched: "Cargada sin match",
  needs_manual: "Revisar a mano",
  error: "Error",
};

function rowTone(job: InvoiceJob): "ok" | "warn" | "error" | "neutral" {
  if (job.status === "done" || job.status === "needs_review" || job.status === "failed") {
    return job.outcome ? OUTCOME_TONE[job.outcome] : job.status === "failed" ? "error" : "warn";
  }
  return "neutral";
}
function rowLabel(job: InvoiceJob): string {
  if (job.status === "done" || job.status === "needs_review") {
    return job.outcome ? OUTCOME_LABEL[job.outcome] : STATUS_LABEL[job.status];
  }
  return STATUS_LABEL[job.status];
}

export function BulkUploadForm({ empresaId, userId }: { empresaId: string; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<File[]>([]);
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [jobs, setJobs] = useState<InvoiceJob[]>([]);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Un archivo soltado un poco fuera de la zona haría que el navegador lo abra
  // como pestaña. Bloqueamos eso a nivel ventana mientras esta página está abierta.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  // Realtime: seguir el estado de los jobs de este lote a medida que el worker los procesa.
  useEffect(() => {
    if (jobIds.length === 0) return;
    const idSet = new Set(jobIds);
    const channel = supabase
      .channel(`invoice_jobs_${jobIds[0]}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoice_jobs" },
        (payload) => {
          const row = payload.new as InvoiceJob;
          if (!row?.id || !idSet.has(row.id)) return;
          setJobs((prev) => prev.map((j) => (j.id === row.id ? row : j)));
        }
      )
      .subscribe();

    // Fallback por si se pierde algún evento: refetch cada 4s hasta que todos terminen.
    const poll = setInterval(async () => {
      const { data } = await supabase.from("invoice_jobs").select("*").in("id", jobIds);
      if (data) setJobs(data as InvoiceJob[]);
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [jobIds, supabase]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (incoming.length > 0) setFiles((prev) => [...prev, ...incoming]);
  }

  async function upload() {
    setUploading(true);
    setUploadError(null);
    const created: InvoiceJob[] = [];
    try {
      for (const file of files) {
        const path = `${empresaId}/inbox/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
        const up = await supabase.storage
          .from("invoice-files")
          .upload(path, file, { contentType: file.type || undefined });
        if (up.error) {
          setUploadError(`${file.name}: ${up.error.message}`);
          continue;
        }
        const { data, error } = await supabase
          .from("invoice_jobs")
          .insert({
            empresa_id: empresaId,
            created_by: userId,
            storage_path: path,
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            batch_date: batchDate,
          })
          .select("*")
          .single();
        if (error || !data) {
          setUploadError(`${file.name}: ${error?.message ?? "no se pudo encolar"}`);
          continue;
        }
        created.push(data as InvoiceJob);
      }
    } finally {
      setUploading(false);
    }
    if (created.length > 0) {
      setJobs((prev) => [...prev, ...created]);
      setJobIds((prev) => [...prev, ...created.map((j) => j.id)]);
      setFiles([]);
    }
  }

  const pending = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;
  const summary = jobs.reduce(
    (acc, j) => {
      if (j.outcome) acc[j.outcome] = (acc[j.outcome] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<InvoiceJobOutcome, number>>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
        <div>
          <Label htmlFor="batch_date">Fecha del lote (respaldo si una foto no muestra fecha)</Label>
          <Input
            id="batch_date"
            type="date"
            value={batchDate}
            onChange={(e) => setBatchDate(e.target.value)}
            className="w-40"
            disabled={uploading}
          />
        </div>

        <div>
          <Label>Fotos de las facturas</Label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!uploading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              if (!uploading) addFiles(e.dataTransfer.files);
            }}
            className={[
              "rounded-lg border-2 border-dashed p-6 text-center text-[13px] transition-colors",
              uploading ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              dragOver
                ? "border-[var(--primary)] bg-[var(--primary-bg)]"
                : files.length > 0
                  ? "border-[var(--primary)]/40 bg-[var(--primary-bg)]/30"
                  : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--primary)]/50 hover:bg-[var(--hover)]",
            ].join(" ")}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto mb-2 text-[var(--muted)]"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {files.length > 0 ? (
              <>
                <p className="font-medium text-[var(--primary)]">
                  {files.length} archivo{files.length !== 1 ? "s" : ""} seleccionado{files.length !== 1 ? "s" : ""}
                </p>
                <p className="text-[12px] text-[var(--muted)] mt-0.5">Clic para agregar más</p>
              </>
            ) : (
              <>
                <p className="font-medium">Arrastrá acá las facturas, o hacé clic para elegirlas</p>
                <p className="text-[12px] text-[var(--muted)] mt-0.5">
                  Fotos (JPG, PNG, WEBP) o PDF — podés soltar varias juntas
                </p>
              </>
            )}
          </div>

          {/* Lista de archivos seleccionados */}
          {files.length > 0 && !uploading ? (
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-[12px]"
                >
                  <span className="text-[var(--muted)] shrink-0">
                    {f.type === "application/pdf" ? "📄" : "🖼️"}
                  </span>
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-[11px] text-[var(--muted)] shrink-0">
                    {f.size > 1024 * 1024
                      ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.round(f.size / 1024)} KB`}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles((prev) => prev.filter((_, j) => j !== i));
                    }}
                    className="text-[var(--muted)] hover:text-[var(--error)] shrink-0 leading-none"
                    title="Quitar"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {uploadError ? (
          <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
            {uploadError}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="button" disabled={files.length === 0 || uploading} onClick={upload}>
            {uploading ? "Subiendo…" : `Subir ${files.length || ""} factura${files.length === 1 ? "" : "s"}`}
          </Button>
          {files.length > 0 && !uploading ? (
            <Button type="button" variant="ghost" onClick={() => setFiles([])}>
              Vaciar
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Se procesan en segundo plano — no hace falta esperar acá, las filas de abajo se actualizan solas.
        </p>
      </div>

      {jobs.length > 0 ? (
        <div className="space-y-2">
          {pending === 0 ? (
            <div className="flex gap-3 text-[12px] text-[var(--muted)]">
              <span>✅ Conciliadas: {summary.matched ?? 0}</span>
              <span>🟡 Sin match: {summary.created_unmatched ?? 0}</span>
              <span>✋ A revisar: {summary.needs_manual ?? 0}</span>
              <span>❌ Errores: {summary.error ?? 0}</span>
              {(summary.needs_manual ?? 0) > 0 ? (
                <Link href="/invoices/revision" className="text-action text-[var(--primary)]">
                  Ir a revisión →
                </Link>
              ) : null}
              <Link href="/invoices" className="text-action text-[var(--primary)] ml-auto">
                Ver todas las facturas →
              </Link>
            </div>
          ) : (
            <div className="text-[12px] text-[var(--muted)]">Procesando {jobs.length - pending}/{jobs.length}…</div>
          )}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Proveedor</th>
                  <th className="num">Total</th>
                  <th>Resultado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.file_name}</td>
                    <td>{j.extracted?.provider_name ?? "-"}</td>
                    <td className="num">{j.extracted?.total ? formatMoney(j.extracted.total, "PYG") : "-"}</td>
                    <td>
                      {j.status === "queued" || j.status === "processing" ? (
                        <span className="text-[12px] text-[var(--muted)]">{STATUS_LABEL[j.status]}</span>
                      ) : (
                        <Badge tone={rowTone(j)}>{rowLabel(j)}</Badge>
                      )}
                    </td>
                    <td className="text-[12px] text-[var(--muted)]">
                      {j.invoice_id ? (
                        <Link href={`/invoices/${j.invoice_id}`} className="text-action">
                          {j.message}
                        </Link>
                      ) : (
                        j.message ?? ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
