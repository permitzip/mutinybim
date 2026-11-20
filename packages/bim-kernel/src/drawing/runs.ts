import { add, perp, scale, sub, unit } from "../geometry";
import { localBounds, partToWorld, type ResolvedSymbol } from "../parts";
import { placedGeometry, placedSymbol } from "../part-placed";
import { flexPlanLines } from "../routing/flex";
import { FaceIndex, cellFor, planProjector, projectSolid, splitHidden } from "./projection";
import { elementSolid } from "./solids";
import { fittingBody, segmentWidthAxis, straightPiece, type Ring } from "../routing/fittings/geometry";
import { sizeLabel, sizeWidth } from "../routing/rules";
import type { BimElement, ModelState, PartInstance, RunFitting, RunSegment, Vec2 } from "../types";
import type { Pen } from "./sheet";
import { drawInsulationPlan } from "./insulation";
import { styleOfSystemId } from "../routing/system-graphics";
import { partClearances } from "../spatial";
import { elementSymbolId, runViewCategory } from "../categories/element";
import { symbolById } from "../categories/symbol-registry";
import { planDisplayFor } from "../categories/symbols";
import type { DetailLevel } from "../part-model/schema";
import { isPartModel2 } from "../part-model/schema-2";
import { partSymbolLines } from "../part-model/symbols";

/**
 * Plan linework for routed runs and placed parts. Duct draws double-line at
 * its width; pipe and conduit draw single-line, with the system's line type.
 * Vertical pieces (drops and rises) draw as their cross-section with a
 * diagonal. Fittings close the linework where pieces meet.
 */

export type LineFn = (a: Vec2, b: Vec2, pen: Pen, dash?: number[]) => void;
export type TextFn = (at: Vec2, text: string, size: number) => void;
export type FillFn = (points: readonly Vec2[], grey: number) => void;

/** A 2D axis-aligned box in model millimetres, used to keep plan labels clear of symbols and each other. */
export interface PartLabelBox {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** One boundary piece of a placed part's plan representation, in model millimetres. */
export type PlanOutline =
  | { readonly kind: "seg"; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: "circle"; readonly c: Vec2; readonly r: number };

export interface DrawPartSymbolOptions {
  /** View scale (model mm per paper mm). Used to size paper-space symbols and smart label offsets. Default 48. */
  readonly scale?: number;
  /** Whether to draw the part's own mark when it is not separately tagged. Default true. */
  readonly showMark?: boolean;
  /** Optional filled-polygon callback for solid fills (`grey = 0`) and opaque white masks (`grey = 1`). */
  readonly fill?: FillFn;
  /** Shared collision boxes in model mm so adjacent symbols, marks and clearance notes stay clear of each other. */
  readonly takenBoxes?: PartLabelBox[];
}

const plan = (p: { x: number; y: number }): Vec2 => ({ x: p.x, y: p.y });

/** The system's line pattern and weight (system-graphics.ts): vent dashed, cold water dash-dot, gas long dash, or the system's own. */
export function systemLine(model: ModelState, systemId: string): { readonly dash: number[] | undefined; readonly weight: Pen | undefined } {
  const style = styleOfSystemId(model.elements, systemId);
  return { dash: style?.dash ? [...style.dash] : undefined, weight: style?.weight };
}

function circle(center: Vec2, r: number, line: LineFn, pen: Pen): void {
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    line({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) }, { x: center.x + r * Math.cos(b), y: center.y + r * Math.sin(b) }, pen);
  }
}

function vertical(seg: RunSegment): boolean {
  return Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y) < 0.01;
}

