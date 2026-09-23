import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260918225636_rodrigo_email_v1.sql"),
  "utf8"
);

describe("Rodrigo email migration security contract", () => {
  it("uses Vault RPCs and never adds plaintext OAuth token columns", () => {
    expect(migration).toContain("create extension if not exists supabase_vault");
    expect(migration).toContain("vault.create_secret");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).not.toMatch(/(?<!p_)refresh_token\s+(text|jsonb)/iu);
    expect(migration).not.toMatch(/(?<!p_)access_token\s+(text|jsonb)/iu);
  });

  it("keeps email tables tenant-aware and marks the approved payload path", () => {
    for (const table of ["email_connections", "email_oauth_states", "email_drafts", "email_draft_attachments", "email_send_events"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("unique (empresa_id, idempotency_key)");
    expect(migration).toContain("cancel_email_approval_for_draft");
    expect(migration).toContain("email.send.started");
    expect(migration).toContain("email.send.completed");
  });
});
