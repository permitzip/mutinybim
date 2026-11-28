/**
 * Commercial domestic water — service entrance, RPZ backflow, water heater,
 * expansion tank, DHWR recirculation loop, pipe insulation & pressure loss:
 *
 * Models a commercial domestic cold/hot/recirculation piping plant:
 *  - Street service entrance with WS-1 hydrant flow test curve (`flowTest`)
 *  - Inline RPZ backflow preventer and cold water main feeding flushometer WCs,
 *    lavatories, and a 3-compartment kitchen sink
 *  - 100 gal gas water heater + thermal expansion tank
 *  - Insulated DHW supply + DHWR return loop with balancing valve, check valve,
 *    and recirculation design settings (`dhwr`)
 *  - IECC 2021 Table C403.12.3 pipe insulation schedule applied to DHW/DHWR
 *  - Full IPC 2021 pipe sizing and pressure-loss report (`plumbing.waterReport`)
 *  - Domestic Water Plan, Live Plumbing Riser Diagram, and Fixture Schedule on P-201
 *
 * Run with `bim_run_script` or `npm run example -- domestic-water-recirc-pressure-loss`.
 */
import { defineScript, units, building, equipment, routes, plumbing, documents } from "@permitzip/bim-script";

const { ft } = units;
const inch = units.in;

