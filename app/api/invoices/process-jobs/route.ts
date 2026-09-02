import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainInvoiceJobs } from "@/lib/invoice-job-runner";

// El parseo de fotos/PDF con OpenAI puede pasarse del timeout serverless
// default (10s en el plan Hobby de Vercel).
export const maxDuration = 60;

/**
 * Drena la cola de invoice_jobs. Lo llama:
 *  - la pantalla de Carga masiva mientras hay jobs pendientes (POST, con sesión)
 *  - un cron de Vercel como respaldo si el que subió cerró la pestaña (GET,
 *    autenticado con CRON_SECRET)
 *
 * `claim_invoice_job` usa `for update skip locked`, así que varias llamadas
 * concurrentes no pisan el mismo job.
 */
export async function POST() {
  await requireProfile(["administracion", "admin"]);
  const result = await drainInvoiceJobs(createAdminClient(), { maxMs: 45_000 });
  return Response.json(result);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await drainInvoiceJobs(createAdminClient(), { maxMs: 45_000 });
  return Response.json(result);
}
