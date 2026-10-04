import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCanonicalCashflow } from "@/lib/cashflow/load";
import { businessToday } from "@/lib/cashflow/dates";
import type { CurrencyCode, Project } from "@/lib/types";
import { FlujoCajaSection } from "./flujo-caja-section";

export default async function FlujoCajaPage() {
  const profile=await requireProfile(["administracion","admin"]);
  const db=await createClient();
  const today=businessToday();
  const [year,month]=today.split("-").map(Number);
  const until=new Date(Date.UTC(year,month+5,0)).toISOString().slice(0,10);
  try {
    const {sources,items}=await loadCanonicalCashflow(db,profile.empresa_id,today,until);
    const balances=new Map<CurrencyCode,number>();
    for(const c of sources.accounts) balances.set(c.moneda,(balances.get(c.moneda)??0)+Number(c.saldo));
    return <FlujoCajaSection saldoPorMoneda={[...balances]} items={items} gastos={sources.expenses} cuentas={sources.accounts}
      proyectos={sources.projects as Pick<Project,"id"|"name"|"code"|"status"|"comitente">[]} hayCuentas={sources.accounts.length>0} today={today} />;
  } catch(e) {
    console.error("cashflow unavailable",e);
    return <div role="alert" className="rounded-lg border p-4 text-sm">Flujo de caja no disponible. No se pudieron verificar todas las fuentes financieras. Reintentá la lectura; los importes no se reemplazan por cero.</div>;
  }
}
