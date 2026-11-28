import {
  paramValue,
  resolveConnectors,
  runNeighbours,
  type BimElement,
  type ElementId,
  type PartInstance,
  type PartTypeDefinition,
  type RunSegment,
} from "@permitzip/bim-kernel";
import { clip, feet, type RuleContext, type RuleDef } from "@permitzip/bim-lint";
import { plumbingSourceRole } from "../connections/plumbing/adapter";

/**
 * Cross-connection control and backflow protection taxonomy (IPC Section 608 / ASPE).
 *
 * Levels ordered from lowest to highest protection tier:
 *   `air_gap` < `avb` < `pvb` < `dcva` < `rpz`
 *
 * Rules:
 *   backflow-protection-missing       potable water connected to non-potable/hydronic or hazard-bearing equipment with no upstream backflow preventer
 *   backflow-protection-insufficient  upstream backflow preventer does not meet the required IPC/ASPE protection level
 */

type Elements = Readonly<Record<string, BimElement>>;

export const BACKFLOW_LEVELS = ["air_gap", "avb", "pvb", "dcva", "rpz"] as const;
export type BackflowKind = (typeof BACKFLOW_LEVELS)[number];

export const BACKFLOW_RANK: Readonly<Record<BackflowKind, number>> = {
  air_gap: 1,
  avb: 2,
  pvb: 3,
  dcva: 4,
  rpz: 5,
};

export const BACKFLOW_LABELS: Readonly<Record<BackflowKind, string>> = {
  air_gap: "air gap",
  avb: "AVB",
  pvb: "PVB",
  dcva: "DCVA",
  rpz: "RPZ",
};

export function backflowSatisfies(provided: BackflowKind, required: BackflowKind): boolean {
  return BACKFLOW_RANK[provided] >= BACKFLOW_RANK[required];
}

const BACKFLOW_ALIASES: Readonly<Record<string, BackflowKind>> = {
  air_gap: "air_gap",
  airgap: "air_gap",
  ag: "air_gap",
  avb: "avb",
  atmospheric_vacuum_breaker: "avb",
  hvb: "avb",
  hbvb: "avb",
  hose_bibb_vacuum_breaker: "avb",
  hose_connection_vacuum_breaker: "avb",
  vacuum_breaker: "avb",
  pvb: "pvb",
  pressure_vacuum_breaker: "pvb",
  svb: "pvb",
  spill_resistant_vacuum_breaker: "pvb",
  dcva: "dcva",
  dc: "dcva",
  dcda: "dcva",
  double_check: "dcva",
  double_check_valve: "dcva",
  double_check_valve_assembly: "dcva",
  dual_check: "dcva",
  rpz: "rpz",
  rp: "rpz",
  rpba: "rpz",
  rpda: "rpz",
  reduced_pressure: "rpz",
  reduced_pressure_zone: "rpz",
  reduced_pressure_zone_assembly: "rpz",
  reduced_pressure_principle: "rpz",
};

const normKey = (s: string): string => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

export function parseBackflowKind(raw: unknown): BackflowKind | null {
  if (typeof raw !== "string") return null;
  const key = normKey(raw);
  if (!key) return null;
  return BACKFLOW_ALIASES[key] ?? null;
}

function isBackflowExempt(raw: unknown): boolean {
  if (raw === false) return true;
  if (typeof raw !== "string") return false;
  const k = normKey(raw);
  return k === "none" || k === "exempt" || k === "false" || k === "no" || k === "not_required";
}

const POTABLE_KINDS: ReadonlySet<string> = new Set([
  "domestic_cold_water",
  "domestic_hot_water",
  "domestic_hot_water_return",
]);

const HYDRONIC_NON_POTABLE_KINDS: ReadonlySet<string> = new Set([
  "hydronic_supply",
  "hydronic_return",
  "heating_water_supply",
  "heating_water_return",
  "chilled_water_supply",
  "chilled_water_return",
  "non_potable_water",
  "reclaimed_water",
  "process_water",
  "glycol_supply",
  "glycol_return",
]);

