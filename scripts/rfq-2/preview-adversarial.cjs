// Adversarial Auth/RPC tests. This script is pinned to the synthetic RFQ Preview.
// Credentials and generated users stay under ignored audit-artifacts.
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");

const root = "audit-artifacts/batch-03/private";
const cfgBytes = fs.readFileSync(`${root}/preview-config.json`);
const cfg = JSON.parse(
  cfgBytes
    .toString(cfgBytes[0] === 255 ? "utf16le" : "utf8")
    .replace(/^\uFEFF/, ""),
);
assert.equal(cfg.SUPABASE_URL, "https://afedslxxtttyqunqmutz.supabase.co");
const fixture = JSON.parse(fs.readFileSync(`${root}/browser-fixture.json`, "utf8"));
const client = (key) =>
  createClient(cfg.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = client(cfg.SUPABASE_SERVICE_ROLE_KEY);
const humanA = client(cfg.SUPABASE_ANON_KEY);
const evidence = [];
const must = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const reject = async (promise, label) => {
  const r = await promise;
  assert.ok(r.error, `${label} must fail closed`);
  evidence.push(`${label}: PASS`);
  return r.error;
};
const passwordOffer = (tag, price = 100) => ({
  offer: {
    budget_number: tag,
    currency: "PYG",
    vat_included: false,
    invoice_available: true,
    valid_until: "2099-01-01T00:00:00Z",
    freight: 0,
    payment_terms: "Synthetic cash terms",
  },
  item: {
    precio_unitario: price,
    available_quantity: 10,
    tax_rate: 10,
    lead_time_days: 3,
    observaciones: `Synthetic ${tag}`,
  },
});

async function signIn(clientRef, email, password) {
  must(await clientRef.auth.signInWithPassword({ email, password }));
  return clientRef;
}
async function makeRfq(actor, purpose, description, providerIds) {
  const out = must(
    await actor.rpc("rfq_create", {
      p_header: { purpose, product: description },
      p_items: [{ descripcion: description, cantidad: 10, unidad: "un" }],
      p_provider_ids: providerIds,
    }),
  );
  const item = must(
    await admin
      .from("rfq_items")
      .select("id")
      .eq("rfq_id", out.id)
      .single(),
  );
  return { id: out.id, itemId: item.id };
}
async function invitation(rfqId, providerId) {
  return must(
    await admin
      .from("rfq_providers")
      .select("id,token,token_expires_at,token_revoked_at")
      .eq("rfq_id", rfqId)
      .eq("provider_id", providerId)
      .single(),
  );
}
async function attachment(empresaId, invitationId, label) {
  return must(
    await admin
      .from("attachments")
      .insert({
        empresa_id: empresaId,
        bucket: "quote-pdfs",
        path: `synthetic/${crypto.randomUUID()}.pdf`,
        file_name: `${label}.pdf`,
        rfq_provider_id: invitationId,
      })
      .select("id")
      .single(),
  );
}
async function submit(token, itemId, documentId, tag, price = 100) {
  const { offer, item } = passwordOffer(tag, price);
  return must(
    await admin.rpc("rfq_submit_version", {
      p_token: token,
      p_offer: offer,
      p_items: [{ rfq_item_id: itemId, ...item }],
      p_attachment_id: documentId,
      p_actor_id: null,
    }),
  );
}
async function versionItem(versionId) {
  return must(
    await admin
      .from("quote_version_items")
      .select("id,rfq_item_id,precio_unitario")
      .eq("quote_version_id", versionId)
      .single(),
  );
}
async function review(actor, versionId, text) {
  return must(
    await actor.rpc("rfq_review_quote", {
      p_version_id: versionId,
      p_extraction: { synthetic: "source preserved" },
      p_comparison: { synthetic: "separate review layer" },
      p_resolution: text,
    }),
  );
}
async function allocate(actor, rfqId, lineId, expectedRevision = 0) {
  return must(
    await actor.rpc("rfq_save_allocation", {
      p_rfq_id: rfqId,
      p_lines: [{ quote_version_item_id: lineId, quantity: 1 }],
      p_justification: "Synthetic human-tested allocation",
      p_expected_revision: expectedRevision,
    }),
  );
}
async function preparePurchase(actor, rfq, providerId, tag) {
  const invite = await invitation(rfq.id, providerId);
  const doc = await attachment(fixture.empresaId, invite.id, tag);
  const submitted = await submit(invite.token, rfq.itemId, doc.id, tag);
  const vi = await versionItem(submitted.versionId);
  await review(actor, submitted.versionId, `Reviewed synthetic ${tag} document facts`);
  const allocation = await allocate(actor, rfq.id, vi.id);
  must(
    await actor.rpc("rfq_authorize_allocation", {
      p_allocation_id: allocation.id,
      p_confirm: true,
    }),
  );
  const preview = must(
    await actor.rpc("rfq_preview_orders", { p_allocation_id: allocation.id }),
  );
  return { invite, doc, submitted, vi, allocation, preview };
}

async function main() {
  must(await signIn(humanA, fixture.email, fixture.password));
  const providerA = fixture.providers[0];

  // Confirm over independent HTTP requests; the DB row lock and unique index serialize writes.
  const concurrentRfq = await makeRfq(
    humanA,
    "PROCUREMENT",
    "Concurrent confirmation synthetic",
    [providerA.id],
  );
  const concurrent = await preparePurchase(
    humanA,
    concurrentRfq,
    providerA.id,
    "CONCURRENT",
  );
  assert.match(concurrent.preview.hash, /^[a-f0-9]{64}$/);
  const confirmArgs = {
    p_allocation_id: concurrent.allocation.id,
    p_preview_hash: concurrent.preview.hash,
    p_confirm: true,
  };
  const concurrentResults = await Promise.all([
    humanA.rpc("rfq_confirm_orders", confirmArgs),
    humanA.rpc("rfq_confirm_orders", confirmArgs),
  ]);
  const concurrentData = concurrentResults.map((r) => must(r));
  assert.deepEqual(
    concurrentData.map((r) => r.alreadyConfirmed).sort(),
    [false, true],
  );
  const createdIds = concurrentData[0].orderIds;
  assert.deepEqual(concurrentData[1].orderIds, createdIds);
  const countAfterRace = must(
    await admin
      .from("authorized_orders")
      .select("id,rfq_allocation_id")
      .eq("rfq_allocation_id", concurrent.allocation.id),
  );
  assert.equal(countAfterRace.length, 1);
  const repeated = must(await humanA.rpc("rfq_confirm_orders", confirmArgs));
  assert.equal(repeated.alreadyConfirmed, true);
  assert.deepEqual(repeated.orderIds, createdIds);
  const countAfterRepeats = must(
    await admin
      .from("authorized_orders")
      .select("id")
      .eq("rfq_allocation_id", concurrent.allocation.id),
  );
  assert.equal(countAfterRepeats.length, 1);
  evidence.push("Concurrent confirmation: one physical OC, no partial/duplicate writes: PASS");
  evidence.push("Sequential idempotency: same OC IDs returned on retries: PASS");

  // A later quote correction leaves v1/evidence intact and makes v1 allocation stale.
  const versionRfq = await makeRfq(
    humanA,
    "PROCUREMENT",
    "Quote correction version synthetic",
    [providerA.id],
  );
  const versionInvite = await invitation(versionRfq.id, providerA.id);
  const doc1 = await attachment(fixture.empresaId, versionInvite.id, "VERSION-1");
  const v1 = await submit(versionInvite.token, versionRfq.itemId, doc1.id, "VERSION-1", 100);
  const vi1 = await versionItem(v1.versionId);
  await review(humanA, v1.versionId, "Reviewed original synthetic version one");
  const oldAllocation = await allocate(humanA, versionRfq.id, vi1.id);
  must(
    await humanA.rpc("rfq_authorize_allocation", {
      p_allocation_id: oldAllocation.id,
      p_confirm: true,
    }),
  );
  const oldPreview = must(
    await humanA.rpc("rfq_preview_orders", { p_allocation_id: oldAllocation.id }),
  );
  const doc2 = await attachment(fixture.empresaId, versionInvite.id, "VERSION-2");
  const v2 = await submit(versionInvite.token, versionRfq.itemId, doc2.id, "VERSION-2", 120);
  assert.equal(v2.versionNumber, 2);
  const vi2 = await versionItem(v2.versionId);
  await review(humanA, v2.versionId, "Reviewed corrected synthetic version two");
  const savedVersions = must(
    await admin
      .from("quote_versions")
      .select("id,version_number,unit_price,pdf_attachment_id")
      .in("id", [v1.versionId, v2.versionId])
      .order("version_number"),
  );
  assert.equal(savedVersions.length, 2);
  assert.equal(savedVersions[0].unit_price, 1100);
  assert.equal(savedVersions[1].unit_price, 1320);
  assert.equal(savedVersions[0].pdf_attachment_id, doc1.id);
  assert.equal(savedVersions[1].pdf_attachment_id, doc2.id);
  assert.equal(vi1.precio_unitario, 100);
  assert.equal(vi2.precio_unitario, 120);
  const reviewRows = must(
    await admin
      .from("rfq_quote_reviews")
      .select("quote_version_id,resolution")
      .in("quote_version_id", [v1.versionId, v2.versionId]),
  );
  assert.deepEqual(
    new Set(reviewRows.map((r) => r.quote_version_id)),
    new Set([v1.versionId, v2.versionId]),
  );
  await reject(
    humanA.rpc("rfq_save_allocation", {
      p_rfq_id: versionRfq.id,
      p_lines: [{ quote_version_item_id: vi1.id, quantity: 1 }],
      p_justification: "Reject obsolete supplier version",
      p_expected_revision: 1,
    }),
    "Allocation rejects old quote version after correction",
  );
  await reject(
    humanA.rpc("rfq_confirm_orders", {
      p_allocation_id: oldAllocation.id,
      p_preview_hash: oldPreview.hash,
      p_confirm: true,
    }),
    "Confirmation rejects stale preview after quote correction",
  );
  assert.equal(
    must(
      await admin
        .from("authorized_orders")
        .select("id")
        .eq("rfq_allocation_id", oldAllocation.id),
    ).length,
    0,
  );
  evidence.push("Quote v1 preserved; v2 latest; review/evidence remain version-scoped: PASS");
  evidence.push("Reconciliation data layers remain separate and auditable: PASS");

  // Build a real independent tenant, supplier, RFQ, quote, and user.
  const foreignCompany = must(
    await admin
      .from("empresas")
      .insert({ nombre: "RFQ final hardening synthetic tenant", plan: "pro", active: true })
      .select("id")
      .single(),
  );
  const foreignEmail = `rfq-hardening-${Date.now()}@example.com`;
  const foreignPassword = crypto.randomBytes(24).toString("base64url");
  const foreignUser = must(
    await admin.auth.admin.createUser({
      email: foreignEmail,
      password: foreignPassword,
      email_confirm: true,
      user_metadata: { full_name: "Synthetic cross-tenant auditor" },
    }),
  ).user;
  must(
    await admin.from("profiles").upsert({
      id: foreignUser.id,
      email: foreignEmail,
      full_name: "Synthetic cross-tenant auditor",
      role: "admin",
      active: true,
      empresa_id: foreignCompany.id,
    }),
  );
  const providerB = must(
    await admin
      .from("providers")
      .insert({ empresa_id: foreignCompany.id, name: "RFQ synthetic foreign supplier" })
      .select("id,name")
      .single(),
  );
  const humanB = client(cfg.SUPABASE_ANON_KEY);
  await signIn(humanB, foreignEmail, foreignPassword);
  const rfqA = await makeRfq(humanA, "PROCUREMENT", "Tenant A synthetic RFQ", [providerA.id]);
  const inviteA = await invitation(rfqA.id, providerA.id);
  const docA = await attachment(fixture.empresaId, inviteA.id, "TENANT-A");
  const rfqB = await makeRfq(humanB, "PROCUREMENT", "Tenant B synthetic RFQ", [providerB.id]);
  const inviteB = await invitation(rfqB.id, providerB.id);
  const docB = await attachment(foreignCompany.id, inviteB.id, "TENANT-B");
  const offerB = await submit(inviteB.token, rfqB.itemId, docB.id, "TENANT-B", 80);
  const viB = await versionItem(offerB.versionId);
  await review(humanB, offerB.versionId, "Reviewed foreign tenant synthetic quote");
  const allocationB = await allocate(humanB, rfqB.id, viB.id);
  must(
    await humanB.rpc("rfq_authorize_allocation", {
      p_allocation_id: allocationB.id,
      p_confirm: true,
    }),
  );
  const previewB = must(
    await humanB.rpc("rfq_preview_orders", { p_allocation_id: allocationB.id }),
  );

  await reject(
    humanA.rpc("rfq_invite", { p_rfq_id: rfqA.id, p_provider_ids: [providerB.id] }),
    "RFQ A rejects provider B",
  );
  await reject(
    admin.rpc("rfq_submit_version", {
      p_token: inviteA.token,
      p_offer: passwordOffer("FOREIGN-ITEM").offer,
      p_items: [{ rfq_item_id: rfqB.itemId, ...passwordOffer("FOREIGN-ITEM").item }],
      p_attachment_id: docA.id,
      p_actor_id: null,
    }),
    "RFQ A token rejects quote item B",
  );
  await reject(
    (() => {
      const payload = passwordOffer("CROSS-ATTACH-B");
      return admin.rpc("rfq_submit_version", {
        p_token: inviteA.token,
        p_offer: payload.offer,
        p_items: [{ rfq_item_id: rfqA.itemId, ...payload.item }],
        p_attachment_id: docB.id,
        p_actor_id: null,
      });
    })(),
    "Invitation A rejects attachment B",
  );
  await reject(
    (() => {
      const payload = passwordOffer("CROSS-ATTACH-A");
      return admin.rpc("rfq_submit_version", {
        p_token: inviteB.token,
        p_offer: payload.offer,
        p_items: [{ rfq_item_id: rfqB.itemId, ...payload.item }],
        p_attachment_id: docA.id,
        p_actor_id: null,
      });
    })(),
    "Invitation B rejects attachment A",
  );
  await reject(
    humanA.rpc("rfq_save_allocation", {
      p_rfq_id: rfqA.id,
      p_lines: [{ quote_version_item_id: viB.id, quantity: 1 }],
      p_justification: "Reject foreign quote allocation",
      p_expected_revision: 0,
    }),
    "Allocation A rejects quote version item B",
  );
  await reject(
    humanB.rpc("rfq_preview_orders", { p_allocation_id: concurrent.allocation.id }),
    "User B cannot preview allocation A",
  );
  await reject(
    humanB.rpc("rfq_confirm_orders", {
      p_allocation_id: concurrent.allocation.id,
      p_preview_hash: concurrent.preview.hash,
      p_confirm: true,
    }),
    "User B cannot confirm allocation A",
  );
  await reject(
    humanA.rpc("rfq_preview_orders", { p_allocation_id: allocationB.id }),
    "User A cannot preview allocation B",
  );
  await reject(
    humanA.rpc("rfq_confirm_orders", {
      p_allocation_id: allocationB.id,
      p_preview_hash: previewB.hash,
      p_confirm: true,
    }),
    "User A cannot confirm allocation B",
  );
  evidence.push("Cross-tenant RFQ/provider/quote/version/attachment/preview/confirm isolation: PASS");

  // Missing purpose and all four server-side discovery purchase gates.
  await reject(
    humanA.rpc("rfq_create", {
      p_header: { product: "Purpose required" },
      p_items: [{ descripcion: "Line", cantidad: 1, unidad: "un" }],
      p_provider_ids: [],
    }),
    "New RFQ requires explicit purpose",
  );
  const discovery = await makeRfq(
    humanA,
    "COST_DISCOVERY",
    "Cost discovery hard block synthetic",
    [providerA.id],
  );
  await reject(
    humanA.rpc("rfq_save_allocation", {
      p_rfq_id: discovery.id,
      p_lines: [{ quote_version_item_id: vi1.id, quantity: 1 }],
      p_justification: "Must reject cost discovery allocation",
      p_expected_revision: 0,
    }),
    "COST_DISCOVERY save allocation blocked server-side",
  );
  const forged = must(
    await admin
      .from("rfq_allocations")
      .insert({
        empresa_id: fixture.empresaId,
        rfq_id: discovery.id,
        revision: 1,
        lines: [],
        justification: "Synthetic attempt to bypass discovery hard block",
        created_by: fixture.userId,
        authorized_by: fixture.userId,
        authorized_at: new Date().toISOString(),
        preview: [],
        preview_hash: "forged-preview",
      })
      .select("id")
      .single(),
  );
  await reject(
    humanA.rpc("rfq_authorize_allocation", { p_allocation_id: forged.id, p_confirm: true }),
    "COST_DISCOVERY authorize blocked server-side",
  );
  await reject(
    humanA.rpc("rfq_preview_orders", { p_allocation_id: forged.id }),
    "COST_DISCOVERY order preview blocked server-side",
  );
  await reject(
    humanA.rpc("rfq_confirm_orders", {
      p_allocation_id: forged.id,
      p_preview_hash: "forged-preview",
      p_confirm: true,
    }),
    "COST_DISCOVERY confirmation blocked server-side",
  );
  evidence.push("COST_DISCOVERY cannot reach allocation, authorization, preview, or confirmation: PASS");

  // Rotation, revocation, expiry, RFQ closure, and provider status are enforced on write.
  const rotationRfq = await makeRfq(humanA, "PROCUREMENT", "Rotation synthetic", [providerA.id]);
  const rotating = await invitation(rotationRfq.id, providerA.id);
  const rotatingDoc = await attachment(fixture.empresaId, rotating.id, "ROTATION");
  assert.match(rotating.token, /^[a-f0-9]{64}$/);
  assert.ok(new Date(rotating.token_expires_at).getTime() > Date.now());
  const renewal = await humanA.rpc("rfq_renew_link", {
    p_rfq_id: rotationRfq.id,
    p_rfq_provider_id: rotating.id,
  });
  must(renewal);
  const renewed = await invitation(rotationRfq.id, providerA.id);
  assert.ok(renewed.token !== rotating.token, "Renewal must issue a different token");
  assert.match(renewed.token, /^[a-f0-9]{64}$/);
  await reject(
    admin.rpc("rfq_submit_version", {
      p_token: rotating.token,
      p_offer: passwordOffer("OLD-TOKEN").offer,
      p_items: [{ rfq_item_id: rotationRfq.itemId, ...passwordOffer("OLD-TOKEN").item }],
      p_attachment_id: rotatingDoc.id,
      p_actor_id: null,
    }),
    "Old magic link invalid after rotation",
  );
  await submit(renewed.token, rotationRfq.itemId, rotatingDoc.id, "ROTATED-TOKEN");
  must(
    await humanA.rpc("rfq_revoke_link", {
      p_rfq_id: rotationRfq.id,
      p_rfq_provider_id: rotating.id,
    }),
  );
  await reject(
    admin.rpc("rfq_submit_version", {
      p_token: renewed.token,
      p_offer: passwordOffer("REVOKED-TOKEN").offer,
      p_items: [{ rfq_item_id: rotationRfq.itemId, ...passwordOffer("REVOKED-TOKEN").item }],
      p_attachment_id: rotatingDoc.id,
      p_actor_id: null,
    }),
    "Revoked magic link cannot submit",
  );

  const expiredRfq = await makeRfq(humanA, "PROCUREMENT", "Expiry synthetic", [providerA.id]);
  const expired = await invitation(expiredRfq.id, providerA.id);
  const expiredDoc = await attachment(fixture.empresaId, expired.id, "EXPIRED");
  must(
    await admin
      .from("rfq_providers")
      .update({ token_expires_at: "2000-01-01T00:00:00Z" })
      .eq("id", expired.id),
  );
  await reject(
    admin.rpc("rfq_submit_version", {
      p_token: expired.token,
      p_offer: passwordOffer("EXPIRED").offer,
      p_items: [{ rfq_item_id: expiredRfq.itemId, ...passwordOffer("EXPIRED").item }],
      p_attachment_id: expiredDoc.id,
      p_actor_id: null,
    }),
    "Expired magic link cannot submit",
  );

  const closedRfq = await makeRfq(humanA, "COST_DISCOVERY", "Closed discovery synthetic", [providerA.id]);
  const closedInvite = await invitation(closedRfq.id, providerA.id);
  const closedDoc = await attachment(fixture.empresaId, closedInvite.id, "CLOSED");
  must(await humanA.rpc("rfq_close_discovery", { p_rfq_id: closedRfq.id, p_confirm: true }));
  await reject(
    admin.rpc("rfq_submit_version", {
      p_token: closedInvite.token,
      p_offer: passwordOffer("CLOSED").offer,
      p_items: [{ rfq_item_id: closedRfq.itemId, ...passwordOffer("CLOSED").item }],
      p_attachment_id: closedDoc.id,
      p_actor_id: null,
    }),
    "Closed RFQ rejects supplier submission",
  );

  const inactiveRfq = await makeRfq(humanB, "PROCUREMENT", "Inactive supplier synthetic", [providerB.id]);
  const inactiveInvite = await invitation(inactiveRfq.id, providerB.id);
  const inactiveDoc = await attachment(foreignCompany.id, inactiveInvite.id, "INACTIVE");
  must(await admin.from("providers").update({ active: false }).eq("id", providerB.id));
  try {
    await reject(
      admin.rpc("rfq_submit_version", {
        p_token: inactiveInvite.token,
        p_offer: passwordOffer("INACTIVE").offer,
        p_items: [{ rfq_item_id: inactiveRfq.itemId, ...passwordOffer("INACTIVE").item }],
        p_attachment_id: inactiveDoc.id,
        p_actor_id: null,
      }),
      "Inactive supplier cannot submit",
    );
  } finally {
    must(await admin.from("providers").update({ active: true }).eq("id", providerB.id));
  }
  evidence.push("Magic link strength/expiry/revocation/rotation/closed RFQ/provider status/attachment binding: PASS");

  const output = {
    status: "PASS",
    preview: "afedslxxtttyqunqmutz",
    checks: evidence,
  };
  fs.writeFileSync(`${root}/adversarial-result.json`, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
