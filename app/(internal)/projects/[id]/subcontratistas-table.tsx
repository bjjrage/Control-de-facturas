"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { formatMoney } from "@/lib/format";
import { SubcontractorContract, SubcontractorCertificate } from "@/lib/types";
import { ContractCertificatesDialog } from "./contract-certificates-dialog";

type Row = {
  contract: SubcontractorContract;
  subName: string;
  itemLabel: string;
  approvedAmount: number;
  retentionAccum: number;
  usedPct: number;
  certs: SubcontractorCertificate[];
};

const contractedLabel = (r: Row) => formatMoney(r.contract.contracted_amount, "PYG");
const approvedLabel = (r: Row) => formatMoney(r.approvedAmount, "PYG");

type ColKey = "subName" | "itemLabel" | "contracted" | "approved" | "status";

export function SubcontratistasTable({ rows, appUrl }: { rows: Row[]; appUrl: string }) {
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    subName: null,
    itemLabel: null,
    contracted: null,
    approved: null,
    status: null,
  });

  const uniques = useMemo(
    () => ({
      subName: uniqueValues(rows, (r) => r.subName),
      itemLabel: uniqueValues(rows, (r) => r.itemLabel),
      contracted: uniqueValues(rows, contractedLabel),
      approved: uniqueValues(rows, approvedLabel),
      status: uniqueValues(rows, (r) => r.contract.status),
    }),
    [rows]
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!passesColumnFilter(r.subName, colFilters.subName)) return false;
      if (!passesColumnFilter(r.itemLabel, colFilters.itemLabel)) return false;
      if (!passesColumnFilter(contractedLabel(r), colFilters.contracted)) return false;
      if (!passesColumnFilter(approvedLabel(r), colFilters.approved)) return false;
      if (!passesColumnFilter(r.contract.status, colFilters.status)) return false;
      if (!term) return true;
      return (
        r.subName.toLowerCase().includes(term) ||
        r.itemLabel.toLowerCase().includes(term) ||
        r.contract.status.toLowerCase().includes(term)
      );
    });
  }, [rows, q, colFilters]);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por subcontratista, rubro o estado…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      ) : null}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>
                Subcontratista
                <ColumnFilter values={uniques.subName} selected={colFilters.subName} onChange={(v) => setCol("subName", v)} />
              </th>
              <th>
                Rubro
                <ColumnFilter
                  values={uniques.itemLabel}
                  selected={colFilters.itemLabel}
                  onChange={(v) => setCol("itemLabel", v)}
                />
              </th>
              <th className="num">
                Contratado
                <ColumnFilter
                  values={uniques.contracted}
                  selected={colFilters.contracted}
                  onChange={(v) => setCol("contracted", v)}
                />
              </th>
              <th className="num">
                Certificado aprobado
                <ColumnFilter
                  values={uniques.approved}
                  selected={colFilters.approved}
                  onChange={(v) => setCol("approved", v)}
                />
              </th>
              <th className="num">Retención acum.</th>
              <th>
                Estado
                <ColumnFilter values={uniques.status} selected={colFilters.status} onChange={(v) => setCol("status", v)} />
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin contratos cargados." : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.contract.id}>
                  <td className="font-medium">{r.subName}</td>
                  <td className="text-[var(--muted)]">{r.itemLabel}</td>
                  <td className="num">{formatMoney(r.contract.contracted_amount, "PYG")}</td>
                  <td className="num">{formatMoney(r.approvedAmount, "PYG")}</td>
                  <td className="num text-[var(--muted)]">{formatMoney(r.retentionAccum, "PYG")}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[var(--muted)]">{r.contract.status}</span>
                      {r.usedPct > 90 ? (
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--error-bg)] text-[var(--error)]"
                          title={`${r.usedPct}% del monto contratado entre aprobado y pendiente`}
                        >
                          ⚠ {r.usedPct}%
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <ContractCertificatesDialog contract={r.contract} certificates={r.certs} appUrl={appUrl} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
