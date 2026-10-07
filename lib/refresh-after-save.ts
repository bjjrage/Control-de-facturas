import { refresh, revalidatePath } from "next/cache";

/** Call from a Server Action only, after its writes have succeeded. */
export function refreshAfterSave(...paths: string[]): void {
  for (const path of new Set(paths)) revalidatePath(path);
  refresh();
}
