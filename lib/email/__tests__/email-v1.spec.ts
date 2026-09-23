import { describe, expect, it } from "vitest";
import { buildRfc2822Message, encodeGmailRaw } from "../mime";
import { composeEmailBody, escapeHtml, inferEmailTemplate, applyEmailRevision } from "../templates";
import { getTool } from "@/lib/agent/registry";
import "@/lib/tools/email/prepare-email";
import "@/lib/tools/email/send-email";
import { SendEmailInputSchema } from "@/lib/tools/email/send-email";
import { sha256Bytes } from "../content-hash";
import { decryptOAuthVerifier, encryptOAuthVerifier } from "../google-oauth";
import { EmailDeliveryUnknownError, parseGmailSendResponse } from "../provider";

const attachment = {
  id: "00000000-0000-4000-a000-000000000010",
  documentId: "00000000-0000-4000-a000-000000000011",
  fileName: "cotizacion.pdf",
  mimeType: "application/pdf",
  sizeBytes: 3,
  storageBucket: "documents",
  storagePath: "empresa/documentos/cotizacion.pdf",
  contentSha256: sha256Bytes(new Uint8Array([1, 2, 3])),
  bytes: new Uint8Array([1, 2, 3]),
};

describe("Rodrigo email V1 pure contracts", () => {
  it("encrypts OAuth PKCE verifiers at rest and rejects tampering", () => {
    const previousSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_SECRET = "unit-test-oauth-secret";
    try {
      const verifier = "pkce-verifier-that-must-not-be-stored-in-plaintext";
      const stored = encryptOAuthVerifier(verifier);
      expect(stored).not.toContain(verifier);
      expect(decryptOAuthVerifier(stored)).toBe(verifier);
      const tamperedParts = stored.split(":");
      const tag = Buffer.from(tamperedParts[3] ?? "", "base64url");
      tag[0] = (tag[0] ?? 0) ^ 0xff;
      tamperedParts[3] = tag.toString("base64url");
      expect(() => decryptOAuthVerifier(tamperedParts.join(":"))).toThrow();
    } finally {
      if (previousSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousSecret;
    }
  });

  it("does not treat Gmail 2xx without a message id as a safe rejection", () => {
    expect(parseGmailSendResponse({ ok: true, status: 200 }, { id: "gmail-message-1" })).toBe("gmail-message-1");
    expect(() => parseGmailSendResponse({ ok: true, status: 200 }, {})).toThrow(EmailDeliveryUnknownError);
    expect(() => parseGmailSendResponse({ ok: false, status: 503 }, {})).toThrow(EmailDeliveryUnknownError);
    expect(() => parseGmailSendResponse({ ok: false, status: 400 }, { error: "invalid_request" })).toThrow(/invalid_request/u);
  });

  it("maps supported objectives to controlled templates", () => {
    expect(inferEmailTemplate("seguimiento de cotizacion")).toBe("seguimiento_cotizacion");
    expect(inferEmailTemplate("solicitar lista de precios")).toBe("solicitud_precio");
    expect(inferEmailTemplate("enviar orden de compra")).toBe("envio_orden_compra");
    expect(inferEmailTemplate("recordatorio de pago vencido")).toBe("recordatorio_pago");
  });

  it("escapes model-controlled content instead of emitting arbitrary HTML", () => {
    const composed = composeEmailBody({
      objective: '<script>alert("x")</script>',
      contactName: "Fátima",
      companyName: "Acme",
    });
    expect(composed.bodyHtml).not.toContain("<script>");
    expect(composed.bodyHtml).toContain("&lt;script&gt;");
    expect(escapeHtml('"<&')).toBe("&quot;&lt;&amp;");
  });

  it("supports edits without creating a second draft", () => {
    const revised = applyEmailRevision({
      bodyText: "Hola.\n\nTe envío la propuesta.\n\nQuedamos atentos.",
      instruction: "hacelo más corto y cambiá el asunto a Propuesta final",
      subject: "Propuesta",
    });
    expect(revised.bodyText).toBe("Hola.\n\nTe envío la propuesta.");
    expect(revised.subject).toBe("Propuesta final");
  });

  it("builds UTF-8 MIME with a base64 attachment and rejects header injection", () => {
    const message = buildRfc2822Message({
      from: "rodrigo@example.com",
      to: ["fatima@example.com"],
      subject: "Nueva cotización",
      bodyText: "Buenas tardes, Fátima:",
      bodyHtml: "<p>Buenas tardes, Fátima:</p>",
      attachments: [attachment],
    });
    expect(message).toContain("multipart/mixed");
    expect(message).toContain("Content-Disposition: attachment; filename=\"cotizacion.pdf\"");
    expect(message).toContain(Buffer.from([1, 2, 3]).toString("base64"));
    expect(() => buildRfc2822Message({
      from: "rodrigo@example.com",
      to: ["victim@example.com\r\nBcc: attacker@example.com"],
      subject: "x",
      bodyText: "x",
    })).toThrow();
    expect(Buffer.from(encodeGmailRaw(message), "base64url").toString("utf8")).toBe(message);
  });

  it("registers prepare as Risk 1 and send as Risk 2 with no free-form body input", () => {
    expect(getTool("prepare_email")?.riskLevel).toBe(1);
    expect(getTool("send_email")?.riskLevel).toBe(2);
    const parsed = SendEmailInputSchema.safeParse({ draft_id: attachment.documentId, to: ["x@example.com"] });
    expect(parsed.success).toBe(false);
  });
});
