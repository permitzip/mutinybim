/**
 * @jest-environment node
 *
 * WS-6 (#210): Bedrock Governance in bim-kernel:
 * 1. Dual public/private work notes on determinations/requirement states + `decisionImpactsFor`.
 * 2. Drafting/detail view `linkedElementIds` / `linkedSystemIds` + `linkedDetailImpacts`.
 * 3. Discipline-neutral `auditEquipmentRequirements(model)` fulfillment & drift audit.
 */
import {
  DEFAULT_SETTINGS,
  EQUIPMENT_BASELINE_PARAM,
  GRAPH_DETERMINATIONS_FEATURE,
  GRAPH_REQUIREMENT_STATES_FEATURE,
  GRAPH_RULES_FEATURE,
  asElementId,
  auditEquipmentRequirements,
  commandSchema,
  decisionImpactsFor,
  executeCommand,
  linkedDetailImpacts,
  publicDeterminationElement,
  serializeEquipmentBaseline,
  stripPrivateNotes,
  withUpgradePolicy,
  type BimElement,
  type Command,
  type DeterminationElement,
  type ModelState,
  type PartTypeDefinition,
  type Revision,
  type ViewElement,
} from "../src";

const ALL_GRAPH_FEATURES = new Set([
  GRAPH_DETERMINATIONS_FEATURE,
  GRAPH_RULES_FEATURE,
  GRAPH_REQUIREMENT_STATES_FEATURE,
]);

function runCmd(model: ModelState, raw: Command): ModelState {
  const parsed = commandSchema.parse(raw);
  const res = withUpgradePolicy(
    (f) => ALL_GRAPH_FEATURES.has(f),
    () => executeCommand(model, parsed),
  );
  if (!res.ok) throw new Error(`Command ${raw.type} failed: ${res.error.message}`);
  return res.model;
}

const SIMPLE_EQUIP_TYPE: PartTypeDefinition = {
  familyName: "Equipment",
  typeName: "Generic unit",
  category: "mechanical_equipment",
  typeParams: [],
  typeValues: {},
  instanceParams: [
    { name: "weight", label: "Operating weight", kind: "number", unit: "lb", min: 0 },
    { name: "load_va", label: "Load", kind: "number", unit: "va", min: 0 },
    { name: "flow_rate", label: "Flow rate", kind: "number", unit: "cfm", min: 0 },
    { name: EQUIPMENT_BASELINE_PARAM, label: "Requirement baseline", kind: "text" },
  ],
  connectors: [
    { id: "power", label: "Power", domain: "electrical", systemKind: "power", shape: "none", position: [0, 0, 0], direction: [1, 0, 0] },
    { id: "air_out", label: "Exhaust", domain: "duct", systemKind: "exhaust", shape: "round", diameter: 250, position: [0, 0, 900], direction: [0, 0, 1] },
  ],
  geometry: [{ kind: "box", center: [0, 0, 450], size: [600, 600, 900] }],
  symbol: [{ kind: "rect", center: [0, 0], size: [600, 600] }],
  tagFields: ["mark"],
  source: { kind: "builtin", libraryVersion: "test@1" },
};

function baseModel(): ModelState {
  const els: BimElement[] = [
    { id: asElementId("L1"), version: 1, authoredRev: {}, kind: "level", name: "Level 1", elevationMm: 0 } as unknown as BimElement,
    {
      id: asElementId("S101"),
      version: 1,
      authoredRev: {},
      kind: "space",
      levelId: asElementId("L1"),
      name: "Prep Room",
      number: "101",
      bounds: {
        kind: "outline",
        outline: [
          { x: 0, y: 0 },
          { x: 6000, y: 0 },
          { x: 6000, y: 6000 },
          { x: 0, y: 6000 },
        ],
      },
    } as unknown as BimElement,
    {
      id: asElementId("type:eq"),
      version: 1,
      authoredRev: {},
      kind: "part_type",
      definition: SIMPLE_EQUIP_TYPE,
    } as unknown as BimElement,
    {
      id: asElementId("P-1"),
      version: 1,
      authoredRev: {},
      kind: "part",
      typeId: asElementId("type:eq"),
      levelId: asElementId("L1"),
      position: { x: 2000, y: 2000 },
      offsetMm: 0,
      rotationDeg: 0,
      mark: "EQ-1",
      values: { weight: 450, load_va: 12000, flow_rate: 800 },
    } as unknown as BimElement,
    {
      id: asElementId("SEG-1"),
      version: 1,
      authoredRev: {},
      kind: "run_segment",
      domain: "pipe",
      systemId: asElementId("sys-condensate"),
      levelId: asElementId("L1"),
      start: { x: 0, y: 0, z: 3000 },
      end: { x: 4000, y: 0, z: 3000 },
      size: { shape: "pipe", nominalMm: 25, material: "copper" },
      links: {},
      branches: [],
      flow: 0,
    } as unknown as BimElement,
  ];
  return {
    modelId: "ws6-kernel-test",
    revision: 1 as Revision,
    elements: Object.fromEntries(els.map((e) => [e.id, e])),
    connections: [],
    settings: DEFAULT_SETTINGS,
  };
}

