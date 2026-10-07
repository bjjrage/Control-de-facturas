// New isolated QA environment only. Never changes an existing user or tenant.
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import safety from "./external-test-target.cjs";

const privateFile = path.resolve(process.argv[2] ?? "");
const credentials = JSON.parse(fs.readFileSync(privateFile, "utf8").replace(/^\uFEFF/, ""));
const url = credentials.SUPABASE_URL;
if (url !== "https://voxiddrfhfanbyatpcvb.supabase.co") throw new Error("Only the explicitly authorized remediation branch is allowed");
safety.assertNonProductionTestTarget({ url, env: { ALLOW_EXTERNAL_TEST_DB: "true" }, label: "QA administration provisioning" });
const out = path.join(path.dirname(privateFile), "qa-identity-private.json");
if (fs.existsSync(out)) throw new Error("Identity already provisioned; reuse it without resetting credentials");
const db = createClient(url, credentials.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const existing = check(await db.from("empresas").select("id").limit(1));
if (existing.length) throw new Error("QA branch is not empty; refusing to overwrite tenants");
const empresaId = randomUUID();
const email = "qa-admin-remediation-1@example.test";
const password = randomBytes(24).toString("base64url");
// Same provisioning contract as scripts/e2e/seed-canonical-demo.ts.
check(await db.from("empresas").insert({ id: empresaId, nombre: "CONSTRUCTORA QA PARAGUAY S.A.", slug: "qa-admin-remediation-1", ruc: "80099999-1", plan: "caterpillar", modulo_compras: true, modulo_ventas: true, active: true }));
const user = check(await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "QA Remediation / Admin" } })).user;
if (!user) throw new Error("Auth did not return a user");
check(await db.from("profiles").upsert({ id: user.id, email, full_name: "QA Remediation / Admin", role: "admin", active: true, empresa_id: empresaId, is_super_admin: false }));
fs.writeFileSync(out, JSON.stringify({ email, password, userId: user.id, empresaId, url }, null, 2));
const profile = check(await db.from("profiles").select("id,role,is_super_admin,empresa_id,empresas(nombre,ruc,modulo_ventas)").eq("id", user.id).single());
console.log(JSON.stringify({ branch: "qa-admin-remediation-1", profile, privateCredentialsStored: true }));
