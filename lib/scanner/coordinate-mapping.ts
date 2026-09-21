import { Point2D, QuadPoints } from './types';

export interface ObjectCoverFit {
  scale: number;
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
  videoWidth: number;
  videoHeight: number;
  containerWidth: number;
  containerHeight: number;
}

/**
 * Calcula la geometría de proyección de un `<video className="object-cover">`
 * dentro de un contenedor con tamaño arbitrario.
 *
 * En CSS `object-cover` (con `object-position: center center`), el video escala
 * uniformemente para cubrir toda el área del contenedor, recortando los márgenes
 * sobrantes de manera simétrica.
 */
export function calculateObjectCoverFit(
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number
): ObjectCoverFit {
  if (videoWidth <= 0 || videoHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return {
      scale: 1,
      renderedWidth: Math.max(1, containerWidth),
      renderedHeight: Math.max(1, containerHeight),
      offsetX: 0,
      offsetY: 0,
      videoWidth: Math.max(1, videoWidth),
      videoHeight: Math.max(1, videoHeight),
      containerWidth: Math.max(1, containerWidth),
      containerHeight: Math.max(1, containerHeight),
    };
  }

  const scale = Math.max(containerWidth / videoWidth, containerHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  return {
    scale,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    videoWidth,
    videoHeight,
    containerWidth,
    containerHeight,
  };
}

/**
 * Transforma un punto de coordenadas de video (resolución intrínseca del stream)
 * a coordenadas del viewport/overlay (píxeles CSS en pantalla).
 */
export function mapVideoPointToViewport(point: Point2D, fit: ObjectCoverFit): Point2D {
  return {
    x: point.x * fit.scale + fit.offsetX,
    y: point.y * fit.scale + fit.offsetY,
  };
}

/**
 * Transforma un punto de coordenadas de pantalla/viewport a coordenadas
 * de la resolución real del video.
 */
export function mapViewportPointToVideo(point: Point2D, fit: ObjectCoverFit): Point2D {
  if (fit.scale <= 0) return { x: 0, y: 0 };
  const rawX = (point.x - fit.offsetX) / fit.scale;
  const rawY = (point.y - fit.offsetY) / fit.scale;

  return {
    x: Math.max(0, Math.min(fit.videoWidth, Math.round(rawX))),
    y: Math.max(0, Math.min(fit.videoHeight, Math.round(rawY))),
  };
}

/**
 * Mapea los 4 puntos del cuadrilátero de espacio de video a espacio de pantalla.
 */
export function mapVideoQuadToViewport(quad: QuadPoints, fit: ObjectCoverFit): QuadPoints {
  return {
    topLeft: mapVideoPointToViewport(quad.topLeft, fit),
    topRight: mapVideoPointToViewport(quad.topRight, fit),
    bottomRight: mapVideoPointToViewport(quad.bottomRight, fit),
    bottomLeft: mapVideoPointToViewport(quad.bottomLeft, fit),
  };
}

/**
 * Mapea los 4 puntos del cuadrilátero de espacio de pantalla a espacio de video.
 */
export function mapViewportQuadToVideo(quad: QuadPoints, fit: ObjectCoverFit): QuadPoints {
  return {
    topLeft: mapViewportPointToVideo(quad.topLeft, fit),
    topRight: mapViewportPointToVideo(quad.topRight, fit),
    bottomRight: mapViewportPointToVideo(quad.bottomRight, fit),
    bottomLeft: mapViewportPointToVideo(quad.bottomLeft, fit),
  };
}

/**
 * Escala un cuadrilátero entre dos espacios de coordenadas 2D proporcionales
 * (por ejemplo de un canvas de análisis reducido a la resolución completa del video).
 */
export function scaleQuad(quad: QuadPoints, scaleX: number, scaleY: number): QuadPoints {
  return {
    topLeft: { x: Math.round(quad.topLeft.x * scaleX), y: Math.round(quad.topLeft.y * scaleY) },
    topRight: { x: Math.round(quad.topRight.x * scaleX), y: Math.round(quad.topRight.y * scaleY) },
    bottomRight: { x: Math.round(quad.bottomRight.x * scaleX), y: Math.round(quad.bottomRight.y * scaleY) },
    bottomLeft: { x: Math.round(quad.bottomLeft.x * scaleX), y: Math.round(quad.bottomLeft.y * scaleY) },
  };
}
