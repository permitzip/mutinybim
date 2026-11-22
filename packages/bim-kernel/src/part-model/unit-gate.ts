import { refuse, registerEditHook } from "../command-core";
import { decidingUndo, peerReads } from "../elements/feature";
import { isUnitCodeOnly, PARTS_UNIT_CODES_FEATURE, type ParamDef } from "../parts";
import { isWallFaceMountable, lineHostTopMm, nearestWallFace, PARTS_LINE_HOST_FEATURE, PARTS_WALL_FACE_HOST_FEATURE, wallFaceFrame } from "../spatial";
import { elementsOfKind } from "../store";
import type { BimElement, ElementId, ModelState } from "../types";

/**
 * Part writes gated on what peers read (units here; line hosts below).
 *
 * Part parameter units, expand then contract: every reader of this release
 * reads a unit code (`cfs`) as well as a v1 unit name (`gpm`); a part type
 * newly carrying a unit code is written only when the peers advertise
 * `parts:unit_codes`. A unit a type already carried passes, so a newer peer's
 * type round-trips; undo restores stored records and stands aside.
 */
function unitCodes(params: readonly ParamDef[]): Set<string> {
  const out = new Set<string>();
  for (const p of params) if (isUnitCodeOnly(p.unit)) out.add(`${p.name}:${p.unit ?? ""}`);
  return out;
}

function checkUnits(base: Readonly<Record<string, BimElement>>, working: Readonly<Record<string, BimElement>>, touchedIds: readonly ElementId[]): void {
  if (decidingUndo()) return;
  for (const id of touchedIds) {
    const next = working[id];
    if (next?.kind !== "part_type") continue;
    const now = unitCodes([...next.definition.typeParams, ...next.definition.instanceParams]);
    if (now.size === 0) continue;
    const prior = base[id];
    const before = prior?.kind === "part_type" ? unitCodes([...prior.definition.typeParams, ...prior.definition.instanceParams]) : new Set<string>();
    const added = [...now].find((u) => !before.has(u));
    if (added === undefined || peerReads(PARTS_UNIT_CODES_FEATURE)) continue;
    const [name, unit] = added.split(":");
    refuse("invalid_value", `${next.definition.familyName} ${next.definition.typeName}'s ${name} in ${unit} can't be saved yet: the model server this model is open on is an older version that reads only the original part unit names. Try again once the server is updated`, [next.id]);
  }
}

/**
 * A part standing on a line-placed element (a unit on a beam): the element
 * must exist and have a line, and the host is written only when the peers
 * advertise `parts:line_host`. A host a part already had passes.
 */
function checkLineHosts(base: ModelState, working: Readonly<Record<string, BimElement>>, touchedIds: readonly ElementId[]): void {
  if (decidingUndo()) return;
  for (const id of touchedIds) {
    const next = working[id];
    if (next?.kind !== "part" || next.host?.kind !== "element") continue;
    const prior = base.elements[id];
    const was = prior?.kind === "part" ? prior.host : undefined;
    if (was?.kind === "element" && was.elementId === next.host.elementId && was.stationMm === next.host.stationMm) continue;
    const name = next.mark || "The part";
    if (lineHostTopMm({ ...base, elements: working }, next.host.elementId, next.host.stationMm) === null) refuse("element_not_found", `${name} can't stand on ${next.host.elementId}: it isn't a beam, wall, grid or component with a line in this model`, [id]);
    if (!peerReads(PARTS_LINE_HOST_FEATURE)) refuse("invalid_value", `${name} can't be saved standing on a beam yet: the model server this model is open on is an older version that stores only slab and roof hosts. Try again once the server is updated`, [id]);
  }
}

/**
 * A part mounted on a wall's finish face: the host wall must exist, and the
 * host is written only when peers advertise `parts:wall_face_host`.
 */
function checkWallFaceHosts(base: ModelState, working: Readonly<Record<string, BimElement>>, touchedIds: readonly ElementId[]): void {
  if (decidingUndo()) return;
  for (const id of touchedIds) {
    const next = working[id];
    if (next?.kind !== "part" || next.host?.kind !== "wall_face") continue;
    const prior = base.elements[id];
    const was = prior?.kind === "part" ? prior.host : undefined;
    if (
      was?.kind === "wall_face" &&
      was.elementId === next.host.elementId &&
      was.stationMm === next.host.stationMm &&
      was.side === next.host.side &&
      (was.faceOffsetMm ?? 0) === (next.host.faceOffsetMm ?? 0)
    ) {
      continue;
    }
    const name = next.mark || "The part";
    if (working[next.host.elementId]?.kind !== "wall") {
      refuse("element_not_found", `${name} can't mount on ${next.host.elementId}: it isn't a wall in this model`, [id]);
    }
    if (!peerReads(PARTS_WALL_FACE_HOST_FEATURE)) {
      refuse("invalid_value", `${name} can't be saved mounted to a wall face yet: the model server this model is open on is an older version. Try again once the server is updated`, [id]);
    }
  }
}