export function drawRunSegment(model: ModelState, seg: RunSegment, line: LineFn, label: TextFn | null, scaleMmPerPaperMm: number): void {
  const w = sizeWidth(seg.size);
  const { dash, weight } = systemLine(model, seg.systemId);
  const a = plan(seg.start);
  const b = plan(seg.end);
  if (seg.flex) {
    // Flex: both edges along its curve with ticks across, labelled as flex.
    for (const [p, q, what] of flexPlanLines(seg)) line(p, q, what === "edge" ? "medium" : "thin");
    const mid = seg.flex.path[Math.floor(seg.flex.path.length / 2)] ?? seg.start;
    if (label) label(add(plan(mid), { x: 0, y: sizeWidth(seg.size) / 2 + 6 * scaleMmPerPaperMm }), `${sizeLabel(seg.size)} FLEX`, 2.5);
    return;
  }
  drawInsulationPlan(model, seg, line);
  if (vertical(seg)) {
    // A drop or rise, seen from above.
    const h = Math.max(w, 50) / 2;
    if (seg.domain === "duct" && seg.size.shape === "rect") {
      // Turned the way the elbows into it turn it.
      const wa = segmentWidthAxis(model.elements, seg);
      const ha = { x: -wa.y, y: wa.x };
      const hy = seg.size.height / 2;
      const at = (sw: number, sh: number) => add(a, { x: wa.x * sw * h + ha.x * sh * hy, y: wa.y * sw * h + ha.y * sh * hy });
      const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
      for (let i = 0; i < 4; i++) line(corners[i] ?? a, corners[(i + 1) % 4] ?? a, "medium");
      line(corners[0] ?? a, corners[2] ?? a, "thin");
    } else {
      circle(a, h, line, seg.domain === "duct" ? "medium" : (weight ?? "wide"));
    }
    return;
  }
  // Library fittings take real length: the straight duct stops where their bodies begin.
  const fromLibrary = [seg.links.start, seg.links.end].some((l) => {
    const f = l ? model.elements[l.elementId] : undefined;
    return f?.kind === "run_fitting" && f.family !== undefined;
  });
  const piece = seg.domain === "duct" && fromLibrary ? straightPiece(model.elements, seg) : null;
  const u = unit(sub(b, a));
  const n = perp(u);
  if (piece) {
    // Fittings meeting end to end leave no straight duct to draw.
    if (piece.lengthMm > 0) {
      const pa = plan(piece.start);
      const pb = plan(piece.end);
      line(add(pa, scale(n, w / 2)), add(pb, scale(n, w / 2)), weight ?? "medium", dash);
      line(add(pa, scale(n, -w / 2)), add(pb, scale(n, -w / 2)), weight ?? "medium", dash);
      if (!seg.links.start) line(add(pa, scale(n, w / 2)), add(pa, scale(n, -w / 2)), "medium");
      if (!seg.links.end) line(add(pb, scale(n, w / 2)), add(pb, scale(n, -w / 2)), "medium");
    }
  } else if (seg.domain === "duct") {
    line(add(a, scale(n, w / 2)), add(b, scale(n, w / 2)), weight ?? "medium", dash);
    line(add(a, scale(n, -w / 2)), add(b, scale(n, -w / 2)), weight ?? "medium", dash);
    // An open end shows as its end line.
    if (!seg.links.start) line(add(a, scale(n, w / 2)), add(a, scale(n, -w / 2)), "medium");
    if (!seg.links.end) line(add(b, scale(n, w / 2)), add(b, scale(n, -w / 2)), "medium");
  } else {
    line(a, b, weight ?? "wide", dash);
  }
  const run = Math.hypot(b.x - a.x, b.y - a.y);
  if (label && run / scaleMmPerPaperMm > 25) {
    const at = add(scale(add(a, b), 0.5), scale(n, (seg.domain === "duct" ? w / 2 : 0) + 6 * scaleMmPerPaperMm));
    label(at, sizeLabel(seg.size), 2.5);
  }
}

/** A library fitting's outline in plan: both sides of every tube, joint lines, and (fine detail) turning vanes. */
function drawBody(model: ModelState, f: RunFitting, line: LineFn, vanes: boolean): boolean {
  const body = fittingBody(model.elements, f);
  if (body.tubes.length === 0 && body.plates.length === 0) return false;
  const side = (r: Ring, k: 1 | -1): Vec2 => {
    // The horizontal half-axis is what shows in plan.
    const h = Math.abs(r.a.z) <= Math.abs(r.b.z) ? r.a : r.b;
    return { x: r.center.x + k * h.x, y: r.center.y + k * h.y };
  };
  for (const tube of body.tubes) {
    for (let i = 0; i + 1 < tube.rings.length; i++) {
      const r0 = tube.rings[i];
      const r1 = tube.rings[i + 1];
      if (!r0 || !r1) continue;
      line(side(r0, 1), side(r1, 1), "medium");
      line(side(r0, -1), side(r1, -1), "medium");
    }
    const first = tube.rings[0];
    const last = tube.rings[tube.rings.length - 1];
    for (const r of first && last ? [first, last] : []) line(side(r, 1), side(r, -1), "thin");
  }
  for (const plate of vanes ? body.plates : []) {
    if (plate.kind !== "sheet") continue;
    for (let i = 0; i + 1 < plate.points.length; i++) {
      const q0 = plate.points[i];
      const q1 = plate.points[i + 1];
      if (q0 && q1) line(plan(q0), plan(q1), "thin");
    }
  }
  return true;
}

