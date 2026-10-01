export interface ErpKnowledgeDocument {
  id: string;
  title: string;
  module: string;
  summary: string;
  keywords: string[];
  content: string;
  sourceMap: string[];
  docPath: string;
}

export interface ErpKnowledgeMatch {
  document: ErpKnowledgeDocument;
  score: number;
  matchedKeywords: string[];
}

export interface KnowledgeSelectionOptions {
  maxDocuments?: number;
  maxChars?: number;
}
