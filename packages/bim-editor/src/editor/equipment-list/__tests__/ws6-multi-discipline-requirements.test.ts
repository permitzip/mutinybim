/**
 * @jest-environment node
 *
 * WS-6 (#210): Generalized Multi-Discipline Owner / Equipment Requirements
 * Schedule model, parser, planned part generation, and kernel drift audit
 * across commercial kitchens, laboratories, manufacturing/industrial,
 * assembly/AV, and office building types.
 */
import { necEdition } from '@permitzip/bim-calc'
import {
  DEFAULT_SETTINGS,
  asElementId,
  auditEquipmentRequirements,
  commandSchema,
  executeCommand,
  type BimElement,
  type Command,
  type ModelState,
  type PartInstance,
  type Revision,
} from '@permitzip/bim-kernel'
import {
  checkDraft,
  parseEquipmentRequirements,
  plannedEquipmentBatch,
  readDraft,
} from '../plan-equipment'

const NEC_2023 = necEdition('2023')

function emptyModel(): ModelState {
  const level: BimElement = {
    id: asElementId('L1'),
    version: 1,
    authoredRev: {},
    kind: 'level',
    name: 'Level 1',
    elevationMm: 0,
  } as unknown as BimElement
  return {
    modelId: 'ws6-equip-test',
    revision: 1 as Revision,
    elements: { L1: level },
    connections: [],
    settings: DEFAULT_SETTINGS,
  }
}

function runCmd(model: ModelState, raw: Command): ModelState {
  const parsed = commandSchema.parse(raw)
  const res = executeCommand(model, parsed)
  if (!res.ok) throw new Error(`Command ${raw.type} refused: ${res.error.message}`)
  return res.model
}

