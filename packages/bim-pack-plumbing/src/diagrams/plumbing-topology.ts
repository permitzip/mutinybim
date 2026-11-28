import { feetText, runHeightMm, slopeText, loadOf, runNeighbours, type RunGraphNode, segmentLength3, elementsOfKind, slopeInPerFt, pipeDims, nominalSizeText, systemRules, partLabelOf, drainSystemKinds, paramValue, resolveFitting } from "@permitzip/bim-kernel";
import { gasNetwork, pressureLabel, type GasRegulator, type RegulatorRole } from "../routing/pipe/gas-zones";
import { GAS_FUEL_LABEL, type GasFuel } from "../routing/pipe/gas-fuel";
import { pipeSystemReportOf, type PipeSystemReport } from "../routing/pipe/hydraulics";
import type { MepSystem, PartInstance, PartTypeDefinition, RunFitting, RunPoint, RunSegment, BimElement, ElementId, DiagramEdge, DiagramNode, DiagramPipe, DiagramPipeRole } from "@permitzip/bim-kernel";

/** Semantic device classification propagated from model part types / fitting families to diagram renderers. */
export type PlumbingDeviceKind =
  | "water_meter"
  | "gas_meter"
  | "rpz"
  | "dcva"
  | "pvb"
  | "avb"
  | "air_gap"
  | "prv"
  | "gas_regulator"
  | "shutoff_valve"
  | "check_valve"
  | "balancing_valve"
  | "recirc_pump"
  | "drip_leg"
  | "cleanout"
  | "backwater_valve"
  | "grease_interceptor"
  | "sewage_ejector"
  | "sewer_connection"
  | "expansion_tank"
  | "buffer_tank"
  | "water_heater"
  | "generic";

/** Semantic fixture classification propagated from model part types / connectors to diagram renderers. */
export type PlumbingFixtureClass =
  | "water_closet"
  | "urinal"
  | "lavatory"
  | "sink"
  | "floor_drain"
  | "shower_tub"
  | "hose_bibb"
  | "dishwasher"
  | "water_heater"
  | "expansion_tank"
  | "buffer_tank"
  | "gas_appliance"
  | "roof_drain"
  | "other";

export interface GasRegulatorMeta {
  readonly role: RegulatorRole;
  readonly inletInWc: number | null;
  readonly inletLabel: string | null;
  readonly outletInWc: number;
  readonly outletLabel: string;
  readonly loadMbh: number;
  readonly vent: string;
  readonly capacityMbh: number | null;
}

export interface GasSourceMeta {
  readonly fuel: GasFuel;
  readonly heatingValueBtuPerCf: number;
  readonly inletInWc: number;
  readonly inletLabel: string;
  readonly totalMbh: number;
  readonly totalCfh: number;
}

export interface PlumbingNodeMeta {
  readonly deviceKind?: PlumbingDeviceKind;
  readonly fixtureClass?: PlumbingFixtureClass;
  readonly familyName?: string;
  readonly connectionType?: string;
  readonly connectorServices?: readonly string[];
  readonly gasRegulator?: GasRegulatorMeta;
  readonly gasSource?: GasSourceMeta;
}

const NODE_META = new WeakMap<DiagramNode, PlumbingNodeMeta>();

/** Read semantic plumbing metadata attached to a `DiagramNode` by `plumbing-topology.ts` (or a test). */
export function getPlumbingNodeMeta(node: DiagramNode): PlumbingNodeMeta | undefined {
  return NODE_META.get(node);
}

/** Attach semantic plumbing metadata to a `DiagramNode` (used by `plumbing-topology.ts` and unit tests). */
export function setPlumbingNodeMeta(node: DiagramNode, meta: PlumbingNodeMeta): DiagramNode {
  NODE_META.set(node, meta);
  return node;
}

/** Copy semantic plumbing metadata when cloning a `DiagramNode` (e.g., during graph grafting/rerooting). */
export function copyPlumbingNodeMeta(from: DiagramNode, to: DiagramNode): DiagramNode {
  const meta = NODE_META.get(from);
  if (meta) NODE_META.set(to, meta);
  return to;
}

function textParam(def: PartTypeDefinition, values: PartInstance["values"], key: string): string {
  const v = paramValue(def, values, key);
  return typeof v === "string" ? v.trim() : "";
}

function classifyBackflowCode(code: string): PlumbingDeviceKind | null {
  const u = code.trim().toUpperCase();
  if (!u) return null;
  if (u === "RPZ" || u === "RPBA") return "rpz";
  if (u === "DCVA" || u === "DC" || u === "DCDA") return "dcva";
  if (u === "PVB" || u === "SVB") return "pvb";
  if (u === "AVB") return "avb";
  if (u === "AG" || u === "AIR_GAP" || u === "AIR GAP") return "air_gap";
  return null;
}

