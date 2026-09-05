// Validación con IA de certificados de subcontratista. Mismo patrón que
// lib/invoice-extraction.ts: fetch crudo a OpenAI, gpt-4o-mini, respuesta con
// json_schema estricto. Se corre server-side (nunca desde el portal público
// directamente) al recibir un certificado nuevo, y su resultado queda
// guardado en subcontractor_certificates.ai_flags para que el admin lo vea
// al revisar. Nunca bloquea el guardado del certificado si falla — la
// validación es un apoyo a la revisión humana, no un gate.

const SCHEMA = {
  type: "object",
  properties: {
    flags: { type: "array", items: { type: "string" } },
    risk_level: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
  },
  required: ["flags", "risk_level", "summary"],
  additionalProperties: false,
};

export type CertificateAiResult = {
  flags: string[];
  risk_level: "low" | "medium" | "high";
  summary: string;
};

export async function analyzeCertificate(params: {
  contractDescription: string | null;
  contractedAmount: number;
  previousApprovedPct: number;
  newClaimedPct: number;
  materialPurchasesInRubro: number;
}): Promise<{ data: CertificateAiResult | null; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { data: null, error: "OPENAI_API_KEY no configurada." };

  const prompt = `Analizá este certificado de avance de un subcontratista de obra.

Contrato: ${params.contractDescription ?? "sin descripción"}
Monto total contratado: Gs ${params.contractedAmount.toLocaleString("es-PY")}
Certificados anteriores aprobados: ${params.previousApprovedPct}%
Nuevo reclamo: ${params.newClaimedPct}%
Compras de materiales registradas en el sistema para este rubro: Gs ${params.materialPurchasesInRubro.toLocaleString("es-PY")}

¿Hay inconsistencias o banderas rojas? Considerá especialmente: saltos grandes de % entre certificados, reclamo de avance sin compras de materiales correspondientes en el rubro, o el acumulado acercándose/superando el 100% del contrato.
Respondé en JSON.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "certificate_analysis", schema: SCHEMA, strict: true },
        },
        messages: [
          { role: "system", content: "Sos un auditor de certificados de avance de obra. Respondé siempre en español." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      return { data: null, error: `OpenAI ${response.status}` };
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { data: null, error: "Respuesta inesperada." };
    return { data: JSON.parse(content) as CertificateAiResult, error: null };
  } catch {
    return { data: null, error: "No se pudo analizar el certificado." };
  }
}
