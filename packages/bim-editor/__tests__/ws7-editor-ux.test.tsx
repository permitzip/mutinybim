// @mutinybim-bare-kernel
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  DEFAULT_SETTINGS,
  FORM_SCHEDULE_POINT,
  asElementId,
  executeCommand,
  formScheduleSupport,
  portInfo,
  runLabel,
  serviceOf,
  withUpgradePolicy,
  type Command,
  type DrawingItem,
  type FormScheduleDef,
  type FormScheduleDefinition,
  type ModelState,
  type PartInstance,
  type PartTypeDefinition,
  type Revision,
  type RunSegment,
  type ViewElement,
} from '@permitzip/bim-kernel'
import { PACK_CONTRACT_VERSION, PackSet, contribute, definePack, withPackSet } from '@permitzip/bim-kernel/packs'
import { PLUMBING_GAS_PACK } from '@permitzip/bim-pack-plumbing'

const PLUMBING_SET = PackSet.create([PLUMBING_GAS_PACK])
import { EditorHostProvider } from '../src/host'
import { createLocalEditorHost } from '../src/host/local'
import { EditorServiceUnavailableError } from '../src/host/unavailable'
import { TooltipProvider } from '../src/ui/tooltip'
import {
  DEFAULT_SNAP_GRID_MM,
  SNAP_GRID_OPTIONS,
  cycleSnapGridMm,
  getSnapGridMm,
  readSnapGridMm,
  setSnapGridMm,
  snapGridLabel,
  snapToIncrement,
} from '../src/editor/snap-grid'
import { snapPoint } from '../src/editor/placement'
import { angleLock, resolveRoutePoint, snapDrag } from '../src/editor/route-axis'
import { SelectionLocksBar } from '../src/editor/SelectionLocksBar'
import { connectEndToSideCommand, grabFor, isVerticalAxis, isVerticalSegment, sideUnderEnd } from '../src/editor/run-grab'
import { plusSpots, verticalStubElevationMm } from '../src/editor/plus-tee'
import { routeChoicesForPartConnector } from '../src/editor/route-like'
import { DEFAULT_ROUTE } from '../src/editor/RoutePanel'
import { DEFAULT_DRAFT_SETTINGS, constrainPoint } from '../src/editor/views-sheets/draft/draft-input'
import { cycleDraftTab, draftCreateSimilarFor, resolveDraftItemClick } from '../src/editor/views-sheets/draft/draft-tab-select'
import { ModelSchedulePane } from '../src/editor/schedules/ModelSchedulePane'
import { editableFieldOfTemplate, formCellEditCommand } from '../src/editor/schedules/FormScheduleViewer'
import { NewViewDialog } from '../src/editor/views-sheets/ViewsSheetsDialogs'
import { ViewsSheetsPanel } from '../src/editor/views-sheets/ViewsSheetsPanel'
import { clearLastOpenItem, readLastOpenItem, writeLastOpenItem } from '../src/editor/views-sheets/last-open-view'
import { isTransientVersionsError, useVersions } from '../src/editor/versions/useVersions'
import type { BranchChannel } from '../src/editor/branches/useBranches'

const id = (s: string) => asElementId(s)
const identity = (p: { x: number; y: number }) => p

function run(model: ModelState, cmd: Command): ModelState {
  const res = withPackSet(PLUMBING_SET, () => withUpgradePolicy(() => true, () => executeCommand(model, cmd)))
  if (!res.ok) throw new Error(`Command ${cmd.type} failed: ${res.error.message}`)
  return { ...res.model, revision: (model.revision + 1) as Revision }
}

function modelWithLevel(): ModelState {
  const empty: ModelState = { modelId: 'ws7-test', revision: 0 as Revision, elements: {}, connections: [], settings: DEFAULT_SETTINGS }
  return run(empty, { type: 'create_level', levelId: 'lvl-1', name: 'L1', elevationMm: 0 })
}