export function drawRunFitting(model: ModelState, f: RunFitting, line: LineFn, vanes = true): void {
  drawInsulationPlan(model, f, line);
  if (f.domain === "duct" && f.family !== undefined && drawBody(model, f, line, vanes)) return;
  const p = plan(f.position);
  const [pa, pb] = f.ports;
  const flat = (d: { z: number }) => Math.abs(d.z) < 1e-6;
  const isDuct = f.domain === "duct";
  switch (f.fittingType) {
    case "elbow": {
      if (!pa || !pb) return;
      const w = sizeWidth(pa.size) / 2;
      if (flat(pa.direction) && flat(pb.direction) && isDuct) {
        const la = perp(unit(plan(pa.direction)));
        const lb = perp(unit(plan(pb.direction)));
        const inner = add(p, sub(scale(la, w), scale(lb, w)));
        const outer = add(p, sub(scale(lb, w), scale(la, w)));
        line(add(p, scale(la, w)), inner, "medium");
        line(inner, add(p, scale(lb, -w)), "medium");
        line(add(p, scale(la, -w)), outer, "medium");
        line(outer, add(p, scale(lb, w)), "medium");
      }
      return;
    }
    case "transition": {
      if (!pa || !pb || !flat(pa.direction)) return;
      const n = perp(unit(plan(pa.direction)));
      const w = Math.max(sizeWidth(pa.size), sizeWidth(pb.size)) / 2;
      line(add(p, scale(n, w)), add(p, scale(n, -w)), isDuct ? "medium" : "wide");
      return;
    }
    case "cap": {
      if (!pa || !flat(pa.direction)) return;
      const n = perp(unit(plan(pa.direction)));
      const w = isDuct ? sizeWidth(pa.size) / 2 : Math.max(sizeWidth(pa.size), 60);
      line(add(p, scale(n, w)), add(p, scale(n, -w)), "wide");
      return;
    }
    case "tap":
    case "tee":
    case "wye": {
      if (!pa) return;
      const at = plan(pa.position);
      const d = unit(plan(pa.direction));
      const n = perp(d);
      const w = sizeWidth(pa.size) / 2;
      if (isDuct) {
        line(add(at, scale(n, w)), add(at, scale(n, -w)), "thin");
      } else if (f.fittingType === "wye") {
        line(at, add(at, scale(add(d, n), Math.max(w * 2, 60))), "thin");
      } else {
        circle(at, Math.max(w, 25), line, "thin");
      }
      return;
    }
    case "offset": {
      if (!pa || !pb || !flat(pa.direction)) return;
      const n = perp(unit(plan(pb.direction)));
      const w = sizeWidth(pa.size) / 2;
      line(add(plan(pa.position), scale(n, w)), add(plan(pb.position), scale(n, w)), "medium");
      line(add(plan(pa.position), scale(n, -w)), add(plan(pb.position), scale(n, -w)), "medium");
      return;
    }
  }
}

/** A modeled part seen from above: its sharp and outline edges, with the ones it hides itself left out. */
function drawPartModelPlan(model: ModelState, part: PartInstance, line: LineFn): void {
  const solid = elementSolid(model, part, 0);
  if (!solid?.mesh) return;
  const projected = projectSolid(solid, planProjector(false));
  if (projected.faces.length === 0) return;
  const xs = projected.faces.flatMap((f) => [f.minU, f.maxU]);
  const ys = projected.faces.flatMap((f) => [f.minV, f.maxV]);
  const index = new FaceIndex(cellFor(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
  for (const f of projected.faces) index.add(f);
  for (const e of projected.edges) {
    for (const [a, b] of splitHidden(e.a, e.b, index).visible) line({ x: a.u, y: a.v }, { x: b.u, y: b.v }, "medium");
  }
}

const DEFAULT_SYMBOL_SCALE = 48;
const MARK_SIZE_MM = 2.5;
const CLEARANCE_TEXT_MM = 1.8;

function circlePolygon(center: Vec2, r: number, steps = 20): Vec2[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
  });
}

