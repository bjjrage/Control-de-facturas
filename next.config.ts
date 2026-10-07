import type { NextConfig } from "next";

// PDF.js loads its worker and optional native bindings dynamically, beyond NFT's
// static dependency graph. Include only the runtime assets of the document reader.
const pdfRuntimeFiles = [
  "./node_modules/pdf-parse/dist/pdf-parse/**",
  "./node_modules/pdf-parse/package.json",
  "./node_modules/pdfjs-dist/package.json",
  "./node_modules/pdfjs-dist/legacy/build/*.mjs",
  "./node_modules/pdfjs-dist/cmaps/**",
  "./node_modules/pdfjs-dist/standard_fonts/**",
  "./node_modules/pdfjs-dist/wasm/**",
  "./node_modules/@napi-rs/canvas/**",
  "./node_modules/@napi-rs/canvas-*/**",
];

const nextConfig: NextConfig = {
  // PDF.js uses createRequire(import.meta.url) to load its Node canvas bindings.
  // Preserve the package's native Node entry instead of bundling it into RSC.
  serverExternalPackages: ["pdf-parse"],
  outputFileTracingIncludes: {
    "/rfqs/*": pdfRuntimeFiles,
    "/api/agent/chat": pdfRuntimeFiles,
  },
  experimental: {
    serverActions: {
      // Next.js defaults Server Action request bodies to 1MB, but a real
      // phone photo of an invoice is routinely several MB — raise it to
      // match the app's own MAX_INVOICE_FILE_BYTES (20MB).
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
