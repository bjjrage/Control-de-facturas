// Entrada compatible: el catálogo actual genera ambos HTML y valida su cobertura.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

execFileSync(process.execPath, [resolve(process.cwd(), "scripts/docs/generate-app-guides.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
