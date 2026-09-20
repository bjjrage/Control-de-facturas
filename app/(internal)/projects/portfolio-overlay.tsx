"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { ProjectListRow } from "./portfolio-data";
import { PortfolioTable } from "./portfolio-table";

export function PortfolioOverlay({ rows }: { rows: ProjectListRow[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">Ver portfolio completo</Button>
      </DialogTrigger>
      <DialogContent title="Portfolio completo" className="h-[88vh] w-[calc(100vw-2rem)] max-w-[1280px] overflow-hidden p-5 sm:w-[min(96vw,1280px)]">
        <DialogClose type="button" aria-label="Cerrar portfolio" className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)]">
          <X size={17} />
        </DialogClose>
        <div className="h-[calc(88vh-5.5rem)] overflow-y-auto pr-1">
          <PortfolioTable rows={rows} showHeader={false} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
