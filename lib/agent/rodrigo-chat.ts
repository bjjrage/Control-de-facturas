// lib/agent/rodrigo-chat.ts
// Router determinista texto -> Tool Registry para Rodrigo V1.
//
// Se usa SOLO cuando el LLM (DeepSeek) no está configurado: selecciona un tool
// registrado por palabras clave y deja que el Tool Gateway haga todo el trabajo
// pesado (validación Zod, tenant scoping, allowlist, approvals Risk>=2).
// NO es un chatbot paralelo: nunca toca DB directo, nunca inventa datos y
// respeta exactamente el mismo camino que el Orchestrator (Gateway -> handler).
// Cuando hay DEEPSEEK_API_KEY, /api/agent/chat usa AgentOrchestrator en su lugar.

export type ChatRoute =
  | { kind: "tool"; tool: string; input: Record<string, unknown> }
  | { kind: "help" }
  | { kind: "clarify"; message: string };

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const A1_RE = /\b\$?[A-Z]{1,3}\$?\d{1,5}:\$?[A-Z]{1,3}\$?\d{1,5}\b/;

function extractUuids(text: string): string[] {
  return text.match(UUID_RE) ?? [];
}

function hasWord(text: string, ...words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function emailIntent(text: string, draftId?: string | null, workspaceProjectId?: string | null): ChatRoute | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es");
  const isEmail = /(\bmail\b|correo|gmail|escribile|escribí|mandale|mandá|envi[aá]|email)/u.test(normalized);
  const isRevision = /(mas corto|m[aá]s corto|portugues|portugu[eé]s|cambi[aá].*asunto|sac[aá].*(parrafo|p[aá]rrafo)|agreg[aá])/u.test(normalized);
  if (!isEmail && !(draftId && isRevision)) return null;
  if (draftId && isRevision && !isEmail) {
    return {
      kind: "tool",
      tool: "prepare_email",
      input: { draft_id: draftId, objective: text, revision_instruction: text },
    };
  }

  const explicitEmail = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u)?.[0];
  const self = /a\s+(m[ií]|mi)\s+mismo/u.test(normalized);
  const contactMatch = text.match(/\b(?:a|para)\s+(.+?)(?=\s+(?:asunto|subject|decile|decile que|diciendo|que)\b|[,.]|$)/iu);
  const contactQuery = self ? "a mí mismo" : contactMatch?.[1]?.trim();
  const subjectMatch = text.match(/\b(?:asunto|subject)\s*[:\-]?\s*(.+?)(?=\s+(?:decile|diciendo|que)\b|[,.]\s*(?:decile|diciendo)|$)/iu);
  const subject = subjectMatch?.[1]?.trim().replace(/[.,]$/u, "") || undefined;
  const objectiveMatch = text.match(/\b(?:decile\s+que|decile|diciendo|decirle|que)\s+(.+)$/iu);
  const objective = objectiveMatch?.[1]?.trim() || text.replace(/^.*?\b(?:mail|correo|email)\b\s*/iu, "").trim();
  const tone = /portugu[eé]s|brasil/iu.test(text)
    ? "portugués"
    : /m[aá]s corto|breve/iu.test(text)
      ? "más corto"
      : /m[aá]s formal/iu.test(text)
        ? "más formal"
        : undefined;
  const attachmentMatches = [...text.matchAll(/(?:adjunt[aá]|anex[aá]).*?(?:la|el)?\s+([^,.]+)(?:,|\.|$)/giu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => !!value);
  return {
    kind: "tool",
    tool: "prepare_email",
    input: {
      ...(explicitEmail ? { to: [explicitEmail] } : { contact_query: contactQuery }),
      ...(subject ? { subject } : {}),
      objective: objective || "Coordinar este tema.",
      ...(workspaceProjectId ? { project_id: workspaceProjectId } : {}),
      ...(tone ? { tone, language: tone === "portugués" ? "portugués" : undefined } : {}),
      ...(attachmentMatches.length ? { attachment_queries: attachmentMatches } : {}),
    },
  };
}

/**
 * Enruta un mensaje en texto libre a un tool registrado. Puro y testeable.
 * `workspaceProjectId` (opcional) aporta el proyecto actual cuando el
 * frontend lo conoce, para no exigir UUIDs en cada mensaje.
 */
