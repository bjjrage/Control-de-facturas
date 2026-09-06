"use client";

import { useState, useEffect, useMemo } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { formatMoney } from "@/lib/format";
import {
  Project,
  BudgetItem,
  ExecutionEntry,
  AuthorizedOrder,
  Invoice,
  PaymentOrder,
  Provider,
  Rfq,
  DailyLaborEntry,
  Subcontractor,
  SubcontractorContract,
  SubcontractorCertificate,
} from "@/lib/types";
import { AddBudgetItemForm } from "./add-budget-item-form";
import { ImportBudgetDialog } from "./import-budget-dialog";
import { DuplicateBudgetDialog } from "./duplicate-budget-dialog";
import { AddExecutionEntryForm } from "./add-execution-entry-form";
import { ProjectStatusSelect } from "./project-status-select";
import { EditProjectDialog } from "./edit-project-dialog";
import { DeleteProjectButton } from "./delete-project-button";
import { ProjectGantt } from "./project-gantt";
import { ProjectReports } from "./reports";
import { AddLaborEntryForm } from "./add-labor-entry-form";
import { AddSubcontractorContractDialog } from "./add-subcontractor-contract-dialog";
import { PresupuestoTable } from "./presupuesto-table";
import { EjecucionTable } from "./ejecucion-table";
import { PersonalTable } from "./personal-table";
import { ProyectoComprasTable } from "./proyecto-compras-table";
import { SubcontratistasTable } from "./subcontratistas-table";
import { ProyectoFacturasTable } from "./proyecto-facturas-table";
import { ProyectoPagosTable } from "./proyecto-pagos-table";
import { ProyectoRfqsTable } from "./proyecto-rfqs-table";
import { RfqDialog } from "@/app/(internal)/rfqs/rfq-dialog";
import { ProyectoProveedoresTable } from "./proyecto-proveedores-table";

type Props = {
  project: Project;
  initialTab: string;
  isCaterpillar: boolean;
  appUrl: string;
  items: BudgetItem[];
  entries: ExecutionEntry[];
  photoUrlByPath: Record<string, string>;
  ocs: AuthorizedOrder[];
  projectRfqs: Rfq[];
  projectProviders: Provider[];
  projectInvoices: Invoice[];
  projectPaymentOrders: PaymentOrder[];
  providerNameById: Record<string, string>;
  laborRows: DailyLaborEntry[];
  laborHoursTotal: number;
  laborCostTotal: number;
  subcontractorCatalog: Subcontractor[];
  contracts: SubcontractorContract[];
  certificates: SubcontractorCertificate[];
  duplicateSources: { id: string; code: string; name: string; itemCount: number }[];
  itemsSubtotal: number;
  presupuestoTotal: number;
  comprasTotal: number;
  comprasPct: number;
};

