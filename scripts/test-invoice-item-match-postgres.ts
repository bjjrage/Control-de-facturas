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
  orderA: string;
  orderItemA: string;
  orderItemIdem: string;
  orderItemUnmatch: string;
  orderItemApproval: string;
  orderItemPrecision: string;
  orderItemBadScale: string;
  orderItemDeadlock: string;
  orderItemDelete: string;
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
  const orderItemDeadlock = randomUUID();
  const orderItemDelete = randomUUID();
  const invoices = Array.from({ length: 8 }, () => ({ id: randomUUID(), lineId: randomUUID(), linkId: randomUUID() }));
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
         VALUES ($1,$3,'R3-A','R3 supplier A','Ladrillo común',1000,'un',10,10000,'PYG',false,$5,true,$7,'manual'),
                ($2,$4,'R3-B','R3 supplier B','Ladrillo común',1000,'un',10,10000,'PYG',false,$6,true,$8,'manual')`,
        [orderA, orderB, providerA, providerB, adminA, adminB, companyA, companyB],
      );
      await client.query(
        `INSERT INTO public.authorized_order_items (id,order_id,empresa_id,product,quantity,unit,unit_price,total_price)
         VALUES ($1,$3,$5,'Ladrillo común',1000,'un',1,1000),($2,$4,$6,'Ladrillo común',1000,'un',1,1000),
                ($7,$3,$5,'Ladrillo común',1000,'un',1,1000),($8,$3,$5,'Ladrillo común',1000,'un',1,1000),($9,$3,$5,'Ladrillo común',1000,'un',1,1000),
                ($10,$3,$5,'Ladrillo común',1000,'un',1,1000),($11,$3,$5,'Ladrillo común',1000,'un',1,1000),($12,$3,$5,'Ladrillo común',1000,'un',1,1000),($13,$3,$5,'Ladrillo común',1000,'un',1,1000)`,
        [orderItemA, orderItemB, orderA, orderB, companyA, companyB, orderItemIdem, orderItemUnmatch, orderItemApproval, orderItemPrecision, orderItemBadScale, orderItemDeadlock, orderItemDelete],
      );
      for (const [index, inv] of invoices.entries()) {
        await client.query(
          `INSERT INTO public.invoices (id,provider_id,invoice_number,invoice_date,currency,total,created_by,empresa_id,status)
           VALUES ($1,$2,$3,CURRENT_DATE,'PYG',800,$4,$5,$6::public.invoice_status)`,
          [inv.id, providerA, `R3-${index}`, adminA, companyA, index === 4 ? "MATCH" : "PENDIENTE"],
        );
        await client.query(
          `INSERT INTO public.invoice_items (id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
           VALUES ($1,$2,$3,'Ladrillo común',800,'un',1,800)`,
          [inv.lineId, inv.id, companyA],
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return { companyA, companyB, adminA, adminB, commercialA, providerA, orderA, orderItemA, orderItemIdem, orderItemUnmatch, orderItemApproval, orderItemPrecision, orderItemBadScale, orderItemDeadlock, orderItemDelete, invoices, invoiceB };
}

async function createMatch(client: Client, f: Fixture, invoiceIndex: number, orderItemId: string, qty: string) {
  const inv = f.invoices[invoiceIndex];
  return client.query(
    "SELECT public.create_invoice_item_match($1,$2,$3,$4,$5,$6) AS result",
    [f.companyA, inv.id, f.orderA, inv.lineId, orderItemId, qty],
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
    [["create_invoice_item_match", "correct_invoice_item", "unmatch_invoice_order", "delete_invoice_item", "delete_invoice_item_match", "delete_invoice"]],
  ));
  const argsByRpc = Object.fromEntries(rpcArguments.rows.map((row) => [row.proname, row.proargnames]));
  assert.deepEqual(argsByRpc.create_invoice_item_match, ["p_empresa_id", "p_invoice_id", "p_expected_order_id", "p_invoice_item_id", "p_order_item_id", "p_quantity"]);
  assert.deepEqual(argsByRpc.correct_invoice_item, ["p_empresa_id", "p_invoice_item_id", "p_description", "p_quantity", "p_unit", "p_unit_price", "p_subtotal"]);
  assert.deepEqual(argsByRpc.unmatch_invoice_order, ["p_empresa_id", "p_invoice_id", "p_expected_match_id", "p_expected_order_id"]);
  assert.deepEqual(argsByRpc.delete_invoice_item, ["p_empresa_id", "p_invoice_id", "p_invoice_item_id"]);
  assert.deepEqual(argsByRpc.delete_invoice_item_match, ["p_empresa_id", "p_invoice_id", "p_invoice_item_match_id"]);
  assert.deepEqual(argsByRpc.delete_invoice, ["p_empresa_id", "p_invoice_id"]);
  const f = await seed();

  // Tenant boundary, role boundary, anon privilege, and direct-write privilege.
  await withClient(async (client) => {
    await asActor(client, f.adminB, async () => {
      await assert.rejects(createMatch(client, f, 0, f.orderItemA, "10"), (error: unknown) => pgErrorCode(error) === "42501");
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
  checks.push("tenant isolation, unauthorized role, anon EXECUTE, and direct match write denied");

  // Exact numeric precision, non-finite rejection, and worker audit attribution.
  const oneCent = await withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 5, f.orderItemPrecision, "0.01")));
  assert.equal(oneCent.rows[0].result.ok, true);
  await withClient(async (client) => asActor(client, f.adminA, async () => {
    await assert.rejects(createMatch(client, f, 5, f.orderItemBadScale, "0.001"), /precisi|cent[eé]sima|redonde|mayor a cero/i);
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
  checks.push("exact 0.01 quantity accepted; 0.001, NaN, Infinity rejected; worker uses explicit tenant and attributed audit");

  // Atomic full deletion removes the invoice graph, item allocations, audit and exception rows together.
  await withClient((client) => asActor(client, f.adminA, () => createMatch(client, f, 7, f.orderItemDelete, "50")));
  const deletionAuditId = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO public.audit_logs(id,empresa_id,actor_id,actor_type,action,invoice_id,detail)
       VALUES($1,$2,$3,'internal','test.invoice.child',$4,'{}'::jsonb)`,
      [deletionAuditId, f.companyA, f.adminA, f.invoices[7].id],
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
  checks.push("delete_invoice atomically removes editable invoice graph, exceptions, audit rows and derived counters");

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