function classifyDeviceFromName(name: string, service?: string): PlumbingDeviceKind {
  const n = name.toLowerCase();
  if (n.includes("rpz") || n.includes("reduced pressure") || /\brpba\b/.test(n)) return "rpz";
  if (n.includes("dcva") || n.includes("double check") || /\bdcda\b/.test(n)) return "dcva";
  if (/\bpvb\b/.test(n) || n.includes("pressure vacuum breaker") || /\bsvb\b/.test(n)) return "pvb";
  if (/\bavb\b/.test(n) || n.includes("atmospheric vacuum breaker") || n.includes("vacuum breaker")) return "avb";
  if (n.includes("air gap") || n.includes("air-gap") || /^ag\b|^ag-/.test(n)) return "air_gap";
  if (n.includes("backflow") || n.includes("bfp")) return "rpz";
  if (n.includes("recirc") || n.includes("circulator") || /^rp\b|^rp-|^cp\b|^cp-/.test(n)) return "recirc_pump";
  if (n.includes("expansion tank") || /^et\b|^et-/.test(n)) return "expansion_tank";
  if (n.includes("buffer tank") || n.includes("storage tank") || /^bt\b|^bt-/.test(n)) return "buffer_tank";
  if (n.includes("water heater") || /^g?wh\b|^wh-|^ewh\b|^dwh\b/.test(n)) return "water_heater";
  if (n.includes("grease interceptor") || n.includes("grease trap") || /^gi\b|^gi-|^gt\b|^gt-/.test(n)) return "grease_interceptor";
  if (n.includes("sewage ejector") || n.includes("ejector") || /^se\b|^se-/.test(n)) return "sewage_ejector";
  if (n.includes("manhole") || /^mh\b|^mh-/.test(n) || n.includes("sewer")) return "sewer_connection";
  if (n.includes("backwater") || /^bwv\b|^bwv-/.test(n)) return "backwater_valve";
  if (n.includes("cleanout") || n.includes("test tee") || /^(f|w)?co\b|^(f|w)?co-/.test(n)) return "cleanout";
  if (n.includes("drip") || n.includes("sediment") || /^st\b|^st-/.test(n)) return "drip_leg";
  if (n.includes("gas meter") || /^gm\b|^gm-/.test(n)) return "gas_meter";
  if (n.includes("mtr") || n.includes("meter") || /^wm\b|^wm-/.test(n)) {
    return service === "natural_gas" || service === "propane" ? "gas_meter" : "water_meter";
  }
  if (n.includes("check valve") || /^cv\b|^cv-/.test(n)) return "check_valve";
  if (n.includes("balanc") || n.includes("circuit setter") || /^bv\b|^bv-|^cs\b|^cs-/.test(n)) return "balancing_valve";
  if (n.includes("regulator") || /^gr\b|^gr-|^lr\b|^lr-|^ar\b|^ar-|^sr\b|^sr-/.test(n)) {
    return service === "natural_gas" || service === "propane" ? "gas_regulator" : "prv";
  }
  if (n === "prv" || /^prv\b|^prv-/.test(n) || n.includes("pressure reducing") || n.includes("pressure-reducing")) return "prv";
  if (n.includes("valve") || n.includes("cock") || /\bsov\b/.test(n) || n.includes("shut-off") || n.includes("shutoff")) return "shutoff_valve";
  return "generic";
}

function classifyFixtureFromName(name: string): PlumbingFixtureClass {
  const n = name.toLowerCase();
  if (/^wc\b|^wc-/.test(n) || n.includes("water closet") || n.includes("toilet")) return "water_closet";
  if (/^ur\b|^ur-/.test(n) || n.includes("urinal")) return "urinal";
  if (/^l-|^lav\b|^lav-/.test(n) || n.includes("lavatory")) return "lavatory";
  if (n.includes("expansion tank") || /^et\b|^et-/.test(n)) return "expansion_tank";
  if (n.includes("buffer tank") || n.includes("storage tank") || /^bt\b|^bt-/.test(n)) return "buffer_tank";
  if (n.includes("water heater") || /^g?wh\b|^wh-|^ewh\b|^dwh\b/.test(n)) return "water_heater";
  if (n.includes("roof drain") || n.includes("overflow drain") || n.includes("area drain") || /^rd\b|^rd-|^ord\b|^ord-/.test(n)) return "roof_drain";
  if (n.includes("floor drain") || n.includes("floor sink") || n.includes("trench drain") || /^fd\d|^fd-|^fs\d|^fs-|^td\b|^td-/.test(n)) return "floor_drain";
  if (n.includes("shower") || n.includes("bathtub") || /\btub\b/.test(n) || /^sh\b|^sh-/.test(n)) return "shower_tub";
  if (n.includes("dishwasher") || /^dw\b|^dw-/.test(n)) return "dishwasher";
  if (n.includes("hose bibb") || n.includes("hydrant") || /^hb\b|^hb-|^whyd/.test(n)) return "hose_bibb";
  if (n.includes("sink") || /^sk\d|^sk-|^hs\b|^hs-|^ms\b|^ms-|^ks\b|^ks-/.test(n)) return "sink";
  return "other";
}

