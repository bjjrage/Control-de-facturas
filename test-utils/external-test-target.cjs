const PRODUCTION_SUPABASE_PROJECT_REF = "ezucivipgmbvamhugkbj";

const PRODUCTION_ENV_KEYS = [
  "APP_ENV",
  "DEPLOYMENT_ENV",
  "ENVIRONMENT",
  "NODE_ENV",
  "SUPABASE_ENV",
  "VERCEL_ENV",
];

const PRODUCTION_HOST_LABELS = new Set(["live", "prod", "production"]);
const LOCAL_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
]);

function projectRefFromUrl(url) {
  if (!url) return null;
  const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function isProductionHost(hostname) {
  if (!hostname) return false;
  return hostname
    .toLowerCase()
    .split(/[._-]+/)
    .some((label) => PRODUCTION_HOST_LABELS.has(label));
}

function isProductionTarget(url) {
  if (!url) return false;
  if (isProductionHost(url.hostname)) return true;
  const urlLabels = `${url.pathname} ${[...url.searchParams.keys(), ...url.searchParams.values()].join(" ")}`
    .toLowerCase()
    .split(/[\/_.-]+/)
    .map((label) => label.trim());
  return urlLabels.some((label) => PRODUCTION_HOST_LABELS.has(label));
}

function isLocalHost(hostname) {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return (
    LOCAL_HOSTS.has(normalized) ||
    normalized.endsWith(".localhost")
  );
}

function environmentIsProduction(env) {
  return PRODUCTION_ENV_KEYS.some((key) =>
    /^(live|prod|production)$/i.test((env[key] ?? "").trim()),
  );
}

/**
 * Fail closed before a test/seed opens a network connection. Local loopback
 * targets are allowed; every other target requires an explicit
 * opt-in, and a production target is rejected even with that opt-in.
 */
exports.assertNonProductionTestTarget = function assertNonProductionTestTarget({
  url,
  projectRef,
  label = "External test target",
  env = process.env,
}) {
  const normalizedUrl = url?.trim();
  const normalizedRef = projectRef?.trim().toLowerCase();
  if (!normalizedUrl && !normalizedRef) {
    throw new Error(`${label}: a test URL or project ref is required.`);
  }
  if (normalizedRef && !/^[a-z0-9]{20}$/.test(normalizedRef)) {
    throw new Error(`${label}: test project ref is invalid; refusing to connect.`);
  }

  let parsedUrl;
  if (normalizedUrl) {
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      throw new Error(`${label}: target URL is invalid; refusing to connect.`);
    }
  }

  const inferredRef = projectRefFromUrl(parsedUrl);
  const effectiveRef = normalizedRef ?? inferredRef;
  const targetHasProductionRef =
    effectiveRef === PRODUCTION_SUPABASE_PROJECT_REF ||
    normalizedUrl?.toLowerCase().includes(PRODUCTION_SUPABASE_PROJECT_REF) === true;

  if (targetHasProductionRef || isProductionTarget(parsedUrl)) {
    throw new Error(`${label}: production targets are always blocked.`);
  }

  if (environmentIsProduction(env)) {
    throw new Error(`${label}: runtime environment is marked as production.`);
  }

  if (isLocalHost(parsedUrl?.hostname)) return;

  if (env.ALLOW_EXTERNAL_TEST_DB !== "true") {
    throw new Error(
      `${label}: external targets are blocked; set ALLOW_EXTERNAL_TEST_DB=true only for an isolated non-production test target.`,
    );
  }
};
