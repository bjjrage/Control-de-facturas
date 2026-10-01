import { detectDocumentV2 } from './document-detector-v2';
import { ScanicDetectionEngine } from './scanic-detection-engine';
import type { OpenCvRuntime } from './opencv-types';
import type { QuadPoints } from './types';

const OPENCV_SRC = 'https://docs.opencv.org/4.13.0/opencv.js';

interface WorkerScope {
  cv?: OpenCvRuntime | Promise<OpenCvRuntime>;
  Module?: {
    onRuntimeInitialized?: () => void;
    [key: string]: unknown;
  };
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: unknown) => void;
  importScripts: (...urls: string[]) => void;
  setTimeout: typeof setTimeout;
}

interface RequestMessage {
  id: number;
  type: 'initialize-opencv' | 'initialize-scanic' | 'fixture';
  name?: string;
  width?: number;
  height?: number;
  pixels?: ArrayBuffer;
  expectedQuad?: QuadPoints | null;
}

const scope = self as unknown as WorkerScope;
let openCvPromise: Promise<OpenCvRuntime> | null = null;
let scanic: ScanicDetectionEngine | null = null;
let openCvInitializationMs = 0;

function now(): number {
  return performance.now();
}

function loadOpenCvInWorker(): Promise<OpenCvRuntime> {
  if (openCvPromise) return openCvPromise;
  if (scope.cv && typeof (scope.cv as OpenCvRuntime).Mat === 'function') {
    return Promise.resolve(scope.cv as OpenCvRuntime);
  }

  openCvPromise = new Promise<OpenCvRuntime>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled || !scope.cv) return;
    const directRuntime = scope.cv as OpenCvRuntime;
    if (typeof directRuntime.Mat === 'function') {
      settled = true;
      resolve(directRuntime);
      return;
    }
      Promise.resolve(scope.cv)
        .then((runtime) => {
          if (!runtime || typeof runtime.Mat !== 'function') throw new Error('OpenCV.js no expuso cv.Mat en Worker');
          settled = true;
          resolve(runtime);
        })
        .catch((error: unknown) => {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    };

    const previousModule = scope.Module ?? {};
    scope.Module = {
      ...previousModule,
      onRuntimeInitialized: () => {
        try {
          previousModule.onRuntimeInitialized?.();
        } finally {
          finish();
        }
      },
    };

    try {
      scope.importScripts(OPENCV_SRC);
      scope.setTimeout(finish, 0);
    } catch (error) {
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    scope.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('OpenCV.js excedió el tiempo de carga dentro del Worker'));
    }, 20_000);
  }).catch((error: unknown) => {
    openCvPromise = null;
    throw error;
  });

  return openCvPromise;
}

scope.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const request = event.data;
  try {
    if (request.type === 'initialize-opencv') {
      const openCvStarted = now();
      const cv = await loadOpenCvInWorker();
      openCvInitializationMs = now() - openCvStarted;
      scope.postMessage({
        id: request.id,
        type: 'opencv-initialized',
        initializationMs: { openCvV2: openCvInitializationMs },
        cvReady: Boolean(cv),
      });
      return;
    }

    if (request.type === 'initialize-scanic') {
      scanic ??= new ScanicDetectionEngine();
      await scanic.initialize();
      scope.postMessage({
        id: request.id,
        type: 'scanic-initialized',
        initializationMs: {
          openCvV2: openCvInitializationMs,
          scanic: scanic.initTimeMs,
        },
      });
      return;
    }

    const cv = await loadOpenCvInWorker();
    if (!scanic || !request.pixels || !request.width || !request.height) {
      throw new Error('Benchmark worker no inicializado o fixture incompleto');
    }
    const imageData = new ImageData(new Uint8ClampedArray(request.pixels), request.width, request.height);
    const openCvStarted = now();
    const openCvResult = detectDocumentV2(imageData, cv, { mode: 'quality', maxDimension: 1280 });
    const openCvMs = now() - openCvStarted;
    const scanicStarted = now();
    const scanicResult = await scanic.detectQuality({ imageData, cv });
    const scanicMs = now() - scanicStarted;
    const openCvDetected = !openCvResult.isFallback;
    const scanicDetected = Boolean(scanicResult && !scanicResult.isFallback);

    scope.postMessage({
      id: request.id,
      type: 'fixture-result',
      name: request.name,
      openCvV2: {
        detected: openCvDetected,
        quad: openCvDetected ? openCvResult.quad : null,
        confidence: openCvResult.confidence,
        processingMs: openCvMs,
      },
      scanic: {
        detected: scanicDetected,
        quad: scanicDetected ? scanicResult?.quad ?? null : null,
        confidence: scanicResult?.confidence ?? 0,
        processingMs: scanicMs,
      },
    });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
