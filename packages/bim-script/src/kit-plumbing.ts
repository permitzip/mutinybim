import {
  asElementId,
  builtinPartType,
  elementsOfKind,
  fittingFamilies,
  insertPartOnRun,
  len3,
  nominalInOf,
  partConnector,
  serviceOf,
  sub3,
  type Command,
  type GhostPlacement,
  type MepSystem,
  type ModelState,
  type PackCommand,
  type PartInstance,
  type PartTypeDefinition,
  type PipeDesign,
  type PipeDemandCurve,
  type PipeMaterial,
  type PipeSizingMode,
  type RunInsulation,
  type RunSegment,
  type RunSize,
  type SystemKind,
} from "@permitzip/bim-kernel";
import { measureIn, type Measure } from "@permitzip/bim-units";
import { ScriptRunError, type ScriptContext } from "./context";
import type { PlacedPart, PlanPoint } from "./kit-building";
import { routes, type RouteHandle, type RoutePoint } from "./kit-routes";
import { levelOf } from "./levels";
import { onWorking } from "./working";

/**
 * `plumbing`: commercial & residential plumbing and fuel-gas scripting helpers.
 *
 * Keeps `@permitzip/bim-script` strictly free of direct pack imports by issuing
 * ordinary kernel/pack commands (`set_system_design`, `set_pipe_sizes`,
 * `place_run_accessory`, `save_catalog_entry`, `set_pipe_insulation`,
 * `name_stacks`, `edit_stack`, `delete_stacks`, `set_stack_checks`, `route_run`)
 * and invoking registered plumbing calculations/reads/proposers via `ctx.calc`,
 * `ctx.read`, and `ctx.propose`.
 */

const MM_PER_IN = 25.4;
const MM_PER_FT = 304.8;
const IN_WC_PER_PSI = 27.679904842545;

// ------------------------------------------------------------------ shared unit helpers

function lengthMm(value: Measure | number, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError(`${what} must be a finite number.`);
    return Math.round(value * 1000) / 1000;
  }
  if (value.kind !== "length") throw new ScriptRunError(`${what} must be a length measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "mm") * 1000) / 1000;
}

function lengthIn(value: Measure | number, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError(`${what} must be a finite number.`);
    return value;
  }
  if (value.kind !== "length") throw new ScriptRunError(`${what} must be a length measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "in") * 10000) / 10000;
}

function lengthFt(value: Measure | number, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError(`${what} must be a finite number.`);
    return value;
  }
  if (value.kind !== "length") throw new ScriptRunError(`${what} must be a length measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "ft") * 10000) / 10000;
}

function pressureInWc(value: Measure | number, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError(`${what} must be a finite number.`);
    return value;
  }
  if (value.kind !== "pressure") throw new ScriptRunError(`${what} must be a pressure measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "in_wc") * 10000) / 10000;
}

function pressurePsi(value: Measure | number, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScriptRunError(`${what} must be a finite number.`);
    return value;
  }
  if (value.kind !== "pressure") throw new ScriptRunError(`${what} must be a pressure measure, got ${value.kind}.`);
  return Math.round(measureIn(value, "psi") * 10000) / 10000;
}

function resolvePipeSystem(model: ModelState, ref: string): MepSystem {
  const exact = model.elements[ref];
  if (exact?.kind === "mep_system" && exact.domain === "pipe") return exact;
  const low = ref.trim().toLowerCase();
  const byName = elementsOfKind(model.elements, "mep_system").find(
    (s) => s.domain === "pipe" && (s.id.toLowerCase() === low || s.name.trim().toLowerCase() === low),
  );
  if (byName) return byName;
  throw new ScriptRunError(`No pipe system "${ref}" found in the working model. Route a run on that system first or pass its system id.`);
}

