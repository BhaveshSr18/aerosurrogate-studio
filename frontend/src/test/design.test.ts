import { describe, expect, it } from "vitest";
import { designFromQuery, designToQuery, sanitizeDesign } from "@/lib/share";
import { designation, geometry, snapCamberPosition, toSelig } from "@/lib/physics/naca";
import { envelopeChecks } from "@/lib/physics/envelope";
import { DEFAULT_DESIGN, PRESETS } from "@/lib/presets";
import type { Design } from "@/lib/types";

describe("share links", () => {
  it("round-trips every preset", () => {
    for (const p of PRESETS) {
      const d = { ...p.design, aoa: 7.5, speed: 63 };
      const back = designFromQuery(designToQuery(d))!;
      expect(back.family).toBe(d.family);
      expect(back.aoa).toBe(7.5);
      expect(back.speed).toBe(63);
      expect(d.family === "4" ? back.naca4 : back.naca5).toEqual(d.family === "4" ? d.naca4 : d.naca5);
    }
  });

  it("ignores links without a design", () => {
    expect(designFromQuery("")).toBeNull();
    expect(designFromQuery("?utm_source=x")).toBeNull();
  });

  it("clamps malformed values instead of producing NaN or degenerate shapes", () => {
    const d = designFromQuery("?f=4&m=2&p=4&t=0&a=abc&u=-5")!;
    expect(d.naca4.T).toBe(5);
    expect(d.aoa).toBe(DEFAULT_DESIGN.aoa);
    expect(d.speed).toBe(31);
    const e = designFromQuery("?f=5&l=99&p=&q=7&t=1e9&a=1e9")!;
    expect(e.naca5).toEqual({ L: 4, P: 3, Q: 0, T: 20 });
    expect(e.aoa).toBe(15);
  });

  it("sanitizes persisted state from older builds", () => {
    const bad = { family: "4", naca4: { M: NaN, P: 0.3, T: -1 }, aoa: Infinity } as unknown as Partial<Design>;
    const d = sanitizeDesign(bad);
    expect(d.naca4).toEqual({ M: DEFAULT_DESIGN.naca4.M, P: 0, T: 5 });
    expect(d.aoa).toBe(DEFAULT_DESIGN.aoa);
    expect(sanitizeDesign(undefined)).toEqual(DEFAULT_DESIGN);
  });
});

describe("NACA geometry and naming", () => {
  it("names designs by NACA convention", () => {
    expect(designation(PRESETS[0].design)).toBe("NACA 0012");
    expect(designation({ ...PRESETS[0].design, naca4: { M: 0, P: 4, T: 12 } })).toBe("NACA 0012");
    expect(designation(PRESETS[1].design)).toBe("NACA 2412");
    expect(designation(PRESETS[5].design)).toBe("NACA 23012");
    expect(designation(PRESETS[6].design)).toBe("NACA 23112");
    expect(designation({ ...PRESETS[1].design, naca4: { M: 2.3, P: 4, T: 12 } })).toBe("≈ NACA 2412");
  });

  it("puts the camber peak and thickness where the parameters say", () => {
    const g = geometry(PRESETS[1].design);
    expect(g.maxCamber.x).toBeCloseTo(0.4, 2);
    expect(g.maxCamber.c).toBeCloseTo(0.02, 4);
    expect(g.maxThickness.t).toBeCloseTo(0.12, 3);
    const g5 = geometry(PRESETS[5].design); // NACA 23012: peak at 15 % chord
    expect(g5.maxCamber.x).toBeCloseTo(0.15, 2);
  });

  it("closes the trailing edge and orders the loop clockwise", () => {
    const { loop } = geometry(PRESETS[2].design);
    expect(loop[0][0]).toBeCloseTo(1, 9);
    expect(loop[0][0]).toBeCloseTo(loop[loop.length - 1][0], 12);
    expect(loop[0][1]).toBeCloseTo(loop[loop.length - 1][1], 12);
    let area = 0;
    for (let i = 0; i < loop.length - 1; i++) area += loop[i][0] * loop[i + 1][1] - loop[i + 1][0] * loop[i][1];
    expect(area).toBeLessThan(0); // clockwise
  });

  it("snaps the camber position to NACA practice", () => {
    expect(snapCamberPosition(0)).toBe(0);
    expect(snapCamberPosition(0.3)).toBe(0);
    expect(snapCamberPosition(0.7)).toBe(1);
    expect(snapCamberPosition(4.2)).toBe(4.2);
    expect(snapCamberPosition(NaN)).toBe(0);
  });

  it("writes Selig files without negative zeros", () => {
    const dat = toSelig(PRESETS[1].design, "NACA 2412").split("\n");
    expect(dat[0]).toBe("NACA 2412");
    expect(dat.length).toBe(203); // name + 201 points + empty string after the trailing newline
    expect(dat.join("\n")).not.toMatch(/-0\.000000/);
  });

  it("flags inputs outside or near the edge of the training envelope", () => {
    const st = (d: Design) => Object.fromEntries(envelopeChecks(d).map((c) => [c.key, c.status]));
    expect(st(DEFAULT_DESIGN).aoa).toBe("pass");
    expect(st({ ...DEFAULT_DESIGN, aoa: 14.9 }).aoa).toBe("warn");
    expect(st({ ...DEFAULT_DESIGN, aoa: 18 }).aoa).toBe("fail");
  });
});
