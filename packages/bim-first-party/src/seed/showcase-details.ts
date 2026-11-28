import {
  asElementId,
  DEFAULT_NOTE_SIZE_MM,
  detailContentBounds,
  executeCommand,
  layoutNote,
  lineStyleFor,
  rectangleLines,
  type Command,
  type DetailLineStyleId,
  type HatchPattern,
  type ModelState,
  type NoteAlign,
  type NoteLeaderArrow,
  type RegionTone,
  type Revision,
  type Vec2,
} from "@permitzip/bim-kernel";

const IN = 25.4;
const pt = (xIn: number, yIn: number): Vec2 => ({
  x: Math.round(xIn * IN * 1000) / 1000,
  y: Math.round(yIn * IN * 1000) / 1000,
});

function run(model: ModelState, commands: readonly Command[]): ModelState {
  let cur = model;
  for (const command of commands) {
    const res = executeCommand(cur, command);
    if (!res.ok) {
      throw new Error(`showcase-details command ${command.type} failed: ${res.error.code} — ${res.error.message}`);
    }
    cur = { ...res.model, revision: (cur.revision + 1) as Revision };
  }
  return cur;
}

class DetailBuilder {
  private seq = 0;
  readonly commands: Command[] = [];
  constructor(
    readonly viewId: string,
    readonly scale: number,
    readonly prefix: string,
  ) {}

  private nextId(tag: string): string {
    this.seq += 1;
    return `${this.prefix}-${tag}-${this.seq}`;
  }

  line(from: Vec2, to: Vec2, style: DetailLineStyleId): void {
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("ln"),
      ownerId: this.viewId,
      shape: "line",
      points: [from, to],
      lineStyle: lineStyleFor(style),
    });
  }

  chain(points: readonly Vec2[], style: DetailLineStyleId): void {
    for (let i = 0; i + 1 < points.length; i += 1) {
      this.line(points[i]!, points[i + 1]!, style);
    }
  }

  rect(xIn: number, yIn: number, wIn: number, hIn: number, style: DetailLineStyleId): void {
    const segs = rectangleLines(pt(xIn, yIn), pt(xIn + wIn, yIn + hIn));
    for (const [a, b] of segs) {
      this.line(a, b, style);
    }
  }

  circle(center: Vec2, radiusIn: number, style: DetailLineStyleId): void {
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("cir"),
      ownerId: this.viewId,
      shape: "circle",
      points: [center, { x: center.x + radiusIn * IN, y: center.y }],
      lineStyle: lineStyleFor(style),
    });
  }

  regionRect(
    xIn: number,
    yIn: number,
    wIn: number,
    hIn: number,
    opts: { hatch?: HatchPattern; tone?: RegionTone; boundary?: boolean; masking?: boolean; lineStyle?: DetailLineStyleId },
  ): void {
    const a = pt(xIn, yIn);
    const b = pt(xIn + wIn, yIn + hIn);
    this.regionPoints(
      [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ],
      opts,
    );
  }

  regionPoints(
    points: readonly Vec2[],
    opts: { hatch?: HatchPattern; tone?: RegionTone; boundary?: boolean; masking?: boolean; lineStyle?: DetailLineStyleId },
  ): void {
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("reg"),
      ownerId: this.viewId,
      shape: "region",
      points: [...points],
      fill: {
        pattern: opts.masking ? "solid" : (opts.hatch ?? "diagonal"),
        ...(opts.masking ? { masking: true } : {}),
        ...(opts.tone ? { tone: opts.tone } : {}),
        ...(opts.boundary !== undefined ? { boundary: opts.boundary } : {}),
      },
      ...(opts.lineStyle ? { lineStyle: lineStyleFor(opts.lineStyle) } : {}),
    });
  }

  component(
    symbolId: string,
    at: Vec2,
    opts: { widthIn: number; heightIn: number; rotationDeg?: number; mirror?: boolean },
  ): void {
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("cmp"),
      ownerId: this.viewId,
      shape: "component",
      points: [at],
      component: {
        symbolId,
        widthMm: opts.widthIn * IN,
        heightMm: opts.heightIn * IN,
        ...(opts.rotationDeg !== undefined ? { rotationDeg: opts.rotationDeg } : {}),
        ...(opts.mirror ? { mirror: true } : {}),
      },
    });
  }

  breakLine(from: Vec2, to: Vec2, maskSide: "left" | "right", maskDepthIn: number): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const rotationDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const heightMm = Math.max(40, Math.min(len * 0.22, 0.22 * IN * this.scale));
    const depth = maskDepthIn * IN;
    const sideSign = maskSide === "left" ? 1 : -1;
    const nx = -uy * sideSign;
    const ny = ux * sideSign;
    const lx = -uy;
    const ly = ux;
    const zigAt = (u: number, vOffset: number): Vec2 => ({
      x: from.x + ux * (u * len) + lx * (vOffset * heightMm),
      y: from.y + uy * (u * len) + ly * (vOffset * heightMm),
    });
    const zig: Vec2[] = [
      zigAt(0, 0),
      zigAt(0.42, 0),
      zigAt(0.46, 0.45),
      zigAt(0.54, -0.45),
      zigAt(0.58, 0),
      zigAt(1, 0),
    ];
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("brkm"),
      ownerId: this.viewId,
      shape: "region",
      points: [
        ...zig,
        { x: to.x + nx * depth, y: to.y + ny * depth },
        { x: from.x + nx * depth, y: from.y + ny * depth },
      ],
      fill: { pattern: "solid", masking: true, boundary: false },
    });
    const flip = maskSide === "right";
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("brk"),
      ownerId: this.viewId,
      shape: "component",
      points: [flip ? to : from],
      component: {
        symbolId: "break_line",
        widthMm: len,
        heightMm,
        rotationDeg: flip ? rotationDeg + 180 : rotationDeg,
      },
    });
  }

  dimension(from: Vec2, to: Vec2, offsetIn: number, suffix?: string): void {
    this.commands.push({
      type: "add_drawing_item",
      itemId: this.nextId("dim"),
      ownerId: this.viewId,
      shape: "dimension",
      points: [from, to],
      dim: {
        kind: "aligned",
        offsetMm: offsetIn * IN,
        ...(suffix ? { suffix } : {}),
      },
    });
  }

  note(at: Vec2, widthIn: number, text: string, opts: { align?: NoteAlign; bold?: boolean; textHeightIn?: number } = {}): void {
    const textSize = (opts.textHeightIn ?? DEFAULT_NOTE_SIZE_MM / IN) * IN;
    const paragraphs = text.split("\n").map((line) => ({
      ...(opts.align ? { align: opts.align } : {}),
      runs: [{ text: line, ...(opts.bold ? { bold: true } : {}) }],
    }));
    this.commands.push({
      type: "create_text_note",
      itemId: this.nextId("note"),
      ownerId: this.viewId,
      at,
      width: widthIn * IN,
      textSize,
      paragraphs,
      mask: true,
    });
  }

  calloutStack(
    side: "left" | "right",
    xIn: number,
    topYIn: number,
    widthIn: number,
    entries: readonly { readonly text: string; readonly to: Vec2 }[],
  ): void {
    const widthMm = widthIn * IN;
    const textSizeMm = DEFAULT_NOTE_SIZE_MM;
    const gapPaperMm = 0.11 * IN;
    const marginXMm = xIn * IN;
    const widthModelMm = widthMm * this.scale;
    const noteX = side === "left" ? marginXMm - widthModelMm : marginXMm;
    const align: NoteAlign = side === "left" ? "right" : "left";
    const arrow: NoteLeaderArrow = "filled_arrow";
    const shoulderModel = 0.18 * IN * this.scale;

    let cursorY = topYIn * IN;
    for (const entry of entries) {
      const paragraphs = entry.text.split("\n").map((line) => ({
        align,
        runs: [{ text: line }],
      }));
      const measured = layoutNote(paragraphs, { width: widthMm, height: null, size: textSizeMm });
      const firstMidPaperMm = measured.lines[0] ? measured.lines[0].top + measured.lines[0].height / 2 : measured.height / 2;
      const at: Vec2 = { x: Math.round(noteX * 1000) / 1000, y: Math.round(cursorY * 1000) / 1000 };
      const attachY = at.y - firstMidPaperMm * this.scale;
      const elbowX = side === "left" ? marginXMm + shoulderModel : marginXMm - shoulderModel;
      this.commands.push({
        type: "create_text_note",
        itemId: this.nextId("call"),
        ownerId: this.viewId,
        at,
        width: widthMm,
        textSize: textSizeMm,
        paragraphs,
        mask: true,
        leaders: [
          {
            to: entry.to,
            elbow: { x: Math.round(elbowX * 1000) / 1000, y: Math.round(attachY * 1000) / 1000 },
            arrow,
          },
        ],
      });
      cursorY -= (measured.height + gapPaperMm) * this.scale;
    }
  }
}

