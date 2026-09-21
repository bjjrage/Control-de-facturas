import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CANONICAL_ASSETS,
  DEMO_IDS,
  REQUIRED_DOMAINS,
  SEED_PLAN,
  validateCanonicalDemoManifest,
} from "../../tests/fixtures/erp-demo/canonical-demo";

type Row = Record<string, unknown>;
type AdminClient = SupabaseClient<any, "public", any>;

const PRODUCTION_PROJECT_REF = "ezucivipgmbvamhugkbj";
const args = new Set(process.argv.slice(2));

function fail(message: string): never {
  throw new Error(`[canonical-e2e-seed] ${message}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`Falta la variable requerida ${name}.`);
  return value;
}

function validateManifest(): void {
  const errors = validateCanonicalDemoManifest();
  if (errors.length > 0) fail(errors.join("\n"));
}

function printPlan(): void {
  validateManifest();
  console.log(`Canonical ERP demo ${CANONICAL_ASSETS.length > 0 ? "ready" : "incomplete"}`);
  console.log(`version: 2026-09-21`);
  console.log(`domains: ${REQUIRED_DOMAINS.join(", ")}`);
  for (const item of SEED_PLAN) {
    console.log(`- ${item.domain}: ${item.tables.join(", ")}`);
  }
  console.log("assets:");
  for (const asset of CANONICAL_ASSETS) {
    console.log(`- ${asset.kind}: ${asset.path}`);
  }
  console.log("No se abrió ninguna conexión a Supabase.");
}

function assertSafeRuntime(url: string): void {
  if (url.includes(PRODUCTION_PROJECT_REF)) {
    fail(`La URL apunta al proyecto productivo (${PRODUCTION_PROJECT_REF}). Abortando.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("E2E_SUPABASE_URL no es una URL válida.");
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const mode = process.env.E2E_SEED_MODE;
  if (mode !== "local" && mode !== "test") {
    fail("E2E_SEED_MODE debe ser 'local' o 'test'.");
  }
  if (!isLocal && process.env.E2E_ALLOW_REMOTE !== "1") {
    fail("El seed remoto requiere E2E_ALLOW_REMOTE=1 y nunca puede apuntar a producción.");
  }
  if (!isLocal && mode !== "test") {
    fail("Una URL remota solo puede usarse con E2E_SEED_MODE=test.");
  }
}

function createAdminClient(): AdminClient {
  const url = requiredEnv("E2E_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("E2E_SERVICE_ROLE_KEY");
  assertSafeRuntime(url);
  return createClient<any>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function upsertRows(db: AdminClient, table: string, rows: Row[], onConflict = "id"): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) fail(`${table}: ${error.message}`);
}

async function deleteRows(db: AdminClient, table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.from(table).delete().in("id", ids);
  if (error) fail(`reset ${table}: ${error.message}`);
}

async function ensureTestUser(db: AdminClient): Promise<string> {
  const email = requiredEnv("E2E_TEST_EMAIL").toLowerCase();
  const password = requiredEnv("E2E_TEST_PASSWORD");
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) fail(`auth.listUsers: ${error.message}`);

  const existing = data.users.find((user) => user.email?.toLowerCase() === email);
  if (existing) {
    const { error: updateError } = await db.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (updateError) fail(`auth.updateUserById: ${updateError.message}`);
    return existing.id;
  }

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Canonical E2E Admin" },
  });
  if (createError || !created.user) fail(`auth.createUser: ${createError?.message ?? "sin usuario"}`);
  return created.user.id;
}