function arcPolyline(center: Vec2, r: number, startDeg: number, sweepDeg: number): Vec2[] {
  const steps = Math.max(2, Math.min(32, Math.ceil(Math.abs(sweepDeg) / 15)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((startDeg + (sweepDeg * i) / steps) * Math.PI) / 180;
    return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
  });
}

function scaleLocalSymbol(s: ResolvedSymbol, viewScale: number): ResolvedSymbol {
  if (s.units !== "paper") return s;
  const k = viewScale;
  const sc = (p: Vec2): Vec2 => ({ x: p.x * k, y: p.y * k });
  switch (s.kind) {
    case "rect":
      return { ...s, center: sc(s.center), size: sc(s.size) };
    case "circle":
      return { ...s, center: sc(s.center), radius: s.radius * k };
    case "arc":
      return { ...s, center: sc(s.center), radius: s.radius * k };
    case "line":
      return { ...s, from: sc(s.from), to: sc(s.to) };
    case "polyline":
      return { ...s, points: s.points.map(sc) };
    case "text":
      return { ...s, at: sc(s.at) };
  }
}

function resolvePartPlan(
  model: ModelState,
  part: PartInstance,
  planSymbol: boolean | null,
  detail: DetailLevel,
  viewScale: number,
): { readonly symbols: ResolvedSymbol[]; readonly planDisplay: "symbol" | "model" | "both"; readonly modelCorners: Vec2[] | null } | null {
  if (part.planned !== undefined) return null;
  const type = model.elements[part.typeId];
  if (type?.kind !== "part_type") return null;
  const classSymbolId = elementSymbolId(model.elements, part);
  const classSymbol = classSymbolId === null ? null : symbolById(classSymbolId);
  const solidProgram = type.definition.model !== undefined && isPartModel2(type.definition.model);
  const levelSymbol = !classSymbol && solidProgram ? partSymbolLines(type.definition, part.values, "plan", detail) : null;
  const symbolSource = classSymbol ? [...classSymbol.primitives] : levelSymbol;
  const rawSymbols = placedSymbol(symbolSource ? { ...type, definition: { ...type.definition, symbol: symbolSource } } : type, part);
  const filtered = rawSymbols.filter((s) => !s.detailLevels || s.detailLevels.includes(detail));
  const ownSymbols = (filtered.length > 0 ? filtered : rawSymbols).map((s) => scaleLocalSymbol(s, viewScale));
  const typeDisplay = solidProgram && !classSymbol && levelSymbol === null ? "model" : type.definition.model?.planDisplay;
  const planDisplay = planDisplayFor(planSymbol, { typeDisplay, hasSymbol: ownSymbols.length > 0, hasBody: type.definition.model !== undefined });
  const symbols = planDisplay === "model" ? [] : ownSymbols;
  let modelCorners: Vec2[] | null = null;
  if (planDisplay === "model" || planDisplay === "both" || symbols.length === 0) {
    const geom = placedGeometry(type, part);
    if (geom.length > 0) {
      const b = localBounds(geom);
      if (Number.isFinite(b.min[0]) && Number.isFinite(b.max[0])) {
        const w = (q: Vec2) => partToWorld(part, q);
        modelCorners = [
          w({ x: b.min[0], y: b.min[1] }),
          w({ x: b.max[0], y: b.min[1] }),
          w({ x: b.max[0], y: b.max[1] }),
          w({ x: b.min[0], y: b.max[1] }),
        ];
      }
    }
  }
  return { symbols, planDisplay, modelCorners };
}

function growBox(box: { minX: number; minY: number; maxX: number; maxY: number }, p: Vec2): void {
  if (p.x < box.minX) box.minX = p.x;
  if (p.y < box.minY) box.minY = p.y;
  if (p.x > box.maxX) box.maxX = p.x;
  if (p.y > box.maxY) box.maxY = p.y;
}

