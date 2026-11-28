/**
 * @jest-environment node
 *
 * End-to-end verification of WS-5 (#209):
 *  - Pack-decoupled `plumbing` & `mechanical` kits in `@permitzip/bim-script`
 *  - Automatic self-clash guard in `self-clash.ts` + `runner.ts`
 *  - Script reference entries + under-slab view / schedule formula guidance
 *  - Worked commercial plumbing examples (`fuel-gas-hybrid-pressure`,
 *    `domestic-water-recirc-pressure-loss`, `commercial-kitchen-dwv-grease`)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { installFirstPartyAddOns } from "@permitzip/bim-first-party";
import { SERVER_FEATURES } from "@permitzip/bim-sync";
import {
  DEFAULT_SETTINGS,
  executeCommand,
  withUpgradePolicy,
  type MepSystem,
  type ModelState,
  type PartInstance,
  type Revision,
  type RunSegment,
} from "@permitzip/bim-kernel";
import {
  applySelfClashGuard,
  building,
  defineScript,
  equipment,
  evaluateSelfClashes,
  kitDeclarations,
  kitExample,
  KIT_EXAMPLE_SOURCES,
  mechanical,
  parts,
  plumbing,
  routes,
  RUNNER_CONTRACT,
  runScript,
  searchReference,
  sliceModel,
  units,
  withSelfClashGuard,
  type ScriptDefinition,
  type ScriptOutput,
  type ScriptRunner,
  type ScriptRunResult,
} from "@permitzip/bim-script";
import fuelGasHybridExample from "../examples/fuel-gas-hybrid-pressure";
import domesticWaterRecircExample from "../examples/domestic-water-recirc-pressure-loss";
import commercialKitchenDwvExample from "../examples/commercial-kitchen-dwv-grease";

installFirstPartyAddOns();

function emptyModel(modelId = "ws5-test", withL1 = true): ModelState {
  let model: ModelState = {
    modelId,
    revision: 0 as Revision,
    elements: {},
    connections: [],
    settings: DEFAULT_SETTINGS,
  };
  if (withL1) {
    model = withUpgradePolicy(
      () => true,
      () => {
        const res = executeCommand(model, { type: "create_level", levelId: "L1", name: "Level 1", elevationMm: 0 });
        if (!res.ok) throw new Error(res.error.message);
        return res.model;
      },
    );
  }
  return model;
}

function applyOutput(model: ModelState, output: ScriptOutput): ModelState {
  if (output.kind !== "edits") return model;
  let current = model;
  withUpgradePolicy(
    () => true,
    () => {
      for (const batch of output.batches) {
        for (const cmd of batch.commands) {
          const res = executeCommand(current, cmd);
          if (!res.ok) {
            throw new Error(`Command ${cmd.type} failed: ${res.error.message}`);
          }
          current = res.model;
        }
      }
    },
  );
  return current;
}

function reportValue(output: ScriptOutput, label: string): unknown {
  return output.report?.find((r) => r.label === label)?.value;
}

function commandCount(output: ScriptOutput): number {
  if (output.kind !== "edits") return 0;
  return output.batches.reduce((n, b) => n + b.commands.length, 0);
}

async function execScript(
  model: ModelState,
  script: ScriptDefinition,
  opts?: { readonly failOnSelfClash?: boolean; readonly skipSelfClash?: boolean },
): Promise<{ readonly result: ScriptRunResult; readonly output?: ScriptOutput; readonly model: ModelState }> {
  const slice = sliceModel(model, script.manifest.reads, [], SERVER_FEATURES);
  const rawRunner: ScriptRunner = {
    id: "ws5-in-process",
    limits: RUNNER_CONTRACT,
    async run(req) {
      const t0 = Date.now();
      const output = await runScript(script, {
        slice: req.slice,
        values: req.values,
        scriptHash: req.scriptHash,
      });
      const bytes = Buffer.byteLength(JSON.stringify(output), "utf8");
      return { ok: true, output, bytes, ms: Date.now() - t0, manifest: script.manifest };
    },
  };
  const runner = opts?.skipSelfClash ? rawRunner : withSelfClashGuard(rawRunner);
  const result = await runner.run({
    source: "",
    scriptHash: "sha256:ws5-test",
    values: {},
    slice,
    failOnSelfClash: opts?.failOnSelfClash,
  });
  if (!result.ok) return { result, model };
  const output = result.output as ScriptOutput;
  return { result, output, model: applyOutput(model, output) };
}

describe("WS-5 architecture boundary", () => {
  it("packages/bim-script/src never directly imports plumbing or mechanical packs", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(path.join(srcDir, file), "utf8");
      if (/from\s+["']@permitzip\/bim-pack-(plumbing|mechanical)/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("WS-5 plumbing kit (pack-decoupled)", () => {
  it("configures fuel gas, domestic water flowTest, DHWR, storm, and drainage via plumbing.setSystemDesign", async () => {
    const script = defineScript({
      kind: "layout",
      parameters: {},
      reads: { levels: true },
      run(ctx) {
        routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(1.25), "black_steel"),
          system: { id: "gas-1", kind: "natural_gas", name: "Fuel Gas" },
          height: units.ft(10),
          points: [{ x: units.ft(0), y: units.ft(0) }, { x: units.ft(20), y: units.ft(0) }],
        });
        routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(2), "copper"),
          system: { id: "dcw-1", kind: "domestic_cold_water", name: "Cold Water" },
          height: units.ft(9),
          points: [{ x: units.ft(0), y: units.ft(4) }, { x: units.ft(20), y: units.ft(4) }],
        });
        routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(0.75), "copper"),
          system: { id: "dhwr-1", kind: "domestic_hot_water_return", name: "DHWR" },
          height: units.ft(8),
          points: [{ x: units.ft(0), y: units.ft(8) }, { x: units.ft(20), y: units.ft(8) }],
        });
        routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(4), "cast_iron"),
          system: { id: "storm-1", kind: "storm", name: "Storm" },
          height: units.ft(-2),
          slope: { rise: units.in(0.125), per: units.ft(1) },
          flow: "with_points",
          points: [{ x: units.ft(0), y: units.ft(12) }, { x: units.ft(20), y: units.ft(12) }],
        });

        plumbing.setSystemDesign(ctx, "gas-1", {
          fuel: "natural_gas",
          inletPressurePsi: 2,
          allowableDropPsi: 1,
          gasSizing: "longest_length",
          heatingValueBtuPerCf: 1000,
        });
        plumbing.setSystemDesign(ctx, "dcw-1", {
          demandCurve: "ipc_e_valve",
          staticPressurePsi: 68,
          fixedLossesPsi: 14,
          minFixturePressurePsi: 25,
          maxVelocityFps: 8,
          flowTest: {
            staticPsi: 68,
            residualPsi: 54,
            testGpm: 150,
            elevationFt: 0,
            safetyMarginPsi: 5,
            location: "Hydrant #4",
          },
        });
        plumbing.setSystemDesign(ctx, "dhwr-1", {
          maxVelocityFps: 4,
          waterTempF: 130,
          dhwr: {
            deltaTF: 10,
            heatLossBtuPerHrFt: 11.5,
            maxVelocityFps: 4,
            supplyTempF: 140,
            returnTempF: 130,
            pumpGpm: 5,
            pumpHeadFt: 10,
            bufferTankGal: 40,
          },
        });
        plumbing.setSystemDesign(ctx, "storm-1", {
          rainfallInPerHr: 4.5,
          slopes: [{ maxNominalIn: 12, inPerFt: 0.125 }],
        });
      },
    });

    const { result, model } = await execScript(emptyModel(), script);
    expect(result.ok).toBe(true);

    const gas = model.elements["gas-1"] as MepSystem;
    expect(gas.design?.pipe?.gasType).toBe("natural");
    expect(gas.design?.pipe?.inletPressureInWc).toBeCloseTo(2 * 27.6799, 1);
    expect(gas.design?.pipe?.gasSizing).toBe("longest_run");

    const dcw = model.elements["dcw-1"] as MepSystem;
    expect(dcw.design?.pipe?.demandCurve).toBe("ipc_e_valve");
    expect(dcw.design?.pipe?.supplyPressurePsi).toBe(68);
    expect(dcw.design?.pipe?.fixedLossesPsi).toBe(14);
    expect(dcw.design?.pipe?.minFixturePressurePsi).toBe(25);

    const dhwr = model.elements["dhwr-1"] as MepSystem;
    expect(dhwr.design?.pipe?.maxVelocityFps).toBe(4);
    expect(dhwr.design?.pipe?.waterTempF).toBe(130);

    const storm = model.elements["storm-1"] as MepSystem;
    expect(storm.design?.pipe?.rainfallInPerHr).toBe(4.5);
  });

  it("places gas regulators/shutoffs/drip legs, sizes hybrid gas systems, and returns plumbing.gasReport", async () => {
    const script = defineScript({
      kind: "layout",
      parameters: {},
      reads: { levels: true },
      run(ctx) {
        const meterPart = parts.part("Gas meter", { type: "2 psi", category: "pipe_accessory" });
        meterPart.box({ length: units.in(12), width: units.in(8), height: units.in(12) });
        meterPart.connector("front", {
          id: "g",
          label: "Gas Out",
          domain: "pipe",
          systemKind: "natural_gas",
          shape: "round",
          diameter: units.in(1),
          flowDirection: "out",
        });
        ctx.edit({
          type: "save_part_types",
          label: "Gas meter, 2 psi",
          types: [{ typeId: "test.gas.meter.2psi", definition: meterPart.build() }],
        });
        const meter = equipment.place(ctx, {
          level: "L1",
          type: "test.gas.meter.2psi",
          at: { x: units.ft(1), y: units.ft(10) },
          height: units.ft(9.5),
          mark: "GM-1",
        });
        const range = equipment.place(ctx, {
          level: "L1",
          type: "builtin:plumbing-gas-range@1",
          at: { x: units.ft(28), y: units.ft(4) },
          mark: "GR-1",
        });
        const fryer = equipment.place(ctx, {
          level: "L1",
          type: "builtin:plumbing-gas-fryer@1",
          at: { x: units.ft(36), y: units.ft(4) },
          mark: "GF-1",
        });
        const main = routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(1), "black_steel"),
          system: { id: "gas-1", kind: "natural_gas", name: "Fuel Gas" },
          height: units.ft(10),
          from: routes.atConnector(meter.id, "g"),
          points: [{ x: units.ft(40), y: units.ft(10) }],
        });
        const drop = routes.branch(ctx, {
          trunk: main.segment(1),
          face: "bottom",
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(0.75), "black_steel"),
          system: { id: "gas-1", kind: "natural_gas", name: "Fuel Gas" },
          height: units.ft(10),
          points: [
            { x: units.ft(18), y: units.ft(10), height: units.ft(10) },
            { x: units.ft(18), y: units.ft(10), height: units.ft(4) },
          ],
        });
        routes.connectInto(ctx, {
          from: [
            { elementId: range.id, port: "g" },
            { elementId: fryer.id, port: "g" },
          ],
          into: main.segment(1),
        });

        plumbing.setSystemDesign(ctx, "gas-1", {
          fuel: "natural_gas",
          inletPressurePsi: 2,
          allowableDropPsi: 1,
          gasSizing: "longest_length",
          fixtureTable: [
            { fixture: "Gas range", mbh: 220 },
            { fixture: "Gas fryer", mbh: 120 },
          ],
        });

        const drip = plumbing.placeAccessory(ctx, {
          segment: drop.segment(1),
          at: units.ft(2),
          kind: "drip_leg",
          nippleLength: units.in(4),
        });
        const shutoff = plumbing.placeAccessory(ctx, {
          segment: main.segment(1),
          at: units.ft(4),
          kind: "gas_shutoff",
        });
        const reg = plumbing.placeAccessory(ctx, {
          segment: main.segment(1),
          at: units.ft(14),
          kind: "gas_regulator",
          regulator: { role: "line", outletInWc: 7, dropInWc: 0.5, vent: "vent_limiter" },
        });

        const sized = plumbing.sizeSystem(ctx, { system: "gas-1", apply: true, fuelGasEdition: "2021" });
        const report = plumbing.gasReport(ctx, "gas-1", { fuelGasEdition: "2021" });

        ctx.report("result", {
          shutoff,
          reg,
          drip,
          ok: sized.ok,
          reason: sized.reason,
          issues: sized.issues,
          calcId: sized.calcId,
          applied: sized.applied,
          appliedCount: sized.appliedCount,
          totalMbh: report.totalMbh,
          zoneCount: report.zones.length,
        });
      },
    });

    const { result, output } = await execScript(emptyModel(), script);
    expect(result.ok).toBe(true);
    if (!result.ok || !output) return;
    const summary = reportValue(output, "result") as Record<string, unknown>;
    expect(summary.ok ? "ok" : JSON.stringify({ reason: summary.reason, issues: summary.issues })).toBe("ok");
    expect(summary.calcId).toBe("plumbing.gas_system");
    expect(Number(summary.totalMbh)).toBeGreaterThan(0);
    expect(Number(summary.zoneCount)).toBeGreaterThanOrEqual(2);
    expect(summary.applied).toBe(true);
  });

  it("places RPZ backflow, configures pipe insulation schedule, sizes water, and returns plumbing.waterReport", async () => {
    const script = defineScript({
      kind: "layout",
      parameters: {},
      reads: { levels: true },
      run(ctx) {
        const wc = equipment.place(ctx, {
          level: "L1",
          type: "builtin:plumbing-wc-flushometer@1",
          at: { x: units.ft(22), y: units.ft(4) },
          mark: "WC-1",
        });
        const lav = equipment.place(ctx, {
          level: "L1",
          type: "builtin:plumbing-lavatory@1",
          at: { x: units.ft(30), y: units.ft(4) },
          mark: "L-1",
        });
        const main = routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(2), "copper"),
          system: { id: "dcw-1", kind: "domestic_cold_water", name: "Cold Water" },
          height: units.ft(10),
          points: [
            { x: units.ft(0), y: units.ft(10) },
            { x: units.ft(34), y: units.ft(10) },
          ],
        });
        routes.connectInto(ctx, {
          from: [
            { elementId: wc.id, port: "cw" },
            { elementId: lav.id, port: "cw" },
          ],
          into: main.segment(1),
        });
        const rpz = plumbing.placeAccessory(ctx, {
          segment: main.segment(1),
          at: units.ft(5),
          kind: "rpz",
          mark: "RPZ-1",
        });
        plumbing.setSystemDesign(ctx, "dcw-1", {
          demandCurve: "ashrae_d",
          staticPressurePsi: 65,
          fixedLossesPsi: 14,
          minFixturePressurePsi: 25,
        });
        const ins = plumbing.setInsulationSchedule(ctx, {
          rows: [
            { systemKinds: ["domestic_cold_water"], belowNominal: units.in(4), thickness: units.in(0.5), material: "fiberglass" },
          ],
          source: "IECC 2021",
          applyToSystems: ["dcw-1"],
        });
        const sized = plumbing.sizeSystem(ctx, { system: "dcw-1", apply: true, plumbingEdition: "2021" });
        const report = plumbing.waterReport(ctx, "dcw-1", {
          plumbingEdition: "2021",
          pressure: {
            supplyPsi: 65,
            backflowLossPsi: 12,
            meterLossPsi: 4,
            criticalFixturePsi: 25,
            developedLength: units.ft(80),
          },
        });
        ctx.report("water", {
          rpzMode: rpz.mode,
          insSaved: ins.saved,
          insUpdated: ins.appliedSystems[0]?.updatedSegments ?? 0,
          sizedOk: sized.ok,
          sizedReason: sized.reason,
          sizedIssues: sized.issues,
          totalWsfu: report.totalWsfu,
          designGpm: report.designGpm,
          availablePsi: report.availablePsi,
        });
      },
    });

    const { result, output, model } = await execScript(emptyModel(), script);
    expect(result.ok).toBe(true);
    if (!result.ok || !output) return;
    const data = reportValue(output, "water") as Record<string, unknown>;
    expect(data.rpzMode).toBe("inline_part");
    expect(data.insSaved).toBe(true);
    expect(Number(data.insUpdated)).toBeGreaterThan(0);
    expect(data.sizedOk).toBe(true);
    expect(Number(data.totalWsfu)).toBeGreaterThan(0);
    expect(Number(data.designGpm)).toBeGreaterThan(0);
    expect(Number(data.availablePsi)).toBeGreaterThan(0);

    const settings = Object.values(model.elements).find(
      (e) => e.kind === "service_catalog" && e.entry.type === "plumbing_settings",
    );
    expect(settings).toBeDefined();
  });

  it("proposes & applies cleanouts, manages vertical stacks, and routes combustion vents", async () => {
    const script = defineScript({
      kind: "layout",
      parameters: {},
      reads: { levels: true },
      run(ctx) {
        routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(4), "cast_iron"),
          system: { id: "san-1", kind: "sanitary", name: "Sanitary" },
          height: units.ft(-2),
          slope: { rise: units.in(0.125), per: units.ft(1) },
          flow: "with_points",
          points: [{ x: units.ft(0), y: units.ft(0) }, { x: units.ft(120), y: units.ft(0) }],
        });
        const cleanouts = plumbing.proposeCleanouts(ctx, { system: "san-1", spacing: units.ft(100), apply: true });

        const stack = routes.along(ctx, {
          level: "L1",
          domain: "pipe",
          size: routes.pipe(units.in(4), "cast_iron"),
          system: { id: "san-1", kind: "sanitary", name: "Sanitary" },
          height: units.ft(-1),
          points: [
            { x: units.ft(10), y: units.ft(12), height: units.ft(-1) },
            { x: units.ft(10), y: units.ft(12), height: units.ft(14) },
          ],
        });
        const named = plumbing.manageStack(ctx, {
          action: "name",
          pipeId: stack.segment(1),
          number: "S-1",
          name: "Core Soil Stack",
          serves: "Restrooms",
        });
        plumbing.manageStack(ctx, { action: "checks", baseClearanceDiameters: 10 });

        const wh = equipment.place(ctx, {
          level: "L1",
          type: "builtin:plumbing-water-heater-tank@1",
          at: { x: units.ft(30), y: units.ft(15) },
          mark: "WH-1",
        });
        const vent = plumbing.connectCombustionVent(ctx, {
          equipment: wh,
          level: "L1",
          termination: { x: units.ft(30), y: units.ft(20), height: units.ft(15) },
          exhaust: { diameter: units.in(4), material: "pvc" },
          intake: true,
        });

        ctx.report("dwv", {
          cleanoutSpots: cleanouts.spots.length,
          cleanoutsPlaced: cleanouts.placedIds.length,
          stackIds: named.stackIds,
          exhaustSegment: vent.exhaust.segment(1),
          intakeSegment: vent.intake?.segment(1) ?? null,
        });
      },
    });

    const { result, output } = await execScript(emptyModel(), script);
    expect(result.ok).toBe(true);
    if (!result.ok || !output) return;
    const data = reportValue(output, "dwv") as Record<string, unknown>;
    expect(Number(data.cleanoutSpots)).toBeGreaterThanOrEqual(1);
    expect(Number(data.cleanoutsPlaced)).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.stackIds) && data.stackIds.length === 1).toBe(true);
    expect(typeof data.exhaustSegment).toBe("string");
    expect(typeof data.intakeSegment).toBe("string");
  });
});

describe("WS-5 mechanical kit (pack-decoupled)", () => {
  it("sets duct design, connects diffusers with CFM, sizes ducts, inserts dampers & inline fans, and runs airBalance", async () => {
    const script = defineScript({
      kind: "layout",
      parameters: {},
      reads: { levels: true },
      run(ctx) {
        equipment.place(ctx, {
          level: "L1",
          type: "builtin:rtu-5-ton@2",
          at: { x: units.ft(4), y: units.ft(10) },
          mark: "RTU-1",
        });
        const supply = routes.along(ctx, {
          level: "L1",
          domain: "duct",
          size: routes.rect(units.in(12), units.in(10)),
          system: { id: "sa-1", kind: "supply_air", name: "Supply Air" },
          height: units.ft(10.5),
          points: [{ x: units.ft(8), y: units.ft(10) }, { x: units.ft(36), y: units.ft(10) }],
        });
        mechanical.setSystemDesign(ctx, "sa-1", {
          material: "galvanized",
          temperatureF: 55,
          sizing: { frictionInPer100Ft: 0.08, maxVelocityFpm: 1200, maxAspectRatio: 4 },
          insulation: { kind: "wrap", thickness: units.in(2), rValue: 6 },
        });

        const d1 = equipment.place(ctx, {
          level: "L1",
          type: "builtin:supply-diffuser-24@1",
          at: { x: units.ft(18), y: units.ft(10) },
          height: units.ft(9),
          mark: "SD-1",
        });
        const d2 = equipment.place(ctx, {
          level: "L1",
          type: "builtin:supply-diffuser-24@1",
          at: { x: units.ft(28), y: units.ft(10) },
          height: units.ft(9),
          mark: "SD-2",
        });
        const conn = mechanical.connectDiffusers(ctx, {
          from: [
            { part: d1, cfm: 400 },
            { part: d2, cfm: 400 },
          ],
          into: supply.segment(1),
        });

        const standaloneSize = mechanical.sizeDucts(ctx, {
          cfm: 1600,
          shape: "rect",
          holdHeight: units.in(12),
          frictionInPer100Ft: 0.08,
        });
        const appliedSize = mechanical.sizeDucts(ctx, {
          segments: [supply.segment(1)],
          cfm: 1600,
          holdHeight: units.in(12),
          apply: true,
        });

        const fireDamper = mechanical.placeDamper(ctx, {
          segment: supply.segment(1),
          at: units.ft(4),
          kind: "fire",
          mark: "FD-1",
        });

        const exhaust = routes.along(ctx, {
          level: "L1",
          domain: "duct",
          size: routes.round(units.in(10)),
          system: { id: "ea-1", kind: "exhaust_air", name: "Exhaust Air" },
          height: units.ft(10.5),
          points: [{ x: units.ft(8), y: units.ft(22) }, { x: units.ft(32), y: units.ft(22) }],
        });
        const inlineFan = mechanical.placeAccessory(ctx, {
          segment: exhaust.segment(1),
          at: units.ft(12),
          typeId: "builtin:inline-fan-10@1",
          mark: "EF-1",
        });

        const balance = mechanical.airBalance(ctx, { scope: "model" });

        ctx.report("mech", {
          connectedCount: conn.connectedCount,
          standaloneSuggested: standaloneSize.segments[0]?.suggested,
          appliedCount: appliedSize.appliedCount,
          fireDamperId: fireDamper.id,
          inlineFanId: inlineFan.id,
          balanceOk: balance.ok,
        });
      },
    });

    const { result, output, model } = await execScript(emptyModel(), script);
    expect(result.ok).toBe(true);
    if (!result.ok || !output) return;
    const data = reportValue(output, "mech") as Record<string, unknown>;
    expect(data.connectedCount).toBe(2);
    expect(data.standaloneSuggested).toBeDefined();
    expect(data.appliedCount).toBe(1);
    expect(data.balanceOk).toBe(true);

    const sa = model.elements["sa-1"] as MepSystem;
    expect(sa.design?.material).toBe("galvanized");
    expect(sa.design?.sizing?.frictionInPer100Ft).toBe(0.08);

    const fd = model.elements[String(data.fireDamperId)] as PartInstance | undefined;
    expect(fd?.kind).toBe("part");
    expect(fd?.mark).toBe("FD-1");

    const ef = model.elements[String(data.inlineFanId)] as PartInstance | undefined;
    expect(ef?.kind).toBe("part");
    expect(ef?.mark).toBe("EF-1");
  });
});

describe("WS-5 automatic self-clash guard (self-clash.ts + runner.ts)", () => {
  const clashingScript = defineScript({
    kind: "layout",
    parameters: {},
    reads: { levels: true },
    run(ctx) {
      routes.along(ctx, {
        level: "L1",
        domain: "pipe",
        size: routes.pipe(units.in(4), "cast_iron"),
        system: { id: "san-1", kind: "sanitary", name: "Sanitary" },
        height: units.ft(10),
        points: [{ x: units.ft(0), y: units.ft(10) }, { x: units.ft(20), y: units.ft(10) }],
      });
      routes.along(ctx, {
        level: "L1",
        domain: "pipe",
        size: routes.pipe(units.in(4), "copper"),
        system: { id: "dcw-1", kind: "domestic_cold_water", name: "Cold Water" },
        height: units.ft(10),
        points: [{ x: units.ft(10), y: units.ft(0) }, { x: units.ft(10), y: units.ft(20) }],
      });
    },
  });

  const cleanScript = defineScript({
    kind: "layout",
    parameters: {},
    reads: { levels: true },
    run(ctx) {
      routes.along(ctx, {
        level: "L1",
        domain: "pipe",
        size: routes.pipe(units.in(4), "cast_iron"),
        system: { id: "san-1", kind: "sanitary", name: "Sanitary" },
        height: units.ft(8),
        points: [{ x: units.ft(0), y: units.ft(10) }, { x: units.ft(20), y: units.ft(10) }],
      });
      routes.along(ctx, {
        level: "L1",
        domain: "pipe",
        size: routes.pipe(units.in(4), "copper"),
        system: { id: "dcw-1", kind: "domestic_cold_water", name: "Cold Water" },
        height: units.ft(10),
        points: [{ x: units.ft(10), y: units.ft(0) }, { x: units.ft(10), y: units.ft(20) }],
      });
    },
  });

  it("attaches structured selfClashes warnings on dry-run when script-routed pipes cross at the same elevation", async () => {
    const { result } = await execScript(emptyModel(), clashingScript);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selfClashes).toBeDefined();
    expect(result.selfClashes?.total).toBeGreaterThan(0);
    expect(result.selfClashes?.checkedElementCount).toBeGreaterThanOrEqual(2);
    expect(result.selfClashes?.warnings[0]?.rule).toMatch(/^clash-(hard|self)$/);
    expect(result.selfClashes?.warnings[0]?.message).toBeTruthy();
  });

  it("fails the run with code self_clash when failOnSelfClash is enabled", async () => {
    const { result } = await execScript(emptyModel(), clashingScript, { failOnSelfClash: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("self_clash");
    expect(result.selfClashes?.total).toBeGreaterThan(0);
    expect(result.message).toMatch(/self-clash/i);
  });

  it("reports zero selfClashes and passes failOnSelfClash when crossing pipes have vertical clearance", async () => {
    const { result } = await execScript(emptyModel(), cleanScript, { failOnSelfClash: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selfClashes?.total).toBe(0);
    expect(result.selfClashes?.checkedElementCount).toBeGreaterThanOrEqual(2);
  });

  it("skips clash evaluation when a script touches only architectural walls (no runs or parts)", async () => {
    const wallOnly = defineScript({
      kind: "layout",
      parameters: {},
      reads: { levels: true },
      run(ctx) {
        building.wall(ctx, {
          level: "L1",
          height: units.ft(10),
          thickness: units.in(6),
          from: { x: units.ft(0), y: units.ft(0) },
          to: { x: units.ft(20), y: units.ft(0) },
        });
      },
    });
    const { result } = await execScript(emptyModel(), wallOnly, { failOnSelfClash: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selfClashes).toBeUndefined();
  });

  it("supports direct evaluateSelfClashes(before, output) and applySelfClashGuard inspection", async () => {
    const base = emptyModel();
    const { result, output } = await execScript(base, clashingScript, { skipSelfClash: true });
    expect(result.ok).toBe(true);
    if (!result.ok || !output) return;
    expect(result.selfClashes).toBeUndefined();
    const report = evaluateSelfClashes(base, output);
    expect(report.evaluated).toBe(true);
    expect(report.total).toBeGreaterThan(0);
    expect(report.warnings.length).toBe(report.total);

    const guarded = applySelfClashGuard(result, {
      slice: sliceModel(base, clashingScript.manifest.reads, [], SERVER_FEATURES),
      failOnSelfClash: true,
    });
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.code).toBe("self_clash");
  });
});

describe("WS-5 reference entries & error hints", () => {
  it("exposes plumbing & mechanical kits, under-slab viewBottom/viewDepth guidance, and schedule formula guidance", () => {
    const dts = kitDeclarations();
    expect(dts).toContain("PlumbingSystemDesignSpec");
    expect(dts).toContain("MechanicalSystemDesignSpec");
    expect(dts).toContain("setSystemDesign(");
    expect(dts).toContain("connectCombustionVent(");
    expect(dts).toContain("placeDamper(");

    const plumbHits = searchReference("plumbing.setSystemDesign");
    expect(plumbHits.some((e) => e.kind === "function" && e.name === "plumbing.setSystemDesign")).toBe(true);
    expect(searchReference("plumbing.sizeSystem").some((e) => e.kind === "function" && e.name === "plumbing.sizeSystem")).toBe(true);
    expect(searchReference("combustion vent").some((e) => e.kind === "function" && e.name === "plumbing.connectCombustionVent")).toBe(true);

    const mechHits = searchReference("mechanical.setSystemDesign");
    expect(mechHits.some((e) => e.kind === "function" && e.name === "mechanical.setSystemDesign")).toBe(true);
    expect(searchReference("mechanical.sizeDucts").some((e) => e.kind === "function" && e.name === "mechanical.sizeDucts")).toBe(true);
    expect(searchReference("fire damper").some((e) => e.kind === "function" && e.name === "mechanical.placeDamper")).toBe(true);

    const underSlabHits = searchReference("under-slab");
    expect(underSlabHits.some((r) => r.kind === "recipe" && /viewBottom.*viewDepth/i.test(r.name))).toBe(true);
    expect(underSlabHits.some((e) => e.kind === "function" && e.name === "documents.planView" && /viewDepthMm >= 0/i.test(e.summary))).toBe(true);

    const schedHits = searchReference("schedule formula");
    expect(schedHits.some((r) => r.kind === "recipe" && /schedule/i.test(r.name))).toBe(true);
    expect(schedHits.some((e) => e.kind === "function" && e.name === "documents.schedule" && /curly braces/i.test(e.summary))).toBe(true);
  });
});

describe("WS-5 worked commercial plumbing examples", () => {
  it("registers all three worked examples in KIT_EXAMPLE_SOURCES and kitExample()", () => {
    for (const name of [
      "fuel-gas-hybrid-pressure",
      "domestic-water-recirc-pressure-loss",
      "commercial-kitchen-dwv-grease",
    ]) {
      expect(KIT_EXAMPLE_SOURCES[name]).toBeTruthy();
      expect(kitExample(name)?.source).toBe(KIT_EXAMPLE_SOURCES[name]);
    }
  });

  it("runs fuel-gas-hybrid-pressure end-to-end with zero self-clashes", async () => {
    const { result, output, model } = await execScript(emptyModel("ex-gas", false), fuelGasHybridExample, {
      failOnSelfClash: true,
    });
    expect(result.ok ? "ok" : result.message).toBe("ok");
    if (!result.ok || !output) return;
    expect(result.selfClashes?.total ?? 0).toBe(0);
    expect(commandCount(output)).toBeGreaterThan(15);
    const gasSegs = Object.values(model.elements).filter(
      (e): e is RunSegment => e.kind === "run_segment" && e.systemId === "gas-1",
    );
    expect(gasSegs.length).toBeGreaterThanOrEqual(4);
  });

  it("runs domestic-water-recirc-pressure-loss end-to-end with zero self-clashes", async () => {
    const { result, output, model } = await execScript(emptyModel("ex-water", false), domesticWaterRecircExample, {
      failOnSelfClash: true,
    });
    expect(result.ok ? "ok" : result.message).toBe("ok");
    if (!result.ok || !output) return;
    expect(result.selfClashes?.total ?? 0).toBe(0);
    expect(commandCount(output)).toBeGreaterThan(20);
    const dcw = model.elements["dcw-1"] as MepSystem | undefined;
    const dhwr = model.elements["dhwr-1"] as MepSystem | undefined;
    expect(dcw?.kind).toBe("mep_system");
    expect(dhwr?.kind).toBe("mep_system");
  });

  it("runs commercial-kitchen-dwv-grease end-to-end with zero self-clashes", async () => {
    const { result, output, model } = await execScript(emptyModel("ex-dwv", false), commercialKitchenDwvExample, {
      failOnSelfClash: true,
    });
    expect(result.ok ? "ok" : result.message).toBe("ok");
    if (!result.ok || !output) return;
    expect(result.selfClashes?.total ?? 0).toBe(0);
    expect(commandCount(output)).toBeGreaterThan(20);
    const san = model.elements["san-1"] as MepSystem | undefined;
    const gw = model.elements["gw-1"] as MepSystem | undefined;
    expect(san?.kind).toBe("mep_system");
    expect(gw?.kind).toBe("mep_system");
  });
});
