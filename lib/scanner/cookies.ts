import { NextRequest, NextResponse } from 'next/server';

export const SCANNER_MOBILE_COOKIE = 'scanner_mobile_credential';

export interface MobileCredential {
  sessionId: string;
  mobileClaimToken: string;
}

/**
 * Parsea el valor del cookie o header de credencial móvil.
 * Formato preferido: `${sessionId}:${mobileClaimToken}`
 * Fallback: `${mobileClaimToken}`
 */
export function parseMobileCookieValue(val: string | undefined | null): MobileCredential | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const sessionId = trimmed.slice(0, colonIdx).trim();
    const mobileClaimToken = trimmed.slice(colonIdx + 1).trim();
    if (sessionId && mobileClaimToken) {
      return { sessionId, mobileClaimToken };
    }
  }

  // Fallback si solo contiene el token (32 bytes hex = 64 chars o > 20 chars)
  if (trimmed.length >= 20) {
    return { sessionId: '', mobileClaimToken: trimmed };
  }

  return null;
}

/**
 * Extrae la credencial móvil de una petición HTTP (Cookie HttpOnly, header personalizado o Bearer).
 */
export function getMobileCredentialFromRequest(req: NextRequest): MobileCredential | null {
  // 1. Prioridad: Cookie HttpOnly
  const cookieVal = req.cookies.get(SCANNER_MOBILE_COOKIE)?.value;
  const fromCookie = parseMobileCookieValue(cookieVal);
  if (fromCookie) return fromCookie;

  // 2. Fallback: Header x-mobile-claim-token
  const headerVal = req.headers.get('x-mobile-claim-token');
  const fromHeader = parseMobileCookieValue(headerVal);
  if (fromHeader) return fromHeader;

  // 3. Fallback: Authorization Bearer
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return parseMobileCookieValue(token);
    }
  }

  return null;
}

/**
 * Establece la cookie HttpOnly con la credencial móvil en la respuesta Next.js.
 */
export function setMobileCredentialCookie(
  res: NextResponse,
  sessionId: string,
  mobileClaimToken: string,
  expiresAt?: string
): void {
  const maxAgeSeconds = expiresAt
    ? Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    : 30 * 60; // 30 minutos por defecto

  res.cookies.set(SCANNER_MOBILE_COOKIE, `${sessionId}:${mobileClaimToken}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

/**
 * Invalida/elimina la cookie HttpOnly de la credencial móvil.
 */
export function clearMobileCredentialCookie(res: NextResponse): void {
  res.cookies.set(SCANNER_MOBILE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
