export function businessToday(now = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dateOnly(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error("Fecha financiera inválida");
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
        throw new Error("Fecha financiera inválida");
    return value;
}
export function addCashDays(value: string, days: number): string {
    const d = new Date(`${dateOnly(value)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
export function financialWindow(items: import("@/lib/flujo-caja").FlujoItem[], from: string, until: string) {
    dateOnly(from);
    dateOnly(until);
    return items.filter(i => i.certainty !== "ACTUAL" && i.fecha !== null && i.fecha <= until
        && (i.fecha >= from || i.certainty === "COMMITTED" || i.tipo === "pago_factura" || i.tipo === "cobro_factura"));
}
