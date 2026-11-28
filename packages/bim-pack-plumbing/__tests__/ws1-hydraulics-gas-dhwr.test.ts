/**
 * @jest-environment node
 *
 * WS-1 comprehensive tests (permitzip/mutinybim#205):
 *   1. Generic water-heater / equipment coupling (modeled parts + non-"water heater" couplers, no double-count with load_point)
 *   2. Multi-story static head & gravity outfall elevation (`runHeightMm`) + root-relative `water.elevation_psi` / `water.friction_psi`
 *   3. Built-in starter gas appliance MBH resolution (`partConnectionTypeLoad`)
 *   4. Gas `branch_length` (IFGC 402.4.2) & high-pressure (>= 1.5 psi / 2 psi, IFGC Eq. 4-2) drop
 *   5. DHWR recirculation solver & loop sizing (`domestic_hot_water_return`, heat loss/ΔT + explicit GPM, pump curve & buffer tank)
 *   6. Hydrant/service flow-test N^1.85 curve, inline device ΔP & EnergyPlus #190 Table:Lookup curves, main vs. branch Hunter notes
 *   7. Live gas sizing calc sheet: built-in IFGC fallback, `branch_length`, multi-segment / multi-zone summary
 *   8. Built-in IPC 912.3 wet-vent fallback & configurable per-size cleanout spacing (50 ft <= 3", 100 ft >= 4", overridable)
 */
import {
  DEFAULT_SETTINGS,
  planCommit,
  resolveConnectors,
  type Command,
  type ElementId,
  type ModelState,
  type PartInstance,
  type PartTypeDefinition,
  type RunSegment,
  type RunSize,
} from "@permitzip/bim-kernel";
import { placeCalcSheet, type CalcTable, type CalcTableSource } from "@permitzip/bim-kernel/calc-sheets";
import { builtinCalcRegistry } from "@permitzip/bim-calc";
import {
  builtinIfgcGasTable,
  cleanoutSpacingForSizeFt,
  evaluateGasSizingSheet,
  evaluatePerformanceCurve,
  evaluatePumpCurve,
  flowTestSupplyPsi,
  gasInputOf,
  gasNetwork,
  gasSizingSpec,
  gasZoneSizingSummary,
  GAS_SIZING_TABLE_SLOT,
  GAS_SIZING_TEMPLATE_ID,
  IPC_912_3_WET_VENT_TABLE,
  pipeLoadWalk,
  pipeSystemReportOf,
  PLUMBING_SERVICE_ROWS,
  PLUMBING_SERVICE_SOLVERS,
  PLUMBING_SETTINGS_NAME,
  PLUMBING_STARTER_CONNECTION_TYPES,
  plumbingStarterTypes,
  proposeCleanouts,
  resolveWaterField,
  serviceSolverOf,
  WATER_PRESSURE_LOSS_TEMPLATE_ID,
  wetVentCheck,
  type GasSystemSizing,
  type PipeSystemSizing,
} from "../src";

const registry = builtinCalcRegistry();
function runSizeSystem(model: ModelState, systemId: string): PipeSystemSizing {
  const r = registry.run({ calc: "plumbing.size_system", inputs: { system_id: systemId }, model, state: "VA" });
  if (!r.ok) throw new Error(r.reason);
  return r.run.detail as PipeSystemSizing;
}
function runSizeGas(model: ModelState, systemId: string): GasSystemSizing {
  const r = registry.run({ calc: "plumbing.gas_system", inputs: { system_id: systemId }, model, state: "VA" });
  if (!r.ok) throw new Error(r.reason);
  return r.run.detail as GasSystemSizing;
}
function loadWalkOf(model: ModelState, systemId: string) {
  const sys = model.elements[systemId];
  if (sys?.kind !== "mep_system") throw new Error(`no system ${systemId}`);
  const seg = Object.values(model.elements).find((e): e is RunSegment => e.kind === "run_segment" && e.systemId === systemId);
  if (!seg) throw new Error(`no segment on ${systemId}`);
  return pipeLoadWalk(model.elements, sys, seg.id, sys.design?.pipe ?? {}, []);
}

const FT = 304.8;
const IN = 25.4;
const NOW = () => "2026-11-27T12:00:00.000Z";
const BUILTIN = { kind: "builtin", libraryVersion: "ws1-test" } as const;
const BOX = {
  geometry: [{ kind: "box" as const, center: [0, 0, 150] as [number, number, number], size: [300, 300, 300] as [number, number, number] }],
  symbol: [{ kind: "rect" as const, center: [0, 0] as [number, number], size: [300, 300] as [number, number] }],
};

function emptyModel(id = "ws1"): ModelState {
  return { modelId: id, revision: 0 as ModelState["revision"], elements: {}, connections: [], settings: DEFAULT_SETTINGS };
}

function apply(m: ModelState, cmds: readonly Command[]): ModelState {
  let cur = m;
  for (const command of cmds) {
    const d = planCommit(
      cur,
      [],
      { idempotencyKey: `ws1-${cur.modelId}-${cur.revision}-${command.type}`, baseRevision: cur.revision, actor: { id: "eng", name: "Engineer", kind: "human" }, command },
      NOW,
      [],
    );
    if (!d.ok) throw new Error(`${command.type}: ${d.error.message}`);
    cur = d.model;
  }
  return cur;
}

const COPPER_3_4: RunSize = { shape: "pipe", nominalMm: 0.75 * IN, material: "copper", spec: "type_l" };
const COPPER_1_2: RunSize = { shape: "pipe", nominalMm: 0.5 * IN, material: "copper", spec: "type_l" };
const COPPER_1: RunSize = { shape: "pipe", nominalMm: 1 * IN, material: "copper", spec: "type_l" };
const STEEL_1: RunSize = { shape: "pipe", nominalMm: 1 * IN, material: "black_steel", spec: "sch40" };
const STEEL_3_4: RunSize = { shape: "pipe", nominalMm: 0.75 * IN, material: "black_steel", spec: "sch40" };