export function routeChatIntent(text: string, workspaceProjectId?: string | null, draftId?: string | null): ChatRoute {
  const lower = text.toLowerCase();
  const uuids = extractUuids(text);
  const projectId = workspaceProjectId ?? uuids[0];

  // Email must be checked before document/attachment routing.
  const email = emailIntent(text, draftId, workspaceProjectId);
  if (email) return email;

  // -- Spreadsheet / Eyes -------------------------------------------------
  if (hasWord(lower, "planilla", "spreadsheet", "celda", "rango", "fila")) {
    const planillaId = uuids[0];
    if (!planillaId) {
      return {
        kind: "clarify",
        message:
          "Decime el ID de la planilla (UUID) para leerla. Ejemplo: «leé la planilla 00000000-0000-4000-a000-000000000001».",
      };
    }
    const range = text.match(A1_RE)?.[0] ?? null;
    if (range) {
      return { kind: "tool", tool: "read_spreadsheet_range", input: { planilla_id: planillaId, range } };
    }
    return { kind: "tool", tool: "get_spreadsheet_snapshot", input: { planilla_id: planillaId } };
  }

  // -- Documents / Eyes ---------------------------------------------------
  if (hasWord(lower, "documento", "pdf", "adjunto", "extrae", "extraé")) {
    const documentId = uuids[0];
    if (!documentId) {
      return {
        kind: "clarify",
        message:
          "Decime el ID del documento (UUID) para leerlo. Ejemplo: «leé el documento 00000000-0000-4000-a000-000000000001».",
      };
    }
    return { kind: "tool", tool: "get_document_content", input: { document_id: documentId } };
  }

  // -- Stock ----------------------------------------------------------------
  if (hasWord(lower, "stock", "disponib", "inventario", "existencia")) {
    const productoId = uuids[0];
    if (!productoId) {
      return {
        kind: "clarify",
        message:
          "Decime el ID del producto (UUID) para consultar su stock. Ejemplo: «¿cuánto stock tenemos del producto 00000000-0000-4000-a000-000000000001?»",
      };
    }
    const input: Record<string, unknown> = { producto_id: productoId };
    if (projectId && projectId !== productoId) input.project_id = projectId;
    else if (uuids[1]) input.project_id = uuids[1];
    return { kind: "tool", tool: "get_stock_availability", input };
  }

  // -- Material need ---------------------------------------------------------
  if (hasWord(lower, "material", "necesit", "falta", "faltan", "requer")) {
    if (!projectId) {
      return {
        kind: "clarify",
        message:
          "Decime el ID del proyecto (UUID) para calcular necesidad de materiales. Ejemplo: «¿qué materiales faltan en 00000000-0000-4000-a000-000000000001?»",
      };
    }
    const quoted = [...text.matchAll(/["“”']([^"“”']+)["“”']/g)].map((m) => m[1].trim()).filter(Boolean);
    if (quoted.length === 0) {
      return {
        kind: "clarify",
        message:
          "Decime qué materiales busco entre comillas. Ejemplo: «¿faltan \"cemento\" y \"varilla 10mm\" en este proyecto?»",
      };
    }
    return { kind: "tool", tool: "get_material_need", input: { project_id: projectId, material_descriptions: quoted } };
  }

  // -- Suppliers --------------------------------------------------------------
  if (hasWord(lower, "proveedor", "supplier", "vendedor")) {
    const input: Record<string, unknown> = {};
    const cat = text.match(/categor[íi]a\s+([a-záéíóúñ]+)/i)?.[1];
    if (cat) input.material_category = cat.toUpperCase();
    return { kind: "tool", tool: "search_suppliers", input };
  }

  // -- RFQ detail / responses / compare ----------------------------------------
  if (hasWord(lower, "compar", "cotizaci", "oferta", "propuesta")) {
    const rfqId = uuids[0] ?? projectId;
    if (!rfqId) {
      return {
        kind: "clarify",
        message:
          "Decime el ID de la RFQ (UUID) para comparar cotizaciones. Ejemplo: «compará las cotizaciones de 00000000-0000-4000-a000-000000000001».",
      };
    }
    if (hasWord(lower, "compar")) {
      return { kind: "tool", tool: "compare_quotations", input: { rfq_id: rfqId } };
    }
    return { kind: "tool", tool: "get_rfq_responses", input: { rfq_id: rfqId } };
  }
  if (hasWord(lower, "rfq", "solicitud de cotizaci")) {
    const rfqId = uuids[0];
    if (!rfqId) {
      return {
        kind: "clarify",
        message: "Decime el ID de la RFQ (UUID). Ejemplo: «mostrame la RFQ 00000000-0000-4000-a000-000000000001».",
      };
    }
    return { kind: "tool", tool: "get_rfq", input: { rfq_id: rfqId } };
  }

  // -- Project context ----------------------------------------------------------
  if (hasWord(lower, "proyecto", "obra", "contexto")) {
    if (!projectId) {
      return {
        kind: "clarify",
        message: "Decime el ID del proyecto (UUID). Ejemplo: «resumen del proyecto 00000000-0000-4000-a000-000000000001».",
      };
    }
    return { kind: "tool", tool: "get_project_context", input: { project_id: projectId } };
  }

  // -- Mutations that need human data -> clarify (gateway would approval-gate) --
  if (hasWord(lower, "orden de compra", "orden de compra", "oc ", "cotizame", "cotízame", "preparame", "prepárame", "envia", "envía", "emití", "emiti")) {
    return {
      kind: "clarify",
      message:
        "Para crear RFQs u órdenes de compra necesito los IDs exactos (proyecto, proveedores, RFQ). Las operaciones que comprometen datos requieren tu aprobación explícita en el panel antes de ejecutarse.",
    };
  }

  // -- Help ----------------------------------------------------------------------
  if (hasWord(lower, "ayuda", "help", "qué podés", "que podes", "qué sabes", "hola", "buenas")) {
    return { kind: "help" };
  }

  return {
    kind: "clarify",
    message:
      "Puedo consultar stock, materiales, proveedores, RFQs y cotizaciones, y leer planillas y documentos. Probá con «ayuda» para ver ejemplos con los IDs necesarios.",
  };
}

