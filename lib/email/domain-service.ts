import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPayload } from "@/lib/agent/approvals";
import {
  EmailDeliveryUnknownError,
  gmailEmailProvider,
  prepareEmailAttachments,
  type EmailProvider,
} from "./provider";
import { EmailApprovalMismatchError, sha256Bytes } from "./content-hash";
import { applyEmailRevision, composeEmailBody, escapeHtml, inferEmailTemplate } from "./templates";
import {
  MAX_EMAIL_ATTACHMENTS,
  MAX_EMAIL_BODY_CHARS,
  type EmailAttachmentPreview,
  type EmailDraftSnapshot,
  type EmailPreview,
  type EmailSendResult,
} from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const STOP_WORDS = new Set(["a", "al", "de", "del", "la", "el", "en", "por", "para", "con", "un", "una"]);

type ContactCandidate = {
  id: string;
  source: "provider" | "client" | "subcontractor";
  name: string;
  organization: string | null;
  email: string | null;
};

type AttachmentRow = {
  id: string;
  empresa_id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  rfq_id: string | null;
  quote_version_id: string | null;
  rfq_provider_id: string | null;
};

type EmailDraftRow = {
  id: string;
  empresa_id: string;
  created_by: string;
  project_id: string | null;
  provider_connection_id: string | null;
  to_json: string[];
  cc_json: string[];
  bcc_json: string[];
  subject: string;
  body_text: string;
  body_html: string | null;
  content_hash: string;
  revision: number;
  delivery_retry_authorized: boolean;
  status: string;
  idempotency_key: string;
  provider_message_id: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

type DraftAttachmentRow = {
  id: string;
  document_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_bucket: string;
  storage_path: string;
  content_sha256: string | null;
};

export type PrepareEmailInput = {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  contact_query?: string;
  subject?: string;
  objective: string;
  tone?: string;
  language?: string;
  attachment_queries?: string[];
  project_id?: string;
  draft_id?: string;
  idempotency_key?: string;
  revision_instruction?: string;
  force_resend?: boolean;
};

export type PrepareEmailOutput = Omit<EmailPreview, "draftId"> & {
  draftId: string | null;
  clarification?: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}@._-]+/gu, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function validEmails(values: string[] | undefined, field: string): string[] {
  const unique = [...new Set((values ?? []).map((value) => value.trim().toLocaleLowerCase("en")))];
  for (const value of unique) if (!EMAIL_RE.test(value)) throw new Error(`${field} contiene un email inválido`);
  return unique;
}

function safeJsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function hashDraftContent(input: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments: EmailAttachmentPreview[];
}): string {
  return hashPayload({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    attachments: input.attachments.map((attachment) => ({
      id: attachment.id,
      documentId: attachment.documentId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storageBucket: attachment.storageBucket,
      storagePath: attachment.storagePath,
      contentSha256: attachment.contentSha256,
    })),
  });
}

function attachmentPreview(row: DraftAttachmentRow): EmailAttachmentPreview {
  return {
    id: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    contentSha256: row.content_sha256,
  };
}

function draftSnapshot(row: EmailDraftRow, attachments: DraftAttachmentRow[]): EmailDraftSnapshot {
  return {
    draftId: row.id,
    revision: Number(row.revision),
    to: safeJsonArray(row.to_json),
    cc: safeJsonArray(row.cc_json),
    bcc: safeJsonArray(row.bcc_json),
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    attachments: attachments.map(attachmentPreview),
    contentHash: row.content_hash,
  };
}

async function resolveContacts(db: SupabaseClient, empresaId: string, query: string): Promise<ContactCandidate[]> {
  const [providers, clients, subcontractors] = await Promise.all([
    db.from("providers").select("id, name, contact_name, email").eq("empresa_id", empresaId).eq("active", true).limit(100),
    db.from("clients").select("id, name, contact_name, email").eq("empresa_id", empresaId).eq("active", true).limit(100),
    db.from("subcontractors").select("id, name, contact_name, contact_email").eq("empresa_id", empresaId).limit(100),
  ]);
  const errors = [providers.error, clients.error, subcontractors.error].filter(Boolean);
  if (errors.length) throw new Error(`No se pudo consultar contactos del ERP: ${errors[0]?.message}`);
  const result: ContactCandidate[] = [];
  for (const row of providers.data ?? []) {
    const item = row as { id: string; name: string; contact_name: string | null; email: string | null };
    result.push({ id: item.id, source: "provider", name: item.contact_name || item.name, organization: item.name, email: item.email });
  }
  for (const row of clients.data ?? []) {
    const item = row as { id: string; name: string; contact_name: string | null; email: string | null };
    result.push({ id: item.id, source: "client", name: item.contact_name || item.name, organization: item.name, email: item.email });
  }
  for (const row of subcontractors.data ?? []) {
    const item = row as { id: string; name: string; contact_name: string | null; contact_email: string | null };
    result.push({ id: item.id, source: "subcontractor", name: item.contact_name || item.name, organization: item.name, email: item.contact_email });
  }
  const wanted = tokens(query);
  return result
    .map((candidate) => {
      const haystack = normalize(`${candidate.name} ${candidate.organization ?? ""} ${candidate.email ?? ""}`);
      const score = wanted.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { candidate, score };
    })
    .filter((item) => item.score > 0 && item.score >= Math.max(1, Math.ceil(wanted.length * 0.5)))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.candidate);
}

