/**
 * Host-neutral parsing, sanitization, and resolution of clickable link cells
 * in schedules (v1 list, v2 list, and form schedules).
 *
 * Keeps `bim-kernel` and `bim-sheets` 100% discipline-neutral and host-agnostic:
 * logical document references (e.g. `doc:<id>` or relative cut-sheet slugs)
 * stay abstract until a host supplies `resolveDocumentUrl` at scene-build or
 * PDF print time. Unsafe URI schemes (`javascript:`, `data:`, `file:`, etc.)
 * are always stripped/rejected.
 */

/**
 * Resolves a logical document reference (e.g. `doc:<id>`, `cut-sheet:<slug>`,
 * or a relative cut-sheet slug) into a permanent public `http://` or `https://`
 * URL. Returning `null` / `undefined` (or a non-http(s) URL) leaves the cell
 * as plain text without a clickable link annotation.
 */
export type DocumentUrlResolver = (ref: string) => string | null | undefined;

export interface ParsedScheduleCellLink {
  /** Clean printable label shown in the schedule cell (never a raw 120-char URL). */
  readonly label: string;
  /** Sanitized `http(s)://` URL, or an unresolved logical document ref for print-time resolution. */
  readonly href: string;
  /** `"url"` when `href` is already a validated `http(s)://` URL; `"ref"` when awaiting host resolution. */
  readonly kind: "url" | "ref";
}

export interface ScheduleCellLinkOptions {
  /** Field path or column id (e.g. `"cut_sheet"`, `"cut_sheet_url"`, `"vendor.cut_sheet"`). */
  readonly columnKey?: string | null;
  /** Printed column heading (e.g. `"CUT SHEET"`). */
  readonly heading?: string | null;
  /** Optional host-provided resolver for logical document references. */
  readonly resolveDocumentUrl?: DocumentUrlResolver;
}

export interface FormattedScheduleCell {
  /** Visible cell text printed in the schedule table. */
  readonly text: string;
  /** Optional sanitized `http(s)://` URL or safe logical document ref carried onto the text primitive. */
  readonly href?: string;
}

const DEFAULT_LINK_LABEL = "Cut Sheet";

const HAS_CONTROL_OR_SPACE = /[\u0000-\u0020\u007F]/;
const STRIP_CONTROL_AND_SPACE = /[\u0000-\u0020\u007F]+/g;

const UNSAFE_URI_SCHEME = /^(?:javascript|data|file|vbscript|blob|about|jar|filesystem|chrome|edge|ms-its|mhtml|livescript|mocha):/i;
const ANY_URI_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const PREFIXED_DOC_REF = /^(?:doc|document|cut-sheet|cut_sheet):[^\s\u0000-\u001F\u007F]+$/i;
const ALLOWED_TARGET_SCHEMES = new Set(["http", "https", "doc", "document", "cut-sheet", "cut_sheet"]);

const CUT_SHEET_KEY = /(?:^|[._/])(?:cut_?sheet(?:_?(?:url|link|ref|pdf))?|spec_?sheet(?:_?(?:url|link))?|submittal_?(?:url|link))$/i;
const CUT_SHEET_HEADING = /^(?:cut[\s_-]?sheet(?:\s*(?:url|link|ref|pdf))?|spec[\s_-]?sheet(?:\s*(?:url|link))?|submittal\s*(?:url|link))$/i;

const PLACEHOLDER_TOKENS = new Set(["n/a", "na", "tbd", "t/b/d", "none", "pending", "yes", "no", "true", "false", "-", "--", "---", "—", "–", "w/o"]);
const DOC_EXTENSION = /^[A-Za-z0-9._/@~-]*[A-Za-z0-9][A-Za-z0-9._/@~-]*\.(?:pdf|png|jpe?g|webp|html?|docx?|xlsx?)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANDIDATE_SLUG = /^[A-Za-z0-9._/@~-]+$/;
const PATH_TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/;

/** True when `raw` starts with a known dangerous URI scheme (even with whitespace/control-char obfuscation). */
export function isUnsafeUriScheme(raw: string): boolean {
  const collapsed = raw.replace(STRIP_CONTROL_AND_SPACE, "");
  return UNSAFE_URI_SCHEME.test(collapsed);
}

/**
 * Validate and normalize an external `http://` or `https://` URL.
 * Returns `null` for empty strings, malformed URLs, control characters,
 * internal whitespace, or any non-http(s) scheme (`javascript:`, `data:`, `file:`, etc.).
 */
