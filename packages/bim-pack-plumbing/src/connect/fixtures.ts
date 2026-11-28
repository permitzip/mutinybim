import { isConnectIntoRefusal, paramValue, physicalConnect, physicalSourcesFor, planConnectInto, type BimElement, type ConnectFace, type ConnectInto, type ConnectIntoPlan, type ConnectIntoSource, type ModelState, type PartConnector, type PartInstance, type PartTypeDefinition, type SourceEndRef, type SourcesForFace, type SystemKind } from "@permitzip/bim-kernel";
import { FIXTURE_CONNECT_WORDS as W } from "../ui";

/**
 * Plumbing › Connect: join the selected fixtures and equipment to the
 * nearest drain, vent, cold/hot water, DHWR, fuel gas, flue or combustion-air
 * run in one action, through the kernel's `connect_into` (round 15+). The
 * kernel picks each run, the takeoff fitting (the system's own fitting
 * preferences: combination wye and 1/8 bend into a level drain, sanitary tee
 * into a stack), the slope and any drop; this file only says which of a
 * fixture's connectors each target means. A selection of fixtures never reads
 * the rest of the model.
 *
 * The "+" grip on a fixture uses the same kernel faces, answered here only
 * for this add-on's own pipe and combustion ends (an HVAC duct neck or a power
 * connection is another add-on's to answer).
 */

type Elements = Readonly<Record<string, BimElement>>;

export const FIXTURE_CONNECT_TARGETS = ["drain", "vent", "cold_water", "hot_water", "dhwr", "gas", "flue", "combustion_air"] as const;
export type FixtureConnectTarget = (typeof FIXTURE_CONNECT_TARGETS)[number];

/** Which connectors each target joins, by the system kind they carry. */
export const TARGET_SYSTEM_KINDS: Readonly<Record<FixtureConnectTarget, ReadonlySet<SystemKind>>> = {
  drain: new Set<SystemKind>(["sanitary", "grease_waste", "indirect_waste"]),
  vent: new Set<SystemKind>(["vent"]),
  cold_water: new Set<SystemKind>(["domestic_cold_water"]),
  hot_water: new Set<SystemKind>(["domestic_hot_water"]),
  dhwr: new Set<SystemKind>(["domestic_hot_water_return"]),
  gas: new Set<SystemKind>(["natural_gas"]),
  flue: new Set<SystemKind>(["flue", "combustion_exhaust", "exhaust_air"]),
  combustion_air: new Set<SystemKind>(["combustion_air", "outside_air"]),
};

const PIPE = "pipe";
const DUCT = "duct";
const COMBUSTION_FLUE_KINDS = new Set<string>(["flue", "combustion_exhaust"]);
const COMBUSTION_AIR_KINDS = new Set<string>(["combustion_air"]);

function partTypeOf(elements: Elements, el: BimElement): PartTypeDefinition | null {
  if (el.kind !== "part") return null;
  const type = elements[el.typeId];
  return type?.kind === "part_type" ? type.definition : null;
}

function connectorsOf(elements: Elements, el: BimElement): readonly PartConnector[] {
  return partTypeOf(elements, el)?.connectors ?? [];
}

/**
 * Inline pass-through pipe accessories (PRV, RPZ, meter, inline regulator,
 * inline cleanout) pair an `in` and `out` connector on the same domain and
 * system kind — those are inserted onto a pipe rather than branched as
 * end-of-line fixture connections. Engineered cut-sheet fixtures and equipment
 * (water heaters, boilers, sinks, appliances) specify `flowDirection: "in" | "out"`
 * on distinct connections and remain connectable.
 */
function isInlinePassThrough(def: PartTypeDefinition, connectors: readonly PartConnector[], c: PartConnector): boolean {
  if (def.category !== "pipe_accessory") return false;
  if (c.flowDirection !== "in" && c.flowDirection !== "out") return false;
  const opposite = c.flowDirection === "in" ? "out" : "in";
  return connectors.some((other) => other.id !== c.id && other.domain === c.domain && other.systemKind === c.systemKind && other.flowDirection === opposite);
}

