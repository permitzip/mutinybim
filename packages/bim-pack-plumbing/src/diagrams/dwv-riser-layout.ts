import { drainSystemKinds, oneLineItemsExtent, oneLineTextHeight } from "@permitzip/bim-kernel";
import type { DiagramEdge, DiagramNode, ElementId, OneLineItem, OneLineTextLine, Pen, RiserLevel, Vec2 } from "@permitzip/bim-kernel";
import { classifyPlumbingDevice, classifyPlumbingFixture, type PlumbingFixtureClass } from "./plumbing-topology";
import type { PipeRef, PipingLayout, PipingLayoutOptions } from "./piping-layout";

/**
 * ASPE / NCS-standard Drainage & Vent (DWV) Riser Diagram layout:
 * - Renders ALL drainage roots together (Sanitary, Grease Waste with baffled GI symbol & heavy line,
 *   Storm with roof drain funnels, Indirect Waste) instead of dropping secondary drainage systems.
 * - Supports multi-stack / multi-wing shafts (multiple vertical soil stacks & vent stacks across
 *   disjoint horizontal zones along the building drain) in addition to single-stack risers.
 * - Uses semantic fixture & device classification from `plumbing-topology.ts` (part family,
 *   connection type, drainage role) with name/mark fallbacks for legacy fixtures.
 * - Draws every physical fixture ONCE on its floor with SOLID gravity drains dropping through
 *   floor slabs (45° wye sweeps) and DASHED vents rising above flood-level rim to VTR cap(s).
 * - Preserves full two-way selection (`pipes`) and DiagramLayer dragging (`ranges`, `entries`).
 */

const ROW = 78;
const LEFT = 34;
const COL = 24;
const STACK_LANE = 22;
const BOX_W = 16;
const BOX_H = 9.5;
const WYE_MM = 2.8;
const TOLERANCE_MM = 1219;

const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

function bandOf(levels: readonly RiserLevel[], z: number | undefined, levelId: string | null): number {
  if (z === undefined) {
    const i = levels.findIndex((l) => l.id === levelId);
    return i >= 0 ? i : levels.length;
  }
  for (let i = 0; i < levels.length; i++) if ((levels[i] as RiserLevel).elevationMm <= z + TOLERANCE_MM) return i;
  return Math.max(0, levels.length - 1);
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const m = s.replace(/,/g, "").match(/[\d.]+/);
  return m ? Number(m[0]) : 0;
}

function formatLoad(n: number, service: string): string {
  const r = Math.round(n * 100) / 100;
  return service === "storm" ? `${r.toLocaleString("en-US")} GPM` : `${r.toLocaleString("en-US")} DFU`;
}

function isCapOrOpen(n: DiagramNode): boolean {
  const u = n.name.toUpperCase();
  return u === "CAP" || u === "OPEN END";
}

function collectTermIds(n: DiagramNode, out: Set<string>): void {
  if (n.role === "terminal" && n.elementId && !isCapOrOpen(n)) out.add(n.elementId);
  for (const c of n.children) collectTermIds(c, out);
}

function hasGraftedVent(n: DiagramNode): boolean {
  for (const c of n.children) {
    if (c.service === "vent" || hasGraftedVent(c)) return true;
  }
  return false;
}

/** True when `roots` has merged DWV systems (drain+vent sharing fixtures, grafted vent, or multiple drainage systems). */
export function hasMergedDwvRoots(roots: readonly DiagramNode[]): boolean {
  const drains = roots.filter((r) => drainSystemKinds().has(r.service));
  if (drains.length === 0) return false;
  if (drains.length > 1) return true;
  if (drains.some((d) => hasGraftedVent(d))) return true;
  const vents = roots.filter((r) => r.service === "vent");
  if (vents.length === 0) return false;
  const drainIds = new Set<string>();
  for (const d of drains) collectTermIds(d, drainIds);
  for (const v of vents) {
    const vIds = new Set<string>();
    collectTermIds(v, vIds);
    for (const id of Array.from(vIds)) {
      if (drainIds.has(id)) return true;
    }
  }
  return false;
}

function drainMetaOf(service: string): {
  readonly code: string;
  readonly weight: Pen;
  readonly dashed: boolean;
  readonly legendLabel: string;
  readonly defaultOutfall: string;
} {
  if (service === "grease_waste") {
    return { code: "GW", weight: "heavy", dashed: false, legendLabel: "GREASE WASTE (GW)", defaultOutfall: "TO GREASE INTERCEPTOR" };
  }
  if (service === "storm") {
    return { code: "ST", weight: "medium", dashed: false, legendLabel: "STORM DRAIN (ST)", defaultOutfall: "TO STORM" };
  }
  if (service === "indirect_waste") {
    return { code: "IW", weight: "medium", dashed: true, legendLabel: "INDIRECT WASTE (IW)", defaultOutfall: "TO INDIRECT RECEPTOR" };
  }
  return { code: "SAN", weight: "medium", dashed: false, legendLabel: "SANITARY DRAIN (SAN)", defaultOutfall: "TO SEWER" };
}

function fixtureSortRank(fc: PlumbingFixtureClass): number {
  switch (fc) {
    case "water_closet":
      return 0;
    case "urinal":
      return 1;
    case "lavatory":
      return 2;
    case "sink":
      return 3;
    case "shower_tub":
      return 4;
    case "floor_drain":
      return 5;
    case "roof_drain":
      return 6;
    default:
      return 7;
  }
}

interface DwvFixture {
  readonly key: string;
  readonly elementId: ElementId | null;
  readonly band: number;
  readonly node: DiagramNode;
  readonly sanEdge: DiagramEdge | undefined;
  readonly fixtureClass: PlumbingFixtureClass;
  ventNode?: DiagramNode;
  ventEdge?: DiagramEdge;
  stackIndex: number;
  readonly order: number;
}

interface FloorSanInfo {
  size?: string;
  slope?: string;
  loadNum: number;
  edge?: DiagramEdge;
  hasCap: boolean;
}

interface FloorVentInfo {
  size?: string;
  edge?: DiagramEdge;
}

interface WingData {
  readonly stackIndex: number;
  readonly label: string;
  readonly fixturesByBand: Map<number, DwvFixture[]>;
  readonly sanFloorInfo: Map<number, FloorSanInfo>;
  readonly ventFloorInfo: Map<number, FloorVentInfo>;
  readonly upperBands: number[];
  readonly maxFixtures: number;
  readonly hasVent: boolean;
  readonly ventedBands: number[];
  readonly ventRoot?: DiagramNode;
  readonly ventStackSize?: string;
  readonly ventStackEdge?: DiagramEdge;
}

function drawWyeSweep(items: OneLineItem[], x: number, y: number, dirX: 1 | -1, nodeId: string): void {
  items.push({
    shape: "line",
    points: [round({ x, y: y + WYE_MM }), round({ x: x + dirX * WYE_MM, y })],
    weight: "thin",
    nodeId,
  });
}

