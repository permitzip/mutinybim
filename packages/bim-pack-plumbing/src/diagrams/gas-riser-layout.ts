import { oneLineItemsExtent, oneLineTextHeight } from "@permitzip/bim-kernel";
import type { DiagramEdge, DiagramNode, OneLineItem, OneLineTextLine, RiserLevel, Vec2 } from "@permitzip/bim-kernel";
import { classifyPlumbingDevice, getPlumbingNodeMeta, type GasRegulatorMeta, type PlumbingDeviceKind } from "./plumbing-topology";
import type { PipeRef, PipingLayout, PipingLayoutOptions } from "./piping-layout";

/**
 * Dedicated ASPE-standard Fuel Gas Riser Diagram layout (Natural Gas & Propane):
 * - Gas Meter / Service Entry assembly (`M` circle with flanges, fuel, inlet pressure, total MBH & CFH).
 * - Service / Line / Appliance Regulators (diaphragm bowtie + domed bonnet, inlet → outlet pressure,
 *   MBH load, and `VL` / `VTO` vent indicator) with dashed pressure-zone boundary dividers & zone banners.
 * - Shut-off Valves (`SOV` horizontal/vertical bowtie), Drip Legs / Sediment Traps (`DRIP` tee + capped pocket).
 * - Appliance boxes with bold mark + MBH cleanly inside, per-piece SIZE / LF / CFH callouts, and end caps (`CAP`).
 * - Full multi-floor vertical riser support and interactive `pipes` / `nodes` / `ranges` / `entries` preservation.
 */

const ROW = 82;
const LEFT = 46;
const COL = 26;
const DEVICE_W = 24;
const REG_W = 34;
const TIER = 14;
const STUB = 10;
const ROOT_LEAD = 22;
const BOX_W = 18;
const BOX_H = 10;
const METER_R = 3.8;
const TOLERANCE_MM = 1219;

const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

export function isFuelGasKind(kind: string): boolean {
  return kind === "natural_gas" || kind === "propane";
}

function bandOf(levels: readonly RiserLevel[], z: number | undefined, levelId: string | null): number {
  if (z === undefined) {
    const i = levels.findIndex((l) => l.id === levelId);
    return i >= 0 ? i : levels.length;
  }
  for (let i = 0; i < levels.length; i++) if ((levels[i] as RiserLevel).elevationMm <= z + TOLERANCE_MM) return i;
  return Math.max(0, levels.length - 1);
}

function parseNumber(text: string | undefined): number {
  if (!text) return 0;
  const m = text.replace(/,/g, "").match(/[\d.]+/);
  return m ? Number(m[0]) : 0;
}

function formatCfh(mbh: number, heatingValueBtuPerCf: number): string {
  if (!(mbh > 0) || !(heatingValueBtuPerCf > 0)) return "";
  const cfh = Math.round(((mbh * 1000) / heatingValueBtuPerCf) * 10) / 10;
  return `${cfh.toLocaleString("en-US")} CFH`;
}

function formatMbh(mbh: number): string {
  const r = Math.round(mbh * 100) / 100;
  return `${r.toLocaleString("en-US")} MBH`;
}

function ventCodeOf(vent: string | undefined): string {
  if (!vent) return "";
  const v = vent.toLowerCase();
  if (v === "vent_limiter" || v === "vl") return "VL";
  if (v === "vent_to_outdoors" || v === "vto") return "VTO";
  return "";
}

function isCapOrOpen(n: DiagramNode): boolean {
  const u = n.name.toUpperCase();
  return u === "CAP" || u === "OPEN END";
}

function circlePoints(c: Vec2, r: number, steps = 16): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push(round({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }));
  }
  return pts;
}

function teeDot(items: OneLineItem[], at: Vec2, nodeId: string): void {
  const r = 0.6;
  items.push({
    shape: "polyline",
    points: [
      round({ x: at.x - r, y: at.y - r }),
      round({ x: at.x + r, y: at.y - r }),
      round({ x: at.x + r, y: at.y + r }),
      round({ x: at.x - r, y: at.y + r }),
    ],
    closed: true,
    weight: "heavy",
    nodeId,
  });
}

function deviceHalfSpan(dk: PlumbingDeviceKind): number {
  if (dk === "gas_meter" || dk === "water_meter") return METER_R;
  if (dk === "gas_regulator" || dk === "prv") return 3.6;
  if (dk === "drip_leg") return 2.2;
  return 2.6;
}

