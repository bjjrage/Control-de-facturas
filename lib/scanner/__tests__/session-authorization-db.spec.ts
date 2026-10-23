import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20261022231201_scanner_session_authorization.sql"),
  "utf8",
);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;

async function actor(userId: number, role = "authenticated") {
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id(userId), role }),
  ]);
  await db.exec(`SET ROLE ${role}`);
}

describe("scanner session authorization migration (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TYPE public.user_role AS ENUM ('comercial', 'administracion', 'admin');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      $$;
      CREATE TABLE public.empresas(id uuid PRIMARY KEY, active boolean NOT NULL);
      CREATE TABLE public.profiles(
        id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        role public.user_role NOT NULL,
        active boolean NOT NULL
      );
      CREATE FUNCTION public.current_empresa_id() RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
          SELECT p.empresa_id FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
          WHERE p.id=auth.uid() AND p.active AND e.active
        $$;
      CREATE FUNCTION public.current_profile_role() RETURNS public.user_role
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
          SELECT p.role FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
          WHERE p.id=auth.uid() AND p.active AND e.active
        $$;
      CREATE FUNCTION public.is_internal_role(roles public.user_role[]) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
          SELECT public.current_profile_role() = ANY(roles)
        $$;
      CREATE TABLE public.scan_sessions(
        id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL,
        created_by uuid,
        context_type text NOT NULL,
        context_id text,
        target_field text,
        status text NOT NULL DEFAULT 'waiting',
        expires_at timestamptz DEFAULT now(),
        storage_bucket text DEFAULT 'invoice-files',
        storage_path text,
        file_name text,
        file_size_bytes bigint,
        page_count integer DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        claimed_at timestamptz,
        completed_at timestamptz,
        token_hash text,
        pin_code text,
        mobile_claim_token_hash text,
        claimed_device_info jsonb,
        metadata jsonb
      );
      ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "internal insert scan_sessions" ON public.scan_sessions FOR INSERT
        WITH CHECK (empresa_id=public.current_empresa_id());
      CREATE POLICY "internal read scan_sessions" ON public.scan_sessions FOR SELECT
        USING (empresa_id=public.current_empresa_id());
      CREATE POLICY "internal update scan_sessions" ON public.scan_sessions FOR UPDATE
        USING (empresa_id=public.current_empresa_id());
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT ALL ON public.scan_sessions TO anon, authenticated, service_role;
      CREATE FUNCTION public.scan_session_claim_atomic(uuid, text, jsonb, uuid) RETURNS void
        LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
      REVOKE ALL ON FUNCTION public.scan_session_claim_atomic(uuid, text, jsonb, uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.scan_session_claim_atomic(uuid, text, jsonb, uuid) TO service_role;
      CREATE FUNCTION public.scan_session_complete_atomic(uuid, text, text, bigint, integer) RETURNS void
        LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
      REVOKE ALL ON FUNCTION public.scan_session_complete_atomic(uuid, text, text, bigint, integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.scan_session_complete_atomic(uuid, text, text, bigint, integer) TO service_role;
      CREATE FUNCTION public.scan_session_create_atomic(uuid, uuid, text, text, timestamptz, text, text, text, text) RETURNS void
        LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
      REVOKE ALL ON FUNCTION public.scan_session_create_atomic(uuid, uuid, text, text, timestamptz, text, text, text, text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.scan_session_create_atomic(uuid, uuid, text, text, timestamptz, text, text, text, text) TO service_role;
      INSERT INTO public.empresas VALUES ('${id(1)}', true), ('${id(2)}', true);
      INSERT INTO public.profiles VALUES
        ('${id(11)}', '${id(1)}', 'comercial', true),
        ('${id(12)}', '${id(1)}', 'admin', true),
        ('${id(14)}', '${id(1)}', 'comercial', true),
        ('${id(13)}', '${id(2)}', 'admin', true);
      INSERT INTO public.scan_sessions(id, empresa_id, created_by, context_type) VALUES
        ('${id(21)}', '${id(1)}', '${id(11)}', 'general'),
        ('${id(22)}', '${id(1)}', '${id(11)}', 'invoice'),
        ('${id(23)}', '${id(1)}', '${id(12)}', 'invoice'),
        ('${id(24)}', '${id(1)}', '${id(14)}', 'general'),
        ('${id(25)}', '${id(2)}', '${id(13)}', 'general');
    `);
    await db.exec(migration);
  }, 20_000);

  afterAll(async () => {
    await db.close();
  });

  it("allows commercial users to read only their own general sessions", async () => {
    await actor(11);
    const rows = await db.query<{ id: string }>(
      "SELECT id, status, storage_path FROM public.scan_sessions ORDER BY id",
    );
    expect(rows.rows.map((row) => row.id)).toEqual([id(21)]);
    await db.exec("RESET ROLE");
  });

  it("allows internal invoice roles to read tenant sessions, never another tenant", async () => {
    await actor(12);
    const rows = await db.query<{ id: string }>(
      "SELECT id FROM public.scan_sessions ORDER BY id",
    );
    expect(rows.rows.map((row) => row.id)).toEqual([id(21), id(22), id(23), id(24)]);
    await db.exec("RESET ROLE");
  });

  it("revokes client mutations while preserving service-role writes and atomic RPC access", async () => {
    const privileges = await db.query(
      `SELECT
        has_table_privilege('anon','public.scan_sessions','SELECT') AS anon_select,
        has_table_privilege('anon','public.scan_sessions','INSERT') AS anon_insert,
        has_table_privilege('anon','public.scan_sessions','UPDATE') AS anon_update,
        has_table_privilege('anon','public.scan_sessions','DELETE') AS anon_delete,
        has_column_privilege('authenticated','public.scan_sessions','id','SELECT') AS auth_id_select,
        has_column_privilege('authenticated','public.scan_sessions','status','SELECT') AS auth_status_select,
        has_column_privilege('authenticated','public.scan_sessions','token_hash','SELECT') AS auth_token_select,
        has_column_privilege('authenticated','public.scan_sessions','pin_code','SELECT') AS auth_pin_select,
        has_column_privilege('authenticated','public.scan_sessions','mobile_claim_token_hash','SELECT') AS auth_mobile_token_select,
        has_column_privilege('authenticated','public.scan_sessions','claimed_device_info','SELECT') AS auth_device_select,
        has_column_privilege('authenticated','public.scan_sessions','metadata','SELECT') AS auth_metadata_select,
        has_table_privilege('authenticated','public.scan_sessions','INSERT') AS auth_insert,
        has_table_privilege('authenticated','public.scan_sessions','UPDATE') AS auth_update,
        has_table_privilege('authenticated','public.scan_sessions','DELETE') AS auth_delete,
        has_table_privilege('service_role','public.scan_sessions','INSERT') AS service_insert,
        has_table_privilege('service_role','public.scan_sessions','UPDATE') AS service_update,
        has_function_privilege('anon','public.scan_session_claim_atomic(uuid,text,jsonb,uuid)','EXECUTE') AS anon_rpc,
        has_function_privilege('authenticated','public.scan_session_claim_atomic(uuid,text,jsonb,uuid)','EXECUTE') AS auth_rpc,
        has_function_privilege('service_role','public.scan_session_claim_atomic(uuid,text,jsonb,uuid)','EXECUTE') AS service_claim_rpc,
        has_function_privilege('service_role','public.scan_session_complete_atomic(uuid,text,text,bigint,integer)','EXECUTE') AS service_complete_rpc,
        has_function_privilege('service_role','public.scan_session_create_atomic(uuid,uuid,text,text,timestamptz,text,text,text,text)','EXECUTE') AS service_create_rpc`,
    );
    expect(privileges.rows[0]).toEqual({
      anon_select: false,
      anon_insert: false,
      anon_update: false,
      anon_delete: false,
      auth_id_select: true,
      auth_status_select: true,
      auth_token_select: false,
      auth_pin_select: false,
      auth_mobile_token_select: false,
      auth_device_select: false,
      auth_metadata_select: false,
      auth_insert: false,
      auth_update: false,
      auth_delete: false,
      service_insert: true,
      service_update: true,
      anon_rpc: false,
      auth_rpc: false,
      service_claim_rpc: true,
      service_complete_rpc: true,
      service_create_rpc: true,
    });

    await actor(11);
    const safeColumns = await db.query<{ id: string; status: string }>(
      "SELECT id, status FROM public.scan_sessions ORDER BY id",
    );
    expect(safeColumns.rows).toEqual([{ id: id(21), status: "waiting" }]);
    await expect(db.query("SELECT * FROM public.scan_sessions")).rejects.toThrow(/permission denied/i);
    await expect(db.query("SELECT token_hash FROM public.scan_sessions")).rejects.toThrow(/permission denied/i);
    await expect(
      db.exec(`INSERT INTO public.scan_sessions(id, empresa_id, created_by, context_type) VALUES ('${id(26)}','${id(1)}','${id(11)}','general')`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.exec(`UPDATE public.scan_sessions SET context_type='general' WHERE id='${id(21)}'`),
    ).rejects.toThrow(/permission denied/i);
    await expect(db.exec(`DELETE FROM public.scan_sessions WHERE id='${id(21)}'`)).rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE");

    await actor(11, "anon");
    await expect(db.query("SELECT id FROM public.scan_sessions")).rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE");

    await actor(12, "service_role");
    await db.exec(`INSERT INTO public.scan_sessions(id, empresa_id, created_by, context_type) VALUES ('${id(26)}','${id(1)}','${id(12)}','general')`);
    await db.exec(`UPDATE public.scan_sessions SET context_type='general' WHERE id='${id(23)}'`);
    await db.exec("RESET ROLE");
  });
});
