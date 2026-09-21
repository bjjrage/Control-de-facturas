import { detectDocumentQuad, type ImageDataSource } from './document-detector';
import { detectDocumentV2 } from './document-detector-v2';
import type { OpenCvRuntime } from './opencv-types';
import type { DetectedQuadResult, DetectionDiagnostics, QuadPoints, ScannerDetectionMode } from './types';

export interface DetectionPipelineInput {
  imageData: ImageDataSource;
  mode: ScannerDetectionMode;
  cv: OpenCvRuntime | null;
  seedQuad?: QuadPoints | null;
}

export interface DetectionPipelineResult extends DetectedQuadResult {
  diagnostics: DetectionDiagnostics;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function withDiagnostics(
  result: DetectedQuadResult,
  diagnostics: DetectionDiagnostics,
  fallbackReason?: string
): DetectionPipelineResult {
  return {
    ...result,
    diagnostics: {
      ...diagnostics,
      detector: diagnostics.detector ?? 'v1',
      fallbackReason: fallbackReason ?? diagnostics.fallbackReason,
    },
  };
}

/**
 * Runs V2 when its runtime is ready and keeps V1 as a hard safety net for
 * loader failures, OpenCV exceptions, and frames without a valid candidate.
 */
export function detectWithFallback(input: DetectionPipelineInput): DetectionPipelineResult {
  const startedAt = now();

  if (input.cv) {
    try {
      const v2 = detectDocumentV2(input.imageData, input.cv, {
        mode: input.mode,
        seedQuad: input.seedQuad,
      });
      if (!v2.isFallback) {
        return withDiagnostics(v2, v2.diagnostics);
      }
    } catch (error) {
      const v1 = detectDocumentQuad(input.imageData);
      return withDiagnostics(
        v1,
        {
          detector: 'v1',
          mode: input.mode,
          processingMs: now() - startedAt,
          fallbackReason: `opencv-error:${error instanceof Error ? error.message : String(error)}`,
          qualityPassAcceptable: false,
        },
        'opencv-error'
      );
    }
  }

  const v1 = detectDocumentQuad(input.imageData);
  return withDiagnostics(
    v1,
    {
      detector: 'v1',
      mode: input.mode,
      processingMs: now() - startedAt,
      // Si OpenCV estaba listo pero V2 no encontró un candidato, V1 sigue
      // disponible para la UX manual, pero no habilita auto-capture.
      qualityPassAcceptable: input.cv ? false : !v1.isFallback && v1.confidence >= 0.62,
      fallbackReason: input.cv ? 'v2-no-valid-candidate' : 'opencv-not-ready',
    },
    input.cv ? 'v2-no-valid-candidate' : 'opencv-not-ready'
  );
}
