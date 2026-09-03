import { SalesDocType } from "./types";
import { TEMPLATE_VARIABLES } from "./template";

const DOC_TYPE_NAME: Record<SalesDocType, string> = {
  PROFORMA: "Proforma",
  REMISION: "Remisión",
  FACTURA: "Factura",
};

function buildPrompt(docType: SalesDocType): string {
  return `Sos un experto en documentos comerciales paraguayos.
Te voy a mostrar una foto del formato de ${DOC_TYPE_NAME[docType]} que usa esta empresa.
Tu tarea es generar el HTML que reproduzca fielmente ese diseño para que pueda usarse como plantilla imprimible.

REGLAS:
1. Generá solo el contenido HTML (sin DOCTYPE, <html>, <head> ni <body>)
2. Incluí un bloque <style> al inicio con todo el CSS necesario
3. Optimizá para impresión A4 (usa @media print si es necesario)
4. No uses fuentes externas (CDN), JavaScript ni iframes
5. Copiá fielmente el diseño: posición, tipografía, colores, bordes, distribución

VARIABLES DISPONIBLES — usalas exactamente así donde corresponda:
${TEMPLATE_VARIABLES}

IMPORTANTE:
- Para el logo usá: <img src="{{LOGO_URL}}" alt="Logo" style="max-height:70px;max-width:200px;object-fit:contain;">
- La variable {{ITEMS_HTML}} será reemplazada por una tabla HTML completa — poné la variable exacta donde va la tabla de ítems, no generes filas de ejemplo
- Si en la imagen hay texto de ejemplo (precios, nombres, etc.), reemplazalos por las variables correspondientes
- Respondé ÚNICAMENTE con el HTML, sin texto explicativo ni bloques de código markdown (\`\`\`)`;
}

export async function generateTemplateFromImage(
  imageBytes: Buffer,
  mimeType: string,
  docType: SalesDocType
): Promise<{ html: string | null; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { html: null, error: "Falta OPENAI_API_KEY." };

  const dataUrl = `data:${mimeType};base64,${imageBytes.toString("base64")}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content: buildPrompt(docType),
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Analizá esta imagen y generá el HTML de la plantilla de ${DOC_TYPE_NAME[docType]}.` },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { html: null, error: `Error OpenAI (${response.status}): ${detail.slice(0, 300)}` };
    }

    const json = await response.json();
    let content: string = json.choices?.[0]?.message?.content ?? "";

    // Strip markdown code fences if GPT wrapped the response anyway
    content = content.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();

    if (!content) return { html: null, error: "La IA no devolvió contenido." };
    return { html: content, error: null };
  } catch {
    return { html: null, error: "No se pudo conectar con la IA para generar la plantilla." };
  }
}
