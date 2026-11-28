/**
 * @jest-environment node
 *
 * WS-8 Flagship Showcase Commercial Plumbing Set & Cross-Stream Integration Tests.
 *
 * Verifies:
 * 1. Showcase plumbing bug fixes: expansion tank ET-1 connected onto DCW water-heater
 *    inlet (dcw-wh), 0 hard/self/soft plumbing pipe clashes across all MEP runs and structure,
 *    and 0 plumbing code-lint findings across all active lint rules.
 * 2. Flagship 5-sheet commercial plumbing set (P-001, P-101, P-102, P-103, P-501)
 *    with 0 viewport-off-sheet overlaps/clipping.
 * 3. Cross-stream integration of WS-1 (generic WH CW+HW WSFU coupling, DHWR, 2 psi -> 7" w.c.
 *    IFGC gas sizing, Water Pressure Loss & Gas Sizing calc sheets), WS-2 (plumbing lint rules),
 *    WS-3 (labeled plumbing risers & isometric), WS-4 (realistic parts & materials),
 *    WS-6 (P-501 model-linked detail views via linkedElementIds), and WS-9 (clickable cut_sheet
 *    hyperlinks in SVG and PDF exports).
 */

import { ifgcEdition } from "@permitzip/bim-calc";
import {
  buildSheetSceneFor,
  checkDetailView,
  elementsOfKind,
  sceneToSvg,
  validateModel,
} from "@permitzip/bim-kernel";
import { activeLintRules, DEFAULT_LINT_CONFIG, LintEngine } from "@permitzip/bim-lint";
import {
  GAS_SIZING_TEMPLATE_ID,
  WATER_PRESSURE_LOSS_TEMPLATE_ID,
  gasNetwork,
  sizeGasSystem,
  waterReportOf,
} from "@permitzip/bim-pack-plumbing";
import { createShowcaseDemoModel } from "../src/seed";

