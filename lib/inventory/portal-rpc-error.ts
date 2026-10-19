/**
 * Un error del RPC solo es un rechazo DEFINITIVO si la base lo respondió con un SQLSTATE de negocio
 * (p. ej. P0001 de RAISE EXCEPTION, 23xxx, 42xxx). Si no hay código (fallo de red, timeout, gateway) o
 * es de conexión/recursos, la operación pudo haberse confirmado: el cliente debe conservar su intento
 * y reintentar con la misma clave (idempotente) en vez de generar otra salida.
 */
type RpcError = { message?: string | null; code?: string | null } | null | undefined;

const AMBIGUOUS_CLASS = /^(08|53|57|58|XX)/;

export function isDefiniteRpcRejection(error: RpcError): boolean {
  const code = String(error?.code ?? "");
  return /^[0-9A-Z]{5}$/.test(code) && !AMBIGUOUS_CLASS.test(code);
}

export function classifyPortalRpcError(
  error: NonNullable<RpcError>,
  fallback: string,
  definiteStatus = 400,
): { status: number; error: string } {
  if (isDefiniteRpcRejection(error)) return { status: definiteStatus, error: error.message || fallback };
  return {
    status: 503,
    error: "No se pudo confirmar si la operación quedó registrada. Reintentá con los mismos datos: no se duplicará.",
  };
}