/** Whether a part is a fuel-burning or plumbing appliance (so `exhaust_air` / `outside_air` connectors on it are flue / combustion-air rather than HVAC air terminals). */
function isCombustionOrPlumbingAppliance(def: PartTypeDefinition, part: PartInstance, connectors: readonly PartConnector[]): boolean {
  if (def.category === "plumbing_fixture") return true;
  const heater = paramValue(def, part.values, "heater_kind");
  if (typeof heater === "string" && heater.trim() !== "") return true;
  if (connectors.some((c) => c.domain === PIPE && (c.systemKind === "natural_gas" || c.systemKind === "domestic_hot_water" || c.systemKind === "domestic_cold_water"))) return true;
  return /\b(water[- ]?heater|boiler|furnace|unit[- ]?heater|burner|kiln)\b/i.test(`${def.familyName} ${def.typeName} ${part.mark}`);
}

/** Whether a connector belongs to `target` and is eligible for Plumbing › Connect. */
function connectorMatchesTarget(def: PartTypeDefinition, part: PartInstance, connectors: readonly PartConnector[], c: PartConnector, target: FixtureConnectTarget): boolean {
  if (isInlinePassThrough(def, connectors, c)) return false;
  if (!TARGET_SYSTEM_KINDS[target].has(c.systemKind)) return false;
  if (target === "flue") {
    if (c.domain !== PIPE && c.domain !== DUCT) return false;
    if (COMBUSTION_FLUE_KINDS.has(c.systemKind)) return true;
    // `exhaust_air`: match when pipe-domain, named flue/combustion, or on a gas/plumbing appliance.
    if (c.domain === PIPE) return true;
    if (/\b(flue|combust\w*|chimney|b-?vent)\b/i.test(`${c.id} ${c.label}`)) return true;
    return isCombustionOrPlumbingAppliance(def, part, connectors);
  }
  if (target === "combustion_air") {
    if (c.domain !== PIPE && c.domain !== DUCT) return false;
    if (COMBUSTION_AIR_KINDS.has(c.systemKind)) return true;
    // `outside_air`: never hijack a weather hood louver; match when pipe-domain or combustion-air named on an appliance.
    if (c.intake !== undefined) return false;
    if (c.domain === PIPE) return true;
    return /\b(combust\w*|burner[- ]?air|make[- ]?up[- ]?air|air[- ]?intake)\b/i.test(`${c.id} ${c.label}`) && isCombustionOrPlumbingAppliance(def, part, connectors);
  }
  return c.domain === PIPE;
}

/** Whether a connector is a plumbing or combustion end this add-on serves on the "+" grip. */
function isConnectablePlumbingConnector(def: PartTypeDefinition, part: PartInstance, connectors: readonly PartConnector[], c: PartConnector): boolean {
  if (isInlinePassThrough(def, connectors, c)) return false;
  if (c.domain === PIPE) return true;
  return connectorMatchesTarget(def, part, connectors, c, "flue") || connectorMatchesTarget(def, part, connectors, c, "combustion_air");
}

/** A fixture's open, connectable connectors for a target. */
function openPorts(elements: Elements, el: BimElement, target: FixtureConnectTarget): string[] {
  if (el.kind !== "part") return [];
  const def = partTypeOf(elements, el);
  if (!def) return [];
  return def.connectors
    .filter((c) => connectorMatchesTarget(def, el, def.connectors, c, target) && !el.links?.[c.id])
    .map((c) => c.id);
}

/** Every selected fixture's open connectors for the target, in selection order, each fixture once. */
export function fixtureConnectSources(elements: Elements, selectedIds: readonly string[], target: FixtureConnectTarget): ConnectIntoSource[] {
  const seen = new Set<string>();
  const out: ConnectIntoSource[] = [];
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const el = elements[id];
    if (!el) continue;
    for (const port of openPorts(elements, el, target)) out.push({ elementId: id, port });
  }
  return out;
}

