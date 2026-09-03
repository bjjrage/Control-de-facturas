import { Search, Bell, HelpCircle } from "lucide-react";
import { UserRole } from "@/lib/types";

export function Topbar({
  initial,
  role: _role,
}: {
  initial: string;
  role: UserRole;
}) {
  return (
    <header className="h-14 shrink-0 border-b border-[var(--border)] bg-[var(--panel)] px-4 flex items-center gap-3 sticky top-0 z-10">
      <div className="flex-1 max-w-md">
        <div className="flex items-center gap-2 h-9 rounded-full bg-[var(--panel-2)] border border-[var(--border)] px-3.5">
          <Search size={15} className="text-[var(--muted)] shrink-0" />
          <input
            placeholder="Buscar en niu.pack…"
            disabled
            className="bg-transparent outline-none text-[13px] w-full placeholder:text-[var(--muted)] disabled:cursor-default"
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          disabled
          className="h-9 w-9 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--hover)] disabled:hover:bg-transparent disabled:opacity-60"
          title="Notificaciones (próximamente)"
        >
          <Bell size={16} />
        </button>
        <button
          disabled
          className="h-9 w-9 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--hover)] disabled:hover:bg-transparent disabled:opacity-60"
          title="Ayuda (próximamente)"
        >
          <HelpCircle size={16} />
        </button>
        <div className="h-8 w-8 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-[13px] font-semibold ml-1">
          {initial}
        </div>
      </div>
    </header>
  );
}