async function resolveAttachmentProjects(
  db: SupabaseClient,
  empresaId: string,
  rows: AttachmentRow[]
): Promise<Map<string, string | null>> {
  const directRfqIds = [...new Set(rows.map((row) => row.rfq_id).filter((id): id is string => Boolean(id)))];
  const directProviderIds = [...new Set(rows.map((row) => row.rfq_provider_id).filter((id): id is string => Boolean(id)))];
  const quoteVersionIds = [...new Set(rows.map((row) => row.quote_version_id).filter((id): id is string => Boolean(id)))];

  const projectByRfq = new Map<string, string | null>();
  const providerToRfq = new Map<string, string>();
  const quoteVersionToQuote = new Map<string, string>();
  const quoteToProvider = new Map<string, string>();

  if (quoteVersionIds.length) {
    const { data, error } = await db
      .from("quote_versions")
      .select("id, quote_id")
      .eq("empresa_id", empresaId)
      .in("id", quoteVersionIds);
    if (error) throw new Error(`No se pudo verificar el proyecto de las cotizaciones: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; quote_id: string }>) quoteVersionToQuote.set(row.id, row.quote_id);
  }

  const quoteIds = [...new Set([...quoteVersionToQuote.values()])];
  if (quoteIds.length) {
    const { data, error } = await db
      .from("quotes")
      .select("id, rfq_provider_id")
      .eq("empresa_id", empresaId)
      .in("id", quoteIds);
    if (error) throw new Error(`No se pudo verificar el proyecto de las cotizaciones: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; rfq_provider_id: string }>) quoteToProvider.set(row.id, row.rfq_provider_id);
  }

  const providerIds = [...new Set([...directProviderIds, ...quoteToProvider.values()])];
  if (providerIds.length) {
    const { data, error } = await db
      .from("rfq_providers")
      .select("id, rfq_id")
      .eq("empresa_id", empresaId)
      .in("id", providerIds);
    if (error) throw new Error(`No se pudo verificar el proyecto de los adjuntos: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; rfq_id: string }>) providerToRfq.set(row.id, row.rfq_id);
  }

  const rfqIds = [
    ...new Set([
      ...directRfqIds,
      ...rows.map((row) => (row.rfq_provider_id ? providerToRfq.get(row.rfq_provider_id) : null)),
      ...rows.map((row) => {
        const quoteId = row.quote_version_id ? quoteVersionToQuote.get(row.quote_version_id) : null;
        const providerId = quoteId ? quoteToProvider.get(quoteId) : null;
        return providerId ? providerToRfq.get(providerId) : null;
      }),
    ].filter((id): id is string => Boolean(id))),
  ];
  if (rfqIds.length) {
    const { data, error } = await db
      .from("rfqs")
      .select("id, project_id")
      .eq("empresa_id", empresaId)
      .in("id", rfqIds);
    if (error) throw new Error(`No se pudo verificar el proyecto de los adjuntos: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; project_id: string | null }>) projectByRfq.set(row.id, row.project_id);
  }

  const result = new Map<string, string | null>();
  for (const row of rows) {
    const rfqId =
      row.rfq_id ??
      (row.rfq_provider_id ? providerToRfq.get(row.rfq_provider_id) : null) ??
      (() => {
        const quoteId = row.quote_version_id ? quoteVersionToQuote.get(row.quote_version_id) : null;
        const providerId = quoteId ? quoteToProvider.get(quoteId) : null;
        return providerId ? providerToRfq.get(providerId) ?? null : null;
      })();
    result.set(row.id, rfqId ? projectByRfq.get(rfqId) ?? null : null);
  }
  return result;
}

export function filterAttachmentsForProject<T extends { id: string }>(
  rows: T[],
  projectByAttachment: Map<string, string | null>,
  projectId: string | null
): T[] {
  return projectId ? rows.filter((row) => projectByAttachment.get(row.id) === projectId) : [];
}

async function hashStoredAttachment(db: SupabaseClient, row: AttachmentRow): Promise<string> {
  const { data, error } = await db.storage.from(row.bucket).download(row.path);
  if (error || !data) throw new Error(`No se pudo verificar el contenido del adjunto ${row.file_name}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (row.size_bytes !== null && bytes.byteLength !== Number(row.size_bytes)) {
    throw new Error(`El tamaÃ±o del adjunto ${row.file_name} no coincide con el ERP`);
  }
  return sha256Bytes(bytes);
}

async function hashDraftAttachment(db: SupabaseClient, row: DraftAttachmentRow): Promise<string> {
  const { data, error } = await db.storage.from(row.storage_bucket).download(row.storage_path);
  if (error || !data) throw new Error(`No se pudo verificar el contenido del adjunto ${row.file_name}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== Number(row.size_bytes)) {
    throw new Error(`El tamaño del adjunto ${row.file_name} no coincide con el borrador`);
  }
  return sha256Bytes(bytes);
}

async function refreshDraftAttachmentHashes(
  db: SupabaseClient,
  actor: AgentToolContext,
  draftId: string,
  attachments: DraftAttachmentRow[]
): Promise<EmailAttachmentPreview[]> {
  const refreshed: EmailAttachmentPreview[] = [];
  for (const row of attachments) {
    const contentSha256 = await hashDraftAttachment(db, row);
    const { error } = await db
      .from("email_draft_attachments")
      .update({ content_sha256: contentSha256 })
      .eq("id", row.id)
      .eq("draft_id", draftId)
      .eq("empresa_id", actor.empresaId);
    if (error) throw new Error(`No se pudo actualizar la huella del adjunto ${row.file_name}: ${error.message}`);
    refreshed.push({ ...attachmentPreview(row), contentSha256 });
  }
  return refreshed;
}

