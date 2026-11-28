/**
 * @jest-environment node
 *
 * WS-9 PDF-byte-level tests: schedule URL cells (`scheduleV2` list schedules
 * and `formSchedule` tables) emit clean short visible labels AND standard PDF
 * `/Subtype /Link` + `/S /URI` annotations in generated PDF bytes, resolve
 * host-neutral logical document refs via `resolveDocumentUrl`, and strictly
 * reject unsafe URI schemes (`javascript:`, `data:`, `file:`).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import {
  buildSheetSceneFor,
  builtinFormTemplate,
  commandSchema,
  executeCommand,
  type FormScheduleDefinition,
  type ModelState,
  type Primitive,
  type ScheduleDefinitionV2,
  type SheetScene,
} from "@permitzip/bim-kernel";
import { createDemoModel } from "@permitzip/bim-pack-mechanical/seed";
import "../src";
import { nodeNoteFonts, renderDrawingSet, renderSheetPdf } from "../src";
import { renderSheetPdfWith } from "../src/pdf-core";
import { loadType, referenceBuilding } from "../../bim-kernel/__tests__/fixtures/electrical-building";

const LONG_URL =
  "https://manufacturer.example.org/catalog/2026/specs/rooftop-unit-rtu-1-complete-engineering-cut-sheet-rev-7.pdf?format=pdf&lang=en";
const META = { title: "M-601", modelRevision: 1, snapshotSha256: "0".repeat(64), renderer: "test" } as const;

interface ExtractedPdfLink {
  readonly uri: string;
  readonly rect: readonly [number, number, number, number];
}

/** Extract every `/Subtype /Link` `/S /URI` annotation from page `pageIndex` of a generated PDF. */
async function extractPdfLinks(bytes: Uint8Array, pageIndex = 0): Promise<ExtractedPdfLink[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return [];
  const out: ExtractedPdfLink[] = [];
  for (const ref of annots.asArray()) {
    const dict = doc.context.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    const subtype = dict.lookup(PDFName.of("Subtype"));
    if (subtype !== PDFName.of("Link")) continue;
    const action = dict.lookup(PDFName.of("A"));
    if (!(action instanceof PDFDict)) continue;
    if (action.lookup(PDFName.of("S")) !== PDFName.of("URI")) continue;
    const uriObj = action.lookup(PDFName.of("URI"));
    if (!(uriObj instanceof PDFString)) continue;
    const rectArr = dict.lookup(PDFName.of("Rect"));
    if (!(rectArr instanceof PDFArray) || rectArr.size() !== 4) continue;
    const nums = rectArr.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : Number.NaN));
    out.push({
      uri: uriObj.decodeText(),
      rect: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0],
    });
  }
  return out;
}

/** Decode all standard-font WinAnsi hex strings emitted on page `pageIndex`. */
async function pageStrings(bytes: Uint8Array, pageIndex = 0): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  const refs = contents && "asArray" in contents ? contents.asArray() : contents ? [contents] : [];
  const out: string[] = [];
  for (const r of refs) {
    const stream = r instanceof PDFRawStream ? r : doc.context.lookup(r);
    if (!(stream instanceof PDFRawStream)) continue;
    const text = new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    for (const m of text.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) {
      const hex = m[1] ?? "";
      out.push(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => parseInt(h, 16))));
    }
  }
  return out;
}

function apply(model: ModelState, cmd: unknown): ModelState {
  const res = executeCommand(model, commandSchema.parse(cmd));
  if (!res.ok) throw new Error(res.error.message);
  return { ...res.model, revision: (model.revision + 1) as ModelState["revision"] };
}

