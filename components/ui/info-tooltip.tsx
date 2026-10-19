"use client";

import { CircleHelp } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type PointerEvent, type FocusEvent, type KeyboardEvent } from "react";

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
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 0, top: "calc(100% + 0.55rem)" });

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!anchor.current || !bubble.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const { width, height } = bubble.current.getBoundingClientRect();
      const left = Math.max(8 - rect.left, Math.min(0, document.documentElement.clientWidth - 8 - rect.left - width));
      const top = rect.bottom + height + 8 > window.innerHeight && rect.top > height + 8
        ? `${-height - 8}px` : "calc(100% + 0.55rem)";
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

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
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pointerType.current = "keyboard";
      setOpen(true);
    }
  }

  function handleClick() {
    if (pointerType.current === "touch") setOpen((value) => !value);
  }

  return (
    <span ref={anchor} className={[
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
      <span ref={bubble} id={id} role="tooltip" className="erp-info-tooltip__content" aria-hidden={!open} style={position}>
        {content}
      </span>
    </span>
  );
}
