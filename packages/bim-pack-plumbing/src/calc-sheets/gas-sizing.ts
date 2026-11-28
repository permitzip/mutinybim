import { nominalInOf, PIPE_DESIGN_DEFAULTS, pipeSegmentOf, pipeSpec, runLabel, specOfSize, type ElementId, type MepSystem, type ModelState, type RunSegment } from "@permitzip/bim-kernel";
import { evaluateCalcSheet, type CalcSheetBuildRequest, type CalcSheetCitation, type CalcSheetContext, type CalcSheetEvaluation, type CalcSheetSpec, type CalcSheetTemplateRow, type CalcTable, type CalcTableSource, type GoverningCell } from "@permitzip/bim-kernel/calc-sheets";
import { highPressureCfh, lowPressureCfh, nominalLabel, usesHighPressure } from "@permitzip/bim-calc";
import { GAS_FUEL_LABEL } from "../routing/pipe/gas-fuel";
import { gasNetwork, pressureLabel, segmentBranchLengthFt, type GasNetwork, type GasZone } from "../routing/pipe/gas-zones";

/**
 * Gas pipe sizing as a live sheet (round 12 P12, upgraded in WS-1).
 *
 * Supports both IFGC 402.4.1 longest-length (`gas.zone_longest`) and IFGC
 * 402.4.2 branch-length (`gas.branch_length`) sizing methods, optional
 * system-level or segment-level subjects, multi-segment / multi-zone summaries
 * (`gasZoneSizingSummary`), and a built-in IFGC 402.4 equation-generated
 * capacity table fallback (`builtinIfgcGasTable`, `withBuiltinGasTables`,
 * `evaluateGasSizingSheet`) so the live sheet evaluates out-of-the-box when no
 * firm `gas_sizing_table` is uploaded while still deferring to any firm or
 * project table that IS provided.
 */

export const GAS_SIZING_TEMPLATE_ID = "gas_sizing";
/** The library table slot the sheet reads unless a request names another (`options.table`). */
export const GAS_SIZING_TABLE_SLOT = "gas_sizing_table";

const IN_WC_PER_PSI = 27.68;
const MM_PER_IN = 25.4;

/** Standard IFGC developed length rows (ft) used for the built-in equation fallback table. */
export const IFGC_FALLBACK_LENGTHS_FT: readonly number[] = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900, 1000,
];

function tableSlot(request: CalcSheetBuildRequest): string {
  const t = request.options?.table;
  return typeof t === "string" && t.trim() !== "" ? t : GAS_SIZING_TABLE_SLOT;
}

function methodOverride(request: CalcSheetBuildRequest): "longest_length" | "branch_length" | null {
  const m = request.options?.method;
  return m === "longest_length" || m === "branch_length" ? m : null;
}

/** Resolve either a gas segment or a gas system (picking its governing root/header segment). */
function resolveSubject(model: Pick<ModelState, "elements">, subjectId: ElementId | undefined): { readonly seg: RunSegment; readonly system: MepSystem; readonly network: GasNetwork } | { readonly refused: string } {
  if (!subjectId) return { refused: "Pick the gas pipe this sheet sizes" };
  const directSeg = pipeSegmentOf(model.elements, subjectId);
  if (directSeg) {
    const system = model.elements[directSeg.systemId];
    if (system?.kind !== "mep_system" || system.systemKind !== "natural_gas") {
      return { refused: "Gas sizing needs a gas pipe: pick a piece of a gas system" };
    }
    const net = gasNetwork(model, system.id);
    if (!net) return { refused: "Gas sizing needs a gas pipe: pick a piece of a gas system" };
    return { seg: directSeg, system, network: net };
  }
  const sys = model.elements[subjectId];
  if (sys?.kind === "mep_system" && sys.systemKind === "natural_gas") {
    const net = gasNetwork(model, sys.id);
    if (!net) return { refused: `${sys.name} has no drawn gas pipe yet` };
    // Pick the governing segment (highest carried MBH across zones, tie-breaking by longest developed length).
    let best: { seg: RunSegment; mbh: number; from: number } | null = null;
    for (const z of net.zones) {
      for (const s of z.segments) {
        if (!s.elementId) continue;
        const el = pipeSegmentOf(model.elements, s.elementId);
        if (!el) continue;
        if (!best || s.loadMbh > best.mbh + 1e-6 || (Math.abs(s.loadMbh - best.mbh) <= 1e-6 && s.fromSourceFt < best.from)) {
          best = { seg: el, mbh: s.loadMbh, from: s.fromSourceFt };
        }
      }
    }
    if (!best) return { refused: `${sys.name} has no drawn gas pipe yet` };
    return { seg: best.seg, system: sys, network: net };
  }
  return { refused: "Gas sizing needs a gas pipe: pick a piece of a gas system" };
}

