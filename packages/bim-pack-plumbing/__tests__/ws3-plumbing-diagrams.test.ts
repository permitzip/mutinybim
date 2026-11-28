/**
 * @jest-environment node
 *
 * WS-3 (#207): Dedicated ASPE Fuel Gas Riser, Water Riser DHWR / Expansion &
 * Buffer Tanks / Backflow Taxonomy, Multi-Drain & Multi-Stack DWV Riser with
 * Semantic Fixture Classification, and Labeled / Rotated Isometrics with Floor Datums.
 */
import {
  asElementId,
  diagramBoxesFor,
  evaluateDiagram,
  type DiagramEvaluation,
  type DiagramHints,
  type DiagramNode,
  type DiagramPipe,
  type DrawingItem,
  type OneLineItem,
  type PartTypeDefinition,
  type RiserLevel,
  type ViewElement,
} from "@permitzip/bim-kernel";
import {
  classifyPlumbingDevice,
  classifyPlumbingFixture,
  hasMergedDwvRoots,
  isFuelGasKind,
  layoutDwvRiser,
  layoutGasRiser,
  layoutPipingIsometric,
  layoutPipingRiser,
  layoutWaterRiser,
  plumbingDiagramGraph,
  setPlumbingNodeMeta,
} from "../src";
import { Building } from "../../bim-kernel/__tests__/fixtures/electrical-building";
import { buildSampleMarketGas } from "../../bim-kernel/__tests__/fixtures/sample-market-gas";
import { stackRisers } from "../../bim-kernel/__tests__/fixtures/stack-risers";

const FT = 304.8;
const IN = 25.4;

const LEVELS_3: readonly RiserLevel[] = [
  { id: asElementId("lvl-3"), name: "Level 3", elevationMm: 24 * FT },
  { id: asElementId("lvl-2"), name: "Level 2", elevationMm: 12 * FT },
  { id: asElementId("lvl-1"), name: "Level 1", elevationMm: 0 },
];

const LEVELS_1: readonly RiserLevel[] = [{ id: asElementId("lvl-1"), name: "Level 1", elevationMm: 0 }];

function itemTexts(items: readonly OneLineItem[]): string[] {
  return items.flatMap((i) => (i.shape === "text" ? i.lines.map((l) => l.text) : []));
}

function evalTexts(ev: DiagramEvaluation | null): string[] {
  return (ev?.items ?? []).flatMap((i: DrawingItem) =>
    i.shape === "text" ? (i.note?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join("")) : [],
  );
}

function makeNode(
  id: string,
  service: string,
  role: NonNullable<DiagramNode["role"]>,
  name: string,
  lines: DiagramNode["lines"],
  opts: Partial<DiagramNode> = {},
): DiagramNode {
  return {
    id,
    elementId: asElementId(opts.elementId ?? id),
    kind: "equipment",
    labelKind: "equipment",
    name,
    lines,
    levelId: opts.levelId ?? "lvl-1",
    service,
    role,
    at: opts.at ?? { x: 0, y: 0, z: 0 },
    ...(opts.feed ? { feed: opts.feed } : {}),
    children: opts.children ?? [],
  };
}

function makePartType(
  familyName: string,
  category: PartTypeDefinition["category"],
  connectors: PartTypeDefinition["connectors"],
  typeValues: Record<string, number | string> = {},
): PartTypeDefinition {
  const typeParams: PartTypeDefinition["typeParams"] = Object.keys(typeValues).map((k) => ({
    name: k,
    label: k,
    kind: typeof typeValues[k] === "number" ? ("number" as const) : ("text" as const),
    ...(typeof typeValues[k] === "number" ? { unit: "none" as const } : {}),
  }));
  return {
    familyName,
    typeName: "Test",
    category,
    typeParams,
    typeValues,
    instanceParams: [],
    connectors,
    geometry: [{ kind: "box", center: [0, 0, 100], size: [200, 200, 200] }],
    symbol: [{ kind: "rect", center: [0, 0], size: [200, 200] }],
    tagFields: ["mark"],
    source: { kind: "builtin", libraryVersion: "test" },
  };
}

// ---------------------------------------------------------------------------
// 1. Dedicated ASPE Fuel Gas Riser Layout
// ---------------------------------------------------------------------------

