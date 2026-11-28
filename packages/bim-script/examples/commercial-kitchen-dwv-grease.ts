/**
 * Commercial kitchen DWV — segregated sanitary, grease waste, indirect /
 * clear-water waste, cleanouts, named soil stack & under-slab view:
 *
 * Models a commercial restaurant kitchen and restroom core with IPC-compliant
 * drainage segregation:
 *  - Sanitary waste (`san-1`) serving restroom WCs and lavatories into a named
 *    4" vertical soil stack (`S-1` via `plumbing.manageStack`)
 *  - Dedicated grease waste (`gw-1`, `grease_waste`) serving the 3-compartment
 *    pot sink, floor sink, and mop sink through an inline 100 gpm grease
 *    interceptor (`builtin:plumbing-grease-interceptor@1`)
 *  - Dedicated indirect / clear-water waste (`cw-waste-1`) serving the
 *    ice-maker / prep floor drain kept separate from grease-laden piping per
 *    IPC 802.1
 *  - Automatic IPC 708 cleanout spacing (`plumbing.proposeCleanouts`) applied
 *    to both sanitary and grease mains
 *  - Under-slab plumbing plan (`viewBottom: ft(-4), viewDepth: ft(0)` — never
 *    negative `viewDepth`), live DWV riser diagram, and fixture schedule on P-101
 *
 * Run with `bim_run_script` or `npm run example -- commercial-kitchen-dwv-grease`.
 */
import { defineScript, units, building, equipment, routes, plumbing, documents } from "@permitzip/bim-script";

const { ft } = units;
const inch = units.in;

