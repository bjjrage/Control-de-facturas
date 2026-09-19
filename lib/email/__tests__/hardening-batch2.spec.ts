import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRfc2822Message } from "../mime";
import { EmailDeliveryUnknownError } from "../provider";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919022401_rodrigo_email_v1_hardening_batch2.sql"),
  "utf8"
);
const disconnectRoute = readFileSync(
  resolve(process.cwd(), "app/api/integrations/gmail/disconnect/route.ts"),
  "utf8"
);

describe("Rodrigo email V1 hardening batch 2", () => {
  it("defines the DB linearization point and the edit/send barrier", () => {
    expect(migration).toContain("create or replace function public.claim_email_send");
    expect(migration).toContain("approved_revision bigint");
    expect(migration).toContain("approved_content_hash text");
    expect(migration).toContain("v_approval.status not in ('APPROVED', 'EXECUTING')");
    expect(migration).toContain("from public.email_connections c");
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_connection.status <> 'CONNECTED'");
    expect(migration).toContain("old.status = 'SENDING'");
    expect(migration).toContain("email draft is locked by an in-flight send attempt");
    expect(migration).toContain("email draft attachments are locked by an in-flight send attempt");
  });

  it("persists an attempt before provider dispatch and has no automatic unknown retry", () => {
    expect(migration).toContain("create table if not exists public.email_send_attempts");
    expect(migration).toContain("'CLAIMED', 'DISPATCHING', 'SENT', 'FAILED_SAFE', 'DELIVERY_UNKNOWN'");
    expect(migration).toContain("insert into public.email_send_attempts");
    expect(migration).toContain("status = 'SENDING'");
    expect(migration).toContain("delivery outcome is unknown; explicit resend with a new approval is required");
    expect(migration).toContain("p_allow_delivery_unknown_retry");
    expect(migration).toContain("recover_stale_email_send_attempts");
    expect(migration).toContain("STALE_DISPATCHING");
    expect(disconnectRoute).toContain("from(\"email_send_attempts\")");
    expect(disconnectRoute).toContain("hasInFlightAttempt");
  });

  it("binds credential reads to the claimed attempt and denies browser roles", () => {
    expect(migration).toContain("create or replace function public.email_read_oauth_secret_for_send");
    expect(migration).toContain("a.status in ('CLAIMED', 'DISPATCHING')");
    expect(migration).toContain("a.approved_revision = d.revision");
    expect(migration).toContain("create or replace function public.email_read_oauth_secret_for_revoke");
    expect(migration).toContain("revoke all on function public.email_read_oauth_secret_for_send(uuid, uuid, uuid, uuid) from public, anon, authenticated");
    expect(migration).toContain("revoke all on function public.email_read_oauth_secret_for_revoke(uuid, uuid, uuid) from public, anon, authenticated");
  });

  it("uses the same verified bytes and a deterministic attempt Message-ID", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const message = buildRfc2822Message({
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Prueba",
      bodyText: "Adjunto",
      messageId: "<attempt-id@dominio-control-facturas>",
      attachments: [{
        id: "attachment-id",
        documentId: "document-id",
        fileName: "proof.bin",
        mimeType: "application/octet-stream",
        sizeBytes: bytes.byteLength,
        storageBucket: "documents",
        storagePath: "documents/proof.bin",
        contentSha256: null,
        bytes,
      }],
    });
    expect(message).toContain("Message-ID: <attempt-id@dominio-control-facturas>");
    expect(message).toContain(Buffer.from(bytes).toString("base64"));
  });

  it("models concurrent claims as one provider call", async () => {
    let draftStatus: "WAITING_APPROVAL" | "SENDING" = "WAITING_APPROVAL";
    let providerCalls = 0;
    const claim = async () => {
      if (draftStatus !== "WAITING_APPROVAL") return false;
      draftStatus = "SENDING";
      providerCalls += 1;
      return true;
    };
    const results = await Promise.all([claim(), claim()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(providerCalls).toBe(1);
  });

  it("surfaces ambiguity as terminal-without-retry", () => {
    const error = new EmailDeliveryUnknownError();
    expect(error.code).toBe("DELIVERY_UNKNOWN");
    expect(error.message).toMatch(/incierto/iu);
    expect(error.message).toMatch(/no se reintentar/iu);
  });
});
