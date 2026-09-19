import { randomUUID } from "node:crypto";
import { sanitizeFileName } from "@/lib/storage";
import type { EmailAttachmentPreview } from "./types";

export type MimeAttachment = EmailAttachmentPreview & { bytes: Uint8Array };

function assertHeaderSafe(value: string, field: string): string {
  if (/[\r\n]/u.test(value)) throw new Error(`${field} contiene caracteres inválidos`);
  return value.trim();
}
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? "";
}

function addressHeader(values: string[]): string {
  return values.map((value) => assertHeaderSafe(value, "Destinatario")).join(", ");
}

export function buildRfc2822Message(params: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: MimeAttachment[];
  messageId?: string;
}): string {
  const attachments = params.attachments ?? [];
  const headers = [
    `From: ${assertHeaderSafe(params.from, "From")}`,
    `To: ${addressHeader(params.to)}`,
    ...(params.cc?.length ? [`Cc: ${addressHeader(params.cc)}`] : []),
    ...(params.bcc?.length ? [`Bcc: ${addressHeader(params.bcc)}`] : []),
    `Subject: ${encodeHeader(assertHeaderSafe(params.subject, "Asunto"))}`,
    ...(params.messageId ? [`Message-ID: ${assertHeaderSafe(params.messageId, "Message-ID")}`] : []),
    "MIME-Version: 1.0",
    "Date: " + new Date().toUTCString(),
  ];
  if (attachments.length === 0) {
    if (params.bodyHtml) {
      const alternativeBoundary = `alt-${randomUUID()}`;
      headers.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`);
      return [
        ...headers,
        "",
        `--${alternativeBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.bodyText,
        `--${alternativeBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.bodyHtml,
        `--${alternativeBoundary}--`,
        "",
      ].join("\r\n");
    }
    headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit");
    return [...headers, "", params.bodyText, ""].join("\r\n");
  }

  const mixedBoundary = `mixed-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const bodyPart = params.bodyHtml
    ? [
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="alt-${mixedBoundary}"`,
        "",
        `--alt-${mixedBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.bodyText,
        `--alt-${mixedBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.bodyHtml,
        `--alt-${mixedBoundary}--`,
      ]
    : [
        `--${mixedBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.bodyText,
      ];
  const attachmentParts = attachments.flatMap((attachment) => [
    `--${mixedBoundary}`,
    `Content-Type: ${assertHeaderSafe(attachment.mimeType, "MIME type")}; name="${sanitizeFileName(attachment.fileName)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${sanitizeFileName(attachment.fileName)}"`,
    "",
    wrapBase64(Buffer.from(attachment.bytes).toString("base64")),
  ]);
  return [...headers, "", ...bodyPart, ...attachmentParts, `--${mixedBoundary}--`, ""].join("\r\n");
}

export function encodeGmailRaw(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}
