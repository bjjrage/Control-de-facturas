import { detectDocumentQuad, type ImageDataSource } from './document-detector';
import { detectWithFallback, type DetectionPipelineResult } from './detection-pipeline';
import { OpenCvDetectionEngine } from './opencv-detection-engine';
import type { OpenCvRuntime } from './opencv-types';
import { ScanicDetectionEngine } from './scanic-detection-engine';
import type { ScannerEnginePreference } from './debug-store';
import { shouldUseScanicPrimary, shouldUseScanicPerspective } from './scanner-engine-policy';
import type { QuadPoints, ScannerDetectionMode } from './types';

export interface ScannerEnginePipelineInput {
  imageData: ImageDataSource;
  mode: ScannerDetectionMode;
  enginePreference: ScannerEnginePreference;
  scanicEngine?: ScanicDetectionEngine | null;
  cv: OpenCvRuntime | null;
  seedQuad?: QuadPoints | null;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function withFallbackReason(result: DetectionPipelineResult, reason: string): DetectionPipelineResult {
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      fallbackReason: [reason, result.diagnostics.fallbackReason].filter(Boolean).join(' -> '),
    },
  };
}

function withMode(engine: OpenCvDetectionEngine, input: ScannerEnginePipelineInput) {
  const engineInput = { imageData: input.imageData, cv: input.cv, seedQuad: input.seedQuad };
  if (input.mode === 'fast') return engine.detectFast(engineInput);
  if (input.mode === 'quality') return engine.detectQuality(engineInput);
  return engine.refineFinal(engineInput);
}

/**
 * Scanic is tried only when forced or when the benchmark gate enables it.
 * A miss/error follows the safety chain OpenCV V2 -> existing V1.
 */
export async function detectWithEngineFallback(
  input: ScannerEnginePipelineInput
): Promise<DetectionPipelineResult> {
  const preference = input.enginePreference;
  const shouldTryScanic = shouldUseScanicPrimary(preference);
  let scanicFallbackReason: string | null = null;

  if (preference === 'v1') {
    return detectWithFallback({ imageData: input.imageData, mode: input.mode, cv: null });
  }

  if (shouldTryScanic) {
    if (!input.scanicEngine) {
      scanicFallbackReason = 'scanic-not-ready';
    } else {
      const scanicInput = { imageData: input.imageData, cv: input.cv, seedQuad: input.seedQuad };
      try {
        const scanicResult =
          input.mode === 'fast'
            ? await input.scanicEngine.detectFast(scanicInput)
            : input.mode === 'quality'
              ? await input.scanicEngine.detectQuality(scanicInput)
              : await input.scanicEngine.refineFinal(scanicInput);
        if (scanicResult && !scanicResult.isFallback) return scanicResult;
        scanicFallbackReason = 'scanic-no-valid-candidate';
      } catch (error) {
        scanicFallbackReason = 'scanic-error:' + (error instanceof Error ? error.message : String(error));
      }
    }
  }

  const openCvEngine = new OpenCvDetectionEngine();
  try {
    const startedAt = now();
    const result = await withMode(openCvEngine, input);
    if (!result) {
      const v1 = detectDocumentQuad(input.imageData);
      return {
        ...v1,
        diagnostics: {
          detector: 'v1',
          engine: 'v1',
          mode: input.mode,
          processingMs: now() - startedAt,
          qualityPassAcceptable: !v1.isFallback && v1.confidence >= 0.62,
          fallbackReason: scanicFallbackReason ?? 'opencv-no-valid-candidate',
        },
      };
    }
    return scanicFallbackReason ? withFallbackReason(result, scanicFallbackReason) : result;
  } finally {
    openCvEngine.dispose();
  }
}

export async function extractPerspectiveWithEngineFallback(
  imageData: ImageData,
  quad: QuadPoints,
  preference: ScannerEnginePreference
): Promise<ImageData> {
  if (!shouldUseScanicPerspective(preference)) {
    const engine = new OpenCvDetectionEngine();
    try {
      return await engine.extractPerspective(imageData, quad);
    } finally {
      engine.dispose();
    }
  }

  const engine = new ScanicDetectionEngine();
  try {
    return await engine.extractPerspective(imageData, quad);
  } catch {
    const fallback = new OpenCvDetectionEngine();
    try {
      return await fallback.extractPerspective(imageData, quad);
    } finally {
      fallback.dispose();
    }
  } finally {
    engine.dispose();
  }
}
