// Parser del compiledRelease OCDS de la DNCP → forma de nuestro esquema.
//
// Todo lo que se extrae acá fue verificado contra licitaciones reales. El
// compiledRelease crudo se guarda igual en licitaciones.raw_json.

type Json = Record<string, unknown>;

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function n(v: unknown): number | null {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}
function arr(v: unknown): Json[] {
  return Array.isArray(v) ? (v as Json[]) : [];
}

export interface ParsedLicitacion {
  cabecera: {
    dncp_nro: string;
    ocid: string;
    titulo: string;
    comitente_nombre: string | null;
    comitente_id: string | null;
    categoria: string | null;
    categoria_detalle: string | null;
    procurement_method: string | null;
    procurement_method_detalle: string | null;
    award_criteria_detalle: string | null;
    monto_referencial: number | null;
    monto_disponible: number | null;
    moneda: string;
    fecha_publicacion: string | null;
    fecha_consultas_fin: string | null;
    fecha_entrega_ofertas: string | null;
    fecha_apertura: string | null;
    lugar_apertura: string | null;
    estado: string | null;
    estado_detalle: string | null;
  };
  lotes: { lote_dncp_id: string | null; numero: number | null; titulo: string | null; monto_referencial: number | null }[];
  items: {
    lote_dncp_id: string | null;
    codigo_catalogo: string | null;
    codigo_unspsc: string | null;
    descripcion: string;
    cantidad: number | null;
    unidad: string | null;
    precio_unitario_referencial: number | null;
    sort_order: number;
  }[];
  oferentes: {
    ruc: string | null;
    nombre: string;
    tamano: string | null;
    monto_ofertado: number | null;
    gano: boolean;
    lotes_ganados: string[];
    fuente: "API";
  }[];
  notificados: { ruc: string | null; nombre: string }[];
  documentos: { tipo: string | null; tipo_detalle: string | null; titulo: string | null; url_dncp: string | null }[];
}

const ESTADO_MAP: Record<string, string> = {
  planning: "PLANIFICACION",
  active: "CONVOCATORIA",
  complete: "ADJUDICADA",
  cancelled: "CANCELADA",
  unsuccessful: "DESIERTA",
};