describe("WS-6 Pillar 1: Decision provenance, dual public/private notes & decisionImpactsFor", () => {
  it("records and supersedes determinations with dual public/private notes and strips privateNote for public exports", () => {
    let m = baseModel();
    m = runCmd(m, {
      type: "record_determination",
      determinationId: "DET-1",
      subject: { kind: "element", id: "P-1" },
      key: "equipment_sizing",
      value: 12000,
      unit: "VA",
      title: "EQ-1 design sizing basis",
      reasoning: "Sized per 2021 table and architectural layout.",
      publicNote: "Sized per 2021 code table and revised architectural layout.",
      privateNote: "Client PM Sarah approved via Oct 12 call; hold budget under $8k.",
      decidedBy: "K. Engineer",
      confidence: "high",
    });

    const det = m.elements["DET-1"] as DeterminationElement;
    expect(det.determination.publicNote).toBe("Sized per 2021 code table and revised architectural layout.");
    expect(det.determination.privateNote).toBe("Client PM Sarah approved via Oct 12 call; hold budget under $8k.");

    const sanitizedBody = stripPrivateNotes(det.determination);
    expect("privateNote" in sanitizedBody).toBe(false);
    expect(sanitizedBody.publicNote).toBe("Sized per 2021 code table and revised architectural layout.");

    const sanitizedEl = publicDeterminationElement(det);
    expect(sanitizedEl.determination.privateNote).toBeUndefined();
    expect(sanitizedEl.determination.publicNote).toBe("Sized per 2021 code table and revised architectural layout.");

    // Supersede the decision and verify old status becomes superseded while new carries updated notes.
    m = runCmd(m, {
      type: "supersede_determination",
      determinationId: "DET-1",
      newDeterminationId: "DET-2",
      value: 15000,
      unit: "VA",
      title: "EQ-1 updated sizing basis",
      reasoning: "Updated after vendor cut-sheet revision.",
      publicNote: "Upsized per Rev B cut-sheet.",
      privateNote: "Internal QA note: verify panel capacity before permit submittal.",
      decidedBy: "K. Engineer",
      confidence: "high",
    });

    const impacts = decisionImpactsFor(m, ["P-1"]);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toEqual({
      id: "DET-2",
      kind: "determination",
      subjectId: "P-1",
      key: "equipment_sizing",
      title: "EQ-1 updated sizing basis",
      status: "recorded",
      publicNote: "Upsized per Rev B cut-sheet.",
    });
    expect("privateNote" in impacts[0]!).toBe(false);
  });

  it("finds active determinations (direct, input ref, enclosing space), local rules, and requirement states while excluding inactive records", () => {
    let m = baseModel();
    // Direct determination on space S101 (which encloses P-1 at (2000, 2000))
    m = runCmd(m, {
      type: "record_determination",
      determinationId: "DET-SPACE",
      subject: { kind: "space", id: "S101" },
      key: "occupancy",
      value: "B",
      title: "Prep Room occupancy classification",
      reasoning: "Classified as Group B.",
      publicNote: "Group B per architectural code matrix.",
      privateNote: "Confidential tenant lease exhibit A.",
      decidedBy: "A. Architect",
      confidence: "high",
    });

    // Determination on model referencing P-1 in inputs[]
    m = runCmd(m, {
      type: "record_determination",
      determinationId: "DET-INPUT",
      subject: { kind: "model" },
      key: "basis_input",
      value: "rev-2",
      title: "System basis derived from EQ-1",
      inputs: [{ key: "load_va", elementId: "P-1", value: 12000 }],
      reasoning: "Derived from EQ-1 nameplate.",
      decidedBy: "A. Architect",
      confidence: "medium",
    });

    // Local rule anchored to P-1 via appliesAt.anchors
    m = runCmd(m, {
      type: "add_local_rule",
      rule: {
        ruleId: "local.eq1-clearance",
        citation: { instrument: "LOCAL", edition: "2024", section: "4.2" },
        title: "Maintain 36 in service clearance around EQ-1",
        summary: "Minimum working clearance required in front of EQ-1.",
        discipline: "general",
        applies: {},
        appliesAt: { anchors: [{ kind: "element", id: "P-1" }] },
        reads: [],
        produces: [],
        verification: { status: "verified" },
        publicNote: "Confirmed with AHJ inspector.",
        privateNote: "Internal field memo #99.",
      },
    });

    // Requirement state anchored to S101 (directly attached to model elements)
    const reqState: BimElement = {
      id: asElementId("requirement_state:test1"),
      version: 1,
      authoredRev: {},
      kind: "requirement_state",
      state: {
        requirementId: "local:local.r1:arch.exit_count:S101",
        status: "overridden",
        value: 2,
        unit: "1",
        reason: "Owner requested second egress door",
        publicNote: "Dual egress provided for operational flow.",
        privateNote: "Internal cost delta discussed with owner.",
        by: "A. Architect",
      },
    } as unknown as BimElement;
    m = { ...m, elements: { ...m.elements, [reqState.id]: reqState } };

    const impacts = decisionImpactsFor(m, ["P-1"]);
    const ids = impacts.map((i) => i.id);
    expect(ids).toContain("DET-INPUT");
    expect(ids).toContain("DET-SPACE");
    expect(ids).toContain("rule:local.eq1-clearance");
    expect(ids).toContain("requirement_state:test1");
    for (const item of impacts) {
      expect("privateNote" in item).toBe(false);
    }
    const ruleImpact = impacts.find((i) => i.id === "rule:local.eq1-clearance");
    expect(ruleImpact).toMatchObject({
      kind: "rule",
      subjectId: "P-1",
      key: "local.eq1-clearance",
      status: "verified",
      publicNote: "Confirmed with AHJ inspector.",
    });
  });
});

