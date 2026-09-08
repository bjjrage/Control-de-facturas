import { NextRequest, NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type {
  Project,
  ProjectCertificate,
  ProjectCertificateItem,
  ProjectCertificateStaff,
} from "@/lib/types";

export const runtime = "nodejs";

const C = {
  bg: "#ffffff",
  header: "#1a1a2e",
  accent: "#2563eb",
  border: "#e5e7eb",
  muted: "#6b7280",
  text: "#111827",
  row2: "#f9fafb",
};

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: "Helvetica", color: C.text, backgroundColor: C.bg },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottom: 2,
    borderColor: C.header,
    paddingBottom: 10,
    marginBottom: 14,
  },
  h1: { fontSize: 14, fontWeight: 700, color: C.header },
  h2: { fontSize: 10, fontWeight: 700, color: C.header, marginTop: 2 },
  headerMeta: { textAlign: "right", color: C.muted, fontSize: 8 },
  // Meta block
  metaGrid: { flexDirection: "row", gap: 10, marginBottom: 12 },
  metaBox: { flex: 1, borderLeft: 2, borderColor: C.accent, paddingLeft: 6 },
  metaLabel: { fontSize: 7, color: C.muted, textTransform: "uppercase", marginBottom: 1 },
  metaValue: { fontSize: 9, fontWeight: 700 },
  // Section title
  sectionTitle: { fontSize: 8, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, marginTop: 12 },
  // Table
  table: {},
  thRow: { flexDirection: "row", backgroundColor: C.header, paddingVertical: 4, paddingHorizontal: 3 },
  th: { color: "#fff", fontSize: 7, fontWeight: 700 },
  tr: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, borderBottom: 1, borderColor: C.border },
  trAlt: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, borderBottom: 1, borderColor: C.border, backgroundColor: C.row2 },
  td: { fontSize: 8, color: C.text },
  tdMuted: { fontSize: 8, color: C.muted },
  // Cols for rubros table
  colCode: { width: "8%" },
  colDesc: { width: "28%" },
  colUnit: { width: "6%", textAlign: "center" },
  colNum: { width: "9%", textAlign: "right" },
  colMonto: { width: "12%", textAlign: "right" },
  // Liquidación
  liqRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderBottom: 1, borderColor: C.border },
  liqLabel: { fontSize: 9, color: C.muted },
  liqValue: { fontSize: 9, fontWeight: 700 },
  liqTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTop: 2, borderColor: C.header, marginTop: 2 },
  liqTotalLabel: { fontSize: 10, fontWeight: 700 },
  liqTotalValue: { fontSize: 10, fontWeight: 700, color: C.accent },
  // Firmas
  firmasRow: { flexDirection: "row", gap: 12, marginTop: 24 },
  firmaBox: { flex: 1, borderTop: 1, borderColor: C.header, paddingTop: 4, alignItems: "center" },
  firmaLabel: { fontSize: 7, color: C.muted, textAlign: "center" },
  firmaName: { fontSize: 8, fontWeight: 700, textAlign: "center", marginTop: 1 },
  // Footer
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", borderTop: 1, borderColor: C.border, paddingTop: 4 },
  footerText: { fontSize: 7, color: C.muted },
});

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return "—";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function CertificadoPdf({
  project,
  cert,
  items,
  staff,
}: {
  project: Project;
  cert: ProjectCertificate;
  items: ProjectCertificateItem[];
  staff: ProjectCertificateStaff[];
}) {
  const deducciones =
    cert.devolucion_anticipo + cert.retencion + cert.penalidad_avance + cert.penalidad_presentacion - cert.ajustes;

  const contratista = staff.find((s) => s.rol?.toLowerCase().includes("contrat"));
  const fiscalizacion = staff.find((s) => s.rol?.toLowerCase().includes("fiscaliz") || s.rol?.toLowerCase().includes("super"));
  const aprobacion = staff.find((s) => s.rol?.toLowerCase().includes("aprob") || s.rol?.toLowerCase().includes("comitente"));

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>{project.name}</Text>
            {project.comitente ? <Text style={styles.h2}>Comitente: {project.comitente}</Text> : null}
          </View>
          <View style={styles.headerMeta}>
            <Text>Contrato N° {project.contract_number ?? "—"}</Text>
            <Text>Certificado de ejecución N° {cert.numero}</Text>
            <Text>Período: {formatDate(cert.period_start)} — {formatDate(cert.period_end)}</Text>
          </View>
        </View>

        {/* Meta */}
        <View style={styles.metaGrid}>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Monto de contrato</Text>
            <Text style={styles.metaValue}>{formatMoney(project.contract_amount, "PYG")}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>IVA incluido</Text>
            <Text style={styles.metaValue}>{project.iva_pct}%</Text>
          </View>
          {project.fiscalizacion_nombre ? (
            <View style={styles.metaBox}>
              <Text style={styles.metaLabel}>Fiscalización</Text>
              <Text style={styles.metaValue}>{project.fiscalizacion_nombre}</Text>
            </View>
          ) : null}
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Estado</Text>
            <Text style={styles.metaValue}>{cert.status}</Text>
          </View>
        </View>

        {/* Rubros */}
        <Text style={styles.sectionTitle}>Cómputo de rubros</Text>
        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, styles.colCode]}>Código</Text>
            <Text style={[styles.th, styles.colDesc]}>Descripción</Text>
            <Text style={[styles.th, styles.colUnit]}>Unid.</Text>
            <Text style={[styles.th, styles.colNum]}>Contract.</Text>
            <Text style={[styles.th, styles.colNum]}>Anterior</Text>
            <Text style={[styles.th, styles.colNum]}>Presente</Text>
            <Text style={[styles.th, styles.colNum]}>Acum.</Text>
            <Text style={[styles.th, styles.colNum]}>%</Text>
            <Text style={[styles.th, styles.colMonto]}>Mto. presente</Text>
            <Text style={[styles.th, styles.colMonto]}>Mto. acum.</Text>
          </View>
          {items.map((it, idx) => (
            <View key={it.id} style={idx % 2 === 0 ? styles.tr : styles.trAlt}>
              <Text style={[styles.tdMuted, styles.colCode]}>{it.codigo ?? ""}</Text>
              <Text style={[styles.td, styles.colDesc]}>{it.descripcion}</Text>
              <Text style={[styles.tdMuted, styles.colUnit]}>{it.unidad ?? ""}</Text>
              <Text style={[styles.tdMuted, styles.colNum]}>{formatNumber(it.qty_contractual, 2)}</Text>
              <Text style={[styles.tdMuted, styles.colNum]}>{formatNumber(it.qty_anterior, 2)}</Text>
              <Text style={[styles.td, styles.colNum]}>{formatNumber(it.qty_presente, 2)}</Text>
              <Text style={[styles.td, styles.colNum]}>{formatNumber(it.qty_acumulada, 2)}</Text>
              <Text style={[styles.tdMuted, styles.colNum]}>{pct(it.qty_acumulada, it.qty_contractual)}</Text>
              <Text style={[styles.td, styles.colMonto]}>{formatMoney(it.monto_presente, "PYG")}</Text>
              <Text style={[styles.td, styles.colMonto]}>{formatMoney(it.monto_acumulado, "PYG")}</Text>
            </View>
          ))}
          {/* Total row */}
          <View style={[styles.thRow, { marginTop: 1 }]}>
            <Text style={[styles.th, { width: "60%", textAlign: "right" }]}>
              Total certificado (c/ IVA {project.iva_pct}%)
            </Text>
            <Text style={[styles.th, { width: "9%", textAlign: "right" }]}> </Text>
            <Text style={[styles.th, { width: "9%", textAlign: "right" }]}> </Text>
            <Text style={[styles.th, styles.colMonto]}>{formatMoney(cert.monto_presente, "PYG")}</Text>
            <Text style={[styles.th, styles.colMonto]}>{formatMoney(cert.monto_acumulado, "PYG")}</Text>
          </View>
        </View>

        {/* Liquidación */}
        <Text style={styles.sectionTitle}>Liquidación</Text>
        <View style={{ maxWidth: 300 }}>
          <View style={styles.liqRow}>
            <Text style={styles.liqLabel}>Monto del certificado del mes</Text>
            <Text style={styles.liqValue}>{formatMoney(cert.monto_presente, "PYG")}</Text>
          </View>
          {cert.ajustes !== 0 ? (
            <View style={styles.liqRow}>
              <Text style={styles.liqLabel}>Ajuste del mes</Text>
              <Text style={styles.liqValue}>{formatMoney(cert.ajustes, "PYG")}</Text>
            </View>
          ) : null}
          <View style={styles.liqRow}>
            <Text style={styles.liqLabel}>
              Devolución anticipo{cert.devolucion_anticipo_pct_snap != null ? ` (${cert.devolucion_anticipo_pct_snap}%)` : ""}
            </Text>
            <Text style={styles.liqValue}>−{formatMoney(cert.devolucion_anticipo, "PYG")}</Text>
          </View>
          <View style={styles.liqRow}>
            <Text style={styles.liqLabel}>
              Retención{cert.retencion_pct_snap != null ? ` (${cert.retencion_pct_snap}%)` : ""}
            </Text>
            <Text style={styles.liqValue}>−{formatMoney(cert.retencion, "PYG")}</Text>
          </View>
          {cert.penalidad_avance !== 0 ? (
            <View style={styles.liqRow}>
              <Text style={styles.liqLabel}>Penalidad de avance</Text>
              <Text style={styles.liqValue}>−{formatMoney(cert.penalidad_avance, "PYG")}</Text>
            </View>
          ) : null}
          {cert.penalidad_presentacion !== 0 ? (
            <View style={styles.liqRow}>
              <Text style={styles.liqLabel}>Penalidad de presentación</Text>
              <Text style={styles.liqValue}>−{formatMoney(cert.penalidad_presentacion, "PYG")}</Text>
            </View>
          ) : null}
          <View style={styles.liqTotal}>
            <Text style={styles.liqTotalLabel}>Monto líquido de la factura</Text>
            <Text style={styles.liqTotalValue}>{formatMoney(cert.monto_liquido, "PYG")}</Text>
          </View>
          <Text style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>
            Deducciones totales: {formatMoney(Math.abs(deducciones), "PYG")}
            {cert.factura_numero ? ` · Factura N° ${cert.factura_numero}` : ""}
          </Text>
        </View>

        {/* Firmas */}
        <View style={styles.firmasRow}>
          {[
            { label: "Contratista", staff: contratista, date: cert.elaborado_at },
            { label: "Fiscalización / SAT", staff: fiscalizacion, date: cert.verificado_at },
            { label: "Supervisión / Comitente", staff: aprobacion, date: cert.aprobado_at },
          ].map((f, i) => (
            <View key={i} style={styles.firmaBox}>
              {f.staff ? <Text style={styles.firmaName}>{f.staff.nombre}</Text> : null}
              <Text style={styles.firmaLabel}>{f.label}</Text>
              {f.date ? <Text style={styles.firmaLabel}>{formatDate(f.date)}</Text> : null}
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{project.name} · Certificado N° {cert.numero}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> }
) {
  const { id, certId } = await params;

  try {
    const profile = await requirePlan("caterpillar");
    const supabase = await createClient();
    const empresaId = profile.empresa_id;

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .single<Project>();
    if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

    const { data: cert } = await supabase
      .from("project_certificates")
      .select("*")
      .eq("id", certId)
      .eq("project_id", id)
      .single<ProjectCertificate>();
    if (!cert) return NextResponse.json({ error: "Certificado no encontrado" }, { status: 404 });

    const [{ data: itemRows }, { data: staffRows }] = await Promise.all([
      supabase
        .from("project_certificate_items")
        .select("*")
        .eq("certificate_id", certId)
        .order("sort_order")
        .returns<ProjectCertificateItem[]>(),
      supabase
        .from("project_certificate_staff")
        .select("*")
        .eq("certificate_id", certId)
        .order("sort_order")
        .returns<ProjectCertificateStaff[]>(),
    ]);

    const items = itemRows ?? [];
    const staff = staffRows ?? [];

    const buffer = await renderToBuffer(
      <CertificadoPdf project={project} cert={cert} items={items} staff={staff} />
    );

    const filename = `certificado-${cert.numero}-${project.code ?? project.id}.pdf`;
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("PDF certificado error:", err);
    return NextResponse.json({ error: "No se pudo generar el PDF" }, { status: 500 });
  }
}
