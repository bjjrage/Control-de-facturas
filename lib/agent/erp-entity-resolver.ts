// Resolver de entidades ERP para Rodrigo.
//
// Este módulo solo lee tablas existentes y siempre aplica empresa_id desde el
// contexto confiable del actor. No intenta inferir UUIDs ni duplica reglas de
// negocio: devuelve candidatos para que el LLM decida si hay una coincidencia
// clara o debe pedir una aclaración humana.
import type { SupabaseClient } from "@supabase/supabase-js";

export const ERP_ENTITY_TYPES = [
  "project",
  "client",
  "provider",
  "product",
  "invoice",
  "purchase_order",
  "rfq",
  "tender",
  "document",
  "warehouse",
  "spreadsheet",
  "subcontractor",
  "budget_item",
  "certificate",
  "sales_document",
  "work_order",
  "auction_room",
] as const;

export type ErpEntityType = (typeof ERP_ENTITY_TYPES)[number];

export interface EntityCandidate {
  entity_type: ErpEntityType;
  id: string;
  label: string;
  secondary: string | null;
  match_kind: "exact" | "partial";
  metadata: Record<string, unknown>;
}

export interface ResolveErpEntityResult {
  entity_type: ErpEntityType;
  query: string;
  candidates: EntityCandidate[];
  exact_match: EntityCandidate | null;
  ambiguous: boolean;
}