/** Resolve regulator details from semantic metadata or fallback node lines. */
function regulatorDetails(n: DiagramNode, currentZonePressure: string): {
  readonly mark: string;
  readonly pressureLine: string;
  readonly loadLine: string;
  readonly ventCode: string;
  readonly outletZoneLabel: string;
} {
  const meta: GasRegulatorMeta | undefined = getPlumbingNodeMeta(n)?.gasRegulator;
  if (meta) {
    const inlet = meta.inletLabel ? meta.inletLabel.toUpperCase() : currentZonePressure;
    const outlet = meta.outletLabel.toUpperCase();
    const pressureLine = inlet && inlet !== outlet ? `${inlet} → ${outlet}` : outlet;
    const ventCode = ventCodeOf(meta.vent);
    const loadParts = [meta.loadMbh > 0 ? formatMbh(meta.loadMbh) : "", ventCode].filter(Boolean);
    return {
      mark: (n.lines[0]?.text ?? n.name).toUpperCase(),
      pressureLine,
      loadLine: loadParts.join(" · "),
      ventCode,
      outletZoneLabel: outlet,
    };
  }
  const line1 = (n.lines[0]?.text ?? n.name).toUpperCase();
  const line2 = (n.lines[1]?.text ?? "").toUpperCase();
  const outletMatch = line2.match(/([\d.]+\s*(?:PSI|IN\.\s*W\.C\.))/i);
  const outlet = outletMatch ? outletMatch[1]!.toUpperCase() : "";
  const ventCode = /\bVTO\b/i.test(line2) ? "VTO" : /\bVL\b/i.test(line2) ? "VL" : "";
  const pressureLine = outlet && currentZonePressure && currentZonePressure !== outlet ? `${currentZonePressure} → ${outlet}` : (outlet || line2);
  const mbhMatch = line2.match(/([\d,.]+\s*MBH)/i);
  const loadLine = [mbhMatch ? mbhMatch[1]!.toUpperCase() : "", ventCode].filter(Boolean).join(" · ");
  return {
    mark: line1,
    pressureLine,
    loadLine,
    ventCode,
    outletZoneLabel: outlet || currentZonePressure,
  };
}

/** Draws an ASPE Gas Meter circle (`M`) with inlet/outlet flanges. */
function drawGasMeterSymbol(items: OneLineItem[], c: Vec2, nodeId: string): void {
  items.push(
    { shape: "polyline", points: circlePoints(c, METER_R), closed: true, weight: "medium", nodeId },
    // Flanged spud bars on inlet & outlet
    { shape: "line", points: [round({ x: c.x - METER_R, y: c.y - 1.8 }), round({ x: c.x - METER_R, y: c.y + 1.8 })], weight: "heavy", nodeId },
    { shape: "line", points: [round({ x: c.x + METER_R, y: c.y - 1.8 }), round({ x: c.x + METER_R, y: c.y + 1.8 })], weight: "heavy", nodeId },
    { shape: "text", at: round({ x: c.x - 2.8, y: c.y + 1.6 }), widthMm: 5.6, lines: [{ text: "M", bold: true }], nodeId, role: "note", align: "center" },
  );
}

