import {
  builtinPartType,
  elementsOfKind,
  insertPartOnRun,
  len3,
  sub3,
  type Command,
  type DuctMaterial,
  type LinerSurface,
  type MepSystem,
  type ModelState,
  type PartInstance,
  type PartTypeDefinition,
  type RunInsulation,
  type RunSegment,
  type RunSize,
  type SystemKind,
} from "@permitzip/bim-kernel";
import { measureIn, type Measure } from "@permitzip/bim-units";
import { ScriptRunError, type ScriptContext } from "./context";
import type { PlacedPart } from "./kit-building";
import { levelOf } from "./levels";
import { onWorking } from "./working";

/**
 * `mechanical`: cross-MEP HVAC scripting helpers for duct system design,
 * automated duct sizing, building pressurization / air balance, inline dampers &
 * accessories, and air terminal connections.
 *
 * Keeps `@permitzip/bim-script` strictly free of direct pack imports by issuing
 * ordinary kernel commands (`set_system_design`, `resize_stretch`, `connect_into`,
 * `set_parameters`, `place_run_accessory`, `insertPartOnRun`) and invoking
 * registered Mechanical pack calcs/reads (`mechanical.duct_size`,
 * `mech.pressurization`, `mech.duct_system_pressure`, `mech.ventilation_outdoor_air`).
 */

const MM_PER_IN = 25.4;

function lengthMm(value: Measure | number, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError(`${what} must be a finite number.`);
    return Math.round(value * 1000) / 1000;
  }
  if (value.kind !== "length") throw new ScriptRunError(`${what} must be a length measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "mm") * 1000) / 1000;
}

function altitudeMeters(value: Measure | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError("Altitude must be a finite number.");
    return value;
  }
  if (value.kind !== "length") throw new ScriptRunError(`Altitude must be a length measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "m") * 1000) / 1000;
}

function resolveDuctSystem(model: ModelState, ref: string): MepSystem {
  const exact = model.elements[ref];
  if (exact?.kind === "mep_system" && exact.domain === "duct") return exact;
  const low = ref.trim().toLowerCase();
  const byName = elementsOfKind(model.elements, "mep_system").find(
    (s) => s.domain === "duct" && (s.id.toLowerCase() === low || s.name.trim().toLowerCase() === low),
  );
  if (byName) return byName;
  throw new ScriptRunError(`No duct system "${ref}" found in the working model. Route a duct on that system first or pass its system id.`);
}

function resolveStationMm(
  seg: RunSegment,
  spec: { readonly at?: Measure | number; readonly fromEnd?: Measure | number; readonly fraction?: number },
  what: string,
): number {
  const totalMm = len3(sub3(seg.end, seg.start));
  if (spec.at !== undefined) return lengthMm(spec.at, `${what} station (at)`);
  if (spec.fromEnd !== undefined) {
    const dist = lengthMm(spec.fromEnd, `${what} offset from end (fromEnd)`);
    const station = Math.round((totalMm - dist) * 1000) / 1000;
    if (!(station > 0 && station < totalMm)) {
      throw new ScriptRunError(`${what} fromEnd (${Math.round(dist)} mm) falls outside segment ${seg.id} (length ${Math.round(totalMm)} mm).`);
    }
    return station;
  }
  const frac = spec.fraction ?? 0.5;
  if (!(Number.isFinite(frac) && frac > 0 && frac < 1)) {
    throw new ScriptRunError(`${what} fraction must be strictly between 0 and 1 (got ${frac}).`);
  }
  return Math.round(totalMm * frac * 1000) / 1000;
}

