import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateObjectCoverFit,
  mapVideoPointToViewport,
  mapViewportPointToVideo,
  mapVideoQuadToViewport,
  mapViewportQuadToVideo,
  scaleQuad,
} from '../lib/scanner/coordinate-mapping';
import { DocumentStabilityTracker } from '../lib/scanner/stability-tracker';
import {
  checkCameraEnvironment,
  parseCameraError,
  getCameraConstraintsForAttempt,
  isVideoElementReady,
} from '../lib/scanner/camera-helpers';
import { QuadPoints } from '../lib/scanner/types';

describe('Coordinate Mapping (object-cover projection)', () => {
  it('calcula correctamente el factor de escala y recorte en modo portrait con video 16:9', () => {
    const videoW = 1920;
    const videoH = 1080;
    const containerW = 390;
    const containerH = 844;

    const fit = calculateObjectCoverFit(videoW, videoH, containerW, containerH);

    // En portrait 390x844 con video 1920x1080:
    // escala = max(390/1920, 844/1080) = max(0.203125, 0.78148) = ~0.78148
    expect(fit.scale).toBeCloseTo(844 / 1080, 4);
    expect(fit.renderedHeight).toBe(844);
    expect(fit.renderedWidth).toBeGreaterThan(containerW);
    expect(fit.offsetY).toBe(0);
    expect(fit.offsetX).toBeLessThan(0); // Recorte lateral simétrico

    // El centro del video (960, 540) debe mapearse exactamente al centro del contenedor (195, 422)
    const centerVideo = { x: 960, y: 540 };
    const centerViewport = mapVideoPointToViewport(centerVideo, fit);

    expect(centerViewport.x).toBeCloseTo(containerW / 2, 1);
    expect(centerViewport.y).toBeCloseTo(containerH / 2, 1);

    // Mapeo inverso de regreso
    const restored = mapViewportPointToVideo(centerViewport, fit);
    expect(restored.x).toBeCloseTo(centerVideo.x, 0);
    expect(restored.y).toBeCloseTo(centerVideo.y, 0);
  });

  it('calcula correctamente en modo landscape con video portrait', () => {
    const videoW = 1080;
    const videoH = 1920;
    const containerW = 844;
    const containerH = 390;

    const fit = calculateObjectCoverFit(videoW, videoH, containerW, containerH);
    expect(fit.scale).toBeCloseTo(844 / 1080, 4);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBeLessThan(0);
  });

  it('maneja valores 0 o negativos de forma segura y defensiva', () => {
    const fit = calculateObjectCoverFit(0, 0, 0, 0);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);

    const pt = mapVideoPointToViewport({ x: 10, y: 20 }, fit);
    expect(pt.x).toBe(10);
    expect(pt.y).toBe(20);
  });

  it('escala cuadriláteros preservando la geometría', () => {
    const quad: QuadPoints = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 90, y: 10 },
      bottomRight: { x: 90, y: 90 },
      bottomLeft: { x: 10, y: 90 },
    };

    const scaled = scaleQuad(quad, 2, 3);
    expect(scaled.topLeft).toEqual({ x: 20, y: 30 });
    expect(scaled.topRight).toEqual({ x: 180, y: 30 });
    expect(scaled.bottomRight).toEqual({ x: 180, y: 270 });
    expect(scaled.bottomLeft).toEqual({ x: 20, y: 270 });
  });

  it('mapea cuadriláteros completos ida y vuelta', () => {
    const fit = calculateObjectCoverFit(1280, 720, 400, 800);
    const originalQuad: QuadPoints = {
      topLeft: { x: 200, y: 100 },
      topRight: { x: 1000, y: 120 },
      bottomRight: { x: 950, y: 650 },
      bottomLeft: { x: 180, y: 600 },
    };

    const viewportQuad = mapVideoQuadToViewport(originalQuad, fit);
    const restoredQuad = mapViewportQuadToVideo(viewportQuad, fit);

    expect(restoredQuad.topLeft.x).toBeCloseTo(originalQuad.topLeft.x, -1);
    expect(restoredQuad.topRight.y).toBeCloseTo(originalQuad.topRight.y, -1);
  });
});

