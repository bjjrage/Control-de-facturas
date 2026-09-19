import type { CurrencyCode, InvoiceStatus, SalesDocStatus } from "@/lib/types";
import type { DashboardIconKey } from "@/app/(internal)/dashboard/icon-map";

export type DomainTone = "ok" | "warn" | "error" | "neutral";

export interface SparklinePoint {
  date: string;
  value: number;
}

export interface MetricCardData {
  key: string;
  title: string;
  value: string;
  multiCurrencyExtra?: string | null;
  secondaryText?: string | null;
  trendText?: string | null;
  trendTone?: "up" | "down" | "neutral";
  href: string;
  iconKey: DashboardIconKey;
  tone: DomainTone;
  sparkline?: SparklinePoint[];
  infoTooltip?: string | null;
}

export interface AttentionAlert {
  id: string;
  label: string;
  count: number;
  href: string;
  tone: "warn" | "error";
  category: "ventas" | "compras" | "stock" | "obras" | "finanzas";
}

export type NormalizedDocumentType =
  | "CERTIFICADO_CUMPLIMIENTO_TRIBUTARIO"
  | "CONSTANCIA_IPS"
  | "PATENTE_MUNICIPAL"
  | "RUC"
  | "PODER_REPRESENTANTE"
  | "ACTA_CONSTITUCION"
  | "ESTATUTOS"
  | "BALANCE_AUDITADO"
  | "REGISTRO_PROVEEDORES_ESTADO"
  | "DECLARACION_JURADA_ART_40"
  | "GARANTIA_MANTENIMIENTO_OFERTA"
  | "OTRO";

export type RequirementReadinessStatus =
  | "READY"
  | "EXPIRING_BEFORE_DEADLINE"
  | "EXPIRED"
  | "MISSING"
  | "UNKNOWN";

export interface ExtractedTenderRequirement {
  id: string;
  licitacion_id: string;
  normalized_type: NormalizedDocumentType;
  source_text: string;
  source_document?: string;
  required: boolean;
  confidence: number;
}

export interface RequirementEvaluationResult {
  requirement: ExtractedTenderRequirement;
  status: RequirementReadinessStatus;
  matchingDoc?: {
    id: string;
    tipo: string;
    fecha_vencimiento: string | null;
  } | null;
  reason: string;
}

export interface TenderReadinessAssessment {
  licitacionId: string;
  titulo: string;
  dncpNro: string;
  fechaEntregaOfertas: string | null;
  hasAnalyzedPbc: boolean;
  evaluations: RequirementEvaluationResult[];
  isAtRisk: boolean;
  missingCount: number;
  expiringCount: number;
  expiredCount: number;
}
