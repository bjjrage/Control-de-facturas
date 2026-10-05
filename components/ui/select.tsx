"use client";

import * as Radix from "@radix-ui/react-select";
import { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

type Option = { value: string; label: ReactNode; disabled?: boolean };
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment || child.type === "optgroup") return optionsFrom(child.props.children);
    if (child.type !== "option") throw new Error("Select accepts option children only");
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: child.props.disabled }];
  });
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "multiple" | "size" | "value" | "defaultValue"> & {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  onValueChange?: (value: string) => void;
};

/** Native option authoring is retained for existing action contracts; the popup is entirely Radix.
 * One successful input owns FormData (visually hidden text for native required validation).
 * The installed Radix 2.3.7 exports unstable_Provider separately from Root, which would
 * automatically insert a native bubble select inside forms. Keep this compatibility
 * boundary covered by the SSR and Firefox regressions when upgrading Radix. */
export function Select({ children, value: controlled, defaultValue, onChange, onValueChange, name, disabled, required, id, className, form, title, ...rest }: Props) {
  const options = optionsFrom(children);
  const initial = String(defaultValue ?? options.find(o => !o.disabled)?.value ?? "");
  const [internal, setInternal] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const value = controlled === undefined ? internal : String(controlled);
  const optionKeys = options.map(o => o.value).join("\u0000");
  useEffect(() => {
    if (controlled === undefined && !options.some(o => o.value === internal)) setInternal(initial);
  }, [controlled, internal, initial, optionKeys]);
  useEffect(() => {
    const owner = input.current?.form;
    const reset = () => setInternal(initial);
    owner?.addEventListener("reset", reset);
    return () => owner?.removeEventListener("reset", reset);
  }, [initial]);
  const encode = (v: string) => v === "" ? "__erp_empty__" : `v:${v}`;
  return <>
    <input ref={input} type={required ? "text" : "hidden"} className={required ? "sr-only" : undefined} tabIndex={-1} aria-hidden="true" name={name} value={value} readOnly={false} onChange={() => {}} required={required} disabled={disabled} form={form} onInvalid={e => { e.preventDefault(); trigger.current?.focus(); }} />
    <Radix.unstable_Provider value={encode(value)} disabled={disabled} onValueChange={encoded => {
      const next = encoded === "__erp_empty__" ? "" : encoded.slice(2);
      setInternal(next);
      onValueChange?.(next);
      onChange?.({ target: { value: next }, currentTarget: { value: next } });
    }}>
      <Radix.Trigger ref={trigger} id={id} title={title} aria-label={rest["aria-label"]} aria-labelledby={rest["aria-labelledby"]} aria-describedby={rest["aria-describedby"]} aria-required={required} aria-invalid={rest["aria-invalid"]} className={cn("flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-white/[0.09] bg-[#17253a] px-3 text-left text-[12px] text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50", className)}>
        <Radix.Value /><Radix.Icon><ChevronDown className="h-3.5 w-3.5 shrink-0" /></Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal><Radix.Content position="popper" sideOffset={4} className="z-[150] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[var(--border)] bg-[#17253a] p-1 text-[12px] text-[var(--foreground)] shadow-xl">
        <Radix.ScrollUpButton className="text-center">↑</Radix.ScrollUpButton>
        <Radix.Viewport>{options.map(o => <Radix.Item key={o.value} value={encode(o.value)} disabled={o.disabled} className="relative cursor-default rounded-md py-2 pl-7 pr-3 outline-none data-[highlighted]:bg-[var(--hover)] data-[state=checked]:text-[var(--primary)] data-[disabled]:opacity-40">
          <Radix.ItemIndicator className="absolute left-2"><Check className="h-3 w-3" /></Radix.ItemIndicator><Radix.ItemText>{o.label}</Radix.ItemText>
        </Radix.Item>)}</Radix.Viewport><Radix.ScrollDownButton className="text-center">↓</Radix.ScrollDownButton>
      </Radix.Content></Radix.Portal>
    </Radix.unstable_Provider>
  </>;
}
