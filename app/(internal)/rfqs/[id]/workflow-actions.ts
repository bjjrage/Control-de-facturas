"use server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { loadRfqWorkspace, rpc, saveHumanAllocation } from "@/lib/rfq/service";
import {
  reconcileOffer,
  type DocumentFact,
  type OrderPreview,
} from "@/lib/rfq/domain";
import { readDocumentContent } from "@/lib/documents/reader";
import {
  extractDocumentFacts,
  documentFactsSchema,
} from "@/lib/rfq/reconciliation";
import { submitOfferForm } from "@/lib/rfq/offer-submission";

async function internal() {
  const profile = await requireProfile([
    "comercial",
    "administracion",
    "admin",
  ]);
  if (!profile.active) throw new Error("Cuenta inactiva");
  return { profile, db: await createClient() };
}
function failure(e: unknown) {
  return {
    error: e instanceof Error ? e.message : "Operación RFQ fallida",
    data: null,
  };
}
export async function openQuoteAttachmentAction(id: string) {
  try {
    const { profile, db } = await internal();
    const { data: a, error } = await db
      .from("attachments")
      .select("bucket,path")
      .eq("id", id)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (error || !a) throw new Error("Adjunto ajeno");
    const signed = await createAdminClient()
      .storage.from(a.bucket)
      .createSignedUrl(a.path, 120);
    if (signed.error || !signed.data)
      throw new Error("No se pudo abrir el adjunto");
    return { error: null, data: signed.data.signedUrl };
  } catch (e) {
    return failure(e);
  }
}
export async function renewMagicLinkAction(rfqId: string, providerId: string) {
  try {
    const { db } = await internal();
    await rpc(db, "rfq_renew_link", {
      p_rfq_id: rfqId,
      p_rfq_provider_id: providerId,
    });
    revalidatePath(`/rfqs/${rfqId}`);
    return { error: null, data: true };
  } catch (e) {
    return failure(e);
  }
}
export async function closeDiscoveryAction(rfqId: string, confirm: boolean) {
  try {
    const { db } = await internal();
    await rpc(db, "rfq_close_discovery", {
      p_rfq_id: rfqId,
      p_confirm: confirm,
    });
    revalidatePath(`/rfqs/${rfqId}`);
    return { error: null, data: true };
  } catch (e) {
    return failure(e);
  }
}
export async function saveAllocationAction(
  rfqId: string,
  lines: unknown,
  justification: string,
  revision: number,
) {
  try {
    const { db } = await internal();
    const data = await saveHumanAllocation(
      db,
      rfqId,
      lines,
      justification,
      revision,
    );
    revalidatePath(`/rfqs/${rfqId}`);
    return { error: null, data };
  } catch (e) {
    return failure(e);
  }
}
export async function authorizeAllocationAction(id: string, confirm: boolean) {
  try {
    const { db } = await internal();
    await rpc(db, "rfq_authorize_allocation", {
      p_allocation_id: id,
      p_confirm: confirm,
    });
    revalidatePath("/rfqs");
    return { error: null, data: true };
  } catch (e) {
    return failure(e);
  }
}
export async function previewOrdersAction(id: string) {
  try {
    const { db } = await internal();
    return {
      error: null,
      data: await rpc<OrderPreview>(db, "rfq_preview_orders", {
        p_allocation_id: id,
      }),
    };
  } catch (e) {
    return failure(e);
  }
}
export async function confirmOrdersAction(
  id: string,
  hash: string,
  confirm: boolean,
) {
  try {
    const { db } = await internal();
    const data = await rpc<{ orderIds: string[] }>(db, "rfq_confirm_orders", {
      p_allocation_id: id,
      p_preview_hash: hash,
      p_confirm: confirm,
    });
    revalidatePath("/rfqs");
    revalidatePath("/orders");
    return { error: null, data };
  } catch (e) {
    return failure(e);
  }
}
export async function extractQuoteDocumentAction(
  rfqId: string,
  versionId: string,
) {
  try {
    const { profile, db } = await internal();
    const workspace = await loadRfqWorkspace(db, profile.empresa_id, rfqId);
    const offers = workspace.offers.filter(
      (o) => o.quote_version_id === versionId,
    );
    if (!offers.length || !offers[0].attachment_id)
      throw new Error("Versión/documento no disponible");
    const extraction = await readDocumentContent({
      db: createAdminClient(),
      empresaId: profile.empresa_id,
      documentId: offers[0].attachment_id,
      maxChars: 50000,
      maxRows: 1000,
      maxSheets: 5,
    });
    if (
      extraction.warnings.some((w) =>
        w.startsWith("Error accediendo al storage:"),
      )
    )
      throw new Error(extraction.warnings.join(" · "));
    const facts = extractDocumentFacts(extraction, workspace.items);
    return {
      error: null,
      data: { extraction, facts, comparison: reconcileOffer(offers, facts) },
    };
  } catch (e) {
    return failure(e);
  }
}
export async function reviewQuoteAction(
  rfqId: string,
  versionId: string,
  facts: DocumentFact[],
  resolution: string,
) {
  try {
    const { db, profile } = await internal();
    const workspace = await loadRfqWorkspace(db, profile.empresa_id, rfqId);
    const offers = workspace.offers.filter(
      (o) => o.quote_version_id === versionId,
    );
    if (!offers.length) throw new Error("Versión ajena o no vigente");
    const verified = documentFactsSchema.parse(facts);
    const extracted = await extractQuoteDocumentAction(rfqId, versionId);
    if (extracted.error || !extracted.data)
      throw new Error(extracted.error ?? "Extracción fallida");
    const data = await rpc<string>(db, "rfq_review_quote", {
      p_version_id: versionId,
      p_extraction: {
        original: extracted.data.extraction,
        automaticFacts: extracted.data.facts,
        humanTranscription: verified,
      },
      p_comparison: {
        automatic: extracted.data.comparison,
        human: reconcileOffer(offers, verified),
      },
      p_resolution: resolution,
    });
    revalidatePath(`/rfqs/${rfqId}`);
    return { error: null, data };
  } catch (e) {
    return failure(e);
  }
}
export async function revokeMagicLinkAction(rfqId: string, providerId: string) {
  try {
    const { db } = await internal();
    await rpc(db, "rfq_revoke_link", {
      p_rfq_id: rfqId,
      p_rfq_provider_id: providerId,
    });
    revalidatePath(`/rfqs/${rfqId}`);
    return { error: null, data: true };
  } catch (e) {
    return failure(e);
  }
}
export async function submitInternalQuoteAction(
  providerId: string,
  fd: FormData,
) {
  try {
    const { profile } = await internal();
    const db = createAdminClient();
    const { data: rp, error } = await db
      .from("rfq_providers")
      .select("token,rfq_id")
      .eq("id", providerId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (error || !rp) throw new Error("Proveedor ajeno");
    const data = await submitOfferForm(
      db,
      rp.token,
      fd,
      profile.id,
      profile.empresa_id,
    );
    revalidatePath(`/rfqs/${rp.rfq_id}`);
    return { error: null, data };
  } catch (e) {
    return failure(e);
  }
}