const FIRE_PROTECTION_KINDS: ReadonlySet<string> = new Set([
  "fire_protection_wet",
  "fire_protection_dry",
]);

const DIRECT_CROSS_KINDS: ReadonlySet<string> = new Set([
  ...HYDRONIC_NON_POTABLE_KINDS,
  ...FIRE_PROTECTION_KINDS,
  "sanitary",
  "grease_waste",
  "indirect_waste",
  "storm",
  "condensate",
]);

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

function readConnectorMeta(c: { readonly values?: Readonly<Record<string, unknown>> }, key: string): unknown {
  if (!c.values) return undefined;
  if (key in c.values) return c.values[key];
  const suffixed = Object.entries(c.values).find(([k]) => k.endsWith(`.${key}`) || k.endsWith(`:${key}`));
  return suffixed?.[1];
}

function partText(def: PartTypeDefinition, part: PartInstance): string {
  const desc = readParam(def, part, "description");
  const note = readParam(def, part, "note");
  return [def.familyName, def.typeName, typeof desc === "string" ? desc : "", part.mark, typeof note === "string" ? note : "", part.planned?.note ?? ""].join(" ");
}

function partName(part: PartInstance): string {
  return part.mark.trim() || part.id;
}

function atEl(ctx: RuleContext, el: BimElement) {
  const body = ctx.body(el.id);
  const c = body ? { x: (body.box.min.x + body.box.max.x) / 2, y: (body.box.min.y + body.box.max.y) / 2, z: body.box.min.z } : { x: 0, y: 0, z: 0 };
  return { level: ctx.levelNameOf(el), x_ft: feet(c.x), y_ft: feet(c.y), z_ft: feet(c.z) };
}

/** Identify a dedicated backflow prevention device part and its protection tier. */
export function backflowDeviceKindOf(els: Elements, part: PartInstance): BackflowKind | null {
  const def = partDef(els, part);
  if (!def) return null;
  const isAccessory = def.category === "pipe_accessory";
  const starter = String(readParam(def, part, "default_connection_type") ?? "").trim().toUpperCase();
  if (starter === "RPZ" || starter === "RPBA") return "rpz";
  if (starter === "DCVA" || starter === "DC" || starter === "DCDA") return "dcva";
  if (starter === "PVB" || starter === "SVB") return "pvb";
  if (starter === "AVB" || starter === "HVB" || starter === "HBVB") return "avb";
  if (starter === "AG" && isAccessory) return "air_gap";

  // Dedicated backflow device via explicit `backflow_kind` on an accessory (not hazard equipment carrying integral protection).
  if (isAccessory) {
    for (const key of ["backflow_kind", "backflow_type", "backflow_device"]) {
      const parsed = parseBackflowKind(readParam(def, part, key));
      if (parsed) return parsed;
    }
    const text = `${def.familyName} ${def.typeName} ${part.mark}`;
    if (/\b(rpz|rpba|reduced[- ]?pressure)\b/i.test(text)) return "rpz";
    if (/\b(dcva|dcda|double[- ]?check)\b/i.test(text)) return "dcva";
    if (/\b(pvb|svb|pressure[- ]?vacuum[- ]?breaker|spill[- ]?resistant[- ]?vacuum)\b/i.test(text)) return "pvb";
    if (/\b(avb|hbvb|atmospheric[- ]?vacuum[- ]?breaker|hose[- ]?(bibb|connection)[- ]?vacuum[- ]?breaker)\b/i.test(text)) return "avb";
    if (/\bair[- ]?gap\b/i.test(text)) return "air_gap";
  }
  return null;
}

/** Integral backflow protection provided on a hazard-bearing fixture/equipment itself. */
function integralBackflowOf(def: PartTypeDefinition, part: PartInstance, potableConn: { readonly values?: Readonly<Record<string, unknown>> }): BackflowKind | null {
  for (const key of ["backflow_kind", "backflow_type", "backflow_device", "integral_backflow"]) {
    const onConn = parseBackflowKind(readConnectorMeta(potableConn, key));
    if (onConn) return onConn;
    const onPart = parseBackflowKind(readParam(def, part, key));
    if (onPart) return onPart;
  }
  if (readParam(def, part, "vacuum_breaker") === true || readParam(def, part, "integral_avb") === true) return "avb";
  if (readConnectorMeta(potableConn, "vacuum_breaker") === true) return "avb";
  return null;
}

