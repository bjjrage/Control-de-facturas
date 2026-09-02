/**
 * Worker standalone de parseo de facturas (opcional).
 *
 * NO es necesario para que el bulk funcione: la app ya drena la cola sola vía
 * `/api/invoices/process-jobs` (la dispara la pantalla de Carga masiva mientras
 * hay jobs pendientes, y un cron de Vercel como respaldo). Este proceso existe
 * para quien prefiera un worker siempre prendido (Railway/Fly/etc.): hace
 * polling de `invoice_jobs` cada POLL_MS y procesa de a uno.
 *
 *   npm run worker
 *
 * La lógica de extracción / lookup / match se reutiliza de lib/ tal cual.
 */
import { config } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { processInvoiceJob, InvoiceJobRow } from "../lib/invoice-job-runner";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2500);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY");
  process.exit(1);
}

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function main() {
  log(`worker arrancado — polling cada ${POLL_MS}ms`);
  while (!stopping) {
    let job: InvoiceJobRow | null = null;
    try {
      const { data, error } = await db.rpc("claim_invoice_job");
      if (error) log("claim error:", error.message);
      else job = data && data.id ? (data as InvoiceJobRow) : null;
    } catch (e) {
      log("claim throw:", (e as Error).message);
    }

    if (!job) { await sleep(POLL_MS); continue; }

    log(`job ${job.id} — ${job.file_name} (intento ${job.attempts})`);
    try {
      await processInvoiceJob(db, job);
    } catch (e) {
      log(`job ${job.id} throw:`, (e as Error).message);
      await db.from("invoice_jobs").update({ status: "failed", locked_at: null, error: (e as Error).message ?? "error inesperado" }).eq("id", job.id);
    }
  }
  log("worker detenido");
  process.exit(0);
}

main();
