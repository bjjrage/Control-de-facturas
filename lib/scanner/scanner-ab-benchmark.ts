"use client";

import { summarizeScannerABBenchmark, type ScannerABBenchmarkSample } from './scanner-benchmark';
import type { Point2D, QuadPoints } from './types';

interface FixtureSpec {
  name: string;
  quad: QuadPoints | null;
  background: string;
  paper: string;
  shadow?: boolean;
  clutter?: boolean;
  receipt?: boolean;
  secondDocument?: QuadPoints;
}

const quad = (points: [Point2D, Point2D, Point2D, Point2D]): QuadPoints => ({
  topLeft: points[0],
  topRight: points[1],
  bottomRight: points[2],
  bottomLeft: points[3],
});

const fixtures: FixtureSpec[] = [
  { name: 'hoja-blanca-mesa-oscura', quad: quad([{ x: 82, y: 46 }, { x: 558, y: 70 }, { x: 572, y: 427 }, { x: 61, y: 410 }]), background: 'rgb(34, 34, 38)', paper: 'rgb(246, 246, 242)' },
  { name: 'hoja-blanca-mesa-clara', quad: quad([{ x: 92, y: 58 }, { x: 545, y: 78 }, { x: 559, y: 420 }, { x: 77, y: 398 }]), background: 'rgb(190, 179, 164)', paper: 'rgb(246, 246, 243)' },
  { name: 'recibo', quad: quad([{ x: 220, y: 18 }, { x: 406, y: 30 }, { x: 422, y: 461 }, { x: 207, y: 450 }]), background: 'rgb(48, 48, 50)', paper: 'rgb(239, 237, 228)', receipt: true },
  { name: 'factura-a4', quad: quad([{ x: 178, y: 18 }, { x: 453, y: 22 }, { x: 470, y: 458 }, { x: 163, y: 452 }]), background: 'rgb(52, 52, 55)', paper: 'rgb(247, 247, 244)' },
  { name: 'perspectiva-fuerte', quad: quad([{ x: 156, y: 26 }, { x: 568, y: 105 }, { x: 477, y: 454 }, { x: 52, y: 361 }]), background: 'rgb(39, 41, 45)', paper: 'rgb(244, 244, 240)' },
  { name: 'sombra', quad: quad([{ x: 73, y: 42 }, { x: 565, y: 67 }, { x: 579, y: 435 }, { x: 56, y: 409 }]), background: 'rgb(35, 35, 38)', paper: 'rgb(246, 246, 242)', shadow: true },
  { name: 'poca-luz', quad: quad([{ x: 89, y: 48 }, { x: 554, y: 72 }, { x: 568, y: 424 }, { x: 66, y: 405 }]), background: 'rgb(13, 14, 17)', paper: 'rgb(105, 106, 101)' },
  { name: 'fondo-cargado', quad: quad([{ x: 88, y: 48 }, { x: 552, y: 74 }, { x: 566, y: 423 }, { x: 66, y: 404 }]), background: 'rgb(116, 105, 91)', paper: 'rgb(241, 240, 235)', clutter: true },
  { name: 'documento-parcialmente-visible', quad: quad([{ x: -38, y: -22 }, { x: 428, y: 24 }, { x: 467, y: 424 }, { x: -23, y: 390 }]), background: 'rgb(33, 34, 37)', paper: 'rgb(244, 244, 241)' },
  { name: 'documento-cerca-del-borde', quad: quad([{ x: 3, y: 5 }, { x: 580, y: 18 }, { x: 630, y: 461 }, { x: 11, y: 454 }]), background: 'rgb(40, 41, 43)', paper: 'rgb(245, 245, 242)' },
  { name: 'rotacion', quad: quad([{ x: 154, y: 69 }, { x: 534, y: 178 }, { x: 442, y: 423 }, { x: 62, y: 314 }]), background: 'rgb(36, 36, 40)', paper: 'rgb(246, 245, 241)' },
  { name: 'bajo-contraste', quad: quad([{ x: 81, y: 46 }, { x: 558, y: 70 }, { x: 572, y: 427 }, { x: 61, y: 410 }]), background: 'rgb(217, 216, 211)', paper: 'rgb(232, 231, 226)' },
  { name: 'dos-documentos', quad: quad([{ x: 158, y: 32 }, { x: 572, y: 66 }, { x: 585, y: 440 }, { x: 129, y: 415 }]), background: 'rgb(37, 37, 39)', paper: 'rgb(245, 245, 241)', secondDocument: quad([{ x: 16, y: 181 }, { x: 170, y: 193 }, { x: 177, y: 427 }, { x: 7, y: 414 }]) },
  { name: 'sin-documento-falso-positivo', quad: null, background: 'rgb(56, 58, 61)', paper: 'rgb(56, 58, 61)', clutter: true },
];

