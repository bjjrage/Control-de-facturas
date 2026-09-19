import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertSameOrigin } from "@/lib/security/same-origin";
import { formatEmailSentMessage } from "../presentation";
import { filterAttachmentsForProject, hashDraftContent } from "../domain-service";
import { isSendableEmailConnectionStatus } from "../provider";
import { revokeGoogleToken } from "../google-oauth";
import { assertAttachmentDigest, sha256Bytes } from "../content-hash";

const hardeningMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919003749_rodrigo_email_v1_hardening.sql"),
  "utf8"
);
const batch2Migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919022401_rodrigo_email_v1_hardening_batch2.sql"),
  "utf8"
);
const providerSource = readFileSync(resolve(process.cwd(), "lib/email/provider.ts"), "utf8");
const domainSource = readFileSync(resolve(process.cwd(), "lib/email/domain-service.ts"), "utf8");
const callbackSource = readFileSync(resolve(process.cwd(), "app/api/integrations/gmail/callback/route.ts"), "utf8");

describe("Rodrigo email V1 adversarial hardening", () => {
  it("keeps Vault bridges and audit inserts server-role-only", () => {
    expect(hardeningMigration).toContain("revoke all on function public.email_read_oauth_secret(uuid) from public, anon, authenticated");
    expect(hardeningMigration).toContain("grant execute on function public.email_read_oauth_secret(uuid, uuid, uuid) to service_role");
    expect(hardeningMigration).toContain("revoke insert on public.email_send_events from public, anon, authenticated");
    expect(hardeningMigration).toContain("grant insert on public.email_send_events to service_role");
    expect(hardeningMigration).toContain("revoke insert, update on public.email_connections from authenticated");
    expect(providerSource).toContain("const admin = createAdminClient();");
    expect(providerSource).toContain('admin.rpc("email_read_oauth_secret_for_send"');
    expect(batch2Migration).toContain("create or replace function public.email_read_oauth_secret_for_revoke");
    expect(batch2Migration).toContain("revoke all on function public.email_read_oauth_secret(uuid, uuid, uuid) from public, anon, authenticated, service_role");
    expect(callbackSource).toContain("const admin = createAdminClient();");
    expect(callbackSource).toContain('admin.rpc("email_connect_gmail"');
  });

  it("detects attachment byte mutation in the approval hash", () => {
    const original = sha256Bytes(new Uint8Array([1, 2, 3]));
    const mutated = sha256Bytes(new Uint8Array([1, 2, 4]));
    expect(original).not.toBe(mutated);
    expect(() => assertAttachmentDigest(new Uint8Array([1, 2, 4]), original)).toThrow(/nueva aprobación/u);
    const base = {
      to: ["destino@example.com"],
      cc: [],
      bcc: [],
      subject: "Cotización",
      bodyText: "Adjunto.",
      bodyHtml: "<p>Adjunto.</p>",
      attachments: [{
        id: "a",
        documentId: "d",
        fileName: "quote.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        storageBucket: "documents",
        storagePath: "d/quote.pdf",
        contentSha256: original,
      }],
    };
    expect(hashDraftContent(base)).not.toBe(hashDraftContent({
      ...base,
      attachments: [{ ...base.attachments[0], contentSha256: mutated }],
    }));
    expect(hardeningMigration).toContain("add column if not exists content_sha256 text");
    expect(domainSource).toContain('prepareEmailAttachments(params.db, current)');
  });

  it("filters attachment candidates to the requested project", () => {
    const rows = [{ id: "project-a" }, { id: "project-b" }, { id: "unlinked" }];
    const projects = new Map([["project-a", "A"], ["project-b", "B"], ["unlinked", null]]);
    expect(filterAttachmentsForProject(rows, projects, "A")).toEqual([{ id: "project-a" }]);
    expect(filterAttachmentsForProject(rows, projects, null)).toEqual([]);
  });

  it("blocks sending while disconnect is pending or failed", () => {
    expect(isSendableEmailConnectionStatus("CONNECTED")).toBe(true);
    expect(isSendableEmailConnectionStatus("REVOKE_PENDING")).toBe(false);
    expect(isSendableEmailConnectionStatus("DISCONNECT_FAILED")).toBe(false);
  });

  it("requires same-origin POSTs for explicit disconnect", () => {
    expect(() => assertSameOrigin(new Request("https://app.example/api/integrations/gmail/disconnect", {
      method: "POST",
      headers: { origin: "https://app.example", host: "app.example" },
    }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("https://app.example/api/integrations/gmail/disconnect", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "app.example" },
    }))).toThrow();
  });

  it("treats success and an already-invalid token as revoked, but retries timeout/5xx", async () => {
    const originalFetch = globalThis.fetch;
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 400 })));
      await expect(revokeGoogleToken("invalid-token")).resolves.toBeUndefined();
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
      await expect(revokeGoogleToken("valid-token")).resolves.toBeUndefined();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
      await expect(revokeGoogleToken("timeout-token")).rejects.toThrow("timeout");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
      await expect(revokeGoogleToken("temporary-failure")).rejects.toThrow();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("shows the final recipient name and email after send", () => {
    expect(formatEmailSentMessage("Fátima López (fatima@example.com)"))
      .toBe("Listo. El correo fue enviado a Fátima López (fatima@example.com).");
  });
});
