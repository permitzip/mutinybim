import type { ClearanceZone, Dim, ParamDef, PartConnector, PartTypeDefinition, SymbolPrimitive } from "@permitzip/bim-kernel";

type GeometryPrimitive = PartTypeDefinition["geometry"][number];

const IN = 25.4;

const p = (name: string): Dim => ({ param: name });
const half = (name: string): Dim => ({ param: name, scale: 0.5 });
const neg = (name: string): Dim => ({ param: name, scale: -0.5 });
const len = (name: string, label: string, def?: number): ParamDef => ({
  name,
  label,
  kind: "length",
  unit: "mm",
  min: 0,
  ...(def !== undefined ? { default: def } : {}),
});
const num = (name: string, label: string, unit: ParamDef["unit"] = "none", def?: number): ParamDef => ({
  name,
  label,
  kind: "number",
  unit,
  min: 0,
  ...(def !== undefined ? { default: def } : {}),
});
const txt = (name: string, label: string): ParamDef => ({ name, label, kind: "text" });
const choice = (name: string, label: string, choices: readonly string[], def?: string): ParamDef => ({
  name,
  label,
  kind: "choice",
  choices: [...choices],
  ...(def !== undefined ? { default: def } : {}),
});

/**
 * Cut-sheet-based realistic geometry, materials, clearances, parameters, symbols,
 * and connector placements for starter plumbing and fuel-gas parts.
 */
export interface CustomPartProfile {
  readonly materialId: string;
  readonly geometry: readonly GeometryPrimitive[];
  readonly symbol?: readonly SymbolPrimitive[];
  readonly clearances?: readonly ClearanceZone[];
  readonly extraParams?: readonly ParamDef[];
  readonly extraValues?: Readonly<Record<string, number | string>>;
  readonly extraInstanceParams?: readonly ParamDef[];
  /** Per-port overrides applied to generated connectors from `spec.ports`. */
  readonly connectorOverrides?: Readonly<Record<string, Partial<PartConnector>>>;
  /** Additional multi-trade or specialized connectors appended after `spec.ports`. */
  readonly extraConnectors?: readonly PartConnector[];
}

const BACKFLOW_KIND_PARAM: ParamDef = choice("backflow_kind", "Backflow preventer type", ["rpz", "dcva", "pvb"]);
const PRESSURE_DROP_PARAM: ParamDef = num("pressure_drop_psi", "Design pressure drop (psi)", "psi");

/** Default first-party MEP material id for starter parts without a bespoke geometry profile. */
export function defaultPlumbingMaterialId(slug: string): string {
  if (slug.startsWith("wc-") || slug === "urinal" || slug === "lavatory" || slug === "hand-sink") return "plumbing_gas.vitreous_china";
  if (slug.startsWith("sink-") || slug === "mop-sink" || slug === "drinking-fountain" || slug === "ice-maker" || slug === "dishwasher" || slug === "gas-range" || slug === "gas-fryer" || slug === "gas-grill") {
    return "plumbing_gas.stainless_304";
  }
  if (slug.startsWith("water-heater-")) return "plumbing_gas.equipment_enamel_blue";
  if (slug === "hose-bibb" || slug === "prv") return "plumbing_gas.brass_bronze";
  if (slug === "sediment-trap" || slug === "gas-regulator") return "plumbing_gas.black_steel";
  return "plumbing_gas.cast_iron_dwv";
}

