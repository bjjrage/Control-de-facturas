"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { processInvoicePhoto, BulkFileResult } from "../bulk-actions";

const CONCURRENCY = 3;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const OUTCOME_TONE: Record<BulkFileResult["outcome"], "ok" | "warn" | "error"> = {
  matched: "ok",
  created_unmatched: "warn",
  needs_manual: "warn",
  error: "error",
};

const OUTCOME_LABEL: Record<BulkFileResult["outcome"], string> = {
  matched: "Conciliada",
  created_unmatched: "Cargada sin match",
  needs_manual: "Revisar a mano",
  error: "Error",
};

type Row = { fileName: string; status: "pending" | "done"; result?: BulkFileResult };

export function BulkUploadForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Safety net: a file dropped even slightly outside the drop zone (but still
  // somewhere on this page) would otherwise make the browser navigate to it
  // and open it as its own tab. Block that globally while this page is open.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (incoming.length === 0) return;
    setFiles((prev) => [...prev, ...incoming]);
  }

  async function runBatch() {
    setRunning(true);
    const initialRows: Row[] = files.map((f) => ({ fileName: f.name, status: "pending" }));
    setRows(initialRows);

    let nextIndex = 0;
    async function worker() {
      while (nextIndex < files.length) {
        const i = nextIndex++;
        const fd = new FormData();
        fd.set("file", files[i]);
        fd.set("batch_date", batchDate);
        let res: BulkFileResult;
        try {
          res = await processInvoicePhoto(fd);
        } catch {
          // A network hiccup or a server timeout must never leave this file
          // (or the rest of this worker's queue) stuck at "Leyendo…" forever.
          res = {
            fileName: files[i].name,
            outcome: "error",
            message: "Se cortó la conexión al leerla (puede haber tardado demasiado) — probala de nuevo.",
          };
        }
        setRows((prev) => prev.map((r, idx) => (idx === i ? { fileName: res.fileName, status: "done", result: res } : r)));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    setRunning(false);
  }

  const doneCount = rows.filter((r) => r.status === "done").length;
  const summary = rows.reduce(
    (acc, r) => {
      if (r.result) acc[r.result.outcome] = (acc[r.result.outcome] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<BulkFileResult["outcome"], number>>
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
            disabled={running}
          />
        </div>

        <div>
          <Label>Fotos de las facturas</Label>
          <div
            onClick={() => !running && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!running) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              if (!running) addFiles(e.dataTransfer.files);
            }}
            className={`rounded-lg border-2 border-dashed p-8 text-center text-[13px] cursor-pointer transition-colors ${
              dragOver ? "border-[var(--primary)] bg-[var(--primary-bg)]" : "border-[var(--border)] bg-[var(--panel-2)]"
            } ${running ? "opacity-50 pointer-events-none" : ""}`}
          >
            <p className="font-medium mb-1">Arrastrá acá las facturas, o hacé clic para elegirlas</p>
            <p className="text-[var(--muted)]">Fotos (JPG, PNG, WEBP) o PDF de factura electrónica — podés soltar varias juntas</p>
            {files.length > 0 ? (
              <p className="mt-2 text-[var(--primary)] font-medium">{files.length} archivo(s) listos</p>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={running}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" disabled={files.length === 0 || running} onClick={runBatch}>
            {running ? `Procesando ${doneCount}/${files.length}…` : `Procesar ${files.length || ""} factura${files.length === 1 ? "" : "s"}`}
          </Button>
          {files.length > 0 && !running ? (
            <Button type="button" variant="ghost" onClick={() => setFiles([])}>
              Vaciar
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.length === doneCount ? (
            <div className="flex gap-3 text-[12px] text-[var(--muted)]">
              <span>✅ Conciliadas: {summary.matched ?? 0}</span>
              <span>🟡 Sin match: {summary.created_unmatched ?? 0}</span>
              <span>✋ A mano: {summary.needs_manual ?? 0}</span>
              <span>❌ Errores: {summary.error ?? 0}</span>
            </div>
          ) : null}
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
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.fileName}</td>
                    <td>{r.result?.providerName ?? "-"}</td>
                    <td className="num">{r.result?.total ? formatMoney(r.result.total, "PYG") : "-"}</td>
                    <td>
                      {r.status === "pending" ? (
                        <span className="text-[12px] text-[var(--muted)]">Leyendo…</span>
                      ) : (
                        <Badge tone={OUTCOME_TONE[r.result!.outcome]}>{OUTCOME_LABEL[r.result!.outcome]}</Badge>
                      )}
                    </td>
                    <td className="text-[12px] text-[var(--muted)]">
                      {r.result?.invoiceId ? (
                        <Link href={`/invoices/${r.result.invoiceId}`} className="hover:underline">
                          {r.result.message}
                        </Link>
                      ) : (
                        (r.result?.message ?? "")
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