describe('DocumentStabilityTracker', () => {
  let tracker: DocumentStabilityTracker;
  const sampleQuad: QuadPoints = {
    topLeft: { x: 200, y: 100 },
    topRight: { x: 1000, y: 100 },
    bottomRight: { x: 1000, y: 600 },
    bottomLeft: { x: 200, y: 600 },
  };

  beforeEach(() => {
    tracker = new DocumentStabilityTracker({
      requiredDurationMs: 600,
      minStableFrames: 3,
      minConfidence: 0.45,
      maxDriftRatio: 0.04,
    });
  });

  it('inicia en estado searching ante quad nulo o fallback', () => {
    const stateNull = tracker.update(null, false, 0, 1280, 720);
    expect(stateNull.status).toBe('searching');
    expect(stateNull.isStable).toBe(false);
    expect(stateNull.isReadyForAutoCapture).toBe(false);

    const stateFallback = tracker.update(sampleQuad, true, 0.8, 1280, 720);
    expect(stateFallback.status).toBe('searching');
  });

  it('rechaza quads con baja confianza', () => {
    const state = tracker.update(sampleQuad, false, 0.35, 1280, 720);
    expect(state.status).toBe('searching');
    expect(state.isStable).toBe(false);
  });

  it('transiciona a detected en el primer frame y no auto-captura de inmediato', () => {
    const state = tracker.update(sampleQuad, false, 0.75, 1280, 720, 1000);
    expect(state.status).toBe('detected');
    expect(state.isStable).toBe(false);
    expect(state.isReadyForAutoCapture).toBe(false);
    expect(state.stabilityProgress).toBe(0);
  });

  it('alcanza estabilidad y auto-capture tras frames estables sostenidos por la duración requerida', () => {
    // Frame 1: t=1000
    let s = tracker.update(sampleQuad, false, 0.85, 1280, 720, 1000);
    expect(s.status).toBe('detected');

    // Frame 2: t=1200 (desplazamiento mínimo de 2px)
    const q2: QuadPoints = {
      topLeft: { x: 202, y: 101 },
      topRight: { x: 1001, y: 100 },
      bottomRight: { x: 999, y: 601 },
      bottomLeft: { x: 201, y: 599 },
    };
    s = tracker.update(q2, false, 0.86, 1280, 720, 1200);
    expect(s.status).toBe('detected');
    expect(s.stabilityProgress).toBeGreaterThan(0);

    // Frame 3: t=1400 (400ms transcurridos de 600ms)
    s = tracker.update(q2, false, 0.87, 1280, 720, 1400);
    expect(s.status).toBe('detected');
    expect(s.isStable).toBe(false);

    // Frame 4: t=1700 (700ms transcurridos > 600ms y 4 frames > 3)
    s = tracker.update(q2, false, 0.88, 1280, 720, 1700);
    expect(s.status).toBe('stable');
    expect(s.isStable).toBe(true);
    expect(s.isReadyForAutoCapture).toBe(true);
    expect(s.stabilityProgress).toBe(1.0);
  });

  it('reinicia estabilidad ante movimiento brusco (inestabilidad)', () => {
    // Estabilizar primero
    tracker.update(sampleQuad, false, 0.85, 1280, 720, 1000);
    tracker.update(sampleQuad, false, 0.85, 1280, 720, 1300);

    // Movimiento brusco (salto de 200px)
    const shiftedQuad: QuadPoints = {
      topLeft: { x: 400, y: 300 },
      topRight: { x: 1200, y: 300 },
      bottomRight: { x: 1200, y: 800 },
      bottomLeft: { x: 400, y: 800 },
    };

    const s = tracker.update(shiftedQuad, false, 0.85, 1280, 720, 1500);
    expect(s.status).toBe('detected');
    expect(s.isStable).toBe(false);
    expect(s.consecutiveFrames).toBe(0);
    expect(s.stabilityProgress).toBe(0);
  });

  it('no auto-captura un quad estable si la cobertura de borde o quality pass falla', () => {
    const quality = {
      meanEdgeCoverage: 0.62,
      minEdgeCoverage: 0.18,
      qualityPassAcceptable: false,
    };
    tracker.update(sampleQuad, false, 0.85, 1280, 720, 1000, quality);
    tracker.update(sampleQuad, false, 0.85, 1280, 720, 1300, quality);
    tracker.update(sampleQuad, false, 0.85, 1280, 720, 1600, quality);
    const state = tracker.update(sampleQuad, false, 0.85, 1280, 720, 1800, quality);

    expect(state.isStable).toBe(true);
    expect(state.isReadyForAutoCapture).toBe(false);
    expect(state.minEdgeCoverage).toBe(0.18);
    expect(state.qualityPassAcceptable).toBe(false);
  });

  it('bloquea capturas posteriores con lockCapture (anti-doble captura)', () => {
    tracker.update(sampleQuad, false, 0.9, 1280, 720, 1000);
    tracker.update(sampleQuad, false, 0.9, 1280, 720, 1300);
    tracker.update(sampleQuad, false, 0.9, 1280, 720, 1700);

    tracker.lockCapture();
    expect(tracker.isLocked()).toBe(true);

    const s = tracker.update(sampleQuad, false, 0.9, 1280, 720, 1800);
    expect(s.isReadyForAutoCapture).toBe(false);
  });

  it('rechaza cuadriláteros con área minúscula o desproporcionada', () => {
    // Área de 10x10 en frame de 1280x720 = 0.0001
    const tinyQuad: QuadPoints = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 20, y: 10 },
      bottomRight: { x: 20, y: 20 },
      bottomLeft: { x: 10, y: 20 },
    };

    const s = tracker.update(tinyQuad, false, 0.9, 1280, 720, 1000);
    expect(s.isStable).toBe(false);
    expect(s.status).toBe('detected');
  });

  it('detecta y rechaza paneo lento acumulativo contra el anchor estable', () => {
    // Frame 1: anchor en (200, 100)
    tracker.update(sampleQuad, false, 0.85, 1280, 720, 1000);

    // Mover 25px en cada frame (frame drift ~1.7% < 4%, pero acumulado superará el límite del anchor)
    let curX = 200;
    let s;
    for (let f = 1; f <= 5; f++) {
      curX += 25; // Salto de 25px acumulando
      const movingQuad: QuadPoints = {
        topLeft: { x: curX, y: 100 },
        topRight: { x: curX + 800, y: 100 },
        bottomRight: { x: curX + 800, y: 600 },
        bottomLeft: { x: curX, y: 600 },
      };
      s = tracker.update(movingQuad, false, 0.85, 1280, 720, 1000 + f * 150);
    }
    // Tras 5 frames continuos de paneo, el desplazamiento total supera el umbral del anchor
    expect(s?.isStable).toBe(false);
  });
});