describe("scheduleV2 list schedules → clickable PDF URI link annotations", () => {
  function modelWithScheduleV2(): ModelState {
    let m = createDemoModel();
    const existingLevel = Object.values(m.elements).find((el) => el.kind === "level");
    if (!existingLevel) {
      m = apply(m, { type: "create_level", levelId: "lvl-1", name: "Level 1", elevationMm: 0 });
    }
    const lvl = existingLevel?.id ?? "lvl-1";
    const whPartType = {
      familyName: "Water Heater",
      typeName: "Commercial Gas WH",
      category: "mechanical_equipment" as const,
      typeParams: [],
      typeValues: {},
      instanceParams: [
        { name: "cut_sheet", label: "Cut Sheet", kind: "text" as const },
        { name: "cut_sheet_url", label: "Submittal", kind: "text" as const },
      ],
      connectors: [],
      geometry: [{ kind: "box" as const, center: [0, 0, 750] as [number, number, number], size: [600, 600, 1500] as [number, number, number] }],
      symbol: [{ kind: "rect" as const, center: [0, 0] as [number, number], size: [600, 600] as [number, number] }],
      tagFields: ["mark"],
      source: { kind: "builtin" as const, libraryVersion: "test" },
    };
    m = apply(m, {
      type: "place_part",
      partId: "wh-1",
      typeId: "pt-wh",
      partType: whPartType,
      levelId: lvl,
      position: { x: 1000, y: 1000 },
      mark: "WH-1",
      values: {
        cut_sheet: LONG_URL,
        cut_sheet_url: "cut-sheets/wh-1.pdf",
      },
    });
    m = apply(m, {
      type: "place_part",
      partId: "wh-2",
      typeId: "pt-wh",
      levelId: lvl,
      position: { x: 2000, y: 1000 },
      mark: "WH-2",
      values: {
        cut_sheet: "[Cut Sheet](https://specs.example.org/wh-2.pdf)",
        cut_sheet_url: "[WH-2 Submittal](doc:wh-2-submittal)",
      },
    });
    m = apply(m, {
      type: "place_part",
      partId: "wh-3",
      typeId: "pt-wh",
      levelId: lvl,
      position: { x: 3000, y: 1000 },
      mark: "WH-3",
      values: {
        cut_sheet: "javascript:alert(1)",
        cut_sheet_url: "[Bad](file:///etc/passwd)",
      },
    });
    m = apply(m, {
      type: "place_part",
      partId: "wh-4",
      typeId: "pt-wh",
      levelId: lvl,
      position: { x: 4000, y: 1000 },
      mark: "WH-4",
      values: {
        cut_sheet: "data:text/html,<script>alert(1)</script>",
        cut_sheet_url: "[Also Bad](data:text/html,hi)",
      },
    });

    const def: ScheduleDefinitionV2 = {
      name: "Water Heater Schedule",
      source: { kind: "classes", classes: ["mep.mechanical_equipment"], includeSubclasses: true },
      columns: [
        { id: "mark", kind: "field", path: "mark" },
        { id: "cut_sheet", kind: "parameter", path: "cut_sheet", heading: "CUT SHEET" },
        { id: "cut_sheet_url", kind: "parameter", path: "cut_sheet_url", heading: "SUBMITTAL" },
      ],
      filters: [{ path: "mark", op: "contains", value: "WH-" }],
      sort: [{ path: "mark", direction: "asc" }],
      groups: [],
      grandTotals: false,
      itemize: true,
      presentation: { kind: "list" },
      display: { textSizeMm: 2.5, emptyText: "NONE" },
    };

    m = apply(m, { type: "create_sheet", sheetId: "p-601", number: "P-601", name: "Plumbing Schedules" });
    m = apply(m, { type: "create_view", viewId: "v-wh", name: "Water Heater Schedule", viewType: "schedule", props: { scheduleV2: def } });
    m = apply(m, { type: "place_viewport", viewportId: "vp-wh", sheetId: "p-601", viewId: "v-wh", center: { x: 250, y: 200 } });
    return m;
  }

  it("emits short clean visible labels and valid /Subtype /Link /S /URI PDF annotations for direct URLs, markdown links, and resolved document refs", async () => {
    const model = modelWithScheduleV2();
    const scene = buildSheetSceneFor(model, "p-601", { projectName: "Link Test" });
    const resolveDocumentUrl = (ref: string) =>
      ref.startsWith("doc:")
        ? `https://files.example.org/public/docs/${ref.slice(4)}.pdf`
        : `https://files.example.org/public/${ref}`;

    const pdf = await renderSheetPdf(scene, META, nodeNoteFonts(), null, { resolveDocumentUrl });
    const rawLatin1 = new TextDecoder("latin1").decode(pdf.bytes);
    const links = await extractPdfLinks(pdf.bytes);
    const strings = await pageStrings(pdf.bytes);

    // Raw PDF bytes carry standard Link + URI dictionaries and zero dangerous schemes.
    expect(rawLatin1).toContain("/Subtype /Link");
    expect(rawLatin1).toContain("/S /URI");
    expect(rawLatin1).not.toMatch(/javascript:|file:\/\/\/|data:text\/html/i);

    // Clean short labels printed with zero WinAnsi character substitutions.
    expect(pdf.substitutedText).toEqual([]);
    expect(strings).toEqual(expect.arrayContaining(["Cut Sheet", "WH-2 Submittal", "Bad", "Also Bad"]));
    expect(strings.some((s) => s.includes("manufacturer.example.org"))).toBe(false);

    // Every valid link produces a valid PDF URI annotation with positive bounding rect.
    expect(links.map((l) => l.uri)).toEqual([
      LONG_URL,
      "https://files.example.org/public/cut-sheets/wh-1.pdf",
      "https://specs.example.org/wh-2.pdf",
      "https://files.example.org/public/docs/wh-2-submittal.pdf",
    ]);
    for (const l of links) {
      expect(l.rect[2]).toBeGreaterThan(l.rect[0]);
      expect(l.rect[3]).toBeGreaterThan(l.rect[1]);
    }
  });

  it("omits link annotations for unresolved logical refs when no resolveDocumentUrl is provided", async () => {
    const model = modelWithScheduleV2();
    const scene = buildSheetSceneFor(model, "p-601", { projectName: "Link Test" });

    const pdf = await renderSheetPdf(scene, META, nodeNoteFonts(), null);
    const links = await extractPdfLinks(pdf.bytes);

    // Only the direct https:// URLs get PDF link annotations; unresolved `doc:` / relative refs do not emit broken URIs.
    expect(links.map((l) => l.uri)).toEqual([
      LONG_URL,
      "https://specs.example.org/wh-2.pdf",
    ]);
  });

  it("propagates resolveDocumentUrl through renderDrawingSet and preserves PDF link annotations in merged set PDFs", async () => {
    const model = modelWithScheduleV2();
    const set = await renderDrawingSet(model, {
      projectName: "Link Test",
      title: "Plumbing Set",
      renderer: "test",
      snapshotSha256: "0".repeat(64),
      noteFonts: nodeNoteFonts(),
      resolveDocumentUrl: (ref) =>
        ref.startsWith("doc:")
          ? `https://files.example.org/public/docs/${ref.slice(4)}.pdf`
          : `https://files.example.org/public/${ref}`,
    });

    const setLinks = await extractPdfLinks(set.pdf.bytes, 0);
    expect(setLinks.map((l) => l.uri)).toEqual([
      LONG_URL,
      "https://files.example.org/public/cut-sheets/wh-1.pdf",
      "https://specs.example.org/wh-2.pdf",
      "https://files.example.org/public/docs/wh-2-submittal.pdf",
    ]);
  });
});

