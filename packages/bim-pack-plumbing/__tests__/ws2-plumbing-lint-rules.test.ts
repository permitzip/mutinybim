/**
 * @jest-environment node
 *
 * WS-2 (#206): Grease-waste on modeled parts, clear-water separation,
 * IPC/ASPE Backflow Protection Taxonomy, and real-world plumbing code lint rules.
 */
import { builtinPartType, withUpgradePolicy, type Command, type ModelState, type ParamDef, type PartTypeDefinition } from "@permitzip/bim-kernel";
import { activeLintRules, DEFAULT_LINT_CONFIG, LintEngine, type Finding, type LinkedModelIndex, type RuleDef } from "@permitzip/bim-lint";
import {
  BACKFLOW_LEVELS,
  BACKFLOW_RANK,
  backflowRules,
  backflowSatisfies,
  parseBackflowKind,
  plumbingRules,
} from "../src";
import { DrainageBuilding, FT } from "../../bim-kernel/__tests__/drainage-fixtures";
import { buildSampleMarketGas } from "../../bim-kernel/__tests__/fixtures/sample-market-gas";
import { starter } from "./p15-fixtures";

class Ws2Building extends DrainageBuilding {
  override ok(command: Command): ModelState {
    return withUpgradePolicy(() => true, () => super.ok(command));
  }
}

const IN = 25.4;
const PVC = (inches: number) => ({ shape: "pipe" as const, nominalMm: inches * IN, material: "pvc" as const });
const COPPER = (inches: number) => ({ shape: "pipe" as const, nominalMm: inches * IN, material: "copper" as const });
const BLACK_STEEL = (inches: number) => ({ shape: "pipe" as const, nominalMm: inches * IN, material: "black_steel" as const });
const ROUND_DUCT = (inches: number) => ({ shape: "round" as const, diameter: inches * IN });

const DCW = { id: "sys-dcw", kind: "domestic_cold_water" as const, name: "Domestic Cold Water" };
const SAN = { id: "sys-san", kind: "sanitary" as const, name: "Sanitary" };
const GW = { id: "sys-gw", kind: "grease_waste" as const, name: "Grease Waste" };
const COND = { id: "sys-cond", kind: "condensate" as const, name: "Condensate" };
const GAS = { id: "sys-gas", kind: "natural_gas" as const, name: "Natural Gas" };
const EXH = { id: "sys-exh", kind: "exhaust_air" as const, name: "Flue Exhaust" };
const OA = { id: "sys-oa", kind: "outside_air" as const, name: "Combustion Air" };

const textParam = (name: string, label: string): ParamDef => ({ name, label, kind: "text" });
const boolParam = (name: string, label: string): ParamDef => ({ name, label, kind: "boolean" });
const numParam = (name: string, label: string): ParamDef => ({ name, label, kind: "number", unit: "none" });

function runRules(model: ModelState, rules: readonly RuleDef[] = [...plumbingRules, ...backflowRules], linked: readonly LinkedModelIndex[] = []): Finding[] {
  const e = new LintEngine(rules);
  e.build(model, linked);
  return e.check({ config: { ...DEFAULT_LINT_CONFIG, ruleset: "issue" } });
}

