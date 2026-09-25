"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, ExternalLink, FileText, Loader2, Plus, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { canAddManualWarehouseSubmissionLine, canConfirmWarehouseSubmission } from "@/lib/inventory/warehouse-submission-ui";
import {
  addManualWarehouseSubmissionLine,
  confirmCanonicalWarehouseSubmission,
  createInventoryLocation,
  createWarehousePortalLink,
  processWarehouseSubmission,
  revokeWarehousePortalLink,
  updateWarehouseSubmissionLine,
} from "@/app/(internal)/inventory/actions";
import type { WarehouseSubmissionLineState } from "@/lib/inventory/types";

export type SubmissionStatus = "UPLOADED" | "PROCESSING" | "NEEDS_REVIEW" | "READY" | "CONFIRMED" | "VOIDED";
export type LineState = WarehouseSubmissionLineState;

export type PanolLineRow = {
  id: string;
  raw_description: string;
  producto_id: string | null;
  producto: string | null;
  quantity: number | null;
  unit: string | null;
  budget_item_id: string | null;
  state: LineState;
  uncertainty_reason: string | null;
  notes: string | null;
  inventory_movement_id: string | null;
};

export type PanolEvidenceRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  extraction_status: "NOT_PROCESSED" | "PROCESSING" | "PROPOSED" | "FAILED" | "REVIEWED";
  extraction_error: string | null;
  signed_url: string | null;
};

export type PanolSubmissionRow = {
  id: string;
  location_name: string;
  period_start: string;
  period_end: string;
  status: SubmissionStatus;
  upload_incomplete: boolean;
  processing_error: string | null;
  evidence: PanolEvidenceRow[];
  lines: PanolLineRow[];
};

export type WarehousePortalLinkRow = {
  id: string;
  location_id: string;
  location_name: string;
  token_hint: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

type InventoryProduct = { id: string; nombre: string; unidad: string };
type BudgetChoice = { id: string; code: string; description: string; unit: string };
type ProjectLocation = { id: string; name: string };

const STATUS_TONE: Record<SubmissionStatus, "ok" | "warn" | "error" | "neutral"> = {
  UPLOADED: "neutral",
  PROCESSING: "neutral",
  NEEDS_REVIEW: "warn",
  READY: "warn",
  CONFIRMED: "ok",
  VOIDED: "error",
};

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  UPLOADED: "Recibida",
  PROCESSING: "Procesando",
  NEEDS_REVIEW: "Requiere revisión",
  READY: "Lista para confirmar",
  CONFIRMED: "Confirmada",
  VOIDED: "Anulada",
};

const LINE_STATE_LABEL: Record<LineState, string> = {
  PROPOSED: "Pendiente de revisión",
  CONFIRMED: "Confirmar para consumo",
  REJECTED: "Ignorar línea",
};

function expiryLabel(value: string | null) {
  if (!value) return "Sin fecha de vencimiento";
  return `Vence ${formatDate(value)}`;
}