export function sanitizeScheduleHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || HAS_CONTROL_OR_SPACE.test(trimmed)) return null;
  if (isUnsafeUriScheme(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return trimmed;
}

/** True when a column key/path or heading identifies a cut-sheet / submittal link column. */
export function isCutSheetColumn(columnKey?: string | null, heading?: string | null): boolean {
  if (columnKey && CUT_SHEET_KEY.test(columnKey.trim())) return true;
  if (heading && CUT_SHEET_HEADING.test(heading.trim())) return true;
  return false;
}

function hasPathTraversal(s: string): boolean {
  return PATH_TRAVERSAL.test(s) || s.includes("\\");
}

function isPrefixedDocumentRef(s: string): boolean {
  return PREFIXED_DOC_REF.test(s) && !hasPathTraversal(s);
}

function hasUnsupportedTargetScheme(target: string): boolean {
  const collapsed = target.replace(STRIP_CONTROL_AND_SPACE, "");
  const m = ANY_URI_SCHEME.exec(collapsed);
  if (!m) return false;
  return !ALLOWED_TARGET_SCHEMES.has((m[1] ?? "").toLowerCase());
}

function isUnambiguousDocumentPath(s: string): boolean {
  if (!s || HAS_CONTROL_OR_SPACE.test(s) || s.startsWith("//") || hasPathTraversal(s)) return false;
  if (ANY_URI_SCHEME.test(s)) return false;
  if (PLACEHOLDER_TOKENS.has(s.toLowerCase())) return false;
  if (DOC_EXTENSION.test(s)) return true;
  if (UUID_RE.test(s)) return true;
  if (s.includes("/") && CANDIDATE_SLUG.test(s)) {
    // Require at least one segment with >= 2 letters so fractions ("1/2") or short abbreviations ("w/o") never match.
    const segments = s.split("/").filter(Boolean);
    return segments.length >= 1 && segments.some((seg) => /[A-Za-z]{2,}/.test(seg));
  }
  return false;
}

function isCandidateRelativeSlug(s: string): boolean {
  if (!s || HAS_CONTROL_OR_SPACE.test(s) || s.startsWith("//") || hasPathTraversal(s)) return false;
  if (isUnsafeUriScheme(s) || hasUnsupportedTargetScheme(s)) return false;
  if (PLACEHOLDER_TOKENS.has(s.toLowerCase())) return false;
  return CANDIDATE_SLUG.test(s) && /[A-Za-z0-9]/.test(s);
}

/**
 * Resolve a raw `href` carried on a text primitive or schedule cell into a
 * validated `http://` or `https://` URL. Direct `http(s)` URLs pass through
 * after strict validation; safe logical document refs are passed to
 * `resolveDocumentUrl` (when provided) and the returned URL is strictly
 * validated to be `http://` or `https://`.
 */
export function resolveScheduleHref(rawRef: string, resolveDocumentUrl?: DocumentUrlResolver): string | null {
  const trimmed = rawRef.trim();
  if (!trimmed || HAS_CONTROL_OR_SPACE.test(trimmed)) return null;
  if (isUnsafeUriScheme(trimmed)) return null;
  const direct = sanitizeScheduleHref(trimmed);
  if (direct) return direct;
  if (!resolveDocumentUrl) return null;
  if (trimmed.startsWith("//") || hasPathTraversal(trimmed) || hasUnsupportedTargetScheme(trimmed)) return null;
  const resolved = resolveDocumentUrl(trimmed);
  if (typeof resolved !== "string") return null;
  return sanitizeScheduleHref(resolved);
}

interface ExplicitLinkParts {
  readonly label: string;
  readonly target: string;
}

/** Match `[Label](target)` markdown links (allowing balanced parens in URLs) or `Label|target` pipe links. */
function splitExplicitLink(trimmed: string): ExplicitLinkParts | null {
  if (trimmed.startsWith("[") && trimmed.endsWith(")")) {
    const mid = trimmed.indexOf("](");
    if (mid > 1) {
      const label = trimmed.slice(1, mid).trim();
      const target = trimmed.slice(mid + 2, -1).trim();
      if (label && target && !label.includes("]") && (!HAS_CONTROL_OR_SPACE.test(target) || isUnsafeUriScheme(target))) {
        return { label, target };
      }
    }
  }
  const bar = trimmed.indexOf("|");
  if (bar > 0) {
    const label = trimmed.slice(0, bar).trim();
    const target = trimmed.slice(bar + 1).trim();
    if (label && target && (!HAS_CONTROL_OR_SPACE.test(target) || isUnsafeUriScheme(target))) {
      return { label, target };
    }
  }
  return null;
}

function cleanLabel(rawLabel: string): string {
  // If the author wrote `[https://very-long-url...](https://...)`, keep the printed cell compact.
  if (sanitizeScheduleHref(rawLabel) || isPrefixedDocumentRef(rawLabel)) return DEFAULT_LINK_LABEL;
  return rawLabel;
}

/**
 * Parse a schedule cell carrying a URL (`https://...`, `[Label](https://...)`,
 * `Label|https://...`) or logical document ref (`doc:<id>`, `cut-sheet:<slug>`,
 * or a relative cut-sheet path/slug in a cut-sheet column) into a clean
 * printable label and sanitized target `href`.
 */
export function parseScheduleCellLink(raw: string, opts?: ScheduleCellLinkOptions): ParsedScheduleCellLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cutSheetCol = isCutSheetColumn(opts?.columnKey, opts?.heading);
  const explicit = splitExplicitLink(trimmed);
  if (explicit) {
    const { target } = explicit;
    if (isUnsafeUriScheme(target) || hasUnsupportedTargetScheme(target)) return null;
    const label = cleanLabel(explicit.label);
    const direct = sanitizeScheduleHref(target);
    if (direct) return { label, href: direct, kind: "url" };
    if (opts?.resolveDocumentUrl) {
      const resolved = resolveScheduleHref(target, opts.resolveDocumentUrl);
      return resolved ? { label, href: resolved, kind: "url" } : null;
    }
    if (isPrefixedDocumentRef(target) || isUnambiguousDocumentPath(target) || (cutSheetCol && isCandidateRelativeSlug(target))) {
      return { label, href: target, kind: "ref" };
    }
    return null;
  }

  if (isUnsafeUriScheme(trimmed)) return null;

  const direct = sanitizeScheduleHref(trimmed);
  if (direct) return { label: DEFAULT_LINK_LABEL, href: direct, kind: "url" };

  if (opts?.resolveDocumentUrl) {
    if (isPrefixedDocumentRef(trimmed) || (cutSheetCol && isCandidateRelativeSlug(trimmed))) {
      const resolved = resolveScheduleHref(trimmed, opts.resolveDocumentUrl);
      if (resolved) return { label: DEFAULT_LINK_LABEL, href: resolved, kind: "url" };
    }
    return null;
  }

  if (isPrefixedDocumentRef(trimmed) || (cutSheetCol && isUnambiguousDocumentPath(trimmed))) {
    return { label: DEFAULT_LINK_LABEL, href: trimmed, kind: "ref" };
  }

  return null;
}

