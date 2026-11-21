import { qty, subtract, to, type Quantity } from "@permitzip/bim-units";
import type { GradingSurface, TinFace } from "./surfaces";

/**
 * Cut and fill between two TIN surfaces, over the ground both of them cover.
 *
 * Method (see `TIN_PRISMOIDAL_VOLUME`): build the plan overlay of the two
 * triangulations by clipping every triangle of one against every triangle of
 * the other. Each piece of that overlay lies in one triangle of each surface,
 * so both are planes there. The signed volume of a triangular prism with a
 * linearly varying height is the plan area times the mean of the three corner
 * height differences:
 *
 *   V = A · (Δz1 + Δz2 + Δz3) / 3
 *
 * Δz is proposed elevation minus existing elevation. Positive is fill (material
 * to place), negative is cut (material to dig). Where Δz changes sign inside
 * one triangle, the triangle is split on the zero contour and the two pieces
 * are totalled separately, so cut and fill are not netted inside one prism.
 *
 * On planar facets this is exact. A fine grid approaches the same number and
 * adds a cell-size error this overlay does not have. Only the plan overlap is
 * counted; ground only one surface covers is reported and adds nothing.
 * Vertical faces have no plan area and add nothing.
 *
 * This is an on-demand calculation, not an edit of the building model. It
 * compares every triangle pair, so it is for a site TIN (see `MAX_TIN_FACES`),
 * not a scan, and it does not walk the rest of the model.
 *
 * Lengths are converted to metres with bim-units before the geometry, and the
 * totals are returned as volume and area quantities.
 */

interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

interface MeshPoint extends PlanPoint {
  readonly z: number;
}

interface Tri {
  readonly a: MeshPoint;
  readonly b: MeshPoint;
  readonly c: MeshPoint;
}

interface Totals {
  cut: number;
  fill: number;
  overlap: number;
  facets: number;
}

export interface CutFillResult {
  /** Material to dig, where the existing ground is above the proposed. */
  readonly cut: Quantity<"volume">;
  /** Material to place, where the proposed ground is above the existing. */
  readonly fill: Quantity<"volume">;
  /** Fill minus cut. Positive is net fill (haul in); negative is net cut (haul off). */
  readonly net: Quantity<"volume">;
  /** Plan area both surfaces cover. */
  readonly overlapArea: Quantity<"area">;
  readonly existingArea: Quantity<"area">;
  readonly proposedArea: Quantity<"area">;
  /** Overlay triangles that contributed volume. */
  readonly facetCount: number;
  readonly issues: readonly string[];
}

const AREA_EPS_M2 = 1e-8;
const HEIGHT_EPS_M = 1e-9;

function meshOf(surface: GradingSurface): MeshPoint[] {
  return surface.points.map((p) => ({ x: to(p.easting, "m"), y: to(p.northing, "m"), z: to(p.elevation, "m") }));
}

