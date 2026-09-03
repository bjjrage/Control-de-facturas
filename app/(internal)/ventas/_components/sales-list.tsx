import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, SalesDocStatus, SalesDocType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { currentMonth, monthRange } from "@/lib/month-range";
import { MonthFilter } from "@/app/(internal)/invoices/month-filter";
import { docSaldo, isOverdue, SALES_DOC_STATUS_LABELS, SALES_STATUS_ORDER } from "@/lib/sales";

type Filters = { month?: string; q?: string; client?: string; status?: string };

const STATUS_TONE: Record<SalesDocStatus, "ok" | "warn" | "neutral"> = {
  EMITIDA: "warn",
  COBRADA_PARCIAL: "warn",
  BORRADOR: "neutral",
  COBRADA: "ok",
  ANULADA: "neutral",
};

function sumByCurrency(docs: SalesDocument[], field: "total" | "saldo") {
  const m = new Map<string, number>();
  for (const d of docs) {
    const v = field === "total" ? d.total : docSaldo(d.total, d.cobrado_amount);
    m.set(d.currency, (m.get(d.currency) ?? 0) + v);
  }
  return [...m.entries()];
}

export async function SalesList({
  docType,
  basePath,
  title,
  newLabel,
  searchParams,
}: {
  docType: SalesDocType;
  basePath: string;
  title: string;
  newLabel: string;
  searchParams: Filters;
}) {
  const supabase = await createClient();
  const { month: monthParam, q, client: clientId, status } = searchParams;
  const month = monthParam === "all" ? null : monthParam || currentMonth();

  const { data: clients } = await supabase.from("clients").select("id, name").order("name").returns<Pick<Client, "id" | "name">[]>();
  const clientById = new Map((clients ?? []).map((c) => [c.id, c.name]));

  let query = supabase.from("sales_documents").select("*").eq("doc_type", docType).order("issue_date", { ascending: false });
  if (month) {
    const { start, end } = monthRange(month);
    query = query.gte("issue_date", start).lt("issue_date", end);
  }
  if (q?.trim()) query = query.ilike("code", `%${q.trim().replace(/[%,]/g, "")}%`);
  if (clientId) query = query.eq("client_id", clientId);
  if (status) query = query.eq("status", status);

  const { data: docs } = await query.returns<SalesDocument[]>();

  const groups = SALES_STATUS_ORDER.map((s) => ({
    status: s,
    docs: (docs ?? []).filter((d) => d.status === s),
  })).filter((g) => g.docs.length > 0);

  function withParams(over: Partial<Filters>) {
    const p = new URLSearchParams();
    const merged = { month: monthParam, q, client: clientId, status, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <div className="flex gap-2">
          <Link
            href="/ventas/export"
            className="inline-flex items-center justify-center rounded-md border px-3 h-8 text-[13px] font-medium bg-[var(--panel)] hover:bg-[var(--hover)] border-[var(--border)]"
          >
            Exportar CSV
          </Link>
          <Link href={`${basePath}/nueva`}>
            <Button>{newLabel}</Button>
          </Link>
        </div>
      </div>

      <form className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3" method="get">
        <div>
          <Label htmlFor="q">Buscar por código</Label>
          <Input id="q" name="q" defaultValue={q ?? ""} placeholder="ej: V-00007" className="w-48" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <MonthFilter month={month} basePath={basePath} />
          <div>
            <Label htmlFor="client">Cliente</Label>
            <Select id="client" name="client" defaultValue={clientId ?? ""} className="w-52">
              <option value="">Todos</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={status ?? ""} className="w-48">
              <option value="">Todos</option>
              {SALES_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SALES_DOC_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {q || clientId || status ? (
            <Link href={withParams({ q: undefined, client: undefined, status: undefined })} className="text-action text-[12px] text-[var(--muted)] pb-1.5">
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          {month ? `No hay ${title.toLowerCase()} con fecha en ${month}.` : `No hay ${title.toLowerCase()} para estos filtros.`}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.status}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[g.status]}>{SALES_DOC_STATUS_LABELS[g.status]}</Badge>
                <span className="text-[12px] text-[var(--muted)]">({g.docs.length})</span>
              </div>
              <div className="text-[12px] text-[var(--muted)]">
                {(g.status === "EMITIDA" || g.status === "COBRADA_PARCIAL"
                  ? sumByCurrency(g.docs, "saldo")
                  : sumByCurrency(g.docs, "total")
                )
                  .map(([c, v]) => formatMoney(v, c as SalesDocument["currency"]))
                  .join(" · ")}
                {g.status === "EMITIDA" || g.status === "COBRADA_PARCIAL" ? " por cobrar" : ""}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden mb-4">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cliente</th>
                    <th>Emisión</th>
                    <th>Vencimiento</th>
                    <th className="num">Total</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {g.docs.map((d) => {
                    const saldo = docSaldo(d.total, d.cobrado_amount);
                    return (
                      <tr key={d.id}>
                        <td>
                          <Link href={`/ventas/${d.id}`} className="text-action font-medium">
                            {d.code}
                          </Link>
                        </td>
                        <td>{clientById.get(d.client_id) ?? "-"}</td>
                        <td>{formatDate(d.issue_date)}</td>
                        <td className={isOverdue(d.due_date, d.status) ? "text-[var(--error)]" : ""}>
                          {d.due_date ? formatDate(d.due_date) : "-"}
                        </td>
                        <td className="num">{formatMoney(d.total, d.currency)}</td>
                        <td className="num">{formatMoney(saldo, d.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