function metaFromPart(elements: Elements, part: PartInstance, service: string, reg?: GasRegulator, inletInWc?: number | null): PlumbingNodeMeta {
  const typeEl = elements[part.typeId];
  const def = typeEl?.kind === "part_type" ? typeEl.definition : null;
  const familyName = def?.familyName ?? "";
  const typeName = def?.typeName ?? "";
  const combined = `${familyName} ${typeName}`.trim();
  const connType = def ? textParam(def, part.values, "default_connection_type") : "";
  const connUpper = connType.toUpperCase();
  const heaterKind = def ? textParam(def, part.values, "heater_kind") : "";
  const drainageRole = def ? textParam(def, part.values, "drainage_role") : "";
  const backflowParam = def ? (textParam(def, part.values, "backflow_type") || textParam(def, part.values, "backflow_preventer")) : "";
  const connectorServices = def ? [...new Set(def.connectors.map((c) => c.systemKind).filter((k): k is string => Boolean(k)))] : [];

  let deviceKind: PlumbingDeviceKind | undefined;
  if (reg) {
    deviceKind = "gas_regulator";
  } else if (backflowParam) {
    deviceKind = classifyBackflowCode(backflowParam) ?? classifyDeviceFromName(backflowParam, service);
  } else if (drainageRole === "sewer_connection") {
    deviceKind = "sewer_connection";
  } else if (drainageRole === "sewage_pump") {
    deviceKind = "sewage_ejector";
  } else if (drainageRole === "backwater_valve") {
    deviceKind = "backwater_valve";
  } else if (heaterKind) {
    deviceKind = "water_heater";
  } else if (connUpper === "RPZ") {
    deviceKind = "rpz";
  } else if (connUpper === "DCVA") {
    deviceKind = "dcva";
  } else if (connUpper === "PVB") {
    deviceKind = "pvb";
  } else if (connUpper === "AVB") {
    deviceKind = "avb";
  } else if (connUpper === "AG") {
    deviceKind = "air_gap";
  } else if (connUpper === "PRV") {
    deviceKind = "prv";
  } else if (connUpper === "MTR") {
    deviceKind = service === "natural_gas" || service === "propane" ? "gas_meter" : "water_meter";
  } else if (connUpper === "RP") {
    deviceKind = "recirc_pump";
  } else if (connUpper === "ET") {
    deviceKind = "expansion_tank";
  } else if (connUpper === "BT") {
    deviceKind = "buffer_tank";
  } else if (connUpper === "GI") {
    deviceKind = "grease_interceptor";
  } else if (connUpper === "CO" || connUpper === "FCO" || connUpper === "WCO") {
    deviceKind = "cleanout";
  } else if (connUpper === "GR") {
    deviceKind = "gas_regulator";
  } else if (connUpper === "ST") {
    deviceKind = "drip_leg";
  } else if (connUpper === "CV") {
    deviceKind = "check_valve";
  } else if (connUpper === "BV" || connUpper === "CS") {
    deviceKind = "balancing_valve";
  } else if (combined) {
    const inferred = classifyDeviceFromName(combined, service);
    if (inferred !== "generic") deviceKind = inferred;
  }

  let fixtureClass: PlumbingFixtureClass | undefined;
  if (heaterKind || connUpper.startsWith("WH-")) {
    fixtureClass = "water_heater";
  } else if (deviceKind === "expansion_tank") {
    fixtureClass = "expansion_tank";
  } else if (deviceKind === "buffer_tank") {
    fixtureClass = "buffer_tank";
  } else if (connUpper === "WC-FT" || connUpper === "WC-FV" || connUpper === "WC") {
    fixtureClass = "water_closet";
  } else if (connUpper === "UR") {
    fixtureClass = "urinal";
  } else if (connUpper === "LAV") {
    fixtureClass = "lavatory";
  } else if (connUpper === "HS" || connUpper === "MS" || connUpper.startsWith("SK")) {
    fixtureClass = "sink";
  } else if (connUpper === "FD" || connUpper === "FS" || connUpper === "TD") {
    fixtureClass = "floor_drain";
  } else if (connUpper === "HB") {
    fixtureClass = "hose_bibb";
  } else if (connUpper === "DW") {
    fixtureClass = "dishwasher";
  } else if (connUpper.startsWith("G-")) {
    fixtureClass = "gas_appliance";
  } else if (combined) {
    const inferred = classifyFixtureFromName(combined);
    if (inferred !== "other") fixtureClass = inferred;
    else if (connectorServices.includes("natural_gas") || service === "natural_gas" || service === "propane") {
      fixtureClass = "gas_appliance";
    }
  }

  return {
    ...(deviceKind ? { deviceKind } : {}),
    ...(fixtureClass ? { fixtureClass } : {}),
    ...(familyName ? { familyName } : {}),
    ...(connType ? { connectionType: connType } : {}),
    ...(connectorServices.length > 0 ? { connectorServices } : {}),
    ...(reg
      ? {
          gasRegulator: {
            role: reg.role,
            inletInWc: inletInWc ?? null,
            inletLabel: inletInWc != null ? pressureLabel(inletInWc) : null,
            outletInWc: reg.outletInWc,
            outletLabel: pressureLabel(reg.outletInWc),
            loadMbh: reg.loadMbh,
            vent: reg.vent,
            capacityMbh: reg.capacityMbh,
          },
        }
      : {}),
  };
}