export function parseCompiledRelease(cr: Json): ParsedLicitacion {
  const tender = (cr.tender as Json) ?? {};
  const planning = (cr.planning as Json) ?? {};
  const parties = arr(cr.parties);
  const awards = arr(cr.awards);

  const ocid = s(cr.ocid) ?? "";
  // El número de licitación es el primer grupo de dígitos después del prefijo OCID.
  const dncp_nro =
    ocid.match(/^ocds-[^-]+-(\d+)/)?.[1] ?? (s(tender.id)?.match(/(\d+)/)?.[1] ?? "");

  // Presupuesto disponible (planning.budget.amount.amount)
  const budgetAmount = (planning.budget as Json)?.amount as Json | undefined;
  const monto_disponible = n(budgetAmount?.amount);

  // Referencial = suma de lotes (con la salvedad conocida: en LPN puede ser techo)
  const lotesRaw = arr(tender.lots);
  const lotes = lotesRaw.map((l, i) => ({
    lote_dncp_id: s(l.id),
    numero: n(l.numero) ?? i + 1,
    titulo: s(l.title),
    monto_referencial: n((l.value as Json)?.amount),
  }));
  const sumaLotes = lotes.reduce((acc, l) => acc + (l.monto_referencial ?? 0), 0);
  const monto_referencial = sumaLotes > 0 ? sumaLotes : n((tender.value as Json)?.amount);

  const procuringEntity = tender.procuringEntity as Json | undefined;

  // Estado
  const estadoRaw = s(tender.status);
  const estado = estadoRaw ? (ESTADO_MAP[estadoRaw] ?? estadoRaw.toUpperCase()) : null;

  const bidOpening = tender.bidOpening as Json | undefined;

  // ── Ítems (subItems de cada item)
  const items: ParsedLicitacion["items"] = [];
  let sort = 0;
  for (const item of arr(tender.items)) {
    const rel = s(item.relatedLot);
    const cls = item.classification as Json | undefined;
    const addl = arr(item.additionalClassifications)[0];
    const subs = arr(item.subItems);
    if (subs.length > 0) {
      for (const sub of subs) {
        const unit = sub.unit as Json | undefined;
        items.push({
          lote_dncp_id: rel,
          codigo_catalogo: s(cls?.id),
          codigo_unspsc: s(addl?.id),
          descripcion: s(sub.description) ?? "(sin descripción)",
          cantidad: n(sub.quantity),
          unidad: s(unit?.name),
          precio_unitario_referencial: n((unit?.value as Json)?.amount),
          sort_order: sort++,
        });
      }
    } else {
      const unit = item.unit as Json | undefined;
      items.push({
        lote_dncp_id: rel,
        codigo_catalogo: s(cls?.id),
        codigo_unspsc: s(addl?.id),
        descripcion: s(item.description) ?? s(cls?.description) ?? "(sin descripción)",
        cantidad: n(item.quantity),
        unidad: s(unit?.name),
        precio_unitario_referencial: n((unit?.value as Json)?.amount),
        sort_order: sort++,
      });
    }
  }

  // ── Oferentes: tender.tenderers + parties (rol/tamaño) + awards (ganadores)
  const scaleByRuc = new Map<string, string>();
  for (const p of parties) {
    const ident = p.identifier as Json | undefined;
    const ruc = s(ident?.id) ?? s(p.id);
    const scale = s((p.details as Json)?.scale);
    if (ruc && scale) scaleByRuc.set(ruc, scale);
  }
  const ganadores = new Map<string, string[]>(); // ruc → lotes
  for (const a of awards) {
    if (s(a.status) === "unsuccessful") continue;
    const lots = [...new Set(arr(a.items).map((it) => s(it.relatedLot)).filter(Boolean) as string[])];
    for (const sup of arr(a.suppliers)) {
      const ruc = s(sup.id) ?? "";
      if (ruc) ganadores.set(ruc, lots);
    }
  }
  const oferentes: ParsedLicitacion["oferentes"] = [];
  const vistos = new Set<string>();
  for (const t of arr(tender.tenderers)) {
    const ruc = s(t.id);
    const nombre = s(t.name) ?? "(sin nombre)";
    const key = ruc ?? nombre;
    if (vistos.has(key)) continue;
    vistos.add(key);
    oferentes.push({
      ruc,
      nombre,
      tamano: ruc ? (scaleByRuc.get(ruc) ?? null) : null,
      monto_ofertado: null, // se completa con el Acta (C4)
      gano: ruc ? ganadores.has(ruc) : false,
      lotes_ganados: ruc ? (ganadores.get(ruc) ?? []) : [],
      fuente: "API",
    });
  }
  // Ganadores que no aparecen en tenderers (raro pero pasa)
  for (const [ruc, lots] of ganadores) {
    if (vistos.has(ruc)) continue;
    const party = parties.find((p) => s((p.identifier as Json)?.id) === ruc || s(p.id) === ruc);
    oferentes.push({
      ruc,
      nombre: s(party?.name) ?? ruc,
      tamano: scaleByRuc.get(ruc) ?? null,
      monto_ofertado: null,
      gano: true,
      lotes_ganados: lots,
      fuente: "API",
    });
  }

  // ── Notificados
  const notificados = arr(tender.notifiedSuppliers).map((ns) => ({
    ruc: s(ns.id),
    nombre: s(ns.name) ?? "(sin nombre)",
  }));

  // ── Documentos (tender + awards)
  const docs: ParsedLicitacion["documentos"] = [];
  const pushDoc = (d: Json) => {
    docs.push({
      tipo: s(d.documentType),
      tipo_detalle: s(d.documentTypeDetails),
      titulo: s(d.title),
      url_dncp: s(d.url),
    });
  };
  for (const d of arr(tender.documents)) pushDoc(d);
  for (const a of awards) for (const d of arr(a.documents)) pushDoc(d);

  return {
    cabecera: {
      dncp_nro,
      ocid,
      titulo: s(tender.title) ?? "(sin título)",
      comitente_nombre: s(procuringEntity?.name),
      comitente_id: s(procuringEntity?.id),
      categoria: s(tender.mainProcurementCategory),
      categoria_detalle: s(tender.mainProcurementCategoryDetails),
      procurement_method: s(tender.procurementMethod),
      procurement_method_detalle: s(tender.procurementMethodDetails),
      award_criteria_detalle: s(tender.awardCriteriaDetails),
      monto_referencial,
      monto_disponible,
      moneda: s((tender.value as Json)?.currency) ?? "PYG",
      fecha_publicacion: s(tender.datePublished) ?? s((tender.tenderPeriod as Json)?.startDate),
      fecha_consultas_fin: s((tender.enquiryPeriod as Json)?.endDate),
      fecha_entrega_ofertas: s((tender.tenderPeriod as Json)?.endDate),
      fecha_apertura: s(bidOpening?.date),
      lugar_apertura: s((bidOpening?.address as Json)?.streetAddress) ?? s(tender.submissionMethodDetails),
      estado,
      estado_detalle: s(tender.statusDetails),
    },
    lotes,
    items,
    oferentes,
    notificados,
    documentos: docs,
  };
}
