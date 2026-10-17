"use client";

import { CircleHelp } from "lucide-react";
import { useId, useRef, useState, type PointerEvent, type FocusEvent, type KeyboardEvent } from "react";

type InfoTooltipProps = {
  label: string;
  content: string;
  className?: string;
};

/** Compact, keyboard and touch accessible help for panel and field headings. */
export function InfoTooltip({ label, content, className }: InfoTooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pointerType = useRef<string | null>(null);
  const hovered = useRef(false);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    pointerType.current = event.pointerType;
  }

  function handlePointerEnter(event: PointerEvent<HTMLButtonElement>) {
    pointerType.current = event.pointerType;
    if (event.pointerType !== "touch") {
      hovered.current = true;
      setOpen(true);
    }
  }

  function handlePointerLeave(event: PointerEvent<HTMLButtonElement>) {
    pointerType.current = event.pointerType;
    if (event.pointerType !== "touch") {
      hovered.current = false;
      if (!event.currentTarget.matches(":focus")) setOpen(false);
    }
  }

  function handleFocus(event: FocusEvent<HTMLButtonElement>) {
    if (pointerType.current !== "touch" && event.currentTarget.matches(":focus-visible")) {
      pointerType.current = "keyboard";
      setOpen(true);
    }
  }

  function handleBlur() {
    if (!hovered.current) setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") setOpen(false);
    else if (event.key === "Enter" || event.key === " ") pointerType.current = "keyboard";
  }

  function handleClick() {
    if (pointerType.current === "touch") setOpen((value) => !value);
  }

  return (
    <span className={[
      "erp-info-tooltip",
      open ? "erp-info-tooltip--open" : "",
      className ?? "",
    ].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="erp-info-tooltip__trigger"
        aria-label={"Más información: " + label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        <CircleHelp aria-hidden="true" size={15} strokeWidth={1.8} />
      </button>
      <span id={id} role="tooltip" className="erp-info-tooltip__content" aria-hidden={!open}>
        {content}
      </span>
    </span>
  );
}
