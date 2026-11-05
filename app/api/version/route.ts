import { deploymentInfo } from "@/lib/deployment-info";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = deploymentInfo();
  return Response.json(info, {
    status: info.valid ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
