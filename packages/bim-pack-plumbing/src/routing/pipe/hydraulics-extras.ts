import {
  connectionTypeOf,
  len3,
  paramValue,
  partConnectionTypeName,
  partLabelOf,
  pipeDims,
  resolveConnectors,
  sub3,
  type BimElement,
  type ElementId,
  type MepSystem,
  type PartInstance,
  type PipeDesign,
  type RunSegment,
} from "@permitzip/bim-kernel";
import { projectPlumbingSettings } from "./plumbing-catalog";
import type { DhwrDesign, WaterFlowTest } from "./plumbing-settings";

type Elements = Readonly<Record<string, BimElement>>;

const MM_PER_FT = 304.8;
const MM_PER_IN = 25.4;
export const WATER_STATIC_PSI_PER_FT = 0.433;
export const DHWR_DEFAULT_MAX_VELOCITY_FPS = 3;
export const DHWR_DEFAULT_DELTA_T_F = 10;
export const DHWR_DEFAULT_AMBIENT_TEMP_F = 70;
export const DHWR_DEFAULT_FITTING_ALLOWANCE_PCT = 30;

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ performance curves (EnergyPlus Issue #190 aligned)

/**
 * 1D tabular lookup curve aligned with EnergyPlus `Table:Lookup` conventions
 * (Issue #190): independent variable (`flow_gpm`) mapped to dependent variable
 * (`pressure_drop_psi`, `head_ft`, `efficiency`, `power_w`).
 */
export interface LookupPerformanceCurve {
  readonly kind: "table_lookup";
  readonly independentVar: "flow_gpm";
  readonly dependentVar: "pressure_drop_psi" | "head_ft" | "efficiency" | "power_w";
  readonly interpolation?: "linear" | "cubic";
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/**
 * Polynomial curve aligned with EnergyPlus `Curve:Quadratic` / `Curve:Cubic`
 * conventions (Issue #190): `c0 + c1*x + c2*x^2 (+ c3*x^3)`.
 */
export interface PolynomialPerformanceCurve {
  readonly kind: "quadratic" | "cubic";
  readonly independentVar: "flow_gpm";
  readonly dependentVar: "pressure_drop_psi" | "head_ft" | "efficiency" | "power_w";
  readonly coefficients: readonly [number, number, number] | readonly [number, number, number, number];
  readonly minX?: number;
  readonly maxX?: number;
}

export type PerformanceCurve = LookupPerformanceCurve | PolynomialPerformanceCurve;

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseCurvePoint(entry: unknown, dependentVar: PerformanceCurve["dependentVar"]): { readonly x: number; readonly y: number } | null {
  if (Array.isArray(entry) && entry.length >= 2) {
    const x = finiteNumber(entry[0]);
    const y = finiteNumber(entry[1]);
    return x !== null && y !== null ? { x, y } : null;
  }
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as Record<string, unknown>;
  const x = finiteNumber(obj.x) ?? finiteNumber(obj.gpm) ?? finiteNumber(obj.flow_gpm) ?? finiteNumber(obj.flowGpm);
  const y =
    finiteNumber(obj.y) ??
    (dependentVar === "pressure_drop_psi"
      ? (finiteNumber(obj.psi) ?? finiteNumber(obj.pressure_drop_psi) ?? finiteNumber(obj.dropPsi))
      : dependentVar === "head_ft"
        ? (finiteNumber(obj.headFt) ?? finiteNumber(obj.head_ft) ?? finiteNumber(obj.head))
        : finiteNumber(obj[dependentVar]));
  return x !== null && y !== null ? { x, y } : null;
}

/**
 * Parses a curve stored as a JSON string (part parameter value) or in-memory
 * array/object into a normalized Issue #190 `PerformanceCurve`. Accepts:
 *  - `PerformanceCurve` object (`table_lookup`, `quadratic`, `cubic`)
 *  - `[[gpm, y], ...]` tuple arrays
 *  - `[{ gpm, psi }]` / `[{ gpm, headFt }]` / `[{ x, y }]` point arrays
 */
export function parsePerformanceCurve(raw: unknown, dependentVar: PerformanceCurve["dependentVar"]): PerformanceCurve | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    const points = value.map((item) => parseCurvePoint(item, dependentVar)).filter((p): p is { readonly x: number; readonly y: number } => p !== null);
    if (points.length < 2) return null;
    points.sort((a, b) => a.x - b.x);
    return { kind: "table_lookup", independentVar: "flow_gpm", dependentVar, interpolation: "linear", points };
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (obj.kind === "table_lookup" && Array.isArray(obj.points)) {
    const points = obj.points.map((item) => parseCurvePoint(item, dependentVar)).filter((p): p is { readonly x: number; readonly y: number } => p !== null);
    if (points.length < 2) return null;
    points.sort((a, b) => a.x - b.x);
    const interpolation = obj.interpolation === "cubic" ? "cubic" : "linear";
    return { kind: "table_lookup", independentVar: "flow_gpm", dependentVar, interpolation, points };
  }
  if (obj.kind === "table_lookup" && Array.isArray(obj.independent) && Array.isArray(obj.dependent)) {
    const len = Math.min(obj.independent.length, obj.dependent.length);
    const points: Array<{ readonly x: number; readonly y: number }> = [];
    for (let i = 0; i < len; i++) {
      const x = finiteNumber(obj.independent[i]);
      const y = finiteNumber(obj.dependent[i]);
      if (x !== null && y !== null) points.push({ x, y });
    }
    if (points.length < 2) return null;
    points.sort((a, b) => a.x - b.x);
    const interpolation = obj.interpolation === "cubic" ? "cubic" : "linear";
    return { kind: "table_lookup", independentVar: "flow_gpm", dependentVar, interpolation, points };
  }
  if ((obj.kind === "quadratic" || obj.kind === "cubic") && Array.isArray(obj.coefficients)) {
    const coeffs = obj.coefficients.map(finiteNumber);
    if (coeffs.some((c) => c === null)) return null;
    if (obj.kind === "quadratic" && coeffs.length >= 3) {
      const minX = finiteNumber(obj.minX);
      const maxX = finiteNumber(obj.maxX);
      return {
        kind: "quadratic",
        independentVar: "flow_gpm",
        dependentVar,
        coefficients: [coeffs[0] as number, coeffs[1] as number, coeffs[2] as number],
        ...(minX !== null ? { minX } : {}),
        ...(maxX !== null ? { maxX } : {}),
      };
    }
    if (obj.kind === "cubic" && coeffs.length >= 4) {
      const minX = finiteNumber(obj.minX);
      const maxX = finiteNumber(obj.maxX);
      return {
        kind: "cubic",
        independentVar: "flow_gpm",
        dependentVar,
        coefficients: [coeffs[0] as number, coeffs[1] as number, coeffs[2] as number, coeffs[3] as number],
        ...(minX !== null ? { minX } : {}),
        ...(maxX !== null ? { maxX } : {}),
      };
    }
  }
  return null;
}

/** Evaluates a `PerformanceCurve` at `x` (linear lookup clamped at ends, or quadratic/cubic polynomial). */
export function evaluatePerformanceCurve(curve: PerformanceCurve, x: number): { readonly value: number; readonly extrapolated: boolean } {
  if (curve.kind === "table_lookup") {
    const pts = [...curve.points].sort((a, b) => a.x - b.x);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return { value: 0, extrapolated: false };
    if (x <= first.x) return { value: first.y, extrapolated: x < first.x - 1e-9 };
    if (x >= last.x) return { value: last.y, extrapolated: x > last.x + 1e-9 };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a && b && x <= b.x) {
        const y = b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
        return { value: y, extrapolated: false };
      }
    }
    return { value: last.y, extrapolated: false };
  }
  const [c0, c1, c2, c3] = curve.coefficients;
  const value = c0 + c1 * x + c2 * x * x + (c3 !== undefined ? c3 * x * x * x : 0);
  const extrapolated = (curve.minX !== undefined && x < curve.minX - 1e-9) || (curve.maxX !== undefined && x > curve.maxX + 1e-9);
  return { value, extrapolated };
}