/**
 * Format a schedule cell for layout measurement and paper/PDF drawing:
 * - Valid URLs and logical document refs produce a short clean label + `href`.
 * - Unsafe URI schemes (`javascript:`, `data:`, `file:`, etc.) are strictly
 *   stripped so they never become clickable links or leak raw payloads.
 * - Unresolved explicit links (when a resolver returned `null`) degrade to
 *   their clean label with no `href`.
 */
export function formatScheduleCell(raw: string, opts?: ScheduleCellLinkOptions): FormattedScheduleCell {
  const link = parseScheduleCellLink(raw, opts);
  if (link) return { text: link.label, href: link.href };

  const trimmed = raw.trim();
  if (!trimmed) return { text: raw };

  const explicit = splitExplicitLink(trimmed);
  if (explicit) {
    const { label, target } = explicit;
    if (
      isUnsafeUriScheme(target) ||
      hasUnsupportedTargetScheme(target) ||
      isPrefixedDocumentRef(target) ||
      isUnambiguousDocumentPath(target) ||
      (isCutSheetColumn(opts?.columnKey, opts?.heading) && isCandidateRelativeSlug(target))
    ) {
      return { text: cleanLabel(label) };
    }
  }

  if (isUnsafeUriScheme(trimmed)) return { text: "" };
  if (isPrefixedDocumentRef(trimmed)) return { text: DEFAULT_LINK_LABEL };

  return { text: raw };
}
