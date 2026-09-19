export type EmailProviderName = "GMAIL";
export type EmailConnectionStatus =
  | "CONNECTED"
  | "REVOKED"
  | "ERROR"
  | "REVOKE_PENDING"
  | "DISCONNECT_FAILED";
export type EmailDraftStatus =
  | "READY"
  | "WAITING_APPROVAL"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "CANCELLED";

export type EmailAddress = string;

export interface EmailAttachmentPreview {
  id: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  storagePath: string;
  contentSha256: string | null;
}

export interface EmailDraftSnapshot {
  draftId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments: EmailAttachmentPreview[];
  contentHash: string;
}

export interface EmailPreview extends EmailDraftSnapshot {
  status?: EmailDraftStatus | "NEEDS_CLARIFICATION";
  warnings: string[];
  template?: string;
  provider?: EmailProviderName;
  providerMessageId?: string | null;
}

export interface EmailConnectionSummary {
  id: string;
  provider: EmailProviderName;
  providerEmail: string | null;
  status: EmailConnectionStatus;
  scopes: string[];
  createdAt: string;
  disconnectedAt: string | null;
}

export interface EmailSendResult {
  draftId: string;
  provider: EmailProviderName;
  providerMessageId: string;
  sentAt: string;
  alreadySent: boolean;
  recipientLabel: string;
}

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_IDENTITY_SCOPES = ["openid", "email"] as const;
export const GMAIL_ALLOWED_SCOPES = [GMAIL_SEND_SCOPE, ...GMAIL_IDENTITY_SCOPES] as const;

export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_EMAIL_BODY_CHARS = 100_000;
