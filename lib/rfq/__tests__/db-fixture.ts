import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261003000341_rfq_2_human_procurement.sql",
  ),
  "utf8",
);
const baseline = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261002231537_production_schema_baseline.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");
export const E = "10000000-0000-4000-8000-000000000001",
  U = "20000000-0000-4000-8000-000000000001",
  V = "30000000-0000-4000-8000-000000000001",
  V2 = "30000000-0000-4000-8000-000000000002";
export async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA extensions;
   CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') $$;`);
  for (const name of [
    "currency_code",
    "rfq_status",
    "rfq_provider_status",
    "user_role",
    "order_status",
    "selection_reason",
  ]) {
    const ddl = baseline.match(
      new RegExp(
        'CREATE TYPE "public"\\."' + name + '" AS ENUM \\([\\s\\S]*?\\);',
      ),
    )?.[0];
    if (!ddl) throw Error(name);
    await db.exec(ddl);
  }
  const tables = [
    "empresas",
    "profiles",
    "projects",
    "productos",
    "providers",
    "rfqs",
    "rfq_items",
    "rfq_providers",
    "quotes",
    "attachments",
    "quote_versions",
    "quote_version_items",
    "authorized_orders",
    "authorized_order_items",
    "audit_logs",
  ];
  for (const name of tables) {
    let ddl = baseline.match(
      new RegExp('CREATE TABLE "public"\\."' + name + '" \\([\\s\\S]*?\\n\\);'),
    )?.[0];
    if (!ddl) throw Error(name);
    ddl = ddl
      .replace(/"extensions"\."uuid_generate_v4"\(\)/g, "gen_random_uuid()")
      .replace(
        /(?:"extensions"\.|extensions\.)?"?gen_random_bytes"?\(32\)/g,
        "extensions.gen_random_bytes(32)",
      );
    await db.exec(ddl);
    await db.exec(`ALTER TABLE public.${name} ADD PRIMARY KEY(id);`);
  }
  await db.exec(`ALTER TABLE public.rfq_providers ADD UNIQUE(rfq_id,provider_id);
   ALTER TABLE public.rfqs ADD CONSTRAINT rfqs_code_key UNIQUE(code);
   CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql AS $$ SELECT empresa_id FROM public.profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION public.test_code() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code IS NULL THEN NEW.code:=gen_random_uuid()::text; END IF; RETURN NEW; END $$;
   CREATE TRIGGER code BEFORE INSERT ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.test_code();
   CREATE TRIGGER code BEFORE INSERT ON public.authorized_orders FOR EACH ROW EXECUTE FUNCTION public.test_code();
   INSERT INTO public.empresas(id,nombre) VALUES('${E}','RFQ test');
   INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES('${U}','test@rfq.invalid','Human','admin','${E}');
   INSERT INTO public.providers(id,empresa_id,name) VALUES('${V}','${E}','A'),('${V2}','${E}','B');
   SELECT set_config('request.jwt.claim.sub','${U}',false);`);
  await db.exec(
    `CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`,
  );
  await db.exec(migration);
  await db.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261003004948_rfq_2_completion_and_integrity.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261003010730_rfq_2_provenance_boundary_guards.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261003011539_rfq_2_document_storage.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261003012030_rfq_2_tenant_code_uniqueness.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261003012927_rfq_2_direct_purchase_notes.sql",
      ),
      "utf8",
    ),
  );
  return db;
}