/** Why Connect › <target> is off for this selection, in words; null when it can run. */
export function fixtureConnectBlocked(elements: Elements, selectedIds: readonly string[], target: FixtureConnectTarget): string | null {
  const parts = selectedIds.filter((id) => elements[id]?.kind === "part");
  if (parts.length === 0) return W.selectFirst;
  if (fixtureConnectSources(elements, parts, target).length > 0) return null;
  const any = parts.some((id) => {
    const el = elements[id];
    if (el?.kind !== "part") return false;
    const def = partTypeOf(elements, el);
    return def ? def.connectors.some((c) => connectorMatchesTarget(def, el, def.connectors, c, target)) : false;
  });
  return any ? W.target[target].allConnected : W.target[target].noneHave;
}

/** The request for the selection: into the nearest run each source's system takes. Null when nothing selected has an open connector for it. */
export function fixtureConnectRequest(elements: Elements, selectedIds: readonly string[], target: FixtureConnectTarget, idPrefix: string): ConnectInto | null {
  const from = fixtureConnectSources(elements, selectedIds, target);
  return from.length > 0 ? { from, into: "nearest", idPrefix } : null;
}

/** One line per source for the preview: what joins where, or why not. */
export interface FixtureConnectLine {
  readonly key: string;
  readonly elementId: string;
  readonly ok: boolean;
  readonly text: string;
}

const markOf = (elements: Elements, id: string): string => {
  const el = elements[id];
  return el?.kind === "part" && el.mark ? el.mark : id;
};

function portLabel(elements: Elements, source: ConnectIntoSource): string {
  const el = elements[source.elementId];
  const c = el ? connectorsOf(elements, el).find((x) => x.id === source.port) : undefined;
  return `${markOf(elements, source.elementId)} ${(c?.label ?? source.port).toLowerCase()}`;
}

function runText(elements: Elements, runId: string): string {
  const seg = elements[runId];
  if (seg?.kind !== "run_segment") return runId;
  const system = elements[seg.systemId];
  return system?.kind === "mep_system" ? system.name : runId;
}

/** Per-ft slope as a fraction of an inch ("1/4\" per ft"). */
function slopeText(ratio: number): string {
  const inPerFt = ratio * 12;
  const eighths = Math.round(inPerFt * 8);
  if (eighths <= 0) return "";
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  const g = rest === 0 ? 1 : rest % 4 === 0 ? 4 : rest % 2 === 0 ? 2 : 1;
  const frac = rest === 0 ? "" : `${rest / g}/${8 / g}`;
  return `${whole > 0 ? `${whole}${frac ? `-${frac}` : ""}` : frac}" per ft`;
}

/** The preview of a plan, one line per source, in request order. */
export function fixtureConnectLines(elements: Elements, plan: ConnectIntoPlan): FixtureConnectLine[] {
  return plan.sources.map((answer, i) => {
    const key = `${answer.source.elementId}:${answer.source.port}:${i}`;
    if (isConnectIntoRefusal(answer)) return { key, elementId: answer.source.elementId, ok: false, text: answer.refused };
    const bits = [answer.fittings.map((f) => f.label).join(", "), answer.slope ? slopeText(answer.slope.ratio) : "", answer.flex ? W.flex : ""].filter((b) => b.length > 0);
    return { key, elementId: answer.source.elementId, ok: true, text: `${portLabel(elements, answer.source)} → ${runText(elements, answer.intoRunId)}${bits.length > 0 ? `: ${bits.join("; ")}` : ""}` };
  });
}

/** The preview for the selection, or why there is none. Nothing changes. */
export function previewFixtureConnect(model: ModelState, selectedIds: readonly string[], target: FixtureConnectTarget, idPrefix: string): { readonly plan: ConnectIntoPlan; readonly lines: readonly FixtureConnectLine[]; readonly joinable: number } | { readonly refused: string } {
  const blocked = fixtureConnectBlocked(model.elements, selectedIds, target);
  const request = blocked ? null : fixtureConnectRequest(model.elements, selectedIds, target, idPrefix);
  if (!request) return { refused: blocked ?? W.target[target].noneHave };
  const plan = planConnectInto(model, request);
  const lines = fixtureConnectLines(model.elements, plan);
  return { plan, lines, joinable: lines.filter((l) => l.ok).length };
}

