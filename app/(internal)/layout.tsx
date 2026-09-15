import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkspaceRail } from "@/components/layout/workspace-rail";
import { AdminRailPanel } from "@/components/layout/admin-rail-panel";
import { Topbar } from "@/components/layout/topbar";
import { AppShellClient } from "@/components/layout/app-shell-client";

// The logo upload in the Sidebar (present on every page under this layout)
// can rasterize a PDF, which may outlast the platform's default serverless
// timeout (10s on Vercel's Hobby plan).
export const maxDuration = 60;

const PLAN_RANK = { basico: 0, pro: 1, caterpillar: 2 } as const;

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";
  const isProOrAbove = PLAN_RANK[profile.plan] >= PLAN_RANK.pro;
  const showOperativo = isProOrAbove && (profile.role === "administracion" || profile.role === "admin");
  const showLicitaciones = isProOrAbove && ["comercial", "administracion", "admin"].includes(profile.role);

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar
        role={profile.role}
        fullName={profile.full_name}
        isSuperAdmin={profile.is_super_admin}
        modules={{ compras: profile.modulo_compras, ventas: profile.modulo_ventas }}
        plan={profile.plan}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar initial={initial} fullName={profile.full_name} role={profile.role} />
        <main className="flex-1 min-w-0 p-5">
          <AppShellClient>{children}</AppShellClient>
        </main>
      </div>
      <WorkspaceRail showOperativo={showOperativo} showLicitaciones={showLicitaciones} />
      <AdminRailPanel role={profile.role} plan={profile.plan} isSuperAdmin={profile.is_super_admin} />
    </div>
  );
}
