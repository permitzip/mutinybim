/**
 * @jest-environment node
 *
 * WS-9: Schedule URL cell parsing, sanitization, host-neutral document URL
 * resolution, and `href` propagation in both `scheduleV2` list schedules and
 * `formSchedule` layouts.
 */
import "../../bim-calc/src";
import {
  asElementId,
  builtinFormTemplate,
  builtinRegistryBuilder,
  drawFormTable,
  drawScheduleV2,
  formatScheduleCell,
  formTable,
  freezeElements,
  isCutSheetColumn,
  isUnsafeUriScheme,
  parseScheduleCellLink,
  resolveScheduleHref,
  sanitizeScheduleHref,
  scheduleV2Paper,
  type BimElement,
  type FieldProvider,
  type FormScheduleDefinition,
  type PartTypeDefinition,
  type Primitive,
  type Registry,
  type ScheduleDefinitionV2,
} from "../src";
import { loadType, referenceBuilding } from "./fixtures/electrical-building";

const LONG_URL =
  "https://manufacturer.example.org/products/commercial/water-heaters/2026/submittals/model-g100-200-commercial-cut-sheet-rev-4.pdf?download=1&utm_source=spec";

describe("schedule cell link parsing, sanitization, and host-neutral resolution", () => {
  it("formats raw http/https URLs into a short Cut Sheet label while keeping the full sanitized href", () => {
    expect(parseScheduleCellLink(LONG_URL)).toEqual({
      label: "Cut Sheet",
      href: LONG_URL,
      kind: "url",
    });
    expect(parseScheduleCellLink("  http://specs.example.com/pump-1.pdf  ")).toEqual({
      label: "Cut Sheet",
      href: "http://specs.example.com/pump-1.pdf",
      kind: "url",
    });
  });

  it("supports markdown [Label](https://...) and legacy Label|https://... syntax with clean WinAnsi labels", () => {
    expect(parseScheduleCellLink("[Cut Sheet](https://example.com/wh-1.pdf)")).toEqual({
      label: "Cut Sheet",
      href: "https://example.com/wh-1.pdf",
      kind: "url",
    });
    expect(parseScheduleCellLink("[Rheem G100 Spec](https://example.com/specs/g100_(rev2).pdf)")).toEqual({
      label: "Rheem G100 Spec",
      href: "https://example.com/specs/g100_(rev2).pdf",
      kind: "url",
    });
    expect(parseScheduleCellLink(`[${LONG_URL}](${LONG_URL})`)).toEqual({
      label: "Cut Sheet",
      href: LONG_URL,
      kind: "url",
    });
    expect(parseScheduleCellLink("2GTL4 PDF|https://example.com/2gtl4.pdf")).toEqual({
      label: "2GTL4 PDF",
      href: "https://example.com/2gtl4.pdf",
      kind: "url",
    });
  });

  it("recognizes logical document refs and explicit cut-sheet columns and resolves them via resolveDocumentUrl", () => {
    expect(isCutSheetColumn("cut_sheet")).toBe(true);
    expect(isCutSheetColumn("cut_sheet_url")).toBe(true);
    expect(isCutSheetColumn("vendor.cut_sheet")).toBe(true);
    expect(isCutSheetColumn("mark", "CUT SHEET")).toBe(true);
    expect(isCutSheetColumn("mark", "MARK")).toBe(false);

    // Without a resolver, safe logical refs stay deferred on `href` for print-time resolution.
    expect(parseScheduleCellLink("doc:wh-101")).toEqual({
      label: "Cut Sheet",
      href: "doc:wh-101",
      kind: "ref",
    });
    expect(parseScheduleCellLink("[WH-1 Spec](doc:wh-101)")).toEqual({
      label: "WH-1 Spec",
      href: "doc:wh-101",
      kind: "ref",
    });
    expect(parseScheduleCellLink("cut-sheets/rheem-g100.pdf", { columnKey: "vendor.cut_sheet" })).toEqual({
      label: "Cut Sheet",
      href: "cut-sheets/rheem-g100.pdf",
      kind: "ref",
    });

    // Placeholders and path traversals in cut-sheet columns stay plain text / rejected.
    for (const plain of ["N/A", "TBD", "NONE", "-", "See Spec", "1/2\"", "../secret.pdf"]) {
      expect(parseScheduleCellLink(plain, { columnKey: "cut_sheet" })).toBeNull();
    }

    // With a host-neutral resolver, logical refs and relative slugs resolve to public https URLs.
    const resolve = (ref: string) =>
      ref.startsWith("doc:")
        ? `https://downloads.example.test/docs/${ref.slice(4)}.pdf`
        : `https://downloads.example.test/public/${ref.replace(/^\/+/, "")}`;

    expect(parseScheduleCellLink("doc:wh-101", { resolveDocumentUrl: resolve })).toEqual({
      label: "Cut Sheet",
      href: "https://downloads.example.test/docs/wh-101.pdf",
      kind: "url",
    });
    expect(parseScheduleCellLink("[Pump Spec](cut-sheets/p1.pdf)", { resolveDocumentUrl: resolve })).toEqual({
      label: "Pump Spec",
      href: "https://downloads.example.test/public/cut-sheets/p1.pdf",
      kind: "url",
    });
    expect(parseScheduleCellLink("rheem-g100", { columnKey: "cut_sheet_url", resolveDocumentUrl: resolve })).toEqual({
      label: "Cut Sheet",
      href: "https://downloads.example.test/public/rheem-g100",
      kind: "url",
    });
  });

  it("strictly strips and rejects unsafe schemes (javascript:, data:, file:, vbscript:) without calling the resolver", () => {
    const resolver = jest.fn(() => "https://downloads.example.test/should-not-be-called.pdf");
    const unsafeBare = [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "blob:https://example.com/123",
    ];
    for (const raw of unsafeBare) {
      expect(isUnsafeUriScheme(raw)).toBe(true);
      expect(sanitizeScheduleHref(raw)).toBeNull();
      expect(parseScheduleCellLink(raw, { columnKey: "cut_sheet", resolveDocumentUrl: resolver })).toBeNull();
      expect(resolveScheduleHref(raw, resolver)).toBeNull();
      expect(formatScheduleCell(raw, { columnKey: "cut_sheet", resolveDocumentUrl: resolver })).toEqual({ text: "" });
    }

    expect(formatScheduleCell("[Click](javascript:alert(1))", { resolveDocumentUrl: resolver })).toEqual({ text: "Click" });
    expect(formatScheduleCell("[Spec](data:text/html,<h1>hello world</h1>)", { resolveDocumentUrl: resolver })).toEqual({ text: "Spec" });
    expect(formatScheduleCell("[Local](file:///etc/passwd)", { resolveDocumentUrl: resolver })).toEqual({ text: "Local" });
    expect(formatScheduleCell("Spec|javascript:alert(1)", { resolveDocumentUrl: resolver })).toEqual({ text: "Spec" });
    expect(resolver).not.toHaveBeenCalled();

    // Even if a buggy host resolver returns an unsafe URI, resolveScheduleHref rejects it.
    expect(resolveScheduleHref("doc:bad", () => "javascript:alert(1)")).toBeNull();
    expect(resolveScheduleHref("doc:bad", () => "file:///etc/passwd")).toBeNull();
    expect(resolveScheduleHref("doc:bad", () => "data:text/html,hi")).toBeNull();

    // Ordinary engineering notes containing colons remain untouched.
    expect(formatScheduleCell("NOTE: VERIFY IN FIELD")).toEqual({ text: "NOTE: VERIFY IN FIELD" });
    expect(formatScheduleCell("MODEL: RHEEM G100")).toEqual({ text: "MODEL: RHEEM G100" });
  });
});

