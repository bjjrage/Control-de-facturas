"use client";

import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceivedDocument, ScanModal } from "./scan-modal";

interface ScanButtonProps {
  contextType?: string;
  contextId?: string | null;
  targetField?: string | null;
  metadata?: Record<string, unknown>;
  onDocumentReceived?: (doc: ReceivedDocument) => void;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
  children?: React.ReactNode;
}

export function ScanButton({
  contextType = "general",
  contextId = null,
  targetField = null,
  metadata,
  onDocumentReceived,
  className,
  variant = "secondary",
  children,
}: ScanButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        onClick={() => setOpen(true)}
        className={className}
      >
        {children || (
          <>
            <Smartphone className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
            Escanear desde celular
          </>
        )}
      </Button>

      <ScanModal
        open={open}
        onOpenChange={setOpen}
        contextType={contextType}
        contextId={contextId}
        targetField={targetField}
        metadata={metadata}
        onDocumentReceived={onDocumentReceived}
      />
    </>
  );
}