function boxesOverlap(a: PartLabelBox, b: PartLabelBox): boolean {
  return a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y;
}

function worldTextBox(at: Vec2, text: string, sizeMm: number, viewScale: number): PartLabelBox {
  const h = sizeMm * viewScale;
  const w = Math.max(h * 0.75, text.length * sizeMm * 0.74 * viewScale);
  const padX = 1.2 * viewScale;
  const padY = 0.55 * viewScale;
  return {
    min: { x: at.x - w / 2 - padX, y: at.y - h / 2 - padY },
    max: { x: at.x + w / 2 + padX, y: at.y + h / 2 + padY },
  };
}

/**
 * The exact plan boundary (world-mm segments and circles) and bounding box of
 * what a plan draws for `part` at `detail` and `scale`. Shared by symbol
 * drawing, view-graphics line trimming, and label/tag collision avoidance.
 */
export function partPlanOutline(
  model: ModelState,
  part: PartInstance,
  opts: { readonly detail?: DetailLevel; readonly scale?: number; readonly planSymbol?: boolean | null } = {},
): { readonly outline: PlanOutline[]; readonly bounds: PartLabelBox | null } {
  const viewScale = opts.scale ?? DEFAULT_SYMBOL_SCALE;
  const resolved = resolvePartPlan(model, part, opts.planSymbol ?? null, opts.detail ?? "medium", viewScale);
  if (!resolved) return { outline: [], bounds: null };
  const w = (q: Vec2) => partToWorld(part, q);
  const outline: PlanOutline[] = [];
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const addRect = (c: Vec2, hx: number, hy: number) => {
    const corners = [w({ x: c.x - hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y + hy }), w({ x: c.x - hx, y: c.y + hy })];
    for (let i = 0; i < 4; i++) {
      const a = corners[i] ?? c;
      const b = corners[(i + 1) % 4] ?? c;
      outline.push({ kind: "seg", a, b });
      growBox(bb, a);
    }
  };
  for (const s of resolved.symbols) {
    switch (s.kind) {
      case "rect":
        addRect(s.center, s.size.x / 2, s.size.y / 2);
        break;
      case "circle": {
        const c = w(s.center);
        outline.push({ kind: "circle", c, r: s.radius });
        growBox(bb, { x: c.x - s.radius, y: c.y - s.radius });
        growBox(bb, { x: c.x + s.radius, y: c.y + s.radius });
        break;
      }
      case "arc": {
        const pts = arcPolyline(s.center, s.radius, s.startDeg, s.sweepDeg).map(w);
        for (let i = 0; i + 1 < pts.length; i++) {
          outline.push({ kind: "seg", a: pts[i]!, b: pts[i + 1]! });
          growBox(bb, pts[i]!);
          growBox(bb, pts[i + 1]!);
        }
        break;
      }
      case "line": {
        const a = w(s.from);
        const b = w(s.to);
        outline.push({ kind: "seg", a, b });
        growBox(bb, a);
        growBox(bb, b);
        break;
      }
      case "polyline": {
        const pts = s.points.map(w);
        for (let i = 0; i + 1 < pts.length; i++) {
          outline.push({ kind: "seg", a: pts[i]!, b: pts[i + 1]! });
          growBox(bb, pts[i]!);
          growBox(bb, pts[i + 1]!);
        }
        if (s.closed && pts.length > 2) outline.push({ kind: "seg", a: pts[pts.length - 1]!, b: pts[0]! });
        break;
      }
      case "text": {
        // Text primitives are labels, not hard symbol geometry; include only when no geometric outline exists.
        break;
      }
    }
  }
  if (resolved.modelCorners && (resolved.planDisplay === "model" || resolved.planDisplay === "both" || outline.length === 0)) {
    const k = resolved.modelCorners;
    for (let i = 0; i < 4; i++) {
      const a = k[i]!;
      const b = k[(i + 1) % 4]!;
      outline.push({ kind: "seg", a, b });
      growBox(bb, a);
    }
  }
  if (outline.length === 0) {
    for (const s of resolved.symbols) {
      if (s.kind !== "text") continue;
      const half = 0.6 * (s.units === "paper" ? s.heightMm : 2) * viewScale;
      addRect(s.at, half, half);
    }
  }
  const bounds: PartLabelBox | null = Number.isFinite(bb.minX) ? { min: { x: bb.minX, y: bb.minY }, max: { x: bb.maxX, y: bb.maxY } } : null;
  return { outline, bounds };
}

