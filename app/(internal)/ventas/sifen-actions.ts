"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  goekuaEmitirFactura,
  goekuaConsultarDocumento,
  isGoekuaConfigured,
  type GoekuaFacturaPayload,
} from "@/lib/goekua";
import type { Client, Empresa, SalesDocument, SalesDocumentItem } from "@/lib/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function buildPayload(
  doc: SalesDocument,
  items: SalesDocumentItem[],
  client: Client,
  empresa: Pick<Empresa, "nombre" | "ruc" | "email_empresa">
): GoekuaFacturaPayload {
  const establishmentId  = parseInt(process.env.GOEKUA_ESTABLISHMENT_ID  ?? "1");
  const establishmentAddr = process.env.GOEKUA_ESTABLISHMENT_ADDRESS ?? "";
  const establishmentName = process.env.GOEKUA_ESTABLISHMENT_NAME   ?? empresa.nombre;
  const pointOfExpedition = process.env.GOEKUA_POINT_OF_EXPEDITION  ?? "001";
  const timbrado          = process.env.GOEKUA_TIMBRADO;

  // ¿El cliente es contribuyente? Tiene RUC si el tax_id contiene guión p.ej. "80012345-6"
  const isContribuyente = !!(client.tax_id && client.tax_id.includes("-"));

  const payload: GoekuaFacturaPayload = {
    user: {
      name:           empresa.nombre,
      email:          empresa.email_empresa ?? "",
      documentType:   2, // RUC
      documentNumber: empresa.ruc ?? "0000000-0",
    },
    client: {
      ruc:          client.tax_id ?? "0000000-0",
      businessName: client.name,
      address:      client.address ?? undefined,
      contributor:  isContribuyente,
    },
    establishment: {
      id:           establishmentId,
      address:      establishmentAddr,
      denomination: establishmentName,
    },
    items: items.map((it) => ({
      description: it.description,
      quantity:    it.quantity,
      unitPrice:   it.unit_price,
      vatRate:     it.vat_rate as 0 | 5 | 10,
      total:       it.line_total,
    })),
    paymentMethods: [{ type: 1, amount: doc.total }], // contado / efectivo por defecto
    currency:                doc.currency,
    currencyRate:            1,
    transactionType:         1, // venta de mercadería / servicio
    operationConditionType:  1, // contado
    emissionType:            1, // normal
    presenceIndicatorType:   1, // presencial
    documentNumber:          doc.code,
    pointOfExpedition,
  };

  if (timbrado) payload.timbrado = timbrado;
  return payload;
}

// ── acciones públicas ─────────────────────────────────────────────────────────

export async function emitirFE(
  docId: string
): Promise<{ ok?: true; cdc?: string; error?: string }> {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  if (!isGoekuaConfigured()) {
    return { error: "Facturación electrónica no configurada (falta GOEKUA_API_KEY). Contactá al administrador." };
  }

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", docId)
    .single<SalesDocument>();

  if (!doc)                         return { error: "Documento no encontrado" };
  if (doc.doc_type !== "FACTURA")   return { error: "Solo se pueden emitir facturas como FE" };
  if (doc.cdc)                      return { error: "Este documento ya tiene un CDC — ya fue emitido" };
  if (doc.status === "ANULADA")     return { error: "No se puede emitir una factura anulada" };

  const [{ data: items }, { data: client }, { data: empresa }] = await Promise.all([
    supabase
      .from("sales_document_items")
      .select("*")
      .eq("sales_document_id", docId)
      .returns<SalesDocumentItem[]>(),
    supabase.from("clients").select("*").eq("id", doc.client_id).single<Client>(),
    supabase
      .from("empresas")
      .select("nombre, ruc, email_empresa")
      .eq("id", doc.empresa_id)
      .single<Pick<Empresa, "nombre" | "ruc" | "email_empresa">>(),
  ]);

  if (!client)        return { error: "Cliente no encontrado" };
  if (!items?.length) return { error: "La factura no tiene ítems" };

  const payload = buildPayload(doc, items, client, empresa ?? { nombre: "Empresa", ruc: null, email_empresa: null });
  const result  = await goekuaEmitirFactura(payload);

  if ("error" in result) {
    return { error: result.error + (result.detail ? `: ${result.detail}` : "") };
  }

  await supabase
    .from("sales_documents")
    .update({
      cdc:     result.cdc     ?? result.id,
      xml_url: result.xmlUrl  ?? null,
      kude_url:result.kudeUrl ?? null,
    })
    .eq("id", docId);

  revalidatePath(`/ventas/${docId}`);
  return { ok: true, cdc: result.cdc };
}