async function seedDemo(db: AdminClient, userId: string): Promise<void> {
  const ids = DEMO_IDS;

  await upsertRows(db, "empresas", [
    {
      id: ids.empresa,
      nombre: "Canonical E2E Demo",
      slug: "canonical-e2e-demo",
      plan: "caterpillar",
      modulo_compras: true,
      modulo_ventas: true,
      active: true,
    },
  ]);
  await upsertRows(db, "profiles", [
    {
      id: userId,
      email: requiredEnv("E2E_TEST_EMAIL").toLowerCase(),
      full_name: "Canonical E2E Admin",
      role: "admin",
      active: true,
      empresa_id: ids.empresa,
    },
  ]);

  await upsertRows(db, "providers", [
    {
      id: ids.provider,
      empresa_id: ids.empresa,
      name: "Proveedor Demo Construcción",
      contact_name: "Ana Proveedora",
      email: "proveedor-demo@example.test",
      phone: "+595 21 555 0101",
      tax_id: "80000001-1",
      active: true,
    },
    {
      id: ids.providerReview,
      empresa_id: ids.empresa,
      name: "Proveedor Demo Revisión",
      contact_name: "Bruno Proveedor",
      email: "proveedor-revision@example.test",
      phone: "+595 21 555 0102",
      tax_id: "80000002-2",
      active: true,
    },
  ]);
  await upsertRows(db, "clients", [
    {
      id: ids.client,
      empresa_id: ids.empresa,
      name: "Cliente Demo Aurora",
      tax_id: "80100001-1",
      contact_name: "Claudia Cliente",
      email: "cliente-demo@example.test",
      phone: "+595 21 555 0201",
      address: "Asunción",
      payment_terms: "30 días",
      active: true,
    },
  ]);

  await upsertRows(db, "categorias_producto", [
    { id: ids.category, empresa_id: ids.empresa, nombre: "Materiales E2E", orden: 1 },
  ]);
  await upsertRows(db, "productos", [
    {
      id: ids.product,
      empresa_id: ids.empresa,
      categoria_id: ids.category,
      nombre: "Cemento estructural demo",
      descripcion: "Material estable para pruebas de inventario",
      unidad: "bolsa",
      sku: "E2E-CEM-001",
      stock_actual: 80,
      stock_minimo: 20,
      activo: true,
      created_by: userId,
    },
    {
      id: ids.productCritical,
      empresa_id: ids.empresa,
      categoria_id: ids.category,
      nombre: "Aditivo crítico demo",
      descripcion: "Producto deliberadamente bajo mínimo para alertas",
      unidad: "unidad",
      sku: "E2E-ADI-001",
      stock_actual: 2,
      stock_minimo: 10,
      activo: true,
      created_by: userId,
    },
  ]);
  await upsertRows(db, "stock_movimientos", [
    {
      id: "10000000-0000-4000-8000-000000000411",
      empresa_id: ids.empresa,
      producto_id: ids.product,
      tipo: "AJUSTE",
      cantidad: 80,
      stock_resultante: 80,
      referencia_tipo: "E2E_SEED",
      notas: "Saldo inicial canónico",
      created_by: userId,
    },
    {
      id: "10000000-0000-4000-8000-000000000412",
      empresa_id: ids.empresa,
      producto_id: ids.productCritical,
      tipo: "AJUSTE",
      cantidad: 2,
      stock_resultante: 2,
      referencia_tipo: "E2E_SEED",
      notas: "Saldo bajo mínimo canónico",
      created_by: userId,
    },
  ]);

  await upsertRows(db, "projects", [
    {
      id: ids.project,
      empresa_id: ids.empresa,
      name: "Edificio Aurora E2E",
      code: "E2E-AURORA",
      client: "Cliente Demo Aurora",
      location: "Asunción",
      start_date: "2026-01-15",
      end_date: "2026-12-15",
      status: "ACTIVO",
      budget_total: 1250000000,
      created_by: userId,
      comitente: "Municipalidad Demo",
      contract_number: "E2E-CONTRACT-001",
      contract_amount: 1250000000,
      plazo_dias: 334,
      orden_inicio_date: "2026-01-15",
    },
  ]);
  await upsertRows(db, "budget_items", [
    {
      id: ids.budgetFoundation,
      project_id: ids.project,
      code: "E2E-EST-001",
      description: "Fundaciones de hormigón",
      unit: "m3",
      quantity: 120,
      unit_price: 780000,
      sort_order: 1,
      start_date: "2026-01-15",
      end_date: "2026-03-31",
    },
    {
      id: ids.budgetFinishes,
      project_id: ids.project,
      code: "E2E-TER-001",
      description: "Terminaciones interiores",
      unit: "m2",
      quantity: 850,
      unit_price: 58000,
      sort_order: 2,
      start_date: "2026-06-01",
      end_date: "2026-09-30",
    },
    {
      id: ids.budgetMaterials,
      project_id: ids.project,
      code: "E2E-MAT-001",
      description: "Materiales de apoyo",
      unit: "lote",
      quantity: 1,
      unit_price: 120000000,
      sort_order: 3,
      start_date: "2026-02-01",
      end_date: "2026-05-31",
    },
  ]);
  await upsertRows(db, "execution_entries", [
    {
      id: ids.executionFoundation,
      project_id: ids.project,
      budget_item_id: ids.budgetFoundation,
      entry_date: "2026-03-15",
      quantity_executed: 72,
      notes: "Avance certificado de fundaciones",
      recorded_by: userId,
    },
    {
      id: ids.executionFinishes,
      project_id: ids.project,
      budget_item_id: ids.budgetFinishes,
      entry_date: "2026-09-15",
      quantity_executed: 400,
      notes: "Avance parcial de terminaciones",
      recorded_by: userId,
    },
  ]);
  await upsertRows(db, "project_schedule_plans", [
    { id: ids.schedulePlan, project_id: ids.project, label: "Cronograma base E2E", is_active: true },
  ]);
  await upsertRows(db, "project_schedule_plan_months", [
    { id: ids.scheduleMonthOne, plan_id: ids.schedulePlan, month_index: 1, programado_pct: 20 },
    { id: ids.scheduleMonthTwo, plan_id: ids.schedulePlan, month_index: 2, programado_pct: 35 },
    { id: ids.scheduleMonthThree, plan_id: ids.schedulePlan, month_index: 3, programado_pct: 45 },
  ]);

  await upsertRows(db, "project_certificates", [
    {
      id: ids.certificate,
      project_id: ids.project,
      numero: 1,
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      status: "CERRADO",
      monto_anterior: 0,
      monto_presente: 56160000,
      notes: "Certificado demo canónico",
      created_by: userId,
      closed_at: "2026-04-02T12:00:00Z",
    },
  ]);
  await upsertRows(db, "project_certificate_items", [
    {
      id: ids.certificateItem,
      certificate_id: ids.certificate,
      budget_item_id: ids.budgetFoundation,
      codigo: "E2E-EST-001",
      descripcion: "Fundaciones de hormigón",
      unidad: "m3",
      qty_contractual: 120,
      precio_unitario: 780000,
      qty_anterior: 0,
      qty_presente: 72,
      sort_order: 1,
    },
  ]);

  await upsertRows(db, "procurement_entities", [
    {
      id: ids.procurementEntity,
      dncp_id: "E2E-ENTITY-001",
      nombre: "Entidad Compradora Demo",
      nombre_normalizado: "ENTIDAD COMPRADORA DEMO",
      siglas: "ECD",
      nivel_gobierno: "MUNICIPAL",
    },
  ]);
  await upsertRows(db, "procurement_processes", [
    {
      id: ids.procurementProcess,
      ocid: "ocds-e2e-000001",
      dncp_nro: "E2E-000001",
      titulo: "Construcción de escuela demo",
      entity_id: ids.procurementEntity,
      comitente_nombre: "Entidad Compradora Demo",
      comitente_id: "E2E-ENTITY-001",
      categoria: "works",
      categoria_detalle: "Construcción",
      procurement_method: "open",
      procurement_method_detalle: "Licitación Pública Nacional",
      monto_referencial: 1500000000,
      monto_disponible: 1500000000,
      moneda: "PYG",
      fecha_publicacion: "2026-02-01T12:00:00Z",
      fecha_entrega_ofertas: "2026-03-01T12:00:00Z",
      fecha_apertura: "2026-03-02T12:00:00Z",
      estado: "ADJUDICADA",
      fuente: "E2E_FIXTURE",
      raw_json: { fixture: "canonical-erp-demo" },
    },
  ]);
  await upsertRows(db, "procurement_lots", [
    {
      id: ids.procurementLot,
      process_id: ids.procurementProcess,
      lote_dncp_id: "E2E-LOT-001",
      numero: 1,
      titulo: "Obra civil",
      monto_referencial: 1500000000,
    },
  ]);
  await upsertRows(db, "procurement_items", [
    {
      id: ids.procurementItem,
      process_id: ids.procurementProcess,
      lot_id: ids.procurementLot,
      codigo_catalogo: "E2E-CAT-001",
      descripcion: "Ejecución de obra civil",
      cantidad: 1,
      unidad: "lote",
      precio_unitario_referencial: 1500000000,
      sort_order: 1,
    },
  ]);
  await upsertRows(db, "procurement_suppliers", [
    {
      id: ids.procurementSupplier,
      ruc_clean: "80000009",
      ruc_raw: "80000009-9",
      dv: "9",
      nombre: "Competidor Demo S.A.",
      nombre_normalizado: "COMPETIDOR DEMO SA",
      tamano: "MEDIUM",
      tipo_entidad: "SA",
    },
  ]);
  await upsertRows(db, "procurement_bids", [
    {
      id: ids.procurementBid,
      process_id: ids.procurementProcess,
      supplier_id: ids.procurementSupplier,
      monto_ofertado: 1410000000,
      gano: true,
      lotes_ganados: ["E2E-LOT-001"],
      fuente: "MANUAL",
      payload_sha256: "e2e-canonical-bid",
    },
  ]);
  await upsertRows(db, "procurement_awards", [
    {
      id: ids.procurementAward,
      process_id: ids.procurementProcess,
      award_dncp_id: "E2E-AWARD-001",
      supplier_id: ids.procurementSupplier,
      monto_adjudicado: 1410000000,
      moneda: "PYG",
      fecha_adjudicacion: "2026-03-10T12:00:00Z",
      status: "ADJUDICADA",
    },
  ]);
  await upsertRows(db, "procurement_contracts", [
    {
      id: ids.procurementContract,
      process_id: ids.procurementProcess,
      award_id: ids.procurementAward,
      supplier_id: ids.procurementSupplier,
      contract_dncp_id: "E2E-CONTRACT-001",
      numero_contrato: "ECD-2026-001",
      monto_contrato: 1410000000,
      fecha_firma: "2026-03-20T12:00:00Z",
      status: "VIGENTE",
    },
  ]);
  await upsertRows(db, "procurement_documents", [
    {
      id: ids.procurementDocument,
      process_id: ids.procurementProcess,
      tipo: "ACTA_APERTURA",
      tipo_detalle: "Acta de apertura demo",
      titulo: "Acta de apertura E2E",
      storage_path: "e2e/canonical/acta-apertura.pdf",
      format: "PDF",
      is_scanned: false,
    },
  ]);

  await upsertRows(db, "licitaciones", [
    {
      id: ids.licitacion,
      empresa_id: ids.empresa,
      process_id: ids.procurementProcess,
      dncp_nro: "E2E-000001",
      ocid: "ocds-e2e-000001",
      titulo: "Construcción de escuela demo",
      comitente_nombre: "Entidad Compradora Demo",
      comitente_id: "E2E-ENTITY-001",
      categoria: "works",
      procurement_method: "open",
      monto_referencial: 1500000000,
      monto_disponible: 1500000000,
      moneda: "PYG",
      fecha_publicacion: "2026-02-01T12:00:00Z",
      fecha_entrega_ofertas: "2026-03-01T12:00:00Z",
      estado: "ADJUDICADA",
      invitada: true,
      decision: "PRESENTADA",
      project_id: ids.project,
      raw_json: { fixture: "canonical-erp-demo" },
    },
  ]);
  await upsertRows(db, "licitacion_lotes", [
    {
      id: ids.licitacionLote,
      licitacion_id: ids.licitacion,
      empresa_id: ids.empresa,
      lote_dncp_id: "E2E-LOT-001",
      numero: 1,
      titulo: "Obra civil",
      monto_referencial: 1500000000,
    },
  ]);
  await upsertRows(db, "licitacion_items", [
    {
      id: ids.licitacionItem,
      licitacion_id: ids.licitacion,
      empresa_id: ids.empresa,
      lote_id: ids.licitacionLote,
      codigo_catalogo: "E2E-CAT-001",
      descripcion: "Ejecución de obra civil",
      cantidad: 1,
      unidad: "lote",
      precio_unitario_referencial: 1500000000,
      sort_order: 1,
    },
  ]);
  await upsertRows(db, "licitacion_oferentes", [
    {
      id: ids.licitacionOferente,
      licitacion_id: ids.licitacion,
      empresa_id: ids.empresa,
      ruc: "80000009-9",
      nombre: "Competidor Demo S.A.",
      tamano: "MEDIUM",
      monto_ofertado: 1410000000,
      gano: true,
      lotes_ganados: ["E2E-LOT-001"],
      fuente: "MANUAL",
    },
  ]);
  await upsertRows(db, "licitacion_documentos", [
    {
      id: ids.licitacionDocumento,
      licitacion_id: ids.licitacion,
      empresa_id: ids.empresa,
      tipo: "ACTA DE APERTURA",
      titulo: "Acta de apertura E2E",
      storage_path: "e2e/canonical/acta-apertura.pdf",
      descargado_at: "2026-03-03T12:00:00Z",
    },
  ]);
  await upsertRows(db, "licitacion_ofertas", [
    {
      id: ids.licitacionOferta,
      licitacion_id: ids.licitacion,
      empresa_id: ids.empresa,
      monto_total: 1430000000,
      margen_estimado_pct: 12.5,
      probabilidad_estimada: 68,
      estado: "PRESENTADA",
      notas: "Oferta demo preparada para E2E",
      created_by: userId,
    },
  ]);
  await upsertRows(db, "licitacion_oferta_items", [
    {
      id: ids.licitacionOfertaItem,
      oferta_id: ids.licitacionOferta,
      empresa_id: ids.empresa,
      licitacion_item_id: ids.licitacionItem,
      precio_unitario: 1430000000,
      costo_unitario: 1250000000,
    },
  ]);
  await upsertRows(db, "licitacion_perfil", [
    {
      empresa_id: ids.empresa,
      codigos_catalogo: ["E2E-CAT-001"],
      palabras_clave: ["escuela", "obra civil"],
      monto_min: 100000000,
      monto_max: 3000000000,
      departamentos: ["Central"],
      activo: true,
    },
  ], "empresa_id");
  await upsertRows(db, "empresa_documentos", [
    {
      id: ids.empresaDocumento,
      empresa_id: ids.empresa,
      tipo: "PATENTE",
      descripcion: "Patente municipal demo con vencimiento próximo",
      storage_path: "e2e/canonical/patente-demo.pdf",
      fecha_emision: "2026-01-01",
      fecha_vencimiento: "2026-10-01",
      notas: "Fuente de alerta de readiness",
      created_by: userId,
    },
  ]);
  await upsertRows(db, "empresa_licitacion_seguimiento", [
    {
      id: ids.tenderFollowUp,
      empresa_id: ids.empresa,
      process_id: ids.procurementProcess,
      decision: "PRESENTADA",
      decision_notas: "Fixture canónico para flujo de licitación",
      go_no_go_score: 82,
      go_no_go_evaluacion: { document_readiness: "REVIEW" },
      invitada: true,
      project_id: ids.project,
    },
  ]);

  await upsertRows(db, "rfqs", [
    {
      id: ids.rfq,
      empresa_id: ids.empresa,
      code: "RFQ-E2E-0001",
      created_by: userId,
      client_name: "Cliente Demo Aurora",
      product: "Cemento estructural demo",
      quantity: 80,
      unit: "bolsa",
      specifications: "Entrega parcial aceptada",
      required_date: "2026-04-15",
      status: "OFERTA_SELECCIONADA",
    },
  ]);
  await upsertRows(db, "rfq_providers", [
    {
      id: ids.rfqProvider,
      empresa_id: ids.empresa,
      rfq_id: ids.rfq,
      provider_id: ids.provider,
      token: "e2e-canonical-rfq-token",
      status: "RESPONDIDO",
      responded_at: "2026-03-20T12:00:00Z",
    },
  ]);
  await upsertRows(db, "attachments", [
    {
      id: ids.attachment,
      empresa_id: ids.empresa,
      bucket: "e2e-fixtures",
      path: "mocks/facturas-4/pdfs/factura-multi-item-01a-distribuidora-parcial.pdf",
      file_name: "factura-multi-item-01a-distribuidora-parcial.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      uploaded_by: userId,
      rfq_provider_id: ids.rfqProvider,
    },
  ]);
  await upsertRows(db, "quotes", [
    { id: ids.quote, empresa_id: ids.empresa, rfq_provider_id: ids.rfqProvider },
  ]);
  await upsertRows(db, "quote_versions", [
    {
      id: ids.quoteVersion,
      empresa_id: ids.empresa,
      quote_id: ids.quote,
      version_number: 1,
      budget_number: "PRES-E2E-001",
      unit_price: 85000,
      total_price: 6800000,
      currency: "PYG",
      invoice_available: true,
      vat_included: true,
      delivery_time: "7 días",
      offer_validity: "30 días",
      payment_terms: "30 días",
      pdf_attachment_id: ids.attachment,
    },
  ]);
  await upsertRows(db, "authorized_orders", [
    {
      id: ids.authorizedOrder,
      empresa_id: ids.empresa,
      rfq_id: ids.rfq,
      provider_id: ids.provider,
      quote_version_id: ids.quoteVersion,
      rfq_code: "RFQ-E2E-0001",
      provider_name: "Proveedor Demo Construcción",
      client_name: "Cliente Demo Aurora",
      product: "Cemento estructural demo",
      quantity: 80,
      unit: "bolsa",
      unit_price: 85000,
      total_price: 6800000,
      currency: "PYG",
      vat_included: true,
      authorized_by: userId,
      is_cheapest: true,
      status: "FACTURADO",
      project_id: ids.project,
    },
  ]);
  await upsertRows(db, "invoices", [
    {
      id: ids.invoice,
      empresa_id: ids.empresa,
      provider_id: ids.provider,
      invoice_number: "E2E-FACT-0001",
      invoice_date: "2026-03-25",
      currency: "PYG",
      subtotal: 6181818,
      vat: 618182,
      total: 6800000,
      attachment_id: ids.attachment,
      status: "MATCH",
      created_by: userId,
    },
    {
      id: ids.invoiceReview,
      empresa_id: ids.empresa,
      provider_id: ids.providerReview,
      invoice_number: "E2E-FACT-0002",
      invoice_date: "2026-09-15",
      currency: "PYG",
      subtotal: 1000000,
      vat: 100000,
      total: 1100000,
      status: "REQUIERE_REVISION",
      created_by: userId,
    },
  ]);
  await upsertRows(db, "invoice_order_matches", [
    {
      id: ids.invoiceMatch,
      empresa_id: ids.empresa,
      invoice_id: ids.invoice,
      authorized_order_id: ids.authorizedOrder,
    },
  ]);
  await upsertRows(db, "invoice_exceptions", [
    {
      id: ids.invoiceException,
      empresa_id: ids.empresa,
      invoice_id: ids.invoiceReview,
      approved_by: userId,
      reason: "Diferencia de monto para revisión E2E",
      comment: "Alerta deliberada del dataset canónico",
      difference_amount: 100000,
      difference_pct: 10,
    },
  ]);

  await upsertRows(db, "sales_documents", [
    {
      id: ids.salesDocument,
      empresa_id: ids.empresa,
      client_id: ids.client,
      code: "V-E2E-0001",
      doc_type: "FACTURA",
      issue_date: "2026-04-05",
      due_date: "2026-05-05",
      currency: "PYG",
      subtotal: 56160000,
      vat_amount: 5616000,
      total: 61776000,
      cobrado_amount: 30000000,
      status: "COBRADA_PARCIAL",
      notes: "Factura vinculada al certificado demo",
      created_by: userId,
      certificate_id: ids.certificate,
    },
  ]);
  await upsertRows(db, "sales_document_items", [
    {
      id: ids.salesItem,
      empresa_id: ids.empresa,
      sales_document_id: ids.salesDocument,
      description: "Certificado de avance E2E N° 1",
      quantity: 1,
      unit_price: 61776000,
      vat_rate: 10,
      line_total: 61776000,
    },
  ]);
  await upsertRows(db, "sales_receipts", [
    {
      id: ids.salesReceipt,
      empresa_id: ids.empresa,
      sales_document_id: ids.salesDocument,
      amount: 30000000,
      receipt_date: "2026-04-20",
      method: "TRANSFERENCIA",
      reference: "E2E-REC-0001",
      created_by: userId,
    },
  ]);

  await upsertRows(db, "attachments", [
    {
      id: ids.attachment,
      empresa_id: ids.empresa,
      bucket: "e2e-fixtures",
      path: "mocks/facturas-4/pdfs/factura-multi-item-01a-distribuidora-parcial.pdf",
      file_name: "factura-multi-item-01a-distribuidora-parcial.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      uploaded_by: userId,
      rfq_provider_id: ids.rfqProvider,
      quote_version_id: ids.quoteVersion,
    },
  ]);

  console.log(JSON.stringify({ ok: true, dataset: "canonical-erp-demo", empresa_id: ids.empresa, user_id: userId }));
}

