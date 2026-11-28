/**
 * @jest-environment node
 *
 * WS-4 (#208): First-party MEP materials library (`plumbing_gas.*` via
 * `MATERIAL_POINT`) and cut-sheet-based realistic multi-primitive plumbing &
 * fuel-gas starter parts with valid connectors, clearances, and engineering
 * parameters.
 */
import {
  allMaterials,
  builtinPartType,
  builtinPartTypes,
  DEFAULT_SETTINGS,
  executeCommand,
  materialOf,
  materialRowProblems,
  partTypeImportReport,
  partTypeIssues,
  resolveElementMaterial,
  type Command,
  type ModelState,
} from "@permitzip/bim-kernel";
import { PLUMBING_MATERIALS } from "../src/materials";
import { plumbingSourceRole, plumbingStarterTypes } from "../src";

const EXPECTED_MATERIAL_IDS = [
  "plumbing_gas.copper_type_l",
  "plumbing_gas.brass_bronze",
  "plumbing_gas.cast_iron_dwv",
  "plumbing_gas.black_steel",
  "plumbing_gas.stainless_304",
  "plumbing_gas.pvc_white",
  "plumbing_gas.cpvc_cream",
  "plumbing_gas.pex_blue",
  "plumbing_gas.pex_red",
  "plumbing_gas.csst_yellow",
  "plumbing_gas.pipe_insulation_asj",
  "plumbing_gas.equipment_enamel_blue",
  "plumbing_gas.equipment_enamel_grey",
  "plumbing_gas.vitreous_china",
  "plumbing_gas.chrome_fixture",
] as const;

const NEW_COMMERCIAL_SLUGS = [
  "gas-meter",
  "roof-drain",
  "overflow-roof-drain",
  "booster-pump",
  "buffer-tank",
  "water-softener",
  "condensate-neutralizer",
  "mixing-valve",
  "trap-primer",
  "sump-pump",
  "dcva",
  "pvb",
] as const;

const UPGRADED_KEY_SLUGS = [
  "water-heater-tank",
  "water-heater-gas-tankless",
  "recirc-pump",
  "grease-interceptor",
  "gas-regulator",
  "wc-flushometer",
  "lavatory",
  "rpz",
] as const;

const mustPart = (slug: string) => {
  const entry = builtinPartType(`builtin:plumbing-${slug}@1`);
  if (!entry) throw new Error(`missing builtin:plumbing-${slug}@1`);
  return entry;
};

