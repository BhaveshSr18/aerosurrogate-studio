"use client";

import { Gauge, Shapes, Wind } from "lucide-react";
import type { Design, Envelope, EnvelopeCheck } from "@/lib/types";
import { SliderField } from "@/components/ui/slider-field";
import { Segmented, Switch } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { SectionLabel } from "@/components/ui/card";
import { PRESETS } from "@/lib/presets";
import { designation, snapCamberPosition } from "@/lib/physics/naca";
import { fmtRe } from "@/lib/format";
import { mach, reynolds } from "@/lib/physics/envelope";

function sameDesignShape(a: Design, b: Design) {
  if (a.family !== b.family) return false;
  return JSON.stringify(a.family === "4" ? a.naca4 : a.naca5) === JSON.stringify(b.family === "4" ? b.naca4 : b.naca5);
}

export function DesignControls({
  design,
  onChange,
  envelope,
  checks,
  showOperating = true,
}: {
  design: Design;
  onChange: (d: Design) => void;
  envelope: Envelope;
  checks?: EnvelopeCheck[];
  showOperating?: boolean;
}) {
  const st = (key: string) => checks?.find((c) => c.key === key)?.status;
  const preset = PRESETS.find((p) => sameDesignShape(p.design, design));
  const set4 = (k: keyof Design["naca4"], v: number) =>
    onChange({ ...design, naca4: { ...design.naca4, [k]: k === "P" ? snapCamberPosition(v) : v } });
  const set5 = (k: "L" | "P" | "T", v: number) => onChange({ ...design, naca5: { ...design.naca5, [k]: v } });

  return (
    <div className="space-y-6">
      <div>
        <SectionLabel className="flex items-center gap-1.5">
          <Shapes className="h-3.5 w-3.5" /> Airfoil
        </SectionLabel>
        <div className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="text-[11px] text-muted">Designation</div>
          <div className="tabular font-mono text-lg font-semibold tracking-tight text-fg">{designation(design)}</div>
        </div>
        <div className="space-y-3">
          <Select
            label="Preset"
            value={preset?.name}
            placeholder="Custom design"
            onValueChange={(name) => {
              const p = PRESETS.find((x) => x.name === name);
              if (p) onChange({ ...p.design, aoa: design.aoa, speed: design.speed });
            }}
            options={PRESETS.map((p) => ({ value: p.name, label: p.name, hint: p.note }))}
          />
          <Segmented
            label="NACA family"
            className="flex w-full"
            value={design.family}
            onChange={(f) => onChange({ ...design, family: f })}
            options={[
              { value: "4", label: "4-digit" },
              { value: "5", label: "5-digit" },
            ]}
          />
        </div>
      </div>

      <div className="space-y-4">
        {design.family === "4" ? (
          <>
            <SliderField
              label="Max camber M"
              hint="Maximum camber as a percentage of chord (first digit)."
              unit="%c"
              value={design.naca4.M}
              onChange={(v) => set4("M", v)}
              {...envelope.naca4.M}
              status={st("M")}
            />
            <SliderField
              label="Camber position P"
              hint="Chordwise position of maximum camber, in tenths of chord (second digit). 0 means no camber; otherwise at least 1 (10 % chord). Has no effect when M = 0."
              unit="/10"
              value={design.naca4.P}
              onChange={(v) => set4("P", v)}
              {...envelope.naca4.P}
              status={st("P")}
            />
            <SliderField
              label="Thickness T"
              hint="Maximum thickness as a percentage of chord (last two digits)."
              unit="%c"
              value={design.naca4.T}
              onChange={(v) => set4("T", v)}
              {...envelope.naca4.T}
              status={st("T")}
            />
          </>
        ) : (
          <>
            <SliderField
              label="Design lift L"
              hint="Design-lift parameter: ideal lift coefficient = 0.15 × L (first digit)."
              value={design.naca5.L}
              onChange={(v) => set5("L", v)}
              {...envelope.naca5.L}
              status={st("L")}
            />
            <SliderField
              label="Camber position P"
              hint="Position of maximum camber, in twentieths of chord (second digit)."
              unit="/20"
              value={design.naca5.P}
              onChange={(v) => set5("P", v)}
              {...envelope.naca5.P}
              status={st("P")}
            />
            <SliderField
              label="Thickness T"
              hint="Maximum thickness as a percentage of chord (last two digits)."
              unit="%c"
              value={design.naca5.T}
              onChange={(v) => set5("T", v)}
              {...envelope.naca5.T}
              status={st("T")}
            />
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-xs font-medium text-fg-2">Reflexed camber (Q = 1)</div>
                <div className="text-[11px] text-muted">Trailing-edge reflex for low pitching moment</div>
              </div>
              <Switch
                label="Reflexed camber"
                checked={design.naca5.Q === 1}
                onCheckedChange={(c) => onChange({ ...design, naca5: { ...design.naca5, Q: c ? 1 : 0 } })}
              />
            </div>
          </>
        )}
      </div>

      {showOperating && (
        <div>
          <SectionLabel className="flex items-center gap-1.5">
            <Wind className="h-3.5 w-3.5" /> Operating point
          </SectionLabel>
          <div className="space-y-4">
            <SliderField
              label="Angle of attack α"
              hint="Applied by rotating the inflow vector, as in the AirfRANS simulations."
              unit="°"
              value={design.aoa}
              onChange={(v) => onChange({ ...design, aoa: v })}
              {...envelope.aoa}
              status={st("aoa")}
            />
            <SliderField
              label="Inflow speed U∞"
              hint="Freestream speed. With a 1 m chord and air at 25 °C it sets the Reynolds number."
              unit="m/s"
              value={design.speed}
              onChange={(v) => onChange({ ...design, speed: v })}
              {...envelope.speed}
              status={st("speed")}
            />
            <div className="grid grid-cols-2 gap-2">
              <Readout icon={<Gauge className="h-3.5 w-3.5" />} label="Reynolds" value={fmtRe(reynolds(design.speed))} />
              <Readout label="Mach" value={mach(design.speed).toFixed(3)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Readout({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted">
        {icon}
        {label}
      </div>
      <div className="tabular font-mono text-sm font-medium text-fg">{value}</div>
    </div>
  );
}