/** Pick a collision-free world-mm position for a part's default mark outside its symbol bounds. */
function placePartMark(
  part: PartInstance,
  mark: string,
  bounds: PartLabelBox | null,
  viewScale: number,
  taken: PartLabelBox[] | undefined,
  hasCenterText: boolean,
): Vec2 {
  const textH = MARK_SIZE_MM * viewScale;
  const textW = Math.max(textH * 0.75, mark.length * MARK_SIZE_MM * 0.72 * viewScale);
  const gap = 1.8 * viewScale;
  const box = bounds ?? { min: { x: part.position.x - 1.5 * viewScale, y: part.position.y - 1.5 * viewScale }, max: { x: part.position.x + 1.5 * viewScale, y: part.position.y + 1.5 * viewScale } };
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const bw = box.max.x - box.min.x;
  const bh = box.max.y - box.min.y;
  // Large equipment/fixtures with empty interior (e.g. wide boxes) can keep their mark centered when clear.
  const canCenter = !hasCenterText && bw >= textW * 1.6 && bh >= textH * 2.2;
  const candidates: Vec2[] = [];
  if (canCenter) candidates.push({ x: cx, y: cy });
  // Prefer the room-facing side (+Y in part local coordinates) first so wall-mounted devices never stamp marks onto their host wall.
  const normal = sub(partToWorld(part, { x: 0, y: 1 }), part.position);
  const nLen = Math.hypot(normal.x, normal.y) || 1;
  const nx = normal.x / nLen;
  const ny = normal.y / nLen;
  for (const ring of [1, 2.1, 3.2]) {
    const dx = textW / 2 + gap * ring;
    const dy = textH / 2 + gap * ring;
    const roomSide: Vec2 = {
      x: cx + nx * (bw / 2 + dx) + (Math.abs(nx) < 0.2 ? 0 : 0),
      y: cy + ny * (bh / 2 + dy),
    };
    const roomDiagR: Vec2 = {
      x: roomSide.x + (Math.abs(ny) > 0.5 ? dx * 0.7 : 0),
      y: roomSide.y + (Math.abs(nx) > 0.5 ? dy * 0.8 : 0),
    };
    const roomDiagL: Vec2 = {
      x: roomSide.x - (Math.abs(ny) > 0.5 ? dx * 0.7 : 0),
      y: roomSide.y - (Math.abs(nx) > 0.5 ? dy * 0.8 : 0),
    };
    candidates.push(
      roomSide,
      roomDiagR,
      roomDiagL,
      { x: box.max.x + dx * 0.85, y: box.max.y + dy * 0.75 }, // top-right
      { x: cx, y: box.max.y + dy }, // top
      { x: box.max.x + dx, y: cy }, // right
      { x: cx, y: box.min.y - dy }, // bottom
      { x: box.min.x - dx, y: cy }, // left
      { x: box.max.x + dx * 0.85, y: box.min.y - dy * 0.75 }, // bottom-right
      { x: box.min.x - dx * 0.85, y: box.max.y + dy * 0.75 }, // top-left
      { x: box.min.x - dx * 0.85, y: box.min.y - dy * 0.75 }, // bottom-left
    );
  }
  if (!taken) return candidates[0] ?? part.position;
  for (const at of candidates) {
    const tb = worldTextBox(at, mark, MARK_SIZE_MM, viewScale);
    if (!taken.some((t) => boxesOverlap(tb, t))) {
      taken.push(tb);
      return at;
    }
  }
  const fallback = candidates[0] ?? part.position;
  taken.push(worldTextBox(fallback, mark, MARK_SIZE_MM, viewScale));
  return fallback;
}

/**
 * A placed part in a plan: its plan symbol, its 3D body seen from above, or
 * both, as its type says unless the view's category says symbol or body
 * (`planSymbol`, from `categories/resolve.ts`; null keeps the type's).
 */
