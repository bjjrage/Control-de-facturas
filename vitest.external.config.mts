import { defineConfig } from "vitest/config";
import path from "path";
import { assertNonProductionTestTarget } from "./test-utils/external-test-target";

const candidates = [
  process.env.TEST_SUPABASE_URL,
  process.env.SUPABASE_TEST_URL,
  process.env.TEST_DATABASE_URL,
  process.env.TEST_SUPABASE_PROJECT_REF,
].filter((candidate): candidate is string => Boolean(candidate?.trim()));

if (candidates.length === 0) {
  throw new Error(
    "External tests require TEST_SUPABASE_URL, SUPABASE_TEST_URL, TEST_DATABASE_URL, or TEST_SUPABASE_PROJECT_REF.",
  );
}

for (const target of candidates) {
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
  assertNonProductionTestTarget(
    isUrl
      ? { url: target, label: "Vitest external test target" }
      : { projectRef: target, label: "Vitest external test target" },
  );
}

export default defineConfig({
  test: {
    include: [
      "lib/procurement/regression-currency-precedence.test.ts",
      "test/mrp-rpc-live.test.ts",
      "test/mrp-lifecycle-live.test.ts",
      "test/weekly-plan-rls-auth.test.ts",
      "test/weekly-plan-atomic-db.test.ts",
      "test/climate-workdays-rls-auth.test.ts",
    ],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
