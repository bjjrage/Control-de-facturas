import type { ReactNode } from "react";
import { requirePlan } from "@/lib/auth";

export default async function LicitacionesLayout({ children }: { children: ReactNode }) {
  await requirePlan("pro", ["comercial", "administracion", "admin"]);
  return children;
}