describe("scheduleV2 list schedules propagate compact labels and clickable hrefs", () => {
  function partValue(el: BimElement, name: string): string | null {
    if (el.kind !== "part") return null;
    const v = el.values[name];
    return typeof v === "string" ? v : null;
  }

  function makeRegistry(): Registry {
    const provider: FieldProvider = {
      id: "test-links",
      fields: [
        { path: "mark", label: "MARK", classes: ["mep.equipment"], valueType: "text", writer: { kind: "none", reason: "test" }, read: (el) => (el.kind === "part" ? el.mark : null) },
        { path: "cut_sheet", label: "CUT SHEET", classes: ["mep.equipment"], valueType: "text", writer: { kind: "none", reason: "test" }, read: (el) => partValue(el, "cut_sheet") },
        { path: "vendor.cut_sheet", label: "VENDOR SUBMITTAL", classes: ["mep.equipment"], valueType: "text", writer: { kind: "none", reason: "test" }, read: (el) => partValue(el, "vendor_cut_sheet") },
      ],
    };
    return builtinRegistryBuilder().addProvider(provider).build();
  }

  function makeModel() {
    const partType: BimElement = {
      id: asElementId("t-eq"),
      version: 1,
      authoredRev: {},
      kind: "part_type",
      definition: {
        familyName: "Equipment",
        typeName: "Unit",
        category: "mechanical_equipment",
        typeParams: [],
        typeValues: {},
        instanceParams: [
          { name: "cut_sheet", label: "Cut sheet", kind: "text" },
          { name: "vendor_cut_sheet", label: "Vendor cut sheet", kind: "text" },
        ],
        connectors: [],
        geometry: [],
        symbol: [],
        tagFields: [],
        source: { kind: "builtin", libraryVersion: "1" },
      } as PartTypeDefinition,
    } as BimElement;
    const eq = (id: string, mark: string, values: Record<string, string>): BimElement =>
      ({
        id: asElementId(id),
        version: 1,
        authoredRev: {},
        kind: "part",
        typeId: asElementId("t-eq"),
        levelId: asElementId("lvl-1"),
        position: { x: 0, y: 0 },
        offsetMm: 0,
        rotationDeg: 0,
        mark,
        values,
      }) as BimElement;
    const elements = freezeElements({
      "lvl-1": { id: asElementId("lvl-1"), version: 1, authoredRev: {}, kind: "level", name: "Level 1", elevationMm: 0 } as BimElement,
      "t-eq": partType,
      "eq-1": eq("eq-1", "WH-1", { cut_sheet: LONG_URL, vendor_cut_sheet: "cut-sheets/wh-1.pdf" }),
      "eq-2": eq("eq-2", "WH-2", { cut_sheet: "[Rheem Spec](https://specs.example.org/wh-2.pdf)", vendor_cut_sheet: "doc:wh-2" }),
      "eq-3": eq("eq-3", "WH-3", { cut_sheet: "javascript:alert(1)", vendor_cut_sheet: "[Evil](file:///etc/passwd)" }),
    });
    return { elements, connections: [] };
  }

  const DEF: ScheduleDefinitionV2 = {
    name: "Equipment submittals",
    source: { kind: "classes", classes: ["mep.equipment"], includeSubclasses: true },
    columns: [
      { id: "mark", kind: "field", path: "mark" },
      { id: "cs", kind: "field", path: "cut_sheet" },
      { id: "vcs", kind: "field", path: "vendor.cut_sheet" },
    ],
    filters: [],
    sort: [{ path: "mark", direction: "asc" }],
    groups: [],
    grandTotals: false,
    itemize: true,
    presentation: { kind: "list" },
    display: { textSizeMm: 2.5, emptyText: "NONE" },
  };

  it("keeps the column narrow for long URLs, emits hrefs, and resolves logical refs via resolveDocumentUrl", () => {
    const registry = makeRegistry();
    const model = makeModel();
    const resolve = (ref: string) =>
      ref.startsWith("doc:")
        ? `https://cdn.example.org/doc/${ref.slice(4)}.pdf`
        : `https://cdn.example.org/${ref}`;

    const paper = scheduleV2Paper(model, DEF, { viewId: "v-eq", revision: 1, registry }, { resolveDocumentUrl: resolve });
    expect(paper.kind).toBe("list");
    if (paper.kind !== "list") return;

    // Column width is sized to compact labels ("Cut Sheet" / "Rheem Spec"), never 120mm for the 140-char raw URL.
    expect(paper.table.columnWidths[1]).toBeLessThan(40);

    const prims: Primitive[] = [];
    drawScheduleV2(prims, paper, { x: 10, y: 20 });
    const texts = prims.filter((p): p is Extract<Primitive, { kind: "text" }> => p.kind === "text");
    const links = texts.filter((t) => t.href !== undefined).map((t) => ({ text: t.text, href: t.href }));

    expect(links).toEqual([
      { text: "Cut Sheet", href: LONG_URL },
      { text: "Cut Sheet", href: "https://cdn.example.org/cut-sheets/wh-1.pdf" },
      { text: "Rheem Spec", href: "https://specs.example.org/wh-2.pdf" },
      { text: "Cut Sheet", href: "https://cdn.example.org/doc/wh-2.pdf" },
    ]);

    // Unsafe cells produce neither hrefs nor raw dangerous scheme text.
    expect(texts.some((t) => /javascript:|file:|data:/i.test(t.text) || /javascript:|file:|data:/i.test(t.href ?? ""))).toBe(false);
    // Label from `[Evil](file:///etc/passwd)` stays plain text without an href.
    const evilLabel = texts.find((t) => t.text === "Evil");
    expect(evilLabel).toBeDefined();
    expect(evilLabel?.href).toBeUndefined();
  });
});

