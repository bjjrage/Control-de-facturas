"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import styles from "./costeo-checklist.module.css";

/** Local help: hover/focus opens; click pins; Escape or outside click dismisses. */
export function CosteoHelp({ title, children }: { title: string; children: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 12 });
  function show() {
    if (timer.current) clearTimeout(timer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 384)), ...(window.innerHeight - rect.bottom < 290 ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
    setOpen(true);
  }
  function leave() {
    if (!pinned && document.activeElement !== trigger.current) timer.current = setTimeout(() => setOpen(false), 180);
  }
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setPinned(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <>
    <button ref={trigger} type="button" className={styles.helpButton} aria-label={`Ayuda: ${title}`} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={() => { if (!trigger.current?.matches(":hover")) leave(); }}
      onClick={() => { if (pinned) { setPinned(false); setOpen(false); } else { show(); setPinned(true); } }}><Info size={15} aria-hidden="true" /></button>
    {open && createPortal(<div ref={popup} id={id} role="tooltip" className={styles.helpPopup} style={position} onMouseEnter={() => { if (timer.current) clearTimeout(timer.current); }} onMouseLeave={leave}>
      <strong>{title}</strong><p>{children}</p>
    </div>, document.body)}
  </>;
}