function zoneForSegment(net: GasNetwork, segmentId: ElementId): GasZone | null {
  let best: { zone: GasZone; from: number } | null = null;
  for (const z of net.zones) {
    for (const s of z.segments) {
      if (s.elementId === segmentId && (best === null || s.fromSourceFt < best.from)) {
        best = { zone: z, from: s.fromSourceFt };
      }
    }
  }
  return best?.zone ?? net.zones[0] ?? null;
}

/**
 * Build a built-in IFGC 402.4 capacity table for a gas segment or system using
 * the IFGC low-pressure (Eq. 4-1) or high-pressure (Eq. 4-2, >= 1.5 psi)
 * equations over the pipe's actual material/spec sizes.
 */
export function builtinIfgcGasTable(
  model: Pick<ModelState, "elements">,
  subjectId: ElementId | undefined,
  options: { readonly zone?: GasZone; readonly lengthsFt?: readonly number[] } = {},
): CalcTable | null {
  const resolved = resolveSubject(model, subjectId);
  if ("refused" in resolved) return null;
  const { seg, system, network } = resolved;
  const zone = options.zone ?? zoneForSegment(network, seg.id);
  const inletInWc = zone?.inletInWc ?? system.design?.pipe?.inletPressureInWc ?? PIPE_DESIGN_DEFAULTS.inletPressureInWc;
  const dropInWc = zone?.allowableDropInWc ?? system.design?.pipe?.allowableDropInWc ?? PIPE_DESIGN_DEFAULTS.allowableDropInWc;
  const inletPsi = inletInWc / IN_WC_PER_PSI;
  const dropPsi = dropInWc / IN_WC_PER_PSI;
  const highP = usesHighPressure({ value: inletPsi, unit: "psi", lessThan: false });
  const spec = (seg.size.shape === "pipe" ? specOfSize(seg.size) : null) ?? pipeSpec("black_steel", "sch40");
  if (!spec || spec.sizes.length === 0) return null;
  const sizes = [...spec.sizes].filter((s) => s.nominalIn >= 0.375 && s.nominalIn <= 12).sort((a, b) => a.nominalIn - b.nominalIn);
  if (sizes.length === 0) return null;
  const rows = [...(options.lengthsFt ?? IFGC_FALLBACK_LENGTHS_FT)];
  const columns = sizes.map((s) => nominalLabel(s.nominalIn));
  const values = rows.map((lengthFt) =>
    sizes.map((s) => {
      const idIn = s.idMm / MM_PER_IN;
      const cfh = highP
        ? highPressureCfh(idIn, lengthFt, inletPsi, Math.max(0, inletPsi - dropPsi), network.gas)
        : lowPressureCfh(idIn, lengthFt, dropInWc, network.gas);
      return Math.max(0, Math.floor(cfh));
    }),
  );
  const eqLabel = highP ? "IFGC 402.4 Eq. 4-2 (high-pressure)" : "IFGC 402.4 Eq. 4-1 (low-pressure)";
  return {
    id: `builtin-ifgc-${network.gas}-${spec.id}-${Math.round(inletInWc * 100)}-${Math.round(dropInWc * 100)}`,
    label: `${eqLabel} — ${GAS_FUEL_LABEL[network.gas]}, ${spec.name}, ${pressureLabel(inletInWc)} / ${pressureLabel(dropInWc)} drop`,
    rowHeading: { label: "Length", unit: "ft" },
    columnHeading: { label: "Size", unit: "in" },
    rows,
    columns,
    values,
    citation: {
      section: highP ? "IFGC 402.4 (Equation 4-2)" : "IFGC 402.4 (Equation 4-1)",
      edition: "Built-in IFGC equation fallback",
    },
  };
}

/**
 * Wrap a `CalcTableSource` so any firm/project table takes precedence and the
 * built-in IFGC 402.4 equation table fills `gas_sizing_table` when none is uploaded.
 */