describe("WS-3.1 Dedicated ASPE Fuel Gas Riser", () => {
  it("dispatches natural_gas and propane roots to layoutGasRiser with ASPE meter, regulators (inlet->outlet, MBH, VL/VTO), SOV, drip legs, CFH & pressure zones", () => {
    expect(isFuelGasKind("natural_gas")).toBe(true);
    expect(isFuelGasKind("propane")).toBe(true);
    expect(isFuelGasKind("domestic_cold_water")).toBe(false);

    // Sample Market Gas model has 2 psi propane -> AR-DOAS, AR-GWH, LR-1 (2 psi -> 11 in. w.c.) -> K07/K08/K09
    const m = buildSampleMarketGas();
    const view: ViewElement = {
      id: asElementId("v-gas-ws3"),
      version: 0,
      authoredRev: {},
      kind: "view",
      name: "Gas Riser",
      viewType: "detail",
      cropMin: { x: 0, y: 0 },
      cropMax: { x: 1000, y: 1000 },
      props: { diagram: { kind: "plumbing_riser", hints: { systemKinds: ["natural_gas"] } } },
    };
    const ev = evaluateDiagram(m.elements, view);
    expect(ev).not.toBeNull();
    const words = evalTexts(ev);

    // ASPE Gas Meter circle ('M'), fuel, inlet pressure, total MBH & total CFH
    expect(words).toContain("M");
    expect(words).toContain("PROPANE, 2 PSI, 1,024.41 MBH TOTAL");
    expect(words.some((w) => /CFH TOTAL$/.test(w))).toBe(true);

    // Line & Appliance Regulators with inlet -> outlet pressure transition, MBH, and VL indicator
    expect(words.some((w) => w.includes("2 PSI → 11 IN. W.C."))).toBe(true);
    expect(words.some((w) => w.includes("VL"))).toBe(true);

    // Pressure-zone banners for both 2 PSI and 11 IN. W.C. zones
    expect(words).toContain("2 PSI ZONE");
    expect(words).toContain("11 IN. W.C. ZONE");

    // Per-piece SIZE, LF, and CFH callouts
    expect(words.some((w) => /^\d+ LF$/.test(w))).toBe(true);
    expect(words.some((w) => /CFH$/.test(w) && !w.includes("TOTAL"))).toBe(true);

    // Interactive selection preserved for pipes and regulators/appliances
    expect(diagramBoxesFor(ev!, ["main-s1"]).length).toBeGreaterThan(0);
    expect(ev!.boxes.some((b) => b.elementId === "LR-1")).toBe(true);
    expect(ev!.boxes.some((b) => b.elementId === "k08")).toBe(true);
  });

  it("renders VTO vent-to-outdoors dashed vent line, SOV bowties, DRIP legs, multi-floor stack & preserves ranges/entries", () => {
    const sov1 = setPlumbingNodeMeta(
      makeNode("sov-1", "natural_gas", "device", "Gas cock", [{ text: "GAS COCK" }], {
        feed: { linkId: asElementId("seg-drop-1"), device: "none", label: '¾"', lengthFt: 6, load: "150 MBH", elementIds: [asElementId("seg-drop-1")] },
      }),
      { deviceKind: "shutoff_valve" },
    );
    const drip1 = setPlumbingNodeMeta(
      makeNode("drip-1", "natural_gas", "device", "Drip leg", [{ text: "DRIP LEG" }], {
        feed: { linkId: asElementId("seg-drop-1b"), device: "none", label: '¾"', lengthFt: 2, load: "150 MBH", elementIds: [asElementId("seg-drop-1b")] },
      }),
      { deviceKind: "drip_leg" },
    );
    const boiler = makeNode("b-1", "natural_gas", "terminal", "B-1", [{ text: "B-1", bold: true }, { text: "150 MBH" }], {
      feed: { linkId: asElementId("seg-drop-1c"), device: "none", label: '¾"', lengthFt: 4, load: "150 MBH", elementIds: [asElementId("seg-drop-1c")] },
    });
    const regVto = setPlumbingNodeMeta(
      makeNode("reg-vto", "natural_gas", "device", "LR-VTO", [{ text: "LR-VTO", bold: true }, { text: "7 IN. W.C., 100 MBH" }], {
        feed: { linkId: asElementId("seg-main-2"), device: "none", label: '1"', lengthFt: 30, load: "100 MBH", elementIds: [asElementId("seg-main-2")] },
      }),
      {
        deviceKind: "gas_regulator",
        gasRegulator: { role: "line", inletInWc: 55.4, inletLabel: "2 psi", outletInWc: 7, outletLabel: "7 in. w.c.", loadMbh: 100, vent: "vent_to_outdoors", capacityMbh: 500 },
      },
    );
    const rtuL2 = makeNode("rtu-1", "natural_gas", "terminal", "RTU-1", [{ text: "RTU-1", bold: true }, { text: "100 MBH" }], {
      levelId: "lvl-2",
      at: { x: 1000, y: 0, z: 12 * FT },
      feed: { linkId: asElementId("seg-l2"), device: "none", label: '¾"', lengthFt: 25, load: "100 MBH", elementIds: [asElementId("seg-l2")] },
    });
    const dropBranch = makeNode("br-1", "natural_gas", "branch", "Tee", [], {
      feed: { linkId: asElementId("seg-main-1"), device: "none", label: '1¼"', lengthFt: 20, load: "250 MBH", elementIds: [asElementId("seg-main-1")] },
      children: [sov1, drip1, boiler],
    });
    const root = setPlumbingNodeMeta(
      makeNode("gm-1", "natural_gas", "source", "GM-1", [{ text: "GM-1", bold: true }, { text: "NATURAL GAS" }, { text: "NATURAL GAS, 2 PSI, 250 MBH TOTAL" }], {
        children: [dropBranch, regVto, rtuL2],
      }),
      {
        deviceKind: "gas_meter",
        gasSource: { fuel: "natural", heatingValueBtuPerCf: 1000, inletInWc: 55.4, inletLabel: "2 psi", totalMbh: 250, totalCfh: 250 },
      },
    );

    const layout = layoutPipingRiser([root], LEVELS_3);
    const words = itemTexts(layout.items);
    expect(words).toContain("M");
    expect(words).toContain("SOV");
    expect(words).toContain("DRIP");
    expect(words).toContain("VTO");
    expect(words).toContain("2 PSI → 7 IN. W.C.");
    expect(words).toContain("250 CFH TOTAL");
    expect(words).toContain("100 MBH · VTO");
    expect(words).toContain("B-1");
    expect(words).toContain("RTU-1");
    expect(words).toContain("7 IN. W.C. ZONE");
    // VTO dashed vent line exists on reg-vto
    expect(layout.items.some((it) => it.shape === "line" && it.nodeId === "reg-vto" && it.dashed === true)).toBe(true);
    // Multi-floor: RTU-1 on Level 2 is drawn above B-1 on Level 1
    const yB1 = layout.nodes.find((n) => n.id === "b-1")!.center.y;
    const yRtu = layout.nodes.find((n) => n.id === "rtu-1")!.center.y;
    expect(yRtu).toBeGreaterThan(yB1);
    // Interactive ranges, entries, and pipes populated
    expect(layout.ranges?.["sov-1"]).toBeDefined();
    expect(layout.ranges?.["drip-1"]).toBeDefined();
    expect(layout.ranges?.["reg-vto"]).toBeDefined();
    expect(layout.entries?.["b-1"]).toBeDefined();
    expect(Object.keys(layout.pipes).length).toBeGreaterThanOrEqual(4);
    // Direct layoutGasRiser matches dispatch
    expect(layoutGasRiser([root], LEVELS_3).items.length).toBe(layout.items.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Water Riser Upgrades: DHWR, Expansion/Buffer Tanks, Backflow Taxonomy
// ---------------------------------------------------------------------------

describe("WS-3.2 Water Riser: DHWR, Expansion/Buffer Tanks & Backflow Taxonomy", () => {
  it("renders distinct DHWR line with recirc pump, check valve, balancing valve, return chevrons, and HWR legend", () => {
    const lavHw = makeNode("lav-1-hw", "domestic_hot_water", "terminal", "L-1", [{ text: "L-1", bold: true }, { text: "1.5 WFU" }], {
      elementId: asElementId("lav-1"),
      levelId: "lvl-2",
      at: { x: 2000, y: 0, z: 12 * FT },
      feed: { linkId: asElementId("hw-l2"), device: "none", label: '¾"', load: "1.5 WFU", elementIds: [asElementId("hw-l2")] },
    });
    const lavCw = makeNode("lav-1-cw", "domestic_cold_water", "terminal", "L-1", [{ text: "L-1", bold: true }, { text: "1.5 WFU" }], {
      elementId: asElementId("lav-1"),
      levelId: "lvl-2",
      at: { x: 2000, y: 0, z: 12 * FT },
      feed: { linkId: asElementId("cw-l2"), device: "none", label: '¾"', load: "1.5 WFU", elementIds: [asElementId("cw-l2")] },
    });
    const bv = setPlumbingNodeMeta(
      makeNode("bv-1", "domestic_hot_water_return", "device", "BV-1", [{ text: "BV-1", bold: true }], {
        feed: { linkId: asElementId("hwr-s1"), device: "none", label: '¾"', load: "2 GPM", elementIds: [asElementId("hwr-s1")] },
      }),
      { deviceKind: "balancing_valve" },
    );
    const cv = setPlumbingNodeMeta(
      makeNode("cv-1", "domestic_hot_water_return", "device", "CV-1", [{ text: "CV-1", bold: true }], {
        feed: { linkId: asElementId("hwr-s2"), device: "none", label: '¾"', load: "2 GPM", elementIds: [asElementId("hwr-s2")] },
      }),
      { deviceKind: "check_valve" },
    );
    const rp = setPlumbingNodeMeta(
      makeNode("rp-1", "domestic_hot_water_return", "device", "RP-1", [{ text: "RP-1", bold: true }], {
        feed: { linkId: asElementId("hwr-s3"), device: "none", label: '¾"', load: "2 GPM", elementIds: [asElementId("hwr-s3")] },
      }),
      { deviceKind: "recirc_pump" },
    );
    const wh = setPlumbingNodeMeta(
      makeNode("wh-1", "domestic_cold_water", "terminal", "WH-1", [{ text: "WH-1", bold: true }], {
        feed: { linkId: asElementId("cw-wh"), device: "none", label: '1¼"', elementIds: [asElementId("cw-wh")] },
        children: [lavHw, bv, cv, rp],
      }),
      { deviceKind: "water_heater", fixtureClass: "water_heater" },
    );
    const root = makeNode("wm-1", "domestic_cold_water", "source", "WM-1", [{ text: "WM-1", bold: true }, { text: "DOMESTIC WATER" }], {
      children: [wh, lavCw],
    });

    const layout = layoutWaterRiser([root], LEVELS_3);
    const words = itemTexts(layout.items);

    // Distinct HWR labels, devices, and legend
    expect(words).toContain("HOT WATER RETURN (HWR)");
    expect(words.some((w) => w.includes('¾" HWR') && w.includes("2 GPM"))).toBe(true);
    expect(words).toContain("RP-1");
    expect(words).toContain("CV-1");
    expect(words).toContain("BV-1");

    // Distinct line weight/pattern: CW solid medium, HW dashed medium, HWR dashed thin
    const pipeLines = layout.items.filter((it): it is Extract<OneLineItem, { shape: "line" }> => it.shape === "line" && it.nodeId.startsWith("pipe:"));
    expect(pipeLines.some((l) => !l.dashed && l.weight === "medium")).toBe(true); // CW
    expect(pipeLines.some((l) => l.dashed === true && l.weight === "medium")).toBe(true); // HW
    expect(pipeLines.some((l) => l.dashed === true && l.weight === "thin")).toBe(true); // DHWR

    // All three HWR loop devices are interactive nodes with ranges
    expect(layout.nodes.some((n) => n.id === "rp-1")).toBe(true);
    expect(layout.nodes.some((n) => n.id === "cv-1")).toBe(true);
    expect(layout.nodes.some((n) => n.id === "bv-1")).toBe(true);
    expect(layout.ranges?.["rp-1"]).toBeDefined();
    expect(layout.ranges?.["cv-1"]).toBeDefined();
    expect(layout.ranges?.["bv-1"]).toBeDefined();
  });

  it("renders Expansion Tank (ET-1) and Buffer Tank (BT-1) off CW/HW headers with zero pipe gaps", () => {
    const et = setPlumbingNodeMeta(
      makeNode("et-1", "domestic_cold_water", "terminal", "ET-1", [{ text: "ET-1", bold: true }], {
        feed: { linkId: asElementId("cw-et"), device: "none", label: '¾"', elementIds: [asElementId("cw-et")] },
      }),
      { deviceKind: "expansion_tank", fixtureClass: "expansion_tank" },
    );
    const bt = setPlumbingNodeMeta(
      makeNode("bt-1", "domestic_hot_water", "terminal", "BT-1", [{ text: "BT-1", bold: true }, { text: "80 GAL" }], {
        feed: { linkId: asElementId("hw-bt"), device: "none", label: '1½"', elementIds: [asElementId("hw-bt")] },
      }),
      { deviceKind: "buffer_tank", fixtureClass: "buffer_tank" },
    );
    const lavHw = makeNode("lav-hw", "domestic_hot_water", "terminal", "L-1", [{ text: "L-1", bold: true }, { text: "1.5 WFU" }], {
      elementId: asElementId("lav-1"),
      feed: { linkId: asElementId("hw-l1"), device: "none", label: '½"', load: "1.5 WFU", elementIds: [asElementId("hw-l1")] },
    });
    const wh = setPlumbingNodeMeta(
      makeNode("wh-1", "domestic_cold_water", "terminal", "WH-1", [{ text: "WH-1", bold: true }], {
        feed: { linkId: asElementId("cw-wh"), device: "none", label: '1½"', elementIds: [asElementId("cw-wh")] },
        children: [bt, lavHw],
      }),
      { deviceKind: "water_heater", fixtureClass: "water_heater" },
    );
    const root = makeNode("wm-1", "domestic_cold_water", "source", "WM-1", [{ text: "WM-1", bold: true }], {
      children: [wh, et],
    });

    const layout = layoutWaterRiser([root], LEVELS_1);
    const words = itemTexts(layout.items);
    expect(words).toContain("ET-1");
    expect(words).toContain("BT-1");

    // Verify ET-1 has its dashed bladder curve and a continuous vertical drop pipe touching its top dome (zero gap!)
    const etBladder = layout.items.find((it) => it.shape === "polyline" && it.nodeId === "et-1" && it.dashed === true);
    expect(etBladder).toBeDefined();
    const etShell = layout.items.find((it) => it.shape === "polyline" && it.nodeId === "et-1" && it.closed === true && it.points.length === 8);
    expect(etShell && etShell.shape === "polyline").toBe(true);
    if (etShell && etShell.shape === "polyline") {
      const tankTopY = Math.max(...etShell.points.map((p) => p.y));
      const etPipe = layout.items.find(
        (it) => it.shape === "line" && it.nodeId.startsWith("pipe:et-1:") && Math.abs(it.points[0].x - it.points[1].x) < 0.05,
      );
      expect(etPipe && etPipe.shape === "line").toBe(true);
      if (etPipe && etPipe.shape === "line") {
        const pipeBottomY = Math.min(etPipe.points[0].y, etPipe.points[1].y);
        expect(Math.abs(pipeBottomY - tankTopY)).toBeLessThan(0.05);
      }
    }

    // Verify BT-1 vertical HW drop pipe lands flush on BT-1 top dome (zero gap!)
    const btShell = layout.items.find((it) => it.shape === "polyline" && it.nodeId === "bt-1" && it.closed === true && it.points.length === 8);
    expect(btShell && btShell.shape === "polyline").toBe(true);
    if (btShell && btShell.shape === "polyline") {
      const btTopY = Math.max(...btShell.points.map((p) => p.y));
      const btPipe = layout.items.find(
        (it) => it.shape === "line" && it.nodeId.startsWith("pipe:bt-1:") && Math.abs(it.points[0].x - it.points[1].x) < 0.05,
      );
      expect(btPipe && btPipe.shape === "line").toBe(true);
      if (btPipe && btPipe.shape === "line") {
        const pipeBottomY = Math.min(btPipe.points[0].y, btPipe.points[1].y);
        expect(Math.abs(pipeBottomY - btTopY)).toBeLessThan(0.05);
      }
    }
  });

  it("renders distinct ASPE symbols for full backflow taxonomy (RPZ, DCVA, PVB, AVB, Air Gap) and PRV via semantic metadata and name fallback", () => {
    const devSpec: Array<{ id: string; name: string; metaKind?: Parameters<typeof setPlumbingNodeMeta>[1]["deviceKind"] }> = [
      // Semantic metadata overrides generic mark "BFP-1"
      { id: "dev-rpz", name: "BFP-1", metaKind: "rpz" },
      { id: "dev-dcva", name: "BFP-2", metaKind: "dcva" },
      { id: "dev-pvb", name: "BFP-3", metaKind: "pvb" },
      { id: "dev-avb", name: "AVB-1" }, // name fallback
      { id: "dev-ag", name: "AG-1", metaKind: "air_gap" },
      { id: "dev-prv", name: "PRV-1" }, // name fallback
    ];

    const devices = devSpec.map((d) => {
      const n = makeNode(d.id, "domestic_cold_water", "device", d.name, [{ text: d.name, bold: true }], {
        feed: { linkId: asElementId(`seg-${d.id}`), device: "none", label: '2"', elementIds: [asElementId(`seg-${d.id}`)] },
      });
      return d.metaKind ? setPlumbingNodeMeta(n, { deviceKind: d.metaKind }) : n;
    });
    expect(classifyPlumbingDevice(devices[0]!)).toBe("rpz");
    expect(classifyPlumbingDevice(devices[1]!)).toBe("dcva");
    expect(classifyPlumbingDevice(devices[2]!)).toBe("pvb");
    expect(classifyPlumbingDevice(devices[3]!)).toBe("avb");
    expect(classifyPlumbingDevice(devices[4]!)).toBe("air_gap");
    expect(classifyPlumbingDevice(devices[5]!)).toBe("prv");

    const fix = makeNode("hb-1", "domestic_cold_water", "terminal", "HB-1", [{ text: "HB-1", bold: true }, { text: "2.5 WFU" }], {
      feed: { linkId: asElementId("seg-hb"), device: "none", label: '¾"', load: "2.5 WFU", elementIds: [asElementId("seg-hb")] },
    });
    const root = makeNode("wm-1", "domestic_cold_water", "source", "WM-1", [{ text: "WM-1", bold: true }], {
      children: [...devices, fix],
    });

    const layout = layoutWaterRiser([root], LEVELS_1);
    const itemsOf = (id: string) => layout.items.filter((it) => it.nodeId === id);

    // RPZ has 2 closed check triangles + vertical relief drop + relief funnel polyline (>= 4 geometry items)
    expect(itemsOf("dev-rpz").filter((i) => i.shape !== "text").length).toBeGreaterThanOrEqual(4);
    // DCVA has 2 closed check triangles + end bar (NO relief drop below y - 2.4)
    const dcvaGeom = itemsOf("dev-dcva").filter((i) => i.shape !== "text");
    expect(dcvaGeom.filter((i) => i.shape === "polyline" && i.closed === true).length).toBe(2);
    // PVB has isolation ticks + vertical stem + umbrella hood (>= 5 geometry items)
    expect(itemsOf("dev-pvb").filter((i) => i.shape !== "text").length).toBeGreaterThanOrEqual(5);
    // AVB has compact hood over neck (3 geometry items)
    expect(itemsOf("dev-avb").filter((i) => i.shape !== "text").length).toBe(3);
    // Air Gap has nozzle + separate open receptor funnel below (4 geometry items)
    expect(itemsOf("dev-ag").filter((i) => i.shape !== "text").length).toBe(4);
    // PRV has bowtie + stem + domed spring bonnet (4 geometry items)
    expect(itemsOf("dev-prv").filter((i) => i.shape !== "text").length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. DWV Riser Upgrades: Multi-Drain, Multi-Stack, Semantic Classification
// ---------------------------------------------------------------------------

describe("WS-3.3 DWV Riser: Multi-Drain, Multi-Stack & Semantic Fixture Classification", () => {
  it("renders Sanitary + Grease Waste (heavy + GI) + Storm (roof drain) together without dropping secondary drainage roots", () => {
    const wc = setPlumbingNodeMeta(
      makeNode("wc-1", "sanitary", "terminal", "P01-1", [{ text: "P01-1", bold: true }, { text: "4 DFU" }], {
        elementId: asElementId("fix-wc"),
        feed: { linkId: asElementId("san-1"), device: "none", label: '4"', load: "4 DFU", slope: '1/8"/FT', elementIds: [asElementId("san-1")] },
      }),
      { fixtureClass: "water_closet" },
    );
    const lav = setPlumbingNodeMeta(
      makeNode("lav-1", "sanitary", "terminal", "P02-1", [{ text: "P02-1", bold: true }, { text: "1 DFU" }], {
        elementId: asElementId("fix-lav"),
        feed: { linkId: asElementId("san-2"), device: "none", label: '2"', load: "1 DFU", slope: '1/4"/FT', elementIds: [asElementId("san-2")] },
      }),
      { fixtureClass: "lavatory" },
    );
    const sanRoot = makeNode("root:san", "sanitary", "source", "TO SEWER", [{ text: "SANITARY", bold: true }, { text: "TO SEWER" }], {
      children: [wc, lav],
    });
    const ventLav = makeNode("v-lav", "vent", "terminal", "P02-1", [{ text: "P02-1", bold: true }], {
      elementId: asElementId("fix-lav"),
      feed: { linkId: asElementId("vent-1"), device: "none", label: '2"', elementIds: [asElementId("vent-1")] },
    });
    const ventRoot = makeNode("root:vent", "vent", "source", "THRU ROOF", [{ text: "VENT", bold: true }, { text: "THRU ROOF" }], {
      children: [ventLav],
    });

    const sk3 = setPlumbingNodeMeta(
      makeNode("sk-3", "grease_waste", "terminal", "K-3C", [{ text: "K-3C", bold: true }, { text: "4 DFU" }], {
        elementId: asElementId("fix-sk3"),
        feed: { linkId: asElementId("gw-1"), device: "none", label: '3"', load: "4 DFU", slope: '1/4"/FT', elementIds: [asElementId("gw-1")] },
      }),
      { fixtureClass: "sink" },
    );
    const giRoot = setPlumbingNodeMeta(
      makeNode("gi-1", "grease_waste", "source", "GI-1", [{ text: "GREASE WASTE", bold: true }, { text: "GI-1" }], {
        children: [sk3],
      }),
      { deviceKind: "grease_interceptor" },
    );

    const rd1 = setPlumbingNodeMeta(
      makeNode("rd-1", "storm", "terminal", "RD-1", [{ text: "RD-1", bold: true }, { text: "45 GPM" }], {
        elementId: asElementId("fix-rd1"),
        levelId: "lvl-3",
        at: { x: 0, y: 0, z: 24 * FT },
        feed: { linkId: asElementId("st-1"), device: "none", label: '4"', load: "45 GPM", elementIds: [asElementId("st-1")] },
      }),
      { fixtureClass: "roof_drain" },
    );
    const stormRoot = makeNode("root:storm", "storm", "source", "TO STORM", [{ text: "STORM", bold: true }, { text: "TO STORM" }], {
      children: [rd1],
    });

    const roots = [sanRoot, ventRoot, giRoot, stormRoot];
    expect(hasMergedDwvRoots(roots)).toBe(true);

    const layout = layoutPipingRiser(roots, LEVELS_3);
    const words = itemTexts(layout.items);

    // ALL THREE drainage systems rendered cleanly (none dropped!)
    expect(words).toContain("P01-1");
    expect(words).toContain("P02-1");
    expect(words).toContain("K-3C");
    expect(words).toContain("GI-1");
    expect(words).toContain("RD-1");
    expect(words).toContain("TO SEWER");
    expect(words).toContain("TO STORM");
    expect(words.some((w) => w.includes("TO SEWER VIA GI-1"))).toBe(true);

    // Legend includes all three drainage systems + Vent
    expect(words).toContain("SANITARY DRAIN (SAN)");
    expect(words).toContain("GREASE WASTE (GW)");
    expect(words).toContain("STORM DRAIN (ST)");
    expect(words).toContain("SANITARY VENT (V)");

    // Grease Waste uses heavy lineweight
    const gwLines = layout.items.filter((it): it is Extract<OneLineItem, { shape: "line" }> => it.shape === "line" && it.nodeId.includes("gi-1:main"));
    expect(gwLines.some((l) => l.weight === "heavy")).toBe(true);

    // Semantic fixture classification sorted P01-1 (water_closet) LEFT of P02-1 (lavatory) AND triggered IPC 912 wet-vent note even without /^WC/i or /^LAV/i marks!
    const xWc = layout.nodes.find((n) => n.id === "wc-1")!.center.x;
    const xLav = layout.nodes.find((n) => n.id === "lav-1")!.center.x;
    expect(xWc).toBeLessThan(xLav);
    expect(words.some((w) => w.includes("P01-1 HORIZONTALLY WET-VENTED VIA LAVATORY DRAINS PER IPC 912"))).toBe(true);
  });

  it("supports multi-stack / multi-wing shafts (West Wing S-1/V-1 + East Wing S-2/V-2 at separate horizontal X zones)", () => {
    const mkFix = (id: string, mark: string, lvl: "lvl-1" | "lvl-2" | "lvl-3", z: number, x: number, cls: "water_closet" | "lavatory") =>
      setPlumbingNodeMeta(
        makeNode(id, "sanitary", "terminal", mark, [{ text: mark, bold: true }, { text: cls === "water_closet" ? "4 DFU" : "1 DFU" }], {
          elementId: asElementId(id),
          levelId: lvl,
          at: { x, y: 0, z },
          feed: { linkId: asElementId(`seg-${id}`), device: "none", label: cls === "water_closet" ? '3"' : '2"', load: cls === "water_closet" ? "4 DFU" : "1 DFU", slope: '1/8"/FT', elementIds: [asElementId(`seg-${id}`)] },
        }),
        { fixtureClass: cls },
      );

    // West Wing (x = 0): L1 + L2 + L3 branch into Stack S-1
    const westBranch = makeNode("br-west", "sanitary", "branch", "West Stack", [], {
      levelId: "lvl-1",
      at: { x: 0, y: 0, z: 0 },
      feed: { linkId: asElementId("bd-west"), device: "none", label: '4"', load: "15 DFU", slope: '1/8"/FT', elementIds: [asElementId("bd-west")] },
      children: [
        mkFix("w-wc-1", "WC-W1", "lvl-1", 0, 0, "water_closet"),
        mkFix("w-lav-1", "L-W1", "lvl-1", 0, 1000, "lavatory"),
        mkFix("w-wc-2", "WC-W2", "lvl-2", 12 * FT, 0, "water_closet"),
        mkFix("w-lav-2", "L-W2", "lvl-2", 12 * FT, 1000, "lavatory"),
        mkFix("w-wc-3", "WC-W3", "lvl-3", 24 * FT, 0, "water_closet"),
      ],
    });

    // East Wing (x = 20m): L1 + L2 + L3 branch into Stack S-2
    const eastBranch = makeNode("br-east", "sanitary", "branch", "East Stack", [], {
      levelId: "lvl-1",
      at: { x: 20_000, y: 0, z: 0 },
      feed: { linkId: asElementId("bd-east"), device: "none", label: '4"', load: "15 DFU", slope: '1/8"/FT', elementIds: [asElementId("bd-east")] },
      children: [
        mkFix("e-wc-1", "WC-E1", "lvl-1", 0, 20_000, "water_closet"),
        mkFix("e-lav-1", "L-E1", "lvl-1", 0, 21_000, "lavatory"),
        mkFix("e-wc-2", "WC-E2", "lvl-2", 12 * FT, 20_000, "water_closet"),
        mkFix("e-lav-2", "L-E2", "lvl-2", 12 * FT, 21_000, "lavatory"),
        mkFix("e-wc-3", "WC-E3", "lvl-3", 24 * FT, 20_000, "water_closet"),
      ],
    });

    const sanRoot = makeNode("root:san-multi", "sanitary", "source", "TO SEWER", [{ text: "SANITARY", bold: true }, { text: "TO SEWER" }], {
      children: [westBranch, eastBranch],
    });
    const ventRoot = makeNode("root:vent-multi", "vent", "source", "VTR-1", [{ text: "VENT", bold: true }, { text: "THRU ROOF" }], {
      levelId: "lvl-3",
      at: { x: 0, y: 0, z: 24 * FT },
      children: [
        makeNode("vw1", "vent", "terminal", "L-W1", [{ text: "L-W1" }], { elementId: asElementId("w-lav-1"), levelId: "lvl-1", at: { x: 1000, y: 0, z: 0 }, feed: { linkId: asElementId("v-w1"), device: "none", label: '2"', elementIds: [asElementId("v-w1")] } }),
        makeNode("vw2", "vent", "terminal", "L-W2", [{ text: "L-W2" }], { elementId: asElementId("w-lav-2"), levelId: "lvl-2", at: { x: 1000, y: 0, z: 12 * FT }, feed: { linkId: asElementId("v-w2"), device: "none", label: '2"', elementIds: [asElementId("v-w2")] } }),
        makeNode("ve1", "vent", "terminal", "L-E1", [{ text: "L-E1" }], { elementId: asElementId("e-lav-1"), levelId: "lvl-1", at: { x: 21_000, y: 0, z: 0 }, feed: { linkId: asElementId("v-e1"), device: "none", label: '2"', elementIds: [asElementId("v-e1")] } }),
        makeNode("ve2", "vent", "terminal", "L-E2", [{ text: "L-E2" }], { elementId: asElementId("e-lav-2"), levelId: "lvl-2", at: { x: 21_000, y: 0, z: 12 * FT }, feed: { linkId: asElementId("v-e2"), device: "none", label: '2"', elementIds: [asElementId("v-e2")] } }),
      ],
    });

    const layout = layoutDwvRiser([sanRoot, ventRoot], LEVELS_3);
    const words = itemTexts(layout.items);

    // Both stacks S-1 and S-2 AND both vent stacks V-1 and V-2 labeled
    expect(words).toContain("S-1");
    expect(words).toContain("S-2");
    expect(words).toContain("V-1");
    expect(words).toContain("V-2");

    // Two distinct vertical soil stack lines at strictly separated X positions
    const s1Line = layout.items.find((it) => it.shape === "line" && it.nodeId.startsWith("pipe:root:san-multi:stack:1:"));
    const s2Line = layout.items.find((it) => it.shape === "line" && it.nodeId.startsWith("pipe:root:san-multi:stack:2:"));
    expect(s1Line && s1Line.shape === "line").toBe(true);
    expect(s2Line && s2Line.shape === "line").toBe(true);
    if (s1Line && s1Line.shape === "line" && s2Line && s2Line.shape === "line") {
      expect(s2Line.points[0].x - s1Line.points[0].x).toBeGreaterThan(40);
    }

    // Two distinct vertical vent stack lines at strictly separated X positions
    const v1Line = layout.items.find((it) => it.shape === "line" && it.nodeId.startsWith("pipe:root:san-multi:vstack:1:"));
    const v2Line = layout.items.find((it) => it.shape === "line" && it.nodeId.startsWith("pipe:root:san-multi:vstack:2:"));
    expect(v1Line && v1Line.shape === "line").toBe(true);
    expect(v2Line && v2Line.shape === "line").toBe(true);
    if (v1Line && v1Line.shape === "line" && v2Line && v2Line.shape === "line") {
      expect(v2Line.points[0].x - v1Line.points[0].x).toBeGreaterThan(40);
    }
  });

  it("propagates semantic fixture & device metadata from PartTypeDefinition through plumbingDiagramGraph", () => {
    const b = new Building();
    const wcType = makePartType(
      "Water closet, flushometer",
      "plumbing_fixture",
      [{ id: "w", label: "Waste", domain: "pipe", systemKind: "sanitary", position: [0, 0, 0], direction: [1, 0, 0], shape: "none", flow: 4 }],
      { default_connection_type: "WC-FV" },
    );
    const rpzType = makePartType(
      "Backflow preventer, reduced pressure zone",
      "pipe_accessory",
      [
        { id: "in", label: "In", domain: "pipe", systemKind: "domestic_cold_water", position: [-100, 0, 0], direction: [-1, 0, 0], shape: "none", flowDirection: "in" },
        { id: "out", label: "Out", domain: "pipe", systemKind: "domestic_cold_water", position: [100, 0, 0], direction: [1, 0, 0], shape: "none", flowDirection: "out" },
      ],
      { default_connection_type: "RPZ" },
    );
    b.ok({ type: "place_part", partId: "p-wc", typeId: "t-wc", partType: wcType, levelId: "lvl-1", position: { x: 0, y: 0 }, mark: "FIX-99" });
    b.ok({ type: "route_run", idPrefix: "san", levelId: "lvl-1", domain: "pipe", size: { shape: "pipe", nominalMm: 4 * IN, material: "pvc" }, system: { id: "sys-san", kind: "sanitary", name: "Sanitary" }, points: [{ x: 10 * FT, y: 0 }], from: { kind: "part", partId: "p-wc", connectorId: "w" } });
    b.ok({ type: "place_part", partId: "p-rpz", typeId: "t-rpz", partType: rpzType, levelId: "lvl-1", position: { x: 5 * FT, y: 10 * FT }, mark: "DEV-77" });
    b.ok({ type: "route_run", idPrefix: "cw-in", levelId: "lvl-1", domain: "pipe", size: { shape: "pipe", nominalMm: 2 * IN, material: "copper" }, system: { id: "sys-cw", kind: "domestic_cold_water", name: "Cold Water" }, points: [{ x: 0, y: 10 * FT }], from: { kind: "part", partId: "p-rpz", connectorId: "in" } });
    b.ok({ type: "route_run", idPrefix: "cw-out", levelId: "lvl-1", domain: "pipe", size: { shape: "pipe", nominalMm: 2 * IN, material: "copper" }, system: { id: "sys-cw", kind: "domestic_cold_water", name: "Cold Water" }, points: [{ x: 12 * FT, y: 10 * FT }], from: { kind: "part", partId: "p-rpz", connectorId: "out" } });

    const graph = plumbingDiagramGraph(b.head.elements, { systemKinds: ["sanitary", "domestic_cold_water"] });
    const allNodes: DiagramNode[] = [];
    const walk = (n: DiagramNode) => {
      allNodes.push(n);
      for (const c of n.children) walk(c);
    };
    for (const r of graph.roots) walk(r);

    const wcNode = allNodes.find((n) => n.elementId === "p-wc");
    const rpzNode = allNodes.find((n) => n.elementId === "p-rpz");
    expect(wcNode).toBeDefined();
    expect(rpzNode).toBeDefined();
    // Despite non-standard marks ("FIX-99", "DEV-77"), semantic metadata classifies them accurately!
    expect(classifyPlumbingFixture(wcNode!)).toBe("water_closet");
    expect(classifyPlumbingDevice(rpzNode!)).toBe("rpz");
  });
});

// ---------------------------------------------------------------------------
// 4. Isometric Layout Upgrades: Inline Device Labels, Azimuths & Floor Datums
// ---------------------------------------------------------------------------

describe("WS-3.4 Isometric Layout: Labeled Devices, Configurable Azimuths & Floor Datums", () => {
  it("labels inline devices (meter, RPZ, gas regulator, SOV, cleanout) with thin leaders when displaced, while leaving anonymous reducers unlabeled", () => {
    const meter = setPlumbingNodeMeta(
      makeNode("mtr-1", "domestic_cold_water", "device", "MTR-1", [{ text: "MTR-1", bold: true }], { at: { x: 0, y: 0, z: 3 * FT } }),
      { deviceKind: "water_meter" },
    );
    const rpz = setPlumbingNodeMeta(
      makeNode("rpz-1", "domestic_cold_water", "device", "RPZ-1", [{ text: "RPZ-1", bold: true }], { at: { x: 2 * FT, y: 0, z: 3 * FT } }),
      { deviceKind: "rpz" },
    );
    const reg = setPlumbingNodeMeta(
      makeNode("lr-1", "natural_gas", "device", "LR-1", [{ text: "LR-1", bold: true }], { at: { x: 2 * FT, y: 0, z: 3 * FT + 100 } }),
      { deviceKind: "gas_regulator" },
    );
    const sov = setPlumbingNodeMeta(
      makeNode("sov-1", "domestic_cold_water", "device", "Ball valve, full port", [{ text: "BALL VALVE, FULL PORT" }], { at: { x: 6 * FT, y: 0, z: 3 * FT } }),
      { deviceKind: "shutoff_valve" },
    );
    const co = setPlumbingNodeMeta(
      makeNode("co-1", "sanitary", "device", "Cleanout (wye + plug)", [{ text: "CLEANOUT (WYE + PLUG)" }], { at: { x: 10 * FT, y: 0, z: 0 } }),
      { deviceKind: "cleanout" },
    );
    const reducer = makeNode("red-1", "domestic_cold_water", "device", "Reducer", [], { at: { x: 8 * FT, y: 0, z: 3 * FT } });
    const root = makeNode("src-1", "domestic_cold_water", "source", "SERVICE", [{ text: "SERVICE", bold: true }], {
      at: { x: -2 * FT, y: 0, z: 3 * FT },
      children: [meter, rpz, reg, sov, reducer, co],
    });
    const pipes: DiagramPipe[] = [
      { elementId: asElementId("p-1"), systemKind: "domestic_cold_water", a: { x: -2 * FT, y: 0, z: 3 * FT }, b: { x: 10 * FT, y: 0, z: 3 * FT } },
    ];

    const iso = layoutPipingIsometric([root], pipes);
    const words = itemTexts(iso.items);

    expect(words).toContain("MTR-1");
    expect(words).toContain("RPZ-1");
    expect(words).toContain("LR-1");
    expect(words).toContain("SOV");
    expect(words).toContain("CO");
    expect(words).not.toContain("REDUCER");

    // Because rpz-1 and lr-1 sit nearly co-located, placeLabel displaces the second label and emits a thin leader line!
    const hasDisplacedLeader = iso.items.some((it) => it.shape === "line" && it.weight === "thin" && (it.nodeId === "lr-1" || it.nodeId === "rpz-1"));
    expect(hasDisplacedLeader).toBe(true);
  });

  it("supports all four viewing azimuths (sw, se, nw, ne) with vertical stacks preserved and optional floor datum lines via hints", () => {
    const s = stackRisers();
    const makeIsoView = (id: string, hints: Record<string, unknown>): ViewElement => ({
      id: asElementId(id),
      version: 0,
      authoredRev: {},
      kind: "view",
      name: `Iso ${id}`,
      viewType: "detail",
      cropMin: { x: 0, y: 0 },
      cropMax: { x: 1000, y: 1000 },
      props: { diagram: { kind: "plumbing_isometric", hints: hints as DiagramHints } },
    });

    const swEv = evaluateDiagram(s.head.elements, makeIsoView("v-iso-sw", { azimuth: "sw" }))!;
    const seEv = evaluateDiagram(s.head.elements, makeIsoView("v-iso-se", { azimuth: "se" }))!;
    const nwEv = evaluateDiagram(s.head.elements, makeIsoView("v-iso-nw", { azimuth: "nw" }))!;
    const neEv = evaluateDiagram(s.head.elements, makeIsoView("v-iso-ne", { azimuth: "ne" }))!;

    // All four azimuths render valid piping AND produce distinct projected coordinates for non-origin fixtures
    const boxPos = (ev: DiagramEvaluation, id: string) => {
      const b = ev.boxes.find((x) => x.elementId === id && !x.pipe);
      if (!b) throw new Error(`missing box ${id}`);
      return `${Math.round(b.min.x)},${Math.round(b.min.y)}`;
    };
    const positions = new Set([boxPos(swEv, "san-wc-3-1"), boxPos(seEv, "san-wc-3-1"), boxPos(nwEv, "san-wc-3-1"), boxPos(neEv, "san-wc-3-1")]);
    expect(positions.size).toBe(4);

    // Vertical riser stays strictly vertical in EVERY azimuth
    for (const ev of [swEv, seEv, nwEv, neEv]) {
      const riser = ev.boxes.find((x) => x.pipe && x.elementId === "cw-s1");
      expect(riser && Math.abs(riser.max.x - riser.min.x)).toBeLessThan(3);
      // Cleanout inline device CO is now labeled on the isometric!
      expect(evalTexts(ev)).toContain("CO");
    }

    // Optional light floor datum reference lines & elevations
    const datumEv = evaluateDiagram(s.head.elements, makeIsoView("v-iso-datums", { azimuth: "se", showFloorDatums: true }))!;
    const datumWords = evalTexts(datumEv);
    expect(datumWords.some((w) => w.includes("LEVEL 1") && w.includes("0'-0\""))).toBe(true);
    expect(datumWords.some((w) => w.includes("LEVEL 2") && w.includes("12'-0\""))).toBe(true);
    expect(datumWords.some((w) => w.includes("LEVEL 3") && w.includes("24'-0\""))).toBe(true);
    // Floor datum lines are light dashed lines ordered strictly upward (L3 > L2 > L1)
    const datumLines = datumEv.items.filter(
      (i) => i.shape === "line" && i.lineStyle?.weight === "thin" && i.lineStyle?.pattern === "dashed" && Math.abs(i.points[0]!.y - i.points[1]!.y) < 0.05,
    );
    expect(datumLines.length).toBeGreaterThanOrEqual(3);
  });
});
