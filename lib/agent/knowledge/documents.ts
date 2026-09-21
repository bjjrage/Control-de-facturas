import type { ErpKnowledgeDocument } from "./types";

/**
 * Runtime registry of curated ERP knowledge. It is intentionally static:
 * it describes code and schema relationships, never tenant data or live state.
 * The matching Markdown manual in rodrigo/knowledge is the human-readable
 * source map for these same facts.
 */
export const ERP_KNOWLEDGE_DOCUMENTS: ErpKnowledgeDocument[] = [
  {
    id: "operating-model",
    title: "Modelo operativo y límites de Rodrigo",
    module: "operating-model",
    summary: "Rodrigo trabaja con un actor autenticado, tenant confiable, tools allowlisteados y aprobaciones por riesgo.",
    keywords: ["rodrigo", "erp", "modulo", "workspace", "permisos", "aprobacion", "tenant", "capacidades", "manual"],
    content:
      "El perfil autenticado define la empresa y el rol. El Gateway valida tenant, permisos, esquema y riesgo antes de ejecutar una herramienta. El conocimiento es descriptivo: no reemplaza una consulta de datos vivos, no autoriza cambios y no habilita capacidades que no estén registradas. Las operaciones sensibles esperan aprobación humana.",
    sourceMap: [
      "app/(internal)/layout.tsx",
      "lib/agent/context.ts",
      "lib/agent/registry.ts",
      "lib/agent/gateway.ts",
      "lib/agent/approvals.ts",
    ],
    docPath: "rodrigo/knowledge/OPERATING-MODEL.md",
  },
  {
    id: "projects-and-execution",
    title: "Obras, presupuesto y ejecución",
    module: "projects",
    summary: "Las obras contienen presupuesto, ejecución, cronograma, BIM, stock, compras, personal, subcontratos y certificación.",
    keywords: ["obra", "obras", "proyecto", "presupuesto", "computo", "cómputo", "ejecucion", "ejecución", "avance", "bim", "certificado", "subcontratista", "personal", "cronograma"],
    content:
      "La superficie de proyecto expone presupuesto, cronograma, BIM, proveedores, cotizaciones, órdenes de compra, facturas, pagos, ejecución, stock/materiales, personal, subcontratistas, certificados, avance físico e informes. El tool get_project_context lee por UUID el proyecto, resumen del presupuesto y resumen de ejecución. No existe en el registry un buscador general de obras por nombre.",
    sourceMap: [
      "app/(internal)/projects/[id]/project-tabs-client.tsx",
      "app/(internal)/projects/actions.ts",
      "app/(internal)/projects/weekly-plan-actions.ts",
      "app/(internal)/projects/[id]/bim-actions.ts",
      "app/(internal)/projects/[id]/computo-actions.ts",
      "lib/tools/projects/get-project-context.ts",
    ],
    docPath: "rodrigo/knowledge/modules/projects.md",
  },
  {
    id: "inventory",
    title: "Inventario, stock y depósitos",
    module: "inventory",
    summary: "El ERP separa catálogo de productos, stock global, stock por depósito y stock imputado a obra.",
    keywords: ["stock", "inventario", "material", "materiales", "producto", "productos", "deposito", "depósito", "pañol", "panol", "recepcion", "recepción", "transferencia", "consumo", "warehouse"],
    content:
      "El catálogo productos se relaciona con stock global y desgloses por depósito y por proyecto. También existen recepciones de órdenes, evidencias, transferencias, inventario de obra, pañol y un portal de depósito. get_stock_availability lee un producto por UUID y opcionalmente la lente de una obra. get_material_need compara descripciones contra budget_items y stock del catálogo; no inventa cantidades cuando faltan.",
    sourceMap: [
      "lib/inventory/service.ts",
      "lib/tools/stock/get-stock-availability.ts",
      "lib/tools/procurement/get-material-need.ts",
      "app/(internal)/stock/stock-actions.ts",
      "app/(internal)/inventory/actions.ts",
      "app/warehouse/[token]/page.tsx",
      "supabase/migrations/20260914_inventory_hardening.sql",
    ],
    docPath: "rodrigo/knowledge/modules/inventory.md",
  },
  {
    id: "procurement",
    title: "Compras, RFQ, cotizaciones y órdenes",
    module: "procurement",
    summary: "La compra se modela con RFQ, ítems, proveedores, respuestas, comparación y preparación/emisión controlada de OC.",
    keywords: ["compras", "compra", "rfq", "cotizacion", "cotización", "proveedor", "proveedores", "oferta", "orden de compra", "oc", "licitacion de precios", "pedido"],
    content:
      "Una RFQ se relaciona con proyecto, ítems solicitados, proveedores invitados y respuestas. Rodrigo puede leer RFQ/respuestas/comparaciones, buscar proveedores y preparar un borrador de RFQ u orden de compra. send_rfq requiere aprobación y issue_purchase_order tiene riesgo comercial mayor; ninguna de esas acciones se ejecuta solo por una afirmación del LLM.",
    sourceMap: [
      "lib/tools/procurement/get-rfq.ts",
      "lib/tools/procurement/get-rfq-responses.ts",
      "lib/tools/procurement/compare-quotations.ts",
      "lib/tools/procurement/search-suppliers.ts",
      "lib/tools/procurement/create-rfq-draft.ts",
      "lib/tools/procurement/prepare-purchase-order.ts",
      "lib/tools/procurement/send-rfq.ts",
      "lib/tools/procurement/issue-purchase-order.ts",
      "app/(internal)/rfqs/actions.ts",
      "app/(internal)/orders/actions.ts",
    ],
    docPath: "rodrigo/knowledge/modules/procurement.md",
  },
  {
    id: "weekly-planning",
    title: "Plan semanal, reservas y abastecimiento",
    module: "weekly-planning",
    summary: "El plan semanal contiene ítems y cruza ejecución, stock, entradas y reservas de inventario.",
    keywords: ["plan semanal", "semanal", "planificacion", "planificación", "reserva", "reservas", "abastecimiento", "inbound", "materiales de la semana", "produccion", "producción"],
    content:
      "El flujo de plan semanal carga datos base de la obra, calcula/previewa objetivos y puede persistir project_weekly_plans, project_weekly_plan_items e inventory_reservations. Es una capacidad real de la UI y del dominio. En esta versión Rodrigo solo puede explicar el modelo y leer materiales mediante los tools existentes; no tiene un tool dedicado para consultar o guardar el plan semanal.",
    sourceMap: [
      "app/(internal)/projects/weekly-plan-actions.ts",
      "app/(internal)/projects/[id]/weekly-plan-section.tsx",
      "lib/procurement/weekly-plan-shared.ts",
      "supabase/migrations/20260917_agent_foundation_life_recipes_mrp_hardening.sql",
    ],
    docPath: "rodrigo/knowledge/modules/weekly-planning.md",
  },
  {
    id: "tenders",
    title: "Licitaciones, competidores y subastas",
    module: "tenders",
    summary: "Licitaciones y el laboratorio de subastas tienen datos y flujos propios separados de las compras internas.",
    keywords: ["licitacion", "licitación", "licitaciones", "tender", "dncp", "lote", "oferente", "oferta", "competidor", "competidores", "subasta", "auction", "radar"],
    content:
      "El módulo de licitaciones trabaja con convocatoria, lotes, ítems, oferentes, ofertas, documentos, seguimiento y observaciones de costos. Incluye radar de competidores, documentos de empresa y Auction Lab/sandbox con políticas y eventos. Es una superficie real de UI/dominio, pero el registry actual de Rodrigo no contiene una herramienta para consultar una licitación, analizar ofertas o operar una subasta.",
    sourceMap: [
      "app/(internal)/licitaciones/actions.ts",
      "app/(internal)/licitaciones/dashboard-data.ts",
      "app/(internal)/licitaciones/[id]/page.tsx",
      "app/(internal)/licitaciones/competidores/actions.ts",
      "app/(internal)/licitaciones/auction-lab/actions.ts",
      "lib/procurement/competitor-intelligence.ts",
      "lib/auction-sandbox/server.ts",
      "supabase/migrations/0062_competitor_intelligence.sql",
      "supabase/migrations/0068_planning_currency_fallback_auction_sandbox.sql",
    ],
    docPath: "rodrigo/knowledge/modules/tenders.md",
  },
  {
    id: "finance-and-treasury",
    title: "Ventas, facturas, cobros, tesorería y caja",
    module: "finance",
    summary: "El ERP tiene superficies financieras reales, pero Rodrigo no recibe tools para mover dinero ni para afirmar saldos vivos.",
    keywords: ["finanzas", "financiero", "factura", "facturas", "venta", "ventas", "cobro", "cobros", "pago", "pagos", "tesoreria", "tesorería", "caja", "banco", "transferencia", "conciliar", "liquidar", "dinero"],
    content:
      "La aplicación contiene ventas, facturas, cobros, flujo de caja, cuentas_financieras y payment_orders/payment_order_invoices. Esas pantallas y acciones son datos vivos y no deben ser resumidos desde este manual. Rodrigo puede explicar conceptos y límites, pero en esta versión no tiene herramientas financieras de lectura ni herramientas de pago. Nunca debe pagar, cobrar, transferir, mover fondos, conciliar, liquidar ni registrar un movimiento efectivo; si se lo piden, debe rechazar la ejecución y derivar a la UI/proceso autorizado.",
    sourceMap: [
      "app/(internal)/ventas/actions.ts",
      "app/(internal)/invoices/actions.ts",
      "app/(internal)/cobros/section-action.ts",
      "app/(internal)/flujo-caja/gastos-actions.ts",
      "app/(internal)/tesoreria/actions.ts",
      "app/(internal)/pagos/actions.ts",
      "lib/agent/registry.ts",
    ],
    docPath: "rodrigo/knowledge/modules/finance-and-treasury.md",
  },
  {
    id: "email-and-documents",
    title: "Email, documentos y planillas",
    module: "documents-and-communication",
    summary: "Rodrigo puede preparar correo, consultar contenido de documentos y leer planillas cuando tiene identificadores válidos.",
    keywords: ["email", "mail", "correo", "destinatario", "gmail", "documento", "documentos", "archivo", "planilla", "spreadsheet", "rango", "adjunto"],
    content:
      "prepare_email crea un borrador y preview; no envía. send_email es una acción de riesgo y exige approval con snapshot íntegro e idempotencia. Los tools de documentos leen o extraen por document_id; los de planillas leen snapshot/rango y sus cambios pasan por confirmación. Un correo común no requiere proyecto, obra, RFQ u OC salvo que el usuario pida contenido o adjuntos de ese contexto.",
    sourceMap: [
      "lib/tools/email/prepare-email.ts",
      "lib/tools/email/send-email.ts",
      "lib/email/domain-service.ts",
      "lib/tools/documents/get-document-content.ts",
      "lib/tools/documents/extract-document-data.ts",
      "lib/tools/spreadsheet/get-spreadsheet-snapshot.ts",
      "lib/tools/spreadsheet/read-spreadsheet-range.ts",
      "lib/tools/spreadsheet/update-spreadsheet-rows.ts",
      "lib/tools/spreadsheet/confirm-spreadsheet.ts",
    ],
    docPath: "rodrigo/knowledge/modules/email-and-documents.md",
  },
];
