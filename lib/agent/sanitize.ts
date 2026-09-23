/** Remove credentials, bearer links and personal addresses from persisted diagnostics. */
export function sanitizeAgentError(value: unknown, maxLength = 500): string {
  const message = value instanceof Error ? value.message : String(value ?? "Unknown error");
  return message
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/giu, "$1 [REDACTED]")
    .replace(/\b(api[_ -]?key|authorization|cookie|set-cookie|token|secret|password)\s*[:=]\s*[^\s,;}]+/giu, "$1: [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/giu, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[EMAIL]")
    .replace(/https?:\/\/[^\s]+/giu, "[URL]")
    .slice(0, maxLength);
}
