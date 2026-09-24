export interface CameraEnvironmentCheck {
  isSupported: boolean;
  reason?: string;
  isSecureContext: boolean;
}

export function checkCameraEnvironment(
  nav: typeof navigator = typeof navigator !== 'undefined' ? navigator : ({} as any),
  win: typeof window = typeof window !== 'undefined' ? window : ({} as any)
): CameraEnvironmentCheck {
  const isSecure = win?.isSecureContext ?? true;
  const isLocalhost =
    typeof win?.location?.hostname === 'string' &&
    (win.location.hostname === 'localhost' || win.location.hostname === '127.0.0.1');

  if (!isSecure && !isLocalhost) {
    return {
      isSupported: false,
      reason: 'La cámara requiere una conexión HTTPS segura.',
      isSecureContext: false,
    };
  }

  if (!nav?.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
    return {
      isSupported: false,
      reason: 'Tu navegador no soporta acceso directo a cámara. Podés subir una foto.',
      isSecureContext: isSecure,
    };
  }

  return {
    isSupported: true,
    isSecureContext: isSecure,
  };
}

export function getCameraConstraintsForAttempt(attempt: number): MediaStreamConstraints {
  switch (attempt) {
    case 0:
      return {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };
    case 1:
      return {
        video: {
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      };
    default:
      return {
        video: true,
        audio: false,
      };
  }
}

export interface CameraErrorInfo {
  message: string;
  isPermissionDenied: boolean;
  name: string;
}

export function parseCameraError(err: unknown): CameraErrorInfo {
  const errorObj = (err && typeof err === 'object' ? err : {}) as { name?: string; message?: string };
  const name = errorObj.name || 'UnknownError';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        message: 'La cámara está bloqueada para este sitio. Habilitala desde los permisos del navegador.',
        isPermissionDenied: true,
        name,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        message: 'No se encontró ninguna cámara disponible en tu dispositivo.',
        isPermissionDenied: false,
        name,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        message: 'La cámara está siendo usada por otra aplicación o no se pudo iniciar. Reiniciá la app o tu navegador.',
        isPermissionDenied: false,
        name,
      };
    case 'OverconstrainedError':
      return {
        message: 'La resolución o modo de la cámara no es compatible con tu dispositivo.',
        isPermissionDenied: false,
        name,
      };
    case 'SecurityError':
      return {
        message: 'Acceso bloqueado por políticas de seguridad del navegador.',
        isPermissionDenied: false,
        name,
      };
    default:
      return {
        message: 'No se pudo iniciar la cámara trasera. Podés reintentar o seleccionar una foto.',
        isPermissionDenied: false,
        name,
      };
  }
}

export function isVideoElementReady(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  return video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2;
}