function SubmissionLineEditor({
  line,
  products,
  budgetItems,
  disabled,
}: {
  line: PanolLineRow;
  products: InventoryProduct[];
  budgetItems: BudgetChoice[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    rawDescription: line.raw_description,
    productoId: line.producto_id ?? "",
    quantity: line.quantity == null ? "" : String(line.quantity),
    unit: line.unit ?? "",
    budgetItemId: line.budget_item_id ?? "",
    state: line.state,
    notes: line.notes ?? "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = disabled || !!line.inventory_movement_id;

  async function save() {
    setPending(true);
    setError(null);
    const result = await updateWarehouseSubmissionLine({
      lineId: line.id,
      rawDescription: draft.rawDescription,
      productoId: draft.productoId || null,
      quantity: draft.quantity === "" ? null : Number(draft.quantity),
      unit: draft.unit || null,
      budgetItemId: draft.budgetItemId || null,
      state: draft.state,
      notes: draft.notes || null,
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 xl:grid-cols-[minmax(150px,1fr)_minmax(180px,1.1fr)_100px_90px_minmax(180px,1fr)_170px_auto]">
      <label className="min-w-0 text-[10px] text-[var(--muted)]">
        Descripción del archivo
        <input
          value={draft.rawDescription}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, rawDescription: event.target.value }))}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        />
        {line.uncertainty_reason ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{line.uncertainty_reason}</p> : null}
        {line.inventory_movement_id ? <p className="mt-1 text-[10px] text-[var(--muted)]">Movimiento canónico registrado</p> : null}
      </label>
      <label className="text-[10px] text-[var(--muted)]">
        Producto
        <select
          value={draft.productoId}
          disabled={locked}
          onChange={(event) => {
            const productoId = event.target.value;
            const selected = products.find((item) => item.id === productoId);
            setDraft((current) => ({
              ...current,
              productoId,
              unit: selected?.unidad ?? current.unit,
            }));
          }}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        >
          <option value="">Seleccionar producto</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.nombre} · {product.unidad}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-[var(--muted)]">
        Cantidad
        <input
          type="number"
          min="0.0001"
          step="any"
          value={draft.quantity}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        />
      </label>
      <label className="text-[10px] text-[var(--muted)]">
        Unidad
        <input
          value={draft.unit}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        />
      </label>
      <label className="text-[10px] text-[var(--muted)]">
        Partida de obra
        <select
          value={draft.budgetItemId}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, budgetItemId: event.target.value }))}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        >
          <option value="">Seleccionar partida</option>
          {budgetItems.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.description}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-[var(--muted)]">
        Revisión
        <select
          value={draft.state}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as LineState }))}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        >
          {(["PROPOSED", "CONFIRMED", "REJECTED"] as LineState[]).map((state) => <option key={state} value={state}>{LINE_STATE_LABEL[state]}</option>)}
        </select>
      </label>
      <div className="flex items-end">
        <Button type="button" onClick={save} disabled={locked || pending} className="h-9 w-full px-2 text-[11px]">
          {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Guardar revisión
        </Button>
      </div>
      {error ? <p className="text-[11px] text-red-600 xl:col-span-full">{error}</p> : null}
      <label className="text-[10px] text-[var(--muted)] xl:col-span-full">
        Nota interna
        <input
          value={draft.notes}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px] text-[var(--foreground)]"
        />
      </label>
    </div>
  );
}