/** Draws an ASPE Gas Pressure Regulator (bowtie + domed diaphragm bonnet + VL/VTO vent indicator). */
function drawGasRegulatorSymbol(
  items: OneLineItem[],
  s: DiagramNode,
  c: Vec2,
  vertical: boolean,
  currentZonePressure: string,
  drawZoneDivider: boolean,
): string {
  const info = regulatorDetails(s, currentZonePressure);
  if (!vertical) {
    const hw = 3.6;
    const hh = 2.0;
    // Bowtie body
    items.push({
      shape: "polyline",
      points: [
        round({ x: c.x - hw, y: c.y + hh }),
        round({ x: c.x - hw, y: c.y - hh }),
        round({ x: c.x + hw, y: c.y + hh }),
        round({ x: c.x + hw, y: c.y - hh }),
      ],
      closed: true,
      weight: "medium",
      nodeId: s.id,
    });
    // Vertical diaphragm stem + domed bonnet arch above bowtie
    const stemTop = c.y + 3.6;
    const domeR = 2.4;
    items.push(
      { shape: "line", points: [round({ x: c.x, y: c.y }), round({ x: c.x, y: stemTop })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: c.x - domeR, y: stemTop }), round({ x: c.x + domeR, y: stemTop })], weight: "medium", nodeId: s.id },
      {
        shape: "polyline",
        points: [
          round({ x: c.x - domeR, y: stemTop }),
          round({ x: c.x - domeR * 0.7, y: stemTop + domeR * 0.75 }),
          round({ x: c.x, y: stemTop + domeR }),
          round({ x: c.x + domeR * 0.7, y: stemTop + domeR * 0.75 }),
          round({ x: c.x + domeR, y: stemTop }),
        ],
        weight: "medium",
        nodeId: s.id,
      },
    );
    // Vent indicator (VL cap or VTO dashed vent line)
    if (info.ventCode === "VTO") {
      items.push(
        { shape: "line", points: [round({ x: c.x, y: stemTop + domeR }), round({ x: c.x, y: stemTop + domeR + 4.8 })], weight: "thin", dashed: true, nodeId: s.id },
        { shape: "text", at: round({ x: c.x + 1.2, y: stemTop + domeR + 4.6 }), widthMm: 10, lines: [{ text: "VTO", bold: true }], nodeId: s.id, role: "note" },
      );
    } else if (info.ventCode === "VL") {
      items.push(
        { shape: "line", points: [round({ x: c.x - 1.1, y: stemTop + domeR + 0.8 }), round({ x: c.x + 1.1, y: stemTop + domeR + 0.8 })], weight: "medium", nodeId: s.id },
        { shape: "text", at: round({ x: c.x + 1.6, y: stemTop + domeR + 2.4 }), widthMm: 8, lines: [{ text: "VL", bold: true }], nodeId: s.id, role: "note" },
      );
    }
    if (drawZoneDivider) {
      items.push({
        shape: "line",
        points: [round({ x: c.x, y: c.y - 4.0 }), round({ x: c.x, y: c.y - 11.0 })],
        weight: "thin",
        dashed: true,
        nodeId: s.id,
      });
    }
    // Label cleanly below the horizontal regulator
    const lblLines: OneLineTextLine[] = [
      { text: info.mark, bold: true },
      ...(info.pressureLine ? [{ text: info.pressureLine }] : []),
      ...(info.loadLine ? [{ text: info.loadLine }] : []),
    ];
    items.push({
      shape: "text",
      at: round({ x: c.x - 16, y: c.y - hh - 1.6 }),
      widthMm: 32,
      lines: lblLines,
      nodeId: s.id,
      role: "equipment",
      align: "center",
    });
  } else {
    // Vertical appliance regulator on a drop
    const hw = 2.0;
    const hh = 3.2;
    items.push({
      shape: "polyline",
      points: [
        round({ x: c.x - hw, y: c.y + hh }),
        round({ x: c.x + hw, y: c.y + hh }),
        round({ x: c.x - hw, y: c.y - hh }),
        round({ x: c.x + hw, y: c.y - hh }),
      ],
      closed: true,
      weight: "medium",
      nodeId: s.id,
    });
    const stemX = c.x - 3.6;
    const domeR = 2.0;
    items.push(
      { shape: "line", points: [round({ x: c.x, y: c.y }), round({ x: stemX, y: c.y })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: stemX, y: c.y - domeR }), round({ x: stemX, y: c.y + domeR })], weight: "medium", nodeId: s.id },
      {
        shape: "polyline",
        points: [
          round({ x: stemX, y: c.y - domeR }),
          round({ x: stemX - domeR * 0.75, y: c.y - domeR * 0.65 }),
          round({ x: stemX - domeR, y: c.y }),
          round({ x: stemX - domeR * 0.75, y: c.y + domeR * 0.65 }),
          round({ x: stemX, y: c.y + domeR }),
        ],
        weight: "medium",
        nodeId: s.id,
      },
    );
    if (info.ventCode === "VTO") {
      items.push({ shape: "line", points: [round({ x: stemX - domeR, y: c.y }), round({ x: stemX - domeR - 3.5, y: c.y + 3.5 })], weight: "thin", dashed: true, nodeId: s.id });
    }
    const lblLines: OneLineTextLine[] = [
      { text: info.mark, bold: true },
      ...(info.pressureLine ? [{ text: info.pressureLine }] : []),
      ...(info.loadLine ? [{ text: info.loadLine }] : []),
    ];
    const h = oneLineTextHeight(lblLines, 28);
    items.push({
      shape: "text",
      at: round({ x: c.x + hw + 1.4, y: c.y + h / 2 }),
      widthMm: 28,
      lines: lblLines,
      nodeId: s.id,
      role: "equipment",
    });
  }
  return info.outletZoneLabel;
}

/** Draws an ASPE Shut-off Valve bowtie (`SOV`). */
function drawGasShutoffSymbol(items: OneLineItem[], s: DiagramNode, c: Vec2, vertical: boolean): void {
  if (!vertical) {
    const hw = 2.6;
    const hh = 1.8;
    items.push({
      shape: "polyline",
      points: [
        round({ x: c.x - hw, y: c.y + hh }),
        round({ x: c.x - hw, y: c.y - hh }),
        round({ x: c.x + hw, y: c.y + hh }),
        round({ x: c.x + hw, y: c.y - hh }),
      ],
      closed: true,
      weight: "medium",
      nodeId: s.id,
    });
    items.push({
      shape: "text",
      at: round({ x: c.x - 6, y: c.y - hh - 1.2 }),
      widthMm: 12,
      lines: [{ text: "SOV", bold: true }],
      nodeId: s.id,
      role: "note",
      align: "center",
    });
  } else {
    const hw = 1.8;
    const hh = 2.6;
    items.push({
      shape: "polyline",
      points: [
        round({ x: c.x - hw, y: c.y + hh }),
        round({ x: c.x + hw, y: c.y + hh }),
        round({ x: c.x - hw, y: c.y - hh }),
        round({ x: c.x + hw, y: c.y - hh }),
      ],
      closed: true,
      weight: "medium",
      nodeId: s.id,
    });
    items.push({
      shape: "text",
      at: round({ x: c.x - hw - 9.2, y: c.y + 1.6 }),
      widthMm: 8.5,
      lines: [{ text: "SOV", bold: true }],
      nodeId: s.id,
      role: "note",
      align: "center",
    });
  }
}

