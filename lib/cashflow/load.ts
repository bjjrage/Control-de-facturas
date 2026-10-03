import { buildCanonicalCashflow } from "./model";
import type { CashflowSources } from "./types";
export async function loadCanonicalCashflow(db: {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
        data: unknown;
        error: {
            message: string;
        } | null;
    }>;
}, empresaId: string, from: string, until: string) {
    const result = await db.rpc("cashflow_read_sources", { p_from: from, p_until: until });
    if (result.error)
        throw new Error(`Caja no disponible: ${result.error.message}`);
    const sources = result.data as CashflowSources;
    const items = buildCanonicalCashflow(sources, empresaId);
    return { sources, items };
}
/** Pagination is transport chunking, never a business cap. Reject read errors
 * and a server response that truncates the requested page. */
export async function readAll<T>(query: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: {
        message: string;
    } | null;
    count?: number | null;
}>): Promise<T[]> {
    const out: T[] = [];
    const pageSize = 500;
    for (let offset = 0;; offset += pageSize) {
        const r = await query(offset, offset + pageSize - 1);
        if (r.error || !r.data)
            throw new Error(r.error?.message ?? "Fuente no disponible");
        out.push(...r.data);
        if (r.count != null && out.length >= r.count)
            return out;
        if (r.data.length < pageSize) {
            if (r.count != null && out.length < r.count)
                throw new Error("Fuente financiera truncada");
            return out;
        }
    }
}