describe("formSchedule tables → clickable PDF URI link annotations", () => {
  it("renders clickable PDF URI annotations for formSchedule URL cells and resolved doc refs while rejecting unsafe schemes", async () => {
    const b = referenceBuilding();
    const baseType = loadType("Unit with cut sheet", "mechanical_equipment", 3);
    const eqType = {
      ...baseType,
      instanceParams: [...baseType.instanceParams, { name: "cut_sheet", label: "Cut sheet", kind: "text" as const }],
    };
    b.ok({ type: "place_part", partId: "eq-url", typeId: "type-eq-cs", partType: eqType, levelId: "lvl-1", position: { x: 1000, y: 1000 }, mark: "EQ-1", values: { voltage: 480, load_va: 1000, cut_sheet: LONG_URL } });
    b.ok({ type: "place_part", partId: "eq-doc", typeId: "type-eq-cs", levelId: "lvl-1", position: { x: 2000, y: 1000 }, mark: "EQ-2", values: { voltage: 480, load_va: 1000, cut_sheet: "[Cut Sheet](doc:wh-1-cutsheet)" } });
    b.ok({ type: "place_part", partId: "eq-bad", typeId: "type-eq-cs", levelId: "lvl-1", position: { x: 3000, y: 1000 }, mark: "EQ-3", values: { voltage: 480, load_va: 1000, cut_sheet: "javascript:alert(1)" } });

    const base = builtinFormTemplate("equipment_connections");
    const formSchedule: FormScheduleDefinition = {
      kind: "equipment_connections",
      rules: "nec-2023",
      template: {
        ...base,
        body: {
          layout: "rows",
          columns: [
            ...(base.body.layout === "rows" ? base.body.columns : []),
            { heading: "CUT SHEET", value: "{cut_sheet}", align: "center" },
          ],
        },
      },
    };

    b.ok({ type: "create_sheet", sheetId: "e-602", number: "E-602", name: "Equipment Connections" });
    b.ok({ type: "create_view", viewId: "v-eq-conn", name: "Equipment Connections", viewType: "schedule", props: { formSchedule } });
    b.ok({ type: "place_viewport", viewportId: "vp-eq-conn", sheetId: "e-602", viewId: "v-eq-conn", center: { x: 300, y: 200 } });

    const scene = buildSheetSceneFor(b.head, "e-602", { projectName: "Example Building" });
    const pdf = await renderSheetPdf(scene, META, nodeNoteFonts(), null, {
      resolveDocumentUrl: (ref) => (ref.startsWith("doc:") ? `https://downloads.example.org/files/${ref.slice(4)}.pdf` : null),
    });

    const links = await extractPdfLinks(pdf.bytes);
    const strings = await pageStrings(pdf.bytes);
    const rawLatin1 = new TextDecoder("latin1").decode(pdf.bytes);

    expect(pdf.substitutedText).toEqual([]);
    expect(links.map((l) => l.uri)).toEqual(
      expect.arrayContaining([
        LONG_URL,
        "https://downloads.example.org/files/wh-1-cutsheet.pdf",
      ]),
    );
    expect(links).toHaveLength(2);
    expect(strings).toContain("Cut Sheet");
    expect(strings.some((s) => s.includes("manufacturer.example.org"))).toBe(false);
    expect(rawLatin1).not.toMatch(/javascript:|file:\/\/\/|data:text\/html/i);
  });
});

