"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SalesDocType } from "@/lib/types";
import { generateTemplate, saveTemplate, deleteTemplate } from "./actions";

const SAMPLE: Record<string, string> = {
  "{{EMPRESA_NOMBRE}}": "Empresa Ejemplo S.A.",
  "{{EMPRESA_RUC}}": "80012345-6",
  "{{EMPRESA_DIRECCION}}": "Av. Mariscal López 1234, Asunción",
  "{{EMPRESA_TELEFONO}}": "+595 21 555-0000",
  "{{EMPRESA_EMAIL}}": "info@empresa.com",
  "{{LOGO_URL}}": "",
  "{{DOC_TIPO}}": "Factura",
  "{{DOC_CODIGO}}": "F-000001",
  "{{DOC_FECHA_EMISION}}": "03/09/2026",
  "{{DOC_FECHA_VENCIMIENTO}}": "03/10/2026",
  "{{CLIENTE_NOMBRE}}": "Cliente Demo S.R.L.",
  "{{CLIENTE_RUC}}": "9876543-2",
  "{{CLIENTE_DIRECCION}}": "Calle Principal 456, Asunción",
  "{{ITEMS_HTML}}": `<table style="width:100%;border-collapse:collapse;font-size:inherit;">
  <thead><tr style="border-bottom:2px solid currentColor;">
    <th style="padding:4px;text-align:left;">Descripción</th>
    <th style="padding:4px;text-align:right;">Cant.</th>
    <th style="padding:4px;text-align:right;">Precio unit.</th>
    <th style="padding:4px;text-align:center;">IVA</th>
    <th style="padding:4px;text-align:right;">Total</th>
  </tr></thead>
  <tbody>
    <tr><td style="padding:3px 4px;border-bottom:1px solid #ddd;">Servicio de diseño web</td><td style="padding:3px 4px;text-align:right;">1</td><td style="padding:3px 4px;text-align:right;">Gs. 500.000</td><td style="padding:3px 4px;text-align:center;">10%</td><td style="padding:3px 4px;text-align:right;">Gs. 500.000</td></tr>
    <tr><td style="padding:3px 4px;border-bottom:1px solid #ddd;">Hosting anual</td><td style="padding:3px 4px;text-align:right;">1</td><td style="padding:3px 4px;text-align:right;">Gs. 200.000</td><td style="padding:3px 4px;text-align:center;">10%</td><td style="padding:3px 4px;text-align:right;">Gs. 200.000</td></tr>
  </tbody>
</table>`,
  "{{NETO}}": "Gs. 636.364",
  "{{IVA}}": "Gs. 63.636",
  "{{TOTAL}}": "Gs. 700.000",
  "{{NOTAS}}": "Pago dentro de 30 días.",
};

function injectSample(html: string): string {
  let result = html;
  for (const [key, val] of Object.entries(SAMPLE)) {
    result = result.replaceAll(key, val);
  }
  return result;
}

export function TemplateEditor({
  docType,
  label,
  empresaId,
  hasTemplate,
}: {
  docType: SalesDocType;
  label: string;
  empresaId: string;
  hasTemplate: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "generated" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [saved, setSaved] = useState(hasTemplate);
  const [deleting, setDeleting] = useState(false);

  async function handleGenerate() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Seleccioná una imagen."); return; }
    setError(null);
    setStatus("generating");
    const fd = new FormData();
    fd.append("imagen", file);
    fd.append("doc_type", docType);
    const result = await generateTemplate(fd);
    if (result.error) { setError(result.error); setStatus("idle"); return; }
    const html = result.html!;
    setRawHtml(html);
    setPreviewHtml(injectSample(html));
    setStatus("generated");
  }

  async function handleSave() {
    if (!rawHtml) return;
    setStatus("saving");
    setError(null);
    const result = await saveTemplate(empresaId, docType, rawHtml);
    if (result.error) { setError(result.error); setStatus("generated"); return; }
    setSaved(true);
    setStatus("saved");
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar la plantilla de ${label}?`)) return;
    setDeleting(true);
    await deleteTemplate(empresaId, docType);
    setSaved(false);
    setRawHtml(null);
    setPreviewHtml(null);
    setStatus("idle");
    setDeleting(false);
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold">{label}</h3>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            {saved ? "✓ Plantilla guardada — se usa al imprimir" : "Sin plantilla — se usa el diseño por defecto"}
          </p>
        </div>
        {saved && status !== "generated" ? (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]"
          >
            {deleting ? "Eliminando…" : "Eliminar plantilla"}
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <div className="text-[13px] text-[var(--muted)]">
          Subí una foto o captura de tu formato actual:
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="text-[13px]"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleGenerate}
          disabled={status === "generating" || status === "saving"}
        >
          {status === "generating" ? "Generando…" : "Generar con IA"}
        </Button>
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {previewHtml ? (
        <div className="space-y-2">
          <div className="text-[12px] text-[var(--muted)]">
            Vista previa (con datos de ejemplo):
          </div>
          <iframe
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:white;color:black;font-family:sans-serif;font-size:13px;}</style></head><body>${previewHtml}</body></html>`}
            className="w-full rounded border border-[var(--border)] bg-white"
            style={{ height: "600px" }}
            title={`Preview ${label}`}
          />
          <div className="flex gap-2 justify-end">
            {status !== "saved" ? (
              <Button
                type="button"
                onClick={handleSave}
                disabled={status === "saving"}
              >
                {status === "saving" ? "Guardando…" : "Guardar plantilla"}
              </Button>
            ) : (
              <span className="text-[13px] text-[var(--ok)] font-medium">✓ Guardada</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
