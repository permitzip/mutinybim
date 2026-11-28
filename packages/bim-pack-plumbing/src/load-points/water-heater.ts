import {
  componentBeyond,
  connectionTypeOf,
  fixtureKeyOf,
  isSource,
  loadPointLoad,
  loadPointTotals,
  loadTypicalOf,
  paramValue,
  partConnectionTypeLoad,
  partConnectionTypeName,
  resolveConnectors,
  typicalFactor,
  type BimElement,
  type CouplingCarry,
  type LoadPointElement,
  type NetworkCouplingDef,
  type PartInstance,
} from "@permitzip/bim-kernel";

type Elements = Readonly<Record<string, BimElement>>;
/** A run graph node: a run element id, a load point id, or `part#connector`. */
type Node = string;

const isPartNode = (n: Node) => n.includes("#");

/** The water heater kind a part's type says ("tank", "gas_tankless", "electric_tankless"), or null. */
export function waterHeaterKind(elements: Elements, part: PartInstance): string | null {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return null;
  const v = paramValue(type.definition, part.values, "heater_kind");
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function connectorDefOf(elements: Elements, part: PartInstance, connectorId: string) {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return null;
  return type.definition.connectors.find((c) => c.id === connectorId) ?? null;
}

function hasExplicitHotWaterCouplingMetadata(elements: Elements, part: PartInstance): boolean | null {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return null;
  const explicit = paramValue(type.definition, part.values, "network_coupling");
  if (explicit === false || (typeof explicit === "string" && /^(none|false|off)$/i.test(explicit.trim()))) return false;
  if (explicit === true || (typeof explicit === "string" && explicit.trim() !== "")) return true;
  for (const k of ["heater_kind", "coupling_role", "couples_systems"]) {
    const v = paramValue(type.definition, part.values, k);
    if (typeof v === "string" && v.trim() !== "" && !/^(none|false|off)$/i.test(v.trim())) return true;
  }
  const hws = paramValue(type.definition, part.values, "hot_water_source");
  if (hws === true || (typeof hws === "string" && hws.trim() !== "" && !/^(none|false|off)$/i.test(hws.trim()))) return true;
  return null;
}

/**
 * Whether a part couples domestic cold water to domestic hot water (water heater,
 * boiler, indirect tank, plate heat exchanger, booster heater). Driven generically
 * by connector/equipment metadata — never hardcoding family names:
 *  - explicit coupling metadata (`heater_kind`, `network_coupling`, `coupling_role`,
 *    `couples_systems`, `hot_water_source`), OR
 *  - directional connector metadata (`domestic_hot_water` connector with
 *    `flowDirection: "out"` and a `domestic_cold_water` inlet).
 */
export function isHotWaterCoupler(elements: Elements, part: PartInstance): boolean {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return false;
  const explicit = hasExplicitHotWaterCouplingMetadata(elements, part);
  if (explicit === false) return false;
  // Read raw connector definitions so `flowDirection` (omitted by `resolveConnectors`) is preserved.
  const conns = type.definition.connectors;
  const coldInlets = conns.filter((c) => c.systemKind === "domestic_cold_water" && c.flowDirection !== "out");
  const hotOutlets = conns.filter((c) => c.systemKind === "domestic_hot_water" && c.flowDirection !== "in");
  if (coldInlets.length === 0 || hotOutlets.length === 0) return false;
  if (explicit === true) return true;
  // Directional cut-sheet equipment: DHW port marked as supply ("out") + cold inlet.
  return hotOutlets.some((c) => c.flowDirection === "out");
}

/** A coupled equipment's hot outlet: the source of its hot water system (the walk's root), as a meter or panel is. */
export function isHeaterOutlet(elements: Elements, part: PartInstance, connectorId: string): boolean {
  if (!isHotWaterCoupler(elements, part)) return false;
  const c = connectorDefOf(elements, part, connectorId);
  return c?.systemKind === "domestic_hot_water" && c.flowDirection !== "in";
}

/** A coupled equipment's cold inlet: on the cold system it carries everything its hot side serves. */
export function isHeaterInlet(elements: Elements, part: PartInstance, connectorId: string): boolean {
  if (!isHotWaterCoupler(elements, part)) return false;
  const c = connectorDefOf(elements, part, connectorId);
  return c?.systemKind === "domestic_cold_water" && c.flowDirection !== "out";
}

export { isHeaterOutlet as isHotWaterCouplingOutlet, isHeaterInlet as isHotWaterCouplingInlet };

/** Hot-water WSFU drawn by one modeled part connector (without needing a separate load_point). */
export function partHotWaterWsfu(elements: Elements, part: PartInstance, connectorId: string): number {
  if (isSource(elements, part) || isHotWaterCoupler(elements, part)) return 0;
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return 0;
  const c = resolveConnectors(type.definition, part.values).find((x) => x.id === connectorId);
  if (c?.flow !== undefined) return c.flow;
  for (const k of ["wsfu_hot", "wsfu", "water_fixture_units"]) {
    const ownVal = part.values[k];
    if (typeof ownVal === "number" && Number.isFinite(ownVal)) return ownVal;
  }
  const fromType = partConnectionTypeLoad(elements, part, c?.systemKind ?? "domestic_hot_water");
  if (fromType !== null) return fromType;
  for (const k of ["wsfu_hot", "wsfu", "water_fixture_units"]) {
    const v = paramValue(type.definition, part.values, k);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function partWaterTotals(elements: Elements, part: PartInstance, coldConnectorId: string): { wsfu_total: number; wsfu_cold: number } {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return { wsfu_total: 0, wsfu_cold: 0 };
  const name = partConnectionTypeName(elements, part);
  const ct = name ? connectionTypeOf(elements, name) : null;
  const c = resolveConnectors(type.definition, part.values).find((x) => x.id === coldConnectorId);
  const totalParam = paramValue(type.definition, part.values, "wsfu_total");
  const coldParam = paramValue(type.definition, part.values, "wsfu_cold");
  const wsfu_total = typeof totalParam === "number" ? totalParam : typeof ct?.quantities?.wsfu_total === "number" ? ct.quantities.wsfu_total : 0;
  const wsfu_cold =
    c?.flow !== undefined
      ? c.flow
      : typeof coldParam === "number"
        ? coldParam
        : typeof ct?.quantities?.wsfu_cold === "number"
          ? ct.quantities.wsfu_cold
          : 0;
  return { wsfu_total, wsfu_cold };
}

/**
 * Water: a coupled equipment's cold inlet carries its hot side's fixture units
 * (both `load_point` elements and modeled `part` fixtures, never double-counting
 * attached parts); a fixture whose cold and hot sides are both below a pipe
 * counts its total units there, not cold + hot (the difference is added once,
 * at the node where its two sides meet).
 */
function carryThroughHeaters({ elements, tree, systemKind, neighbours, own, alsoRead }: CouplingCarry): void {
  if (systemKind !== "domestic_cold_water") return;
  const coldPoints: LoadPointElement[] = [];
  const coldAttachedParts = new Set<string>();
  const coldPartNodes: Array<{ readonly node: Node; readonly part: PartInstance; readonly connectorId: string }> = [];
  for (const n of tree.order) {
    const el = elements[n];
    if (el?.kind === "load_point") {
      coldPoints.push(el);
      if (el.attachedPartId) coldAttachedParts.add(el.attachedPartId);
      continue;
    }
    if (isPartNode(n)) {
      const hash = n.indexOf("#");
      const p = elements[n.slice(0, hash)];
      if (p?.kind === "part") coldPartNodes.push({ node: n, part: p, connectorId: n.slice(hash + 1) });
    }
  }
  const readSet = new Set<string>(alsoRead);
  const trackRead = (id: string) => {
    if (!readSet.has(id)) {
      readSet.add(id);
      alsoRead.push(id);
    }
  };
  for (const n of tree.order) {
    if (!isPartNode(n)) continue;
    const partId = n.slice(0, n.indexOf("#"));
    const part = elements[partId];
    if (part?.kind !== "part" || !isHeaterInlet(elements, part, n.slice(n.indexOf("#") + 1))) continue;
    // The equipment's hot side: every hot load point and modeled part fixture its outlets reach.
    const hot = new Map<string, number>();
    let hotTotal = 0;
    const beyondNodes: Node[] = [];
    const seenBeyond = new Set<Node>();
    for (const [connector, link] of Object.entries(part.links ?? {})) {
      if (!isHeaterOutlet(elements, part, connector)) continue;
      for (const m of componentBeyond(elements, partId, link.elementId, neighbours)) {
        if (seenBeyond.has(m)) continue;
        seenBeyond.add(m);
        beyondNodes.push(m);
      }
    }
    const hotAttachedParts = new Set<string>();
    for (const m of beyondNodes) {
      if (!isPartNode(m)) trackRead(m);
      const el = elements[m];
      if (el?.kind !== "load_point") continue;
      if (el.attachedPartId) hotAttachedParts.add(el.attachedPartId);
      const h = loadPointLoad(elements, el);
      // A typical unit's hot points count once per instance at equipment outside the unit (F6).
      hotTotal += h * typicalFactor(loadTypicalOf(elements, el, [el.host?.elementId, el.attachedPartId]).typical, part.groupId);
      const key = fixtureKeyOf(el);
      if (key) hot.set(key, (hot.get(key) ?? 0) + h);
    }
    for (const m of beyondNodes) {
      if (!isPartNode(m)) continue;
      const hash = m.indexOf("#");
      const pId = m.slice(0, hash);
      if (pId === partId || hotAttachedParts.has(pId)) continue;
      const p = elements[pId];
      if (p?.kind !== "part") continue;
      trackRead(p.id);
      trackRead(p.typeId);
      const h = partHotWaterWsfu(elements, p, m.slice(hash + 1));
      if (h <= 0) continue;
      hotTotal += h * typicalFactor(loadTypicalOf(elements, p, []).typical, part.groupId);
      const key = `part:${p.id}`;
      hot.set(key, (hot.get(key) ?? 0) + h);
    }
    own.set(n, (own.get(n) ?? 0) + hotTotal);
    if (hot.size === 0) continue;
    const ancestors = new Set<Node>();
    for (let a: Node | null | undefined = n; a !== null && a !== undefined; a = tree.parent.get(a)) ancestors.add(a);
    const adjustedKeys = new Set<string>();
    for (const cold of coldPoints) {
      const key = fixtureKeyOf(cold);
      const h = key ? hot.get(key) : undefined;
      if (!key || h === undefined) continue;
      const t = loadPointTotals(elements, cold);
      if (t.wsfu_total <= 0) continue;
      const adj = t.wsfu_total - t.wsfu_cold - h;
      adjustedKeys.add(key);
      if (adj === 0) continue;
      let meet: Node | null | undefined = cold.id;
      while (meet !== null && meet !== undefined && !ancestors.has(meet)) meet = tree.parent.get(meet);
      if (meet === null || meet === undefined) continue;
      const meetGroup = elements[meet.includes("#") ? meet.slice(0, meet.indexOf("#")) : meet]?.groupId;
      own.set(meet, (own.get(meet) ?? 0) + adj * typicalFactor(loadTypicalOf(elements, cold, [cold.host?.elementId, cold.attachedPartId]).typical, meetGroup));
    }
    for (const { node: cn, part: cp, connectorId: cc } of coldPartNodes) {
      if (coldAttachedParts.has(cp.id) || isHotWaterCoupler(elements, cp)) continue;
      const key = `part:${cp.id}`;
      if (adjustedKeys.has(key)) continue;
      const h = hot.get(key);
      if (h === undefined) continue;
      const t = partWaterTotals(elements, cp, cc);
      if (t.wsfu_total <= 0) continue;
      const adj = t.wsfu_total - t.wsfu_cold - h;
      adjustedKeys.add(key);
      if (adj === 0) continue;
      let meet: Node | null | undefined = cn;
      while (meet !== null && meet !== undefined && !ancestors.has(meet)) meet = tree.parent.get(meet);
      if (meet === null || meet === undefined) continue;
      const meetGroup = elements[meet.includes("#") ? meet.slice(0, meet.indexOf("#")) : meet]?.groupId;
      own.set(meet, (own.get(meet) ?? 0) + adj * typicalFactor(loadTypicalOf(elements, cp, []).typical, meetGroup));
    }
  }
}

/** Hot-to-cold water equipment coupling (water heaters, boilers, indirect tanks, heat exchangers): the source of its hot system, and its cold inlet carries the hot side (with the combined-units adjustment). */
export const WATER_HEATER_COUPLING: NetworkCouplingDef = {
  id: "water_heater",
  couples: isHotWaterCoupler,
  isOutlet: isHeaterOutlet,
  carry: carryThroughHeaters,
};
