import { executeCommand, withUpgradePolicy, type ModelState } from "@permitzip/bim-kernel";
import { withPackSet, type PackSet } from "@permitzip/bim-kernel/packs";
import type { Severity } from "@permitzip/bim-lint";
import { evaluateClashes } from "./kit-checks";
import { parseScriptOutput, type ScriptOutput } from "./output";

/**
 * Automatic Self-Clash Guard for `@permitzip/bim-script`.
 *
 * Whenever a script creates or edits routed runs or placed parts
 * (`run_segment`, `run_fitting`, `part`), evaluates hard clashes
 * (`clash-hard`, `clash-self`) scoped to the elements created/edited by the
 * script itself and produces concise structured warnings so agents immediately
 * see if their own routed pipes/ducts/equipment clash before applying.
 */

export const SELF_CLASH_KINDS = ["run_segment", "run_fitting", "part"] as const;
export type SelfClashKind = (typeof SELF_CLASH_KINDS)[number];
const SELF_CLASH_KIND_SET: ReadonlySet<string> = new Set(SELF_CLASH_KINDS);

export interface SelfClashWarning {
  readonly rule: "clash-hard" | "clash-self";
  readonly severity: Severity;
  /** Element ids participating in the clash. */
  readonly elements: readonly string[];
  /** Subset of `elements` created or edited by this script run. */
  readonly touchedElements: readonly string[];
  /** True when every element in the clash was created/edited by this script run. */
  readonly betweenTouchedOnly: boolean;
  readonly level: string;
  readonly at: { readonly x_ft: number; readonly y_ft: number; readonly z_ft: number };
  readonly message: string;
  readonly fixHint?: string;
}

export interface SelfClashReport {
  /** True when the script created/edited at least one `run_segment`, `run_fitting`, or `part`. */
  readonly evaluated: boolean;
  /** Number of script-created/edited run/part elements checked. */
  readonly checkedElementCount: number;
  /** Total hard/self clashes detected on those elements. */
  readonly total: number;
  /** Number of warnings included in `warnings` (capped by `maxWarnings`). */
  readonly shown: number;
  readonly byRule: Readonly<Record<string, number>>;
  readonly warnings: readonly SelfClashWarning[];
  /** One-line human/agent summary. */
  readonly summary: string;
}

export interface SelfClashOptions {
  /** Minimum overlap depth in inches to report (default 0.5 in., matching `bim-lint`). */
  readonly toleranceIn?: number;
  /** Maximum warnings to include in `warnings` (default 15, max 50). */
  readonly maxWarnings?: number;
  /** Server protocol features enabled when replaying batches against a base model. */
  readonly features?: readonly string[];
  /** Pack set active when replaying batches and evaluating clashes. */
  readonly packs?: PackSet;
  /** Restrict findings strictly to pairs where EVERY element was created/edited by the script (default false). */
  readonly onlyBetweenTouched?: boolean;
}

/**
 * Evaluates hard/self clashes (`clash-hard`, `clash-self`) on an already-computed
 * post-script model, scoped strictly to `touchedIds` whose element kind is
 * `run_segment`, `run_fitting`, or `part`.
 */