export function withBuiltinGasTables(
  model: Pick<ModelState, "elements">,
  subjectId: ElementId | undefined,
  base?: CalcTableSource,
  options: { readonly slot?: string; readonly zone?: GasZone } = {},
): CalcTableSource & { readonly usedFallback: () => boolean; readonly tableLabel: () => string | null } {
  const slotName = options.slot ?? GAS_SIZING_TABLE_SLOT;
  let fellBack = false;
  let resolvedLabel: string | null = null;
  return {
    table: (slot: string): CalcTable | null => {
      const uploaded = base?.table(slot) ?? null;
      if (uploaded) {
        resolvedLabel = uploaded.label;
        return uploaded;
      }
      if (slot === slotName) {
        const built = builtinIfgcGasTable(model, subjectId, options.zone ? { zone: options.zone } : {});
        if (built) {
          fellBack = true;
          resolvedLabel = built.label;
        }
        return built;
      }
      return null;
    },
    usedFallback: () => fellBack,
    tableLabel: () => resolvedLabel,
  };
}

export function gasSizingSpec(model: Pick<ModelState, "elements">, request: CalcSheetBuildRequest): CalcSheetSpec | { readonly refused: string } {
  const resolved = resolveSubject(model, request.subjectId);
  if ("refused" in resolved) return resolved;
  const { seg, system, network } = resolved;
  const method = methodOverride(request) ?? network.method;
  const field = (path: string) => ({ from: "field" as const, subjectId: seg.id, path });
  const lengthPath = method === "branch_length" ? "gas.branch_length" : "gas.zone_longest";
  const lengthLabel =
    method === "branch_length"
      ? "Sizing length (branch length to farthest outlet, IFGC 402.4.2)"
      : "Sizing length (longest run in this pressure zone)";
  const zoneCount = network.zones.length;
  const segmentCount = new Set(network.zones.flatMap((z) => z.segments.map((s) => s.elementId).filter((x): x is ElementId => x !== null))).size;
  const citations: CalcSheetCitation[] = [
    method === "branch_length"
      ? { section: "Branch length method (IFGC 402.4.2)", note: "Each branch sized on the developed length from its zone start to its farthest downstream outlet; trunk sections use the longest developed run." }
      : { section: "Longest length method (IFGC 402.4.1)", note: "Every piece sized on the longest developed length in its pressure zone, from the firm table or built-in IFGC 402.4 fallback." },
  ];
  if (zoneCount > 0) {
    const zoneDesc = network.zones
      .map((z, i) => `Zone ${i + 1} (${z.label}, ${pressureLabel(z.inletInWc)} / ${pressureLabel(z.allowableDropInWc)} drop, longest ${Math.round(z.longestFt)} ft, ${Math.round(z.totalMbh)} MBH)`)
      .join("; ");
    citations.push({
      section: `Network summary (${zoneCount} pressure zone${zoneCount === 1 ? "" : "s"}, ${segmentCount} segment${segmentCount === 1 ? "" : "s"})`,
      note: zoneDesc,
    });
  }
  return {
    template: GAS_SIZING_TEMPLATE_ID,
    title: `Gas pipe sizing, ${system.name}`,
    inputs: [
      { key: "length", label: lengthLabel, unit: "ft", bind: field(lengthPath) },
      { key: "load", label: "Gas flow this pipe carries", unit: "cfh", bind: field("gas.carries_cfh") },
      { key: "heating_value", label: "Heating value", unit: "Btu/ft3", bind: field("gas.heating_value") },
      { key: "inlet", label: "Pressure at the start of the zone", unit: "in_wc", bind: field("gas.zone") },
    ],
    lookups: [
      {
        key: "capacity",
        label: "Capacity of the size the table picks",
        table: { slot: tableSlot(request) },
        row: { input: "length", match: "next_up" },
        column: { input: "load", match: "next_up", by: "value" },
        unit: "cfh",
      },
    ],
    steps: [
      { key: "size", label: "Pipe size", formula: "{capacity_column}", unit: "in" },
      { key: "margin", label: "Capacity over the load", formula: "({capacity} - {load}) / {load} * 100", unit: "%" },
      { key: "load_mbh", label: "Gas input this pipe carries", formula: "{load} * {heating_value} / 1000", unit: "MBH" },
    ],
    checks: [{ key: "margin_check", label: "Main margin", value: "margin", limit: { quantity: "ratio", system: "natural_gas" } }],
    citations,
    result: { key: "size", label: "Pipe size (in)" },
  };
}

