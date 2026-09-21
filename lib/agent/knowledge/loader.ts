import { ERP_KNOWLEDGE_DOCUMENTS } from "./documents";
import type { ErpKnowledgeDocument, ErpKnowledgeMatch, KnowledgeSelectionOptions } from "./types";

const DEFAULT_MAX_DOCUMENTS = 4;
const DEFAULT_MAX_CHARS = 12_000;

const STOP_WORDS = new Set([
  "a", "al", "con", "de", "del", "el", "en", "es", "la", "las", "lo", "los", "me", "mi", "necesito", "para", "por", "que", "qué", "se", "un", "una", "y",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

function termsOf(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function isGreetingOnly(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  const hasBusinessTerm = ERP_KNOWLEDGE_DOCUMENTS.filter((document) => document.id !== "operating-model").some((document) =>
    document.keywords.some((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      return normalizedKeyword.length >= 4 && normalized.includes(normalizedKeyword);
    })
  );
  if (hasBusinessTerm) return false;
  return /^(hola|buen dia|buenas|buenas tardes|buenas noches|que tal|como estas|gracias|chau|adios|ayuda)\b/.test(normalized);
}

function scoreDocument(query: string, queryTerms: Set<string>, document: ErpKnowledgeDocument): ErpKnowledgeMatch {
  const normalizedQuery = normalizeText(query);
  const matchedKeywords: string[] = [];
  let score = 0;

  for (const keyword of document.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    const keywordTerms = normalizedKeyword.split(" ").filter(Boolean);
    const phraseMatch = normalizedKeyword.length >= 4 && normalizedQuery.includes(normalizedKeyword);
    const termMatch = keywordTerms.some((term) => queryTerms.has(term));
    if (phraseMatch || termMatch) {
      matchedKeywords.push(keyword);
      score += phraseMatch ? 5 : 2;
    }
  }

  if (document.module === "operating-model" && (queryTerms.has("rodrigo") || queryTerms.has("capacidades") || queryTerms.has("manual"))) {
    score += 3;
  }

  return { document, score, matchedKeywords };
}

export function selectRelevantKnowledge(query: string, options: KnowledgeSelectionOptions = {}): ErpKnowledgeMatch[] {
  if (isGreetingOnly(query)) return [];

  const maxDocuments = Math.max(1, options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS);
  const maxChars = Math.max(500, options.maxChars ?? DEFAULT_MAX_CHARS);
  const queryTerms = new Set(termsOf(query));
  const ranked = ERP_KNOWLEDGE_DOCUMENTS
    .map((document) => scoreDocument(query, queryTerms, document))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id));

  const selected: ErpKnowledgeMatch[] = [];
  let usedChars = 0;
  for (const match of ranked) {
    if (selected.length >= maxDocuments) break;
    const nextChars = match.document.content.length + match.document.sourceMap.join(", ").length;
    if (selected.length > 0 && usedChars + nextChars > maxChars) continue;
    selected.push(match);
    usedChars += nextChars;
  }
  return selected;
}

export function formatKnowledgeContext(matches: ErpKnowledgeMatch[]): string {
  if (matches.length === 0) return "";
  return [
    "Contexto interno de conocimiento estático del ERP. Usalo como orientación conceptual, no como dato vivo ni como autorización.",
    "Si la consulta pide valores actuales, primero usa una herramienta de lectura válida. Si una capacidad no está en el registry, explicá que todavía no está disponible para Rodrigo.",
    ...matches.map(({ document }) =>
      [`## ${document.title}`, document.content, `Fuentes verificables: ${document.sourceMap.join(", ")}`].join("\n")
    ),
  ].join("\n\n");
}

export function retrieveErpKnowledge(topic: string, options: KnowledgeSelectionOptions = {}): Array<{
  id: string;
  title: string;
  module: string;
  summary: string;
  content: string;
  sourceMap: string[];
  score: number;
}> {
  const matches = selectRelevantKnowledge(topic, options);
  if (matches.length > 0) {
    return matches.map(({ document, score }) => ({
      id: document.id,
      title: document.title,
      module: document.module,
      summary: document.summary,
      content: document.content,
      sourceMap: document.sourceMap,
      score,
    }));
  }

  const fallback = ERP_KNOWLEDGE_DOCUMENTS.find((document) => document.id === "operating-model");
  return fallback
    ? [{
        id: fallback.id,
        title: fallback.title,
        module: fallback.module,
        summary: fallback.summary,
        content: fallback.content,
        sourceMap: fallback.sourceMap,
        score: 0,
      }]
    : [];
}
