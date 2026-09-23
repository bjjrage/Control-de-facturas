"use client";

import { useEffect, useState } from "react";
import { detectDocumentFromRgba } from "@/lib/scanner/document-detector";
import { detectDocumentV2 } from "@/lib/scanner/document-detector-v2";
import { evaluateScannerDetection, summarizeScannerBenchmark } from "@/lib/scanner/scanner-benchmark";
import { loadOpenCv } from "@/lib/scanner/opencv-loader";
import type { OpenCvRuntime } from "@/lib/scanner/opencv-types";
import type { QuadPoints } from "@/lib/scanner/types";

function createSyntheticFixture(expectedQuad: QuadPoints, lightBackground: boolean, shadow: boolean) {
  const width = 640;
  const height = 480;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D no disponible");

  context.fillStyle = lightBackground ? "rgb(174, 160, 142)" : "rgb(32, 32, 32)";
  context.fillRect(0, 0, width, height);
  context.beginPath();
  context.moveTo(expectedQuad.topLeft.x, expectedQuad.topLeft.y);
  context.lineTo(expectedQuad.topRight.x, expectedQuad.topRight.y);
  context.lineTo(expectedQuad.bottomRight.x, expectedQuad.bottomRight.y);
  context.lineTo(expectedQuad.bottomLeft.x, expectedQuad.bottomLeft.y);
  context.closePath();
  context.fillStyle = "rgb(244, 244, 244)";
  context.fill();
  if (shadow) {
    context.save();
    context.beginPath();
    context.rect(70, 260, 500, 150);
    context.clip();
    context.fillStyle = "rgba(35, 35, 35, 0.34)";
    context.fillRect(0, 230, width, 210);
    context.restore();
  }
  return { width, height, imageData: context.getImageData(0, 0, width, height), expectedQuad };
}

const fixtures = [
  {
    name: "white-paper-dark-table",
    quad: { topLeft: { x: 80, y: 50 }, topRight: { x: 560, y: 70 }, bottomRight: { x: 580, y: 430 }, bottomLeft: { x: 60, y: 410 } },
    lightBackground: false,
    shadow: false,
  },
  {
    name: "white-paper-light-table",
    quad: { topLeft: { x: 100, y: 60 }, topRight: { x: 540, y: 82 }, bottomRight: { x: 560, y: 420 }, bottomLeft: { x: 80, y: 398 } },
    lightBackground: true,
    shadow: false,
  },
  {
    name: "shadow-across-document",
    quad: { topLeft: { x: 70, y: 42 }, topRight: { x: 565, y: 68 }, bottomRight: { x: 580, y: 435 }, bottomLeft: { x: 56, y: 410 } },
    lightBackground: false,
    shadow: true,
  },
];

export default function ScannerBenchmarkPage() {
  const [output, setOutput] = useState<unknown>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const cv = await loadOpenCv();
        const v1Rows = [];
        const v2Rows = [];
        for (const fixture of fixtures) {
          const image = createSyntheticFixture(fixture.quad, fixture.lightBackground, fixture.shadow);
          const v1Started = performance.now();
          const v1 = detectDocumentFromRgba(image.imageData.data, image.width, image.height);
          v1Rows.push(
            evaluateScannerDetection(
              image.expectedQuad,
              { quad: v1.quad, isFallback: v1.isFallback, processingMs: performance.now() - v1Started },
              image.width,
              image.height
            )
          );

          const v2Started = performance.now();
          const v2 = detectDocumentV2(image.imageData, cv as OpenCvRuntime, { mode: "quality", maxDimension: 1280 });
          v2Rows.push(
            evaluateScannerDetection(
              image.expectedQuad,
              { quad: v2.quad, isFallback: v2.isFallback, processingMs: performance.now() - v2Started },
              image.width,
              image.height
            )
          );
        }
        if (!cancelled) {
          setOutput({
            status: "ready",
            runtime: "OpenCV.js",
            v1: summarizeScannerBenchmark(v1Rows),
            v2: summarizeScannerBenchmark(v2Rows),
          });
        }
      } catch (error) {
        if (!cancelled) setOutput({ status: "opencv-failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="text-lg font-semibold">Scanner detection benchmark</h1>
      <p className="mt-2 text-sm text-slate-400">Synthetic fixtures only. No private images are loaded.</p>
      <pre id="scanner-benchmark-output" className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-xs text-emerald-300">
        {JSON.stringify(output, null, 2)}
      </pre>
    </main>
  );
}