async function resolveAttachments(db: SupabaseClient, empresaId: string, projectId: string | null, queries: string[]): Promise<{
  attachments: EmailAttachmentPreview[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  if (!queries.length) return { attachments: [], warnings };
  if (!projectId) {
    return {
      attachments: [],
      warnings: queries.map((query) => `No adjunté «${query}» porque el proyecto no está identificado.`),
    };
  }
  const { data, error } = await db
    .from("attachments")
    .select("id, empresa_id, bucket, path, file_name, mime_type, size_bytes, created_at, rfq_id, quote_version_id, rfq_provider_id")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`No se pudieron buscar adjuntos: ${error.message}`);
  const allRows = (data ?? []) as AttachmentRow[];
  const projectByAttachment = await resolveAttachmentProjects(db, empresaId, allRows);
  const rows = filterAttachmentsForProject(allRows, projectByAttachment, projectId);
  const selected: EmailAttachmentPreview[] = [];
  for (const query of queries) {
    const wanted = tokens(query);
    const isLatestQuote = /(ultima|ultimo|cotizaci|propuesta|presupuesto)/u.test(normalize(query));
    const candidates = rows
      .map((row) => {
        const haystack = normalize(`${row.file_name} ${row.mime_type ?? ""}`);
        const score = wanted.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
        const quoteBoost = isLatestQuote && row.quote_version_id ? 2 : 0;
        return { row, score: score + quoteBoost };
      })
      .filter((item) => (wanted.length === 0 ? true : item.score > 0))
      .sort((a, b) => b.score - a.score || b.row.created_at.localeCompare(a.row.created_at));
    if (!candidates.length) {
      warnings.push(`No encontré un documento autorizado para «${query}».`);
      continue;
    }
    const best = candidates[0];
    const second = candidates[1];
    if (second && second.score === best.score && !isLatestQuote) {
      warnings.push(`Hay varios documentos posibles para «${query}»; no adjunté ninguno.`);
      continue;
    }
    const preview: EmailAttachmentPreview = {
      id: best.row.id,
      documentId: best.row.id,
      fileName: best.row.file_name,
      mimeType: best.row.mime_type || "application/octet-stream",
      sizeBytes: Number(best.row.size_bytes ?? 0),
      storageBucket: best.row.bucket,
      storagePath: best.row.path,
      contentSha256: await hashStoredAttachment(db, best.row),
    };
    if (!selected.some((item) => item.documentId === preview.documentId)) selected.push(preview);
  }
  if (selected.length > MAX_EMAIL_ATTACHMENTS) throw new Error(`El correo no puede superar ${MAX_EMAIL_ATTACHMENTS} adjuntos`);
  return { attachments: selected, warnings };
}

async function getCompanyName(db: SupabaseClient, empresaId: string): Promise<string | null> {
  const { data } = await db.from("empresas").select("nombre").eq("id", empresaId).maybeSingle();
  return data && typeof (data as { nombre?: unknown }).nombre === "string" ? (data as { nombre: string }).nombre : null;
}

async function resolveProjectId(db: SupabaseClient, actor: AgentToolContext, requestedProjectId?: string): Promise<string | null> {
  const contextProjectId = actor.projectId ?? actor.workspace?.projectId ?? null;
  const projectId = requestedProjectId ?? contextProjectId;
  if (!projectId) return null;
  if (requestedProjectId && contextProjectId && requestedProjectId !== contextProjectId) {
    throw new Error("El proyecto solicitado no coincide con el workspace actual");
  }
  const { data, error } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", actor.empresaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo validar el proyecto actual: ${error.message}`);
  if (!data) throw new Error("El proyecto no existe o no pertenece a tu empresa");
  return projectId;
}

async function getConnectionId(db: SupabaseClient, actor: AgentToolContext): Promise<string | null> {
  const { data, error } = await db
    .from("email_connections")
    .select("id")
    .eq("empresa_id", actor.empresaId)
    .eq("user_id", actor.userId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar la conexión Gmail: ${error.message}`);
  return data ? (data as { id: string }).id : null;
}

async function getDraftWithAttachments(db: SupabaseClient, actor: AgentToolContext, draftId: string) {
  const { data, error } = await db
    .from("email_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("empresa_id", actor.empresaId)
    .eq("created_by", actor.userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el borrador de email: ${error.message}`);
  if (!data) throw new Error("El borrador no existe o no pertenece a tu usuario/empresa");
  const { data: attachmentRows, error: attachmentError } = await db
    .from("email_draft_attachments")
    .select("id, document_id, file_name, mime_type, size_bytes, storage_bucket, storage_path, content_sha256")
    .eq("draft_id", draftId)
    .eq("empresa_id", actor.empresaId)
    .order("sort_order", { ascending: true });
  if (attachmentError) throw new Error(`No se pudieron leer los adjuntos del borrador: ${attachmentError.message}`);
  return { row: data as EmailDraftRow, attachments: (attachmentRows ?? []) as DraftAttachmentRow[] };
}

export async function getEmailDraftPreview(
  db: SupabaseClient,
  actor: AgentToolContext,
  draftId: string
): Promise<EmailPreview> {
  const { row, attachments } = await getDraftWithAttachments(db, actor, draftId);
  const snapshot = draftSnapshot(row, attachments);
  return {
    ...snapshot,
    status: row.status as EmailPreview["status"],
    warnings: row.provider_connection_id ? [] : ["Gmail no está conectado para este usuario."],
    provider: "GMAIL",
    providerMessageId: row.provider_message_id,
  };
}

function defaultSubject(template: ReturnType<typeof inferEmailTemplate>): string {
  const subjects: Record<ReturnType<typeof inferEmailTemplate>, string> = {
    envio_cotizacion: "Nueva cotización",
    seguimiento_cotizacion: "Seguimiento de cotización",
    solicitud_precio: "Solicitud de precios",
    envio_orden_compra: "Orden de compra",
    reclamo_entrega: "Seguimiento de entrega",
    solicitud_factura: "Solicitud de factura",
    envio_certificacion: "Certificación",
    recordatorio_pago: "Recordatorio de pago",
    general: "Consulta",
  };
  return subjects[template];
}