// ------------------------------------------------------------------ inline device ΔP & pump curves

export interface DeviceLossResult {
  readonly elementId: ElementId;
  readonly label: string;
  readonly flowGpm: number;
  readonly lossPsi: number;
  readonly basis: "fixed" | "curve";
  readonly extrapolated: boolean;
}

export interface PumpCurveEvaluation {
  readonly curve: PerformanceCurve | null;
  readonly ratedGpm: number | null;
  readonly ratedHeadFt: number | null;
  readonly availableHeadAtDutyFt: number | null;
  readonly meetsDuty: boolean | null;
  readonly extrapolated: boolean;
}

function readPartParam(elements: Elements, part: PartInstance, key: string): unknown {
  if (part.values[key] !== undefined) return part.values[key];
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return undefined;
  return paramValue(type.definition, part.values, key);
}

/**
 * Evaluates an inline part's declared pressure drop (psi) at `flowGpm`.
 * Supports `pressure_drop_curve` (manufacturer flow-vs-drop points or Issue #190
 * curve) and fixed `pressure_drop_psi` on RPZ, water meter, PRV, softener,
 * strainer, or any custom inline part. Returns null if the part declares neither.
 */
export function evaluateDevicePressureDrop(
  elements: Elements,
  part: PartInstance,
  flowGpm: number,
): { readonly lossPsi: number; readonly basis: "fixed" | "curve"; readonly extrapolated: boolean } | null {
  const rawCurve = readPartParam(elements, part, "pressure_drop_curve");
  if (rawCurve !== undefined) {
    const curve = parsePerformanceCurve(rawCurve, "pressure_drop_psi");
    if (curve) {
      const ev = evaluatePerformanceCurve(curve, Math.max(0, flowGpm));
      return { lossPsi: Math.max(0, ev.value), basis: "curve", extrapolated: ev.extrapolated };
    }
  }
  const fixed = finiteNumber(readPartParam(elements, part, "pressure_drop_psi"));
  if (fixed !== null && fixed >= 0) {
    return { lossPsi: fixed, basis: "fixed", extrapolated: false };
  }
  return null;
}