describe('Camera Helpers & Reliability', () => {
  it('detecta correctamente ambiente no seguro (insecure context)', () => {
    const fakeWin = { isSecureContext: false, location: { hostname: 'mi-sitio-remoto.com' } } as unknown as typeof window;
    const fakeNav = { mediaDevices: { getUserMedia: () => {} } } as unknown as typeof navigator;

    const res = checkCameraEnvironment(fakeNav, fakeWin);
    expect(res.isSupported).toBe(false);
    expect(res.reason).toContain('HTTPS');
  });

  it('permite localhost como excepción de contexto seguro', () => {
    const fakeWin = { isSecureContext: false, location: { hostname: 'localhost' } } as unknown as typeof window;
    const fakeNav = { mediaDevices: { getUserMedia: () => {} } } as unknown as typeof navigator;

    const res = checkCameraEnvironment(fakeNav, fakeWin);
    expect(res.isSupported).toBe(true);
  });

  it('detecta falta de mediaDevices / getUserMedia', () => {
    const fakeWin = { isSecureContext: true, location: { hostname: 'app.com' } } as unknown as typeof window;
    const fakeNav = {} as unknown as typeof navigator;

    const res = checkCameraEnvironment(fakeNav, fakeWin);
    expect(res.isSupported).toBe(false);
    expect(res.reason).toContain('soporta');
  });

  it('diferencia mensajes de error según el tipo de excepción de cámara', () => {
    const permErr = parseCameraError({ name: 'NotAllowedError' });
    expect(permErr.isPermissionDenied).toBe(true);
    expect(permErr.message).toContain('bloqueada');

    const notFoundErr = parseCameraError({ name: 'NotFoundError' });
    expect(notFoundErr.isPermissionDenied).toBe(false);
    expect(notFoundErr.message).toContain('No se encontró ninguna cámara');

    const busyErr = parseCameraError({ name: 'NotReadableError' });
    expect(busyErr.message).toContain('otra aplicación');

    const overconstrainedErr = parseCameraError({ name: 'OverconstrainedError' });
    expect(overconstrainedErr.message).toContain('compatible');
  });

  it('provee fallback progresivo de constraints de video', () => {
    const c0 = getCameraConstraintsForAttempt(0);
    const c0Video = c0.video as { facingMode: { ideal: string }; width: { ideal: number } };
    expect(c0Video.facingMode.ideal).toBe('environment');
    expect(c0Video.width.ideal).toBe(1920);

    const c1 = getCameraConstraintsForAttempt(1);
    const c1Video = c1.video as { facingMode: { ideal: string }; width?: unknown };
    expect(c1Video.facingMode.ideal).toBe('environment');
    expect(c1Video.width).toBeUndefined();

    const c2 = getCameraConstraintsForAttempt(2) as MediaStreamConstraints;
    expect(c2.video).toBe(true);
  });

  it('determina correctamente si un elemento video está listo para análisis', () => {
    expect(isVideoElementReady(null)).toBe(false);
    expect(isVideoElementReady({ videoWidth: 0, videoHeight: 0, readyState: 0 } as unknown as HTMLVideoElement)).toBe(false);
    expect(isVideoElementReady({ videoWidth: 1920, videoHeight: 1080, readyState: 1 } as unknown as HTMLVideoElement)).toBe(false);
    expect(isVideoElementReady({ videoWidth: 1920, videoHeight: 1080, readyState: 2 } as unknown as HTMLVideoElement)).toBe(true);
    expect(isVideoElementReady({ videoWidth: 1920, videoHeight: 1080, readyState: 4 } as unknown as HTMLVideoElement)).toBe(true);
  });
});