export function PanolObraSection({
  projectId,
  locations,
  portalLinks,
  submissions,
  products,
  budgetItems,
}: {
  projectId: string;
  locations: ProjectLocation[];
  portalLinks: WarehousePortalLinkRow[];
  submissions: PanolSubmissionRow[];
  products: InventoryProduct[];
  budgetItems: BudgetChoice[];
}) {
  const router = useRouter();
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdLink, setCreatedLink] = useState<{ url: string; token: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const locationId = selectedLocationId || locations[0]?.id || "";

  async function createLink() {
    if (!locationId) {
      setActionMessage("Primero creá una ubicación canónica de depósito para esta obra.");
      return;
    }
    setPendingId("create-link");
    setActionMessage(null);
    const result = await createWarehousePortalLink(
      locationId,
      expiresAt ? new Date(expiresAt).toISOString() : null
    );
    setPendingId(null);
    if (result.error || !result.url || !result.token) {
      setActionMessage(result.error ?? "No se pudo crear el enlace.");
      return;
    }
    setCreatedLink({ url: result.url, token: result.token });
    setActionMessage("Enlace creado. Copialo ahora: el token completo no se vuelve a mostrar.");
    router.refresh();
  }

  async function createLocation() {
    setPendingId("create-location");
    setActionMessage(null);
    const result = await createInventoryLocation({
      name: "Depósito de obra",
      locationType: "PROJECT",
      projectId,
    });
    setPendingId(null);
    if (result.error) {
      setActionMessage(result.error);
      return;
    }
    setActionMessage("Ubicación canónica creada.");
    router.refresh();
  }

  async function revokeLink(linkId: string) {
    setPendingId(linkId);
    setActionMessage(null);
    const result = await revokeWarehousePortalLink(linkId);
    setPendingId(null);
    if (result.error) {
      setActionMessage(result.error);
      return;
    }
    setActionMessage("Enlace revocado.");
    router.refresh();
  }

  async function processSubmission(submissionId: string) {
    setPendingId(submissionId);
    setActionMessage(null);
    const result = await processWarehouseSubmission(submissionId);
    setPendingId(null);
    setActionMessage(result.error ?? `Análisis terminado: ${result.proposals} línea(s) propuestas.`);
    router.refresh();
  }

  async function addManualLine(submissionId: string) {
    setPendingId(submissionId);
    setActionMessage(null);
    const result = await addManualWarehouseSubmissionLine(submissionId);
    setPendingId(null);
    if (result.error) {
      setActionMessage(result.error);
      router.refresh();
      return;
    }
    setActionMessage("Línea manual agregada como propuesta. Completá los datos y revisala antes de confirmar.");
    router.refresh();
  }

  async function confirmSubmission(submissionId: string) {
    setPendingId(submissionId);
    setActionMessage(null);
    const result = await confirmCanonicalWarehouseSubmission({ submissionId });
    setPendingId(null);
    if (result.error) {
      setActionMessage(result.error);
      router.refresh();
      return;
    }
    setActionMessage(`Rendición confirmada: ${result.ids?.length ?? 0} movimiento(s) canónico(s).`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Depósito de obra · acceso externo</h3>
            <p className="mt-1 max-w-3xl text-[12px] text-[var(--muted)]">
              Generá un enlace para que el encargado envíe rendiciones y evidencia. El token se muestra una sola vez; revocá el enlace para cortar nuevos accesos.
            </p>
          </div>
          <Button type="button" onClick={createLink} disabled={pendingId === "create-link" || locations.length === 0} className="h-9 px-3 text-xs">
            {pendingId === "create-link" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Crear enlace
          </Button>
        </div>
        {locations.length > 1 ? (
          <label className="mt-3 block max-w-md text-[11px] text-[var(--muted)]">
            Ubicación de depósito
            <select value={locationId} onChange={(event) => setSelectedLocationId(event.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 text-xs text-[var(--foreground)]">
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
        ) : locations.length === 1 ? <p className="mt-2 text-[11px] text-[var(--muted)]">Ubicación: {locations[0].name}</p> : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-[12px] text-amber-700 dark:text-amber-300">No hay una ubicación canónica de depósito de obra activa.</p>
            <Button type="button" variant="secondary" onClick={createLocation} disabled={pendingId === "create-location"} className="h-8 px-2 text-[11px]">
              {pendingId === "create-location" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
              Crear ubicación canónica
            </Button>
          </div>
        )}
        <label className="mt-3 block max-w-md text-[11px] text-[var(--muted)]">
          Vencimiento (opcional)
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 text-xs text-[var(--foreground)]" />
        </label>
        {createdLink ? (
          <div className="mt-4 break-all rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">Enlace nuevo · copialo ahora</p>
            <a href={createdLink.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[var(--accent-teal)] underline">
              {createdLink.url}<ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void navigator.clipboard.writeText(createdLink.url)} className="h-8 px-2 text-[11px]">
                <Copy className="mr-1 h-3 w-3" />Copiar enlace
              </Button>
              <span className="text-[10px] text-[var(--muted)]">Token: {createdLink.token.slice(-6)} (solo pista)</span>
            </div>
          </div>
        ) : null}
        {portalLinks.length > 0 ? (
          <div className="mt-4 space-y-2">
            <h4 className="text-[11px] font-semibold">Enlaces emitidos</h4>
            {portalLinks.map((link) => {
              return (
                <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-3 py-2 text-[11px]">
                  <span>{link.location_name} ·••••{link.token_hint} · {expiryLabel(link.expires_at)} · {link.last_used_at ? `último uso ${formatDate(link.last_used_at)}` : "sin uso registrado"}</span>
                  {link.active ? <Button type="button" variant="secondary" onClick={() => void revokeLink(link.id)} disabled={pendingId === link.id} className="h-7 px-2 text-[10px]">Revocar</Button> : <Badge tone="neutral">Revocado</Badge>}
                </div>
              );
            })}
          </div>
        ) : null}
        {actionMessage ? <p className="mt-3 text-[11px] text-[var(--muted)]">{actionMessage}</p> : null}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Rendiciones de materiales</h3>
          <p className="mt-1 text-[12px] text-[var(--muted)]">Revisá evidencia y corregí producto, cantidad y partida antes de confirmar el consumo canónico.</p>
        </div>
        {submissions.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">Esta obra todavía no tiene rendiciones de materiales.</div>
        ) : submissions.map((submission) => {
          const canConfirm = canConfirmWarehouseSubmission({
            status: submission.status,
            uploadIncomplete: submission.upload_incomplete,
            processingError: submission.processing_error,
            hasUnresolvedEvidence: submission.evidence.some((evidence) =>
              ["NOT_PROCESSED", "PROCESSING", "FAILED"].includes(evidence.extraction_status)
              || evidence.extraction_error !== null,
            ),
            lineStates: submission.lines.map((line) => line.state),
          });
          const locked = submission.status === "CONFIRMED" || submission.status === "VOIDED";
          const canAddManualLine = canAddManualWarehouseSubmissionLine({
            status: submission.status,
            evidenceCount: submission.evidence.length,
            locked,
          });
          return (
            <article key={submission.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{formatDate(submission.period_start)} – {formatDate(submission.period_end)}</span>
                  <span className="text-[var(--muted)]">{submission.location_name}</span>
                  <Badge tone={STATUS_TONE[submission.status]}>{STATUS_LABEL[submission.status]}</Badge>
                  <span className="text-[var(--muted)]">{submission.lines.length} líneas · {submission.evidence.length} evidencias</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canAddManualLine ? <Button type="button" variant="secondary" onClick={() => void addManualLine(submission.id)} disabled={pendingId === submission.id} className="h-8 px-2 text-[11px]">
                    {pendingId === submission.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
                    Agregar línea manual
                  </Button> : null}
                  {!locked ? <Button type="button" variant="secondary" onClick={() => void processSubmission(submission.id)} disabled={pendingId === submission.id || submission.status === "PROCESSING" || submission.evidence.length === 0} className="h-8 px-2 text-[11px]">
                    {pendingId === submission.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                    Proponer líneas desde planillas
                  </Button> : null}
                  {!locked ? <Button type="button" onClick={() => void confirmSubmission(submission.id)} disabled={!canConfirm || pendingId === submission.id} className="h-8 px-2 text-[11px]">
                    {pendingId === submission.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    Confirmar rendición
                  </Button> : null}
                </div>
              </header>
              {submission.upload_incomplete ? <div className="border-b border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">Hay archivos pendientes o incompletos; la base bloqueará la confirmación hasta resolverlos.</div> : null}
              {submission.processing_error ? <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] text-red-600">{submission.processing_error}</div> : null}
              {submission.evidence.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-b border-[var(--border)] p-3">
                  {submission.evidence.map((evidence) => (
                    <div key={evidence.id} className="flex min-w-[210px] items-center gap-2 rounded border border-[var(--border)] px-2.5 py-2 text-[11px]">
                      <FileText className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <div className="min-w-0 flex-1">
                        {evidence.signed_url ? <a href={evidence.signed_url} target="_blank" rel="noreferrer" className="block truncate underline">{evidence.file_name}</a> : <span className="block truncate">{evidence.file_name} · vista no disponible</span>}
                        <span className="text-[10px] text-[var(--muted)]">{evidence.extraction_status}{evidence.extraction_error ? ` · ${evidence.extraction_error}` : ""}</span>
                      </div>
                    </div>
                  ))}
                  <p className="basis-full text-[10px] text-[var(--muted)]">Las fotografías son evidencia; no se interpreta ni confirma contenido por OCR.</p>
                </div>
              ) : null}
              <div className="space-y-2 p-3">
                {submission.lines.map((line) => <SubmissionLineEditor key={`${submission.id}:${line.id}`} line={line} products={products} budgetItems={budgetItems} disabled={locked || submission.status === "PROCESSING"} />)}
                {submission.lines.length === 0 ? <p className="text-[11px] text-[var(--muted)]">No hay líneas propuestas. Procesá la planilla o revisá la evidencia antes de confirmar.</p> : null}
                {!canConfirm && !locked ? <p className="flex items-center gap-1 text-[10px] text-[var(--muted)]"><XCircle className="h-3 w-3" />Confirmación disponible cuando la rendición esté lista, no haya errores ni archivos sin procesar y todas las líneas estén revisadas con al menos una aceptada.</p> : null}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
