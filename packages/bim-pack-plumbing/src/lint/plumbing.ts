import { ifgcEdition } from "@permitzip/bim-calc";
import {
  connectionTypeOfLoadPoint,
  elementsOfKind,
  loadAnchorOf,
  paramValue,
  placedConnectors,
  resolveConnectors,
  resolveFitting,
  runNeighbours,
  worldConnector,
  type BimElement,
  type ElementId,
  type LoadPointElement,
  type MepSystem,
  type Opening,
  type PartInstance,
  type PartTypeDefinition,
  type RunFitting,
  type RunSegment,
} from "@permitzip/bim-kernel";
import { clip, feet, feetInches, type RuleContext, type RuleDef } from "@permitzip/bim-lint";
import { sizeGasSystem, type GasFindingCode } from "../calc/plumbing/gas-system";
import { drainOutletSides, plumbingSourceRole } from "../connections/plumbing/adapter";
import {
  greaseClassWords,
  greaseFixtureClassOf,
  greaseRouteOf,
  isGreaseFixtureOnItsFace,
  requirementRequires,
  sewerAuthorityOf,
  type GreaseFixtureClass,
  type GreaseRoute,
} from "../plumbing/grease";
import { stackBendClearanceOf } from "../plumbing/stack-base";
import { stackAt, stackBaseClearanceDiameters } from "../plumbing/stacks";
import { gasNetwork, type GasAppliance } from "../routing/pipe/gas-zones";
import { backflowDeviceKindOf } from "./backflow";

/**
 * Plumbing checks (ROADMAP P5 + WS-2 #206). The building sewer checks
 * (manholes, pumps, backwater valves) are in drainage.ts; backflow protection
 * taxonomy checks are in backflow.ts; these are the fixture, grease, stack,
 * venting, thermal-expansion, water-pressure and gas code rules engineers
 * carry in their heads.
 *
 *   grease-fixture-bypasses-interceptor  a fixture (load_point or part) the sewer authority sends to a grease interceptor drains to the sewer without one
 *   grease-fixture-not-routed            the same fixture, with nothing drawn or named yet
 *   grease-authority-unknown             a grease-laden fixture and no sewer authority to say where it must go
 *   stack-base-branch-too-close          a branch within N pipe diameters of a stack's base or offset bend (off unless turned on)
 *   clear-water-in-grease-waste          clear-water fixture/equipment/condensate piped into grease waste or upstream of a grease interceptor (IPC 1003.3)
 *   vtr-air-intake-clearance             VTR / vent roof terminal within 10 ft horizontal and < 3 ft above an outdoor air intake / RTU / operable opening (IPC 903.5 / 903.2)
 *   water-heater-condensate-neutralizer  condensing gas water heater lacking a condensate neutralizer or acid-neutralizing specification (IPC 803.2 / IFGC 307.2)
 *   closed-water-expansion-tank          closed domestic water system (backflow/PRV/check + water heater) with no expansion tank connected (IPC 607.3)
 *   gas-appliance-venting-check          gas-fired water heater/furnace/boiler with unconnected flue/combustion-air port or missing venting specification (IFGC 501.2 / 304)
 *   water-pressure-prv-required          domestic cold water system with static supply pressure > 80 psi and no PRV (IPC 604.8)
 *   gas-system-sizing-lint               IFGC gas system sizing, pressure-zone regulator, minimum inlet pressure and sediment-trap checks (IFGC 402.4 / 408.4 / 410)
 */

type Elements = Readonly<Record<string, BimElement>>;

const MM_PER_FT = 304.8;
const TEN_FT_MM = 10 * MM_PER_FT;
const THREE_FT_MM = 3 * MM_PER_FT;
const MAX_STATIC_WATER_PSI = 80;

const DRAIN_KINDS: ReadonlySet<string> = new Set(["sanitary", "grease_waste", "indirect_waste"]);
const POTABLE_KINDS: ReadonlySet<string> = new Set(["domestic_cold_water", "domestic_hot_water", "domestic_hot_water_return"]);

// ------------------------------------------------------------------ shared helpers

function loadName(lp: LoadPointElement): string {
  return lp.mark?.trim() || lp.id;
}

function partName(els: Elements, id: string | null): string {
  if (!id) return "the sewer";
  const el = els[id];
  return el?.kind === "part" ? el.mark.trim() || el.id : id;
}

function partDef(els: Elements, part: PartInstance): PartTypeDefinition | null {
  const t = els[part.typeId];
  return t?.kind === "part_type" ? t.definition : null;
}

function readParam(def: PartTypeDefinition, part: PartInstance, name: string): unknown {
  const fromSchema = paramValue(def, part.values, name);
  if (fromSchema !== undefined) return fromSchema;
  if (name in part.values) return part.values[name];
  if (name in def.typeValues) return def.typeValues[name];
  return undefined;
}

function readStringParam(def: PartTypeDefinition, part: PartInstance, name: string): string {
  const v = readParam(def, part, name);
  return typeof v === "string" ? v.trim() : "";
}

