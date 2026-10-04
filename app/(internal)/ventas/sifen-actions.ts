"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { goekuaEmitirFactura, goekuaEmitirNotaCredito, goekuaConsultarDocumento, isGoekuaConfigured, isFiscalCdc, GOEKUA_RECONCILIATION_REQUIRED, type GoekuaDocumentoResult } from "@/lib/goekua";
import { buildGoekuaInvoice, buildGoekuaCreditNote } from "@/lib/goekua-payload";
import type { Client, Empresa, SalesDocument, SalesDocumentItem } from "@/lib/types";
import { canIssueSalesFiscalDocument } from "@/lib/sales";
import { validateSalesEmission } from "@/lib/sales-post-ot";

type Result = { ok?: true; cdc?: string; goekuaDocumentId?: string; reconciliationRequired?: boolean; kudeUrl?: string; xmlUrl?: string; error?: string };
type Company = Pick<Empresa, "nombre" | "email_empresa">;
type Db = Awaited<ReturnType<typeof createClient>>;
export type CreditNoteFiscalChoice = { emissionMotive?: number; sourceItemIds?: string[] };

async function issue(docId: string, type: "FACTURA" | "NOTA_CREDITO", choice: CreditNoteFiscalChoice = {}): Promise<Result> {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const db = await createClient();
  const { data: doc } = await db.from("sales_documents").select("*").eq("id", docId).eq("empresa_id", profile.empresa_id).single<SalesDocument>();
  if (!doc) return { error: "Documento no encontrado" };
  if (doc.doc_type !== type) return { error: type === "FACTURA" ? "Solo se pueden emitir facturas como FE" : "Solo aplica a notas de crédito" };
  if (!canIssueSalesFiscalDocument(doc.doc_type, doc.status)) return { error: "Primero emití el documento interno antes de emitir el documento fiscal; no puede estar anulado." };
  const lineage = await validateSalesEmission(db, doc, profile.empresa_id);
  if (lineage.error) return { error: lineage.error };
  // Metadata is checked after the audited lifecycle/provenance gates.
  if (doc.cdc) return { error: "Este documento ya tiene un CDC; no se permite otra emisión." };
  if (doc.goekua_document_id != null) return { error: GOEKUA_RECONCILIATION_REQUIRED };
  if (!isGoekuaConfigured()) return { error: "Facturación electrónica no configurada (falta GOEKUA_API_KEY)." };

  const [{ data: items }, { data: company }] = await Promise.all([
    db.from("sales_document_items").select("*").eq("sales_document_id", docId).eq("empresa_id", profile.empresa_id).order("created_at").returns<SalesDocumentItem[]>(),
    db.from("empresas").select("nombre, email_empresa").eq("id", profile.empresa_id).single<Company>(),
  ]);
  if (!items?.length) return { error: "El documento no tiene ítems" };
  if (!company) return { error: "Empresa no encontrada" };
  let result;
  try {
    if (type === "FACTURA") {
      const { data: client } = await db.from("clients").select("*").eq("id", doc.client_id).eq("empresa_id", profile.empresa_id).single<Client>();
      if (!client) return { error: "Cliente no encontrado" };
      const payload = buildGoekuaInvoice(doc, items, client, company);
      result = await goekuaEmitirFactura(payload);
    } else {
      const { data: source } = await db.from("sales_documents").select("cdc").eq("id", doc.source_document_id!).eq("empresa_id", profile.empresa_id).single<{ cdc: string | null }>();
      if (!isFiscalCdc(source?.cdc)) return { error: "La factura de origen debe estar emitida fiscalmente antes de emitir la NC." };
      const { data: sourceItems } = await db.from("sales_document_items").select("*").eq("sales_document_id", doc.source_document_id!).eq("empresa_id", profile.empresa_id).returns<SalesDocumentItem[]>();
      const payload = buildGoekuaCreditNote(doc, items, company, source.cdc, choice.emissionMotive, choice.sourceItemIds ?? [], sourceItems ?? []);
      // Existing append-only audit detail preserves the explicit human fiscal choice.
      const { error: auditError } = await db.rpc("log_audit_event", {
        p_action: "sifen.credit_note.requested",
        p_detail: { empresa_id: profile.empresa_id, sales_document_id: docId, source_document_id: doc.source_document_id,
          emissionMotive: payload.emissionMotive, items: payload.items, cdcElectronicDocumentAttached: source.cdc },
      });
      if (auditError) return { error: "No se pudo registrar el motivo fiscal de NC; no se envió a Goekua." };
      result = await goekuaEmitirNotaCredito(payload);
    }
  } catch (error) { return { error: error instanceof Error ? error.message : "Datos fiscales inválidos." }; }
  if ("error" in result) return { error: result.error + (result.detail ? `: ${result.detail}` : "") };
  return persist(db, docId, profile.empresa_id, result);
}

async function persist(db: Db, docId: string, tenant: string, result: GoekuaDocumentoResult): Promise<Result> {
  const cdc = isFiscalCdc(result.cdc) ? result.cdc : null;
  const { error } = await db.from("sales_documents").update({
    goekua_document_id: result.id, cdc,
    ...(result.xmlUrl ? { xml_url: result.xmlUrl } : {}),
    ...(result.kudeUrl ? { kude_url: result.kudeUrl } : {}),
  }).eq("id", docId).eq("empresa_id", tenant).select("id").single();
  if (error) return { error: `Goekua creó el documento (ID ${result.id}), pero no se pudo guardar en el ERP: ${error.message}. Requiere conciliación antes de reintentar; no se reintentó automáticamente.` };
  revalidatePath(`/ventas/${docId}`);
  return { ok: true, goekuaDocumentId: result.id, reconciliationRequired: !cdc, ...(cdc ? { cdc } : {}), ...(result.kudeUrl ? { kudeUrl: result.kudeUrl } : {}), ...(result.xmlUrl ? { xmlUrl: result.xmlUrl } : {}) };
}

export async function emitirFE(docId: string): Promise<Result> { return issue(docId, "FACTURA"); }
export async function emitirNC(docId: string, choice: CreditNoteFiscalChoice = {}): Promise<Result> { return issue(docId, "NOTA_CREDITO", choice); }

export async function consultarFE(docId: string): Promise<Result> {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const db = await createClient();
  const { data: doc } = await db.from("sales_documents").select("cdc, goekua_document_id, kude_url").eq("id", docId).eq("empresa_id", profile.empresa_id).single();
  if (!doc) return { error: "Documento no encontrado" };
  if (!doc.cdc && doc.goekua_document_id != null) return { error: GOEKUA_RECONCILIATION_REQUIRED };
  if (!isFiscalCdc(doc.cdc)) return { error: "Este documento no tiene un CDC fiscal real." };
  const result = await goekuaConsultarDocumento(doc.cdc);
  if ("error" in result) return { error: result.error };
  if (result.kudeUrl && result.kudeUrl !== doc.kude_url) {
    const { error } = await db.from("sales_documents").update({ kude_url: result.kudeUrl }).eq("id", docId).eq("empresa_id", profile.empresa_id).select("id").single();
    if (error) return { error: "No se pudo guardar el KUDE consultado." };
    revalidatePath(`/ventas/${docId}`);
  }
  return { ok: true, cdc: result.cdc, kudeUrl: result.kudeUrl };
}