function metaFromFitting(system: MepSystem, f: RunFitting, reg?: GasRegulator, inletInWc?: number | null): PlumbingNodeMeta {
  const resolved = resolveFitting(system, f);
  const famId = resolved?.family.id ?? f.family ?? "";
  const famName = resolved?.family.name ?? f.label;
  const acc = resolved?.family.pipe?.accessory;
  let deviceKind: PlumbingDeviceKind = "generic";
  if (reg || acc === "regulator") deviceKind = "gas_regulator";
  else if (acc === "drip_leg") deviceKind = "drip_leg";
  else if (acc === "cleanout" || acc === "test_tee") deviceKind = "cleanout";
  else if (acc === "prv") deviceKind = "prv";
  else if (famId === "pipe.valve.check") deviceKind = "check_valve";
  else if (acc === "gas_cock" || acc === "valve") {
    const fromName = classifyDeviceFromName(`${famName} ${f.label}`, system.systemKind);
    deviceKind = fromName !== "generic" ? fromName : "shutoff_valve";
  } else {
    deviceKind = classifyDeviceFromName(`${famName} ${f.label}`, system.systemKind);
  }
  return {
    deviceKind,
    familyName: famName,
    ...(reg
      ? {
          gasRegulator: {
            role: reg.role,
            inletInWc: inletInWc ?? null,
            inletLabel: inletInWc != null ? pressureLabel(inletInWc) : null,
            outletInWc: reg.outletInWc,
            outletLabel: pressureLabel(reg.outletInWc),
            loadMbh: reg.loadMbh,
            vent: reg.vent,
            capacityMbh: reg.capacityMbh,
          },
        }
      : {}),
  };
}

/** Semantic device kind for a diagram node: reads model metadata first, falling back to mark/name matching. */
export function classifyPlumbingDevice(node: DiagramNode): PlumbingDeviceKind {
  const meta = NODE_META.get(node);
  if (meta?.deviceKind) return meta.deviceKind;
  if (meta?.gasRegulator) return "gas_regulator";
  if (meta?.familyName) {
    const fromFamily = classifyDeviceFromName(meta.familyName, node.service);
    if (fromFamily !== "generic") return fromFamily;
  }
  return classifyDeviceFromName(node.name, node.service);
}

/** Semantic fixture class for a diagram node: reads model metadata first, falling back to mark/name matching. */
export function classifyPlumbingFixture(node: DiagramNode): PlumbingFixtureClass {
  const meta = NODE_META.get(node);
  if (meta?.fixtureClass) return meta.fixtureClass;
  if (meta?.familyName) {
    const fromFamily = classifyFixtureFromName(meta.familyName);
    if (fromFamily !== "other") return fromFamily;
  }
  return classifyFixtureFromName(node.name);
}

/**
 * A plumbing system's real topology, read from the routed model: the line
 * from the system's root (the water service or heater, the gas source, the
 * sanitary outfall, the vent's roof terminal) with every branch, device and
 * fixture on it in the order the pipe reaches them, each branch a line of its
 * own. Each drawn piece of pipe between two of those carries its size, length,
 * slope, invert and what it carries.
 *
 * The root and the loads are the pipe report's (`pipeSystemReportOf`), so the
 * riser prints the same numbers as the Properties panel and `bim_pipe_report`.
 * The walk is the report's breadth-first tree over `runNeighbours` (neighbours
 * in id order), so the same model always gives the same tree.
 */

type Elements = Readonly<Record<string, BimElement>>;
type Node = RunGraphNode;

const FT = 304.8;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const idOf = (n: Node): string => (n.includes("#") ? n.slice(0, n.indexOf("#")) : n);
export interface PipingTree {
  readonly root: DiagramNode;
  readonly pipes: readonly DiagramPipe[];
  readonly reads: readonly ElementId[];
}

interface Piece {
  readonly ids: ElementId[];
  readonly segments: RunSegment[];
  /** Where the first segment was entered (the end nearest the root): its downstream end on a drain. */
  entry: RunPoint | null;
  /** Length along the pipe from the station before it (a segment with branches on it is several pieces). */
  lengthMm: number;
}

const newPiece = (): Piece => ({ ids: [], segments: [], entry: null, lengthMm: 0 });

interface Walk {
  readonly root: Node;
  readonly children: ReadonlyMap<Node, readonly Node[]>;
  readonly parent: ReadonlyMap<Node, Node | null>;
  readonly weight: ReadonlyMap<Node, number>;
}

function component(elements: Elements, start: Node): Node[] {
  const seen = new Set<Node>([start]);
  const stack = [start];
  const out: Node[] = [];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined) break;
    out.push(n);
    for (const m of runNeighbours(elements, n)) {
      if (seen.has(m) || (!m.includes("#") && !elements[m])) continue;
      seen.add(m);
      stack.push(m);
    }
  }
  return out.sort();
}

function walkFrom(elements: Elements, root: Node): Walk {
  const parent = new Map<Node, Node | null>([[root, null]]);
  const children = new Map<Node, Node[]>();
  const order: Node[] = [];
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (n === undefined) break;
    order.push(n);
    const kids: Node[] = [];
    for (const m of runNeighbours(elements, n).sort()) {
      if (parent.has(m) || (!m.includes("#") && !elements[m])) continue;
      parent.set(m, n);
      kids.push(m);
      queue.push(m);
    }
    children.set(n, kids);
  }
  // How many ends (fixtures, open ends, caps) lie beyond each node: the heavier way on is the line, the others branch off it.
  const weight = new Map<Node, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i] as Node;
    const kids = children.get(n) ?? [];
    const w = kids.reduce((s, k) => s + (weight.get(k) ?? 0), 0);
    weight.set(n, kids.length === 0 ? 1 : w);
  }
  return { root, children, parent, weight };
}