function spanOf(points: readonly PlanPoint[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return 1;
  return Math.max(maxX - minX, maxY - minY, 1);
}

function triArea(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5;
}

function orient(t: Tri): Tri {
  const signed = (t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y);
  return signed < 0 ? { a: t.a, b: t.c, c: t.b } : t;
}

function elevationAt(p: PlanPoint, t: Tri): number {
  const { a, b, c } = t;
  const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (den === 0) return a.z;
  const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den;
  const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den;
  const w = 1 - u - v;
  return u * a.z + v * b.z + w * c.z;
}

function leftOf(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function segmentIntersect(s: PlanPoint, e: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const dx1 = e.x - s.x;
  const dy1 = e.y - s.y;
  const dx2 = b.x - a.x;
  const dy2 = b.y - a.y;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-18) return e;
  const t = ((a.x - s.x) * dy2 - (a.y - s.y) * dx2) / den;
  const u = Math.min(1, Math.max(0, t));
  return { x: s.x + u * dx1, y: s.y + u * dy1 };
}

/** Sutherland–Hodgman: `subject` clipped to the CCW triangle `clip`. */
function clipTriangle(subject: Tri, clip: Tri, sideEps: number, lenEps: number): PlanPoint[] {
  let poly: PlanPoint[] = [subject.a, subject.b, subject.c];
  const edges: readonly PlanPoint[] = [clip.a, clip.b, clip.c];
  for (let i = 0; i < 3; i++) {
    const a = edges[i]!;
    const b = edges[(i + 1) % 3]!;
    const next: PlanPoint[] = [];
    for (let j = 0; j < poly.length; j++) {
      const s = poly[j]!;
      const e = poly[(j + 1) % poly.length]!;
      const sIn = leftOf(s, a, b) >= -sideEps;
      const eIn = leftOf(e, a, b) >= -sideEps;
      if (eIn) {
        if (!sIn) next.push(segmentIntersect(s, e, a, b));
        next.push(e);
      } else if (sIn) next.push(segmentIntersect(s, e, a, b));
    }
    poly = next;
    if (poly.length === 0) return [];
  }
  const cleaned: PlanPoint[] = [];
  for (const p of poly) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) <= lenEps) continue;
    cleaned.push(p);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0]!;
    const last = cleaned[cleaned.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= lenEps) cleaned.pop();
  }
  return cleaned;
}

function prism(a: PlanPoint, b: PlanPoint, c: PlanPoint, ha: number, hb: number, hc: number, totals: Totals): void {
  const area = triArea(a, b, c);
  if (area <= AREA_EPS_M2) return;
  const vol = (area * (ha + hb + hc)) / 3;
  if (vol > 0) totals.fill += vol;
  else totals.cut += -vol;
  totals.overlap += area;
  totals.facets += 1;
}

function lerpZero(p: PlanPoint, hp: number, q: PlanPoint, hq: number): PlanPoint {
  const t = hp / (hp - hq);
  return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
}

function splitSigned(verts: readonly PlanPoint[], h: readonly [number, number, number], totals: Totals): void {
  const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const signs = h.map(sign);
  const zeroAt = signs.findIndex((s) => s === 0);
  if (zeroAt >= 0) {
    const i = zeroAt;
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    if (signs[j] === 0 || signs[k] === 0 || signs[j] === signs[k]) {
      prism(verts[0]!, verts[1]!, verts[2]!, h[0], h[1], h[2], totals);
      return;
    }
    const c = lerpZero(verts[j]!, h[j]!, verts[k]!, h[k]!);
    prism(verts[i]!, verts[j]!, c, 0, h[j]!, 0, totals);
    prism(verts[i]!, c, verts[k]!, 0, 0, h[k]!, totals);
    return;
  }
  const unique = signs[0] !== signs[1] && signs[0] !== signs[2] ? 0 : signs[1] !== signs[0] && signs[1] !== signs[2] ? 1 : 2;
  const n = (unique + 1) % 3;
  const p = (unique + 2) % 3;
  const cN = lerpZero(verts[unique]!, h[unique]!, verts[n]!, h[n]!);
  const cP = lerpZero(verts[unique]!, h[unique]!, verts[p]!, h[p]!);
  prism(verts[unique]!, cN, cP, h[unique]!, 0, 0, totals);
  prism(cN, verts[n]!, verts[p]!, 0, h[n]!, h[p]!, totals);
  prism(cN, verts[p]!, cP, 0, h[p]!, 0, totals);
}

function addVolume(a: PlanPoint, b: PlanPoint, c: PlanPoint, ha: number, hb: number, hc: number, totals: Totals): void {
  if (triArea(a, b, c) <= AREA_EPS_M2) return;
  const h: [number, number, number] = [Math.abs(ha) <= HEIGHT_EPS_M ? 0 : ha, Math.abs(hb) <= HEIGHT_EPS_M ? 0 : hb, Math.abs(hc) <= HEIGHT_EPS_M ? 0 : hc];
  const pos = h.filter((v) => v > 0).length;
  const neg = h.filter((v) => v < 0).length;
  if (pos === 0 && neg === 0) {
    const area = triArea(a, b, c);
    totals.overlap += area;
    totals.facets += 1;
    return;
  }
  if (neg === 0 || pos === 0) {
    prism(a, b, c, h[0], h[1], h[2], totals);
    return;
  }
  splitSigned([a, b, c], h, totals);
}