type Row = Record<string, unknown>;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeIlikeTerm(value: string): string {
  // El filtro .or() de PostgREST usa una gramática propia. No dejamos que un
  // query humano introduzca separadores, comodines o paréntesis.
  return value
    .replace(/[%,_()*.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function ilike(fields: string[], query: string): string {
  const term = safeIlikeTerm(query);
  return fields.map((field) => `${field}.ilike.%${term}%`).join(",");
}

function rank(label: string, secondary: string | null, query: string): number {
  const q = normalize(query);
  const l = normalize(label);
  const s = normalize(secondary);
  if (l === q || s === q) return 100;
  if (l.startsWith(q) || s.startsWith(q)) return 75;
  if (l.includes(q) || s.includes(q)) return 50;
  return 10;
}

function candidate(
  entityType: ErpEntityType,
  row: Row,
  label: string,
  secondary: string | null,
  query: string,
  metadata: Record<string, unknown> = {}
): EntityCandidate & { _rank: number } {
  const matchRank = rank(label, secondary, query);
  return {
    entity_type: entityType,
    id: String(row.id),
    label,
    secondary,
    match_kind: matchRank === 100 ? "exact" : "partial",
    metadata,
    _rank: matchRank,
  };
}

async function readRows(
  db: SupabaseClient,
  table: string,
  columns: string,
  empresaId: string,
  filter?: string,
  limit = 12
): Promise<Row[]> {
  let query = db.from(table).select(columns).eq("empresa_id", empresaId);
  if (filter) query = query.or(filter);
  const { data, error } = await query.limit(limit);
  if (error) throw new Error(`No se pudo buscar ${table}: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

async function resolveRows(
  db: SupabaseClient,
  empresaId: string,
  entityType: ErpEntityType,
  query: string
): Promise<Array<EntityCandidate & { _rank: number }>> {
  switch (entityType) {
    case "project": {
      const rows = await readRows(db, "projects", "id, name, code, client, location, status", empresaId, ilike(["name", "code", "client"], query));
      return rows.map((row) => candidate(entityType, row, String(row.name ?? row.code), row.code ? String(row.code) : null, query, { status: row.status, client: row.client, location: row.location }));
    }
    case "client": {
      const rows = await readRows(db, "clients", "id, name, tax_id, contact_name, email, phone, active", empresaId, ilike(["name", "tax_id", "email", "contact_name"], query));
      return rows.map((row) => candidate(entityType, row, String(row.name), row.tax_id ? `RUC ${row.tax_id}` : row.email ? String(row.email) : null, query, { tax_id: row.tax_id, email: row.email, active: row.active }));
    }
    case "provider": {
      const rows = await readRows(db, "providers", "id, name, tax_id, contact_name, email, phone, active", empresaId, ilike(["name", "tax_id", "email", "contact_name"], query));
      return rows.map((row) => candidate(entityType, row, String(row.name), row.tax_id ? `RUC ${row.tax_id}` : row.email ? String(row.email) : null, query, { tax_id: row.tax_id, email: row.email, active: row.active }));
    }
    case "product": {
      const rows = await readRows(db, "productos", "id, nombre, descripcion, unidad, sku, stock_actual, stock_minimo, activo", empresaId, ilike(["nombre", "descripcion", "sku"], query));
      return rows.map((row) => candidate(entityType, row, String(row.nombre), row.sku ? `SKU ${row.sku}` : row.unidad ? String(row.unidad) : null, query, { unidad: row.unidad, stock_actual: row.stock_actual, stock_minimo: row.stock_minimo, activo: row.activo }));
    }
    case "invoice": {
      let rows = await readRows(db, "invoices", "id, invoice_number, invoice_date, provider_id, total, currency, status, timbrado", empresaId, ilike(["invoice_number", "timbrado"], query));
      if (rows.length === 0) {
        const providers = await readRows(db, "providers", "id, name, tax_id", empresaId, ilike(["name", "tax_id"], query), 8);
        const ids = providers.map((row) => String(row.id));
        if (ids.length > 0) {
          const result = await db.from("invoices").select("id, invoice_number, invoice_date, provider_id, total, currency, status, timbrado").eq("empresa_id", empresaId).in("provider_id", ids).limit(12);
          if (result.error) throw new Error(`No se pudo buscar invoices: ${result.error.message}`);
          rows = (result.data ?? []) as Row[];
        }
      }
      return rows.map((row) => candidate(entityType, row, String(row.invoice_number), row.timbrado ? `Timbrado ${row.timbrado}` : String(row.invoice_date ?? ""), query, { provider_id: row.provider_id, total: row.total, currency: row.currency, status: row.status, invoice_date: row.invoice_date }));
    }
    case "purchase_order": {
      const rows = await readRows(db, "authorized_orders", "id, code, provider_id, provider_name, client_name, product, quantity, unit, total_price, currency, status, authorized_at, project_id", empresaId, ilike(["code", "provider_name", "client_name", "product"], query));
      return rows.map((row) => candidate(entityType, row, String(row.code), row.provider_name ? String(row.provider_name) : row.product ? String(row.product) : null, query, { provider_id: row.provider_id, project_id: row.project_id, total_price: row.total_price, currency: row.currency, status: row.status, authorized_at: row.authorized_at }));
    }
    case "rfq": {
      const rows = await readRows(db, "rfqs", "id, code, client_name, product, internal_reference, status, required_date, created_at, project_id", empresaId, ilike(["code", "client_name", "product", "internal_reference"], query));
      return rows.map((row) => candidate(entityType, row, String(row.code), row.client_name ? String(row.client_name) : row.product ? String(row.product) : null, query, { project_id: row.project_id, status: row.status, created_at: row.created_at, required_date: row.required_date }));
    }
    case "tender": {
      const rows = await readRows(db, "licitaciones", "id, dncp_nro, ocid, titulo, comitente_nombre, categoria, estado, decision, project_id, fecha_entrega_ofertas", empresaId, ilike(["titulo", "dncp_nro", "ocid", "comitente_nombre"], query));
      return rows.map((row) => candidate(entityType, row, String(row.titulo), row.dncp_nro ? `DNCP ${row.dncp_nro}` : row.comitente_nombre ? String(row.comitente_nombre) : null, query, { ocid: row.ocid, estado: row.estado, decision: row.decision, project_id: row.project_id, fecha_entrega_ofertas: row.fecha_entrega_ofertas }));
    }
    case "document": {
      const rows = await readRows(db, "empresa_documentos", "id, tipo, descripcion, storage_path, fecha_emision, fecha_vencimiento, notas, updated_at", empresaId, ilike(["tipo", "descripcion", "storage_path", "notas"], query));
      return rows.map((row) => candidate(entityType, row, String(row.descripcion ?? row.tipo), row.tipo ? String(row.tipo) : null, query, { tipo: row.tipo, storage_path: row.storage_path, fecha_emision: row.fecha_emision, fecha_vencimiento: row.fecha_vencimiento, notas: row.notas }));
    }
    case "warehouse": {
      const [locations, legacy] = await Promise.all([
        readRows(db, "inventory_locations", "id, name, location_type, project_id, is_primary, active", empresaId, ilike(["name", "location_type"], query)),
        readRows(db, "depositos", "id, nombre, es_principal, project_id, activo", empresaId, ilike(["nombre"], query)),
      ]);
      const current = locations.map((row) => candidate(entityType, row, String(row.name), String(row.location_type ?? ""), query, { location_type: row.location_type, project_id: row.project_id, is_primary: row.is_primary, active: row.active }));
      const old = legacy.map((row) => candidate(entityType, row, String(row.nombre), row.es_principal ? "principal" : null, query, { legacy_deposito_id: row.id, project_id: row.project_id, es_principal: row.es_principal, active: row.activo }));
      return [...current, ...old];
    }
    case "spreadsheet": {
      const rows = await readRows(db, "planillas", "id, modulo, contexto, estado, created_at, updated_at, confirmed_at", empresaId, undefined, 100);
      const q = normalize(query);
      return rows
        .filter((row) => normalize(JSON.stringify(row.contexto)).includes(q) || normalize(row.modulo).includes(q))
        .slice(0, 12)
        .map((row) => candidate(entityType, row, String(row.modulo), String(row.estado), query, { contexto: row.contexto, estado: row.estado, updated_at: row.updated_at, confirmed_at: row.confirmed_at }));
    }
    case "subcontractor": {
      const rows = await readRows(
        db,
        "subcontractors",
        "id, name, ruc, contact_name, contact_phone, specialty",
        empresaId,
        ilike(["name", "ruc", "contact_name", "specialty"], query)
      );
      return rows.map((row) => candidate(entityType, row, String(row.name), row.ruc ? `RUC ${row.ruc}` : row.specialty ? String(row.specialty) : null, query, {
        contact_name: row.contact_name,
        contact_phone: row.contact_phone,
        specialty: row.specialty,
      }));
    }
    case "budget_item": {
      const projects = await readRows(db, "projects", "id", empresaId);
      const projectIds = projects.map((row) => String(row.id));
      if (projectIds.length === 0) return [];
      const { data, error } = await db
        .from("budget_items")
        .select("id, project_id, code, description, unit, quantity, unit_price, subtotal")
        .in("project_id", projectIds)
        .or(ilike(["code", "description"], query))
        .limit(12);
      if (error) throw new Error(`No se pudo buscar partidas: ${error.message}`);
      return ((data ?? []) as Row[]).map((row) => candidate(entityType, row, String(row.description), row.code ? String(row.code) : null, query, {
        project_id: row.project_id,
        unit: row.unit,
        quantity: row.quantity,
        unit_price: row.unit_price,
        subtotal: row.subtotal,
      }));
    }
    case "certificate": {
      const projects = await readRows(db, "projects", "id", empresaId);
      const projectIds = projects.map((row) => String(row.id));
      if (projectIds.length === 0) return [];
      const { data, error } = await db
        .from("project_certificates")
        .select("id, project_id, numero, period_start, period_end, status, monto_acumulado")
        .in("project_id", projectIds)
        .limit(12);
      if (error) throw new Error(`No se pudo buscar certificados: ${error.message}`);
      return ((data ?? []) as Row[]).map((row) => candidate(entityType, row, `Certificado ${row.numero}`, `${row.period_start ?? ""} ${row.period_end ?? ""}`.trim() || null, query, {
        project_id: row.project_id,
        status: row.status,
        monto_acumulado: row.monto_acumulado,
      }));
    }
    case "sales_document": {
      const rows = await readRows(db, "sales_documents", "id, client_id, code, doc_type, issue_date, total, currency, status", empresaId, ilike(["code", "doc_type", "status"], query));
      return rows.map((row) => candidate(entityType, row, String(row.code), `${row.doc_type ?? ""} ${row.issue_date ?? ""}`.trim() || null, query, {
        client_id: row.client_id,
        doc_type: row.doc_type,
        total: row.total,
        currency: row.currency,
        status: row.status,
      }));
    }
    case "work_order": {
      const documents = await readRows(db, "sales_documents", "id", empresaId);
      const documentIds = documents.map((row) => String(row.id));
      if (documentIds.length === 0) return [];
      const { data, error } = await db
        .from("work_orders")
        .select("id, sales_document_id, status, workflow_status, created_at")
        .in("sales_document_id", documentIds)
        .or(ilike(["status", "workflow_status"], query))
        .limit(12);
      if (error) throw new Error(`No se pudo buscar órdenes de trabajo: ${error.message}`);
      return ((data ?? []) as Row[]).map((row) => candidate(entityType, row, `OT ${row.id}`, `${row.status ?? ""} ${row.workflow_status ?? ""}`.trim() || null, query, {
        sales_document_id: row.sales_document_id,
        status: row.status,
        workflow_status: row.workflow_status,
        created_at: row.created_at,
      }));
    }
    case "auction_room": {
      const rows = await readRows(db, "auction_sandbox_rooms", "id, title, group_id, scope, status, opening_price_pyg, started_at, closed_at", empresaId, ilike(["title", "group_id", "scope", "status"], query));
      return rows.map((row) => candidate(entityType, row, String(row.title), row.group_id ? String(row.group_id) : null, query, {
        scope: row.scope,
        status: row.status,
        opening_price_pyg: row.opening_price_pyg,
        started_at: row.started_at,
        closed_at: row.closed_at,
      }));
    }
  }
}

export async function resolveErpEntity(
  db: SupabaseClient,
  empresaId: string,
  entityType: ErpEntityType,
  query: string
): Promise<ResolveErpEntityResult> {
  if (!normalize(query)) {
    return { entity_type: entityType, query, candidates: [], exact_match: null, ambiguous: false };
  }
  const candidates = (await resolveRows(db, empresaId, entityType, query))
    .sort((a, b) => b._rank - a._rank || a.label.localeCompare(b.label))
    .slice(0, 10)
    .map((row) => {
      const clean = { ...row } as EntityCandidate & { _rank?: number };
      delete clean._rank;
      return clean as EntityCandidate;
    });
  const exact = candidates.filter((row) => row.match_kind === "exact");
  return {
    entity_type: entityType,
    query,
    candidates,
    exact_match: exact.length === 1 ? exact[0] : null,
    ambiguous: candidates.length > 1 && exact.length !== 1,
  };
}
