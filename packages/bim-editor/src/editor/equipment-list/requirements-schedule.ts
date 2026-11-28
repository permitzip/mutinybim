import { necEdition, type NecEdition } from '@permitzip/bim-calc'
import { loadFromText, numberIn, suggestLoadClass, type LoadClass } from '@permitzip/bim-pack-electrical'
import type { EquipmentRequirementBaseline, ParamDef, ParamValue } from '@permitzip/bim-kernel'

/**
 * Generalized Multi-Discipline Owner / Equipment Requirements Schedule model &
 * parser supporting any building type (commercial kitchens, manufacturing,
 * industrial, labs, assembly/AV, offices, healthcare, general).
 *
 * Covers five disciplines in one open schema:
 *   - Structural:             operatingWeightLb / weight
 *   - Electrical:             voltage, phase, load, fla, mca, mocp, connection
 *   - Fuel gas:               gasMbh, gasPressureInWc, fuel
 *   - Plumbing:               coldWater, hotWater, waste, greaseWaste,
 *                             indirectWaste, condensate, vent
 *   - Mechanical/EnergyPlus:  exhaustCfm, makeupCfm, sensibleHeatBtuh,
 *                             latentHeatBtuh, combustionFlue
 */

export const KNOWN_BUILDING_TYPES = [
  'commercial_kitchen',
  'manufacturing',
  'industrial',
  'laboratory',
  'assembly_av',
  'office',
  'healthcare',
  'general',
] as const

export type BuildingType = (typeof KNOWN_BUILDING_TYPES)[number] | (string & {})

export const EQUIPMENT_DISCIPLINES = ['identity', 'structural', 'electrical', 'fuel_gas', 'plumbing', 'mechanical'] as const
export type EquipmentDiscipline = (typeof EQUIPMENT_DISCIPLINES)[number]

/** Canonical multi-discipline equipment requirement row (raw text as authored/imported). */
export interface MultiDisciplineEquipmentRow {
  readonly key: string
  readonly mark: string
  readonly description: string
  readonly quantity: string
  readonly buildingType?: BuildingType
  readonly location?: string
  readonly manufacturer?: string
  readonly modelNumber?: string
  // Structural
  readonly operatingWeightLb: string
  // Electrical
  readonly voltage: string
  readonly phase: string
  readonly load: string
  readonly fla: string
  readonly mca: string
  readonly mocp: string
  readonly connection: string
  // Fuel gas
  readonly gasMbh: string
  readonly gasPressureInWc: string
  readonly fuel: string
  // Plumbing
  readonly coldWater: string
  readonly hotWater: string
  readonly waste: string
  readonly greaseWaste: string
  readonly indirectWaste: string
  readonly condensate: string
  readonly vent: string
  // Mechanical / EnergyPlus (#190 aligned)
  readonly exhaustCfm: string
  readonly makeupCfm: string
  readonly sensibleHeatBtuh: string
  readonly latentHeatBtuh: string
  readonly combustionFlue: string
  /** Open extension bag for firm/project custom columns. */
  readonly extras?: Readonly<Record<string, string>>
}

export type MultiDisciplineField = Exclude<keyof MultiDisciplineEquipmentRow, 'key' | 'buildingType' | 'extras'>

export interface MultiDisciplineFieldMeta {
  readonly field: MultiDisciplineField
  readonly label: string
  readonly discipline: EquipmentDiscipline
  /** Target part instance parameter name (null when stored on part metadata like `mark` or `quantity`). */
  readonly paramName: string | null
  readonly unit?: string
  readonly numeric?: boolean
}

