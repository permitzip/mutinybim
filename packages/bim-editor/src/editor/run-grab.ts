import { elementsOfKind, isPitchedOrLevel, type BimElement, type Command, type ModelState, type RunPoint, type RunSegment, type RunSize } from '@permitzip/bim-kernel'

/** What a press on a routed run grabs: a straight piece whole, one end of it, or an elbow's corner. */
export interface RunGrab {
  readonly id: string
  /** `segment`: moves whole; `corner`: an elbow, or a piece's end where an elbow is (moves freely); `end`: an open end (stretches). */
  readonly kind: 'segment' | 'corner' | 'end'
  readonly grip?: 'start' | 'end'
  /** Where the handle is drawn (model mm, z above the level floor). */
  readonly at: RunPoint
  /** The piece's direction, for snapping; null for a corner. */
  readonly axis: RunPoint | null
}

/** How close to an end (mm) still grabs the end: a fifth of the piece, at least 6", at most 2 ft, never more than a third. */
export function endZoneMm(lengthMm: number): number {
  return Math.min(Math.max(lengthMm * 0.2, 152.4), 609.6, lengthMm / 3)
}

/**
 * The grab for a press on `el` at `hit` (model mm, same frame as the run). The
 * middle of a straight piece moves it whole; near an end, that end moves (the
 * elbow there, so a small elbow is easy to grab); an elbow moves its corner.
 * Branch takeoffs and anything else: null (they slide or aren't runs).
 */
export function grabFor(elements: Readonly<Record<string, BimElement>>, el: BimElement | undefined, hit: RunPoint): RunGrab | null {
  if (!el) return null
  if (el.kind === 'run_fitting') return el.host ? null : { id: el.id, kind: 'corner', at: el.position, axis: null }
  if (el.kind !== 'run_segment') return null
  const d = { x: el.end.x - el.start.x, y: el.end.y - el.start.y, z: el.end.z - el.start.z }
  const len = Math.hypot(d.x, d.y, d.z)
  if (len < 1e-6) return null
  const axis = { x: d.x / len, y: d.y / len, z: d.z / len }
  const s = (hit.x - el.start.x) * axis.x + (hit.y - el.start.y) * axis.y + (hit.z - el.start.z) * axis.z
  const zone = endZoneMm(len)
  const grip = s <= zone ? 'start' : s >= len - zone ? 'end' : null
  if (!grip) return { id: el.id, kind: 'segment', at: { x: el.start.x + d.x / 2, y: el.start.y + d.y / 2, z: el.start.z + d.z / 2 }, axis }
  const link = el.links[grip]
  const other = link ? elements[link.elementId] : undefined
  const corner = other?.kind === 'run_fitting' && !other.host && other.ports.length === 2
  return { id: el.id, kind: corner ? 'corner' : 'end', grip, at: grip === 'start' ? el.start : el.end, axis }
}

/** True when a run grab's axis is plumb (vertical riser/drop). */
export function isVerticalAxis(axis: RunPoint | null | undefined): boolean {
  return Boolean(axis && Math.hypot(axis.x, axis.y) < 1e-3 && Math.abs(axis.z) > 0.5)
}

/** True when a run segment is plumb (vertical riser/drop). */
export function isVerticalSegment(seg: RunSegment): boolean {
  return Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y) < 1 && Math.abs(seg.end.z - seg.start.z) >= 1
}

function halfWidthOfSize(size: RunSize): number {
  switch (size.shape) {
    case 'rect':
    case 'oval':
      return size.width / 2
    case 'round':
      return size.diameter / 2
    case 'pipe':
      return size.nominalMm / 2
    default:
      return size.tradeSizeMm / 2
  }
}

/**
 * The level straight run, sloped pipe, or vertical round/pipe riser whose side
 * the dragged open end now touches (away from its ends); null when none.
 */
export function sideUnderEnd(model: ModelState, id: string, grip: 'start' | 'end'): RunSegment | null {
  const piece = model.elements[id]
  if (piece?.kind !== 'run_segment') return null
  const p = grip === 'start' ? piece.start : piece.end
  const pieceIsVertical = isVerticalSegment(piece)
  let best: { seg: RunSegment; d: number } | null = null
  for (const el of elementsOfKind(model.elements, 'run_segment')) {
    if (el.id === id || el.domain !== piece.domain || el.levelId !== piece.levelId) continue
    if (el.links.start?.elementId === id || el.links.end?.elementId === id) continue
    if (isVerticalSegment(el)) {
      if (pieceIsVertical || el.size.shape === 'rect' || el.size.shape === 'oval') continue
      const minZ = Math.min(el.start.z, el.end.z)
      const maxZ = Math.max(el.start.z, el.end.z)
      if (p.z <= minZ + 1 || p.z >= maxZ - 1) continue
      const d = Math.hypot(el.start.x - p.x, el.start.y - p.y)
      const reach = Math.max(halfWidthOfSize(el.size) + 25, 50)
      if (d <= reach && (!best || d < best.d)) best = { seg: el, d }
      continue
    }
    const sloped = Math.abs(el.start.z - el.end.z) > 1
    if (sloped && (el.domain !== 'pipe' || !isPitchedOrLevel(el))) continue
    const ax = el.end.x - el.start.x
    const ay = el.end.y - el.start.y
    const len2 = ax * ax + ay * ay
    if (len2 < 1) continue
    const t = ((p.x - el.start.x) * ax + (p.y - el.start.y) * ay) / len2
    if (t < 0.02 || t > 0.98) continue
    const d = Math.hypot(el.start.x + ax * t - p.x, el.start.y + ay * t - p.y)
    if (d <= halfWidthOfSize(el.size) + 25 && (!best || d < best.d)) best = { seg: el, d }
  }
  return best?.seg ?? null
}

