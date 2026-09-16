"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatDateTime, formatMoney } from "@/lib/format";
import {
  APPROVAL_MODE_LABELS,
  QUOTATION_ACCEPTANCE_LABELS,
  WORKFLOW_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from "@/lib/quotation";
import {
  SalesDocument,
  SalesQuotationAcceptance,
  SalesQuotationEvent,
  SalesQuotationToken,
  WorkOrder,
} from "@/lib/types";
import {
  createQuotationLink,
  logQuotationLinkCopied,
  reopenQuotationToDraft,
  revokeQuotationLink,
  updateQuotationExpiry,
} from "./quotation-actions";
import { CopyButton } from "./quotation-copy-button";

function acceptanceTone(s: SalesDocument["acceptance_status"]): "ok" | "warn" | "neutral" | "error" {
  if (s === "ACCEPTED") return "ok";
  if (s === "PENDING_ACCEPTANCE") return "warn";
  if (s === "REJECTED" || s === "EXPIRED") return "error";
  return "neutral";
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Link creado",
  EMAIL_PREPARED: "Email preparado (mailto:)",
  LINK_COPIED: "Link copiado",
  VIEWED: "Visto por el cliente",
  ACCEPTED: "Aceptada por el cliente",
  REJECTED: "Rechazada por el cliente",
  REVOKED: "Link revocado",
  EXPIRED: "Vencida",
  VERSION_SUPERSEDED: "Versión superada",
  WORK_ORDER_CREATED: "OT generada",
  WORKFLOW_RESOLVED: "Workflow interno resuelto",
  OT_STATUS_CHANGED: "OT actualizada",
};

export function QuotationPanel({
  doc,
  tokens,
  events,
  workOrder,
  acceptance,
}: {
  doc: SalesDocument;
  tokens: SalesQuotationToken[];
  events: SalesQuotationEvent[];
  workOrder: WorkOrder | null;
  acceptance: SalesQuotationAcceptance | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // URL completa del link recién generado: existe solo en memoria (el raw
  // jamás se persiste: en DB solo hay hash + prefijo). Al navegar se pierde:
  // si se pierde, generar un link nuevo.
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [freshMailto, setFreshMailto] = useState<string | null>(null);
  const active = [...tokens].filter((t) => !t.revoked_at).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null;
  const stale = active && active.quotation_version !== doc.quotation_version;
  const canGenerate = doc.status === "BORRADOR" && doc.total > 0 && doc.acceptance_status !== "ACCEPTED";

  async function run<T extends { error: string | null }>(fn: () => Promise<T>): Promise<T | null> {
    setPending(true);
    setError(null);
    try {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return null;
      }
      return res;
    } catch {
      setError("Se cortó la conexión. Probá de nuevo.");
      return null;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold">Aceptación electrónica</h2>
          <Badge tone={acceptanceTone(doc.acceptance_status)}>{QUOTATION_ACCEPTANCE_LABELS[doc.acceptance_status]}</Badge>
          <span className="text-[11px] text-[var(--muted)]">v{doc.quotation_version}</span>
        </div>
        {doc.acceptance_expires_at ? (
          <span className="text-[12px] text-[var(--muted)]">Vence: {formatDateTime(doc.acceptance_expires_at)}</span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {freshUrl ? (
        <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-3 space-y-2">
          <div className="text-[13px] font-medium">Link generado — se muestra una sola vez</div>
          <div className="flex gap-2">
            <Input readOnly value={freshUrl} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton
              text={freshUrl}
              onCopied={() => {
                if (active) void run(() => logQuotationLinkCopied(doc.id, active.id));
              }}
            />
          </div>
          {freshMailto ? (
            <a href={freshMailto} className="text-[13px] text-[var(--primary)] underline">
              Abrir email preparado para el cliente
            </a>
          ) : null}
          <p className="text-[11px] text-[var(--muted)]">
            Copialo ahora: por seguridad solo guardamos el hash. Si lo perdés, generá un link nuevo
            (invalida este).
          </p>
        </div>
      ) : null}

      {doc.acceptance_status === "ACCEPTED" ? (
        <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-3 text-[13px] text-[var(--ok)]">
          Aceptada por <strong>{doc.accepted_by_name ?? "-"}</strong>
          {doc.accepted_at ? ` el ${formatDateTime(doc.accepted_at)}` : ""}.
          {workOrder ? (
            <div className="mt-2 text-[var(--foreground)]">
              OT interna generada:{" "}
              <Link href={`/ordenes-trabajo/${workOrder.id}`} className="text-action font-medium text-[var(--primary)]">
                {workOrder.code} · {WORK_ORDER_STATUS_LABELS[workOrder.status]}
              </Link>{" "}
              <span className="text-[11px] text-[var(--muted)]">
                · {APPROVAL_MODE_LABELS[workOrder.approval_mode]} · {WORKFLOW_STATUS_LABELS[workOrder.workflow_status]}
              </span>{" "}
              <span className="text-[11px] text-[var(--muted)]">(documento interno, nunca visible al cliente)</span>
            </div>
          ) : (
            <div className="mt-1 text-[12px]">La Orden de Trabajo se está generando…</div>
          )}
        </div>
      ) : null}

      {acceptance ? (
        <div className="rounded-lg border border-[var(--border)] p-3 text-[12px] space-y-1">
          <div className="font-medium text-[13px]">Registro de aceptación (inmutable)</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[var(--muted)]">
            <span>Versión aceptada</span><span className="text-[var(--foreground)] num">v{acceptance.quotation_version}</span>
            <span>Cliente</span><span className="text-[var(--foreground)]">{acceptance.client_name_snapshot}</span>
            <span>Total</span><span className="text-[var(--foreground)] num">{formatMoney(acceptance.total_snapshot, acceptance.currency_snapshot)}</span>
            <span>Canal</span><span className="text-[var(--foreground)]">{acceptance.channel}</span>
            <span>Email destino</span><span className="text-[var(--foreground)]">{acceptance.recipient_email ?? "-"}</span>
            <span>Aceptada</span><span className="text-[var(--foreground)]">{formatDateTime(acceptance.accepted_at)} por {acceptance.acceptor_name}</span>
            <span>IP / agente</span><span className="text-[var(--foreground)]">{acceptance.ip ?? "-"} · {(acceptance.user_agent ?? "-").slice(0, 60)}</span>
            <span>Referencia link</span><span className="text-[var(--foreground)] font-mono">{acceptance.token_prefix ?? "-"}</span>
            <span>Ítems fotografiados</span><span className="text-[var(--foreground)] num">{acceptance.items_snapshot.length}</span>
          </div>
        </div>
      ) : null}

      {doc.acceptance_status === "REJECTED" ? (
        <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-bg)] p-3 text-[13px]">
          Rechazada{doc.rejected_at ? ` el ${formatDateTime(doc.rejected_at)}` : ""}
          {doc.rejection_reason ? `: ${doc.rejection_reason}` : "."} Rechazar no creó OT y el
          histórico se conserva. Para aceptar se necesita un nuevo ciclo (reabrir + nuevo link).
          <form
            className="mt-2"
            action={async () => {
              await run(() => reopenQuotationToDraft(doc.id));
            }}
          >
            <Button variant="secondary" type="submit" disabled={pending}>Reabrir como borrador</Button>
          </form>
        </div>
      ) : null}

      {doc.acceptance_status === "EXPIRED" ? (
        <div className="rounded-lg border border-[var(--border)] p-3 text-[13px] text-[var(--muted)]">
          La cotización venció. Generá un nuevo link para volver a ponerla pendiente de aceptación, o reabrila.
          <form
            className="mt-2"
            action={async () => {
              await run(() => reopenQuotationToDraft(doc.id));
            }}
          >
            <Button variant="secondary" type="submit" disabled={pending}>Reabrir como borrador</Button>
          </form>
        </div>
      ) : null}

      {stale ? (
        <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-bg)] p-3 text-[13px]">
          Editáste la cotización (ahora v{doc.quotation_version}) después de generar el link (v{active?.quotation_version}).
          Ese link quedó obsoleto y el cliente no puede aceptar con él: generá un nuevo link.
        </div>
      ) : null}

      {active && doc.acceptance_status === "PENDING_ACCEPTANCE" && !stale ? (
        <div className="space-y-2">
          <Label>Link activo para el cliente (solo cotización, nunca la OT)</Label>
          <div className="text-[12px] text-[var(--muted)]">
            Ref <span className="font-mono">{active.token_prefix}…</span> · versión congelada v{active.quotation_version} · creado {formatDateTime(active.created_at)}
            {active.expires_at ? ` · vence ${formatDateTime(active.expires_at)}` : " · sin vencimiento"}
            {active.prepared_for_email ? ` · email preparado para ${active.prepared_for_email}` : ""}
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            El link completo solo se mostró al generarse (no guardamos el secreto). Si se perdió,
            generá uno nuevo abajo: el anterior se revoca automáticamente.
          </p>
          <div className="flex gap-2 flex-wrap">
            <form
              action={async () => {
                await run(() => revokeQuotationLink(doc.id, active.id));
              }}
            >
              <Button variant="ghost" type="submit" disabled={pending} className="text-[12px]">Revocar link</Button>
            </form>
          </div>
          <form
            className="flex gap-2 items-end"
            action={async (fd: FormData) => {
              await run(() => updateQuotationExpiry(doc.id, fd));
            }}
          >
            <div>
              <Label htmlFor="expiry">Vencimiento (opcional)</Label>
              <Input id="expiry" name="expires_at" type="datetime-local" defaultValue={active.expires_at ? new Date(active.expires_at).toISOString().slice(0, 16) : ""} />
            </div>
            <Button variant="secondary" type="submit" disabled={pending}>Guardar vencimiento</Button>
          </form>
        </div>
      ) : null}

      {canGenerate && (doc.acceptance_status === "DRAFT" || doc.acceptance_status === "PENDING_ACCEPTANCE" || doc.acceptance_status === "EXPIRED") && (!active || stale) ? (
        <form
          className="rounded-lg border border-[var(--border)] p-3 space-y-2"
          action={async (fd: FormData) => {
            const res = await run(() => createQuotationLink(doc.id, fd));
            if (res && "rawToken" in res && res.rawToken) {
              setFreshUrl(res.url ?? null);
              setFreshMailto((res as { mailto?: string | null }).mailto ?? null);
            }
          }}
        >
          <div className="text-[13px] font-medium">
            {doc.acceptance_status === "DRAFT" ? "Enviar a aceptación" : "Generar nuevo link (invalida el anterior)"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="new-expires">Vencimiento (opcional)</Label>
              <Input id="new-expires" name="expires_at" type="datetime-local" />
            </div>
            <div>
              <Label htmlFor="new-email">Email del cliente (opcional, prepara mailto:)</Label>
              <Input id="new-email" name="sent_to_email" type="email" placeholder="cliente@empresa.com" />
            </div>
          </div>
          <Button type="submit" disabled={pending}>Generar link seguro</Button>
          <p className="text-[11px] text-[var(--muted)]">
            Al generar, la cotización pasa a “Pendiente de aceptación” y el link congela la versión v{doc.quotation_version}.
            El cliente acepta solo la cotización; la OT se genera sola y es interna. El email solo se
            prepara (mailto:), nunca se registra como enviado.
          </p>
        </form>
      ) : null}

      {tokens.length > 0 ? (
        <div>
          <div className="text-[12px] font-medium mb-1">Historial de links</div>
          <div className="rounded border border-[var(--border)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Creado</th>
                  <th>Ref</th>
                  <th>Versión</th>
                  <th>Vence</th>
                  <th>Email prep.</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...tokens].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 5).map((t) => (
                  <tr key={t.id}>
                    <td className="text-[12px]">{formatDateTime(t.created_at)}</td>
                    <td className="text-[12px] font-mono">{t.token_prefix}…</td>
                    <td className="text-[12px]">v{t.quotation_version}{t.quotation_version !== doc.quotation_version ? " (obsoleto)" : ""}</td>
                    <td className="text-[12px]">{t.expires_at ? formatDateTime(t.expires_at) : "-"}</td>
                    <td className="text-[12px]">{t.prepared_for_email ?? "-"}</td>
                    <td className="text-[12px]">{t.revoked_at ? `Revocado ${formatDateTime(t.revoked_at)}` : "Activo"}</td>
                    <td>
                      {!t.revoked_at ? (
                        <form
                          action={async () => {
                            await run(() => revokeQuotationLink(doc.id, t.id));
                          }}
                        >
                          <button disabled={pending} className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]">Revocar</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div>
          <div className="text-[12px] font-medium mb-1">Auditoría</div>
          <div className="space-y-1">
            {[...events].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 12).map((e) => (
              <div key={e.id} className="text-[12px] text-[var(--muted)]">
                {formatDateTime(e.created_at)} · {EVENT_LABELS[e.event_type] ?? e.event_type}
                {e.actor_label ? ` · ${e.actor_label}` : ""}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
