import { loadEnvConfig } from "@next/env";
import { assertNonProductionTestTarget } from "./external-test-target";

export type PlaywrightServerMode = "development" | "production";

/** Load the environment file precedence used by the selected local Next.js server mode. */
export function loadPlaywrightTestEnvironment(
  serverMode: PlaywrightServerMode = "development",
) {
  if (process.env.NODE_ENV?.toLowerCase() === "production") {
    throw new Error("Playwright cannot run with NODE_ENV=production.");
  }
  if (!Reflect.set(process.env, "NODE_ENV", "development")) {
    throw new Error("Could not set NODE_ENV=development for the local E2E server.");
  }
  loadEnvConfig(process.cwd(), serverMode === "development");
}

/** E2E suites must own the local app process so its validated DB config is the one under test. */
export function createGuardedLocalWebServer(
  baseUrl: string,
  label: string,
  options: { serverMode?: PlaywrightServerMode } = {},
) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`${label}: application URL is invalid; refusing to run E2E.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const loopback =
    ["localhost", "127.0.0.1"].includes(hostname) || hostname.endsWith(".localhost");
  if (parsed.protocol !== "http:" || !loopback) {
    throw new Error(`${label}: E2E application target must be HTTP loopback; remote targets are disabled.`);
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(label + ": application target must be an origin without a path, query, or fragment.");
  }

  assertNonProductionTestTarget({ url: baseUrl, label });
  const port = parsed.port || "3000";
  const canonicalBaseURL = "http://127.0.0.1:" + port;
  const serverMode = options.serverMode ?? "development";
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.NODE_ENV = serverMode;

  return {
    // Keep Playwright navigation on the exact host/port served by this child process.
    baseURL: canonicalBaseURL,
    command:
      serverMode === "production"
        ? `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`
        : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env,
    reuseExistingServer: false,
    wait: { stdout: new RegExp(`- Local:\\s+http://127\\.0\\.0\\.1:${port}(?:\\s|$)`) },
    timeout: serverMode === "production" ? 600_000 : 120_000,
  };
}
