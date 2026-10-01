import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const baseline = "1a71c96279febf6636892143af20f36a0315f5ae";

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function safeGit(args, options = {}) {
  try {
    return { ok: true, value: git(args, options) };
  } catch (error) {
    return { ok: false, value: String(error.stderr || error.message).trim() };
  }
}

function md(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", "<br>");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferArea(files, message, refName = "") {
  const haystack = `${files.join(" ")} ${message} ${refName}`.toLowerCase();
  const rules = [
    ["BIM / Cómputo", ["bim", "computo", "ifc"]],
    ["Scanner", ["scanner", "camera", "opencv"]],
    ["Forecast / Clima", ["forecast", "climate", "weather"]],
    ["Inventario", ["inventory", "inventario", "panol", "warehouse"]],
    ["Rodrigo / Agent / Email", ["agent", "rodrigo", "gmail", "email"]],
    ["Planillas / Workbook", ["planilla", "workbook", "spreadsheet"]],
    ["Licitaciones / Auction", ["auction", "licitacion", "dncp"]],
    ["Dashboard / Navegación", ["dashboard", "sidebar", "workspace", "navigation"]],
    ["Plan Semanal / MRP", ["weekly", "production-recipe", "recipe", "mrp"]],
    ["Compras / Procurement", ["procurement", "rfq", "purchase-order"]],
    ["Certificados", ["certificate", "certificado"]],
    ["Documentación / Gobernanza", ["agents.md", "claude.md", "instructivo", "docs/"]],
  ];
  const matched = rules.filter(([, keys]) => keys.some((key) => haystack.includes(key))).map(([name]) => name);
  return matched.length ? matched.slice(0, 3).join(" + ") : "Transversal / Recovery";
}

function batchFor(area) {
  if (area.includes("Inventario")) return "batch/00-db-reality";
  if (area.includes("Certificados") || area.includes("Planillas")) return "batch/01-integrity";
  if (area.includes("BIM") || area.includes("Forecast") || area.includes("Plan Semanal")) return "batch/04-planning-bim";
  if (area.includes("Compras")) return "batch/03a-procurement";
  if (area.includes("Scanner")) return "batch/05-scanner";
  if (area.includes("Rodrigo")) return "batch/06-agent";
  if (area.includes("Licitaciones")) return "batch/07-tenders";
  if (area.includes("Dashboard")) return "batch/08-ui";
  if (area.includes("Documentación")) return "batch/09-docs";
  return "batch/00-db-reality";
}

const exactRules = new Map([
  ["746549c2b007e327daacbfce67b77bf6439a9aff", { eq: "Parcial", cls: "RESCUE", action: "rescatar únicamente routing BIM y tests permitidos", batch: "batch/04-planning-bim", status: "PENDING REVIEW — batch/04-planning-bim" }],
  ["595abc7f01b6d7c8c4b5d1bac798cd0f0f86e1d0", { eq: "Sí — main contiene una implementación posterior y más segura", cls: "SUPERSEDED", action: "ignorar; no rescatar", batch: "—", status: `SUPERSEDED BY ${baseline}:invoice-dialog/actions` }],
  ["01664ffc46e41da35ed981fb8887131192a1ba66", { eq: "Sí/Parcial — Scanner vigente ya está en main", cls: "SUPERSEDED", action: "ignorar como conjunto; comparar sólo pruebas futuras", batch: "batch/05-scanner", status: `SUPERSEDED BY ${baseline}:scanner` }],
  ["432d82f5bdb9bf58fa14ce7f59150d5105217178", { eq: "Sí — main contiene controlador de polling posterior", cls: "SUPERSEDED", action: "ignorar; no rescatar", batch: "—", status: `SUPERSEDED BY ${baseline}:auction-sandbox` }],
  ["d8d2406382c79fb65c14ab56b67c705a3b6bd4a8", { eq: "Sí/Parcial — dashboard actual fue consolidado posteriormente", cls: "SUPERSEDED", action: "ignorar como rama; revisar sólo diferencias visuales si se abre batch UI", batch: "batch/08-ui", status: `SUPERSEDED BY ${baseline}:dashboard` }],
  ["97abfee1afe1dc18a0d517fa2835d1bbfd569e5e", { eq: "Sí — KPIs y helpers equivalentes existen en main", cls: "SUPERSEDED", action: "ignorar", batch: "—", status: `SUPERSEDED BY ${baseline}:lib/dashboard` }],
  ["0879e006f3b478ebae01bd22b341ff444282471c", { eq: "No confirmado; modifica una migración histórica", cls: "REVIEW", action: "analizar; nunca cherry-pick antes de DB Reality", batch: "batch/00-db-reality", status: "PENDING REVIEW — batch/00-db-reality" }],
  ["eb52c146696d4182a96939711ec1ec299ccb98c5", { eq: "No — test exclusivo", cls: "TEST", action: "rescatar test exacto tras validar contrato actual", batch: "batch/04-planning-bim", status: "PENDING REVIEW — batch/04-planning-bim" }],
  ["d6c31bba1168802907653cc4ce3507ee7d8cd122", { eq: "Parcial — main tiene intérprete, pero este delta requiere comparación", cls: "REVIEW", action: "analizar hunk por hunk", batch: "batch/01-integrity", status: "PENDING REVIEW — batch/01-integrity" }],
  ["6e9efabd7eeec1ec7a07a018a8cc671f0caaacfb", { eq: "Parcial — WIP/stash commit, no integración directa", cls: "REVIEW", action: "analizar junto con stash climático; no cherry-pick", batch: "batch/04-planning-bim", status: "PENDING REVIEW — batch/04-planning-bim" }],
  ["64753ef233152dd818abb37c686e1249e9a5ab29", { eq: "Parcial — índice sintético de WIP", cls: "CHECKPOINT", action: "ignorar como commit; revisar contenido desde stash ledger", batch: "batch/04-planning-bim", status: "REJECTED — synthetic stash index commit" }],
  ["6c1dab6d97799da19457c60a58fd522691211a42", { eq: "Sí — commit vacío de redeploy", cls: "CHECKPOINT", action: "ignorar", batch: "—", status: "REJECTED — no product diff" }],
]);