function drawCleanout(items: OneLineItem[], c: Vec2, nodeId: string, label = "CO"): void {
  items.push(
    { shape: "line", points: [round({ x: c.x, y: c.y }), round({ x: c.x, y: c.y + 3.2 })], weight: "medium", nodeId },
    { shape: "line", points: [round({ x: c.x - 1.8, y: c.y + 3.2 }), round({ x: c.x + 1.8, y: c.y + 3.2 })], weight: "heavy", nodeId },
    { shape: "text", at: round({ x: c.x - 5, y: c.y + 7.2 }), widthMm: 10, lines: [{ text: label, bold: true }], nodeId, role: "note", align: "center" },
  );
}

function drawBackwaterValve(items: OneLineItem[], c: Vec2, nodeId: string, label = "BWV"): void {
  const hw = 2.6;
  const hh = 2.0;
  items.push(
    { shape: "polyline", points: [round({ x: c.x - hw, y: c.y - hh }), round({ x: c.x + hw, y: c.y - hh }), round({ x: c.x + hw, y: c.y + hh }), round({ x: c.x - hw, y: c.y + hh })], closed: true, weight: "medium", nodeId },
    { shape: "line", points: [round({ x: c.x - hw * 0.6, y: c.y + hh }), round({ x: c.x + hw * 0.6, y: c.y - hh })], weight: "medium", nodeId },
    { shape: "text", at: round({ x: c.x - 6, y: c.y + hh + 3.4 }), widthMm: 12, lines: [{ text: label, bold: true }], nodeId, role: "note", align: "center" },
  );
}

/** ASPE Baffled Grease Interceptor tank symbol (`GI-1`). */
function drawGreaseInterceptor(items: OneLineItem[], c: Vec2, giNode: DiagramNode): void {
  const hw = 9;
  const hh = 5.5;
  items.push(
    {
      shape: "polyline",
      points: [
        round({ x: c.x - hw, y: c.y - hh }),
        round({ x: c.x + hw, y: c.y - hh }),
        round({ x: c.x + hw, y: c.y + hh }),
        round({ x: c.x - hw, y: c.y + hh }),
      ],
      closed: true,
      weight: "heavy",
      nodeId: giNode.id,
    },
    // Internal inlet & outlet grease-separation baffles
    { shape: "line", points: [round({ x: c.x - hw * 0.45, y: c.y + hh }), round({ x: c.x - hw * 0.45, y: c.y - hh * 0.35 })], weight: "thin", nodeId: giNode.id },
    { shape: "line", points: [round({ x: c.x + hw * 0.45, y: c.y - hh }), round({ x: c.x + hw * 0.45, y: c.y + hh * 0.35 })], weight: "thin", nodeId: giNode.id },
  );
  const firstLine = (giNode.lines[0]?.text ?? "").trim().toUpperCase();
  const mark = !firstLine || firstLine === "GREASE WASTE" || firstLine === "GREASE"
    ? (giNode.name || giNode.lines[1]?.text || "GI").toUpperCase()
    : firstLine;
  items.push({
    shape: "text",
    at: round({ x: c.x - hw + 1, y: c.y + 1.8 }),
    widthMm: hw * 2 - 2,
    lines: [{ text: mark, bold: true }],
    nodeId: giNode.id,
    role: "equipment",
    align: "center",
  });
}

/** ASPE Roof Drain / Overflow Drain funnel collector symbol for Storm risers. */
function drawRoofDrainSymbol(items: OneLineItem[], cx: number, botY: number, node: DiagramNode): void {
  const hw = 6.5;
  const topY = botY + 6.5;
  items.push(
    // Funneled roof drain bowl
    {
      shape: "polyline",
      points: [round({ x: cx - hw, y: topY }), round({ x: cx - 2.2, y: botY }), round({ x: cx + 2.2, y: botY }), round({ x: cx + hw, y: topY })],
      closed: true,
      weight: "medium",
      nodeId: node.id,
    },
    // Strainer dome arch above bowl
    {
      shape: "polyline",
      points: [round({ x: cx - hw * 0.7, y: topY }), round({ x: cx - hw * 0.4, y: topY + 2.2 }), round({ x: cx + hw * 0.4, y: topY + 2.2 }), round({ x: cx + hw * 0.7, y: topY })],
      weight: "thin",
      nodeId: node.id,
    },
  );
  const boxLines = node.lines.slice(0, 2);
  const textH = oneLineTextHeight(boxLines, BOX_W);
  items.push({
    shape: "text",
    at: round({ x: cx - BOX_W / 2, y: topY + 3.2 + textH }),
    widthMm: BOX_W,
    lines: boxLines,
    nodeId: node.id,
    role: "equipment",
    align: "center",
  });
}

function drawFlowArrow(items: OneLineItem[], tip: Vec2, dir: 1 | -1, nodeId: string): void {
  const len = 3.0;
  const half = 1.4;
  items.push({
    shape: "polyline",
    points: [round({ x: tip.x - dir * len, y: tip.y + half }), round(tip), round({ x: tip.x - dir * len, y: tip.y - half })],
    weight: "medium",
    nodeId,
  });
}

function drawVtrCap(items: OneLineItem[], at: Vec2, vtrNode: DiagramNode, sizeText: string, labelRight = false): void {
  items.push(
    {
      shape: "polyline",
      points: [round({ x: at.x - 5.5, y: at.y - 1.2 }), round({ x: at.x, y: at.y + 2.8 }), round({ x: at.x + 5.5, y: at.y - 1.2 })],
      weight: "medium",
      nodeId: vtrNode.id,
    },
    { shape: "line", points: [round({ x: at.x, y: at.y - 1.2 }), round({ x: at.x, y: at.y + 5.2 })], weight: "medium", dashed: true, nodeId: vtrNode.id },
  );
  const title = `${sizeText ? `${sizeText} ` : ""}${vtrNode.name.toUpperCase()}`;
  const sub = vtrNode.name.toUpperCase().includes("ROOF") ? "" : "THRU ROOF (VTR)";
  const lines: OneLineTextLine[] = [{ text: title, bold: true }, ...(sub ? [{ text: sub }] : [])];
  items.push({
    shape: "text",
    at: round({ x: labelRight ? at.x + 6.5 : at.x - 42, y: at.y + 5.6 }),
    widthMm: 35,
    lines,
    nodeId: vtrNode.id,
    role: "equipment",
    align: "center",
  });
}