/**
 * Parts mounted on a wall face:
 * 1. When a host wall moves, rotates, stretches or changes thickness, every
 *    hosted part follows its finish face inside the same atomic edit / undo step.
 * 2. When a hosted part itself is moved (e.g. dragged on a plan while its host
 *    wall stayed put), it slides smoothly along the nearest wall finish face
 *    within 450 mm (even hopping corners onto perpendicular walls), or detaches
 *    if dragged into open space away from walls.
 */
function followWallFaceHosts(base: ModelState, working: Record<string, BimElement>, touchedIds: ElementId[]): void {
  if (decidingUndo()) return;
  const changedWalls = new Set<string>();
  for (const id of touchedIds) {
    const next = working[id];
    if (next?.kind !== "wall") continue;
    const prev = base.elements[id];
    if (
      prev?.kind !== "wall" ||
      prev.start.x !== next.start.x ||
      prev.start.y !== next.start.y ||
      prev.end.x !== next.end.x ||
      prev.end.y !== next.end.y ||
      prev.thickness !== next.thickness
    ) {
      changedWalls.add(id);
    }
  }
  const alreadyTouched = new Set<string>(touchedIds);
  // 1) Hosted parts whose host wall changed follow their wall's new finish face.
  if (changedWalls.size > 0) {
    for (const part of elementsOfKind(working, "part")) {
      if (part.planned !== undefined || part.host?.kind !== "wall_face") continue;
      if (!changedWalls.has(part.host.elementId)) continue;
      const wall = working[part.host.elementId];
      if (wall?.kind !== "wall") continue;
      const frame = wallFaceFrame(wall, part.host.stationMm, part.host.side, part.host.faceOffsetMm ?? 0);
      if (part.position.x === frame.position.x && part.position.y === frame.position.y && part.rotationDeg === frame.rotationDeg) continue;
      working[part.id] = { ...part, position: frame.position, rotationDeg: frame.rotationDeg };
      if (!alreadyTouched.has(part.id)) {
        touchedIds.push(part.id);
        alreadyTouched.add(part.id);
      }
    }
  }
  // 2) Hosted parts (and unhosted wall-mountable parts) that were moved directly:
  //    re-project onto the nearest wall face within 450 mm, or detach if dragged into open room space.
  const workingModel: ModelState = { ...base, elements: working };
  const wallFaceAllowed = peerReads(PARTS_WALL_FACE_HOST_FEATURE);
  for (const id of touchedIds) {
    const next = working[id];
    if (next?.kind !== "part" || next.planned !== undefined) continue;
    const prev = base.elements[id];
    if (prev?.kind !== "part") continue;
    const movedPos = prev.position.x !== next.position.x || prev.position.y !== next.position.y;
    if (!movedPos) continue;
    if (next.host?.kind === "wall_face") {
      if (changedWalls.has(next.host.elementId)) continue;
      if (prev.host?.kind !== "wall_face") continue;
      // Skip if the command explicitly updated the host record itself (e.g. set_part_host).
      const sameHost =
        prev.host.elementId === next.host.elementId &&
        prev.host.stationMm === next.host.stationMm &&
        prev.host.side === next.host.side &&
        (prev.host.faceOffsetMm ?? 0) === (next.host.faceOffsetMm ?? 0);
      if (!sameHost) continue;
      const snap = nearestWallFace(workingModel, next.levelId, next.position, { maxDistanceMm: 450 });
      if (snap) {
        const faceOffsetMm = next.host.faceOffsetMm ?? 0;
        const wall = working[snap.wallId];
        const frame = wall?.kind === "wall" ? wallFaceFrame(wall, snap.stationMm, snap.side, faceOffsetMm) : { position: snap.position, rotationDeg: snap.rotationDeg };
        working[id] = {
          ...next,
          position: frame.position,
          rotationDeg: frame.rotationDeg,
          host: {
            kind: "wall_face",
            elementId: snap.wallId,
            stationMm: snap.stationMm,
            side: snap.side,
            ...(faceOffsetMm !== 0 ? { faceOffsetMm } : {}),
          },
        };
      } else {
        const { host: _detached, ...unhosted } = next;
        working[id] = unhosted;
      }
    } else if (wallFaceAllowed && next.host === undefined && prev.host === undefined) {
      // An unhosted wall-mountable part dragged back near a wall re-snaps and auto-rotates onto the finish face.
      const typeEl = working[next.typeId];
      if (typeEl?.kind !== "part_type" || !isWallFaceMountable(typeEl.definition)) continue;
      const snap = nearestWallFace(workingModel, next.levelId, next.position, { maxDistanceMm: 450 });
      if (!snap) continue;
      const wall = working[snap.wallId];
      const frame = wall?.kind === "wall" ? wallFaceFrame(wall, snap.stationMm, snap.side, 0) : { position: snap.position, rotationDeg: snap.rotationDeg };
      working[id] = {
        ...next,
        position: frame.position,
        rotationDeg: frame.rotationDeg,
        host: { kind: "wall_face", elementId: snap.wallId, stationMm: snap.stationMm, side: snap.side },
      };
    }
  }
}

registerEditHook("part-unit-codes", (base, working, touchedIds) => {
  checkUnits(base.elements, working, touchedIds);
  checkLineHosts(base, working, touchedIds);
  checkWallFaceHosts(base, working, touchedIds);
  followWallFaceHosts(base, working, touchedIds);
});