export function drawPartSymbol(
  model: ModelState,
  part: PartInstance,
  line: LineFn,
  text: TextFn,
  planSymbol: boolean | null = null,
  detail: DetailLevel = "medium",
  opts: DrawPartSymbolOptions = {},
): void {
  const viewScale = opts.scale ?? DEFAULT_SYMBOL_SCALE;
  const resolved = resolvePartPlan(model, part, planSymbol, detail, viewScale);
  if (!resolved) return;
  const w = (q: Vec2) => partToWorld(part, q);
  if (resolved.planDisplay === "model" || resolved.planDisplay === "both") drawPartModelPlan(model, part, line);
  const symbols = resolved.symbols;
  const fill = opts.fill;
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let hasCenterText = false;

  // Pass 1: opaque white masks first so background linework and under-parts runs never bleed through.
  if (fill) {
    for (const s of symbols) {
      if (s.kind === "rect" && s.fill === "mask") {
        const hx = s.size.x / 2;
        const hy = s.size.y / 2;
        const c = s.center;
        fill([w({ x: c.x - hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y + hy }), w({ x: c.x - hx, y: c.y + hy })], 1);
      } else if (s.kind === "circle" && s.fill === "mask") {
        fill(circlePolygon(w(s.center), s.radius), 1);
      } else if (s.kind === "polyline" && s.closed && s.fill === "mask" && s.points.length >= 3) {
        fill(s.points.map(w), 1);
      }
    }
    // Pass 2: solid black fills (half-filled indicators, shaded fixtures).
    for (const s of symbols) {
      if (s.kind === "rect" && s.fill === "solid") {
        const hx = s.size.x / 2;
        const hy = s.size.y / 2;
        const c = s.center;
        fill([w({ x: c.x - hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y + hy }), w({ x: c.x - hx, y: c.y + hy })], 0);
      } else if (s.kind === "circle" && s.fill === "solid") {
        fill(circlePolygon(w(s.center), s.radius), 0);
      } else if (s.kind === "polyline" && s.closed && s.fill === "solid" && s.points.length >= 3) {
        fill(s.points.map(w), 0);
      }
    }
  }

  // Pass 3: symbol strokes and embedded text.
  for (const s of symbols) {
    switch (s.kind) {
      case "rect": {
        const hx = s.size.x / 2;
        const hy = s.size.y / 2;
        const c = s.center;
        const pen = s.pen ?? "medium";
        const corners = [w({ x: c.x - hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y - hy }), w({ x: c.x + hx, y: c.y + hy }), w({ x: c.x - hx, y: c.y + hy })];
        for (let i = 0; i < 4; i++) {
          const a = corners[i] ?? c;
          const b = corners[(i + 1) % 4] ?? c;
          line(a, b, pen);
          growBox(bb, a);
        }
        break;
      }
      case "circle": {
        const c = w(s.center);
        circle(c, s.radius, line, s.pen ?? "medium");
        growBox(bb, { x: c.x - s.radius, y: c.y - s.radius });
        growBox(bb, { x: c.x + s.radius, y: c.y + s.radius });
        break;
      }
      case "arc": {
        const pts = arcPolyline(s.center, s.radius, s.startDeg, s.sweepDeg).map(w);
        const pen = s.pen ?? "medium";
        for (let i = 0; i + 1 < pts.length; i++) {
          line(pts[i]!, pts[i + 1]!, pen);
          growBox(bb, pts[i]!);
          growBox(bb, pts[i + 1]!);
        }
        break;
      }
      case "line": {
        let a: Vec2;
        let b: Vec2;
        if (s.upright) {
          const mid = w({ x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 });
          const hx = (s.to.x - s.from.x) / 2;
          const hy = (s.to.y - s.from.y) / 2;
          a = { x: mid.x - hx, y: mid.y - hy };
          b = { x: mid.x + hx, y: mid.y + hy };
        } else {
          a = w(s.from);
          b = w(s.to);
        }
        line(a, b, s.pen ?? "thin");
        growBox(bb, a);
        growBox(bb, b);
        break;
      }
      case "polyline": {
        const pts = s.points.map(w);
        const pen = s.pen ?? "medium";
        for (let i = 0; i + 1 < pts.length; i++) {
          line(pts[i]!, pts[i + 1]!, pen);
          growBox(bb, pts[i]!);
          growBox(bb, pts[i + 1]!);
        }
        if (s.closed && pts.length > 2) line(pts[pts.length - 1]!, pts[0]!, pen);
        break;
      }
      case "text": {
        const baseAt = w(s.at);
        const uScale = s.units === "paper" ? viewScale : 1;
        const rawAt = s.uprightOffset ? { x: baseAt.x + s.uprightOffset[0] * uScale, y: baseAt.y + s.uprightOffset[1] * uScale } : baseAt;
        const sizeMm = s.units === "paper" ? s.heightMm : 2;
        // SVG/PDF text `y` is the baseline; shift down by 0.35em (negative world Y) so centered glyphs ("S", "J", "OS") sit dead-center.
        const at = { x: rawAt.x, y: rawAt.y - sizeMm * 0.35 * viewScale };
        text(at, s.text, sizeMm);
        const tb = worldTextBox(rawAt, s.text, sizeMm, viewScale);
        growBox(bb, tb.min);
        growBox(bb, tb.max);
        opts.takenBoxes?.push(tb);
        if (Math.hypot(s.at.x, s.at.y) < 1e-3) hasCenterText = true;
        break;
      }
    }
  }
  if (!Number.isFinite(bb.minX) && resolved.modelCorners) {
    for (const c of resolved.modelCorners) growBox(bb, c);
  }
  const symbolBox: PartLabelBox | null = Number.isFinite(bb.minX) ? { min: { x: bb.minX, y: bb.minY }, max: { x: bb.maxX, y: bb.maxY } } : null;
  if (symbolBox && opts.takenBoxes) opts.takenBoxes.push(symbolBox);
  if (part.mark && opts.showMark !== false) {
    const markAt = placePartMark(part, part.mark, symbolBox, viewScale, opts.takenBoxes, hasCenterText);
    // Center the mark vertically on markAt (SVG/PDF text y is baseline).
    text({ x: markAt.x, y: markAt.y - MARK_SIZE_MM * 0.35 * viewScale }, part.mark, MARK_SIZE_MM);
  }
  drawPartClearances(model, part, line, text, viewScale, opts.takenBoxes);
}

