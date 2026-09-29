import { headers } from "next/headers";

/**
 * Origen (https://host) con el que se arman los links públicos (portal de
 * cotización, QR, recepciones). En desarrollo se toma del pedido actual, así
 * el link sale con el puerto en el que realmente está corriendo la app aunque
 * cambie en cada arranque. En producción manda NEXT_PUBLIC_APP_URL (el header
 * Host no es de fiar) y el pedido solo se usa si esa variable falta.
 */
export async function getAppOrigin(): Promise<string> {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && fromEnv) return fromEnv;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Fuera de un pedido (tests, scripts): se usa la variable.
  }
  return fromEnv;
}
