import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()) },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
