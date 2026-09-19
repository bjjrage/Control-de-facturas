"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  approveAndExecuteEmailApprovalAction,
  cancelEmailDraftAction,
  sendPreparedEmailAction,
} from "@/app/(internal)/agent/approval-actions";
import type { EmailPreview } from "@/lib/email/types";
import { formatEmailSentMessage } from "@/lib/email/presentation";

export function EmailPreviewCard(props: {
  preview: EmailPreview;
  approvalId?: string | null;
  onCompleted?: (message: string) => void;
  onCancelled?: () => void;
  onEdit?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  async function send() {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const result = props.approvalId
        ? await approveAndExecuteEmailApprovalAction({ approvalId: props.approvalId, previewHash: props.preview.contentHash })
        : await sendPreparedEmailAction({ draftId: props.preview.draftId, previewHash: props.preview.contentHash });
      if (result.error) throw new Error(result.error);
      const recipientLabel = result.result && typeof result.result === "object" && "recipientLabel" in result.result
        ? String(result.result.recipientLabel)
        : props.preview.to[0] ?? "el destinatario";
      const message = formatEmailSentMessage(recipientLabel);
      setDone(true);
      setDoneMessage(message);
      props.onCompleted?.(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
}
  async function cancel() {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cancelEmailDraftAction({ draftId: props.preview.draftId });
      if (result.error) throw new Error(result.error);
      props.onCancelled?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm" aria-label="Preview de correo">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Mail</p>
          <p className="text-[13px] font-semibold">Nuevo correo</p>
        </div>
        {props.approvalId ? <span className="rounded-full bg-[var(--warn)] px-2 py-1 text-[10px] font-semibold">Aprobación pendiente</span> : null}
      </div>

      <dl className="space-y-1.5 text-[12px]">
        <div><dt className="inline font-semibold">Para: </dt><dd className="inline break-words">{props.preview.to.join(", ")}</dd></div>
        {props.preview.cc.length ? <div><dt className="inline font-semibold">CC: </dt><dd className="inline break-words">{props.preview.cc.join(", ")}</dd></div> : null}
        <div><dt className="inline font-semibold">Asunto: </dt><dd className="inline break-words">{props.preview.subject}</dd></div>
      </dl>

      <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] leading-5 whitespace-pre-wrap">
        {props.preview.bodyText}
      </div>

      <div>
        <p className="text-[11px] font-semibold">Adjuntos</p>
        {props.preview.attachments.length ? (
          <ul className="mt-1 space-y-1 text-[11px] text-[var(--muted)]">
            {props.preview.attachments.map((attachment) => (
              <li key={attachment.documentId}>✓ {attachment.fileName} — {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[11px] text-[var(--muted)]">Sin adjuntos</p>}
      </div>

      {props.preview.warnings.map((warning) => <p key={warning} className="text-[11px] text-[var(--warn)]">{warning}</p>)}
      {error ? <p className="rounded-md bg-[var(--error-bg)] p-2 text-[11px] text-[var(--error)]">{error}</p> : null}
      {done ? <p className="text-[12px] font-medium text-[var(--success)]">{doneMessage ?? "Correo enviado."}</p> : null}

      {!done ? (
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-2">
          <Button variant="ghost" disabled={busy} onClick={props.onEdit}>Editar</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void cancel()}>Cancelar</Button>
          <Button disabled={busy || !props.preview.to.length} onClick={() => void send()}>
            {busy ? "Procesando…" : "Enviar correo"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
