import { requireProfile, type CurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Licitacion, LicitacionPerfil } from "@/lib/types";
import type { MetricCardData } from "@/lib/dashboard/types";
import { computeTenderKpis, type RawLicitacionForTenderKpi } from "@/lib/dashboard/tender-kpis";
import {
  assessTendersReadiness,
  type RawEmpresaDocumento,
  type RawLicitacionDocumento,
  type RawLicitacionForReadiness,
} from "@/lib/dashboard/document-readiness";

const PLAN_RANK = { basico: 0, pro: 1, caterpillar: 2 } as const;

export type LicitacionesPageData = {
  cards: MetricCardData[];
  licitaciones: Partial<Licitacion>[];
  perfil: LicitacionPerfil | null;
};

export async function getLicitacionesPageData(profile?: CurrentProfile): Promise<LicitacionesPageData> {
  const p = profile ?? (await requireProfile(["comercial", "administracion", "admin"]));
  const supabase = await createClient();
  const canUseLicitaciones = PLAN_RANK[p.plan] >= PLAN_RANK.pro;
  const emptyRows = Promise.resolve({ data: [] as unknown[] });

  const [{ data: licitacionesData }, { data: perfil }, { data: licDocsData }, { data: empresaDocsData }] = await Promise.all([
    supabase
      .from("licitaciones")
      .select(
        "id, dncp_nro, titulo, comitente_nombre, categoria, monto_referencial, moneda, " +
          "fecha_entrega_ofertas, fecha_apertura, estado, estado_detalle, invitada, decision, synced_at, raw_json",
      )
      .order("fecha_entrega_ofertas", { ascending: true, nullsFirst: false })
      .returns<Partial<Licitacion>[]>(),
    supabase.from("licitacion_perfil").select("*").maybeSingle<LicitacionPerfil>(),
    canUseLicitaciones
      ? supabase.from("licitacion_documentos").select("id, licitacion_id, tipo, tipo_detalle, titulo, url_dncp, storage_path")
      : emptyRows,
    canUseLicitaciones
      ? supabase.from("empresa_documentos").select("id, tipo, descripcion, fecha_emision, fecha_vencimiento")
      : emptyRows,
  ]);

  const licitaciones = (licitacionesData ?? []) as Partial<Licitacion>[];
  const licitacionesForKpi = licitaciones as RawLicitacionForTenderKpi[];
  const readinessAssessments = assessTendersReadiness({
    licitaciones: licitaciones as unknown as RawLicitacionForReadiness[],
    docs: (licDocsData ?? []) as RawLicitacionDocumento[],
    empresaDocs: (empresaDocsData ?? []) as RawEmpresaDocumento[],
    todayIso: new Date().toISOString().slice(0, 10),
  });

  return {
    cards: computeTenderKpis({
      todayIso: new Date().toISOString().slice(0, 10),
      licitaciones: licitacionesForKpi,
      empresaDocs: (empresaDocsData ?? []) as RawEmpresaDocumento[],
      readinessAssessments,
      canUseLicitaciones,
    }),
    licitaciones,
    perfil: perfil ?? null,
  };
}
