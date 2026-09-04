import { NextRequest, NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Project, BudgetItem, AuthorizedOrder } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";

// @react-pdf/renderer usa APIs de Node (Buffer, streams) — no corre en Edge.
export const runtime = "nodejs";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: 2, borderColor: "#333", paddingBottom: 12, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700 },
  subtitle: { fontSize: 10, color: "#555", marginTop: 2 },
  code: { fontSize: 12, fontWeight: 700, color: "#333" },
  sectionTitle: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#888", marginBottom: 6, marginTop: 14 },
  kpiRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  kpiBox: { flex: 1, border: 1, borderColor: "#ddd", borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 8, color: "#888", textTransform: "uppercase" },
  kpiValue: { fontSize: 13, fontWeight: 700, marginTop: 2 },
  table: { marginTop: 4 },
  tr: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 4 },
  thRow: { flexDirection: "row", backgroundColor: "#333", paddingVertical: 5, paddingHorizontal: 2 },
  th: { color: "#fff", fontSize: 8, fontWeight: 700 },
  td: { fontSize: 9, paddingHorizontal: 2 },
  colCode: { width: "12%" },
  colDesc: { width: "40%" },
  colUnit: { width: "10%" },
  colQty: { width: "13%", textAlign: "right" },
  colPrice: { width: "13%", textAlign: "right" },
  colSubtotal: { width: "12%", textAlign: "right" },
  totalRow: { flexDirection: "row", borderTop: 2, borderColor: "#333", paddingTop: 6, marginTop: 4 },
});

function ProjectPdf({
  project,
  items,
  orders,
  presupuestoTotal,
  comprasTotal,
}: {
  project: Project;
  items: BudgetItem[];
  orders: AuthorizedOrder[];
  presupuestoTotal: number;
  comprasTotal: number;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{project.name}</Text>
            <Text style={styles.subtitle}>
              {project.client ? `Cliente: ${project.client}` : "Sin cliente"}
              {project.location ? ` · ${project.location}` : ""}
            </Text>
          </View>
          <Text style={styles.code}>{project.code}</Text>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Presupuesto total</Text>
            <Text style={styles.kpiValue}>{formatMoney(presupuestoTotal, "PYG")}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Compras realizadas</Text>
            <Text style={styles.kpiValue}>{formatMoney(comprasTotal, "PYG")}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Estado</Text>
            <Text style={styles.kpiValue}>{project.status}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Cómputo métrico</Text>
        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, styles.colCode]}>Código</Text>
            <Text style={[styles.th, styles.colDesc]}>Descripción</Text>
            <Text style={[styles.th, styles.colUnit]}>Unid.</Text>
            <Text style={[styles.th, styles.colQty]}>Cantidad</Text>
            <Text style={[styles.th, styles.colPrice]}>P. Unit.</Text>
            <Text style={[styles.th, styles.colSubtotal]}>Subtotal</Text>
          </View>
          {items.map((i) => (
            <View style={styles.tr} key={i.id}>
              <Text style={[styles.td, styles.colCode]}>{i.code}</Text>
              <Text style={[styles.td, styles.colDesc]}>{i.description}</Text>
              <Text style={[styles.td, styles.colUnit]}>{i.unit ?? "—"}</Text>
              <Text style={[styles.td, styles.colQty]}>{i.quantity ?? "—"}</Text>
              <Text style={[styles.td, styles.colPrice]}>{i.unit_price != null ? formatMoney(i.unit_price, "PYG") : "—"}</Text>
              <Text style={[styles.td, styles.colSubtotal]}>{formatMoney(i.subtotal, "PYG")}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={[styles.td, { width: "88%", textAlign: "right", fontWeight: 700 }]}>TOTAL</Text>
            <Text style={[styles.td, styles.colSubtotal, { fontWeight: 700 }]}>{formatMoney(presupuestoTotal, "PYG")}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Órdenes de compra vinculadas</Text>
        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, { width: "15%" }]}>Código</Text>
            <Text style={[styles.th, { width: "40%" }]}>Producto</Text>
            <Text style={[styles.th, { width: "25%" }]}>Proveedor</Text>
            <Text style={[styles.th, { width: "20%", textAlign: "right" }]}>Total</Text>
          </View>
          {orders.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%", color: "#999" }]}>Sin OCs vinculadas.</Text>
            </View>
          ) : (
            orders.map((o) => (
              <View style={styles.tr} key={o.id}>
                <Text style={[styles.td, { width: "15%" }]}>{o.code}</Text>
                <Text style={[styles.td, { width: "40%" }]}>{o.product}</Text>
                <Text style={[styles.td, { width: "25%" }]}>{o.provider_name}</Text>
                <Text style={[styles.td, { width: "20%", textAlign: "right" }]}>{formatMoney(o.total_price, o.currency)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={{ fontSize: 8, color: "#999", marginTop: 20 }}>
          Generado {formatDate(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .single<Project>();

  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado." }, { status: 404 });
  }

  const [{ data: items }, { data: orders }] = await Promise.all([
    supabase.from("budget_items").select("*").eq("project_id", id).order("sort_order").returns<BudgetItem[]>(),
    supabase.from("authorized_orders").select("*").eq("project_id", id).order("authorized_at", { ascending: false }).returns<AuthorizedOrder[]>(),
  ]);

  const budgetItems = items ?? [];
  const ocs = orders ?? [];
  const presupuestoTotal = budgetItems.reduce((s, i) => s + i.subtotal, 0);
  const comprasTotal = ocs.filter((o) => o.currency === "PYG").reduce((s, o) => s + o.total_price, 0);

  const buffer = await renderToBuffer(
    <ProjectPdf project={project} items={budgetItems} orders={ocs} presupuestoTotal={presupuestoTotal} comprasTotal={comprasTotal} />
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${project.code}-informe.pdf"`,
    },
  });
}