function expansionTankDefinition(): PartTypeDefinition {
  return {
    familyName: 'Expansion Tank',
    typeName: 'Thermal Expansion Tank',
    category: 'pipe_accessory',
    typeParams: [{ name: 'volume_gal', label: 'Volume (gal)', kind: 'number', default: 5 }],
    instanceParams: [{ name: 'notes', label: 'Notes', kind: 'text', default: '' }],
    typeValues: { volume_gal: 5 },
    geometry: [{ kind: 'cylinder', center: [0, 0, 200], radius: 150, height: 400, axis: 'z' }],
    connectors: [
      {
        id: 'water',
        label: 'Bottom Water Port',
        domain: 'pipe',
        systemKind: 'domestic_cold_water',
        position: [0, 0, 0],
        direction: [0, 0, -1],
        shape: 'round',
        diameter: 25.4,
      },
    ],
    symbol: [{ kind: 'circle', center: [0, 0], radius: 150 }],
    tagFields: ['mark'],
    source: { kind: 'cut_sheet', fileName: 'expansion-tank.pdf' },
  }
}

function lineItem(itemId: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<DrawingItem> = {}): DrawingItem {
  return {
    id: id(itemId),
    ownerId: id('view-detail'),
    kind: 'drawing_item',
    shape: 'line',
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
    version: 0,
    authoredRev: {},
    ...extra,
  }
}

describe('WS-7 Step 1: Configurable snap grid increment & UI toggle', () => {
  beforeEach(() => {
    localStorage.clear()
    setSnapGridMm(DEFAULT_SNAP_GRID_MM, 'user-a')
  })

  test('snaps to Free (1 mm), 1/2", 1", 3", 6", and 12" increments and persists per user', () => {
    expect(SNAP_GRID_OPTIONS.map((o) => o.shortLabel)).toEqual(['Free', '1/2"', '1"', '3"', '6"', '12"'])
    expect(snapToIncrement(137.4, 0)).toBe(137)
    expect(snapToIncrement(137.4, 12.7)).toBeCloseTo(139.7, 2)
    expect(snapToIncrement(137.4, 25.4)).toBeCloseTo(127, 2)
    expect(snapToIncrement(137.4, 76.2)).toBeCloseTo(152.4, 2)
    expect(snapToIncrement(137.4, 152.4)).toBeCloseTo(152.4, 2)
    expect(snapToIncrement(137.4, 304.8)).toBeCloseTo(0, 2)

    setSnapGridMm(25.4, 'user-a')
    expect(getSnapGridMm()).toBe(25.4)
    expect(readSnapGridMm('user-a')).toBe(25.4)
    expect(snapGridLabel(25.4)).toBe('1"')
    expect(snapGridLabel(0)).toBe('Free')

    const cycled = cycleSnapGridMm('user-a')
    expect(cycled).toBeCloseTo(76.2, 2) // 1" -> 3"
  })

  test('placement, routing, and run dragging respect configured gridMm and 0 (Alt free-drag override)', () => {
    const freePlace = snapPoint({ x: 137.3, y: 241.8 }, [], null, undefined, null, 0)
    expect(freePlace.point).toEqual({ x: 137, y: 242 })
    expect(freePlace.label).toContain('free')

    const inchPlace = snapPoint({ x: 137.3, y: 241.8 }, [], null, undefined, null, 25.4)
    expect(inchPlace.point.x).toBeCloseTo(127, 1)
    expect(inchPlace.label).toContain('1"')

    const lockedFree = angleLock({ x: 0, y: 0 }, { x: 137, y: 0 }, 0, '45', 0)
    expect(lockedFree).toEqual({ x: 137, y: 0 })

    const routeRes = resolveRoutePoint({
      prev: { x: 0, y: 0, elevationMm: 1000 },
      raw: { x: 137, y: 0 },
      vertical: null,
      lock: 'auto',
      shift: false,
      pipe: true,
      gridMm: 0,
    })
    expect(routeRes?.point).toEqual({ x: 137, y: 0 })

    const dragFree = snapDrag('end', { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 137.4 }, 0)
    expect(dragFree.delta).toEqual({ x: 0, y: 0, z: 137 })
    const dragSix = snapDrag('end', { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 137.4 }, 152.4)
    expect(dragSix.delta.z).toBeCloseTo(152.4, 2)
  })

  test('SelectionLocksBar displays clickable Snap control synced with snap-grid store', () => {
    setSnapGridMm(DEFAULT_SNAP_GRID_MM, 'user-ui')
    render(
      <TooltipProvider>
        <SelectionLocksBar hasSelection={false} selectionLocked={false} canEdit userId="user-ui" />
      </TooltipProvider>,
    )
    const trigger = screen.getByTestId('snap-grid-trigger')
    expect(trigger).toHaveTextContent('Snap: 6"')

    act(() => {
      setSnapGridMm(0, 'user-ui')
    })
    expect(trigger).toHaveTextContent('Snap: Free')

    act(() => {
      setSnapGridMm(25.4, 'user-ui')
    })
    expect(trigger).toHaveTextContent('Snap: 1"')
  })
})

