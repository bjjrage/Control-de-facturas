import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { buildRfc2822Message, encodeGmailRaw } from "./mime";
import {
  GMAIL_SEND_SCOPE,
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_EMAIL_ATTACHMENTS,
  type EmailConnectionSummary,
  type EmailDraftSnapshot,
  type EmailProviderName,
  type EmailSendResult,
} from "./types";
import type { MimeAttachment } from "./mime";

export interface EmailProvider {
  readonly name: EmailProviderName;
  getConnectionStatus(params: {
    db: SupabaseClient;
    actor: AgentToolContext;
  }): Promise<EmailConnectionSummary | null>;
  sendMessage(params: {
    db: SupabaseClient;
    actor: AgentToolContext;
    connectionId: string;
    draft: EmailDraftSnapshot;
  }): Promise<Pick<EmailSendResult, "provider" | "providerMessageId">>;
}

type ConnectionRow = {
  id: string;
  empresa_id: string;
  provider: "GMAIL";
  provider_email: string | null;
  status: "CONNECTED" | "REVOKED" | "ERROR";
  scopes: string[];
  created_at: string;
  disconnected_at: string | null;
  refresh_token_secret_id: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GmailSendResponse = { id?: string };

function requireGoogleConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Gmail no está configurado: faltan credenciales OAuth server-side");
  }
  return { clientId, clientSecret };
}

function safeProviderError(value: unknown): string {
  if (!value || typeof value !== "object") return "Error del proveedor Gmail";
  const item = value as Record<string, unknown>;
  const error = typeof item.error === "string" ? item.error : "gmail_error";
  const description = typeof item.error_description === "string" ? item.error_description : "";
  return `${error}${description ? `: ${description}` : ""}`.slice(0, 500);
}

function requireSenderEmail(value: string | null): string {
  if (!value) throw new Error("La conexiÃ³n Gmail no tiene una cuenta remitente identificada; reconectÃ¡ Gmail");
  return value;
}

async function getConnection(db: SupabaseClient, actor: AgentToolContext, connectionId: string): Promise<ConnectionRow> {
  const { data, error } = await db
    .from("email_connections")
    .select("id, empresa_id, provider, provider_email, status, scopes, created_at, disconnected_at, refresh_token_secret_id")
    .eq("id", connectionId)
    .eq("empresa_id", actor.empresaId)
    .eq("user_id", actor.userId)
    .eq("provider", "GMAIL")
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conexión Gmail: ${error.message}`);
  if (!data) throw new Error("La conexión Gmail no existe o no pertenece a tu usuario/empresa");
  return data as ConnectionRow;
}

async function getRefreshToken(db: SupabaseClient, connectionId: string): Promise<string> {
  const { data, error } = await db.rpc("email_read_oauth_secret", { p_connection_id: connectionId });
  if (error || typeof data !== "string" || !data) {
    throw new Error("No se pudo leer el secreto OAuth desde Supabase Vault");
  }
  return data;
}

async function getAccessToken(db: SupabaseClient, connection: ConnectionRow): Promise<string> {
  if (!connection.refresh_token_secret_id) {
    throw new Error("La conexión Gmail no tiene secreto OAuth seguro asociado");
  }
  const { clientId, clientSecret } = requireGoogleConfig();
  const refreshToken = await getRefreshToken(db, connection.id);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    if (payload.error === "invalid_grant") {
      await db
        .from("email_connections")
        .update({ status: "ERROR" })
        .eq("id", connection.id)
        .eq("empresa_id", connection.empresa_id);
    }
    throw new Error(`Gmail no autorizó el envío: ${safeProviderError(payload)}`);
  }
  return payload.access_token;
}

function isAllowedMimeType(mimeType: string): boolean {
  return /^[\w.+-]+\/[\w.+-]+$/u.test(mimeType) && !/^text\/html$/iu.test(mimeType);
}

async function loadAttachments(db: SupabaseClient, draft: EmailDraftSnapshot): Promise<MimeAttachment[]> {
  if (draft.attachments.length > MAX_EMAIL_ATTACHMENTS) {
    throw new Error(`Gmail permite como máximo ${MAX_EMAIL_ATTACHMENTS} adjuntos por correo`);
  }
  let totalBytes = 0;
  const output: MimeAttachment[] = [];
  for (const attachment of draft.attachments) {
    if (!isAllowedMimeType(attachment.mimeType)) {
      throw new Error(`MIME no permitido para ${attachment.fileName}`);
    }
    totalBytes += attachment.sizeBytes;
    if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
      throw new Error("El tamaño total de los adjuntos supera el límite seguro para Gmail");
    }
    const { data, error } = await db.storage.from(attachment.storageBucket).download(attachment.storagePath);
    if (error || !data) throw new Error(`No se pudo leer el adjunto ${attachment.fileName}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength !== attachment.sizeBytes && attachment.sizeBytes > 0) {
      throw new Error(`El tamaño del adjunto ${attachment.fileName} cambió después de preparar el correo`);
    }
    output.push({ ...attachment, bytes });
  }
  return output;
}

