// Preview-only synthetic test fixture. Reads credentials from ignored audit-artifacts; never production.
const fs = require("fs"),
  crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const cfg = JSON.parse(
  (() => {
    const b = fs.readFileSync(
      "audit-artifacts/batch-03/private/preview-config.json",
    );
    return b.toString(b[0] === 255 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  })(),
);
if (cfg.SUPABASE_URL !== "https://afedslxxtttyqunqmutz.supabase.co")
  throw Error("Preview ref mismatch");
fs.writeFileSync(
  ".env.local",
  `NEXT_PUBLIC_SUPABASE_URL=${cfg.SUPABASE_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${cfg.SUPABASE_ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${cfg.SUPABASE_SERVICE_ROLE_KEY}\nNEXT_PUBLIC_APP_URL=http://localhost:3103\n`,
);
const db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const must = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
(async () => {
  const empresa = must(
    await db
      .from("empresas")
      .insert({
        nombre: "RFQ 2 synthetic browser verification",
        plan: "pro",
        active: true,
        modulo_compras: true,
      })
      .select("id")
      .single(),
  );
  const email = `rfq-preview-${Date.now()}@example.com`,
    password = crypto.randomBytes(24).toString("base64url");
  const user = must(
    await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "RFQ synthetic auditor" },
    }),
  ).user;
  must(
    await db
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: "RFQ synthetic auditor",
        empresa_id: empresa.id,
        role: "admin",
        active: true,
      }),
  );
  const providers = must(
    await db
      .from("providers")
      .insert([
        { empresa_id: empresa.id, name: "RFQ Synthetic Supplier A" },
        { empresa_id: empresa.id, name: "RFQ Synthetic Supplier B" },
      ])
      .select("id,name"),
  );
  fs.writeFileSync(
    "audit-artifacts/batch-03/private/browser-fixture.json",
    JSON.stringify({
      empresaId: empresa.id,
      userId: user.id,
      email,
      password,
      providers,
    }),
  );
  console.log(
    "PREVIEW_ENV: PASS; SYNTHETIC_AUTH_FIXTURE: PASS; PROVIDERS: " +
      providers.length,
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