export interface BackflowRequirement {
  readonly required: BackflowKind;
  readonly reason: string;
  readonly cite: string;
}

/**
 * Determine whether a part connected to potable water requires backflow protection
 * and at which IPC/ASPE taxonomy level.
 */
export function requiredBackflowOf(els: Elements, part: PartInstance, potableConn?: { readonly values?: Readonly<Record<string, unknown>> }): BackflowRequirement | null {
  const def = partDef(els, part);
  if (!def) return null;
  // A dedicated backflow preventer, meter, PRV, expansion tank or recirc pump is distribution hardware, not a hazard end-point.
  if (backflowDeviceKindOf(els, part) !== null) return null;
  const starter = String(readParam(def, part, "default_connection_type") ?? "").trim().toUpperCase();
  if (starter === "MTR" || starter === "PRV" || starter === "ET" || starter === "RP") return null;

  const connectors = resolveConnectors(def, part.values);
  const potableConnectors = connectors.filter((c) => c.domain === "pipe" && POTABLE_KINDS.has(c.systemKind));
  if (potableConnectors.length === 0) return null;

  // 1. Explicit `backflow_required` on connector metadata or part parameters.
  const connExplicit = potableConn ? readConnectorMeta(potableConn, "backflow_required") : undefined;
  const partExplicit = readParam(def, part, "backflow_required");
  const explicit = connExplicit !== undefined ? connExplicit : partExplicit;
  if (isBackflowExempt(explicit)) return null;
  const parsedExplicit = parseBackflowKind(explicit);
  if (parsedExplicit) {
    return { required: parsedExplicit, reason: `${partName(part)} requires ${BACKFLOW_LABELS[parsedExplicit]}`, cite: "IPC 608.1" };
  }

  // 2. Non-potable / hydronic cross-connection interfaces on the same equipment.
  if (connectors.some((c) => HYDRONIC_NON_POTABLE_KINDS.has(c.systemKind))) {
    return { required: "rpz", reason: "hydronic / non-potable make-up connection", cite: "IPC 608.17.2" };
  }
  if (connectors.some((c) => FIRE_PROTECTION_KINDS.has(c.systemKind))) {
    return { required: "dcva", reason: "fire protection make-up connection", cite: "IPC 608.17.4" };
  }

  // 3. Known hazard-bearing equipment by designator / family / description.
  const text = partText(def, part);
  if (/\b(boiler|hydronic[- ]?make[- ]?up|chiller|cooling[- ]?tower|chemical[- ]?dispenser|detergent[- ]?dispenser|soap[- ]?dispenser|carbonat\w*|sterilizer|autoclave|mortuary)\b/i.test(text)) {
    return { required: "rpz", reason: "high-hazard equipment connection", cite: "IPC 608.17" };
  }
  if (/\b(irrigation|lawn[- ]?sprinkler|turf[- ]?sprinkler)\b/i.test(text)) {
    return { required: "pvb", reason: "irrigation connection", cite: "IPC 608.17.5" };
  }
  if (starter === "DW" || /\b(commercial[- ]?dish ?wash\w*|dish ?machine|dish ?washer)\b/i.test(text)) {
    return { required: "avb", reason: "commercial dishwasher connection", cite: "IPC 608.15.4" };
  }
  if (starter === "HB" || /\b(hose[- ]?bibb?|wall[- ]?hydrant|yard[- ]?hydrant|sill ?cock)\b/i.test(text)) {
    return { required: "avb", reason: "hose bibb connection", cite: "IPC 608.15.4.2" };
  }

  // Boolean `backflow_required: true` with no more specific hazard falls back to RPZ.
  if (explicit === true) {
    return { required: "rpz", reason: "backflow-protected connection", cite: "IPC 608.1" };
  }
  return null;
}

