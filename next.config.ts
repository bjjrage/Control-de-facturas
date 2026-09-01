import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
