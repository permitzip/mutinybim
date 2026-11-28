import { elementsOfKind } from "../store";
import type { BimElement, ElementId, ModelState, ParamValue, PartInstance, PartTypeElement } from "../types";
import { loadIndexOf } from "./load-index";

/**
 * Pure, discipline-neutral equipment requirements fulfilment and drift audit.
 *
 * Inspects planned and placed equipment parts against their planned requirement
 * baselines, system/service connections, and load-calculation coverage:
 *   - unplaced_equipment   planned items not yet placed in the model
 *   - unconnected_system   placed items missing a required system/service link
 *   - missing_from_loads   load-bearing items omitted from load records/sources
 *   - parameter_drift      modeled part values that drifted from planned rows
 */

/** Instance parameter name used to persist a compact JSON requirement baseline on a planned/placed part. */
export const EQUIPMENT_BASELINE_PARAM = "req_baseline";

export type EquipmentAuditFindingKind =
  | "unplaced_equipment"
  | "unconnected_system"
  | "missing_from_loads"
  | "parameter_drift";

export type EquipmentAuditSeverity = "error" | "warning" | "info";

export interface EquipmentRequirementBaseline {
  readonly partId?: ElementId;
  readonly mark: string;
  readonly buildingType?: string;
  /** Planned parameter values to compare against the modeled part. */
  readonly values: Readonly<Record<string, ParamValue>>;
  /** Service or system ids the placed part must connect to. */
  readonly requiredServices?: readonly string[];
  /** Service ids that must be represented in load calculations (`load_point` or `service_link`). */
  readonly requiredLoadServices?: readonly string[];
  /** Parameter keys representing demand that must be tracked in load calculations. */
  readonly loadKeys?: readonly string[];
  /** Explicit flag requiring load-calculation coverage even when `loadKeys` is empty. */
  readonly requiresLoad?: boolean;
}

export interface EquipmentAuditFinding {
  readonly kind: EquipmentAuditFindingKind;
  readonly severity: EquipmentAuditSeverity;
  readonly partId?: ElementId;
  readonly mark: string;
  /** Affected service or system id (for `unconnected_system` and `missing_from_loads`). */
  readonly service?: string;
  /** Affected parameter key (for `parameter_drift`). */
  readonly parameter?: string;
  readonly plannedValue?: ParamValue;
  readonly modeledValue?: ParamValue | null;
  readonly message: string;
}

export interface EquipmentAuditSummary {
  readonly totalTracked: number;
  readonly placedCount: number;
  readonly unplacedCount: number;
  readonly unconnectedCount: number;
  readonly missingFromLoadsCount: number;
  readonly driftCount: number;
  readonly clean: boolean;
}

export interface EquipmentAuditReport {
  readonly summary: EquipmentAuditSummary;
  readonly findings: readonly EquipmentAuditFinding[];
}

export interface AuditEquipmentOptions {
  /** Optional external planned requirement rows to check alongside in-model baselines. */
  readonly requirements?: readonly EquipmentRequirementBaseline[];
  /** Additional numeric parameter keys treated as load-bearing demand when present and > 0. */
  readonly loadParameterKeys?: readonly string[];
  /** Optional service alias map (e.g. canonical required service id → acceptable connected service/system ids). */
  readonly serviceAliases?: Readonly<Record<string, readonly string[]>>;
  /** Relative tolerance for numeric drift comparisons (default 1e-4). */
  readonly numericRelativeTolerance?: number;
  /** Absolute tolerance for numeric drift comparisons (default 1e-6). */
  readonly numericAbsoluteTolerance?: number;
}

type Elements = Readonly<Record<string, BimElement>>;

function isParamValue(v: unknown): v is ParamValue {
  return typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
}

/** Serializes a requirement baseline into a compact JSON string for storage in `part.values[EQUIPMENT_BASELINE_PARAM]`. */
export function serializeEquipmentBaseline(baseline: EquipmentRequirementBaseline): string {
  const payload: Record<string, unknown> = {
    mark: baseline.mark,
    values: baseline.values,
  };
  if (baseline.buildingType) payload.buildingType = baseline.buildingType;
  if (baseline.requiredServices && baseline.requiredServices.length > 0) payload.requiredServices = [...baseline.requiredServices];
  if (baseline.requiredLoadServices && baseline.requiredLoadServices.length > 0) payload.requiredLoadServices = [...baseline.requiredLoadServices];
  if (baseline.loadKeys && baseline.loadKeys.length > 0) payload.loadKeys = [...baseline.loadKeys];
  if (baseline.requiresLoad !== undefined) payload.requiresLoad = baseline.requiresLoad;
  return JSON.stringify(payload);
}

