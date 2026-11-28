import { z } from "zod";
import { PIPE_DEMAND_CURVES, PIPE_SIZING_MODES, SYSTEM_KINDS, systemKindSchema, type PipeDemandCurve, type PipeSizingMode, type SystemKind } from "@permitzip/bim-kernel";

export { PIPE_SIZING_MODES, type PipeSizingMode } from "@permitzip/bim-kernel";

/**
 * (Round 12 P12: moved from the kernel; the stored `plumbing_settings` record
 * and its values are frozen.) Where the plumbing design choices the Plumbing tab exposes are kept. The
 * code tables and the curves themselves live in the calc packs
 * (packages/bim-calc plumbing settings); the kernel only stores the choices,
 * with the same values, so the ribbon, a system's properties, lint and the
 * sizing command all read one place:
 *
 * - **Project** (a catalog record, `plumbing_settings`, one per model):
 *   auto-sizing on or off, the building type, the demand curve.
 * - **System** (`design.pipe.sizingMode` / `design.pipe.demandCurve`): an
 *   override for one pipe system; absent, the project's applies.
 *
 * Auto-sizing never turns itself on: absent everywhere, it is "check" (audit
 * and suggest; nothing in the model changes).
 *
 * The project's pipe insulation schedule is kept here too: thickness by
 * system kind and pipe size band. The adopted energy code's table is not in
 * the code library, so the rows are the project's (or the firm's) own; the
 * edit that applies them (`set_pipe_insulation`) is one undo.
 */

/** Stored values the kernel's system design writer checks (`design.ts`); the same lists, under this add-on's names. */
export const PLUMBING_DEMAND_CURVES = PIPE_DEMAND_CURVES;
export type PlumbingDemandCurve = PipeDemandCurve;

export const DEMAND_CURVE_LABEL: Readonly<Record<PlumbingDemandCurve, string>> = {
  ashrae_a: "ASHRAE Curve A (restaurants)",
  ashrae_b: "ASHRAE Curve B (hospitals, hotels, dormitories)",
  ashrae_c: "ASHRAE Curve C (apartments)",
  ashrae_d: "ASHRAE Curve D (offices, schools)",
  ipc_e_tank: "IPC Appendix E, flush tanks",
  ipc_e_valve: "IPC Appendix E, flushometer valves",
  firm: "Firm curve",
  legacy_fit: "Hunter-style power fit (old default)",
};

export const PLUMBING_BUILDING_TYPES = ["restaurant", "hospital", "nursing_home", "dormitory", "hotel", "motel", "apartment", "office", "school", "other"] as const;
export type PlumbingBuildingType = (typeof PLUMBING_BUILDING_TYPES)[number];

export const BUILDING_TYPE_LABEL: Readonly<Record<PlumbingBuildingType, string>> = {
  restaurant: "Restaurant",
  hospital: "Hospital",
  nursing_home: "Nursing home",
  dormitory: "Dormitory",
  hotel: "Hotel",
  motel: "Motel",
  apartment: "Apartment building",
  office: "Office",
  school: "School",
  other: "Other",
};

/** The name the one project record is saved under. */
export const PLUMBING_SETTINGS_NAME = "Project";

