/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OpenCvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32S?: Int32Array;
  data32F?: Float32Array;
  delete(): void;
}

/**
 * OpenCV.js is loaded at runtime, so keeping this boundary deliberately small
 * prevents the client bundle from importing a server-side OpenCV package.
 */
export type OpenCvRuntime = {
  [key: string]: any;
  Mat: new (...args: any[]) => OpenCvMat;
  MatVector: new (...args: any[]) => { size(): number; get(index: number): OpenCvMat; delete(): void };
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
};

/* eslint-enable @typescript-eslint/no-explicit-any */
