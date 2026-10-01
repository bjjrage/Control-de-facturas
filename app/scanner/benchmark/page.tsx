"use client";

import { useEffect, useState } from "react";
import { runScannerEngineBenchmark } from "@/lib/scanner/scanner-ab-benchmark";

export default function ScannerBenchmarkPage() {
  const [output, setOutput] = useState<unknown>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void runScannerEngineBenchmark(
      () => cancelled,
      (progress) => {
        if (!cancelled) setOutput(progress);
      }
    )
      .then((result) => {
        if (!cancelled) setOutput(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOutput({
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="text-lg font-semibold">Scanner engine A/B benchmark</h1>
      <p className="mt-2 text-sm text-slate-400">
        Deterministic synthetic fixtures, rendered once and processed by both engines. Physical camera photos are not included.
      </p>
      <pre
        id="scanner-benchmark-output"
        className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-xs text-emerald-300"
      >
        {JSON.stringify(output, null, 2)}
      </pre>
    </main>
  );
}