function yieldToBrowserFrame(): Promise<void> {
  // A timer yields to React and browser input even in headless/background tabs,
  // where requestAnimationFrame can be throttled indefinitely.
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function drawPath(context: CanvasRenderingContext2D, points: QuadPoints) {
  context.beginPath();
  context.moveTo(points.topLeft.x, points.topLeft.y);
  context.lineTo(points.topRight.x, points.topRight.y);
  context.lineTo(points.bottomRight.x, points.bottomRight.y);
  context.lineTo(points.bottomLeft.x, points.bottomLeft.y);
  context.closePath();
}

function drawPaper(context: CanvasRenderingContext2D, points: QuadPoints, color: string, receipt = false) {
  context.save();
  drawPath(context, points);
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = 10;
  context.shadowOffsetX = 4;
  context.shadowOffsetY = 5;
  context.fillStyle = color;
  context.fill();
  context.restore();

  context.save();
  drawPath(context, points);
  context.clip();
  context.strokeStyle = 'rgba(48, 52, 56, 0.48)';
  context.lineWidth = receipt ? 2 : 1;
  const left = Math.min(points.topLeft.x, points.bottomLeft.x);
  const right = Math.max(points.topRight.x, points.bottomRight.x);
  const top = Math.min(points.topLeft.y, points.topRight.y);
  const bottom = Math.max(points.bottomLeft.y, points.bottomRight.y);
  const count = receipt ? 34 : 17;
  for (let index = 1; index <= count; index++) {
    const y = top + ((bottom - top) * index) / (count + 1);
    context.beginPath();
    context.moveTo(left + 18, y);
    context.lineTo(left + (right - left) * (index % 4 === 0 ? 0.52 : 0.78), y);
    context.stroke();
  }
  context.restore();
}

function renderFixture(spec: FixtureSpec) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D no disponible');
  context.fillStyle = spec.background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (spec.clutter) {
    context.strokeStyle = 'rgba(14, 18, 23, 0.35)';
    context.lineWidth = 2;
    for (let x = 12; x < canvas.width; x += 38) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 35, canvas.height);
      context.stroke();
    }
    for (let y = 15; y < canvas.height; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y - 25);
      context.stroke();
    }
  }
  if (spec.secondDocument) drawPaper(context, spec.secondDocument, 'rgb(227, 227, 222)');
  if (spec.quad) drawPaper(context, spec.quad, spec.paper, spec.receipt);
  if (spec.shadow && spec.quad) {
    context.save();
    drawPath(context, spec.quad);
    context.clip();
    context.fillStyle = 'rgba(18, 21, 26, 0.4)';
    context.fillRect(0, 0, canvas.width, canvas.height * 0.54);
    context.restore();
  }
  return { imageData: context.getImageData(0, 0, canvas.width, canvas.height), quad: spec.quad };
}

function sample(
  spec: FixtureSpec,
  detectedQuad: QuadPoints | null,
  processingMs: number,
  fallback: boolean
): ScannerABBenchmarkSample {
  return {
    name: spec.name,
    width: 640,
    height: 480,
    expectedQuad: spec.quad,
    detectedQuad,
    detected: detectedQuad !== null,
    fallback,
    processingMs,
  };
}

