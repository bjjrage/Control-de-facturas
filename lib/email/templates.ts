export type EmailTemplateIntent =
  | "envio_cotizacion"
  | "seguimiento_cotizacion"
  | "solicitud_precio"
  | "envio_orden_compra"
  | "reclamo_entrega"
  | "solicitud_factura"
  | "envio_certificacion"
  | "recordatorio_pago"
  | "general";

export type EmailTone = "professional" | "formal" | "short" | "commercial" | "portuguese";

export function inferEmailTemplate(objective: string): EmailTemplateIntent {
  const text = objective.toLocaleLowerCase("es");
  if (/(seguimiento|follow.?up|estado de la cotiz)/u.test(text)) return "seguimiento_cotizacion";
  if (/(cotizaci|cotizacion|propuesta|presupuesto)/u.test(text)) return "envio_cotizacion";
  if (/(precio|cotizar|lista de precios)/u.test(text)) return "solicitud_precio";
  if (/(orden de compra|\boc\b)/u.test(text)) return "envio_orden_compra";
  if (/(reclamo|atraso|demora|entrega)/u.test(text)) return "reclamo_entrega";
  if (/(factura|comprobante fiscal)/u.test(text)) return "solicitud_factura";
  if (/(certificaci|certificacion)/u.test(text)) return "envio_certificacion";
  if (/(pago|vencimiento|saldo)/u.test(text)) return "recordatorio_pago";
  return "general";
}

function normalizeObjective(objective: string): string {
  const cleaned = objective.replace(/\s+/gu, " ").trim();
  if (!cleaned) return "Te escribo para coordinar este tema.";
  return /[.!?]$/u.test(cleaned) ? cleaned : `${cleaned}.`;
}

function greeting(name: string | null | undefined, tone: EmailTone, portuguese: boolean): string {
  const recipient = name?.trim() || (portuguese ? "Olá" : "Hola");
  if (portuguese) return `Olá${name ? `, ${name}` : ""}:`;
  if (tone === "formal") return `Estimada/o ${recipient}:`;
  return `${tone === "short" ? "Hola" : "Buenas tardes"}${name ? `, ${name}` : ""}:`;
}

export function composeEmailBody(params: {
  objective: string;
  contactName?: string | null;
  tone?: string | null;
  language?: string | null;
  companyName?: string | null;
}): { bodyText: string; bodyHtml: string; template: EmailTemplateIntent } {
  const toneValue = (params.tone ?? "professional").toLocaleLowerCase("es");
  const portuguese = (params.language ?? toneValue).includes("portugu");
  const tone: EmailTone = portuguese
    ? "portuguese"
    : toneValue.includes("formal")
      ? "formal"
      : toneValue.includes("cort")
        ? "short"
        : toneValue.includes("comercial")
          ? "commercial"
          : "professional";
  const objective = normalizeObjective(params.objective);
  const template = inferEmailTemplate(params.objective);
  const close = portuguese
    ? tone === "short"
      ? "Obrigado."
      : "Fico à disposição.\n\nAtenciosamente,"
    : tone === "short"
      ? "Saludos."
      : tone === "formal"
        ? "Agradeceré tu confirmación.\n\nSaludos cordiales,"
        : "Quedamos atentos.\n\nSaludos,";
  const signature = params.companyName?.trim() || "";
  const bodyText = [greeting(params.contactName, tone, portuguese), "", objective, "", close, signature]
    .filter((line, index, all) => !(line === "" && index === all.length - 1))
    .join("\n");
  const bodyHtml = bodyText
    .split("\n\n")
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br />")}</p>`)
    .join("");
  return { bodyText, bodyHtml, template };
}

export function applyEmailRevision(params: {
  bodyText: string;
  bodyHtml?: string | null;
  instruction: string;
  subject?: string;
}): { bodyText: string; bodyHtml: string; subject?: string } {
  const instruction = params.instruction.toLocaleLowerCase("es");
  let body = params.bodyText.trim();
  let subject = params.subject;
  if (/(m[aá]s corto|acort|breve)/u.test(instruction)) {
    const paragraphs = body.split(/\n\s*\n/gu).filter(Boolean);
    body = paragraphs.slice(0, 2).join("\n\n");
    if (!body.endsWith(".")) body += ".";
  }
  if (/(sac[aá]|quit[aá]).*(p[aá]rrafo|[uú]ltimo)/u.test(instruction)) {
    const paragraphs = body.split(/\n\s*\n/gu).filter(Boolean);
    body = paragraphs.slice(0, Math.max(1, paragraphs.length - 1)).join("\n\n");
  }
  if (/(portugu[eé]s|brasil)/u.test(instruction)) {
    body = body
      .replace(/Buenas tardes/giu, "Boa tarde")
      .replace(/Quedamos atentos/giu, "Fico à disposição")
      .replace(/Saludos cordiales/giu, "Atenciosamente")
      .replace(/Saludos/giu, "Atenciosamente");
  }
  const subjectMatch = params.instruction.match(/(?:cambi[aá]|pon[eé])\s+(?:el\s+)?asunto\s+(?:a\s+)?["“”']?([^"“”'.]+)["“”']?/iu);
  if (subjectMatch?.[1]) subject = subjectMatch[1].trim();
  const bodyHtml = body
    .split("\n\n")
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br />")}</p>`)
    .join("");
  return { bodyText: body, bodyHtml, subject };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
