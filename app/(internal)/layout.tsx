import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

// The logo upload in the Sidebar (present on every page under this layout)
// can rasterize a PDF, which may outlast the platform's default serverless
// timeout (10s on Vercel's Hobby plan).
export const maxDuration = 60;

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar
        role={profile.role}
        fullName={profile.full_name}
        isSuperAdmin={profile.is_super_admin}
        modules={{ compras: profile.modulo_compras, ventas: profile.modulo_ventas }}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar initial={initial} role={profile.role} />
        <main className="flex-1 min-w-0 p-5">{children}</main>
      </div>
    </div>
  );
}
