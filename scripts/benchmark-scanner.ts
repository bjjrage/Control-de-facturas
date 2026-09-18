import { performance } from 'perf_hooks';
import { detectDocumentFromRgba } from '../lib/scanner/document-detector';
import { warpPerspective, applyScanFilter } from '../lib/scanner/image-processing';
import { buildPdfFromJpegPages } from '../lib/scanner/pdf-builder';

interface BenchmarkResult {
  resolution: string;
  pixels: number;
  detectionMs: number;
  warpMs: number;
  filterMs: number;
  pdfBuildMs: number;
  totalMs: number;
  detectedQuad: any;
}

function createSyntheticDocumentImage(width: number, height: number): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: 'srgb';
} {
  const data = new Uint8ClampedArray(width * height * 4);

  // Background: dark gray textured desk (RGB 45, 45, 48)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 45;
    data[i + 1] = 45;
    data[i + 2] = 48;
    data[i + 3] = 255;
  }

  // Draw paper quad (approx 80% of width and height)
  const padX = Math.floor(width * 0.1);
  const padY = Math.floor(height * 0.1);
  const docW = width - 2 * padX;
  const docH = height - 2 * padY;

  for (let y = padY; y < padY + docH; y++) {
    for (let x = padX; x < padX + docW; x++) {
      const idx = (y * width + x) * 4;
      // White paper with subtle variation
      data[idx] = 240;
      data[idx + 1] = 242;
      data[idx + 2] = 238;
      data[idx + 3] = 255;
    }
  }

  // Add printed invoice lines
  for (let line = 0; line < 25; line++) {
    const ly = padY + Math.floor(docH * (0.15 + line * 0.03));
    const startX = padX + Math.floor(docW * 0.1);
    const endX = padX + Math.floor(docW * 0.85);
    for (let x = startX; x < endX; x++) {
      const idx = (ly * width + x) * 4;
      data[idx] = 25;
      data[idx + 1] = 25;
      data[idx + 2] = 25;
    }
  }

  return {
    data,
    width,
    height,
    colorSpace: 'srgb',
  };
}

async function runBenchmarkForResolution(width: number, height: number, label: string): Promise<BenchmarkResult> {
  console.log(`\n========================================`);
  console.log(`Starting Benchmark: ${label} (${width}x${height} = ${(width * height / 1e6).toFixed(2)} MP)`);
  console.log(`========================================`);

  // 1. Synthetic Document Image Setup
  const setupStart = performance.now();
  const image = createSyntheticDocumentImage(width, height);
  const setupMs = performance.now() - setupStart;
  console.log(`[1/5] Image Buffer Initialized (${setupMs.toFixed(1)} ms)`);

  // 2. Document Edge & Quad Detection
  const detStart = performance.now();
  const quad = detectDocumentFromRgba(image.data, width, height);
  const detectionMs = performance.now() - detStart;
  console.log(`[2/5] Real Edge & Quad Detection: ${detectionMs.toFixed(2)} ms (Confidence: ${quad.confidence.toFixed(2)})`);

  // 3. Perspective Correction (Warp)
  const warpStart = performance.now();
  const warped = warpPerspective(image as any, quad.quad, Math.round(width * 0.8), Math.round(height * 0.8));
  const warpMs = performance.now() - warpStart;
  console.log(`[3/5] Perspective Warping: ${warpMs.toFixed(2)} ms (Output: ${warped.width}x${warped.height})`);

  // 4. CamScanner B&W / Document Filter Enhancement
  const filterStart = performance.now();
  const filtered = applyScanFilter(warped, 'document');
  const filterMs = performance.now() - filterStart;
  console.log(`[4/5] CamScanner Document Filter Enhancement: ${filterMs.toFixed(2)} ms`);

  // 5. PDF Construction
  // Create a minimal valid JPEG payload header for PDF embedding
  const fakeJpegBytes = new Uint8Array(1024);
  fakeJpegBytes[0] = 0xFF; fakeJpegBytes[1] = 0xD8; // SOI
  fakeJpegBytes[1022] = 0xFF; fakeJpegBytes[1023] = 0xD9; // EOI
  const pdfStart = performance.now();
  const pdfBytes = buildPdfFromJpegPages([
    { jpegBytes: fakeJpegBytes, width: warped.width, height: warped.height },
  ]);
  const pdfBuildMs = performance.now() - pdfStart;
  console.log(`[5/5] Multi-page PDF Assembly: ${pdfBuildMs.toFixed(2)} ms (Size: ${pdfBytes.length} bytes)`);

  const totalMs = detectionMs + warpMs + filterMs + pdfBuildMs;
  console.log(`>> Total Pipeline Time: ${totalMs.toFixed(2)} ms <<`);

  return {
    resolution: label,
    pixels: width * height,
    detectionMs,
    warpMs,
    filterMs,
    pdfBuildMs,
    totalMs,
    detectedQuad: quad,
  };
}

async function main() {
  console.log('Control Scanner Camera & Image Processing Performance Benchmark');
  console.log('Testing CamScanner detection, bilinear warping, adaptive filter, and PDF generation.\n');

  // Benchmark A: 1920x1080 (Full HD / 2.07 MP)
  const res1080p = await runBenchmarkForResolution(1920, 1080, '1920x1080 (Full HD)');

  // Benchmark B: 3024x4032 (~12.2 MP - standard smartphone sensor resolution)
  const res12MP = await runBenchmarkForResolution(3024, 4032, '3024x4032 (12MP Smartphone Camera)');

  console.log('\n\n================ SUMMARY RESULTS ================');
  console.table([
    {
      Resolution: res1080p.resolution,
      'Megapixels (MP)': (res1080p.pixels / 1e6).toFixed(2),
      'Detection (ms)': res1080p.detectionMs.toFixed(1),
      'Warp (ms)': res1080p.warpMs.toFixed(1),
      'Filter (ms)': res1080p.filterMs.toFixed(1),
      'PDF (ms)': res1080p.pdfBuildMs.toFixed(1),
      'Total (ms)': res1080p.totalMs.toFixed(1),
    },
    {
      Resolution: res12MP.resolution,
      'Megapixels (MP)': (res12MP.pixels / 1e6).toFixed(2),
      'Detection (ms)': res12MP.detectionMs.toFixed(1),
      'Warp (ms)': res12MP.warpMs.toFixed(1),
      'Filter (ms)': res12MP.filterMs.toFixed(1),
      'PDF (ms)': res12MP.pdfBuildMs.toFixed(1),
      'Total (ms)': res12MP.totalMs.toFixed(1),
    },
  ]);
  console.log('=================================================\n');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