/**
 * Appends Sheet M-501 (Mechanical Details) with two CAD-standard 2D drafting details
 * tailored to the Showcase building's RTU-1 (Carrier 50FC-A06) and restroom exhaust
 * assembly: lineweight hierarchy, hatched assemblies, detail components, break lines
 * with cut masks, real CAD dimensions, and opaque-masked aligned callout stacks.
 */
export function appendShowcaseDetails(model: ModelState): ModelState {
  const scale = 16; // 3/4" = 1'-0"
  const rtu = new DetailBuilder("view-detail-rtu-curb", scale, "dtl-rtu");
  rtu.commands.push({
    type: "create_view",
    viewId: rtu.viewId,
    name: 'RTU-1 on 14" Insulated Roof Curb Detail',
    viewType: "detail",
    props: { scale, discipline: "mechanical" },
  });

  // Service & condenser clearance envelopes
  rtu.rect(-48, 15.5, 48, 34, "hidden");
  rtu.rect(64, 15.5, 36, 34, "hidden");

  // East flat roof assembly (metal deck + rigid insulation + roofing membrane)
  for (const [rx, rw] of [
    [-46, 50],
    [60, 38],
  ] as const) {
    rtu.regionRect(rx, -5.5, rw, 3.5, { hatch: "metal_deck", tone: "halftone", lineStyle: "medium" });
    rtu.regionRect(rx, -2, rw, 3.5, { hatch: "insulation_rigid", tone: "screened", lineStyle: "thin" });
    rtu.line(pt(rx, 1.5), pt(rx + rw, 1.5), "wide");
  }
  rtu.breakLine(pt(-44, -7.5), pt(-44, 4), "left", 5);
  rtu.breakLine(pt(96, -7.5), pt(96, 4), "right", 5);

  // 14" insulated roof curb rails (left & right mirrored)
  rtu.component("mechanical.roof_curb_rail", pt(-2, 1.5), { widthIn: 8, heightIn: 14 });
  rtu.component("mechanical.roof_curb_rail", pt(58, 1.5), { widthIn: 8, heightIn: 14, mirror: true });

  // Carrier 50FC-A06 RTU-1 cabinet + condenser discharge shroud + OA intake hood
  rtu.regionRect(0, 15.5, 64, 34, { hatch: "solid", tone: "screened", boundary: false });
  rtu.rect(0, 15.5, 64, 34, "wide");
  rtu.line(pt(24, 15.5), pt(24, 49.5), "thin");
  rtu.line(pt(48, 15.5), pt(48, 49.5), "thin");
  rtu.rect(8, 49.5, 22, 4, "medium");
  rtu.chain([pt(64, 39.5), pt(74, 31.5), pt(74, 23.5), pt(64, 23.5)], "medium");
  rtu.note(pt(8, 37.5), 2.9, "CARRIER 50FC-A06 PACKAGED RTU\nRTU-1 (5-TON, 480V/3PH)\nEAST PARAPET ROOF DECK", {
    align: "center",
    bold: true,
    textHeightIn: 0.1,
  });

  // Supply & Return vertical curb drops with 1" NFPA 90A acoustic liner
  rtu.line(pt(10, 15.5), pt(10, -40), "wide");
  rtu.line(pt(24, 15.5), pt(24, -40), "wide");
  rtu.regionRect(10, -35, 1.5, 28, { hatch: "acoustic", tone: "halftone", lineStyle: "thin" });
  rtu.regionRect(22.5, -35, 1.5, 28, { hatch: "acoustic", tone: "halftone", lineStyle: "thin" });
  rtu.line(pt(11.5, -14), pt(22.5, -18), "medium");
  rtu.circle(pt(17, -16), 0.75, "thin");
  rtu.component("flow_arrow", pt(15.5, -24), { widthIn: 5, heightIn: 3, rotationDeg: -90 });

  rtu.line(pt(40, 15.5), pt(40, -40), "wide");
  rtu.line(pt(54, 15.5), pt(54, -40), "wide");
  rtu.regionRect(40, -35, 1.5, 28, { hatch: "acoustic", tone: "halftone", lineStyle: "thin" });
  rtu.regionRect(52.5, -35, 1.5, 28, { hatch: "acoustic", tone: "halftone", lineStyle: "thin" });
  rtu.component("flow_arrow", pt(48.5, -18), { widthIn: 5, heightIn: 3, rotationDeg: 90 });

  // Ceiling plane & concentric plenum transition box
  rtu.line(pt(-12, -52), pt(8, -52), "medium");
  rtu.line(pt(56, -52), pt(76, -52), "medium");
  rtu.component("mechanical.concentric_diffuser", pt(8, -53), { widthIn: 48, heightIn: 13 });

  // Real CAD dimensions
  rtu.dimension(pt(-48, 49.5), pt(0, 49.5), -0.45, " SERVICE CLR.");
  rtu.dimension(pt(64, 49.5), pt(100, 49.5), -0.45, " COND. / OA CLR.");
  rtu.dimension(pt(0, 1.5), pt(0, 15.5), -0.55, " CURB");

  // Aligned margin callouts (zero overlaps)
  rtu.calloutStack("left", -54, 20, 2.85, [
    { text: '14" INSULATED ROOF CURB\n(CRRFCURB) W/ CANT & FLASHING', to: pt(0.5, 11.5) },
  ]);
  rtu.calloutStack("left", -54, 3.5, 2.85, [
    { text: "FLAT ROOF METAL DECK\nW/ RIGID INSULATION & MEMBRANE", to: pt(-28, -0.5) },
  ]);
  rtu.calloutStack("left", -54, -16, 2.85, [
    { text: "SUPPLY DROP DUCT W/ BAL. DAMPER\nSEAL ALL JOINTS (SMACNA CLASS A)", to: pt(10, -20) },
    { text: 'FINISHED CEILING PLANE (9\'-6" AFF)', to: pt(-6, -52) },
  ]);
  rtu.calloutStack("right", 106, 35, 2.95, [
    { text: "OUTDOOR AIR INTAKE HOOD\nW/ BIRD SCREEN & MOTORIZED DAMPER", to: pt(74, 29) },
  ]);
  rtu.calloutStack("right", 106, -16, 2.95, [
    { text: 'RETURN DROP DUCT W/ 1" INTERNAL\nACOUSTIC DUCT LINER (NFPA 90A)', to: pt(54, -20) },
    { text: "PLENUM TRANSITION & CONCENTRIC BOX\nCONNECT TO 10'-8\" PLENUM TRUNKS", to: pt(56, -46) },
  ]);

  // ── DETAIL 2: RESTROOM EXHAUST FAN & EXTERIOR WALL CAP ──
  const fan = new DetailBuilder("view-detail-ef-wall", scale, "dtl-ef");
  fan.commands.push({
    type: "create_view",
    viewId: fan.viewId,
    name: "Restroom Exhaust & Exterior Wall Cap Detail",
    viewType: "detail",
    props: { scale, discipline: "mechanical" },
  });

  // Exterior CMU backup + interior gypsum board
  fan.regionRect(42, -14, 8, 42, { hatch: "masonry", tone: "halftone", lineStyle: "wide" });
  fan.regionRect(40, -14, 2, 42, { hatch: "gypsum", tone: "screened", lineStyle: "thin" });
  fan.breakLine(pt(37.5, 25.5), pt(52.5, 25.5), "left", 5);
  fan.breakLine(pt(52.5, -11.5), pt(37.5, -11.5), "left", 5);

  // Restroom ceiling plane
  fan.regionRect(-10, -2, 50, 2, { hatch: "gypsum", tone: "screened", lineStyle: "medium" });
  fan.line(pt(-10, 0), pt(40, 0), "wide");
  fan.breakLine(pt(-8.5, -4), pt(-8.5, 4), "left", 4);

  // Ceiling cabinet exhaust assembly
  fan.component("mechanical.exhaust_fan_ceiling", pt(2, -1), { widthIn: 14, heightIn: 13 });

  // 6" Ø rigid galvanized exhaust duct sloped toward exterior with opaque cut mask through wall
  fan.regionPoints([pt(16, 9), pt(50, 7.5), pt(50, 1.5), pt(16, 3)], { masking: true, boundary: false });
  fan.chain([pt(16, 9), pt(50, 7.5)], "wide");
  fan.chain([pt(16, 3), pt(50, 1.5)], "wide");
  fan.line(pt(16, 6), pt(50, 4.5), "center");
  fan.component("flow_arrow", pt(26, 4), { widthIn: 8, heightIn: 3.5, rotationDeg: -2.5 });

  // 6" Ø exterior hooded wall cap w/ integral BDD & 1/4" bird screen
  fan.component("mechanical.hooded_louver", pt(50, -0.5), { widthIn: 10, heightIn: 10 });

  // CAD dimensions
  fan.dimension(pt(0, -4), pt(16, -4), 0.45, " FAN HSG.");
  fan.dimension(pt(40, -14), pt(50, -14), 0.45);

  // Aligned margin callouts
  fan.calloutStack("left", -16, 24, 3.15, [
    { text: "RESTROOM EXHAUST ASSEMBLY (EF-1)\nINTEGRAL BACKDRAFT DAMPER\nWIRED TO LIGHTING CIRCUIT", to: pt(6, 11) },
    { text: '6" Ø RIGID GALV. EXHAUST DUCT\nSLOPE 1/4" PER FT TO EXTERIOR\nINSULATE W/ R-6 WRAP IN PLENUM', to: pt(20, 8.8) },
    { text: 'RESTROOM CEILING (9\'-6" AFF)', to: pt(-2, 0) },
  ]);
  fan.calloutStack("right", 66, 24, 2.85, [
    { text: "2-HR CMU EXTERIOR WALL\nSEAL PENETRATION WEATHERTIGHT", to: pt(48, 18) },
    { text: '6" Ø HOODED WALL CAP\nW/ INTEGRAL BDD & 1/4" BIRD SCREEN\nCAULK FLANGE PERIMETER', to: pt(57, 6) },
  ]);

  let m = run(model, [...rtu.commands, ...fan.commands]);

  // Fit tight CAD crops around all drawn items, notes, leaders, and dimensions
  const padMm = 0.35 * IN * scale;
  const cropCmds: Command[] = [];
  for (const vid of [rtu.viewId, fan.viewId]) {
    const b = detailContentBounds(m, vid);
    if (!b) throw new Error(`showcase-details: empty bounds for ${vid}`);
    cropCmds.push({
      type: "set_view_crop",
      viewId: vid,
      crop: {
        min: { x: Math.round((b.min.x - padMm) * 1000) / 1000, y: Math.round((b.min.y - padMm) * 1000) / 1000 },
        max: { x: Math.round((b.max.x + padMm) * 1000) / 1000, y: Math.round((b.max.y + padMm) * 1000) / 1000 },
      },
    });
  }

  // Place both drafted details cleanly on Arch D Sheet M-501
  m = run(m, [
    ...cropCmds,
    {
      type: "create_sheet",
      sheetId: "sheet-m501",
      number: "M-501",
      name: "MECHANICAL DETAILS",
      discipline: "mechanical",
      group: "Mechanical",
      sortOrder: 403,
    },
    {
      type: "place_viewport",
      viewportId: "vp-detail-rtu-curb",
      sheetId: "sheet-m501",
      viewId: rtu.viewId,
      center: { x: Math.round(14.5 * IN), y: Math.round(15.8 * IN) },
    },
    {
      type: "place_viewport",
      viewportId: "vp-detail-ef-wall",
      sheetId: "sheet-m501",
      viewId: fan.viewId,
      center: { x: Math.round(14.5 * IN), y: Math.round(6.2 * IN) },
    },
  ]);

  return appendShowcasePlumbingDetails(m);
}

