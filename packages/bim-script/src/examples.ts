import { KIT_EXAMPLE_SOURCES } from "./examples.generated";

export { KIT_EXAMPLE_SOURCES };

/**
 * The showcase scripts in packages/bim-script/examples: whole jobs, written
 * against the public kit, each one bim_run_script → check → apply. People
 * copy them; agents start from them (bim_script_reference({ example })).
 */
export interface KitExample {
  /** The file name without .ts, and what `npm run example -- <name>` takes. */
  readonly name: string;
  readonly title: string;
  /** What it builds, in plain words. */
  readonly builds: string;
  readonly topics: readonly string[];
  readonly source: string;
}

/** Where the files are, in the repository. */
export const KIT_EXAMPLES_PATH = "packages/bim-script/examples";

const ABOUT: readonly Omit<KitExample, "source">[] = [
  {
    name: "small-office",
    title: "Small office",
    builds: "Two floors of a 40 x 30 ft office: exterior and interior walls, doors and windows, rooms found from the walls (open office, conference, office), and a plan of each floor on its own sheet.",
    topics: ["office", "walls", "rooms", "doors", "windows", "levels", "sheets", "floor plan", "architecture"],
  },
  {
    name: "rooftop-unit",
    title: "Rooftop unit",
    builds: "A 10 ton rooftop unit built as a part type, placed on the roof, its supply and return ducts sized from airflow and routed down into two rooms, every duct tagged, and an equipment schedule on a sheet.",
    topics: ["rooftop unit", "rtu", "ducts", "duct sizing", "hvac", "mechanical", "equipment schedule", "tags"],
  },
  {
    name: "plumbing-riser",
    title: "Plumbing riser",
    builds: "Toilet rooms on two floors with their fixture units counted, branches, a stack and a building drain sized by the plumbing code and sloped 1/4 in per ft, the fixtures connected, water demand from the Hunter curve, and the drain tagged with size and slope.",
    topics: ["plumbing", "riser", "stack", "building drain", "dfu", "wsfu", "fixture units", "slope", "sanitary"],
  },
  {
    name: "electrical-room",
    title: "Electrical room",
    builds: "A one-bedroom unit: walls and rooms, a panel, receptacles placed by NEC 210.52 wall spacing, one circuit per room from a room template, and the panel schedule on a sheet with the code's demand factors.",
    topics: ["electrical", "receptacles", "panel", "panel schedule", "circuits", "nec 210.52", "power plan"],
  },
  {
    name: "mechanical-details",
    title: "Mechanical details sheet",
    builds: "Two permit-ready CAD mechanical details (RTU on 14 in insulated roof curb with concentric diffuser dog-leg, and ceiling toilet exhaust fan with 6 in hooded exterior wall cap) using halftone/screened hatches, mechanical 2D components, break lines, CAD dimensions, aligned callout stacks, and automated overlap QA on sheet M-501.",
    topics: ["mechanical details", "drafting", "detail view", "rtu curb", "exhaust fan", "louver", "callout", "hatch", "cad"],
  },
  {
    name: "civil-site",
    title: "Civil site grading",
    builds: "Imports existing and proposed LandXML 1.2 TIN surfaces onto a Site level, computes prismoidal cut, fill, net earthwork and overlap area, and places a Site Grading Plan on sheet C-101.",
    topics: ["civil", "grading", "landxml", "tin", "cut and fill", "earthwork", "site plan", "contours"],
  },
  {
    name: "fuel-gas-hybrid-pressure",
    title: "Commercial fuel gas (hybrid 2 psi / 7 in. w.c.)",
    builds: "A commercial kitchen and mechanical room supplied at 2 psi natural gas through a line pressure regulator to 7 in. w.c. appliances, with shutoff valve, drip leg, combustion exhaust/intake venting, IFGC 2021 zone-by-zone gas sizing, and a plan, live riser diagram, and gas schedules on sheet P-401.",
    topics: ["plumbing", "fuel gas", "gas", "hybrid pressure", "2 psi", "regulator", "ifgc", "gas sizing", "combustion vent", "riser"],
  },
  {
    name: "domestic-water-recirc-pressure-loss",
    title: "Commercial domestic water, DHWR loop & pressure loss",
    builds: "A commercial domestic water service with hydrant flow test curve, RPZ backflow preventer, water heater, expansion tank, insulated DHW/DHWR recirculation loop with balancing and check valves, IECC pipe insulation schedule, IPC pipe sizing & pressure-loss report, and a plan, riser diagram, and fixture schedule on sheet P-201.",
    topics: ["plumbing", "domestic water", "dhwr", "recirculation", "rpz", "backflow", "pressure loss", "flow test", "water heater", "insulation", "riser"],
  },
  {
    name: "commercial-kitchen-dwv-grease",
    title: "Commercial kitchen DWV, grease & indirect waste",
    builds: "A commercial kitchen and restroom core with segregated sanitary waste, dedicated grease waste through an inline 100 gpm grease interceptor, separate clear-water/indirect waste, named soil stack, IPC 708 cleanout spacing, under-slab DWV plan (negative viewBottom, non-negative viewDepth), live riser diagram, and fixture schedule on sheet P-101.",
    topics: ["plumbing", "dwv", "sanitary", "grease waste", "grease interceptor", "indirect waste", "cleanouts", "stack", "under-slab", "riser"],
  },
];

export const KIT_EXAMPLES: readonly KitExample[] = ABOUT.map((a) => ({ ...a, source: KIT_EXAMPLE_SOURCES[a.name] ?? "" }));

export function kitExample(name: string): KitExample | undefined {
  const key = name.trim().toLowerCase().replace(/\.ts$/, "");
  return KIT_EXAMPLES.find((e) => e.name === key);
}
