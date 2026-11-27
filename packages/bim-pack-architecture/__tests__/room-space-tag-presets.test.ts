/**
 * @jest-environment node
 *
 * Starter tag types for rooms and spaces (issue #39): each Architecture preset
 * makes a style whose tag, placed on a sample room or space, prints the
 * expected text. Occupancy is not covered: rooms store no occupant count and
 * tags have no reader for a space's occupants yet.
 *
 * Fails without the change: `general.room_area` and `general.space_name` are
 * not registered, so `tagStylePreset` returns null.
 */
import {
  DEFAULT_SETTINGS,
  asElementId,
  commandSchema,
  createTagStyleFromPreset,
  executeCommand,
  tagLines,
  tagStylePreset,
  type DrawingItem,
  type ModelState,
  type Room,
  withUpgradePolicy,
} from "@permitzip/bim-kernel";
import { PackSet, withPackSet } from "@permitzip/bim-kernel/packs";
import { ARCHITECTURE_PACK } from "../src";

const FT = 304.8;
const rect = (x0: number, y0: number, w: number, h: number) => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];

/** A peer that advertises what this release stores (the up-to-date model server), as the room and space tag tests do. */
function run(model: ModelState, command: Record<string, unknown> & { type: string }): ModelState {
  const r = withUpgradePolicy(
    () => true,
    () => executeCommand(model, commandSchema.parse(command)),
  );
  if (!r.ok) throw new Error(r.error.message);
  return { ...r.model, revision: (model.revision + 1) as ModelState["revision"] };
}

const room: Room = { id: asElementId("rm-101"), version: 1, authoredRev: {}, kind: "room", number: "101", name: "Office", outline: rect(0, 0, 20 * FT, 10 * FT), areaSqM: 0, partition: { level: "L1", zone: "*", discipline: "architecture" } };

/** A room made through the editor: it stores its area, and the outline (10 x 10 ft, 100 SF) is deliberately not the same, so only the stored value prints 200 SF. */
const storedRoom: Room = { ...room, id: asElementId("rm-102"), number: "102", name: "Studio", outline: rect(0, 30 * FT, 10 * FT, 10 * FT), areaSqM: 18.58 };

function sample(): ModelState {
  let m: ModelState = { modelId: "room-space-tags", revision: 0 as ModelState["revision"], elements: { [room.id]: room, [storedRoom.id]: storedRoom }, connections: [], settings: DEFAULT_SETTINGS };
  m = run(m, { type: "create_level", levelId: "lvl-1", name: "L1", elevationMm: 0 });
  m = run(m, { type: "create_space", spaces: [{ spaceId: "sp-1", number: "102", name: "Classroom", levelId: "lvl-1", outline: rect(30 * FT, 0, 30 * FT, 20 * FT) }] });
  return m;
}

/** Make the preset's style, tag the element with it and read the tag's text. */
function tagText(m: ModelState, presetId: string, elementId: string, units?: "mm"): string[] | null {
  const preset = withPackSet(PackSet.create([ARCHITECTURE_PACK]), () => tagStylePreset(presetId));
  if (!preset) throw new Error(`no preset ${presetId}`);
  const style = createTagStyleFromPreset({ ...preset, ...(units ? { units } : {}) }, "tst-style", []);
  let next = run(m, style);
  next = run(next, { type: "add_drawing_item", itemId: "t1", ownerId: "plan", shape: "tag", points: [{ x: 0, y: 0 }], tag: { elementId, template: "fields", leader: false, styleId: "tst-style" } });
  const item = next.elements["t1"] as DrawingItem;
  return tagLines(next, item.tag!);
}

describe("starter tag presets for rooms and spaces", () => {
  let base: ModelState;
  beforeAll(() => {
    base = run(sample(), { type: "create_view", viewId: "plan", name: "Plan", viewType: "floor_plan", props: { level: "lvl-1", scale: 48 } });
  });

  it("room name and number", () => {
    expect(tagText(base, "general.room", "rm-101")).toEqual(["Office", "101"]);
  });

  it("room name, number and area", () => {
    expect(tagText(base, "general.room_area", "rm-101")).toEqual(["Office", "101", "200 SF"]);
  });

  it("room area reads the stored area, not the outline", () => {
    expect(tagText(base, "general.room_area", "rm-102")).toEqual(["Studio", "102", "200 SF"]);
  });

  it("space name and number", () => {
    expect(tagText(base, "general.space_name", "sp-1")).toEqual(["Classroom", "102"]);
  });

  it("space name, number and area", () => {
    expect(tagText(base, "general.space", "sp-1")).toEqual(["Classroom", "102", "600 SF"]);
  });

  it("area follows the style's units: square metres when metric", () => {
    expect(tagText(base, "general.room_area", "rm-101", "mm")).toEqual(["Office", "101", "18.6 m²"]);
  });
});