/** Where along a segment a neighbour meets it (mm from its start). */
function positionOn(elements: Elements, seg: RunSegment, n: Node | null, length: number): number {
  if (n === null) return 0;
  const id = idOf(n);
  if (seg.links.start?.elementId === id) return 0;
  if (seg.links.end?.elementId === id) return length;
  const hosted = elements[id];
  if (hosted?.kind === "run_fitting" && hosted.host?.segmentId === seg.id) return hosted.host.s;
  return 0;
}

function abs3(elements: Elements, levelId: string, p: RunPoint): { x: number; y: number; z: number } {
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(runHeightMm(elements, levelId, p.z) * 10) / 10 };
}

function partName(elements: Elements, partId: string): string {
  const part = elements[partId];
  return part?.kind === "part" ? partLabelOf(elements, part) : partId;
}

/** The root the report counted from, as a walk node; for a system the report doesn't calculate (vent), its roof terminal. */
function rootNode(elements: Elements, system: MepSystem, report: PipeSystemReport, nodes: readonly Node[]): Node | null {
  const rootId = report.rootId;
  if (rootId) {
    const el = elements[rootId];
    if (el?.kind === "part") return nodes.find((n) => n.startsWith(`${rootId}#`)) ?? null;
    if (nodes.includes(rootId)) return rootId;
  }
  // Vent and other uncalculated piping: the highest open end (the vent through the roof), else the system's entry run.
  let best: { n: Node; z: number } | null = null;
  for (const n of nodes) {
    const el = elements[n];
    if (el?.kind !== "run_segment") continue;
    for (const end of ["start", "end"] as const) {
      if (el.links[end]) continue;
      const z = runHeightMm(elements, el.levelId, el[end].z);
      if (!best || z > best.z + 0.5) best = { n, z };
    }
  }
  if (best) return best.n;
  return system.entryId && nodes.includes(system.entryId) ? system.entryId : (nodes.find((n) => !n.includes("#")) ?? null);
}

/** The end a root segment is entered from: its open end (the highest for a vent through the roof, else the lowest: the outfall, the service). */
function rootEntry(elements: Elements, seg: RunSegment, top: boolean): "start" | "end" {
  const open = (["start", "end"] as const).filter((e) => !seg.links[e]);
  if (open.length === 1) return open[0] as "start" | "end";
  const zs = runHeightMm(elements, seg.levelId, seg.start.z);
  const ze = runHeightMm(elements, seg.levelId, seg.end.z);
  if (Math.abs(zs - ze) < 0.5) return "start";
  return top === zs > ze ? "start" : "end";
}

/**
 * Every connected piece of a system, each its own tree: a system drawn floor by
 * floor before its riser joins them is several pieces. The system's entry run
 * first, then the others by their lowest id.
 */
export function plumbingTrees(elements: Elements, system: MepSystem, hidden: ReadonlySet<string> = new Set()): PipingTree[] {
  const members: ElementId[] = [];
  for (const el of elementsOfKind(elements, "run_segment", "run_fitting")) if (el.systemId === system.id) members.push(el.id);
  members.sort(cmp);
  const anchors = system.entryId && members.includes(system.entryId) ? [system.entryId, ...members] : members;
  const covered = new Set<string>();
  const ids = new Set<string>();
  const out: PipingTree[] = [];
  for (const anchor of anchors) {
    if (covered.has(anchor)) continue;
    const tree = plumbingTree(elements, system, hidden, anchor, covered, ids);
    if (tree) out.push(tree);
    covered.add(anchor);
  }
  return out;
}

