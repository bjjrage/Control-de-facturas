import { z } from "zod";

export const needOriginSchema = z.object({
  planId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  needIds: z.array(z.string().uuid()).min(1).max(500),
  seen: z.record(z.string(), z.unknown()),
}).refine(v => new Set(v.needIds).size === v.needIds.length, "Necesidades duplicadas");
export type NeedOrigin = z.infer<typeof needOriginSchema>;

export function needOriginArgs(raw: unknown) {
  const origin = needOriginSchema.parse(raw);
  return { p_plan_id: origin.planId, p_snapshot_id: origin.snapshotId,
    p_need_ids: origin.needIds, p_seen: origin.seen };
}