/** Parses a requirement baseline stored in `part.values[EQUIPMENT_BASELINE_PARAM]`, or null if absent/invalid. */
export function parseEquipmentBaseline(raw: unknown, fallbackMark = ""): EquipmentRequirementBaseline | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const rawValues = obj.values;
  if (typeof rawValues !== "object" || rawValues === null || Array.isArray(rawValues)) return null;
  const values: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (isParamValue(v)) values[k] = v;
  }
  const mark = typeof obj.mark === "string" && obj.mark.trim() ? obj.mark.trim() : fallbackMark;
  return {
    mark,
    ...(typeof obj.buildingType === "string" && obj.buildingType.trim() ? { buildingType: obj.buildingType.trim() } : {}),
    values,
    ...(isStringArray(obj.requiredServices) ? { requiredServices: obj.requiredServices } : {}),
    ...(isStringArray(obj.requiredLoadServices) ? { requiredLoadServices: obj.requiredLoadServices } : {}),
    ...(isStringArray(obj.loadKeys) ? { loadKeys: obj.loadKeys } : {}),
    ...(typeof obj.requiresLoad === "boolean" ? { requiresLoad: obj.requiresLoad } : {}),
  };
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function serviceMatches(required: string, connected: ReadonlySet<string>, aliases?: Readonly<Record<string, readonly string[]>>): boolean {
  const reqNorm = norm(required);
  if (connected.has(reqNorm)) return true;
  for (const c of connected) {
    if (c === reqNorm || c.startsWith(`${reqNorm}:`) || c.startsWith(`${reqNorm}_`) || c.endsWith(`_${reqNorm}`) || c.endsWith(`:${reqNorm}`)) {
      return true;
    }
  }
  const extra = aliases?.[required] ?? aliases?.[reqNorm];
  if (extra) {
    for (const alt of extra) {
      if (connected.has(norm(alt))) return true;
    }
  }
  return false;
}

function connectedServicesOf(model: ModelState, part: PartInstance, partType: PartTypeElement | undefined): Set<string> {
  const elements: Elements = model.elements;
  const out = new Set<string>();
  const add = (token: string | undefined) => {
    if (token && token.trim()) out.add(norm(token));
  };

  // 1. Run connections via part.links
  for (const [connId, ref] of Object.entries(part.links ?? {})) {
    add(connId);
    const conn = partType?.definition.connectors.find((c) => c.id === connId);
    if (conn) {
      add(conn.domain);
      if (conn.systemKind) add(conn.systemKind);
    }
    const target = elements[ref.elementId];
    if (target) {
      if ("systemId" in target && typeof target.systemId === "string") add(target.systemId);
      if ("domain" in target && typeof target.domain === "string") add(target.domain);
      if ("service" in target && typeof target.service === "string") add(target.service);
    }
  }

  // 2. Service links via part.served
  for (const [connId, linkId] of Object.entries(part.served ?? {})) {
    add(connId);
    const link = elements[linkId];
    if (link?.kind === "service_link") {
      add(link.adapter ?? link.trade);
      add(link.source.elementId);
    }
  }

  // 3. Explicit model.connections touching this part
  for (const c of model.connections) {
    const otherId = c.a.elementId === part.id ? c.b.elementId : c.b.elementId === part.id ? c.a.elementId : null;
    if (!otherId) continue;
    const other = elements[otherId];
    if (!other) continue;
    if ("systemId" in other && typeof other.systemId === "string") add(other.systemId);
    if ("domain" in other && typeof other.domain === "string") add(other.domain);
    if ("service" in other && typeof other.service === "string") add(other.service);
  }

  // 4. Load points attached to this part that sit on a live run host
  for (const lpId of loadIndexOf(elements).ofPart(part.id)) {
    const lp = elements[lpId];
    if (lp?.kind !== "load_point") continue;
    if (lp.host && elements[lp.host.elementId]) {
      const host = elements[lp.host.elementId];
      if (lp.service) add(lp.service);
      if (host && "systemId" in host && typeof host.systemId === "string") add(host.systemId);
      if (host && "domain" in host && typeof host.domain === "string") add(host.domain);
    }
  }

  return out;
}