// ------------------------------------------------------------------ the "+" grip

/** Whether the grip's end is one of this add-on's pipe or combustion ends (a fixture's pipe/flue/combustion-air connector, or an open pipe end). */
function isPlumbingEnd(elements: Elements, ref: SourceEndRef): boolean {
  const el = elements[ref.elementId];
  if (!el) return false;
  if (el.kind === "run_segment") return el.domain === PIPE;
  if (el.kind !== "part") return false;
  const def = partTypeOf(elements, el);
  if (!def) return false;
  const connectors = def.connectors;
  if (ref.end !== undefined) {
    const c = connectors.find((x) => x.id === ref.end);
    return c !== undefined && (c.domain === PIPE || connectorMatchesTarget(def, el, connectors, c, "flue") || connectorMatchesTarget(def, el, connectors, c, "combustion_air"));
  }
  // Answer when this part has an open pipe/combustion connector, unless its first open routed connector is an HVAC-only duct.
  const first = connectors.find((c) => (c.domain === PIPE || c.domain === DUCT) && !el.links?.[c.id]);
  if (!first) return false;
  return isConnectablePlumbingConnector(def, el, connectors, first);
}

/** The order a fixture's open ends are offered when the grip names none: drain first, then vent, water, DHWR, gas, combustion, then the rest. */
const GRIP_ORDER: readonly FixtureConnectTarget[] = ["drain", "vent", "cold_water", "hot_water", "dhwr", "gas", "flue", "combustion_air"];
const gripRank = (kind: SystemKind): number => {
  const i = GRIP_ORDER.findIndex((t) => TARGET_SYSTEM_KINDS[t].has(kind));
  return i < 0 ? GRIP_ORDER.length : i;
};

/** A fixture's open plumbing and combustion ends, drain first: the ends the grip can serve when the hover names none. */
function gripEnds(elements: Elements, ref: SourceEndRef): SourceEndRef[] {
  const el = elements[ref.elementId];
  if (ref.end !== undefined || el?.kind !== "part") return [ref];
  const def = partTypeOf(elements, el);
  if (!def) return [];
  return def.connectors
    .filter((c) => isConnectablePlumbingConnector(def, el, def.connectors, c) && !el.links?.[c.id])
    .sort((a, b) => gripRank(a.systemKind) - gripRank(b.systemKind))
    .map((c) => ({ elementId: ref.elementId, end: c.id }));
}

/**
 * The "+" grip on a fixture or an open pipe end: the nearest runs of its
 * system (kernel faces), for plumbing ends only. Hovering a fixture names no
 * end, so the first of its open ends (drain first) with a run in reach is
 * offered: a closet with a drain 3 ft away and no cold water main yet offers
 * the drain, not an empty cold water list.
 */
export const plumbingSourcesFor: SourcesForFace = (model, ref) => {
  if (!isPlumbingEnd(model.elements, ref)) return null;
  let empty: ReturnType<SourcesForFace> = null;
  for (const end of gripEnds(model.elements, ref)) {
    const answer = physicalSourcesFor(model, end);
    if (answer && answer.candidates.length > 0) return answer;
    empty ??= answer;
  }
  return empty;
};

/** The grip's drop on a plumbing end: one `connect_into` from the end whose system the dropped-on run carries. */
export const plumbingConnect: ConnectFace = (model, ref, source, newId) => {
  if (!isPlumbingEnd(model.elements, ref)) return null;
  const ends = gripEnds(model.elements, ref);
  const end = ends.find((e) => physicalSourcesFor(model, e)?.candidates.some((c) => c.sourceId === source.sourceId)) ?? ends[0] ?? ref;
  return physicalConnect(model, end, source, newId);
};