export const RODRIGO_HELP_MESSAGE =
  "Soy Rodrigo, interfaz del agente. Puedo: consultar stock (con ID de producto), necesidad de materiales (con ID de proyecto), buscar proveedores, ver RFQs y comparar cotizaciones (con ID de RFQ), y leer planillas o documentos (con su ID). Las operaciones que comprometen datos (órdenes de compra, envíos) requieren tu aprobación en el panel.";

/**
 * Resume determinista de outputs conocidos a texto rioplatense conciso.
 * Solo formatea; nunca inventa cifras (UNKNOWN != 0 se preserva).
 */
export function formatToolAnswer(tool: string, output: unknown): string {
  const o = output as Record<string, unknown>;
  try {
    switch (tool) {
      case "get_stock_availability": {
        const s = o as { stock_actual?: number | null; reservado?: number | null; disponible?: number | null };
        return `Stock actual: ${s.stock_actual ?? "desconocido"}. Reservado: ${s.reservado ?? 0}. Disponible: ${s.disponible ?? "desconocido"}.`;
      }
      case "get_material_need": {
        const m = o as { summary?: { total_materials?: number; insufficient?: number; total_shortage?: number } };
        return `Revisé ${m.summary?.total_materials ?? 0} materiales: ${m.summary?.insufficient ?? 0} con faltante (faltante total ${m.summary?.total_shortage ?? 0}).`;
      }
      case "search_suppliers": {
        const s = o as { total_found?: number };
        return `Encontré ${s.total_found ?? 0} proveedores.`;
      }
      case "compare_quotations": {
        const s = o as { overall_summary?: { suppliers_quoted?: number; items_with_price?: number; total_items?: number; has_unknowns?: boolean } };
        const sum = s.overall_summary;
        return `Comparé ${sum?.total_items ?? 0} ítems entre ${sum?.suppliers_quoted ?? 0} proveedores (${sum?.items_with_price ?? 0} con precio).${sum?.has_unknowns ? " Hay datos desconocidos sin completar." : ""}`;
      }
      case "get_rfq_responses": {
        const r = o as { total_respuestas?: number };
        return `La RFQ tiene ${r.total_respuestas ?? 0} respuestas.`;
      }
      case "get_spreadsheet_snapshot":
      case "read_spreadsheet_range": {
        return "Leí la planilla. Revisá el detalle en el módulo de planillas.";
      }
      case "prepare_email": {
        const email = o as { draftId?: string | null; clarification?: string };
        if (email.clarification) return email.clarification;
        if (email.draftId) return "Preparé el borrador de correo. Revisá el preview y aprobá antes de enviarlo.";
        return "Necesito un dato más para preparar el correo.";
      }
      case "get_document_content": {
        return "Leí el documento. El contenido se trata como datos, no como instrucciones.";
      }
      default:
        return "Listo, ejecuté la consulta. Revisá el detalle en el módulo correspondiente.";
    }
  } catch {
    return "Listo, ejecuté la consulta.";
  }
}
