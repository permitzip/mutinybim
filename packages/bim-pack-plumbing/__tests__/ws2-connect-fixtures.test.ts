/**
 * @jest-environment node
 *
 * WS-2 (#206): Plumbing Connect fixes
 * - Adds gas, dhwr (domestic_hot_water_return), flue (combustion exhaust), and
 *   combustion_air targets to FIXTURE_CONNECT_TARGETS and TARGET_SYSTEM_KINDS.
 * - Stops excluding connectors that define `flowDirection: "in" | "out"` so
 *   engineered cut-sheet parts remain connectable via Plumbing › Connect and
 *   the "+" grip, while paired inline pass-through pipe accessories (RPZ, PRV,
 *   meter, regulator) and already-linked connectors stay excluded.
 */
import { asElementId, connectToSource, sourcesFor, validateModel, withUpgradePolicy, type LibraryEntry } from "@permitzip/bim-kernel";
import { PackSet, withPackSet } from "@permitzip/bim-kernel/packs";
import {
  FIXTURE_CONNECT_TARGETS,
  FIXTURE_CONNECT_WORDS,
  PLUMBING_GAS_PACK,
  TARGET_SYSTEM_KINDS,
  fixtureConnectBlocked,
  fixtureConnectRequest,
  fixtureConnectSources,
  plumbingSourcesFor,
  previewFixtureConnect,
} from "../src";
import { COPPER, DIFFUSER, FT, IN, K15Model, SA } from "../../bim-kernel/__tests__/k15-fixtures";
import { HW, starter } from "./p15-fixtures";

const BLACK_STEEL = (inches: number) => ({ shape: "pipe" as const, nominalMm: inches * IN, material: "black_steel" as const });
const ROUND_DUCT = (inches: number) => ({ shape: "round" as const, diameter: inches * IN });

const GAS = { id: "sys-gas", kind: "natural_gas" as const, name: "Natural Gas" };
const DHWR = { id: "sys-dhwr", kind: "domestic_hot_water_return" as const, name: "Domestic Hot Water Return" };
const EXHAUST = { id: "sys-flue", kind: "exhaust_air" as const, name: "Boiler Flue" };
const OA = { id: "sys-ca", kind: "outside_air" as const, name: "Combustion Air" };