/** Evaluate a live gas sizing sheet with built-in IFGC table fallback whenever no firm table is supplied. */
export function evaluateGasSizingSheet(
  model: Pick<ModelState, "elements">,
  request: CalcSheetBuildRequest,
  ctx: Partial<CalcSheetContext> = {},
):
  | { readonly spec: CalcSheetSpec; readonly evaluation: CalcSheetEvaluation; readonly usedBuiltinTable: boolean; readonly meterNote: string | null }
  | { readonly refused: string } {
  const spec = gasSizingSpec(model, request);
  if ("refused" in spec) return spec;
  const wrapped = withBuiltinGasTables(model, request.subjectId, ctx.tables, { slot: tableSlot(request) });
  const evaluation = evaluateCalcSheet(model, spec, {
    tables: wrapped,
    limits: ctx.limits ?? {},
    ...(ctx.stage !== undefined ? { stage: ctx.stage } : {}),
    ...(ctx.sheets !== undefined ? { sheets: ctx.sheets } : {}),
  });
  if ("refused" in evaluation) return evaluation;
  return { spec, evaluation, usedBuiltinTable: wrapped.usedFallback(), meterNote: gasMeterNote(evaluation) };
}

export interface GasSegmentSheetRow {
  readonly segmentId: ElementId;
  readonly label: string;
  readonly drawnSizeIn: number;
  readonly sizingLengthFt: number;
  readonly carriesCfh: number;
  readonly carriesMbh: number;
  readonly requiredSizeIn: number | null;
  readonly capacityCfh: number | null;
  readonly marginPct: number | null;
  readonly marginPass: boolean | null;
  readonly undersized: boolean;
  readonly governingCell: GoverningCell | null;
  readonly spec: CalcSheetSpec;
  readonly evaluation: CalcSheetEvaluation;
}

export interface GasZoneSheetSummary {
  readonly zoneIndex: number;
  readonly label: string;
  readonly inletPressureInWc: number;
  readonly allowableDropInWc: number;
  readonly highPressure: boolean;
  readonly longestFt: number;
  readonly totalMbh: number;
  readonly totalCfh: number;
  readonly usedBuiltinTable: boolean;
  readonly tableLabel: string | null;
  readonly segments: readonly GasSegmentSheetRow[];
  readonly undersizedCount: number;
}

export interface GasSystemSheetSummary {
  readonly systemId: ElementId;
  readonly systemName: string;
  readonly gasType: GasNetwork["gas"];
  readonly method: GasNetwork["method"];
  readonly totalMbh: number;
  readonly totalCfh: number;
  readonly meterNote: string | null;
  readonly zones: readonly GasZoneSheetSummary[];
  readonly totalSegments: number;
  readonly undersizedCount: number;
}

/**
 * Multi-segment & multi-zone live gas sizing summary: evaluates every gas
 * segment across every pressure zone with firm table override or built-in
 * IFGC 402.4 fallback, respecting `longest_length` vs `branch_length`.
 */