export const MULTI_DISCIPLINE_FIELD_META: readonly MultiDisciplineFieldMeta[] = [
  // Identity
  { field: 'mark', label: 'Mark', discipline: 'identity', paramName: null },
  { field: 'description', label: 'Description', discipline: 'identity', paramName: 'description' },
  { field: 'quantity', label: 'Qty', discipline: 'identity', paramName: null, numeric: true },
  { field: 'location', label: 'Location', discipline: 'identity', paramName: 'location' },
  { field: 'manufacturer', label: 'Manufacturer', discipline: 'identity', paramName: 'manufacturer' },
  { field: 'modelNumber', label: 'Model', discipline: 'identity', paramName: 'model' },
  // Structural
  { field: 'operatingWeightLb', label: 'Weight (lb)', discipline: 'structural', paramName: 'weight', unit: 'lb', numeric: true },
  // Electrical
  { field: 'voltage', label: 'Volts', discipline: 'electrical', paramName: 'voltage', unit: 'V', numeric: true },
  { field: 'phase', label: 'Phase', discipline: 'electrical', paramName: 'phases', numeric: true },
  { field: 'load', label: 'Load', discipline: 'electrical', paramName: 'load_va', unit: 'VA' },
  { field: 'fla', label: 'FLA (A)', discipline: 'electrical', paramName: 'fla', unit: 'A', numeric: true },
  { field: 'mca', label: 'MCA (A)', discipline: 'electrical', paramName: 'mca', unit: 'A', numeric: true },
  { field: 'mocp', label: 'MOCP (A)', discipline: 'electrical', paramName: 'mocp', unit: 'A', numeric: true },
  { field: 'connection', label: 'Connection', discipline: 'electrical', paramName: 'connection' },
  // Fuel gas
  { field: 'gasMbh', label: 'Gas (MBH)', discipline: 'fuel_gas', paramName: 'input_mbh', unit: 'MBH', numeric: true },
  { field: 'gasPressureInWc', label: 'Gas Press. (in. w.c.)', discipline: 'fuel_gas', paramName: 'gas_pressure_inwc', unit: 'in. w.c.', numeric: true },
  { field: 'fuel', label: 'Fuel', discipline: 'fuel_gas', paramName: 'fuel' },
  // Plumbing
  { field: 'coldWater', label: 'CW', discipline: 'plumbing', paramName: 'cw_size' },
  { field: 'hotWater', label: 'HW', discipline: 'plumbing', paramName: 'hw_size' },
  { field: 'waste', label: 'Waste', discipline: 'plumbing', paramName: 'waste_size' },
  { field: 'greaseWaste', label: 'Grease Waste', discipline: 'plumbing', paramName: 'grease_waste_size' },
  { field: 'indirectWaste', label: 'Indirect Waste', discipline: 'plumbing', paramName: 'indirect_waste_size' },
  { field: 'condensate', label: 'Condensate', discipline: 'plumbing', paramName: 'condensate_size' },
  { field: 'vent', label: 'Vent', discipline: 'plumbing', paramName: 'vent_size' },
  // Mechanical / EnergyPlus (#190 aligned)
  { field: 'exhaustCfm', label: 'Exhaust (CFM)', discipline: 'mechanical', paramName: 'exhaust_cfm', unit: 'CFM', numeric: true },
  { field: 'makeupCfm', label: 'Makeup (CFM)', discipline: 'mechanical', paramName: 'makeup_cfm', unit: 'CFM', numeric: true },
  { field: 'sensibleHeatBtuh', label: 'Sensible (Btu/h)', discipline: 'mechanical', paramName: 'sensible_heat_btuh', unit: 'Btu/h', numeric: true },
  { field: 'latentHeatBtuh', label: 'Latent (Btu/h)', discipline: 'mechanical', paramName: 'latent_heat_btuh', unit: 'Btu/h', numeric: true },
  { field: 'combustionFlue', label: 'Combustion Flue', discipline: 'mechanical', paramName: 'combustion_flue' },
]

/** Typed kernel `ParamDef` declarations for the extended multi-discipline equipment parameters. */
export const MULTI_DISCIPLINE_EXTRA_PARAM_DEFS: readonly ParamDef[] = [
  { name: 'location', label: 'Location', kind: 'text' },
  { name: 'manufacturer', label: 'Manufacturer', kind: 'text' },
  { name: 'model', label: 'Model', kind: 'text' },
  // Structural
  { name: 'weight', label: 'Operating weight', kind: 'number', unit: 'lb', min: 0 },
  // Electrical
  { name: 'fla', label: 'Full load amps (FLA)', kind: 'number', unit: 'a', min: 0 },
  { name: 'mca', label: 'Minimum circuit ampacity (MCA)', kind: 'number', unit: 'a', min: 0 },
  { name: 'mocp', label: 'Maximum overcurrent protection (MOCP)', kind: 'number', unit: 'a', min: 0 },
  // Fuel gas
  { name: 'gas_pressure_inwc', label: 'Gas inlet pressure', kind: 'number', unit: 'in_wc', min: 0 },
  { name: 'fuel', label: 'Fuel type', kind: 'text' },
  // Plumbing
  { name: 'grease_waste_size', label: 'Grease waste', kind: 'text' },
  { name: 'indirect_waste_size', label: 'Indirect waste', kind: 'text' },
  { name: 'condensate_size', label: 'Condensate', kind: 'text' },
  { name: 'vent_size', label: 'Vent', kind: 'text' },
  // Mechanical / EnergyPlus (#190 aligned)
  { name: 'exhaust_cfm', label: 'Exhaust airflow', kind: 'number', unit: 'cfm', min: 0 },
  { name: 'makeup_cfm', label: 'Makeup airflow', kind: 'number', unit: 'cfm', min: 0 },
  { name: 'sensible_heat_btuh', label: 'Sensible heat gain', kind: 'number', unit: 'btuh', min: 0 },
  { name: 'latent_heat_btuh', label: 'Latent heat gain', kind: 'number', unit: 'btuh', min: 0 },
  { name: 'combustion_flue', label: 'Combustion flue', kind: 'text' },
]

/** Parsed numeric/normalized values for a multi-discipline equipment row. */
export interface NormalizedEquipmentValues {
  readonly quantity: number
  readonly operatingWeightLb: number | null
  readonly voltageV: number | null
  readonly phases: 1 | 3 | null
  readonly loadVa: number | null
  readonly loadVaBasis: string
  readonly loadClass: LoadClass
  readonly fla: number | null
  readonly mca: number | null
  readonly mocp: number | null
  readonly gasMbh: number | null
  readonly gasPressureInWc: number | null
  readonly exhaustCfm: number | null
  readonly makeupCfm: number | null
  readonly sensibleHeatBtuh: number | null
  readonly latentHeatBtuh: number | null
  readonly problems: readonly string[]
  readonly paramValues: Readonly<Record<string, ParamValue>>
  readonly requiredServices: readonly string[]
  readonly requiredLoadServices: readonly string[]
  readonly loadKeys: readonly string[]
}

