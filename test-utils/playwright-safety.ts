import { loadEnvConfig } from "@next/env";
import { assertNonProductionTestTarget } from "./external-test-target";

/** Load the exact environment Next.js dev uses before guarding E2E targets. */
export function loadPlaywrightTestEnvironment() {
  if (process.env.NODE_ENV?.toLowerCase() === "production") {
    throw new Error("Playwright cannot run with NODE_ENV=production.");
  }
  if (!Reflect.set(process.env, "NODE_ENV", "development")) {
    throw new Error("Could not set NODE_ENV=development for the local E2E server.");
  }
  loadEnvConfig(process.cwd(), true);
}

/** E2E suites must own the local app process so its validated DB config is the one under test. */
export function createGuardedLocalWebServer(baseUrl: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`${label}: application URL is invalid; refusing to run E2E.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const loopback =
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) ||
    hostname.endsWith(".localhost");
  if (parsed.protocol !== "http:" || !loopback) {
    throw new Error(`${label}: E2E application target must be HTTP loopback; remote targets are disabled.`);
  }

  assertNonProductionTestTarget({ url: baseUrl, label });
  const port = parsed.port || "3000";
  return {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: parsed.origin,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}