/** Evaluates a pump part's curve (`pump_curve`) or rated duty against `(flowGpm, requiredHeadFt)`. */
export function evaluatePumpCurve(elements: Elements, part: PartInstance, flowGpm: number, requiredHeadFt: number): PumpCurveEvaluation {
  const rawCurve = readPartParam(elements, part, "pump_curve");
  const curve = rawCurve !== undefined ? parsePerformanceCurve(rawCurve, "head_ft") : null;
  const ratedGpm =
    finiteNumber(readPartParam(elements, part, "pump_rated_gpm")) ??
    finiteNumber(readPartParam(elements, part, "rated_gpm")) ??
    null;
  const ratedHeadFt =
    finiteNumber(readPartParam(elements, part, "pump_rated_head_ft")) ??
    finiteNumber(readPartParam(elements, part, "rated_head_ft")) ??
    null;
  if (curve) {
    const ev = evaluatePerformanceCurve(curve, Math.max(0, flowGpm));
    const head = Math.max(0, ev.value);
    return {
      curve,
      ratedGpm,
      ratedHeadFt,
      availableHeadAtDutyFt: r(head, 2),
      meetsDuty: head >= requiredHeadFt - 1e-6,
      extrapolated: ev.extrapolated,
    };
  }
  if (ratedGpm !== null && ratedHeadFt !== null) {
    return {
      curve: null,
      ratedGpm,
      ratedHeadFt,
      availableHeadAtDutyFt: r(ratedHeadFt, 2),
      meetsDuty: ratedGpm >= flowGpm - 1e-6 && ratedHeadFt >= requiredHeadFt - 1e-6,
      extrapolated: false,
    };
  }
  return { curve: null, ratedGpm, ratedHeadFt, availableHeadAtDutyFt: null, meetsDuty: null, extrapolated: false };
}