describe('WS-7 Step 2: Vertical pipe stretch, horizontal-to-vertical auto-tee, and + vertical-port grip', () => {
  test('vertical pipe open end is grabbed as plumb end and stretches along Z in kernel', () => {
    let m = modelWithLevel()
    m = run(m, {
      type: 'route_run',
      idPrefix: 'riser',
      levelId: 'lvl-1',
      domain: 'pipe',
      size: { shape: 'pipe', nominalMm: 50.8, material: 'copper' },
      elevationMm: 500,
      system: { id: 'sys-dcw', kind: 'domestic_cold_water', name: 'DCW' },
      points: [
        { x: 1000, y: 1000, elevationMm: 500 },
        { x: 1000, y: 1000, elevationMm: 3000 },
      ],
    })
    const riser = Object.values(m.elements).find((el): el is RunSegment => el.kind === 'run_segment')!
    expect(riser).toBeDefined()
    expect(isVerticalSegment(riser)).toBe(true)

    const grab = grabFor(m.elements, riser, { x: 1000, y: 1000, z: 2950 })
    expect(grab?.kind).toBe('end')
    expect(grab?.grip).toBe('end')
    expect(isVerticalAxis(grab?.axis)).toBe(true)

    const stretched = run(m, {
      type: 'drag_run',
      elementId: riser.id,
      grip: 'end',
      delta: { x: 0, y: 0, z: 600 },
    })
    const after = stretched.elements[riser.id] as RunSegment
    expect(after.end.z).toBeCloseTo(3600, 1)
  })

  test('horizontal pipe pulled onto vertical riser detects riser and cuts a tee via connectEndToSideCommand', () => {
    let m = modelWithLevel()
    // Vertical riser from z=0 to z=3600 at (2000, 1000)
    m = run(m, {
      type: 'route_run',
      idPrefix: 'riser',
      levelId: 'lvl-1',
      domain: 'pipe',
      size: { shape: 'pipe', nominalMm: 50.8, material: 'copper' },
      elevationMm: 0,
      system: { id: 'sys-dcw', kind: 'domestic_cold_water', name: 'DCW' },
      points: [
        { x: 2000, y: 1000, elevationMm: 0 },
        { x: 2000, y: 1000, elevationMm: 3600 },
      ],
    })
    const riser = Object.values(m.elements).find((el): el is RunSegment => el.kind === 'run_segment')!

    // Horizontal pipe at z=1800 approaching the riser from x=500 to x=1980 (within reach of x=2000)
    m = run(m, {
      type: 'route_run',
      idPrefix: 'branch',
      levelId: 'lvl-1',
      domain: 'pipe',
      size: { shape: 'pipe', nominalMm: 25.4, material: 'copper' },
      elevationMm: 1800,
      system: { id: 'sys-dcw', kind: 'domestic_cold_water' },
      points: [
        { x: 500, y: 1000 },
        { x: 1980, y: 1000 },
      ],
    })
    const horiz = Object.values(m.elements).find((el): el is RunSegment => el.kind === 'run_segment' && el.id !== riser.id)!

    const detected = sideUnderEnd(m, horiz.id, 'end')
    expect(detected?.id).toBe(riser.id)

    const cmd = connectEndToSideCommand(m, horiz.id, 'end', riser, 'auto-tee')
    expect(cmd).not.toBeNull()
    expect(['route_run', 'batch_edits']).toContain(cmd?.type)

    // Actually execute against bim-kernel to prove the tee is cut cleanly on the vertical riser!
    const after = run(m, cmd!)
    const fittings = Object.values(after.elements).filter((el) => el.kind === 'run_fitting')
    expect(fittings.length).toBeGreaterThanOrEqual(1)
  })

  test('+ grip on bottom-port expansion tank computes valid lowered stub elevation and routes cleanly in kernel', () => {
    let m = modelWithLevel()
    const def = expansionTankDefinition()
    m = run(m, {
      type: 'place_part',
      partId: 'et-1',
      typeId: 'type-et',
      partType: def,
      levelId: 'lvl-1',
      position: { x: 1000, y: 1000 },
      offsetMm: 2400,
      rotationDeg: 0,
    })
    const part = m.elements[id('et-1')] as PartInstance
    const spots = plusSpots(
      m.elements,
      part,
      {
        runLabel,
        serviceOf,
        portInfo: (elements, ref) => portInfo(elements, { elementId: asElementId(ref.elementId), port: ref.port }),
      },
      [],
    )
    expect(spots).toHaveLength(1)
    expect(spots[0]?.kind).toBe('connector')
    expect(spots[0]?.port).toBe('water')
    expect(spots[0]?.toward.z).toBeCloseTo(-1, 3)

    const picked = routeChoicesForPartConnector(m.elements, part, 'water', { ...DEFAULT_ROUTE, material: 'copper' })
    expect(typeof picked).toBe('object')
    if (typeof picked !== 'object') return
    expect(picked.vertical).toBe(true)
    expect(picked.elevationMm).toBe(verticalStubElevationMm(2400, -1, { shape: 'pipe', nominalMm: 25.4, material: 'copper' }))
    expect(picked.elevationMm).toBeLessThan(2400)

    // Routing out of the bottom vertical connector at the computed stub elevation succeeds in the kernel!
    const routed = run(m, {
      type: 'route_run',
      idPrefix: 'et-route',
      levelId: 'lvl-1',
      domain: 'pipe',
      size: { shape: 'pipe', nominalMm: Number(picked.choices.nominalIn) * 25.4, material: 'copper' },
      elevationMm: picked.elevationMm,
      system: { id: 'sys-dcw', kind: 'domestic_cold_water', name: 'DCW' },
      from: { kind: 'part', partId: 'et-1', connectorId: 'water' },
      points: [{ x: 2000, y: 1000 }],
    })
    const updatedPart = routed.elements[id('et-1')] as PartInstance
    expect(updatedPart.links?.water).toBeDefined()
  })
})