export interface ParsedEquipmentRequirements {
  readonly buildingType: BuildingType
  readonly headers: readonly string[]
  readonly mappedFields: Readonly<Record<number, MultiDisciplineField>>
  readonly unmappedHeaders: readonly { readonly index: number; readonly heading: string }[]
  readonly rows: readonly MultiDisciplineEquipmentRow[]
  readonly normalized: readonly NormalizedEquipmentValues[]
  readonly baselines: readonly EquipmentRequirementBaseline[]
}

export interface ParseEquipmentRequirementsOptions {
  readonly nec?: NecEdition | null
  readonly buildingType?: BuildingType
}

// ── Header matching across all 5 disciplines ───────────────────────────────

interface HeaderRule {
  readonly field: MultiDisciplineField
  readonly patterns: readonly RegExp[]
  /** Optional unit multiplier hint encoded in the header itself (e.g. "Gas (BTU/h)" vs "Gas (MBH)"). */
  readonly headerUnit?: 'kw' | 'va' | 'kva' | 'w' | 'a' | 'hp' | 'btuh' | 'mbh' | 'kg' | 'lb' | 'psi' | 'in_wc' | 'ls' | 'cfm'
}

const HEADER_RULES: readonly HeaderRule[] = [
  // Identity
  { field: 'mark', patterns: [/^(tag|item|mark|no\.?|#|item\s*no\.?|equip(?:ment)?\s*(?:id|tag|mark|no\.?)|symbol|designator|k-?tag)$/i] },
  { field: 'description', patterns: [/^(description|equipment|name|item\s*description|desc\.?|equipment\s*description|equipment\s*name|service\s*description)$/i] },
  { field: 'quantity', patterns: [/^(qty|quantity|count|no\.?\s*req'?d|units?)$/i] },
  { field: 'location', patterns: [/^(location|room|space|area|zone|room\s*no\.?|served\s*space)$/i] },
  { field: 'manufacturer', patterns: [/^(manufacturer|mfr\.?|mfg\.?|make|vendor|basis\s*of\s*design)$/i] },
  { field: 'modelNumber', patterns: [/^(model|model\s*no\.?|model\s*#|catalog(?:\s*no\.?)?|part\s*no\.?)$/i] },

  // Structural
  { field: 'operatingWeightLb', headerUnit: 'kg', patterns: [/^(?:operating\s*)?weight\s*\(?kg\)?$/i, /^mass\s*\(?kg\)?$/i] },
  { field: 'operatingWeightLb', headerUnit: 'lb', patterns: [/^(operating\s*weight|weight|op\.?\s*wt\.?|wt\.?|operating\s*wt\.?|weight\s*\(?lbs?\)?|operating\s*weight\s*\(?lbs?\)?|operatingweightlb)$/i] },

  // Electrical
  { field: 'voltage', patterns: [/^(volts?|voltage|v|rated\s*volts?)$/i] },
  { field: 'phase', patterns: [/^(ph|phase|phases|ø|φ)$/i] },
  { field: 'fla', headerUnit: 'a', patterns: [/^(fla|full\s*load\s*amps?|fla\s*\(?a\)?|rla)$/i] },
  { field: 'mca', headerUnit: 'a', patterns: [/^(mca|min\.?\s*circuit\s*ampacity|mca\s*\(?a\)?)$/i] },
  { field: 'mocp', headerUnit: 'a', patterns: [/^(mocp|mop|max\.?\s*overcurrent(?:\s*protection)?|max\.?\s*fuse|mocp\s*\(?a\)?|ocpd)$/i] },
  { field: 'load', headerUnit: 'kw', patterns: [/^(kw|load\s*\(?kw\)?|power\s*\(?kw\)?|connected\s*kw)$/i] },
  { field: 'load', headerUnit: 'kva', patterns: [/^(kva|load\s*\(?kva\)?)$/i] },
  { field: 'load', headerUnit: 'va', patterns: [/^(va|load\s*\(?va\)?|load|elec\.?\s*load|connected\s*load|power)$/i] },
  { field: 'load', headerUnit: 'w', patterns: [/^(w|watts?|load\s*\(?w\)?|power\s*\(?w\)?)$/i] },
  { field: 'load', headerUnit: 'hp', patterns: [/^(hp|horsepower|motor\s*hp)$/i] },
  { field: 'load', headerUnit: 'a', patterns: [/^(amps?|current|a)$/i] },
  { field: 'connection', patterns: [/^(conn\.?|connection|connection\s*type|elec\.?\s*conn\.?|type\s*of\s*connection|ct|nema|plug)$/i] },

  // Fuel gas
  { field: 'gasPressureInWc', headerUnit: 'psi', patterns: [/^(?:gas\s*)?(?:inlet\s*)?press(?:ure)?\s*\(?psi(?:g)?\)?$/i] },
  { field: 'gasPressureInWc', headerUnit: 'in_wc', patterns: [/^(gas\s*pressure|gas\s*press\.?|inlet\s*pressure|gas\s*pressure\s*\(?in\.?\s*w\.?c\.?\)?|gaspressureinwc|w\.?c\.?|supply\s*pressure)$/i] },
  { field: 'fuel', patterns: [/^(fuel|fuel\s*type|gas\s*type|nat\.?\s*\/?\s*lp)$/i] },
  { field: 'gasMbh', headerUnit: 'btuh', patterns: [/^(btu|btuh|btu\/h|btu\/hr|gas\s*\(?btuh?\)?|gas\s*btuh)$/i] },
  { field: 'gasMbh', headerUnit: 'mbh', patterns: [/^(mbh|gas|gas\s*mbh|gas\s*\(?mbh\)?|gas\s*input|input\s*\(?mbh\)?|mbtuh|kbtuh|gasmbh)$/i] },

  // Plumbing
  { field: 'coldWater', patterns: [/^(cw|dcw|cold|cold\s*water|cw\s*conn\.?|coldwater|cw\s*size)$/i] },
  { field: 'hotWater', patterns: [/^(hw|dhw|hot|hot\s*water|hw\s*conn\.?|hotwater|hw\s*size)$/i] },
  { field: 'greaseWaste', patterns: [/^(gw|grease|grease\s*waste|grease\s*drain|greasewaste|gw\s*size)$/i] },
  { field: 'indirectWaste', patterns: [/^(iw|ind\.?\s*waste|indirect\s*waste|indirect|indirectwaste|floor\s*sink|air\s*gap)$/i] },
  { field: 'condensate', patterns: [/^(cd|cond\.?|condensate|condensate\s*drain|cond\.?\s*drain|condensate\s*size)$/i] },
  { field: 'vent', patterns: [/^(vent|vtr|vent\s*size|plumbing\s*vent|vent\s*conn\.?)$/i] },
  { field: 'waste', patterns: [/^(waste|drain|dw|san\.?|sanitary|sanitary\s*waste|waste\s*size|san\.?\s*drain)$/i] },

  // Mechanical / EnergyPlus (#190 aligned)
  { field: 'exhaustCfm', headerUnit: 'ls', patterns: [/^(?:exhaust|ea)\s*\(?l\/s\)?$/i] },
  { field: 'exhaustCfm', headerUnit: 'cfm', patterns: [/^(exhaust|exhaust\s*cfm|ea|exhaust\s*airflow|exhaust\s*\(?cfm\)?|exhaustcfm|hood\s*exhaust)$/i] },
  { field: 'makeupCfm', headerUnit: 'ls', patterns: [/^(?:make-?up|mua)\s*\(?l\/s\)?$/i] },
  { field: 'makeupCfm', headerUnit: 'cfm', patterns: [/^(make-?up|makeup|mua|make-?up\s*cfm|makeup\s*cfm|make-?up\s*air|makeup\s*\(?cfm\)?|makeupcfm)$/i] },
  { field: 'sensibleHeatBtuh', headerUnit: 'mbh', patterns: [/^(?:sensible|sens\.?)\s*(?:heat)?\s*\(?mbh\)?$/i] },
  { field: 'sensibleHeatBtuh', headerUnit: 'btuh', patterns: [/^(sensible|sens\.?\s*heat|sensible\s*heat|sensible\s*gain|sensible\s*heat\s*\(?btu\/?h?\)?|sensible\s*\(?btu\/?h?\)?|sensibleheatbtuh)$/i] },
  { field: 'latentHeatBtuh', headerUnit: 'mbh', patterns: [/^(?:latent|lat\.?)\s*(?:heat)?\s*\(?mbh\)?$/i] },
  { field: 'latentHeatBtuh', headerUnit: 'btuh', patterns: [/^(latent|lat\.?\s*heat|latent\s*heat|latent\s*gain|latent\s*heat\s*\(?btu\/?h?\)?|latent\s*\(?btu\/?h?\)?|latentheatbtuh)$/i] },
  { field: 'combustionFlue', patterns: [/^(flue|combustion\s*flue|flue\s*size|exhaust\s*flue|combustionflue|stack|type\s*b\s*vent|b-?vent)$/i] },
]

function matchHeader(rawHeading: string): HeaderRule | null {
  const clean = rawHeading.trim().replace(/\s+/g, ' ')
  if (!clean) return null
  for (const rule of HEADER_RULES) {
    if (rule.patterns.some((p) => p.test(clean))) return rule
  }
  const stripped = clean.replace(/[()]/g, '').trim()
  if (stripped !== clean) {
    for (const rule of HEADER_RULES) {
      if (rule.patterns.some((p) => p.test(stripped))) return rule
    }
  }
  return null
}

// ── Delimiter splitting (TSV / CSV / Pipe) ─────────────────────────────────

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (!quoted && cur.trim() === '') {
        // RFC 4180: a quote only starts a quoted field at the beginning of a cell;
        // mid-cell quotes like 2" or 1-1/2" are literal inch marks.
        cur = ''
        quoted = true
      } else if (quoted) {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += '"'
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

function detectDelimiter(lines: readonly string[]): ((line: string) => string[]) | null {
  if (lines.length === 0) return null
  if (lines.some((l) => l.includes('\t'))) return (l) => l.split('\t').map((c) => c.trim())
  if (lines.every((l) => l.includes('|'))) {
    return (l) =>
      l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
  }
  if (lines.every((l) => l.includes(','))) return splitCsvLine
  return null
}

// ── Unit-aware numeric parsing ─────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100
const YES_TOKEN = /^(y|yes|true|req|required|✓|x)$/i
const NO_TOKEN = /^(n|no|false|none|n\/a|-|—)$/i

export function parseWeightLb(raw: string, headerUnit?: HeaderRule['headerUnit']): { readonly value: number | null; readonly problem?: string } {
  const t = raw.trim()
  if (!t || NO_TOKEN.test(t)) return { value: null }
  const n = numberIn(t)
  if (n === null || !Number.isFinite(n) || n < 0) return { value: null, problem: `Weight "${raw}" must be a non-negative number (lb or kg).` }
  if (n === 0) return { value: null }
  if (/\bkg\b/i.test(t) || (headerUnit === 'kg' && !/\blbs?\b/i.test(t))) {
    return { value: round2(n * 2.2046226218) }
  }
  return { value: round2(n) }
}

export function parseCurrentAmps(raw: string, label: string): { readonly value: number | null; readonly problem?: string } {
  const t = raw.trim()
  if (!t || NO_TOKEN.test(t)) return { value: null }
  const n = numberIn(t)
  if (n === null || !Number.isFinite(n) || n < 0) return { value: null, problem: `${label} "${raw}" must be a non-negative current in amps.` }
  if (n === 0) return { value: null }
  return { value: round2(n) }
}

export function parseGasMbh(raw: string, headerUnit?: HeaderRule['headerUnit']): { readonly value: number | null; readonly problem?: string } {
  const t = raw.trim()
  if (!t || NO_TOKEN.test(t)) return { value: null }
  const n = numberIn(t)
  if (n === null || !Number.isFinite(n) || n < 0) return { value: null, problem: `Gas "${raw}" must be a non-negative input in MBH or Btu/h.` }
  if (n === 0) return { value: null }
  if (/\bbtu\/?h?r?\b/i.test(t) && !/\bm?k?btu/i.test(t.replace(/btu/i, ''))) {
    return { value: round2(n / 1000) }
  }
  if (headerUnit === 'btuh' && !/\b(mbh|mbtuh|kbtuh)\b/i.test(t)) {
    return { value: round2(n / 1000) }
  }
  return { value: round2(n) }
}

export function parseGasPressureInWc(raw: string, headerUnit?: HeaderRule['headerUnit']): { readonly value: number | null; readonly problem?: string } {
  const t = raw.trim()
  if (!t || NO_TOKEN.test(t)) return { value: null }
  const n = numberIn(t)
  if (n === null || !Number.isFinite(n) || n < 0) return { value: null, problem: `Gas pressure "${raw}" must be a non-negative number (in. w.c. or psi).` }
  if (n === 0) return { value: null }
  if (/\bpsig?\b/i.test(t) || (headerUnit === 'psi' && !/\bw\.?c\.?\b/i.test(t))) {
    // 1 psi = 27.6799 in. w.c.
    return { value: round2(n * 27.6799) }
  }
  return { value: round2(n) }
}

export function parseAirflowCfm(raw: string, label: string, headerUnit?: HeaderRule['headerUnit']): { readonly value: number | null; readonly problem?: string } {
  const t = raw.trim()
  if (!t || NO_TOKEN.test(t)) return { value: null }
  const n = numberIn(t)
  if (n === null || !Number.isFinite(n) || n < 0) return { value: null, problem: `${label} "${raw}" must be a non-negative airflow (CFM or L/s).` }
  if (n === 0) return { value: null }
  if (/\bl\/s\b/i.test(t) || (headerUnit === 'ls' && !/\bcfm\b/i.test(t))) {
    // 1 L/s = 2.11888 CFM
    return { value: round2(n * 2.11888) }
  }
  return { value: round2(n) }
}

export function parseThermalBtuh(raw: string, label: string, headerUnit?: HeaderRule['headerUnit']): { readonly value: number | null; readonly problem?: string } {
  const t = raw.trim()
  if (!t || NO_TOKEN.test(t)) return { value: null }
  const n = numberIn(t)
  if (n === null || !Number.isFinite(n) || n < 0) return { value: null, problem: `${label} "${raw}" must be a non-negative heat gain (Btu/h, MBH, W, or kW).` }
  if (/\bkw\b/i.test(t)) return { value: round2(n * 3412.142) }
  if (/\b(w|watts?)\b/i.test(t)) return { value: round2(n * 3.412142) }
  if (/\b(mbh|mbtuh|kbtuh)\b/i.test(t) || (headerUnit === 'mbh' && !/\bbtu/i.test(t))) return { value: round2(n * 1000) }
  if (/\btons?\b/i.test(t)) return { value: round2(n * 12000) }
  return { value: round2(n) }
}

function hasTextValue(s: string | undefined): boolean {
  const t = (s ?? '').trim()
  return t !== '' && !NO_TOKEN.test(t)
}

const DEFAULT_NEC = necEdition('2023')

/** Formats a load cell using the header's unit when the cell itself is a bare number. */
function withLoadHeaderUnit(raw: string, headerUnit?: HeaderRule['headerUnit']): string {
  const t = raw.trim()
  if (!t || !headerUnit) return t
  if (/[a-zA-Z]/.test(t)) return t
  switch (headerUnit) {
    case 'kw':
      return `${t} kW`
    case 'kva':
      return `${t} kVA`
    case 'va':
      return `${t} VA`
    case 'w':
      return `${t} W`
    case 'hp':
      return `${t} hp`
    case 'a':
      return `${t} A`
    default:
      return t
  }
}

export function emptyMultiDisciplineRow(key: string, buildingType?: BuildingType): MultiDisciplineEquipmentRow {
  return {
    key,
    mark: '',
    description: '',
    quantity: '1',
    ...(buildingType ? { buildingType } : {}),
    operatingWeightLb: '',
    voltage: '',
    phase: '',
    load: '',
    fla: '',
    mca: '',
    mocp: '',
    connection: '',
    gasMbh: '',
    gasPressureInWc: '',
    fuel: '',
    coldWater: '',
    hotWater: '',
    waste: '',
    greaseWaste: '',
    indirectWaste: '',
    condensate: '',
    vent: '',
    exhaustCfm: '',
    makeupCfm: '',
    sensibleHeatBtuh: '',
    latentHeatBtuh: '',
    combustionFlue: '',
  }
}

/** Validates, normalizes, and derives required systems + load keys for one multi-discipline equipment row. */
export function normalizeMultiDisciplineRow(
  row: MultiDisciplineEquipmentRow,
  nec: NecEdition | null = null,
  headerUnits: Readonly<Partial<Record<MultiDisciplineField, HeaderRule['headerUnit']>>> = {},
): NormalizedEquipmentValues {
  const problems: string[] = []
  const mark = row.mark.trim()
  if (!mark) problems.push('Give the equipment item a mark/tag.')

  const qRaw = row.quantity.trim() === '' ? 1 : Number(row.quantity)
  const quantity = Number.isInteger(qRaw) && qRaw >= 1 && qRaw <= 50 ? qRaw : 1
  if (!Number.isInteger(qRaw) || qRaw < 1) problems.push(`Qty "${row.quantity}" must be a whole number >= 1.`)
  else if (qRaw > 50) problems.push('More than 50 of one item: add as a space load or split the row.')

  // Structural
  const weightRes = parseWeightLb(row.operatingWeightLb, headerUnits.operatingWeightLb)
  if (weightRes.problem) problems.push(weightRes.problem)

  // Electrical
  const vRaw = row.voltage.trim() === '' ? null : numberIn(row.voltage)
  if (row.voltage.trim() !== '' && (vRaw === null || vRaw < 12 || vRaw > 15000)) {
    problems.push(`Volts "${row.voltage}" must be a valid voltage.`)
  }
  const voltageV = vRaw !== null && vRaw >= 12 && vRaw <= 15000 ? vRaw : null

  const pRaw = row.phase.trim() === '' ? null : numberIn(row.phase)
  if (row.phase.trim() !== '' && pRaw !== 1 && pRaw !== 3) {
    problems.push(`Phase "${row.phase}" must be 1 or 3.`)
  }
  const phases: 1 | 3 | null = pRaw === 1 || pRaw === 3 ? pRaw : null

  const flaRes = parseCurrentAmps(row.fla, 'FLA')
  if (flaRes.problem) problems.push(flaRes.problem)
  const mcaRes = parseCurrentAmps(row.mca, 'MCA')
  if (mcaRes.problem) problems.push(mcaRes.problem)
  const mocpRes = parseCurrentAmps(row.mocp, 'MOCP')
  if (mocpRes.problem) problems.push(mocpRes.problem)

  // Compute load VA from explicit load text, or fall back to FLA/MCA with voltage & phase.
  const loadText = row.load.trim()
    ? row.load.trim()
    : flaRes.value !== null && voltageV !== null
      ? `${flaRes.value} A`
      : mcaRes.value !== null && voltageV !== null
        ? `${mcaRes.value} A`
        : ''
  const loadRead =
    nec === null && /\bhp\b/i.test(loadText)
      ? { va: null, vaBasis: '', problem: 'Horsepower needs the NEC edition to read its table current, or give FLA/kW.' }
      : loadFromText(nec ?? DEFAULT_NEC, loadText, voltageV, phases)
  if (loadRead.problem) problems.push(loadRead.problem)

  // Fuel gas
  const gasRes = parseGasMbh(row.gasMbh, headerUnits.gasMbh)
  if (gasRes.problem) problems.push(gasRes.problem)
  const gasPressRes = parseGasPressureInWc(row.gasPressureInWc, headerUnits.gasPressureInWc)
  if (gasPressRes.problem) problems.push(gasPressRes.problem)

  // Mechanical / EnergyPlus
  const exhaustRes = parseAirflowCfm(row.exhaustCfm, 'Exhaust airflow', headerUnits.exhaustCfm)
  if (exhaustRes.problem) problems.push(exhaustRes.problem)
  const makeupRes = parseAirflowCfm(row.makeupCfm, 'Makeup airflow', headerUnits.makeupCfm)
  if (makeupRes.problem) problems.push(makeupRes.problem)
  const sensibleRes = parseThermalBtuh(row.sensibleHeatBtuh, 'Sensible heat', headerUnits.sensibleHeatBtuh)
  if (sensibleRes.problem) problems.push(sensibleRes.problem)
  const latentRes = parseThermalBtuh(row.latentHeatBtuh, 'Latent heat', headerUnits.latentHeatBtuh)
  if (latentRes.problem) problems.push(latentRes.problem)

  const { cls: loadClass } = suggestLoadClass(`${row.description} ${mark}`)

  const paramValues: Record<string, ParamValue> = {}
  if (row.description.trim()) paramValues.description = row.description.trim()
  if (row.location?.trim()) paramValues.location = row.location.trim()
  if (row.manufacturer?.trim()) paramValues.manufacturer = row.manufacturer.trim()
  if (row.modelNumber?.trim()) paramValues.model = row.modelNumber.trim()
  if (weightRes.value !== null) paramValues.weight = weightRes.value
  if (voltageV !== null) paramValues.voltage = voltageV
  if (phases !== null) paramValues.phases = phases
  if (loadRead.va !== null) {
    paramValues.load_va = loadRead.va
    paramValues.load_class = loadClass
  }
  if (flaRes.value !== null) paramValues.fla = flaRes.value
  if (mcaRes.value !== null) paramValues.mca = mcaRes.value
  if (mocpRes.value !== null) paramValues.mocp = mocpRes.value
  if (row.connection.trim()) paramValues.connection = row.connection.trim()
  if (gasRes.value !== null) paramValues.input_mbh = gasRes.value
  if (gasPressRes.value !== null) paramValues.gas_pressure_inwc = gasPressRes.value
  if (hasTextValue(row.fuel)) paramValues.fuel = row.fuel.trim()
  if (hasTextValue(row.coldWater)) paramValues.cw_size = row.coldWater.trim()
  if (hasTextValue(row.hotWater)) paramValues.hw_size = row.hotWater.trim()
  if (hasTextValue(row.waste)) paramValues.waste_size = row.waste.trim()
  if (hasTextValue(row.greaseWaste)) paramValues.grease_waste_size = YES_TOKEN.test(row.greaseWaste.trim()) ? 'Yes' : row.greaseWaste.trim()
  if (hasTextValue(row.indirectWaste)) paramValues.indirect_waste_size = YES_TOKEN.test(row.indirectWaste.trim()) ? 'Yes' : row.indirectWaste.trim()
  if (hasTextValue(row.condensate)) paramValues.condensate_size = YES_TOKEN.test(row.condensate.trim()) ? 'Yes' : row.condensate.trim()
  if (hasTextValue(row.vent)) paramValues.vent_size = YES_TOKEN.test(row.vent.trim()) ? 'Yes' : row.vent.trim()
  if (exhaustRes.value !== null) paramValues.exhaust_cfm = exhaustRes.value
  if (makeupRes.value !== null) paramValues.makeup_cfm = makeupRes.value
  if (sensibleRes.value !== null) paramValues.sensible_heat_btuh = sensibleRes.value
  if (latentRes.value !== null) paramValues.latent_heat_btuh = latentRes.value
  if (hasTextValue(row.combustionFlue)) paramValues.combustion_flue = row.combustionFlue.trim()

  const requiredServices: string[] = []
  const requiredLoadServices: string[] = []
  const loadKeys: string[] = []

  if (loadRead.va !== null || flaRes.value !== null || mcaRes.value !== null) {
    requiredServices.push('electrical')
    requiredLoadServices.push('electrical')
    if (loadRead.va !== null) loadKeys.push('load_va')
  }
  if (gasRes.value !== null || hasTextValue(row.fuel)) {
    requiredServices.push('gas')
    if (gasRes.value !== null) {
      requiredLoadServices.push('gas')
      loadKeys.push('input_mbh')
    }
  }
  if (hasTextValue(row.coldWater)) requiredServices.push('domestic_cold_water')
  if (hasTextValue(row.hotWater)) requiredServices.push('domestic_hot_water')
  if (hasTextValue(row.waste)) requiredServices.push('sanitary')
  if (hasTextValue(row.greaseWaste)) requiredServices.push('grease_waste')
  if (hasTextValue(row.indirectWaste)) requiredServices.push('indirect_waste')
  if (hasTextValue(row.condensate)) requiredServices.push('condensate')
  if (hasTextValue(row.vent)) requiredServices.push('vent')
  if (exhaustRes.value !== null) {
    requiredServices.push('exhaust_air')
    loadKeys.push('exhaust_cfm')
  }
  if (makeupRes.value !== null) {
    requiredServices.push('makeup_air')
    loadKeys.push('makeup_cfm')
  }
  if (hasTextValue(row.combustionFlue)) requiredServices.push('combustion_flue')

  const hasAnyRequirement =
    weightRes.value !== null ||
    loadRead.va !== null ||
    flaRes.value !== null ||
    mcaRes.value !== null ||
    mocpRes.value !== null ||
    gasRes.value !== null ||
    gasPressRes.value !== null ||
    hasTextValue(row.fuel) ||
    hasTextValue(row.coldWater) ||
    hasTextValue(row.hotWater) ||
    hasTextValue(row.waste) ||
    hasTextValue(row.greaseWaste) ||
    hasTextValue(row.indirectWaste) ||
    hasTextValue(row.condensate) ||
    hasTextValue(row.vent) ||
    exhaustRes.value !== null ||
    makeupRes.value !== null ||
    sensibleRes.value !== null ||
    latentRes.value !== null ||
    hasTextValue(row.combustionFlue)

  if (!hasAnyRequirement && problems.length === 0) {
    problems.push('Row has no engineering requirements across structural, electrical, gas, plumbing, or mechanical disciplines.')
  }

  return {
    quantity,
    operatingWeightLb: weightRes.value,
    voltageV,
    phases,
    loadVa: loadRead.va,
    loadVaBasis: loadRead.vaBasis,
    loadClass,
    fla: flaRes.value,
    mca: mcaRes.value,
    mocp: mocpRes.value,
    gasMbh: gasRes.value,
    gasPressureInWc: gasPressRes.value,
    exhaustCfm: exhaustRes.value,
    makeupCfm: makeupRes.value,
    sensibleHeatBtuh: sensibleRes.value,
    latentHeatBtuh: latentRes.value,
    problems,
    paramValues,
    requiredServices,
    requiredLoadServices,
    loadKeys,
  }
}

/** Builds a compact, discipline-neutral `EquipmentRequirementBaseline` suitable for `auditEquipmentRequirements(model)`. */
export function equipmentRequirementBaselineOf(
  row: MultiDisciplineEquipmentRow,
  norm: NormalizedEquipmentValues,
  buildingType?: BuildingType,
): EquipmentRequirementBaseline {
  // Keep numeric & key service-sizing values in the baseline so serialized JSON stays compact (< 400 chars).
  const baselineValues: Record<string, ParamValue> = {}
  const TRACKED_KEYS = [
    'weight',
    'voltage',
    'phases',
    'load_va',
    'fla',
    'mca',
    'mocp',
    'input_mbh',
    'gas_pressure_inwc',
    'fuel',
    'cw_size',
    'hw_size',
    'waste_size',
    'grease_waste_size',
    'indirect_waste_size',
    'condensate_size',
    'vent_size',
    'exhaust_cfm',
    'makeup_cfm',
    'sensible_heat_btuh',
    'latent_heat_btuh',
    'combustion_flue',
  ] as const
  for (const k of TRACKED_KEYS) {
    const v = norm.paramValues[k]
    if (v !== undefined) baselineValues[k] = v
  }
  const bt = buildingType ?? row.buildingType
  return {
    mark: row.mark.trim(),
    ...(bt ? { buildingType: bt } : {}),
    values: baselineValues,
    ...(norm.requiredServices.length > 0 ? { requiredServices: norm.requiredServices } : {}),
    ...(norm.requiredLoadServices.length > 0 ? { requiredLoadServices: norm.requiredLoadServices } : {}),
    ...(norm.loadKeys.length > 0 ? { loadKeys: norm.loadKeys } : {}),
    ...(norm.requiredLoadServices.length > 0 ? { requiresLoad: true } : {}),
  }
}

/**
 * Parses a multi-discipline Owner / Equipment Requirements schedule from CSV,
 * TSV (spreadsheet paste), or pipe-delimited markdown/table text for any
 * building type.
 */
export function parseEquipmentRequirements(
  text: string,
  options: ParseEquipmentRequirementsOptions = {},
): ParsedEquipmentRequirements {
  const buildingType: BuildingType = options.buildingType ?? 'general'
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter((l) => l !== '' && !/^\|?[\s-:|]+\|?$/.test(l))

  const split = detectDelimiter(lines)
  if (!split || lines.length < 2) {
    return { buildingType, headers: [], mappedFields: {}, unmappedHeaders: [], rows: [], normalized: [], baselines: [] }
  }

  // Locate header row (first row with >= 2 matched column headers, defaulting to row 0).
  let headerIdx = 0
  let bestHits = -1
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const cells = split(lines[i] ?? '')
    const hits = cells.filter((c) => matchHeader(c) !== null).length
    if (hits > bestHits) {
      bestHits = hits
      headerIdx = i
    }
    if (hits >= 3) break
  }

  const headers = split(lines[headerIdx] ?? '')
  const mappedFields: Record<number, MultiDisciplineField> = {}
  const headerUnits: Partial<Record<MultiDisciplineField, HeaderRule['headerUnit']>> = {}
  const unmappedHeaders: { index: number; heading: string }[] = []
  const usedFields = new Set<MultiDisciplineField>()

  headers.forEach((heading, index) => {
    const rule = matchHeader(heading)
    if (rule && !usedFields.has(rule.field)) {
      mappedFields[index] = rule.field
      usedFields.add(rule.field)
      if (rule.headerUnit) headerUnits[rule.field] = rule.headerUnit
    } else if (heading.trim()) {
      unmappedHeaders.push({ index, heading: heading.trim() })
    }
  })

  const rows: MultiDisciplineEquipmentRow[] = []
  const normalized: NormalizedEquipmentValues[] = []
  const baselines: EquipmentRequirementBaseline[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = split(lines[i] ?? '')
    if (cells.every((c) => c === '')) continue
    const { extras: _ignoredExtras, ...baseFields } = emptyMultiDisciplineRow(`line-${i + 1}`, buildingType)
    const mutable: Record<string, string | undefined> = { ...baseFields }
    const extras: Record<string, string> = {}

    headers.forEach((heading, idx) => {
      const val = (cells[idx] ?? '').trim()
      if (!val) return
      const field = mappedFields[idx]
      if (field) {
        mutable[field] = field === 'load' ? withLoadHeaderUnit(val, headerUnits.load) : val
      } else if (heading.trim()) {
        extras[heading.trim()] = val
      }
    })

    // Skip totals/summary rows with no mark and no description.
    if (!mutable.mark && !mutable.description) continue
    if (/^(total|subtotal|notes?):?$/i.test((mutable.mark || mutable.description || '').trim())) continue

    const row: MultiDisciplineEquipmentRow = {
      ...(mutable as unknown as MultiDisciplineEquipmentRow),
      key: `line-${i + 1}`,
      buildingType,
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    }
    const norm = normalizeMultiDisciplineRow(row, options.nec ?? null, headerUnits)
    rows.push(row)
    normalized.push(norm)
    baselines.push(equipmentRequirementBaselineOf(row, norm, buildingType))
  }

  return { buildingType, headers, mappedFields, unmappedHeaders, rows, normalized, baselines }
}