export default defineScript({
  kind: "layout",
  parameters: {},
  reads: {},
  run(ctx) {
    const L1 = building.level(ctx, { id: "L1", name: "Level 1", elevation: ft(0) });
    building.level(ctx, { id: "ROOF", name: "Roof", elevation: ft(14) });

    building.walls(ctx, {
      level: L1,
      height: ft(14),
      thickness: inch(8),
      points: [
        { x: ft(0), y: ft(0) },
        { x: ft(48), y: ft(0) },
        { x: ft(48), y: ft(28) },
        { x: ft(0), y: ft(28) },
      ],
      closed: true,
    });

    // Water heater + thermal expansion tank in the mechanical corner.
    const wh = equipment.place(ctx, {
      level: L1,
      type: "builtin:plumbing-water-heater-tank@1",
      at: { x: ft(6), y: ft(20) },
      mark: "WH-1",
    });
    const expTank = equipment.place(ctx, {
      level: L1,
      type: "builtin:plumbing-expansion-tank@1",
      at: { x: ft(10), y: ft(20) },
      height: ft(5),
      mark: "ET-1",
    });

    // Commercial restroom + kitchen fixtures along the south wall.
    const wc1 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-wc-flushometer@1", at: { x: ft(18), y: ft(3) }, mark: "WC-1" });
    const wc2 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-wc-flushometer@1", at: { x: ft(23), y: ft(3) }, mark: "WC-2" });
    const lav1 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-lavatory@1", at: { x: ft(29), y: ft(3) }, mark: "L-1" });
    const lav2 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-lavatory@1", at: { x: ft(34), y: ft(3) }, mark: "L-2" });
    const sink3 = equipment.place(ctx, { level: L1, type: "builtin:plumbing-sink-3@1", at: { x: ft(42), y: ft(4) }, mark: "SK-3" });

    // Cold water main (DCW) at 10'-6" AFF along y=12 ft; separated vertically and
    // laterally from DHW (9'-8" AFF, y=14 ft) and DHWR (9'-0" AFF, y=16 ft) so
    // parallel headers stay completely clash-free.
    const dcwMain = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(2), "copper"),
      system: { id: "dcw-1", kind: "domestic_cold_water", name: "Domestic Cold Water" },
      height: ft(10.5),
      points: [
        { x: ft(1), y: ft(12) },
        { x: ft(44), y: ft(12) },
      ],
    });

    routes.connectInto(ctx, {
      from: [
        { elementId: wh.id, port: "cw" },
        { elementId: expTank.id, port: "cw" },
        { elementId: wc1.id, port: "cw" },
        { elementId: wc2.id, port: "cw" },
        { elementId: lav1.id, port: "cw" },
        { elementId: lav2.id, port: "cw" },
        { elementId: sink3.id, port: "cw" },
      ],
      into: dcwMain.segment(1),
    });

    // Main shutoff valve and inline RPZ backflow preventer near the service entry.
    // Place hosted accessories before inline part insertion (RPZ splits the host pipe).
    plumbing.placeAccessory(ctx, {
      segment: dcwMain.segment(1),
      at: ft(1.5),
      kind: "ball_valve",
      mark: "BV-CW1",
    });
    plumbing.placeAccessory(ctx, {
      segment: dcwMain.segment(1),
      at: ft(3.5),
      kind: "rpz",
      mark: "RPZ-1",
    });

    // Domestic Hot Water (DHW) header at 9'-8" AFF along y=14 ft.
    const dhwMain = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(1.25), "copper"),
      system: { id: "dhw-1", kind: "domestic_hot_water", name: "Domestic Hot Water" },
      height: ft(9.67),
      points: [
        { x: ft(8), y: ft(14) },
        { x: ft(44), y: ft(14) },
      ],
    });
    routes.connectInto(ctx, {
      from: [
        { elementId: wh.id, port: "hw" },
        { elementId: lav1.id, port: "hw" },
        { elementId: lav2.id, port: "hw" },
        { elementId: sink3.id, port: "hw" },
      ],
      into: dhwMain.segment(1),
    });

    // Domestic Hot Water Return (DHWR) loop at 9'-0" AFF along y=16 ft back toward WH-1.
    const dhwrMain = routes.along(ctx, {
      level: L1,
      domain: "pipe",
      size: routes.pipe(inch(0.75), "copper"),
      system: { id: "dhwr-1", kind: "domestic_hot_water_return", name: "Domestic Hot Water Return" },
      height: ft(9.0),
      points: [
        { x: ft(42), y: ft(16) },
        { x: ft(8), y: ft(16) },
      ],
    });

    // Balancing valve and check valve on the DHWR loop near the water heater.
    plumbing.placeAccessory(ctx, {
      segment: dhwrMain.segment(1),
      at: ft(24),
      kind: "balancing_valve",
      mark: "CBV-1",
    });
    plumbing.placeAccessory(ctx, {
      segment: dhwrMain.segment(1),
      at: ft(28),
      kind: "check_valve",
      mark: "CV-1",
    });

    // Configure DCW hydrant flow-test curve + ASHRAE demand curve, DHW, and DHWR loop metadata.
    plumbing.setSystemDesign(ctx, "dcw-1", {
      demandCurve: "ashrae_d",
      staticPressurePsi: 65,
      fixedLossesPsi: 15,
      minFixturePressurePsi: 25,
      maxVelocityFps: 8,
      flowTest: {
        staticPsi: 65,
        residualPsi: 52,
        testGpm: 120,
        elevationFt: 0,
        safetyMarginPsi: 5,
        location: "Main St Hydrant #14",
      },
    });
    plumbing.setSystemDesign(ctx, "dhw-1", {
      demandCurve: "ashrae_d",
      staticPressurePsi: 60,
      fixedLossesPsi: 16,
      minFixturePressurePsi: 15,
      maxVelocityFps: 5,
      waterTempF: 140,
    });
    plumbing.setSystemDesign(ctx, "dhwr-1", {
      maxVelocityFps: 4,
      waterTempF: 130,
      dhwr: {
        deltaTF: 10,
        heatLossBtuPerHrFt: 12,
        maxVelocityFps: 4,
        supplyTempF: 140,
        returnTempF: 130,
        pumpGpm: 6,
        pumpHeadFt: 12,
      },
    });

    // Apply IECC 2021 pipe insulation schedule to DHW and DHWR systems.
    plumbing.setInsulationSchedule(ctx, {
      rows: [
        {
          systemKinds: ["domestic_hot_water", "domestic_hot_water_return"],
          belowNominal: inch(1.5),
          thickness: inch(1),
          material: "fiberglass",
        },
        {
          systemKinds: ["domestic_hot_water", "domestic_hot_water_return"],
          belowNominal: inch(48),
          thickness: inch(1.5),
          material: "fiberglass",
        },
      ],
      source: "IECC 2021 Table C403.12.3",
      buildingType: "restaurant",
      demandCurve: "ipc_e_valve",
      applyToSystems: ["dhw-1", "dhwr-1"],
    });

    // Size DCW and DHW systems and run the domestic water pressure-loss report.
    const dcwSized = plumbing.sizeSystem(ctx, { system: "dcw-1", apply: true, plumbingEdition: "2021" });
    const dhwSized = plumbing.sizeSystem(ctx, { system: "dhw-1", apply: true, plumbingEdition: "2021" });
    const waterReport = plumbing.waterReport(ctx, "dcw-1", {
      plumbingEdition: "2021",
      pressure: {
        supplyKind: "flow_test",
        supplyPsi: 65,
        meterLossPsi: 4,
        backflowLossPsi: 12,
        backflowDevice: "RPZ",
        highestFixtureHeight: ft(4),
        criticalFixture: "WC-2 (Flushometer)",
        criticalFixturePsi: 25,
        developedLength: ft(95),
      },
    });

    // Documents: Domestic Water Plan, Live Plumbing Riser Diagram, Fixture & Pipe Schedules.
    const waterPlan = documents.planView(ctx, {
      level: L1,
      name: "Level 1 - Domestic Water Plan",
      discipline: "plumbing",
      scale: 48,
      viewTopRef: "level_above",
      viewBottom: ft(0),
      viewDepth: ft(0),
      browserGroup: "Plumbing",
      sortOrder: 201,
      detailLevel: "medium",
    });
    const waterRiser = documents.diagram(ctx, {
      name: "Domestic Water & DHWR Riser Diagram",
      kind: "plumbing_riser",
    });
    const fixtureSchedule = documents.schedule(ctx, {
      name: "Plumbing Fixture Schedule",
      category: "plumbing_fixture",
      columns: ["mark", "type_name", "level"],
    });

    const sheet = documents.sheet(ctx, {
      number: "P-201",
      name: "Domestic Water, DHWR & Pressure Loss",
      discipline: "plumbing",
      sortOrder: 201,
    });
    documents.place(ctx, sheet, waterPlan, { x: units.mm(230), y: units.mm(420) });
    documents.place(ctx, sheet, waterRiser, { x: units.mm(640), y: units.mm(420) }, 1);
    documents.place(ctx, sheet, fixtureSchedule, { x: units.mm(230), y: units.mm(150) });

    ctx.report("Domestic water & pressure loss", {
      totalWsfu: waterReport.totalWsfu,
      designGpm: waterReport.designGpm,
      availablePsi: waterReport.availablePsi,
      allowablePsiPer100Ft: waterReport.allowablePsiPer100Ft,
      dcwUpdates: dcwSized.appliedCount,
      dhwUpdates: dhwSized.appliedCount,
    });
    ctx.label(`Domestic water + DHWR loop sized (${dcwSized.appliedCount + dhwSized.appliedCount} updates) on sheet P-201`);
  },
});
