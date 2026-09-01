"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { SELECTION_REASON_LABELS, SelectionReason } from "@/lib/types";
import { selectAndAuthorizeOffer } from "./actions";

const REASONS = Object.keys(SELECTION_REASON_LABELS) as SelectionReason[];

export function SelectOfferDialog({
  rfqId,
  rfqProviderId,
  quoteVersionId,
  providerName,
  totalPrice,
  currency,
  trigger,
}: {
  rfqId: string;
  rfqProviderId: string;
  quoteVersionId: string;
  providerName: string;
  totalPrice: number;
  currency: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<SelectionReason | "">("");
  const [detail, setDetail] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Autorizar oferta">
        <p className="text-[13px] mb-3">
          Vas a autorizar la oferta de <strong>{providerName}</strong> por{" "}
          <strong>{formatMoney(totalPrice, currency as never)}</strong>. Esta acción crea la orden
          autorizada y no se puede deshacer.
        </p>
        {error ? (
          <div className="mb-3 rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}
        <div className="space-y-3">
          <div>
            <Label htmlFor="selection_reason">
              Motivo de selección (si no es la más económica)
            </Label>
            <Select
              id="selection_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as SelectionReason)}
            >
              <option value="">Es la oferta más económica</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {SELECTION_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          {reason ? (
            <div>
              <Label htmlFor="selection_reason_detail">Detalle (opcional)</Label>
              <Textarea
                id="selection_reason_detail"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const result = await selectAndAuthorizeOffer({
                rfqId,
                rfqProviderId,
                quoteVersionId,
                selectionReason: reason || null,
                selectionReasonDetail: detail || null,
              });
              setPending(false);
              if (result.error) {
                setError(result.error);
                return;
              }
              setOpen(false);
            }}
          >
            {pending ? "Autorizando…" : "Autorizar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