/**
 * Author CAD-standard Plumbing Legend (placed on Sheet P-001) and 4 model-linked
 * Plumbing Details on Sheet P-501 (WS-6 `linkedElementIds` so edits to WH-1, ET-1,
 * RPZ-1, FCO-1, or VTR-1 trigger live detail staleness alerts).
 */
export function appendShowcasePlumbingDetails(model: ModelState): ModelState {
  // ── LEGEND VIEW FOR P-001: PIPE SERVICE LINE-CODE & EQUIPMENT/BACKFLOW SYMBOLS ──
  const legendScale = 12; // 1" = 1'-0" paper-friendly drafting scale
  const leg = new DetailBuilder("view-plumb-legend", legendScale, "leg-p");
  leg.commands.push({
    type: "create_view",
    viewId: leg.viewId,
    name: "Plumbing Pipe Service & Symbol Legend",
    viewType: "detail",
    props: { scale: legendScale, discipline: "plumbing" },
  });

  // Left panel: Pipe Service Line-Code Legend
  leg.note(pt(0, 62), 3.6, "PIPE SERVICE LINE-CODE LEGEND", { bold: true });
  leg.line(pt(0, 58), pt(46, 58), "medium");
  const pipeLegend: readonly { readonly code: string; readonly label: string; readonly style: DetailLineStyleId }[] = [
    { code: "CW", label: "DOMESTIC COLD WATER (TYPE L COPPER)", style: "wide" },
    { code: "HW", label: "DOMESTIC HOT WATER (120°F, INSULATED)", style: "medium" },
    { code: "HWR", label: "HOT WATER RECIRCULATION RETURN (DASHED)", style: "hidden" },
    { code: "SAN", label: "SANITARY WASTE / SOIL DRAINAGE (PVC SCH 40)", style: "wide" },
    { code: "V", label: "SANITARY VENT PIPING (DASHED IN PRINT)", style: "hidden" },
    { code: "ST", label: "STORM ROOF DRAIN & LEADER (CAST IRON / PVC)", style: "center" },
    { code: "G", label: "NATURAL GAS (2 PSI MAIN / 7\" W.C. BRANCH, SCH 40)", style: "wide" },
    { code: "COND", label: "CONDENSATE DRAIN (NEUTRALIZED TO SANITARY)", style: "thin" },
  ];
  pipeLegend.forEach((row, idx) => {
    const y = 53 - idx * 6.5;
    leg.line(pt(0, y), pt(9, y), row.style);
    leg.note(pt(10.5, y + 1.8), 0.75, row.code, { bold: true });
    leg.note(pt(19.5, y + 1.8), 3.1, row.label);
  });

  // Right panel: Backflow & Plumbing Equipment Symbol Legend
  leg.note(pt(62, 62), 3.6, "EQUIPMENT & BACKFLOW SYMBOL LEGEND", { bold: true });
  leg.line(pt(62, 58), pt(108, 58), "medium");
  const symRows: readonly { readonly tag: string; readonly label: string; readonly draw: (cx: number, cy: number) => void }[] = [
    {
      tag: "RPZ",
      label: "REDUCED PRESSURE ZONE BACKFLOW PREVENTER (ASSE 1013)",
      draw: (cx, cy) => {
        leg.rect(cx - 3.0, cy - 1.4, 6.0, 2.8, "medium");
        leg.circle(pt(cx, cy), 0.9, "thin");
      },
    },
    {
      tag: "MTR",
      label: "DOMESTIC WATER METER (SITE SERVICE ENTRY)",
      draw: (cx, cy) => {
        leg.rect(cx - 2.6, cy - 1.4, 5.2, 2.8, "medium");
        leg.line(pt(cx - 2.6, cy), pt(cx + 2.6, cy), "thin");
      },
    },
    {
      tag: "WH",
      label: "COMMERCIAL WATER HEATER (ELECTRIC / CONDENSING GAS)",
      draw: (cx, cy) => {
        leg.circle(pt(cx, cy), 2.1, "medium");
        leg.circle(pt(cx, cy), 1.4, "thin");
      },
    },
    {
      tag: "ET",
      label: "THERMAL EXPANSION TANK (PRECHARGED DIAPHRAGM, IPC 607.3)",
      draw: (cx, cy) => {
        leg.circle(pt(cx, cy), 1.6, "medium");
      },
    },
    {
      tag: "RP",
      label: "INLINE DHW RECIRCULATION PUMP (BRONZE WET-ROTOR)",
      draw: (cx, cy) => {
        leg.circle(pt(cx, cy), 1.7, "medium");
        leg.chain([pt(cx - 1.0, cy - 0.9), pt(cx + 1.2, cy), pt(cx - 1.0, cy + 0.9), pt(cx - 1.0, cy - 0.9)], "thin");
      },
    },
    {
      tag: "GM / GR",
      label: "FUEL GAS METER (2 PSI) / LINE PRESSURE REGULATOR (7\" W.C.)",
      draw: (cx, cy) => {
        leg.rect(cx - 2.6, cy - 1.5, 5.2, 3.0, "medium");
        leg.circle(pt(cx, cy), 1.0, "thin");
      },
    },
    {
      tag: "RD / FCO",
      label: "ROOF DRAIN (4\" DOME) / EXTERIOR FLOOR CLEANOUT (GRADE)",
      draw: (cx, cy) => {
        leg.circle(pt(cx, cy), 1.8, "medium");
        leg.line(pt(cx - 1.8, cy), pt(cx + 1.8, cy), "thin");
        leg.line(pt(cx, cy - 1.8), pt(cx, cy + 1.8), "thin");
      },
    },
    {
      tag: "VTR / CN",
      label: "VENT THROUGH ROOF (3\" MIN) / CONDENSATE NEUTRALIZER",
      draw: (cx, cy) => {
        leg.circle(pt(cx, cy), 1.8, "wide");
        leg.circle(pt(cx, cy), 0.9, "thin");
      },
    },
  ];
  symRows.forEach((row, idx) => {
    const y = 53 - idx * 6.5;
    row.draw(65.5, y);
    leg.note(pt(70.5, y + 1.8), 0.85, row.tag, { bold: true });
    leg.note(pt(80.5, y + 1.8), 3.2, row.label);
  });

  // ── P-501 DETAIL 1: WATER HEATER, EXPANSION TANK & DRAIN PAN (LINKED TO WH-1 & ET-1) ──
  const whScale = 16; // 3/4" = 1'-0"
  const wh = new DetailBuilder("view-detail-wh-assembly", whScale, "dtl-wh");
  wh.commands.push({
    type: "create_view",
    viewId: wh.viewId,
    name: "Water Heater, Expansion Tank & Drain Pan Detail",
    viewType: "detail",
    props: {
      scale: whScale,
      discipline: "plumbing",
      linkedElementIds: [asElementId("wh-1"), asElementId("et-1")],
    },
  });

  // Concrete floor slab & 2" overflow drain pan
  wh.regionRect(-24, -8, 68, 8, { hatch: "concrete", tone: "halftone", lineStyle: "medium" });
  wh.line(pt(-24, 0), pt(44, 0), "wide");
  wh.breakLine(pt(-22, -10), pt(-22, 2), "left", 4);
  wh.breakLine(pt(42, 2), pt(42, -10), "left", 4);
  wh.rect(-13, 0, 26, 2.5, "wide");

  // Commercial water heater tank body (22" Ø × 56" H)
  wh.regionRect(-11, 2.5, 22, 54, { hatch: "insulation_rigid", tone: "screened", lineStyle: "wide" });
  wh.rect(-11, 2.5, 22, 54, "wide");
  wh.rect(-5, 36, 10, 9, "thin"); // control cover

  // Top CW inlet (-5") + HW outlet (+5") copper risers & isolation valves
  wh.chain([pt(-5, 56.5), pt(-5, 72), pt(-24, 72)], "wide");
  wh.chain([pt(5, 56.5), pt(5, 76), pt(24, 76)], "wide");
  // Thermal expansion tank ET-1 teed off CW inlet (-16", y = 55..69)
  wh.line(pt(-16, 72), pt(-16, 65), "medium");
  wh.regionRect(-21, 51, 10, 14, { hatch: "crosshatch", tone: "screened", lineStyle: "medium" });
  wh.rect(-21, 51, 10, 14, "medium");

  // Side T&P relief valve discharge pipe dropping to 6" above drain pan
  wh.chain([pt(11, 48), pt(16, 48), pt(16, 6)], "medium");

  // Side condensate neutralizer & floor drain stub for condensing gas WH-2
  wh.rect(19, 10, 12, 4, "medium");
  wh.line(pt(31, 12), pt(38, 12), "thin");

  // CAD dimensions
  wh.dimension(pt(-13, -4), pt(13, -4), 0.55, " DRAIN PAN");
  wh.dimension(pt(-11, 2.5), pt(-11, 56.5), -1.15);

  // Aligned margin callouts (zero crossings)
  wh.calloutStack("left", -28, 76, 3.1, [
    { text: '1-1/4" CW INLET W/ FULL-PORT\nBALL VALVE & DIELECTRIC UNION', to: pt(-10, 72) },
    { text: "THERMAL EXPANSION TANK (ET-1)\nPRECHARGED TO STATIC PSI\nSUPPORT INDEPENDENTLY (IPC 607.3)", to: pt(-21, 58) },
    { text: "COMMERCIAL WATER HEATER (WH-1)\nSET ON 2\" DEEP DRAIN PAN\nW/ 3/4\" INDIRECT DRAIN TO FD", to: pt(-11, 22) },
  ]);
  wh.calloutStack("right", 42, 76, 3.1, [
    { text: '1-1/4" HW OUTLET & 3/4" HWR\nRECIRCULATION LOOP W/ RP-1\nINSULATE PER IECC C404.4', to: pt(10, 76) },
    { text: 'T&P RELIEF VALVE (150 PSI / 210°F)\nFULL-SIZE COPPER DISCHARGE\nTERMINATE 6" ABOVE DRAIN PAN', to: pt(16, 44) },
    { text: "INLINE CONDENSATE NEUTRALIZER\n(CN-1 ON CONDENSING WH-2)\nCALCIUM CARBONATE MEDIA", to: pt(25, 14) },
  ]);

  // ── P-501 DETAIL 2: RPZ BACKFLOW PREVENTER ASSEMBLY (LINKED TO RPZ-1) ──
  const rpzScale = 12; // 1" = 1'-0"
  const rpz = new DetailBuilder("view-detail-rpz", rpzScale, "dtl-rpz");
  rpz.commands.push({
    type: "create_view",
    viewId: rpz.viewId,
    name: "RPZ Backflow Preventer Assembly Detail",
    viewType: "detail",
    props: {
      scale: rpzScale,
      discipline: "plumbing",
      linkedElementIds: [asElementId("rpz-1")],
    },
  });

  // Floor slab & floor drain funnel receptor
  rpz.regionRect(-24, -6, 56, 6, { hatch: "concrete", tone: "halftone", lineStyle: "medium" });
  rpz.line(pt(-24, 0), pt(32, 0), "wide");
  rpz.breakLine(pt(-22, -8), pt(-22, 2), "left", 4);
  rpz.breakLine(pt(30, 2), pt(30, -8), "left", 4);

  // Incoming 2" water service riser & outgoing main at 36" AFF
  rpz.chain([pt(-18, -4), pt(-18, 36), pt(-10, 36)], "wide");
  rpz.chain([pt(14, 36), pt(22, 36), pt(22, 16)], "wide");

  // Horizontal RPZ body (20" W) + twin check bonnets + isolation valves
  rpz.rect(-10, 33, 24, 6, "wide");
  rpz.rect(-6, 39, 5, 4, "medium");
  rpz.rect(5, 39, 5, 4, "medium");
  rpz.line(pt(-12, 32), pt(-12, 42), "medium"); // inlet shutoff
  rpz.line(pt(16, 32), pt(16, 42), "medium"); // outlet shutoff

  // Bottom relief valve + air-gap funnel piped to floor drain
  rpz.rect(-1, 28, 6, 5, "medium");
  rpz.chain([pt(-1, 26), pt(5, 26), pt(3, 22), pt(1, 22), pt(-1, 26)], "medium");
  rpz.line(pt(2, 22), pt(2, 2), "medium");
  rpz.rect(-1, -1.5, 6, 1.5, "wide"); // floor drain grate

  // CAD dimensions
  rpz.dimension(pt(-18, 0), pt(-18, 36), -0.9, " AFF (12\"-60\")");
  rpz.dimension(pt(-10, 52), pt(14, 52), 0.75, " RPZ ASSY");

  // Aligned margin callouts
  rpz.calloutStack("left", -26, 48, 3.0, [
    { text: '2" TYPE L COPPER SERVICE RISER\nFROM EXTERIOR WATER METER (MTR-1)\nPROVIDE SLEEVE & WATERSTOP', to: pt(-18, 22) },
    { text: "INLET ISOLATION BALL VALVE\n& WYE STRAINER W/ BLOWDOWN", to: pt(-12, 36) },
  ]);
  rpz.calloutStack("right", 32, 48, 3.0, [
    { text: "RPZ BACKFLOW PREVENTER (RPZ-1)\nASSE 1013 W/ 4 TEST COCKS\nMIN 24\" CLEAR TEST ACCESS (IPC 608)", to: pt(8, 41) },
    { text: "FACTORY AIR-GAP FUNNEL &\nFULL-SIZE INDIRECT RELIEF DRAIN\nTO FLOOR DRAIN (NO DIRECT CONN.)", to: pt(4, 24) },
    { text: "PIPE SUPPORT STAND TO FLOOR\nANCHOR WITH STAINLESS STUDS", to: pt(22, 20) },
  ]);

  // ── P-501 DETAIL 3: EXTERIOR FLOOR CLEANOUT (LINKED TO FCO-1) ──
  const fcoScale = 12;
  const fco = new DetailBuilder("view-detail-fco", fcoScale, "dtl-fco");
  fco.commands.push({
    type: "create_view",
    viewId: fco.viewId,
    name: "Exterior Floor Cleanout Detail",
    viewType: "detail",
    props: {
      scale: fcoScale,
      discipline: "plumbing",
      linkedElementIds: [asElementId("fco-1")],
    },
  });

  // Grade line, compacted earth hatch, and 18"×18"×6" concrete collar
  fco.regionRect(-18, -28, 36, 28, { hatch: "earth", tone: "screened", lineStyle: "thin" });
  fco.regionRect(-9, -6, 18, 6, { hatch: "concrete", tone: "halftone", lineStyle: "wide" });
  fco.line(pt(-18, 0), pt(18, 0), "wide");
  fco.breakLine(pt(-18, -30), pt(-18, 2), "left", 4);
  fco.breakLine(pt(18, 2), pt(18, -30), "left", 4);

  // Heavy-duty nickel-bronze recessed cleanout head flush at grade
  fco.rect(-4, -1.5, 8, 1.5, "wide");
  // 4" PVC vertical riser neck + threaded brass plug + combo wye into sloped building sewer
  fco.regionRect(-2.25, -21, 4.5, 19.5, { masking: true, boundary: false });
  fco.line(pt(-2.25, -1.5), pt(-2.25, -19), "wide");
  fco.line(pt(2.25, -1.5), pt(2.25, -19), "wide");
  fco.line(pt(0, -1.5), pt(0, -21), "center");

  // Sloped 4" PVC building sewer lateral (1/8" per ft toward MH-1)
  fco.regionPoints([pt(-18, -23.5), pt(18, -22.5), pt(18, -18), pt(-18, -19)], { masking: true, boundary: false });
  fco.line(pt(-18, -19), pt(18, -18), "wide");
  fco.line(pt(-18, -23.5), pt(18, -22.5), "wide");
  fco.line(pt(-18, -21.25), pt(18, -20.25), "center");
  fco.component("flow_arrow", pt(-12, -22.5), { widthIn: 6, heightIn: 2.8, rotationDeg: 181 });

  // CAD dimension (cleanly above grade line & callout leaders)
  fco.dimension(pt(-9, 12), pt(9, 12), 0.5, " CONC. COLLAR");

  // Aligned margin callouts
  fco.calloutStack("left", -26, 10, 3.0, [
    { text: 'HEAVY-DUTY RECESSED COVER (FCO-1)\nFLUSH AT FINISHED GRADE\nSET IN 18"×18"×6" CONC. COLLAR', to: pt(-4, -0.5) },
    { text: '4" PVC SCH 40 RISER NECK\nWITH COUNTERSUNK BRASS PLUG', to: pt(-2.25, -11) },
  ]);
  fco.calloutStack("right", 26, 10, 3.0, [
    { text: "COMPACTED GRAVEL BEDDING\n6\" MIN BELOW 1'-9\" INVERT (IPC 306.3)", to: pt(10, -24) },
    { text: '4" PVC SANITARY SEWER LATERAL\nSLOPE 1/8" PER FT TO MH-1\nLONG-SWEEP COMBO WYE FITTING', to: pt(12, -18.5) },
  ]);

  // ── P-501 DETAIL 4: VENT THROUGH ROOF (VTR) FLASHING (LINKED TO VTR-1) ──
  const vtrScale = 12;
  const vtr = new DetailBuilder("view-detail-vtr", vtrScale, "dtl-vtr");
  vtr.commands.push({
    type: "create_view",
    viewId: vtr.viewId,
    name: "Vent Through Roof (VTR) Flashing Detail",
    viewType: "detail",
    props: {
      scale: vtrScale,
      discipline: "plumbing",
      linkedElementIds: [asElementId("vtr-1")],
    },
  });

  // Roof structure, rigid insulation, and EPDM/TPO membrane
  vtr.regionRect(-24, -4, 48, 4, { hatch: "concrete", tone: "halftone", lineStyle: "medium" });
  vtr.regionRect(-24, 0, 48, 4, { hatch: "insulation_rigid", tone: "screened", lineStyle: "thin" });
  vtr.line(pt(-24, 4), pt(24, 4), "wide");
  vtr.breakLine(pt(-22, -6), pt(-22, 6), "left", 4);
  vtr.breakLine(pt(22, 6), pt(22, -6), "left", 4);

  // 3" Vent stack extending 12"+ above finished roof membrane
  vtr.regionRect(-1.75, -16, 3.5, 34, { masking: true, boundary: false });
  vtr.line(pt(-1.75, -16), pt(-1.75, 18), "wide");
  vtr.line(pt(1.75, -16), pt(1.75, 18), "wide");
  vtr.line(pt(0, -16), pt(0, 19), "center");
  vtr.line(pt(-1.75, 18), pt(1.75, 18), "wide");

  // 4 lb lead / neoprene flashing boot + counterflashing collar + roof flange
  vtr.chain([pt(-9, 4), pt(-4.5, 4), pt(-2.4, 14), pt(2.4, 14), pt(4.5, 4), pt(9, 4)], "wide");
  vtr.line(pt(-2.4, 14), pt(-2.4, 17.5), "medium");
  vtr.line(pt(2.4, 14), pt(2.4, 17.5), "medium");

  // CAD dimensions (outside deck & stack geometry)
  vtr.dimension(pt(-11, 4), pt(-11, 18), -0.45, " MIN");
  vtr.dimension(pt(-9, -23), pt(9, -23), -0.45, " FLASHING FLANGE");

  // Aligned margin callouts
  vtr.calloutStack("left", -32, 24, 3.5, [
    { text: '3" Ø VENT STACK (VTR-1)\nMIN 12" ABOVE ROOF & 10\'-0" CLEAR\nOF ALL OA INTAKES (IPC 903.5)', to: pt(-1.75, 17) },
    { text: "ROOF MEMBRANE & R-30 RIGID INSUL.\nOVER CONCRETE ROOF DECK", to: pt(-15, 2) },
  ]);
  vtr.calloutStack("right", 28, 24, 3.5, [
    { text: "4 LB LEAD / NEOPRENE ROOF JACK\nTURN TOP 1\" INTO VENT STACK\nSEAL WITH ELASTOMERIC CAULK", to: pt(3.2, 11) },
    { text: "WEATHERPROOF DECK FLANGE\nSTRIP-IN WITH ROOFING MEMBRANE\nPER ROOFING MFR. WARRANTY", to: pt(7, 4) },
  ]);

  let m = run(model, [...leg.commands, ...wh.commands, ...rpz.commands, ...fco.commands, ...vtr.commands]);

  // Fit tight CAD crops around every plumbing drafting view
  const cropSpecs: readonly { readonly vid: string; readonly scale: number }[] = [
    { vid: leg.viewId, scale: legendScale },
    { vid: wh.viewId, scale: whScale },
    { vid: rpz.viewId, scale: rpzScale },
    { vid: fco.viewId, scale: fcoScale },
    { vid: vtr.viewId, scale: vtrScale },
  ];
  const cropCmds: Command[] = [];
  for (const { vid, scale } of cropSpecs) {
    const b = detailContentBounds(m, vid);
    if (!b) throw new Error(`showcase-details: empty bounds for ${vid}`);
    const padMm = 0.35 * IN * scale;
    cropCmds.push({
      type: "set_view_crop",
      viewId: vid,
      crop: {
        min: { x: Math.round((b.min.x - padMm) * 1000) / 1000, y: Math.round((b.min.y - padMm) * 1000) / 1000 },
        max: { x: Math.round((b.max.x + padMm) * 1000) / 1000, y: Math.round((b.max.y + padMm) * 1000) / 1000 },
      },
    });
  }

  // Place legend on P-001 (if sheet-p001 exists) and all 4 linked details in a crisp 2×2 grid on Arch D Sheet P-501
  const placeLegendCmd: Command[] = m.elements["sheet-p001"]
    ? [{ type: "place_viewport", viewportId: "vp-plumb-legend", sheetId: "sheet-p001", viewId: leg.viewId, center: { x: 420, y: 410 } }]
    : [];

  m = run(m, [
    ...cropCmds,
    ...placeLegendCmd,
    {
      type: "create_sheet",
      sheetId: "sheet-p501",
      number: "P-501",
      name: "PLUMBING DETAILS",
      discipline: "plumbing",
      group: "Plumbing",
      sortOrder: 605,
    },
    {
      type: "place_viewport",
      viewportId: "vp-detail-wh-assembly",
      sheetId: "sheet-p501",
      viewId: wh.viewId,
      center: { x: 225, y: 430 },
    },
    {
      type: "place_viewport",
      viewportId: "vp-detail-rpz",
      sheetId: "sheet-p501",
      viewId: rpz.viewId,
      center: { x: 605, y: 430 },
    },
    {
      type: "place_viewport",
      viewportId: "vp-detail-fco",
      sheetId: "sheet-p501",
      viewId: fco.viewId,
      center: { x: 225, y: 165 },
    },
    {
      type: "place_viewport",
      viewportId: "vp-detail-vtr",
      sheetId: "sheet-p501",
      viewId: vtr.viewId,
      center: { x: 605, y: 165 },
    },
  ]);

  return m;
}
