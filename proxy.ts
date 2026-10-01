import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // The one-time bearer token is the credential for supplier receipt links.
  // Validate it in the portal page/API without requiring an ERP session.
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/recepcion/") ||
    path.startsWith("/api/recepcion-portal/") ||
    path.startsWith("/warehouse/") ||
    path.startsWith("/api/warehouse-portal/")
  ) {
    const response = NextResponse.next({ request });
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Documentos estáticos servidos desde public/ — accesibles sin login.
  const STATIC_DOCS = ["/manual-obra", "/flujo-obra"];
  const isPublic =
    path.endsWith(".html") ||
    path.endsWith(".wasm") ||
    STATIC_DOCS.includes(path) ||
    path.startsWith("/login") ||
    path.startsWith("/reset-password") ||
    path.startsWith("/suspendido") ||
    path.startsWith("/cotizar") ||
    path.startsWith("/cotizacion") ||
    path.startsWith("/certificados") ||
    path.startsWith("/avance") ||
    path.startsWith("/scanner") ||
    path.startsWith("/_next") ||
    path.startsWith("/api/cotizar") ||
    path.startsWith("/api/scanner") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html)$).*)"],
};
