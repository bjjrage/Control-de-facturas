// Real Next production compiler + Node HTTP runtime, isolated from ERP/Auth/DB.
// Compare the old bundled configuration with the actual project configuration.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const nextBin = require.resolve("next/dist/bin/next");
const out = path.join(root, "..", "qa-e2e-administracion/remediation-1/pdf-runtime-final");
const files = ["COT-QA-001_Cementos.pdf", "COT-QA-002_Ferreteria.pdf"];
fs.mkdirSync(out, { recursive: true });

async function build(cwd) {
  const proc = spawn(process.execPath, [nextBin, "build"], {
    cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", x => { log += x; });
  proc.stderr.on("data", x => { log += x; });
  const code = await new Promise((resolve, reject) => { proc.on("error", reject); proc.on("exit", resolve); });
  fs.writeFileSync(path.join(cwd, "build.log"), log);
  if (code !== 0) throw new Error(`Runtime fixture build failed (${code}): ${log}`);
}

const results = [];
for (const mode of ["before", "after"]) {
  const cwd = path.join(out, mode);
  fs.mkdirSync(path.join(cwd, "app/api/extract"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "fixtures"), { recursive: true });
  if (!fs.existsSync(path.join(cwd, "node_modules"))) fs.symlinkSync(path.join(root, "node_modules"), path.join(cwd, "node_modules"), "junction");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ private: true, name: `qa-pdf-${mode}`, dependencies: { next: "16.3.8", react: "19.2.8", "react-dom": "19.2.8", "pdf-parse": "2.4.5" } }));
  fs.copyFileSync(path.join(root, "lib/documents/reader.ts"), path.join(cwd, "reader.ts"));
  for (const file of files) fs.copyFileSync(path.join(root, "test/fixtures/qa-admin", file), path.join(cwd, "fixtures", file));
  const projectConfig = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  const fixtureConfig = mode === "before" ? projectConfig.replace('serverExternalPackages: ["pdf-parse"]', "serverExternalPackages: []") : projectConfig;
  // The fixture is beside the repo; its dependency junction is inside this root.
  fs.writeFileSync(path.join(cwd, "next.config.ts"), fixtureConfig
    .replace('"/rfqs/*": pdfRuntimeFiles', '"/api/extract": pdfRuntimeFiles')
    .replace("const nextConfig: NextConfig = {", `const nextConfig: NextConfig = {\n  outputFileTracingRoot: ${JSON.stringify(path.dirname(root))},\n  turbopack: { root: ${JSON.stringify(path.dirname(root))} },`));
  fs.writeFileSync(path.join(cwd, "app/layout.tsx"), 'export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}');
  fs.writeFileSync(path.join(cwd, "app/page.tsx"), 'export default function Page(){return <p>Isolated PDF runtime check</p>}');
  fs.writeFileSync(path.join(cwd, "app/api/extract/route.ts"), `import fs from "node:fs";
import path from "node:path";
import { extractPdfText } from "../../../reader";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file");
  if (!${JSON.stringify(files)}.includes(file ?? "")) return new Response("Unknown fixture", {status:400});
  try { return Response.json(await extractPdfText(fs.readFileSync(path.join(process.cwd(), "fixtures", file!)), 50000)); }
  catch(e) { return Response.json({error: e instanceof Error ? e.message : String(e)}, {status:500}); }
}`);
  console.log(`Building isolated ${mode} configuration`);
  await build(cwd);
  if (mode === "after") {
    const tracePath = path.join(cwd, ".next/server/app/api/extract/route.js.nft.json");
    const trace = JSON.parse(fs.readFileSync(tracePath, "utf8")).files;
    const assets = trace.filter(file => /pdf-parse|pdfjs-dist|napi-rs[\\/]canvas/.test(file));
    const hasWorker = assets.some(file => file.endsWith("pdf.worker.mjs"));
    const hasNativeCanvas = assets.some(file => file.endsWith(".node"));
    fs.writeFileSync(path.join(cwd, "tracing.json"), JSON.stringify({ hasWorker, hasNativeCanvas, assets }, null, 2));
    if (!hasWorker || !hasNativeCanvas) throw new Error("PDF deployment trace is missing worker/native bindings");
  }
  const port = mode === "before" ? 3111 : 3112;
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", x => { log += x; });
  server.stderr.on("data", x => { log += x; });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://localhost:${port}`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`Isolated server failed: ${log}`);
    for (const file of files) {
      const response = await fetch(`http://localhost:${port}/api/extract?file=${encodeURIComponent(file)}`);
      const body = await response.json();
      // Windows has its canvas binary installed, so the bundled configuration
      // fails next at the worker's import.meta.url. Serverless can fail earlier
      // at DOMMatrix when that optional native binary is absent.
      const pass = mode === "before" ? response.status === 500 && /DOMMatrix|fake worker/.test(body.error ?? "") : response.ok && !body.requiresVision && body.text.includes("QA");
      results.push({ mode, file, status: response.status, error: body.error ?? null, text: body.text ?? null, pass });
      console.log(`${mode}: ${file}: HTTP ${response.status}, ${body.error ?? "text extracted"}, regression=${pass}`);
    }
  } finally {
    server.kill();
    fs.writeFileSync(path.join(cwd, "runtime.log"), log);
  }
}
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
if (results.some(result => !result.pass)) throw new Error("PDF runtime regression did not reproduce before / pass after; inspect results.json");