export function ProjectTabsClient({
  project,
  initialTab,
  isCaterpillar,
  appUrl,
  items,
  entries,
  photoUrlByPath,
  ocs,
  projectRfqs,
  projectProviders,
  projectInvoices,
  projectPaymentOrders,
  providerNameById: providerNameByIdRecord,
  laborRows,
  laborHoursTotal,
  laborCostTotal,
  subcontractorCatalog,
  contracts,
  certificates,
  duplicateSources,
  itemsSubtotal,
  presupuestoTotal,
  comprasTotal,
  comprasPct,
}: Props) {
  const [tab, setTab] = useState(initialTab);

  // Escucha el custom event que despacha el sidebar al hacer click en un tab
  useEffect(() => {
    const handler = (e: Event) => setTab((e as CustomEvent<string>).detail);
    window.addEventListener("niupack:tab", handler);
    return () => window.removeEventListener("niupack:tab", handler);
  }, []);

  const providerNameById = useMemo(
    () => new Map(Object.entries(providerNameByIdRecord)),
    [providerNameByIdRecord]
  );

  const photoUrlMap = useMemo(
    () => new Map(Object.entries(photoUrlByPath)),
    [photoUrlByPath]
  );

  const execByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      m.set(e.budget_item_id, (m.get(e.budget_item_id) ?? 0) + e.quantity_executed);
    }
    return m;
  }, [entries]);

  const certsByContract = useMemo(() => {
    const m = new Map<string, SubcontractorCertificate[]>();
    for (const c of certificates) {
      const list = m.get(c.contract_id) ?? [];
      list.push(c);
      m.set(c.contract_id, list);
    }
    return m;
  }, [certificates]);

  function contractSummary(contractId: string) {
    const certs = certsByContract.get(contractId) ?? [];
    const approvedAmount = certs
      .filter((c) => c.status === "APROBADO" || c.status === "PAGADO")
      .reduce((s, c) => s + (c.approved_amount ?? 0), 0);
    const pendingAmount = certs
      .filter((c) => c.status === "PENDIENTE")
      .reduce((s, c) => s + c.claimed_amount, 0);
    const retentionAccum = certs
      .filter((c) => c.status === "APROBADO" || c.status === "PAGADO")
      .reduce((s, c) => s + c.retention_amount, 0);
    return { approvedAmount, pendingAmount, retentionAccum };
  }

  return (
    <div className="max-w-5xl space-y-5">
      <BackButton label="Volver a Proyectos" />

      <div className="flex items-start justify-between mt-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{project.name}</h1>
            <span className="text-[12px] text-[var(--muted)] font-mono">{project.code}</span>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {project.client ? `Cliente: ${project.client}` : "Sin cliente"}
            {project.location ? ` · ${project.location}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <EditProjectDialog
            project={project}
            trigger={
              <Button variant="ghost" title="Editar obra">
                <Pencil size={15} />
              </Button>
            }
          />
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
          <ProjectStatusSelect projectId={project.id} status={project.status} />
        </div>
      </div>

      <div className={`grid gap-3 ${isCaterpillar ? "grid-cols-4" : "grid-cols-3"}`}>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Presupuesto total</div>
          <div className="text-[16px] font-bold mt-1">{formatMoney(presupuestoTotal, "PYG")}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Compras realizadas</div>
          <div className={`text-[16px] font-bold mt-1 ${comprasPct > 100 ? "text-[var(--error)]" : ""}`}>
            {formatMoney(comprasTotal, "PYG")}
          </div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">{comprasPct}% del presupuesto</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Ítems / entradas de avance</div>
          <div className="text-[16px] font-bold mt-1">{items.length} / {entries.length}</div>
        </div>
        {isCaterpillar ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Costo M. de Obra</div>
            <div className="text-[16px] font-bold mt-1">{formatMoney(laborCostTotal, "PYG")}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{laborHoursTotal} h totales</div>
          </div>
        ) : null}
      </div>

      {tab === "presupuesto" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <AddBudgetItemForm projectId={project.id} />
            <ImportBudgetDialog projectId={project.id} />
            <DuplicateBudgetDialog targetProjectId={project.id} sources={duplicateSources} />
          </div>
          <PresupuestoTable
            rows={items.map((i) => {
              const exec = execByItem.get(i.id) ?? 0;
              const pct = i.quantity && i.quantity > 0 ? Math.min(100, Math.round((exec / i.quantity) * 100)) : null;
              return {
                id: i.id,
                code: i.code,
                description: i.description,
                unit: i.unit,
                quantity: i.quantity,
                unitPrice: i.unit_price,
                subtotal: i.subtotal,
                execPct: pct,
              };
            })}
            total={itemsSubtotal}
            projectId={project.id}
          />
        </div>
      ) : null}

      {tab === "cronograma" ? (
        <ProjectGantt projectId={project.id} budgetItems={items} execEntries={entries} />
      ) : null}

      {tab === "ejecucion" ? (
        <div className="space-y-3">
          <AddExecutionEntryForm projectId={project.id} budgetItems={items} />
          <EjecucionTable
            rows={entries.map((e) => {
              const item = items.find((i) => i.id === e.budget_item_id);
              const photoUrls = e.photo_paths.map((p) => photoUrlMap.get(p)).filter((u): u is string => !!u);
              return {
                id: e.id,
                date: e.entry_date,
                itemLabel: item ? `${item.code} — ${item.description}` : "—",
                unit: item?.unit ?? "",
                quantityExecuted: e.quantity_executed,
                notes: e.notes,
                photoUrls,
              };
            })}
          />
        </div>
      ) : null}

      {tab === "compras" ? (
        <div className="space-y-3">
          <RfqDialog
            projectId={project.id}
            trigger={<Button size="sm">+ Nueva cotización / OC</Button>}
          />
          <ProyectoComprasTable rows={ocs} />
        </div>
      ) : null}

      {tab === "cotizaciones" ? (
        <div className="space-y-3">
          <RfqDialog
            projectId={project.id}
            trigger={<Button size="sm">+ Nueva cotización</Button>}
          />
          <ProyectoRfqsTable rows={projectRfqs} />
        </div>
      ) : null}

      {tab === "proveedores" ? <ProyectoProveedoresTable rows={projectProviders} /> : null}

      {tab === "facturas" ? (
        <ProyectoFacturasTable rows={projectInvoices} providerNameById={providerNameById} />
      ) : null}

      {tab === "pagos" ? (
        <ProyectoPagosTable rows={projectPaymentOrders} providerNameById={providerNameById} />
      ) : null}

      {tab === "informes" ? (
        <ProjectReports project={project} budgetItems={items} execEntries={entries} orders={ocs} />
      ) : null}

      {tab === "personal" && isCaterpillar ? (
        <div className="space-y-3">
          <AddLaborEntryForm projectId={project.id} />
          <PersonalTable rows={laborRows} />
        </div>
      ) : null}

      {tab === "subcontratistas" && isCaterpillar ? (
        <div className="space-y-3">
          <AddSubcontractorContractDialog
            projectId={project.id}
            subcontractors={subcontractorCatalog}
            budgetItems={items}
          />
          <SubcontratistasTable
            appUrl={appUrl}
            rows={contracts.map((c) => {
              const sub = subcontractorCatalog.find((s) => s.id === c.subcontractor_id);
              const item = items.find((i) => i.id === c.budget_item_id);
              const summary = contractSummary(c.id);
              const usedPct =
                c.contracted_amount > 0
                  ? Math.round(
                      ((summary.approvedAmount + summary.pendingAmount) / c.contracted_amount) * 100
                    )
                  : 0;
              return {
                contract: c,
                subName: sub?.name ?? "—",
                itemLabel: item ? `${item.code} — ${item.description}` : "—",
                approvedAmount: summary.approvedAmount,
                retentionAccum: summary.retentionAccum,
                usedPct,
                certs: certificates.filter((cert) => cert.contract_id === c.id),
              };
            })}
          />
        </div>
      ) : null}
    </div>
  );
}