export async function emitirNC(
  docId: string
): Promise<{ ok?: true; cdc?: string; error?: string }> {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  if (!isGoekuaConfigured()) {
    return { error: "Facturación electrónica no configurada (falta GOEKUA_API_KEY). Contactá al administrador." };
  }

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", docId)
    .single<SalesDocument>();

  if (!doc)                              return { error: "Documento no encontrado" };
  if (doc.doc_type !== "NOTA_CREDITO")   return { error: "Solo aplica a notas de crédito" };
  if (doc.cdc)                           return { error: "Esta NC ya tiene un CDC — ya fue emitida" };
  if (doc.status === "ANULADA")          return { error: "No se puede emitir una NC anulada" };

  // CDC de la factura origen (si tiene)
  let sourceCdc: string | null = null;
  if (doc.source_document_id) {
    const { data: src } = await supabase
      .from("sales_documents")
      .select("cdc")
      .eq("id", doc.source_document_id)
      .single<{ cdc: string | null }>();
    sourceCdc = src?.cdc ?? null;
  }

  const [{ data: items }, { data: client }, { data: empresa }] = await Promise.all([
    supabase
      .from("sales_document_items")
      .select("*")
      .eq("sales_document_id", docId)
      .returns<SalesDocumentItem[]>(),
    supabase.from("clients").select("*").eq("id", doc.client_id).single<Client>(),
    supabase
      .from("empresas")
      .select("nombre, ruc, email_empresa")
      .eq("id", doc.empresa_id)
      .single<Pick<Empresa, "nombre" | "ruc" | "email_empresa">>(),
  ]);

  if (!client)        return { error: "Cliente no encontrado" };
  if (!items?.length) return { error: "La NC no tiene ítems" };

  const basePayload = buildPayload(
    doc,
    items,
    client,
    empresa ?? { nombre: "Empresa", ruc: null, email_empresa: null }
  );

  // Goekua credit-note: mismo payload que factura + referencia al CDC origen
  const ncPayload = {
    ...basePayload,
    ...(sourceCdc ? { referencedCdc: sourceCdc } : {}),
  };

  const establishmentId   = parseInt(process.env.GOEKUA_ESTABLISHMENT_ID  ?? "1");
  const establishmentAddr = process.env.GOEKUA_ESTABLISHMENT_ADDRESS ?? "";
  const establishmentName = process.env.GOEKUA_ESTABLISHMENT_NAME ?? (empresa?.nombre ?? "Empresa");
  const pointOfExpedition = process.env.GOEKUA_POINT_OF_EXPEDITION ?? "001";
  const timbrado          = process.env.GOEKUA_TIMBRADO;

  const payload = {
    ...ncPayload,
    establishment: { id: establishmentId, address: establishmentAddr, denomination: establishmentName },
    pointOfExpedition,
    ...(timbrado ? { timbrado } : {}),
  };

  if (!process.env.GOEKUA_API_KEY) return { error: "GOEKUA_API_KEY no configurada" };

  const goekuaBaseUrl = process.env.GOEKUA_BASE_URL ?? "https://api.goekua.com.py";
  let result: { id: string; cdc?: string; xmlUrl?: string; kudeUrl?: string } | { error: string; detail?: string };
  try {
    const res = await fetch(`${goekuaBaseUrl}/api/electronic-document/generate-credit-note`, {
      method: "POST",
      headers: { "x-api-key": process.env.GOEKUA_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 201) {
      const data = await res.json();
      result = { id: data.id, cdc: data.cdc, xmlUrl: data.xmlUrl, kudeUrl: data.kudeUrl };
    } else {
      const body = await res.text();
      result = { error: `Goekua respondió ${res.status}`, detail: body };
    }
  } catch (e) {
    result = { error: "Error de red al conectar con Goekua", detail: String(e) };
  }

  if ("error" in result) {
    return { error: result.error + (result.detail ? `: ${result.detail}` : "") };
  }

  await supabase
    .from("sales_documents")
    .update({
      cdc:      result.cdc     ?? result.id,
      xml_url:  result.xmlUrl  ?? null,
      kude_url: result.kudeUrl ?? null,
    })
    .eq("id", docId);

  revalidatePath(`/ventas/${docId}`);
  return { ok: true, cdc: result.cdc };
}

export async function consultarFE(
  docId: string
): Promise<{ ok?: true; cdc?: string; kudeUrl?: string; error?: string }> {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("cdc, kude_url")
    .eq("id", docId)
    .single();

  if (!doc?.cdc) return { error: "Este documento no tiene CDC" };

  const result = await goekuaConsultarDocumento(doc.cdc);
  if ("error" in result) return { error: result.error };

  if (result.kudeUrl && result.kudeUrl !== doc.kude_url) {
    await supabase
      .from("sales_documents")
      .update({ kude_url: result.kudeUrl, xml_url: result.xmlUrl ?? null })
      .eq("id", docId);
    revalidatePath(`/ventas/${docId}`);
  }

  return { ok: true, cdc: result.cdc, kudeUrl: result.kudeUrl };
}