export default defineScript({
  kind: "layout",
  parameters: {},
  reads: {},
  run(ctx) {
    const L1 = building.level(ctx, { id: "L1", name: "Level 1", elevation: ft(0) });
    building.level(ctx, { id: "ROOF", name: "Roof", elevation: ft(14) });

    building.walls(ctx, {
      level: L1,
      height: ft(14),
      thickness: inch(8),
      points: [
        { x: ft(0), y: ft(0) },
        { x: ft(56), y: ft(0) },
        { x: ft(56), y: ft(30) },
        { x: ft(0), y: ft(30) },
      ],
      closed: true,
    });
    building.wall(ctx, {
      level: L1,
      height: ft(14),
      thickness: inch(6),
      from: { x: ft(22), y: ft(0) },
      to: { x: ft(22), y: ft(30) },
    });

    // Restroom fixtures (west zone) -> Sanitary waste (san-1).
    const wc1 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-wc-flush-tank@1", at: { x: ft(6), y: ft(4) }, mark: "WC-1" });
    const wc2 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-wc-flush-tank@1", at: { x: ft(12), y: ft(4) }, mark: "WC-2" });
    const lav1 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-lavatory@1", at: { x: ft(18), y: ft(4) }, mark: "L-1" });

    // Kitchen grease-bearing fixtures (east zone) -> Grease waste (gw-1).
    const sink3 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-sink-3@1", at: { x: ft(28), y: ft(5) }, mark: "SK-3" });
    const fsGrease = equipment.place(ctx, { level: L1, type: "builtin:plumbing-floor-sink@1", at: { x: ft(36), y: ft(5) }, mark: "FS-G1" });
    const mop = equipment.place(ctx, { level: L1, type: "builtin:plumbing-mop-sink@1", at: { x: ft(44), y: ft(5) }, mark: "MS-1" });

    // Clear-water / indirect waste fixture (north kitchen) -> kept separate from grease.
    const fsClear = equipment.place(ctx, { level: L1, type: "builtin:plumbing-floor-sink@1", at: { x: ft(34), y: ft(24) }, mark: "FS-CW1" });
    const fdClear = equipment.place(ctx, { level: L1, type: "builtin:plumbing-floor-drain@1", at: { x: ft(46), y: ft(24) }, mark: "FD-CW1" });

    // 1. Sanitary under-slab main along y=10 ft, sloping west toward the street at 1/8"/ft.
    const sanMain = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(4), "cast_iron"),
      system: { id: "san-1", kind: "sanitary", name: "Sanitary Waste" },
      height: ft(-2),
      slope: { rise: inch(0.125), per: ft(1) },
      flow: "with_points",
      points: [
        { x: ft(20), y: ft(10) },
        { x: ft(2), y: ft(10) },
      ],
    });
    routes.connectInto(ctx, {
      from: [
        { elementId: wc1.id, port: "w" },
        { elementId: wc2.id, port: "w" },
        { elementId: lav1.id, port: "w" },
      ],
      into: sanMain.segment(1),
    });

    // Named vertical soil & vent stack at the restroom chase (x=3, y=14).
    const soilStack = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(4), "cast_iron"),
      system: { id: "san-1", kind: "sanitary", name: "Sanitary Waste" },
      height: ft(-1.5),
      points: [
        { x: ft(3), y: ft(14), height: ft(-1.5) },
        { x: ft(3), y: ft(14), height: ft(15) },
      ],
    });
    plumbing.manageStack(ctx, {
      action: "name",
      pipeId: soilStack.segment(1),
      number: "S-1",
      name: "Restroom Soil Stack",
      systemCode: "SAN",
      serves: "Level 1 Restrooms",
    });

    // 2. Dedicated Grease Waste main along y=13 ft, sloping east out past the east
    // exterior wall (x=56) to an exterior 100 gpm grease interceptor centered at x=63 ft
    // (clear of the east wall footprint, with the pipe passing safely below slab at -2.5 ft).
    const greaseMain = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(4), "cast_iron"),
      system: { id: "gw-1", kind: "sanitary", name: "Grease Waste" },
      height: ft(-2.5),
      slope: { rise: inch(0.125), per: ft(1) },
      flow: "with_points",
      points: [
        { x: ft(26), y: ft(13) },
        { x: ft(68), y: ft(13) },
      ],
    });
    // Place inline grease interceptor FIRST near the downstream end of the grease
    // main (inline insertion splits the pipe; connecting fixtures afterward taps
    // the upstream segment cleanly without dragging connected fixtures).
    plumbing.placeAccessory(ctx, {
      segment: greaseMain.segment(1),
      fromEnd: ft(5),
      partTypeId: "builtin:plumbing-grease-interceptor@1",
      mark: "GI-1",
    });
    routes.connectInto(ctx, {
      from: [
        { elementId: sink3.id, port: "w" },
        { elementId: fsGrease.id, port: "w" },
        { elementId: mop.id, port: "w" },
      ],
      into: greaseMain.segment(1),
    });

    // 3. Dedicated Indirect / Clear-Water Waste along y=20 ft (completely separated
    // from grease waste, discharging downstream of the interceptor).
    const clearMain = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(3), "pvc"),
      system: { id: "iw-1", kind: "sanitary", name: "Indirect / Clear-Water Waste" },
      height: ft(-1.75),
      slope: { rise: inch(0.25), per: ft(1) },
      flow: "with_points",
      points: [
        { x: ft(48), y: ft(20) },
        { x: ft(26), y: ft(20) },
      ],
    });
    routes.connectInto(ctx, {
      from: [
        { elementId: fsClear.id, port: "w" },
        { elementId: fdClear.id, port: "w" },
      ],
      into: clearMain.segment(1),
    });

    // Configure drainage slopes & apply IPC 708 cleanout spacing + drain sizing.
    plumbing.setSystemDesign(ctx, "san-1", {
      slopes: [
        { maxNominalIn: 2.5, inPerFt: 0.25 },
        { maxNominalIn: 12, inPerFt: 0.125 },
      ],
    });
    plumbing.setSystemDesign(ctx, "gw-1", {
      slopes: [
        { maxNominalIn: 2.5, inPerFt: 0.25 },
        { maxNominalIn: 12, inPerFt: 0.125 },
      ],
    });

    const sanCleanouts = plumbing.proposeCleanouts(ctx, { system: "san-1", spacing: ft(50), apply: true });
    const greaseCleanouts = plumbing.proposeCleanouts(ctx, { system: "gw-1", spacing: ft(50), apply: true });
    const sanSized = plumbing.sizeSystem(ctx, { system: "san-1", apply: true, plumbingEdition: "2021" });
    const greaseSized = plumbing.sizeSystem(ctx, { system: "gw-1", apply: true, plumbingEdition: "2021" });

    // Under-slab DWV plan: viewBottom is signed negative (-4 ft); viewDepth is ALWAYS >= 0!
    const underSlabPlan = documents.planView(ctx, {
      level: L1,
      name: "Level 1 - Under-Slab DWV & Grease Plan",
      discipline: "plumbing",
      scale: 48,
      cutHeight: ft(2),
      viewTop: ft(2),
      viewBottom: ft(-4),
      viewDepth: ft(0),
      browserGroup: "Plumbing",
      sortOrder: 101,
      detailLevel: "medium",
    });
    const dwvRiser = documents.diagram(ctx, {
      name: "Commercial Kitchen DWV & Grease Riser",
      kind: "plumbing_riser",
    });
    const fixtureSchedule = documents.schedule(ctx, {
      name: "DWV Fixture & Interceptor Schedule",
      category: "plumbing_fixture",
      columns: ["mark", "type_name", "level"],
    });

    const sheet = documents.sheet(ctx, {
      number: "P-101",
      name: "Under-Slab DWV, Grease & Indirect Waste",
      discipline: "plumbing",
      sortOrder: 101,
    });
    documents.place(ctx, sheet, underSlabPlan, { x: units.mm(230), y: units.mm(420) });
    documents.place(ctx, sheet, dwvRiser, { x: units.mm(640), y: units.mm(420) }, 1);
    documents.place(ctx, sheet, fixtureSchedule, { x: units.mm(230), y: units.mm(150) });

    ctx.report("Commercial kitchen DWV & grease", {
      sanCleanoutsPlaced: sanCleanouts.placedIds.length,
      greaseCleanoutsPlaced: greaseCleanouts.placedIds.length,
      sanSizedUpdates: sanSized.appliedCount,
      greaseSizedUpdates: greaseSized.appliedCount,
    });
    ctx.label("Commercial kitchen DWV + grease + indirect waste modeled and documented on sheet P-101");
  },
});
