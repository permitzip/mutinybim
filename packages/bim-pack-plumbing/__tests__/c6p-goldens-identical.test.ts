/**
 * @jest-environment node
 *
 * Round 6 lane P: moving Plumbing and gas into its add-on changed no number
 * and no stored name.
 *
 * - The riser and isometric goldens the moved suites compare against are the
 *   bytes they were before the move (sha-256 of each file at the round's base).
 * - 7492 Sample Market gas golden: 1,024,407 Btu/h and the 1-1/4" manifold, read
 *   through the built-in calc registry (what agents and the Plumbing tab run)
 *   and through this add-on's own calc row in a set holding only it: the
 *   same answer both ways.
 * - Stack commands parse back to the bytes they were sent as.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { builtinCalcRegistry, CalcRegistry, CALC_POINT } from "@permitzip/bim-calc";
import { canonicalJson, commandSchema } from "@permitzip/bim-kernel";
import { PackSet, withPackSet } from "@permitzip/bim-kernel/packs";
import { buildSampleMarketGas, SAMPLE_MARKET_GAS_SYSTEM, SAMPLE_MARKET_GAS_TOTAL_MBH } from "../../bim-kernel/__tests__/fixtures/sample-market-gas";
import { PLUMBING_GAS_PACK, type GasSystemSizing } from "../src";

const GOLDEN_SHA256: Readonly<Record<string, string>> = {
  "isometric-stack.svg": "e6f4e16dad0dda602c7cac936f3abdbed7541f5f27e07966d3d2ce9b2e63e38c",
  "riser-gas-propane.svg": "e09afed8590857280922f35b6b17f4b5bede2b9a5787618f0b86f1e1515b20b4",
  "riser-stack-sanitary.svg": "9a3c7a6661006b71da9acb34ea8540000114ce3d86e6e71551478f9ddf0abd27",
  "riser-sample-market-dcw.svg": "1a23e6dc30c59499c3ba2e10d84f290bde7048128e9afb45ff7731c994d23ff9",
  "riser-sample-market-dhw.svg": "7ff91c6ce781ace00eab6e3f7c1ab5ed9b938e6bba4c7c7198c3f68eae79372d",
  "riser-sample-market-gas.svg": "6485595037cb0e46eb47dfb671b6b7e27bdecb225cbfb9f2d67ff0d4ec7b8873",
  "riser-sample-market-sanitary.svg": "5e3484f73d5ee5a0245e9675e50e4350e205832feb3616f76a3e5080c3760b75",
};

function gasSizing(registry: CalcRegistry): GasSystemSizing {
  const r = registry.run({ calc: "plumbing.gas_system", inputs: { system_id: SAMPLE_MARKET_GAS_SYSTEM }, model: buildSampleMarketGas(), state: "VA" });
  if (!r.ok) throw new Error(r.reason);
  const sizing = r.run.detail as GasSystemSizing | undefined;
  if (!sizing) throw new Error("gas sizing returned no detail");
  return sizing;
}

const manifold = (s: GasSystemSizing) => s.proposals.find((p) => p.segmentId === "main-s3")?.proposed;

describe("Plumbing and gas numbers are unchanged by the move", () => {
  it("the moved goldens are byte-identical", () => {
    for (const [name, sha] of Object.entries(GOLDEN_SHA256)) {
      expect([name, createHash("sha256").update(readFileSync(path.join(__dirname, "golden", name))).digest("hex")]).toEqual([name, sha]);
    }
  });

  it("7492 Sample Market gas: 1,024,407 Btu/h and a 1-1/4\" manifold, through the registry and through the add-on alone", () => {
    const viaRegistry = gasSizing(builtinCalcRegistry());
    const alone = withPackSet(PackSet.create([PLUMBING_GAS_PACK]), () => gasSizing(new CalcRegistry({ packPoint: CALC_POINT })));
    expect(viaRegistry.totalMbh).toBe(SAMPLE_MARKET_GAS_TOTAL_MBH);
    expect(viaRegistry.totalMbh).toBe(1024.407);
    expect(manifold(viaRegistry)).toBe("1-1/4");
    expect(canonicalJson(alone)).toBe(canonicalJson(viaRegistry));
  });

  it("stack commands keep their stored bytes", () => {
    for (const sent of [
      { type: "name_stacks", stacks: [{ stackId: "stack-1", pipeId: "seg-1", number: "1" }] },
      { type: "edit_stack", stackId: "stack-1", name: null },
      { type: "delete_stacks", stackIds: ["stack-1"] },
      { type: "set_stack_checks", baseClearanceDiameters: 3 },
    ]) {
      const parsed = commandSchema.safeParse(sent);
      expect(parsed.success ? canonicalJson(parsed.data) : parsed.error.issues.map((i) => i.message).join("; ")).toBe(canonicalJson(sent));
    }
  });
});