function loadCoverageOf(elements: Elements, part: PartInstance): { readonly hasAny: boolean; readonly services: Set<string>; readonly untypedCount: number } {
  const services = new Set<string>();
  let untypedCount = 0;
  let total = 0;

  for (const lpId of loadIndexOf(elements).ofPart(part.id)) {
    const lp = elements[lpId];
    if (lp?.kind !== "load_point") continue;
    total += 1;
    if (lp.service) services.add(norm(lp.service));
    else untypedCount += 1;
  }

  for (const [connId, linkId] of Object.entries(part.served ?? {})) {
    const link = elements[linkId];
    if (link?.kind !== "service_link") continue;
    total += 1;
    const svc = link.adapter ?? link.trade;
    if (svc) services.add(norm(svc));
    if (connId) services.add(norm(connId));
    if (!svc && !connId) untypedCount += 1;
  }

  return { hasAny: total > 0, services, untypedCount };
}

function valuesDrifted(expected: ParamValue, actual: ParamValue | undefined, relTol: number, absTol: number): boolean {
  if (actual === undefined) return true;
  if (typeof expected === "number") {
    if (typeof actual !== "number" || !Number.isFinite(actual)) return true;
    return Math.abs(actual - expected) > Math.max(absTol, Math.abs(expected) * relTol);
  }
  if (typeof expected === "boolean") {
    return actual !== expected;
  }
  if (typeof actual !== "string") return true;
  return actual.trim().toLowerCase() !== expected.trim().toLowerCase();
}

const FINDING_ORDER: Readonly<Record<EquipmentAuditFindingKind, number>> = {
  unplaced_equipment: 0,
  unconnected_system: 1,
  missing_from_loads: 2,
  parameter_drift: 3,
};

/**
 * Pure audit of equipment requirements fulfilment and schedule-vs-plan drift.
 *
 * Reads planned/placed parts, their stored `req_baseline` snapshots (plus any
 * explicit `options.requirements`), service/run connections, and load records.
 */