export function gasZoneSizingSummary(
  model: Pick<ModelState, "elements">,
  subjectId: ElementId,
  ctx: Partial<CalcSheetContext> = {},
  options: { readonly method?: "longest_length" | "branch_length"; readonly table?: string } = {},
): GasSystemSheetSummary | { readonly refused: string } {
  const resolved = resolveSubject(model, subjectId);
  if ("refused" in resolved) return resolved;
  const { system, network } = resolved;
  const method = options.method ?? network.method;
  const slot = options.table && options.table.trim() !== "" ? options.table : GAS_SIZING_TABLE_SLOT;
  const zones: GasZoneSheetSummary[] = [];
  let totalSegments = 0;
  let totalUndersized = 0;
  let firstMeterNote: string | null = null;

  for (let zi = 0; zi < network.zones.length; zi++) {
    const zone = network.zones[zi];
    if (!zone) continue;
    const seenSegIds = new Set<ElementId>();
    const rows: GasSegmentSheetRow[] = [];
    let zoneUsedFallback = false;
    let zoneTableLabel: string | null = null;

    for (const s of zone.segments) {
      if (!s.elementId || seenSegIds.has(s.elementId)) continue;
      seenSegIds.add(s.elementId);
      const seg = pipeSegmentOf(model.elements, s.elementId);
      if (!seg) continue;
      const req: CalcSheetBuildRequest = {
        subjectId: seg.id,
        options: { ...(options.method ? { method: options.method } : {}), ...(options.table ? { table: options.table } : {}) },
      };
      const spec = gasSizingSpec(model, req);
      if ("refused" in spec) continue;
      const wrapped = withBuiltinGasTables(model, seg.id, ctx.tables, { slot, zone });
      const evaluation = evaluateCalcSheet(model, spec, {
        tables: wrapped,
        limits: ctx.limits ?? {},
        ...(ctx.stage !== undefined ? { stage: ctx.stage } : {}),
        ...(ctx.sheets !== undefined ? { sheets: ctx.sheets } : {}),
      });
      if ("refused" in evaluation) continue;
      if (wrapped.usedFallback()) zoneUsedFallback = true;
      const gov = evaluation.governing[0] ?? null;
      if (!zoneTableLabel) zoneTableLabel = wrapped.tableLabel();
      const drawnSizeIn = Math.round(nominalInOf(seg.size) * 1000) / 1000;
      const requiredSizeIn = evaluation.values.size ?? null;
      const capacityCfh = evaluation.values.capacity ?? null;
      const marginPct = evaluation.values.margin !== null && evaluation.values.margin !== undefined ? Math.round(evaluation.values.margin * 100) / 100 : null;
      const marginCheck = evaluation.checks.find((c) => c.key === "margin_check");
      const sizingLengthFt =
        method === "branch_length"
          ? Math.round((segmentBranchLengthFt(zone, seg.id) ?? zone.longestFt) * 10) / 10
          : Math.round(zone.longestFt * 10) / 10;
      const carriesCfh = Math.round((evaluation.values.load ?? (s.loadMbh * 1000) / network.heatingValueBtuPerCf) * 10) / 10;
      const carriesMbh = Math.round((evaluation.values.load_mbh ?? s.loadMbh) * 10) / 10;
      const undersized = requiredSizeIn !== null && requiredSizeIn > drawnSizeIn + 1e-6;
      if (undersized) totalUndersized += 1;
      if (!firstMeterNote) firstMeterNote = gasMeterNote(evaluation);
      rows.push({
        segmentId: seg.id,
        label: runLabel(model.elements, seg),
        drawnSizeIn,
        sizingLengthFt,
        carriesCfh,
        carriesMbh,
        requiredSizeIn,
        capacityCfh,
        marginPct,
        marginPass: marginCheck ? marginCheck.pass : null,
        undersized,
        governingCell: gov,
        spec,
        evaluation,
      });
    }
    totalSegments += rows.length;
    zones.push({
      zoneIndex: zi,
      label: zone.label,
      inletPressureInWc: zone.inletInWc,
      allowableDropInWc: zone.allowableDropInWc,
      highPressure: zone.highPressure,
      longestFt: Math.round(zone.longestFt * 10) / 10,
      totalMbh: Math.round(zone.totalMbh * 10) / 10,
      totalCfh: Math.round(((zone.totalMbh * 1000) / network.heatingValueBtuPerCf) * 10) / 10,
      usedBuiltinTable: zoneUsedFallback,
      tableLabel: zoneTableLabel,
      segments: rows,
      undersizedCount: rows.filter((r) => r.undersized).length,
    });
  }

  const totalCfh = Math.round(((network.totalMbh * 1000) / network.heatingValueBtuPerCf) * 10) / 10;
  const sourceInletInWc = network.zones[0]?.inletInWc ?? system.design?.pipe?.inletPressureInWc ?? PIPE_DESIGN_DEFAULTS.inletPressureInWc;
  return {
    systemId: system.id,
    systemName: system.name,
    gasType: network.gas,
    method,
    totalMbh: Math.round(network.totalMbh * 10) / 10,
    totalCfh,
    meterNote:
      network.totalMbh > 0
        ? `Gas meter: ${Math.round(totalCfh).toLocaleString("en-US")} CFH (${Math.round(network.totalMbh).toLocaleString("en-US")} MBH) at ${Math.round(sourceInletInWc * 100) / 100} in. w.c.`
        : firstMeterNote,
    zones,
    totalSegments,
    undersizedCount: totalUndersized,
  };
}

/** The meter note, from the sheet's own numbers: "Gas meter: 1,950 CFH (1,950 MBH) at 7 in. w.c." Null until the sheet has worked out. */
export function gasMeterNote(evaluation: Pick<CalcSheetEvaluation, "values">): string | null {
  const { load, load_mbh: mbh, inlet } = evaluation.values;
  if (load === null || load === undefined || mbh === null || mbh === undefined || inlet === null || inlet === undefined) return null;
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  return `Gas meter: ${n(load)} CFH (${n(mbh)} MBH) at ${Math.round(inlet * 100) / 100} in. w.c.`;
}

export const GAS_SIZING_TEMPLATE: CalcSheetTemplateRow = {
  id: GAS_SIZING_TEMPLATE_ID,
  label: "Gas sizing",
  discipline: "plumbing",
  subjectKinds: ["run_segment"],
  build: (model, request) => gasSizingSpec(model, request),
};