const WATER_SOURCE: PartTypeDefinition = {
  familyName: "Water service entry",
  typeName: "Street main",
  category: "mechanical_equipment",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  connectors: [{ id: "cw_out", label: "CW", domain: "pipe", systemKind: "domestic_cold_water", position: [0, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" }],
  ...BOX,
  tagFields: ["mark"],
  source: BUILTIN,
};

const GENERIC_HEAT_EXCHANGER: PartTypeDefinition = {
  familyName: "Plate heat exchanger",
  typeName: "Indirect domestic",
  category: "mechanical_equipment",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  connectors: [
    { id: "cold_in", label: "Cold in", domain: "pipe", systemKind: "domestic_cold_water", position: [-150, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
    { id: "hot_out", label: "Hot out", domain: "pipe", systemKind: "domestic_hot_water", position: [150, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
  ],
  ...BOX,
  tagFields: ["mark"],
  source: BUILTIN,
};

const MODELED_FIXTURE: PartTypeDefinition = {
  familyName: "Commercial sink",
  typeName: "2-comp",
  category: "plumbing_fixture",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  connectors: [
    { id: "cw", label: "CW", domain: "pipe", systemKind: "domestic_cold_water", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 0.5 * IN, flowDirection: "in", flow: 1.5 },
    { id: "hw", label: "HW", domain: "pipe", systemKind: "domestic_hot_water", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 0.5 * IN, flowDirection: "in", flow: 2.5 },
  ],
  ...BOX,
  tagFields: ["mark"],
  source: BUILTIN,
};

const GAS_METER: PartTypeDefinition = {
  familyName: "Gas meter",
  typeName: "Utility",
  category: "mechanical_equipment",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  connectors: [{ id: "g", label: "Gas", domain: "pipe", systemKind: "natural_gas", position: [0, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" }],
  ...BOX,
  tagFields: ["mark"],
  source: BUILTIN,
};

const LINE_REGULATOR: PartTypeDefinition = {
  familyName: "Gas line regulator",
  typeName: "2 psi to 7 in wc",
  category: "pipe_accessory",
  typeParams: [
    { name: "role", label: "Role", kind: "text" },
    { name: "outlet_in_wc", label: "Outlet", kind: "number", unit: "none" },
    { name: "zone_drop_in_wc", label: "Drop", kind: "number", unit: "none" },
    { name: "vent", label: "Vent", kind: "text" },
  ],
  typeValues: { role: "line", outlet_in_wc: 7, zone_drop_in_wc: 0.5, vent: "vent_limiter" },
  instanceParams: [],
  connectors: [
    { id: "in", label: "In", domain: "pipe", systemKind: "natural_gas", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
    { id: "out", label: "Out", domain: "pipe", systemKind: "natural_gas", position: [100, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
  ],
  ...BOX,
  tagFields: ["mark"],
  source: BUILTIN,
};

// ================================================================== 1. Generic water-heater / equipment coupling
describe("WS-1.1: Generic water-heater / equipment load coupling", () => {
  it("carries modeled part hot-water WSFU across a non-'water heater' plate heat exchanger onto cold water", () => {
    const m = apply(emptyModel("ws1-couple"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "src", typeId: "t:src", partType: WATER_SOURCE, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 1000, mark: "WS-1" },
      { type: "place_part", partId: "hx", typeId: "t:hx", partType: GENERIC_HEAT_EXCHANGER, levelId: "L1", position: { x: 10 * FT, y: 0 }, offsetMm: 1000, mark: "HX-1" },
      { type: "place_part", partId: "sk1", typeId: "t:sk", partType: MODELED_FIXTURE, levelId: "L1", position: { x: 20 * FT, y: 0 }, offsetMm: 1000, mark: "SK-1" },
      { type: "place_part", partId: "sk2", typeId: "t:sk", partType: MODELED_FIXTURE, levelId: "L1", position: { x: 20 * FT, y: 5 * FT }, offsetMm: 1000, mark: "SK-2" },
      {
        type: "route_run",
        idPrefix: "cw",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: 1000,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [],
        from: { kind: "part", partId: "src", connectorId: "cw_out" },
        to: { kind: "part", partId: "hx", connectorId: "cold_in" },
      },
      {
        type: "route_run",
        idPrefix: "hw1",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_3_4,
        elevationMm: 1000,
        system: { id: "sys-hw", kind: "domestic_hot_water", name: "HW" },
        points: [],
        from: { kind: "part", partId: "hx", connectorId: "hot_out" },
        to: { kind: "part", partId: "sk1", connectorId: "hw" },
      },
      {
        type: "route_run",
        idPrefix: "hw2",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_3_4,
        elevationMm: 1000,
        system: { id: "sys-hw", kind: "domestic_hot_water", name: "HW" },
        points: [{ x: 15 * FT, y: 0 }, { x: 15 * FT, y: 5 * FT }],
        from: { kind: "run_branch", segmentId: "hw1-s1" as ElementId },
        to: { kind: "part", partId: "sk2", connectorId: "hw" },
      },
    ]);

    const cwWalk = loadWalkOf(m, "sys-cw");
    // Two modeled sinks × 2.5 WSFU hot each = 5 WSFU carried across HX-1 onto the CW header.
    expect(cwWalk.load.get(cwWalk.root)).toBeCloseTo(5, 3);
    const cwSeg = Object.values(m.elements).find((e): e is RunSegment => e.kind === "run_segment" && e.systemId === "sys-cw");
    expect(cwSeg).toBeDefined();
    expect(cwWalk.load.get(cwSeg!.id)).toBeCloseTo(5, 3);
  });

  it("does not double-count a modeled part when a load_point is attached to it", () => {
    const m = apply(emptyModel("ws1-nodbl"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "src", typeId: "t:src", partType: WATER_SOURCE, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 1000, mark: "WS-1" },
      { type: "place_part", partId: "hx", typeId: "t:hx", partType: GENERIC_HEAT_EXCHANGER, levelId: "L1", position: { x: 10 * FT, y: 0 }, offsetMm: 1000, mark: "HX-1" },
      { type: "place_part", partId: "sk1", typeId: "t:sk", partType: MODELED_FIXTURE, levelId: "L1", position: { x: 20 * FT, y: 0 }, offsetMm: 1000, mark: "SK-1" },
      {
        type: "route_run",
        idPrefix: "cw",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: 1000,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [],
        from: { kind: "part", partId: "src", connectorId: "cw_out" },
        to: { kind: "part", partId: "hx", connectorId: "cold_in" },
      },
      {
        type: "route_run",
        idPrefix: "hw1",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_3_4,
        elevationMm: 1000,
        system: { id: "sys-hw", kind: "domestic_hot_water", name: "HW" },
        points: [],
        from: { kind: "part", partId: "hx", connectorId: "hot_out" },
        to: { kind: "part", partId: "sk1", connectorId: "hw" },
      },
      {
        type: "route_run",
        idPrefix: "hwstub",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1_2,
        elevationMm: 1000,
        system: { id: "sys-hw", kind: "domestic_hot_water", name: "HW" },
        points: [{ x: 15 * FT, y: 0 }, { x: 15 * FT, y: 2 * FT }],
        from: { kind: "run_branch", segmentId: "hw1-s1" as ElementId },
      },
      {
        type: "create_load_point",
        points: [{ hostId: "hwstub-s1", port: "end", values: { wsfu_hot: 3 }, mark: "LP-SK1" }],
      },
    ]);
    const lpId = Object.values(m.elements).find((e) => e.kind === "load_point")!.id;
    const mAttached = apply(m, [{ type: "attach_part_to_load_point", loadPointId: lpId, partId: "sk1" }]);

    const cwWalk = loadWalkOf(mAttached, "sys-cw");
    // Only the attached load_point's 3 WSFU should carry (not 3 + 2.5 = 5.5).
    expect(cwWalk.load.get(cwWalk.root)).toBeCloseTo(3, 3);
  });
});

// ================================================================== 2. Multi-story static head & gravity outfall elevation
describe("WS-1.2: Multi-story static head, root-relative water fields & outfall elevation", () => {
  it("uses level elevation (runHeightMm) for upper-floor static head and computes root-relative water.elevation_psi & water.friction_psi", () => {
    const m0 = apply(emptyModel("ws1-story"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "create_level", levelId: "L2", name: "Level 2", elevationMm: 12 * FT },
      // Buried street service at -4 ft on L1
      { type: "place_part", partId: "src", typeId: "t:src", partType: WATER_SOURCE, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: -4 * FT, mark: "MTR" },
      // Horizontal + vertical riser on L1 up to absolute +14 ft (1 ft below L2's +15 ft horizontal run for the 90° elbow)
      {
        type: "route_run",
        idPrefix: "r1",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: -4 * FT,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [{ x: 10 * FT, y: 0, elevationMm: -4 * FT }, { x: 10 * FT, y: 0, elevationMm: 14 * FT }],
        from: { kind: "part", partId: "src", connectorId: "cw_out" },
      },
    ]);
    const riserTopSeg = Object.values(m0.elements).find((e): e is RunSegment => e.kind === "run_segment" && !e.links.end)!;
    const m1 = apply(m0, [
      // L2 horizontal pipe with level-local elevationMm = 3 ft (absolute = 12 + 3 = 15 ft)
      {
        type: "route_run",
        idPrefix: "r2",
        levelId: "L2",
        domain: "pipe",
        size: COPPER_3_4,
        elevationMm: 3 * FT,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [{ x: 10 * FT, y: 0 }, { x: 30 * FT, y: 0 }],
        from: { kind: "run_end", elementId: riserTopSeg.id, port: "end" },
      },
    ]);
    const l2OpenSeg = Object.values(m1.elements).find((e): e is RunSegment => e.kind === "run_segment" && e.id.startsWith("r2") && !e.links.end)!;
    const m = apply(m1, [
      { type: "create_load_point", points: [{ hostId: l2OpenSeg.id, port: "end", values: { wsfu_cold: 10 }, mark: "F-L2" }] },
      { type: "set_system_design", systemId: "sys-cw", design: { pipe: { supplyPressurePsi: 60, fixedLossesPsi: 5, minFixturePressurePsi: 15 } } },
    ]);

    const report = pipeSystemReportOf(m.elements, "sys-cw");
    expect(report?.kind).toBe("water");
    if (report?.kind !== "water") return;
    // Root is at -4 ft, L2 fixture is at 12 + 3 = 15 ft -> Δz = 19 ft -> static head = 19 * 0.433 = 8.227 psi
    expect(report.rootElevationFt).toBeCloseTo(-4, 1);
    expect(report.critical?.elevationFt).toBeCloseTo(15, 1);

    const elevField = resolveWaterField(m.elements, "sys-cw", "water.elevation_psi");
    const fricField = resolveWaterField(m.elements, "sys-cw", "water.friction_psi");
    const resField = resolveWaterField(m.elements, "sys-cw", "water.residual_psi");
    expect(elevField?.value).toBeCloseTo(19 * 0.433, 1);
    expect(fricField?.value as number).toBeGreaterThan(0);
    // Energy balance: supply (60) - fixed (5) - elevation - friction === residual
    expect(60 - 5 - (elevField?.value as number) - (fricField?.value as number)).toBeCloseTo(resField?.value as number, 1);
  });

  it("computes negative static head (pressure gain) when source sits on an upper penthouse floor", () => {
    const m = apply(emptyModel("ws1-penthouse"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "create_level", levelId: "PH", name: "Penthouse", elevationMm: 30 * FT },
      { type: "place_part", partId: "src", typeId: "t:src", partType: WATER_SOURCE, levelId: "PH", position: { x: 0, y: 0 }, offsetMm: 0, mark: "TANK" },
      // Leave straight out +X from TANK's cw_out, then drop 27 ft down, then run east
      {
        type: "route_run",
        idPrefix: "dn",
        levelId: "PH",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: 0,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [
          { x: 5 * FT, y: 0, elevationMm: 0 },
          { x: 5 * FT, y: 0, elevationMm: -27 * FT },
          { x: 25 * FT, y: 0, elevationMm: -27 * FT },
        ],
        from: { kind: "part", partId: "src", connectorId: "cw_out" },
      },
      { type: "create_load_point", points: [{ hostId: "dn-s3", port: "end", values: { wsfu_cold: 8 }, mark: "F-L1" }] },
      { type: "set_system_design", systemId: "sys-cw", design: { pipe: { supplyPressurePsi: 30, fixedLossesPsi: 0, minFixturePressurePsi: 15 } } },
    ]);

    const elevField = resolveWaterField(m.elements, "sys-cw", "water.elevation_psi");
    const fricField = resolveWaterField(m.elements, "sys-cw", "water.friction_psi");
    const resField = resolveWaterField(m.elements, "sys-cw", "water.residual_psi");
    // Drop of 27 ft -> elevation_psi ≈ -11.69 psi (pressure gain)
    expect(elevField?.value as number).toBeCloseTo(-27 * 0.433, 1);
    expect(fricField?.value as number).toBeGreaterThan(0);
    expect(resField?.value as number).toBeGreaterThan(35);
  });

  it("picks the true lowest gravity outfall across multiple levels using absolute elevation", () => {
    const drainSize: RunSize = { shape: "pipe", nominalMm: 4 * IN, material: "pvc", spec: "sch40" };
    // Draw from L2 (+12.5 ft abs, local +0.5 ft) down the stack to L1 (+2 ft abs) and horizontally out to open outfall on L1
    const m0 = apply(emptyModel("ws1-drain-elev"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "create_level", levelId: "L2", name: "Level 2", elevationMm: 12 * FT },
      {
        type: "route_run",
        idPrefix: "d2",
        levelId: "L2",
        domain: "pipe",
        size: drainSize,
        elevationMm: 0.5 * FT,
        system: { id: "sys-san", kind: "sanitary", name: "Sanitary" },
        points: [
          { x: -10 * FT, y: 0, elevationMm: 0.5 * FT },
          { x: 0, y: 0, elevationMm: 0.5 * FT },
          { x: 0, y: 0, elevationMm: -8 * FT }, // drops to absolute +4 ft (L2 12 ft - 8 ft)
        ],
      },
    ]);
    const stackBottom = Object.values(m0.elements).find((e): e is RunSegment => e.kind === "run_segment" && !e.links.end)!;
    const m1 = apply(m0, [
      // L1 horizontal drain at local z = +2 ft (absolute +2 ft, higher LOCAL z than L2's +0.5 ft, but MUCH lower absolute elevation!)
      {
        type: "route_run",
        idPrefix: "d1",
        levelId: "L1",
        domain: "pipe",
        size: drainSize,
        elevationMm: 2 * FT,
        system: { id: "sys-san", kind: "sanitary", name: "Sanitary" },
        points: [{ x: 0, y: 0 }, { x: 20 * FT, y: 0 }],
        from: { kind: "run_end", elementId: stackBottom.id, port: "end" },
      },
    ]);
    const l2Start = Object.values(m1.elements).find((e): e is RunSegment => e.kind === "run_segment" && e.id === "d2-s1")!;
    const l1Outfall = Object.values(m1.elements).find((e): e is RunSegment => e.kind === "run_segment" && e.id.startsWith("d1") && !e.links.end)!;
    const m = apply(m1, [
      { type: "create_load_point", points: [{ hostId: l2Start.id, port: "start", values: { dfu: 6 }, mark: "WC-L2" }] },
    ]);

    const walk = loadWalkOf(m, "sys-san");
    // Outfall must be on L1 (abs +2 ft), NOT d2-s1 (local +0.5 ft on L2 = abs +12.5 ft).
    expect(walk.root).toBe(l1Outfall.id);
    expect(walk.load.get(l1Outfall.id)).toBeCloseTo(6, 3);
  });
});

// ================================================================== 3. Built-in starter gas appliance MBH resolution
describe("WS-1.3: Built-in starter gas appliance MBH resolution", () => {
  it("resolves starter gas appliances (WH-T, WH-GT, G-RANGE, G-FRYER, G-GRILL) via partConnectionTypeLoad", () => {
    const starterEntries = plumbingStarterTypes("ws1-test");
    const wantedIds = [
      "builtin:plumbing-water-heater-tank@1",
      "builtin:plumbing-water-heater-gas-tankless@1",
      "builtin:plumbing-gas-range@1",
      "builtin:plumbing-gas-fryer@1",
      "builtin:plumbing-gas-grill@1",
    ];
    const partsById = new Map(starterEntries.map((p) => [p.id, p]));
    const connCatalogCmds: Command[] = PLUMBING_STARTER_CONNECTION_TYPES.map((ct) => ({
      type: "save_catalog_entry",
      entry: ct,
    }));
    let m = apply(emptyModel("ws1-gas-starters"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      ...connCatalogCmds,
      { type: "place_part", partId: "gm", typeId: "t:gm", partType: GAS_METER, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 1000, mark: "GM-1" },
      {
        type: "route_run",
        idPrefix: "gmain",
        levelId: "L1",
        domain: "pipe",
        size: STEEL_1,
        elevationMm: 1000,
        system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
        points: [{ x: 40 * FT, y: 0 }],
        from: { kind: "part", partId: "gm", connectorId: "g" },
      },
      { type: "set_system_design", systemId: "sys-gas", design: { pipe: { gasType: "natural", inletPressureInWc: 7, allowableDropInWc: 0.5 } } },
    ]);

    let expectedTotal = 0;
    wantedIds.forEach((tid, idx) => {
      const def = partsById.get(tid);
      expect(def).toBeDefined();
      const resolvedConns = resolveConnectors(def!.definition, {});
      const gasConn = resolvedConns.find((c) => c.systemKind === "natural_gas");
      expect(gasConn).toBeDefined();
      const pid = `app-${idx}`;
      const xPos = (idx + 1) * 6 * FT;
      const [cx, cy, cz] = gasConn!.position;
      const [dx, dy, dz] = gasConn!.direction;
      const isVertical = Math.abs(dz) > 0.5;
      // Rotate horizontal connectors to point -Y (south toward the gas main at y=0).
      // For vertical connectors (e.g. downward-facing tankless WH bottom spud), elevate above the 1000mm main so the branch rises into it.
      const rotDeg = isVertical ? 0 : -90 - (Math.atan2(dy, dx) * 180) / Math.PI;
      const rad = (rotDeg * Math.PI) / 180;
      const rotX = cx * Math.cos(rad) - cy * Math.sin(rad);
      const branchX = xPos + rotX;
      const offsetMm = dz < -0.5 ? 1000 - cz + 350 : dz > 0.5 ? 1000 - cz - 350 : 1000 - cz;
      m = apply(m, [
        { type: "place_part", partId: pid, typeId: tid, partType: def!.definition, levelId: "L1", position: { x: xPos, y: 8 * FT }, offsetMm, rotationDeg: rotDeg, mark: `GA-${idx + 1}` },
        {
          type: "route_run",
          idPrefix: `gb${idx}`,
          levelId: "L1",
          domain: "pipe",
          size: STEEL_3_4,
          elevationMm: 1000,
          system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
          points: [{ x: branchX, y: 0 }, { x: branchX, y: 4 * FT }],
          from: { kind: "run_branch", segmentId: "gmain-s1" as ElementId },
          to: { kind: "part", partId: pid, connectorId: gasConn!.id },
        },
      ]);
      const pEl = m.elements[pid];
      expect(pEl?.kind).toBe("part");
      if (pEl?.kind === "part") {
        const res = gasInputOf(m.elements, pEl, gasConn!.id, {});
        expect(res.found).toBe(true);
        expect(res.mbh).toBeGreaterThan(0);
        expectedTotal += res.mbh;
      }
    });

    const net = gasNetwork(m, "sys-gas");
    expect(net).not.toBeNull();
    expect(net!.appliances).toHaveLength(5);
    expect(net!.totalMbh).toBeCloseTo(expectedTotal, 2);
    expect(net!.totalMbh).toBeGreaterThan(300);

    const sized = runSizeGas(m, "sys-gas");
    expect(sized.totalMbh).toBeCloseTo(expectedTotal, 2);
    expect(sized.equipment.length).toBeGreaterThanOrEqual(5);
    expect(sized.connections).toHaveLength(5);
    for (const c of sized.connections) expect(c.inputMbh).toBeGreaterThan(0);
  });
});

// ================================================================== 4. Gas branch_length & high-pressure (>= 1.5 psi / 2 psi) drop
describe("WS-1.4: Gas branch_length & high-pressure (>= 1.5 psi) drop equations", () => {
  function branchedGas(designPipe: Record<string, unknown>): ModelState {
    // Trunk 40 ft -> tee at 20 ft (or 40 ft) splits to short branch (10 ft, 100 MBH) and long branch (160 ft, 100 MBH)
    return apply(emptyModel("ws1-gas-bl"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "gm", typeId: "t:gm", partType: GAS_METER, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 1000, mark: "GM-1" },
      {
        type: "route_run",
        idPrefix: "main",
        levelId: "L1",
        domain: "pipe",
        size: STEEL_1,
        elevationMm: 1000,
        system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
        points: [{ x: 200 * FT, y: 0 }],
        from: { kind: "part", partId: "gm", connectorId: "g" },
      },
      // Branch off at x = 40 ft going north 10 ft
      {
        type: "route_run",
        idPrefix: "shortb",
        levelId: "L1",
        domain: "pipe",
        size: STEEL_3_4,
        elevationMm: 1000,
        system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
        points: [{ x: 40 * FT, y: 0 }, { x: 40 * FT, y: 10 * FT }],
        from: { kind: "run_branch", segmentId: "main-s1" as ElementId },
      },
      {
        type: "create_load_point",
        points: [
          { hostId: "shortb-s1", port: "end", values: { mbh: 100 }, mark: "A-SHORT" },
          { hostId: "main-s1", port: "end", values: { mbh: 100 }, mark: "A-LONG" },
        ],
      },
      { type: "set_system_design", systemId: "sys-gas", design: { pipe: designPipe } },
    ]);
  }

  it("uses developed branch length from source to farthest branch outlet in branch_length mode", () => {
    const mLongest = branchedGas({ gasType: "natural", inletPressureInWc: 7, allowableDropInWc: 0.5, gasSizing: "longest_run" });
    const mBranch = branchedGas({ gasType: "natural", inletPressureInWc: 7, allowableDropInWc: 0.5, gasSizing: "branch_length" });

    const repLongest = pipeSystemReportOf(mLongest.elements, "sys-gas");
    const repBranch = pipeSystemReportOf(mBranch.elements, "sys-gas");
    expect(repLongest?.kind).toBe("gas");
    expect(repBranch?.kind).toBe("gas");
    if (repLongest?.kind !== "gas" || repBranch?.kind !== "gas") return;

    const shortLongest = repLongest.segments.find((s) => s.elementId === "shortb-s1");
    const shortBranch = repBranch.segments.find((s) => s.elementId === "shortb-s1");
    expect(shortLongest && shortBranch).toBeTruthy();

    // Short branch has 50 ft developed length (40 + 10) vs 200 ft zone longest -> branch_length drop is ~1/4 of longest_length drop
    // and ~5x larger than single-segment 10 ft drop!
    expect(shortBranch!.designDropInWc).toBeLessThan(shortLongest!.designDropInWc * 0.4);
    expect(shortBranch!.designDropInWc).toBeGreaterThan(shortBranch!.dropInWc * 3);
  });

  it("uses IFGC 402.4 Eq. 4-2 high-pressure drop equation for 2 psi (>= 1.5 psi) zones", () => {
    const mLow = branchedGas({ gasType: "natural", inletPressureInWc: 7, allowableDropInWc: 0.5 });
    const mHigh = branchedGas({ gasType: "natural", inletPressureInWc: 55.36, allowableDropInWc: 27.68 }); // 2 psi inlet, 1 psi drop

    const repLow = pipeSystemReportOf(mLow.elements, "sys-gas");
    const repHigh = pipeSystemReportOf(mHigh.elements, "sys-gas");
    expect(repLow?.kind).toBe("gas");
    expect(repHigh?.kind).toBe("gas");
    if (repLow?.kind !== "gas" || repHigh?.kind !== "gas") return;

    expect(repLow.equation).not.toBe("ifgc_high_pressure");
    expect(repHigh.equation).toBe("ifgc_high_pressure");
    // At 2 psi, pressure drop for the same flow on 1" pipe is smaller than low-pressure Spitzglass
    const lowMain = repLow.segments.find((s) => s.elementId === "main-s1")!;
    const highMain = repHigh.segments.find((s) => s.elementId === "main-s1")!;
    expect(highMain.designDropInWc).toBeGreaterThan(0);
    expect(highMain.designDropInWc).toBeLessThan(lowMain.designDropInWc);
  });
});

// ================================================================== 5. DHWR recirculation solver & loop sizing
describe("WS-1.5: DHWR recirculation solver & loop sizing", () => {
  const RECIRC_PUMP = (headAt5GpmFt: number): PartTypeDefinition => ({
    familyName: "DHWR Recirculation Pump",
    typeName: "Inline Bronze",
    category: "mechanical_equipment",
    typeParams: [
      { name: "external_pump", label: "External", kind: "boolean" },
      { name: "rated_gpm", label: "Rated GPM", kind: "number", unit: "none" },
      { name: "rated_head_ft", label: "Rated Head", kind: "number", unit: "none" },
      { name: "pump_curve", label: "Pump Curve", kind: "text" },
    ],
    typeValues: {
      external_pump: true,
      rated_gpm: 5,
      rated_head_ft: headAt5GpmFt,
      pump_curve: JSON.stringify({
        kind: "table_lookup",
        independentVar: "flow_gpm",
        dependentVar: "head_ft",
        interpolation: "linear",
        points: [
          { x: 0, y: headAt5GpmFt + 2 },
          { x: 5, y: headAt5GpmFt },
          { x: 10, y: Math.max(0.5, headAt5GpmFt - 3) },
        ],
      }),
    },
    instanceParams: [],
    connectors: [
      { id: "in", label: "In", domain: "pipe", systemKind: "domestic_hot_water_return", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "in" },
      { id: "out", label: "Out", domain: "pipe", systemKind: "domestic_hot_water_return", position: [100, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "out" },
    ],
    ...BOX,
    tagFields: ["mark"],
    source: BUILTIN,
  });

  const BUFFER_TANK: PartTypeDefinition = {
    familyName: "Domestic Hot Water Buffer Tank",
    typeName: "120 Gal",
    category: "mechanical_equipment",
    typeParams: [
      { name: "volume_gal", label: "Volume (gal)", kind: "number", unit: "none" },
      { name: "standby_loss_btuh", label: "Standby Loss (Btu/h)", kind: "number", unit: "none" },
    ],
    typeValues: { volume_gal: 120, standby_loss_btuh: 2500 },
    instanceParams: [],
    connectors: [
      { id: "ret_in", label: "Return In", domain: "pipe", systemKind: "domestic_hot_water_return", position: [-150, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "in" },
    ],
    ...BOX,
    tagFields: ["mark"],
    source: BUILTIN,
  };

  function buildDhwr(pumpHeadFt: number, dhwrDesign: Record<string, unknown>): ModelState {
    return apply(emptyModel("ws1-dhwr"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "p1", typeId: "t:rpump", partType: RECIRC_PUMP(pumpHeadFt), levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 1000, mark: "RP-1" },
      { type: "place_part", partId: "bt1", typeId: "t:btank", partType: BUFFER_TANK, levelId: "L1", position: { x: 200 * FT, y: 0 }, offsetMm: 1000, mark: "BT-1" },
      {
        type: "route_run",
        idPrefix: "dhwr",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1_2, // Intentionally undersized 1/2" for 4.5 gpm at 3 ft/s
        elevationMm: 1000,
        system: { id: "sys-dhwr", kind: "domestic_hot_water_return", name: "DHWR" },
        points: [],
        from: { kind: "part", partId: "p1", connectorId: "out" },
        to: { kind: "part", partId: "bt1", connectorId: "ret_in" },
      },
      { type: "set_system_design", systemId: "sys-dhwr", design: { pipe: { waterTempF: 140 } } },
      { type: "save_catalog_entry", entry: { type: "plumbing_settings", name: PLUMBING_SETTINGS_NAME, sizingMode: "check", dhwrBySystem: { "sys-dhwr": dhwrDesign } } },
    ]);
  }

  it("registers solver 'dhwr_loop' on domestic_hot_water_return service", () => {
    const row = PLUMBING_SERVICE_ROWS.find((r) => r.id === "domestic_hot_water_return");
    expect(row).toBeDefined();
    expect(PLUMBING_SERVICE_SOLVERS.domestic_hot_water_return).toBe("dhwr_loop");
    expect(serviceSolverOf("domestic_hot_water_return")).toBe("dhwr_loop");
  });

  it("solves heat-loss / ΔT flow with buffer tank standby loss, sizes at <= 3 ft/s, and verifies pump duty", () => {
    // ~199 ft piping at 100 Btu/h·ft + 2,500 Btu/h buffer tank ≈ 22,400 Btu/h / (500 * 10°F) ≈ 4.48 gpm
    // At 3/4" copper (~19.2 ft head over 260 eq ft), a 25 ft head pump meets duty.
    const m = buildDhwr(25, { heatLossBtuhPerFt: 100, deltaTF: 10, maxVelocityFps: 3 });

    const rep = pipeSystemReportOf(m.elements, "sys-dhwr");
    expect(rep?.kind).toBe("water");
    if (rep?.kind !== "water") return;
    expect(rep.dhwr).toBeDefined();
    expect(rep.dhwr!.flowBasis).toBe("heat_loss_delta_t");
    expect(rep.dhwr!.totalHeatLossBtuh).toBeGreaterThan(22000);
    expect(rep.dhwr!.designFlowGpm).toBeCloseTo(4.48, 1);
    expect(rep.dhwr!.bufferTank?.volumeGal).toBe(120);
    expect(rep.dhwr!.bufferTank?.standbyLossBtuh).toBe(2500);
    expect(rep.dhwr!.pump?.external).toBe(true);
    expect(rep.dhwr!.pump?.hasCurve).toBe(true);

    const sizing = runSizeSystem(m, "sys-dhwr");
    expect(sizing.service).toBe("dhwr");
    expect(sizing.dhwr?.designFlowGpm).toBeCloseTo(4.48, 1);
    expect(sizing.dhwr?.pump?.meetsDuty).toBe(true);
    const prop = sizing.proposals[0];
    expect(prop).toBeDefined();
    expect(prop!.role).toBe("dhwr_return");
    expect(prop!.proposedIn).toBeGreaterThanOrEqual(0.75);
    expect(prop!.velocityFps!).toBeLessThanOrEqual(3 + 1e-6);
  });

  it("supports explicit GPM and flags pump_undersized when pump curve falls below loop head", () => {
    const m = buildDhwr(0.5, { designFlowGpm: 5, maxVelocityFps: 3 });
    const sizing = runSizeSystem(m, "sys-dhwr");
    expect(sizing.dhwr?.flowBasis).toBe("explicit_gpm");
    expect(sizing.dhwr?.designFlowGpm).toBe(5);
    expect(sizing.dhwr?.pump?.meetsDuty).toBe(false);
    expect(sizing.findings.some((f) => f.code === "pump_undersized")).toBe(true);
  });
});

// ================================================================== 6. Flow-test curve, inline device ΔP / pump curves (#190) & demand notes
describe("WS-1.6: Flow-test curve, inline device ΔP, EnergyPlus #190 curves & Hunter demand notes", () => {
  it("evaluates NFPA 291 / Hazen-Williams N^1.85 flow-test curve with elevation adjustment", () => {
    // 70 psi static, 50 psi residual @ 500 gpm; at 250 gpm -> 70 - 20 * (0.5)^1.85 = 64.45 psi; gauge at -5 ft vs root at +5 ft -> -10 * 0.433 = -4.33 psi
    const res = flowTestSupplyPsi({ staticPsi: 70, residualPsi: 50, testGpm: 500, elevationFt: -5 }, 250, 5);
    const expectedDrop = 20 * Math.pow(0.5, 1.85);
    expect(res.frictionDropAtDesignPsi).toBeCloseTo(expectedDrop, 2);
    expect(res.elevationAdjustPsi).toBeCloseTo(-4.33, 2);
    expect(res.availableAtDesignPsi).toBeCloseTo(70 - expectedDrop - 4.33, 2);
    expect(res.extrapolated).toBe(false);

    // Also works through plumbing.pressure_report code calc
    const calc = registry.run({
      calc: "plumbing.pressure_report",
      inputs: {
        supply: { kind: "flow_test", static_psi: 70, residual_psi: 50, test_gpm: 500, elevation_ft: -5, service_elevation_ft: 5 },
        highest_fixture_height_ft: 10,
        critical_fixture_psi: 15,
        design_gpm: 250,
      },
      state: "VA",
    });
    expect(calc.ok).toBe(true);
    if (!calc.ok) return;
    const supplyVal = calc.run.values.find((v) => v.key === "supply_psi")?.value;
    expect(supplyVal).toBeCloseTo(res.availableAtDesignPsi, 1);
  });

  it("evaluates EnergyPlus #190 Table:Lookup and quadratic pump curves accurately", () => {
    const lookup = evaluatePerformanceCurve(
      {
        kind: "table_lookup",
        independentVar: "flow_gpm",
        dependentVar: "head_ft",
        interpolation: "linear",
        points: [
          { x: 0, y: 18 },
          { x: 10, y: 16 },
          { x: 20, y: 12 },
          { x: 30, y: 6 },
        ],
      },
      15,
    );
    expect(lookup.value).toBeCloseTo(14, 4);
    expect(lookup.extrapolated).toBe(false);

    const poly = evaluatePerformanceCurve(
      { kind: "quadratic", independentVar: "flow_gpm", dependentVar: "head_ft", coefficients: [20, -0.1, -0.02] },
      10,
    );
    // 20 - 1 - 2 = 17 ft
    expect(poly.value).toBeCloseTo(17, 4);

    // Part-level pump curve evaluation using JSON EnergyPlus parallel-array Table:Lookup
    const pumpDef: PartTypeDefinition = {
      familyName: "Booster Pump",
      typeName: "Test",
      category: "mechanical_equipment",
      typeParams: [{ name: "pump_curve", label: "Pump Curve", kind: "text" }],
      typeValues: {
        pump_curve: JSON.stringify({ kind: "table_lookup", independent: [0, 10, 20], dependent: [20, 15, 5], interpolation: "linear" }),
      },
      instanceParams: [],
      connectors: [],
      ...BOX,
      tagFields: ["mark"],
      source: BUILTIN,
    };
    const m = apply(emptyModel("ws1-pump-ev"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "bp1", typeId: "t:bp", partType: pumpDef, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 0, mark: "BP-1" },
    ]);
    const ev = evaluatePumpCurve(m.elements, m.elements.bp1 as PartInstance, 15, 9);
    expect(ev.availableHeadAtDutyFt).toBeCloseTo(10, 2);
    expect(ev.meetsDuty).toBe(true);
  });

  it("applies inline device fixed ΔP (RPZ) and manufacturer curve (water meter), flow-test supply, and exposes main vs. branch Hunter notes", () => {
    const INLINE_RPZ: PartTypeDefinition = {
      familyName: "RPZ Backflow Preventer",
      typeName: "1 in",
      category: "pipe_accessory",
      typeParams: [{ name: "pressure_drop_psi", label: "Fixed ΔP (psi)", kind: "number", unit: "none" }],
      typeValues: { pressure_drop_psi: 10 },
      instanceParams: [],
      connectors: [
        { id: "in", label: "In", domain: "pipe", systemKind: "domestic_cold_water", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
        { id: "out", label: "Out", domain: "pipe", systemKind: "domestic_cold_water", position: [100, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
      ],
      ...BOX,
      tagFields: ["mark"],
      source: BUILTIN,
    };

    const INLINE_METER: PartTypeDefinition = {
      familyName: "Water Meter",
      typeName: "1 in",
      category: "pipe_accessory",
      typeParams: [{ name: "pressure_drop_curve", label: "ΔP Curve", kind: "text" }],
      typeValues: {
        pressure_drop_curve: JSON.stringify({
          kind: "table_lookup",
          independentVar: "flow_gpm",
          dependentVar: "pressure_drop_psi",
          interpolation: "linear",
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 2 },
            { x: 50, y: 6 },
            { x: 100, y: 15 },
          ],
        }),
      },
      instanceParams: [],
      connectors: [
        { id: "in", label: "In", domain: "pipe", systemKind: "domestic_cold_water", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
        { id: "out", label: "Out", domain: "pipe", systemKind: "domestic_cold_water", position: [100, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
      ],
      ...BOX,
      tagFields: ["mark"],
      source: BUILTIN,
    };

    const m = apply(emptyModel("ws1-dev-dp"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "src", typeId: "t:src", partType: WATER_SOURCE, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 0, mark: "MAIN" },
      { type: "place_part", partId: "mtr", typeId: "t:mtr", partType: INLINE_METER, levelId: "L1", position: { x: 5 * FT, y: 0 }, offsetMm: 0, mark: "WM-1" },
      { type: "place_part", partId: "rpz", typeId: "t:rpz", partType: INLINE_RPZ, levelId: "L1", position: { x: 10 * FT, y: 0 }, offsetMm: 0, mark: "RPZ-1" },
      {
        type: "route_run",
        idPrefix: "s1",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: 0,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [],
        from: { kind: "part", partId: "src", connectorId: "cw_out" },
        to: { kind: "part", partId: "mtr", connectorId: "in" },
      },
      {
        type: "route_run",
        idPrefix: "s2",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: 0,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [],
        from: { kind: "part", partId: "mtr", connectorId: "out" },
        to: { kind: "part", partId: "rpz", connectorId: "in" },
      },
      {
        type: "route_run",
        idPrefix: "s3",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1,
        elevationMm: 0,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [{ x: 40 * FT, y: 0 }],
        from: { kind: "part", partId: "rpz", connectorId: "out" },
      },
      {
        type: "route_run",
        idPrefix: "br",
        levelId: "L1",
        domain: "pipe",
        size: COPPER_1_2,
        elevationMm: 0,
        system: { id: "sys-cw", kind: "domestic_cold_water", name: "CW" },
        points: [{ x: 25 * FT, y: 0 }, { x: 25 * FT, y: 10 * FT }],
        from: { kind: "run_branch", segmentId: "s3-s1" as ElementId },
      },
      {
        type: "create_load_point",
        points: [
          { hostId: "s3-s1", port: "end", values: { wsfu_cold: 40 }, mark: "BLDG" },
          { hostId: "br-s1", port: "end", values: { wsfu_cold: 1 }, mark: "Lavatory" },
        ],
      },
      {
        type: "set_system_design",
        systemId: "sys-cw",
        design: {
          pipe: {
            minFixturePressurePsi: 15,
            demandCurve: "ashrae_a",
          },
        },
      },
      {
        type: "save_catalog_entry",
        entry: {
          type: "plumbing_settings",
          name: PLUMBING_SETTINGS_NAME,
          sizingMode: "check",
          flowTests: { "sys-cw": { staticPsi: 65, residualPsi: 45, testGpm: 300 } },
        },
      },
    ]);

    const rep = pipeSystemReportOf(m.elements, "sys-cw");
    expect(rep?.kind).toBe("water");
    if (rep?.kind !== "water") return;
    expect(rep.flowTest).toBeDefined();
    expect(rep.supplyPsi).toBeCloseTo(rep.flowTest!.availableAtDesignPsi, 2);
    expect(rep.deviceLosses.length).toBe(2);
    expect(rep.criticalDeviceLossPsi).toBeGreaterThan(10); // 10 psi RPZ + meter curve drop > 0

    const devField = resolveWaterField(m.elements, "sys-cw", "water.device_losses_psi");
    expect(devField?.value as number).toBeGreaterThan(10);

    const sizing = runSizeSystem(m, "sys-cw");
    expect(sizing.flowTest).toBeDefined();
    expect(sizing.demandNotes?.some((n) => /Main-level Hunter demand/i.test(n))).toBe(true);
    expect(sizing.demandNotes?.some((n) => /Branch-level fixture demand/i.test(n))).toBe(true);
    expect(sizing.proposals.some((p) => p.demandBasis === "hunter_main")).toBe(true);
    expect(sizing.proposals.some((p) => p.demandBasis === "fixture_sum_branch")).toBe(true);

    // Water pressure loss calc sheet includes Hunter main-vs-branch, flow-test, and inline device citations
    const placed = placeCalcSheet(m, WATER_PRESSURE_LOSS_TEMPLATE_ID, { subjectId: "sys-cw" as ElementId }, { tables: { table: () => null }, limits: {} });
    expect("refused" in placed).toBe(false);
    if (!("refused" in placed)) {
      const sections = placed.spec.citations.map((c) => c.section);
      expect(sections.some((s) => /Hunter WSFU/i.test(s))).toBe(true);
      expect(sections.some((s) => /flow test/i.test(s))).toBe(true);
      expect(sections.some((s) => /Inline device/i.test(s))).toBe(true);
    }
  });
});

// ================================================================== 7. Live Gas Sizing Calc Sheet upgrade
describe("WS-1.7: Live Gas Sizing Calc Sheet (IFGC fallback, branch_length, multi-zone summary)", () => {
  function twoZoneGas(method: "longest_length" | "branch_length"): ModelState {
    // Zone 1 (2 psi): meter -> 50 ft trunk -> line regulator (2 psi -> 7 in wc)
    // Zone 2 (7 in wc): reg -> 150 ft run, with short branch (10 ft, 100 MBH) teeing off at 30 ft (t = 0.2)
    return apply(emptyModel(`ws1-gsheet-${method}`), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      { type: "place_part", partId: "gm", typeId: "t:gm", partType: GAS_METER, levelId: "L1", position: { x: 0, y: 0 }, offsetMm: 1000, mark: "GM-1" },
      { type: "place_part", partId: "reg", typeId: "t:reg", partType: LINE_REGULATOR, levelId: "L1", position: { x: 50 * FT, y: 0 }, offsetMm: 1000, mark: "REG-1" },
      {
        type: "route_run",
        idPrefix: "hp",
        levelId: "L1",
        domain: "pipe",
        size: STEEL_3_4,
        elevationMm: 1000,
        system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
        points: [],
        from: { kind: "part", partId: "gm", connectorId: "g" },
        to: { kind: "part", partId: "reg", connectorId: "in" },
      },
      {
        type: "route_run",
        idPrefix: "lpmain",
        levelId: "L1",
        domain: "pipe",
        size: STEEL_1,
        elevationMm: 1000,
        system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
        points: [{ x: 200 * FT, y: 0 }],
        from: { kind: "part", partId: "reg", connectorId: "out" },
      },
      {
        type: "route_run",
        idPrefix: "lpshort",
        levelId: "L1",
        domain: "pipe",
        size: STEEL_3_4,
        elevationMm: 1000,
        system: { id: "sys-gas", kind: "natural_gas", name: "Gas" },
        points: [{ x: 80 * FT, y: 0 }, { x: 80 * FT, y: 10 * FT }],
        from: { kind: "run_branch", segmentId: "lpmain-s1" as ElementId },
      },
      {
        type: "create_load_point",
        points: [
          { hostId: "lpshort-s1", port: "end", values: { mbh: 100 }, mark: "LP-SHORT" },
          { hostId: "lpmain-s1", port: "end", values: { mbh: 200 }, mark: "LP-LONG" },
        ],
      },
      { type: "set_system_design", systemId: "sys-gas", design: { pipe: { gasType: "natural", inletPressureInWc: 55.36, allowableDropInWc: 27.68, gasSizing: method === "branch_length" ? "branch_length" : "longest_run" } } },
    ]);
  }

  it("evaluates out-of-the-box with built-in IFGC fallback when no firm table is uploaded, while deferring to firm tables", () => {
    const m = twoZoneGas("longest_length");
    const builtTable = builtinIfgcGasTable(m, "hp-s1" as ElementId);
    expect(builtTable).not.toBeNull();
    expect(builtTable!.citation?.section).toMatch(/IFGC 402\.4/);

    const evalFallback = evaluateGasSizingSheet(m, { subjectId: "hp-s1" as ElementId });
    expect("refused" in evalFallback).toBe(false);
    if ("refused" in evalFallback) return;
    expect(evalFallback.usedBuiltinTable).toBe(true);
    expect(evalFallback.evaluation.values.size).toBeGreaterThan(0);
    expect(evalFallback.evaluation.governing).toHaveLength(1);
    expect(evalFallback.meterNote).toContain("300 CFH");

    // Firm table still overrides the built-in fallback
    const custom: CalcTable = {
      id: "custom-firm",
      label: "Custom Firm Table",
      rowHeading: { label: "Length", unit: "ft" },
      columnHeading: { label: "Size", unit: "in" },
      rows: [200],
      columns: ["2"],
      values: [[9999]],
      citation: { section: "Firm custom" },
    };
    const customSrc: CalcTableSource = { table: (slot) => (slot === GAS_SIZING_TABLE_SLOT ? custom : null) };
    const evalFirm = evaluateGasSizingSheet(m, { subjectId: "hp-s1" as ElementId }, { tables: customSrc });
    expect("refused" in evalFirm).toBe(false);
    if ("refused" in evalFirm) return;
    expect(evalFirm.usedBuiltinTable).toBe(false);
    expect(evalFirm.evaluation.values.size).toBe(2);
  });

  it("switches input binding to gas.branch_length in branch_length mode and builds multi-zone summary", () => {
    const m = twoZoneGas("branch_length");
    const spec = gasSizingSpec(m, { subjectId: "lpshort-s1" as ElementId });
    expect("refused" in spec).toBe(false);
    if ("refused" in spec) return;
    const lenInput = spec.inputs.find((i) => i.key === "length");
    expect(lenInput?.bind).toEqual({ from: "field", subjectId: "lpshort-s1", path: "gas.branch_length" });

    // Multi-segment / multi-zone summary directly from the system id
    const summary = gasZoneSizingSummary(m, "sys-gas" as ElementId);
    expect("refused" in summary).toBe(false);
    if ("refused" in summary) return;
    expect(summary.method).toBe("branch_length");
    expect(summary.zones).toHaveLength(2);
    expect(summary.zones[0]!.highPressure).toBe(true);
    expect(summary.zones[1]!.highPressure).toBe(false);
    expect(summary.totalSegments).toBe(3);
    expect(summary.totalMbh).toBe(300);

    const shortRow = summary.zones[1]!.segments.find((s) => s.segmentId === "lpshort-s1");
    const longRow = summary.zones[1]!.segments.find((s) => s.segmentId === "lpmain-s1");
    expect(shortRow && longRow).toBeTruthy();
    // Short branch in zone 2 is ~30 + 10 = 40 ft; long branch is ~150 ft
    expect(shortRow!.sizingLengthFt).toBeLessThan(55);
    expect(longRow!.sizingLengthFt).toBeGreaterThan(140);
    expect(shortRow!.requiredSizeIn!).toBeLessThanOrEqual(longRow!.requiredSizeIn!);

    // Template also accepts system subject directly
    const sysSpec = gasSizingSpec(m, { subjectId: "sys-gas" as ElementId });
    expect("refused" in sysSpec).toBe(false);
    expect(GAS_SIZING_TEMPLATE_ID).toBe("gas_sizing");
  });
});

// ================================================================== 8. IPC 912.3 wet-vent fallback & per-size cleanout spacing
describe("WS-1.8: Built-in IPC 912.3 wet-vent fallback & configurable per-size cleanout spacing", () => {
  it("exposes IPC Table 912.3 (1.5\"=1, 2\"=4, 2.5\"=6, 3\"=12 DFU) as built-in wet-vent fallback", () => {
    expect(IPC_912_3_WET_VENT_TABLE.rows).toEqual([
      [1.5, 1],
      [2, 4],
      [2.5, 6],
      [3, 12],
    ]);
    const m = apply(emptyModel("ws1-wv"), [
      { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
      {
        type: "route_run",
        idPrefix: "wv",
        levelId: "L1",
        domain: "pipe",
        size: { shape: "pipe", nominalMm: 2 * IN, material: "pvc" },
        elevationMm: 2 * FT,
        system: { id: "sys-v", kind: "vent", name: "Vent" },
        points: [{ x: 0, y: 0 }, { x: 10 * FT, y: 0 }],
      },
      { type: "create_load", loads: [{ id: "ld-1", anchor: { kind: "run_end", hostId: "wv-s1", port: "end" }, values: { dfu: 5 }, mark: "B1" }] },
    ]);

    const finding = wetVentCheck(m, "wv-s1");
    expect(finding?.kind).toBe("too_small");
    if (finding?.kind === "too_small") {
      expect(finding.source).toBe("IPC Table 912.3");
      expect(finding.maxDfu).toBe(4);
      expect(finding.fix?.label).toBe('Make it 2.5"');
    }
  });

  it("proposes cleanouts every 50 ft on <= 3\" drains and every 100 ft on >= 4\" drains, with options & project overrides", () => {
    expect(cleanoutSpacingForSizeFt(2)).toBe(50);
    expect(cleanoutSpacingForSizeFt(3)).toBe(50);
    expect(cleanoutSpacingForSizeFt(4)).toBe(100);
    expect(cleanoutSpacingForSizeFt(6)).toBe(100);
    expect(cleanoutSpacingForSizeFt(3, { spacingFt: 75 })).toBe(75);
    expect(cleanoutSpacingForSizeFt(3, { spacingBySize: [{ maxNominalIn: 3, spacingFt: 40 }, { maxNominalIn: 100, spacingFt: 80 }] })).toBe(40);

    const buildDrain = (nominalIn: number, lengthFt: number) =>
      apply(emptyModel(`ws1-co-${nominalIn}`), [
        { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 },
        {
          type: "route_run",
          idPrefix: "dr",
          levelId: "L1",
          domain: "pipe",
          size: { shape: "pipe", nominalMm: nominalIn * IN, material: "pvc", spec: "sch40" },
          elevationMm: 2 * FT,
          system: { id: "sys-san", kind: "sanitary", name: "Sanitary" },
          points: [{ x: 0, y: 0 }, { x: lengthFt * FT, y: 0 }],
        },
      ]);

    // 80 ft 3" drain -> gets a 50 ft spacing cleanout
    const m3 = buildDrain(3, 80);
    const ans3 = proposeCleanouts(m3, { roomIds: ["dr-s1"] });
    expect("refused" in ans3).toBe(false);
    if (!("refused" in ans3)) {
      expect(ans3.ghosts.filter((g) => g.spot === "spacing")).toHaveLength(1);
    }

    // 80 ft 4" drain -> 100 ft spacing -> 0 spacing cleanouts
    const m4 = buildDrain(4, 80);
    const ans4 = proposeCleanouts(m4, { roomIds: ["dr-s1"] });
    expect("refused" in ans4).toBe(false);
    if (!("refused" in ans4)) {
      expect(ans4.ghosts.filter((g) => g.spot === "spacing")).toHaveLength(0);
    }

    // Project plumbing_settings override: 35 ft for <= 4" -> 80 ft 4" drain gets 2 spacing cleanouts (at 35 ft and 70 ft)
    const m4Custom = apply(m4, [
      {
        type: "save_catalog_entry",
        entry: {
          type: "plumbing_settings",
          name: PLUMBING_SETTINGS_NAME,
          sizingMode: "check",
          cleanoutSpacingBySize: [{ maxNominalIn: 4, spacingFt: 35 }, { maxNominalIn: 100, spacingFt: 100 }],
        },
      },
    ]);
    const ans4Custom = proposeCleanouts(m4Custom, { roomIds: ["dr-s1"] });
    expect("refused" in ans4Custom).toBe(false);
    if (!("refused" in ans4Custom)) {
      expect(ans4Custom.ghosts.filter((g) => g.spot === "spacing")).toHaveLength(2);
    }
  });
});