/** Draws an ASPE Drip Leg / Sediment Trap (`DRIP`) tee + capped pocket. */
function drawGasDripLegSymbol(items: OneLineItem[], s: DiagramNode, c: Vec2, vertical: boolean): void {
  if (!vertical) {
    items.push(
      { shape: "line", points: [round({ x: c.x - 2.2, y: c.y }), round({ x: c.x + 2.2, y: c.y })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: c.x, y: c.y }), round({ x: c.x, y: c.y - 4.4 })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: c.x - 1.8, y: c.y - 4.4 }), round({ x: c.x + 1.8, y: c.y - 4.4 })], weight: "heavy", nodeId: s.id },
      { shape: "text", at: round({ x: c.x - 6, y: c.y - 5.4 }), widthMm: 12, lines: [{ text: "DRIP", bold: true }], nodeId: s.id, role: "note", align: "center" },
    );
  } else {
    // Vertical drop sediment trap: vertical pocket teeing off left with capped bottom leg
    items.push(
      { shape: "line", points: [round({ x: c.x, y: c.y + 2.2 }), round({ x: c.x, y: c.y - 2.2 })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: c.x, y: c.y }), round({ x: c.x - 2.6, y: c.y })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: c.x - 2.6, y: c.y }), round({ x: c.x - 2.6, y: c.y - 3.6 })], weight: "medium", nodeId: s.id },
      { shape: "line", points: [round({ x: c.x - 4.2, y: c.y - 3.6 }), round({ x: c.x - 1.0, y: c.y - 3.6 })], weight: "heavy", nodeId: s.id },
      { shape: "text", at: round({ x: c.x - 12.6, y: c.y + 1.4 }), widthMm: 9.5, lines: [{ text: "DRIP", bold: true }], nodeId: s.id, role: "note", align: "center" },
    );
  }
}