export class GmailEmailProvider implements EmailProvider {
  readonly name = "GMAIL" as const;

  async getConnectionStatus(params: {
    db: SupabaseClient;
    actor: AgentToolContext;
  }): Promise<EmailConnectionSummary | null> {
    const { data, error } = await params.db
      .from("email_connections")
    .select("id, provider, provider_email, status, scopes, created_at, disconnected_at")
      .eq("empresa_id", params.actor.empresaId)
      .eq("user_id", params.actor.userId)
      .eq("provider", "GMAIL")
      .eq("status", "CONNECTED")
      .maybeSingle();
    if (error) throw new Error(`No se pudo consultar el estado Gmail: ${error.message}`);
    if (!data) return null;
    const row = data as Omit<ConnectionRow, "refresh_token_secret_id">;
    return {
      id: row.id,
      provider: "GMAIL",
      providerEmail: row.provider_email,
      status: row.status,
      scopes: row.scopes ?? [],
      createdAt: row.created_at,
      disconnectedAt: row.disconnected_at,
    };
  }

  async sendMessage(params: {
    db: SupabaseClient;
    actor: AgentToolContext;
    connectionId: string;
    draft: EmailDraftSnapshot;
  }): Promise<Pick<EmailSendResult, "provider" | "providerMessageId">> {
    const connection = await getConnection(params.db, params.actor, params.connectionId);
    if (connection.status !== "CONNECTED") throw new Error("La conexión Gmail no está conectada");
    if (!connection.scopes.includes(GMAIL_SEND_SCOPE)) {
      throw new Error("La conexión Gmail no tiene el scope mínimo gmail.send");
    }
    const accessToken = await getAccessToken(params.db, connection);
    const attachments = await loadAttachments(params.db, params.draft);
    const mimeMessage = buildRfc2822Message({
      from: requireSenderEmail(connection.provider_email),
      to: params.draft.to,
      cc: params.draft.cc,
      bcc: params.draft.bcc,
      subject: params.draft.subject,
      bodyText: params.draft.bodyText,
      bodyHtml: params.draft.bodyHtml,
      attachments,
    });
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodeGmailRaw(mimeMessage) }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as GmailSendResponse & Record<string, unknown>;
    if (!response.ok || typeof payload.id !== "string" || !payload.id) {
      throw new Error(`Gmail no pudo enviar el correo: ${safeProviderError(payload)}`);
    }
    return { provider: "GMAIL", providerMessageId: payload.id };
  }
}

export const gmailEmailProvider = new GmailEmailProvider();

// Future providers intentionally remain interfaces only in V1.
export type MicrosoftGraphEmailProvider = EmailProvider;
export type SmtpEmailProvider = EmailProvider;