function trianglesOf(points: readonly MeshPoint[], faces: readonly TinFace[], name: string, issues: string[]): { tris: Tri[]; area: number } {
  const tris: Tri[] = [];
  let area = 0;
  let skipped = 0;
  let bad = 0;
  for (const face of faces) {
    const a = points[face.a];
    const b = points[face.b];
    const c = points[face.c];
    if (!a || !b || !c) {
      bad += 1;
      continue;
    }
    const areaM2 = triArea(a, b, c);
    if (areaM2 <= AREA_EPS_M2) {
      skipped += 1;
      continue;
    }
    area += areaM2;
    tris.push(orient({ a, b, c }));
  }
  if (bad > 0) issues.push(`${name} has ${bad} ${bad === 1 ? "triangle that names" : "triangles that name"} a missing point. ${bad === 1 ? "It was" : "They were"} left out.`);
  if (skipped > 0) issues.push(`${name} has ${skipped} ${skipped === 1 ? "triangle" : "triangles"} with no plan area (vertical, or a repeated corner). ${skipped === 1 ? "It adds" : "They add"} no volume.`);
  return { tris, area };
}

function volume(m3: number): Quantity<"volume"> {
  return qty("volume", m3, "m3");
}

function area(m2: number): Quantity<"area"> {
  return qty("area", m2, "m2");
}

/**
 * Cut, fill and net between `existing` and `proposed`, on the plan ground
 * both cover. Net is fill minus cut.
 */
export function cutFillBetween(existing: GradingSurface, proposed: GradingSurface): CutFillResult {
  const issues: string[] = [];
  const exPts = meshOf(existing);
  const prPts = meshOf(proposed);
  const ex = trianglesOf(exPts, existing.faces, existing.name, issues);
  const pr = trianglesOf(prPts, proposed.faces, proposed.name, issues);
  const totals: Totals = { cut: 0, fill: 0, overlap: 0, facets: 0 };
  if (ex.tris.length === 0 || pr.tris.length === 0) {
    if (ex.tris.length === 0) issues.push(`${existing.name} has no plan area, so there is nothing to compare.`);
    if (pr.tris.length === 0) issues.push(`${proposed.name} has no plan area, so there is nothing to compare.`);
  } else {
    const span = spanOf([...exPts, ...prPts]);
    const lenEps = span * 1e-10;
    const sideEps = lenEps * span;
    for (const a of ex.tris) {
      for (const b of pr.tris) {
        const poly = clipTriangle(a, b, sideEps, lenEps);
        if (poly.length < 3) continue;
        for (let i = 1; i < poly.length - 1; i++) {
          const p = poly[0]!;
          const q = poly[i]!;
          const r = poly[i + 1]!;
          const dz = (at: PlanPoint): number => elevationAt(at, b) - elevationAt(at, a);
          addVolume(p, q, r, dz(p), dz(q), dz(r), totals);
        }
      }
    }
    if (totals.overlap <= AREA_EPS_M2 && ex.area > AREA_EPS_M2 && pr.area > AREA_EPS_M2) {
      issues.push(`${existing.name} and ${proposed.name} don't overlap in plan, so the cut and fill are zero. Check that both TINs cover the same ground.`);
    }
  }
  const cut = volume(totals.cut);
  const fill = volume(totals.fill);
  return {
    cut,
    fill,
    net: subtract(fill, cut),
    overlapArea: area(totals.overlap),
    existingArea: area(ex.area),
    proposedArea: area(pr.area),
    facetCount: totals.facets,
    issues,
  };
}
