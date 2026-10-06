"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn, clamp } from "@/lib/utils";
import { InfoTip } from "./tooltip";

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step,
  className,
  label,
  range,
  minStepsBetweenThumbs,
}: {
  value: number[];
  onValueChange: (v: number[]) => void;
  min: number;
  max: number;
  step: number;
  className?: string;
  label: string;
  range?: boolean;
  minStepsBetweenThumbs?: number;
}) {
  return (
    <SliderPrimitive.Root
      minStepsBetweenThumbs={minStepsBetweenThumbs}
      className={cn("relative flex h-5 w-full touch-none items-center select-none", className)}
      value={value}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      aria-label={label}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-3">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
      </SliderPrimitive.Track>
      {value.map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={range ? `${label} ${i === 0 ? "minimum" : "maximum"}` : label}
          className="block h-4 w-4 rounded-full border-2 border-accent bg-surface shadow transition-transform hover:scale-110 focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  digits = 1,
  className,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  digits?: number;
  className?: string;
  label: string;
}) {
  const [draft, setDraft] = React.useState(value.toFixed(digits));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(value.toFixed(digits));
  }, [value, digits, focused]);
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v)) onChange(clamp(v, min, max));
    else setDraft(value.toFixed(digits));
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      className={cn(
        "tabular h-7 w-16 rounded-md border border-border bg-surface-2 px-2 text-right font-mono text-xs text-fg",
        "focus:border-accent focus:ring-2 focus:ring-ring focus:outline-none",
        className,
      )}
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const mult = e.shiftKey ? 10 : 1;
          const nv = clamp(value + (e.key === "ArrowUp" ? step : -step) * mult, min, max);
          onChange(Number(nv.toFixed(6)));
        }
      }}
    />
  );
}

export function SliderField({
  label,
  hint,
  unit,
  value,
  onChange,
  min,
  max,
  step,
  digits = 1,
  status,
  trailing,
}: {
  label: string;
  hint?: string;
  unit?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  digits?: number;
  status?: "pass" | "warn" | "fail";
  trailing?: React.ReactNode;
}) {
  return (
    <div className="group">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
          {label}
          {hint && <InfoTip>{hint}</InfoTip>}
          {status && status !== "pass" && (
            <span
              className={cn("h-1.5 w-1.5 rounded-full", status === "warn" ? "bg-warning" : "bg-critical")}
              aria-label={status === "warn" ? "near envelope edge" : "outside envelope"}
            />
          )}
        </label>
        <div className="flex items-center gap-1.5">
          {trailing}
          <NumberInput label={label} value={value} onChange={onChange} min={min} max={max} step={step} digits={digits} />
          {unit && <span className="w-6 text-[11px] text-muted">{unit}</span>}
        </div>
      </div>
      <Slider label={label} value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted opacity-0 transition-opacity group-hover:opacity-100">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