export async function runScannerEngineBenchmark(
  isCancelled: () => boolean = () => false,
  onProgress: (progress: Record<string, unknown>) => void = () => {}
) {
  let worker: Worker | null = null;
  let nextRequestId = 0;

  const requestWorker = <T,>(payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> => {
    if (!worker) return Promise.reject(new Error('Scanner benchmark worker is not initialized'));
    const activeWorker = worker;
    const id = ++nextRequestId;
    return new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        activeWorker.removeEventListener('message', onMessage);
        activeWorker.removeEventListener('error', onError);
        activeWorker.terminate();
        worker = null;
        reject(new Error(`Scanner benchmark worker timed out at ${String(payload.type)}`));
      }, 20_000);
      const onMessage = (event: MessageEvent<Record<string, unknown>>) => {
        if (event.data.id !== id) return;
        window.clearTimeout(timeoutId);
        activeWorker.removeEventListener('message', onMessage);
        activeWorker.removeEventListener('error', onError);
        if (event.data.type === 'error') {
          reject(new Error(String(event.data.error ?? 'Error en scanner benchmark worker')));
        } else {
          resolve(event.data as T);
        }
      };
      const onError = (event: ErrorEvent) => {
        window.clearTimeout(timeoutId);
        activeWorker.removeEventListener('message', onMessage);
        activeWorker.removeEventListener('error', onError);
        reject(new Error(event.message || 'Scanner benchmark worker failed'));
      };
      activeWorker.addEventListener('message', onMessage);
      activeWorker.addEventListener('error', onError);
      activeWorker.postMessage({ ...payload, id }, transfer);
    });
  };

  try {
    onProgress({ status: 'running', phase: 'opencv-initialize' });
    await yieldToBrowserFrame();
    if (isCancelled()) return { status: 'cancelled' as const };
    worker = new Worker(new URL('./scanner-ab-benchmark.worker.ts', import.meta.url), { type: 'classic' });
    const openCvInitialized = await requestWorker<{
      initializationMs: { openCvV2: number; scanic: number };
    }>({ type: 'initialize-opencv' });
    if (isCancelled()) return { status: 'cancelled' as const };
    onProgress({ status: 'running', phase: 'scanic-initialize' });
    await yieldToBrowserFrame();
    if (isCancelled()) return { status: 'cancelled' as const };
    const scanicInitialized = await requestWorker<{
      initializationMs: { openCvV2: number; scanic: number };
    }>({ type: 'initialize-scanic' });

    const openCvSamples: ScannerABBenchmarkSample[] = [];
    const scanicSamples: ScannerABBenchmarkSample[] = [];
    const scenarios: Array<Record<string, unknown>> = [];
    for (const [fixtureIndex, fixture] of fixtures.entries()) {
      if (isCancelled()) return { status: 'cancelled' as const };
      const image = renderFixture(fixture);
      onProgress({
        status: 'running',
        phase: 'worker-detect',
        current: fixtureIndex + 1,
        total: fixtures.length,
        name: fixture.name,
      });
      await yieldToBrowserFrame();
      if (isCancelled()) return { status: 'cancelled' as const };
      const result = await requestWorker<{
        openCvV2: { detected: boolean; quad: QuadPoints | null; confidence: number; processingMs: number };
        scanic: { detected: boolean; quad: QuadPoints | null; confidence: number; processingMs: number };
      }>({
        type: 'fixture',
        name: fixture.name,
        width: image.imageData.width,
        height: image.imageData.height,
        pixels: image.imageData.data.buffer,
        expectedQuad: fixture.quad,
      }, [image.imageData.data.buffer]);
      const { openCvV2: openCvResult, scanic: scanicResult } = result;
      openCvSamples.push(sample(fixture, openCvResult.detected ? openCvResult.quad : null, openCvResult.processingMs, !openCvResult.detected));
      scanicSamples.push(sample(fixture, scanicResult.detected ? scanicResult.quad : null, scanicResult.processingMs, !scanicResult.detected));

      scenarios.push({
        name: fixture.name,
        expectedDocument: fixture.quad !== null,
        openCvV2: {
          detected: openCvResult.detected,
          confidence: openCvResult.confidence,
          processingMs: Number(openCvResult.processingMs.toFixed(2)),
        },
        scanic: {
          detected: scanicResult.detected,
          confidence: scanicResult.confidence,
          processingMs: Number(scanicResult.processingMs.toFixed(2)),
        },
        autoFallbackWouldRun: !scanicResult.detected,
        openCvWouldRescue: !scanicResult.detected && openCvResult.detected,
      });
    }

    const fallbackCount = scanicSamples.filter((entry) => entry.fallback).length;
    return {
      status: 'ready' as const,
      dataset: {
        kind: 'deterministic-synthetic',
        dimensions: '640x480',
        fixtureCount: fixtures.length,
        scenarios: fixtures.map((entry) => entry.name),
        sameImageDataForBothEngines: true,
      },
      initializationMs: {
        openCvV2: Number(openCvInitialized.initializationMs.openCvV2.toFixed(2)),
        scanic: Number(scanicInitialized.initializationMs.scanic.toFixed(2)),
      },
      openCvV2: summarizeScannerABBenchmark(openCvSamples),
      scanic: summarizeScannerABBenchmark(scanicSamples),
      fallbackChain: {
        order: ['scanic', 'opencv-v2', 'v1'],
        scanicFallbackCount: fallbackCount,
        scanicFallbackRate: scanicSamples.length ? fallbackCount / scanicSamples.length : 0,
        rescuedByOpenCvV2Count: scenarios.filter((entry) => entry.openCvWouldRescue === true).length,
      },
      scenarios,
    };
  } finally {
    worker?.terminate();
  }
}
