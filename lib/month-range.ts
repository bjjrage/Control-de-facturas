// Shared by the Facturas panel (app/(internal)/invoices/page.tsx) and the CSV
// export route so "el mes actual" and its date boundaries are computed exactly
// the same way in both places.

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end: `${nextMonth}-01` };
}