export function layoutDwvRiser(roots: readonly DiagramNode[], levels: readonly RiserLevel[], opts: PipingLayoutOptions = {}): PipingLayout {
  const items: OneLineItem[] = [];
  const pipes: Record<string, PipeRef> = {};
  const ranges: Record<string, readonly [number, number]> = {};
  const entries: Record<string, Vec2> = {};
  const nodes: Array<{ id: string; kind: DiagramNode["kind"]; name: string; center: Vec2; depth: number }> = [];
  let usedUnknown = false;
  let pieceNo = 0;

  const band = (n: DiagramNode): number => {
    const b = bandOf(levels, n.at?.z, n.levelId);
    if (b >= levels.length) usedUnknown = true;
    return b;
  };

  const floorY = (b: number) => -(b + 1) * ROW;
  const fixtureBotY = (b: number) => floorY(b) + 12;
  const sanBranchY = (b: number) => floorY(b) - 14; // cleanly below floor slab
  const ventHeaderY = (b: number) => floorY(b) + 46; // >= 6" above flood-level rim, well below next floor's drain!

  const pipeSeg = (
    ownerId: string,
    ownerName: string,
    edge: DiagramEdge | undefined,
    a: Vec2,
    b: Vec2,
    dashed: boolean,
    weight: Pen = "medium",
    sysLabel?: string,
  ): { pa: Vec2; pb: Vec2 } | null => {
    const pa = round(a);
    const pb = round(b);
    if (Math.abs(pa.x - pb.x) < 0.01 && Math.abs(pa.y - pb.y) < 0.01) return null;
    const id = `pipe:${ownerId}:${pieceNo++}`;
    const ids = edge?.elementIds ?? (edge?.linkId ? [edge.linkId] : []);
    const kindWord = sysLabel ?? (dashed ? "Vent" : "Sanitary");
    if (ids[0]) pipes[id] = { elementId: ids[0], elementIds: ids, name: `${edge?.label ? `${edge.label} ` : ""}${kindWord} pipe${ownerName ? ` to ${ownerName}` : ""}` };
    items.push({ shape: "line", points: [pa, pb], weight, nodeId: id, ...(dashed ? { dashed: true } : {}) });
    return { pa, pb };
  };

  const labelText = (ownerId: string, lines: readonly string[], at: Vec2, widthMm: number, align?: "center") => {
    const clean = lines.filter(Boolean);
    if (clean.length === 0) return;
    items.push({
      shape: "text",
      at: round(at),
      widthMm,
      lines: clean.map((text) => ({ text })),
      nodeId: `pipe:${ownerId}:lbl:${pieceNo++}`,
      role: "device",
      ...(align ? { align } : {}),
    });
  };

  const labels = opts.labels ?? ["size", "load", "slope"];
  const showSize = labels.includes("size");
  const showLoad = labels.includes("load");
  const showSlope = labels.includes("slope");

  // Collect ALL drainage roots (Sanitary, Grease Waste, Storm, Indirect Waste) and ALL sibling vent roots!
  const drainRoots = roots.filter((r) => drainSystemKinds().has(r.service));
  const siblingVentRoots = roots.filter((r) => r.service === "vent");
  if (drainRoots.length === 0) {
    return { items, extent: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }, nodes, ranges, entries, pipes };
  }

  // Match each sibling vent root to the drainage root(s) whose physical fixtures it shares
  const drainTermSets = drainRoots.map((dr) => {
    const s = new Set<string>();
    collectTermIds(dr, s);
    return s;
  });
  const ventsForDrain = new Map<number, DiagramNode[]>();
  const matchedVents = new Set<DiagramNode>();
  for (const vr of siblingVentRoots) {
    const vIds = new Set<string>();
    collectTermIds(vr, vIds);
    let assigned = false;
    for (let di = 0; di < drainRoots.length; di++) {
      const dr = drainRoots[di]!;
      if (dr.service === "storm") continue;
      const dSet = drainTermSets[di]!;
      if (Array.from(vIds).some((id) => dSet.has(id))) {
        const arr = ventsForDrain.get(di) ?? [];
        arr.push(vr);
        ventsForDrain.set(di, arr);
        matchedVents.add(vr);
        assigned = true;
      }
    }
    if (!assigned) {
      const fallbackIdx = drainRoots.findIndex((d) => d.service !== "storm");
      if (fallbackIdx >= 0) {
        const arr = ventsForDrain.get(fallbackIdx) ?? [];
        arr.push(vr);
        ventsForDrain.set(fallbackIdx, arr);
        matchedVents.add(vr);
      }
    }
  }

  let originX = LEFT + 14;
  const drawnServices = new Set<string>();
  let anyVentDrawn = false;

  for (let drainIdx = 0; drainIdx < drainRoots.length; drainIdx++) {
    const drainRoot = drainRoots[drainIdx]!;
    const dm = drainMetaOf(drainRoot.service);
    drawnServices.add(drainRoot.service);
    const attachedVentRoots: DiagramNode[] = [...(ventsForDrain.get(drainIdx) ?? [])];

    const fixturesByKey = new Map<string, DwvFixture>();
    const cleanouts: DiagramNode[] = [];
    const backwaterValves: DiagramNode[] = [];
    let greaseInterceptorNode: DiagramNode | null = null;
    let outfallNode: DiagramNode | null = null;
    let mainDrainEdge: DiagramEdge | undefined;
    let mainDrainSize: string | undefined;
    let mainDrainSlope: string | undefined;
    let totalDfuNum = 0;
    let orderSeq = 0;

    // Collect any grafted vent subtrees embedded inside the drain tree
    const graftedVentSubtrees: Array<{ readonly hostFixtureId: string; readonly ventNodes: readonly DiagramNode[] }> = [];

    // First pass: find all active bands in this drainage root so we know bottomBand before assigning stack wings
    const allDrainBands = new Set<number>([band(drainRoot)]);
    const scanBands = (list: readonly DiagramNode[]) => {
      for (const s of list) {
        if (s.service === "vent") continue;
        allDrainBands.add(band(s));
        if (s.children.length > 0) scanBands(s.children);
      }
    };
    scanBands(drainRoot.children);
    const drainBottomBand = Math.max(...Array.from(allDrainBands));

    const subtreeHasUpperFixture = (n: DiagramNode): boolean => {
      if (n.service === "vent") return false;
      const b = band(n);
      if (n.role === "terminal" && !isCapOrOpen(n)) {
        const dk = classifyPlumbingDevice(n);
        if (dk !== "sewer_connection" && dk !== "cleanout" && dk !== "grease_interceptor" && b < drainBottomBand) {
          return true;
        }
      }
      return n.children.some((c) => subtreeHasUpperFixture(c));
    };

    const rawFloorInfoByStack = new Map<number, Map<number, FloorSanInfo>>();
    const ensureStackFloor = (stackIdx: number, b: number): FloorSanInfo => {
      let map = rawFloorInfoByStack.get(stackIdx);
      if (!map) {
        map = new Map();
        rawFloorInfoByStack.set(stackIdx, map);
      }
      let info = map.get(b);
      if (!info) {
        info = { loadNum: 0, hasCap: false };
        map.set(b, info);
      }
      return info;
    };

    let nextStackId = 0;
    const stackOrderMap = new Map<number, number>();

    const walkDrain = (list: readonly DiagramNode[], topLevel: boolean, activeStack: number) => {
      let lastEdge: DiagramEdge | undefined;
      for (const s of list) {
        if (s.service === "vent") continue;
        const b = band(s);
        if (s.feed) {
          const dfu = parseNum(s.feed.load);
          if (topLevel) {
            if (!mainDrainEdge) mainDrainEdge = s.feed;
            if (!mainDrainSize && s.feed.label) mainDrainSize = s.feed.label;
            if (!mainDrainSlope && s.feed.slope) mainDrainSlope = s.feed.slope;
            if (dfu > totalDfuNum) {
              totalDfuNum = dfu;
              mainDrainEdge = s.feed;
              if (s.feed.label) mainDrainSize = s.feed.label;
              if (s.feed.slope) mainDrainSlope = s.feed.slope;
            }
          }
        }
        if (s.role === "device") {
          if (s.lines.length === 0) {
            if (s.feed?.label) lastEdge = s.feed;
            continue;
          }
          const dk = classifyPlumbingDevice(s);
          if (dk === "cleanout") cleanouts.push(s);
          else if (dk === "grease_interceptor") greaseInterceptorNode = s;
          else if (dk === "backwater_valve") backwaterValves.push(s);
          else if (dk === "sewer_connection") outfallNode = s;
          continue;
        }
        const eff = s.feed?.label ? s.feed : (lastEdge ?? s.feed);
        lastEdge = undefined;
        if (s.role === "terminal") {
          if (isCapOrOpen(s)) {
            if (s.name.toUpperCase() === "CAP") ensureStackFloor(Math.max(0, activeStack), b).hasCap = true;
            continue;
          }
          const dk = classifyPlumbingDevice(s);
          if (dk === "sewer_connection") {
            outfallNode = s;
            continue;
          }
          if (dk === "grease_interceptor") {
            greaseInterceptorNode = s;
            continue;
          }
          if (dk === "cleanout") {
            cleanouts.push(s);
            continue;
          }
          if (dk === "backwater_valve") {
            backwaterValves.push(s);
            continue;
          }
          const key = `${b}:${s.elementId ?? s.id}`;
          const fc = classifyPlumbingFixture(s);
          if (!fixturesByKey.has(key)) {
            const assignedStack = activeStack >= 0 ? activeStack : (b < drainBottomBand ? nextStackId++ : -1);
            if (assignedStack >= 0 && !stackOrderMap.has(assignedStack)) stackOrderMap.set(assignedStack, stackOrderMap.size);
            fixturesByKey.set(key, {
              key,
              elementId: s.elementId,
              band: b,
              node: s,
              sanEdge: eff,
              fixtureClass: fc,
              stackIndex: assignedStack,
              order: orderSeq++,
            });
          }
          // Check for grafted vent subtrees hanging off this terminal fixture
          const graftedVents = s.children.filter((c) => c.service === "vent");
          if (graftedVents.length > 0 && s.elementId) {
            graftedVentSubtrees.push({ hostFixtureId: s.elementId, ventNodes: graftedVents });
          }
          continue;
        }

        // Branch node: determine whether this branch initiates a new vertical soil stack wing!
        if (s.children.length > 0) {
          let branchStack = activeStack;
          const upperChildBranches = s.children.filter((c) => c.role === "branch" && subtreeHasUpperFixture(c));
          if (activeStack < 0 && b === drainBottomBand && upperChildBranches.length >= 2) {
            // A main building-drain branch that itself splits into 2+ separate upper-floor stacks: keep activeStack = -1 so each child branch gets its own stack wing!
            branchStack = -1;
          } else if (activeStack < 0 && subtreeHasUpperFixture(s)) {
            branchStack = nextStackId++;
            stackOrderMap.set(branchStack, stackOrderMap.size);
          }

          const firstKid = s.children[0]!;
          const tb = band(firstKid);
          if (firstKid.feed) {
            const info = ensureStackFloor(Math.max(0, branchStack), tb);
            if (!info.edge) info.edge = firstKid.feed;
            if (!info.size && firstKid.feed.label) info.size = firstKid.feed.label;
            if (!info.slope && firstKid.feed.slope) info.slope = firstKid.feed.slope;
          }
          walkDrain(s.children, false, branchStack);
        }
      }
    };
    // Check if the drainRoot ITSELF is a grease interceptor (common when `grease_waste` is rooted at GI-1!)
    if (classifyPlumbingDevice(drainRoot) === "grease_interceptor") {
      greaseInterceptorNode = drainRoot;
    }
    walkDrain(drainRoot.children, true, -1);

    // Normalize stack indices:
    // - If 0 or 1 upper-floor stacks exist, every fixture belongs to stack 0 (single-stack / single-story mode).
    // - If 2+ upper-floor stacks exist, match ungrouped bottom-floor fixtures to the nearest stack by X coordinate (or stack 0).
    const distinctUpperStacks = new Set<number>();
    Array.from(fixturesByKey.values()).forEach((f) => {
      if (f.stackIndex >= 0 && f.band < drainBottomBand) distinctUpperStacks.add(f.stackIndex);
    });
    const isMultiStack = distinctUpperStacks.size >= 2;
    const stackList = isMultiStack
      ? Array.from(distinctUpperStacks).sort((a, b) => (stackOrderMap.get(a) ?? a) - (stackOrderMap.get(b) ?? b))
      : [0];

    if (!isMultiStack) {
      Array.from(fixturesByKey.values()).forEach((f) => {
        f.stackIndex = 0;
      });
    } else {
      // Compute representative plan X per stack wing to group ungrouped bottom-floor fixtures cleanly under their stack
      const stackMeanX = new Map<number, number>();
      for (const sIdx of stackList) {
        const xs = Array.from(fixturesByKey.values())
          .filter((f) => f.stackIndex === sIdx && f.node.at !== undefined)
          .map((f) => f.node.at!.x);
        if (xs.length > 0) stackMeanX.set(sIdx, xs.reduce((a, c) => a + c, 0) / xs.length);
      }
      Array.from(fixturesByKey.values()).forEach((f) => {
        if (f.stackIndex >= 0 && distinctUpperStacks.has(f.stackIndex)) return;
        if (f.node.at !== undefined && stackMeanX.size > 0) {
          let bestIdx = stackList[0]!;
          let bestDist = Infinity;
          for (const [sIdx, mx] of Array.from(stackMeanX.entries())) {
            const d = Math.abs(f.node.at.x - mx);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = sIdx;
            }
          }
          f.stackIndex = bestIdx;
        } else {
          f.stackIndex = stackList[0]!;
        }
      });
    }

    // Attach vent branches (from both sibling vent roots AND grafted vent subtrees) onto existing physical fixtures!
    const ventFloorByStack = new Map<number, Map<number, FloorVentInfo>>();
    const ventRootByStack = new Map<number, DiagramNode>();
    const ventStackSizeByStack = new Map<number, string>();
    const ventStackEdgeByStack = new Map<number, DiagramEdge>();
    const ensureVentFloor = (sIdx: number, b: number): FloorVentInfo => {
      let map = ventFloorByStack.get(sIdx);
      if (!map) {
        map = new Map();
        ventFloorByStack.set(sIdx, map);
      }
      let info = map.get(b);
      if (!info) {
        info = {};
        map.set(b, info);
      }
      return info;
    };

    const matchFixture = (s: DiagramNode): DwvFixture | undefined => {
      const b = band(s);
      const byId = `${b}:${s.elementId ?? s.id}`;
      return (
        fixturesByKey.get(byId) ??
        Array.from(fixturesByKey.values()).find((f) => f.elementId !== null && f.elementId === s.elementId) ??
        Array.from(fixturesByKey.values()).find((f) => f.band === b && f.node.name.trim().toUpperCase() === s.name.trim().toUpperCase())
      );
    };

    const walkVentNodes = (list: readonly DiagramNode[], ownerVentRoot: DiagramNode | null) => {
      let lastEdge: DiagramEdge | undefined;
      for (const s of list) {
        if (s.role === "device") {
          if (s.lines.length === 0 && s.feed?.label) lastEdge = s.feed;
          continue;
        }
        const eff = s.feed?.label ? s.feed : (lastEdge ?? s.feed);
        lastEdge = undefined;
        if (s.role === "terminal") {
          if (isCapOrOpen(s)) continue;
          const match = matchFixture(s);
          if (match) {
            match.ventNode = s;
            match.ventEdge = eff;
            const sIdx = match.stackIndex;
            const vInfo = ensureVentFloor(sIdx, match.band);
            if (!vInfo.edge && eff) vInfo.edge = eff;
            if (!vInfo.size && eff?.label) vInfo.size = eff.label;
            if (ownerVentRoot && !ventRootByStack.has(sIdx)) ventRootByStack.set(sIdx, ownerVentRoot);
            if (eff?.label && !ventStackSizeByStack.has(sIdx)) {
              ventStackSizeByStack.set(sIdx, eff.label);
              ventStackEdgeByStack.set(sIdx, eff);
            }
          }
          continue;
        }
        if (s.children.length > 0) {
          walkVentNodes(s.children, ownerVentRoot);
        }
      }
    };

    for (const vr of attachedVentRoots) {
      const topSize = vr.children[0]?.feed?.label;
      const topEdge = vr.children[0]?.feed;
      walkVentNodes(vr.children, vr);
      for (const sIdx of stackList) {
        if (ventRootByStack.get(sIdx) === vr && topSize) {
          ventStackSizeByStack.set(sIdx, topSize);
          if (topEdge) ventStackEdgeByStack.set(sIdx, topEdge);
        }
      }
    }

    // Handle grafted vent subtrees (from `plumbing-graph.ts` rerootAt): find VTR node inside and attach vents!
    for (const gv of graftedVentSubtrees) {
      let foundVtr: DiagramNode | null = null;
      const findVtr = (nodesList: readonly DiagramNode[]) => {
        for (const n of nodesList) {
          const u = n.name.toUpperCase();
          if (u.includes("VTR") || u.includes("THRU ROOF") || u.includes("VENT")) {
            if (!foundVtr && n.role === "terminal" && !fixturesByKey.has(`${band(n)}:${n.elementId ?? n.id}`)) {
              foundVtr = n;
            }
          }
          if (n.children.length > 0) findVtr(n.children);
        }
      };
      findVtr(gv.ventNodes);
      const syntheticRoot: DiagramNode =
        foundVtr ??
        ({
          id: `vtr:${drainRoot.id}:${gv.hostFixtureId}`,
          elementId: null,
          kind: "equipment",
          labelKind: "equipment",
          name: "THRU ROOF",
          lines: [{ text: "VENT", bold: true }, { text: "THRU ROOF" }],
          levelId: levels[0]?.id ?? null,
          service: "vent",
          role: "source",
          children: [],
        } as DiagramNode);

      // Attach host fixture itself as vented
      const hostFix = Array.from(fixturesByKey.values()).find((f) => f.elementId === gv.hostFixtureId);
      if (hostFix && !hostFix.ventNode) {
        const firstEdge = gv.ventNodes[0]?.feed;
        hostFix.ventNode = gv.ventNodes[0];
        hostFix.ventEdge = firstEdge;
        const vInfo = ensureVentFloor(hostFix.stackIndex, hostFix.band);
        if (!vInfo.edge && firstEdge) vInfo.edge = firstEdge;
        if (!vInfo.size && firstEdge?.label) vInfo.size = firstEdge.label;
        if (!ventRootByStack.has(hostFix.stackIndex)) ventRootByStack.set(hostFix.stackIndex, syntheticRoot);
        if (firstEdge?.label && !ventStackSizeByStack.has(hostFix.stackIndex)) {
          ventStackSizeByStack.set(hostFix.stackIndex, firstEdge.label);
          ventStackEdgeByStack.set(hostFix.stackIndex, firstEdge);
        }
      }
      walkVentNodes(gv.ventNodes, syntheticRoot);
    }

    // Build per-wing data structures
    const drainBand = band(drainRoot);
    const activeBands = new Set<number>([drainBand]);
    Array.from(fixturesByKey.values()).forEach((f) => activeBands.add(f.band));
    const sortedBands = Array.from(activeBands).sort((a, b) => b - a);
    const bottomBand = sortedBands[0] ?? drainBand;

    const wings: WingData[] = stackList.map((sIdx, wPos) => {
      const wingFixtures = Array.from(fixturesByKey.values()).filter((f) => f.stackIndex === sIdx);
      const fixturesByBand = new Map<number, DwvFixture[]>();
      for (const f of wingFixtures) {
        const arr = fixturesByBand.get(f.band) ?? [];
        arr.push(f);
        fixturesByBand.set(f.band, arr);
      }
      const sanFloorInfo = rawFloorInfoByStack.get(sIdx) ?? new Map<number, FloorSanInfo>();
      let maxFixtures = 1;
      Array.from(fixturesByBand.entries()).forEach(([b, list]) => {
        list.sort((a, bFix) => {
          return fixtureSortRank(a.fixtureClass) - fixtureSortRank(bFix.fixtureClass) || a.node.name.localeCompare(bFix.node.name, "en-US", { numeric: true });
        });
        maxFixtures = Math.max(maxFixtures, list.length);
        const sum = list.reduce((acc, f) => acc + parseNum(f.node.lines[1]?.text), 0);
        const info = sanFloorInfo.get(b) ?? { loadNum: 0, hasCap: false };
        info.loadNum = sum;
        sanFloorInfo.set(b, info);
      });
      const wingUpperBands = Array.from(fixturesByBand.keys())
        .filter((b) => b !== bottomBand)
        .sort((a, b) => b - a);
      const ventedBands = Array.from(fixturesByBand.entries())
        .filter(([, list]) => list.some((f) => f.ventNode !== undefined))
        .map(([b]) => b)
        .sort((a, b) => b - a);
      const ventRoot = ventRootByStack.get(sIdx) ?? (ventedBands.length > 0 ? attachedVentRoots[0] : undefined);
      return {
        stackIndex: sIdx,
        label: isMultiStack ? `S-${wPos + 1}` : "",
        fixturesByBand,
        sanFloorInfo,
        ventFloorInfo: ventFloorByStack.get(sIdx) ?? new Map<number, FloorVentInfo>(),
        upperBands: wingUpperBands,
        maxFixtures,
        hasVent: ventedBands.length > 0 && ventRoot !== undefined,
        ventedBands,
        ventRoot,
        ventStackSize: ventStackSizeByStack.get(sIdx),
        ventStackEdge: ventStackEdgeByStack.get(sIdx),
      };
    });

    // Compute clean horizontal column grid for this drainage system across all wings!
    let cursorX = originX;
    const coHeadX = cursorX;
    cursorX += 14;

    interface WingCoords {
      readonly wing: WingData;
      readonly firstFixX: number;
      readonly sanStackX: number | null;
      readonly ventStackX: number | null;
      readonly fixPos: Map<DwvFixture, number>;
    }
    const wingCoords: WingCoords[] = [];

    for (let wi = 0; wi < wings.length; wi++) {
      const wing = wings[wi]!;
      const firstFixX = cursorX + COL / 2;
      cursorX += wing.maxFixtures * COL;

      const sanStackX = wing.upperBands.length > 0 ? cursorX + 8 : null;
      if (sanStackX !== null) cursorX += STACK_LANE;

      const ventStackX = wing.hasVent ? cursorX + 8 : null;
      if (ventStackX !== null) cursorX += STACK_LANE + 4;

      const fixPos = new Map<DwvFixture, number>();
      Array.from(wing.fixturesByBand.values()).forEach((list) => {
        list.forEach((f, i) => fixPos.set(f, firstFixX + i * COL));
      });
      wingCoords.push({ wing, firstFixX, sanStackX, ventStackX, fixPos });
      if (wi < wings.length - 1) cursorX += 10;
    }

    const bwvX = backwaterValves.length > 0 ? cursorX + 6 : null;
    if (bwvX !== null) cursorX += 14;

    const giX = greaseInterceptorNode !== null ? cursorX + 12 : null;
    if (giX !== null) cursorX += 26;

    const coExitX = cursorX + 4;
    const sewerExitX = coExitX + 18;

    // 1. Draw Building Drain under bottomBand (solid horizontal line flowing RIGHT to outfall!)
    const mainY = sanBranchY(bottomBand);
    const mainStartX = coHeadX;
    const mainEndX = sewerExitX;
    const sumDfu = wings.reduce(
      (acc, w) => acc + Array.from(w.sanFloorInfo.values()).reduce((s, info) => s + info.loadNum, 0),
      0,
    );
    const totalLoad = totalDfuNum > 0 ? totalDfuNum : sumDfu;

    // Draw building drain cleanly around inline GI / BWV symbols with zero pipe gaps
    if (giX !== null && greaseInterceptorNode) {
      pipeSeg(`${drainRoot.id}:main-pre`, "Building Drain", mainDrainEdge, { x: mainStartX, y: mainY }, { x: giX - 9, y: mainY }, dm.dashed, dm.weight, dm.code);
      const giStart = items.length;
      drawGreaseInterceptor(items, { x: giX, y: mainY }, greaseInterceptorNode);
      nodes.push({ id: greaseInterceptorNode.id, kind: greaseInterceptorNode.kind, name: greaseInterceptorNode.name, center: round({ x: giX, y: mainY }), depth: 0 });
      ranges[greaseInterceptorNode.id] = [giStart, items.length];
      pipeSeg(`${drainRoot.id}:main-post`, "Building Drain", mainDrainEdge, { x: giX + 9, y: mainY }, { x: mainEndX, y: mainY }, dm.dashed, dm.weight, dm.code);
    } else {
      pipeSeg(`${drainRoot.id}:main`, "Building Drain", mainDrainEdge, { x: mainStartX, y: mainY }, { x: mainEndX, y: mainY }, dm.dashed, dm.weight, dm.code);
    }

    if (bwvX !== null && backwaterValves[0]) {
      const bwv = backwaterValves[0];
      drawBackwaterValve(items, { x: bwvX, y: mainY }, bwv.id, bwv.name.toUpperCase().slice(0, 6));
      nodes.push({ id: bwv.id, kind: bwv.kind, name: bwv.name, center: round({ x: bwvX, y: mainY }), depth: 0 });
    }

    // Head & Exit Cleanouts (CO)
    const co1 = cleanouts[0];
    const co2 = cleanouts[1];
    drawCleanout(items, { x: coHeadX, y: mainY }, co1?.id ?? `co:${drainRoot.id}:head`, "CO");
    if (cleanouts.length > 1) {
      drawCleanout(items, { x: coExitX, y: mainY }, co2?.id ?? `co:${drainRoot.id}:exit`, "CO");
    }
    drawFlowArrow(items, { x: mainEndX - 2, y: mainY }, 1, drainRoot.id);

    // Main building drain size + DFU/GPM + slope cleanly BELOW the drain line
    const mainLbl = [
      showSize && mainDrainSize ? `${mainDrainSize} ${dm.code}` : "",
      showLoad && totalLoad > 0 ? formatLoad(totalLoad, drainRoot.service) : "",
      showSlope && mainDrainSlope ? mainDrainSlope : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (mainLbl) {
      const firstFixX = wingCoords[0]?.firstFixX ?? mainStartX + 10;
      labelText(`${drainRoot.id}:main`, [mainLbl], { x: firstFixX, y: mainY - 2.2 }, Math.max(58, sewerExitX - firstFixX - 8));
    }

    // Outfall box & label at right end
    const outStart = items.length;
    items.push({
      shape: "polyline",
      points: [
        round({ x: mainEndX - 1.5, y: mainY - 1.5 }),
        round({ x: mainEndX + 1.5, y: mainY - 1.5 }),
        round({ x: mainEndX + 1.5, y: mainY + 1.5 }),
        round({ x: mainEndX - 1.5, y: mainY + 1.5 }),
      ],
      closed: true,
      weight: dm.weight,
      nodeId: drainRoot.id,
    });
    const outTitle = drainRoot.lines[0]?.text ?? drainRoot.service.replace(/_/g, " ").toUpperCase();
    const outSub = outfallNode
      ? `TO SEWER (${(outfallNode as DiagramNode).name.toUpperCase()})`
      : greaseInterceptorNode && drainRoot.service === "grease_waste"
        ? `TO SEWER VIA ${(greaseInterceptorNode as DiagramNode).name.toUpperCase()}`
        : (drainRoot.lines[1]?.text ?? dm.defaultOutfall);
    items.push({
      shape: "text",
      at: round({ x: mainEndX + 3.5, y: mainY + 3.2 }),
      widthMm: 38,
      lines: [{ text: outTitle, bold: true }, { text: outSub }],
      nodeId: drainRoot.id,
      role: "equipment",
    });
    nodes.push({ id: drainRoot.id, kind: drainRoot.kind, name: drainRoot.name, center: round({ x: mainEndX, y: mainY }), depth: 0 });
    ranges[drainRoot.id] = [outStart, items.length];

    // 2. Draw each wing's floor branches, fixtures, vertical soil stack, and vertical vent stack!
    const roofBand = Math.max(0, levels.length > 0 ? 0 : Math.min(...sortedBands));
    const roofY = floorY(roofBand);
    const vtrY = roofY + 2;

    for (let wi = 0; wi < wingCoords.length; wi++) {
      const wc = wingCoords[wi]!;
      const { wing, sanStackX, ventStackX, fixPos } = wc;

      for (const b of sortedBands) {
        const list = wing.fixturesByBand.get(b) ?? [];
        if (list.length === 0) continue;
        const fBotY = fixtureBotY(b);
        const fTopY = fBotY + BOX_H;
        const sY = sanBranchY(b);
        const vY = ventHeaderY(b);
        const sInfo = wing.sanFloorInfo.get(b);
        const vInfo = wing.ventFloorInfo.get(b);

        // Upper floor horizontal drainage branch flowing right into this wing's vertical soil stack
        if (b !== bottomBand && sanStackX !== null) {
          const leftX = fixPos.get(list[0]!)!;
          pipeSeg(`${drainRoot.id}:br:${wi}:${b}`, `L${b} ${dm.code} Branch`, sInfo?.edge, { x: leftX, y: sY }, { x: sanStackX, y: sY }, dm.dashed, dm.weight, dm.code);
          const brLbl = [
            showSize && sInfo?.size ? `${sInfo.size} ${dm.code}` : "",
            showLoad && sInfo && sInfo.loadNum > 0 ? formatLoad(sInfo.loadNum, drainRoot.service) : "",
            showSlope && sInfo?.slope ? sInfo.slope : "",
          ]
            .filter(Boolean)
            .join(" · ");
          if (brLbl) {
            labelText(`${drainRoot.id}:br:${wi}:${b}`, [brLbl], { x: leftX + 2, y: sY - 2.0 }, Math.max(46, sanStackX - leftX - 4));
          }
          if (sInfo?.hasCap) {
            items.push({ shape: "line", points: [round({ x: leftX - 3, y: sY }), round({ x: leftX, y: sY })], weight: dm.weight, nodeId: `${drainRoot.id}:br:${wi}:${b}` });
            items.push({ shape: "line", points: [round({ x: leftX - 3, y: sY - 1.8 }), round({ x: leftX - 3, y: sY + 1.8 })], weight: "heavy", nodeId: `${drainRoot.id}:br:${wi}:${b}` });
          }
        }

        // Horizontal dashed branch vent header (>= 6" above flood rim) running right into this wing's vertical Vent Stack!
        const ventedOnFloor = list.filter((f) => f.ventNode !== undefined);
        if (ventedOnFloor.length > 0 && ventStackX !== null) {
          const vLeftX = fixPos.get(ventedOnFloor[0]!)!;
          pipeSeg(`${drainRoot.id}:vhdr:${wi}:${b}`, `L${b} Branch Vent`, vInfo?.edge, { x: vLeftX, y: vY }, { x: ventStackX, y: vY }, true, "medium", "Vent");
          const vSize = vInfo?.size ?? '2"';
          labelText(`${drainRoot.id}:vhdr:${wi}:${b}`, [`${vSize} V`], { x: vLeftX + 2, y: vY + 4.4 }, 24);
        }

        // Draw each unique physical fixture on floor `b` ONCE
        for (const f of list) {
          const cx = fixPos.get(f)!;
          const t0 = items.length;
          entries[f.node.id] = round({ x: cx, y: sY });

          // SOLID gravity drop DOWN from fixture bottom through floor slab into horizontal drain with 45° wye sweep!
          pipeSeg(f.node.id, f.node.name, f.sanEdge, { x: cx, y: fBotY }, { x: cx, y: sY }, dm.dashed, dm.weight, dm.code);
          if (!dm.dashed) drawWyeSweep(items, cx, sY, 1, f.node.id);
          if (showSize && f.sanEdge?.label) {
            labelText(f.node.id, [f.sanEdge.label], { x: cx + 1.6, y: (floorY(b) + sY) / 2 + 1.4 }, 10);
          }

          // DASHED vertical vent rising UP from fixture top to horizontal branch vent header!
          if (f.ventNode) {
            pipeSeg(f.ventNode.id, `${f.node.name} vent`, f.ventEdge, { x: cx, y: fTopY }, { x: cx, y: vY }, true, "medium", "Vent");
            if (showSize && f.ventEdge?.label) {
              labelText(f.ventNode.id, [f.ventEdge.label], { x: cx + 1.6, y: (fTopY + vY) / 2 + 1.4 }, 10);
            }
          }

          // Storm Roof Drain funnel symbol vs standard crisp fixture box
          if (drainRoot.service === "storm" && f.fixtureClass === "roof_drain") {
            drawRoofDrainSymbol(items, cx, fBotY, f.node);
            nodes.push({ id: f.node.id, kind: f.node.kind, name: f.node.name, center: round({ x: cx, y: fBotY + 3.5 }), depth: 0 });
          } else {
            items.push({
              shape: "polyline",
              points: [
                round({ x: cx - BOX_W / 2, y: fBotY }),
                round({ x: cx + BOX_W / 2, y: fBotY }),
                round({ x: cx + BOX_W / 2, y: fTopY }),
                round({ x: cx - BOX_W / 2, y: fTopY }),
              ],
              closed: true,
              weight: "medium",
              nodeId: f.node.id,
            });
            const boxLines = f.node.lines.slice(0, 2);
            const textH = oneLineTextHeight(boxLines, BOX_W - 1.2);
            items.push({
              shape: "text",
              at: round({ x: cx - (BOX_W - 1.2) / 2, y: fBotY + (BOX_H + textH) / 2 - 0.5 }),
              widthMm: BOX_W - 1.2,
              lines: boxLines,
              nodeId: f.node.id,
              role: "equipment",
              align: "center",
            });
            nodes.push({ id: f.node.id, kind: f.node.kind, name: f.node.name, center: round({ x: cx, y: fBotY + BOX_H / 2 }), depth: 0 });
          }
          ranges[f.node.id] = [t0, items.length];
        }
      }

      // 3. Wing's vertical Soil / Drain Stack connecting upper floor(s) down into Building Drain!
      if (sanStackX !== null && wing.upperBands.length > 0) {
        const topSanBand = wing.upperBands[wing.upperBands.length - 1]!;
        const yTop = sanBranchY(topSanBand);
        const stackInfo = wing.sanFloorInfo.get(topSanBand);
        const stackLoad = wing.upperBands.reduce((acc, b) => acc + (wing.sanFloorInfo.get(b)?.loadNum ?? 0), 0);
        const stackId = isMultiStack ? `${drainRoot.id}:stack:${wi + 1}` : `${drainRoot.id}:stack`;
        pipeSeg(stackId, wing.label ? `Soil Stack ${wing.label}` : "Soil Stack", stackInfo?.edge, { x: sanStackX, y: yTop }, { x: sanStackX, y: mainY }, dm.dashed, dm.weight, dm.code);
        if (!dm.dashed) drawWyeSweep(items, sanStackX, mainY, 1, stackId);
        const stackLbl = [
          wing.label ? wing.label : "",
          showSize && stackInfo?.size ? `${stackInfo.size} ${dm.code}` : "",
          showLoad && stackLoad > 0 ? formatLoad(stackLoad, drainRoot.service) : "",
        ].filter(Boolean);
        if (stackLbl.length > 0) {
          labelText(stackId, stackLbl, { x: sanStackX + 1.8, y: floorY(bottomBand) + 28 }, STACK_LANE - 1);
        }
      }

      // 4. Wing's vertical Dashed Vent Stack rising cleanly from lowest branch vent straight UP through ROOF to VTR!
      if (ventStackX !== null && wing.ventRoot && wing.ventedBands.length > 0) {
        anyVentDrawn = true;
        const lowVentBand = Math.max(...wing.ventedBands);
        const yLow = ventHeaderY(lowVentBand);
        const vStart = items.length;
        const vStackId = isMultiStack ? `${drainRoot.id}:vstack:${wi + 1}` : `${drainRoot.id}:vstack`;
        pipeSeg(vStackId, isMultiStack ? `Vent Stack V-${wi + 1}` : "Main Vent Stack", wing.ventStackEdge, { x: ventStackX, y: yLow }, { x: ventStackX, y: vtrY }, true, "medium", "Vent");
        drawVtrCap(items, { x: ventStackX, y: vtrY }, wing.ventRoot, wing.ventStackSize ?? '3"');
        const vStackLbl = [
          isMultiStack ? `V-${wi + 1}` : "",
          wing.ventStackSize ? `${wing.ventStackSize} V` : '3" V',
          "STACK",
        ].filter(Boolean);
        labelText(vStackId, vStackLbl, { x: ventStackX + 2.0, y: (yLow + vtrY) / 2 + 2 }, STACK_LANE);
        if (!nodes.some((n) => n.id === wing.ventRoot!.id)) {
          nodes.push({ id: wing.ventRoot.id, kind: wing.ventRoot.kind, name: wing.ventRoot.name, center: round({ x: ventStackX, y: vtrY }), depth: 0 });
          ranges[wing.ventRoot.id] = [vStart, items.length];
        }
      }
    }

    // 4b. IPC 912 horizontal wet-vent engineering note using semantic fixture classification!
    if (drainRoot.service === "sanitary") {
      const wetVentedFixtures: string[] = [];
      for (const wc of wingCoords) {
        for (const b of sortedBands) {
          const list = wc.wing.fixturesByBand.get(b) ?? [];
          const hasDryVentedLav = list.some((f) => f.ventNode !== undefined && f.fixtureClass === "lavatory");
          if (!hasDryVentedLav) continue;
          for (const f of list) {
            if (!f.ventNode && f.fixtureClass === "water_closet") wetVentedFixtures.push(f.node.name.toUpperCase());
          }
        }
      }
      if (wetVentedFixtures.length > 0) {
        items.push({
          shape: "text",
          at: round({ x: originX, y: mainY - 11.5 }),
          widthMm: Math.max(120, sewerExitX - originX + 20),
          lines: [{ text: `NOTE: ${wetVentedFixtures.join(", ")} HORIZONTALLY WET-VENTED VIA LAVATORY DRAINS PER IPC 912.` }],
          nodeId: `note:wet-vent:${drainRoot.id}`,
          role: "note",
        });
      }
    }

    originX = sewerExitX + 48;
  }

  const extentX = Math.max(originX, LEFT + 110);

  // 5. Dynamic ASPE Line-Type Legend in top-right (above ROOF line)
  const legX = extentX - 60;
  let legY = floorY(0) + 14;
  for (const svc of Array.from(drawnServices)) {
    const dm = drainMetaOf(svc);
    items.push(
      { shape: "line", points: [round({ x: legX, y: legY }), round({ x: legX + 12, y: legY })], weight: dm.weight, ...(dm.dashed ? { dashed: true } : {}), nodeId: `legend:${svc}` },
      { shape: "text", at: round({ x: legX + 14, y: legY + 1.5 }), widthMm: 46, lines: [{ text: dm.legendLabel }], nodeId: `legend:${svc}`, role: "note" },
    );
    legY -= 6;
  }
  if (anyVentDrawn) {
    items.push(
      { shape: "line", points: [round({ x: legX, y: legY }), round({ x: legX + 12, y: legY })], weight: "medium", dashed: true, nodeId: "legend:vent" },
      { shape: "text", at: round({ x: legX + 14, y: legY + 1.5 }), widthMm: 46, lines: [{ text: "SANITARY VENT (V)" }], nodeId: "legend:vent", role: "note" },
    );
  }

  // 6. Floor datum lines & bold level names
  const rows = [...levels.map((l) => l.name), ...(usedUnknown ? ["No level"] : [])];
  rows.forEach((name, i) => {
    const y = floorY(i);
    items.push({ shape: "line", points: [round({ x: 0, y }), round({ x: extentX, y })], weight: "thin", nodeId: "levels" });
    items.push({ shape: "text", at: round({ x: 0, y: y + oneLineTextHeight([{ text: name }], LEFT - 4) + 1 }), widthMm: LEFT - 4, lines: [{ text: name.toUpperCase(), bold: true }], nodeId: "levels", role: "note" });
  });

  return { items, extent: oneLineItemsExtent(items), nodes, ranges, entries, pipes };
}
