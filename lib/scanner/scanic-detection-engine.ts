import type { DetectionOptions, Scanner, ScannerResult } from 'scanic';
import { isValidConvexQuad } from './image-processing';
import type { ImageDataSource } from './document-detector';
import type { DetectionPipelineResult } from './detection-pipeline';
import type { ScannerDetectionEngine, ScannerDetectionInput } from './scanner-detection-engine';
import type { DetectionDiagnostics, QuadPoints, ScannerDetectionMode } from './types';

let scanicModulePromise: Promise<typeof import('scanic')> | null = null;

function loadScanicModule(): Promise<typeof import('scanic')> {
  if (!scanicModulePromise) {
    scanicModulePromise = import('scanic').catch((error: unknown) => {
      scanicModulePromise = null;
      throw error;
    });
  }
  return scanicModulePromise;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function validCorners(result: ScannerResult, width: number, height: number): QuadPoints | null {
  const corners = result.corners;
  if (!result.success || !corners) return null;
  const quad: QuadPoints = {
    topLeft: { x: corners.topLeft.x, y: corners.topLeft.y },
    topRight: { x: corners.topRight.x, y: corners.topRight.y },
    bottomRight: { x: corners.bottomRight.x, y: corners.bottomRight.y },
    bottomLeft: { x: corners.bottomLeft.x, y: corners.bottomLeft.y },
  };
  return isValidConvexQuad(quad, width, height) ? quad : null;
}

function detectionMode(mode: ScannerDetectionMode): Pick<DetectionOptions, 'maxProcessingDimension' | 'enableDetectionCascade'> {
  if (mode === 'fast') return { maxProcessingDimension: 640, enableDetectionCascade: false };
  if (mode === 'quality') return { maxProcessingDimension: 1120, enableDetectionCascade: true };
  return { maxProcessingDimension: 1600, enableDetectionCascade: true };
}

export class ScanicDetectionEngine implements ScannerDetectionEngine {
  private scanner: Scanner | null = null;
  private module: typeof import('scanic') | null = null;
  private initializationPromise: Promise<void> | null = null;
  private initialized = false;
  private disposed = false;
  private initializationMs = 0;

  public get initTimeMs(): number {
    return this.initializationMs;
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error('Scanic detection engine has been disposed');
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      const startedAt = now();
      const module = await loadScanicModule();
      if (this.disposed) throw new Error('Scanic detection engine disposed during initialization');
      const scanner = new module.Scanner();
      await scanner.initialize();
      if (this.disposed) throw new Error('Scanic detection engine disposed during initialization');
      this.module = module;
      this.scanner = scanner;
      this.initializationMs = now() - startedAt;
      this.initialized = true;
    })().finally(() => {
      this.initializationPromise = null;
    });
    return this.initializationPromise;
  }

  async detectFast(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null> {
    return this.detect(input, 'fast');
  }

  async detectQuality(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null> {
    return this.detect(input, 'quality');
  }

  async refineFinal(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null> {
    return this.detect(input, 'final');
  }

  async extractPerspective(imageData: ImageData, quad: QuadPoints): Promise<ImageData> {
    if (this.disposed) throw new Error('Scanic detection engine has been disposed');
    const module = this.module ?? await loadScanicModule();
    const extraction = await module.extractDocument(imageData as ImageData, quad, { output: 'imagedata' });
    const output = extraction.output;
    if (!extraction.success || !output || typeof output === 'string' || 'getContext' in output) {
      throw new Error(extraction.message || 'Scanic perspective extraction failed');
    }
    return output as ImageData;
  }

  /**
   * Scanic 1.6 does not expose a Scanner.dispose() method. The adapter drops its
   * per-session references and rejects late results; the library-owned WASM module
   * stays cached once per page and is reclaimed when the page itself is unloaded.
   */
  dispose(): void {
    this.disposed = true;
    this.scanner = null;
    this.module = null;
    this.initialized = false;
  }

  private async detect(
    input: ScannerDetectionInput,
    mode: ScannerDetectionMode
  ): Promise<DetectionPipelineResult | null> {
    if (this.disposed) return null;
    await this.initialize();
    const scanner = this.scanner;
    if (!scanner || this.disposed) return null;

    const startedAt = now();
    const result = await scanner.scan(input.imageData as ImageData, {
      mode: 'detect',
      ...detectionMode(mode),
    });
    const processingMs = now() - startedAt;
    if (this.disposed) return null;
    const quad = validCorners(result, input.imageData.width, input.imageData.height);
    const confidence = Number.isFinite(result.confidence) ? Number(result.confidence) : 0;
    if (!quad || confidence < 0.4) return null;

    const diagnostics: DetectionDiagnostics = {
      detector: 'scanic',
      engine: 'scanic',
      mode,
      processingMs,
      initializationMs: this.initializationMs,
      qualityScore: confidence,
      candidateCount: 1,
      qualityPassAcceptable: confidence >= 0.62,
      rawQuad: quad,
      refinedQuad: quad,
    };
    return {
      quad,
      confidence,
      isFallback: false,
      diagnostics,
    };
  }
}

export async function loadScanicDetectionEngine(): Promise<ScanicDetectionEngine> {
  const engine = new ScanicDetectionEngine();
  await engine.initialize();
  return engine;
}