describe("formSchedule layouts propagate compact labels and clickable hrefs", () => {
  it("sizes columns to compact labels and emits hrefs on equipment_connections form rows", () => {
    const b = referenceBuilding();
    const baseType = loadType("Unit with cut sheet", "mechanical_equipment", 3);
    const eqType: PartTypeDefinition = {
      ...baseType,
      instanceParams: [...baseType.instanceParams, { name: "cut_sheet", label: "Cut sheet", kind: "text" }],
    };
    b.ok({ type: "place_part", partId: "eq-url", typeId: "type-eq-cs", partType: eqType, levelId: "lvl-1", position: { x: 1000, y: 1000 }, mark: "EQ-1", values: { voltage: 480, load_va: 1000, cut_sheet: LONG_URL } });
    b.ok({ type: "place_part", partId: "eq-doc", typeId: "type-eq-cs", levelId: "lvl-1", position: { x: 2000, y: 1000 }, mark: "EQ-2", values: { voltage: 480, load_va: 1000, cut_sheet: "[WH-1 Spec](doc:wh-1)" } });
    b.ok({ type: "place_part", partId: "eq-bad", typeId: "type-eq-cs", levelId: "lvl-1", position: { x: 3000, y: 1000 }, mark: "EQ-3", values: { voltage: 480, load_va: 1000, cut_sheet: "javascript:alert(1)" } });

    const base = builtinFormTemplate("equipment_connections");
    const def: FormScheduleDefinition = {
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

    const resolve = (ref: string) => (ref.startsWith("doc:") ? `https://cdn.example.org/cut-sheets/${ref.slice(4)}.pdf` : null);
    const ft = formTable(b.head, def, { resolveDocumentUrl: resolve });

    // The CUT SHEET column must stay compact (< 35mm), not balloon to MAX_COL_MM (70mm) from the 140-char raw URL.
    const cutSheetColIdx = ft.form.grid.headings.indexOf("CUT SHEET");
    expect(cutSheetColIdx).toBeGreaterThan(-1);
    expect(ft.gridWidths[cutSheetColIdx]).toBeLessThan(35);

    const prims: Primitive[] = [];
    drawFormTable(prims, ft, { x: 20, y: 30 });
    const texts = prims.filter((p): p is Extract<Primitive, { kind: "text" }> => p.kind === "text");
    const links = texts.filter((t) => t.href !== undefined).map((t) => ({ text: t.text, href: t.href }));

    expect(links).toEqual(
      expect.arrayContaining([
        { text: "Cut Sheet", href: LONG_URL },
        { text: "WH-1 Spec", href: "https://cdn.example.org/cut-sheets/wh-1.pdf" },
      ]),
    );
    expect(texts.some((t) => /javascript:/i.test(t.text) || /javascript:/i.test(t.href ?? ""))).toBe(false);
  });
});
