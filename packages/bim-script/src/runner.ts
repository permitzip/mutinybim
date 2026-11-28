import type { ScriptManifest, ScriptValue } from "@permitzip/bim-library";
import { evaluateSelfClashes, selfClashFailureMessage, type SelfClashOptions, type SelfClashReport } from "./self-clash";
import { sliceAsModel, type ModelSlice } from "./slice";

/**
 * Where scripts run (SCRIPTING-PROPOSAL §5.2). The kit defines the contract;
 * each harness supplies a runner (a laptop's own process, a hosted code
 * sandbox, a host's cloud sandbox adapter). Scripts never run in a
 * MutinyBIM model server or MCP server process, and never in the host app's
 * server process: servers only receive output JSON and re-parse it.
 *
 * Every runner meets the contract, checked by `runRunnerConformance`: a
 * fresh process per run; no network; no file access beyond the kit and the
 * run's input; no child processes; memory, wall-clock and output caps no
 * larger than these. A run that hits a cap says which, and is not retried
 * unchanged.
 */
export const RUNNER_CONTRACT = {
  memoryMb: 1024,
  wallMs: 30_000,
  outputBytes: 2 * 1024 * 1024,
} as const;

export interface RunnerLimits {
  readonly memoryMb: number;
  readonly wallMs: number;
  readonly outputBytes: number;
}

export interface ScriptRunRequest {
  /** The module's source (imports only the kit; default export is `defineScript(...)`). */
  readonly source: string;
  /** The script item's content hash: seeds ids and randomness. */
  readonly scriptHash: string;
  /** Stored values (quantities in SI), checked against the manifest by the kit. */
  readonly values: Readonly<Record<string, ScriptValue>>;
  readonly slice: ModelSlice;
  /** Opt-in: reject the run with `code: "self_clash"` if the script's own routed/edited runs or parts hard-clash. */
  readonly failOnSelfClash?: boolean;
  /** Optional configuration for the automatic self-clash guard. */
  readonly selfClash?: SelfClashOptions;
}

export type RunnerFailureCode =
  /** Over the memory cap. */
  | "cap_memory"
  /** Over the wall-clock cap. */
  | "cap_time"
  /** Output larger than the cap. */
  | "cap_output"
  /** The script threw (a refused step, a read beyond its slice, its own error): `message` says what. */
  | "script_error"
  /** The script's routed/edited runs or parts hard-clashed while `failOnSelfClash: true` was set. */
  | "self_clash"
  /** The runner couldn't start or finish the run (its own fault, not the script's). */
  | "runner_error";

export type ScriptRunResult =
  /** `manifest`: the script's own (what `defineScript` declared), when the runner reports it; a host checks it before saving the script. */
  | { readonly ok: true; readonly output: unknown; readonly bytes: number; readonly ms: number; readonly manifest?: ScriptManifest; readonly selfClashes?: SelfClashReport }
  | { readonly ok: false; readonly code: RunnerFailureCode; readonly message: string; readonly ms: number; readonly selfClashes?: SelfClashReport };

export interface ScriptRunner {
  /** Stable id (`laptop`, `vercel-sandbox`, `acme-container`). */
  readonly id: string;
  readonly limits: RunnerLimits;
  run(request: ScriptRunRequest): Promise<ScriptRunResult>;
}

/**
 * Evaluates hard/self clashes (`clash-hard`, `clash-self`) scoped to runs/parts
 * created or edited by a successful script run and attaches concise `selfClashes`
 * warnings to the result. When `failOnSelfClash` is true and clashes exist, turns
 * the result into a `self_clash` failure.
 */
export function applySelfClashGuard(
  result: ScriptRunResult,
  request: Pick<ScriptRunRequest, "slice" | "failOnSelfClash" | "selfClash">,
  defaults: { readonly failOnSelfClash?: boolean; readonly selfClash?: SelfClashOptions } = {},
): ScriptRunResult {
  if (!result.ok) return result;
  const options: SelfClashOptions = {
    ...(request.slice.features ? { features: request.slice.features } : {}),
    ...(defaults.selfClash ?? {}),
    ...(request.selfClash ?? {}),
  };
  let report: SelfClashReport;
  try {
    report = evaluateSelfClashes(sliceAsModel(request.slice), result.output, options);
  } catch {
    return result;
  }
  if (!report.evaluated) return result;
  const fail = request.failOnSelfClash ?? defaults.failOnSelfClash ?? false;
  if (fail && report.total > 0) {
    return {
      ok: false,
      code: "self_clash",
      message: selfClashFailureMessage(report),
      ms: result.ms,
      selfClashes: report,
    };
  }
  return { ...result, selfClashes: report };
}

/** Wraps any `ScriptRunner` so every run/dry-run automatically attaches `selfClashes` warnings (and respects `failOnSelfClash`). */
export function withSelfClashGuard(
  runner: ScriptRunner,
  defaults: { readonly failOnSelfClash?: boolean; readonly selfClash?: SelfClashOptions } = {},
): ScriptRunner {
  return {
    id: runner.id,
    limits: runner.limits,
    async run(request: ScriptRunRequest): Promise<ScriptRunResult> {
      const result = await runner.run(request);
      return applySelfClashGuard(result, request, defaults);
    },
  };
}

/** Words for a failed run, for the agent and the person. */
export function runFailureWords(result: Extract<ScriptRunResult, { ok: false }>, limits: RunnerLimits): string {
  switch (result.code) {
    case "cap_memory":
      return `The script used more than ${limits.memoryMb} MB, so it was stopped. Make it read less or build less at once; running it again unchanged will stop the same way.`;
    case "cap_time":
      return `The script ran longer than ${Math.round(limits.wallMs / 1000)} s, so it was stopped. Running it again unchanged will stop the same way.`;
    case "cap_output":
      return `The script's output was over ${Math.round(limits.outputBytes / 1024)} KB, so it was not kept. Split the work into smaller runs.`;
    case "script_error":
      return `The script stopped: ${result.message}`;
    case "self_clash":
      return `The script's own routed runs or parts have hard clashes: ${result.message}`;
    case "runner_error":
      return `The script couldn't be run here: ${result.message.replace(/[.\s]+$/, "")}. That is the script machine, not a mistake in the script, so don't rewrite the script: run it once more as it is, and if it fails the same way tell the person.`;
  }
}