describe('WS-7 Step 3: 2D drafting Tab chain persistence, CS Create Similar, and strong snapping', () => {
  test('Tab cycles connected 2D drafting lines and clicking preserves the full chain without collapsing', () => {
    const l1 = lineItem('l1', 0, 0, 100, 0)
    const l2 = lineItem('l2', 100, 0, 100, 80)
    const l3 = lineItem('l3', 100, 80, 0, 80)
    const items = [l1, l2, l3]

    // Hover l1 + Tab highlights entire 3-segment chain
    const preview = cycleDraftTab(items, null, 'l1')
    expect(preview?.mode).toBe('chain')
    expect(new Set(preview?.ids)).toEqual(new Set(['l1', 'l2', 'l3']))

    // Clicking l2 while chain preview is active commits all 3 and locks against pointer-up collapse
    const commitClick = resolveDraftItemClick({
      itemId: 'l2',
      selectedIds: [],
      chainLocked: false,
      tabPreview: preview,
    })
    expect(commitClick.committedPreview).toBe(true)
    expect(commitClick.chainLocked).toBe(true)
    expect(commitClick.collapseTo).toBeNull()
    expect(new Set(commitClick.ids)).toEqual(new Set(['l1', 'l2', 'l3']))

    // Clicking l3 while chain is selected preserves the full chain instead of collapsing to l3
    const repeatClick = resolveDraftItemClick({
      itemId: 'l3',
      selectedIds: commitClick.ids,
      chainLocked: true,
      tabPreview: null,
    })
    expect(repeatClick.chainLocked).toBe(true)
    expect(repeatClick.collapseTo).toBeNull()
    expect(repeatClick.ids).toEqual(commitClick.ids)
  })

  test('CS (Create Similar) resolves matching tool and style for drafted lines, regions, and dimensions', () => {
    const dashedHeavy = lineItem('l1', 0, 0, 50, 0, { lineStyle: { weight: 'heavy', pattern: 'dashed' } })
    const resLine = draftCreateSimilarFor(dashedHeavy, DEFAULT_DRAFT_SETTINGS)
    expect(resLine?.tool).toBe('line')
    expect(resLine?.settings.weight).toBe('heavy')
    expect(resLine?.settings.pattern).toBe('dashed')

    const region: DrawingItem = {
      id: id('r1'),
      ownerId: id('view-detail'),
      kind: 'drawing_item',
      shape: 'region',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      fill: { pattern: 'crosshatch', tone: 'halftone' },
      version: 0,
      authoredRev: {},
    }
    const resRegion = draftCreateSimilarFor(region, DEFAULT_DRAFT_SETTINGS)
    expect(resRegion?.tool).toBe('region')
    expect(resRegion?.settings.hatch).toBe('crosshatch')
    expect(resRegion?.settings.regionTone).toBe('halftone')
    expect(resRegion?.settings.masking).toBe(false)
  })

  test('constrainPoint provides strong endpoint, midpoint, and orthogonal alignment snapping for 2D drafting lines', () => {
    const existing = [lineItem('l1', 10, 20, 110, 20)]

    // Strong endpoint pull within 1.25x reach
    const ep = constrainPoint({
      at: { x: 112.2, y: 20.5 },
      from: null,
      items: existing,
      toPaper: identity,
      settings: DEFAULT_DRAFT_SETTINGS,
      reachMm: 2,
    })
    expect(ep.snapKind).toBe('endpoint')
    expect(ep.at).toEqual({ x: 110, y: 20 })

    // Strong midpoint pull
    const mp = constrainPoint({
      at: { x: 60.8, y: 21.2 },
      from: null,
      items: existing,
      toPaper: identity,
      settings: DEFAULT_DRAFT_SETTINGS,
      reachMm: 2,
    })
    expect(mp.snapKind).toBe('midpoint')
    expect(mp.at).toEqual({ x: 60, y: 20 })

    // Orthogonal alignment guide to existing line endpoint (x=110) far below the line (y=75)
    const align = constrainPoint({
      at: { x: 111.1, y: 75 },
      from: { x: 10, y: 75 },
      items: existing,
      toPaper: identity,
      settings: DEFAULT_DRAFT_SETTINGS,
      reachMm: 2,
    })
    expect(align.at.x).toBe(110)
    expect(align.guideLine).toBeDefined()
  })
})

