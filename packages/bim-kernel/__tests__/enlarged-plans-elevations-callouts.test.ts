/**
 * @jest-environment node
 *
 * Revit-style enlarged plans, elevations, and unified live view-reference
 * markers (callouts, section marks, elevation marks) in the kernel.
 */
import {
  DEFAULT_SETTINGS,
  buildViewScene,
  calloutHead,
  enlargedPlanCommands,
  executeCommand,
  planReferenceViews,
  sheetDependsOn,
  type Command,
  type ModelState,
  type Revision,
  type ViewElement,
} from "../src";

const FT = 304.8;

function baseModel(): ModelState {
  let m: ModelState = { modelId: "views-unified", revision: 0 as Revision, elements: {}, connections: [], settings: DEFAULT_SETTINGS };
  const steps: Command[] = [
    { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
    { type: "create_level", levelId: "L2", name: "Level 2", elevationMm: 12 * FT },
    {
      type: "create_view",
      viewId: "v-overall",
      name: "Level 1 - Overall Plumbing",
      viewType: "floor_plan",
      crop: { min: { x: 0, y: 0 }, max: { x: 60 * FT, y: 40 * FT } },
      props: { level: "Level 1", scale: 96, discipline: "plumbing" },
    },
    { type: "create_sheet", sheetId: "s-p101", number: "P-101", name: "Overall Plumbing Plan" },
    { type: "place_viewport", viewportId: "vp-overall", sheetId: "s-p101", viewId: "v-overall", center: { x: 400, y: 300 }, scale: 96 },
  ];
  for (const cmd of steps) {
    const r = executeCommand(m, cmd);
    if (!r.ok) throw new Error(r.error.message);
    m = r.model;
  }
  return m;
}

function apply(m: ModelState, cmd: Command): ModelState {
  const r = executeCommand(m, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.model;
}

describe("enlarged plans (Revit-style callout creates cropped view + live bubble)", () => {
  it("creates a cropped enlarged plan inheriting parent level/discipline and places a live callout in one batch", () => {
    let m = baseModel();
    const steps = enlargedPlanCommands(m, {
      parentViewId: "v-overall",
      viewId: "v-restroom",
      calloutId: "co-restroom",
      name: "Enlarged Restroom Plan",
      box: { min: { x: 10 * FT, y: 10 * FT }, max: { x: 24 * FT, y: 20 * FT } },
    });
    expect(Array.isArray(steps)).toBe(true);
    if (typeof steps === "string") throw new Error(steps);

    m = apply(m, { type: "batch_documents", label: "Create enlarged restroom plan", commands: steps });

    const enlarged = m.elements["v-restroom"] as ViewElement;
    expect(enlarged.kind).toBe("view");
    expect(enlarged.viewType).toBe("floor_plan");
    expect(enlarged.props?.level).toBe("Level 1");
    expect(enlarged.props?.discipline).toBe("plumbing");
    // Parent was 1/8" (96) -> enlarged defaults to 1/4" (48)
    expect(enlarged.props?.scale).toBe(48);
    expect(enlarged.cropMin).toEqual({ x: Math.round(10 * FT * 1000) / 1000, y: Math.round(10 * FT * 1000) / 1000 });
    expect(enlarged.cropMax).toEqual({ x: Math.round(24 * FT * 1000) / 1000, y: Math.round(20 * FT * 1000) / 1000 });

    // Before placement on a sheet: head shows unresolved "—"
    expect(calloutHead(m, { viewId: "v-restroom" })).toMatchObject({ top: "?", bottom: "—", resolved: false });

    // Place on P-401 -> head updates automatically to 1 / P-401
    m = apply(m, { type: "create_sheet", sheetId: "s-p401", number: "P-401", name: "Enlarged Plumbing Plans" });
    m = apply(m, { type: "place_viewport", viewportId: "vp-restroom", sheetId: "s-p401", viewId: "v-restroom", center: { x: 300, y: 250 }, scale: 48 });
    expect(calloutHead(m, { viewId: "v-restroom" })).toMatchObject({ top: "1", bottom: "P-401", resolved: true });

    const scene = buildViewScene(m, "v-overall").scene;
    expect(scene.primitives.some((p) => p.kind === "text" && p.text === "P-401")).toBe(true);
    expect(scene.primitives.some((p) => p.kind === "text" && p.text === "ENLARGED RESTROOM PLAN")).toBe(true);

    // Move viewport to P-402 -> callout bubble updates live and P-101 sheetDependsOn tracks it
    m = apply(m, { type: "create_sheet", sheetId: "s-p402", number: "P-402", name: "Enlarged Plans 2" });
    const depends = sheetDependsOn(m, "s-p101");
    expect(depends("vp-restroom", m.elements["vp-restroom"])).toBe(true);
    m = apply(m, { type: "remove_viewport", viewportId: "vp-restroom" });
    m = apply(m, { type: "place_viewport", viewportId: "vp-restroom-2", sheetId: "s-p402", viewId: "v-restroom", center: { x: 300, y: 250 }, scale: 48 });
    expect(calloutHead(m, { viewId: "v-restroom" })).toMatchObject({ top: "1", bottom: "P-402", resolved: true });
    expect(buildViewScene(m, "v-overall").scene.primitives.some((p) => p.kind === "text" && p.text === "P-402")).toBe(true);
  });
});

describe("sections and elevations share vertical projection and print live sheet-referenced marks on plans", () => {
  it("renders elevations with level datums, supports far clip crop, and prints live section & elevation bubbles on overlapping plans", () => {
    let m = baseModel();
    m = apply(m, {
      type: "create_view",
      viewId: "v-sec-a",
      name: "Section A-A",
      viewType: "section",
      props: {
        level: "Level 1",
        scale: 48,
        section: { start: { x: 5 * FT, y: 20 * FT }, end: { x: 50 * FT, y: 20 * FT }, direction: 1, depthMm: 15 * FT },
      },
    });
    m = apply(m, {
      type: "create_view",
      viewId: "v-elev-n",
      name: "Restroom North Elevation",
      viewType: "elevation",
      props: {
        level: "Level 1",
        scale: 24,
        section: { start: { x: 12 * FT, y: 12 * FT }, end: { x: 22 * FT, y: 12 * FT }, direction: 1, depthMm: 8 * FT },
      },
    });

    // Elevation supports far clip adjustment just like a section
    m = apply(m, { type: "set_view_crop", viewId: "v-elev-n", farClipMm: 10 * FT });
    expect((m.elements["v-elev-n"] as ViewElement).props?.section?.depthMm).toBe(Math.round(10 * FT * 1000) / 1000);

    // Elevation draws level datum lines (reusing unified vertical orthographic projection)
    const elevScene = buildViewScene(m, "v-elev-n").scene;
    expect(elevScene.primitives.some((p) => p.kind === "text" && p.text.includes("LEVEL 1"))).toBe(true);
    expect(elevScene.primitives.some((p) => p.kind === "text" && p.text.includes("LEVEL 2"))).toBe(true);

    // Overall plan picks up both section and elevation reference marks
    const refs = planReferenceViews(m, m.elements["v-overall"] as ViewElement);
    expect(refs.map((v) => v.id).sort()).toEqual(["v-elev-n", "v-sec-a"]);

    // Place section on A-301 and elevation on A-401 -> overall plan prints live "A-301" and "A-401" bubbles
    m = apply(m, { type: "create_sheet", sheetId: "s-a301", number: "A-301", name: "Building Sections" });
    m = apply(m, { type: "place_viewport", viewportId: "vp-sec-a", sheetId: "s-a301", viewId: "v-sec-a", center: { x: 400, y: 300 }, scale: 48 });
    m = apply(m, { type: "create_sheet", sheetId: "s-a401", number: "A-401", name: "Interior Elevations" });
    m = apply(m, { type: "place_viewport", viewportId: "vp-elev-n", sheetId: "s-a401", viewId: "v-elev-n", center: { x: 400, y: 300 }, scale: 24 });

    const planScene = buildViewScene(m, "v-overall").scene;
    expect(planScene.primitives.some((p) => p.kind === "text" && p.text === "A-301")).toBe(true);
    expect(planScene.primitives.some((p) => p.kind === "text" && p.text === "A-401")).toBe(true);

    // Sheet dependency invalidation tracks both section and elevation viewports
    const depends = sheetDependsOn(m, "s-p101");
    expect(depends("vp-sec-a", m.elements["vp-sec-a"])).toBe(true);
    expect(depends("vp-elev-n", m.elements["vp-elev-n"])).toBe(true);
  });
});