export function auditEquipmentRequirements(model: ModelState, options: AuditEquipmentOptions = {}): EquipmentAuditReport {
  const elements = model.elements;
  const relTol = options.numericRelativeTolerance ?? 1e-4;
  const absTol = options.numericAbsoluteTolerance ?? 1e-6;
  const extraLoadKeys = options.loadParameterKeys ?? [];

  const parts = elementsOfKind(elements, "part");
  const partById = new Map<string, PartInstance>();
  const partByMark = new Map<string, PartInstance>();
  for (const p of parts) {
    partById.set(p.id, p);
    if (p.mark.trim()) partByMark.set(p.mark.trim().toLowerCase(), p);
  }

  interface TrackedItem {
    readonly part: PartInstance | null;
    readonly mark: string;
    readonly baseline: EquipmentRequirementBaseline | null;
  }

  const trackedByKey = new Map<string, TrackedItem>();

  // 1. Collect tracked parts directly from the model (planned parts or parts carrying a baseline).
  for (const p of parts) {
    const baseline = parseEquipmentBaseline(p.values[EQUIPMENT_BASELINE_PARAM], p.mark);
    if (p.planned !== undefined || baseline !== null) {
      trackedByKey.set(`part:${p.id}`, {
        part: p,
        mark: p.mark.trim() || baseline?.mark || p.id,
        baseline,
      });
    }
  }

  // 2. Merge any explicit requirements passed by caller (matching by partId, then mark).
  for (const req of options.requirements ?? []) {
    const matched = (req.partId ? partById.get(req.partId) : undefined) ?? (req.mark.trim() ? partByMark.get(req.mark.trim().toLowerCase()) : undefined) ?? null;
    const key = matched ? `part:${matched.id}` : `req:${req.mark.trim().toLowerCase() || req.partId || trackedByKey.size}`;
    trackedByKey.set(key, {
      part: matched,
      mark: matched?.mark.trim() || req.mark.trim() || (matched?.id ?? key),
      baseline: req,
    });
  }

  const findings: EquipmentAuditFinding[] = [];
  let placedCount = 0;
  let unplacedCount = 0;
  let unconnectedCount = 0;
  let missingFromLoadsCount = 0;
  let driftCount = 0;

  for (const item of trackedByKey.values()) {
    const { part, mark, baseline } = item;

    // 1. Unplaced planned equipment
    if (!part || part.planned !== undefined) {
      unplacedCount += 1;
      findings.push({
        kind: "unplaced_equipment",
        severity: "warning",
        ...(part ? { partId: part.id } : {}),
        mark,
        message: part ? `Planned equipment "${mark}" (${part.id}) has not been placed on a plan.` : `Required equipment "${mark}" has not been created or placed in the model.`,
      });
    } else {
      placedCount += 1;
    }

    if (!part) continue;

    const partTypeEl = elements[part.typeId];
    const partType = partTypeEl?.kind === "part_type" ? partTypeEl : undefined;

    // 2. Placed equipment not connected to required system(s)
    if (part.planned === undefined) {
      const requiredServices = new Set<string>(baseline?.requiredServices ?? []);
      // Also require any service explicitly requested by an anchored load_point on this part.
      for (const lpId of loadIndexOf(elements).ofPart(part.id)) {
        const lp = elements[lpId];
        if (lp?.kind === "load_point" && lp.service) requiredServices.add(lp.service);
      }
      if (requiredServices.size > 0) {
        const connected = connectedServicesOf(model, part, partType);
        for (const reqSvc of [...requiredServices].sort()) {
          if (!serviceMatches(reqSvc, connected, options.serviceAliases)) {
            unconnectedCount += 1;
            findings.push({
              kind: "unconnected_system",
              severity: "error",
              partId: part.id,
              mark,
              service: reqSvc,
              message: `Placed equipment "${mark}" is not connected to required system/service "${reqSvc}".`,
            });
          }
        }
      }
    }

    // 3. Equipment missing from load calculations
    const loadKeys = [...(baseline?.loadKeys ?? []), ...extraLoadKeys];
    const hasPositiveLoadParam = loadKeys.some((k) => {
      const v = part.values[k];
      return typeof v === "number" && Number.isFinite(v) && v > 0;
    });
    const requiredLoadServices = baseline?.requiredLoadServices ?? [];
    const needsLoad = baseline?.requiresLoad === true || requiredLoadServices.length > 0 || hasPositiveLoadParam;
    if (needsLoad) {
      const coverage = loadCoverageOf(elements, part);
      if (requiredLoadServices.length > 0) {
        for (const svc of [...new Set(requiredLoadServices)].sort()) {
          const coveredByService = serviceMatches(svc, coverage.services, options.serviceAliases);
          const coveredByUntyped = requiredLoadServices.length === 1 && coverage.untypedCount > 0;
          if (!coveredByService && !coveredByUntyped) {
            missingFromLoadsCount += 1;
            findings.push({
              kind: "missing_from_loads",
              severity: "warning",
              partId: part.id,
              mark,
              service: svc,
              message: `Equipment "${mark}" is missing from load calculations for "${svc}".`,
            });
          }
        }
      } else if (!coverage.hasAny) {
        missingFromLoadsCount += 1;
        findings.push({
          kind: "missing_from_loads",
          severity: "warning",
          partId: part.id,
          mark,
          message: `Equipment "${mark}" carries demand values but is missing from load calculations.`,
        });
      }
    }

    // 4. Modeled part values drifted from planned requirement row
    if (baseline) {
      const modeledValues: Readonly<Record<string, ParamValue>> = {
        ...(partType?.definition.typeValues ?? {}),
        ...part.values,
      };
      for (const [paramKey, expected] of Object.entries(baseline.values)) {
        if (paramKey === EQUIPMENT_BASELINE_PARAM) continue;
        const actual = modeledValues[paramKey];
        if (valuesDrifted(expected, actual, relTol, absTol)) {
          driftCount += 1;
          findings.push({
            kind: "parameter_drift",
            severity: "warning",
            partId: part.id,
            mark,
            parameter: paramKey,
            plannedValue: expected,
            modeledValue: actual ?? null,
            message: `Equipment "${mark}" parameter "${paramKey}" drifted from planned value (${String(expected)}) to modeled value (${actual === undefined ? "unset" : String(actual)}).`,
          });
        }
      }
    }
  }

  findings.sort(
    (a, b) =>
      FINDING_ORDER[a.kind] - FINDING_ORDER[b.kind] ||
      a.mark.localeCompare(b.mark) ||
      (a.service ?? "").localeCompare(b.service ?? "") ||
      (a.parameter ?? "").localeCompare(b.parameter ?? ""),
  );

  return {
    summary: {
      totalTracked: trackedByKey.size,
      placedCount,
      unplacedCount,
      unconnectedCount,
      missingFromLoadsCount,
      driftCount,
      clean: findings.length === 0,
    },
    findings,
  };
}
