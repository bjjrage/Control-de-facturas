import { createHash } from "node:crypto";

import type { TenderRequirement } from "./compliance-engine";
import type { PbcSourceMetadata } from "./pbc-extractor";

export type TenderPbcAssessment =
  | {
      status: "ANALYZED";
      requirements: TenderRequirement[];
      sourceSha256: string | null;
      analyzedAt: string | null;
    }
  | {
      status: "NOT_ANALYZED";
      requirements: [];
      sourceSha256: null;
      analyzedAt: null;
    };

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function hasParserEvidence(value: unknown): value is TenderRequirement {
  const requirement = asRecord(value);
  const evidence = asRecord(requirement?.sourceEvidence);
  return typeof requirement?.id === "string"
    && requirement.id.startsWith("pbc-")
    && typeof requirement.descripcion === "string"
    && evidence?.provenance === "PBC_TEXT_PARSER"
    && typeof evidence.snippet === "string"
    && evidence.snippet.trim().length > 0;
}

export function createPbcSourceMetadata(text: string, analyzedAt = new Date().toISOString()): PbcSourceMetadata {
  const normalizedText = text.trim();
  return {
    kind: "USER_SUPPLIED_PBC_TEXT",
    textSha256: createHash("sha256").update(normalizedText, "utf8").digest("hex"),
    textLength: normalizedText.length,
    analyzedAt,
  };
}

/**
 * Accept only non-empty requirements carrying excerpts emitted by the PBC
 * parser. New records also bind the extracted result to the stored source text;
 * older parser-produced records remain readable for backward compatibility.
 */
export function assessTenderPbc(rawJson: unknown): TenderPbcAssessment {
  const raw = asRecord(rawJson);
  const extraction = asRecord(raw?.pbc_requisitos_extraidos);
  const rawRequirements = extraction?.requirements;
  if (!Array.isArray(rawRequirements) || rawRequirements.length === 0 || !rawRequirements.every(hasParserEvidence)) {
    return { status: "NOT_ANALYZED", requirements: [], sourceSha256: null, analyzedAt: null };
  }

  const sourceValue = extraction?.source;
  const source = asRecord(sourceValue);
  if (sourceValue !== undefined && sourceValue !== null && !source) {
    return { status: "NOT_ANALYZED", requirements: [], sourceSha256: null, analyzedAt: null };
  }
  if (source) {
    const sourceText = raw?.pbc_texto_crudo;
    if (source.kind !== "USER_SUPPLIED_PBC_TEXT"
      || typeof sourceText !== "string"
      || sourceText.trim().length < 50
      || typeof source.textSha256 !== "string"
      || !/^[a-f0-9]{64}$/i.test(source.textSha256)
      || source.textSha256.toLowerCase() !== createHash("sha256").update(sourceText.trim(), "utf8").digest("hex")
      || source.textLength !== sourceText.trim().length
      || typeof source.analyzedAt !== "string"
      || !Number.isFinite(Date.parse(source.analyzedAt))) {
      return { status: "NOT_ANALYZED", requirements: [], sourceSha256: null, analyzedAt: null };
    }

    return {
      status: "ANALYZED",
      requirements: rawRequirements,
      sourceSha256: source.textSha256.toLowerCase(),
      analyzedAt: source.analyzedAt,
    };
  }

  // Legacy extraction records stored parser excerpts but not the full source.
  return {
    status: "ANALYZED",
    requirements: rawRequirements,
    sourceSha256: null,
    analyzedAt: null,
  };
}
