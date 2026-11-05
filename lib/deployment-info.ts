/**
 * Public release identity only. Never return credentials or the environment object.
 * Check the actual data source, rather than inferring QA from an alias.
 */
export function deploymentInfo(env: Record<string, string | undefined> = process.env) {
  const environment = env.VERCEL_ENV ?? "development";
  let hostname = "";
  try { hostname = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch {}
  const database = hostname === "kyiihlkncatojvlasoag.supabase.co" ? "qa"
    : hostname === "ezucivipgmbvamhugkbj.supabase.co" ? "production"
    : ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) ? "local" : "unknown";
  const commit = /^[a-f0-9]{40}$/i.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
    ? env.VERCEL_GIT_COMMIT_SHA! : null;
  const valid = environment === "production" ? database === "production"
    : environment === "preview" ? database === "qa"
    : environment === "development" && (database === "qa" || database === "local");
  return { environment, database, commit, valid };
}