interface UpstreamBackflowDevice {
  readonly id: ElementId;
  readonly name: string;
  readonly kind: BackflowKind;
}

type UpstreamResult =
  | { readonly status: "protected"; readonly device: UpstreamBackflowDevice | null }
  | { readonly status: "insufficient"; readonly device: UpstreamBackflowDevice }
  | { readonly status: "missing" };

function isOutletSide(els: Elements, part: PartInstance, connectorId: string): boolean {
  const def = partDef(els, part);
  if (!def) return connectorId === "out";
  const c = def.connectors.find((x) => x.id === connectorId);
  if (c?.flowDirection === "out") return true;
  if (c?.flowDirection === "in") return false;
  if (connectorId === "out") return true;
  if (connectorId === "in") return false;
  // Single-port backflow device (e.g. inline AVB adapter): treat as upstream when encountered.
  const potable = def.connectors.filter((x) => x.domain === "pipe" && POTABLE_KINDS.has(x.systemKind));
  return potable.length <= 1;
}

function inletPortsOf(els: Elements, part: PartInstance, excludePort: string): string[] {
  const def = partDef(els, part);
  if (!def) return [];
  return def.connectors
    .filter((c) => c.id !== excludePort && c.domain === "pipe" && POTABLE_KINDS.has(c.systemKind) && (c.flowDirection === "in" || c.id === "in"))
    .map((c) => c.id);
}

function otherPotablePortsOf(els: Elements, part: PartInstance, excludePort: string): string[] {
  const def = partDef(els, part);
  if (!def || def.category !== "pipe_accessory") return [];
  return def.connectors
    .filter((c) => c.id !== excludePort && c.domain === "pipe" && POTABLE_KINDS.has(c.systemKind))
    .map((c) => c.id);
}

/**
 * Walk upstream along the potable pipe network from a connected equipment port.
 * Checks whether every path back to the potable supply source passes through
 * a backflow preventer whose protection level satisfies `required`.
 */
