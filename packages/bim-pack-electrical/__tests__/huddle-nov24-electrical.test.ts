import { DEFAULT_SETTINGS, asRevision, commandSchema, executeCommand, type ModelState } from "@permitzip/bim-kernel";
import { electricalDiagramGraph, electricalStarterTypes } from "../src";

function emptyModel(id: string): ModelState {
  return { modelId: id, revision: asRevision(0), elements: {}, connections: [], settings: DEFAULT_SETTINGS };
}

function run(model: ModelState, raw: Record<string, unknown>): ModelState {
  const res = executeCommand(model, commandSchema.parse(raw));
  if (!res.ok) throw new Error(`Command ${String(raw.type)} failed: ${res.error.message}`);
  return res.model;
}

describe("Nov 24 huddle electrical features", () => {
  it("provides floor-hosted floor boxes (duplex and quad) and clean wall-hosted quad receptacles", () => {
    const types = electricalStarterTypes("1.0.0");
    const floorDuplex = types.find((t) => t.id === "builtin:floor-receptacle@1");
    const floorQuad = types.find((t) => t.id === "builtin:floor-receptacle-quad@1");
    const wallQuad = types.find((t) => t.id === "builtin:quad-receptacle@1");

    expect(floorDuplex?.definition.hosting).toBe("floor");
    expect(floorQuad?.definition.hosting).toBe("floor");
    expect(wallQuad?.definition.hosting).toBe("wall_face");
    expect(floorQuad?.definition.instanceParams.find((p) => p.name === "load")?.default).toBe(360);
    // Floor boxes sit flush at the slab (top z <= 5 mm), not vertical wall plates.
    for (const g of floorDuplex?.definition.geometry ?? []) {
      if (g.kind === "box" && typeof g.center[2] === "number" && typeof g.size[2] === "number") {
        expect(g.center[2] + g.size[2] / 2).toBeLessThanOrEqual(5);
      }
    }
  });

  it("filters one-line diagram loads by minBreakerA and equipment by phaseScope", () => {
    let model = emptyModel("m-sld");
    model = run(model, { type: "create_level", levelId: "lvl-1", name: "Level 1", elevationMm: 0 });
    const types = electricalStarterTypes("1.0.0");
    const panelDef = types.find((t) => t.id === "builtin:panelboard-225-mcb@1")!.definition;
    const rtuDef = {
      familyName: "Rooftop unit",
      typeName: "RTU",
      category: "mechanical_equipment",
      typeParams: [],
      typeValues: {},
      instanceParams: [],
      connectors: [
        {
          id: "power",
          label: "Power",
          domain: "electrical",
          systemKind: "power",
          position: [0, 0, 0],
          direction: [0, 0, -1],
          shape: "none",
          voltage: 208,
          poles: 3,
          flow: 10000,
        },
      ],
      geometry: [{ kind: "box", center: [0, 0, 500], size: [1000, 1000, 1000] }],
      symbol: [{ kind: "rect", center: [0, 0], size: [1000, 1000], pen: "medium" }],
      tagFields: ["mark"],
      source: { kind: "builtin", libraryVersion: "1.0.0" },
    };
    model = run(model, { type: "place_part", partId: "mdp", typeId: "pt-panel", partType: panelDef, position: { x: 0, y: 0 }, levelId: "lvl-1", mark: "MDP" });
    model = run(model, { type: "place_part", partId: "rtu-small", typeId: "pt-rtu", partType: rtuDef, position: { x: 2000, y: 0 }, levelId: "lvl-1", mark: "RTU-30A" });
    model = run(model, { type: "place_part", partId: "rtu-big", typeId: "pt-rtu", position: { x: 4000, y: 0 }, levelId: "lvl-1", mark: "RTU-80A" });

    model = run(model, {
      type: "create_service_link",
      linkId: "lnk-30",
      sourceId: "mdp",
      positions: [1, 3, 5],
      members: [{ elementId: "rtu-small" }],
      electrical: { ratingA: 30 },
    });
    model = run(model, {
      type: "create_service_link",
      linkId: "lnk-80",
      sourceId: "mdp",
      positions: [2, 4, 6],
      members: [{ elementId: "rtu-big" }],
      electrical: { ratingA: 80 },
    });

    // Without minBreakerA, both 30A and 80A loads appear when showLoads is true.
    const full = electricalDiagramGraph(model.elements, { showLoads: true });
    expect(full.roots[0]?.children.map((c) => c.elementId).sort()).toEqual(["rtu-big", "rtu-small"]);

    // With minBreakerA: 60, only the 80A unit appears (30A is hidden).
    const filtered = electricalDiagramGraph(model.elements, { showLoads: true, minBreakerA: 60 });
    expect(filtered.roots[0]?.children.map((c) => c.elementId)).toEqual(["rtu-big"]);

    // Per-equipment includeEquipmentIds pins a <60A unit onto the diagram, and excludeEquipmentIds hides a >=60A unit.
    const overridden = electricalDiagramGraph(model.elements, {
      showLoads: true,
      minBreakerA: 60,
      includeEquipmentIds: ["rtu-small"],
      excludeEquipmentIds: ["rtu-big"],
    });
    expect(overridden.roots[0]?.children.map((c) => c.elementId)).toEqual(["rtu-small"]);

    // Mark MDP as existing and rtu-small as existing + demolished; rtu-big is new work.
    model = run(model, { type: "set_element_phases", ids: ["mdp", "rtu-small"], phaseCreated: "phase-existing" });
    model = run(model, { type: "demolish_elements", ids: ["rtu-small"] });

    // New work scope hides demolished equipment.
    const newGraph = electricalDiagramGraph(model.elements, { showLoads: true, phaseScope: "new" });
    expect(newGraph.roots[0]?.children.map((c) => c.elementId)).toEqual(["rtu-big"]);

    // Demolition scope shows existing/demolished equipment and marks demolished items.
    const demoGraph = electricalDiagramGraph(model.elements, { showLoads: true, phaseScope: "demolition" });
    expect(demoGraph.roots[0]?.children.map((c) => c.elementId)).toEqual(["rtu-small"]);
    expect(demoGraph.roots[0]?.children[0]?.lines.some((l) => l.text.includes("DEMOLISHED"))).toBe(true);
  });
});
