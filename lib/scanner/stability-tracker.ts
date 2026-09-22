import { Point2D, QuadPoints } from './types';
import { isConvexQuad, polygonArea } from './document-detector';

export interface StabilityOptions {
  /** Tiempo mínimo en milisegundos que el documento debe mantenerse estable (default: 750ms) */
  requiredDurationMs?: number;
  /** Cantidad mínima de frames estables consecutivos requeridos (default: 4) */
  minStableFrames?: number;
  /** Umbral de confianza mínimo de detección (default: 0.40) */
  minConfidence?: number;
  /** Desplazamiento máximo permitido por esquina relativo a la diagonal (default: 0.035 = 3.5%) */
  maxDriftRatio?: number;
  /** Área mínima relativa al frame de video (default: 0.08 = 8%) */
  minAreaRatio?: number;
  /** Área máxima relativa al frame de video (default: 0.97 = 97%) */
  maxAreaRatio?: number;
  /** Tamaño de ventana de historial para suavizado (default: 6) */
  historyWindowSize?: number;
}

export type DocumentStabilityStatus = 'searching' | 'detected' | 'stable';

export interface StabilityState {
  status: DocumentStabilityStatus;
  isStable: boolean;
  isReadyForAutoCapture: boolean;
  stabilityProgress: number; // 0.0 a 1.0 (para barra / aro de progreso visual)
  confidence: number;
  consecutiveFrames: number;
  stableDurationMs: number;
  averageDrift: number;
  meanEdgeCoverage: number;
  minEdgeCoverage: number;
  qualityPassAcceptable: boolean;
  recentLargeJump: boolean;
  lastQuad: QuadPoints | null;
  smoothedQuad: QuadPoints | null;
}

export interface StabilityQuality {
  meanEdgeCoverage?: number;
  minEdgeCoverage?: number;
  qualityPassAcceptable?: boolean;
  recentLargeJump?: boolean;
}

interface FrameRecord {
  quad: QuadPoints;
  timestamp: number;
}

