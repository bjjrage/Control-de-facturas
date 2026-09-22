"use client";

import type { OpenCvRuntime } from './opencv-types';

export type OpenCvLoadState = 'idle' | 'loading' | 'ready' | 'failed';

const OPENCV_SRC = 'https://docs.opencv.org/4.13.0/opencv.js';
const SCRIPT_ATTRIBUTE = 'data-control-scanner-opencv';

let state: OpenCvLoadState = 'idle';
let error: Error | null = null;
let loadPromise: Promise<OpenCvRuntime> | null = null;
const listeners = new Set<(nextState: OpenCvLoadState, nextError: Error | null) => void>();

declare global {
  interface Window {
    cv?: OpenCvRuntime | Promise<OpenCvRuntime>;
    Module?: {
      onRuntimeInitialized?: () => void;
      [key: string]: unknown;
    };
  }
}

function update(nextState: OpenCvLoadState, nextError: Error | null = null) {
  state = nextState;
  error = nextError;
  listeners.forEach((listener) => listener(state, error));
}

function getRuntime(): OpenCvRuntime | null {
  if (typeof window === 'undefined' || !window.cv) return null;
  const candidate = window.cv as OpenCvRuntime;
  return typeof candidate.Mat === 'function' ? candidate : null;
}

function resolveRuntime(resolve: (runtime: OpenCvRuntime) => void, reject: (reason: Error) => void) {
  const candidate = window.cv;
  if (!candidate) return false;

  Promise.resolve(candidate)
    .then((runtime) => {
      if (!runtime || typeof runtime.Mat !== 'function') {
        throw new Error('OpenCV.js cargó, pero no expuso cv.Mat');
      }
      update('ready');
      resolve(runtime);
    })
    .catch((reason: unknown) => {
      const nextError = reason instanceof Error ? reason : new Error(String(reason));
      update('failed', nextError);
      reject(nextError);
    });
  return true;
}

export function getOpenCvState(): { state: OpenCvLoadState; error: Error | null } {
  return { state, error };
}

export function subscribeOpenCv(
  listener: (nextState: OpenCvLoadState, nextError: Error | null) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadOpenCv(): Promise<OpenCvRuntime> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('OpenCV.js solo puede cargarse en el navegador'));
  }

  const existingRuntime = getRuntime();
  if (existingRuntime) {
    update('ready');
    return Promise.resolve(existingRuntime);
  }
  if (loadPromise) return loadPromise;

  update('loading');
  loadPromise = new Promise<OpenCvRuntime>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      if (resolveRuntime((runtime) => {
        settled = true;
        resolve(runtime);
      }, (reason) => {
        settled = true;
        reject(reason);
      })) return;
    };

    const previousModule = window.Module ?? {};
    window.Module = {
      ...previousModule,
      onRuntimeInitialized: () => {
        try {
          previousModule.onRuntimeInitialized?.();
        } finally {
          finish();
        }
      },
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[${SCRIPT_ATTRIBUTE}]`
    );
    const script = existingScript ?? document.createElement('script');

    const handleLoad = () => {
      // Some OpenCV.js builds expose cv as a Promise after the script load.
      window.setTimeout(finish, 0);
    };
    const handleError = () => {
      if (settled) return;
      settled = true;
      const nextError = new Error('No se pudo cargar OpenCV.js');
      update('failed', nextError);
      reject(nextError);
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existingScript) {
      script.async = true;
      script.src = OPENCV_SRC;
      script.setAttribute(SCRIPT_ATTRIBUTE, 'true');
      document.head.appendChild(script);
    } else {
      finish();
    }

    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      const nextError = new Error('OpenCV.js excedió el tiempo de carga');
      update('failed', nextError);
      reject(nextError);
    }, 15000);
  }).catch((reason: unknown) => {
    loadPromise = null;
    throw reason;
  });

  return loadPromise;
}

export const OPENCV_SCRIPT_URL = OPENCV_SRC;
