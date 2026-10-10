import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, type QueryResult } from "pg";

/**
 * Real PostgreSQL certification for invoice item reconciliation.
 * Run only against the disposable Supabase local database after `supabase db reset`.
 * PGlite remains useful for sequential SQL behavior but is never counted as lock evidence.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const host = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing non-loopback PostgreSQL target: ${host}`);
}

type Fixture = {
  companyA: string;
  companyB: string;
  adminA: string;
  adminB: string;
  commercialA: string;
  providerA: string;
  providerB: string;
  orderA: string;
  orderItemA: string;
  orderItemIdem: string;
  orderItemUnmatch: string;
  orderItemApproval: string;
  orderItemPrecision: string;
  orderItemBadScale: string;
  orderItemFractionalRace: string;
  orderItemFractionalLineRaceA: string;
  orderItemFractionalLineRaceB: string;
  orderItemDeadlock: string;
  orderItemDelete: string;
  sharedAttachmentId: string;
  unsafeBucketAttachmentId: string;
  foreignPrefixAttachmentId: string;
  attachmentB: string;
  providerAttachmentId: string;
  invoices: Array<{ id: string; lineId: string; linkId: string }>;
  invoiceB: { id: string; lineId: string; linkId: string };
};

const db = () => new Client({ connectionString: databaseUrl });
const checks: string[] = [];

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = db();
  await client.connect();
  try {
    await client.query("SET statement_timeout = '15s'");
    await client.query("SET lock_timeout = '8s'");
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function asActor<T>(client: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await client.query("SET ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [userId]);
  try {
    return await fn();
  } finally {
    await client.query("RESET ROLE");
  }
}

async function asService<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query("SET ROLE service_role");
  await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
  try {
    return await fn();
  } finally {
    await client.query("RESET ROLE");
  }
}

async function seed(): Promise<Fixture> {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  const commercialA = randomUUID();
  const providerA = randomUUID();
  const providerB = randomUUID();
  const orderA = randomUUID();
  const orderB = randomUUID();
  const orderItemA = randomUUID();
  const orderItemB = randomUUID();
  const orderItemIdem = randomUUID();
  const orderItemUnmatch = randomUUID();
  const orderItemApproval = randomUUID();
  const orderItemPrecision = randomUUID();
  const orderItemBadScale = randomUUID();
  const orderItemFractionalRace = randomUUID();
  const orderItemFractionalLineRaceA = randomUUID();
  const orderItemFractionalLineRaceB = randomUUID();
  const orderItemDeadlock = randomUUID();
  const orderItemDelete = randomUUID();
  const sharedAttachmentId = randomUUID();
  const unsafeBucketAttachmentId = randomUUID();
  const foreignPrefixAttachmentId = randomUUID();
  const attachmentB = randomUUID();
  const providerAttachmentId = randomUUID();
  const invoices = Array.from({ length: 15 }, () => ({ id: randomUUID(), lineId: randomUUID(), linkId: randomUUID() }));
  const invoiceB = { id: randomUUID(), lineId: randomUUID(), linkId: randomUUID() };

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO public.empresas (id,nombre,slug) VALUES ($1,'R3 test A',$3),($2,'R3 test B',$4)", [companyA, companyB, `r3-${companyA}`, `r3-${companyB}`]);
      await client.query(
        `INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
         VALUES ($1,'authenticated','authenticated',$3,now(),'{}'::jsonb,'{}'::jsonb),
                ($2,'authenticated','authenticated',$4,now(),'{}'::jsonb,'{}'::jsonb),
                ($5,'authenticated','authenticated',$6,now(),'{}'::jsonb,'{}'::jsonb)`,
        [adminA, adminB, `${adminA}@r3.test`, `${adminB}@r3.test`, commercialA, `${commercialA}@r3.test`],
      );
      await client.query(
        `INSERT INTO public.profiles (id,email,full_name,role,empresa_id) VALUES
         ($1,$5,'R3 Admin A','admin',$3),($2,$6,'R3 Admin B','admin',$4),($7,$8,'R3 Commercial A','comercial',$3)`,
        [adminA, adminB, companyA, companyB, `${adminA}@r3.test`, `${adminB}@r3.test`, commercialA, `${commercialA}@r3.test`],
      );
      await client.query("INSERT INTO public.providers (id,empresa_id,name) VALUES ($1,$3,'R3 supplier A'),($2,$4,'R3 supplier B')", [providerA, providerB, companyA, companyB]);
      await client.query(
        `INSERT INTO public.authorized_orders (id,provider_id,code,provider_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,empresa_id,created_from)
         VALUES ($1,$3,'R3-A','R3 supplier A','Ladrillo común',1000,'un',10,10000,'PYG',false,$5,true,$7,'invoice'),
                ($2,$4,'R3-B','R3 supplier B','Ladrillo común',1000,'un',10,10000,'PYG',false,$6,true,$8,'invoice')`,
        [orderA, orderB, providerA, providerB, adminA, adminB, companyA, companyB],
      );
      await client.query(
        `INSERT INTO public.authorized_order_items (id,order_id,empresa_id,product,quantity,unit,unit_price,total_price)
         VALUES ($1,$3,$5,'Ladrillo común',1000,'un',1,1000),($2,$4,$6,'Ladrillo común',1000,'un',1,1000),
                ($7,$3,$5,'Ladrillo común',1000,'un',1,1000),($8,$3,$5,'Ladrillo común',1000,'un',1,1000),($9,$3,$5,'Ladrillo común',1000,'un',1,1000),
                ($10,$3,$5,'Ladrillo común',60.0000,'un',1,60),($11,$3,$5,'Ladrillo común',1000,'un',1,1000),($12,$3,$5,'Ladrillo común',1000,'un',1,1000),($13,$3,$5,'Ladrillo común',1000,'un',1,1000),
                ($14,$3,$5,'Ladrillo común',0.0001,'un',1,0.01),
                ($15,$3,$5,'Ladrillo común',0.0001,'un',1,0.01),($16,$3,$5,'Ladrillo común',0.0001,'un',1,0.01)`,
        [orderItemA, orderItemB, orderA, orderB, companyA, companyB, orderItemIdem, orderItemUnmatch, orderItemApproval, orderItemPrecision, orderItemBadScale, orderItemDeadlock, orderItemDelete, orderItemFractionalRace, orderItemFractionalLineRaceA, orderItemFractionalLineRaceB],
      );
      for (const [index, inv] of invoices.entries()) {
        const quantity = index >= 12 ? "0.0001" : "800";
        const subtotal = index >= 12 ? "0.01" : "800";
        await client.query(
          `INSERT INTO public.invoices (id,provider_id,invoice_number,invoice_date,currency,total,created_by,empresa_id,status)
           VALUES ($1,$2,$3,CURRENT_DATE,'PYG',800,$4,$5,$6::public.invoice_status)`,
          [inv.id, providerA, `R3-${index}`, adminA, companyA, index === 4 ? "MATCH" : "PENDIENTE"],
        );
        await client.query(
          `INSERT INTO public.invoice_items (id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
           VALUES ($1,$2,$3,'Ladrillo común',$4::numeric,'un',1,$5::numeric)`,
          [inv.lineId, inv.id, companyA, quantity, subtotal],
        );
        await client.query(
          `INSERT INTO public.invoice_order_matches (id,invoice_id,authorized_order_id,empresa_id) VALUES ($1,$2,$3,$4)`,
          [inv.linkId, inv.id, orderA, companyA],
        );
      }
      await client.query(
        `INSERT INTO public.invoices (id,provider_id,invoice_number,invoice_date,currency,total,created_by,empresa_id)
         VALUES ($1,$2,'R3-B-1',CURRENT_DATE,'PYG',100,$3,$4)`,
        [invoiceB.id, providerB, adminB, companyB],
      );
      await client.query(
        `INSERT INTO public.invoice_items (id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
         VALUES ($1,$2,$3,'Ladrillo común',100,'un',1,100)`,
        [invoiceB.lineId, invoiceB.id, companyB],
      );
      await client.query(
        `INSERT INTO public.invoice_order_matches (id,invoice_id,authorized_order_id,empresa_id) VALUES ($1,$2,$3,$4)`,
        [invoiceB.linkId, invoiceB.id, orderB, companyB],
      );
      await client.query(
        `INSERT INTO public.attachments(id,bucket,path,file_name,uploaded_by,empresa_id)
         VALUES($1,'invoice-files',$4,'shared.pdf',$2,$3),
               ($5,'private-bucket',$6,'unsafe-bucket.pdf',$2,$3),
               ($7,'invoice-files',$8,'foreign-prefix.pdf',$2,$3),
               ($9,'invoice-files',$10,'tenant-b.pdf',$11,$12),
               ($13,'invoice-files',$14,'provider-prefix.pdf',$2,$3)`,
        [sharedAttachmentId, adminA, companyA, `${companyA}/shared.pdf`, unsafeBucketAttachmentId, `${companyA}/unsafe.pdf`, foreignPrefixAttachmentId, `${companyB}/foreign.pdf`, attachmentB, `${companyB}/tenant.pdf`, adminB, companyB, providerAttachmentId, `${providerA}/provider.pdf`],
      );
      await client.query(
        `UPDATE public.invoices SET attachment_id=CASE id
           WHEN $2 THEN $1::uuid WHEN $3 THEN $1::uuid WHEN $4 THEN $5::uuid WHEN $6 THEN $7::uuid WHEN $8 THEN $9::uuid END
         WHERE id=ANY($10::uuid[])`,
        [sharedAttachmentId, invoices[7].id, invoices[8].id, invoices[9].id, unsafeBucketAttachmentId, invoices[10].id, foreignPrefixAttachmentId, invoices[11].id, providerAttachmentId, [invoices[7].id, invoices[8].id, invoices[9].id, invoices[10].id, invoices[11].id]],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return { companyA, companyB, adminA, adminB, commercialA, providerA, providerB, orderA, orderItemA, orderItemIdem, orderItemUnmatch, orderItemApproval, orderItemPrecision, orderItemBadScale, orderItemFractionalRace, orderItemFractionalLineRaceA, orderItemFractionalLineRaceB, orderItemDeadlock, orderItemDelete, sharedAttachmentId, unsafeBucketAttachmentId, foreignPrefixAttachmentId, attachmentB, providerAttachmentId, invoices, invoiceB };
}

async function createMatch(client: Client, f: Fixture, invoiceIndex: number, orderItemId: string, qty: string) {
  const inv = f.invoices[invoiceIndex];
  return client.query(
    "SELECT public.create_invoice_item_match($1,$2,$3,$4,$5,$6) AS result",
    [f.companyA, inv.id, f.orderA, inv.lineId, orderItemId, qty],
  );
}

async function createMatchForLine(client: Client, f: Fixture, invoiceIndex: number, lineId: string, orderItemId: string, qty: string) {
  const inv = f.invoices[invoiceIndex];
  return client.query(
    "SELECT public.create_invoice_item_match($1,$2,$3,$4,$5,$6) AS result",
    [f.companyA, inv.id, f.orderA, lineId, orderItemId, qty],
  );
}

async function waitUntilBlocked(observer: Client, pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`session ${pid} did not block on a PostgreSQL lock`);
}

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

async function main() {
  const version = await withClient(async (client) => (await client.query("SHOW server_version_num")).rows[0].server_version_num as string);
  assert.ok(Number(version) >= 170000 && Number(version) < 180000, `expected PostgreSQL 17, got ${version}`);
  const rpcArguments = await withClient(async (client) => client.query(
    `SELECT p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname = ANY($1::text[]) ORDER BY p.proname`,
    [["create_invoice_item_match", "correct_invoice_item", "unmatch_invoice_order", "delete_invoice_item", "delete_invoice_item_match", "delete_invoice", "create_invoice_from_job"]],
  ));
  const argsByRpc = Object.fromEntries(rpcArguments.rows.map((row) => [row.proname, row.proargnames]));
  assert.deepEqual(argsByRpc.create_invoice_item_match, ["p_empresa_id", "p_invoice_id", "p_expected_order_id", "p_invoice_item_id", "p_order_item_id", "p_quantity"]);
  assert.deepEqual(argsByRpc.correct_invoice_item, ["p_empresa_id", "p_invoice_item_id", "p_description", "p_quantity", "p_unit", "p_unit_price", "p_subtotal"]);
  assert.deepEqual(argsByRpc.unmatch_invoice_order, ["p_empresa_id", "p_invoice_id", "p_expected_match_id", "p_expected_order_id"]);
  assert.deepEqual(argsByRpc.delete_invoice_item, ["p_empresa_id", "p_invoice_id", "p_invoice_item_id"]);
  assert.deepEqual(argsByRpc.delete_invoice_item_match, ["p_empresa_id", "p_invoice_id", "p_invoice_item_match_id"]);
  assert.deepEqual(argsByRpc.delete_invoice, ["p_empresa_id", "p_invoice_id"]);
  assert.deepEqual(argsByRpc.create_invoice_from_job, ["p_empresa_id", "p_job_id", "p_expected_attempts", "p_invoice"]);
  const receiptGuard = await withClient(async (client) => client.query(
    `SELECT t.tgname,t.tgenabled,p.proname,pn.nspname AS function_schema,
            ARRAY(SELECT a.attname::text FROM unnest(t.tgattr::smallint[]) AS target(attnum)
                    JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=target.attnum
                   ORDER BY a.attnum) AS update_columns
       FROM pg_trigger t
       JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace rn ON rn.oid=c.relnamespace
       JOIN pg_proc p ON p.oid=t.tgfoid
       JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE rn.nspname='public' AND c.relname='authorized_order_items'
        AND t.tgname='trg_prevent_order_quantity_below_confirmed_receipts'
        AND NOT t.tgisinternal`,
  ));
  assert.equal(receiptGuard.rows.length, 1, "confirmed-receipt quantity guard trigger must remain installed");
  assert.equal(receiptGuard.rows[0].tgenabled, "O", "confirmed-receipt trigger must remain enabled for origin sessions");
  assert.equal(receiptGuard.rows[0].function_schema, "public");
  assert.equal(receiptGuard.rows[0].proname, "prevent_order_quantity_below_confirmed_receipts");
  assert.deepEqual(receiptGuard.rows[0].update_columns, ["quantity"], "receipt guard must remain scoped to quantity updates");
  const f = await seed();

  // Tenant boundary, role boundary, anon privilege, and direct-write privilege.
  await withClient(async (client) => {
    await asActor(client, f.adminB, async () => {
      await assert.rejects(createMatch(client, f, 0, f.orderItemA, "10"), (error: unknown) => pgErrorCode(error) === "42501");
    });
    await asActor(client, f.adminA, async () => {
      await assert.rejects(client.query("SELECT public.create_invoice_item_match($1,$2,$3,$4,$5,$6)", [f.companyB, f.invoices[0].id, f.orderA, f.invoices[0].lineId, f.orderItemA, "10"]), (error: unknown) => pgErrorCode(error) === "42501");
    });
    await asActor(client, f.adminB, async () => {
      await assert.rejects(
        client.query("SELECT public.create_invoice_item_match($1,$2,$3,$4,$5,$6)", [f.companyB, f.invoices[0].id, f.orderA, f.invoices[0].lineId, f.orderItemA, "10"]),
        (error: unknown) => pgErrorCode(error) === "42501"
          || (pgErrorCode(error) === "P0001" && /no pertenece a esta empresa/i.test(String(error))),
      );
      const untouched = await client.query("SELECT count(*)::int AS count FROM public.invoice_item_matches WHERE invoice_item_id=$1", [f.invoices[0].lineId]);
      assert.equal(untouched.rows[0].count, 0, "cross-tenant resource rejection must not write a match");
    });
    await asActor(client, f.commercialA, async () => {
      await assert.rejects(createMatch(client, f, 0, f.orderItemA, "10"), (error: unknown) => pgErrorCode(error) === "42501");
    });
    await client.query("SET ROLE anon");
    await client.query("SELECT set_config('request.jwt.claim.role','anon',false)");
    await assert.rejects(createMatch(client, f, 0, f.orderItemA, "10"), (error: unknown) => pgErrorCode(error) === "42501");
    await client.query("RESET ROLE");
    await asActor(client, f.adminA, async () => {
      await assert.rejects(client.query("INSERT INTO public.invoice_item_matches(invoice_item_id,order_item_id,empresa_id,quantity_matched) VALUES($1,$2,$3,1)", [f.invoices[0].lineId, f.orderItemA, f.companyA]), (error: unknown) => pgErrorCode(error) === "42501");
      await assert.rejects(client.query("TRUNCATE public.invoice_item_matches"), (error: unknown) => pgErrorCode(error) === "42501");
    });
  });
  await withClient(async (client) => {
    await client.query("UPDATE public.profiles SET active=false WHERE id=$1", [f.adminA]);
    await asActor(client, f.adminA, async () => {
      await assert.rejects(createMatch(client, f, 0, f.orderItemA, "10"), (error: unknown) => pgErrorCode(error) === "42501");
    });
    await client.query("UPDATE public.profiles SET active=true WHERE id=$1", [f.adminA]);
  });
  checks.push("tenant ownership/spoofing, inactive and unauthorized actors, anon EXECUTE, and direct match write denied");

  // Worker crash recovery must never enqueue a job that already crossed the invoice creation checkpoint.
  const jobWithInvoice = randomUUID();
  const staleWithoutInvoice = randomUUID();
  const exhaustedWithoutInvoice = randomUUID();
  const queuedWithInvoice = randomUUID();
  const queuedWithoutInvoice = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts,invoice_id,locked_at)
       VALUES($1,$5,$6,'r3/stale-created.pdf','stale-created.pdf','application/pdf','processing',1,$7,now()-interval '1 hour'),
             ($2,$5,$6,'r3/stale-empty.pdf','stale-empty.pdf','application/pdf','processing',1,NULL,now()-interval '1 hour'),
             ($3,$5,$6,'r3/stale-exhausted.pdf','stale-exhausted.pdf','application/pdf','processing',3,NULL,now()-interval '1 hour'),
             ($4,$5,$6,'r3/queued-created.pdf','queued-created.pdf','application/pdf','queued',0,$7,NULL)`,
      [jobWithInvoice, staleWithoutInvoice, exhaustedWithoutInvoice, queuedWithInvoice, f.companyA, f.adminA, f.invoices[6].id],
    );
    await client.query(
      `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts)
       VALUES($1,$2,$3,'r3/queued-empty.pdf','queued-empty.pdf','application/pdf','queued',0)`,
      [queuedWithoutInvoice, f.companyA, f.adminA],
    );
  });
  await withClient(async (client) => {
    await asActor(client, f.adminA, async () => {
      await assert.rejects(client.query("SELECT public.claim_invoice_job()"), (error: unknown) => pgErrorCode(error) === "42501");
      await assert.rejects(client.query("SELECT public.requeue_stale_invoice_jobs(15,3)"), (error: unknown) => pgErrorCode(error) === "42501");
    });
  });
  const jobStates = await withClient(async (client) => {
    await client.query("SET ROLE service_role");
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
    try {
      const claim = await client.query("SELECT (public.claim_invoice_job()).id AS id");
      const requeued = await client.query("SELECT public.requeue_stale_invoice_jobs(15,3) AS count");
      const rows = await client.query(
        "SELECT id,status::text,attempts,invoice_id,outcome,locked_at,message FROM public.invoice_jobs WHERE id=ANY($1::uuid[])",
        [[jobWithInvoice, staleWithoutInvoice, exhaustedWithoutInvoice, queuedWithInvoice, queuedWithoutInvoice]],
      );
      return { claimedId: claim.rows[0].id as string | null, count: requeued.rows[0].count as number, rows: rows.rows };
    } finally { await client.query("RESET ROLE"); }
  });
  assert.equal(jobStates.claimedId, queuedWithoutInvoice, "claim must skip a queued job that already has an invoice checkpoint");
  assert.equal(jobStates.count, 3);
  const stateById = new Map(jobStates.rows.map((row) => [row.id as string, row]));
  const reviewJob = stateById.get(jobWithInvoice);
  assert.equal(reviewJob?.status, "needs_review");
  assert.equal(reviewJob?.outcome, "needs_manual");
  assert.equal(reviewJob?.invoice_id, f.invoices[6].id);
  assert.equal(reviewJob?.locked_at, null);
  assert.equal(stateById.get(staleWithoutInvoice)?.status, "queued", "stale job without invoice remains retryable below max attempts");
  assert.equal(stateById.get(exhaustedWithoutInvoice)?.status, "failed");
  assert.equal(stateById.get(queuedWithInvoice)?.status, "queued", "claim must not consume post-checkpoint work");
  assert.equal(stateById.get(queuedWithoutInvoice)?.status, "processing", "claim must transition the eligible job to processing");
  checks.push("worker-only invoice job RPCs; claim skips invoice-checkpoint jobs; stale checkpoint moves to needs_review preserving invoice_id while retryable/exhausted jobs follow their own branches");

  // Atomic worker create/checkpoint: one exact lease attempt can create one invoice, checkpoint, and tenant-scoped audit row.
  const createdInvoiceNumber = `R3-ATOMIC-${randomUUID()}`;
  const invoicePayload = {
    provider_id: f.providerA,
    invoice_number: createdInvoiceNumber,
    invoice_date: new Date().toISOString().slice(0, 10),
    currency: "PYG",
    subtotal: 100,
    vat: 0,
    total: 100,
    timbrado: null,
    attachment_id: null,
  };
  const workerCreate = (client: Client, jobId: string, tenant: string, attempts: number, payload: Record<string, unknown>) =>
    client.query("SELECT public.create_invoice_from_job($1,$2,$3,$4::jsonb) AS result", [tenant, jobId, attempts, JSON.stringify(payload)]);
  const atomicAttempts = await Promise.all([
    withClient(async (client) => {
      await client.query("SET ROLE service_role");
      await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
      try { return await workerCreate(client, queuedWithoutInvoice, f.companyA, 1, invoicePayload); }
      finally { await client.query("RESET ROLE"); }
    }).then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
    withClient(async (client) => {
      await client.query("SET ROLE service_role");
      await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
      try { return await workerCreate(client, queuedWithoutInvoice, f.companyA, 1, invoicePayload); }
      finally { await client.query("RESET ROLE"); }
    }).then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
  ]);
  assert.equal(atomicAttempts.filter((attempt) => attempt.ok).length, 1, "only one concurrent create for the same lease may win");
  assert.equal(atomicAttempts.filter((attempt) => !attempt.ok).length, 1, "the stale concurrent create must lose the row-lock/CAS race");
  const createdResult = atomicAttempts.find((attempt) => attempt.ok);
  assert.ok(createdResult?.ok);
  assert.equal(createdResult.value.rows[0].result.ok, true);
  const atomicState = await withClient(async (client) => client.query(
    `SELECT j.status::text,j.attempts,j.invoice_id,i.empresa_id,i.created_by,
            (SELECT count(*)::int FROM public.invoices x WHERE x.invoice_number=$2 AND x.empresa_id=$3) AS invoice_count,
            (SELECT count(*)::int FROM public.audit_logs a WHERE a.invoice_id=j.invoice_id AND a.action='invoice.created' AND a.empresa_id=$3 AND a.actor_type='system') AS audit_count
       FROM public.invoice_jobs j LEFT JOIN public.invoices i ON i.id=j.invoice_id WHERE j.id=$1`,
    [queuedWithoutInvoice, createdInvoiceNumber, f.companyA],
  ));
  assert.equal(atomicState.rows[0].invoice_count, 1);
  assert.equal(atomicState.rows[0].status, "processing");
  assert.equal(atomicState.rows[0].attempts, 1);
  assert.equal(atomicState.rows[0].empresa_id, f.companyA);
  assert.equal(atomicState.rows[0].created_by, f.adminA);
  assert.equal(atomicState.rows[0].audit_count, 1, "atomic worker creation must write one tenant-scoped system audit");
  checks.push("concurrent same-job invoice creation has a single CAS winner and atomically persists invoice, checkpoint, and tenant audit");

  // Exact attempt and tenant fencing reject stale workers and cross-company jobs without creating invoices.
  const fencedJobId = randomUUID();
  const crossTenantJobId = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts,locked_at)
       VALUES($1,$2,$3,'r3/fenced.pdf','fenced.pdf','application/pdf','processing',2,now()-interval '1 hour'),
             ($4,$5,$6,'r3/other-tenant.pdf','other-tenant.pdf','application/pdf','processing',1,now())`,
      [fencedJobId, f.companyA, f.adminA, crossTenantJobId, f.companyB, f.adminB],
    );
  });
  const beforeFencedInvoices = await withClient(async (client) => client.query("SELECT count(*)::int AS count FROM public.invoices WHERE invoice_number=$1", [createdInvoiceNumber]));
  await withClient(async (client) => {
    await client.query("SET ROLE service_role");
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
    try {
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 1, { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-STALE` }), (error: unknown) => pgErrorCode(error) === "40001");
      await assert.rejects(workerCreate(client, crossTenantJobId, f.companyA, 1, { ...invoicePayload, provider_id: f.providerB, invoice_number: `${createdInvoiceNumber}-TENANT` }), (error: unknown) => pgErrorCode(error) === "42501");
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, provider_id: f.providerB, invoice_number: `${createdInvoiceNumber}-PROVIDER` }), /tenant|empresa|proveedor|pertenece/i);
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, attachment_id: f.attachmentB, invoice_number: `${createdInvoiceNumber}-ATTACHMENT` }), /tenant|empresa|adjunto|pertenece/i);
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-UNKNOWN`, untrusted_column: true }), /unexpected|allowlist|field|column/i);
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-NAN`, total: "NaN" }), (error: unknown) => pgErrorCode(error) === "22023");
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-INFINITY`, total: "Infinity" }), (error: unknown) => pgErrorCode(error) === "22023");
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-SUBSCALE`, subtotal: 1.001 }), (error: unknown) => pgErrorCode(error) === "22023");
      await assert.rejects(workerCreate(client, fencedJobId, f.companyA, 2, { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-VATSCALE`, vat: 1.001 }), (error: unknown) => pgErrorCode(error) === "22023");
    } finally { await client.query("RESET ROLE"); }
  });
  const fencedInvoiceCount = await withClient(async (client) => client.query("SELECT count(*)::int AS count FROM public.invoices WHERE invoice_number LIKE $1", [`${createdInvoiceNumber}-%`]));
  assert.equal(Number(fencedInvoiceCount.rows[0].count), 0);
  assert.equal(Number(beforeFencedInvoices.rows[0].count), 1);
  checks.push("atomic worker RPC rejects stale attempt, cross-tenant job/provider/attachment, unexpected payload keys, non-finite totals and excessive amount scales without side effects");

  // Authenticated admins may create only their own company's invoice/job; commercial and cross-tenant users fail closed.
  const authenticatedJobId = randomUUID();
  const deniedJobId = randomUUID();
  await withClient(async (client) => client.query(
    `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts,locked_at)
     VALUES($1,$3,$4,'r3/authenticated.pdf','authenticated.pdf','application/pdf','processing',1,now()),
           ($2,$3,$4,'r3/auth-denied.pdf','auth-denied.pdf','application/pdf','processing',1,now())`,
    [authenticatedJobId, deniedJobId, f.companyA, f.adminA],
  ));
  const authenticatedPayload = { ...invoicePayload, invoice_number: `${createdInvoiceNumber}-AUTH` };
  await withClient(async (client) => {
    await asActor(client, f.commercialA, async () => {
      await assert.rejects(workerCreate(client, deniedJobId, f.companyA, 1, { ...authenticatedPayload, invoice_number: `${createdInvoiceNumber}-NONADMIN` }), (error: unknown) => pgErrorCode(error) === "42501");
    });
    await asActor(client, f.adminB, async () => {
      await assert.rejects(workerCreate(client, deniedJobId, f.companyA, 1, { ...authenticatedPayload, invoice_number: `${createdInvoiceNumber}-AUTH-TENANT` }), (error: unknown) => pgErrorCode(error) === "42501");
    });
    await asActor(client, f.adminA, async () => {
      const created = await workerCreate(client, authenticatedJobId, f.companyA, 1, authenticatedPayload);
      assert.equal(created.rows[0].result.ok, true);
    });
  });
  const authenticatedAudit = await withClient(async (client) => client.query(
    `SELECT j.invoice_id,i.empresa_id,i.created_by,
            (SELECT count(*)::int FROM public.audit_logs a WHERE a.invoice_id=j.invoice_id AND a.action='invoice.created' AND a.empresa_id=$2 AND a.actor_id=$3) AS audit_count
       FROM public.invoice_jobs j JOIN public.invoices i ON i.id=j.invoice_id WHERE j.id=$1`,
    [authenticatedJobId, f.companyA, f.adminA],
  ));
  assert.equal(authenticatedAudit.rows[0].empresa_id, f.companyA);
  assert.equal(authenticatedAudit.rows[0].created_by, f.adminA);
  assert.equal(authenticatedAudit.rows[0].audit_count, 1);
  checks.push("authenticated admin RPC is tenant-scoped and audited; authenticated commercial and cross-tenant admin are rejected");

  // Fail after the invoice INSERT at checkpoint UPDATE; the single RPC transaction must roll back invoice, checkpoint and audit.
  const rollbackJobId = randomUUID();
  const rollbackInvoiceNumber = `${createdInvoiceNumber}-ROLLBACK`;
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts,locked_at)
       VALUES($1,$2,$3,$4,'rollback.pdf','application/pdf','processing',4,now())`,
      [rollbackJobId, f.companyA, f.adminA, `r3/rollback-${rollbackJobId}.pdf`],
    );
    await client.query(`CREATE OR REPLACE FUNCTION public.r3_fail_invoice_job_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.storage_path LIKE 'r3/rollback-%' AND OLD.invoice_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
        RAISE EXCEPTION 'R3 forced checkpoint failure'; END IF; RETURN NEW; END; $$`);
    await client.query("CREATE TRIGGER r3_fail_invoice_job_checkpoint BEFORE UPDATE ON public.invoice_jobs FOR EACH ROW EXECUTE FUNCTION public.r3_fail_invoice_job_checkpoint()");
  });
  const auditCountBeforeFailure = await withClient(async (client) => client.query(
    "SELECT count(*)::int AS count FROM public.audit_logs WHERE action='invoice.created' AND actor_type='system' AND actor_id=$1",
    [f.adminA],
  ));
  try {
    await withClient(async (client) => {
      await client.query("SET ROLE service_role");
      await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
      try {
        await assert.rejects(workerCreate(client, rollbackJobId, f.companyA, 4, { ...invoicePayload, invoice_number: rollbackInvoiceNumber }), /R3 forced checkpoint failure/);
      } finally { await client.query("RESET ROLE"); }
    });
  } finally {
    await withClient(async (client) => {
      await client.query("DROP TRIGGER IF EXISTS r3_fail_invoice_job_checkpoint ON public.invoice_jobs");
      await client.query("DROP FUNCTION IF EXISTS public.r3_fail_invoice_job_checkpoint()");
    });
  }
  const rolledBackCreate = await withClient(async (client) => client.query(
    `SELECT j.invoice_id,(SELECT count(*)::int FROM public.invoices WHERE invoice_number=$2 AND empresa_id=$3) AS invoice_count
       FROM public.invoice_jobs j WHERE j.id=$1`, [rollbackJobId, rollbackInvoiceNumber, f.companyA],
  ));
  const auditCountAfterFailure = await withClient(async (client) => client.query(
    "SELECT count(*)::int AS count FROM public.audit_logs WHERE action='invoice.created' AND actor_type='system' AND actor_id=$1",
    [f.adminA],
  ));
  assert.equal(rolledBackCreate.rows[0].invoice_id, null);
  assert.equal(rolledBackCreate.rows[0].invoice_count, 0);
  assert.equal(auditCountAfterFailure.rows[0].count, auditCountBeforeFailure.rows[0].count);
  checks.push("forced post-insert checkpoint trigger failure rolls back invoice/checkpoint/audit atomically");

  // The table guard fences direct writes even for service_role; only the owned
  // transactional RPC may create invoice checkpoints; new leases require a higher attempt.
  const reentryJobId = randomUUID();
  await withClient(async (client) => client.query(
    `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts)
     VALUES($1,$2,$3,$4,'reentry.pdf','application/pdf','needs_review',2)`,
    [reentryJobId, f.companyA, f.adminA, `r3/reentry-${reentryJobId}.pdf`],
  ));
  await withClient(async (client) => {
    for (const actor of [
      (fn: () => Promise<unknown>) => asActor(client, f.adminA, fn),
      (fn: () => Promise<unknown>) => asService(client, fn),
    ]) {
      await actor(async () => {
        await assert.rejects(client.query("UPDATE public.invoice_jobs SET attempts=attempts-1 WHERE id=$1", [fencedJobId]),
          (error: unknown) => pgErrorCode(error) === "40001");
        await assert.rejects(client.query("UPDATE public.invoice_jobs SET status='processing' WHERE id=$1", [reentryJobId]),
          (error: unknown) => pgErrorCode(error) === "40001");
        await assert.rejects(client.query("UPDATE public.invoice_jobs SET invoice_id=$2 WHERE id=$1", [fencedJobId, f.invoices[0].id]),
          (error: unknown) => pgErrorCode(error) === "42501");
        await assert.rejects(client.query("TRUNCATE public.invoice_jobs"),
          (error: unknown) => pgErrorCode(error) === "42501");
      });
    }
    await asActor(client, f.adminA, async () => {
      const insertedJobId = randomUUID();
      await assert.rejects(client.query(
        `INSERT INTO public.invoice_jobs(id,empresa_id,created_by,storage_path,file_name,mime_type,status,attempts,invoice_id)
         VALUES($1,$2,$3,$4,'forged-checkpoint.pdf','application/pdf','queued',0,$5)`,
        [insertedJobId, f.companyA, f.adminA, `r3/forged-${insertedJobId}.pdf`, f.invoices[0].id],
      ), (error: unknown) => pgErrorCode(error) === "42501");
    });
  });
  const fencedState = await withClient(async (client) => client.query(
    "SELECT id,status::text,attempts,invoice_id FROM public.invoice_jobs WHERE id=ANY($1::uuid[]) ORDER BY id",
    [[fencedJobId, reentryJobId]],
  ));
  assert.deepEqual(fencedState.rows, [
    { id: fencedJobId, status: "processing", attempts: 2, invoice_id: null },
    { id: reentryJobId, status: "needs_review", attempts: 2, invoice_id: null },
  ].sort((a, b) => a.id.localeCompare(b.id)));
  checks.push("authenticated and service roles cannot decrement attempts, re-enter processing without a new attempt, forge invoice checkpoints, insert pre-checkpointed jobs, or TRUNCATE invoice_jobs");

  // Exact numeric precision, non-finite rejection, and worker audit attribution.
  // INSERT as the tenant admin to prove the guards receive the original numeric
  // value before PostgreSQL can silently coerce it to a typmod scale.
  const precisionLineId = randomUUID();
  const trailingZeroLineId = randomUUID();
  const invalidSourceLines = [
    { id: randomUUID(), quantity: "1.23456", unitPrice: "1.0000", subtotal: "1.00" },
    { id: randomUUID(), quantity: "1.00", unitPrice: "1.00001", subtotal: "1.00" },
    { id: randomUUID(), quantity: "1.00", unitPrice: "1.0000", subtotal: "1.001" },
  ];
  await withClient(async (client) => asActor(client, f.adminA, async () => {
    await client.query(
      `INSERT INTO public.invoice_items(id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
       VALUES($1,$2,$3,'raw numeric precision valid',1.2345,'un',1.0000,1.23)`,
      [precisionLineId, f.invoices[5].id, f.companyA],
    );
    for (const source of invalidSourceLines) {
      await assert.rejects(client.query(
        `INSERT INTO public.invoice_items(id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
         VALUES($1,$2,$3,'raw numeric precision invalid',$4,'un',$5,$6)`,
        [source.id, f.invoices[5].id, f.companyA, source.quantity, source.unitPrice, source.subtotal],
      ), (error: unknown) => pgErrorCode(error) === "P0001");
    }
  }));
  const rawSourceCheck = await withClient(async (client) => client.query(
    `SELECT id,empresa_id,quantity::text,unit_price::text,subtotal::text
       FROM public.invoice_items WHERE id=ANY($1::uuid[]) ORDER BY id`,
    [[precisionLineId, ...invalidSourceLines.map(({ id }) => id)]],
  ));
  assert.equal(rawSourceCheck.rows.length, 1);
  assert.equal(rawSourceCheck.rows[0].id, precisionLineId);
  assert.equal(rawSourceCheck.rows[0].empresa_id, f.companyA);
  assert.equal(rawSourceCheck.rows[0].quantity, "1.2345");
  assert.equal(rawSourceCheck.rows[0].unit_price, "1.0000");
  assert.equal(rawSourceCheck.rows[0].subtotal, "1.23");

  // Service-role source edits are authorized for this fixture; the unbounded
  // numeric CHECK constraints must still reject each original over-scale value.
  await withClient(async (client) => {
    await client.query("SET ROLE service_role");
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
    try {
      for (const [column, value] of [["quantity", "1.23456"], ["unit_price", "1.00001"], ["total_price", "1.001"]] as const) {
        await assert.rejects(client.query(`UPDATE public.authorized_order_items SET ${column}=$2 WHERE id=$1`, [f.orderItemBadScale, value]),
          (error: unknown) => pgErrorCode(error) === "23514");
      }
    } finally { await client.query("RESET ROLE"); }
  });
  const sourceOrderItemCheck = await withClient(async (client) => client.query(
    "SELECT quantity::text,unit_price::text,total_price::text,quantity_invoiced::text FROM public.authorized_order_items WHERE id=$1",
    [f.orderItemBadScale],
  ));
  assert.deepEqual(sourceOrderItemCheck.rows[0], { quantity: "1000", unit_price: "1", total_price: "1000", quantity_invoiced: "0.00" });
  checks.push("raw tenant-admin invoice-item INSERT preserves 1.2345, rejects 1.23456, price 1.00001 and subtotal 1.001 without rounded rows; AOI precision CHECKs reject the same over-scale sources without counter changes");

  await withClient(async (client) => asActor(client, f.adminA, async () => {
    await client.query(
      `INSERT INTO public.invoice_items(id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
       VALUES($1,$2,$3,'Ladrillo común', $4::numeric,'un',1,1.23)`,
      [trailingZeroLineId, f.invoices[5].id, f.companyA, "1.230000"],
    );
    const source = await client.query("SELECT quantity::text FROM public.invoice_items WHERE id=$1", [trailingZeroLineId]);
    assert.equal(source.rows[0].quantity, "1.230000");
    const applied = await createMatchForLine(client, f, 5, trailingZeroLineId, f.orderItemBadScale, "1.230000");
    assert.equal(applied.rows[0].result.ok, true);
  }));
  const trailingZeroPersisted = await withClient(async (client) => client.query(
    `SELECT l.quantity::text AS documented,m.quantity_matched::text AS matched,oi.quantity_invoiced::text AS invoiced
       FROM public.invoice_items l
       JOIN public.invoice_item_matches m ON m.invoice_item_id=l.id
       JOIN public.authorized_order_items oi ON oi.id=m.order_item_id
      WHERE l.id=$1`, [trailingZeroLineId],
  ));
  assert.deepEqual(trailingZeroPersisted.rows[0], { documented: "1.230000", matched: "1.230000", invoiced: "1.230000" });
  checks.push("real PostgreSQL accepts equivalent trailing-zero input 1.230000 end-to-end and preserves the source, match and derived counter scales exactly");

  const largeFraction = await withClient(async (client) => asActor(client, f.adminA, async () => {
    await client.query(
      "UPDATE public.authorized_order_items SET quantity=3000.0000,total_price=3000.00 WHERE id=$1",
      [f.orderItemPrecision],
    );
    const result = await client.query(
      "SELECT quantity::text,total_price::text,quantity_invoiced::text FROM public.authorized_order_items WHERE id=$1",
      [f.orderItemPrecision],
    );
    await client.query(
      "UPDATE public.authorized_order_items SET quantity=60.0000,total_price=60.00 WHERE id=$1",
      [f.orderItemPrecision],
    );
    return result;
  }));
  assert.deepEqual(largeFraction.rows[0], { quantity: "3000.0000", total_price: "3000.00", quantity_invoiced: "0.00" });
  checks.push("real PostgreSQL preserves 3000.0000 physical quantity and 3000.00 money scale, then restores the fixture before matching");

  const exactMatch = await withClient((client) => asActor(client, f.adminA, async () => {
    const created = await createMatchForLine(client, f, 5, precisionLineId, f.orderItemPrecision, "1.2345");
    assert.equal(created.rows[0].result.ok, true);
    const second = await createMatch(client, f, 6, f.orderItemPrecision, "0.0001");
    assert.equal(second.rows[0].result.ok, true);
    const correction = await client.query(
      "SELECT public.correct_invoice_item($1,$2,$3,$4,$5,$6,$7) AS result",
      [f.companyA, precisionLineId, "Ladrillo común", "1.2345", "un", "1.0000", "1.23"],
    );
    assert.equal(correction.rows[0].result.ok, true);
    await assert.rejects(client.query(
      "SELECT public.correct_invoice_item($1,$2,$3,$4,$5,$6,$7)",
      [f.companyA, precisionLineId, "Ladrillo común", "1.23456", "un", "1.0000", "1.23"],
    ), /4 decimales/i);
    return client.query(
      `SELECT oi.quantity::text AS ordered,oi.quantity_invoiced::text AS invoiced,
              (SELECT sum(m.quantity_matched)::text FROM public.invoice_item_matches m WHERE m.order_item_id=oi.id) AS matched,
              (SELECT sum(m.quantity_matched)::text FROM public.invoice_item_matches m WHERE m.invoice_item_id=$2) AS first_line_matched,
              (SELECT (l.quantity-coalesce(sum(m.quantity_matched),0))::text
                 FROM public.invoice_items l LEFT JOIN public.invoice_item_matches m ON m.invoice_item_id=l.id
                WHERE l.id=$3 GROUP BY l.quantity) AS second_line_remaining
         FROM public.authorized_order_items oi WHERE oi.id=$1`, [f.orderItemPrecision, precisionLineId, f.invoices[6].lineId],
    );
  }));
  assert.deepEqual(exactMatch.rows[0], { ordered: "60.0000", invoiced: "1.2346", matched: "1.2346", first_line_matched: "1.2345", second_line_remaining: "799.9999" });
  checks.push("real PostgreSQL preserves 60.0000, documents and matches 1.2345 exactly, keeps 799.9999 after a partial 0.0001 allocation, and rejects an over-scale correction atomically");

  const oneCent = await withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 5, f.orderItemPrecision, "0.01")));
  assert.equal(oneCent.rows[0].result.ok, true);
  await withClient(async (client) => asActor(client, f.adminA, async () => {
    await assert.rejects(createMatch(client, f, 5, f.orderItemBadScale, "0.00001"), /4 decimales/i);
    await assert.rejects(createMatch(client, f, 5, f.orderItemBadScale, "NaN"), /finito|num[eé]rico|cantidad/i);
    await assert.rejects(createMatch(client, f, 5, f.orderItemBadScale, "Infinity"), /finito|num[eé]rico|cantidad/i);
  }));
  const workerMatch = await withClient(async (client) => {
    await client.query("SET ROLE service_role");
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)");
    try { return await createMatch(client, f, 5, f.orderItemBadScale, "0.01"); }
    finally { await client.query("RESET ROLE"); }
  });
  assert.equal(workerMatch.rows[0].result.ok, true);
  const workerAudit = await withClient(async (client) => client.query(
    `SELECT empresa_id,actor_type,actor_label FROM public.audit_logs
      WHERE invoice_id=$1 AND action='invoice.item_matched' ORDER BY created_at DESC LIMIT 1`, [f.invoices[5].id],
  ));
  assert.equal(workerAudit.rows[0].empresa_id, f.companyA);
  assert.equal(workerAudit.rows[0].actor_type, "system");
  assert.equal(workerAudit.rows[0].actor_label, "invoice-reconciliation-worker");
  checks.push("exact 0.01 quantity accepted; fifth effective decimal, NaN and Infinity rejected; worker uses explicit tenant and attributed audit");

  // Atomic full deletion removes the invoice graph, item allocations, audit and exception rows together.
  await withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 7, f.orderItemDelete, "50")));
  const deletionAuditId = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO public.audit_logs(id,empresa_id,actor_id,actor_type,action,invoice_id,detail)
       VALUES($1,$2,$3,'internal','test.invoice.child',$4,'{}'::jsonb),
             ($5,NULL,NULL,'system','test.invoice.legacy',$4,'{}'::jsonb)`,
      [deletionAuditId, f.companyA, f.adminA, f.invoices[7].id, randomUUID()],
    );
    await client.query(
      `INSERT INTO public.invoice_exceptions(invoice_id,empresa_id,approved_by,reason,difference_amount,difference_pct)
       VALUES($1,$2,$3,'R3 fixture',1,0.01)`, [f.invoices[7].id, f.companyA, f.adminA],
    );
  });
  const deleteResult = await withClient((client) => asActor(client, f.adminA, () => client.query(
    "SELECT public.delete_invoice($1,$2) AS result", [f.companyA, f.invoices[7].id],
  )));
  assert.equal(deleteResult.rows[0].result.ok, true);
  assert.equal(deleteResult.rows[0].result.cleanup_bucket, null);
  assert.equal(deleteResult.rows[0].result.cleanup_path, null);
  const sharedAttachment = await withClient(async (client) => client.query("SELECT count(*)::int AS count FROM public.attachments WHERE id=$1", [f.sharedAttachmentId]));
  assert.equal(sharedAttachment.rows[0].count, 1, "shared attachment metadata must remain while another invoice references it");
  await withClient(async (client) => {
    await assert.rejects(client.query(
      "INSERT INTO public.attachments(id,bucket,path,file_name,empresa_id) VALUES($1,'invoice-files',$2,'duplicate.pdf',$3)",
      [randomUUID(), `${f.companyA}/shared.pdf`, f.companyA],
    ), (error: unknown) => pgErrorCode(error) === "23505");
  });
  const deletedGraph = await withClient(async (client) => client.query(
    `SELECT (SELECT count(*)::int FROM public.invoices WHERE id=$1) AS invoice_count,
            (SELECT count(*)::int FROM public.invoice_items WHERE invoice_id=$1) AS line_count,
            (SELECT count(*)::int FROM public.invoice_order_matches WHERE invoice_id=$1) AS link_count,
            (SELECT count(*)::int FROM public.invoice_item_matches WHERE invoice_item_id=$2) AS match_count,
            (SELECT count(*)::int FROM public.invoice_exceptions WHERE invoice_id=$1) AS exception_count,
            (SELECT count(*)::int FROM public.audit_logs WHERE invoice_id=$1) AS audit_count,
            (SELECT quantity_invoiced FROM public.authorized_order_items WHERE id=$3) AS invoiced`,
    [f.invoices[7].id, f.invoices[7].lineId, f.orderItemDelete],
  ));
  assert.deepEqual(deletedGraph.rows[0], { invoice_count: 0, line_count: 0, link_count: 0, match_count: 0, exception_count: 0, audit_count: 0, invoiced: "0.00" });
  const exclusiveDelete = await withClient((client) => asActor(client, f.adminA, () => client.query(
    "SELECT public.delete_invoice($1,$2) AS result", [f.companyA, f.invoices[8].id],
  )));
  assert.equal(exclusiveDelete.rows[0].result.cleanup_bucket, "invoice-files");
  assert.equal(exclusiveDelete.rows[0].result.cleanup_path, `${f.companyA}/shared.pdf`);
  const removedAttachment = await withClient(async (client) => client.query("SELECT count(*)::int AS count FROM public.attachments WHERE id=$1", [f.sharedAttachmentId]));
  assert.equal(removedAttachment.rows[0].count, 0, "exclusive attachment metadata should be removed atomically");
  const forgedCleanup = await withClient(async (client) => {
    const unsafeBucket = await asActor(client, f.adminA, () => client.query("SELECT public.delete_invoice($1,$2) AS result", [f.companyA, f.invoices[9].id]));
    const foreignPrefix = await asActor(client, f.adminA, () => client.query("SELECT public.delete_invoice($1,$2) AS result", [f.companyA, f.invoices[10].id]));
    return [unsafeBucket.rows[0].result, foreignPrefix.rows[0].result];
  });
  assert.ok(forgedCleanup.every((result) => result.ok && result.cleanup_bucket === null && result.cleanup_path === null), "untrusted bucket or another tenant's path must never be returned for physical cleanup");
  const providerScopedCleanup = await withClient((client) => asActor(client, f.adminA, () => client.query(
    "SELECT public.delete_invoice($1,$2) AS result", [f.companyA, f.invoices[11].id],
  )));
  assert.equal(providerScopedCleanup.rows[0].result.cleanup_bucket, "invoice-files");
  assert.equal(providerScopedCleanup.rows[0].result.cleanup_path, `${f.providerA}/provider.pdf`);
  const noAttachmentDelete = await withClient((client) => asActor(client, f.adminB, () => client.query(
    "SELECT public.delete_invoice($1,$2) AS result", [f.companyB, f.invoiceB.id],
  )));
  assert.equal(noAttachmentDelete.rows[0].result.ok, true);
  assert.equal(noAttachmentDelete.rows[0].result.cleanup_bucket, null);
  assert.equal(noAttachmentDelete.rows[0].result.cleanup_path, null);
  checks.push("delete_invoice atomically removes editable invoice graphs/audit rows with and without attachments, preserves shared attachments, returns only the final safe company/provider-scoped storage object, denies forged bucket/prefix cleanup, and duplicate physical metadata paths are blocked by the unique index");

  // Two different invoices race for the same 1,000-unit order item. Exactly one 800-unit allocation can commit.
  const raceResults = await Promise.all([
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 0, f.orderItemA, "800")))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 1, f.orderItemA, "800")))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
  ]);
  assert.equal(raceResults.filter((r) => r.ok).length, 1, "exactly one overbooked allocation should win");
  assert.equal(raceResults.filter((r) => !r.ok).length, 1, "exactly one overbooked allocation should fail");
  const raceFailure = raceResults.find((r) => !r.ok);
  assert.ok(raceFailure && !raceFailure.ok && /remanente/i.test(String(raceFailure.error)), "losing transaction should fail on the refreshed order remainder");
  const orderTotal = await withClient(async (client) => client.query("SELECT quantity_invoiced FROM public.authorized_order_items WHERE id=$1", [f.orderItemA]));
  assert.equal(Number(orderTotal.rows[0].quantity_invoiced), 800);
  checks.push("concurrent different-invoice allocation serializes at the order item and preserves the 1,000 cap");

  const fractionalRace = await Promise.all([
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 12, f.orderItemFractionalRace, "0.0001")))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 13, f.orderItemFractionalRace, "0.0001")))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
  ]);
  assert.equal(fractionalRace.filter((result) => result.ok).length, 1);
  assert.equal(fractionalRace.filter((result) => !result.ok).length, 1);
  const fractionalRaceState = await withClient((client) => client.query(
    `SELECT oi.quantity::text AS ordered,oi.quantity_invoiced::text AS invoiced,
            coalesce(sum(m.quantity_matched),0)::text AS matched,count(m.id)::int AS matches
       FROM public.authorized_order_items oi LEFT JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
      WHERE oi.id=$1 GROUP BY oi.id`, [f.orderItemFractionalRace],
  ));
  assert.deepEqual(fractionalRaceState.rows[0], { ordered: "0.0001", invoiced: "0.0001", matched: "0.0001", matches: 1 });
  checks.push("two real PostgreSQL invoice sessions racing for the final 0.0001 OC remainder commit exactly one match and preserve the exact counter");

  const fractionalLineRace = await Promise.all([
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 14, f.orderItemFractionalLineRaceA, "0.0001")))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 14, f.orderItemFractionalLineRaceB, "0.0001")))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })),
  ]);
  assert.equal(fractionalLineRace.filter((result) => result.ok).length, 1);
  assert.equal(fractionalLineRace.filter((result) => !result.ok).length, 1);
  const fractionalLineRaceState = await withClient((client) => client.query(
    `SELECT l.quantity::text AS documented,
            coalesce(sum(m.quantity_matched),0)::text AS matched,
            (l.quantity-coalesce(sum(m.quantity_matched),0))::text AS remaining,
            count(m.id)::int AS matches
       FROM public.invoice_items l LEFT JOIN public.invoice_item_matches m ON m.invoice_item_id=l.id
      WHERE l.id=$1 GROUP BY l.id`, [f.invoices[14].lineId],
  ));
  assert.deepEqual(fractionalLineRaceState.rows[0], { documented: "0.0001", matched: "0.0001", remaining: "0.0000", matches: 1 });
  checks.push("two real PostgreSQL imputations racing for one documented 0.0001 quantity serialize at the source line; only one persists and the exact line remainder is zero");

  // Same request concurrently is idempotent and returns the same match id.
  const idem = await Promise.all([
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 2, f.orderItemIdem, "800"))),
    withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 2, f.orderItemIdem, "800"))),
  ]);
  assert.ok(idem.every((r) => r.rows[0]?.result?.ok === true));
  assert.equal(idem[0].rows[0].result.match_id, idem[1].rows[0].result.match_id);
  assert.equal(idem.filter((r) => r.rows[0].result.duplicate === true).length, 1);
  const idempotencyRows = await withClient(async (client) => client.query("SELECT count(*)::int AS count FROM public.invoice_item_matches WHERE invoice_item_id=$1", [f.invoices[2].lineId]));
  assert.equal(idempotencyRows.rows[0].count, 1);
  checks.push("concurrent retry of identical request is idempotent and creates one match");

  // Exercise the AOI child-first UPDATE trigger against the RPC parent-first locking protocol.
  // A real PostgreSQL deadlock is acceptable only as a bounded 40P01 abort; final source counters must converge.
  const deadlockClient = db();
  const rpcClient = db();
  await Promise.all([deadlockClient.connect(), rpcClient.connect()]);
  let deadlockTransactionOpen = false;
  try {
    await Promise.all([deadlockClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'; RESET request.jwt.claim.role"), rpcClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'")]);
    await deadlockClient.query("BEGIN");
    deadlockTransactionOpen = true;
    await deadlockClient.query("SELECT id FROM public.authorized_order_items WHERE id=$1 FOR UPDATE", [f.orderItemDeadlock]);
    const rpcPid = (await rpcClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const allocation = asActor(rpcClient, f.adminA, () => createMatch(rpcClient, f, 6, f.orderItemDeadlock, "100"))
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
    await waitUntilBlocked(deadlockClient, rpcPid);
    const sourceEdit = deadlockClient.query("UPDATE public.authorized_order_items SET unit_price=unit_price WHERE id=$1", [f.orderItemDeadlock])
      .then(async () => {
        await deadlockClient.query("COMMIT");
        deadlockTransactionOpen = false;
        return { ok: true as const };
      }, async (error) => {
        await deadlockClient.query("ROLLBACK").catch(() => undefined);
        deadlockTransactionOpen = false;
        return { ok: false as const, error };
      });
    const [allocationResult, editResult] = await Promise.all([allocation, sourceEdit]);
    const outcomes = [allocationResult, editResult];
    assert.ok(outcomes.every((outcome) => outcome.ok || ("error" in outcome && pgErrorCode(outcome.error) === "40P01")), "only success or bounded PostgreSQL deadlock abort is allowed");
    assert.ok(outcomes.some((outcome) => outcome.ok), "one side of contention must make progress");
  } finally {
    if (deadlockTransactionOpen) await deadlockClient.query("ROLLBACK").catch(() => undefined);
    await Promise.all([deadlockClient.end(), rpcClient.end()]);
  }
  const deadlockInvariant = await withClient(async (client) => client.query(
    `SELECT oi.quantity,oi.quantity_invoiced,coalesce(sum(m.quantity_matched),0) AS matched
       FROM public.authorized_order_items oi LEFT JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
      WHERE oi.id=$1 GROUP BY oi.id`, [f.orderItemDeadlock],
  ));
  assert.equal(Number(deadlockInvariant.rows[0].quantity_invoiced), Number(deadlockInvariant.rows[0].matched));
  assert.ok(Number(deadlockInvariant.rows[0].quantity_invoiced) <= Number(deadlockInvariant.rows[0].quantity));
  checks.push("source-row edit vs parent-first allocation contention converges, with PostgreSQL 40P01 bounded abort allowed");

  // A correction that fails after its UPDATE must roll back both the line and the cached order counter.
  await withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 2, f.orderItemIdem, "800")));
  const before = await withClient(async (client) => client.query("SELECT product_description,quantity FROM public.invoice_items WHERE id=$1", [f.invoices[2].lineId]));
  await withClient(async (client) => asActor(client, f.adminA, async () => {
    await assert.rejects(
      client.query("SELECT public.correct_invoice_item($1,$2,$3,$4,$5,$6,$7)", [f.companyA, f.invoices[2].lineId, "Ladrillo común", 799, "un", 1, 799]),
      /sobre-imputada/,
    );
  }));
  const after = await withClient(async (client) => client.query("SELECT product_description,quantity FROM public.invoice_items WHERE id=$1", [f.invoices[2].lineId]));
  assert.deepEqual(after.rows[0], before.rows[0]);
  checks.push("financial correction failure rolls back source line and its matches");

  // Deterministic create-vs-unmatch lock ordering: create queues first while the invoice is locked;
  // unmatch follows it. After release both succeed in order and leave no header or child allocation.
  await withClient(async (holder) => {
    const createClient = db();
    const unmatchClient = db();
    let holderTransactionOpen = false;
    try {
      await holder.query("BEGIN");
      holderTransactionOpen = true;
      await holder.query("SELECT id FROM public.invoices WHERE id=$1 FOR UPDATE", [f.invoices[3].id]);
      await Promise.all([createClient.connect(), unmatchClient.connect()]);
      await Promise.all([createClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'"), unmatchClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'")]);
      const createPid = (await createClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const unmatchPid = (await unmatchClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const createPromise = asActor(createClient, f.adminA, () => createMatch(createClient, f, 3, f.orderItemUnmatch, "100"))
        .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      await waitUntilBlocked(holder, createPid);
      const unmatchPromise = asActor(unmatchClient, f.adminA, () => unmatchClient.query(
        "SELECT public.unmatch_invoice_order($1,$2,$3,$4) AS result",
        [f.companyA, f.invoices[3].id, f.invoices[3].linkId, f.orderA],
      )).then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      await waitUntilBlocked(holder, unmatchPid);
      await holder.query("COMMIT");
      holderTransactionOpen = false;
      const [created, unmatched] = await Promise.all([createPromise, unmatchPromise]);
      assert.ok(created.ok, "queued create should complete before header unmatch");
      assert.ok(unmatched.ok, "queued unmatch should complete after create");
      assert.equal(unmatched.value.rows[0].result.deleted_item_matches, 1);
    } finally {
      if (holderTransactionOpen) await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all([createClient.end(), unmatchClient.end()]);
    }
  });
  const unmatchState = await withClient(async (client) => client.query(
    `SELECT (SELECT count(*)::int FROM public.invoice_order_matches WHERE invoice_id=$1) AS links,
            (SELECT count(*)::int FROM public.invoice_item_matches WHERE invoice_item_id=$2) AS matches,
            (SELECT quantity_invoiced FROM public.authorized_order_items WHERE id=$3) AS invoiced`,
    [f.invoices[3].id, f.invoices[3].lineId, f.orderItemUnmatch],
  ));
  assert.equal(unmatchState.rows[0].links, 0);
  assert.equal(unmatchState.rows[0].matches, 0);
  assert.equal(Number(unmatchState.rows[0].invoiced), 0);
  checks.push("create racing with header unmatch serializes and clears child allocation before dropping the link");

  // Approval gets the invoice lock first. A queued create must observe the settled state and fail closed.
  await withClient(async (holder) => {
    const approveClient = db();
    const createClient = db();
    let holderTransactionOpen = false;
    try {
      await holder.query("BEGIN");
      holderTransactionOpen = true;
      await holder.query("SELECT id FROM public.invoices WHERE id=$1 FOR UPDATE", [f.invoices[4].id]);
      await Promise.all([approveClient.connect(), createClient.connect()]);
      await Promise.all([approveClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'"), createClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'")]);
      const approvePid = (await approveClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const createPid = (await createClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const approve = asActor(approveClient, f.adminA, () => approveClient.query("SELECT public.mark_invoice_apto_para_pago($1)", [f.invoices[4].id]))
        .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      await waitUntilBlocked(holder, approvePid);
      const create = asActor(createClient, f.adminA, () => createMatch(createClient, f, 4, f.orderItemApproval, "100"))
        .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      await waitUntilBlocked(holder, createPid);
      await holder.query("UPDATE public.invoices SET status='MATCH' WHERE id=$1", [f.invoices[4].id]);
      await holder.query("COMMIT");
      holderTransactionOpen = false;
      const [approveResult, createResult] = await Promise.all([approve, create]);
      assert.ok(approveResult.ok, "queued approval should complete");
      assert.ok(!createResult.ok && /congelada/.test(String(createResult.error)));
    } finally {
      if (holderTransactionOpen) await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all([approveClient.end(), createClient.end()]);
    }
  });
  const approvalState = await withClient(async (client) => client.query("SELECT status::text FROM public.invoices WHERE id=$1", [f.invoices[4].id]));
  assert.equal(approvalState.rows[0].status, "APTO_PARA_PAGO");
  checks.push("approval lock wins over queued create; settled invoice cannot receive a new allocation");

  // Serialize full invoice deletion against payment execution using the shared OP -> invoice lock order.
  const paymentOrderId = randomUUID();
  await withClient(async (client) => {
    await client.query("INSERT INTO public.payment_orders(id,empresa_id,code,provider_id,status,created_by) VALUES($1,$2,$3,$4,'EMITIDA',$5)", [paymentOrderId, f.companyA, `R3-OP-${paymentOrderId}`, f.providerA, f.adminA]);
    await client.query("INSERT INTO public.payment_order_invoices(empresa_id,payment_order_id,invoice_id) VALUES($1,$2,$3)", [f.companyA, paymentOrderId, f.invoices[4].id]);
  });
  await withClient(async (holder) => {
    const deleteClient = db();
    const executeClient = db();
    let holderTransactionOpen = false;
    let deleteConnected = false;
    let executeConnected = false;
    let deleting: Promise<{ ok: true; value: QueryResult } | { ok: false; error: unknown }> | undefined;
    let executing: Promise<{ ok: true; value: QueryResult } | { ok: false; error: unknown }> | undefined;
    try {
      await holder.query("BEGIN");
      holderTransactionOpen = true;
      await holder.query("SELECT id FROM public.payment_orders WHERE id=$1 FOR UPDATE", [paymentOrderId]);
      await Promise.all([deleteClient.connect(), executeClient.connect()]);
      deleteConnected = true;
      executeConnected = true;
      await Promise.all([deleteClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'"), executeClient.query("SET statement_timeout='15s'; SET lock_timeout='8s'")]);
      const deletePid = (await deleteClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const executePid = (await executeClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      deleting = asActor(deleteClient, f.adminA, () => deleteClient.query("SELECT public.delete_invoice($1,$2)", [f.companyA, f.invoices[4].id]))
        .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      await waitUntilBlocked(holder, deletePid);
      executing = asActor(executeClient, f.adminA, () => executeClient.query(
        "SELECT public.ejecutar_orden_pago_atomica($1,$2,NULL,$3)", [f.companyA, paymentOrderId, f.adminA],
      )).then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
      await waitUntilBlocked(holder, executePid);
      await holder.query("COMMIT");
      holderTransactionOpen = false;
      const [deleteOutcome, executeOutcome] = await Promise.all([deleting, executing]);
      assert.ok(!deleteOutcome.ok && pgErrorCode(deleteOutcome.error) === "55000", "delete must reject the now payable invoice atomically");
      assert.ok(executeOutcome.ok, "the queued payment execution should complete after delete rollback");
    } finally {
      if (holderTransactionOpen) await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all([deleting, executing].filter((promise): promise is NonNullable<typeof promise> => promise !== undefined));
      await Promise.all([
        ...(deleteConnected ? [deleteClient.end()] : []),
        ...(executeConnected ? [executeClient.end()] : []),
      ]);
    }
  });
  const paidInvoice = await withClient(async (client) => client.query(
    `SELECT i.status::text AS invoice_status,po.status AS op_status,
            (SELECT count(*)::int FROM public.payment_order_invoices WHERE payment_order_id=$2) AS link_count
       FROM public.invoices i JOIN public.payment_orders po ON po.id=$2 WHERE i.id=$1`,
    [f.invoices[4].id, paymentOrderId],
  ));
  assert.deepEqual(paidInvoice.rows[0], { invoice_status: "PAGADO", op_status: "EJECUTADA", link_count: 1 });
  checks.push("concurrent delete vs payment execution serializes OP-first; delete rollback preserves a payable invoice for successful execution");

  const finalInvariant = await withClient(async (client) => client.query(
    `SELECT oi.quantity,oi.quantity_invoiced,coalesce(sum(m.quantity_matched),0) AS matched
       FROM public.authorized_order_items oi LEFT JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
      WHERE oi.id=$1 GROUP BY oi.id`, [f.orderItemA],
  ));
  assert.ok(Number(finalInvariant.rows[0].quantity_invoiced) <= Number(finalInvariant.rows[0].quantity));
  assert.equal(Number(finalInvariant.rows[0].quantity_invoiced), Number(finalInvariant.rows[0].matched));
  console.log(JSON.stringify({ status: "PASS", postgresMajor: 17, checks }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