describe("WS-6 Pillar 2: Detail view element/system linkage & staleness alerts", () => {
  it("stores, updates, and clears linkedElementIds and linkedSystemIds on views and detects staleness on edit/delete", () => {
    let m = baseModel();
    m = runCmd(m, {
      type: "create_view",
      viewId: "V-DET-CURB",
      name: "Equipment Curb & Drain Pan Detail",
      viewType: "detail",
      props: {
        linkedElementIds: ["P-1", "P-1"], // deduped
        linkedSystemIds: ["sys-condensate"],
      },
    });

    const view = m.elements["V-DET-CURB"] as ViewElement;
    expect(view.props?.linkedElementIds).toEqual(["P-1"]);
    expect(view.props?.linkedSystemIds).toEqual(["sys-condensate"]);

    // Direct element modification triggers staleness alert
    const elImpacts = linkedDetailImpacts(m, ["P-1"]);
    expect(elImpacts).toHaveLength(1);
    expect(elImpacts[0]).toMatchObject({
      viewId: "V-DET-CURB",
      viewName: "Equipment Curb & Drain Pan Detail",
      matchedElementIds: ["P-1"],
      matchedSystemIds: [],
      deletedElementIds: [],
    });
    expect(elImpacts[0]!.notice).toContain("Equipment Curb & Drain Pan Detail");

    // Modifying a run segment belonging to the linked system triggers system staleness alert
    const sysImpacts = linkedDetailImpacts(m, ["SEG-1"]);
    expect(sysImpacts).toHaveLength(1);
    expect(sysImpacts[0]).toMatchObject({
      viewId: "V-DET-CURB",
      matchedElementIds: ["SEG-1"],
      matchedSystemIds: ["sys-condensate"],
      deletedElementIds: [],
    });

    // Deleting a linked element reports it in deletedElementIds and in the notice
    const delImpacts = linkedDetailImpacts(m, ["P-1"], { deletedElementIds: ["P-1"] });
    expect(delImpacts[0]!.deletedElementIds).toEqual(["P-1"]);
    expect(delImpacts[0]!.notice).toContain("1 deleted");

    // Unrelated element triggers no alert
    expect(linkedDetailImpacts(m, ["S101"])).toEqual([]);

    // Updating and clearing via set_view_properties preserves backward compatibility
    m = runCmd(m, {
      type: "set_view_properties",
      viewId: "V-DET-CURB",
      props: { linkedElementIds: null, linkedSystemIds: [] },
    });
    const cleared = m.elements["V-DET-CURB"] as ViewElement;
    expect(cleared.props?.linkedElementIds).toBeUndefined();
    expect(cleared.props?.linkedSystemIds).toBeUndefined();
    expect(linkedDetailImpacts(m, ["P-1", "SEG-1"])).toEqual([]);
  });
});

