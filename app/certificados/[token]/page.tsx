import { notFound } from "next/navigation";
import Image from "next/image";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatMoney } from "@/lib/format";
import { CertificateForm } from "./certificate-form";

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente de revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  PAGADO: "Pagado",
};

export default async function CertificadosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("subcontractor_contracts")
    .select("*, subcontractors(name), projects(name, code)")
    .eq("public_token", token)
    .maybeSingle();

  if (!contract) notFound();

  const rawSub = (contract as unknown as { subcontractors: { name: string } | { name: string }[] }).subcontractors;
  const rawProject = (contract as unknown as { projects: { name: string; code: string } | { name: string; code: string }[] }).projects;
  const subcontractor = (Array.isArray(rawSub) ? rawSub[0] : rawSub) ?? { name: "—" };
  const project = (Array.isArray(rawProject) ? rawProject[0] : rawProject) ?? { name: "—", code: "—" };

  const { data: certificates } = await admin
    .from("subcontractor_certificates")
    .select("*")
    .eq("contract_id", contract.id)
    .order("certificate_number", { ascending: false });

  const certs = certificates ?? [];
  const isActive = contract.status === "ACTIVO";

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-[11px] text-[var(--muted)] mb-1">Contrato de subcontratista</p>
          <h1 className="text-[15px] font-semibold mb-2">Hola, {subcontractor.name}</h1>
          <div className="space-y-1 text-[13px]">
            <div><span className="text-[var(--muted)]">Proyecto: </span>{project.name} ({project.code})</div>
            <div><span className="text-[var(--muted)]">Monto contratado: </span>{formatMoney(contract.contracted_amount, "PYG")}</div>
            <div><span className="text-[var(--muted)]">Retención: </span>{contract.retention_pct}%</div>
            {contract.description ? <div><span className="text-[var(--muted)]">Descripción: </span>{contract.description}</div> : null}
          </div>
        </div>

        {certs.length > 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <p className="text-[12px] font-semibold mb-2">Certificados anteriores</p>
            <div className="space-y-2">
              {certs.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[12px] border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                  <div>
                    <div className="font-medium">Certificado #{c.certificate_number} — {c.claimed_pct}%</div>
                    <div className="text-[var(--muted)]">{formatDate(c.submitted_at)} · {formatMoney(c.claimed_amount, "PYG")}</div>
                  </div>
                  <span className="text-[11px] text-[var(--muted)]">{STATUS_LABELS[c.status] ?? c.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {isActive ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <h2 className="text-[14px] font-semibold mb-3">Cargar nuevo certificado</h2>
            <CertificateForm token={token} />
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Este contrato ya no está activo. Si creés que es un error, contactá a la empresa.
          </div>
        )}
      </div>
    </div>
  );
}
