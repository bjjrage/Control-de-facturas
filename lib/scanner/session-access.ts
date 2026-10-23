import { sanitizeFileName } from "@/lib/storage";

export const SCANNER_STORAGE_BUCKET = "invoice-files";

export type ScannerRole = "comercial" | "administracion" | "admin";

const SCANNER_ROLES: readonly ScannerRole[] = ["comercial", "administracion", "admin"];
const INVOICE_SCANNER_ROLES: readonly ScannerRole[] = ["administracion", "admin"];

export function canCreateScannerContext(role: string, contextType: unknown): contextType is "general" | "invoice" {
  if (!SCANNER_ROLES.includes(role as ScannerRole)) return false;
  if (contextType === "general") return true;
  return contextType === "invoice" && INVOICE_SCANNER_ROLES.includes(role as ScannerRole);
}

export function canReadScannerContext(role: string, contextType: unknown): boolean {
  if (!SCANNER_ROLES.includes(role as ScannerRole)) return false;
  if (contextType === "general") return true;
  return contextType === "invoice" && INVOICE_SCANNER_ROLES.includes(role as ScannerRole);
}

export interface ScannerObjectReference {
  id: string;
  empresa_id: string;
  context_type: string;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
}

export function isScannerObjectReferenceValid(session: ScannerObjectReference): boolean {
  if (
    session.storage_bucket !== SCANNER_STORAGE_BUCKET ||
    !session.storage_path ||
    !session.file_name ||
    !canReadScannerContext("admin", session.context_type)
  ) {
    return false;
  }

  const expectedPath = `${session.empresa_id}/scans/${session.id}/${sanitizeFileName(session.file_name)}`;
  return session.storage_path === expectedPath;
}
