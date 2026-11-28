/**
 * @jest-environment node
 *
 * WS-6 (#210): Script Decision Provenance, Dual Public/Private Notes,
 * Dry-Run Impact / Supersede Loop, and Linked Detail View Staleness Alerts.
 */
import {
  DEFAULT_SETTINGS,
  GRAPH_DETERMINATIONS_FEATURE,
  asElementId,
  exampleRooftopUnit,
  executeCommand,
  withUpgradePolicy,
  type AuthorRef,
  type BimElement,
  type Command,
  type ModelState,
  type Revision,
} from "@permitzip/bim-kernel";
import { contentHashOf, makeItem, scriptItemSchema, type ScriptItem } from "@permitzip/bim-library";
import {
  analyzeScriptOutputImpacts,
  buildRunProvenance,
  defineScript,
  dryRunScript,
  parseScriptOutput,
  publicRunProvenance,
  runScript,
  sanitizeWorkNotes,
  sliceModel,
  type ScriptDefinition,
} from "../src";

const PERSON: AuthorRef = { provider: "test.identity", subject: "keng", kind: "person", displayName: "K. Engineer" };
const FEATURES = [GRAPH_DETERMINATIONS_FEATURE];

function applyCmd(model: ModelState, command: Command): ModelState {
  const res = withUpgradePolicy(
    (f) => FEATURES.includes(f),
    () => executeCommand(model, command),
  );
  if (!res.ok) throw new Error(res.error.message);
  return res.model;
}

function fixtureModel(): ModelState {
  const rtu = exampleRooftopUnit();
  const els: BimElement[] = [
    { id: asElementId("L1"), version: 1, authoredRev: {}, kind: "level", name: "Roof", elevationMm: 4000 } as unknown as BimElement,
    { id: asElementId("type:rtu"), version: 1, authoredRev: {}, kind: "part_type", definition: rtu } as unknown as BimElement,
  ];
  let m: ModelState = {
    modelId: "ws6-script-test",
    revision: 1 as Revision,
    elements: Object.fromEntries(els.map((e) => [e.id, e])),
    connections: [],
    settings: DEFAULT_SETTINGS,
  };
  m = applyCmd(m, {
    type: "place_part",
    partId: "RTU-1",
    typeId: "type:rtu",
    levelId: "L1",
    position: { x: 2000, y: 2000 },
    mark: "RTU-1",
  });
  m = applyCmd(m, {
    type: "record_determination",
    determinationId: "DET-RTU-1",
    subject: { kind: "element", id: "RTU-1" },
    key: "curb_location",
    value: "north_bay",
    title: "RTU-1 structural bay placement",
    reasoning: "Centered over existing bar joist line per structural engineer.",
    publicNote: "Centered over structural framing line per coordination review.",
    privateNote: "CONFIDENTIAL: Owner asked to avoid tenant suite 204 acoustic complaint.",
    decidedBy: "K. Engineer",
    confidence: "high",
  });
  m = applyCmd(m, {
    type: "create_view",
    viewId: "V-DET-RTU-CURB",
    name: "RTU-1 Roof Curb & Flashing Detail",
    viewType: "detail",
    props: {
      linkedElementIds: ["RTU-1"],
    },
  });
  return m;
}

function makeScriptItem(def: ScriptDefinition, key: string): ScriptItem {
  const body = scriptItemSchema.parse({
    id: `test.${key}`,
    revision: 1,
    key: `test.${key}`,
    name: key,
    version: "1.0.0",
    language: "typescript",
    kit: ">=0.1.0",
    manifest: def.manifest,
    source: `import { defineScript } from "@permitzip/bim-script";\nexport default defineScript(${JSON.stringify(def.manifest)} as never);\n`,
    license: "Apache-2.0",
    authors: [PERSON],
  });
  return { ...body, contentHash: contentHashOf(makeItem("script", body)) };
}