async function resetDemo(db: AdminClient): Promise<void> {
  const ids = DEMO_IDS;
  const deletes: Array<[string, string[]]> = [
    ["sales_receipts", [ids.salesReceipt]],
    ["sales_document_items", [ids.salesItem]],
    ["sales_documents", [ids.salesDocument]],
    ["invoice_exceptions", [ids.invoiceException]],
    ["invoice_order_matches", [ids.invoiceMatch]],
    ["invoices", [ids.invoice, ids.invoiceReview]],
    ["authorized_orders", [ids.authorizedOrder]],
    ["quote_versions", [ids.quoteVersion]],
    ["quotes", [ids.quote]],
    ["attachments", [ids.attachment]],
    ["rfq_providers", [ids.rfqProvider]],
    ["rfqs", [ids.rfq]],
    ["licitacion_oferta_items", [ids.licitacionOfertaItem]],
    ["licitacion_ofertas", [ids.licitacionOferta]],
    ["licitacion_documentos", [ids.licitacionDocumento]],
    ["licitacion_oferentes", [ids.licitacionOferente]],
    ["licitacion_items", [ids.licitacionItem]],
    ["licitacion_lotes", [ids.licitacionLote]],
    ["empresa_documentos", [ids.empresaDocumento]],
    ["licitaciones", [ids.licitacion]],
    ["empresa_licitacion_seguimiento", [ids.tenderFollowUp]],
    ["procurement_documents", [ids.procurementDocument]],
    ["procurement_contracts", [ids.procurementContract]],
    ["procurement_awards", [ids.procurementAward]],
    ["procurement_bids", [ids.procurementBid]],
    ["procurement_items", [ids.procurementItem]],
    ["procurement_lots", [ids.procurementLot]],
    ["procurement_processes", [ids.procurementProcess]],
    ["procurement_suppliers", [ids.procurementSupplier]],
    ["procurement_entities", [ids.procurementEntity]],
    ["project_certificate_items", [ids.certificateItem]],
    ["project_certificates", [ids.certificate]],
    ["project_schedule_plan_months", [ids.scheduleMonthOne, ids.scheduleMonthTwo, ids.scheduleMonthThree]],
    ["project_schedule_plans", [ids.schedulePlan]],
    ["execution_entries", [ids.executionFoundation, ids.executionFinishes]],
    ["budget_items", [ids.budgetFoundation, ids.budgetFinishes, ids.budgetMaterials]],
    ["projects", [ids.project]],
    ["stock_movimientos", ["10000000-0000-4000-8000-000000000411", "10000000-0000-4000-8000-000000000412"]],
    ["productos", [ids.product, ids.productCritical]],
    ["categorias_producto", [ids.category]],
    ["clients", [ids.client]],
    ["providers", [ids.provider, ids.providerReview]],
  ];

  for (const [table, tableIds] of deletes) await deleteRows(db, table, tableIds);
  console.log(JSON.stringify({ ok: true, reset: true, dataset: "canonical-erp-demo" }));
}

async function main(): Promise<void> {
  validateManifest();

  if (args.has("--plan") || args.size === 0) {
    printPlan();
    return;
  }

  if (!["--apply", "--reset", "--reset-only"].some((flag) => args.has(flag))) {
    fail("Usá --plan, --apply, --reset o --reset-only.");
  }

  const db = createAdminClient();
  if (args.has("--reset") || args.has("--reset-only")) await resetDemo(db);
  if (!args.has("--reset-only")) await seedDemo(db, await ensureTestUser(db));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