function makeBackflowDevice(slug: string, familyName: string, kind: "air_gap" | "avb" | "pvb" | "dcva" | "rpz"): PartTypeDefinition {
  return {
    familyName,
    typeName: '2"',
    category: "pipe_accessory",
    typeParams: [textParam("backflow_kind", "Backflow kind")],
    typeValues: { backflow_kind: kind },
    instanceParams: [],
    tagFields: ["mark"],
    connectors: [
      { id: "in", label: "Inlet", domain: "pipe", systemKind: "domestic_cold_water", position: [-250, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 2 * IN, flowDirection: "in" },
      { id: "out", label: "Outlet", domain: "pipe", systemKind: "domestic_cold_water", position: [250, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 2 * IN, flowDirection: "out" },
    ],
    geometry: [{ kind: "box", center: [0, 0, 0], size: [500, 150, 150] }],
    symbol: [{ kind: "rect", center: [0, 0], size: [500, 150] }],
    source: { kind: "builtin", libraryVersion: `test-${slug}` },
  };
}

const BOILER_HYDRONIC: PartTypeDefinition = {
  familyName: "Hydronic Boiler",
  typeName: "500 MBH",
  category: "mechanical_equipment",
  typeParams: [],
  typeValues: {},
  instanceParams: [textParam("backflow_required", "Backflow required"), textParam("vent_type", "Vent type")],
  tagFields: ["mark"],
  connectors: [
    { id: "cw", label: "Make-up water", domain: "pipe", systemKind: "domestic_cold_water", position: [-300, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
    { id: "hws", label: "Heating supply", domain: "pipe", systemKind: "hydronic_supply", position: [300, 0, 900], direction: [1, 0, 0], shape: "round", diameter: 2 * IN, flowDirection: "out" },
    { id: "hwr", label: "Heating return", domain: "pipe", systemKind: "hydronic_return", position: [300, 0, 300], direction: [1, 0, 0], shape: "round", diameter: 2 * IN, flowDirection: "in" },
    { id: "g", label: "Gas", domain: "pipe", systemKind: "natural_gas", position: [0, 300, 300], direction: [0, 1, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
  ],
  geometry: [{ kind: "box", center: [0, 0, 600], size: [600, 600, 1200] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [600, 600] }],
  source: { kind: "builtin", libraryVersion: "test" },
};

const IRRIGATION_MANIFOLD: PartTypeDefinition = {
  familyName: "Irrigation Manifold",
  typeName: "4-zone",
  category: "plumbing_fixture",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  tagFields: ["mark"],
  connectors: [
    { id: "cw", label: "Supply", domain: "pipe", systemKind: "domestic_cold_water", position: [-200, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
  ],
  geometry: [{ kind: "box", center: [0, 0, 300], size: [400, 200, 600] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [400, 200] }],
  source: { kind: "builtin", libraryVersion: "test" },
};

const CLEAR_WATER_GREASE_PORT_PART: PartTypeDefinition = {
  familyName: "Ice Maker Indirect Drain",
  typeName: "Clear water",
  category: "plumbing_fixture",
  typeParams: [boolParam("clear_water", "Clear water")],
  typeValues: { clear_water: true },
  instanceParams: [],
  tagFields: ["mark"],
  connectors: [
    { id: "w", label: "Drain", domain: "pipe", systemKind: "grease_waste", position: [0, 0, 0], direction: [0, 0, -1], shape: "round", diameter: 2 * IN, flowDirection: "out" },
  ],
  geometry: [{ kind: "box", center: [0, 0, 300], size: [400, 400, 600] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [400, 400] }],
  source: { kind: "builtin", libraryVersion: "test" },
};

const CONDENSING_WH: PartTypeDefinition = {
  familyName: "Condensing Gas Water Heater",
  typeName: "199 MBH",
  category: "plumbing_fixture",
  typeParams: [textParam("heater_kind", "Heater kind"), boolParam("condensing", "Condensing"), numParam("thermal_efficiency", "Efficiency")],
  typeValues: { heater_kind: "gas_tankless", condensing: true, thermal_efficiency: 0.96 },
  instanceParams: [boolParam("condensate_neutralizer", "Condensate neutralizer"), textParam("vent_type", "Vent type")],
  tagFields: ["mark"],
  connectors: [
    { id: "cw", label: "Cold water", domain: "pipe", systemKind: "domestic_cold_water", position: [-200, 0, 300], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
    { id: "hw", label: "Hot water", domain: "pipe", systemKind: "domestic_hot_water", position: [200, 0, 300], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
    { id: "g", label: "Gas", domain: "pipe", systemKind: "natural_gas", position: [0, 200, 300], direction: [0, 1, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "in" },
    { id: "cond", label: "Condensate", domain: "pipe", systemKind: "condensate", position: [0, -200, 100], direction: [0, -1, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "out" },
    { id: "flue", label: "Flue", domain: "duct", systemKind: "exhaust_air", position: [-100, 0, 1000], direction: [0, 0, 1], shape: "round", diameter: 4 * IN, flowDirection: "out" },
    { id: "ca", label: "Combustion air", domain: "duct", systemKind: "outside_air", position: [100, 0, 1000], direction: [0, 0, 1], shape: "round", diameter: 4 * IN, flowDirection: "in" },
  ],
  geometry: [{ kind: "box", center: [0, 0, 500], size: [500, 400, 1000] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [500, 400] }],
  source: { kind: "builtin", libraryVersion: "test" },
};

const NEUTRALIZER: PartTypeDefinition = {
  familyName: "Condensate Neutralizer",
  typeName: "Limestone cartridge",
  category: "pipe_accessory",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  tagFields: ["mark"],
  connectors: [
    { id: "in", label: "Inlet", domain: "pipe", systemKind: "condensate", position: [-150, 0, 100], direction: [-1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
    { id: "out", label: "Outlet", domain: "pipe", systemKind: "condensate", position: [150, 0, 100], direction: [1, 0, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
  ],
  geometry: [{ kind: "box", center: [0, 0, 100], size: [300, 150, 150] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [300, 150] }],
  source: { kind: "builtin", libraryVersion: "test" },
};

const RTU_WITH_OA: PartTypeDefinition = {
  familyName: "Rooftop Unit",
  typeName: "10 Ton",
  category: "mechanical_equipment",
  typeParams: [],
  typeValues: {},
  instanceParams: [],
  tagFields: ["mark"],
  connectors: [
    { id: "oa", label: "Outdoor air", domain: "duct", systemKind: "outside_air", position: [0, 0, 1000], direction: [1, 0, 0], shape: "rect", width: 24 * IN, height: 12 * IN, flowDirection: "in", intake: "hood" },
  ],
  geometry: [{ kind: "box", center: [0, 0, 750], size: [1200, 1200, 1500] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [1200, 1200] }],
  source: { kind: "builtin", libraryVersion: "test" },
};

describe("WS-2 Part 2: Grease-waste on modeled parts + clear-water separation", () => {
  it("evaluates modeled part fixtures for grease-authority-unknown, grease-fixture-not-routed, and grease-fixture-bypasses-interceptor, deduplicating attached load points", () => {
    const sk3 = starter("sink-3");
    const hs = starter("hand-sink");
    const wc = starter("wc-flush-tank");
    const df = starter("drinking-fountain");
    const gi = builtinPartType("builtin:plumbing-grease-interceptor@1");
    if (!gi) throw new Error("missing starter GI");

    // 1. Unknown sewer authority: modeled SK3 part triggers grease-authority-unknown.
    const unknown = new Ws2Building();
    unknown.ok({ type: "place_part", partId: "sk3-p", typeId: sk3.id, partType: sk3.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "SK3-1" });
    unknown.ok({ type: "place_part", partId: "wc-p", typeId: wc.id, partType: wc.definition, levelId: "lvl-1", position: { x: 10 * FT, y: 0 }, mark: "WC-1" });
    expect(runRules(unknown.head, plumbingRules).filter((f) => f.rule === "grease-authority-unknown").map((f) => f.elementIds[0])).toEqual(["sk3-p"]);

    // 2. Deduplication: attach a load_point to sk3-p -> still only ONE finding (on the load_point).
    unknown.ok({ type: "create_load", loads: [{ id: "lp-sk3", mark: "SK3-1", connectionType: "SK3", anchor: { kind: "part", partId: "sk3-p" }, values: { dfu: 4 } }] });
    expect(runRules(unknown.head, plumbingRules).filter((f) => f.rule === "grease-authority-unknown").map((f) => f.elementIds[0])).toEqual(["lp-sk3"]);

    // 3. HRSD: modeled SK3 and HS trigger grease-fixture-not-routed; WC (restroom) and DF (clear water) do not.
    const mh = starter("sanitary-manhole-existing");
    const hrsd = new Ws2Building();
    hrsd.ok({ type: "place_part", partId: "mh-1", typeId: mh.id, partType: mh.definition, levelId: "lvl-1", position: { x: 40 * FT, y: 0 }, offsetMm: -4 * FT, mark: "MH-1", values: { sewer_authority: "HRSD" } });
    hrsd.ok({ type: "place_part", partId: "gi-1", typeId: gi.id, partType: gi.definition, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, offsetMm: -4.5 * FT, mark: "GI-1" });
    hrsd.ok({ type: "place_part", partId: "sk3-p", typeId: sk3.id, partType: sk3.definition, levelId: "lvl-1", position: { x: 0, y: 3 * FT }, mark: "SK3-1" });
    hrsd.ok({ type: "place_part", partId: "hs-p", typeId: hs.id, partType: hs.definition, levelId: "lvl-1", position: { x: 0, y: 13 * FT }, mark: "HS-1" });
    hrsd.ok({ type: "place_part", partId: "wc-p", typeId: wc.id, partType: wc.definition, levelId: "lvl-1", position: { x: 0, y: 20 * FT }, mark: "WC-1" });
    hrsd.ok({ type: "place_part", partId: "df-p", typeId: df.id, partType: df.definition, levelId: "lvl-1", position: { x: 0, y: 30 * FT }, mark: "DF-1" });

    expect(runRules(hrsd.head, plumbingRules).filter((f) => f.rule === "grease-fixture-not-routed").map((f) => f.elementIds[0]).sort()).toEqual(["hs-p", "sk3-p"]);

    // 4. Pipe SK3 directly to GI inlet -> clears; pipe HS directly to MH-1 -> grease-fixture-bypasses-interceptor!
    // Route from GI-1 inlet and MH-1 inlet out to open branches, then connect SK3 / HS via connect_into (matching real gravity slope).
    hrsd.ok({
      type: "route_run",
      idPrefix: "gi-line",
      levelId: "lvl-1",
      domain: "pipe",
      size: PVC(4),
      system: SAN,
      from: { kind: "part", partId: "gi-1", connectorId: "in" },
      points: [{ x: -4 * FT, y: 0 }],
      flow: "against_points",
    });
    hrsd.ok({
      type: "route_run",
      idPrefix: "mh-line",
      levelId: "lvl-1",
      domain: "pipe",
      size: PVC(4),
      system: SAN,
      from: { kind: "part", partId: "mh-1", connectorId: "in" },
      points: [{ x: 30 * FT, y: 0 }, { x: 30 * FT, y: 10 * FT }, { x: -4 * FT, y: 10 * FT }],
      flow: "against_points",
    });
    hrsd.ok({ type: "connect_into", from: [{ elementId: "sk3-p", port: "w" }], into: "gi-line-s1", idPrefix: "csk3" });
    hrsd.ok({ type: "connect_into", from: [{ elementId: "hs-p", port: "w" }], into: "mh-line-s3", idPrefix: "chs" });
    const f = runRules(hrsd.head, plumbingRules);
    expect(f.filter((x) => x.rule === "grease-fixture-not-routed")).toEqual([]);
    expect(f.filter((x) => x.rule === "grease-fixture-bypasses-interceptor").map((x) => x.elementIds[0])).toEqual(["hs-p"]);
  });

  it("clear-water-in-grease-waste flags drinking fountains, ice makers, and condensate piped into grease_waste or GI inlet, and passes on sanitary", () => {
    const df = starter("drinking-fountain");
    const sk3 = starter("sink-3");
    const gi = builtinPartType("builtin:plumbing-grease-interceptor@1");
    if (!gi) throw new Error("missing starter GI");

    const b = new Ws2Building();
    b.ok({ type: "place_part", partId: "gi-1", typeId: gi.id, partType: gi.definition, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, offsetMm: -4.5 * FT, mark: "GI-1" });
    b.ok({ type: "place_part", partId: "df-bad", typeId: df.id, partType: df.definition, levelId: "lvl-1", position: { x: 0, y: 3 * FT }, mark: "DF-1" });
    b.ok({ type: "place_part", partId: "im-gw", typeId: "type-im-gw", partType: CLEAR_WATER_GREASE_PORT_PART, levelId: "lvl-1", position: { x: 0, y: -20 * FT }, mark: "IM-2" });
    b.ok({ type: "place_part", partId: "df-ok", typeId: df.id, partType: df.definition, levelId: "lvl-1", position: { x: 0, y: 18 * FT }, mark: "DF-2" });
    b.ok({ type: "place_part", partId: "sk3-ok", typeId: sk3.id, partType: sk3.definition, levelId: "lvl-1", position: { x: 8 * FT, y: 3 * FT }, mark: "SK3-1" });

    // Main line into GI-1 inlet: DF-1 piped upstream of GI (BAD); SK3 piped upstream of GI (GOOD for clear-water rule).
    b.ok({
      type: "route_run",
      idPrefix: "gi-m",
      levelId: "lvl-1",
      domain: "pipe",
      size: PVC(4),
      system: SAN,
      from: { kind: "part", partId: "gi-1", connectorId: "in" },
      points: [{ x: -4 * FT, y: 0 }],
      flow: "against_points",
    });
    b.ok({ type: "connect_into", from: [{ elementId: "df-bad", port: "w" }, { elementId: "sk3-ok", port: "w" }], into: "gi-m-s1", idPrefix: "cgim" });

    // IM-2 piped directly into a grease_waste system run (BAD).
    b.ok({
      type: "route_run",
      idPrefix: "gw-m",
      levelId: "lvl-1",
      domain: "pipe",
      size: PVC(4),
      elevationMm: -2 * FT,
      system: GW,
      points: [{ x: -4 * FT, y: -23 * FT }, { x: 12 * FT, y: -23 * FT }],
    });
    b.ok({ type: "connect_into", from: [{ elementId: "im-gw", port: "w" }], into: "gw-m-s1", idPrefix: "cim" });

    // DF-2 piped into sanitary NOT upstream of GI (GOOD).
    b.ok({
      type: "route_run",
      idPrefix: "san-df",
      levelId: "lvl-1",
      domain: "pipe",
      size: PVC(4),
      elevationMm: -2 * FT,
      system: SAN,
      points: [{ x: -4 * FT, y: 15 * FT }, { x: 10 * FT, y: 15 * FT }],
    });
    b.ok({ type: "connect_into", from: [{ elementId: "df-ok", port: "w" }], into: "san-df-s1", idPrefix: "cdfok" });

    // Ice maker load_point on grease_waste service (BAD).
    b.ok({
      type: "create_load",
      loads: [{ id: "im-bad", mark: "IM-1", connectionType: "IM", service: "grease_waste", note: "Ice maker drain", values: { dfu: 1 } }],
    });

    const hits = runRules(b.head, plumbingRules).filter((f) => f.rule === "clear-water-in-grease-waste");
    expect(hits).toHaveLength(3);
    for (const id of ["df-bad", "im-bad", "im-gw"]) {
      expect(hits.some((h) => h.elementIds.includes(id))).toBe(true);
    }
    expect(hits.every((h) => h.severity === "error")).toBe(true);
  });
});

describe("WS-2 Part 3: Cross-connection / Backflow Protection Taxonomy", () => {
  it("enforces full taxonomy ordering air_gap < avb < pvb < dcva < rpz", () => {
    expect(BACKFLOW_LEVELS).toEqual(["air_gap", "avb", "pvb", "dcva", "rpz"]);
    expect(BACKFLOW_RANK.air_gap).toBeLessThan(BACKFLOW_RANK.avb);
    expect(BACKFLOW_RANK.avb).toBeLessThan(BACKFLOW_RANK.pvb);
    expect(BACKFLOW_RANK.pvb).toBeLessThan(BACKFLOW_RANK.dcva);
    expect(BACKFLOW_RANK.dcva).toBeLessThan(BACKFLOW_RANK.rpz);

    expect(backflowSatisfies("rpz", "rpz")).toBe(true);
    expect(backflowSatisfies("rpz", "avb")).toBe(true);
    expect(backflowSatisfies("dcva", "rpz")).toBe(false);
    expect(backflowSatisfies("dcva", "pvb")).toBe(true);
    expect(backflowSatisfies("pvb", "dcva")).toBe(false);
    expect(backflowSatisfies("avb", "pvb")).toBe(false);
    expect(backflowSatisfies("air_gap", "avb")).toBe(false);
    expect(backflowSatisfies("air_gap", "air_gap")).toBe(true);

    expect(parseBackflowKind("reduced pressure zone")).toBe("rpz");
    expect(parseBackflowKind("double check")).toBe("dcva");
    expect(parseBackflowKind("PVB")).toBe("pvb");
    expect(parseBackflowKind("hose_bibb_vacuum_breaker")).toBe("avb");
    expect(parseBackflowKind("air gap")).toBe("air_gap");
  });

  it("flags boiler/hydronic make-up missing RPZ, flags DCVA as insufficient, and passes with upstream RPZ", () => {
    const mtr = starter("water-meter");
    const dcva = makeBackflowDevice("dcva", "Double check valve assembly", "dcva");
    const rpz = makeBackflowDevice("rpz", "Reduced pressure zone assembly", "rpz");

    // 1. Unprotected boiler fed from water meter -> backflow-protection-missing.
    const missing = new Ws2Building();
    missing.ok({ type: "place_part", partId: "mtr-1", typeId: mtr.id, partType: mtr.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "MTR-1" });
    missing.ok({ type: "place_part", partId: "b-1", typeId: "type-boiler", partType: BOILER_HYDRONIC, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, mark: "B-1" });
    missing.ok({
      type: "route_run",
      idPrefix: "cw",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(1),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "mtr-1", connectorId: "out" },
      to: { kind: "part", partId: "b-1", connectorId: "cw" },
      points: [{ x: 2 * FT, y: 0 }, { x: 18 * FT, y: 0 }],
    });
    const fMissing = runRules(missing.head, backflowRules);
    expect(fMissing.map((x) => `${x.rule} ${x.elementIds[0]}`)).toEqual(["backflow-protection-missing b-1"]);

    // 2. Boiler protected only by DCVA -> backflow-protection-insufficient (DCVA < RPZ).
    const insuf = new Ws2Building();
    insuf.ok({ type: "place_part", partId: "mtr-1", typeId: mtr.id, partType: mtr.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "MTR-1" });
    insuf.ok({ type: "place_part", partId: "dcva-1", typeId: "type-dcva", partType: dcva, levelId: "lvl-1", position: { x: 10 * FT, y: 0 }, mark: "DCVA-1" });
    insuf.ok({ type: "place_part", partId: "b-1", typeId: "type-boiler", partType: BOILER_HYDRONIC, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, mark: "B-1" });
    insuf.ok({
      type: "route_run",
      idPrefix: "cw1",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(2),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "mtr-1", connectorId: "out" },
      to: { kind: "part", partId: "dcva-1", connectorId: "in" },
      points: [{ x: 2 * FT, y: 0 }, { x: 8 * FT, y: 0 }],
    });
    insuf.ok({
      type: "route_run",
      idPrefix: "cw2",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(1),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "dcva-1", connectorId: "out" },
      to: { kind: "part", partId: "b-1", connectorId: "cw" },
      points: [{ x: 12 * FT, y: 0 }, { x: 18 * FT, y: 0 }],
    });
    const fInsuf = runRules(insuf.head, backflowRules);
    expect(fInsuf.map((x) => x.rule)).toEqual(["backflow-protection-insufficient"]);
    expect(fInsuf[0]?.message).toContain("DCVA");
    expect(fInsuf[0]?.message).toContain("RPZ");

    // 3. Boiler with upstream RPZ -> clean!
    const ok = new Ws2Building();
    ok.ok({ type: "place_part", partId: "mtr-1", typeId: mtr.id, partType: mtr.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "MTR-1" });
    ok.ok({ type: "place_part", partId: "rpz-1", typeId: "type-rpz", partType: rpz, levelId: "lvl-1", position: { x: 10 * FT, y: 0 }, mark: "RPZ-1" });
    ok.ok({ type: "place_part", partId: "b-1", typeId: "type-boiler", partType: BOILER_HYDRONIC, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, mark: "B-1" });
    ok.ok({
      type: "route_run",
      idPrefix: "cw1",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(2),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "mtr-1", connectorId: "out" },
      to: { kind: "part", partId: "rpz-1", connectorId: "in" },
      points: [{ x: 2 * FT, y: 0 }, { x: 8 * FT, y: 0 }],
    });
    ok.ok({
      type: "route_run",
      idPrefix: "cw2",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(1),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "rpz-1", connectorId: "out" },
      to: { kind: "part", partId: "b-1", connectorId: "cw" },
      points: [{ x: 12 * FT, y: 0 }, { x: 18 * FT, y: 0 }],
    });
    expect(runRules(ok.head, backflowRules)).toEqual([]);
  });

  it("handles irrigation (PVB), hose bibb (AVB), and sibling branch isolation", () => {
    const mtr = starter("water-meter");
    const avb = makeBackflowDevice("avb", "Atmospheric vacuum breaker", "avb");
    const pvb = makeBackflowDevice("pvb", "Pressure vacuum breaker", "pvb");
    const hb = starter("hose-bibb");
    const lav = starter("lavatory");

    // Irrigation with AVB -> insufficient (AVB < PVB).
    const irrBad = new Ws2Building();
    irrBad.ok({ type: "place_part", partId: "avb-1", typeId: "type-avb", partType: avb, levelId: "lvl-1", position: { x: 5 * FT, y: 0 }, mark: "AVB-1" });
    irrBad.ok({ type: "place_part", partId: "irr-1", typeId: "type-irr", partType: IRRIGATION_MANIFOLD, levelId: "lvl-1", position: { x: 15 * FT, y: 0 }, mark: "IRR-1" });
    irrBad.ok({
      type: "route_run",
      idPrefix: "cw",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(1),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "avb-1", connectorId: "out" },
      to: { kind: "part", partId: "irr-1", connectorId: "cw" },
      points: [{ x: 7 * FT, y: 0 }, { x: 13 * FT, y: 0 }],
    });
    expect(runRules(irrBad.head, backflowRules).map((f) => f.rule)).toEqual(["backflow-protection-insufficient"]);

    // Sibling branch: MTR -> main -> (branch A: PVB -> IRR-1, clean) AND (branch B: HB-1 with no AVB, flagged; LAV-1, clean).
    const sib = new Ws2Building();
    sib.ok({ type: "place_part", partId: "mtr-1", typeId: mtr.id, partType: mtr.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, offsetMm: 3 * FT, mark: "MTR-1" });
    sib.ok({ type: "place_part", partId: "pvb-1", typeId: "type-pvb", partType: pvb, levelId: "lvl-1", position: { x: 16 * FT, y: 0 }, offsetMm: 3 * FT, mark: "PVB-1" });
    sib.ok({ type: "place_part", partId: "irr-1", typeId: "type-irr", partType: IRRIGATION_MANIFOLD, levelId: "lvl-1", position: { x: 26 * FT, y: 0 }, offsetMm: 3 * FT, mark: "IRR-1" });
    sib.ok({ type: "place_part", partId: "hb-1", typeId: hb.id, partType: hb.definition, levelId: "lvl-1", position: { x: 8 * FT, y: 4 * FT }, mark: "HB-1" });
    sib.ok({ type: "place_part", partId: "lav-1", typeId: lav.id, partType: lav.definition, levelId: "lvl-1", position: { x: 12 * FT, y: 4 * FT }, mark: "LAV-1" });

    sib.ok({
      type: "route_run",
      idPrefix: "main",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(2),
      elevationMm: 3 * FT,
      system: DCW,
      from: { kind: "part", partId: "mtr-1", connectorId: "out" },
      to: { kind: "part", partId: "pvb-1", connectorId: "in" },
      points: [{ x: 2 * FT, y: 0 }, { x: 14 * FT, y: 0 }],
    });
    sib.ok({
      type: "route_run",
      idPrefix: "irr-pipe",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(1),
      elevationMm: 3 * FT,
      system: DCW,
      from: { kind: "part", partId: "pvb-1", connectorId: "out" },
      to: { kind: "part", partId: "irr-1", connectorId: "cw" },
      points: [{ x: 18 * FT, y: 0 }, { x: 24 * FT, y: 0 }],
    });
    sib.ok({ type: "connect_into", from: [{ elementId: "hb-1", port: "cw" }, { elementId: "lav-1", port: "cw" }], into: "main-s1", idPrefix: "csib" });
    expect(runRules(sib.head, backflowRules).map((f) => `${f.rule} ${f.elementIds[0]}`)).toEqual(["backflow-protection-missing hb-1"]);
  });
});

describe("WS-2 Part 4: Real-world plumbing code lint rules", () => {
  it("vtr-air-intake-clearance: flags VTR within 10 ft horizontally and < 3 ft above RTU OA intake or linked window; clears at >= 10 ft or >= 3 ft above", () => {
    const vtr = starter("vtr");

    // 1. VTR 6 ft from RTU OA intake (OA top Z ≈ 1152mm, VTR top Z = 304.8mm -> below intake) -> FIRES.
    const near = new Ws2Building();
    near.ok({ type: "place_part", partId: "rtu-1", typeId: "type-rtu", partType: RTU_WITH_OA, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "RTU-1" });
    near.ok({ type: "place_part", partId: "vtr-1", typeId: vtr.id, partType: vtr.definition, levelId: "lvl-1", position: { x: 6 * FT, y: 0 }, mark: "VTR-1" });
    const hits = runRules(near.head, plumbingRules).filter((f) => f.rule === "vtr-air-intake-clearance");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("error");
    expect(hits[0]?.message).toContain("IPC 903.5");

    // 2. VTR 6 ft away, raised so its top is >= 3 ft above the OA intake (offsetMm = 8 ft -> top = 9 ft vs intake top ~3.8 ft) -> CLEAN.
    const high = new Ws2Building();
    high.ok({ type: "place_part", partId: "rtu-1", typeId: "type-rtu", partType: RTU_WITH_OA, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "RTU-1" });
    high.ok({ type: "place_part", partId: "vtr-1", typeId: vtr.id, partType: vtr.definition, levelId: "lvl-1", position: { x: 6 * FT, y: 0 }, offsetMm: 8 * FT, mark: "VTR-1" });
    expect(runRules(high.head, plumbingRules).filter((f) => f.rule === "vtr-air-intake-clearance")).toEqual([]);

    // 3. VTR 12 ft away horizontally -> CLEAN.
    const far = new Ws2Building();
    far.ok({ type: "place_part", partId: "rtu-1", typeId: "type-rtu", partType: RTU_WITH_OA, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "RTU-1" });
    far.ok({ type: "place_part", partId: "vtr-1", typeId: vtr.id, partType: vtr.definition, levelId: "lvl-1", position: { x: 12 * FT, y: 0 }, mark: "VTR-1" });
    expect(runRules(far.head, plumbingRules).filter((f) => f.rule === "vtr-air-intake-clearance")).toEqual([]);

    // 4. Linked operable window 5 ft away at same elevation -> FIRES with linked ref.
    const linkedWin: LinkedModelIndex = {
      modelId: "arch-1",
      label: "Arch",
      discipline: "architecture",
      storeys: [{ name: "Level 1", elevationMm: 0 }],
      elements: [{ globalId: "win-1", name: "Operable Window W-1", ifcClass: "IfcWindow", kind: "window", storey: "Level 1", box: [4 * FT, -100, 0, 6 * FT, 100, 1200] }],
    };
    const withWin = new Ws2Building();
    withWin.ok({ type: "place_part", partId: "vtr-1", typeId: vtr.id, partType: vtr.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "VTR-1" });
    const winHits = runRules(withWin.head, plumbingRules, [linkedWin]).filter((f) => f.rule === "vtr-air-intake-clearance");
    expect(winHits).toHaveLength(1);
    expect(winHits[0]?.linked?.[0]?.globalId).toBe("win-1");
  });

  it("water-heater-condensate-neutralizer: flags condensing gas water heater without neutralizer, clears with param or piped neutralizer, ignores electric", () => {
    const whE = starter("water-heater-electric-tank");

    // 1. Condensing gas WH without neutralizer -> FIRES.
    const b = new Ws2Building();
    b.ok({ type: "place_part", partId: "cwh-1", typeId: "type-cwh", partType: CONDENSING_WH, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "WH-1" });
    b.ok({ type: "place_part", partId: "ewh-1", typeId: whE.id, partType: whE.definition, levelId: "lvl-1", position: { x: 10 * FT, y: 0 }, mark: "EWH-1" });
    const hits = runRules(b.head, plumbingRules).filter((f) => f.rule === "water-heater-condensate-neutralizer");
    expect(hits.map((h) => h.elementIds[0])).toEqual(["cwh-1"]);

    // 2. Setting condensate_neutralizer: true clears it.
    b.ok({ type: "set_parameters", id: "cwh-1", scope: "instance", values: { condensate_neutralizer: true } });
    expect(runRules(b.head, plumbingRules).filter((f) => f.rule === "water-heater-condensate-neutralizer")).toEqual([]);

    // 3. Piping condensate port to a Condensate Neutralizer part clears it too.
    const piped = new Ws2Building();
    piped.ok({ type: "place_part", partId: "cwh-2", typeId: "type-cwh", partType: CONDENSING_WH, levelId: "lvl-1", position: { x: 0, y: 0 }, offsetMm: 2 * FT, mark: "WH-2" });
    piped.ok({ type: "place_part", partId: "cn-1", typeId: "type-cn", partType: NEUTRALIZER, levelId: "lvl-1", position: { x: 4 * FT, y: -4 * FT }, offsetMm: 0, mark: "CN-1" });
    piped.ok({
      type: "route_run",
      idPrefix: "cond-m",
      levelId: "lvl-1",
      domain: "pipe",
      size: PVC(1),
      system: COND,
      from: { kind: "part", partId: "cn-1", connectorId: "in" },
      points: [{ x: -4 * FT, y: -4 * FT }],
      flow: "against_points",
    });
    piped.ok({ type: "connect_into", from: [{ elementId: "cwh-2", port: "cond" }], into: "cond-m-s1", idPrefix: "ccond" });
    expect(runRules(piped.head, plumbingRules).filter((f) => f.rule === "water-heater-condensate-neutralizer")).toEqual([]);
  });

  it("closed-water-expansion-tank: flags DCW with RPZ/PRV + water heater and no expansion tank; clears when expansion tank is connected or open system", () => {
    const rpz = starter("rpz");
    const wh = starter("water-heater-electric-tank");
    const et = starter("expansion-tank");

    // 1. Open system (no backflow/PRV/check) with water heater -> CLEAN.
    const open = new Ws2Building();
    open.ok({ type: "place_part", partId: "wh-1", typeId: wh.id, partType: wh.definition, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, mark: "WH-1" });
    open.ok({
      type: "route_run",
      idPrefix: "cw",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(1),
      elevationMm: 3 * FT,
      system: DCW,
      points: [{ x: 0, y: 6 * FT }, { x: 24 * FT, y: 6 * FT }],
    });
    open.ok({ type: "connect_into", from: [{ elementId: "wh-1", port: "cw" }], into: "cw-s1", idPrefix: "cwh1" });
    expect(runRules(open.head, plumbingRules).filter((f) => f.rule === "closed-water-expansion-tank")).toEqual([]);

    // 2. Closed system (RPZ + WH-1) with NO expansion tank -> FIRES!
    const closed = new Ws2Building();
    closed.ok({ type: "place_part", partId: "rpz-1", typeId: rpz.id, partType: rpz.definition, levelId: "lvl-1", position: { x: 5 * FT, y: 6 * FT }, offsetMm: 3 * FT, mark: "RPZ-1" });
    closed.ok({ type: "place_part", partId: "wh-1", typeId: wh.id, partType: wh.definition, levelId: "lvl-1", position: { x: 20 * FT, y: 0 }, mark: "WH-1" });
    closed.ok({
      type: "route_run",
      idPrefix: "cw",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(2),
      elevationMm: 3 * FT,
      system: DCW,
      from: { kind: "part", partId: "rpz-1", connectorId: "out" },
      points: [{ x: 8 * FT, y: 6 * FT }, { x: 24 * FT, y: 6 * FT }],
    });
    closed.ok({ type: "connect_into", from: [{ elementId: "wh-1", port: "cw" }], into: "cw-s1", idPrefix: "cwh2" });
    const hits = runRules(closed.head, plumbingRules).filter((f) => f.rule === "closed-water-expansion-tank");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("error");
    expect(hits[0]?.message).toContain("IPC 607.3");

    // 3. Connect an expansion tank to the DCW branch -> CLEARS!
    closed.ok({ type: "place_part", partId: "et-1", typeId: et.id, partType: et.definition, levelId: "lvl-1", position: { x: 14 * FT, y: 10 * FT }, mark: "ET-1" });
    closed.ok({ type: "connect_into", from: [{ elementId: "et-1", port: "cw" }], into: "cw-s1", idPrefix: "cet" });
    expect(runRules(closed.head, plumbingRules).filter((f) => f.rule === "closed-water-expansion-tank")).toEqual([]);
  });

  it("gas-appliance-venting-check: flags unconnected flue/combustion-air connectors or missing venting spec; clears when connected or specified", () => {
    const whE = starter("water-heater-electric-tank");

    // 1. Condensing gas WH with unconnected flue & combustion_air connectors -> FIRES.
    const b = new Ws2Building();
    b.ok({ type: "place_part", partId: "cwh-1", typeId: "type-cwh", partType: CONDENSING_WH, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "WH-1", values: { condensate_neutralizer: true } });
    b.ok({ type: "place_part", partId: "ewh-1", typeId: whE.id, partType: whE.definition, levelId: "lvl-1", position: { x: 10 * FT, y: 0 }, mark: "EWH-1" });
    const hits = runRules(b.head, plumbingRules).filter((f) => f.rule === "gas-appliance-venting-check");
    expect(hits.map((h) => h.elementIds[0])).toEqual(["cwh-1"]);
    expect(hits[0]?.message).toContain("flue");
    expect(hits[0]?.message).toContain("combustion-air");

    // 2. Connect both flue and combustion-air runs -> CLEARS.
    b.ok({
      type: "route_run",
      idPrefix: "flue",
      levelId: "lvl-1",
      domain: "duct",
      size: ROUND_DUCT(4),
      elevationMm: 8 * FT,
      system: EXH,
      from: { kind: "part", partId: "cwh-1", connectorId: "flue" },
      points: [{ x: -100, y: 0 }, { x: -100, y: 10 * FT }],
    });
    b.ok({
      type: "route_run",
      idPrefix: "ca",
      levelId: "lvl-1",
      domain: "duct",
      size: ROUND_DUCT(4),
      elevationMm: 8 * FT,
      system: OA,
      from: { kind: "part", partId: "cwh-1", connectorId: "ca" },
      points: [{ x: 100, y: 0 }, { x: 100, y: 10 * FT }],
    });
    expect(runRules(b.head, plumbingRules).filter((f) => f.rule === "gas-appliance-venting-check")).toEqual([]);

    // 3. Gas boiler with NO flue connector and NO vent_type -> FIRES; setting vent_type clears it.
    const boiler = new Ws2Building();
    boiler.ok({ type: "place_part", partId: "b-1", typeId: "type-boiler", partType: BOILER_HYDRONIC, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "B-1" });
    expect(runRules(boiler.head, plumbingRules).filter((f) => f.rule === "gas-appliance-venting-check").map((f) => f.elementIds[0])).toEqual(["b-1"]);
    boiler.ok({ type: "set_parameters", id: "b-1", scope: "instance", values: { vent_type: "Cat IV PVC direct vent" } });
    expect(runRules(boiler.head, plumbingRules).filter((f) => f.rule === "gas-appliance-venting-check")).toEqual([]);
  });

  it("water-pressure-prv-required: flags DCW > 80 psi static without PRV; clears <= 80 psi or with PRV connected", () => {
    const prv = starter("prv");

    // 1. 95 psi static, no PRV -> FIRES (IPC 604.8).
    const high = new Ws2Building();
    high.ok({ type: "route_run", idPrefix: "cw", levelId: "lvl-1", domain: "pipe", size: COPPER(2), elevationMm: 3 * FT, system: DCW, points: [{ x: 0, y: 0 }, { x: 20 * FT, y: 0 }] });
    high.ok({ type: "set_system_design", systemId: DCW.id, design: { pipe: { supplyPressurePsi: 95 } } });
    const hits = runRules(high.head, plumbingRules).filter((f) => f.rule === "water-pressure-prv-required");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("error");
    expect(hits[0]?.message).toContain("95 psi");
    expect(hits[0]?.message).toContain("IPC 604.8");

    // 2. <= 80 psi static -> CLEAN.
    high.ok({ type: "set_system_design", systemId: DCW.id, design: { pipe: { supplyPressurePsi: 75 } } });
    expect(runRules(high.head, plumbingRules).filter((f) => f.rule === "water-pressure-prv-required")).toEqual([]);

    // 3. 95 psi static WITH PRV connected -> CLEAN.
    const withPrv = new Ws2Building();
    withPrv.ok({ type: "place_part", partId: "prv-1", typeId: prv.id, partType: prv.definition, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "PRV-1" });
    withPrv.ok({
      type: "route_run",
      idPrefix: "cw",
      levelId: "lvl-1",
      domain: "pipe",
      size: COPPER(2),
      elevationMm: 0,
      system: DCW,
      from: { kind: "part", partId: "prv-1", connectorId: "out" },
      points: [{ x: 2 * FT, y: 0 }, { x: 20 * FT, y: 0 }],
    });
    withPrv.ok({ type: "set_system_design", systemId: DCW.id, design: { pipe: { supplyPressurePsi: 95 } } });
    expect(runRules(withPrv.head, plumbingRules).filter((f) => f.rule === "water-pressure-prv-required")).toEqual([]);
  });

  it("gas-system-sizing-lint: surfaces IFGC sizing, missing regulator, min-inlet-pressure, and sediment-trap findings via activeLintRules()", () => {
    // 1. Sample Market gas without heater regulator: missing regulator + undersized pipes + sediment traps surfaced automatically!
    const badGas = buildSampleMarketGas({ withoutHeaterRegulator: true, rangeMinInletInWc: 10.8 });
    const gasFindings = runRules(badGas, activeLintRules()).filter((f) => f.rule === "gas-system-sizing-lint");
    expect(gasFindings.length).toBeGreaterThan(0);
    expect(gasFindings.some((f) => /regulator/i.test(f.message))).toBe(true);
    expect(gasFindings.some((f) => /10\.8|minimum|inlet/i.test(f.message))).toBe(true);
    expect(gasFindings.some((f) => /sediment trap/i.test(f.message))).toBe(true);

    // 2. Simple gas water heater without vs with sediment trap on its branch.
    const gr = starter("gas-regulator");
    const st = starter("sediment-trap");
    const wh = starter("water-heater-tank");
    const simple = new Ws2Building();
    simple.ok({ type: "place_part", partId: "gr-1", typeId: gr.id, partType: gr.definition, levelId: "lvl-1", position: { x: 0, y: 6 * FT }, offsetMm: 360, mark: "GR-1" });
    simple.ok({ type: "place_part", partId: "wh-1", typeId: wh.id, partType: wh.definition, levelId: "lvl-1", position: { x: 12 * FT, y: 0 }, mark: "WH-1" });
    simple.ok({
      type: "route_run",
      idPrefix: "g",
      levelId: "lvl-1",
      domain: "pipe",
      size: BLACK_STEEL(1.25),
      elevationMm: 360,
      system: GAS,
      from: { kind: "part", partId: "gr-1", connectorId: "out" },
      points: [{ x: 2 * FT, y: 6 * FT }, { x: 18 * FT, y: 6 * FT }],
    });
    simple.ok({ type: "connect_into", from: [{ elementId: "wh-1", port: "g" }], into: "g-s1", idPrefix: "cwhg" });
    const noTrap = runRules(simple.head, plumbingRules).filter((f) => f.rule === "gas-system-sizing-lint" && /sediment trap/i.test(f.message));
    expect(noTrap).toHaveLength(1);
    expect(noTrap[0]?.severity).toBe("warning");

    // Add a sediment trap on the branch -> sediment trap warning clears!
    simple.ok({ type: "place_part", partId: "st-1", typeId: st.id, partType: st.definition, levelId: "lvl-1", position: { x: 8 * FT, y: 2 * FT }, offsetMm: 258, mark: "ST-1" });
    simple.ok({ type: "connect_into", from: [{ elementId: "st-1", port: "g" }], into: "g-s1", idPrefix: "cst" });
    const withTrap = runRules(simple.head, plumbingRules).filter((f) => f.rule === "gas-system-sizing-lint" && /sediment trap/i.test(f.message));
    expect(withTrap).toEqual([]);
  });

  it("registers every WS-2 rule in activeLintRules()", () => {
    const ids = new Set(activeLintRules().map((r) => r.id));
    for (const id of [
      "grease-fixture-bypasses-interceptor",
      "grease-fixture-not-routed",
      "grease-authority-unknown",
      "clear-water-in-grease-waste",
      "backflow-protection-missing",
      "backflow-protection-insufficient",
      "vtr-air-intake-clearance",
      "water-heater-condensate-neutralizer",
      "closed-water-expansion-tank",
      "gas-appliance-venting-check",
      "water-pressure-prv-required",
      "gas-system-sizing-lint",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
