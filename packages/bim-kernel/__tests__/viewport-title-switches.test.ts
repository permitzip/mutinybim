/**
 * @jest-environment node
 *
 * A sheet viewport prints its view name and its scale unless those switches
 * are off. The detail number stays. An older peer that does not advertise
 * `documents:viewport_title_switches` still accepts a title move.
 */
import {
  DEFAULT_SETTINGS,
  VIEWPORT_TITLE_SWITCHES_FEATURE,
  buildSheetSceneFor,
  executeCommand,
  toDocumentRecord,
  withUpgradePolicy,
  type Command,
  type ModelState,
  type Revision,
} from "../src";

function run(cmds: readonly Command[], allow: (feature: string) => boolean): ModelState {
  return withUpgradePolicy(allow, () => {
    let m: ModelState = { modelId: "vp-title-switches", revision: 0 as Revision, elements: {}, connections: [], settings: DEFAULT_SETTINGS };
    for (const cmd of cmds) {
      const r = executeCommand(m, cmd);
      if (!r.ok) throw new Error(`${cmd.type} failed: ${r.error.message}`);
      m = { ...r.model, revision: (m.revision + 1) as Revision };
    }
    return m;
  });
}

const placed: Command[] = [
  { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
  { type: "create_view", viewId: "v-1", name: "Level 1 Plan", viewType: "floor_plan", props: { level: "Level 1", scale: 48 } },
  { type: "create_sheet", sheetId: "sh-1", number: "A-101", name: "Floor Plan" },
  { type: "place_viewport", viewportId: "vp-1", sheetId: "sh-1", viewId: "v-1", center: { x: 300, y: 250 } },
];

function sheetTexts(model: ModelState): string[] {
  return buildSheetSceneFor(model, "sh-1", { projectName: "P" }).primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));
}

describe("viewport name and scale switches", () => {
  const base = run(placed, () => true);

  it("prints the view name and the scale until a switch turns one off", () => {
    const open = sheetTexts(base);
    expect(open.some((t) => t.includes("LEVEL 1 PLAN"))).toBe(true);
    expect(open.some((t) => t.startsWith("SCALE:"))).toBe(true);

    const nameOff = run([...placed, { type: "set_viewport_title", viewportId: "vp-1", showName: false }], () => true);
    const hiddenName = sheetTexts(nameOff);
    expect(hiddenName.some((t) => t.includes("LEVEL 1 PLAN"))).toBe(false);
    expect(hiddenName.some((t) => t.startsWith("SCALE:"))).toBe(true);
    expect(hiddenName).toContain("1");

    const scaleOff = run([...placed, { type: "set_viewport_title", viewportId: "vp-1", showScale: false }], () => true);
    const hiddenScale = sheetTexts(scaleOff);
    expect(hiddenScale.some((t) => t.includes("LEVEL 1 PLAN"))).toBe(true);
    expect(hiddenScale.some((t) => t.startsWith("SCALE:"))).toBe(false);

    const bothOff = run([...placed, { type: "set_viewport_title", viewportId: "vp-1", showName: false, showScale: false }], () => true);
    const vp = bothOff.elements["vp-1"];
    if (vp?.kind !== "viewport") throw new Error("expected viewport");
    expect(vp.showName).toBe(false);
    expect(vp.showScale).toBe(false);
    expect(toDocumentRecord(vp)).toMatchObject({ showName: false, showScale: false });
    const hidden = sheetTexts(bothOff);
    expect(hidden.some((t) => t.includes("LEVEL 1 PLAN"))).toBe(false);
    expect(hidden.some((t) => t.startsWith("SCALE:"))).toBe(false);
    expect(hidden).toContain("1");
  });

  it("refuses the switches on an older peer and still moves the title", () => {
    const refused = withUpgradePolicy(
      () => false,
      () => executeCommand(base, { type: "set_viewport_title", viewportId: "vp-1", showName: false }),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toMatch(/name and scale switches/);

    const moved = withUpgradePolicy(
      (feature) => feature !== VIEWPORT_TITLE_SWITCHES_FEATURE,
      () => executeCommand(base, { type: "set_viewport_title", viewportId: "vp-1", titleOffsetMm: { x: 10, y: 4 } }),
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const vp = moved.model.elements["vp-1"];
    if (vp?.kind !== "viewport") throw new Error("expected viewport");
    expect(vp.titleOffsetMm).toEqual({ x: 10, y: 4 });
    expect(vp.showName).toBeUndefined();
  });
});