describe("WS-4 first-party MEP materials library", () => {
  it("contributes all 15 plumbing_gas.* materials via MATERIAL_POINT with zero schema problems", () => {
    expect(materialRowProblems(PLUMBING_MATERIALS)).toEqual([]);
    const registeredIds = new Set(allMaterials().map((m) => m.id));
    for (const id of EXPECTED_MATERIAL_IDS) {
      expect(registeredIds.has(id)).toBe(true);
      const mat = materialOf(id);
      expect(mat).not.toBeNull();
      expect(mat?.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("every starter plumbing part type's material_id resolves to a registered material", () => {
    const entries = plumbingStarterTypes("test").filter((e) => e.id.startsWith("builtin:plumbing-"));
    expect(entries.length).toBeGreaterThanOrEqual(50);
    for (const entry of entries) {
      const matId = entry.definition.typeValues.material_id;
      expect(typeof matId).toBe("string");
      expect(materialOf(String(matId))).not.toBeNull();
    }
  });

  it("resolveElementMaterial resolves a placed plumbing part's MEP material", () => {
    let model: ModelState = { modelId: "ws4-mat", revision: 0 as ModelState["revision"], elements: {}, connections: [], settings: DEFAULT_SETTINGS };
    const r1 = executeCommand(model, { type: "create_level", levelId: "lvl-1", name: "Level 1", elevationMm: 0 } as Command);
    if (!r1.ok) throw new Error(r1.error.message);
    model = r1.model;
    const gm = mustPart("gas-meter");
    const r2 = executeCommand(model, {
      type: "place_part",
      partId: "gm-1",
      typeId: gm.id,
      partType: gm.definition,
      levelId: "lvl-1",
      position: { x: 0, y: 0 },
      mark: "GM-1",
    } as Command);
    if (!r2.ok) throw new Error(r2.error.message);
    const placed = r2.model.elements["gm-1"];
    if (!placed || placed.kind !== "part") throw new Error("not placed");
    expect(resolveElementMaterial(r2.model, placed)?.id).toBe("plumbing_gas.equipment_enamel_grey");
    expect(plumbingSourceRole(r2.model.elements, placed)).toBe("gas_meter");
  });
});

describe("WS-4 cut-sheet-based realistic plumbing & gas starter parts", () => {
  it("all 12 new commercial parts and 8 upgraded key parts use multi-primitive geometry and pass schema + connector hygiene", () => {
    for (const slug of [...NEW_COMMERCIAL_SLUGS, ...UPGRADED_KEY_SLUGS]) {
      const entry = mustPart(slug);
      expect(entry.definition.geometry.length).toBeGreaterThanOrEqual(4);
      expect(partTypeIssues(entry.definition)).toEqual([]);
      const report = partTypeImportReport(entry.definition);
      expect({ id: entry.id, problems: report.problems }).toEqual({ id: entry.id, problems: [] });
    }
  });

  it("every offered built-in plumbing part passes partTypeIssues and partTypeImportReport cleanly", () => {
    const plumbingParts = builtinPartTypes().filter((e) => e.id.startsWith("builtin:plumbing-") || e.id === "builtin:water-closet-floor@1" || e.id === "builtin:lavatory-wall@1");
    expect(plumbingParts.length).toBeGreaterThanOrEqual(52);
    for (const entry of plumbingParts) {
      expect({ id: entry.id, issues: partTypeIssues(entry.definition) }).toEqual({ id: entry.id, issues: [] });
      expect({ id: entry.id, problems: partTypeImportReport(entry.definition).problems }).toEqual({ id: entry.id, problems: [] });
    }
  });

  it("preserves backward-compatible connector IDs on upgraded parts and adds condensing multi-trade ports", () => {
    expect(mustPart("water-heater-tank").definition.connectors.map((c) => c.id)).toEqual(expect.arrayContaining(["cw", "hw", "hwr", "g", "flue"]));
    expect(mustPart("water-heater-gas-tankless").definition.connectors.map((c) => c.id)).toEqual(expect.arrayContaining(["cw", "hw", "g", "flue", "intake", "condensate"]));
    expect(mustPart("recirc-pump").definition.connectors.map((c) => c.id)).toEqual(["in", "out", "power"]);
    expect(mustPart("grease-interceptor").definition.connectors.map((c) => c.id)).toEqual(["in", "out"]);
    expect(mustPart("gas-regulator").definition.connectors.map((c) => c.id)).toEqual(["in", "out"]);
    expect(mustPart("wc-flushometer").definition.connectors.map((c) => c.id)).toEqual(["cw", "w", "v"]);
    expect(mustPart("lavatory").definition.connectors.map((c) => c.id)).toEqual(["cw", "hw", "w", "v"]);
  });

  it("backflow preventers (rpz, dcva, pvb) carry backflow_kind, pressure_drop_psi, and service clearances", () => {
    for (const [slug, kind] of [
      ["rpz", "rpz"],
      ["dcva", "dcva"],
      ["pvb", "pvb"],
    ] as const) {
      const def = mustPart(slug).definition;
      expect(def.typeValues.backflow_kind).toBe(kind);
      expect(Number(def.typeValues.pressure_drop_psi)).toBeGreaterThan(0);
      expect((def.clearances ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("roof drains, pumps, buffer tank, softener, neutralizer, mixing valve, and trap primer expose key engineering params & ports", () => {
    const rd = mustPart("roof-drain").definition;
    expect(rd.instanceParams.some((p) => p.name === "roof_area_sqft")).toBe(true);
    expect(rd.connectors.find((c) => c.id === "out")?.systemKind).toBe("storm");
    expect(rd.connectors.find((c) => c.id === "out")?.endType).toBe("plumbing_gas.no_hub");

    const ord = mustPart("overflow-roof-drain").definition;
    expect(ord.typeValues.drain_role).toBe("overflow");
    expect(ord.typeValues.dam_height).toBeCloseTo(50.8, 1);

    const bp = mustPart("booster-pump").definition;
    expect(bp.connectors.map((c) => c.id)).toEqual(["in", "out", "power"]);
    expect(bp.typeValues.pump_rated_gpm).toBe(60);
    expect(bp.typeValues.pump_rated_head_ft).toBe(115);
    expect((bp.clearances ?? []).length).toBeGreaterThanOrEqual(1);

    const bt = mustPart("buffer-tank").definition;
    expect(bt.connectors.map((c) => c.id)).toEqual(expect.arrayContaining(["cw", "hw", "hwr", "drain", "tp_relief"]));
    expect((bt.clearances ?? []).length).toBeGreaterThanOrEqual(1);

    const ws = mustPart("water-softener").definition;
    expect(ws.connectors.map((c) => c.id)).toEqual(["in", "out", "w", "power"]);
    expect(ws.typeValues.pressure_drop_psi).toBe(15);
    expect((ws.clearances ?? []).some((z) => z.id === "salt_loading")).toBe(true);

    const cn = mustPart("condensate-neutralizer").definition;
    expect(cn.connectors.every((c) => c.systemKind === "condensate")).toBe(true);

    const tmv = mustPart("mixing-valve").definition;
    expect(tmv.connectors.map((c) => c.id)).toEqual(["cw", "hw", "out"]);
    expect(tmv.typeValues.pressure_drop_psi).toBe(5);

    const tp = mustPart("trap-primer").definition;
    expect(tp.connectors.map((c) => c.id)).toEqual(["cw", "out"]);

    const sp = mustPart("sump-pump").definition;
    expect(sp.connectors.map((c) => c.id)).toEqual(["out", "v", "power"]);
    expect(sp.connectors.find((c) => c.id === "out")?.systemKind).toBe("storm");
    expect(sp.connectors.find((c) => c.id === "v")?.systemKind).toBe("vent");
  });
});
