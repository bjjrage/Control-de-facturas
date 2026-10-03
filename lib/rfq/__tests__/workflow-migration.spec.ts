import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { fixture, E, U, V, V2 } from "./db-fixture";
describe("RFQ 2 atomic workflow against baseline table definitions", () => {
  let db: PGlite;
  let rfq: string,
    item: string,
    token: string,
    token2: string,
    v: string,
    vi: string,
    vi2: string,
    allocation: string,
    hash: string;
  const call = async (name: string, args: unknown[]) => {
    const placeholders = args.map((_, i) => "$" + (i + 1)).join(",");
    const result = await db.query<{ result: any }>(
      `SELECT public.${name}(${placeholders}) AS result`,
      args,
    );
    return result.rows[0].result;
  };
  beforeAll(async () => {
    db = await fixture();
  }, 60000);
  afterAll(async () => {
    await db?.close();
  });
  it("purpose has no default, historical null allowed; new NULL rejected", async () => {
    const result = await db.query<{
      column_default: string | null;
      is_nullable: string;
    }>(
      `SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='rfqs' AND column_name='purpose'`,
    );
    expect(result.rows[0]).toEqual({
      column_default: null,
      is_nullable: "YES",
    });
    await expect(
      call("rfq_create", [
        JSON.stringify({ product: "Test" }),
        JSON.stringify([{ descripcion: "A", cantidad: 10, unidad: "un" }]),
        [],
      ]),
    ).rejects.toThrow(/purpose/);
  });
  it("fresh schema provisions private RFQ buckets with original document formats", async () => {
    const rows = await db.query<{
      id: string;
      public: boolean;
      allowed_mime_types: string[];
    }>(`SELECT id,public,allowed_mime_types FROM storage.buckets ORDER BY id`);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => !r.public)).toBe(true);
    expect(
      rows.rows.find((r) => r.id === "quote-pdfs")!.allowed_mime_types,
    ).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
  it("RFQ codes are unique within empresa, rather than globally across tenants", async () => {
    const rows = await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='rfqs_empresa_code_key'`,
    );
    expect(rows.rows[0].definition).toBe("UNIQUE (empresa_id, code)");
    expect(
      (
        await db.query(
          `SELECT oid FROM pg_constraint WHERE conname='rfqs_code_key'`,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("creates explicit PROCUREMENT with canonical items/providers", async () => {
    const r = await call("rfq_create", [
      JSON.stringify({ purpose: "PROCUREMENT", product: "Test" }),
      JSON.stringify([{ descripcion: "A", cantidad: 10, unidad: "un" }]),
      [V, V2],
    ]);
    rfq = r.id;
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM public.rfq_items WHERE rfq_id=$1`,
      [rfq],
    );
    item = rows.rows[0].id;
    const links = await db.query<{ token: string; provider_id: string }>(
      `SELECT token,provider_id FROM public.rfq_providers WHERE rfq_id=$1`,
      [rfq],
    );
    token = links.rows.find((x) => x.provider_id === V)!.token;
    token2 = links.rows.find((x) => x.provider_id === V2)!.token;
    expect(links.rows).toHaveLength(2);
  });
  const submit = async (t: string, price = 100, itemId = item) => {
    const link = await db.query<{ id: string }>(
      `SELECT id FROM public.rfq_providers WHERE token=$1`,
      [t],
    );
    const doc = await db.query<{ id: string }>(
      `INSERT INTO public.attachments(empresa_id,bucket,path,file_name,rfq_provider_id) VALUES($1,'quote-pdfs',gen_random_uuid()::text,'original.pdf',$2) RETURNING id`,
      [E, link.rows[0].id],
    );
    return call("rfq_submit_version", [
      t,
      JSON.stringify({
        budget_number: "Q",
        currency: "PYG",
        vat_included: false,
        invoice_available: true,
        valid_until: "2099-01-01T00:00:00Z",
        freight: 20,
        payment_terms: "30 days",
      }),
      JSON.stringify([
        {
          rfq_item_id: itemId,
          precio_unitario: price,
          available_quantity: 10,
          tax_rate: 10,
          lead_time_days: 5,
        },
      ]),
      doc.rows[0].id,
      null,
    ]);
  };
  it("requires original evidence and rejects invalid tokens", async () => {
    await expect(
      call("rfq_submit_version", ["invalid", "{}", "[]", null, null]),
    ).rejects.toThrow(/Link/);
    await expect(
      call("rfq_submit_version", [token, "{}", "[]", null, null]),
    ).rejects.toThrow(/Documento/);
  });
  it("appends versions, never overwrites, totals include explicit tax/freight", async () => {
    const first = await submit(token);
    const second = await submit(token, 90);
    v = second.versionId;
    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);
    expect(second.totalPrice).toBe(1010);
    await expect(
      db.query(`UPDATE public.quote_versions SET total_price=1 WHERE id=$1`, [
        v,
      ]),
    ).rejects.toThrow(/inmutable/);
    vi = (
      await db.query<{ id: string }>(
        `SELECT id FROM public.quote_version_items WHERE quote_version_id=$1`,
        [v],
      )
    ).rows[0].id;
    const b = await submit(token2, 95);
    vi2 = (
      await db.query<{ id: string }>(
        `SELECT id FROM public.quote_version_items WHERE quote_version_id=$1`,
        [b.versionId],
      )
    ).rows[0].id;
  });
  it("allocation rejects unreviewed quotes", async () => {
    await expect(
      call("rfq_save_allocation", [
        rfq,
        JSON.stringify([{ quote_version_item_id: vi, quantity: 5 }]),
        "Human justification",
        0,
      ]),
    ).rejects.toThrow(/revisión/);
    for (const qvi of [vi, vi2]) {
      const row = await db.query<{ quote_version_id: string }>(
        `SELECT quote_version_id FROM public.quote_version_items WHERE id=$1`,
        [qvi],
      );
      await call("rfq_review_quote", [
        row.rows[0].quote_version_id,
        "{}",
        "{}",
        "Human checked original document",
      ]);
    }
  });
  it("rejects negative and overallocated quantities", async () => {
    await expect(
      call("rfq_save_allocation", [
        rfq,
        JSON.stringify([{ quote_version_item_id: vi, quantity: -1 }]),
        "Human justification",
        0,
      ]),
    ).rejects.toThrow(/incompleta/);
    await expect(
      call("rfq_save_allocation", [
        rfq,
        JSON.stringify([
          { quote_version_item_id: vi, quantity: 6 },
          { quote_version_item_id: vi2, quantity: 6 },
        ]),
        "Human justification",
        0,
      ]),
    ).rejects.toThrow(/Sobreasignación/);
  });
  it("human allocation alone does not create any orders; prices are DB factual", async () => {
    const a = await call("rfq_save_allocation", [
      rfq,
      JSON.stringify([
        { quote_version_item_id: vi, quantity: 4, unit_price: 1 },
        { quote_version_item_id: vi2, quantity: 5 },
      ]),
      "Human partial split decision",
      0,
    ]);
    allocation = a.id;
    expect(a.lines[0].unit_price).toBe(90);
    expect(
      (await db.query(`SELECT * FROM public.authorized_orders`)).rows,
    ).toHaveLength(0);
  });
  it("authorization requires explicit confirmation, no orders", async () => {
    await expect(call("rfq_preview_orders", [allocation])).rejects.toThrow(
      /autorizada/,
    );
    await expect(
      call("rfq_authorize_allocation", [allocation, false]),
    ).rejects.toThrow(/humana/);
    await call("rfq_authorize_allocation", [allocation, true]);
    expect(
      (await db.query(`SELECT * FROM public.authorized_orders`)).rows,
    ).toHaveLength(0);
  });
  it("preview is exact, no orders and confirmation rejects changed hash", async () => {
    const p = await call("rfq_preview_orders", [allocation]);
    hash = p.hash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const persisted = await db.query<{ hash: string }>(
      `SELECT encode(extensions.digest(convert_to(preview::text,'UTF8'),'sha256'),'hex') AS hash FROM public.rfq_allocations WHERE id=$1`,
      [allocation],
    );
    expect(persisted.rows[0].hash).toBe(hash);
    expect(p.orders).toHaveLength(2);
    expect(
      p.orders.map((o: any) => o.total).sort((a: number, b: number) => a - b),
    ).toEqual([416, 542.5]);
    expect(
      (await db.query(`SELECT * FROM public.authorized_orders`)).rows,
    ).toHaveLength(0);
    await expect(
      call("rfq_confirm_orders", [allocation, "tampered", true]),
    ).rejects.toThrow(/Preview/);
    await expect(
      call("rfq_confirm_orders", [allocation, hash, false]),
    ).rejects.toThrow(/humana/);
  });
  it("creates 1..N orders exactly once with quote-line provenance", async () => {
    const confirmed = await call("rfq_confirm_orders", [
      allocation,
      hash,
      true,
    ]);
    expect(confirmed.orderIds).toHaveLength(2);
    const again = await call("rfq_confirm_orders", [allocation, hash, true]);
    expect(again.alreadyConfirmed).toBe(true);
    const rows = await db.query(
      `SELECT * FROM public.authorized_orders WHERE rfq_id=$1`,
      [rfq],
    );
    expect(rows.rows).toHaveLength(2);
    const lines = await db.query(
      `SELECT quote_version_item_id,quantity FROM public.authorized_order_items`,
    );
    expect(lines.rows).toHaveLength(2);
  });
  it("COST_DISCOVERY cannot allocate or create OC; old shortcut disabled", async () => {
    const r = await call("rfq_create", [
      JSON.stringify({ purpose: "COST_DISCOVERY", product: "Discover" }),
      JSON.stringify([{ descripcion: "A", cantidad: 10, unidad: "un" }]),
      [V],
    ]);
    await expect(
      call("rfq_save_allocation", [
        r.id,
        JSON.stringify([{ quote_version_item_id: vi, quantity: 1 }]),
        "Human justification",
        0,
      ]),
    ).rejects.toThrow(/compra/);
    await expect(
      call("select_and_authorize_offer_atomically", [
        E,
        U,
        rfq,
        V,
        v,
        null,
        null,
      ]),
    ).rejects.toThrow(/RFQ 2.0/);
    const seeded = await db.query<{ id: string }>(
      `INSERT INTO public.rfq_allocations(empresa_id,rfq_id,revision,lines,justification,created_by,authorized_by,authorized_at,preview,preview_hash)
       VALUES($1,$2,1,'[]'::jsonb,'Synthetic adversarial row',$3,$3,now(),'[]'::jsonb,'forged') RETURNING id`,
      [E, r.id, U],
    );
    const forgedAllocation = seeded.rows[0].id;
    await expect(
      call("rfq_authorize_allocation", [forgedAllocation, true]),
    ).rejects.toThrow(/compra/);
    await expect(
      call("rfq_preview_orders", [forgedAllocation]),
    ).rejects.toThrow(/compra/);
    await expect(
      call("rfq_confirm_orders", [forgedAllocation, "forged", true]),
    ).rejects.toThrow(/compra/);
  });
  it("tenant isolation, anonymous mutation denied, supplier RPC inaccessible", async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','',false);`);
    await expect(call("rfq_preview_orders", [allocation])).rejects.toThrow(
      /denegado/,
    );
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`SELECT public.rfq_submit_version('x','{}','[]',null,null)`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`UPDATE public.rfq_allocations SET authorized_at=now()`),
    ).rejects.toThrow(/permission denied/);
    await db.exec(
      `RESET ROLE; SELECT set_config('request.jwt.claim.sub','${U}',false);`,
    );
  });
  it("confirmed order provenance and financial lines cannot be edited or deleted", async () => {
    const order = (
      await db.query<{ id: string }>(
        `SELECT id FROM public.authorized_orders WHERE rfq_id=$1 LIMIT 1`,
        [rfq],
      )
    ).rows[0].id;
    await expect(
      db.query(
        `UPDATE public.authorized_orders SET total_price=1 WHERE id=$1`,
        [order],
      ),
    ).rejects.toThrow(/inmutable/);
    await expect(
      db.query(
        `UPDATE public.authorized_order_items SET quantity=1 WHERE order_id=$1`,
        [order],
      ),
    ).rejects.toThrow(/inmutable/);
    await expect(
      db.query(`DELETE FROM public.authorized_orders WHERE id=$1`, [order]),
    ).rejects.toThrow(/provenance/);
    await expect(
      db.query(
        `INSERT INTO public.authorized_order_items(empresa_id,order_id,product,quantity,unit,unit_price,total_price) VALUES($1,$2,'Extra',1,'un',1,1)`,
        [E, order],
      ),
    ).rejects.toThrow(/agregar/);
    await expect(
      db.query(
        `UPDATE public.quotes SET rfq_provider_id=gen_random_uuid() WHERE id=(SELECT quote_id FROM public.quote_versions WHERE id=$1)`,
        [v],
      ),
    ).rejects.toThrow(/inmutables/);
    await db.query(
      `UPDATE public.authorized_orders SET facturado_amount=5 WHERE id=$1`,
      [order],
    );
  });
  it("explicit cost discovery closure creates no order and cannot reopen", async () => {
    const r = await call("rfq_create", [
      JSON.stringify({ purpose: "COST_DISCOVERY", product: "Close" }),
      JSON.stringify([{ descripcion: "A", cantidad: 1, unidad: "un" }]),
      [V],
    ]);
    const before = (await db.query(`SELECT id FROM public.authorized_orders`))
      .rows.length;
    await expect(call("rfq_close_discovery", [r.id, false])).rejects.toThrow(
      /humano/,
    );
    await expect(call("rfq_close_discovery", [rfq, true])).rejects.toThrow(
      /descubrimiento/,
    );
    await call("rfq_close_discovery", [r.id, true]);
    await call("rfq_close_discovery", [r.id, true]);
    expect(
      (
        await db.query<{ closed_by: string }>(
          `SELECT closed_by FROM public.rfqs WHERE id=$1`,
          [r.id],
        )
      ).rows[0].closed_by,
    ).toBe(U);
    await expect(
      db.query(`UPDATE public.rfqs SET expires_at='2099-01-01' WHERE id=$1`, [
        r.id,
      ]),
    ).rejects.toThrow(/inmutable/);
    expect(
      (await db.query(`SELECT id FROM public.authorized_orders`)).rows.length,
    ).toBe(before);
  });
  it("revocation denies supplier writes and renewal rotates token", async () => {
    const r = await call("rfq_create", [
      JSON.stringify({ purpose: "PROCUREMENT", product: "Revoke" }),
      JSON.stringify([{ descripcion: "A", cantidad: 1, unidad: "un" }]),
      [V],
    ]);
    const rp = (
      await db.query<{ id: string; token: string }>(
        `SELECT id,token FROM public.rfq_providers WHERE rfq_id=$1`,
        [r.id],
      )
    ).rows[0];
    await call("rfq_revoke_link", [r.id, rp.id]);
    await expect(
      call("rfq_submit_version", [rp.token, "{}", "[]", null, null]),
    ).rejects.toThrow(/Link/);
    await call("rfq_renew_link", [r.id, rp.id]);
    const renewed = (
      await db.query<{ token: string; token_revoked_at: string | null }>(
        `SELECT token,token_revoked_at FROM public.rfq_providers WHERE id=$1`,
        [rp.id],
      )
    ).rows[0];
    expect(renewed.token).not.toBe(rp.token);
    expect(renewed.token_revoked_at).toBeNull();
    await expect(
      call("rfq_submit_version", [rp.token, "{}", "[]", null, null]),
    ).rejects.toThrow(/Link/);
  });
  it("foreign active tenant cannot operate another tenant records", async () => {
    const e2 = "10000000-0000-4000-8000-000000000002",
      u2 = "20000000-0000-4000-8000-000000000002";
    await db.query(
      `INSERT INTO public.empresas(id,nombre) VALUES($1,'Foreign')`,
      [e2],
    );
    await db.query(
      `INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES($1,'foreign@rfq.invalid','Foreign','admin',$2)`,
      [u2, e2],
    );
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [u2]);
    try {
      await expect(call("rfq_preview_orders", [allocation])).rejects.toThrow();
      await expect(
        call("rfq_authorize_allocation", [allocation, true]),
      ).rejects.toThrow();
      await expect(
        call("rfq_confirm_orders", [allocation, hash, true]),
      ).rejects.toThrow();
      await expect(call("rfq_close_discovery", [rfq, true])).rejects.toThrow();
    } finally {
      await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [
        U,
      ]);
    }
  });
  it("direct purchase rejects precision loss and amounts below ledger minimum", async () => {
    const header = JSON.stringify({
      provider_id: V,
      currency: "PYG",
      freight: 0,
      payment_terms: "cash",
      vat_included: false,
    });
    for (const line of [
      { quantity: 0.12345, unit_price: 100 },
      { quantity: 0.0001, unit_price: 0.0001 },
    ]) {
      await expect(
        call("direct_purchase_preview", [
          header,
          JSON.stringify([{ product: "A", unit: "un", tax_rate: 0, ...line }]),
        ]),
      ).rejects.toThrow();
    }
  });
  it("revision CAS, obsolete allocations and replacement supplier versions fail closed", async () => {
    const r = await call("rfq_create", [
      JSON.stringify({ purpose: "PROCUREMENT", product: "CAS" }),
      JSON.stringify([{ descripcion: "A", cantidad: 10, unidad: "un" }]),
      [V],
    ]);
    const ri = (
      await db.query<{ id: string }>(
        `SELECT id FROM public.rfq_items WHERE rfq_id=$1`,
        [r.id],
      )
    ).rows[0].id;
    const link = (
      await db.query<{ token: string }>(
        `SELECT token FROM public.rfq_providers WHERE rfq_id=$1`,
        [r.id],
      )
    ).rows[0].token;
    const first = await submit(link, 100, ri);
    const line = (
      await db.query<{ id: string }>(
        `SELECT id FROM public.quote_version_items WHERE quote_version_id=$1`,
        [first.versionId],
      )
    ).rows[0].id;
    await call("rfq_review_quote", [
      first.versionId,
      "{}",
      "{}",
      "Human checked original document",
    ]);
    const lines = JSON.stringify([
      { quote_version_item_id: line, quantity: 1 },
    ]);
    const a1 = await call("rfq_save_allocation", [
      r.id,
      lines,
      "Human justification",
      0,
    ]);
    await expect(
      call("rfq_save_allocation", [r.id, lines, "Human justification", 0]),
    ).rejects.toThrow();
    const a2 = await call("rfq_save_allocation", [
      r.id,
      lines,
      "Human revised allocation",
      1,
    ]);
    await expect(
      call("rfq_authorize_allocation", [a1.id, true]),
    ).rejects.toThrow();
    await submit(link, 90, ri);
    await expect(
      call("rfq_authorize_allocation", [a2.id, true]),
    ).rejects.toThrow(/obsoleta/);
    await noOrderFor(r.id);
  });
  async function noOrderFor(id: string) {
    expect(
      (
        await db.query(
          `SELECT id FROM public.authorized_orders WHERE rfq_id=$1`,
          [id],
        )
      ).rows,
    ).toHaveLength(0);
  }
  it("direct purchase has its own exact preview, no RFQ and explicit idempotent confirmation", async () => {
    const before = (await db.query(`SELECT id FROM public.authorized_orders`))
      .rows.length;
    const preview = await call("direct_purchase_preview", [
      JSON.stringify({
        provider_id: V,
        currency: "USD",
        freight: 5,
        payment_terms: "cash",
        vat_included: false,
      }),
      JSON.stringify([
        {
          product: "Direct",
          quantity: 0.1234,
          unit: "kg",
          unit_price: 100,
          tax_rate: 10,
          total_price: 999999,
        },
      ]),
    ]);
    expect(preview.snapshot.total).toBe(18.57);
    expect(preview.snapshot.items[0].total_price).toBe(13.57);
    expect(
      (await db.query(`SELECT id FROM public.authorized_orders`)).rows,
    ).toHaveLength(before);
    await expect(
      call("direct_purchase_confirm", [preview.id, preview.hash, false]),
    ).rejects.toThrow(/humana/);
    await expect(
      call("direct_purchase_confirm", [preview.id, "bad", true]),
    ).rejects.toThrow(/modificado/);
    const id = await call("direct_purchase_confirm", [
      preview.id,
      preview.hash,
      true,
    ]);
    expect(
      await call("direct_purchase_confirm", [preview.id, preview.hash, true]),
    ).toBe(id);
    const row = (
      await db.query<{ quantity: string; rfq_id: string | null }>(
        `SELECT quantity,rfq_id FROM public.authorized_orders WHERE id=$1`,
        [id],
      )
    ).rows[0];
    expect(Number(row.quantity)).toBe(0.1234);
    expect(row.rfq_id).toBeNull();
  });
});