function readNumberParam(def: PartTypeDefinition, part: PartInstance, name: string): number | null {
  const v = readParam(def, part, name);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function partWords(def: PartTypeDefinition, part: PartInstance): string {
  const desc = readStringParam(def, part, "description");
  const note = readStringParam(def, part, "note");
  return [def.familyName, def.typeName, desc, part.mark, note, part.planned?.note ?? ""].join(" ");
}

function levelElevOf(els: Elements, levelId: string): number {
  const l = els[levelId];
  return l?.kind === "level" ? l.elevationMm : 0;
}

function atElement(ctx: RuleContext, el: BimElement) {
  const body = ctx.body(el.id);
  const c = body ? { x: (body.box.min.x + body.box.max.x) / 2, y: (body.box.min.y + body.box.max.y) / 2, z: body.box.min.z } : { x: 0, y: 0, z: 0 };
  return { level: ctx.levelNameOf(el), x_ft: feet(c.x), y_ft: feet(c.y), z_ft: feet(c.z) };
}

function atId(ctx: RuleContext, els: Elements, id: string | null, fallback: BimElement) {
  const target = id ? els[id] : undefined;
  return atElement(ctx, target ?? fallback);
}

const firstOf = (s: ReadonlySet<ElementId>): ElementId | null => [...s].sort()[0] ?? null;

// ------------------------------------------------------------------ grease on load_point + modeled part (with dedup)

const attachedPartsCache = new WeakMap<object, ReadonlySet<string>>();

/** Part ids that already have an attached load_point (deduplication for grease & clear-water rules). */
function attachedPartIds(els: Elements): ReadonlySet<string> {
  const hit = attachedPartsCache.get(els);
  if (hit) return hit;
  const ids = new Set<string>();
  for (const lp of elementsOfKind(els, "load_point")) {
    const anchor = loadAnchorOf(lp);
    const pid = lp.attachedPartId ?? (anchor.kind === "part" ? anchor.partId : undefined);
    if (pid) ids.add(pid);
  }
  attachedPartsCache.set(els, ids);
  return ids;
}

const PART_DESIGNATOR_CLASS: Readonly<Record<string, GreaseFixtureClass>> = {
  SK3: "three_compartment_sink",
  SK1: "prep_sink",
  SK2: "prep_sink",
  MS: "mop_sink",
  FS: "floor_sink",
  DW: "dishwasher",
  HS: "hand_sink",
  FD: "floor_drain",
  TD: "floor_drain",
  "WC-FT": "restroom",
  "WC-FV": "restroom",
  UR: "restroom",
  LAV: "restroom",
};

const NON_GREASE_STARTERS: ReadonlySet<string> = new Set([
  "FCO",
  "WCO",
  "CO",
  "VTR",
  "ET",
  "RPZ",
  "PRV",
  "MTR",
  "RP",
  "GI",
  "GR",
  "ST",
  "HB",
  "DF",
  "IM",
  "WH-T",
  "WH-E",
  "WH-GT",
  "WH-ET",
  "G-RANGE",
  "G-FRYER",
  "G-GRILL",
]);

const CLEAR_WATER_STARTERS: ReadonlySet<string> = new Set(["IM", "DF", "EWC", "BF", "COND"]);
const CLEAR_WATER_REGEX = /\b(ice ?maker|ice ?machine|drinking ?fountain|water ?cooler|bottle ?filler|clear[- ]?water|indirect[- ]?clear|condensate)\b/i;

const PART_WORD_CLASS: ReadonlyArray<readonly [GreaseFixtureClass, RegExp]> = [
  ["three_compartment_sink", /\b(three|3)[- ]?(compartment|comp\.?)\b/i],
  ["mop_sink", /\b(mop|service|janitor'?s?) (sink|basin|receptor)\b/i],
  ["floor_sink", /\bfloor sinks?\b/i],
  ["dishwasher", /\bdish ?wash\w*/i],
  ["hand_sink", /\bhand ?(sink|wash)\w*/i],
  ["restroom", /\b(water closet|toilet|urinal|lavator\w*|wc)\b/i],
  ["floor_drain", /\b(floor|trench|hub) drains?\b/i],
  ["prep_sink", /\b(prep|one|two|1|2)[- ]?(compartment )?sinks?\b|\b(bar|dump|veg\w*|pot) sinks?\b/i],
];

function isClearWaterPart(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  if (plumbingSourceRole(els, part) !== null) return false;
  if (readParam(def, part, "clear_water") === true) return true;
  for (const k of ["waste_class", "drain_kind", "water_class"]) {
    const v = readStringParam(def, part, k);
    if (v && /clear[-_ ]?water|indirect[-_ ]?clear|condensate/i.test(v)) return true;
  }
  const starter = readStringParam(def, part, "default_connection_type").toUpperCase();
  if (CLEAR_WATER_STARTERS.has(starter)) return true;
  return CLEAR_WATER_REGEX.test(partWords(def, part));
}

function isClearWaterLoad(els: Elements, lp: LoadPointElement): boolean {
  const designator = lp.connectionType.trim().toUpperCase();
  if (CLEAR_WATER_STARTERS.has(designator)) return true;
  const ct = connectionTypeOfLoadPoint(els, lp);
  const words = [ct?.description ?? "", ct?.comments ?? "", lp.note ?? "", lp.mark ?? ""].join(" ");
  if (CLEAR_WATER_REGEX.test(words)) return true;
  const anchor = loadAnchorOf(lp);
  const pid = lp.attachedPartId ?? (anchor.kind === "part" ? anchor.partId : undefined);
  const part = pid ? els[pid] : undefined;
  return part?.kind === "part" ? isClearWaterPart(els, part) : false;
}

function partGreaseClassOf(els: Elements, part: PartInstance): GreaseFixtureClass | null {
  const def = partDef(els, part);
  if (!def) return null;
  if (plumbingSourceRole(els, part) !== null) return null;
  if (isClearWaterPart(els, part)) return null;
  const starter = readStringParam(def, part, "default_connection_type").toUpperCase();
  if (NON_GREASE_STARTERS.has(starter)) return null;
  const byStarter = PART_DESIGNATOR_CLASS[starter];
  if (byStarter) return byStarter;
  const connectors = resolveConnectors(def, part.values);
  const hasDrain = connectors.some((c) => c.domain === "pipe" && DRAIN_KINDS.has(c.systemKind));
  if (!hasDrain) return null;
  if (def.category === "pipe_accessory") return null;
  const words = partWords(def, part);
  for (const [cls, re] of PART_WORD_CLASS) if (re.test(words)) return cls;
  return def.category === "plumbing_fixture" ? "other_drain" : null;
}

function partHasGreaseWasteConnector(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  return resolveConnectors(def, part.values).some((c) => c.domain === "pipe" && c.systemKind === "grease_waste");
}

function isPartGreaseOnItsFace(els: Elements, part: PartInstance): boolean {
  return partHasGreaseWasteConnector(els, part) || partGreaseClassOf(els, part) === "three_compartment_sink";
}

function isPartInletConnector(els: Elements, part: PartInstance, port: string): boolean {
  const def = partDef(els, part);
  const c = def?.connectors.find((x) => x.id === port);
  if (c?.flowDirection === "in") return true;
  if (c?.flowDirection === "out") return false;
  return port === "in";
}

function partGreaseRouteOf(els: Elements, part: PartInstance): GreaseRoute {
  const def = partDef(els, part);
  if (!def) return { kind: "not_routed" };
  for (const c of resolveConnectors(def, part.values)) {
    if (c.domain !== "pipe" || !DRAIN_KINDS.has(c.systemKind)) continue;
    const link = part.links?.[c.id];
    if (!link) continue;
    const target = els[link.elementId];
    if (!target) continue;
    if (target.kind === "part") {
      const role = plumbingSourceRole(els, target);
      if (role === "grease_interceptor") {
        return isPartInletConnector(els, target, link.port)
          ? { kind: "through_interceptor", interceptorId: target.id, how: "drawn" }
          : { kind: "bypasses", toId: null, how: "drawn", belowInterceptor: target.id };
      }
      if (role === "sewer_connection" || role === "sewage_pump" || role === "backwater_valve") {
        return { kind: "bypasses", toId: target.id, how: "drawn", belowInterceptor: null };
      }
      continue;
    }
    const sides = drainOutletSides(els, target.id);
    const gi = firstOf(sides.interceptorInlets);
    if (gi) return { kind: "through_interceptor", interceptorId: gi, how: "drawn" };
    if (sides.interceptorOutlets.size > 0 || sides.sewer.size > 0) {
      return { kind: "bypasses", toId: firstOf(sides.sewer), how: "drawn", belowInterceptor: firstOf(sides.interceptorOutlets) };
    }
  }
  return { kind: "not_routed" };
}

/** The fixture class a known authority sends to the interceptor, for a load_point. */
function requiredLoadClass(els: Elements, lp: LoadPointElement): { cls: GreaseFixtureClass; authority: string; cite: string; connectionId: string } | null {
  const a = sewerAuthorityOf(els);
  if (a.kind !== "known") return null;
  const cls = greaseFixtureClassOf(els, lp);
  if (!cls) return null;
  if (lp.service !== "grease_waste" && !requirementRequires(a.requires, cls)) return null;
  return { cls, authority: a.authority, cite: a.cite, connectionId: a.connectionId };
}

/** The fixture class a known authority sends to the interceptor, for a modeled part. */
function requiredPartClass(els: Elements, part: PartInstance): { cls: GreaseFixtureClass; authority: string; cite: string; connectionId: string } | null {
  const a = sewerAuthorityOf(els);
  if (a.kind !== "known") return null;
  const cls = partGreaseClassOf(els, part);
  if (!cls) return null;
  if (!partHasGreaseWasteConnector(els, part) && !requirementRequires(a.requires, cls)) return null;
  return { cls, authority: a.authority, cite: a.cite, connectionId: a.connectionId };
}

interface GreaseWasteHit {
  readonly targetId: ElementId;
  readonly where: string;
}

/** Check whether a linked drain/condensate target enters a grease_waste system or leads upstream into a grease interceptor. */
function greaseWasteHitAt(els: Elements, targetId: ElementId, targetPort?: string): GreaseWasteHit | null {
  const target = els[targetId];
  if (!target) return null;
  if (target.kind === "part") {
    if (plumbingSourceRole(els, target) === "grease_interceptor" && (!targetPort || isPartInletConnector(els, target, targetPort))) {
      return { targetId: target.id, where: `grease interceptor ${partName(els, target.id)}` };
    }
    return null;
  }
  if (target.kind === "run_segment" || target.kind === "run_fitting") {
    const sys = els[target.systemId];
    if (sys?.kind === "mep_system" && sys.systemKind === "grease_waste") {
      return { targetId: target.id, where: `${sys.name || "grease waste"} (grease_waste)` };
    }
    const sides = drainOutletSides(els, target.id);
    const gi = firstOf(sides.interceptorInlets);
    if (gi) return { targetId: gi, where: `grease interceptor ${partName(els, gi)}` };
  }
  return null;
}

// ------------------------------------------------------------------ VTR vs outdoor air intake / operable opening (IPC 903.5 / 903.2)

function isVtrPart(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  const starter = readStringParam(def, part, "default_connection_type").toUpperCase();
  if (starter === "VTR") return true;
  if (/\b(vtr|vent through roof|roof vent|vent terminal|vent stack termination)\b/i.test(`${def.familyName} ${def.typeName} ${part.mark}`)) return true;
  if (def.category === "pipe_accessory") {
    const pipes = resolveConnectors(def, part.values).filter((c) => c.domain === "pipe");
    if (pipes.length === 1 && pipes[0]?.systemKind === "vent") return true;
  }
  return false;
}

interface IntakeTarget {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly topZ: number;
  readonly linked?: { readonly modelId: string; readonly globalId: string; readonly name: string; readonly ifcClass: string };
}

const INTAKE_PART_REGEX = /\b(outdoor[- ]?air|outside[- ]?air|oa[- ]?intake|air[- ]?intake|fresh[- ]?air|intake[- ]?(hood|louver)|rtu|rooftop[- ]?unit|mau|make[- ]?up[- ]?air|erv|hrv|ahu)\b/i;

function intakeTargetsInModel(ctx: RuleContext, vtrId: ElementId): IntakeTarget[] {
  const els = ctx.model.elements;
  const targets: IntakeTarget[] = [];

  for (const part of elementsOfKind(els, "part")) {
    if (part.id === vtrId || isVtrPart(els, part)) continue;
    const type = els[part.typeId];
    if (type?.kind !== "part_type") continue;
    const def = type.definition;
    const elev = levelElevOf(els, part.levelId);
    const body = ctx.body(part.id);
    const connectors = placedConnectors(type, part);
    const oaConnectors = connectors.filter((c) => c.domain === "duct" && c.systemKind === "outside_air");

    if (oaConnectors.length > 0) {
      for (const c of oaConnectors) {
        const w = worldConnector(part, c);
        const halfH = c.height ? c.height / 2 : c.diameter ? c.diameter / 2 : 0;
        targets.push({
          id: part.id,
          label: `${partName(els, part.id)} (${c.label})`,
          x: w.position.x,
          y: w.position.y,
          topZ: elev + w.position.z + halfH,
        });
      }
      continue;
    }

    if (INTAKE_PART_REGEX.test(partWords(def, part))) {
      const cx = body ? (body.box.min.x + body.box.max.x) / 2 : part.position.x;
      const cy = body ? (body.box.min.y + body.box.max.y) / 2 : part.position.y;
      const topZ = body ? body.box.max.z : elev + part.offsetMm + (readNumberParam(def, part, "height") ?? 0);
      targets.push({ id: part.id, label: partName(els, part.id), x: cx, y: cy, topZ });
    }
  }

  for (const op of elementsOfKind(els, "opening") as readonly Opening[]) {
    if (op.openingType !== "window" && op.openingType !== "door" && op.openingType !== "louver") continue;
    const body = ctx.body(op.id);
    const host = els[op.hostId];
    const levelId = op.partition?.level ?? host?.partition?.level;
    const elev = levelId ? levelElevOf(els, levelId) : 0;
    const cx = body ? (body.box.min.x + body.box.max.x) / 2 : op.position.x;
    const cy = body ? (body.box.min.y + body.box.max.y) / 2 : op.position.y;
    const topZ = body ? body.box.max.z : elev + op.height;
    const label = op.mark.trim() || `${op.openingType} ${op.id}`;
    targets.push({ id: op.id, label, x: cx, y: cy, topZ });
  }

  for (const linkedModel of ctx.linked) {
    for (const le of linkedModel.elements) {
      const isOpening = le.kind === "window" || le.kind === "door" || le.kind === "opening";
      const isLinkedIntake = le.kind === "mep" && INTAKE_PART_REGEX.test(le.name);
      if (!isOpening && !isLinkedIntake) continue;
      const [minX, minY, , maxX, maxY, maxZ] = le.box;
      targets.push({
        id: le.globalId,
        label: le.name || le.kind,
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        topZ: maxZ,
        linked: { modelId: linkedModel.modelId, globalId: le.globalId, name: le.name, ifcClass: le.ifcClass },
      });
    }
  }

  return targets;
}

// ------------------------------------------------------------------ gas water heater / appliance helpers

function isGasFiredPart(part: PartInstance, def: PartTypeDefinition): boolean {
  const starter = readStringParam(def, part, "default_connection_type").toUpperCase();
  if (starter === "WH-E" || starter === "WH-ET") return false;
  const heaterKind = readStringParam(def, part, "heater_kind").toLowerCase();
  if (heaterKind === "electric_tankless" || heaterKind === "electric" || heaterKind === "electric_tank") return false;
  if (heaterKind === "gas_tankless" || heaterKind === "gas_tank") return true;
  if (starter === "WH-T" || starter === "WH-GT") return true;
  const fuel = readStringParam(def, part, "fuel").toLowerCase();
  if (/electric/i.test(fuel)) return false;
  if (/gas|propane|lp|ng/i.test(fuel)) return true;
  const connectors = resolveConnectors(def, part.values);
  if (connectors.some((c) => c.domain === "pipe" && c.systemKind === "natural_gas")) return true;
  const text = partWords(def, part);
  if (/\belectric\b/i.test(text) && !/\bgas\b/i.test(text)) return false;
  return /\b(gas[- ]?fired|natural[- ]?gas|propane|gas[- ]?water[- ]?heater|gas[- ]?furnace|gas[- ]?boiler)\b/i.test(text);
}

function isWaterHeaterPart(els: Elements, part: PartInstance, def: PartTypeDefinition): boolean {
  if (plumbingSourceRole(els, part) === "water_heater") return true;
  if (readStringParam(def, part, "heater_kind") !== "") return true;
  const starter = readStringParam(def, part, "default_connection_type").toUpperCase();
  if (starter === "WH-T" || starter === "WH-E" || starter === "WH-GT" || starter === "WH-ET") return true;
  return /\bwater[- ]?heater\b/i.test(partWords(def, part));
}

function isCondensingGasWaterHeater(els: Elements, part: PartInstance, def: PartTypeDefinition): boolean {
  if (!isWaterHeaterPart(els, part, def) || !isGasFiredPart(part, def)) return false;
  if (readParam(def, part, "condensing") === true) return true;
  if (readParam(def, part, "condensing") === false) return false;
  for (const k of ["thermal_efficiency", "efficiency", "afue", "uef"]) {
    const n = readNumberParam(def, part, k);
    if (n !== null && ((n >= 0.9 && n <= 1.0) || n >= 90)) return true;
  }
  for (const k of ["vent_category", "flue_category"]) {
    const v = readStringParam(def, part, k);
    if (/\b(iv|4|cat[- ]?iv|cat[- ]?4|condensing)\b/i.test(v)) return true;
  }
  const connectors = resolveConnectors(def, part.values);
  if (connectors.some((c) => c.domain === "pipe" && c.systemKind === "condensate")) return true;
  return /\bcondens(ing|ation)\b/i.test(partWords(def, part));
}

function isNeutralizerPart(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  if (readParam(def, part, "condensate_neutralizer") === true) return true;
  if (readStringParam(def, part, "plumbing_role").toLowerCase() === "condensate_neutralizer") return true;
  return /\b(neutraliz\w*|acid[- ]?neutral\w*)\b/i.test(partWords(def, part));
}

function hasCondensateNeutralizer(els: Elements, part: PartInstance, def: PartTypeDefinition): boolean {
  for (const k of ["condensate_neutralizer", "neutralizer"]) {
    const v = readParam(def, part, k);
    if (v === true) return true;
    if (typeof v === "string" && v.trim() !== "" && !/^(false|no|none)$/i.test(v.trim())) return true;
  }
  const notes = [readStringParam(def, part, "condensate_note"), readStringParam(def, part, "description"), readStringParam(def, part, "note"), part.planned?.note ?? ""].join(" ");
  if (/\b(neutraliz\w*|acid[- ]?neutral\w*|limestone|calcite)\b/i.test(notes)) return true;

  // Walk condensate / indirect_waste / drain connectors to see if a neutralizer part is piped downstream.
  const connectors = resolveConnectors(def, part.values);
  for (const c of connectors) {
    if (c.domain !== "pipe" || (c.systemKind !== "condensate" && c.systemKind !== "indirect_waste" && c.systemKind !== "sanitary")) continue;
    const link = part.links?.[c.id];
    if (!link) continue;
    const start = els[link.elementId]?.kind === "part" ? `${link.elementId}#${link.port}` : link.elementId;
    const seen = new Set<string>([`${part.id}#${c.id}`, start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const n = queue.shift() as string;
      const hash = n.indexOf("#");
      if (hash >= 0) {
        const pid = n.slice(0, hash);
        if (pid === part.id) continue;
        const other = els[pid];
        if (other?.kind === "part" && isNeutralizerPart(els, other)) return true;
        continue;
      }
      for (const nb of runNeighbours(els, n)) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return false;
}

// ------------------------------------------------------------------ domestic water system network helpers (PRV & expansion tank)

interface WaterSystemInventory {
  readonly segments: RunSegment[];
  readonly fittings: RunFitting[];
  readonly parts: PartInstance[];
}

function collectWaterSystemInventory(els: Elements, systemId: ElementId): WaterSystemInventory {
  const segments: RunSegment[] = [];
  const fittings: RunFitting[] = [];
  const partMap = new Map<string, PartInstance>();

  const seeds: string[] = [];
  for (const seg of elementsOfKind(els, "run_segment")) {
    if (seg.systemId === systemId) {
      segments.push(seg);
      seeds.push(seg.id);
    }
  }
  for (const fit of elementsOfKind(els, "run_fitting")) {
    if (fit.systemId === systemId) {
      fittings.push(fit);
      seeds.push(fit.id);
    }
  }

  // BFS across linked parts and inline pipe accessories (so parts connected on either side of a meter/PRV/RPZ/check valve are all discovered).
  const seen = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    const hash = node.indexOf("#");
    if (hash >= 0) {
      const pid = node.slice(0, hash);
      const part = els[pid];
      if (part?.kind !== "part") continue;
      partMap.set(part.id, part);
      const def = partDef(els, part);
      if (!def) continue;
      // Step across inline accessories AND water heaters (so an expansion tank connected to a water heater is found too).
      if (def.category === "pipe_accessory" || isWaterHeaterPart(els, part, def)) {
        for (const c of resolveConnectors(def, part.values)) {
          if (c.domain !== "pipe" || !POTABLE_KINDS.has(c.systemKind)) continue;
          const link = part.links?.[c.id];
          if (!link) continue;
          const next = els[link.elementId]?.kind === "part" ? `${link.elementId}#${link.port}` : link.elementId;
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      continue;
    }
    const el = els[node];
    if (!el) continue;
    if (el.kind === "run_segment" && el.systemId !== systemId) {
      const sys = els[el.systemId];
      if (sys?.kind !== "mep_system" || !POTABLE_KINDS.has(sys.systemKind)) continue;
    }
    if (el.kind === "run_fitting" && el.systemId !== systemId) {
      const sys = els[el.systemId];
      if (sys?.kind !== "mep_system" || !POTABLE_KINDS.has(sys.systemKind)) continue;
    }
    for (const nb of runNeighbours(els, node)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }

  return { segments, fittings, parts: [...partMap.values()] };
}

function isPrvPart(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  if (readParam(def, part, "prv") === true) return true;
  if (readStringParam(def, part, "plumbing_role").toLowerCase() === "prv") return true;
  if (readStringParam(def, part, "default_connection_type").toUpperCase() === "PRV") return true;
  return /\b(prv|pressure[- ]?reducing[- ]?valve)\b/i.test(partWords(def, part));
}

function isPrvFitting(els: Elements, fit: RunFitting): boolean {
  if (fit.family === "pipe.valve.prv") return true;
  const sys = els[fit.systemId];
  const rf = resolveFitting(sys?.kind === "mep_system" ? sys : null, fit);
  return rf?.family.pipe?.accessory === "prv" || /\bprv\b/i.test(fit.family ?? "");
}

function isCheckOrClosingFitting(els: Elements, fit: RunFitting): boolean {
  if (isPrvFitting(els, fit) || fit.family === "pipe.valve.check") return true;
  return /\b(check|prv|backflow|rpz|dcva)\b/i.test(fit.family ?? "");
}

function isClosingDevicePart(els: Elements, part: PartInstance): boolean {
  if (backflowDeviceKindOf(els, part) !== null || isPrvPart(els, part)) return true;
  const def = partDef(els, part);
  if (!def) return false;
  if (readParam(def, part, "check_valve") === true || readParam(def, part, "closed_system") === true) return true;
  return def.category === "pipe_accessory" && /\b(check[- ]?valve|backflow|pressure[- ]?reducing)\b/i.test(partWords(def, part));
}

function isExpansionTankPart(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  if (readParam(def, part, "expansion_tank") === true) return true;
  if (readStringParam(def, part, "default_connection_type").toUpperCase() === "ET") return true;
  return /\b(expansion[- ]?tank|thermal[- ]?expansion)\b/i.test(partWords(def, part));
}

function waterStaticPressurePsi(els: Elements, sys: MepSystem, parts: readonly PartInstance[]): number | null {
  if (typeof sys.design?.pipe?.supplyPressurePsi === "number" && Number.isFinite(sys.design.pipe.supplyPressurePsi)) {
    return sys.design.pipe.supplyPressurePsi;
  }
  for (const part of parts) {
    if (plumbingSourceRole(els, part) !== "water_meter") continue;
    const def = partDef(els, part);
    if (!def) continue;
    for (const k of ["static_pressure_psi", "supply_pressure_psi", "street_pressure_psi"]) {
      const v = readNumberParam(def, part, k);
      if (v !== null) return v;
    }
  }
  return null;
}

// ------------------------------------------------------------------ gas appliance venting & sediment trap helpers

function isGasVentingAppliance(els: Elements, part: PartInstance, def: PartTypeDefinition): boolean {
  if (!isGasFiredPart(part, def)) return false;
  if (readParam(def, part, "unvented") === true || readStringParam(def, part, "vent_type").toLowerCase() === "unvented") return false;
  if (isWaterHeaterPart(els, part, def)) return true;
  return /\b(boiler|furnace|unit[- ]?heater)\b/i.test(partWords(def, part));
}

function hasVentingSpecification(def: PartTypeDefinition, part: PartInstance): boolean {
  for (const k of ["vent_type", "flue_type", "vent_category", "flue_category", "venting", "vent_spec", "flue_material"]) {
    const v = readStringParam(def, part, k);
    if (v && !/^(none|unknown|tbd)$/i.test(v)) return true;
  }
  for (const k of ["flue_size", "flue_diameter", "vent_diameter", "flue"]) {
    const n = readNumberParam(def, part, k);
    if (n !== null && n > 0) return true;
    const s = readStringParam(def, part, k);
    if (s && !/^(none|unknown|tbd)$/i.test(s)) return true;
  }
  const notes = [readStringParam(def, part, "description"), readStringParam(def, part, "note"), part.planned?.note ?? ""].join(" ");
  return /\b(b-?vent|cat\s*[i1-4v]+|direct[- ]?vent|power[- ]?vent|atmospheric[- ]?vent|pvc[- ]?flue|cpvc[- ]?flue|sealed[- ]?combustion|flue[- ]?size|vented)\b/i.test(notes);
}

const SEDIMENT_TRAP_EXEMPT_STARTERS: ReadonlySet<string> = new Set(["G-RANGE", "G-GRILL", "G-FRYER"]);
const SEDIMENT_TRAP_EXEMPT_REGEX = /\b(range|stove|cooktop|oven|grill|griddle|fryer|clothes[- ]?dryer|dryer|fireplace|decorative|illuminating)\b/i;

function requiresSedimentTrap(els: Elements, app: GasAppliance): boolean {
  const el = els[app.elementId];
  if (el?.kind === "part") {
    const def = partDef(els, el);
    if (def) {
      if (readParam(def, el, "sediment_trap_required") === true) return true;
      if (readParam(def, el, "sediment_trap_exempt") === true) return false;
      const starter = readStringParam(def, el, "default_connection_type").toUpperCase();
      if (SEDIMENT_TRAP_EXEMPT_STARTERS.has(starter)) return false;
      if (SEDIMENT_TRAP_EXEMPT_REGEX.test(partWords(def, el))) return false;
      if (isWaterHeaterPart(els, el, def) || /\b(boiler|furnace|unit[- ]?heater|rtu|rooftop|doas|make[- ]?up[- ]?air|mau|ahu|heater)\b/i.test(partWords(def, el))) return true;
    }
  }
  if (SEDIMENT_TRAP_EXEMPT_REGEX.test(`${app.label} ${app.description}`)) return false;
  return /\b(water[- ]?heater|boiler|furnace|unit[- ]?heater|rtu|rooftop|doas|make[- ]?up[- ]?air|mau|ahu|heater)\b/i.test(`${app.label} ${app.description}`);
}

function isSedimentTrapPart(els: Elements, part: PartInstance): boolean {
  const def = partDef(els, part);
  if (!def) return false;
  if (readStringParam(def, part, "default_connection_type").toUpperCase() === "ST") return true;
  return /\b(sediment[- ]?trap|drip[- ]?leg)\b/i.test(partWords(def, part));
}

function hasSedimentTrapOnBranch(els: Elements, app: GasAppliance): boolean {
  const el = els[app.elementId];
  if (el?.kind === "part") {
    const def = partDef(els, el);
    if (def && readParam(def, el, "sediment_trap") === true) return true;
  }
  if (!app.feedElementId) return false;
  // Walk along the appliance's gas branch (stopping at regulators / other appliances) looking for a drip_leg fitting or ST part.
  const seen = new Set<string>([app.elementId, app.feedElementId]);
  const queue: Array<{ readonly node: string; readonly depth: number }> = [{ node: app.feedElementId, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift() as { readonly node: string; readonly depth: number };
    const hash = node.indexOf("#");
    if (hash >= 0) {
      const pid = node.slice(0, hash);
      const p = els[pid];
      if (p?.kind === "part" && isSedimentTrapPart(els, p)) return true;
      continue;
    }
    const item = els[node];
    if (!item) continue;
    if (item.kind === "run_fitting") {
      if (item.family === "pipe.gas.drip_leg") return true;
      const sys = els[item.systemId];
      const rf = resolveFitting(sys?.kind === "mep_system" ? sys : null, item);
      if (rf?.family.pipe?.accessory === "drip_leg") return true;
      if (rf?.family.pipe?.accessory === "regulator") continue;
    }
    if (depth >= 12) continue;
    for (const nb of runNeighbours(els, node)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      queue.push({ node: nb, depth: depth + 1 });
    }
  }
  return false;
}

function gasFindingFix(code: GasFindingCode): { readonly tool: string; readonly hint: string } {
  switch (code) {
    case "undersized_gas_pipe":
    case "no_size_fits":
      return { tool: "bim_resize_run", hint: "resize the gas pipe to the IFGC Table 402.4 proposed diameter, or adjust zone pressure" };
    case "regulator_missing":
      return { tool: "bim_place_part", hint: "insert a line or appliance gas pressure regulator upstream to step down to <= 14 in. w.c." };
    case "regulator_raises_pressure":
    case "regulator_over_capacity":
    case "zone_below_appliance_minimum":
      return { tool: "bim_set_parameters", hint: "check the regulator outlet pressure / capacity and the appliance minimum inlet pressure" };
    case "appliance_no_input":
      return { tool: "bim_set_parameters", hint: "enter the appliance gas input (MBH) on its connection type or load" };
    case "no_source":
      return { tool: "bim_place_part", hint: "connect a gas meter or service regulator as the gas system source" };
    case "mixed_material":
      return { tool: "bim_set_parameters", hint: "verify pipe material matches an IFGC Table 402.4 gas piping table" };
  }
}

// ------------------------------------------------------------------ rules

/** The 4 batch-5c plumbing rules (kept in their original rank-900 slot; grease rules now evaluate both load_point and modeled part). */
export const batch5cPlumbingRules: readonly RuleDef[] = [
  {
    id: "grease-fixture-bypasses-interceptor",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "A fixture the sewer authority sends to a grease interceptor drains to the sewer without one",
    scope: "element",
    kinds: ["load_point", "part"],
    run: (ctx, el) => {
      const els = ctx.model.elements;
      if (el.kind === "load_point") {
        const need = requiredLoadClass(els, el);
        if (!need) return;
        const route = greaseRouteOf(els, el);
        if (route.kind !== "bypasses") return;
        const where = route.belowInterceptor ? `joins below ${partName(els, route.belowInterceptor)}` : `drains to ${partName(els, route.toId)}`;
        const how = route.how === "named" ? " (its named source)" : "";
        ctx.emit({
          rule: "grease-fixture-bypasses-interceptor",
          severity: "error",
          elementIds: [el.id, ...(route.toId ? [route.toId] : []), ...(route.belowInterceptor ? [route.belowInterceptor] : [])],
          at: atElement(ctx, el),
          message: clip(`${loadName(el)} (${greaseClassWords(need.cls)}) ${where}${how} without a grease interceptor; ${need.authority} sends it through one (${need.cite})`),
          fix: { tool: "bim_edit_load_point", hint: "pipe it to the grease interceptor's inlet, or name the interceptor as its source (served_by)" },
        });
        return;
      }
      if (el.kind !== "part" || attachedPartIds(els).has(el.id)) return;
      const need = requiredPartClass(els, el);
      if (!need) return;
      const route = partGreaseRouteOf(els, el);
      if (route.kind !== "bypasses") return;
      const where = route.belowInterceptor ? `joins below ${partName(els, route.belowInterceptor)}` : `drains to ${partName(els, route.toId)}`;
      ctx.emit({
        rule: "grease-fixture-bypasses-interceptor",
        severity: "error",
        elementIds: [el.id, ...(route.toId ? [route.toId] : []), ...(route.belowInterceptor ? [route.belowInterceptor] : [])],
        at: atElement(ctx, el),
        message: clip(`${partName(els, el.id)} (${greaseClassWords(need.cls)}) ${where} without a grease interceptor; ${need.authority} sends it through one (${need.cite})`),
        fix: { tool: "bim_route_run", hint: "pipe this fixture's drain to the grease interceptor's inlet" },
      });
    },
  },
  {
    id: "grease-fixture-not-routed",
    version: 1,
    pack: "systems",
    severity: "info",
    title: "A fixture the sewer authority sends to a grease interceptor, not routed to one yet",
    scope: "element",
    kinds: ["load_point", "part"],
    run: (ctx, el) => {
      const els = ctx.model.elements;
      if (el.kind === "load_point") {
        const need = requiredLoadClass(els, el);
        if (!need) return;
        if (greaseRouteOf(els, el).kind !== "not_routed") return;
        ctx.emit({
          rule: "grease-fixture-not-routed",
          severity: "info",
          elementIds: [el.id],
          at: atElement(ctx, el),
          message: clip(`${loadName(el)} (${greaseClassWords(need.cls)}) must drain through a grease interceptor under ${need.authority} (${need.cite}); none is piped or named yet`),
          fix: { tool: "bim_edit_load_point", hint: "name the grease interceptor as its source (served_by), or pipe it to the interceptor's inlet" },
        });
        return;
      }
      if (el.kind !== "part" || attachedPartIds(els).has(el.id)) return;
      const need = requiredPartClass(els, el);
      if (!need) return;
      if (partGreaseRouteOf(els, el).kind !== "not_routed") return;
      ctx.emit({
        rule: "grease-fixture-not-routed",
        severity: "info",
        elementIds: [el.id],
        at: atElement(ctx, el),
        message: clip(`${partName(els, el.id)} (${greaseClassWords(need.cls)}) must drain through a grease interceptor under ${need.authority} (${need.cite}); none is piped yet`),
        fix: { tool: "bim_route_run", hint: "pipe this fixture's drain to the grease interceptor's inlet" },
      });
    },
  },
  {
    id: "grease-authority-unknown",
    version: 1,
    pack: "systems",
    severity: "info",
    title: "A grease-laden fixture, and no sewer authority to say whether it goes through a grease interceptor",
    scope: "element",
    kinds: ["load_point", "part"],
    run: (ctx, el) => {
      const els = ctx.model.elements;
      const a = sewerAuthorityOf(els);
      if (a.kind === "known") return;
      let subjectName: string | null = null;
      if (el.kind === "load_point") {
        if (!isGreaseFixtureOnItsFace(els, el)) return;
        if (greaseRouteOf(els, el).kind === "through_interceptor") return;
        subjectName = loadName(el);
      } else if (el.kind === "part") {
        if (attachedPartIds(els).has(el.id)) return;
        if (!isPartGreaseOnItsFace(els, el)) return;
        if (partGreaseRouteOf(els, el).kind === "through_interceptor") return;
        subjectName = partName(els, el.id);
      } else {
        return;
      }
      const conn = a.connectionId ? partName(els, a.connectionId) : null;
      const why =
        a.kind === "no_rule"
          ? `no grease rule is on file for ${a.authority}; type which fixtures go to the interceptor on ${conn}`
          : a.reason === "no_connection"
            ? "sewer authority unknown: place the sewer connection and set its authority from the code study"
            : a.reason === "disagree"
              ? "the sewer connections name different sewer authorities; set one from the code study"
              : `sewer authority unknown: set it on ${conn} from the code study`;
      ctx.emit({
        rule: "grease-authority-unknown",
        severity: "info",
        elementIds: [el.id, ...(a.connectionId ? [a.connectionId] : [])],
        at: atElement(ctx, el),
        message: clip(`${subjectName} carries grease (IPC 1003.3.1); ${why}`),
        fix: { tool: "bim_set_parameters", hint: "set sewer_authority (as the code study names the sewer owner) on the sewer connection" },
      });
    },
  },
  {
    id: "stack-base-branch-too-close",
    version: 1,
    pack: "systems",
    severity: "warning",
    title: "A branch joins too close to a stack's base or offset bend (firm rule, off unless turned on)",
    scope: "element",
    kinds: ["run_fitting"],
    available: (ctx) => (stackBaseClearanceDiameters(ctx.model.elements) === null ? "Off by default (a firm rule, not code): turn it on in Plumbing › Stacks" : null),
    run: (ctx, el) => {
      if (el.kind !== "run_fitting" || !el.host) return;
      const els = ctx.model.elements;
      const n = stackBaseClearanceDiameters(els);
      if (n === null) return;
      const c = stackBendClearanceOf(els, el, n);
      if (!c) return;
      const stack = stackAt(els, c.stackKey);
      const name = stack?.number ? `stack ${stack.number}` : "the stack";
      const on = c.onStack ? `on ${name}` : `on the pipe leaving ${name}'s ${c.bend} bend`;
      const p = el.position;
      ctx.emit({
        rule: "stack-base-branch-too-close",
        severity: "warning",
        elementIds: [el.id, c.hostId, ...(c.bendId ? [c.bendId] : [])],
        at: { level: ctx.levelNameOf(el), x_ft: feet(p.x), y_ft: feet(p.y), z_ft: feet(p.z) },
        message: clip(`A branch joins ${on} ${feetInches(c.distanceMm)} from the ${c.bend} bend; keep it ${n} pipe diameters (${feetInches(c.requiredMm)}) away (firm rule)`),
        fix: { tool: "bim_slide_branch", hint: `slide the branch at least ${feetInches(c.requiredMm)} from the bend` },
      });
    },
  },
];

/** WS-2 plumbing code lint rules (rank 910, after batch-5c plumbing rules). */
export const plumbingCodeRules: readonly RuleDef[] = [
  {
    id: "clear-water-in-grease-waste",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Clear-water fixture, equipment or condensate drain piped into grease waste or upstream of a grease interceptor",
    scope: "element",
    kinds: ["part", "load_point", "run_segment"],
    reads: ["part", "run_segment", "load_point"],
    run: (ctx, el) => {
      const els = ctx.model.elements;
      if (el.kind === "load_point") {
        if (!isClearWaterLoad(els, el)) return;
        let hit: GreaseWasteHit | null = null;
        if (el.service === "grease_waste") {
          hit = { targetId: el.id, where: "grease_waste service" };
        } else {
          const anchor = loadAnchorOf(el);
          if (anchor.kind === "run_end") hit = greaseWasteHitAt(els, anchor.hostId);
          if (!hit) {
            const route = greaseRouteOf(els, el);
            if (route.kind === "through_interceptor") {
              hit = { targetId: route.interceptorId, where: `grease interceptor ${partName(els, route.interceptorId)}` };
            }
          }
        }
        if (!hit) return;
        const elementIds = hit.targetId === el.id ? [el.id] : [el.id, hit.targetId];
        ctx.emit({
          rule: "clear-water-in-grease-waste",
          severity: "error",
          elementIds,
          at: atElement(ctx, el),
          message: clip(`${loadName(el)} discharges clear water and must not drain into ${hit.where}; clear water dilutes and washes out grease interceptors (IPC 1003.3)`),
          fix: { tool: "bim_route_run", hint: "route clear-water / condensate waste to sanitary or indirect waste downstream of the grease interceptor" },
        });
        return;
      }

      if (el.kind === "part") {
        // Deduplicate if an attached clear-water load_point already checks this part.
        if (attachedPartIds(els).has(el.id)) {
          const hasAttachedClearLoad = elementsOfKind(els, "load_point").some((lp) => {
            const a = loadAnchorOf(lp);
            const pid = lp.attachedPartId ?? (a.kind === "part" ? a.partId : undefined);
            return pid === el.id && isClearWaterLoad(els, lp);
          });
          if (hasAttachedClearLoad) return;
        }
        const def = partDef(els, el);
        if (!def) return;
        const clearPart = isClearWaterPart(els, el);
        for (const c of resolveConnectors(def, el.values)) {
          if (c.domain !== "pipe") continue;
          const isCondensatePort = c.systemKind === "condensate";
          const isDrainPort = DRAIN_KINDS.has(c.systemKind);
          if (!isCondensatePort && !(clearPart && isDrainPort)) continue;
          const link = el.links?.[c.id];
          if (!link) continue;
          const hit = greaseWasteHitAt(els, link.elementId, link.port);
          if (!hit) continue;
          const what = isCondensatePort ? `${partName(els, el.id)}'s condensate drain` : `${partName(els, el.id)} (clear water)`;
          ctx.emit({
            rule: "clear-water-in-grease-waste",
            severity: "error",
            elementIds: [el.id, hit.targetId],
            at: atElement(ctx, el),
            message: clip(`${what} drains into ${hit.where}; keep clear water and condensate out of grease waste and interceptors (IPC 1003.3)`),
            fix: { tool: "bim_route_run", hint: "reconnect clear-water / condensate waste to sanitary or indirect waste downstream of the grease interceptor" },
          });
          return;
        }
        return;
      }

      if (el.kind === "run_segment") {
        const sys = els[el.systemId];
        if (sys?.kind !== "mep_system" || sys.systemKind !== "condensate") return;
        for (const end of ["start", "end"] as const) {
          const link = el.links[end];
          if (!link) continue;
          const hit = greaseWasteHitAt(els, link.elementId, link.port);
          if (!hit) continue;
          ctx.emit({
            rule: "clear-water-in-grease-waste",
            severity: "error",
            elementIds: [el.id, hit.targetId],
            at: atElement(ctx, el),
            message: clip(`Condensate pipe ${el.id} drains into ${hit.where}; keep clear-water condensate out of grease waste and interceptors (IPC 1003.3)`),
            fix: { tool: "bim_route_run", hint: "route condensate to an indirect waste receptor or sanitary line downstream of the grease interceptor" },
          });
          return;
        }
      }
    },
  },
  {
    id: "vtr-air-intake-clearance",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Vent roof termination (VTR) within 10 ft horizontally and less than 3 ft above an outdoor air intake, RTU or operable opening (IPC 903.5 / 903.2)",
    scope: "element",
    kinds: ["part"],
    reads: ["part", "opening"],
    run: (ctx, el) => {
      if (el.kind !== "part") return;
      const els = ctx.model.elements;
      if (!isVtrPart(els, el)) return;
      const def = partDef(els, el);
      const body = ctx.body(el.id);
      const elev = levelElevOf(els, el.levelId);
      const vx = body ? (body.box.min.x + body.box.max.x) / 2 : el.position.x;
      const vy = body ? (body.box.min.y + body.box.max.y) / 2 : el.position.y;
      const vtrTopZ = body ? body.box.max.z : elev + el.offsetMm + (def ? (readNumberParam(def, el, "height") ?? 304.8) : 304.8);

      for (const target of intakeTargetsInModel(ctx, el.id)) {
        const horizMm = Math.hypot(vx - target.x, vy - target.y);
        const aboveMm = vtrTopZ - target.topZ;
        if (horizMm >= TEN_FT_MM - 1e-3 || aboveMm >= THREE_FT_MM - 1e-3) continue;
        const vertDesc = aboveMm >= 0 ? `only ${feetInches(aboveMm)} above it` : `${feetInches(-aboveMm)} below it`;
        ctx.emit({
          rule: "vtr-air-intake-clearance",
          severity: "error",
          elementIds: target.linked ? [el.id] : [el.id, target.id],
          ...(target.linked ? { linked: [target.linked] } : {}),
          at: atElement(ctx, el),
          message: clip(`${partName(els, el.id)} is ${feetInches(horizMm)} horizontally from ${target.label} and ${vertDesc}; keep VTR >= 10 ft away or >= 3 ft above (IPC 903.5 / 903.2)`),
          fix: { tool: "bim_move_part", hint: "relocate the VTR at least 10 ft horizontally from the intake/opening, or extend it at least 3 ft above" },
        });
      }
    },
  },
  {
    id: "water-heater-condensate-neutralizer",
    version: 1,
    pack: "systems",
    severity: "warning",
    title: "Condensing gas water heater lacks a condensate neutralizer or acid-neutralizing specification (IPC 803.2 / IFGC 307.2)",
    scope: "element",
    kinds: ["part"],
    reads: ["part", "run_segment"],
    run: (ctx, el) => {
      if (el.kind !== "part") return;
      const els = ctx.model.elements;
      const def = partDef(els, el);
      if (!def || !isCondensingGasWaterHeater(els, el, def)) return;
      if (hasCondensateNeutralizer(els, el, def)) return;
      ctx.emit({
        rule: "water-heater-condensate-neutralizer",
        severity: "warning",
        elementIds: [el.id],
        at: atElement(ctx, el),
        message: clip(`${partName(els, el.id)} is a condensing gas water heater with no condensate neutralizer connected or specified (IPC 803.2 / IFGC 307.2)`),
        fix: { tool: "bim_place_part", hint: "pipe the condensate drain through a limestone/calcite condensate neutralizer or specify condensate_neutralizer on the heater" },
      });
    },
  },
  {
    id: "closed-water-expansion-tank",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Closed domestic water system (backflow preventer, PRV or check valve + water heater) has no thermal expansion tank connected (IPC 607.3)",
    scope: "system",
    run: (ctx, el) => {
      if (el.kind !== "mep_system" || el.systemKind !== "domestic_cold_water") return;
      const els = ctx.model.elements;
      const inv = collectWaterSystemInventory(els, el.id);
      if (inv.segments.length === 0) return;

      const closingIds: ElementId[] = [];
      const closingNames: string[] = [];
      for (const p of inv.parts) {
        if (isClosingDevicePart(els, p)) {
          closingIds.push(p.id);
          closingNames.push(partName(els, p.id));
        }
      }
      for (const f of inv.fittings) {
        if (isCheckOrClosingFitting(els, f)) {
          closingIds.push(f.id);
          closingNames.push(f.family ?? f.fittingType);
        }
      }
      if (closingIds.length === 0) return;

      const heaters = inv.parts.filter((p) => {
        const def = partDef(els, p);
        if (!def || !isWaterHeaterPart(els, p, def)) return false;
        if (readParam(def, p, "expansion_tank") === true || readParam(def, p, "integral_expansion_tank") === true) return false;
        return true;
      });
      if (heaters.length === 0) return;

      const hasTank = inv.parts.some((p) => isExpansionTankPart(els, p));
      if (hasTank) return;

      const firstHeater = heaters[0] as PartInstance;
      const firstClosing = closingIds[0] as ElementId;
      ctx.emit({
        rule: "closed-water-expansion-tank",
        severity: "error",
        elementIds: [el.id, firstHeater.id, firstClosing],
        at: atElement(ctx, firstHeater),
        message: clip(`${el.name} is a closed system (${closingNames[0]}) feeding ${partName(els, firstHeater.id)} with no thermal expansion tank connected (IPC 607.3)`),
        fix: { tool: "bim_place_part", hint: "place and connect a potable thermal expansion tank on the cold water supply near the water heater" },
      });
    },
  },
  {
    id: "gas-appliance-venting-check",
    version: 1,
    pack: "systems",
    severity: "warning",
    title: "Gas-fired water heater, furnace or boiler has an unconnected flue/combustion-air connector or missing venting specification (IFGC 501.2 / 304)",
    scope: "element",
    kinds: ["part"],
    run: (ctx, el) => {
      if (el.kind !== "part") return;
      const els = ctx.model.elements;
      const def = partDef(els, el);
      if (!def || !isGasVentingAppliance(els, el, def)) return;

      const connectors = resolveConnectors(def, el.values);
      const flueConnectors = connectors.filter(
        (c) =>
          (c.domain === "pipe" || c.domain === "duct") &&
          (c.systemKind === "flue" || c.systemKind === "combustion_exhaust" || (c.systemKind === "exhaust_air" && /\b(flue|exhaust|vent|combust\w*)\b/i.test(`${c.id} ${c.label}`))),
      );
      const combustionAirConnectors = connectors.filter(
        (c) =>
          (c.domain === "pipe" || c.domain === "duct") &&
          c.intake === undefined &&
          (c.systemKind === "combustion_air" || (c.systemKind === "outside_air" && /\b(combust\w*|intake|burner[- ]?air)\b/i.test(`${c.id} ${c.label}`))),
      );

      const openFlue = flueConnectors.filter((c) => !el.links?.[c.id]);
      const openAir = combustionAirConnectors.filter((c) => !el.links?.[c.id]);

      if (openFlue.length > 0 || openAir.length > 0) {
        const missing: string[] = [];
        if (openFlue.length > 0) missing.push(`flue (${openFlue.map((c) => c.id).join(", ")})`);
        if (openAir.length > 0) missing.push(`combustion-air (${openAir.map((c) => c.id).join(", ")})`);
        ctx.emit({
          rule: "gas-appliance-venting-check",
          severity: "warning",
          elementIds: [el.id],
          at: atElement(ctx, el),
          message: clip(`${partName(els, el.id)} has unconnected ${missing.join(" and ")} connector${openFlue.length + openAir.length === 1 ? "" : "s"} (IFGC 501.2 / 304)`),
          fix: { tool: "bim_route_run", hint: "connect the flue and combustion-air ports to vent/intake runs or terminate outdoors" },
        });
        return;
      }

      if (flueConnectors.length === 0 && combustionAirConnectors.length === 0 && !hasVentingSpecification(def, el)) {
        ctx.emit({
          rule: "gas-appliance-venting-check",
          severity: "warning",
          elementIds: [el.id],
          at: atElement(ctx, el),
          message: clip(`${partName(els, el.id)} is gas-fired with no flue connector or venting specification (vent_type / flue_size) defined (IFGC 501.2)`),
          fix: { tool: "bim_set_parameters", hint: "specify vent_type / vent_category / flue_size or use a part type with flue and combustion-air connectors" },
        });
      }
    },
  },
  {
    id: "water-pressure-prv-required",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Domestic cold water static supply pressure exceeds 80 psi with no PRV in the path (IPC 604.8)",
    scope: "system",
    run: (ctx, el) => {
      if (el.kind !== "mep_system" || el.systemKind !== "domestic_cold_water") return;
      const els = ctx.model.elements;
      const inv = collectWaterSystemInventory(els, el.id);
      const staticPsi = waterStaticPressurePsi(els, el, inv.parts);
      if (staticPsi === null || staticPsi <= MAX_STATIC_WATER_PSI + 1e-9) return;
      const hasPrv = inv.parts.some((p) => isPrvPart(els, p)) || inv.fittings.some((f) => isPrvFitting(els, f));
      if (hasPrv) return;
      const anchor = inv.segments[0] ?? inv.parts[0] ?? el;
      ctx.emit({
        rule: "water-pressure-prv-required",
        severity: "error",
        elementIds: [el.id],
        at: atElement(ctx, anchor),
        message: clip(`${el.name} static supply pressure is ${Math.round(staticPsi * 10) / 10} psi (> 80 psi limit) with no PRV in the path (IPC 604.8)`),
        fix: { tool: "bim_place_part", hint: "install a pressure reducing valve (PRV) on the domestic cold water main to reduce static pressure to <= 80 psi" },
      });
    },
  },
  {
    id: "gas-system-sizing-lint",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Fuel gas system has IFGC sizing, pressure-zone regulator, minimum inlet pressure or sediment-trap issues (IFGC 402.4 / 408.4 / 410)",
    scope: "system",
    run: (ctx, el) => {
      if (el.kind !== "mep_system" || el.systemKind !== "natural_gas") return;
      const els = ctx.model.elements;
      const ifgc = ifgcEdition("2021");
      const sized = sizeGasSystem(ctx.model, el.id, ifgc);
      const net = gasNetwork(ctx.model, el.id);

      const findings = sized.ok ? sized.sizing.findings : (net?.issues ?? []);
      const firstSeg = elementsOfKind(els, "run_segment").find((s) => s.systemId === el.id);
      const fallbackEl = firstSeg ?? el;

      for (const f of findings) {
        const elementIds = f.elementId ? (f.code === "undersized_gas_pipe" || f.code === "no_size_fits" ? [f.elementId] : [f.elementId, el.id]) : [el.id];
        ctx.emit({
          rule: "gas-system-sizing-lint",
          severity: f.severity,
          elementIds,
          at: atId(ctx, els, f.elementId, fallbackEl),
          message: clip(f.message),
          fix: gasFindingFix(f.code),
        });
      }

      if (!net) return;
      for (const app of net.appliances) {
        if (!requiresSedimentTrap(els, app)) continue;
        if (hasSedimentTrapOnBranch(els, app)) continue;
        const elementIds = app.feedElementId ? [app.elementId, app.feedElementId] : [app.elementId];
        ctx.emit({
          rule: "gas-system-sizing-lint",
          severity: "warning",
          elementIds,
          at: atId(ctx, els, app.elementId, fallbackEl),
          message: clip(`${app.label} has no sediment trap (drip leg) on its gas branch; provide one downstream of the shutoff valve (IFGC 408.4)`),
          fix: { tool: "bim_place_part", hint: "add a sediment trap (ST) or drip leg fitting (pipe.gas.drip_leg) ahead of the appliance gas inlet" },
        });
      }
    },
  },
];

export const plumbingRules: readonly RuleDef[] = [...batch5cPlumbingRules, ...plumbingCodeRules];