describe("WS-6 bim-script provenance, dry-run impact/supersede loop & detail staleness", () => {
  it("supports ctx.decisions.record, ctx.decisions.query, and two-layer public/private notes without leaking privateNote", async () => {
    const m = fixtureModel();
    const recordScript = defineScript({
      kind: "layout",
      reads: { levels: true, kinds: ["part", "determination", "view"] },
      parameters: {},
      notes: {
        publicNote: "Documented initial equipment sizing basis.",
        privateNote: "INTERNAL ONLY: client budget threshold $12k.",
      },
      run(ctx) {
        const before = ctx.decisions.query({ elementIds: ["RTU-1"] });
        expect(before).toHaveLength(1);
        expect(before[0]!.id).toBe("DET-RTU-1");
        expect("privateNote" in before[0]!).toBe(false);

        const newId = ctx.decisions.record({
          subject: { kind: "element", id: "RTU-1" },
          key: "acoustic_isolation",
          value: "spring_curb",
          title: "RTU-1 spring isolation curb",
          reasoning: "Isolation curb selected for roof-mounted rotating equipment.",
          publicNote: "Spring isolation curb specified per acoustic criteria.",
          privateNote: "INTERNAL: vendor quote #4412 from Acme Vibration.",
          decidedBy: "K. Engineer",
          confidence: "high",
        });

        const after = ctx.decisions.query({ elementIds: ["RTU-1"] });
        expect(after.map((d) => d.id)).toContain(newId);
        for (const item of after) {
          expect("privateNote" in item).toBe(false);
        }
        ctx.note({
          publicNote: "Added RTU-1 acoustic isolation determination.",
          privateNote: "NEVER EXPORT THIS PRIVATE NOTE",
        });
        ctx.label("Record RTU-1 isolation decision");
      },
    });

    const slice = sliceModel(m, recordScript.manifest.reads, [], FEATURES);
    const out = await runScript(recordScript, { slice, values: {}, scriptHash: "ws6-rec-1" });
    expect(out.kind).toBe("edits");
    if (out.kind !== "edits") throw new Error("expected edits");
    expect(out.publicNote).toBe("Added RTU-1 acoustic isolation determination.");
    expect(JSON.stringify(out)).not.toContain("NEVER EXPORT THIS PRIVATE NOTE");
    expect(JSON.stringify(out)).not.toContain("client budget threshold");

    // Provenance helpers preserve privateNote internally and strip it for public exports.
    const item = makeScriptItem(recordScript, "record-decision");
    const prov = buildRunProvenance({
      script: item,
      values: {},
      generatedBy: PERSON,
      generatedAt: "2026-11-27T16:00:00.000Z",
      publicNote: "Sized per 2021 code table and revised architectural layout.",
      privateNote: "Client email from Bob on 2026-11-20.",
    });
    expect(prov.privateNote).toBe("Client email from Bob on 2026-11-20.");
    const pub = publicRunProvenance(prov);
    expect("privateNote" in pub).toBe(false);
    expect(pub.publicNote).toBe("Sized per 2021 code table and revised architectural layout.");
    expect(sanitizeWorkNotes({ publicNote: "Public ok", privateNote: "Secret" })).toEqual({ publicNote: "Public ok" });
  });

  it("flags unresolved decision impacts and stale linked detail views in dry-run, then clears unresolved status when explicitly superseded", async () => {
    const m = fixtureModel();

    // Script 1: Moves RTU-1 WITHOUT superseding DET-RTU-1
    const moveWithoutSupersede = defineScript({
      kind: "layout",
      reads: { levels: true, kinds: ["part", "part_type", "determination", "view"] },
      parameters: {},
      run(ctx) {
        ctx.edit({
          type: "move_elements",
          ids: ["RTU-1"],
          delta: { x: 3000, y: 1000 },
        });
        ctx.label("Relocate RTU-1 to south bay");
      },
    });

    const slice1 = sliceModel(m, moveWithoutSupersede.manifest.reads, [], FEATURES);
    const dry1 = await dryRunScript(moveWithoutSupersede, { slice: slice1, values: {}, scriptHash: "ws6-move-1" });

    expect(dry1.hasUnresolvedDecisions).toBe(true);
    expect(dry1.decisionImpacts).toHaveLength(1);
    expect(dry1.decisionImpacts[0]).toEqual({
      id: "DET-RTU-1",
      kind: "determination",
      subjectId: "RTU-1",
      key: "curb_location",
      title: "RTU-1 structural bay placement",
      status: "recorded",
      publicNote: "Centered over structural framing line per coordination review.",
      superseded: false,
    });
    expect(JSON.stringify(dry1)).not.toContain("CONFIDENTIAL");

    // Linked detail view staleness alert is surfaced alongside decision impacts
    expect(dry1.detailImpacts).toHaveLength(1);
    expect(dry1.detailImpacts[0]).toMatchObject({
      viewId: "V-DET-RTU-CURB",
      viewName: "RTU-1 Roof Curb & Flashing Detail",
      matchedElementIds: ["RTU-1"],
      deletedElementIds: [],
    });
    expect(dry1.notices).toHaveLength(2);
    expect(dry1.notices[0]).toContain("NOT superseded");
    expect(dry1.notices[1]).toContain("RTU-1 Roof Curb & Flashing Detail");

    // parseScriptOutput round-trip preserves decisionImpacts and detailImpacts
    const reparsed = parseScriptOutput(JSON.parse(JSON.stringify(dry1.output)));
    expect(reparsed.kind).toBe("edits");
    if (reparsed.kind !== "edits") throw new Error("expected edits");
    expect(reparsed.decisionImpacts).toEqual(dry1.decisionImpacts);
    expect(reparsed.detailImpacts).toEqual(dry1.detailImpacts);

    // Script 2: Moves RTU-1 AND explicitly supersedes DET-RTU-1 in the same run
    const moveWithSupersede = defineScript({
      kind: "layout",
      reads: { levels: true, kinds: ["part", "part_type", "determination", "view"] },
      parameters: {},
      run(ctx) {
        ctx.edit({
          type: "move_elements",
          ids: ["RTU-1"],
          delta: { x: 3000, y: 1000 },
        });
        ctx.decisions.supersede({
          determinationId: "DET-RTU-1",
          newDeterminationId: "DET-RTU-2",
          value: "south_bay",
          title: "RTU-1 relocated to south structural bay",
          reasoning: "Structural engineer verified south bay framing for revised curb.",
          publicNote: "Relocated to south bay per revised framing plan.",
          privateNote: "Internal coordination email with structural PM.",
          decidedBy: "K. Engineer",
          confidence: "high",
        });
        ctx.label("Relocate RTU-1 and supersede curb placement decision");
      },
    });

    const slice2 = sliceModel(m, moveWithSupersede.manifest.reads, [], FEATURES);
    const dry2 = await dryRunScript(moveWithSupersede, { slice: slice2, values: {}, scriptHash: "ws6-move-2" });

    expect(dry2.hasUnresolvedDecisions).toBe(false);
    expect(dry2.decisionImpacts).toHaveLength(1);
    expect(dry2.decisionImpacts[0]).toMatchObject({
      id: "DET-RTU-1",
      superseded: true,
      supersededBy: "DET-RTU-2",
    });
    expect(dry2.notices[0]).toContain("superseded by DET-RTU-2");
    expect(dry2.detailImpacts).toHaveLength(1);

    // analyzeScriptOutputImpacts computes identical governance report from raw output + beforeModel
    const analyzed = analyzeScriptOutputImpacts(m, dry2.output, FEATURES);
    expect(analyzed.hasUnresolvedDecisions).toBe(false);
    expect(analyzed.decisionImpacts).toEqual(dry2.decisionImpacts);
    expect(analyzed.detailImpacts).toEqual(dry2.detailImpacts);
  });
});