describe("pdf-core defense-in-depth URI validation", () => {
  function sceneWithPrimitives(primitives: readonly Primitive[]): SheetScene {
    return {
      paper: { x: 400, y: 300 },
      revision: 1,
      primitives,
      tags: [],
      dimensions: [],
      details: [],
      schedule: [],
    };
  }

  it("strictly rejects unsafe primitive hrefs and unsafe resolver outputs, and keeps monochrome links clickable", async () => {
    const resolver = jest.fn((ref: string) => {
      if (ref === "doc:good") return "https://public.example.org/good.pdf";
      if (ref === "doc:evil-js") return "javascript:alert(1)";
      if (ref === "doc:evil-file") return "file:///etc/passwd";
      if (ref === "doc:evil-data") return "data:text/html,<script>x</script>";
      return null;
    });

    const scene = sceneWithPrimitives([
      { kind: "text", at: { x: 20, y: 40 }, text: "Good Direct", size: 2.5, anchor: "start", href: "https://public.example.org/direct.pdf" },
      { kind: "text", at: { x: 20, y: 50 }, text: "Good Resolved", size: 2.5, anchor: "start", href: "doc:good" },
      { kind: "text", at: { x: 20, y: 60 }, text: "Unsafe JS", size: 2.5, anchor: "start", href: "javascript:alert(1)" },
      { kind: "text", at: { x: 20, y: 70 }, text: "Unsafe Data", size: 2.5, anchor: "start", href: "data:text/html,hi" },
      { kind: "text", at: { x: 20, y: 80 }, text: "Unsafe File", size: 2.5, anchor: "start", href: "file:///etc/passwd" },
      { kind: "text", at: { x: 20, y: 90 }, text: "Resolver JS", size: 2.5, anchor: "start", href: "doc:evil-js" },
      { kind: "text", at: { x: 20, y: 100 }, text: "Resolver File", size: 2.5, anchor: "start", href: "doc:evil-file" },
      { kind: "text", at: { x: 20, y: 110 }, text: "Resolver Data", size: 2.5, anchor: "start", href: "doc:evil-data" },
    ]);

    const pdf = await renderSheetPdfWith(scene, META, null, null, null, { monochrome: true, resolveDocumentUrl: resolver });
    const links = await extractPdfLinks(pdf.bytes);
    const rawLatin1 = new TextDecoder("latin1").decode(pdf.bytes);

    expect(links.map((l) => l.uri)).toEqual([
      "https://public.example.org/direct.pdf",
      "https://public.example.org/good.pdf",
    ]);
    // Unsafe schemes were never even passed to the host resolver.
    expect(resolver).not.toHaveBeenCalledWith("javascript:alert(1)");
    expect(resolver).not.toHaveBeenCalledWith("data:text/html,hi");
    expect(resolver).not.toHaveBeenCalledWith("file:///etc/passwd");
    expect(rawLatin1).not.toMatch(/javascript:|file:\/\/\/|data:text\/html/i);
  });
});
