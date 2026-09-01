import { UserRole } from "./types";

/**
 * Frontend-side permission helpers. These are a UX convenience only — the
 * real enforcement is Postgres RLS (supabase/migrations/0004_rls.sql), which
 * is what actually protects the data regardless of what the client renders.
 */
export const can = {
  createRfq: (role: UserRole) => role === "comercial" || role === "admin",
  selectOffer: (role: UserRole) => role === "comercial" || role === "admin",
  viewCosts: (role: UserRole) => role === "comercial" || role === "admin",
  manageInvoices: (role: UserRole) => role === "administracion" || role === "admin",
  viewInvoices: (role: UserRole) => role === "administracion" || role === "admin",
  manageProviders: (role: UserRole) => role === "admin",
  manageUsers: (role: UserRole) => role === "admin",
};

export function homeRouteFor(role: UserRole) {
  return "/dashboard";
}