export function customPartProfile(slug: string): CustomPartProfile | null {
  switch (slug) {
    // ------------------------------------------------------------------
    // Upgraded existing starter parts (cut-sheet multi-primitive geometry)
    // ------------------------------------------------------------------
    case "water-heater-tank":
      return {
        materialId: "plumbing_gas.equipment_enamel_blue",
        extraParams: [
          num("capacity_gal", "Storage capacity (gal)", "none"),
          num("input_mbh", "Gas input (MBH)", "none"),
          num("thermal_efficiency", "Thermal efficiency", "none"),
          num("recovery_gph", "Recovery at 100 °F rise (gph)", "none"),
          len("hwr_connection_size", "Hot water return connection size"),
          len("flue_size", "Exhaust flue collar size"),
        ],
        extraValues: {
          capacity_gal: 100,
          input_mbh: 199,
          thermal_efficiency: 0.96,
          recovery_gph: 232,
          hwr_connection_size: 0.75 * IN,
          flue_size: 4 * IN,
        },
        geometry: [
          // Circular overflow drain pan at floor (32" Ø × 2" H)
          { kind: "cylinder", center: [0, 0, 25], radius: { param: "width", scale: 0.53 }, height: 50, axis: "z" },
          // Insulated commercial cylindrical tank jacket
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.48 }], radius: half("width"), height: { param: "height", scale: 0.86 }, axis: "z" },
          // Domed upper ASME head shroud
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.93 }], radius: { param: "width", scale: 0.44 }, height: { param: "height", scale: 0.06 }, axis: "z" },
          // Top combustion blower & exhaust flue collar reaching z = height
          { kind: "cylinder", center: [0, -80, { param: "height", add: -37 }], radius: 64, height: 74, axis: "z" },
          // Side-tapped CW & HW 1" NPT connection nipples (+Y, z = 450) flush at y = width/2 + 45
          { kind: "cylinder", center: [100, { param: "width", scale: 0.5, add: 22.5 }, 450], radius: 22, height: 45, axis: "y" },
          { kind: "cylinder", center: [-100, { param: "width", scale: 0.5, add: 22.5 }, 450], radius: 22, height: 45, axis: "y" },
          // Side gas train valve & burner manifold box (+X)
          { kind: "box", center: [{ param: "width", scale: 0.5, add: 35 }, 0, 360], size: [70, 120, 150] },
          // Side hot-water recirculation return stub (-X)
          { kind: "cylinder", center: [{ param: "width", scale: -0.5, add: -25 }, 0, 560], radius: 20, height: 50, axis: "x" },
          // Front digital control display & handhole cleanout cover (+Y)
          { kind: "box", center: [0, { param: "width", scale: 0.5, add: 14 }, 1180], size: [180, 28, 220] },
          // Lower front drain valve stub (+Y)
          { kind: "box", center: [0, { param: "width", scale: 0.5, add: 22 }, 190], size: [38, 44, 38] },
        ],
        connectorOverrides: {
          cw: { position: [100, { param: "width", scale: 0.5, add: 45 }, 450], direction: [0, 1, 0], flowDirection: "in" },
          hw: { position: [-100, { param: "width", scale: 0.5, add: 45 }, 450], direction: [0, 1, 0], flowDirection: "out" },
          hwr: { position: [{ param: "width", scale: -0.5, add: -50 }, 0, 560], direction: [-1, 0, 0], diameter: p("hwr_connection_size"), flowDirection: "in" },
          g: { position: [{ param: "width", scale: 0.5, add: 70 }, 0, 360], direction: [1, 0, 0], flowDirection: "in" },
        },
        extraConnectors: [
          {
            id: "flue",
            label: "Exhaust flue",
            domain: "duct",
            systemKind: "exhaust_air",
            position: [0, -80, p("height")],
            direction: [0, 0, 1],
            shape: "round",
            diameter: p("flue_size"),
            endType: "mechanical.slip",
            flowDirection: "out",
          },
        ],
        clearances: [
          { id: "service", name: "Burner & Control Service", purpose: "service_access", face: "left", depth: 24 * IN, cite: "IPC 502.5" },
          { id: "combustibles", name: "Clearance to Combustibles", purpose: "combustible", face: "top", depth: 18 * IN, cite: "IFGC 308" },
        ],
        symbol: [
          { kind: "circle", center: [0, 0], radius: half("width"), fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, 0], radius: { param: "width", scale: 0.41 }, pen: "thin" },
          { kind: "circle", center: [110, 60], radius: 26, pen: "thin" },
          { kind: "circle", center: [-110, 60], radius: 26, pen: "thin" },
          { kind: "circle", center: [0, -80], radius: 64, pen: "thin" },
        ],
      };

    case "water-heater-gas-tankless":
      return {
        materialId: "plumbing_gas.stainless_304",
        extraParams: [
          num("input_mbh", "Gas input (MBH)", "none"),
          num("thermal_efficiency", "Uniform energy factor (UEF)", "none"),
          len("flue_size", "Condensing flue collar size"),
          len("intake_size", "Combustion air intake collar size"),
          len("condensate_size", "Condensate drain connection size"),
        ],
        extraValues: {
          input_mbh: 199,
          thermal_efficiency: 0.96,
          flue_size: 3 * IN,
          intake_size: 3 * IN,
          condensate_size: 0.75 * IN,
        },
        geometry: [
          // Rear wall-mounting bracket plate (+Y rear)
          { kind: "box", center: [0, { param: "depth", scale: 0.46 }, { param: "height", scale: 0.5 }], size: [{ param: "width", scale: 0.92 }, 18, { param: "height", scale: 0.96 }] },
          // Brushed stainless condensing commercial cabinet
          { kind: "box", center: [0, 0, { param: "height", scale: 0.5 }], size: [p("width"), { param: "depth", scale: 0.92 }, { param: "height", scale: 0.9 }] },
          // Front recessed digital controller bezel (-Y front)
          { kind: "box", center: [0, { param: "depth", scale: -0.47 }, { param: "height", scale: 0.55 }], size: [120, 12, 140] },
          // Top 3" Category IV condensing exhaust flue collar (top z = height + 60)
          { kind: "cylinder", center: [-85, 0, { param: "height", add: 12 }], radius: 44, height: 96, axis: "z" },
          // Top 3" combustion air intake collar (top z = height + 60)
          { kind: "cylinder", center: [85, 0, { param: "height", add: 12 }], radius: 44, height: 96, axis: "z" },
          // Bottom connection spuds extending flush down to z = 0
          { kind: "cylinder", center: [-140, 0, 17.5], radius: 16, height: 35, axis: "z" },
          { kind: "cylinder", center: [-45, 0, 17.5], radius: 16, height: 35, axis: "z" },
          { kind: "cylinder", center: [45, 0, 17.5], radius: 14, height: 35, axis: "z" },
          { kind: "cylinder", center: [140, 0, 17.5], radius: 16, height: 35, axis: "z" },
        ],
        connectorOverrides: {
          cw: { position: [140, 0, 0], direction: [0, 0, -1], flowDirection: "in" },
          hw: { position: [-140, 0, 0], direction: [0, 0, -1], flowDirection: "out" },
          g: { position: [-45, 0, 0], direction: [0, 0, -1], flowDirection: "in" },
        },
        extraConnectors: [
          {
            id: "flue",
            label: "Condensing flue",
            domain: "duct",
            systemKind: "exhaust_air",
            position: [-85, 0, { param: "height", add: 60 }],
            direction: [0, 0, 1],
            shape: "round",
            diameter: p("flue_size"),
            endType: "mechanical.slip",
            flowDirection: "out",
          },
          {
            id: "intake",
            label: "Combustion air intake",
            domain: "duct",
            systemKind: "outside_air",
            position: [85, 0, { param: "height", add: 60 }],
            direction: [0, 0, 1],
            shape: "round",
            diameter: p("intake_size"),
            endType: "mechanical.slip",
            flowDirection: "in",
          },
          {
            id: "condensate",
            label: "Condensate drain",
            domain: "pipe",
            systemKind: "condensate",
            position: [45, 0, 0],
            direction: [0, 0, -1],
            shape: "round",
            diameter: p("condensate_size"),
            endType: "plumbing_gas.solvent_weld",
            flowDirection: "out",
          },
        ],
        clearances: [
          { id: "service", name: "Front Cover Service", purpose: "service_access", face: "right", depth: 24 * IN, cite: "IFGC 306" },
          { id: "bottom_piping", name: "Isolation & Descale Service", purpose: "service_access", face: "bottom", depth: 12 * IN, cite: "Mfr" },
        ],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "circle", center: [-85, 0], radius: 44, pen: "thin" },
          { kind: "circle", center: [85, 0], radius: 44, pen: "thin" },
        ],
      };

    case "recirc-pump":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [
          num("pump_rated_gpm", "Rated flow", "gpm"),
          num("pump_rated_head_ft", "Rated head (ft)", "none"),
          num("pump_shutoff_head_ft", "Shutoff head (ft)", "none"),
          num("motor_hp", "Motor HP", "hp"),
          num("voltage", "Voltage", "v"),
        ],
        extraValues: {
          pump_rated_gpm: 5,
          pump_rated_head_ft: 12,
          pump_shutoff_head_ft: 18,
          motor_hp: 0.08,
          voltage: 120,
        },
        geometry: [
          // Bronze spiral volute casing
          { kind: "cylinder", center: [0, 0, 0], radius: 52, height: 68, axis: "y" },
          // Inline flow barrel spanning flange-to-flange along X
          { kind: "cylinder", center: [0, 0, 0], radius: 20, height: p("width"), axis: "x" },
          // Twin 2-bolt bronze companion flanges flush at ±width/2
          { kind: "cylinder", center: [{ param: "width", scale: -0.5, add: 9 }, 0, 0], radius: 42, height: 18, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.5, add: -9 }, 0, 0], radius: 42, height: 18, axis: "x" },
          // Horizontal wet-rotor electric motor cartridge (+Y)
          { kind: "cylinder", center: [0, 74, 0], radius: 44, height: 90, axis: "y" },
          // Top conduit terminal box on motor (top z = +76)
          { kind: "box", center: [0, 76, 56], size: [54, 62, 40] },
        ],
        connectorOverrides: {
          power: { position: [0, 76, 76], direction: [0, 0, 1], voltage: 120, poles: 1 },
        },
        clearances: [{ id: "service", name: "Motor & Cartridge Access", purpose: "service_access", face: "left", depth: 12 * IN, cite: "Mfr" }],
        symbol: [
          { kind: "circle", center: [0, 0], radius: 52, fill: "mask", pen: "medium" },
          { kind: "line", from: [neg("width"), 0], to: [-52, 0], pen: "thin" },
          { kind: "line", from: [52, 0], to: [half("width"), 0], pen: "thin" },
          { kind: "polyline", points: [[-30, -28], [38, 0], [-30, 28]], closed: true, pen: "thin" },
        ],
      };

    case "grease-interceptor":
      return {
        materialId: "plumbing_gas.cast_iron_dwv",
        extraParams: [
          num("rated_gpm", "Rated flow capacity", "gpm"),
          num("grease_capacity_lb", "Grease retention capacity (lb)", "lb"),
          num("liquid_capacity_gal", "Liquid capacity (gal)", "none"),
        ],
        extraValues: {
          rated_gpm: 100,
          grease_capacity_lb: 200,
          liquid_capacity_gal: 250,
        },
        geometry: [
          // Main baffled commercial interceptor tank body
          { kind: "box", center: [0, 0, { param: "height", scale: 0.44 }], size: [{ param: "width", scale: 0.92 }, p("depth"), { param: "height", scale: 0.88 }] },
          // Twin exterior structural reinforcement ribs
          { kind: "box", center: [-420, 0, { param: "height", scale: 0.44 }], size: [60, { param: "depth", add: 36 }, { param: "height", scale: 0.82 }] },
          { kind: "box", center: [420, 0, { param: "height", scale: 0.44 }], size: [60, { param: "depth", add: 36 }, { param: "height", scale: 0.82 }] },
          // Twin raised manhole access risers + bolted cast-iron covers (inlet & outlet chambers)
          { kind: "cylinder", center: [{ param: "width", scale: -0.22 }, 0, { param: "height", scale: 0.93 }], radius: 260, height: { param: "height", scale: 0.1 }, axis: "z" },
          { kind: "cylinder", center: [{ param: "width", scale: -0.22 }, 0, { param: "height", scale: 0.99 }], radius: 280, height: { param: "height", scale: 0.02 }, axis: "z" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.22 }, 0, { param: "height", scale: 0.93 }], radius: 260, height: { param: "height", scale: 0.1 }, axis: "z" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.22 }, 0, { param: "height", scale: 0.99 }], radius: 280, height: { param: "height", scale: 0.02 }, axis: "z" },
          // Inlet 4" no-hub baffle stub flush at -width/2
          { kind: "cylinder", center: [{ param: "width", scale: -0.48 }, 0, { param: "height", scale: 0.65 }], radius: 60, height: { param: "width", scale: 0.04 }, axis: "x" },
          // Outlet 4" no-hub baffle stub flush at +width/2 (slight gravity drop across baffles)
          { kind: "cylinder", center: [{ param: "width", scale: 0.48 }, 0, { param: "height", scale: 0.6 }], radius: 60, height: { param: "width", scale: 0.04 }, axis: "x" },
        ],
        connectorOverrides: {
          in: { position: [neg("width"), 0, { param: "height", scale: 0.65 }], direction: [-1, 0, 0] },
          out: { position: [half("width"), 0, { param: "height", scale: 0.6 }], direction: [1, 0, 0] },
        },
        clearances: [{ id: "pump_out", name: "Grease Pump-Out & Cover Removal", purpose: "service_access", face: "top", depth: 36 * IN, cite: "IPC 1003.3" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "line", from: [0, neg("depth")], to: [0, half("depth")], pen: "thin" },
          { kind: "circle", center: [{ param: "width", scale: -0.22 }, 0], radius: 260, pen: "thin" },
          { kind: "circle", center: [{ param: "width", scale: 0.22 }, 0], radius: 260, pen: "thin" },
        ],
      };

    case "gas-regulator":
      return {
        materialId: "plumbing_gas.black_steel",
        extraParams: [
          choice("role", "Regulator role", ["service", "line", "appliance"], "line"),
          num("outlet_in_wc", "Outlet pressure (in. w.c.)", "in_wc"),
          num("zone_drop_in_wc", "Allowable downstream drop (in. w.c.)", "in_wc"),
          num("capacity_mbh", "Rated capacity (MBH)", "none"),
          choice("vent", "Venting method", ["limiter", "piped_outdoors"], "limiter"),
        ],
        extraValues: {
          role: "line",
          outlet_in_wc: 7,
          zone_drop_in_wc: 0.5,
          capacity_mbh: 1250,
          vent: "limiter",
        },
        geometry: [
          // Lower inline gas valve body spanning -width/2 to +width/2
          { kind: "cylinder", center: [0, 0, 0], radius: 24, height: p("width"), axis: "x" },
          // Threaded inlet & outlet hex bosses flush at ±width/2
          { kind: "cylinder", center: [{ param: "width", scale: -0.5, add: 14 }, 0, 0], radius: 30, height: 28, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.5, add: -14 }, 0, 0], radius: 30, height: 28, axis: "x" },
          // Central valve throat neck
          { kind: "cylinder", center: [0, 0, 32], radius: 34, height: 40, axis: "z" },
          // Wide circular diaphragm housing (pancake flange)
          { kind: "cylinder", center: [0, 0, 68], radius: 74, height: 34, axis: "z" },
          // Upper spring-housing bonnet tower
          { kind: "cylinder", center: [0, 0, 118], radius: 28, height: 68, axis: "z" },
          // Top pressure-adjustment cap nut
          { kind: "cylinder", center: [0, 0, 160], radius: 20, height: 16, axis: "z" },
          // Side breather / vent limiter spud (-Y)
          { kind: "cylinder", center: [0, -82, 68], radius: 12, height: 20, axis: "y" },
        ],
        clearances: [{ id: "service", name: "Regulator Access & Vent", purpose: "service_access", face: "top", depth: 12 * IN, cite: "IFGC 410.2" }],
        symbol: [
          { kind: "line", from: [neg("width"), 0], to: [half("width"), 0], pen: "medium" },
          { kind: "circle", center: [0, 0], radius: 68, fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, 0], radius: 28, pen: "thin" },
        ],
      };

    case "wc-flushometer":
      return {
        materialId: "plumbing_gas.vitreous_china",
        extraParams: [num("flush_gpf", "Flush volume (gpf)", "none")],
        extraValues: { flush_gpf: 1.28 },
        geometry: [
          // Rear wall-carrier mounting shroud & trapway body (+Y rear wall at +depth/2)
          { kind: "box", center: [0, { param: "depth", scale: 0.32 }, 220], size: [290, { param: "depth", scale: 0.36 }, 340] },
          // Lower bowl drain sump reaching z = 0
          { kind: "box", center: [0, 60, 125], size: [210, 260, 250] },
          // Elongated vitreous china bowl rim (rear box + semicircular front cylinder)
          { kind: "box", center: [0, 30, 310], size: [p("width"), 310, 160] },
          { kind: "cylinder", center: [0, -127, 310], radius: half("width"), height: 160, axis: "z" },
          // Commercial open-front seat ring
          { kind: "cylinder", center: [0, -127, 402], radius: { param: "width", scale: 0.46 }, height: 22, axis: "z" },
          { kind: "box", center: [0, 10, 402], size: [{ param: "width", scale: 0.92 }, 240, 22] },
          // Chrome flushometer vacuum-breaker tailpiece & Sloan-style valve body
          { kind: "cylinder", center: [0, 210, 535], radius: 19, height: 290, axis: "z" },
          { kind: "cylinder", center: [0, 210, 705], radius: 34, height: 64, axis: "z" },
          // Supply angle-stop ell reaching rear wall face y = +depth/2
          { kind: "box", center: [55, 263.75, 680], size: [125, 107.5, 38] },
          // Rear carrier vent riser stub reaching z = 737
          { kind: "cylinder", center: [-90, 265, 563.5], radius: 28, height: 347, axis: "z" },
        ],
        connectorOverrides: {
          cw: { position: [100, half("depth"), 680], direction: [0, 1, 0] },
          w: { position: [0, 60, 0], direction: [0, 0, -1] },
          v: { position: [-90, 265, 737], direction: [0, 0, 1] },
        },
        clearances: [{ id: "front_clearance", name: "Water Closet Clear Floor Space", purpose: "service_access", face: "right", depth: 24 * IN, cite: "IPC 405.3.1" }],
        symbol: [
          { kind: "line", from: [-155, 280], to: [155, 280], pen: "thin" },
          { kind: "line", from: [-155, 280], to: [-184, -127], pen: "thin" },
          { kind: "line", from: [155, 280], to: [184, -127], pen: "thin" },
          { kind: "arc", center: [0, -127], radius: 184, startDeg: 180, sweepDeg: 180, pen: "thin" },
          { kind: "arc", center: [0, -120], radius: 130, startDeg: 180, sweepDeg: 180, pen: "thin" },
          { kind: "circle", center: [0, 210], radius: 32, pen: "thin" },
        ],
      };

    case "lavatory":
      return {
        materialId: "plumbing_gas.vitreous_china",
        extraParams: [num("flow_gpm", "Faucet flow rate", "gpm")],
        extraValues: { flow_gpm: 0.5 },
        geometry: [
          // Bottom drain tailpiece & trap stub (z: 0..40)
          { kind: "cylinder", center: [0, 20, 20], radius: 20, height: 40, axis: "z" },
          // Recessed vitreous-china basin bottom floor slab
          { kind: "box", center: [0, -18, 52], size: [{ param: "width", scale: 0.88 }, { param: "depth", scale: 0.72 }, 24] },
          // Rear faucet deck ledge flush at +depth/2
          { kind: "box", center: [0, { param: "depth", scale: 0.41 }, 133.6], size: [p("width"), { param: "depth", scale: 0.18 }, 139.2] },
          // Front rim wall flush at -depth/2
          { kind: "box", center: [0, { param: "depth", scale: -0.45 }, 133.6], size: [p("width"), { param: "depth", scale: 0.1 }, 139.2] },
          // Left & right basin rim walls
          { kind: "box", center: [{ param: "width", scale: -0.45 }, -18, 133.6], size: [{ param: "width", scale: 0.1 }, { param: "depth", scale: 0.72 }, 139.2] },
          { kind: "box", center: [{ param: "width", scale: 0.45 }, -18, 133.6], size: [{ param: "width", scale: 0.1 }, { param: "depth", scale: 0.72 }, 139.2] },
          // Chrome center-set metering faucet deck escutcheon, body tower & spout
          { kind: "box", center: [0, 185, 211], size: [152, 54, 16] },
          { kind: "cylinder", center: [0, 185, 266], radius: 18, height: 110, axis: "z" },
          { kind: "box", center: [0, 125, 306], size: [26, 120, 22] },
          // Rear in-wall vent riser stub reaching z = 321 (offset clear of faucet)
          { kind: "cylinder", center: [-55, 205, 192.5], radius: 19, height: 257, axis: "z" },
        ],
        connectorOverrides: {
          cw: { position: [100, half("depth"), 120], direction: [0, 1, 0] },
          hw: { position: [-100, half("depth"), 120], direction: [0, 1, 0] },
          w: { position: [0, 20, 0], direction: [0, 0, -1] },
          v: { position: [-55, 205, 321], direction: [0, 0, 1] },
        },
        clearances: [{ id: "front_access", name: "Lavatory Clear Floor Space", purpose: "service_access", face: "right", depth: 30 * IN, cite: "IPC 405.3.1" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, -28], radius: { param: "depth", scale: 0.32 }, pen: "thin" },
          { kind: "circle", center: [0, 20], radius: 22, pen: "thin" },
          { kind: "circle", center: [0, 185], radius: 18, pen: "thin" },
        ],
      };

    case "rpz":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [BACKFLOW_KIND_PARAM, PRESSURE_DROP_PARAM, txt("asse_standard", "ASSE standard")],
        extraValues: {
          backflow_kind: "rpz",
          pressure_drop_psi: 12,
          asse_standard: "ASSE 1013",
        },
        geometry: [
          // Horizontal bronze main RPZ body spanning -width/2 to +width/2
          { kind: "cylinder", center: [0, 0, 0], radius: 1.75 * IN, height: p("width"), axis: "x" },
          // Inlet & outlet isolation ball valve collars + lever handles
          { kind: "cylinder", center: [-7.5 * IN, 0, 0], radius: 2.4 * IN, height: 2.0 * IN, axis: "x" },
          { kind: "cylinder", center: [7.5 * IN, 0, 0], radius: 2.4 * IN, height: 2.0 * IN, axis: "x" },
          { kind: "box", center: [-7.5 * IN, 0, 3.2 * IN], size: [4.5 * IN, 0.75 * IN, 0.75 * IN] },
          { kind: "box", center: [7.5 * IN, 0, 3.2 * IN], size: [4.5 * IN, 0.75 * IN, 0.75 * IN] },
          // Twin check-valve access bonnets on top
          { kind: "cylinder", center: [-2.8 * IN, 0, 2.2 * IN], radius: 1.8 * IN, height: 2.5 * IN, axis: "z" },
          { kind: "cylinder", center: [2.8 * IN, 0, 2.2 * IN], radius: 1.8 * IN, height: 2.5 * IN, axis: "z" },
          // Four brass test-cock bosses on front (-Y)
          { kind: "cylinder", center: [-5.2 * IN, -2.0 * IN, 0.9 * IN], radius: 0.35 * IN, height: 1.0 * IN, axis: "y" },
          { kind: "cylinder", center: [-1.4 * IN, -2.0 * IN, 0.9 * IN], radius: 0.35 * IN, height: 1.0 * IN, axis: "y" },
          { kind: "cylinder", center: [1.4 * IN, -2.0 * IN, 0.9 * IN], radius: 0.35 * IN, height: 1.0 * IN, axis: "y" },
          { kind: "cylinder", center: [5.2 * IN, -2.0 * IN, 0.9 * IN], radius: 0.35 * IN, height: 1.0 * IN, axis: "y" },
          // Bottom differential relief valve discharge port + flared air-gap funnel
          { kind: "cylinder", center: [0, 0, -2.6 * IN], radius: 1.4 * IN, height: 3.2 * IN, axis: "z" },
          { kind: "cylinder", center: [0, 0, -4.4 * IN], radius: 2.0 * IN, height: 1.4 * IN, axis: "z" },
        ],
        clearances: [{ id: "test_access", name: "RPZ Testing & Relief Drain Access", purpose: "service_access", face: "right", depth: 24 * IN, cite: "IPC 608.15.2" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "polyline", points: [[-180, -55], [-60, 0], [-180, 55]], closed: true, pen: "thin" },
          { kind: "polyline", points: [[60, -55], [180, 0], [60, 55]], closed: true, pen: "thin" },
          { kind: "circle", center: [0, 0], radius: 34, pen: "thin" },
        ],
      };

    // ------------------------------------------------------------------
    // New commercial plumbing & gas starter parts
    // ------------------------------------------------------------------
    case "gas-meter":
      return {
        materialId: "plumbing_gas.equipment_enamel_grey",
        extraParams: [
          txt("plumbing_source", "Plumbing source role"),
          num("capacity_cfh", "Rated capacity (CFH)", "none"),
          num("pressure_drop_in_wc", "Meter pressure drop (in. w.c.)", "in_wc"),
          num("operating_pressure_psi", "Max operating pressure (psi)", "psi"),
        ],
        extraValues: {
          plumbing_source: "gas_meter",
          capacity_cfh: 1500,
          pressure_drop_in_wc: 0.5,
          operating_pressure_psi: 2,
        },
        geometry: [
          // Lower cast-aluminum commercial diaphragm/rotary meter body
          { kind: "box", center: [0, 0, { param: "height", scale: 0.36 }], size: [{ param: "width", scale: 0.78 }, { param: "depth", scale: 0.82 }, { param: "height", scale: 0.72 }] },
          // Bolted upper valve-chamber flange cap
          { kind: "box", center: [0, 0, { param: "height", scale: 0.78 }], size: [{ param: "width", scale: 0.84 }, { param: "depth", scale: 0.86 }, { param: "height", scale: 0.12 }] },
          // Front index register housing & cylindrical dial bezel (+Y)
          { kind: "box", center: [0, { param: "depth", scale: 0.45 }, { param: "height", scale: 0.56 }], size: [140, 56, 100] },
          { kind: "cylinder", center: [0, { param: "depth", scale: 0.54 }, { param: "height", scale: 0.56 }], radius: 42, height: 24, axis: "y" },
          // Top inlet & outlet riser hubs + horizontal threaded union spuds flush at ±width/2
          { kind: "cylinder", center: [{ param: "width", scale: -0.32 }, 0, { param: "height", scale: 0.9 }], radius: 34, height: { param: "height", scale: 0.2 }, axis: "z" },
          { kind: "cylinder", center: [{ param: "width", scale: -0.41 }, 0, { param: "height", scale: 0.92 }], radius: 30, height: { param: "width", scale: 0.18 }, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.32 }, 0, { param: "height", scale: 0.9 }], radius: 34, height: { param: "height", scale: 0.2 }, axis: "z" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.41 }, 0, { param: "height", scale: 0.92 }], radius: 30, height: { param: "width", scale: 0.18 }, axis: "x" },
        ],
        connectorOverrides: {
          in: { position: [neg("width"), 0, { param: "height", scale: 0.92 }], direction: [-1, 0, 0] },
          out: { position: [half("width"), 0, { param: "height", scale: 0.92 }], direction: [1, 0, 0] },
        },
        clearances: [{ id: "meter_read", name: "Gas Meter Read & Service", purpose: "service_access", face: "left", depth: 36 * IN, cite: "IFGC 401.8" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, 0], radius: 95, pen: "thin" },
          { kind: "text", at: [0, 0], text: "GM", heightMm: 80, anchor: "middle", upright: true, pen: "thin" },
        ],
      };

    case "roof-drain":
      return {
        materialId: "plumbing_gas.cast_iron_dwv",
        extraParams: [choice("drain_role", "Roof drain role", ["primary", "overflow"], "primary")],
        extraValues: { drain_role: "primary" },
        extraInstanceParams: [num("roof_area_sqft", "Tributary roof area (sq ft)", "none", 2500)],
        geometry: [
          // Bottom 4" no-hub outlet tailpiece (z: 0..100)
          { kind: "cylinder", center: [0, 0, 50], radius: 56, height: 100, axis: "z" },
          // Cast-iron roof drain sump bowl
          { kind: "cylinder", center: [0, 0, 120], radius: 145, height: 80, axis: "z" },
          // Roof deck flashing flange & gravel-stop clamping collar
          { kind: "cylinder", center: [0, 0, 168], radius: half("width"), height: 24, axis: "z" },
          // 3-tier stepped cast-iron beehive dome strainer
          { kind: "cylinder", center: [0, 0, 215], radius: 130, height: 50, axis: "z" },
          { kind: "cylinder", center: [0, 0, 255], radius: 100, height: 42, axis: "z" },
          { kind: "cylinder", center: [0, 0, 290], radius: 62, height: 30, axis: "z" },
        ],
        connectorOverrides: {
          out: { label: "Storm outlet", position: [0, 0, 0], direction: [0, 0, -1], systemKind: "storm", endType: "plumbing_gas.no_hub", flowDirection: "out" },
        },
        symbol: [
          { kind: "circle", center: [0, 0], radius: half("width"), fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, 0], radius: 130, pen: "thin" },
          { kind: "line", from: [-130, 0], to: [130, 0], pen: "thin" },
          { kind: "line", from: [0, -130], to: [0, 130], pen: "thin" },
        ],
      };

    case "overflow-roof-drain":
      return {
        materialId: "plumbing_gas.cast_iron_dwv",
        extraParams: [choice("drain_role", "Roof drain role", ["primary", "overflow"], "overflow"), len("dam_height", "Overflow water-dam height")],
        extraValues: { drain_role: "overflow", dam_height: 2 * IN },
        extraInstanceParams: [num("roof_area_sqft", "Tributary roof area (sq ft)", "none", 2500)],
        geometry: [
          // Bottom 4" no-hub outlet tailpiece (z: 0..100)
          { kind: "cylinder", center: [0, 0, 50], radius: 56, height: 100, axis: "z" },
          // Cast-iron roof drain sump bowl
          { kind: "cylinder", center: [0, 0, 120], radius: 145, height: 80, axis: "z" },
          // Roof deck flashing flange & clamping ring
          { kind: "cylinder", center: [0, 0, 168], radius: half("width"), height: 24, axis: "z" },
          // 2" secondary overflow water-dam standpipe collar (IPC 1108.2)
          { kind: "cylinder", center: [0, 0, 205], radius: 118, height: 50, axis: "z" },
          // 3-tier cast-iron beehive dome strainer
          { kind: "cylinder", center: [0, 0, 240], radius: 126, height: 42, axis: "z" },
          { kind: "cylinder", center: [0, 0, 276], radius: 96, height: 36, axis: "z" },
          { kind: "cylinder", center: [0, 0, 304], radius: 58, height: 24, axis: "z" },
        ],
        connectorOverrides: {
          out: { label: "Overflow storm outlet", position: [0, 0, 0], direction: [0, 0, -1], systemKind: "storm", endType: "plumbing_gas.no_hub", flowDirection: "out" },
        },
        symbol: [
          { kind: "circle", center: [0, 0], radius: half("width"), fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, 0], radius: 150, pen: "thin" },
          { kind: "circle", center: [0, 0], radius: 118, pen: "thin" },
          { kind: "line", from: [-118, -118], to: [118, 118], pen: "thin" },
          { kind: "line", from: [-118, 118], to: [118, -118], pen: "thin" },
        ],
      };

    case "booster-pump":
      return {
        materialId: "plumbing_gas.equipment_enamel_blue",
        extraParams: [
          choice("pump_arrangement", "Pump arrangement", ["duplex", "simplex", "triplex"], "duplex"),
          num("pump_rated_gpm", "Rated flow", "gpm"),
          num("pump_rated_head_ft", "Rated head (ft)", "none"),
          num("pump_shutoff_head_ft", "Shutoff head (ft)", "none"),
          num("pump_boost_psi", "Design boost pressure (psi)", "psi"),
          num("motor_hp", "Motor HP (per pump)", "hp"),
          num("voltage", "Voltage", "v"),
        ],
        extraValues: {
          pump_arrangement: "duplex",
          pump_rated_gpm: 60,
          pump_rated_head_ft: 115,
          pump_shutoff_head_ft: 140,
          pump_boost_psi: 50,
          motor_hp: 3,
          voltage: 208,
        },
        extraInstanceParams: [num("design_gpm", "Design flow", "gpm"), num("design_head_ft", "Design head (ft)", "none"), txt("circuit", "Circuit")],
        geometry: [
          // Structural steel skid base frame
          { kind: "box", center: [0, 0, 50], size: [{ param: "width", scale: 0.92 }, { param: "depth", scale: 0.92 }, 100] },
          // Suction header (-Y front-low) & discharge header (+Y rear-mid) spanning ±width/2
          { kind: "cylinder", center: [0, -140, 210], radius: 36, height: p("width"), axis: "x" },
          { kind: "cylinder", center: [0, 140, 320], radius: 36, height: p("width"), axis: "x" },
          // Inlet & outlet companion flanges flush at ±width/2
          { kind: "cylinder", center: [{ param: "width", scale: -0.5, add: 12 }, -140, 210], radius: 68, height: 24, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.5, add: -12 }, 140, 320], radius: 68, height: 24, axis: "x" },
          // Pump 1 (left): lower volute, vertical multistage barrel, coupling lantern, TEFC motor
          { kind: "box", center: [-210, 0, 220], size: [180, 300, 140] },
          { kind: "cylinder", center: [-210, 0, 530], radius: 72, height: 480, axis: "z" },
          { kind: "cylinder", center: [-210, 0, 820], radius: 80, height: 100, axis: "z" },
          { kind: "cylinder", center: [-210, 0, 1020], radius: 105, height: 320, axis: "z" },
          // Pump 2 (right): lower volute, vertical multistage barrel, coupling lantern, TEFC motor
          { kind: "box", center: [210, 0, 220], size: [180, 300, 140] },
          { kind: "cylinder", center: [210, 0, 530], radius: 72, height: 480, axis: "z" },
          { kind: "cylinder", center: [210, 0, 820], radius: 80, height: 100, axis: "z" },
          { kind: "cylinder", center: [210, 0, 1020], radius: 105, height: 320, axis: "z" },
          // Rear VFD duplex control cabinet (top z = 1219)
          { kind: "box", center: [0, 190, 920], size: [340, 180, 598] },
        ],
        connectorOverrides: {
          in: { position: [neg("width"), -140, 210], direction: [-1, 0, 0] },
          out: { position: [half("width"), 140, 320], direction: [1, 0, 0] },
          power: { position: [0, 190, 1219], direction: [0, 0, 1], voltage: 208, poles: 3, motorHp: p("motor_hp") },
        },
        clearances: [{ id: "service", name: "Pump & VFD Service", purpose: "service_access", face: "right", depth: 36 * IN, cite: "NEC 110.26" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "circle", center: [-210, 0], radius: 105, pen: "thin" },
          { kind: "circle", center: [210, 0], radius: 105, pen: "thin" },
          { kind: "rect", center: [0, 190], size: [340, 180], pen: "thin" },
        ],
      };

    case "buffer-tank":
      return {
        materialId: "plumbing_gas.equipment_enamel_blue",
        extraParams: [
          num("capacity_gal", "Storage volume (gal)", "none"),
          num("working_pressure_psi", "ASME working pressure (psi)", "psi"),
          num("insulation_r_value", "Jacket insulation R-value", "none"),
          len("hwr_connection_size", "Hot water return connection size"),
          len("drain_size", "Drain valve connection size"),
          len("tp_relief_size", "T&P relief valve connection size"),
        ],
        extraValues: {
          capacity_gal: 120,
          working_pressure_psi: 150,
          insulation_r_value: 16,
          hwr_connection_size: 1.5 * IN,
          drain_size: 1 * IN,
          tp_relief_size: 0.75 * IN,
        },
        geometry: [
          // Floor steel support skirt
          { kind: "cylinder", center: [0, 0, 60], radius: { param: "width", scale: 0.46 }, height: 120, axis: "z" },
          // Lower elliptical ASME head
          { kind: "cylinder", center: [0, 0, 140], radius: { param: "width", scale: 0.44 }, height: 60, axis: "z" },
          // Main insulated vertical cylindrical storage shell
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.5 }], radius: half("width"), height: { param: "height", scale: 0.8 }, axis: "z" },
          // Upper domed ASME head (2 stepped crown tiers)
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.92 }], radius: { param: "width", scale: 0.43 }, height: { param: "height", scale: 0.06 }, axis: "z" },
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.96 }], radius: { param: "width", scale: 0.32 }, height: { param: "height", scale: 0.04 }, axis: "z" },
          // Top hot-water supply spud flush at z = height
          { kind: "cylinder", center: [0, 0, { param: "height", add: -35 }], radius: 34, height: 70, axis: "z" },
          // Side cold-water inlet nozzle (+Y)
          { kind: "cylinder", center: [0, { param: "width", scale: 0.5, add: 30 }, 310], radius: 34, height: 60, axis: "y" },
          // Side hot-water return nozzle (-X)
          { kind: "cylinder", center: [{ param: "width", scale: -0.5, add: -30 }, 0, 960], radius: 28, height: 60, axis: "x" },
          // Side T&P relief port nozzle (+X)
          { kind: "cylinder", center: [{ param: "width", scale: 0.5, add: 30 }, 0, 1320], radius: 22, height: 60, axis: "x" },
          // Lower drain valve nozzle (-Y)
          { kind: "cylinder", center: [0, { param: "width", scale: -0.5, add: -30 }, 220], radius: 22, height: 60, axis: "y" },
        ],
        connectorOverrides: {
          cw: { position: [0, { param: "width", scale: 0.5, add: 60 }, 310], direction: [0, 1, 0], flowDirection: "in" },
          hw: { position: [0, 0, p("height")], direction: [0, 0, 1], flowDirection: "out" },
          hwr: { position: [{ param: "width", scale: -0.5, add: -60 }, 0, 960], direction: [-1, 0, 0], diameter: p("hwr_connection_size"), flowDirection: "in" },
        },
        extraConnectors: [
          {
            id: "drain",
            label: "Tank drain",
            domain: "pipe",
            systemKind: "indirect_waste",
            position: [0, { param: "width", scale: -0.5, add: -60 }, 220],
            direction: [0, -1, 0],
            shape: "round",
            diameter: p("drain_size"),
            endType: "plumbing_gas.threaded",
            flowDirection: "out",
          },
          {
            id: "tp_relief",
            label: "T&P relief valve",
            domain: "pipe",
            systemKind: "indirect_waste",
            position: [{ param: "width", scale: 0.5, add: 60 }, 0, 1320],
            direction: [1, 0, 0],
            shape: "round",
            diameter: p("tp_relief_size"),
            endType: "plumbing_gas.threaded",
            flowDirection: "out",
          },
        ],
        clearances: [
          { id: "service", name: "Tank Service & Drain Access", purpose: "service_access", face: "right", depth: 24 * IN, cite: "IPC 502.5" },
          { id: "anode_top", name: "Anode Rod Pull Clearance", purpose: "service_access", face: "top", depth: 24 * IN, cite: "Mfr" },
        ],
        symbol: [
          { kind: "circle", center: [0, 0], radius: half("width"), fill: "mask", pen: "medium" },
          { kind: "circle", center: [0, 0], radius: { param: "width", scale: 0.36 }, pen: "thin" },
          { kind: "text", at: [0, 0], text: "BT", heightMm: 100, anchor: "middle", upright: true, pen: "thin" },
        ],
      };

    case "water-softener":
      return {
        materialId: "plumbing_gas.equipment_enamel_grey",
        extraParams: [
          num("capacity_kilograins", "Exchange capacity (kilograins)", "none"),
          num("service_flow_gpm", "Service flow rate", "gpm"),
          PRESSURE_DROP_PARAM,
          num("salt_capacity_lb", "Brine tank salt capacity (lb)", "lb"),
          len("drain_size", "Backwash drain connection size"),
        ],
        extraValues: {
          capacity_kilograins: 120,
          service_flow_gpm: 30,
          pressure_drop_psi: 15,
          salt_capacity_lb: 450,
          drain_size: 1.5 * IN,
        },
        extraInstanceParams: [txt("circuit", "Circuit")],
        geometry: [
          // FRP mineral resin tank (left): base, cylindrical vessel, domed shoulder, automatic control head
          { kind: "cylinder", center: [-280, 0, 60], radius: 195, height: 120, axis: "z" },
          { kind: "cylinder", center: [-280, 0, 760], radius: 205, height: 1280, axis: "z" },
          { kind: "cylinder", center: [-280, 0, 1435], radius: 155, height: 70, axis: "z" },
          { kind: "box", center: [-280, 0, 1573], size: [210, 220, 206] },
          // Inlet stub extending flush to -width/2 (-533.4)
          { kind: "cylinder", center: [-459.2, -45, 1570], radius: 26, height: 148.4, axis: "x" },
          // Softened outlet & backwash drain stubs extending flush to +depth/2 (+279.4)
          { kind: "cylinder", center: [-230, 194.7, 1570], radius: 26, height: 169.4, axis: "y" },
          { kind: "cylinder", center: [-330, 194.7, 1520], radius: 24, height: 169.4, axis: "y" },
          // Brine tank (right): drum body + removable salt-loading cover lid
          { kind: "cylinder", center: [265, 0, 500], radius: 248, height: 1000, axis: "z" },
          { kind: "cylinder", center: [265, 0, 1020], radius: 258, height: 40, axis: "z" },
          // Brine draw line bridge between brine drum and resin control valve
          { kind: "box", center: [-10, 0, 1050], size: [220, 24, 24] },
        ],
        connectorOverrides: {
          in: { position: [neg("width"), -45, 1570], direction: [-1, 0, 0] },
          out: { position: [-230, half("depth"), 1570], direction: [0, 1, 0] },
          w: { label: "Backwash drain", position: [-330, half("depth"), 1520], direction: [0, 1, 0], diameter: p("drain_size"), endType: "plumbing_gas.threaded", flowDirection: "out" },
          power: { position: [-280, 0, 1676], direction: [0, 0, 1], voltage: 120, poles: 1 },
        },
        clearances: [
          { id: "salt_loading", name: "Salt Loading & Resin Service", purpose: "service_access", face: "right", depth: 36 * IN, cite: "Mfr" },
          { id: "brine_lid", name: "Brine Tank Lid Clearance", purpose: "service_access", face: "top", depth: 24 * IN, cite: "Mfr" },
        ],
        symbol: [
          { kind: "circle", center: [-280, 0], radius: 205, fill: "mask", pen: "medium" },
          { kind: "circle", center: [265, 0], radius: 258, fill: "mask", pen: "medium" },
          { kind: "line", from: [-75, 0], to: [7, 0], pen: "thin" },
        ],
      };

    case "condensate-neutralizer":
      return {
        materialId: "plumbing_gas.pvc_white",
        extraParams: [
          num("max_input_mbh", "Max boiler / heater input (MBH)", "none"),
          txt("neutralizing_media", "Neutralizing media"),
          PRESSURE_DROP_PARAM,
        ],
        extraValues: {
          max_input_mbh: 500,
          neutralizing_media: "calcium_carbonate",
          pressure_drop_psi: 0.2,
        },
        geometry: [
          // Horizontal PVC limestone media tube body
          { kind: "cylinder", center: [0, 0, 0], radius: 50, height: { param: "width", scale: 0.78 }, axis: "x" },
          // Twin threaded union media-recharge end caps
          { kind: "cylinder", center: [{ param: "width", scale: -0.42 }, 0, 0], radius: 56, height: 32, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.42 }, 0, 0], radius: 56, height: 32, axis: "x" },
          // Inlet & outlet 3/4" PVC port stubs flush at ±width/2
          { kind: "cylinder", center: [{ param: "width", scale: -0.47 }, 0, 0], radius: 16, height: { param: "width", scale: 0.06 }, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.47 }, 0, 0], radius: 16, height: { param: "width", scale: 0.06 }, axis: "x" },
          // Twin wall / floor mounting clip brackets
          { kind: "box", center: [-90, 0, -54], size: [26, 90, 12] },
          { kind: "box", center: [90, 0, -54], size: [26, 90, 12] },
        ],
        connectorOverrides: {
          in: { endType: "plumbing_gas.solvent_weld" },
          out: { endType: "plumbing_gas.solvent_weld" },
        },
        clearances: [{ id: "media_service", name: "Media Recharge Access", purpose: "service_access", face: "top", depth: 12 * IN, cite: "Mfr" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "line", from: [-150, -50], to: [-150, 50], pen: "thin" },
          { kind: "line", from: [150, -50], to: [150, 50], pen: "thin" },
        ],
      };

    case "mixing-valve":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [
          num("setpoint_f", "Outlet setpoint (°F)", "none"),
          num("rated_cv", "Flow coefficient (Cv)", "none"),
          PRESSURE_DROP_PARAM,
          txt("asse_standard", "ASSE standard"),
        ],
        extraValues: {
          setpoint_f: 120,
          rated_cv: 6.5,
          pressure_drop_psi: 5,
          asse_standard: "ASSE 1017",
        },
        geometry: [
          // Central vertical bronze thermostatic mixing chamber
          { kind: "cylinder", center: [0, 0, 0], radius: 42, height: 110, axis: "z" },
          // Horizontal check-stop inlet manifold spanning -width/2 to +width/2
          { kind: "cylinder", center: [0, 0, 0], radius: 22, height: p("width"), axis: "x" },
          // Left (HW) & right (CW) integral check-stop valve bodies + front service bonnets
          { kind: "cylinder", center: [-78, 0, 0], radius: 30, height: 44, axis: "x" },
          { kind: "cylinder", center: [78, 0, 0], radius: 30, height: 44, axis: "x" },
          { kind: "cylinder", center: [-78, -36, 0], radius: 16, height: 28, axis: "y" },
          { kind: "cylinder", center: [78, -36, 0], radius: 16, height: 28, axis: "y" },
          // Bottom tamper-resistant temperature adjustment cap
          { kind: "cylinder", center: [0, 0, -78], radius: 28, height: 46, axis: "z" },
          // Top tempered outlet riser spud (top z = +114) + front dial thermometer
          { kind: "cylinder", center: [0, 0, 84], radius: 24, height: 60, axis: "z" },
          { kind: "cylinder", center: [0, -44, 78], radius: 26, height: 18, axis: "y" },
        ],
        connectorOverrides: {
          hw: { position: [neg("width"), 0, 0], direction: [-1, 0, 0], flowDirection: "in" },
          cw: { position: [half("width"), 0, 0], direction: [1, 0, 0], flowDirection: "in" },
          out: { label: "Tempered hot water outlet", position: [0, 0, 114], direction: [0, 0, 1], systemKind: "domestic_hot_water", flowDirection: "out" },
        },
        symbol: [
          { kind: "circle", center: [0, 0], radius: 44, fill: "mask", pen: "medium" },
          { kind: "line", from: [neg("width"), 0], to: [-44, 0], pen: "thin" },
          { kind: "line", from: [44, 0], to: [half("width"), 0], pen: "thin" },
          { kind: "text", at: [0, 0], text: "TMV", heightMm: 36, anchor: "middle", upright: true, pen: "thin" },
        ],
      };

    case "trap-primer":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [
          choice("primer_kind", "Trap primer type", ["pressure_drop", "electronic"], "pressure_drop"),
          num("outlets_served", "Floor drains served", "count"),
          PRESSURE_DROP_PARAM,
        ],
        extraValues: {
          primer_kind: "pressure_drop",
          outlets_served: 4,
          pressure_drop_psi: 3,
        },
        geometry: [
          // Main vertical brass priming valve cylinder
          { kind: "cylinder", center: [0, 0, 102], radius: 34, height: 110, axis: "z" },
          // Upper vacuum-breaker bonnet & top 1/2" CW inlet spud (top z = 203)
          { kind: "cylinder", center: [0, 0, 168], radius: 28, height: 22, axis: "z" },
          { kind: "cylinder", center: [0, 0, 191], radius: 14, height: 24, axis: "z" },
          // Lower air-gap viewing chamber & bottom 1/2" discharge nipple (bottom z = 0)
          { kind: "cylinder", center: [0, 0, 32], radius: 24, height: 30, axis: "z" },
          { kind: "cylinder", center: [0, 0, 9], radius: 14, height: 18, axis: "z" },
          // Rear wall mounting lug bracket
          { kind: "box", center: [0, 38, 102], size: [64, 16, 80] },
        ],
        connectorOverrides: {
          cw: { position: [0, 0, 203], direction: [0, 0, 1], flowDirection: "in" },
          out: { label: "Primer discharge", position: [0, 0, 0], direction: [0, 0, -1], flowDirection: "out" },
        },
        symbol: [
          { kind: "circle", center: [0, 0], radius: 38, fill: "mask", pen: "medium" },
          { kind: "text", at: [0, 0], text: "TP", heightMm: 32, anchor: "middle", upright: true, pen: "thin" },
        ],
      };

    case "sump-pump":
      return {
        materialId: "plumbing_gas.cast_iron_dwv",
        extraParams: [
          num("pump_rated_gpm", "Rated flow", "gpm"),
          num("pump_rated_head_ft", "Rated head (ft)", "none"),
          num("pump_shutoff_head_ft", "Shutoff head (ft)", "none"),
          num("motor_hp", "Motor HP", "hp"),
          num("voltage", "Voltage", "v"),
          num("basin_volume_gal", "Basin capacity (gal)", "none"),
        ],
        extraValues: {
          pump_rated_gpm: 40,
          pump_rated_head_ft: 25,
          pump_shutoff_head_ft: 34,
          motor_hp: 0.5,
          voltage: 120,
          basin_volume_gal: 50,
        },
        extraInstanceParams: [num("pump_inflow_gpm", "Design inflow", "gpm"), num("pump_head_ft", "Total head (ft)", "none"), txt("circuit", "Circuit")],
        geometry: [
          // Cylindrical submersible sump basin (24" Ø × 28" deep)
          { kind: "cylinder", center: [0, 0, 355], radius: 292, height: 710, axis: "z" },
          // Bolted gas-tight steel cover rim flange
          { kind: "cylinder", center: [0, 0, 722], radius: 305, height: 24, axis: "z" },
          // Bolted pump inspection hatch boss on cover
          { kind: "box", center: [0, -110, 746], size: [180, 130, 24] },
          // Top 2" storm discharge standpipe collar (top z = 762)
          { kind: "cylinder", center: [-110, 80, 748], radius: 34, height: 28, axis: "z" },
          // Top 2" basin vent collar (top z = 762)
          { kind: "cylinder", center: [110, 80, 748], radius: 34, height: 28, axis: "z" },
          // Top electrical cord grommet junction box (top z = 762)
          { kind: "box", center: [0, 140, 748], size: [76, 76, 28] },
        ],
        connectorOverrides: {
          out: { label: "Storm discharge", position: [-110, 80, 762], direction: [0, 0, 1], systemKind: "storm", endType: "plumbing_gas.threaded", flowDirection: "out" },
          v: { position: [110, 80, 762], direction: [0, 0, 1] },
          power: { position: [0, 140, 762], direction: [0, 0, 1], voltage: 120, poles: 1, motorHp: p("motor_hp") },
        },
        clearances: [{ id: "pump_pull", name: "Pump Pull & Cover Access", purpose: "service_access", face: "top", depth: 36 * IN, cite: "IPC 1113.1" }],
        symbol: [
          { kind: "circle", center: [0, 0], radius: half("width"), fill: "mask", pen: "medium" },
          { kind: "circle", center: [-110, 80], radius: 34, pen: "thin" },
          { kind: "circle", center: [110, 80], radius: 34, pen: "thin" },
          { kind: "text", at: [0, -80], text: "SP", heightMm: 90, anchor: "middle", upright: true, pen: "thin" },
        ],
      };

    case "dcva":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [BACKFLOW_KIND_PARAM, PRESSURE_DROP_PARAM, txt("asse_standard", "ASSE standard")],
        extraValues: {
          backflow_kind: "dcva",
          pressure_drop_psi: 5.5,
          asse_standard: "ASSE 1015",
        },
        geometry: [
          // Horizontal bronze double-check barrel spanning ±width/2
          { kind: "cylinder", center: [0, 0, 0], radius: 42, height: p("width"), axis: "x" },
          // Inlet & outlet shutoff ball valve bodies + lever handles
          { kind: "cylinder", center: [-175, 0, 0], radius: 54, height: 48, axis: "x" },
          { kind: "cylinder", center: [175, 0, 0], radius: 54, height: 48, axis: "x" },
          { kind: "box", center: [-175, 0, 74], size: [110, 18, 18] },
          { kind: "box", center: [175, 0, 74], size: [110, 18, 18] },
          // Twin top bolted check-valve access bonnets (no bottom relief port)
          { kind: "cylinder", center: [-64, 0, 52], radius: 42, height: 52, axis: "z" },
          { kind: "cylinder", center: [64, 0, 52], radius: 42, height: 52, axis: "z" },
          // Brass test-cock bosses on front (-Y)
          { kind: "cylinder", center: [-120, -48, 22], radius: 9, height: 24, axis: "y" },
          { kind: "cylinder", center: [0, -48, 22], radius: 9, height: 24, axis: "y" },
          { kind: "cylinder", center: [120, -48, 22], radius: 9, height: 24, axis: "y" },
        ],
        clearances: [{ id: "test_access", name: "Backflow Testing & Service", purpose: "service_access", face: "right", depth: 24 * IN, cite: "IPC 608.15.2" }],
        symbol: [
          { kind: "rect", center: [0, 0], size: [p("width"), p("depth")], fill: "mask", pen: "medium" },
          { kind: "polyline", points: [[-160, -50], [-40, 0], [-160, 50]], closed: true, pen: "thin" },
          { kind: "polyline", points: [[40, -50], [160, 0], [40, 50]], closed: true, pen: "thin" },
        ],
      };

    case "pvb":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [
          BACKFLOW_KIND_PARAM,
          PRESSURE_DROP_PARAM,
          txt("asse_standard", "ASSE standard"),
          num("min_height_above_outlet_in", "Min height above highest outlet (in)", "none"),
        ],
        extraValues: {
          backflow_kind: "pvb",
          pressure_drop_psi: 4,
          asse_standard: "ASSE 1020",
          min_height_above_outlet_in: 12,
        },
        geometry: [
          // Horizontal lower manifold barrel spanning ±width/2
          { kind: "cylinder", center: [0, 0, 0], radius: 24, height: p("width"), axis: "x" },
          // Inlet & outlet shutoff ball valve collars + lever handles
          { kind: "cylinder", center: [-72, 0, 0], radius: 32, height: 34, axis: "x" },
          { kind: "cylinder", center: [72, 0, 0], radius: 32, height: 34, axis: "x" },
          { kind: "box", center: [-72, -36, 0], size: [76, 14, 14] },
          { kind: "box", center: [72, -36, 0], size: [76, 14, 14] },
          // Vertical check & air-inlet valve body
          { kind: "cylinder", center: [0, 0, 74], radius: 38, height: 112, axis: "z" },
          // Protective flared bell canopy & top hold-down nut
          { kind: "cylinder", center: [0, 0, 158], radius: 46, height: 56, axis: "z" },
          { kind: "cylinder", center: [0, 0, 192], radius: 14, height: 12, axis: "z" },
        ],
        clearances: [{ id: "test_access", name: "PVB Testing & Air-Inlet Clearance", purpose: "service_access", face: "top", depth: 12 * IN, cite: "IPC 608.15.4" }],
        symbol: [
          { kind: "circle", center: [0, 0], radius: 46, fill: "mask", pen: "medium" },
          { kind: "line", from: [neg("width"), 0], to: [-46, 0], pen: "thin" },
          { kind: "line", from: [46, 0], to: [half("width"), 0], pen: "thin" },
          { kind: "text", at: [0, 0], text: "PVB", heightMm: 28, anchor: "middle", upright: true, pen: "thin" },
        ],
      };

    // ------------------------------------------------------------------
    // Existing custom parts upgraded to first-party plumbing_gas materials
    // ------------------------------------------------------------------
    case "cleanout-floor":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraInstanceParams: [len("riser_height", "Riser neck depth", 18 * IN)],
        geometry: [
          // Flush circular brass floor cleanout deck plate at z = 0 (6" Ø × 3/8" thick)
          { kind: "cylinder", center: [0, 0, -5], radius: 3 * IN, height: 10, axis: "z" },
          // Countersunk brass access plug top ring
          { kind: "cylinder", center: [0, 0, 2], radius: 2 * IN, height: 4, axis: "z" },
          // Adjustable vertical 4" riser neck extending down from floor to pipe invert (-riser_height..0)
          { kind: "cylinder", center: [0, 0, { param: "riser_height", scale: -0.5 }], radius: 2.25 * IN, height: p("riser_height"), axis: "z" },
          // Bottom hub collar where riser neck joins the cleanout wye/tee branch
          { kind: "cylinder", center: [0, 0, { param: "riser_height", scale: -1 }], radius: 2.75 * IN, height: 60, axis: "z" },
        ],
        connectorOverrides: {
          w: { position: [0, 0, { param: "riser_height", scale: -1, add: -30 }] },
        },
      };

    case "water-meter":
      return {
        materialId: "plumbing_gas.brass_bronze",
        extraParams: [PRESSURE_DROP_PARAM],
        extraValues: { pressure_drop_psi: 5 },
        geometry: [
          // Main horizontal bronze meter barrel spanning inlet to outlet along X
          { kind: "cylinder", center: [0, 0, 0], radius: 2.25 * IN, height: p("width"), axis: "x" },
          // Flanged inlet & outlet pipe spuds (outer faces sit flush at ±width/2 laying length)
          { kind: "cylinder", center: [{ param: "width", scale: -0.5, add: 11 }, 0, 0], radius: 3.0 * IN, height: 22, axis: "x" },
          { kind: "cylinder", center: [{ param: "width", scale: 0.5, add: -11 }, 0, 0], radius: 3.0 * IN, height: 22, axis: "x" },
          // Measuring chamber dome
          { kind: "cylinder", center: [0, 0, 2.0 * IN], radius: 2.6 * IN, height: 3.0 * IN, axis: "z" },
          // Raised circular bronze register dial bonnet + flip lid
          { kind: "cylinder", center: [0, 0, 4.2 * IN], radius: 2.0 * IN, height: 1.6 * IN, axis: "z" },
        ],
      };

    case "expansion-tank":
      return {
        materialId: "plumbing_gas.equipment_enamel_grey",
        extraParams: [num("volume_gal", "Tank volume (gal)", "none"), num("precharge_psi", "Factory air precharge (psi)", "psi")],
        extraValues: { volume_gal: 5, precharge_psi: 40 },
        geometry: [
          // Lower domed steel head
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.08 }], radius: { param: "width", scale: 0.44 }, height: { param: "height", scale: 0.16 }, axis: "z" },
          // Vertical cylindrical thermal expansion tank shell
          { kind: "cylinder", center: [0, 0, half("height")], radius: half("width"), height: { param: "height", scale: 0.72 }, axis: "z" },
          // Upper domed steel head
          { kind: "cylinder", center: [0, 0, { param: "height", scale: 0.92 }], radius: { param: "width", scale: 0.44 }, height: { param: "height", scale: 0.16 }, axis: "z" },
          // Top threaded connection spud reaching height + 60
          { kind: "cylinder", center: [0, 0, { param: "height", add: 30 }], radius: 25, height: 60, axis: "z" },
        ],
        connectorOverrides: {
          cw: { position: [0, 0, { param: "height", add: 60 }], direction: [0, 0, 1] },
        },
      };

    case "vtr":
      return {
        materialId: "plumbing_gas.cast_iron_dwv",
        geometry: [
          // Weatherproof roof flashing cone base
          { kind: "cylinder", center: [0, 0, 40], radius: 5.5 * IN, height: 80, axis: "z" },
          // 3" Vent stack extending above roof flashing
          { kind: "cylinder", center: [0, 0, half("height")], radius: 1.75 * IN, height: p("height"), axis: "z" },
        ],
        connectorOverrides: {
          v: { position: [0, 0, 0], direction: [0, 0, -1] },
        },
      };

    default:
      return null;
  }
}