// ------------------------------------------------------------------ hydrant / water-service flow-test curve

export interface FlowTestSupplyResult {
  readonly staticPsi: number;
  readonly residualPsi: number;
  readonly testGpm: number;
  readonly elevationFt?: number;
  readonly frictionDropAtDesignPsi: number;
  readonly elevationAdjustPsi: number;
  readonly safetyMarginPsi: number;
  readonly availableAtDesignPsi: number;
  readonly extrapolated: boolean;
}

/**
 * Available supply pressure at `designGpm` from a municipal hydrant / service
 * flow test using the NFPA 291 / Hazen-Williams N^1.85 curve:
 *   P(Q) = P_static - (P_static - P_residual) * (Q / Q_test)^1.85
 *          + (z_test - z_root) * 0.433 - safetyMargin
 */
export function flowTestSupplyPsi(flowTest: WaterFlowTest, designGpm: number, rootElevationFt?: number): FlowTestSupplyResult {
  const dropAtTest = Math.max(0, flowTest.staticPsi - flowTest.residualPsi);
  const q = Math.max(0, designGpm);
  const frictionDropAtDesignPsi = q <= 0 || flowTest.testGpm <= 0 ? 0 : dropAtTest * (q / flowTest.testGpm) ** 1.85;
  const elevationAdjustPsi =
    flowTest.elevationFt !== undefined && rootElevationFt !== undefined
      ? (flowTest.elevationFt - rootElevationFt) * WATER_STATIC_PSI_PER_FT
      : 0;
  const safetyMarginPsi = flowTest.safetyMarginPsi ?? 0;
  const availableAtDesignPsi = flowTest.staticPsi - frictionDropAtDesignPsi + elevationAdjustPsi - safetyMarginPsi;
  return {
    staticPsi: r(flowTest.staticPsi, 2),
    residualPsi: r(flowTest.residualPsi, 2),
    testGpm: r(flowTest.testGpm, 2),
    ...(flowTest.elevationFt !== undefined ? { elevationFt: r(flowTest.elevationFt, 2) } : {}),
    frictionDropAtDesignPsi: r(frictionDropAtDesignPsi, 3),
    elevationAdjustPsi: r(elevationAdjustPsi, 3),
    safetyMarginPsi: r(safetyMarginPsi, 3),
    availableAtDesignPsi: r(availableAtDesignPsi, 3),
    extrapolated: q > flowTest.testGpm + 1e-9,
  };
}

/**
 * Resolves flow-test data for a water system.
 * Precedence: system/firm `design.flowTest` > explicit system `supplyPressurePsi` (disables project fallback) >
 * project `plumbing_settings.flowTests[system.id]` > project `plumbing_settings.flowTest`.
 */
export function resolveWaterFlowTest(elements: Elements, system: MepSystem, design: PipeDesign): WaterFlowTest | null {
  if (design.flowTest) return design.flowTest;
  if (system.design?.pipe?.supplyPressurePsi !== undefined) return null;
  const settings = projectPlumbingSettings(elements);
  return settings.flowTests?.[system.id] ?? settings.flowTest ?? null;
}

// ------------------------------------------------------------------ DHWR recirculation loop helpers

export interface DhwrPumpMetadata {
  readonly elementId: ElementId;
  readonly label: string;
  readonly external: boolean;
  readonly ratedGpm: number | null;
  readonly ratedHeadFt: number | null;
  readonly availableHeadAtDutyFt: number | null;
  readonly meetsDuty: boolean | null;
  readonly hasCurve: boolean;
}

export interface DhwrBufferTankMetadata {
  readonly elementId: ElementId | null;
  readonly label: string;
  readonly volumeGal: number | null;
  readonly standbyLossBtuh: number;
}

