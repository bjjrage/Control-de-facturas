import "server-only";
import type { NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReceiptPortalContext } from "@/lib/inventory/receipt-portal-data";
import { hashWarehousePortalToken } from "@/lib/inventory/portal";
import { getScanSessionByCredential } from "@/lib/scanner/session-service";
import { getMobileCredentialFromRequest } from "@/lib/scanner/cookies";
import { internalUploadPrincipal } from "./document-upload-server";
import { uploadPrincipal } from "./document-upload-ticket";
import type { DocumentUploadContext } from "./document-upload";

export async function authorizeDocumentUpload(context: DocumentUploadContext, request?: NextRequest): Promise<string> {
  if (context?.kind === "internal") {
    const profile = await getCurrentProfile();
    if (profile?.active && (profile.empresa_active || profile.is_super_admin) && profile.empresa_id
      && ["admin", "administracion"].includes(profile.role)) return internalUploadPrincipal(profile);
  } else if (context?.kind === "receipt" && typeof context.token === "string" && context.token.length <= 256) {
    if (await getReceiptPortalContext(context.token)) return uploadPrincipal("receipt", context.token);
  } else if (context?.kind === "warehouse" && typeof context.token === "string" && context.token.length <= 256) {
    const admin = createAdminClient();
    const { data: link } = await admin.from("warehouse_portal_links").select("id,empresa_id,location_id,created_by")
      .eq("token_hash", hashWarehousePortalToken(context.token)).eq("active", true).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (link) {
      const [{ data: location }, { data: sponsor }] = await Promise.all([
        admin.from("inventory_locations").select("id,project_id").eq("id", link.location_id).eq("empresa_id", link.empresa_id).eq("active", true).eq("location_type", "PROJECT").maybeSingle(),
        admin.from("profiles").select("id").eq("id", link.created_by).eq("empresa_id", link.empresa_id).eq("active", true).in("role", ["admin", "administracion"]).maybeSingle(),
      ]);
      if (location?.project_id && sponsor) return uploadPrincipal("warehouse", context.token);
    }
  } else if (context?.kind === "scanner") {
    const credential = context.mobileClaimToken || (request && getMobileCredentialFromRequest(request)?.mobileClaimToken);
    if (typeof credential === "string" && credential.length <= 256) {
      const session = await getScanSessionByCredential(credential);
      if (session && ["connected", "scanning", "processing"].includes(session.status) && new Date(session.expires_at).getTime() > Date.now()
        && session.storage_bucket === "invoice-files") return uploadPrincipal("scanner", credential);
    }
  }
  throw new Error("No se pudo autorizar la carga. Revisá la sesión o el enlace.");
}