async function resolveRecipient(params: {
  db: SupabaseClient;
  actor: AgentToolContext;
  to?: string[];
  contactQuery?: string;
}): Promise<{ to: string[]; contactName: string | null; warnings: string[]; clarification?: string }> {
  const explicit = validEmails(params.to, "to");
  if (explicit.length) return { to: explicit, contactName: null, warnings: [] };
  const query = params.contactQuery?.trim();
  if (!query) return { to: [], contactName: null, warnings: [], clarification: "Decime a quién le envío el correo o pasame la dirección de email." };
  if (/^(a\s+)?(m[ií]|mi)\s+mismo$/iu.test(query)) {
    if (!params.actor.email || !EMAIL_RE.test(params.actor.email)) {
      return { to: [], contactName: null, warnings: [], clarification: "No tengo tu email de usuario registrado para enviarte la prueba." };
    }
    return { to: [params.actor.email.toLocaleLowerCase("en")], contactName: params.actor.email, warnings: [] };
  }
  const candidates = await resolveContacts(params.db, params.actor.empresaId, query);
  const withEmail = candidates.filter((candidate) => candidate.email && EMAIL_RE.test(candidate.email));
  if (withEmail.length === 1) {
    const match = withEmail[0];
    return { to: [match.email!.toLocaleLowerCase("en")], contactName: match.name, warnings: [] };
  }
  if (withEmail.length > 1) {
    return {
      to: [],
      contactName: null,
      warnings: [],
      clarification: `Encontré varios contactos para «${query}»: ${withEmail
        .slice(0, 4)
        .map((candidate) => `${candidate.name}${candidate.organization ? ` de ${candidate.organization}` : ""}`)
        .join("; ")}. ¿A cuál le escribo?`,
    };
  }
  return {
    to: [],
    contactName: null,
    warnings: [],
    clarification: `No tengo un email registrado para «${query}». Decime la dirección o agregala al contacto.`,
  };
}

