"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  label,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: { value: string; label: React.ReactNode; hint?: string }[];
  placeholder?: string;
  className?: string;
  label: string;
}) {
  // "" (not undefined) keeps the Select controlled while it shows the placeholder.
  return (
    <SelectPrimitive.Root value={value ?? ""} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[placeholder]:text-muted",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer items-center justify-between gap-4 rounded-md py-2 pr-8 pl-2.5 text-sm text-fg outline-none select-none data-[highlighted]:bg-surface-2"
              >
                <div>
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  {o.hint && <div className="text-xs text-muted">{o.hint}</div>}
                </div>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="h-4 w-4 text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