/** Engineered cut-sheet condensing gas water heater with explicit flowDirection on every connector. */
const CUT_SHEET_WATER_HEATER: LibraryEntry = {
  id: "test:cut-sheet-condensing-wh@1",
  definition: {
    familyName: "Condensing Gas Water Heater",
    typeName: "199 MBH",
    category: "plumbing_fixture",
    typeParams: [{ name: "heater_kind", label: "Heater kind", kind: "text" }],
    typeValues: { heater_kind: "gas_tankless" },
    instanceParams: [],
    connectors: [
      { id: "cw", label: "Cold water in", domain: "pipe", systemKind: "domestic_cold_water", position: [100, 300, 450], direction: [0, 1, 0], shape: "round", diameter: 1 * IN, flowDirection: "in" },
      { id: "hw", label: "Hot water out", domain: "pipe", systemKind: "domestic_hot_water", position: [-100, 300, 450], direction: [0, 1, 0], shape: "round", diameter: 1 * IN, flowDirection: "out" },
      { id: "hwr", label: "DHWR in", domain: "pipe", systemKind: "domestic_hot_water_return", position: [-200, 300, 300], direction: [0, 1, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "in" },
      { id: "g", label: "Gas inlet", domain: "pipe", systemKind: "natural_gas", position: [200, 300, 300], direction: [0, 1, 0], shape: "round", diameter: 0.75 * IN, flowDirection: "in" },
      { id: "flue", label: "Flue exhaust", domain: "duct", systemKind: "exhaust_air", position: [0, 0, 1200], direction: [0, 0, 1], shape: "round", diameter: 4 * IN, flowDirection: "out" },
      { id: "comb_air", label: "Combustion air intake", domain: "duct", systemKind: "outside_air", position: [150, 0, 1200], direction: [0, 0, 1], shape: "round", diameter: 4 * IN, flowDirection: "in" },
    ],
    geometry: [{ kind: "box", center: [0, 0, 600], size: [600, 600, 1200] }],
    symbol: [{ kind: "rect", center: [0, 0], size: [600, 600] }],
    tagFields: ["mark"],
    source: { kind: "cut_sheet", fileName: "wh-199.pdf" },
  },
};

/** Cut-sheet fixture with flowDirection on drain/water/vent. */
const CUT_SHEET_SINK: LibraryEntry = {
  id: "test:cut-sheet-sink@1",
  definition: {
    familyName: "Three-compartment sink",
    typeName: "Cut sheet",
    category: "plumbing_fixture",
    typeParams: [],
    typeValues: {},
    instanceParams: [],
    connectors: [
      { id: "w", label: "Waste out", domain: "pipe", systemKind: "sanitary", position: [0, 0, 0], direction: [0, 0, -1], shape: "round", diameter: 2 * IN, flowDirection: "out" },
      { id: "cw", label: "Cold in", domain: "pipe", systemKind: "domestic_cold_water", position: [100, 300, 450], direction: [0, 1, 0], shape: "round", diameter: 0.5 * IN, flowDirection: "in" },
      { id: "hw", label: "Hot in", domain: "pipe", systemKind: "domestic_hot_water", position: [-100, 300, 450], direction: [0, 1, 0], shape: "round", diameter: 0.5 * IN, flowDirection: "in" },
    ],
    geometry: [{ kind: "box", center: [0, 0, 450], size: [1200, 600, 900] }],
    symbol: [{ kind: "rect", center: [0, 0], size: [1200, 600] }],
    tagFields: ["mark"],
    source: { kind: "cut_sheet", fileName: "sink3.pdf" },
  },
};

/** HVAC RTU with weather hood OA intake (must not be hijacked as a combustion-air connect target). */
const HVAC_RTU_WITH_HOOD: LibraryEntry = {
  id: "test:hvac-rtu@1",
  definition: {
    familyName: "Rooftop Unit",
    typeName: "10 Ton",
    category: "mechanical_equipment",
    typeParams: [],
    typeValues: {},
    instanceParams: [],
    connectors: [
      { id: "sa", label: "Supply", domain: "duct", systemKind: "supply_air", position: [0, 0, 0], direction: [0, 0, -1], shape: "rect", width: 24 * IN, height: 18 * IN, flowDirection: "out" },
      { id: "oa", label: "Outside air", domain: "duct", systemKind: "outside_air", position: [600, 0, 500], direction: [1, 0, 0], shape: "rect", width: 24 * IN, height: 12 * IN, flowDirection: "in", intake: "hood" },
    ],
    geometry: [{ kind: "box", center: [0, 0, 600], size: [1200, 1200, 1200] }],
    symbol: [{ kind: "rect", center: [0, 0], size: [1200, 1200] }],
    tagFields: ["mark"],
    source: { kind: "builtin", libraryVersion: "test" },
  },
};

describe("WS-2 Plumbing Connect targets & flowDirection support", () => {
  it("exports gas, dhwr, flue, and combustion_air in FIXTURE_CONNECT_TARGETS and TARGET_SYSTEM_KINDS", () => {
    expect(FIXTURE_CONNECT_TARGETS).toEqual(["drain", "vent", "cold_water", "hot_water", "dhwr", "gas", "flue", "combustion_air"]);
    expect([...TARGET_SYSTEM_KINDS.dhwr]).toEqual(["domestic_hot_water_return"]);
    expect([...TARGET_SYSTEM_KINDS.gas]).toEqual(["natural_gas"]);
    expect(TARGET_SYSTEM_KINDS.flue.has("flue")).toBe(true);
    expect(TARGET_SYSTEM_KINDS.flue.has("combustion_exhaust")).toBe(true);
    expect(TARGET_SYSTEM_KINDS.flue.has("exhaust_air")).toBe(true);
    expect(TARGET_SYSTEM_KINDS.combustion_air.has("combustion_air")).toBe(true);
    expect(TARGET_SYSTEM_KINDS.combustion_air.has("outside_air")).toBe(true);
    for (const t of FIXTURE_CONNECT_TARGETS) {
      expect(FIXTURE_CONNECT_WORDS.target[t].label.length).toBeGreaterThan(0);
    }
  });

  it("connects starter gas appliances to gas and starter water heater to dhwr + gas", () => {
    const m = new K15Model();
    m.ok({ type: "route_run", idPrefix: "gas", levelId: "lvl-1", domain: "pipe", size: BLACK_STEEL(1.5), elevationMm: 3 * FT, system: GAS, points: [{ x: -10 * FT, y: 6 * FT }, { x: 40 * FT, y: 6 * FT }] });
    m.ok({ type: "route_run", idPrefix: "dhwr", levelId: "lvl-1", domain: "pipe", size: COPPER(1), elevationMm: 3 * FT, system: DHWR, points: [{ x: -10 * FT, y: 9 * FT }, { x: 40 * FT, y: 9 * FT }] });

    m.place("wh-1", starter("water-heater-tank"), 4 * FT, 2 * FT, 0, "WH-1");
    m.place("range-1", starter("gas-range"), 14 * FT, 2 * FT, 0, "K-1");
    m.place("wc-1", starter("wc-flush-tank"), 24 * FT, 2 * FT, 0, "WC-1");

    // Gas target picks up WH-1 and K-1, ignores WC-1.
    expect(fixtureConnectSources(m.head.elements, ["wh-1", "range-1", "wc-1"], "gas")).toEqual([
      { elementId: "wh-1", port: "g" },
      { elementId: "range-1", port: "g" },
    ]);
    expect(fixtureConnectBlocked(m.head.elements, ["wc-1"], "gas")).toBe(FIXTURE_CONNECT_WORDS.target.gas.noneHave);

    const gasReq = fixtureConnectRequest(m.head.elements, ["wh-1", "range-1"], "gas", "cg");
    if (!gasReq) throw new Error("expected gas connect request");
    m.ok({ type: "connect_into", ...gasReq });
    expect(m.part("wh-1").links?.g).toBeDefined();
    expect(m.part("range-1").links?.g).toBeDefined();
    expect(fixtureConnectBlocked(m.head.elements, ["wh-1", "range-1"], "gas")).toBe(FIXTURE_CONNECT_WORDS.target.gas.allConnected);

    // DHWR target picks up WH-1's hwr connector and connects it.
    expect(fixtureConnectSources(m.head.elements, ["wh-1", "range-1"], "dhwr")).toEqual([{ elementId: "wh-1", port: "hwr" }]);
    const dhwrReq = fixtureConnectRequest(m.head.elements, ["wh-1"], "dhwr", "cdhwr");
    if (!dhwrReq) throw new Error("expected dhwr connect request");
    m.ok({ type: "connect_into", ...dhwrReq });
    expect(m.part("wh-1").links?.hwr).toBeDefined();
    expect(fixtureConnectBlocked(m.head.elements, ["wh-1"], "dhwr")).toBe(FIXTURE_CONNECT_WORDS.target.dhwr.allConnected);
    expect(validateModel(m.head)).toEqual([]);
  });

  it("connects engineered cut-sheet parts with flowDirection on water, dhwr, gas, flue, and combustion_air", () => {
    const m = new K15Model();
    m.ok({ type: "route_run", idPrefix: "hw", levelId: "lvl-1", domain: "pipe", size: COPPER(1), elevationMm: 3 * FT, system: HW, points: [{ x: -10 * FT, y: 6 * FT }, { x: 30 * FT, y: 6 * FT }] });
    m.ok({ type: "route_run", idPrefix: "dhwr", levelId: "lvl-1", domain: "pipe", size: COPPER(0.75), elevationMm: 2 * FT, system: DHWR, points: [{ x: -10 * FT, y: 7 * FT }, { x: 30 * FT, y: 7 * FT }] });
    m.ok({ type: "route_run", idPrefix: "gas", levelId: "lvl-1", domain: "pipe", size: BLACK_STEEL(1.25), elevationMm: 4 * FT, system: GAS, points: [{ x: -10 * FT, y: 8 * FT }, { x: 30 * FT, y: 8 * FT }] });
    m.ok({ type: "route_run", idPrefix: "flue", levelId: "lvl-1", domain: "duct", size: ROUND_DUCT(6), elevationMm: 9 * FT, system: EXHAUST, points: [{ x: -10 * FT, y: 0 }, { x: 30 * FT, y: 0 }] });
    m.ok({ type: "route_run", idPrefix: "ca", levelId: "lvl-1", domain: "duct", size: ROUND_DUCT(6), elevationMm: 9 * FT, system: OA, points: [{ x: -10 * FT, y: 2 * FT }, { x: 30 * FT, y: 2 * FT }] });

    m.place("cwh-1", CUT_SHEET_WATER_HEATER, 10 * FT, 0, 0, "CWH-1");

    // All 6 connectors define flowDirection: "in" | "out", and ALL 6 must be returned by fixtureConnectSources!
    expect(fixtureConnectSources(m.head.elements, ["cwh-1"], "cold_water")).toEqual([{ elementId: "cwh-1", port: "cw" }]);
    expect(fixtureConnectSources(m.head.elements, ["cwh-1"], "hot_water")).toEqual([{ elementId: "cwh-1", port: "hw" }]);
    expect(fixtureConnectSources(m.head.elements, ["cwh-1"], "dhwr")).toEqual([{ elementId: "cwh-1", port: "hwr" }]);
    expect(fixtureConnectSources(m.head.elements, ["cwh-1"], "gas")).toEqual([{ elementId: "cwh-1", port: "g" }]);
    expect(fixtureConnectSources(m.head.elements, ["cwh-1"], "flue")).toEqual([{ elementId: "cwh-1", port: "flue" }]);
    expect(fixtureConnectSources(m.head.elements, ["cwh-1"], "combustion_air")).toEqual([{ elementId: "cwh-1", port: "comb_air" }]);

    // Connect hot_water, dhwr, gas, flue, and combustion_air cleanly via connect_into.
    for (const target of ["hot_water", "dhwr", "gas", "flue", "combustion_air"] as const) {
      const preview = withUpgradePolicy(() => true, () => previewFixtureConnect(m.head, ["cwh-1"], target, `p-${target}`));
      if ("refused" in preview) throw new Error(`${target} refused: ${preview.refused}`);
      expect(preview.joinable).toBe(1);
      const req = fixtureConnectRequest(m.head.elements, ["cwh-1"], target, `c-${target}`);
      if (!req) throw new Error(`no request for ${target}`);
      m.ok({ type: "connect_into", ...req });
    }
    expect(m.part("cwh-1").links?.hw).toBeDefined();
    expect(m.part("cwh-1").links?.hwr).toBeDefined();
    expect(m.part("cwh-1").links?.g).toBeDefined();
    expect(m.part("cwh-1").links?.flue).toBeDefined();
    expect(m.part("cwh-1").links?.comb_air).toBeDefined();
    expect(validateModel(m.head)).toEqual([]);
  });

  it("excludes paired inline pipe accessories (RPZ, PRV) from bulk fixture connect, while allowing single-port accessories and + grip on flowDirection parts", () => {
    withPackSet(PackSet.create([PLUMBING_GAS_PACK]), () => {
      const m = new K15Model();
      m.ok({ type: "route_run", idPrefix: "san", levelId: "lvl-1", domain: "pipe", size: { shape: "pipe", nominalMm: 4 * IN, material: "pvc" }, elevationMm: -2 * FT, system: { id: "sys-san", kind: "sanitary", name: "Sanitary" }, points: [{ x: -10 * FT, y: 0 }, { x: 30 * FT, y: 0 }] });
      m.ok({ type: "route_run", idPrefix: "trunk", levelId: "lvl-1", domain: "duct", size: { shape: "rect", width: 14 * IN, height: 10 * IN }, elevationMm: 10 * FT, system: SA, points: [{ x: 0, y: 40 * FT }, { x: 30 * FT, y: 40 * FT }] });

      m.place("rpz-1", starter("rpz"), 0, 10 * FT, 0, "RPZ-1");
      m.place("et-1", starter("expansion-tank"), 4 * FT, 10 * FT, 0, "ET-1");
      m.place("sink-1", CUT_SHEET_SINK, 10 * FT, 3 * FT, 0, "SK-1");
      m.place("sd-1", DIFFUSER, 10 * FT, 45 * FT, 8 * FT, "SD-1");
      m.place("rtu-1", HVAC_RTU_WITH_HOOD, 20 * FT, 45 * FT, 12 * FT, "RTU-1");

      // Paired inline pass-through RPZ (in + out on domestic_cold_water) is excluded from bulk cold_water connect.
      expect(fixtureConnectSources(m.head.elements, ["rpz-1"], "cold_water")).toEqual([]);
      // Single-port pipe_accessory (expansion tank) stays connectable.
      expect(fixtureConnectSources(m.head.elements, ["et-1"], "cold_water")).toEqual([{ elementId: "et-1", port: "cw" }]);
      // HVAC RTU with weather hood OA intake is NOT matched by combustion_air connect.
      expect(fixtureConnectSources(m.head.elements, ["rtu-1"], "combustion_air")).toEqual([]);
      // HVAC diffuser is left to the mechanical add-on on "+" grip.
      expect(plumbingSourcesFor(m.head, { elementId: asElementId("sd-1") })).toBeNull();

      // Cut-sheet sink with flowDirection: "out" on waste IS offered & connected by the "+" grip!
      const answer = sourcesFor(m.head, { elementId: asElementId("sink-1") });
      if (!answer) throw new Error("expected + grip sources for cut-sheet sink with flowDirection");
      expect(answer.candidates.map((c) => c.sourceId)).toEqual(["san-s1"]);
      const nearest = answer.candidates[0];
      if (!nearest) throw new Error("no candidate");
      const plan = connectToSource(m.head, { elementId: asElementId("sink-1") }, nearest, "grip-cs");
      if (!plan.ok) throw new Error(plan.reason);
      for (const cmd of plan.commands) m.ok(cmd);
      expect(m.part("sink-1").links?.w).toBeDefined();
      expect(validateModel(m.head)).toEqual([]);
    });
  });
});