describe('WS-6 Pillar 3B: Generalized Multi-Discipline Equipment Requirements Schedule', () => {
  it('parses all 5 engineering disciplines across commercial kitchen, lab, industrial, and AV/office schedules', () => {
    const csv = [
      'Mark,Description,Qty,Operating Weight (lb),Volts,Phase,Load,FLA,MCA,MOCP,Gas (MBH),Gas Pressure (in. w.c.),Fuel,CW,HW,Waste,Grease Waste,Indirect Waste,Condensate,Vent,Exhaust (CFM),Makeup (CFM),Sensible (Btu/h),Latent (Btu/h),Combustion Flue',
      'K-1,Gas Fryer,1,420 lb,120,1,0.5 kW,4.2,5.3,15,90,7 in. w.c.,Natural Gas,,,,2",Yes,,1-1/2",800,640,14500,6200,6" Type B',
      'FH-1,Chemical Fume Hood,1,350 kg,120,1,,8.5,10.6,15,,,,1/2",1/2",2",,,3/4",1-1/2",1100,900,1200,0,',
      'CNC-1,5-Axis CNC Mill,1,8500,480,3,,45,56.3,70,,,,,,,,,,,,,3.5 kW,0,',
      'AV-1,LED Video Wall Rack,1,680,208,1,6 kW,,,,0,,,,,,,,,,0,,20472,0,',
    ].join('\n')

    const parsed = parseEquipmentRequirements(csv, { nec: NEC_2023, buildingType: 'industrial' })
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.normalized.every((n) => n.problems.length === 0)).toBe(true)

    // Row 1: Commercial kitchen gas fryer — all 5 disciplines populated
    const k1 = parsed.normalized[0]!
    expect(k1.operatingWeightLb).toBe(420)
    expect(k1.voltageV).toBe(120)
    expect(k1.phases).toBe(1)
    expect(k1.loadVa).toBe(500)
    expect(k1.fla).toBe(4.2)
    expect(k1.mca).toBe(5.3)
    expect(k1.mocp).toBe(15)
    expect(k1.gasMbh).toBe(90)
    expect(k1.gasPressureInWc).toBe(7)
    expect(k1.paramValues.fuel).toBe('Natural Gas')
    expect(k1.paramValues.grease_waste_size).toBe('2"')
    expect(k1.paramValues.indirect_waste_size).toBe('Yes')
    expect(k1.paramValues.vent_size).toBe('1-1/2"')
    expect(k1.exhaustCfm).toBe(800)
    expect(k1.makeupCfm).toBe(640)
    expect(k1.sensibleHeatBtuh).toBe(14500)
    expect(k1.latentHeatBtuh).toBe(6200)
    expect(k1.paramValues.combustion_flue).toBe('6" Type B')
    expect(k1.requiredServices).toEqual(
      expect.arrayContaining(['electrical', 'gas', 'grease_waste', 'indirect_waste', 'vent', 'exhaust_air', 'makeup_air', 'combustion_flue']),
    )

    // Row 2: Lab fume hood — kg converted to lb, FLA-derived VA, condensate + exhaust/makeup
    const fh1 = parsed.normalized[1]!
    expect(fh1.operatingWeightLb).toBeCloseTo(771.62, 1)
    expect(fh1.loadVa).toBe(1020) // 120V * 8.5A
    expect(fh1.paramValues.condensate_size).toBe('3/4"')
    expect(fh1.exhaustCfm).toBe(1100)
    expect(fh1.makeupCfm).toBe(900)
    expect(fh1.requiredServices).toEqual(
      expect.arrayContaining(['electrical', 'domestic_cold_water', 'domestic_hot_water', 'sanitary', 'condensate', 'vent', 'exhaust_air', 'makeup_air']),
    )

    // Row 3: Industrial 480V 3-phase CNC mill — kW sensible heat converted to Btu/h
    const cnc = parsed.normalized[2]!
    expect(cnc.operatingWeightLb).toBe(8500)
    expect(cnc.voltageV).toBe(480)
    expect(cnc.phases).toBe(3)
    expect(cnc.fla).toBe(45)
    expect(cnc.mca).toBe(56.3)
    expect(cnc.mocp).toBe(70)
    expect(cnc.sensibleHeatBtuh).toBeCloseTo(11942.5, 0) // 3.5 kW * 3412.142

    // Row 4: Assembly/AV rack — structural weight + electrical + EnergyPlus sensible heat, zero plumbing/gas
    const av = parsed.normalized[3]!
    expect(av.operatingWeightLb).toBe(680)
    expect(av.loadVa).toBe(6000)
    expect(av.sensibleHeatBtuh).toBe(20472)
  })

  it('accepts structural-only or mechanical-only rows (non-kitchen buildings) and flows end-to-end into kernel drift audit', () => {
    const tsv = [
      'Mark\tDescription\tQty\tWeight (lb)\tVolts\tPhase\tFLA\tMCA\tMOCP\tExhaust CFM\tSensible Btu/h',
      'FH-101\tLab Exhaust Hood\t1\t650\t120\t1\t10\t12.5\t15\t950\t2400',
      'SAFE-1\tVault Safe (Structural Only)\t1\t3200\t\t\t\t\t\t\t',
    ].join('\n')

    let model = emptyModel()
    const draft = readDraft(NEC_2023, tsv, 'laboratory')
    expect(draft).toHaveLength(2)
    const checks = checkDraft(NEC_2023, model, draft)
    expect(checks[0]!.problems).toEqual([])
    expect(checks[1]!.problems).toEqual([]) // Structural-only row is valid!

    let seq = 0
    const batch = plannedEquipmentBatch(model, draft, checks, (prefix) => `${prefix}-${++seq}`)
    if ('refused' in batch) throw new Error(batch.refused)
    expect(batch.count).toBe(2)

    model = runCmd(model, batch.command)
    const fhPartId = batch.partIds[0]!
    const safePartId = batch.partIds[1]!
    const fhPart = model.elements[fhPartId] as PartInstance
    expect(fhPart.values.weight).toBe(650)
    expect(fhPart.values.exhaust_cfm).toBe(950)
    expect(fhPart.values.sensible_heat_btuh).toBe(2400)
    expect(fhPart.values.mca).toBe(12.5)
    expect(fhPart.values.mocp).toBe(15)

    // Audit right after planning: both items are unplaced, and FH-101 is missing from loads
    const audit1 = auditEquipmentRequirements(model)
    expect(audit1.summary.totalTracked).toBe(2)
    expect(audit1.summary.unplacedCount).toBe(2)
    expect(audit1.findings.some((f) => f.kind === 'unplaced_equipment' && f.mark === 'FH-101')).toBe(true)
    expect(audit1.findings.some((f) => f.kind === 'unplaced_equipment' && f.mark === 'SAFE-1')).toBe(true)
    expect(audit1.findings.some((f) => f.kind === 'missing_from_loads' && f.mark === 'FH-101')).toBe(true)

    // Place both parts, then drift FH-101's exhaust_cfm & weight from the planned requirement row
    model = runCmd(model, { type: 'place_planned_part', partId: fhPartId, levelId: 'L1', position: { x: 1000, y: 1000 } })
    model = runCmd(model, { type: 'place_planned_part', partId: safePartId, levelId: 'L1', position: { x: 3000, y: 1000 } })
    model = runCmd(model, { type: 'set_parameters', id: fhPartId, scope: 'instance', values: { exhaust_cfm: 1200, weight: 800 } })

    const audit2 = auditEquipmentRequirements(model)
    expect(audit2.summary.unplacedCount).toBe(0)
    expect(audit2.summary.placedCount).toBe(2)
    // SAFE-1 has no required systems or loads and no drift → clean!
    expect(audit2.findings.filter((f) => f.mark === 'SAFE-1')).toEqual([])
    // FH-101 is placed, unconnected to electrical & exhaust_air, missing from loads, and drifted on weight + exhaust_cfm!
    expect(audit2.findings.filter((f) => f.kind === 'unconnected_system' && f.mark === 'FH-101').map((f) => f.service)).toEqual([
      'electrical',
      'exhaust_air',
    ])
    expect(audit2.findings.filter((f) => f.kind === 'parameter_drift' && f.mark === 'FH-101')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parameter: 'exhaust_cfm', plannedValue: 950, modeledValue: 1200 }),
        expect.objectContaining({ parameter: 'weight', plannedValue: 650, modeledValue: 800 }),
      ]),
    )
  })
})