export interface DhwrLoopSummary {
  readonly flowBasis: "explicit_gpm" | "heat_loss_delta_t";
  readonly designFlowGpm: number;
  readonly deltaTF: number;
  readonly waterTempF: number;
  readonly ambientTempF: number;
  readonly pipeHeatLossBtuh: number;
  readonly bufferTankLossBtuh: number;
  readonly totalHeatLossBtuh: number;
  readonly loopLengthFt: number;
  readonly supplyLengthIncludedFt: number;
  readonly loopFrictionPsi: number;
  readonly deviceLossPsi: number;
  readonly totalHeadPsi: number;
  readonly totalHeadFt: number;
  readonly maxVelocityFps: number;
  readonly pump: DhwrPumpMetadata | null;
  readonly bufferTank: DhwrBufferTankMetadata | null;
}

/** Resolves DHWR loop design inputs (project defaults -> per-system catalog override -> system/firm PipeDesign). */
export function resolveDhwrDesign(elements: Elements, system: MepSystem, design: PipeDesign): DhwrDesign {
  const settings = projectPlumbingSettings(elements);
  return {
    ...(settings.dhwr ?? {}),
    ...(settings.dhwrBySystem?.[system.id] ?? {}),
    ...(design.dhwr ?? {}),
  };
}

/**
 * Steady-state heat loss (Btu/h) for one hot-water / DHWR pipe segment using
 * cylindrical radial conduction through pipe insulation plus exterior surface
 * convection/radiation (fiberglass k = 0.025 Btu/(h·ft·°F), h_o = 1.6 Btu/(h·ft²·°F)).
 */
export function pipeSegmentHeatLossBtuh(seg: RunSegment, tempF: number, ambientTempF = DHWR_DEFAULT_AMBIENT_TEMP_F, overrideBtuhPerFt?: number): number {
  const lenFt = len3(sub3(seg.end, seg.start)) / MM_PER_FT;
  if (lenFt <= 0) return 0;
  if (overrideBtuhPerFt !== undefined) return lenFt * Math.max(0, overrideBtuhPerFt);
  const dT = Math.max(0, tempF - ambientTempF);
  if (dT <= 0 || seg.size.shape !== "pipe") return 0;
  const odIn = pipeDims(seg.size).odMm / MM_PER_IN;
  const insIn = (seg.insulation?.thicknessMm ?? 0) / MM_PER_IN;
  const rPipeFt = Math.max(odIn / 2 / 12, 1e-4);
  const rOuterFt = rPipeFt + Math.max(0, insIn) / 12;
  const kIns = 0.025;
  const hOut = 1.6;
  const rCond = insIn > 0 ? Math.log(rOuterFt / rPipeFt) / (2 * Math.PI * kIns) : 0;
  const rConv = 1 / (2 * Math.PI * rOuterFt * hOut);
  const qPerFt = dT / (rCond + rConv);
  return lenFt * qPerFt;
}

/** Explicit DHWR recirculation flow (gpm) declared on a part via connector flow, params, or starter connection type (`RP`). */
export function dhwrPartFlowGpm(elements: Elements, part: PartInstance, connectorId?: string): number | null {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return null;
  if (connectorId) {
    const c = resolveConnectors(type.definition, part.values).find((x) => x.id === connectorId);
    if (c?.flow !== undefined && c.flow > 0) return c.flow;
  }
  for (const k of ["recirc_gpm", "design_gpm", "flow_gpm", "gpm_fixed"]) {
    const v = finiteNumber(readPartParam(elements, part, k));
    if (v !== null && v > 0) return v;
  }
  const ctName = partConnectionTypeName(elements, part);
  const ct = ctName ? connectionTypeOf(elements, ctName) : null;
  const ctGpm = ct?.quantities?.gpm_fixed;
  if (typeof ctGpm === "number" && ctGpm > 0) return ctGpm;
  return null;
}

