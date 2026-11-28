import { decisionImpactsFor, executeCommand, linkedDetailImpacts, withUpgradePolicy, type ModelState } from "@permitzip/bim-kernel";
import type { ScriptManifest, ScriptValue } from "@permitzip/bim-library";
import { runScript, type RunScriptInput } from "./context";
import type { ScriptDefinition } from "./define";
import type { ScriptDecisionImpact, ScriptDetailImpact, ScriptOutput } from "./output";
import type { ModelSlice } from "./slice";

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
  /** The runner couldn't start or finish the run (its own fault, not the script's). */
  | "runner_error";

export type ScriptRunResult =
  /** `manifest`: the script's own (what `defineScript` declared), when the runner reports it; a host checks it before saving the script. */
  | {
      readonly ok: true;
      readonly output: unknown;
      readonly bytes: number;
      readonly ms: number;
      readonly manifest?: ScriptManifest;
      readonly decisionImpacts?: readonly ScriptDecisionImpact[];
      readonly detailImpacts?: readonly ScriptDetailImpact[];
      readonly notices?: readonly string[];
    }
  | { readonly ok: false; readonly code: RunnerFailureCode; readonly message: string; readonly ms: number };

export interface ScriptRunner {
  /** Stable id (`laptop`, `vercel-sandbox`, `acme-container`). */
  readonly id: string;
  readonly limits: RunnerLimits;
  run(request: ScriptRunRequest): Promise<ScriptRunResult>;
}

/** Structured low-token governance impact report from a script execution or dry-run. */
export interface ScriptImpactReport {
  readonly decisionImpacts: readonly ScriptDecisionImpact[];
  readonly detailImpacts: readonly ScriptDetailImpact[];
  /** Concise low-token notices for impacted decisions (with supersede status) and stale detail views. */
  readonly notices: readonly string[];
  /** True when at least one impacted active decision was NOT explicitly superseded in the same run. */
  readonly hasUnresolvedDecisions: boolean;
}

/** Result of `dryRunScript`: the script output plus governance impact notices, without mutating the caller's model. */
export interface ScriptDryRunResult extends ScriptImpactReport {
  readonly output: ScriptOutput;
}

/** Formats concise, low-token impact notices from decision and linked-detail impacts. */
export function formatImpactNotices(decisionImpacts: readonly ScriptDecisionImpact[], detailImpacts: readonly ScriptDetailImpact[]): string[] {
  const notices: string[] = [];
  for (const d of decisionImpacts) {
    const tag = d.superseded ? `superseded by ${d.supersededBy ?? "new decision"}` : "NOT superseded — review or supersede";
    const note = d.publicNote ? ` — ${d.publicNote}` : "";
    notices.push(`[decision:${d.id}] ${d.title} (${d.subjectId}, ${tag})${note}`);
  }
  for (const v of detailImpacts) {
    notices.push(`[detail:${v.viewId}] ${v.notice}`);
  }
  return notices;
}

const RUNNER_GRAPH_KINDS: ReadonlySet<string> = new Set(["determination", "rule", "requirement_state"]);

/**
 * Simulates a script's edit output against `beforeModel` (without mutating it)
 * to compute low-token decision impacts (including whether each was superseded
 * in the same run) and linked detail-view staleness alerts.
 */
export function analyzeScriptOutputImpacts(beforeModel: ModelState, output: ScriptOutput, features: readonly string[] = []): ScriptImpactReport {
  if (output.kind !== "edits" || output.batches.length === 0) {
    const decisionImpacts = output.kind === "edits" ? (output.decisionImpacts ?? []) : [];
    const detailImpacts = output.kind === "edits" ? (output.detailImpacts ?? []) : [];
    return {
      decisionImpacts,
      detailImpacts,
      notices: formatImpactNotices(decisionImpacts, detailImpacts),
      hasUnresolvedDecisions: decisionImpacts.some((d) => !d.superseded),
    };
  }
  const featureSet = new Set(features);
  const modifiedOrDeleted = new Set<string>();
  const deletedIds = new Set<string>();
  const supersededInRun = new Map<string, string>();
  let head = beforeModel;

  for (const batch of output.batches) {
    for (const cmd of batch.commands) {
      if (cmd.type === "supersede_determination") {
        supersededInRun.set(cmd.determinationId, cmd.newDeterminationId);
      }
    }
    const res = withUpgradePolicy((f) => featureSet.has(f), () => executeCommand(head, batch));
    if (!res.ok) break;
    head = res.model;
    for (const id of res.changedIds) {
      const prev = beforeModel.elements[id];
      if (prev && !RUNNER_GRAPH_KINDS.has(prev.kind)) {
        modifiedOrDeleted.add(id);
        const cur = head.elements[id];
        const wasDel = "deleted" in prev && prev.deleted === true;
        const nowDel = cur === undefined || ("deleted" in cur && cur.deleted === true);
        if (!wasDel && nowDel) deletedIds.add(id);
      }
    }
    for (const id of res.removedIds) {
      const prev = beforeModel.elements[id];
      if (prev && !RUNNER_GRAPH_KINDS.has(prev.kind)) {
        modifiedOrDeleted.add(id);
        deletedIds.add(id);
      }
    }
  }

  const touched = [...modifiedOrDeleted];
  const decisionImpacts: ScriptDecisionImpact[] =
    touched.length > 0
      ? decisionImpactsFor(beforeModel, touched).map((d) => {
          const supersededBy = supersededInRun.get(d.id);
          return {
            id: d.id,
            kind: d.kind,
            subjectId: d.subjectId,
            key: d.key,
            title: d.title,
            status: d.status,
            ...(d.publicNote ? { publicNote: d.publicNote } : {}),
            superseded: supersededBy !== undefined,
            ...(supersededBy !== undefined ? { supersededBy } : {}),
          };
        })
      : [];
  const detailImpacts: ScriptDetailImpact[] =
    touched.length > 0
      ? linkedDetailImpacts(beforeModel, touched, {
          deletedElementIds: [...deletedIds],
          afterElements: head.elements,
        }).map((v) => ({
          viewId: v.viewId,
          viewName: v.viewName,
          matchedElementIds: [...v.matchedElementIds],
          matchedSystemIds: [...v.matchedSystemIds],
          deletedElementIds: [...v.deletedElementIds],
          notice: v.notice,
        }))
      : [];
  return {
    decisionImpacts,
    detailImpacts,
    notices: formatImpactNotices(decisionImpacts, detailImpacts),
    hasUnresolvedDecisions: decisionImpacts.some((d) => !d.superseded),
  };
}

/**
 * Dry-runs a script against a slice and returns its output together with
 * low-token decision impact notices (showing whether each was superseded)
 * and linked drafting/detail view staleness notices.
 */
export async function dryRunScript(definition: ScriptDefinition, input: RunScriptInput): Promise<ScriptDryRunResult> {
  const output = await runScript(definition, input);
  const decisionImpacts = output.kind === "edits" ? (output.decisionImpacts ?? []) : [];
  const detailImpacts = output.kind === "edits" ? (output.detailImpacts ?? []) : [];
  return {
    output,
    decisionImpacts,
    detailImpacts,
    notices: formatImpactNotices(decisionImpacts, detailImpacts),
    hasUnresolvedDecisions: decisionImpacts.some((d) => !d.superseded),
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
    case "runner_error":
      return `The script couldn't be run here: ${result.message.replace(/[.\s]+$/, "")}. That is the script machine, not a mistake in the script, so don't rewrite the script: run it once more as it is, and if it fails the same way tell the person.`;
  }
}