/**
 * The command to connect an open end dragged onto `onto`'s side:
 * - Level/sloped trunk: `stretch_to_side` (standard side tap).
 * - Vertical round/pipe riser: `route_run` into `{ kind: 'run_branch', segmentId: onto.id }`
 *   at the horizontal piece's elevation so the kernel cuts a tee into the vertical riser.
 */
export function connectEndToSideCommand(view: ModelState, elementId: string, grip: 'start' | 'end', onto: RunSegment, idPrefix: string): Command | null {
  if (!isVerticalSegment(onto)) {
    return { type: 'stretch_to_side', from: { elementId, port: grip }, onto: onto.id, idPrefix }
  }
  if (onto.size.shape === 'rect' || onto.size.shape === 'oval') return null
  const piece = view.elements[elementId]
  if (piece?.kind !== 'run_segment' || piece.domain !== onto.domain || piece.levelId !== onto.levelId) return null
  if (isVerticalSegment(piece)) return null
  const system = view.elements[onto.systemId]
  if (system?.kind !== 'mep_system') return null
  const endPt = grip === 'start' ? piece.start : piece.end
  const otherPt = grip === 'start' ? piece.end : piece.start
  const minZ = Math.min(onto.start.z, onto.end.z)
  const maxZ = Math.max(onto.start.z, onto.end.z)
  if (endPt.z <= minZ + 1 || endPt.z >= maxZ - 1) return null
  const routeCmd: Command = {
    type: 'route_run',
    idPrefix,
    levelId: piece.levelId,
    domain: piece.domain,
    size: piece.size,
    elevationMm: endPt.z,
    system: { id: system.id, kind: system.systemKind },
    from: { kind: 'run_end', elementId: piece.id, port: grip },
    to: { kind: 'run_branch', segmentId: onto.id },
    points: [{ x: onto.start.x, y: onto.start.y }],
    ...(piece.domain === 'duct' || piece.domain === 'pipe' ? { insulation: piece.insulation ?? null } : {}),
  }
  // When the un-dragged open end is already very close to the riser (< 250 mm),
  // pull it back slightly along its own axis first so `route_run` clears `minStraightMm`
  // cleanly and still produces one continuous horizontal branch into the riser tee.
  const gapMm = Math.hypot(onto.start.x - endPt.x, onto.start.y - endPt.y)
  const pieceLen = Math.hypot(endPt.x - otherPt.x, endPt.y - otherPt.y)
  const minClearance = Math.max(view.settings.minStraightMm ?? 150, 150) + halfWidthOfSize(onto.size) + 50
  if (gapMm < minClearance && pieceLen > minClearance + 200) {
    const pullMm = Math.ceil(minClearance - gapMm + 50)
    const ux = (otherPt.x - endPt.x) / pieceLen
    const uy = (otherPt.y - endPt.y) / pieceLen
    return {
      type: 'batch_edits',
      label: 'Tap horizontal run into vertical riser',
      commands: [
        { type: 'drag_run', elementId: piece.id, grip, delta: { x: Math.round(ux * pullMm), y: Math.round(uy * pullMm), z: 0 } },
        routeCmd,
      ],
    }
  }
  return routeCmd
}

/** Below this camera pitch (degrees under level) a plain drag goes up and down as well as sideways: the view is looking at the run from the side. */
export const LOW_VIEW_DEG = 35

/** How a drag goes up or down from this view, said before the drag starts. */
function upDownWords(lowView: boolean): string {
  return lowView ? 'From this low angle, dragging up or down raises or lowers it (Shift: only up or down).' : 'Hold Shift while dragging to go up or down.'
}

/** What the handle says, in operator words. `lowView`: the camera looks at the run from the side (see LOW_VIEW_DEG). */
export function grabHint(kind: RunGrab['kind'], label: string, lowView = false): string {
  switch (kind) {
    case 'segment':
      return `Drag the middle to move the ${label}; what it meets follows. ${upDownWords(lowView)}`
    case 'corner':
      return `Drag to move this corner of the ${label}; both legs keep their direction. ${upDownWords(lowView)}`
    case 'end':
      return `Drag this end to make the ${label} longer or shorter.`
  }
}
