import type { ViewType } from "../documents";
import { elementsOfKind } from "../store";
import { asElementId, type BimElement, type ElementId, type ModelState } from "../types";

/**
 * Drafting / detail view staleness alerts when linked model elements or
 * systems are modified or deleted. Discipline-neutral: reads only view
 * `linkedElementIds` / `linkedSystemIds` and the touched element records.
 */

export interface LinkedDetailImpact {
  readonly viewId: ElementId;
  readonly viewName: string;
  readonly viewType: ViewType;
  /** Touched/deleted element ids that triggered this alert (direct link or system member). */
  readonly matchedElementIds: readonly ElementId[];
  /** Linked system/service ids affected by the touched/deleted elements. */
  readonly matchedSystemIds: readonly ElementId[];
  /** Subset of matched element ids that were deleted. */
  readonly deletedElementIds: readonly ElementId[];
  /** Low-token staleness alert suitable for scripts, dry-runs, and review badges. */
  readonly notice: string;
}

export interface LinkedDetailImpactOptions {
  /** Element ids deleted by the change (if known). */
  readonly deletedElementIds?: readonly string[];
  /** Post-change elements map (when provided, ids absent here are also treated as deleted). */
  readonly afterElements?: Readonly<Record<string, BimElement>>;
  /** Include non-detail views that carry explicit links (default false: drafting/detail views only). */
  readonly includeAllViewTypes?: boolean;
}

type Elements = Readonly<Record<string, BimElement>>;

function systemIdsOf(el: BimElement | undefined, elements: Elements): string[] {
  if (!el) return [];
  const out = new Set<string>();
  if ("systemId" in el && typeof el.systemId === "string" && el.systemId) out.add(el.systemId);
  if (el.kind === "service_link") {
    out.add(el.id);
    const svc = el.adapter ?? el.trade;
    if (svc) out.add(svc);
    if (el.source.elementId) out.add(el.source.elementId);
  } else if (el.kind === "load_point") {
    if (el.service) out.add(el.service);
    if (el.servedBy) out.add(el.servedBy);
  } else if (el.kind === "part") {
    for (const ref of Object.values(el.links ?? {})) {
      const target = elements[ref.elementId];
      if (target && "systemId" in target && typeof target.systemId === "string" && target.systemId) {
        out.add(target.systemId);
      }
    }
    for (const linkId of Object.values(el.served ?? {})) {
      const link = elements[linkId];
      if (link?.kind === "service_link") {
        const svc = link.adapter ?? link.trade;
        if (svc) out.add(svc);
        if (link.source.elementId) out.add(link.source.elementId);
      }
    }
  }
  return [...out];
}

/**
 * Detects drafting/detail views linked to modified or deleted model elements
 * or systems (`ViewProps.linkedElementIds` / `ViewProps.linkedSystemIds`).
 */
export function linkedDetailImpacts(
  model: ModelState,
  touchedElementIds: readonly string[],
  options: LinkedDetailImpactOptions = {},
): LinkedDetailImpact[] {
  const deletedSet = new Set<string>(options.deletedElementIds ?? []);
  const touched = new Set<string>([...touchedElementIds, ...deletedSet]);
  if (touched.size === 0) return [];

  const before = model.elements;
  const after = options.afterElements;
  const includeAllViewTypes = options.includeAllViewTypes === true;

  // Precompute associated system/service ids for every touched element (before and after states).
  const systemsByElement = new Map<string, Set<string>>();
  for (const id of touched) {
    const sys = new Set<string>();
    for (const s of systemIdsOf(before[id], before)) sys.add(s);
    if (after) {
      for (const s of systemIdsOf(after[id], after)) sys.add(s);
      if (before[id] !== undefined && after[id] === undefined) deletedSet.add(id);
    }
    systemsByElement.set(id, sys);
  }

  const impacts: LinkedDetailImpact[] = [];
  for (const view of elementsOfKind(before, "view")) {
    if (view.deleted) continue;
    if (!includeAllViewTypes && view.viewType !== "detail") continue;
    const linkedElements = view.props?.linkedElementIds ?? [];
    const linkedSystems = view.props?.linkedSystemIds ?? [];
    if (linkedElements.length === 0 && linkedSystems.length === 0) continue;

    const linkedElSet = new Set<string>(linkedElements);
    const linkedSysSet = new Set<string>(linkedSystems);
    const matchedEl = new Set<ElementId>();
    const matchedSys = new Set<ElementId>();

    for (const id of touched) {
      if (linkedElSet.has(id)) matchedEl.add(asElementId(id));
      if (linkedSysSet.has(id)) {
        matchedSys.add(asElementId(id));
        matchedEl.add(asElementId(id));
      }
      const sysIds = systemsByElement.get(id);
      if (sysIds) {
        for (const sid of sysIds) {
          if (linkedSysSet.has(sid)) {
            matchedSys.add(asElementId(sid));
            matchedEl.add(asElementId(id));
          }
        }
      }
    }

    if (matchedEl.size === 0 && matchedSys.size === 0) continue;

    const matchedElementIds = [...matchedEl].sort();
    const matchedSystemIds = [...matchedSys].sort();
    const deletedElementIds = matchedElementIds.filter((id) => deletedSet.has(id));
    const parts: string[] = [];
    if (matchedElementIds.length > 0) {
      const preview = matchedElementIds.slice(0, 4).join(", ");
      const more = matchedElementIds.length > 4 ? ` +${matchedElementIds.length - 4}` : "";
      parts.push(`element(s) ${preview}${more}`);
    }
    if (matchedSystemIds.length > 0) {
      const preview = matchedSystemIds.slice(0, 4).join(", ");
      const more = matchedSystemIds.length > 4 ? ` +${matchedSystemIds.length - 4}` : "";
      parts.push(`system(s) ${preview}${more}`);
    }
    const delSuffix = deletedElementIds.length > 0 ? ` (${deletedElementIds.length} deleted)` : "";
    const notice = `Detail "${view.name}" may be stale: linked ${parts.join(" and ")} changed${delSuffix}.`;

    impacts.push({
      viewId: view.id,
      viewName: view.name,
      viewType: view.viewType,
      matchedElementIds,
      matchedSystemIds,
      deletedElementIds,
      notice,
    });
  }

  return impacts.sort((a, b) => a.viewName.localeCompare(b.viewName) || a.viewId.localeCompare(b.viewId));
}