function plumbingTree(elements: Elements, system: MepSystem, hidden: ReadonlySet<string>, anchor: ElementId, covered: Set<string>, seenIds: Set<string>): PipingTree | null {
  const report = pipeSystemReportOf(elements, system.id, {}, anchor);
  if (!report) return null;
  const nodes = component(elements, anchor);
  for (const n of nodes) covered.add(n);
  const root = rootNode(elements, system, report, nodes);
  if (!root) return null;
  const walk = walkFrom(elements, root);
  const reads = new Set<ElementId>([system.id]);
  for (const n of nodes) {
    const el = elements[idOf(n)];
    if (!el) continue;
    reads.add(el.id);
    if (el.kind === "part") reads.add(el.typeId);
    if (el.kind === "run_segment" || el.kind === "run_fitting" || el.kind === "part") reads.add(el.levelId);
  }

  const kind = system.systemKind;
  const drain = drainSystemKinds().has(kind) || report.kind === "drainage";
  const unit = systemRules(kind).flowUnit;
  const loads = new Map<string, number>();
  if (report.kind === "drainage" || report.kind === "water") for (const s of report.segments) loads.set(s.elementId, s.fixtureUnits);
  if (report.kind === "gas") for (const s of report.segments) loads.set(s.elementId, s.mbh);
  const calculated = report.kind !== "not_calculated";
  // Gas: each regulator prints its outlet pressure and the input it serves; the source its inlet pressure and the total.
  const gas = kind === "natural_gas" ? gasNetwork({ elements }, system.id) : null;
  const mbhText = (mbh: number) => `${(Math.round(mbh * 100) / 100).toLocaleString("en-US")} MBH`;
  /** A device's name and lines; a gas regulator is named by its role and mark, with its outlet pressure and the input it serves. */
  const deviceLabel = (id: string, name: string, bold: boolean): { name: string; lines: DiagramNode["lines"] } => {
    const g = gas?.regulators.find((r) => r.elementId === id);
    if (!g) return { name, lines: [{ text: name.toUpperCase(), ...(bold ? { bold } : {}) }] };
    return { name: g.label, lines: [{ text: g.label.toUpperCase(), bold: true }, { text: `${pressureLabel(g.outletInWc).toUpperCase()}, ${mbhText(g.loadMbh)}` }] };
  };

  const edgeOf = (piece: Piece): DiagramEdge => {
    const first = piece.segments[0];
    const ids = [...new Set(piece.ids)];
    if (!first) return { linkId: (ids[0] ?? null) as ElementId | null, device: "none", elementIds: ids };
    let load = 0;
    const lengthMm = piece.lengthMm;
    let rise = 0;
    let run = 0;
    for (const s of piece.segments) {
      load = Math.max(load, loads.get(s.id) ?? (calculated ? 0 : s.flow));
      rise += Math.abs(s.end.z - s.start.z);
      run += Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
    }
    const sloped = drain ? piece.segments.find((s) => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) > 1 && slopeInPerFt(s) > 0.001) : undefined;
    const entry = piece.entry;
    const invert = drain && entry && first.size.shape === "pipe" ? feetText((runHeightMm(elements, first.levelId, entry.z) - pipeDims(first.size).idMm / 2) / FT) : undefined;
    const round = Math.round(load * 100) / 100;
    return {
      linkId: first.id,
      device: "none",
      label: nominalSizeText(first.size),
      elementIds: ids,
      lengthFt: Math.max(1, Math.round(lengthMm / FT)),
      ...(round > 0 && unit ? { load: `${round.toLocaleString("en-US")} ${unit}` } : {}),
      ...(sloped ? { slope: slopeText(slopeInPerFt(sloped)) } : {}),
      ...(invert ? { invert: `INV ${invert}` } : {}),
      ...(rise > run ? { vertical: true } : {}),
    };
  };

  const regMetaOf = (id: string): { reg: GasRegulator; inletInWc: number | null } | undefined => {
    const g = gas?.regulators.find((r) => r.elementId === id);
    if (!g) return undefined;
    const upZone = gas?.zones.find((z) => z.id === g.upstreamZoneId);
    return { reg: g, inletInWc: upZone?.inletInWc ?? null };
  };

  const node = (id: string, elementId: string, role: DiagramPipeRole, name: string, lines: DiagramNode["lines"], levelId: string | null, at: DiagramNode["at"], feed: DiagramEdge | undefined, children: DiagramNode[], meta?: PlumbingNodeMeta): DiagramNode => {
    const built: DiagramNode = {
      id,
      elementId: elementId as ElementId,
      kind: "equipment",
      labelKind: "equipment",
      name,
      lines,
      levelId,
      service: kind,
      role,
      ...(at ? { at } : {}),
      ...(feed ? { feed } : {}),
      children,
    };
    if (meta) setPlumbingNodeMeta(built, meta);
    return built;
  };

  const heaviest = (kids: readonly Node[]): Node | null => {
    let best: Node | null = null;
    for (const k of kids) if (best === null || (walk.weight.get(k) ?? 0) > (walk.weight.get(best) ?? 0)) best = k;
    return best;
  };

  const uniqueId = (id: string): string => {
    let out = id;
    for (let i = 2; seenIds.has(out); i++) out = `${id}~${i}`;
    seenIds.add(out);
    return out;
  };

  const terminalOfPart = (n: Node, piece: Piece): DiagramNode => {
    const partId = idOf(n);
    const part = elements[partId];
    const name = partName(elements, partId);
    const feed = edgeOf(piece);
    // The fixture's own load (its connector), not the pipe's: the pipe reaching it may carry the fixtures beyond it too.
    const own = part?.kind === "part" && calculated ? Math.round(loadOf(elements, part, n.slice(n.indexOf("#") + 1)) * 100) / 100 : 0;
    const appliance = gas?.appliances.find((a) => a.elementId === partId);
    const lines = [{ text: name.toUpperCase(), bold: true }, ...(appliance ? [{ text: mbhText(appliance.mbh) }] : own > 0 && unit ? [{ text: `${own.toLocaleString("en-US")} ${unit}` }] : [])];
    const at = part?.kind === "part" ? { x: part.position.x, y: part.position.y, z: runHeightMm(elements, part.levelId, part.offsetMm ?? 0) } : undefined;
    const meta = part?.kind === "part" ? metaFromPart(elements, part, kind) : undefined;
    return node(uniqueId(partId), partId, "terminal", name, lines, part?.kind === "part" ? part.levelId : null, at, feed, [], meta);
  };

  /** One line: from `start` (entered from `from`) to the end the heavier way leads, with the branches and devices on the way. */
  const line = (start: Node, from: Node | null, startEnd: "start" | "end" | null): DiagramNode[] => {
    const stations: DiagramNode[] = [];
    let piece = newPiece();
    let cur: Node | null = start;
    let prev: Node | null = from;
    let firstEnd = startEnd;
    const close = (): Piece => {
      const p = piece;
      piece = newPiece();
      return p;
    };
    while (cur !== null) {
      const el: BimElement | undefined = elements[idOf(cur)];
      const kids = walk.children.get(cur) ?? [];
      if (!el) break;
      if (el.kind === "part") {
        if (kids.length === 0) {
          if (!hidden.has(el.id)) stations.push(terminalOfPart(cur, close()));
          return stations;
        }
        // An inline part (meter, backflow preventer, pump) has both `#in` and `#out` graph nodes; emit one station on entry and pass silently through its exit port.
        if (prev === null || idOf(prev) !== el.id) {
          const label = deviceLabel(el.id, partName(elements, el.id), true);
          const rm = regMetaOf(el.id);
          const meta = metaFromPart(elements, el, kind, rm?.reg, rm?.inletInWc);
          if (!hidden.has(el.id)) stations.push(node(uniqueId(el.id), el.id, "device", label.name, label.lines, el.levelId, { x: el.position.x, y: el.position.y, z: runHeightMm(elements, el.levelId, el.offsetMm ?? 0) }, edgeOf(close()), [], meta));
        }
        const next = heaviest(kids);
        for (const k of kids) if (k !== next) stations.push(...branchAt(k, cur));
        prev = cur;
        cur = next;
        continue;
      }
      if (el.kind === "run_segment") {
        const seg = el;
        const length = segmentLength3(seg);
        const e = firstEnd ? (firstEnd === "start" ? 0 : length) : positionOn(elements, seg, prev, length);
        firstEnd = null;
        piece.ids.push(seg.id);
        piece.segments.push(seg);
        if (!piece.entry) piece.entry = e <= 0.5 ? seg.start : e >= length - 0.5 ? seg.end : null;
        const farPos = e <= 0.5 ? length : e >= length - 0.5 ? 0 : null;
        const farEnd = farPos === 0 ? "start" : "end";
        const placed = kids.map((k) => ({ k, pos: positionOn(elements, seg, k, length) })).sort((a, b) => Math.abs(a.pos - e) - Math.abs(b.pos - e) || cmp(a.k, b.k));
        const far = farPos === null ? null : (placed.find((p) => Math.abs(p.pos - farPos) < 0.5 && (seg.links.start?.elementId === idOf(p.k) || seg.links.end?.elementId === idOf(p.k)))?.k ?? null);
        // Straight through to the far end when there is one; an open far end finishes the line there.
        const openFar = farPos !== null && !seg.links[farEnd];
        const next = far ?? (openFar ? null : heaviest(kids));
        let lastPos = e;
        const advance = (pos: number) => {
          piece.lengthMm += Math.abs(pos - lastPos);
          lastPos = pos;
        };
        for (const { k, pos } of placed) {
          if (k === next) continue;
          const f = elements[idOf(k)];
          advance(pos);
          if (f?.kind === "run_fitting" && f.fittingType === "accessory") {
            if (hidden.has(f.id)) continue;
            const label = deviceLabel(f.id, f.label, false);
            const rm = regMetaOf(f.id);
            const meta = metaFromFitting(system, f, rm?.reg, rm?.inletInWc);
            stations.push(node(uniqueId(f.id), f.id, "device", label.name, label.lines, f.levelId, abs3(elements, f.levelId, f.position), edgeOf(close()), [], meta));
            piece.ids.push(seg.id);
            piece.segments.push(seg);
            continue;
          }
          const before = close();
          stations.push(...branchAt(k, cur, before));
          piece.ids.push(seg.id);
          piece.segments.push(seg);
        }
        if (farPos !== null) advance(farPos);
        if (next === null) {
          // The far end: open (a fixture's or the service's end), else the line stops where the walk met itself.
          const end = farEnd;
          if (openFar) {
            const id = `${seg.id}:${end}`;
            if (!hidden.has(id)) stations.push(node(uniqueId(id), seg.id, "terminal", "OPEN END", [{ text: "OPEN END" }], seg.levelId, abs3(elements, seg.levelId, seg[end]), edgeOf(close()), []));
          }
          return stations;
        }
        prev = cur;
        cur = next;
        continue;
      }
      if (el.kind === "run_fitting") {
        const f: RunFitting = el;
        piece.ids.push(f.id);
        if (f.fittingType === "cap" || kids.length === 0) {
          if (!hidden.has(f.id)) stations.push(node(uniqueId(f.id), f.id, "terminal", f.fittingType === "cap" ? "CAP" : "OPEN END", [{ text: f.fittingType === "cap" ? "CAP" : "OPEN END" }], f.levelId, abs3(elements, f.levelId, f.position), edgeOf(close()), []));
          return stations;
        }
        if (f.fittingType === "transition" && cur !== root) {
          stations.push(node(uniqueId(f.id), f.id, "device", f.label, [], f.levelId, abs3(elements, f.levelId, f.position), edgeOf(close()), []));
          piece.ids.push(f.id);
        }
        const next = heaviest(kids);
        for (const k of kids) if (k !== next) stations.push(...branchAt(k, cur, close()));
        prev = cur;
        cur = next;
        continue;
      }
      break;
    }
    return stations;
  };

  /** A branch leaving the line at `at` (a tee, a wye, or the other way at a fitting): its own line under one branch node. */
  const branchAt = (k: Node, at: Node, before: Piece = newPiece()): DiagramNode[] => {
    const el = elements[idOf(k)];
    if (!el || hidden.has(el.id)) return [];
    const where = el.kind === "run_fitting" ? abs3(elements, el.levelId, el.position) : el.kind === "run_segment" ? abs3(elements, el.levelId, el.start) : undefined;
    const levelId = el.kind === "run_fitting" || el.kind === "run_segment" || el.kind === "part" ? el.levelId : null;
    const name = el.kind === "run_fitting" ? el.label : el.kind === "part" ? partName(elements, el.id) : "BRANCH";
    if (el.kind === "part") return line(k, at, null);
    return [node(uniqueId(el.id), el.id, "branch", name, [], levelId, where, edgeOf(before), line(k, at, null))];
  };

  // The root: the source part, or the open end of the root pipe.
  const rootEl = elements[idOf(root)];
  if (!rootEl) return null;
  const gasSource = gas?.zones.find((z) => z.id === "zone-source");
  const gasSourceMeta: GasSourceMeta | undefined =
    gas && gasSource
      ? {
          fuel: gas.gas,
          heatingValueBtuPerCf: gas.heatingValueBtuPerCf,
          inletInWc: gasSource.inletInWc,
          inletLabel: pressureLabel(gasSource.inletInWc),
          totalMbh: gas.totalMbh,
          totalCfh: Math.round(((gas.totalMbh * 1000) / gas.heatingValueBtuPerCf) * 10) / 10,
        }
      : undefined;
  const gasTotalLine: DiagramNode["lines"] = gas && gasSource ? [{ text: `${GAS_FUEL_LABEL[gas.gas].toUpperCase()}, ${pressureLabel(gasSource.inletInWc).toUpperCase()}, ${mbhText(gas.totalMbh)} TOTAL` }] : [];
  let head: DiagramNode;
  if (rootEl.kind === "part") {
    const name = partName(elements, rootEl.id);
    const kids = walk.children.get(root) ?? [];
    const main = kids[0] ? line(kids[0], root, null) : [];
    for (const k of kids.slice(1)) main.push(...branchAt(k, root));
    const rootMeta: PlumbingNodeMeta = {
      ...metaFromPart(elements, rootEl, kind),
      ...(gasSourceMeta ? { gasSource: gasSourceMeta } : {}),
    };
    head = node(uniqueId(rootEl.id), rootEl.id, "source", name, [{ text: name.toUpperCase(), bold: true }, { text: system.name.toUpperCase() }, ...gasTotalLine], rootEl.levelId, { x: rootEl.position.x, y: rootEl.position.y, z: runHeightMm(elements, rootEl.levelId, rootEl.offsetMm ?? 0) }, undefined, main, rootMeta);
  } else {
    const entryEnd = rootEl.kind === "run_segment" ? rootEntry(elements, rootEl, kind === "vent") : null;
    const main = line(root, null, entryEnd);
    // Counted from an open end: where the pipe leaves the building (or enters it). Otherwise the report had nowhere to start; say so.
    const open = rootEl.kind === "run_segment" && entryEnd !== null && !rootEl.links[entryEnd];
    const word = !open ? (drain ? "NO OUTFALL CONNECTED" : "NO SOURCE CONNECTED") : drain ? (kind === "storm" ? "TO STORM" : "TO SEWER") : kind === "vent" ? "THRU ROOF" : "SERVICE";
    const at = rootEl.kind === "run_segment" && entryEnd ? abs3(elements, rootEl.levelId, rootEl[entryEnd]) : rootEl.kind === "run_fitting" ? abs3(elements, rootEl.levelId, rootEl.position) : undefined;
    const levelId = rootEl.kind === "run_segment" || rootEl.kind === "run_fitting" ? rootEl.levelId : null;
    head = node(uniqueId(`root:${system.id}`), rootEl.id, "source", word, [{ text: system.name.toUpperCase(), bold: true }, { text: word }, ...gasTotalLine], levelId, at, undefined, main, gasSourceMeta ? { gasSource: gasSourceMeta } : undefined);
  }

  const pipes: DiagramPipe[] = [];
  for (const n of nodes) {
    const el = elements[n];
    if (el?.kind !== "run_segment") continue;
    pipes.push({ elementId: el.id, systemKind: kind, a: abs3(elements, el.levelId, el.start), b: abs3(elements, el.levelId, el.end) });
  }
  pipes.sort((a, b) => cmp(a.elementId, b.elementId));
  return { root: head, pipes, reads: [...reads].sort() };
}