function inspectUpstreamBackflow(els: Elements, equipment: PartInstance, connectorId: string, potableSystemKind: string, required: BackflowKind): UpstreamResult {
  const link = equipment.links?.[connectorId];
  if (!link) return { status: "missing" };
  const targetEl = els[link.elementId];
  if (!targetEl) return { status: "missing" };

  const startNode = targetEl.kind === "part" ? `${targetEl.id}#${link.port}` : targetEl.id;
  const seen = new Set<string>([`${equipment.id}#${connectorId}`, startNode]);
  const queue: string[] = [startNode];

  let adequateDevice: UpstreamBackflowDevice | null = null;
  let bestInadequate: UpstreamBackflowDevice | null = null;
  let reachedUnprotectedSource = false;

  const isPotableSource = (part: PartInstance): boolean => {
    const role = plumbingSourceRole(els, part);
    if (role === "water_meter") return true;
    if (role === "water_heater" && (potableSystemKind === "domestic_hot_water" || potableSystemKind === "domestic_hot_water_return")) return true;
    return false;
  };

  while (queue.length > 0) {
    const node = queue.shift() as string;
    const hash = node.indexOf("#");
    if (hash >= 0) {
      const partId = node.slice(0, hash);
      const portId = node.slice(hash + 1);
      if (partId === equipment.id) continue;
      const other = els[partId];
      if (other?.kind !== "part") continue;

      const deviceKind = backflowDeviceKindOf(els, other);
      if (deviceKind !== null) {
        if (isOutletSide(els, other, portId)) {
          const dev: UpstreamBackflowDevice = { id: other.id, name: partName(other), kind: deviceKind };
          if (backflowSatisfies(deviceKind, required)) {
            adequateDevice ??= dev;
            // This path is protected; do not traverse further upstream past this adequate device.
            continue;
          }
          if (!bestInadequate || BACKFLOW_RANK[deviceKind] > BACKFLOW_RANK[bestInadequate.kind]) {
            bestInadequate = dev;
          }
          // Continue upstream through the device's inlet in case a higher-level device sits upstream.
          for (const inPort of inletPortsOf(els, other, portId)) {
            const inLink = other.links?.[inPort];
            if (!inLink) continue;
            const next = els[inLink.elementId]?.kind === "part" ? `${inLink.elementId}#${inLink.port}` : inLink.elementId;
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
        // Encountered via inlet side = sibling/downstream branch; do not traverse through.
        continue;
      }

      if (isPotableSource(other)) {
        reachedUnprotectedSource = true;
        continue;
      }

      // Pass through inline accessories (PRV, shutoff valve, strainer, inline pump) to reach upstream piping.
      for (const nextPort of otherPotablePortsOf(els, other, portId)) {
        const nextLink = other.links?.[nextPort];
        if (!nextLink) continue;
        const next = els[nextLink.elementId]?.kind === "part" ? `${nextLink.elementId}#${nextLink.port}` : nextLink.elementId;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
      continue;
    }

    // Run segment or run fitting: check inline fitting metadata and expand along potable run neighbours.
    const el = els[node];
    if (!el) continue;
    if (el.kind === "run_fitting") {
      const bf = parseBackflowKind(el.params?.backflow_kind);
      if (bf) {
        const dev: UpstreamBackflowDevice = { id: el.id, name: el.family ?? el.fittingType, kind: bf };
        if (backflowSatisfies(bf, required)) {
          adequateDevice ??= dev;
          continue;
        }
        if (!bestInadequate || BACKFLOW_RANK[bf] > BACKFLOW_RANK[bestInadequate.kind]) {
          bestInadequate = dev;
        }
      }
    }
    for (const nb of runNeighbours(els, node)) {
      if (seen.has(nb)) continue;
      if (!nb.includes("#")) {
        const nbEl = els[nb];
        if (!nbEl) continue;
        if (nbEl.kind === "run_segment" || nbEl.kind === "run_fitting") {
          const sys = els[nbEl.systemId];
          if (sys?.kind === "mep_system" && !POTABLE_KINDS.has(sys.systemKind)) continue;
        }
      }
      seen.add(nb);
      queue.push(nb);
    }
  }

  if (reachedUnprotectedSource) {
    return bestInadequate ? { status: "insufficient", device: bestInadequate } : { status: "missing" };
  }
  if (adequateDevice) return { status: "protected", device: adequateDevice };
  if (bestInadequate) return { status: "insufficient", device: bestInadequate };
  return { status: "missing" };
}

function directCrossConnections(els: Elements, seg: RunSegment): Array<{ readonly otherId: ElementId; readonly otherSystem: string }> {
  const sys = els[seg.systemId];
  if (sys?.kind !== "mep_system" || !POTABLE_KINDS.has(sys.systemKind)) return [];
  const out: Array<{ readonly otherId: ElementId; readonly otherSystem: string }> = [];
  for (const end of ["start", "end"] as const) {
    const link = seg.links[end];
    if (!link) continue;
    const other = els[link.elementId];
    if (other?.kind !== "run_segment" && other?.kind !== "run_fitting") continue;
    const otherSys = els[other.systemId];
    if (otherSys?.kind === "mep_system" && DIRECT_CROSS_KINDS.has(otherSys.systemKind)) {
      out.push({ otherId: other.id, otherSystem: otherSys.name || otherSys.systemKind.replace(/_/g, " ") });
    }
  }
  return out;
}

export const backflowRules: readonly RuleDef[] = [
  {
    id: "backflow-protection-missing",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Potable water connected to non-potable, hydronic or hazard-bearing equipment without an upstream backflow preventer",
    scope: "element",
    kinds: ["part", "run_segment"],
    reads: ["part", "run_segment", "run_fitting"],
    run: (ctx, el) => {
      const els = ctx.model.elements;
      if (el.kind === "run_segment") {
        for (const cross of directCrossConnections(els, el)) {
          const sys = els[el.systemId];
          const sysName = sys?.kind === "mep_system" ? sys.name : "Potable water";
          ctx.emit({
            rule: "backflow-protection-missing",
            severity: "error",
            elementIds: [el.id, cross.otherId],
            at: atEl(ctx, el),
            message: clip(`${sysName} connects directly to ${cross.otherSystem} with no backflow preventer; isolate potable water with an RPZ or air gap (IPC 608.1)`),
            fix: { tool: "bim_place_part", hint: "insert an approved backflow preventer (RPZ) or air gap between the potable supply and non-potable system" },
          });
        }
        return;
      }
      if (el.kind !== "part") return;
      const def = partDef(els, el);
      if (!def) return;
      const connectors = resolveConnectors(def, el.values);
      for (const c of connectors) {
        if (c.domain !== "pipe" || !POTABLE_KINDS.has(c.systemKind)) continue;
        if (!el.links?.[c.id]) continue;
        const req = requiredBackflowOf(els, el, c);
        if (!req) continue;
        const integral = integralBackflowOf(def, el, c);
        if (integral !== null) continue; // Handled by insufficient check if integral < required.
        const upstream = inspectUpstreamBackflow(els, el, c.id, c.systemKind, req.required);
        if (upstream.status !== "missing") continue;
        ctx.emit({
          rule: "backflow-protection-missing",
          severity: "error",
          elementIds: [el.id],
          at: atEl(ctx, el),
          message: clip(`${partName(el)} (${req.reason}) is fed by potable water with no upstream backflow preventer; provide ${BACKFLOW_LABELS[req.required]} (${req.cite})`),
          fix: { tool: "bim_place_part", hint: `place and pipe a ${BACKFLOW_LABELS[req.required]} upstream on the potable supply to ${partName(el)}` },
        });
        return;
      }
    },
  },
  {
    id: "backflow-protection-insufficient",
    version: 1,
    pack: "systems",
    severity: "error",
    title: "Upstream backflow preventer does not meet the required IPC/ASPE protection level",
    scope: "element",
    kinds: ["part"],
    reads: ["part", "run_segment", "run_fitting"],
    run: (ctx, el) => {
      if (el.kind !== "part") return;
      const els = ctx.model.elements;
      const def = partDef(els, el);
      if (!def) return;
      const connectors = resolveConnectors(def, el.values);
      for (const c of connectors) {
        if (c.domain !== "pipe" || !POTABLE_KINDS.has(c.systemKind)) continue;
        if (!el.links?.[c.id]) continue;
        const req = requiredBackflowOf(els, el, c);
        if (!req) continue;
        const integral = integralBackflowOf(def, el, c);
        if (integral !== null && backflowSatisfies(integral, req.required)) continue;
        const upstream = inspectUpstreamBackflow(els, el, c.id, c.systemKind, req.required);
        if (upstream.status === "protected") continue;
        if (upstream.status === "insufficient") {
          ctx.emit({
            rule: "backflow-protection-insufficient",
            severity: "error",
            elementIds: [el.id, upstream.device.id],
            at: atEl(ctx, el),
            message: clip(`${partName(el)} (${req.reason}) needs ${BACKFLOW_LABELS[req.required]} (${req.cite}), but upstream ${upstream.device.name} only provides ${BACKFLOW_LABELS[upstream.device.kind]}`),
            fix: { tool: "bim_place_part", hint: `upgrade ${upstream.device.name} or add a ${BACKFLOW_LABELS[req.required]} upstream of ${partName(el)}` },
          });
          return;
        }
        if (integral !== null && !backflowSatisfies(integral, req.required)) {
          ctx.emit({
            rule: "backflow-protection-insufficient",
            severity: "error",
            elementIds: [el.id],
            at: atEl(ctx, el),
            message: clip(`${partName(el)} (${req.reason}) needs ${BACKFLOW_LABELS[req.required]} (${req.cite}), but only has integral ${BACKFLOW_LABELS[integral]}`),
            fix: { tool: "bim_place_part", hint: `add an upstream ${BACKFLOW_LABELS[req.required]} on the potable supply to ${partName(el)}` },
          });
          return;
        }
      }
    },
  },
];