describe("WS-8 Flagship Showcase Plumbing Set & Cross-Stream Integration", () => {
  const model = createShowcaseDemoModel("ws8-showcase-plumbing");
  const eng = new LintEngine(activeLintRules());
  eng.build(model, []);
  const findings = eng.check({ config: { ...DEFAULT_LINT_CONFIG, ruleset: "issue" } });

  it("passes kernel validation with 0 plumbing hard/self/soft run clashes and 0 structural pipe clashes", () => {
    expect(validateModel(model)).toEqual([]);

    const pipeToRunClashes = findings.filter(
      (f) =>
        f.rule.startsWith("clash-") &&
        f.elementIds.every((id) => {
          const el = model.elements[id];
          return el?.kind === "run_segment" || el?.kind === "run_fitting";
        }) &&
        f.elementIds.some((id) => {
          const el = model.elements[id];
          return (el?.kind === "run_segment" || el?.kind === "run_fitting") && el.domain === "pipe";
        }),
    );
    expect(pipeToRunClashes).toEqual([]);

    const pipeToStructHardClashes = findings.filter(
      (f) =>
        (f.rule === "clash-hard" || f.rule === "clash-self") &&
        f.elementIds.some((id) => {
          const el = model.elements[id];
          return el?.kind === "run_segment" && el.domain === "pipe";
        }) &&
        f.elementIds.some((id) => {
          const el = model.elements[id];
          return el?.kind === "column" || el?.kind === "beam";
        }),
    );
    expect(pipeToStructHardClashes).toEqual([]);
  });

  it("clears all WS-2 plumbing code-lint rules and all P-001..P-501 sheet viewport layout checks", () => {
    const plumbingRuleIds = new Set([
      "closed-water-expansion-tank",
      "water-heater-condensate-neutralizer",
      "gas-system-sizing-lint",
      "gas-appliance-venting-check",
      "vtr-air-intake-clearance",
      "backflow-protection-missing",
      "backflow-protection-insufficient",
    ]);
    const plumbingHits = findings.filter((f) => plumbingRuleIds.has(f.rule));
    expect(plumbingHits).toEqual([]);

    const plumbingSheetIds = new Set(["sheet-p001", "sheet-p101", "sheet-p102", "sheet-p103", "sheet-p501"]);
    const plumbingSheetLayoutIssues = findings.filter(
      (f) => f.rule === "viewport-off-sheet" && f.elementIds.some((id) => plumbingSheetIds.has(id)),
    );
    expect(plumbingSheetLayoutIssues).toEqual([]);
  });

  it("connects ET-1 to sys-dcw, couples full CW+HW WSFU on sys-dcw, and models DHWR loop with powered RP-1", () => {
    const allSegs = elementsOfKind(model.elements, "run_segment");
    // Expansion tank ET-1 is connected via dcw-et1 onto sys-dcw
    const etSegs = allSegs.filter((el) => el.systemId === "sys-dcw" && el.id.startsWith("dcw-et1"));
    expect(etSegs.length).toBeGreaterThan(0);

    // WS-1 generic WH CW+HW coupling: sys-dcw carries full building CW+HW demand (>= 50 WSFU) & passes pressure check
    const waterReport = waterReportOf(model.elements, "sys-dcw");
    expect(waterReport).not.toBeNull();
    expect(waterReport?.totalFixtureUnits).toBeGreaterThanOrEqual(50);
    expect(waterReport?.pass).toBe(true);
    expect(waterReport?.deviceLosses.map((d) => d.label)).toEqual(
      expect.arrayContaining([expect.stringMatching(/MTR-1/), expect.stringMatching(/RPZ-1/)]),
    );

    // DHWR return system + circuited recirc pump RP-1
    const dhwrSys = model.elements["sys-dhwr"];
    expect(dhwrSys?.kind).toBe("mep_system");
    if (dhwrSys?.kind === "mep_system") {
      expect(dhwrSys.systemKind).toBe("domestic_hot_water_return");
    }
    const dhwrSegs = allSegs.filter((el) => el.systemId === "sys-dhwr");
    expect(dhwrSegs.length).toBeGreaterThanOrEqual(4);

    const rp1 = model.elements["rp-1"];
    expect(rp1?.kind).toBe("part");
    const rp1Link = model.elements["ckt-lp-rp1"];
    expect(rp1Link?.kind).toBe("service_link");
    if (rp1Link?.kind === "service_link") {
      expect(rp1Link.source.elementId).toBe("lp-1");
      expect(rp1Link.members.some((m) => m.elementId === "rp-1")).toBe(true);
    }
  });

  it("models roof drain RD-1 on storm system and 2 psi -> 7\" w.c. IFGC fuel gas system with WH-2, CN-1, drip legs & RTU-1", () => {
    const rd1 = model.elements["rd-1"];
    expect(rd1?.kind).toBe("part");
    const stormSegs = elementsOfKind(model.elements, "run_segment").filter(
      (el) => el.systemId === "sys-plumb-storm",
    );
    expect(stormSegs.length).toBeGreaterThanOrEqual(2);

    const gn = gasNetwork(model, "sys-gas");
    expect(gn).not.toBeNull();
    expect(gn?.totalMbh).toBe(271);
    expect(gn?.zones).toHaveLength(2);
    expect(gn?.zones[0]?.inletInWc).toBeCloseTo(55.4, 1);
    expect(gn?.zones[1]?.inletInWc).toBeCloseTo(7, 1);
    expect(gn?.appliances.map((a) => a.elementId).sort()).toEqual(["rtu-1", "wh-2"]);

    const sized = sizeGasSystem(model, "sys-gas", ifgcEdition("2021"));
    expect(sized.ok).toBe(true);
    if (sized.ok) {
      expect(sized.sizing.findings.filter((f) => f.severity === "error")).toEqual([]);
    }

    expect(model.elements["cn-1"]?.kind).toBe("part");
    const dripWh2 = model.elements["drip-wh2"];
    const dripRtu1 = model.elements["drip-rtu1"];
    expect(dripWh2?.kind).toBe("run_fitting");
    expect(dripRtu1?.kind).toBe("run_fitting");
    if (dripWh2?.kind === "run_fitting") expect(dripWh2.family).toBe("pipe.gas.drip_leg");
    if (dripRtu1?.kind === "run_fitting") expect(dripRtu1.family).toBe("pipe.gas.drip_leg");
  });

  it("builds the flagship 5-sheet plumbing set (P-001..P-501) with live calc sheets, WS-6 linkedElementIds, and WS-9 clickable cut_sheet links", () => {
    const expectedSheets = [
      { id: "sheet-p001", number: "P-001" },
      { id: "sheet-p101", number: "P-101" },
      { id: "sheet-p102", number: "P-102" },
      { id: "sheet-p103", number: "P-103" },
      { id: "sheet-p501", number: "P-501" },
    ];

    for (const s of expectedSheets) {
      const el = model.elements[s.id];
      expect(el?.kind).toBe("sheet");
      if (el?.kind === "sheet") {
        expect(el.number).toBe(s.number);
      }
      const scene = buildSheetSceneFor(model, s.id, { projectName: "MutinyBIM Showcase" });
      expect(scene.primitives.length).toBeGreaterThan(200);
    }

    // Live calc sheet blocks on P-101 and P-103
    const waterCalc = model.elements["calc-water-loss"];
    expect(waterCalc?.kind).toBe("drawing_item");
    if (waterCalc?.kind === "drawing_item") {
      expect(waterCalc.block?.calc?.template).toBe(WATER_PRESSURE_LOSS_TEMPLATE_ID);
    }
    const gasCalc = model.elements["calc-gas-sizing"];
    expect(gasCalc?.kind).toBe("drawing_item");
    if (gasCalc?.kind === "drawing_item") {
      expect(gasCalc.block?.calc?.template).toBe(GAS_SIZING_TEMPLATE_ID);
    }

    // WS-9 clickable cut_sheet hyperlinks on P-101 in both scene primitives (consumed by bim-sheets PDF) and SVG output
    const p101Scene = buildSheetSceneFor(model, "sheet-p101", { projectName: "MutinyBIM Showcase" });
    const linkedPrimitives = p101Scene.primitives.filter(
      (p) => p.kind === "text" && typeof p.href === "string" && p.href.startsWith("https://"),
    );
    expect(linkedPrimitives.length).toBeGreaterThanOrEqual(2);
    const p101Svg = sceneToSvg(p101Scene);
    expect(p101Svg).toContain("<a ");
    expect(p101Svg).toContain("https://");

    // WS-6 model-linked CAD plumbing details on P-501 + P-001 legend QA
    const detailChecks: Array<{ viewId: string; linked: string[] }> = [
      { viewId: "view-detail-wh-assembly", linked: ["wh-1", "et-1"] },
      { viewId: "view-detail-rpz", linked: ["rpz-1"] },
      { viewId: "view-detail-fco", linked: ["fco-1"] },
      { viewId: "view-detail-vtr", linked: ["vtr-1"] },
    ];
    for (const d of detailChecks) {
      const v = model.elements[d.viewId];
      expect(v?.kind).toBe("view");
      if (v?.kind === "view") {
        expect(v.props?.linkedElementIds).toEqual(d.linked);
      }
      const qa = checkDetailView(model, d.viewId);
      expect(qa.textOverlaps).toEqual([]);
      expect(qa.clippedItems).toEqual([]);
      expect(qa.orphanedDimensions).toEqual([]);
    }
    expect(checkDetailView(model, "view-plumb-legend").clean).toBe(true);
  });
});
