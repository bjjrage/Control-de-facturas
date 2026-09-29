"use client";

import { useState } from "react";
import { Library } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApuTemplatesSection } from "./apu-templates-section";

export function ApuTemplatesDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="gap-1.5">
          <Library className="h-3.5 w-3.5" />
          Plantillas de APU
        </Button>
      </DialogTrigger>
      <DialogContent title="Plantillas de APU (empresa)" className="max-w-3xl">
        <ApuTemplatesSection />
        <div className="flex justify-end pt-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="h-8 text-xs">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
