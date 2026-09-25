import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const tenderPage = read("app/(internal)/licitaciones/[id]/page.tsx");
const auctionBot = read("app/(internal)/licitaciones/auction-bot/auction-bot-client.tsx");
const auctionLabPage = read("app/(internal)/licitaciones/auction-lab/page.tsx");
const auctionLabOperator = read("app/(internal)/licitaciones/auction-lab/[roomId]/operator-console.tsx");

describe("Batch 7 honest tender and auction surfaces", () => {
  it("distinguishes generic pre-evaluation from PBC-backed documentary readiness", () => {
    expect(tenderPage).toContain("PBC NO ANALIZADO");
    expect(tenderPage).toContain("REQUISITOS GENÉRICOS");
    expect(tenderPage).toContain("NO USAR COMO VALIDACIÓN DOCUMENTAL");
    expect(tenderPage).toContain("RE-EVALUAR CON EL PBC ACTUAL");
  });

  it("labels Auction Bot and Auction Lab as simulation-only at operator entry points", () => {
    expect(auctionBot).toContain("SBE Auction Bot V0 · Simulador");
    expect(auctionBot).toContain("No se conecta a DNCP ni envía ofertas reales.");
    expect(auctionLabPage).toContain("Simulación — no es DNCP real.");
    expect(auctionLabOperator).toContain("SIMULACIÓN · NO OPERA EN DNCP");
  });
});
