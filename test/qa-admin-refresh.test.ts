import "next/dist/server/node-environment-baseline";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { refreshAfterSave } from "../lib/refresh-after-save";

describe("QA ADMIN common save invalidation", () => {
  it.each(["/providers", "/projects", "/projects/qa-budget", "/projects/qa-certificate"])(
    "invalidates %s and requests a dynamic router update using the real Next API", path => {
      const store = { page: `${path}/page`, route: path, incrementalCache: {}, cacheLifeProfiles: {} } as unknown as WorkStore;
      workAsyncStorage.run(store, () => workUnitAsyncStorage.run({ type: "request", phase: "action" } as never, () => {
        refreshAfterSave(path, path);
      }));
      expect(store.pendingRevalidatedTags).toHaveLength(1);
      expect(store.pendingRevalidatedTags?.[0].tag).toContain(path);
      expect(store.pathWasRevalidated).toBeDefined();
    },
  );
  it("cannot be used outside a Server Action", () => {
    expect(() => refreshAfterSave("/providers")).toThrow();
  });
  it("synchronizes keep-alive sections when an RSC response changes without navigation", () => {
    const shell = readFileSync("components/layout/app-shell-client.tsx", "utf8");
    expect(shell).toContain("[pathname, children]");
  });
  it.each([
    ["app/(internal)/providers/actions.ts", 'refreshAfterSave("/providers")'],
    ["app/(internal)/projects/actions.ts", 'refreshAfterSave("/projects")'],
    ["app/(internal)/projects/actions.ts", 'refreshAfterSave(`/projects/${projectId}`, "/projects")'],
    ["app/(internal)/projects/certificado-actions.ts", 'refreshAfterSave(`/projects/${projectId}`, "/projects")'],
  ])("uses the shared success mechanism in %s", (file, expected) => {
    expect(readFileSync(file, "utf8")).toContain(expected);
  });
});