describe("WS-6 Pillar 3A: Pure kernel auditEquipmentRequirements", () => {
  it("reports unplaced equipment, unconnected required systems, missing load coverage, and parameter drift", () => {
    const baselineUnplaced = serializeEquipmentBaseline({
      mark: "EQ-UNPLACED",
      values: { weight: 300, load_va: 5000 },
      requiredServices: ["power"],
      requiredLoadServices: ["power"],
      loadKeys: ["load_va"],
      requiresLoad: true,
    });
    const baselinePlacedDrifted = serializeEquipmentBaseline({
      mark: "EQ-DRIFT",
      values: { weight: 600, load_va: 10000, flow_rate: 1200 },
      requiredServices: ["power", "exhaust_air"],
      requiredLoadServices: ["power"],
      loadKeys: ["load_va"],
      requiresLoad: true,
    });
    const baselineClean = serializeEquipmentBaseline({
      mark: "EQ-CLEAN",
      values: { weight: 250, load_va: 4000 },
      requiredServices: ["power"],
      requiredLoadServices: ["power"],
      loadKeys: ["load_va"],
      requiresLoad: true,
    });

    const m: ModelState = {
      modelId: "ws6-audit",
      revision: 1 as Revision,
      settings: DEFAULT_SETTINGS,
      connections: [],
      elements: {
        L1: { id: asElementId("L1"), version: 1, authoredRev: {}, kind: "level", name: "Level 1", elevationMm: 0 } as unknown as BimElement,
        "type:eq": { id: asElementId("type:eq"), version: 1, authoredRev: {}, kind: "part_type", definition: SIMPLE_EQUIP_TYPE } as unknown as BimElement,
        // 1. Unplaced planned part (also missing from loads)
        "P-UNPLACED": {
          id: asElementId("P-UNPLACED"),
          version: 1,
          authoredRev: {},
          kind: "part",
          typeId: asElementId("type:eq"),
          levelId: asElementId("L1"),
          position: { x: 0, y: 0 },
          offsetMm: 0,
          rotationDeg: 0,
          mark: "EQ-UNPLACED",
          values: { weight: 300, load_va: 5000, [EQUIPMENT_BASELINE_PARAM]: baselineUnplaced },
          planned: { levelHint: asElementId("L1"), note: "Planned item" },
        } as unknown as BimElement,
        // 2. Placed part: connected to neither power nor exhaust_air, missing from loads, and weight + load_va drifted!
        "P-DRIFT": {
          id: asElementId("P-DRIFT"),
          version: 1,
          authoredRev: {},
          kind: "part",
          typeId: asElementId("type:eq"),
          levelId: asElementId("L1"),
          position: { x: 1000, y: 1000 },
          offsetMm: 0,
          rotationDeg: 0,
          mark: "EQ-DRIFT",
          values: { weight: 750, load_va: 14000, flow_rate: 1200, [EQUIPMENT_BASELINE_PARAM]: baselinePlacedDrifted },
        } as unknown as BimElement,
        // 3. Placed, connected via service_link, covered in loads, zero drift!
        "SL-CLEAN": {
          id: asElementId("SL-CLEAN"),
          version: 1,
          authoredRev: {},
          kind: "service_link",
          trade: "electrical",
          adapter: "electrical",
          role: "branch",
          source: { elementId: asElementId("SRC-1"), port: "bus", positions: [1] },
          members: [{ elementId: asElementId("P-CLEAN"), connector: "power" }],
          description: "Circuit 1",
        } as unknown as BimElement,
        "P-CLEAN": {
          id: asElementId("P-CLEAN"),
          version: 1,
          authoredRev: {},
          kind: "part",
          typeId: asElementId("type:eq"),
          levelId: asElementId("L1"),
          position: { x: 3000, y: 1000 },
          offsetMm: 0,
          rotationDeg: 0,
          mark: "EQ-CLEAN",
          values: { weight: 250, load_va: 4000, [EQUIPMENT_BASELINE_PARAM]: baselineClean },
          served: { power: asElementId("SL-CLEAN") },
        } as unknown as BimElement,
      },
    };

    const report = auditEquipmentRequirements(m);
    expect(report.summary).toEqual({
      totalTracked: 3,
      placedCount: 2,
      unplacedCount: 1,
      unconnectedCount: 2,
      missingFromLoadsCount: 2,
      driftCount: 2,
      clean: false,
    });

    expect(report.findings.filter((f) => f.kind === "unplaced_equipment")).toHaveLength(1);
    expect(report.findings.filter((f) => f.kind === "unconnected_system").map((f) => f.service)).toEqual(["exhaust_air", "power"]);
    expect(report.findings.filter((f) => f.kind === "missing_from_loads").map((f) => f.mark)).toEqual(["EQ-DRIFT", "EQ-UNPLACED"]);
    const drifts = report.findings.filter((f) => f.kind === "parameter_drift");
    expect(drifts).toHaveLength(2);
    expect(drifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mark: "EQ-DRIFT", parameter: "load_va", plannedValue: 10000, modeledValue: 14000 }),
        expect.objectContaining({ mark: "EQ-DRIFT", parameter: "weight", plannedValue: 600, modeledValue: 750 }),
      ]),
    );
    // EQ-CLEAN should have zero findings
    expect(report.findings.filter((f) => f.mark === "EQ-CLEAN")).toEqual([]);
  });
});
