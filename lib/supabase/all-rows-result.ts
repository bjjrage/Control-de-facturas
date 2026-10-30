import { readAll } from "@/lib/cashflow/load";

export async function allRowsResult<T>(query: {
  order(column: string): { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }> };
}) {
  return { data: await readAll((from,to) => query.order("id").range(from,to)), error: null as { message: string } | null };
}
