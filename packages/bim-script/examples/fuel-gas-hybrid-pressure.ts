/**
 * Commercial fuel gas — hybrid 2 psi / 7 in. w.c. system:
 *
 * Models a commercial kitchen & mechanical room supplied at 2 psi medium
 * pressure from the gas service entry, stepped down through an inline line
 * pressure regulator (7 in. w.c. outlet, 0.5 in. w.c. drop, vent limiter) to
 * feed commercial cooking appliances (gas range, gas fryer, gas flat-top grill)
 * and a tank water heater with shutoff valves, drip legs, and combustion flue
 * / intake venting.
 *
 * Uses the `plumbing` kit to configure IFGC 2021 longest-length design inputs,
 * place the regulator/shutoff/drip leg, run zone-by-zone IFGC 402.4 gas sizing,
 * apply the sized pipe diameters, and produce a gas plan, live plumbing riser
 * diagram, and gas appliance & pipe schedules on sheet P-401.
 *
 * Run with `bim_run_script` or `npm run example -- fuel-gas-hybrid-pressure`.
 */
import { defineScript, units, building, equipment, parts, routes, plumbing, documents } from "@permitzip/bim-script";

const { ft } = units;
const inch = units.in;

export default defineScript({
  kind: "layout",
  parameters: {},
  reads: {},
  run(ctx) {
    const L1 = building.level(ctx, { id: "L1", name: "Level 1", elevation: ft(0) });
    building.level(ctx, { id: "ROOF", name: "Roof", elevation: ft(14) });

    // Simple kitchen + mechanical room envelope (44 ft x 24 ft).
    building.walls(ctx, {
      level: L1,
      height: ft(14),
      thickness: inch(8),
      points: [
        { x: ft(0), y: ft(0) },
        { x: ft(44), y: ft(0) },
        { x: ft(44), y: ft(24) },
        { x: ft(0), y: ft(24) },
      ],
      closed: true,
    });
    building.wall(ctx, {
      level: L1,
      height: ft(9.5),
      thickness: inch(6),
      from: { x: ft(14), y: ft(0) },
      to: { x: ft(14), y: ft(24) },
    });

    // Utility gas meter at service entry (2 psi outlet, flowDirection: "out").
    // PartBuilder's "front" face points +X (east); a 12 in. tall box at 10'-0"
    // AFF places its mid-height gas outlet right at 10'-6" AFF.
    const meterPart = parts.part("Gas meter", { type: "2 psi Commercial", category: "pipe_accessory" });
    meterPart.box({ length: inch(14), width: inch(10), height: inch(12) });
    meterPart.connector("front", {
      id: "g",
      label: "Gas Outlet",
      domain: "pipe",
      systemKind: "natural_gas",
      shape: "round",
      diameter: inch(1.25),
      flowDirection: "out",
    });
    ctx.edit({
      type: "save_part_types",
      label: "Gas meter, 2 psi Commercial",
      types: [{ typeId: "example.gas.meter.2psi", definition: meterPart.build() }],
    });
    const meter = equipment.place(ctx, {
      level: L1,
      type: "example.gas.meter.2psi",
      at: { x: ft(2), y: ft(10) },
      height: ft(10),
      mark: "GM-1",
    });

    // Gas-fired commercial kitchen appliances + mechanical room water heater.
    const wh = equipment.place(ctx, {
      level: L1,
      type: "builtin:plumbing-water-heater-tank@1",
      at: { x: ft(6), y: ft(6) },
      mark: "WH-1",
    });
    const range = equipment.place(ctx, {
      level: L1,
      type: "builtin:plumbing-gas-range@1",
      at: { x: ft(22), y: ft(4) },
      mark: "GR-1",
    });
    const fryer = equipment.place(ctx, {
      level: L1,
      type: "builtin:plumbing-gas-fryer@1",
      at: { x: ft(29), y: ft(4) },
      mark: "GF-1",
    });
    const grill = equipment.place(ctx, {
      level: L1,
      type: "builtin:plumbing-gas-grill@1",
      at: { x: ft(36), y: ft(4) },
      mark: "GG-1",
    });

    // Black-steel natural gas overhead main (10'-6" AFF, clearing the 9'-6"
    // partition wall in the ceiling plenum). Medium-pressure (2 psi) from GM-1
    // to the line regulator at x=12 ft, stepping down to 7 in. w.c. for the
    // commercial kitchen manifold.
    const gasSystem = { id: "gas-1", kind: "natural_gas" as const, name: "Natural Gas (2 psi / 7 in. w.c.)" };
    const main = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(1.25), "black_steel"),
      system: gasSystem,
      height: ft(10.5),
      from: routes.atConnector(meter.id, "g"),
      points: [{ x: ft(38), y: ft(10) }],
    });
    // Vertical service drop off the main for the sediment trap / drip leg.
    const dripDrop = routes.branch(ctx, {
      trunk: main.segment(1),
      face: "bottom",
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(1), "black_steel"),
      system: gasSystem,
      height: ft(10.5),
      points: [
        { x: ft(16), y: ft(10), height: ft(10.5) },
        { x: ft(16), y: ft(10), height: ft(4) },
      ],
    });

    // Connect all four appliances onto the overhead gas header with clean spacing in X.
    routes.connectInto(ctx, {
      from: [
        { elementId: wh.id, port: "g" },
        { elementId: range.id, port: "g" },
        { elementId: fryer.id, port: "g" },
        { elementId: grill.id, port: "g" },
      ],
      into: main.segment(1),
    });

    // Configure hybrid 2 psi inlet pressure + 1 psi allowable drop (IFGC 402.4
    // longest-length method, 1000 Btu/cf natural gas) and appliance MBH inputs.
    plumbing.setSystemDesign(ctx, "gas-1", {
      fuel: "natural_gas",
      inletPressurePsi: 2,
      allowableDropPsi: 1,
      gasSizing: "longest_length",
      heatingValueBtuPerCf: 1000,
      fixtureTable: [
        { fixture: "Water heater, tank", mbh: 199 },
        { fixture: "Gas range", mbh: 220 },
        { fixture: "Gas fryer", mbh: 120 },
        { fixture: "Gas flat top grill", mbh: 90 },
      ],
    });

    // Place sediment trap / drip leg on the vertical drop, plus service shutoff
    // valve and 2 psi → 7 in. w.c. line regulator on the overhead main.
    plumbing.placeAccessory(ctx, {
      segment: dripDrop.segment(1),
      at: ft(2),
      kind: "drip_leg",
      nippleLength: inch(4),
      mark: "DL-1",
    });
    plumbing.placeAccessory(ctx, {
      segment: main.segment(1),
      at: ft(2.5),
      kind: "gas_shutoff",
      mark: "GV-MAIN",
    });
    plumbing.placeAccessory(ctx, {
      segment: main.segment(1),
      at: ft(12),
      kind: "gas_regulator",
      regulator: {
        role: "line",
        outletInWc: 7,
        dropInWc: 0.5,
        vent: "vent_limiter",
      },
      mark: "REG-1",
    });

    // Route Category IV PVC combustion exhaust + intake from the tank water heater
    // straight up through the roof, offset well clear of the overhead gas header.
    plumbing.connectCombustionVent(ctx, {
      equipment: wh,
      level: L1,
      termination: { x: ft(6), y: ft(18), height: ft(16) },
      exhaust: { diameter: inch(4), material: "pvc" },
      intake: { diameter: inch(4), material: "pvc", offset: { x: ft(2), y: ft(0) } },
    });

    // Run IFGC 2021 zone-by-zone gas sizing and apply the proposed nominal sizes.
    const sized = plumbing.sizeSystem(ctx, {
      system: "gas-1",
      apply: true,
      allowSmaller: true,
      fuelGasEdition: "2021",
    });
    const gasReport = plumbing.gasReport(ctx, "gas-1", { fuelGasEdition: "2021" });

    // Documents: Fuel Gas Plan, Live Plumbing Riser Diagram, Appliance & Pipe Schedules.
    const gasPlan = documents.planView(ctx, {
      level: L1,
      name: "Level 1 - Fuel Gas Plan",
      discipline: "plumbing",
      scale: 48,
      viewTopRef: "level_above",
      viewBottom: ft(0),
      viewDepth: ft(0),
      browserGroup: "Plumbing",
      sortOrder: 401,
      detailLevel: "medium",
    });
    const gasRiser = documents.diagram(ctx, {
      name: "Fuel Gas Riser Diagram",
      kind: "plumbing_riser",
    });
    const applianceSchedule = documents.schedule(ctx, {
      name: "Gas Appliance Schedule",
      category: "plumbing_fixture",
      columns: ["mark", "type_name", "level"],
    });
    const pipeSchedule = documents.schedule(ctx, {
      name: "Fuel Gas Pipe Schedule",
      category: "pipe",
      columns: ["system_name", "size", "length", "level"],
    });

    const sheet = documents.sheet(ctx, {
      number: "P-401",
      name: "Fuel Gas Plan, Riser & Schedules",
      discipline: "plumbing",
      sortOrder: 401,
    });
    documents.place(ctx, sheet, gasPlan, { x: units.mm(230), y: units.mm(420) });
    documents.place(ctx, sheet, gasRiser, { x: units.mm(640), y: units.mm(420) }, 1);
    documents.place(ctx, sheet, applianceSchedule, { x: units.mm(220), y: units.mm(150) });
    documents.place(ctx, sheet, pipeSchedule, { x: units.mm(560), y: units.mm(150) });

    ctx.report("Fuel gas sizing & pressure zones", {
      totalMbh: gasReport.totalMbh,
      zones: gasReport.zones.length,
      appliedSizes: sized.appliedCount,
      changes: sized.changes.map((c) => `${c.label}: ${c.currentLabel ?? "?"} -> ${c.proposedLabel}`),
      findings: gasReport.findings.length,
    });
    ctx.label(`Hybrid 2 psi / 7 in. w.c. fuel gas system sized (${sized.appliedCount} pipe updates) on sheet P-401`);
  },
});