export async function prepareEmailDraft(
  db: SupabaseClient,
  actor: AgentToolContext,
  input: PrepareEmailInput
): Promise<PrepareEmailOutput> {
  if (input.objective.trim().length > MAX_EMAIL_BODY_CHARS) throw new Error("El objetivo del correo es demasiado largo");
  const existing = input.draft_id ? await getDraftWithAttachments(db, actor, input.draft_id) : null;
  if (existing && (["SENT", "SENDING"].includes(existing.row.status) || existing.row.provider_message_id || existing.row.sent_at)) {
    throw new Error("Ese correo ya está enviado o en proceso y no se puede editar");
  }

  const recipient = existing
    ? { to: validEmails(input.to ?? safeJsonArray(existing.row.to_json), "to"), contactName: null, warnings: [] as string[] }
    : await resolveRecipient({ db, actor, to: input.to, contactQuery: input.contact_query });
  if (recipient.clarification) {
    return {
      draftId: null,
      to: [],
      cc: [],
      bcc: [],
      subject: input.subject ?? "",
      bodyText: "",
      bodyHtml: null,
      attachments: [],
      contentHash: "",
      revision: 0,
      status: "NEEDS_CLARIFICATION",
      warnings: [],
      clarification: recipient.clarification,
    };
  }

  const cc = validEmails(input.cc ?? (existing ? safeJsonArray(existing.row.cc_json) : []), "cc");
  const bcc = validEmails(input.bcc ?? (existing ? safeJsonArray(existing.row.bcc_json) : []), "bcc");
  const attachmentQueries = input.attachment_queries ?? [];
  const requestedProjectId = input.project_id ?? actor.projectId ?? actor.workspace?.projectId ?? existing?.row.project_id ?? undefined;
  const projectId = await resolveProjectId(db, actor, requestedProjectId);
  const resolvedAttachments = await resolveAttachments(db, actor.empresaId, projectId, attachmentQueries);
  const existingAttachments = existing
    ? await refreshDraftAttachmentHashes(db, actor, existing.row.id, existing.attachments)
    : [];
  const attachments = attachmentQueries.length
    ? [...existingAttachments, ...resolvedAttachments.attachments].filter(
        (attachment, index, all) => all.findIndex((item) => item.documentId === attachment.documentId) === index
      )
    : existingAttachments;
  if (attachments.length > MAX_EMAIL_ATTACHMENTS) throw new Error(`El correo no puede superar ${MAX_EMAIL_ATTACHMENTS} adjuntos`);

  const companyName = await getCompanyName(db, actor.empresaId);
  const revisionInstruction = input.revision_instruction ?? (existing ? input.objective : null);
  let subject = input.subject?.trim() || existing?.row.subject || "";
  let bodyText: string;
  let bodyHtml: string | null;
  let template: ReturnType<typeof inferEmailTemplate>;
  if (existing) {
    const revision = revisionInstruction
      ? applyEmailRevision({ bodyText: existing.row.body_text, bodyHtml: existing.row.body_html, instruction: revisionInstruction, subject })
      : { bodyText: existing.row.body_text, bodyHtml: existing.row.body_html ?? "", subject };
    bodyText = revision.bodyText;
    bodyHtml = revision.bodyHtml || `<p>${escapeHtml(bodyText).replace(/\n/gu, "<br />")}</p>`;
    subject = revision.subject?.trim() || subject;
    template = inferEmailTemplate(existing.row.subject);
  } else {
    const composed = composeEmailBody({
      objective: input.objective,
      contactName: recipient.contactName,
      tone: input.tone,
      language: input.language,
      companyName,
    });
    bodyText = composed.bodyText;
    bodyHtml = composed.bodyHtml;
    template = composed.template;
    subject = subject || defaultSubject(template);
  }
  if (!bodyText.trim()) throw new Error("El cuerpo del correo no puede quedar vacío");
  const connectionId = await getConnectionId(db, actor);
  const contentHash = hashDraftContent({
    to: recipient.to,
    cc,
    bcc,
    subject,
    bodyText,
    bodyHtml,
    attachments,
  });
  const warnings = [
    ...recipient.warnings,
    ...resolvedAttachments.warnings,
    ...(connectionId ? [] : ["Gmail no está conectado para este usuario; el borrador queda guardado."]),
  ];

  let draftId = existing?.row.id ?? null;
  let idempotencyKey = existing?.row.idempotency_key ?? input.idempotency_key ?? randomUUID();
  if (existing) {
    const { error } = await db
      .from("email_drafts")
      .update({
        provider_connection_id: connectionId,
        to_json: recipient.to,
        cc_json: cc,
        bcc_json: bcc,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        content_hash: contentHash,
        status: "READY",
        failure_reason: null,
      })
      .eq("id", existing.row.id)
      .eq("empresa_id", actor.empresaId)
      .eq("created_by", actor.userId);
    if (error) throw new Error(`No se pudo actualizar el borrador: ${error.message}`);
    await db.rpc("cancel_email_approval_for_draft", { p_draft_id: existing.row.id, p_empresa_id: actor.empresaId });
    draftId = existing.row.id;
    idempotencyKey = existing.row.idempotency_key;
    if (attachmentQueries.length) {
      await db.from("email_draft_attachments").delete().eq("draft_id", draftId).eq("empresa_id", actor.empresaId);
      if (attachments.length) {
        const { error: attachmentError } = await db.from("email_draft_attachments").insert(
          attachments.map((attachment, index) => ({
            empresa_id: actor.empresaId,
            draft_id: draftId,
            document_id: attachment.documentId,
            file_name: attachment.fileName,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes,
            storage_bucket: attachment.storageBucket,
            storage_path: attachment.storagePath,
            content_sha256: attachment.contentSha256,
            sort_order: index,
          }))
        );
        if (attachmentError) throw new Error(`No se pudieron actualizar los adjuntos: ${attachmentError.message}`);
      }
    }
    const { error: retryFlagError } = await db
      .from("email_drafts")
      .update({ delivery_retry_authorized: input.force_resend === true })
      .eq("id", draftId)
      .eq("empresa_id", actor.empresaId)
      .eq("created_by", actor.userId);
    if (retryFlagError) throw new Error(`No se pudo fijar el modo de reenvío: ${retryFlagError.message}`);
    await recordEmailEvent(db, actor, {
      eventType: "email.draft.updated",
      draftId,
      idempotencyKey,
      subject,
      recipientEmails: recipient.to,
      metadata: { template },
    });
  } else {
    const { data, error } = await db
      .from("email_drafts")
      .insert({
        empresa_id: actor.empresaId,
        created_by: actor.userId,
        project_id: projectId,
        provider_connection_id: connectionId,
        to_json: recipient.to,
        cc_json: cc,
        bcc_json: bcc,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        content_hash: contentHash,
        status: "READY",
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el borrador: ${error?.message ?? "sin datos"}`);
    draftId = (data as { id: string }).id;
    if (attachments.length) {
      const { error: attachmentError } = await db.from("email_draft_attachments").insert(
        attachments.map((attachment, index) => ({
          empresa_id: actor.empresaId,
          draft_id: draftId,
          document_id: attachment.documentId,
          file_name: attachment.fileName,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
          storage_bucket: attachment.storageBucket,
          storage_path: attachment.storagePath,
          content_sha256: attachment.contentSha256,
          sort_order: index,
        }))
      );
      if (attachmentError) throw new Error(`No se pudieron guardar los adjuntos: ${attachmentError.message}`);
    }
    const { error: retryFlagError } = await db
      .from("email_drafts")
      .update({ delivery_retry_authorized: input.force_resend === true })
      .eq("id", draftId)
      .eq("empresa_id", actor.empresaId)
      .eq("created_by", actor.userId);
    if (retryFlagError) throw new Error(`No se pudo fijar el modo de reenvío: ${retryFlagError.message}`);
    await recordEmailEvent(db, actor, {
      eventType: "email.draft.created",
      draftId,
      idempotencyKey,
      subject,
      recipientEmails: recipient.to,
      metadata: { template, attachmentCount: attachments.length },
    });
  }
  if (!draftId) throw new Error("No se pudo determinar el borrador preparado");
  const persisted = await getDraftWithAttachments(db, actor, draftId);
  return {
    ...draftSnapshot(persisted.row, persisted.attachments),
    status: "READY",
    warnings,
    template,
  };
}

export function buildSendEmailInput(snapshot: EmailDraftSnapshot, idempotencyKey: string) {
  return {
    draft_id: snapshot.draftId,
    idempotency_key: idempotencyKey,
    draft_hash: snapshot.contentHash,
    draft_revision: snapshot.revision,
    draft_snapshot: snapshot,
  };
}

export async function getEmailDraftSendContext(
  db: SupabaseClient,
  actor: AgentToolContext,
  draftId: string,
  expectedHash?: string | null
) {
  const { row, attachments } = await getDraftWithAttachments(db, actor, draftId);
  const snapshot = draftSnapshot(row, attachments);
  if (expectedHash && snapshot.contentHash !== expectedHash) {
    throw new Error("El preview ya no coincide con el borrador actual; revisá y aprobá la versión nueva");
  }
  return { row, snapshot, input: buildSendEmailInput(snapshot, row.idempotency_key) };
}

export async function getRecipientLabel(db: SupabaseClient, empresaId: string, recipientEmails: string[]): Promise<string> {
  const email = recipientEmails[0] ?? "destinatario";
  const [providers, clients, subcontractors] = await Promise.all([
    db.from("providers").select("name, contact_name, email").eq("empresa_id", empresaId).eq("email", email).limit(1),
    db.from("clients").select("name, contact_name, email").eq("empresa_id", empresaId).eq("email", email).limit(1),
    db.from("subcontractors").select("name, contact_name, contact_email").eq("empresa_id", empresaId).eq("contact_email", email).limit(1),
  ]);
  const match = [providers.data?.[0], clients.data?.[0], subcontractors.data?.[0]].find(Boolean) as
    | { name?: string | null; contact_name?: string | null }
    | undefined;
  const name = match?.contact_name?.trim() || match?.name?.trim();
  return name ? `${name} (${email})` : email;
}

export async function sendEmailDraft(params: {
  db: SupabaseClient;
  actor: AgentToolContext;
  draftId: string;
  idempotencyKey: string;
  draftHash: string;
  approvedRevision: number;
  approvalId?: string | null;
  draftSnapshot: EmailDraftSnapshot;
  provider?: EmailProvider;
}): Promise<EmailSendResult> {
  /* Legacy implementation retained in the diff for audit traceability; the atomic implementation below is authoritative.
  const { row, attachments } = await getDraftWithAttachments(params.db, params.actor, params.draftId);
  const current = draftSnapshot(row, attachments);
  if (
    current.contentHash !== params.draftHash ||
    hashDraftContent(current) !== params.draftHash ||
    current.revision !== params.approvedRevision
  ) {
    throw new Error("El borrador cambió después de la aprobación; se necesita una nueva aprobación");
  }
  if (
    hashDraftContent(params.draftSnapshot) !== params.draftHash ||
    params.draftSnapshot.draftId !== params.draftId ||
    params.draftSnapshot.revision !== params.approvedRevision
  ) {
    throw new Error("El snapshot aprobado no coincide con el borrador solicitado");
  }
  if (row.idempotency_key !== params.idempotencyKey) throw new Error("Idempotency key inválida para el borrador");
  // Treat persisted provider evidence as terminal even if a stale client tried
  // to rewrite the status column after delivery. This preserves idempotency
  // across refreshes and protects against a duplicate send on replay.
  if (row.provider_message_id && row.sent_at) {
    return {
      draftId: row.id,
      provider: "GMAIL",
      providerMessageId: row.provider_message_id,
      sentAt: row.sent_at,
      alreadySent: true,
      recipientLabel: await getRecipientLabel(params.db, params.actor.empresaId, current.to),
    };
  }
  if (!params.approvalId) throw new Error("El envío requiere una aprobación humana consumible");
  if (row.status !== "WAITING_APPROVAL") {
    throw new Error(`El borrador no puede enviarse en estado ${row.status}`);
  }
  const preparedAttachments = await prepareEmailAttachments(params.db, current);
  const deliveryFingerprint = hashPayload({
    connectionId: row.provider_connection_id,
    to: current.to,
    cc: current.cc,
    bcc: current.bcc,
    subject: current.subject,
    bodyText: current.bodyText,
    bodyHtml: current.bodyHtml,
    attachments: current.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      contentSha256: attachment.contentSha256,
    })),
  });
  const admin = createAdminClient();
  const { data: claimData, error: claimError } = await admin.rpc("claim_email_send", {
    p_empresa_id: params.actor.empresaId,
    p_user_id: params.actor.userId,
    p_draft_id: row.id,
    p_connection_id: row.provider_connection_id,
    p_approval_id: params.approvalId,
    p_approved_revision: params.approvedRevision,
    p_approved_content_hash: params.draftHash,
    p_delivery_fingerprint: deliveryFingerprint,
    p_allow_delivery_unknown_retry: row.delivery_retry_authorized === true,
  });
  if (claimError || !claimData || typeof claimData !== "object") {
    throw new Error(`No se pudo reservar atómicamente el envío: ${claimError?.message ?? "claim rechazado"}`);
  }
  const claim = claimData as { attempt_id?: string; client_message_id?: string };
  if (!claim.attempt_id || !claim.client_message_id) throw new Error("El claim de envío no devolvió un intento válido");
  if (claimError) throw new Error(`No se pudo reservar el envío: ${claimError.message}`);
  if (!claimed) throw new Error("El borrador ya está siendo enviado o fue consumido por otro intento");

  const claimed = true;
  const provider = params.provider ?? gmailEmailProvider;
  let providerAccepted = false;
  await recordEmailEvent(params.db, params.actor, {
    eventType: "email.send.started",
    draftId: row.id,
    connectionId: row.provider_connection_id,
    idempotencyKey: params.idempotencyKey,
    subject: row.subject,
    recipientEmails: current.to,
    metadata: { provider: provider.name },
  });
  try {
    if (!row.provider_connection_id) throw new Error("No hay una conexión Gmail activa para enviar este correo");
    const sent = await provider.sendMessage({
      db: params.db,
      actor: params.actor,
      connectionId: row.provider_connection_id,
      draft: current,
      sendAttemptId: claim.attempt_id,
      clientMessageId: claim.client_message_id,
      attachments: preparedAttachments,
    });
    providerAccepted = true;
    const { data: completed, error: completeError } = await admin.rpc("complete_email_send_attempt", {
      p_send_attempt_id: claim.attempt_id,
      p_empresa_id: params.actor.empresaId,
      p_user_id: params.actor.userId,
      p_provider_message_id: sent.providerMessageId,
    });
    if (completeError || !completed) {
      throw new EmailDeliveryUnknownError(
        `Gmail aceptó el correo, pero no se pudo persistir el resultado; no se reintentará automáticamente (${completeError?.message ?? "persistencia incierta"})`
      );
    }
    const sentAt = new Date().toISOString();
    const { error: updateError } = await params.db
      .from("email_drafts")
      .update({ status: "SENT", provider_message_id: sent.providerMessageId, sent_at: sentAt })
      .eq("id", row.id)
      .eq("empresa_id", params.actor.empresaId)
      .eq("status", "SENDING");
    if (updateError) throw new Error(`El proveedor aceptó el correo pero no se pudo guardar el resultado: ${updateError.message}`);
    }
    await recordEmailEvent(params.db, params.actor, {
      eventType: "email.send.completed",
      draftId: row.id,
      connectionId: row.provider_connection_id,
      idempotencyKey: params.idempotencyKey,
      providerMessageId: sent.providerMessageId,
      subject: row.subject,
      recipientEmails: current.to,
      metadata: { provider: provider.name },
    });
    return {
      draftId: row.id,
      provider: sent.provider,
      providerMessageId: sent.providerMessageId,
      sentAt,
      alreadySent: false,
      recipientLabel: await getRecipientLabel(params.db, params.actor.empresaId, current.to),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const requiresReapproval = error instanceof EmailApprovalMismatchError;
    const deliveryUnknown = providerAccepted || error instanceof EmailDeliveryUnknownError;
    await admin.rpc(deliveryUnknown ? "mark_email_send_attempt_unknown" : "fail_email_send_attempt", {
      p_send_attempt_id: claim.attempt_id,
      p_empresa_id: params.actor.empresaId,
      p_user_id: params.actor.userId,
      p_error_code: deliveryUnknown ? "DELIVERY_UNKNOWN" : "PROVIDER_REJECTED",
      p_failure_reason: deliveryUnknown
        ? "El resultado de entrega es incierto; no se reintentará automáticamente. Revisá el buzón antes de reenviar."
        : message.slice(0, 1000),
    });
    if (deliveryUnknown && !(error instanceof EmailDeliveryUnknownError)) {
      error = new EmailDeliveryUnknownError();
    }
    if (false) {
    await params.db
      .from("email_drafts")
      .update({ status: requiresReapproval ? "WAITING_APPROVAL" : "FAILED", failure_reason: message.slice(0, 1000) })
      .eq("id", row.id)
      .eq("empresa_id", params.actor.empresaId)
      .eq("status", "SENDING");
    if (requiresReapproval) {
      await params.db.rpc("cancel_email_approval_for_draft", {
        p_draft_id: row.id,
        p_empresa_id: params.actor.empresaId,
      });
    }
    await recordEmailEvent(params.db, params.actor, {
      eventType: "email.send.failed",
      draftId: row.id,
      connectionId: row.provider_connection_id,
      idempotencyKey: params.idempotencyKey,
      subject: row.subject,
      recipientEmails: current.to,
      errorMessage: message,
      metadata: { provider: provider.name, deliveryUnknown, attemptId: claim.attempt_id },
    });
    throw deliveryUnknown && !(error instanceof EmailDeliveryUnknownError)
      ? new EmailDeliveryUnknownError()
      : error;
  }
}

  */
  return sendEmailDraftAtomic(params);
}

async function sendEmailDraftAtomic(params: {
  db: SupabaseClient;
  actor: AgentToolContext;
  draftId: string;
  idempotencyKey: string;
  draftHash: string;
  approvedRevision: number;
  approvalId?: string | null;
  draftSnapshot: EmailDraftSnapshot;
  provider?: EmailProvider;
}): Promise<EmailSendResult> {
  const { row, attachments } = await getDraftWithAttachments(params.db, params.actor, params.draftId);
  const current = draftSnapshot(row, attachments);
  if (
    current.contentHash !== params.draftHash ||
    hashDraftContent(current) !== params.draftHash ||
    current.revision !== params.approvedRevision ||
    params.draftSnapshot.draftId !== params.draftId ||
    params.draftSnapshot.revision !== params.approvedRevision ||
    hashDraftContent(params.draftSnapshot) !== params.draftHash
  ) {
    throw new Error("El borrador cambió después de la aprobación; se necesita una nueva aprobación");
  }
  if (row.idempotency_key !== params.idempotencyKey) throw new Error("Idempotency key inválida para el borrador");
  if (row.provider_message_id && row.sent_at) {
    return {
      draftId: row.id,
      provider: "GMAIL",
      providerMessageId: row.provider_message_id,
      sentAt: row.sent_at,
      alreadySent: true,
      recipientLabel: await getRecipientLabel(params.db, params.actor.empresaId, current.to),
    };
  }
  if (!params.approvalId) throw new Error("El envío requiere una aprobación humana consumible");
  if (row.status !== "WAITING_APPROVAL") throw new Error(`El borrador no puede enviarse en estado ${row.status}`);

  // The storage bytes are downloaded and verified before claim, then retained
  // in memory and passed unchanged to the provider after claim.
  let preparedAttachments: Awaited<ReturnType<typeof prepareEmailAttachments>>;
  try {
    preparedAttachments = await prepareEmailAttachments(params.db, current);
  } catch (error) {
    if (error instanceof EmailApprovalMismatchError) {
      await params.db
        .from("email_drafts")
        .update({ status: "WAITING_APPROVAL", failure_reason: error.message })
        .eq("id", row.id)
        .eq("empresa_id", params.actor.empresaId)
        .eq("status", "WAITING_APPROVAL");
      await params.db.rpc("cancel_email_approval_for_draft", {
        p_draft_id: row.id,
        p_empresa_id: params.actor.empresaId,
      });
    }
    throw error;
  }

  const deliveryFingerprint = hashPayload({
    connectionId: row.provider_connection_id,
    to: current.to,
    cc: current.cc,
    bcc: current.bcc,
    subject: current.subject,
    bodyText: current.bodyText,
    bodyHtml: current.bodyHtml,
    attachments: current.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      contentSha256: attachment.contentSha256,
    })),
  });
  const admin = createAdminClient();
  const { data: claimData, error: claimError } = await admin.rpc("claim_email_send", {
    p_empresa_id: params.actor.empresaId,
    p_user_id: params.actor.userId,
    p_draft_id: row.id,
    p_connection_id: row.provider_connection_id,
    p_approval_id: params.approvalId,
    p_approved_revision: params.approvedRevision,
    p_approved_content_hash: params.draftHash,
    p_delivery_fingerprint: deliveryFingerprint,
    p_allow_delivery_unknown_retry: row.delivery_retry_authorized === true,
  });
  if (claimError || !claimData || typeof claimData !== "object") {
    throw new Error(`No se pudo reservar atómicamente el envío: ${claimError?.message ?? "claim rechazado"}`);
  }
  const claim = claimData as { attempt_id?: string; client_message_id?: string };
  if (!claim.attempt_id || !claim.client_message_id) throw new Error("El claim de envío no devolvió un intento válido");

  const provider = params.provider ?? gmailEmailProvider;
  let providerAccepted = false;
  await recordEmailEvent(params.db, params.actor, {
    eventType: "email.send.started",
    draftId: row.id,
    connectionId: row.provider_connection_id,
    idempotencyKey: params.idempotencyKey,
    subject: row.subject,
    recipientEmails: current.to,
    metadata: { provider: provider.name, attemptId: claim.attempt_id },
  });
  let recipientLabel = "";
  try {
    recipientLabel = await getRecipientLabel(params.db, params.actor.empresaId, current.to);
    if (!row.provider_connection_id) throw new Error("No hay una conexión Gmail activa para enviar este correo");
    const sent = await provider.sendMessage({
      db: params.db,
      actor: params.actor,
      connectionId: row.provider_connection_id,
      draft: current,
      sendAttemptId: claim.attempt_id,
      clientMessageId: claim.client_message_id,
      attachments: preparedAttachments,
    });
    providerAccepted = true;
    const { data: completed, error: completeError } = await admin.rpc("complete_email_send_attempt", {
      p_send_attempt_id: claim.attempt_id,
      p_empresa_id: params.actor.empresaId,
      p_user_id: params.actor.userId,
      p_provider_message_id: sent.providerMessageId,
    });
    if (completeError || !completed) {
      throw new EmailDeliveryUnknownError(
        `Gmail aceptó el correo, pero no se pudo persistir el resultado; no se reintentará automáticamente (${completeError?.message ?? "persistencia incierta"})`
      );
    }
    const sentAt = new Date().toISOString();
    await recordEmailEvent(params.db, params.actor, {
      eventType: "email.send.completed",
      draftId: row.id,
      connectionId: row.provider_connection_id,
      idempotencyKey: params.idempotencyKey,
      providerMessageId: sent.providerMessageId,
      subject: row.subject,
      recipientEmails: current.to,
      metadata: { provider: provider.name, attemptId: claim.attempt_id },
    });
    return {
      draftId: row.id,
      provider: sent.provider,
      providerMessageId: sent.providerMessageId,
      sentAt,
      alreadySent: false,
      recipientLabel,
      sendAttemptId: claim.attempt_id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const deliveryUnknown = providerAccepted || error instanceof EmailDeliveryUnknownError;
    await admin.rpc(deliveryUnknown ? "mark_email_send_attempt_unknown" : "fail_email_send_attempt", {
      p_send_attempt_id: claim.attempt_id,
      p_empresa_id: params.actor.empresaId,
      p_user_id: params.actor.userId,
      p_error_code: deliveryUnknown ? "DELIVERY_UNKNOWN" : "PROVIDER_REJECTED",
      p_failure_reason: deliveryUnknown
        ? "El resultado de entrega es incierto; no se reintentará automáticamente. Revisá el buzón antes de reenviar."
        : message.slice(0, 1000),
    });
    await recordEmailEvent(params.db, params.actor, {
      eventType: "email.send.failed",
      draftId: row.id,
      connectionId: row.provider_connection_id,
      idempotencyKey: params.idempotencyKey,
      subject: row.subject,
      recipientEmails: current.to,
      errorMessage: message,
      metadata: { provider: provider.name, deliveryUnknown, attemptId: claim.attempt_id },
    });
    if (deliveryUnknown && !(error instanceof EmailDeliveryUnknownError)) throw new EmailDeliveryUnknownError();
    throw error;
  }
}

export async function recordEmailEvent(
  _db: SupabaseClient,
  actor: AgentToolContext,
  params: {
    eventType: string;
    draftId?: string | null;
    connectionId?: string | null;
    idempotencyKey?: string | null;
    providerMessageId?: string | null;
    subject?: string | null;
    recipientEmails?: string[];
    actorType?: "user" | "agent" | "system";
    metadata?: Record<string, unknown>;
    errorMessage?: string | null;
  }
) {
  const domains = [...new Set((params.recipientEmails ?? []).map((email) => email.split("@")[1]).filter(Boolean))];
  await createAdminClient().from("email_send_events").insert({
    empresa_id: actor.empresaId,
    draft_id: params.draftId ?? null,
    connection_id: params.connectionId ?? null,
    event_type: params.eventType,
    idempotency_key: params.idempotencyKey ?? null,
    provider_message_id: params.providerMessageId ?? null,
    actor_id: actor.userId,
    actor_type: params.actorType ?? actor.actorType,
    recipient_domains: domains,
    subject: params.subject ?? null,
    metadata: params.metadata ?? {},
    error_message: params.errorMessage?.slice(0, 1000) ?? null,
  });
}

export async function markEmailDraftWaitingApproval(
  db: SupabaseClient,
  actor: AgentToolContext,
  snapshot: EmailDraftSnapshot,
  approvalId?: string | null,
  idempotencyKey?: string | null
) {
  const { data, error } = await db
    .from("email_drafts")
    .update({ status: "WAITING_APPROVAL" })
    .eq("id", snapshot.draftId)
    .eq("empresa_id", actor.empresaId)
    .eq("created_by", actor.userId)
    .eq("status", "READY")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`No se pudo marcar el borrador como pendiente: ${error.message}`);
  if (data) {
    await recordEmailEvent(db, actor, {
      eventType: "email.send.approval_requested",
      draftId: snapshot.draftId,
      idempotencyKey: idempotencyKey ?? null,
      subject: snapshot.subject,
      recipientEmails: snapshot.to,
      metadata: { approvalId: approvalId ?? null },
    });
  }
}