function cornerDist(p1: Point2D, p2: Point2D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export class DocumentStabilityTracker {
  private options: Required<StabilityOptions>;
  private history: FrameRecord[] = [];
  private stableSinceMs: number | null = null;
  private stableAnchorQuad: QuadPoints | null = null;
  private consecutiveStableFrames = 0;
  private captureLocked = false;

  constructor(options: StabilityOptions = {}) {
    this.options = {
      requiredDurationMs: options.requiredDurationMs ?? 750,
      minStableFrames: options.minStableFrames ?? 4,
      minConfidence: options.minConfidence ?? 0.40,
      maxDriftRatio: options.maxDriftRatio ?? 0.035,
      minAreaRatio: options.minAreaRatio ?? 0.08,
      maxAreaRatio: options.maxAreaRatio ?? 0.97,
      historyWindowSize: options.historyWindowSize ?? 6,
    };
  }

  public lockCapture(): void {
    this.captureLocked = true;
  }

  public unlockCapture(): void {
    this.captureLocked = false;
  }

  public isLocked(): boolean {
    return this.captureLocked;
  }

  public reset(): void {
    this.history = [];
    this.stableSinceMs = null;
    this.stableAnchorQuad = null;
    this.consecutiveStableFrames = 0;
    this.captureLocked = false;
  }

  /**
   * Procesa un frame de detección y retorna el estado actualizado de estabilidad.
   */
  public update(
    quad: QuadPoints | null,
    isFallback: boolean,
    confidence: number,
    videoWidth: number,
    videoHeight: number,
    timestamp: number = Date.now(),
    quality: StabilityQuality = {}
  ): StabilityState {
    const meanEdgeCoverage = quality.meanEdgeCoverage ?? 1;
    const minEdgeCoverage = quality.minEdgeCoverage ?? 1;
    const qualityPassAcceptable = quality.qualityPassAcceptable ?? true;
    const recentLargeJump = quality.recentLargeJump ?? false;
    const defaultResult: StabilityState = {
      status: 'searching',
      isStable: false,
      isReadyForAutoCapture: false,
      stabilityProgress: 0,
      confidence,
      consecutiveFrames: 0,
      stableDurationMs: 0,
      averageDrift: 0,
      meanEdgeCoverage,
      minEdgeCoverage,
      qualityPassAcceptable,
      recentLargeJump,
      lastQuad: null,
      smoothedQuad: null,
    };

    if (this.captureLocked || !quad || isFallback || confidence < this.options.minConfidence) {
      this.history = [];
      this.stableSinceMs = null;
      this.stableAnchorQuad = null;
      this.consecutiveStableFrames = 0;
      return defaultResult;
    }

    // 1. Validar convexidad estricta
    const quadPointsArray = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
    if (!isConvexQuad(quadPointsArray)) {
      this.stableSinceMs = null;
      this.stableAnchorQuad = null;
      this.consecutiveStableFrames = 0;
      return {
        ...defaultResult,
        status: 'detected',
        lastQuad: quad,
      };
    }

    // 2. Validar proporciones de área en espacio de video
    const area = polygonArea(quadPointsArray);
    const totalArea = Math.max(1, videoWidth * videoHeight);
    const areaRatio = area / totalArea;

    if (areaRatio < this.options.minAreaRatio || areaRatio > this.options.maxAreaRatio) {
      this.stableSinceMs = null;
      this.stableAnchorQuad = null;
      this.consecutiveStableFrames = 0;
      return {
        ...defaultResult,
        status: 'detected',
        confidence,
        lastQuad: quad,
      };
    }

    // 3. Medir desplazamiento respecto al historial reciente y al anchor acumulado
    const diagonal = Math.hypot(videoWidth, videoHeight);
    let isFrameDisplacementAcceptable = false;
    let maxCornerDisplacement = 0;
    let avgDisplacement = 0;

    let prevTimestamp: number | null = null;
    if (this.history.length > 0) {
      const prevRecord = this.history[this.history.length - 1];
      prevTimestamp = prevRecord.timestamp;
      const prev = prevRecord.quad;

      const dTL = cornerDist(quad.topLeft, prev.topLeft);
      const dTR = cornerDist(quad.topRight, prev.topRight);
      const dBR = cornerDist(quad.bottomRight, prev.bottomRight);
      const dBL = cornerDist(quad.bottomLeft, prev.bottomLeft);

      maxCornerDisplacement = Math.max(dTL, dTR, dBR, dBL);
      avgDisplacement = (dTL + dTR + dBR + dBL) / 4;

      const driftRatio = maxCornerDisplacement / Math.max(1, diagonal);
      let acceptable = driftRatio <= this.options.maxDriftRatio;

      // Prevenir falso positivo por paneo lento continuo: verificar contra el anchor estable inicial
      if (acceptable && this.stableAnchorQuad) {
        const aTL = cornerDist(quad.topLeft, this.stableAnchorQuad.topLeft);
        const aTR = cornerDist(quad.topRight, this.stableAnchorQuad.topRight);
        const aBR = cornerDist(quad.bottomRight, this.stableAnchorQuad.bottomRight);
        const aBL = cornerDist(quad.bottomLeft, this.stableAnchorQuad.bottomLeft);
        const maxAnchorDisplacement = Math.max(aTL, aTR, aBR, aBL);
        const anchorDriftRatio = maxAnchorDisplacement / Math.max(1, diagonal);

        if (anchorDriftRatio > this.options.maxDriftRatio * 1.5) {
          acceptable = false;
        }
      }

      isFrameDisplacementAcceptable = acceptable;
    } else {
      // Primer frame detectado: todavía no hay referencia de desplazamiento
      isFrameDisplacementAcceptable = false;
    }

    // Registrar en historial
    this.history.push({ quad, timestamp });
    if (this.history.length > this.options.historyWindowSize) {
      this.history.shift();
    }

    // 4. Calcular quad suavizado promediando historial
    const smoothedQuad = this.calculateSmoothedQuad();

    // 5. Actualizar temporizador de estabilidad
    if (isFrameDisplacementAcceptable) {
      this.consecutiveStableFrames++;
      if (this.stableSinceMs === null) {
        // La estabilidad comenzó desde el frame anterior que sirvió de referencia
        this.stableSinceMs = prevTimestamp ?? timestamp;
        this.stableAnchorQuad = this.history[0]?.quad ?? quad;
      }
    } else {
      this.stableSinceMs = null;
      this.consecutiveStableFrames = 0;
      this.stableAnchorQuad = null;
    }

    const stableDurationMs = this.stableSinceMs !== null ? timestamp - this.stableSinceMs : 0;
    const progress = Math.min(1.0, stableDurationMs / this.options.requiredDurationMs);
    const computedRecentLargeJump =
      recentLargeJump ||
      (this.history.length > 1 && maxCornerDisplacement / Math.max(1, diagonal) > this.options.maxDriftRatio * 0.8);
    const isStable =
      this.consecutiveStableFrames >= this.options.minStableFrames &&
      stableDurationMs >= this.options.requiredDurationMs;

    const status: DocumentStabilityStatus = isStable ? 'stable' : 'detected';

    return {
      status,
      isStable,
      isReadyForAutoCapture:
        isStable &&
        !this.captureLocked &&
        qualityPassAcceptable &&
        meanEdgeCoverage >= 0.45 &&
        minEdgeCoverage >= 0.28 &&
        !computedRecentLargeJump,
      stabilityProgress: Number(progress.toFixed(2)),
      confidence,
      consecutiveFrames: this.consecutiveStableFrames,
      stableDurationMs,
      averageDrift: Math.round(avgDisplacement),
      meanEdgeCoverage,
      minEdgeCoverage,
      qualityPassAcceptable,
      recentLargeJump: computedRecentLargeJump,
      lastQuad: quad,
      smoothedQuad,
    };
  }

  private calculateSmoothedQuad(): QuadPoints {
    if (this.history.length === 0) {
      throw new Error('Historial vacío');
    }
    const n = this.history.length;
    let tlX = 0, tlY = 0;
    let trX = 0, trY = 0;
    let brX = 0, brY = 0;
    let blX = 0, blY = 0;

    for (const h of this.history) {
      tlX += h.quad.topLeft.x;
      tlY += h.quad.topLeft.y;
      trX += h.quad.topRight.x;
      trY += h.quad.topRight.y;
      brX += h.quad.bottomRight.x;
      brY += h.quad.bottomRight.y;
      blX += h.quad.bottomLeft.x;
      blY += h.quad.bottomLeft.y;
    }

    return {
      topLeft: { x: Math.round(tlX / n), y: Math.round(tlY / n) },
      topRight: { x: Math.round(trX / n), y: Math.round(trY / n) },
      bottomRight: { x: Math.round(brX / n), y: Math.round(brY / n) },
      bottomLeft: { x: Math.round(blX / n), y: Math.round(blY / n) },
    };
  }
}