function resolvePart(model: ModelState, ref: string | PlacedPart): PartInstance {
  const id = typeof ref === "string" ? ref : ref.id;
  const exact = model.elements[id];
  if (exact?.kind === "part") return exact;
  const low = id.trim().toLowerCase();
  const byMark = elementsOfKind(model.elements, "part").find((p) => p.mark.trim().toLowerCase() === low);
  if (byMark) return byMark;
  throw new ScriptRunError(`No placed part "${id}" found in the working model.`);
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ------------------------------------------------------------------ types

/** Water supply flow test curve data (aligned with WS-1 `design.pipe.flowTest`). */
export interface WaterFlowTestSpec {
  readonly staticPsi: number;
  readonly residualPsi: number;
  readonly testGpm: number;
  readonly elevationFt?: number;
  readonly safetyMarginPsi?: number;
  readonly testedAt?: string;
  readonly location?: string;
}

/** Domestic hot water recirculation loop design criteria (aligned with WS-1 `design.pipe.dhwr`). */
export interface DhwrDesignSpec {
  readonly deltaTF?: number;
  readonly heatLossBtuPerHrFt?: number;
  readonly maxVelocityFps?: number;
  readonly minVelocityFps?: number;
  readonly supplyTempF?: number;
  readonly returnTempF?: number;
  readonly pumpGpm?: number;
  readonly pumpHeadFt?: number;
  readonly bufferTankGal?: number;
  readonly aquastatLowF?: number;
  readonly aquastatHighF?: number;
}

export interface PipeWrapInsulationSpec {
  readonly thickness: Measure | number;
  readonly material?: string;
  readonly rValue?: number;
}

type SetSystemDesignCmd = Extract<Command, { type: "set_system_design" }>;

/**
 * Typed system design inputs for fuel gas, domestic water, DHWR, storm, and drainage
 * pipe systems (`plumbing.setSystemDesign`).
 */
export interface PlumbingSystemDesignSpec {
  /** Optional new name for the system. */
  readonly name?: string;
  /** System sizing mode (`"check"` audit-only or `"auto"`), or `null` to inherit the project setting. */
  readonly sizingMode?: PipeSizingMode | null;
  /** Hunter demand curve override (`"ashrae_a"`..`"ashrae_d"`, `"ipc_e_tank"`, `"ipc_e_valve"`, `"firm"`), or `null` to inherit. */
  readonly demandCurve?: PipeDemandCurve | null;
  // ---- Fuel gas ----
  /** Gas fuel type (`"natural_gas"` / `"natural"` or `"propane"`). */
  readonly fuel?: "natural" | "natural_gas" | "propane";
  /** Gas inlet pressure (`units.of("pressure", 2, "psi")` / `units.of("pressure", 7, "in_wc")` or plain in. w.c.). */
  readonly inletPressure?: Measure | number;
  /** Gas inlet pressure in inches of water column (in. w.c.). */
  readonly inletPressureInWc?: number;
  /** Gas inlet pressure in psi (converted to in. w.c.: `psi * 27.68`). */
  readonly inletPressurePsi?: number;
  /** Allowable gas pressure drop (`Measure` or plain in. w.c.). */
  readonly allowableDrop?: Measure | number;
  /** Allowable gas pressure drop in inches of water column (in. w.c.). */
  readonly allowableDropInWc?: number;
  /** Allowable gas pressure drop in psi (converted to in. w.c.). */
  readonly allowableDropPsi?: number;
  /** IFGC 402.4 sizing method (`"longest_length"` / `"longest_run"`, `"branch_length"`, or `"actual_length"`). */
  readonly gasSizing?: "longest_length" | "longest_run" | "branch_length" | "actual_length";
  readonly gasEquation?: "spitzglass" | "mueller";
  readonly specificGravity?: number;
  readonly heatingValueBtuPerCf?: number;
  // ---- Domestic water ----
  /** Supply / static pressure at the service entry (psi, or pressure `Measure`). */
  readonly staticPressure?: Measure | number;
  /** Supply / static pressure at the service entry, psi. */
  readonly staticPressurePsi?: number;
  /** Alias for `staticPressurePsi` (direct kernel field name). */
  readonly supplyPressurePsi?: number;
  /** Fixed entry losses before modeled piping (meter, backflow, strainer), psi or pressure `Measure`. */
  readonly fixedLosses?: Measure | number;
  readonly fixedLossesPsi?: number;
  /** Minimum operating pressure required at the critical fixture, psi or pressure `Measure`. */
  readonly minFixturePressure?: Measure | number;
  readonly minFixturePressurePsi?: number;
  readonly maxVelocityFps?: number;
  readonly waterTempF?: number;
  readonly hazenC?: number;
  readonly frictionMethod?: "hazen_williams" | "darcy";
  readonly fittingMethod?: "k" | "equivalent_length";
  readonly demandMethod?: "table" | "hunter_formula" | "flow_is_gpm";
  readonly demandTable?: readonly { readonly fu: number; readonly gpm: number }[];
  /** Per-fixture-family overrides for WSFU, DFU, and gas input (MBH). */
  readonly fixtureTable?: readonly { readonly fixture: string; readonly wsfu?: number; readonly dfu?: number; readonly mbh?: number }[];
  /** Municipal hydrant flow test data (WS-1 `design.pipe.flowTest`). */
  readonly flowTest?: WaterFlowTestSpec;
  // ---- DHWR ----
  /** Domestic hot water recirculation loop settings (WS-1 `design.pipe.dhwr`). */
  readonly dhwr?: DhwrDesignSpec;
  // ---- Storm ----
  /** Design rainfall intensity in inches per hour (e.g. `4` in/hr). */
  readonly rainfallInPerHr?: number;
  // ---- Drainage ----
  readonly slopes?: readonly { readonly maxNominalIn: number; readonly inPerFt: number }[];
  readonly fillRatio?: number;
  readonly manningN?: number;
  readonly capacityTable?: readonly { readonly nominalIn: number; readonly inPerFt?: number; readonly maxDfu: number }[];
  readonly directionRules?: PipeDesign["directionRules"];
  // ---- Default wrap insulation & fittings ----
  /** Default pipe wrap insulation for new runs on this system (`null` clears). */
  readonly insulation?: PipeWrapInsulationSpec | null;
  readonly fittingDefaults?: SetSystemDesignCmd["fittingDefaults"];
}

export interface PlumbingSizeSystemSpec {
  /** Pipe system id or name. */
  readonly system: string;
  /** Apply proposed sizes via `set_pipe_sizes` (default `false` — preview/propose only). */
  readonly apply?: boolean;
  /** When `apply: true`, also shrink pipes drawn larger than required (default `false` — upsize only). */
  readonly allowSmaller?: boolean;
  /** Fuel gas sizing method override (`"longest_length"` or `"branch_length"`). */
  readonly method?: "longest_length" | "branch_length";
  /** Optional segment id inside the system to disambiguate disconnected subnets. */
  readonly elementId?: string;
  /** Plumbing code edition (IPC family, e.g. `"2021"`). */
  readonly plumbingEdition?: string;
  /** Fuel gas code edition (IFGC family, e.g. `"2021"`). */
  readonly fuelGasEdition?: string;
  /** Two-letter state code for state-amended editions (e.g. `"VA"`). */
  readonly state?: string;
  /** Optional deterministic id prefix for any reducers created by `set_pipe_sizes`. */
  readonly idPrefix?: string;
}

export interface PlumbingPipeSizeChange {
  readonly segmentId: string;
  readonly label: string;
  readonly currentIn: number | null;
  readonly currentLabel: string | null;
  readonly proposedIn: number;
  readonly proposedLabel: string;
  readonly change: "up" | "down" | "same";
  readonly applied: boolean;
  readonly zoneId?: string;
  readonly governs?: string;
}

export interface PlumbingSizeSystemResult {
  readonly ok: boolean;
  readonly systemId: string;
  readonly systemName: string;
  readonly systemKind: SystemKind;
  readonly calcId: "plumbing.gas_system" | "plumbing.size_system";
  readonly applied: boolean;
  readonly appliedCount: number;
  /** Only the pipes whose size differs (or was applied). */
  readonly changes: readonly PlumbingPipeSizeChange[];
  /** Every evaluated pipe segment proposal. */
  readonly proposals: readonly PlumbingPipeSizeChange[];
  readonly findings: readonly { readonly code?: string; readonly severity: string; readonly message: string; readonly elementId?: string }[];
  readonly issues: readonly { readonly severity: string; readonly message: string }[];
  readonly summary: string;
  readonly totalMbh?: number;
  readonly totalLoad?: number;
  readonly designGpm?: number | null;
  readonly allowablePsiPer100Ft?: number | null;
  readonly zones?: readonly unknown[];
  readonly reason?: string;
  readonly raw: unknown;
}

export type PlumbingAccessoryKind =
  | "gas_regulator"
  | "regulator"
  | "gas_shutoff"
  | "gas_cock"
  | "drip_leg"
  | "sediment_trap"
  | "gas_union"
  | "ball_valve"
  | "shutoff_valve"
  | "gate_valve"
  | "check_valve"
  | "balancing_valve"
  | "prv"
  | "pressure_reducing_valve"
  | "cleanout"
  | "cleanout_tee"
  | "cleanout_wye"
  | "test_tee"
  | "p_trap"
  | "union"
  | "coupling"
  | "backflow"
  | "rpz"
  | "dcva"
  | "pvb";

export interface GasRegulatorParams {
  readonly role?: "line" | "service" | "appliance";
  /** Outlet pressure in inches of water column (e.g. `7` for 7" w.c., `11` for propane). */
  readonly outletInWc?: number;
  /** Outlet pressure in psi (converted to in. w.c., e.g. `2` psi → `55.36` in. w.c.). */
  readonly outletPsi?: number;
  /** Outlet pressure as a typed pressure `Measure`. */
  readonly outletPressure?: Measure;
  /** Allowable pressure drop downstream in in. w.c. (default `0.5`). */
  readonly dropInWc?: number;
  /** Allowable pressure drop downstream in psi. */
  readonly dropPsi?: number;
  /** Allowable pressure drop downstream as a typed pressure `Measure`. */
  readonly allowableDrop?: Measure;
  /** Regulator vent arrangement (IFGC 410.3). */
  readonly vent?: "vent_limiter" | "vent_to_outdoors" | "none";
  /** Rated regulator capacity in MBH. */
  readonly capacityMbh?: number;
}

export interface PlacePlumbingAccessorySpec {
  /** Straight pipe segment id. */
  readonly segment: string;
  /** Friendly accessory kind (maps to fitting family or inline part type). */
  readonly kind?: PlumbingAccessoryKind;
  /** Explicit pipe fitting family id (overrides `kind`, e.g. `"pipe.gas.regulator"`). */
  readonly family?: string;
  /** Explicit inline part type id (e.g. `"builtin:plumbing-rpz@1"`, `"builtin:plumbing-dcva@1"`). */
  readonly partTypeId?: string;
  /** Distance from segment start (`Measure` or mm). */
  readonly at?: Measure | number;
  /** Distance back from segment end (`Measure` or mm). */
  readonly fromEnd?: Measure | number;
  /** Fractional position along segment in `(0, 1)` when `at` and `fromEnd` are omitted (default `0.5`). */
  readonly fraction?: number;
  /** Typed parameters for gas pressure regulators (`pipe.gas.regulator`). */
  readonly regulator?: GasRegulatorParams;
  /** Drip leg / sediment trap capped nipple length (`Measure` or mm, default 3"). */
  readonly nippleLength?: Measure | number;
  /** Additional fitting family parameters (`joint`, `takeout_mm`, etc.). */
  readonly params?: Readonly<Record<string, number | string>>;
  /** Optional mark for inline parts (RPZ, DCVA, PVB). */
  readonly mark?: string;
  /** Flip inline part flow orientation. */
  readonly flip?: boolean;
  /** Optional explicit accessory / part id. */
  readonly id?: string;
}

export interface PlacePlumbingAccessoryResult {
  readonly id: string;
  readonly segmentId: string;
  readonly atMm: number;
  readonly mode: "accessory" | "inline_part";
  readonly family?: string;
  readonly partTypeId?: string;
}

export interface ProposeCleanoutsSpec {
  /** Specific drainage segment ids to inspect (defaults to horizontal drain segments of `system` or the model). */
  readonly segments?: readonly string[];
  /** Optional drainage system id or name (used when `segments` is omitted). */
  readonly system?: string;
  /** Maximum cleanout spacing (`Measure` or feet; default 100 ft per IPC 708.1). */
  readonly spacing?: Measure | number;
  /** Automatically insert proposed cleanouts in-line on their pipes (default `false`). */
  readonly apply?: boolean;
  /** Optional deterministic id prefix when `apply: true`. */
  readonly idPrefix?: string;
}

export interface CleanoutProposalSpot {
  readonly key: string;
  readonly segmentId: string;
  readonly atMm: number;
  readonly spot: string;
  readonly typeId: string;
  readonly reason: string;
}

export interface ProposeCleanoutsResult {
  readonly ghosts: readonly GhostPlacement[];
  readonly spots: readonly CleanoutProposalSpot[];
  readonly summary: string;
  readonly passes: boolean;
  readonly notes: readonly string[];
  readonly applied: boolean;
  readonly placedIds: readonly string[];
}

export interface StackEntrySpec {
  readonly stackId?: string;
  readonly pipeId: string;
  readonly number?: string;
  readonly name?: string;
  readonly systemCode?: string;
  readonly serves?: string;
}

export type ManageStackSpec =
  | { readonly action: "name" | "create"; readonly stacks: readonly StackEntrySpec[] }
  | ({ readonly action: "name" | "create" } & StackEntrySpec)
  | {
      readonly action: "edit" | "assign";
      readonly stackId: string;
      readonly number?: string;
      readonly name?: string | null;
      readonly systemCode?: string | null;
      readonly serves?: string | null;
      readonly pipeId?: string;
    }
  | { readonly action: "delete" | "remove"; readonly stackIds: string | readonly string[] }
  | { readonly action: "checks"; readonly baseClearanceDiameters: number | null }
  | { readonly action: "list" };

export interface ManageStackResult {
  readonly action: ManageStackSpec["action"];
  readonly stackIds?: readonly string[];
  readonly stacks?: readonly unknown[];
  readonly baseClearanceDiameters?: number | null;
}

export interface PipeInsulationScheduleRowSpec {
  readonly systemKinds: readonly SystemKind[];
  /** Upper nominal pipe size threshold for this band (`units.in(1.5)` or inches; use `48` for "and larger"). */
  readonly belowNominal: Measure | number;
  /** Insulation wrap thickness (`units.in(1)` or inches; `0` = uninsulated). */
  readonly thickness: Measure | number;
  readonly material?: string;
}

export interface SetInsulationScheduleSpec {
  readonly rows: readonly PipeInsulationScheduleRowSpec[];
  /** Source / code citation (e.g. `"IECC 2021 Table C403.12.3"`). */
  readonly source?: string;
  /** Optional project-level sizing mode to preserve/update alongside the insulation schedule. */
  readonly sizingMode?: PipeSizingMode;
  readonly buildingType?: "restaurant" | "hospital" | "nursing_home" | "dormitory" | "hotel" | "motel" | "apartment" | "office" | "school" | "other";
  readonly demandCurve?: PipeDemandCurve;
  /** Apply the schedule to matching pipe segments (`true` = all pipe systems, or list of system ids/names). */
  readonly applyToSystems?: boolean | readonly string[];
}

export interface SetInsulationScheduleResult {
  readonly saved: true;
  readonly rowCount: number;
  readonly source: string | null;
  readonly appliedSystems: readonly { readonly systemId: string; readonly updatedSegments: number }[];
}

export interface GasReportOptions {
  readonly method?: "longest_length" | "branch_length";
  readonly elementId?: string;
  readonly fuelGasEdition?: string;
  readonly state?: string;
}

export interface GasSystemReport {
  readonly ok: boolean;
  readonly systemId: string;
  readonly systemName: string;
  readonly method: string | null;
  readonly totalMbh: number | null;
  readonly zones: readonly unknown[];
  readonly proposals: readonly PlumbingPipeSizeChange[];
  readonly findings: readonly { readonly code?: string; readonly severity: string; readonly message: string; readonly elementId?: string }[];
  readonly issues: readonly { readonly severity: string; readonly message: string }[];
  readonly values: readonly { readonly key: string; readonly label: string; readonly value: unknown; readonly unit: string | null }[];
  readonly detail: unknown;
  readonly reason?: string;
}

export interface WaterPressureReportInput {
  readonly supplyKind?: "design_minimum" | "flow_test";
  readonly supplyPsi?: number;
  readonly meterLossPsi?: number;
  readonly backflowLossPsi?: number;
  readonly backflowDevice?: string;
  readonly tapLossPsi?: number;
  readonly prvLossPsi?: number;
  readonly otherLosses?: readonly { readonly label: string; readonly psi: number }[];
  readonly highestFixtureHeight?: Measure | number;
  readonly staticHeadPsiPerFt?: number;
  readonly criticalFixture?: string;
  readonly criticalFixturePsi?: number;
  readonly developedLength?: Measure | number;
}

export interface WaterReportOptions {
  readonly elementId?: string;
  readonly plumbingEdition?: string;
  readonly state?: string;
  /** Optional explicit inputs for `plumbing.pressure_report` (if omitted, derived from system design & sizing when possible). */
  readonly pressure?: WaterPressureReportInput;
}

export interface WaterSystemReport {
  readonly ok: boolean;
  readonly systemId: string;
  readonly systemName: string;
  readonly totalWsfu: number | null;
  readonly designGpm: number | null;
  readonly curve: string | null;
  readonly availablePsi: number | null;
  readonly allowablePsiPer100Ft: number | null;
  readonly developedLengthFt: number | null;
  readonly criticalFixture: string | null;
  readonly criticalPressurePsi: number | null;
  readonly hydraulicsPass: boolean | null;
  readonly proposals: readonly PlumbingPipeSizeChange[];
  readonly findings: readonly { readonly code?: string; readonly severity: string; readonly message: string; readonly elementId?: string }[];
  readonly pressureReport: {
    readonly ok: boolean;
    readonly availablePsi: number | null;
    readonly allowablePsiPer100Ft: number | null;
    readonly values: readonly { readonly key: string; readonly label: string; readonly value: unknown; readonly unit: string | null }[];
    readonly issues: readonly { readonly severity: string; readonly message: string }[];
  } | null;
  readonly issues: readonly { readonly severity: string; readonly message: string }[];
  readonly sizingRaw: unknown;
  readonly hydraulicsRaw: unknown;
}

export interface CombustionVentBranchSpec {
  /** Optional explicit equipment connector id (auto-detects flue/exhaust/vent or intake/combustion_air when omitted). */
  readonly connectorId?: string;
  readonly system?: { readonly id: string; readonly kind?: SystemKind; readonly name?: string };
  readonly size?: RunSize;
  /** Vent/intake diameter (defaults to 4"). */
  readonly diameter?: Measure;
  /** Pipe material for pipe-domain vents (default `"pvc"` for Category IV condensing; use `"galvanized"` for B-vent). */
  readonly material?: PipeMaterial;
  readonly domain?: "pipe" | "duct";
  /** Optional intermediate waypoints between the equipment and termination. */
  readonly points?: readonly RoutePoint[];
  /** Optional horizontal run height above `level` before rising to termination. */
  readonly height?: Measure;
  /** Optional separate termination point for intake (defaults to exhaust termination shifted by `offset`). */
  readonly termination?: { readonly x: Measure; readonly y: Measure; readonly height?: Measure };
  /** Horizontal separation from exhaust termination when intake shares `termination` (default 2 ft in +X). */
  readonly offset?: { readonly x?: Measure; readonly y?: Measure };
  readonly riseStyle?: "vertical" | "45" | "60" | "22.5";
  readonly capEnd?: boolean;
  readonly id?: string;
}

export interface ConnectCombustionVentSpec {
  /** Gas-fired equipment part id or `PlacedPart` (water heater, boiler, furnace, RTU). */
  readonly equipment: string | PlacedPart;
  /** Starting level id or name. */
  readonly level: string;
  /** Optional destination / roof level id or name. */
  readonly toLevel?: string;
  /** Termination location (plan XY and optional elevation above `toLevel` or `level`). */
  readonly termination: { readonly x: Measure; readonly y: Measure; readonly height?: Measure };
  /** Exhaust / flue configuration (always routed). */
  readonly exhaust?: CombustionVentBranchSpec;
  /** Combustion-air intake configuration (`true` uses 4" default intake, or pass a spec object). */
  readonly intake?: boolean | CombustionVentBranchSpec;
}

export interface ConnectCombustionVentResult {
  readonly equipmentId: string;
  readonly exhaust: RouteHandle;
  readonly intake?: RouteHandle;
}

// ------------------------------------------------------------------ internals

const ACCESSORY_FAMILY_MAP: Readonly<Record<string, string>> = {
  gas_regulator: "pipe.gas.regulator",
  regulator: "pipe.gas.regulator",
  gas_shutoff: "pipe.gas.cock",
  gas_cock: "pipe.gas.cock",
  drip_leg: "pipe.gas.drip_leg",
  sediment_trap: "pipe.gas.drip_leg",
  gas_union: "pipe.gas.union",
  ball_valve: "pipe.valve.ball",
  shutoff_valve: "pipe.valve.ball",
  gate_valve: "pipe.valve.gate",
  check_valve: "pipe.valve.check",
  prv: "pipe.valve.prv",
  pressure_reducing_valve: "pipe.valve.prv",
  cleanout: "dwv.cleanout_wye",
  cleanout_tee: "dwv.cleanout_tee",
  cleanout_wye: "dwv.cleanout_wye",
  test_tee: "dwv.test_tee",
  p_trap: "dwv.p_trap",
  union: "pipe.water.union",
  coupling: "pipe.water.coupling",
};

const INLINE_BACKFLOW_PART_MAP: Readonly<Record<string, string>> = {
  backflow: "builtin:plumbing-rpz@1",
  rpz: "builtin:plumbing-rpz@1",
  dcva: "builtin:plumbing-dcva@1",
  pvb: "builtin:plumbing-pvb@1",
};

function parseProposalsFromDetail(detail: unknown): PlumbingPipeSizeChange[] {
  const rec = asRecord(detail);
  const rawProposals = Array.isArray(rec?.proposals) ? rec.proposals : [];
  const out: PlumbingPipeSizeChange[] = [];
  for (const item of rawProposals) {
    const p = asRecord(item);
    if (!p || typeof p.segmentId !== "string" || typeof p.proposedIn !== "number") continue;
    const change = p.change === "up" || p.change === "down" || p.change === "same" ? p.change : "same";
    out.push({
      segmentId: p.segmentId,
      label: typeof p.label === "string" ? p.label : p.segmentId,
      currentIn: typeof p.currentIn === "number" ? p.currentIn : null,
      currentLabel: typeof p.current === "string" ? p.current : null,
      proposedIn: p.proposedIn,
      proposedLabel: typeof p.proposed === "string" ? p.proposed : `${p.proposedIn}"`,
      change,
      applied: false,
      ...(typeof p.zoneId === "string" ? { zoneId: p.zoneId } : {}),
      ...(typeof p.governs === "string" ? { governs: p.governs } : {}),
    });
  }
  return out;
}

function parseFindingsFromDetail(detail: unknown): Array<{ readonly code?: string; readonly severity: string; readonly message: string; readonly elementId?: string }> {
  const rec = asRecord(detail);
  const rawFindings = Array.isArray(rec?.findings) ? rec.findings : [];
  const out: Array<{ readonly code?: string; readonly severity: string; readonly message: string; readonly elementId?: string }> = [];
  for (const item of rawFindings) {
    const f = asRecord(item);
    if (!f || typeof f.message !== "string") continue;
    out.push({
      ...(typeof f.code === "string" ? { code: f.code } : {}),
      severity: typeof f.severity === "string" ? f.severity : "warning",
      message: f.message,
      ...(typeof f.elementId === "string" ? { elementId: f.elementId } : {}),
    });
  }
  return out;
}

function findMatchingConnectorId(
  model: ModelState,
  part: PartInstance,
  explicit: string | undefined,
  patterns: readonly RegExp[],
): string | null {
  const pt = model.elements[part.typeId];
  if (pt?.kind !== "part_type") return null;
  const connectors = pt.definition.connectors;
  if (explicit) {
    if (!connectors.some((c) => c.id === explicit)) {
      throw new ScriptRunError(`Part "${part.mark || part.id}" (${part.typeId}) has no connector "${explicit}". Available: ${connectors.map((c) => c.id).join(", ") || "none"}.`);
    }
    return explicit;
  }
  for (const re of patterns) {
    const hit = connectors.find((c) => re.test(c.id) || re.test(c.label));
    if (hit) return hit.id;
  }
  return null;
}

function equipmentTopPointMm(model: ModelState, part: PartInstance): { x: number; y: number; zAboveLevel: number } {
  const pt = model.elements[part.typeId];
  let heightMm = 1200;
  if (pt?.kind === "part_type") {
    const h = pt.definition.typeValues.height;
    if (typeof h === "number" && h > 0) heightMm = h;
  }
  return { x: part.position.x, y: part.position.y, zAboveLevel: part.offsetMm + heightMm };
}

function measureMm(mm: number): Measure {
  return { kind: "length", value: mm / 1000 };
}

function levelElevationMm(model: ModelState, levelId: string): number {
  const el = model.elements[levelId];
  return el?.kind === "level" ? el.elevationMm : 0;
}

// ------------------------------------------------------------------ public API

export const plumbing = {
  /**
   * Configures design parameters on a pipe system via `set_system_design`:
   * fuel gas (inlet pressure, allowable drop, longest vs branch length, natural gas / propane, heating value),
   * domestic water (static pressure, WS-1 `flowTest` curve, demand curve, fixed losses, velocity limit),
   * DHWR (WS-1 `dhwr` loop ΔT, heat loss, velocity, pump, buffer tank), storm (`rainfallInPerHr`),
   * and drainage (minimum slopes, fill ratio, Manning n, capacity/direction rules).
   */
  setSystemDesign(ctx: ScriptContext, systemRef: string, spec: PlumbingSystemDesignSpec): { readonly systemId: string } {
    const systemId = onWorking(ctx, "plumbing.setSystemDesign", (m) => {
      const existing = m.elements[systemRef];
      if (existing?.kind === "mep_system" && existing.domain === "pipe") return existing.id;
      const low = systemRef.trim().toLowerCase();
      const byName = elementsOfKind(m.elements, "mep_system").find(
        (s) => s.domain === "pipe" && (s.id.toLowerCase() === low || s.name.trim().toLowerCase() === low),
      );
      return byName?.id ?? systemRef;
    });

    const pipe: Record<string, unknown> = {};

    // Sizing overrides
    if (spec.sizingMode !== undefined) pipe.sizingMode = spec.sizingMode;
    if (spec.demandCurve !== undefined) pipe.demandCurve = spec.demandCurve;

    // Fuel gas
    if (spec.fuel !== undefined) pipe.gasType = spec.fuel === "natural_gas" ? "natural" : spec.fuel;
    if (spec.inletPressure !== undefined) {
      pipe.inletPressureInWc = pressureInWc(spec.inletPressure, "Inlet pressure");
    } else if (spec.inletPressurePsi !== undefined) {
      pipe.inletPressureInWc = Math.round(spec.inletPressurePsi * IN_WC_PER_PSI * 1000) / 1000;
    } else if (spec.inletPressureInWc !== undefined) {
      pipe.inletPressureInWc = spec.inletPressureInWc;
    }
    if (spec.allowableDrop !== undefined) {
      pipe.allowableDropInWc = pressureInWc(spec.allowableDrop, "Allowable pressure drop");
    } else if (spec.allowableDropPsi !== undefined) {
      pipe.allowableDropInWc = Math.round(spec.allowableDropPsi * IN_WC_PER_PSI * 1000) / 1000;
    } else if (spec.allowableDropInWc !== undefined) {
      pipe.allowableDropInWc = spec.allowableDropInWc;
    }
    if (spec.gasSizing !== undefined) {
      pipe.gasSizing = spec.gasSizing === "longest_length" ? "longest_run" : spec.gasSizing;
    }
    if (spec.gasEquation !== undefined) pipe.gasEquation = spec.gasEquation;
    if (spec.specificGravity !== undefined) pipe.specificGravity = spec.specificGravity;
    if (spec.heatingValueBtuPerCf !== undefined) pipe.heatingValueBtuPerCf = spec.heatingValueBtuPerCf;

    // Domestic water
    if (spec.staticPressure !== undefined) {
      pipe.supplyPressurePsi = pressurePsi(spec.staticPressure, "Static pressure");
    } else if (spec.staticPressurePsi !== undefined) {
      pipe.supplyPressurePsi = spec.staticPressurePsi;
    } else if (spec.supplyPressurePsi !== undefined) {
      pipe.supplyPressurePsi = spec.supplyPressurePsi;
    } else if (spec.flowTest !== undefined) {
      // Seed supplyPressurePsi from flow test residual so hydraulics works both with and before WS-1 flowTest schema.
      pipe.supplyPressurePsi = spec.flowTest.residualPsi;
    }
    if (spec.fixedLosses !== undefined) pipe.fixedLossesPsi = pressurePsi(spec.fixedLosses, "Fixed losses");
    else if (spec.fixedLossesPsi !== undefined) pipe.fixedLossesPsi = spec.fixedLossesPsi;
    if (spec.minFixturePressure !== undefined) pipe.minFixturePressurePsi = pressurePsi(spec.minFixturePressure, "Min fixture pressure");
    else if (spec.minFixturePressurePsi !== undefined) pipe.minFixturePressurePsi = spec.minFixturePressurePsi;
    if (spec.maxVelocityFps !== undefined) pipe.maxVelocityFps = spec.maxVelocityFps;
    if (spec.waterTempF !== undefined) pipe.waterTempF = spec.waterTempF;
    if (spec.hazenC !== undefined) pipe.hazenC = spec.hazenC;
    if (spec.frictionMethod !== undefined) pipe.frictionMethod = spec.frictionMethod;
    if (spec.fittingMethod !== undefined) pipe.fittingMethod = spec.fittingMethod;
    if (spec.demandMethod !== undefined) pipe.demandMethod = spec.demandMethod;
    if (spec.demandTable !== undefined) pipe.demandTable = [...spec.demandTable];
    if (spec.fixtureTable !== undefined) pipe.fixtureTable = [...spec.fixtureTable];
    if (spec.flowTest !== undefined) pipe.flowTest = { ...spec.flowTest };

    // DHWR (WS-1 schema)
    if (spec.dhwr !== undefined) {
      pipe.dhwr = { ...spec.dhwr };
      if (spec.dhwr.maxVelocityFps !== undefined && pipe.maxVelocityFps === undefined) {
        pipe.maxVelocityFps = spec.dhwr.maxVelocityFps;
      }
      if (spec.dhwr.supplyTempF !== undefined && pipe.waterTempF === undefined) {
        pipe.waterTempF = spec.dhwr.supplyTempF;
      }
    }

    // Storm
    if (spec.rainfallInPerHr !== undefined) pipe.rainfallInPerHr = spec.rainfallInPerHr;

    // Drainage
    if (spec.slopes !== undefined) pipe.slopes = [...spec.slopes];
    if (spec.fillRatio !== undefined) pipe.fillRatio = spec.fillRatio;
    if (spec.manningN !== undefined) pipe.manningN = spec.manningN;
    if (spec.capacityTable !== undefined) pipe.capacityTable = [...spec.capacityTable];
    if (spec.directionRules !== undefined) pipe.directionRules = [...spec.directionRules];

    const insulation: RunInsulation | null | undefined =
      spec.insulation === undefined
        ? undefined
        : spec.insulation === null
          ? null
          : {
              kind: "wrap",
              thicknessMm: lengthMm(spec.insulation.thickness, "Pipe insulation thickness"),
              ...(spec.insulation.material ? { material: spec.insulation.material } : {}),
              ...(spec.insulation.rValue !== undefined ? { rValue: spec.insulation.rValue } : {}),
            };

    const hasDesign = Object.keys(pipe).length > 0 || insulation !== undefined;
    ctx.edit({
      type: "set_system_design",
      systemId,
      ...(spec.name ? { name: spec.name } : {}),
      ...(hasDesign
        ? {
            design: {
              ...(Object.keys(pipe).length > 0 ? { pipe: pipe as PipeDesign } : {}),
              ...(insulation !== undefined ? { insulation } : {}),
            },
          }
        : {}),
      ...(spec.fittingDefaults ? { fittingDefaults: spec.fittingDefaults } : {}),
    });

    return { systemId };
  },

  /**
   * Sizes a fuel gas (`plumbing.gas_system`) or water/sanitary/vent/storm/DHWR
   * (`plumbing.size_system`) pipe system on the working model. When `apply: true`,
   * emits `set_pipe_sizes` (upsizing only unless `allowSmaller: true`) and returns
   * structured before/after pipe size changes and engineering findings.
   */
  sizeSystem(ctx: ScriptContext, spec: PlumbingSizeSystemSpec): PlumbingSizeSystemResult {
    const sys = onWorking(ctx, "plumbing.sizeSystem", (m) => resolvePipeSystem(m, spec.system));
    const isGas = sys.systemKind === "natural_gas" || serviceOf(sys.systemKind) === "gas";
    const calcId = isGas ? ("plumbing.gas_system" as const) : ("plumbing.size_system" as const);

    const calcResult = ctx.calc({
      calc: calcId,
      inputs: isGas
        ? {
            system_id: sys.id,
            ...(spec.method ? { method: spec.method } : {}),
            ...(spec.elementId ? { element_id: spec.elementId } : {}),
          }
        : { system_id: sys.id },
      ...(spec.plumbingEdition ? { plumbingEdition: spec.plumbingEdition } : {}),
      ...(spec.fuelGasEdition ? { fuelGasEdition: spec.fuelGasEdition } : {}),
      ...(spec.state ? { state: spec.state } : {}),
    });

    if (!calcResult.ok) {
      return {
        ok: false,
        systemId: sys.id,
        systemName: sys.name,
        systemKind: sys.systemKind,
        calcId,
        applied: false,
        appliedCount: 0,
        changes: [],
        proposals: [],
        findings: [],
        issues: [{ severity: "error", message: calcResult.reason }],
        summary: calcResult.reason,
        reason: calcResult.reason,
        raw: calcResult,
      };
    }

    const detail = calcResult.run.detail;
    const detailRec = asRecord(detail);
    const proposals = parseProposalsFromDetail(detail);
    const findings = parseFindingsFromDetail(detail);
    const issues = calcResult.run.issues.map((i) => ({ severity: i.severity, message: i.message }));
    const allowSmaller = spec.allowSmaller === true;
    const eligible = proposals.filter((p) => p.change === "up" || (allowSmaller && p.change === "down"));

    let applied = false;
    let appliedIds = new Set<string>();
    const blocking = findings.find((f) => f.code === "no_demand_curve" || f.code === "no_rainfall_rate");
    if (spec.apply === true && !blocking && eligible.length > 0) {
      const idPrefix = spec.idPrefix ?? ctx.id("size");
      ctx.edit({
        type: "set_pipe_sizes",
        idPrefix,
        systemId: sys.id,
        label: `Size ${eligible.length} pipe${eligible.length === 1 ? "" : "s"} on ${sys.name}`.slice(0, 160),
        sizes: eligible.map((p) => ({ segmentId: p.segmentId, nominalIn: p.proposedIn })),
      });
      applied = true;
      appliedIds = new Set(eligible.map((p) => p.segmentId));
    }

    const markedProposals = proposals.map((p) => ({ ...p, applied: appliedIds.has(p.segmentId) }));
    const changes = markedProposals.filter((p) => p.change !== "same");
    const designPoint = asRecord(detailRec?.designPoint);
    const summary = applied
      ? `Applied ${appliedIds.size} pipe size change${appliedIds.size === 1 ? "" : "s"} on ${sys.name}.`
      : changes.length > 0
        ? `${changes.length} pipe${changes.length === 1 ? "" : "s"} on ${sys.name} can be resized (${eligible.length} eligible; pass apply: true to commit).`
        : `${sys.name}: all ${markedProposals.length} pipes meet sizing criteria.`;

    return {
      ok: issues.every((i) => i.severity !== "error") || markedProposals.length > 0,
      systemId: sys.id,
      systemName: sys.name,
      systemKind: sys.systemKind,
      calcId,
      applied,
      appliedCount: appliedIds.size,
      changes,
      proposals: markedProposals,
      findings,
      issues,
      summary,
      ...(typeof detailRec?.totalMbh === "number" ? { totalMbh: detailRec.totalMbh } : {}),
      ...(typeof detailRec?.totalLoad === "number" ? { totalLoad: detailRec.totalLoad } : {}),
      ...(designPoint && typeof designPoint.gpm === "number" ? { designGpm: designPoint.gpm } : {}),
      ...(typeof detailRec?.allowablePsiPer100Ft === "number" ? { allowablePsiPer100Ft: detailRec.allowablePsiPer100Ft } : {}),
      ...(Array.isArray(detailRec?.zones) ? { zones: detailRec.zones } : {}),
      raw: calcResult,
    };
  },

  /**
   * Places an inline plumbing/gas accessory on a straight pipe segment using typed
   * length units (`at`, `fromEnd`, or `fraction`): gas pressure regulators (with typed
   * outlet/drop/vent params), gas shutoffs, drip legs, ball/gate/check/balancing valves,
   * cleanouts, P-traps, and inline backflow assemblies (RPZ, DCVA, PVB).
   */
  placeAccessory(ctx: ScriptContext, spec: PlacePlumbingAccessorySpec): PlacePlumbingAccessoryResult {
    const resolved = onWorking(ctx, "plumbing.placeAccessory", (m) => {
      const seg = m.elements[spec.segment];
      if (seg?.kind !== "run_segment" || seg.domain !== "pipe") {
        throw new ScriptRunError(`"${spec.segment}" is not a straight pipe segment in the working model.`);
      }
      const atMm = resolveStationMm(seg, spec, "plumbing.placeAccessory");

      // Inline part mode: explicit partTypeId OR backflow device kind (RPZ/DCVA/PVB)
      const inlinePartId = spec.partTypeId ?? (spec.kind ? INLINE_BACKFLOW_PART_MAP[spec.kind] : undefined);
      if (inlinePartId && !spec.family) {
        const existingType = m.elements[inlinePartId];
        const builtinDef = existingType?.kind === "part_type" ? existingType.definition : builtinPartType(inlinePartId)?.definition;
        if (!builtinDef) {
          throw new ScriptRunError(`Inline part type "${inlinePartId}" is not installed in this model or starter library.`);
        }
        const idPrefix = spec.id ?? ctx.id("acc");
        const plan = insertPartOnRun(m, {
          runId: seg.id,
          atMm,
          partDefinitionId: inlinePartId,
          ...(existingType?.kind === "part_type" ? {} : { partType: builtinDef }),
          idPrefix,
          ...(spec.flip ? { flip: true } : {}),
          ...(spec.mark ? { mark: spec.mark } : {}),
        });
        if ("refused" in plan) throw new ScriptRunError(`plumbing.placeAccessory: ${plan.refused}`);
        return { mode: "inline_part" as const, id: `${idPrefix}-part`, segmentId: seg.id, atMm, partTypeId: inlinePartId, commands: plan };
      }

      // Fitting-family accessory mode (`place_run_accessory`)
      let familyId = spec.family;
      if (!familyId && spec.kind === "balancing_valve") {
        const families = fittingFamilies();
        familyId = families.some((f) => f.id === "pipe.valve.balancing") ? "pipe.valve.balancing" : "pipe.valve.ball";
      } else if (!familyId && spec.kind) {
        familyId = ACCESSORY_FAMILY_MAP[spec.kind];
      }
      if (!familyId) {
        throw new ScriptRunError('plumbing.placeAccessory requires `kind`, `family`, or `partTypeId` (e.g. kind: "gas_regulator", "ball_valve", "drip_leg", "cleanout_wye", "rpz").');
      }

      const params: Record<string, number | string> = { ...(spec.params ?? {}) };
      if (spec.regulator) {
        if (spec.regulator.role !== undefined) params.role = spec.regulator.role;
        if (spec.regulator.outletPressure !== undefined) {
          params.outlet_in_wc = pressureInWc(spec.regulator.outletPressure, "Regulator outlet pressure");
        } else if (spec.regulator.outletPsi !== undefined) {
          params.outlet_in_wc = Math.round(spec.regulator.outletPsi * IN_WC_PER_PSI * 1000) / 1000;
        } else if (spec.regulator.outletInWc !== undefined) {
          params.outlet_in_wc = spec.regulator.outletInWc;
        }
        if (spec.regulator.allowableDrop !== undefined) {
          params.zone_drop_in_wc = pressureInWc(spec.regulator.allowableDrop, "Regulator allowable drop");
        } else if (spec.regulator.dropPsi !== undefined) {
          params.zone_drop_in_wc = Math.round(spec.regulator.dropPsi * IN_WC_PER_PSI * 1000) / 1000;
        } else if (spec.regulator.dropInWc !== undefined) {
          params.zone_drop_in_wc = spec.regulator.dropInWc;
        }
        if (spec.regulator.vent !== undefined) params.vent = spec.regulator.vent;
        if (spec.regulator.capacityMbh !== undefined) params.capacity_mbh = spec.regulator.capacityMbh;
      }
      if (spec.nippleLength !== undefined) {
        params.nipple_mm = lengthMm(spec.nippleLength, "Drip leg nipple length");
      }

      const accessoryId = spec.id ?? ctx.id("acc");
      return {
        mode: "accessory" as const,
        id: accessoryId,
        segmentId: seg.id,
        atMm,
        family: familyId,
        params,
      };
    });

    if (resolved.mode === "inline_part") {
      for (const cmd of resolved.commands) ctx.editSteps(cmd);
      return {
        id: resolved.id,
        segmentId: resolved.segmentId,
        atMm: resolved.atMm,
        mode: "inline_part",
        partTypeId: resolved.partTypeId,
      };
    }

    ctx.edit({
      type: "place_run_accessory",
      accessoryId: resolved.id,
      segmentId: resolved.segmentId,
      atMm: resolved.atMm,
      family: resolved.family,
      ...(Object.keys(resolved.params).length > 0 ? { params: resolved.params } : {}),
    });

    return {
      id: resolved.id,
      segmentId: resolved.segmentId,
      atMm: resolved.atMm,
      mode: "accessory",
      family: resolved.family,
    };
  },

  /**
   * Runs the `plumbing.cleanouts` spacing & direction-change proposer on horizontal
   * drain piping (upper end, >45° turns, every `spacing` ft, sewer connection) and
   * optionally inserts every proposed cleanout in-line when `apply: true`.
   */
  proposeCleanouts(ctx: ScriptContext, spec: ProposeCleanoutsSpec = {}): ProposeCleanoutsResult {
    const segmentIds = onWorking(ctx, "plumbing.proposeCleanouts", (m) => {
      if (spec.segments && spec.segments.length > 0) return [...spec.segments];
      const sysId = spec.system ? resolvePipeSystem(m, spec.system).id : null;
      const horizontalDrains = elementsOfKind(m.elements, "run_segment")
        .filter((s) => {
          if (s.domain !== "pipe") return false;
          if (sysId && s.systemId !== sysId) return false;
          const sys = m.elements[s.systemId];
          if (sys?.kind !== "mep_system" || serviceOf(sys.systemKind) !== "drainage") return false;
          const d = sub3(s.end, s.start);
          return Math.hypot(d.x, d.y) >= Math.abs(d.z);
        })
        .map((s) => s.id);
      if (horizontalDrains.length === 0) {
        throw new ScriptRunError(
          spec.system
            ? `No horizontal drainage pipe segments found on system "${spec.system}".`
            : "No horizontal drainage pipe segments found in the working model; pass `segments` or route a drain first.",
        );
      }
      return horizontalDrains;
    });

    const spacingFt = spec.spacing !== undefined ? lengthFt(spec.spacing, "Cleanout spacing") : undefined;
    const answer = ctx.propose("plumbing.cleanouts", {
      typeId: "builtin:plumbing-cleanout-inline@1",
      roomIds: segmentIds,
      ...(spacingFt !== undefined ? { options: { spacingFt } } : {}),
    });

    const spots: CleanoutProposalSpot[] = answer.ghosts.map((g) => {
      const rec = g as unknown as Record<string, unknown>;
      return {
        key: g.key,
        segmentId: typeof rec.segmentId === "string" ? rec.segmentId : g.roomId,
        atMm: typeof rec.atMm === "number" ? rec.atMm : 0,
        spot: typeof rec.spot === "string" ? rec.spot : "spacing",
        typeId: g.typeId,
        reason: g.reason,
      };
    });

    const placedIds: string[] = [];
    let applied = false;

    if (spec.apply === true && answer.ghosts.length > 0) {
      // Apply from far end back per segment so earlier cuts don't shift later station coordinates.
      const ordered = [...answer.ghosts].sort((a, b) => {
        const ra = a as unknown as Record<string, unknown>;
        const rb = b as unknown as Record<string, unknown>;
        const segA = typeof ra.segmentId === "string" ? ra.segmentId : a.roomId;
        const segB = typeof rb.segmentId === "string" ? rb.segmentId : b.roomId;
        if (segA !== segB) return segA.localeCompare(segB);
        const atA = typeof ra.atMm === "number" ? ra.atMm : 0;
        const atB = typeof rb.atMm === "number" ? rb.atMm : 0;
        return atB - atA;
      });

      const prefix = spec.idPrefix ?? ctx.id("co");
      for (const [idx, g] of ordered.entries()) {
        const rec = g as unknown as Record<string, unknown>;
        const segId = typeof rec.segmentId === "string" ? rec.segmentId : g.roomId;
        const atMm = typeof rec.atMm === "number" ? rec.atMm : 0;
        const partType = rec.partType as PartTypeDefinition | undefined;
        const itemPrefix = `${prefix}-${idx + 1}`;
        const plan = onWorking(ctx, "plumbing.proposeCleanouts:apply", (m) => {
          const pinned = m.elements[g.typeId]?.kind === "part_type";
          const fallbackDef = pinned ? undefined : (partType ?? builtinPartType(g.typeId)?.definition);
          return insertPartOnRun(m, {
            runId: asElementId(segId),
            atMm,
            partDefinitionId: g.typeId,
            ...(fallbackDef ? { partType: fallbackDef } : {}),
            idPrefix: itemPrefix,
          });
        });
        if ("refused" in plan) {
          // Graceful fallback to hosted wye cleanout accessory if inline part cannot fit
          const accId = `${itemPrefix}-acc`;
          ctx.edit({
            type: "place_run_accessory",
            accessoryId: accId,
            segmentId: segId,
            atMm,
            family: "dwv.cleanout_wye",
          });
          placedIds.push(accId);
        } else {
          for (const cmd of plan) ctx.editSteps(cmd);
          placedIds.push(`${itemPrefix}-part`);
        }
      }
      applied = placedIds.length > 0;
    }

    return {
      ghosts: answer.ghosts,
      spots,
      summary: answer.summary,
      passes: answer.passes,
      notes: answer.notes,
      applied,
      placedIds,
    };
  },

  /**
   * Manages vertical plumbing stacks: name/create stacks (`name_stacks`), edit or
   * re-assign a stack's number/name/systemCode/serves/pipe (`edit_stack`), delete stack
   * names (`delete_stacks`), set base-of-stack clearance checks (`set_stack_checks`),
   * or list stacks via `bim_plumbing_catalog`.
   */
  manageStack(ctx: ScriptContext, spec: ManageStackSpec): ManageStackResult {
    switch (spec.action) {
      case "list": {
        const catalog = ctx.read<{ readonly stacks?: readonly unknown[] }>("bim_plumbing_catalog", {});
        return { action: "list", stacks: catalog.stacks ?? [] };
      }
      case "name":
      case "create": {
        const entries: readonly StackEntrySpec[] = "stacks" in spec ? spec.stacks : [spec];
        if (entries.length === 0) throw new ScriptRunError("plumbing.manageStack requires at least one stack entry.");
        const stacks = entries.map((s) => ({
          stackId: s.stackId ?? ctx.id("stack"),
          pipeId: s.pipeId,
          ...(s.number !== undefined ? { number: s.number } : {}),
          ...(s.name !== undefined ? { name: s.name } : {}),
          ...(s.systemCode !== undefined ? { systemCode: s.systemCode } : {}),
          ...(s.serves !== undefined ? { serves: s.serves } : {}),
        }));
        ctx.edit({ type: "name_stacks", stacks } as PackCommand);
        return { action: spec.action, stackIds: stacks.map((s) => s.stackId) };
      }
      case "edit":
      case "assign": {
        ctx.edit({
          type: "edit_stack",
          stackId: spec.stackId,
          ...(spec.number !== undefined ? { number: spec.number } : {}),
          ...(spec.name !== undefined ? { name: spec.name } : {}),
          ...(spec.systemCode !== undefined ? { systemCode: spec.systemCode } : {}),
          ...(spec.serves !== undefined ? { serves: spec.serves } : {}),
          ...(spec.pipeId !== undefined ? { pipeId: spec.pipeId } : {}),
        } as PackCommand);
        return { action: spec.action, stackIds: [spec.stackId] };
      }
      case "delete":
      case "remove": {
        const ids = typeof spec.stackIds === "string" ? [spec.stackIds] : [...spec.stackIds];
        if (ids.length === 0) throw new ScriptRunError("plumbing.manageStack delete requires at least one stackId.");
        ctx.edit({ type: "delete_stacks", stackIds: ids } as PackCommand);
        return { action: spec.action, stackIds: ids };
      }
      case "checks": {
        ctx.edit({ type: "set_stack_checks", baseClearanceDiameters: spec.baseClearanceDiameters } as PackCommand);
        return { action: "checks", baseClearanceDiameters: spec.baseClearanceDiameters };
      }
    }
  },

  /**
   * Configures the project's pipe insulation schedule (`save_catalog_entry` type
   * `"plumbing_settings"`) using typed size & thickness units, and optionally applies
   * the schedule to routed pipe systems via `set_pipe_insulation`.
   */
  setInsulationSchedule(ctx: ScriptContext, spec: SetInsulationScheduleSpec): SetInsulationScheduleResult {
    const existing = onWorking(ctx, "plumbing.setInsulationSchedule", (m) => {
      const cat = elementsOfKind(m.elements, "service_catalog").find(
        (c) => c.entry.type === "plumbing_settings" && (c.entry as { name?: string }).name === "Project",
      );
      return cat ? (cat.entry as Record<string, unknown>) : null;
    });

    const pipeInsulation = spec.rows.map((r) => ({
      systemKinds: [...r.systemKinds],
      belowNominalIn: lengthIn(r.belowNominal, "Pipe insulation band belowNominal"),
      thicknessIn: lengthIn(r.thickness, "Pipe insulation thickness"),
      ...(r.material ? { material: r.material } : {}),
    }));

    const entry: Record<string, unknown> = {
      type: "plumbing_settings",
      name: "Project",
      sizingMode: spec.sizingMode ?? (existing?.sizingMode as PipeSizingMode | undefined) ?? "check",
      ...(spec.buildingType ?? existing?.buildingType ? { buildingType: spec.buildingType ?? existing?.buildingType } : {}),
      ...(spec.demandCurve ?? existing?.demandCurve ? { demandCurve: spec.demandCurve ?? existing?.demandCurve } : {}),
      pipeInsulation,
      ...(spec.source ? { pipeInsulationSource: spec.source } : {}),
    };

    ctx.edit({
      type: "save_catalog_entry",
      entry: entry as Extract<Command, { type: "save_catalog_entry" }>["entry"],
    });

    const appliedSystems: Array<{ readonly systemId: string; readonly updatedSegments: number }> = [];
    if (spec.applyToSystems) {
      const plans = onWorking(ctx, "plumbing.setInsulationSchedule:apply", (m) => {
        const targetSystems =
          spec.applyToSystems === true
            ? elementsOfKind(m.elements, "mep_system").filter((s) => s.domain === "pipe")
            : spec.applyToSystems
              ? spec.applyToSystems.map((ref) => resolvePipeSystem(m, ref))
              : [];

        const out: Array<{ systemId: string; systemName: string; pieces: Array<{ segmentId: string; insulation: RunInsulation | null }> }> = [];
        for (const sys of targetSystems) {
          const matchingRows = pipeInsulation
            .filter((r) => r.systemKinds.includes(sys.systemKind))
            .sort((a, b) => a.belowNominalIn - b.belowNominalIn);
          if (matchingRows.length === 0) continue;
          const pieces: Array<{ segmentId: string; insulation: RunInsulation | null }> = [];
          for (const seg of elementsOfKind(m.elements, "run_segment")) {
            if (seg.systemId !== sys.id || seg.size.shape !== "pipe") continue;
            const nomIn = nominalInOf(seg.size);
            const row = matchingRows.find((r) => nomIn < r.belowNominalIn - 1e-9);
            if (!row) continue;
            const ins: RunInsulation | null =
              row.thicknessIn > 0
                ? {
                    kind: "wrap",
                    thicknessMm: Math.round(row.thicknessIn * MM_PER_IN * 1000) / 1000,
                    ...(row.material ? { material: row.material } : {}),
                  }
                : null;
            pieces.push({ segmentId: seg.id, insulation: ins });
          }
          if (pieces.length > 0) out.push({ systemId: sys.id, systemName: sys.name, pieces });
        }
        return out;
      });

      for (const plan of plans) {
        ctx.edit({
          type: "set_pipe_insulation",
          systemId: plan.systemId,
          label: `Apply pipe insulation schedule to ${plan.systemName}`.slice(0, 160),
          pieces: plan.pieces,
        } as Command);
        appliedSystems.push({ systemId: plan.systemId, updatedSegments: plan.pieces.length });
      }
    }

    return {
      saved: true,
      rowCount: pipeInsulation.length,
      source: spec.source ?? null,
      appliedSystems,
    };
  },

  /**
   * Runs `plumbing.gas_system` (IFGC 402.4 zone-by-zone sizing & pressure drops) on a
   * fuel gas system and returns a clean typed readout of total MBH, pressure zones,
   * segment size proposals, and code findings.
   */
  gasReport(ctx: ScriptContext, systemRef: string, opts: GasReportOptions = {}): GasSystemReport {
    const sys = onWorking(ctx, "plumbing.gasReport", (m) => resolvePipeSystem(m, systemRef));
    const res = ctx.calc({
      calc: "plumbing.gas_system",
      inputs: {
        system_id: sys.id,
        ...(opts.method ? { method: opts.method } : {}),
        ...(opts.elementId ? { element_id: opts.elementId } : {}),
      },
      ...(opts.fuelGasEdition ? { fuelGasEdition: opts.fuelGasEdition } : {}),
      ...(opts.state ? { state: opts.state } : {}),
    });

    if (!res.ok) {
      return {
        ok: false,
        systemId: sys.id,
        systemName: sys.name,
        method: opts.method ?? null,
        totalMbh: null,
        zones: [],
        proposals: [],
        findings: [],
        issues: [{ severity: "error", message: res.reason }],
        values: [],
        detail: null,
        reason: res.reason,
      };
    }

    const detailRec = asRecord(res.run.detail);
    return {
      ok: res.run.issues.every((i) => i.severity !== "error") || detailRec !== null,
      systemId: sys.id,
      systemName: sys.name,
      method: typeof detailRec?.method === "string" ? detailRec.method : (opts.method ?? null),
      totalMbh: typeof detailRec?.totalMbh === "number" ? detailRec.totalMbh : null,
      zones: Array.isArray(detailRec?.zones) ? detailRec.zones : [],
      proposals: parseProposalsFromDetail(res.run.detail),
      findings: parseFindingsFromDetail(res.run.detail),
      issues: res.run.issues.map((i) => ({ severity: i.severity, message: i.message })),
      values: res.run.values.map((v) => ({ key: v.key, label: v.label, value: v.value, unit: v.unit })),
      detail: res.run.detail,
    };
  },

  /**
   * Runs `plumbing.size_system`, `plumbing.pipe_system`, and (when supply pressure &
   * fixture head data are available) `plumbing.pressure_report` on a domestic water
   * system, returning a unified typed summary of WSFU, design GPM, critical fixture
   * pressure, allowable friction, pipe proposals, and findings.
   */
  waterReport(ctx: ScriptContext, systemRef: string, opts: WaterReportOptions = {}): WaterSystemReport {
    const sys = onWorking(ctx, "plumbing.waterReport", (m) => resolvePipeSystem(m, systemRef));

    const sizing = ctx.calc({
      calc: "plumbing.size_system",
      inputs: { system_id: sys.id },
      ...(opts.plumbingEdition ? { plumbingEdition: opts.plumbingEdition } : {}),
      ...(opts.state ? { state: opts.state } : {}),
    });

    const hydraulics = ctx.calc({
      calc: "plumbing.pipe_system",
      inputs: {
        system_id: sys.id,
        ...(opts.elementId ? { element_id: opts.elementId } : {}),
      },
    });

    const sizingDetail = sizing.ok ? asRecord(sizing.run.detail) : null;
    const hydDetail = hydraulics.ok ? asRecord(hydraulics.run.detail) : null;
    const designPoint = asRecord(sizingDetail?.designPoint);
    const curveRec = asRecord(sizingDetail?.curve);
    const criticalRec = asRecord(hydDetail?.critical);

    const totalWsfu =
      typeof sizingDetail?.totalLoad === "number"
        ? sizingDetail.totalLoad
        : typeof hydDetail?.totalFixtureUnits === "number"
          ? hydDetail.totalFixtureUnits
          : null;
    const designGpm =
      designPoint && typeof designPoint.gpm === "number"
        ? designPoint.gpm
        : typeof hydDetail?.peakGpm === "number"
          ? hydDetail.peakGpm
          : null;
    const developedLengthFt = typeof sizingDetail?.developedLengthFt === "number" ? sizingDetail.developedLengthFt : null;

    // Optionally run plumbing.pressure_report when explicit pressure inputs or system supply pressure exist
    let pressureReport: WaterSystemReport["pressureReport"] = null;
    const supplyPsi = opts.pressure?.supplyPsi ?? sys.design?.pipe?.supplyPressurePsi;
    if (opts.pressure || supplyPsi !== undefined) {
      const p = opts.pressure;
      const effSupply = supplyPsi ?? 50;
      const highestFt = p?.highestFixtureHeight !== undefined ? lengthFt(p.highestFixtureHeight, "Highest fixture height") : 0;
      const devFt = p?.developedLength !== undefined ? lengthFt(p.developedLength, "Developed length") : (developedLengthFt ?? undefined);
      const pr = ctx.calc({
        calc: "plumbing.pressure_report",
        inputs: {
          supply: { kind: p?.supplyKind ?? "design_minimum", psi: effSupply },
          ...(p?.meterLossPsi !== undefined ? { meter_loss_psi: p.meterLossPsi } : {}),
          ...(p?.backflowLossPsi !== undefined ? { backflow_loss_psi: p.backflowLossPsi } : {}),
          ...(p?.backflowDevice ? { backflow_device: p.backflowDevice } : {}),
          ...(p?.tapLossPsi !== undefined ? { tap_loss_psi: p.tapLossPsi } : {}),
          ...(p?.prvLossPsi !== undefined ? { prv_loss_psi: p.prvLossPsi } : {}),
          ...(p?.otherLosses ? { other_losses: [...p.otherLosses] } : {}),
          highest_fixture_height_ft: highestFt,
          ...(p?.staticHeadPsiPerFt !== undefined ? { static_head_psi_per_ft: p.staticHeadPsiPerFt } : {}),
          ...(p?.criticalFixture ? { critical_fixture: p.criticalFixture } : {}),
          critical_fixture_psi: p?.criticalFixturePsi ?? sys.design?.pipe?.minFixturePressurePsi ?? 15,
          ...(devFt !== undefined && devFt > 0 ? { developed_length_ft: devFt } : {}),
          ...(totalWsfu !== null ? { total_wsfu: totalWsfu } : {}),
          ...(designGpm !== null ? { design_gpm: designGpm } : {}),
        },
        ...(opts.plumbingEdition ? { plumbingEdition: opts.plumbingEdition } : {}),
        ...(opts.state ? { state: opts.state } : {}),
      });
      if (pr.ok) {
        const prDetail = asRecord(pr.run.detail);
        pressureReport = {
          ok: pr.run.issues.every((i) => i.severity !== "error"),
          availablePsi: typeof prDetail?.availablePsi === "number" ? prDetail.availablePsi : null,
          allowablePsiPer100Ft: typeof prDetail?.allowablePsiPer100Ft === "number" ? prDetail.allowablePsiPer100Ft : null,
          values: pr.run.values.map((v) => ({ key: v.key, label: v.label, value: v.value, unit: v.unit })),
          issues: pr.run.issues.map((i) => ({ severity: i.severity, message: i.message })),
        };
      }
    }

    const issues: Array<{ readonly severity: string; readonly message: string }> = [
      ...(sizing.ok ? sizing.run.issues.map((i) => ({ severity: i.severity, message: i.message })) : [{ severity: "error", message: sizing.reason }]),
      ...(hydraulics.ok ? hydraulics.run.issues.map((i) => ({ severity: i.severity, message: i.message })) : [{ severity: "error", message: hydraulics.reason }]),
    ];

    return {
      ok: (sizing.ok || hydraulics.ok) && issues.every((i) => i.severity !== "error"),
      systemId: sys.id,
      systemName: sys.name,
      totalWsfu,
      designGpm,
      curve: typeof curveRec?.label === "string" ? curveRec.label : typeof curveRec?.id === "string" ? curveRec.id : null,
      availablePsi:
        typeof sizingDetail?.availablePsi === "number"
          ? sizingDetail.availablePsi
          : (pressureReport?.availablePsi ?? null),
      allowablePsiPer100Ft:
        typeof sizingDetail?.allowablePsiPer100Ft === "number"
          ? sizingDetail.allowablePsiPer100Ft
          : (pressureReport?.allowablePsiPer100Ft ?? null),
      developedLengthFt,
      criticalFixture: typeof criticalRec?.label === "string" ? criticalRec.label : null,
      criticalPressurePsi: typeof criticalRec?.pressure === "number" ? criticalRec.pressure : null,
      hydraulicsPass: typeof hydDetail?.pass === "boolean" ? hydDetail.pass : null,
      proposals: sizing.ok ? parseProposalsFromDetail(sizing.run.detail) : [],
      findings: sizing.ok ? parseFindingsFromDetail(sizing.run.detail) : [],
      pressureReport,
      issues,
      sizingRaw: sizing,
      hydraulicsRaw: hydraulics,
    };
  },

  /**
   * Routes combustion exhaust (flue) and optional combustion-air intake from a
   * gas-fired appliance (water heater, boiler, furnace) to its roof or sidewall
   * termination point. Auto-detects flue/intake connectors when declared on the part,
   * or rises cleanly from the top of the equipment envelope.
   */
  connectCombustionVent(ctx: ScriptContext, spec: ConnectCombustionVentSpec): ConnectCombustionVentResult {
    const resolved = onWorking(ctx, "plumbing.connectCombustionVent", (m) => {
      const part = resolvePart(m, spec.equipment);
      const startLevelId = levelOf(ctx, spec.level);
      const targetLevelId = spec.toLevel ? levelOf(ctx, spec.toLevel) : startLevelId;
      const levelShiftMm = levelElevationMm(m, targetLevelId) - levelElevationMm(m, startLevelId);
      const top = equipmentTopPointMm(m, part);

      const exhaustConnId = findMatchingConnectorId(m, part, spec.exhaust?.connectorId, [
        /^flue$/i,
        /combustion[_ -]?exhaust/i,
        /exhaust/i,
        /vent/i,
      ]);
      const intakeSpec = spec.intake === true ? {} : spec.intake || undefined;
      const intakeConnId = intakeSpec
        ? findMatchingConnectorId(m, part, intakeSpec.connectorId, [
            /combustion[_ -]?air/i,
            /intake/i,
            /outdoor[_ -]?air/i,
          ])
        : null;

      const partTypeEl = m.elements[part.typeId];
      const exhaustAnchor =
        exhaustConnId && partTypeEl?.kind === "part_type" ? partConnector(part, partTypeEl, exhaustConnId)?.position ?? null : null;
      const intakeAnchor =
        intakeConnId && partTypeEl?.kind === "part_type" ? partConnector(part, partTypeEl, intakeConnId)?.position ?? null : null;
      return {
        partId: part.id,
        startLevelId,
        levelShiftMm,
        top,
        exhaustConnId,
        exhaustAnchor,
        intakeSpec,
        intakeConnId,
        intakeAnchor,
      };
    });

    const routeBranch = (
      branch: CombustionVentBranchSpec | undefined,
      isIntake: boolean,
      connId: string | null,
      anchorPt: { x: number; y: number; z: number } | null,
    ): RouteHandle => {
      const domain = branch?.domain ?? (isIntake ? "duct" : "pipe");
      const dia = branch?.diameter ?? { kind: "length", value: (4 * MM_PER_IN) / 1000 };
      const size: RunSize =
        branch?.size ??
        (domain === "duct" ? routes.round(dia) : routes.pipe(dia, branch?.material ?? "pvc"));
      const system =
        branch?.system ??
        (isIntake
          ? domain === "duct"
            ? { id: "comb-air-1", kind: "outside_air" as SystemKind, name: "Combustion Air Intake" }
            : { id: "comb-air-1", kind: "vent" as SystemKind, name: "Combustion Air Intake" }
          : domain === "duct"
            ? { id: "flue-1", kind: "exhaust_air" as SystemKind, name: "Combustion Exhaust (Flue)" }
            : { id: "flue-1", kind: "vent" as SystemKind, name: "Combustion Exhaust (Flue)" });

      const termBase = branch?.termination ?? spec.termination;
      const offX = isIntake && !branch?.termination ? lengthMm(branch?.offset?.x ?? { kind: "length", value: (2 * MM_PER_FT) / 1000 }, "Intake offset x") : 0;
      const offY = isIntake && !branch?.termination ? lengthMm(branch?.offset?.y ?? { kind: "length", value: 0 }, "Intake offset y") : 0;
      const termX = measureMm(lengthMm(termBase.x, "Termination x") + offX);
      const termY = measureMm(lengthMm(termBase.y, "Termination y") + offY);
      const termAboveTargetMm = termBase.height ? lengthMm(termBase.height, "Termination height") : (spec.toLevel ? 2 * MM_PER_FT : 10 * MM_PER_FT);
      const termHeight = measureMm(resolved.levelShiftMm + termAboveTargetMm);

      const startX = measureMm((anchorPt?.x ?? resolved.top.x) + (isIntake && !anchorPt ? 200 : 0));
      const startY = measureMm(anchorPt?.y ?? resolved.top.y);
      const startZMm = anchorPt ? anchorPt.z : resolved.top.zAboveLevel;
      const horizHeight = branch?.height ?? measureMm(Math.max(startZMm + 600, resolved.top.zAboveLevel + 600));

      const pts: RoutePoint[] = [];
      if (!connId) {
        pts.push({ x: startX, y: startY, height: measureMm(startZMm) });
      }
      // Rise up to horizontal header height above equipment before running horizontally
      pts.push({ x: startX, y: startY, height: horizHeight });
      if (branch?.points) {
        for (const p of branch.points) pts.push(p);
      }
      // Run horizontally to termination XY, then rise to termination height
      const termXMm = lengthMm(termX, "Termination x");
      const termYMm = lengthMm(termY, "Termination y");
      const lastPrev = pts[pts.length - 1];
      const prevXMm = lastPrev ? lengthMm(lastPrev.x, "prev x") : 0;
      const prevYMm = lastPrev ? lengthMm(lastPrev.y, "prev y") : 0;
      if (Math.hypot(termXMm - prevXMm, termYMm - prevYMm) > 10) {
        pts.push({ x: termX, y: termY, height: horizHeight });
      }
      if (Math.abs(lengthMm(termHeight, "term h") - lengthMm(horizHeight, "horiz h")) > 10) {
        pts.push({ x: termX, y: termY, height: termHeight });
      }

      return routes.along(ctx, {
        level: resolved.startLevelId,
        domain,
        size,
        system: { id: system.id, kind: system.kind ?? (domain === "duct" ? (isIntake ? "outside_air" : "exhaust_air") : "vent"), ...(system.name ? { name: system.name } : {}) },
        ...(connId ? { from: routes.atConnector(resolved.partId, connId) } : { height: measureMm(startZMm) }),
        points: pts,
        ...(branch?.riseStyle ? { riseStyle: branch.riseStyle } : {}),
        ...(branch?.capEnd ? { capEnd: true } : {}),
        ...(branch?.id ? { id: branch.id } : {}),
      });
    };

    const exhaust = routeBranch(spec.exhaust, false, resolved.exhaustConnId, resolved.exhaustAnchor);
    const intake = resolved.intakeSpec
      ? routeBranch(resolved.intakeSpec, true, resolved.intakeConnId, resolved.intakeAnchor)
      : undefined;

    return {
      equipmentId: resolved.partId,
      exhaust,
      ...(intake ? { intake } : {}),
    };
  },
};

export type { PlanPoint };
