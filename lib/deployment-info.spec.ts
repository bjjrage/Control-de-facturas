import { describe, expect, it } from "vitest";
import { deploymentInfo } from "./deployment-info";

describe("release environment identity", () => {
  it("does not label a preview connected to production as safe QA", () => {
    expect(deploymentInfo({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://ezucivipgmbvamhugkbj.supabase.co" })).toMatchObject({ database: "production", valid: false });
  });
  it("requires the known QA database for a preview", () => {
    expect(deploymentInfo({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://kyiihlkncatojvlasoag.supabase.co" })).toMatchObject({ database: "qa", valid: true });
    expect(deploymentInfo({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://unknown.supabase.co" }).valid).toBe(false);
  });
  it("rejects production pointed at QA and malformed data source URLs", () => {
    expect(deploymentInfo({ VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://kyiihlkncatojvlasoag.supabase.co" }).valid).toBe(false);
    expect(deploymentInfo({ VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "invalid" }).valid).toBe(false);
  });
  it("returns only public metadata and an actual full commit SHA", () => {
    const info = deploymentInfo({ VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://ezucivipgmbvamhugkbj.supabase.co", VERCEL_GIT_COMMIT_SHA: "a".repeat(40), SUPABASE_SERVICE_ROLE_KEY: "must-not-leak" });
    expect(info).toEqual({ environment: "production", database: "production", commit: "a".repeat(40), valid: true });
    expect(deploymentInfo({ VERCEL_GIT_COMMIT_SHA: "main" }).commit).toBeNull();
  });
});
