"use client";

import { useRouter } from "next/navigation";

export function CobrosFilter({
  clients,
  selected,
}: {
  clients: { id: string; name: string }[];
  selected?: string;
}) {
  const router = useRouter();
  return (
    <select
      defaultValue={selected ?? ""}
      onChange={(e) =>
        router.push(`/cobros${e.target.value ? `?client=${e.target.value}` : ""}`)
      }
      className="h-8 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[13px] focus:outline-none"
    >
      <option value="">Todos los clientes</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