describe('WS-7 Step 4: Unified Interactive Schedule Viewer for formSchedule', () => {
  test('ModelSchedulePane opens formSchedule directly in interactive center-pane viewer with inline edit and print preview toggle', () => {
    let m = modelWithLevel()
    const def = expansionTankDefinition()
    m = run(m, {
      type: 'place_part',
      partId: 'eq-1',
      typeId: 'type-et',
      partType: def,
      levelId: 'lvl-1',
      position: { x: 0, y: 0 },
      offsetMm: 0,
      rotationDeg: 0,
    })
    m = run(m, { type: 'set_parameters', id: 'eq-1', scope: 'instance', mark: 'ET-1', values: { notes: 'Basement' } })

    const formDef: FormScheduleDefinition = {
      kind: 'test_gas_equipment',
      template: {
        name: 'Gas Equipment Schedule',
        title: 'GAS EQUIPMENT SCHEDULE',
        header: { columns: 2, fields: [] },
        body: {
          layout: 'rows',
          columns: [
            { heading: 'MARK', value: '{mark}', align: 'left' },
            { heading: 'NOTES', value: '{param.notes}', align: 'left' },
          ],
        },
        notes: [],
      },
    }

    const testFormRow: FormScheduleDef = {
      kind: 'test_gas_equipment',
      label: 'Gas Equipment',
      template: formDef.template,
      evaluate: (model, fDef) => {
        const eq = model.elements[id('eq-1')] as PartInstance | undefined
        return formScheduleSupport.listForm(
          model,
          fDef,
          eq
            ? [
                {
                  ids: [eq.id],
                  value: (path) => (path === 'mark' ? eq.mark : path === 'param.notes' ? String(eq.values.notes ?? '') : ''),
                },
              ]
            : [],
        )
      },
    }

    const scheduleView: ViewElement = {
      id: id('sched-gas'),
      kind: 'view',
      viewType: 'schedule',
      name: 'Gas Equipment Schedule',
      cropMin: { x: 0, y: 0 },
      cropMax: { x: 1000, y: 1000 },
      props: { formSchedule: formDef },
      version: 0,
      authoredRev: {},
    }

    const submit = jest.fn(() => null)
    const onShowInModel = jest.fn()
    const onTogglePrintPreview = jest.fn()
    const host = createLocalEditorHost({ authorityUrl: 'ws://127.0.0.1:3095/sync' })

    const pack = definePack(
      {
        id: 'ws7_test',
        name: 'WS7 Test Forms',
        version: '1.0.0',
        kernel: `^${PACK_CONTRACT_VERSION}`,
        description: 'WS7 test form schedules',
      },
      [contribute(FORM_SCHEDULE_POINT, [testFormRow])],
    )
    const packSet = PackSet.create([PLUMBING_GAS_PACK, pack])

    withPackSet(packSet, () => {
      render(
        <EditorHostProvider host={host}>
          <ModelSchedulePane
            projectId="proj-1"
            session={null}
            connected={false}
            view={scheduleView}
            actor={{ id: 'u1', name: 'Engineer' }}
            model={m}
            onShowInModel={onShowInModel}
            onUndo={jest.fn()}
            onRedo={jest.fn()}
            submit={submit}
            editBlocked={null}
            onTogglePrintPreview={onTogglePrintPreview}
          />
        </EditorHostProvider>,
      )
    })

    // Opens directly in interactive viewer (NOT blocked by SyncScheduleConnection or FormScheduleOpens empty state!)
    expect(screen.getByTestId('form-schedule-interactive')).toBeInTheDocument()
    expect(screen.queryByTestId('model-schedule-form-only')).not.toBeInTheDocument()
    expect(screen.getByText('ET-1')).toBeInTheDocument()
    expect(screen.getByText('Basement')).toBeInTheDocument()

    // One-click print preview toggle
    fireEvent.click(screen.getByTestId('schedule-print-preview-toggle'))
    expect(onTogglePrintPreview).toHaveBeenCalledTimes(1)

    // Locate in model
    fireEvent.click(screen.getByTestId('form-row-locate-0'))
    expect(onShowInModel).toHaveBeenCalledWith(['eq-1'])

    // Inline edit of editable mark cell
    const binding = editableFieldOfTemplate(m, 'eq-1', '{mark}')
    expect(binding?.kind).toBe('mark')
    expect(formCellEditCommand(binding!, 'ET-2')).toEqual({ type: 'set_parameters', id: 'eq-1', scope: 'instance', mark: 'ET-2' })

    fireEvent.click(screen.getByTestId('form-cell-edit-0-0'))
    const input = screen.getByTestId('form-cell-input-0-0')
    fireEvent.change(input, { target: { value: 'ET-2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith(
      { type: 'set_parameters', id: 'eq-1', scope: 'instance', mark: 'ET-2' },
      expect.stringContaining('Gas Equipment Schedule'),
    )
  })
})

describe('WS-7 Step 5: Discipline picker in NewViewDialog, double-click rename, last-open persistence, and useVersions resilience', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('NewViewDialog renders Discipline picker for 3D view and passes discipline on submit', async () => {
    const onCreate = jest.fn(() => null)
    render(<NewViewDialog viewType="three_d" levels={['L1']} onCancel={jest.fn()} onCreate={onCreate} />)
    expect(screen.getByTestId('new-view-discipline')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create and open/i }))
    })
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '3D - Coordination',
        level: null,
        discipline: null,
      }),
    )
  })

  test('ViewsSheetsPanel double-click on a view row opens inline rename input and commits on Enter', () => {
    let m = modelWithLevel()
    m = run(m, {
      type: 'create_view',
      viewId: 'v-plan-1',
      name: 'L1 Mechanical Plan',
      viewType: 'floor_plan',
      props: { level: 'L1', scale: 48 },
    })
    const onRenameView = jest.fn(() => null)
    render(
      <TooltipProvider>
        <ViewsSheetsPanel
          model={m}
          canEdit
          blockedReason=""
          open={{ kind: 'model', mode: '3d' }}
          onOpen={jest.fn()}
          onRequest={jest.fn()}
          onRenameView={onRenameView}
        />
      </TooltipProvider>,
    )

    const row = screen.getByTestId('view-row-v-plan-1')
    fireEvent.doubleClick(within(row).getByText('L1 Mechanical Plan'))

    const renameInput = screen.getByTestId('view-rename-input-v-plan-1')
    expect(renameInput).toHaveValue('L1 Mechanical Plan')

    fireEvent.change(renameInput, { target: { value: 'L1 Plumbing Plan' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })

    expect(onRenameView).toHaveBeenCalledWith(expect.objectContaining({ id: 'v-plan-1' }), 'L1 Plumbing Plan')
  })

  test('last-open-view persists and restores view/sheet per project/model/user in localStorage', () => {
    const scope = { projectId: 'proj-42', modelId: 'model-7', userId: 'u-1' }
    expect(readLastOpenItem(scope)).toBeNull()

    writeLastOpenItem(scope, { kind: 'view', id: 'v-plumb-3d' })
    expect(readLastOpenItem(scope)).toEqual({ kind: 'view', id: 'v-plumb-3d' })

    writeLastOpenItem(scope, { kind: 'sheet', id: 's-p101' })
    expect(readLastOpenItem(scope)).toEqual({ kind: 'sheet', id: 's-p101' })

    // Different model has isolated state
    expect(readLastOpenItem({ projectId: 'proj-42', modelId: 'model-8', userId: 'u-1' })).toBeNull()

    clearLastOpenItem(scope)
    expect(readLastOpenItem(scope)).toBeNull()
  })

  test('useVersions degrades gracefully on transient issued-sets errors without spamming console.error', async () => {
    expect(isTransientVersionsError(new Error('Checking the set failed (HTTP 502). Try again.'))).toBe(true)
    expect(isTransientVersionsError(new Error('Failed to fetch'))).toBe(true)
    expect(isTransientVersionsError(new EditorServiceUnavailableError('Printing and issuing sets'))).toBe(true)
    expect(isTransientVersionsError(new Error('Permission denied'))).toBe(false)

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const baseHost = createLocalEditorHost({ authorityUrl: 'ws://127.0.0.1:3095/sync' })
    const hostWithTransient502 = {
      ...baseHost,
      data: {
        ...baseHost.data,
        drawingSets: {
          status: jest.fn().mockRejectedValue(new Error('Checking the set failed (HTTP 502). Try again.')),
          print: jest.fn(),
          issue: jest.fn(),
        },
      },
    }

    const channel: BranchChannel = {
      request: jest.fn().mockResolvedValue({
        type: 'versions',
        head: 4,
        versions: [{ versionId: 'ver-1', name: 'Baseline', revision: 2, savedAt: '2026-11-27T10:00:00Z', savedBy: 'u1' }],
      }),
      branchesAvailable: () => true,
      branch: () => null,
    }

    function Harness() {
      const { state } = useVersions({ channel, connected: true, projectId: 'proj-1', modelId: 'model-1' })
      if (state.status === 'ready') {
        return (
          <div data-testid="versions-ready">
            <span data-testid="versions-count">{state.entries.length}</span>
            <span data-testid="versions-issued-err">{state.issuedError ?? ''}</span>
          </div>
        )
      }
      return <div data-testid={`versions-${state.status}`} />
    }

    try {
      render(
        <EditorHostProvider host={hostWithTransient502}>
          <Harness />
        </EditorHostProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('versions-ready')).toBeInTheDocument())
      expect(Number(screen.getByTestId('versions-count').textContent)).toBeGreaterThanOrEqual(2)
      expect(screen.getByTestId('versions-issued-err').textContent).toContain('temporarily unavailable')
      // Transient issued-sets error should NOT spam console.error!
      expect(errSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