/** One row of the pipe insulation schedule: pipes of these system kinds up to this nominal size (inches, inclusive of smaller rows' remainder) take this thickness; 0 means none. */
export const pipeInsulationRowSchema = z
  .object({
    systemKinds: z.array(systemKindSchema).min(1).max(SYSTEM_KINDS.length),
    /** Pipes smaller than this nominal size (inches) take the row; the last row for a kind can be 48 for "and larger". */
    belowNominalIn: z.number().positive().max(48),
    thicknessIn: z.number().min(0).max(6),
    material: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export type PipeInsulationRow = z.infer<typeof pipeInsulationRowSchema>;

/** Municipal hydrant or water-service flow test inputs (NFPA 291 / Hazen-Williams N^1.85 curve). */
export const waterFlowTestSchema = z
  .object({
    /** Static pressure at 0 gpm (psi). */
    staticPsi: z.number().finite().positive().max(300),
    /** Residual pressure measured during the flow test (psi). */
    residualPsi: z.number().finite().min(0).max(300),
    /** Flow rate measured during the flow test (gpm). */
    testGpm: z.number().finite().positive().max(100_000),
    /** Elevation of the test hydrant / gauge relative to project zero datum (ft). */
    elevationFt: z.number().finite().min(-1_000).max(20_000).optional(),
    /** Optional safety margin subtracted from available pressure (psi). */
    safetyMarginPsi: z.number().finite().min(0).max(100).optional(),
    /** Optional test date / identifier metadata. */
    testedAt: z.string().trim().min(1).max(80).optional(),
    location: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export type WaterFlowTest = z.infer<typeof waterFlowTestSchema>;

/** Domestic hot water recirculation (DHWR) loop design inputs. */
export const dhwrDesignSchema = z
  .object({
    /** Explicit recirculation loop flow (gpm). Overrides heat-loss / delta-T calculation when set. */
    designFlowGpm: z.number().finite().positive().max(1_000).optional(),
    /** Allowable loop temperature drop (°F), default 10 °F. */
    deltaTF: z.number().finite().positive().max(60).optional(),
    /** Explicit total loop heat loss (Btu/h), overrides per-segment pipe heat-loss calculation. */
    heatLossBtuh: z.number().finite().min(0).max(10_000_000).optional(),
    /** Override heat loss per linear foot of piping (Btu/h·ft). */
    heatLossBtuhPerFt: z.number().finite().min(0).max(500).optional(),
    /** Optional DHW supply loop length included in heat loss (ft). When omitted, DHW supply length is estimated from the return loop. */
    supplyLoopLengthFt: z.number().finite().min(0).max(100_000).optional(),
    /** Ambient air temperature around piping (°F), default 70 °F. */
    ambientTempF: z.number().finite().min(0).max(130).optional(),
    /** Fitting equivalent length allowance as a percent of developed loop length, default 30%. */
    fittingAllowancePct: z.number().finite().min(0).max(200).optional(),
    /** Velocity limit for DHWR sizing (ft/s), default 3 ft/s. */
    maxVelocityFps: z.number().finite().positive().max(15).optional(),
    /** Optional friction limit for DHWR sizing (psi per 100 ft). */
    maxFrictionPsiPer100Ft: z.number().finite().positive().max(20).optional(),
    /** Buffer / storage tank volume (gal), when separate from a modeled part. */
    bufferTankGal: z.number().finite().min(0).max(50_000).optional(),
    /** Buffer / storage tank standby heat loss (Btu/h). */
    bufferTankLossBtuh: z.number().finite().min(0).max(500_000).optional(),
    /** Whether the recirc pump is external to the water heater. */
    externalPump: z.boolean().optional(),
  })
  .strict();
export type DhwrDesign = z.infer<typeof dhwrDesignSchema>;

/** Configurable horizontal drain cleanout spacing band, smallest maxNominalIn first. */
export const cleanoutSpacingBandSchema = z
  .object({
    /** Applies to horizontal drains at or below this nominal diameter (inches). */
    maxNominalIn: z.number().finite().positive().max(1000),
    /** Maximum developed spacing between cleanouts (ft). */
    spacingFt: z.number().finite().positive().max(1000),
  })
  .strict();
export type CleanoutSpacingBand = z.infer<typeof cleanoutSpacingBandSchema>;

declare module "@permitzip/bim-kernel" {
  interface PipeDesign {
    /** Hydrant or service flow-test curve inputs for domestic water systems. */
    readonly flowTest?: WaterFlowTest;
    /** Domestic hot water recirculation loop sizing inputs. */
    readonly dhwr?: DhwrDesign;
  }
}

export const plumbingSettingsEntrySchema = z
  .object({
    type: z.literal("plumbing_settings"),
    name: z.literal(PLUMBING_SETTINGS_NAME).default(PLUMBING_SETTINGS_NAME),
    sizingMode: z.enum(PIPE_SIZING_MODES).default("check"),
    buildingType: z.enum(PLUMBING_BUILDING_TYPES).optional(),
    demandCurve: z.enum(PLUMBING_DEMAND_CURVES).optional(),
    /** Pipe insulation by system kind and size band; absent: no schedule yet. */
    pipeInsulation: z.array(pipeInsulationRowSchema).max(80).optional(),
    /** Where the schedule's values come from, in words ("IECC 2021 Table C403.12.3 via the firm's spec"). */
    pipeInsulationSource: z.string().trim().min(1).max(200).optional(),
    /** Project-level hydrant/service flow test data (overridden by per-system flowTests or system design). */
    flowTest: waterFlowTestSchema.optional(),
    /** Per-system hydrant/service flow test data, keyed by system element id. */
    flowTests: z.record(z.string().min(1).max(200), waterFlowTestSchema).optional(),
    /** Project-level DHWR loop design defaults. */
    dhwr: dhwrDesignSchema.optional(),
    /** Per-system DHWR loop design overrides, keyed by system element id. */
    dhwrBySystem: z.record(z.string().min(1).max(200), dhwrDesignSchema).optional(),
    /** Flat cleanout spacing override (ft), overrides cleanoutSpacingBySize when set. */
    cleanoutSpacingFt: z.number().finite().positive().max(1000).optional(),
    /** Per-size horizontal drain cleanout spacing bands (default 50 ft <= 3", 100 ft >= 4"). */
    cleanoutSpacingBySize: z.array(cleanoutSpacingBandSchema).min(1).max(20).optional(),
  })
  .strict();
export type PlumbingSettingsEntry = z.infer<typeof plumbingSettingsEntrySchema>;

export const DEFAULT_PLUMBING_SETTINGS_ENTRY: PlumbingSettingsEntry = { type: "plumbing_settings", name: PLUMBING_SETTINGS_NAME, sizingMode: "check" };

/**
 * The project record and a system override in the shape the calc pack's
 * `resolveSizingMode` / `resolveDemandCurve` take (packages/bim-calc
 * plumbing settings), so the kernel never decides the mode on its own.
 */
export function sizingInputs(
  project: PlumbingSettingsEntry | null,
  system: { readonly sizingMode?: PipeSizingMode | null; readonly demandCurve?: PlumbingDemandCurve | null } | null | undefined,
): { readonly project: { readonly sizing_mode: PipeSizingMode; readonly building_type?: PlumbingBuildingType; readonly demand_curve?: PlumbingDemandCurve }; readonly system: { readonly sizing_mode?: PipeSizingMode; readonly demand_curve?: PlumbingDemandCurve } } {
  const p = project ?? DEFAULT_PLUMBING_SETTINGS_ENTRY;
  return {
    project: { sizing_mode: p.sizingMode, ...(p.buildingType ? { building_type: p.buildingType } : {}), ...(p.demandCurve ? { demand_curve: p.demandCurve } : {}) },
    system: { ...(system?.sizingMode ? { sizing_mode: system.sizingMode } : {}), ...(system?.demandCurve ? { demand_curve: system.demandCurve } : {}) },
  };
}

/**
 * The schedule's insulation for one pipe: the first row for its system kind
 * whose band the size is below (rows are read smallest band first). Null:
 * the schedule says nothing for this pipe; `{ thicknessIn: 0 }`: it says none.
 */
export function scheduledPipeInsulation(rows: readonly PipeInsulationRow[] | undefined, kind: SystemKind, nominalIn: number): { readonly thicknessIn: number; readonly material?: string } | null {
  const mine = (rows ?? []).filter((r) => r.systemKinds.includes(kind)).sort((a, b) => a.belowNominalIn - b.belowNominalIn);
  const row = mine.find((r) => nominalIn < r.belowNominalIn - 1e-9) ?? null;
  return row ? { thicknessIn: row.thicknessIn, ...(row.material ? { material: row.material } : {}) } : null;
}