export function isRecircPumpPart(elements: Elements, part: PartInstance): boolean {
  const type = elements[part.typeId];
  if (type?.kind !== "part_type") return false;
  const def = type.definition;
  const role = readPartParam(elements, part, "equipment_role") ?? readPartParam(elements, part, "pump_role");
  if (typeof role === "string" && /recirc|dhwr|circulat/i.test(role)) return true;
  if (readPartParam(elements, part, "pump_curve") !== undefined || readPartParam(elements, part, "pump_rated_gpm") !== undefined || readPartParam(elements, part, "recirc_gpm") !== undefined) {
    return resolveConnectors(def, part.values).some((c) => c.systemKind === "domestic_hot_water_return" || c.systemKind === "domestic_hot_water");
  }
  const conns = def.connectors;
  const hasHwrPair =
    conns.some((c) => c.systemKind === "domestic_hot_water_return" && c.flowDirection === "in") &&
    conns.some((c) => c.systemKind === "domestic_hot_water_return" && c.flowDirection === "out");
  return hasHwrPair && (def.category === "pipe_accessory" || def.category === "mechanical_equipment");
}

export function extractBufferTankMetadata(elements: Elements, parts: readonly PartInstance[], dhwrDesign: DhwrDesign): DhwrBufferTankMetadata | null {
  for (const part of parts) {
    const vol =
      finiteNumber(readPartParam(elements, part, "buffer_tank_gal")) ??
      finiteNumber(readPartParam(elements, part, "tank_volume_gal")) ??
      finiteNumber(readPartParam(elements, part, "volume_gal")) ??
      null;
    const standby =
      finiteNumber(readPartParam(elements, part, "buffer_tank_loss_btuh")) ??
      finiteNumber(readPartParam(elements, part, "standby_loss_btuh")) ??
      null;
    const role = readPartParam(elements, part, "tank_role") ?? readPartParam(elements, part, "equipment_role");
    const isBuffer = (typeof role === "string" && /buffer|storage/i.test(role)) || vol !== null || standby !== null;
    if (isBuffer) {
      return {
        elementId: part.id,
        label: partLabelOf(elements, part),
        volumeGal: vol ?? dhwrDesign.bufferTankGal ?? null,
        standbyLossBtuh: r(standby ?? dhwrDesign.bufferTankLossBtuh ?? 0, 1),
      };
    }
  }
  if (dhwrDesign.bufferTankGal !== undefined || dhwrDesign.bufferTankLossBtuh !== undefined) {
    return {
      elementId: null,
      label: "Buffer tank",
      volumeGal: dhwrDesign.bufferTankGal ?? null,
      standbyLossBtuh: r(dhwrDesign.bufferTankLossBtuh ?? 0, 1),
    };
  }
  return null;
}

export function extractRecircPumpPart(elements: Elements, parts: readonly PartInstance[]): PartInstance | null {
  return parts.find((p) => isRecircPumpPart(elements, p)) ?? null;
}

export function buildDhwrPumpMetadata(
  elements: Elements,
  pumpPart: PartInstance | null,
  designFlowGpm: number,
  requiredHeadFt: number,
  dhwrDesign: DhwrDesign,
): DhwrPumpMetadata | null {
  if (!pumpPart) return null;
  const ev = evaluatePumpCurve(elements, pumpPart, designFlowGpm, requiredHeadFt);
  const extParam = readPartParam(elements, pumpPart, "external_pump");
  const locParam = readPartParam(elements, pumpPart, "pump_location");
  const external =
    typeof extParam === "boolean"
      ? extParam
      : typeof locParam === "string"
        ? !/integral|internal/i.test(locParam)
        : (dhwrDesign.externalPump ?? true);
  return {
    elementId: pumpPart.id,
    label: partLabelOf(elements, pumpPart),
    external,
    ratedGpm: ev.ratedGpm,
    ratedHeadFt: ev.ratedHeadFt,
    availableHeadAtDutyFt: ev.availableHeadAtDutyFt,
    meetsDuty: ev.meetsDuty,
    hasCurve: ev.curve !== null,
  };
}