export function layoutGasRiser(roots: readonly DiagramNode[], levels: readonly RiserLevel[], opts: PipingLayoutOptions = {}): PipingLayout {
  const items: OneLineItem[] = [];
  const pipes: Record<string, PipeRef> = {};
  const ranges: Record<string, readonly [number, number]> = {};
  const entries: Record<string, Vec2> = {};
  const nodes: Array<{ id: string; kind: DiagramNode["kind"]; name: string; center: Vec2; depth: number }> = [];
  let usedUnknown = false;
  let pieceNo = 0;

  const band = (n: DiagramNode): number => {
    const b = bandOf(levels, n.at?.z, n.levelId);
    if (b >= levels.length) usedUnknown = true;
    return b;
  };
  const floorY = (b: number) => -(b + 1) * ROW;
  const topY = (b: number) => -b * ROW;
  const tierY = (b: number, depth: number) => Math.max(floorY(b) + 34, topY(b) - 18 - depth * TIER);
  const fixtureY = (b: number) => floorY(b) + 8;

  // Measure subtree widths bottom-up (preserving tree order strictly left-to-right).
  const widthOf = new Map<DiagramNode, number>();
  const upStack = new Map<DiagramNode, boolean>();

  const isDrop = (kids: readonly DiagramNode[], b: number): boolean => {
    const last = kids[kids.length - 1];
    return (
      kids.length > 1 &&
      last?.role === "terminal" &&
      last.children.length === 0 &&
      !isCapOrOpen(last) &&
      kids.slice(0, -1).every((k) => k.role === "device") &&
      kids.every((k) => band(k) === b)
    );
  };

  const measure = (stations: readonly DiagramNode[], startBand: number, lead = 0): number => {
    let x = 0;
    let max = 0;
    let prev: DiagramNode | null = null;
    let prevBand = startBand;
    for (const s of stations) {
      if (s.role === "device" && s.lines.length === 0) {
        widthOf.set(s, 0);
        upStack.set(s, false);
        continue;
      }
      const b = band(s);
      const stacked = b !== prevBand;
      if (!stacked) x += prev ? (widthOf.get(prev) ?? COL) : lead;
      let base: number;
      if (s.role === "branch") {
        if (isDrop(s.children, b)) {
          const hasReg = s.children.some((k) => k.role === "device" && classifyPlumbingDevice(k) === "gas_regulator");
          base = hasReg ? REG_W : COL;
        } else {
          base = Math.max(COL, measure(s.children, b));
        }
      } else if (s.role === "device") {
        const dk = classifyPlumbingDevice(s);
        base = dk === "gas_regulator" || dk === "prv" ? REG_W : DEVICE_W;
      } else if (isCapOrOpen(s)) {
        base = 14;
      } else {
        base = s.children.length > 0 ? Math.max(COL, measure(s.children, b, 16)) : COL;
      }
      const w = base + (stacked && s.role !== "device" ? STUB : 0);
      widthOf.set(s, w);
      upStack.set(s, stacked);
      max = Math.max(max, x + w);
      prev = s;
      prevBand = b;
    }
    return max;
  };

  let originX = LEFT + 8;
  const legendFuels = new Set<string>();
  let anyRegulator = false;

  for (const root of roots) {
    const kind = root.service;
    const labels = opts.labels ?? ["size", "load", "length"];
    const showSize = labels.includes("size");
    const showLoad = labels.includes("load");
    const showLength = labels.includes("length");

    const sourceMeta = getPlumbingNodeMeta(root)?.gasSource;
    const rootText = root.lines.map((l) => l.text).join(" ");
    const isPropane = sourceMeta ? sourceMeta.fuel === "propane" : (kind === "propane" || /\bpropane\b|\blp\b/i.test(rootText));
    const heatingValue = sourceMeta?.heatingValueBtuPerCf ?? (isPropane ? 2516 : 1000);
    legendFuels.add(isPropane ? "PROPANE (LP)" : "NATURAL GAS (NG)");

    const parsedInletMatch = rootText.match(/([\d.]+\s*(?:PSI|IN\.\s*W\.C\.))/i);
    const initialZonePressure = (sourceMeta?.inletLabel ?? parsedInletMatch?.[1] ?? "7 in. w.c.").toUpperCase();

    const rb = band(root);
    const width = Math.max(COL, measure(root.children, rb, ROOT_LEAD)) + COL;

    const pipeLine = (ownerId: string, ownerName: string, edge: DiagramEdge | undefined, a: Vec2, b: Vec2): { pa: Vec2; pb: Vec2 } | null => {
      const pa = round(a);
      const pb = round(b);
      if (Math.abs(pa.x - pb.x) < 0.01 && Math.abs(pa.y - pb.y) < 0.01) return null;
      const id = `pipe:${ownerId}:${pieceNo++}`;
      const ids = edge?.elementIds ?? (edge?.linkId ? [edge.linkId] : []);
      if (ids[0]) {
        pipes[id] = {
          elementId: ids[0],
          elementIds: ids,
          name: `${edge?.label ? `${edge.label} ` : ""}gas pipe${ownerName && ownerName !== "OPEN END" ? ` to ${ownerName}` : ""}`,
        };
      }
      items.push({ shape: "line", points: [pa, pb], weight: "medium", nodeId: id });
      return { pa, pb };
    };

    const callout = (ownerId: string, edge: DiagramEdge | undefined, seg: { pa: Vec2; pb: Vec2 } | null, extraMbh?: number) => {
      if (!seg || !edge) return;
      const out: string[] = [];
      if (showSize && edge.label) out.push(edge.label);
      if (showLength && edge.lengthFt) out.push(`${edge.lengthFt} LF`);
      if (showLoad) {
        const mbh = parseNumber(edge.load) || (extraMbh ?? 0);
        const cfh = formatCfh(mbh, heatingValue);
        if (cfh) out.push(cfh);
      }
      if (out.length === 0) return;
      const lines: OneLineTextLine[] = out.map((text) => ({ text }));
      const vertical = Math.abs(seg.pa.x - seg.pb.x) < 0.05;
      const id = `pipe:${ownerId}:lbl:${pieceNo++}`;
      if (vertical) {
        const w = 16;
        const h = oneLineTextHeight(lines, w);
        const midY = (seg.pa.y + seg.pb.y) / 2;
        items.push({ shape: "text", at: round({ x: seg.pa.x + 1.4, y: midY + h / 2 }), widthMm: w, lines, nodeId: id, role: "device" });
      } else {
        const span = Math.abs(seg.pb.x - seg.pa.x);
        const w = Math.max(16, span - 1);
        const h = oneLineTextHeight(lines, w);
        const left = Math.min(seg.pa.x, seg.pb.x);
        items.push({ shape: "text", at: round({ x: left + 1.0, y: seg.pa.y + h + 1.2 }), widthMm: w, lines, nodeId: id, role: "device" });
      }
    };

    const zoneBanner = (zonePressure: string, x: number, y: number, nodeId: string) => {
      if (!zonePressure) return;
      items.push({
        shape: "text",
        at: round({ x, y: y + 20.5 }),
        widthMm: 36,
        lines: [{ text: `${zonePressure} ZONE`, bold: true }],
        nodeId: `zone:${nodeId}:${pieceNo++}`,
        role: "note",
      });
    };

    const drawAppliance = (s: DiagramNode, from: Vec2, b: number, edge: DiagramEdge | null, depth: number, zonePressure: string) => {
      if (isCapOrOpen(s)) {
        if (s.name.toUpperCase() === "CAP") {
          items.push(
            { shape: "line", points: [round({ x: from.x, y: from.y - 2.2 }), round({ x: from.x, y: from.y + 2.2 })], weight: "heavy", nodeId: s.id },
            { shape: "text", at: round({ x: from.x + 2.2, y: from.y + 1.6 }), widthMm: 12, lines: [{ text: "CAP", bold: true }], nodeId: s.id, role: "note" },
          );
          nodes.push({ id: s.id, kind: s.kind, name: s.name, center: round(from), depth: 0 });
        }
        return;
      }
      const fy = fixtureY(b);
      const topBoxY = fy + BOX_H;
      const seg = pipeLine(s.id, s.name, s.feed, from, { x: from.x, y: topBoxY });
      const appMbh = parseNumber(s.lines[1]?.text);
      if (edge) callout(s.id, edge, seg, appMbh);

      // Appliance box with bold mark + MBH cleanly inside
      items.push({
        shape: "polyline",
        points: [
          round({ x: from.x - BOX_W / 2, y: fy }),
          round({ x: from.x + BOX_W / 2, y: fy }),
          round({ x: from.x + BOX_W / 2, y: topBoxY }),
          round({ x: from.x - BOX_W / 2, y: topBoxY }),
        ],
        closed: true,
        weight: "medium",
        nodeId: s.id,
      });
      const boxLines = s.lines.slice(0, 2);
      const textH = oneLineTextHeight(boxLines, BOX_W - 1.2);
      items.push({
        shape: "text",
        at: round({ x: from.x - (BOX_W - 1.2) / 2, y: fy + (BOX_H + textH) / 2 - 0.5 }),
        widthMm: BOX_W - 1.2,
        lines: boxLines,
        nodeId: s.id,
        role: "equipment",
        align: "center",
      });
      nodes.push({ id: s.id, kind: s.kind, name: s.name, center: round({ x: from.x, y: fy + BOX_H / 2 }), depth: 0 });

      if (s.children.length > 0) {
        drawLine(s.children, { x: from.x + BOX_W / 2, y: fy + BOX_H / 2 }, depth + 1, 14, zonePressure, false);
      }
    };

    const drawDevice = (s: DiagramNode, c: Vec2, vertical: boolean, zonePressure: string, isMainLine: boolean): string => {
      const dk = classifyPlumbingDevice(s);
      let nextZone = zonePressure;
      if (dk === "gas_meter" || dk === "water_meter") {
        drawGasMeterSymbol(items, c, s.id);
        if (s.lines.length > 0) {
          items.push({
            shape: "text",
            at: round({ x: c.x - 10, y: c.y - METER_R - 1.4 }),
            widthMm: 20,
            lines: s.lines.slice(0, 2),
            nodeId: s.id,
            role: "note",
            align: "center",
          });
        }
      } else if (dk === "gas_regulator" || dk === "prv") {
        anyRegulator = true;
        nextZone = drawGasRegulatorSymbol(items, s, c, vertical, zonePressure, isMainLine && !vertical);
      } else if (dk === "drip_leg") {
        drawGasDripLegSymbol(items, s, c, vertical);
      } else {
        drawGasShutoffSymbol(items, s, c, vertical);
      }
      nodes.push({ id: s.id, kind: s.kind, name: s.name, center: round(c), depth: 0 });
      return nextZone;
    };

    const drawDrop = (kids: readonly DiagramNode[], from: Vec2, b: number, zonePressure: string) => {
      const end = kids[kids.length - 1] as DiagramNode;
      const fy = fixtureY(b);
      const bottom = fy + BOX_H;
      const devices = kids.slice(0, -1).filter((k) => k.lines.length > 0);
      const step = (bottom - from.y) / (devices.length + 1);
      const totalFt = kids.reduce((sum, k) => sum + (k.feed?.lengthFt ?? 0), 0);
      const first = kids[0] as DiagramNode;
      const combinedIds = kids.flatMap((k) => k.feed?.elementIds ?? (k.feed?.linkId ? [k.feed.linkId] : []));
      const dropEdge: DiagramEdge | undefined = first.feed
        ? { ...first.feed, lengthFt: totalFt > 0 ? totalFt : first.feed.lengthFt, elementIds: combinedIds.length > 0 ? combinedIds : first.feed.elementIds }
        : end.feed;
      const appMbh = parseNumber(end.lines[1]?.text);

      let curY = from.y;
      let curZone = zonePressure;
      let labelledDrop = false;
      devices.forEach((d, i) => {
        const dy = from.y + step * (i + 1);
        const dk = classifyPlumbingDevice(d);
        const span = dk === "gas_regulator" || dk === "prv" ? 3.2 : dk === "drip_leg" ? 2.2 : 2.6;
        const t0 = items.length;
        entries[d.id] = round({ x: from.x, y: curY });
        const seg = pipeLine(d.id, d.name, d.feed ?? dropEdge, { x: from.x, y: curY }, { x: from.x, y: dy + span });
        if (!labelledDrop && dk !== "gas_regulator") {
          callout(d.id, dropEdge, seg, appMbh);
          labelledDrop = true;
        }
        curZone = drawDevice(d, { x: from.x, y: dy }, true, curZone, false);
        ranges[d.id] = [t0, items.length];
        curY = dy - span;
      });

      const t0 = items.length;
      entries[end.id] = round({ x: from.x, y: curY });
      drawAppliance(end, { x: from.x, y: curY }, b, labelledDrop ? null : (dropEdge ?? null), 0, curZone);
      ranges[end.id] = [t0, items.length];
    };

    const drawLine = (stations: readonly DiagramNode[], start: Vec2, depth: number, lead = 0, startZone: string, showInitialBanner = false) => {
      let cur = start;
      let prev: DiagramNode | null = null;
      let zonePressure = startZone;
      let absorbedIds: DiagramEdge["elementIds"] = undefined;
      let absorbedLenFt = 0;

      if (showInitialBanner && depth === 0 && stations.length > 0) {
        zoneBanner(zonePressure, start.x + 2, start.y, root.id);
      }

      for (const s of stations) {
        // Absorb anonymous reducer/transition nodes seamlessly without drawing mystery diamonds
        if (s.role === "device" && s.lines.length === 0) {
          const ids = s.feed?.elementIds ?? (s.feed?.linkId ? [s.feed.linkId] : []);
          absorbedIds = [...(absorbedIds ?? []), ...ids];
          absorbedLenFt += s.feed?.lengthFt ?? 0;
          continue;
        }
        const effectiveEdge: DiagramEdge | undefined =
          absorbedIds && s.feed
            ? { ...s.feed, elementIds: [...absorbedIds, ...(s.feed.elementIds ?? [])], lengthFt: (s.feed.lengthFt ?? 0) + absorbedLenFt }
            : s.feed;
        absorbedIds = undefined;
        absorbedLenFt = 0;

        const b = band(s);
        const stacked = upStack.get(s) === true;
        const at: Vec2 = stacked
          ? { x: cur.x, y: tierY(b, depth) }
          : { x: cur.x + (prev ? (widthOf.get(prev) ?? COL) : lead), y: cur.y };

        const t0 = items.length;
        entries[s.id] = round(cur);

        if (s.role === "terminal" && !stacked) {
          const seg = pipeLine(s.id, s.name, effectiveEdge, cur, at);
          if (isCapOrOpen(s)) {
            callout(s.id, effectiveEdge, seg);
            drawAppliance(s, at, b, null, depth, zonePressure);
          } else {
            teeDot(items, at, s.id);
            callout(s.id, effectiveEdge, seg);
            drawAppliance(s, at, b, effectiveEdge ?? null, depth, zonePressure);
          }
          cur = at;
        } else if (s.role === "device") {
          const dk = classifyPlumbingDevice(s);
          const span = deviceHalfSpan(dk);
          const segEnd: Vec2 = stacked
            ? { x: at.x, y: at.y + (cur.y > at.y ? span : -span) }
            : { x: Math.max(cur.x, at.x - span), y: at.y };
          const seg = pipeLine(s.id, s.name, effectiveEdge, cur, segEnd);
          callout(s.id, effectiveEdge, seg);
          const prevZone = zonePressure;
          zonePressure = drawDevice(s, at, stacked, zonePressure, depth === 0);
          if (!stacked && zonePressure && zonePressure !== prevZone) {
            zoneBanner(zonePressure, at.x + span + 4, at.y, s.id);
          }
          cur = stacked ? { x: at.x, y: at.y - (cur.y > at.y ? span : -span) } : { x: at.x + span, y: at.y };
        } else if (s.role === "terminal" && stacked) {
          const seg = pipeLine(s.id, s.name, effectiveEdge, cur, at);
          callout(s.id, effectiveEdge, seg);
          const off = { x: at.x + STUB, y: at.y };
          pipeLine(s.id, s.name, effectiveEdge, at, off);
          drawAppliance(s, off, b, effectiveEdge ?? null, depth, zonePressure);
          cur = at;
        } else {
          // Branch node
          const seg = pipeLine(s.id, s.name, effectiveEdge, cur, at);
          callout(s.id, effectiveEdge, seg);
          const off = stacked ? { x: at.x + STUB, y: at.y } : at;
          teeDot(items, at, s.id);
          nodes.push({ id: s.id, kind: s.kind, name: s.name, center: round(at), depth });
          const kids = s.children;
          const first = kids[0];
          if (stacked && first) pipeLine(first.id, first.name, first.feed, at, off);
          if (kids.length === 1 && first?.role === "terminal") {
            drawAppliance(first, off, b, first.feed ?? null, depth + 1, zonePressure);
          } else if (isDrop(kids, b)) {
            drawDrop(kids, off, b, zonePressure);
          } else if (first) {
            const tier = { x: off.x, y: tierY(b, depth + 1) };
            const dropSeg = pipeLine(first.id, first.name, first.feed, off, tier);
            callout(first.id, first.feed, dropSeg);
            drawLine(kids, tier, depth + 1, 0, zonePressure, false);
          }
          cur = at;
        }
        ranges[s.id] = [t0, items.length];
        prev = s;
      }
    };

    // Draw Gas Meter / Service Entry at head of main
    const t0 = items.length;
    const start = { x: originX, y: tierY(rb, 0) };
    drawGasMeterSymbol(items, start, root.id);

    const totalMbh = sourceMeta?.totalMbh ?? parseNumber(root.lines.find((l) => /MBH/i.test(l.text))?.text);
    const totalCfh = sourceMeta?.totalCfh ?? (totalMbh > 0 ? Math.round(((totalMbh * 1000) / heatingValue) * 10) / 10 : 0);
    const cfhSummary = totalCfh > 0 ? `${totalCfh.toLocaleString("en-US")} CFH TOTAL` : "";
    const rootLines: OneLineTextLine[] = [
      ...root.lines.slice(0, 3),
      ...(cfhSummary && !root.lines.some((l) => /CFH/i.test(l.text)) ? [{ text: cfhSummary }] : []),
    ];
    const rootH = oneLineTextHeight(rootLines, LEFT - 4);
    items.push({
      shape: "text",
      at: round({ x: start.x - METER_R - (LEFT - 2), y: start.y + rootH / 2 }),
      widthMm: LEFT - 4,
      lines: rootLines,
      nodeId: root.id,
      role: "equipment",
    });
    nodes.push({ id: root.id, kind: root.kind, name: root.name, center: round(start), depth: 0 });

    drawLine(root.children, { x: start.x + METER_R, y: start.y }, 0, ROOT_LEAD - METER_R, initialZonePressure, true);
    ranges[root.id] = [t0, items.length];
    originX += width + COL * 2;
  }

  const extentX = Math.max(originX, LEFT + 90);

  // ASPE Gas Riser Legend in top-right
  const legX = extentX - 66;
  const legY = floorY(0) + 12;
  const fuelLabel = Array.from(legendFuels).join(" / ") || "FUEL GAS";
  items.push(
    { shape: "line", points: [round({ x: legX, y: legY }), round({ x: legX + 12, y: legY })], weight: "medium", nodeId: "legend:gas" },
    { shape: "text", at: round({ x: legX + 14, y: legY + 1.5 }), widthMm: 50, lines: [{ text: fuelLabel }], nodeId: "legend:gas", role: "note" },
    ...(anyRegulator
      ? [
          {
            shape: "text" as const,
            at: round({ x: legX, y: legY - 4.5 }),
            widthMm: 64,
            lines: [{ text: "VL = VENT LIMITER · VTO = VENT TO OUTDOORS" }],
            nodeId: "legend:gas-vent",
            role: "note" as const,
          },
        ]
      : []),
  );

  const rows = [...levels.map((l) => l.name), ...(usedUnknown ? ["No level"] : [])];
  rows.forEach((name, i) => {
    const y = floorY(i);
    items.push({ shape: "line", points: [round({ x: 0, y }), round({ x: extentX, y })], weight: "thin", nodeId: "levels" });
    items.push({
      shape: "text",
      at: round({ x: 0, y: y + oneLineTextHeight([{ text: name }], LEFT - 4) + 1 }),
      widthMm: LEFT - 4,
      lines: [{ text: name.toUpperCase(), bold: true }],
      nodeId: "levels",
      role: "note",
    });
  });

  return { items, extent: oneLineItemsExtent(items), nodes, ranges, entries, pipes };
}