function sameRunSize(a: RunSize, b: RunSize): boolean {
  if (a.shape !== b.shape) return false;
  if (a.shape === "round" && b.shape === "round") return Math.abs(a.diameter - b.diameter) < 1;
  if ((a.shape === "rect" && b.shape === "rect") || (a.shape === "oval" && b.shape === "oval")) {
    return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  }
  return false;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ------------------------------------------------------------------ types

type SetSystemDesignCmd = Extract<Command, { type: "set_system_design" }>;

export interface DuctInsulationSpec {
  readonly kind: "wrap" | "liner";
  readonly thickness: Measure | number;
  readonly material?: string;
  readonly rValue?: number;
  readonly surface?: LinerSurface;
}

export interface DuctSizingCriteriaSpec {
  /** Target equal-friction rate in in. w.c. per 100 ft (e.g. `0.08`). */
  readonly frictionInPer100Ft?: number;
  /** Maximum air velocity in feet per minute (fpm). */
  readonly maxVelocityFpm?: number;
  /** Maximum rectangular aspect ratio width/height (e.g. `4`). */
  readonly maxAspectRatio?: number;
}

export interface MechanicalSystemDesignSpec {
  readonly name?: string;
  /** Site elevation (`units.ft(5280)` or meters). */
  readonly altitude?: Measure | number;
  /** Air temperature in °F (converted to °C for the kernel). */
  readonly temperatureF?: number;
  /** Air temperature in °C. */
  readonly temperatureC?: number;
  readonly material?: DuctMaterial;
  readonly frictionMethod?: "colebrook" | "altshul_tsal";
  /** Default duct wrap or liner insulation for new runs (`null` clears). */
  readonly insulation?: DuctInsulationSpec | null;
  /** Equal-friction and velocity sizing criteria (`null` resets to defaults). */
  readonly sizing?: DuctSizingCriteriaSpec | null;
  readonly fittingDefaults?: SetSystemDesignCmd["fittingDefaults"];
}

export interface SizeDuctsSpec {
  /** Duct system id or name (sizes all segments carrying airflow in that system). */
  readonly system?: string;
  /** Explicit duct segment ids to size. */
  readonly segments?: readonly string[];
  /** Explicit airflow in CFM (for standalone sizing without routed segments, or overriding segment flow). */
  readonly cfm?: number;
  /** Target duct cross-section shape (`"rect"` or `"round"`). */
  readonly shape?: "rect" | "round";
  /** System kind for standalone sizing when neither `system` nor `segments` is given (default `"supply_air"`). */
  readonly systemKind?: SystemKind;
  /** Hold rectangular duct height (`Measure` or mm, e.g. `units.in(12)` for ceiling plenum clearance). */
  readonly holdHeight?: Measure | number;
  readonly frictionInPer100Ft?: number;
  readonly maxVelocityFpm?: number;
  readonly maxAspectRatio?: number;
  /** Apply proposed sizes via `resize_stretch` (default `false` — propose only). */
  readonly apply?: boolean;
  /** Optional deterministic id prefix for `resize_stretch`. */
  readonly idPrefix?: string;
}

export interface DuctSizeProposal {
  readonly segmentId: string | null;
  readonly cfm: number;
  readonly shape: "rect" | "round";
  readonly current: RunSize | null;
  readonly suggested: RunSize;
  readonly changed: boolean;
  readonly applied: boolean;
  readonly velocityFpm: number | null;
  readonly frictionInPer100Ft: number | null;
}

export interface SizeDuctsResult {
  readonly systemId: string | null;
  readonly applied: boolean;
  readonly appliedCount: number;
  readonly segments: readonly DuctSizeProposal[];
  readonly skipped: readonly { readonly segmentId: string; readonly reason: string }[];
}

export interface AirBalanceSpec {
  /** Pressurization scope (`"model"`, `"level"`, or `"zone"`). */
  readonly scope?: "model" | "level" | "zone";
  /** Level id or name when `scope: "level"`. */
  readonly level?: string;
  /** Zone id when `scope: "zone"`. */
  readonly zoneId?: string;
  /** Optional duct system id or name to also compute `mech.duct_system_pressure` (fan ESP). */
  readonly system?: string;
}

export interface AirBalanceResult {
  readonly ok: boolean;
  readonly scope: "model" | "level" | "zone";
  readonly building: {
    readonly netCfm: number | null;
    readonly exhaustCfm: number | null;
    readonly makeupCfm: number | null;
    readonly outdoorCfm: number | null;
    readonly state: string | null;
  } | null;
  readonly zones: readonly unknown[];
  readonly issues: readonly { readonly severity: string; readonly message: string }[];
  readonly pressure?: {
    readonly systemId: string;
    readonly requiredEspInWc: number | null;
    readonly totalPa: number | null;
    readonly criticalEnd: string | null;
    readonly issues: readonly { readonly severity: string; readonly message: string }[];
  };
  readonly raw: unknown;
}

export type DamperKind = "volume" | "fire" | "smoke" | "fire_smoke" | "backdraft";

export interface PlaceDamperSpec {
  /** Straight duct segment id. */
  readonly segment: string;
  /** Damper type (`"volume"`, `"fire"`, `"smoke"`, `"fire_smoke"`, `"backdraft"`). Default `"volume"`. */
  readonly kind?: DamperKind;
  /** Distance from segment start (`Measure` or mm). */
  readonly at?: Measure | number;
  /** Distance back from segment end (`Measure` or mm). */
  readonly fromEnd?: Measure | number;
  /** Fractional position along segment in `(0, 1)` when `at` and `fromEnd` are omitted (default `0.5`). */
  readonly fraction?: number;
  /** Optional explicit damper `part_type` id (otherwise auto-creates/reuses an inline damper matching the duct size). */
  readonly typeId?: string;
  /** Optional damper mark (e.g. `"FD-1"`, `"VD-3"`). */
  readonly mark?: string;
  /** Flip flow orientation along the duct. */
  readonly flip?: boolean;
  /** Optional deterministic id prefix. */
  readonly id?: string;
}

export interface PlaceMechanicalAccessorySpec {
  /** Straight duct or pipe segment id. */
  readonly segment: string;
  /** Inline part type id (inserted via `insertPartOnRun`), or omit when passing a pipe fitting `family`. */
  readonly typeId?: string;
  /** Optional part type definition if `typeId` is not yet in the model or built-in library. */
  readonly partType?: PartTypeDefinition;
  /** Optional pipe fitting family id (for `place_run_accessory` on hydronic/condensate pipe segments). */
  readonly family?: string;
  readonly params?: Readonly<Record<string, number | string>>;
  /** Distance from segment start (`Measure` or mm). */
  readonly at?: Measure | number;
  /** Distance back from segment end (`Measure` or mm). */
  readonly fromEnd?: Measure | number;
  /** Fractional position along segment in `(0, 1)` when `at` and `fromEnd` are omitted (default `0.5`). */
  readonly fraction?: number;
  readonly mark?: string;
  readonly flip?: boolean;
  readonly id?: string;
}

export interface PlaceMechanicalAccessoryResult {
  readonly id: string;
  readonly segmentId: string;
  readonly atMm: number;
  readonly mode: "inline_part" | "accessory";
  readonly typeId?: string;
  readonly family?: string;
}

export type DiffuserRef =
  | string
  | PlacedPart
  | { readonly elementId: string; readonly port?: string; readonly cfm?: number }
  | { readonly part: PlacedPart; readonly port?: string; readonly cfm?: number };

export interface ConnectDiffusersSpec {
  /** Air terminals (ids, `PlacedPart` handles, or `{ elementId/part, port?, cfm? }`). */
  readonly from: readonly DiffuserRef[];
  /** Target duct trunk segment id, or `"nearest"`. */
  readonly into: string;
  /** Default terminal connector id (default `"neck"`). */
  readonly port?: string;
  /** Optional deterministic id prefix for `connect_into`. */
  readonly id?: string;
}

export interface ConnectDiffusersResult {
  readonly idPrefix: string;
  readonly connectedCount: number;
  readonly terminals: readonly { readonly elementId: string; readonly port: string; readonly cfm?: number }[];
}

// ------------------------------------------------------------------ damper part builder

const DAMPER_LABELS: Readonly<Record<DamperKind, { readonly family: string; readonly code: string; readonly lengthMm: number }>> = {
  volume: { family: "Volume damper", code: "VD", lengthMm: 150 },
  fire: { family: "Fire damper", code: "FD", lengthMm: 200 },
  smoke: { family: "Smoke damper", code: "SD", lengthMm: 250 },
  fire_smoke: { family: "Combination fire/smoke damper", code: "FSD", lengthMm: 300 },
  backdraft: { family: "Backdraft damper", code: "BDD", lengthMm: 150 },
};

function buildInlineDamperDefinition(kind: DamperKind, size: RunSize, systemKind: SystemKind): { readonly typeId: string; readonly definition: PartTypeDefinition } {
  const meta = DAMPER_LABELS[kind];
  const L = meta.lengthMm;
  const halfL = L / 2;

  if (size.shape === "round") {
    const dIn = Math.round((size.diameter / MM_PER_IN) * 10) / 10;
    const typeId = `mutiny.damper.${kind}.r${Math.round(size.diameter)}`;
    const definition: PartTypeDefinition = {
      familyName: meta.family,
      typeName: `${dIn}" round`,
      category: "duct_accessory",
      description: `Inline ${meta.family.toLowerCase()} sized to match ${dIn}" round duct.`,
      typeParams: [
        { name: "length", label: "Length", kind: "length", unit: "mm", min: 50 },
        { name: "diameter", label: "Diameter", kind: "length", unit: "mm", min: 50 },
        { name: "damper_kind", label: "Damper kind", kind: "text" },
      ],
      typeValues: { length: L, diameter: size.diameter, damper_kind: kind },
      instanceParams: [],
      connectors: [
        { id: "in", label: "Inlet", domain: "duct", systemKind, position: [-halfL, 0, 0], direction: [-1, 0, 0], shape: "round", diameter: { param: "diameter" }, endType: "mechanical.slip", flowDirection: "in" },
        { id: "out", label: "Outlet", domain: "duct", systemKind, position: [halfL, 0, 0], direction: [1, 0, 0], shape: "round", diameter: { param: "diameter" }, endType: "mechanical.slip", flowDirection: "out" },
      ],
      geometry: [
        { kind: "cylinder", center: [0, 0, 0], radius: { param: "diameter", scale: 0.5 }, height: { param: "length" }, axis: "x" },
      ],
      symbol: [
        { kind: "rect", center: [0, 0], size: [{ param: "length" }, { param: "diameter" }] },
        { kind: "line", from: [-halfL, { param: "diameter", scale: -0.5 }], to: [halfL, { param: "diameter", scale: 0.5 }] },
      ],
      tagFields: ["mark"],
      source: { kind: "builtin", libraryVersion: "1" },
    };
    return { typeId, definition };
  }

  const w = size.shape === "rect" || size.shape === "oval" ? size.width : 300;
  const h = size.shape === "rect" || size.shape === "oval" ? size.height : 300;
  const wIn = Math.round((w / MM_PER_IN) * 10) / 10;
  const hIn = Math.round((h / MM_PER_IN) * 10) / 10;
  const typeId = `mutiny.damper.${kind}.${Math.round(w)}x${Math.round(h)}`;
  const definition: PartTypeDefinition = {
    familyName: meta.family,
    typeName: `${wIn}"x${hIn}"`,
    category: "duct_accessory",
    description: `Inline ${meta.family.toLowerCase()} sized to match ${wIn}"x${hIn}" rectangular duct.`,
    typeParams: [
      { name: "length", label: "Length", kind: "length", unit: "mm", min: 50 },
      { name: "width", label: "Width", kind: "length", unit: "mm", min: 50 },
      { name: "height", label: "Height", kind: "length", unit: "mm", min: 50 },
      { name: "damper_kind", label: "Damper kind", kind: "text" },
    ],
    typeValues: { length: L, width: w, height: h, damper_kind: kind },
    instanceParams: [],
    connectors: [
      { id: "in", label: "Inlet", domain: "duct", systemKind, position: [-halfL, 0, 0], direction: [-1, 0, 0], shape: "rect", width: { param: "width" }, height: { param: "height" }, endType: "mechanical.slip", flowDirection: "in" },
      { id: "out", label: "Outlet", domain: "duct", systemKind, position: [halfL, 0, 0], direction: [1, 0, 0], shape: "rect", width: { param: "width" }, height: { param: "height" }, endType: "mechanical.slip", flowDirection: "out" },
    ],
    geometry: [
      { kind: "box", center: [0, 0, 0], size: [{ param: "length" }, { param: "width" }, { param: "height" }] },
    ],
    symbol: [
      { kind: "rect", center: [0, 0], size: [{ param: "length" }, { param: "width" }] },
      { kind: "line", from: [-halfL, { param: "width", scale: -0.5 }], to: [halfL, { param: "width", scale: 0.5 }] },
    ],
    tagFields: ["mark"],
    source: { kind: "builtin", libraryVersion: "1" },
  };
  return { typeId, definition };
}

// ------------------------------------------------------------------ public API

export const mechanical = {
  /**
   * Configures design parameters on a duct system via `set_system_design`:
   * altitude, air temperature, duct material, friction method, default wrap/liner
   * insulation, equal-friction / max-velocity / aspect-ratio sizing criteria, and
   * fitting defaults.
   */
  setSystemDesign(ctx: ScriptContext, systemRef: string, spec: MechanicalSystemDesignSpec): { readonly systemId: string } {
    const systemId = onWorking(ctx, "mechanical.setSystemDesign", (m) => {
      const existing = m.elements[systemRef];
      if (existing?.kind === "mep_system" && existing.domain === "duct") return existing.id;
      const low = systemRef.trim().toLowerCase();
      const byName = elementsOfKind(m.elements, "mep_system").find(
        (s) => s.domain === "duct" && (s.id.toLowerCase() === low || s.name.trim().toLowerCase() === low),
      );
      return byName?.id ?? systemRef;
    });

    const temperatureC =
      spec.temperatureC !== undefined
        ? spec.temperatureC
        : spec.temperatureF !== undefined
          ? Math.round((((spec.temperatureF - 32) * 5) / 9) * 1000) / 1000
          : undefined;

    const insulation: RunInsulation | null | undefined =
      spec.insulation === undefined
        ? undefined
        : spec.insulation === null
          ? null
          : {
              kind: spec.insulation.kind,
              thicknessMm: lengthMm(spec.insulation.thickness, "Duct insulation thickness"),
              ...(spec.insulation.material ? { material: spec.insulation.material } : {}),
              ...(spec.insulation.rValue !== undefined ? { rValue: spec.insulation.rValue } : {}),
              ...(spec.insulation.surface ? { surface: spec.insulation.surface } : {}),
            };

    const design: NonNullable<SetSystemDesignCmd["design"]> = {
      ...(spec.altitude !== undefined ? { altitudeM: altitudeMeters(spec.altitude) } : {}),
      ...(temperatureC !== undefined ? { temperatureC } : {}),
      ...(spec.material !== undefined ? { material: spec.material } : {}),
      ...(spec.frictionMethod !== undefined ? { frictionMethod: spec.frictionMethod } : {}),
      ...(insulation !== undefined ? { insulation } : {}),
      ...(spec.sizing !== undefined ? { sizing: spec.sizing } : {}),
    };

    ctx.edit({
      type: "set_system_design",
      systemId,
      ...(spec.name ? { name: spec.name } : {}),
      ...(Object.keys(design).length > 0 ? { design } : {}),
      ...(spec.fittingDefaults ? { fittingDefaults: spec.fittingDefaults } : {}),
    });

    return { systemId };
  },

  /**
   * Sizes one or more duct segments (or a standalone CFM lookup) using the Mechanical
   * pack's `mechanical.duct_size` criteria read. When `apply: true`, resizes changed
   * duct segments via `resize_stretch`.
   */
  sizeDucts(ctx: ScriptContext, spec: SizeDuctsSpec): SizeDuctsResult {
    const holdHeightMm = spec.holdHeight !== undefined ? lengthMm(spec.holdHeight, "Duct holdHeight") : undefined;

    const target = onWorking(ctx, "mechanical.sizeDucts", (m) => {
      const sys = spec.system ? resolveDuctSystem(m, spec.system) : null;
      if (spec.segments && spec.segments.length > 0) {
        return { systemId: sys?.id ?? null, segmentIds: [...spec.segments] };
      }
      if (sys) {
        const segs = elementsOfKind(m.elements, "run_segment")
          .filter((s) => s.domain === "duct" && s.systemId === sys.id)
          .map((s) => s.id);
        return { systemId: sys.id, segmentIds: segs };
      }
      return { systemId: null, segmentIds: [] as string[] };
    });

    // Standalone sizing lookup (no segments, just cfm)
    if (target.segmentIds.length === 0) {
      if (spec.cfm === undefined) {
        throw new ScriptRunError("mechanical.sizeDucts needs `system`, `segments`, or an explicit `cfm` value.");
      }
      const ans = ctx.read<Record<string, unknown>>("mechanical.duct_size", {
        cfm: spec.cfm,
        ...(spec.shape ? { shape: spec.shape } : {}),
        ...(target.systemId ? { system_id: target.systemId } : {}),
        ...(spec.systemKind ? { system_kind: spec.systemKind } : {}),
        ...(holdHeightMm !== undefined ? { height_mm: holdHeightMm } : {}),
        ...(spec.frictionInPer100Ft !== undefined ? { friction_in_per_100ft: spec.frictionInPer100Ft } : {}),
        ...(spec.maxVelocityFpm !== undefined ? { max_velocity_fpm: spec.maxVelocityFpm } : {}),
        ...(spec.maxAspectRatio !== undefined ? { max_aspect_ratio: spec.maxAspectRatio } : {}),
      });
      const pick = asRecord(ans.suggested);
      const size = pick?.size as RunSize | undefined;
      if (!size) throw new ScriptRunError("mechanical.duct_size did not return a suggested duct size.");
      return {
        systemId: target.systemId,
        applied: false,
        appliedCount: 0,
        segments: [
          {
            segmentId: null,
            cfm: spec.cfm,
            shape: size.shape === "round" ? "round" : "rect",
            current: null,
            suggested: size,
            changed: true,
            applied: false,
            velocityFpm: typeof pick?.velocityFpm === "number" ? pick.velocityFpm : null,
            frictionInPer100Ft: typeof pick?.frictionInPer100Ft === "number" ? pick.frictionInPer100Ft : null,
          },
        ],
        skipped: [],
      };
    }

    const proposals: DuctSizeProposal[] = [];
    const skipped: Array<{ readonly segmentId: string; readonly reason: string }> = [];
    const prefix = spec.idPrefix ?? ctx.id("dsize");
    let appliedCount = 0;

    for (const [idx, segId] of target.segmentIds.entries()) {
      const segInfo = onWorking(ctx, "mechanical.sizeDucts:seg", (m) => {
        const seg = m.elements[segId];
        if (seg?.kind !== "run_segment" || seg.domain !== "duct") return null;
        return { flow: seg.flow, size: seg.size };
      });
      if (!segInfo) {
        skipped.push({ segmentId: segId, reason: "Not a duct segment." });
        continue;
      }
      const cfm = spec.cfm ?? (segInfo.flow > 0 ? segInfo.flow : undefined);
      if (cfm === undefined) {
        skipped.push({ segmentId: segId, reason: "Segment carries 0 CFM and no explicit `cfm` override was given." });
        continue;
      }
      const ans = ctx.read<Record<string, unknown>>("mechanical.duct_size", {
        element_id: segId,
        cfm,
        ...(spec.shape ? { shape: spec.shape } : {}),
        ...(holdHeightMm !== undefined ? { height_mm: holdHeightMm } : {}),
        ...(spec.frictionInPer100Ft !== undefined ? { friction_in_per_100ft: spec.frictionInPer100Ft } : {}),
        ...(spec.maxVelocityFpm !== undefined ? { max_velocity_fpm: spec.maxVelocityFpm } : {}),
        ...(spec.maxAspectRatio !== undefined ? { max_aspect_ratio: spec.maxAspectRatio } : {}),
      });
      const pick = asRecord(ans.suggested);
      const suggested = pick?.size as RunSize | undefined;
      if (!suggested) {
        skipped.push({ segmentId: segId, reason: "No duct size returned." });
        continue;
      }
      const changed = !sameRunSize(segInfo.size, suggested);
      let applied = false;
      if (spec.apply === true && changed) {
        ctx.edit({
          type: "resize_stretch",
          idPrefix: `${prefix}-${idx + 1}`,
          segmentIds: [segId],
          size: suggested,
        });
        applied = true;
        appliedCount += 1;
      }
      proposals.push({
        segmentId: segId,
        cfm,
        shape: suggested.shape === "round" ? "round" : "rect",
        current: segInfo.size,
        suggested,
        changed,
        applied,
        velocityFpm: typeof pick?.velocityFpm === "number" ? pick.velocityFpm : null,
        frictionInPer100Ft: typeof pick?.frictionInPer100Ft === "number" ? pick.frictionInPer100Ft : null,
      });
    }

    return {
      systemId: target.systemId,
      applied: appliedCount > 0,
      appliedCount,
      segments: proposals,
      skipped,
    };
  },

  /**
   * Runs `mech.pressurization` (building / level / zone exhaust vs makeup + outdoor air
   * balance) and optionally `mech.duct_system_pressure` (fan ESP & critical path) on
   * a named duct system.
   */
  airBalance(ctx: ScriptContext, spec: AirBalanceSpec = {}): AirBalanceResult {
    const scope = spec.scope ?? "model";
    const resolvedLevelId = scope === "level" && spec.level ? levelOf(ctx, spec.level) : undefined;
    const pressRes = ctx.calc({
      calc: "mech.pressurization",
      inputs: {
        scope,
        ...(resolvedLevelId ? { level_id: resolvedLevelId } : {}),
        ...(spec.zoneId ? { zone_id: spec.zoneId } : {}),
      },
    });

    if (!pressRes.ok) {
      return {
        ok: false,
        scope,
        building: null,
        zones: [],
        issues: [{ severity: "error", message: pressRes.reason }],
        raw: pressRes,
      };
    }

    const val = (key: string) => pressRes.run.values.find((v) => v.key === key)?.value ?? null;
    const detailRec = asRecord(pressRes.run.detail);
    const hasBuilding = detailRec?.building !== null && detailRec?.building !== undefined;

    let pressure: AirBalanceResult["pressure"];
    if (spec.system) {
      const sysId = onWorking(ctx, "mechanical.airBalance:system", (m) => resolveDuctSystem(m, spec.system!).id);
      const espRes = ctx.calc({
        calc: "mech.duct_system_pressure",
        inputs: { system_id: sysId },
      });
      if (espRes.ok) {
        const ev = (k: string) => espRes.run.values.find((v) => v.key === k)?.value ?? null;
        pressure = {
          systemId: sysId,
          requiredEspInWc: typeof ev("required_esp_in_wc") === "number" ? (ev("required_esp_in_wc") as number) : null,
          totalPa: typeof ev("total_pa") === "number" ? (ev("total_pa") as number) : null,
          criticalEnd: typeof ev("critical_end") === "string" ? (ev("critical_end") as string) : null,
          issues: espRes.run.issues.map((i) => ({ severity: i.severity, message: i.message })),
        };
      } else {
        pressure = {
          systemId: sysId,
          requiredEspInWc: null,
          totalPa: null,
          criticalEnd: null,
          issues: [{ severity: "error", message: espRes.reason }],
        };
      }
    }

    const issues = pressRes.run.issues.map((i) => ({ severity: i.severity, message: i.message }));
    return {
      ok: issues.every((i) => i.severity !== "error") && (pressure ? pressure.issues.every((i) => i.severity !== "error") : true),
      scope,
      building: hasBuilding
        ? {
            netCfm: typeof val("building_net_cfm") === "number" ? (val("building_net_cfm") as number) : null,
            exhaustCfm: typeof val("building_exhaust_cfm") === "number" ? (val("building_exhaust_cfm") as number) : null,
            makeupCfm: typeof val("building_makeup_cfm") === "number" ? (val("building_makeup_cfm") as number) : null,
            outdoorCfm: typeof val("building_outdoor_cfm") === "number" ? (val("building_outdoor_cfm") as number) : null,
            state: typeof val("building_state") === "string" ? (val("building_state") as string) : null,
          }
        : null,
      zones: Array.isArray(detailRec?.zones) ? detailRec.zones : [],
      issues,
      ...(pressure ? { pressure } : {}),
      raw: pressRes,
    };
  },

  /**
   * Places an inline volume, fire, smoke, combination fire/smoke, or backdraft damper
   * on a straight duct segment using typed length units (`at`, `fromEnd`, or `fraction`).
   * Automatically matches the duct's rectangular or round cross-section and sets
   * `damper_kind` so rated-wall crossing checks recognize it immediately.
   */
  placeDamper(ctx: ScriptContext, spec: PlaceDamperSpec): PlaceMechanicalAccessoryResult {
    const kind: DamperKind = spec.kind ?? "volume";
    const resolved = onWorking(ctx, "mechanical.placeDamper", (m) => {
      const seg = m.elements[spec.segment];
      if (seg?.kind !== "run_segment" || seg.domain !== "duct") {
        throw new ScriptRunError(`"${spec.segment}" is not a straight duct segment in the working model.`);
      }
      const sys = m.elements[seg.systemId];
      const systemKind: SystemKind = sys?.kind === "mep_system" ? sys.systemKind : "supply_air";
      const atMm = resolveStationMm(seg, spec, "mechanical.placeDamper");

      const built = spec.typeId
        ? {
            typeId: spec.typeId,
            definition:
              m.elements[spec.typeId]?.kind === "part_type"
                ? undefined
                : builtinPartType(spec.typeId)?.definition,
          }
        : buildInlineDamperDefinition(kind, seg.size, systemKind);

      const pinned = m.elements[built.typeId]?.kind === "part_type";
      const idPrefix = spec.id ?? ctx.id("dmp");
      const meta = DAMPER_LABELS[kind];
      const plan = insertPartOnRun(m, {
        runId: seg.id,
        atMm,
        partDefinitionId: built.typeId,
        ...(!pinned && built.definition ? { partType: built.definition } : {}),
        idPrefix,
        ...(spec.flip ? { flip: true } : {}),
        mark: spec.mark ?? `${meta.code}-${idPrefix.slice(-4).toUpperCase()}`,
      });
      if ("refused" in plan) throw new ScriptRunError(`mechanical.placeDamper: ${plan.refused}`);
      return { id: `${idPrefix}-part`, segmentId: seg.id, atMm, typeId: built.typeId, commands: plan };
    });

    for (const cmd of resolved.commands) ctx.editSteps(cmd);
    return {
      id: resolved.id,
      segmentId: resolved.segmentId,
      atMm: resolved.atMm,
      mode: "inline_part",
      typeId: resolved.typeId,
    };
  },

  /**
   * Places an inline mechanical accessory part (`typeId` via `insertPartOnRun`, e.g.
   * VAV box, inline fan, silencer, damper) on a straight duct/pipe run, or a hosted
   * pipe accessory (`family` via `place_run_accessory`) on a hydronic/condensate run.
   */
  placeAccessory(ctx: ScriptContext, spec: PlaceMechanicalAccessorySpec): PlaceMechanicalAccessoryResult {
    const resolved = onWorking(ctx, "mechanical.placeAccessory", (m) => {
      const seg = m.elements[spec.segment];
      if (seg?.kind !== "run_segment") {
        throw new ScriptRunError(`"${spec.segment}" is not a straight run segment in the working model.`);
      }
      const atMm = resolveStationMm(seg, spec, "mechanical.placeAccessory");

      if (spec.family && !spec.typeId) {
        const accessoryId = spec.id ?? ctx.id("macc");
        return {
          mode: "accessory" as const,
          id: accessoryId,
          segmentId: seg.id,
          atMm,
          family: spec.family,
        };
      }

      if (!spec.typeId) {
        throw new ScriptRunError("mechanical.placeAccessory requires `typeId` (for inline parts) or `family` (for hosted pipe accessories).");
      }
      const pinned = m.elements[spec.typeId]?.kind === "part_type";
      const def = pinned ? undefined : (spec.partType ?? builtinPartType(spec.typeId)?.definition);
      if (!pinned && !def) {
        throw new ScriptRunError(`Part type "${spec.typeId}" was not found in the model or built-in library; pass \`partType\` too.`);
      }
      const idPrefix = spec.id ?? ctx.id("macc");
      const plan = insertPartOnRun(m, {
        runId: seg.id,
        atMm,
        partDefinitionId: spec.typeId,
        ...(def ? { partType: def } : {}),
        idPrefix,
        ...(spec.flip ? { flip: true } : {}),
        ...(spec.mark ? { mark: spec.mark } : {}),
      });
      if ("refused" in plan) throw new ScriptRunError(`mechanical.placeAccessory: ${plan.refused}`);
      return {
        mode: "inline_part" as const,
        id: `${idPrefix}-part`,
        segmentId: seg.id,
        atMm,
        typeId: spec.typeId,
        commands: plan,
      };
    });

    if (resolved.mode === "accessory") {
      ctx.edit({
        type: "place_run_accessory",
        accessoryId: resolved.id,
        segmentId: resolved.segmentId,
        atMm: resolved.atMm,
        family: resolved.family,
        ...(spec.params && Object.keys(spec.params).length > 0 ? { params: { ...spec.params } } : {}),
      });
      return {
        id: resolved.id,
        segmentId: resolved.segmentId,
        atMm: resolved.atMm,
        mode: "accessory",
        family: resolved.family,
      };
    }

    for (const cmd of resolved.commands) ctx.editSteps(cmd);
    return {
      id: resolved.id,
      segmentId: resolved.segmentId,
      atMm: resolved.atMm,
      mode: "inline_part",
      typeId: resolved.typeId,
    };
  },

  /**
   * Connects air terminals (supply diffusers, return/exhaust grilles) into a duct trunk
   * segment (or `"nearest"`) via `connect_into`. Optionally sets each terminal's design
   * airflow (`cfm`) before connecting so flow propagates cleanly upstream to the trunk.
   */
  connectDiffusers(ctx: ScriptContext, spec: ConnectDiffusersSpec): ConnectDiffusersResult {
    if (spec.from.length === 0) {
      throw new ScriptRunError("mechanical.connectDiffusers requires at least one terminal in `from`.");
    }
    const defaultPort = spec.port ?? "neck";
    const terminals = spec.from.map((entry) => {
      if (typeof entry === "string") return { elementId: entry, port: defaultPort };
      if ("connector" in entry) return { elementId: entry.id, port: defaultPort };
      if ("part" in entry) {
        return {
          elementId: entry.part.id,
          port: entry.port ?? defaultPort,
          ...(entry.cfm !== undefined ? { cfm: entry.cfm } : {}),
        };
      }
      return {
        elementId: entry.elementId,
        port: entry.port ?? defaultPort,
        ...(entry.cfm !== undefined ? { cfm: entry.cfm } : {}),
      };
    });

    // Apply optional per-terminal CFM overrides before connecting so duct flow propagates accurately
    for (const t of terminals) {
      if (t.cfm === undefined) continue;
      const hasInstanceAirflow = onWorking(ctx, "mechanical.connectDiffusers:cfm", (m) => {
        const part = m.elements[t.elementId] as PartInstance | undefined;
        if (part?.kind !== "part") return false;
        const pt = m.elements[part.typeId];
        return pt?.kind === "part_type" && pt.definition.instanceParams.some((p) => p.name === "airflow");
      });
      if (hasInstanceAirflow) {
        ctx.edit({ type: "set_parameters", id: t.elementId, scope: "instance", values: { airflow: t.cfm } });
      } else {
        ctx.edit({ type: "set_element_values", elementIds: [t.elementId], values: { "mechanical.airflow": t.cfm } });
      }
    }

    const idPrefix = spec.id ?? ctx.id("diff");
    ctx.edit({
      type: "connect_into",
      from: terminals.map((t) => ({ elementId: t.elementId, port: t.port })),
      into: spec.into,
      idPrefix,
    });

    return {
      idPrefix,
      connectedCount: terminals.length,
      terminals,
    };
  },
};
