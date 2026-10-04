"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { unmatchOrder } from "./actions";

export function UnmatchOrderButton({ invoiceId, matchId, orderId }: {
  invoiceId: string; matchId: string; orderId: string;
}) {
  const [state, action, pending] = useActionState(
    async () => unmatchOrder(invoiceId, matchId, orderId),
    { error: null as string | null },
  );
  return (
    <form action={action}>
      <Button variant="ghost" className="h-6 px-2 text-[12px]" type="submit" disabled={pending}>
        {pending ? "Desvinculando…" : "Desvincular"}
      </Button>
      {state.error ? <p role="alert" className="text-[12px] text-[var(--danger)]">{state.error}</p> : null}
    </form>
  );
}