function classify(commit, files, message, refName, patchEquivalent) {
  if (exactRules.has(commit)) return exactRules.get(commit);
  const area = inferArea(files, message, refName);
  const batch = batchFor(area);
  const lower = `${message} ${refName}`.toLowerCase();
  const docsOnly = files.length > 0 && files.every((f) => /(^|\/)(docs?|instructivos y roadmap)\//i.test(f) || /(^|\/)(AGENTS|CLAUDE|README)\.md$/i.test(f));
  const testsOnly = files.length > 0 && files.every((f) => /(^|\/)(__tests__|tests?|fixtures)\//i.test(f) || /\.(spec|test)\.[cm]?[jt]sx?$/i.test(f));
  const checkpointOnly = files.length === 0 || files.every((f) => ["AGENTS.md", "CLAUDE.md", "data/construction-v1-backfill-checkpoint.json"].includes(f));

  if (patchEquivalent) return { eq: "Sí — patch-id equivalente en main", cls: "SUPERSEDED", action: "ignorar", batch: "—", status: `ABSORBED BY ${baseline} (patch-equivalent)` };
  if (checkpointOnly || /checkpoint|trigger redeploy|preserve repository instructions/.test(lower)) return { eq: "No aplica; metadata/checkpoint sin unidad funcional rescatable", cls: "CHECKPOINT", action: "ignorar", batch: "—", status: "REJECTED — checkpoint/metadata only" };
  if (testsOnly) return { eq: "No confirmado; cobertura exclusiva", cls: "TEST", action: "analizar y rescatar sólo el test compatible", batch, status: `PENDING REVIEW — ${batch}` };
  if (docsOnly) return { eq: "Parcial — documentación histórica", cls: "DOCS", action: "analizar sólo contra comportamiento vigente", batch: "batch/09-docs", status: "PENDING REVIEW — batch/09-docs" };
  if (/recovery\/|recovery:|restore legacy|functional-rebuild/.test(lower)) return { eq: "Parcial — rama recovery amplia; equivalencia no autoriza merge", cls: "REVIEW", action: "analizar archivo/hunk exacto; merge completo prohibido", batch, status: `PENDING REVIEW — ${batch}` };
  return { eq: "Parcial/No confirmado — requiere comparación semántica", cls: "REVIEW", action: "analizar hunk por hunk; no integrar por rango", batch, status: `PENDING REVIEW — ${batch}` };
}

function buildMainPatchIds() {
  const log = spawnSync("git", ["log", "--no-merges", "--pretty=format:", "-p", "main"], { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (log.status !== 0) return new Set();
  const ids = spawnSync("git", ["patch-id", "--stable"], { cwd: root, encoding: "utf8", input: log.stdout, maxBuffer: 128 * 1024 * 1024 });
  if (ids.status !== 0) return new Set();
  return new Set(ids.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean));
}

function patchId(commit) {
  const show = spawnSync("git", ["show", "--pretty=format:", "--patch", commit], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (show.status !== 0 || !show.stdout.trim()) return null;
  const id = spawnSync("git", ["patch-id", "--stable"], { cwd: root, encoding: "utf8", input: show.stdout, maxBuffer: 32 * 1024 * 1024 });
  return id.status === 0 ? id.stdout.trim().split(/\s+/)[0] || null : null;
}

const mainPatchIds = buildMainPatchIds();
const commits = unique(git(["rev-list", "--branches", "--remotes", "--tags", "--not", "main"]).split(/\r?\n/));
commits.sort((a, b) => Number(git(["show", "-s", "--format=%ct", b])) - Number(git(["show", "-s", "--format=%ct", a])));

const rows = commits.map((sha) => {
  const meta = git(["show", "-s", "--format=%aI%x00%an%x00%s", sha]).split("\0");
  const files = unique(git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", sha]).split(/\r?\n/));
  const name = safeGit(["name-rev", "--name-only", "--no-undefined", "--refs=refs/heads/*", "--refs=refs/remotes/origin/*", "--refs=refs/tags/*", sha]);
  const refName = name.ok ? name.value.replace(/^remotes\//, "") : "ref indirecta";
  const rule = classify(sha, files, meta[2], refName, mainPatchIds.has(patchId(sha)));
  return { sha, date: meta[0], author: meta[1], message: meta[2], files, refName, area: inferArea(files, meta[2], refName), ...rule };
});

const classificationCounts = Object.entries(rows.reduce((acc, row) => ((acc[row.cls] = (acc[row.cls] || 0) + 1), acc), {}));
let ledger = `# GIT LEDGER — freeze pre ERP hardening\n\n`;
ledger += `**Baseline autorizado:** \`${baseline}\`\n\n`;
ledger += `**Tag local:** \`baseline-pre-erp-hardening-2026-09-30\`\n\n`;
ledger += `**Universo:** commits alcanzables desde ramas locales, referencias \`origin/*\` cacheadas y tags, excluyendo todo commit ya alcanzable desde \`main\`. Los stashes se registran aparte.\n\n`;
ledger += `**Total fuera de main:** ${rows.length} commits.\n\n`;
ledger += `## Resumen de clasificación\n\n`;
ledger += classificationCounts.map(([key, value]) => `- ${key}: ${value}`).join("\n") + "\n\n";
ledger += `Los estados válidos son \`ABSORBED\`, \`SUPERSEDED\`, \`REJECTED\` o \`PENDING REVIEW\`. Un estado pendiente no autoriza cherry-pick, merge ni aplicación de stash.\n\n`;
ledger += `## Commit ledger\n\n`;
ledger += `| SHA | Branch/ref | Fecha | Autor | Mensaje | Archivos | Área | ¿Existe equivalente en main? | Clasificación | Acción | Batch destino | Estado |\n`;
ledger += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const row of rows) {
  ledger += `| \`${row.sha}\` | ${md(row.refName)} | ${md(row.date)} | ${md(row.author)} | ${md(row.message)} | ${md(row.files.length ? row.files.join(";<br>") : "(sin delta de archivos)")} | ${md(row.area)} | ${md(row.eq)} | ${md(row.cls)} | ${md(row.action)} | ${md(row.batch)} | ${md(row.status)} |\n`;
}

const stashPolicies = [
  { functionality: "Archivos de instrucciones generados en recovery", exists: "Sí/Parcial", unique: "No", decision: "REJECTED — no aplicar; conservar hasta limpieza final" },
  { functionality: "Auditoría de supervivencia + pack de datos/fixtures NIU", exists: "Parcial", unique: "Sí: fixtures y documentos", decision: "PENDING REVIEW — batch de datos/fixtures; nunca aplicar completo" },
  { functionality: "Ajustes visuales menores del dashboard", exists: "Sí, UI posterior", unique: "No confirmado", decision: "SUPERSEDED — no aplicar" },
  { functionality: "Clima, días laborables y conexión de forecast", exists: "Parcial", unique: "Sí", decision: "PENDING REVIEW — batch/04-planning-bim; rescate por hunk" },
  { functionality: "Reorganización/actualización de manuales HTML", exists: "Parcial", unique: "No confirmado", decision: "PENDING REVIEW — batch/09-docs; comparar documento por documento" },
  { functionality: "Fixtures BIM, HTML y reportes adversariales", exists: "Parcial", unique: "Sí", decision: "PENDING REVIEW — batch/04-planning-bim; rescatar archivos exactos" },
  { functionality: "Experimento no aprobado de prompt BIM", exists: "No", unique: "Sí, 4 líneas", decision: "REJECTED — experimento no aprobado" },
  { functionality: "Dataset de modificaciones DNCP descubiertas", exists: "No confirmado", unique: "Sí", decision: "PENDING REVIEW — batch/07-tenders; validar origen/licencia" },
];

ledger += `\n## STASH LEDGER\n\n`;
ledger += `Prohibición vigente: no ejecutar \`git stash pop\` ni \`git stash apply\` durante un batch sin autorización explícita y actualización previa de este ledger.\n\n`;
ledger += `| Índice | SHA stash | Commit base | Fecha | Archivos | Diff resumido | Funcionalidad | ¿Ya existe en main? | ¿Pieza única? | Decisión |\n`;
ledger += `|---|---|---|---|---|---|---|---|---|---|\n`;
const stashLines = git(["stash", "list", "--format=%gd%x00%H%x00%ci%x00%s"]).split(/\r?\n/).filter(Boolean);
stashLines.forEach((line, index) => {
  const [ref, sha, date, subject] = line.split("\0");
  const base = git(["rev-parse", `${ref}^1`]);
  const files = unique(safeGit(["stash", "show", "--name-only", "--include-untracked", ref]).value.split(/\r?\n/));
  const shortstat = safeGit(["stash", "show", "--shortstat", "--include-untracked", ref]).value || "sin estadística";
  const policy = stashPolicies[index] ?? { functionality: subject, exists: "No confirmado", unique: "No confirmado", decision: "PENDING REVIEW — sin aplicar" };
  ledger += `| \`${ref}\` | \`${sha}\` | \`${base}\` | ${md(date)} | ${md(files.join(";<br>"))} | ${md(shortstat)} | ${md(policy.functionality)} | ${md(policy.exists)} | ${md(policy.unique)} | ${md(policy.decision)} |\n`;
});

ledger += `\n## WORKTREE LEDGER\n\n`;
ledger += `No se borró ningún worktree. Los commits exclusivos se cuentan contra el baseline/main actual.\n\n`;
ledger += `| Ruta | Branch | HEAD | Estado | Commits exclusivos | Untracked | Propósito histórico | Decisión |\n`;
ledger += `|---|---|---|---|---:|---|---|---|\n`;
const worktreeText = git(["worktree", "list", "--porcelain"]);
const worktreeBlocks = worktreeText.split(/\r?\n\r?\n/).filter(Boolean);
for (const block of worktreeBlocks) {
  const values = Object.fromEntries(block.split(/\r?\n/).map((line) => {
    const at = line.indexOf(" ");
    return at === -1 ? [line, true] : [line.slice(0, at), line.slice(at + 1)];
  }));
  const wtPath = values.worktree;
  const branch = values.branch ? String(values.branch).replace("refs/heads/", "") : "DETACHED";
  const status = safeGit(["status", "--short"], { cwd: wtPath });
  const exclusive = safeGit(["rev-list", "--count", `${baseline}..${values.HEAD}`]);
  const untracked = status.ok ? status.value.split(/\r?\n/).filter((line) => line.startsWith("??")).map((line) => line.slice(3)) : [];
  const dirty = status.ok ? (status.value ? `SUCIO — ${status.value.split(/\r?\n/).filter(Boolean).length} entradas` : "LIMPIO") : `NO VERIFICABLE — ${status.value}`;
  const purpose = branch === "main" ? "Checkout principal" : branch === "DETACHED" ? "Auditoría/inspección detached" : branch.replaceAll("/", " → ");
  const decision = branch === "main" ? "PRESERVAR — checkout activo; no limpiar" : "PRESERVAR CLASIFICADO — no borrar hasta cierre definitivo";
  ledger += `| ${md(wtPath)} | ${md(branch)} | \`${values.HEAD}\` | ${md(dirty)} | ${md(exclusive.ok ? exclusive.value : "no verificable")} | ${md(untracked.length ? untracked.join(";<br>") : "—")} | ${md(purpose)} | ${md(decision)} |\n`;
}

ledger += `\n## Reglas de cierre\n\n`;
ledger += `- Las ramas \`recovery/erp-functional-rebuild\` y \`recovery/restore-legacy-surface-contract\` no pueden mergearse ni cherry-pickearse por rango.\n`;
ledger += `- Todo rescate debe aparecer primero en \`RESCUE-ALLOWLIST.md\`, con commit, archivo o hunk exacto y batch destino.\n`;
ledger += `- No borrar ramas, worktrees ni stashes hasta que no quede ningún \`PENDING REVIEW\`.\n`;
ledger += `- Después de absorber una pieza, reemplazar su estado por \`ABSORBED BY <SHA>\`; si queda superada, usar \`SUPERSEDED BY <SHA/path>\`; si se descarta, registrar el motivo.\n`;

writeFileSync(path.join(root, "GIT-LEDGER.md"), ledger, "utf8");