export function evaluateSelfClashesOnModel(
  after: ModelState,
  touchedIds: readonly string[],
  options: SelfClashOptions = {},
): SelfClashReport {
  const checkedIds = touchedIds.filter((id) => {
    const el = after.elements[id];
    return el !== undefined && !("deleted" in el && el.deleted) && SELF_CLASH_KIND_SET.has(el.kind);
  });

  if (checkedIds.length === 0) {
    return {
      evaluated: false,
      checkedElementCount: 0,
      total: 0,
      shown: 0,
      byRule: {},
      warnings: [],
      summary: "No runs or parts were created or edited; self-clash guard skipped.",
    };
  }

  const checkedSet = new Set(checkedIds);
  const rawFindings = withPackSet(options.packs, () =>
    evaluateClashes(
      after,
      {
        ruleset: "coordination",
        types: ["hard", "self"],
        scope: "touched",
        ...(options.toleranceIn !== undefined ? { toleranceIn: options.toleranceIn } : {}),
      },
      checkedIds,
    ),
  );

  const filtered = options.onlyBetweenTouched
    ? rawFindings.filter((f) => f.elementIds.length > 0 && f.elementIds.every((id) => checkedSet.has(id)))
    : rawFindings;

  const byRule: Record<string, number> = {};
  for (const f of filtered) {
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  }

  const maxWarnings = Math.max(1, Math.min(50, Math.round(options.maxWarnings ?? 15)));
  const warnings: SelfClashWarning[] = filtered.slice(0, maxWarnings).map((f) => {
    const touchedElements = f.elementIds.filter((id) => checkedSet.has(id));
    return {
      rule: f.rule === "clash-self" ? "clash-self" : "clash-hard",
      severity: f.severity,
      elements: f.elementIds,
      touchedElements,
      betweenTouchedOnly: f.elementIds.length > 0 && touchedElements.length === f.elementIds.length,
      level: f.at.level,
      at: { x_ft: f.at.x_ft, y_ft: f.at.y_ft, z_ft: f.at.z_ft },
      message: f.message,
      ...(f.fix?.hint ? { fixHint: f.fix.hint } : {}),
    };
  });

  const total = filtered.length;
  const summary =
    total === 0
      ? `Self-clash guard passed: 0 hard/self clashes across ${checkedIds.length} routed/edited run or part element${checkedIds.length === 1 ? "" : "s"}.`
      : `Self-clash guard found ${total} hard/self clash${total === 1 ? "" : "es"} involving ${checkedIds.length} routed/edited run or part element${checkedIds.length === 1 ? "" : "s"} (${Object.entries(byRule).map(([k, v]) => `${v} ${k}`).join(", ")}).`;

  return {
    evaluated: true,
    checkedElementCount: checkedIds.length,
    total,
    shown: warnings.length,
    byRule,
    warnings,
    summary,
  };
}

/**
 * Replays a script's `ScriptOutput` (or raw JSON output) against `before` without
 * mutating `before`, collects every element created or edited by the script, and
 * evaluates hard/self clashes on all touched `run_segment`, `run_fitting`, and `part`
 * elements.
 */
export function evaluateSelfClashes(
  before: ModelState,
  rawOutput: ScriptOutput | unknown,
  options: SelfClashOptions = {},
): SelfClashReport {
  const output: ScriptOutput = parseScriptOutput(rawOutput);
  if (output.kind !== "edits" || output.batches.length === 0) {
    return {
      evaluated: false,
      checkedElementCount: 0,
      total: 0,
      shown: 0,
      byRule: {},
      warnings: [],
      summary: "No model edits to check for self-clashes.",
    };
  }

  const featureSet = options.features ? new Set(options.features) : null;
  const allowFeature = (f: string) => (featureSet ? featureSet.has(f) : true);

  let head = before;
  const touched = new Set<string>();
  withPackSet(options.packs, () =>
    withUpgradePolicy(allowFeature, () => {
      for (const batch of output.batches) {
        const res = executeCommand(head, batch);
        if (!res.ok) return;
        head = res.model;
        for (const id of res.changedIds) touched.add(id);
        for (const id of res.removedIds) touched.delete(id);
      }
    }),
  );

  return evaluateSelfClashesOnModel(head, [...touched], options);
}

/** Formats a concise error message when `failOnSelfClash: true` rejects a run. */
export function selfClashFailureMessage(report: SelfClashReport): string {
  const top = report.warnings
    .slice(0, 3)
    .map((w) => `[${w.rule}] ${w.message}`)
    .join("; ");
  const extra = report.total > 3 ? ` (+${report.total - 3} more)` : "";
  return `${report.summary}${top ? ` First clashes: ${top}${extra}.` : ""} Adjust run elevations/offsets or pass failOnSelfClash: false to preview with warnings.`;
}