/** Clearance zones draw dashed (paper mm), never as part of the part's body. */
export const CLEARANCE_DASH: readonly number[] = [3, 1.5];

/** A placed part's clearance zones in plan: a dashed outline each, named cleanly away from the part mark. */
export function drawPartClearances(model: ModelState, part: PartInstance, line: LineFn, text: TextFn, viewScale = DEFAULT_SYMBOL_SCALE, takenBoxes?: PartLabelBox[]): void {
  for (const z of partClearances(model, part)) {
    const c = z.corners;
    for (let i = 0; i < 4; i++) line(c[i] ?? c[0], c[(i + 1) % 4] ?? c[0], "thin", [...CLEARANCE_DASH]);
    const label = z.name.toUpperCase();
    const mid: Vec2 = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
    // Push the clearance label toward the outer side of the zone (away from the part origin) if the center collides.
    const outDir = sub(mid, part.position);
    const outLen = Math.hypot(outDir.x, outDir.y);
    const candidates: Vec2[] = [mid];
    if (outLen > 1) {
      const u = scale(outDir, 1 / outLen);
      candidates.push(add(mid, scale(u, outLen * 0.45)), add(mid, scale(u, outLen * 0.85)));
    }
    let at = mid;
    if (takenBoxes) {
      const clear = candidates.find((p) => !takenBoxes.some((t) => boxesOverlap(worldTextBox(p, label, CLEARANCE_TEXT_MM, viewScale), t)));
      at = clear ?? candidates[candidates.length - 1] ?? mid;
      takenBoxes.push(worldTextBox(at, label, CLEARANCE_TEXT_MM, viewScale));
    }
    text(at, label, CLEARANCE_TEXT_MM);
  }
}

/** Drawing category of a routed element (views can hide duct and pipe separately). */
export function runCategory(el: BimElement): "duct" | "duct_fitting" | "pipe" | null {
  return runViewCategory(el);
}
