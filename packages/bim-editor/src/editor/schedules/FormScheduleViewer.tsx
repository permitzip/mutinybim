'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Crosshair, FileText, Pencil, Printer, Search, SlidersHorizontal } from 'lucide-react'
import {
  documentIndex,
  evaluateFormSchedule,
  formScheduleKindLabel,
  parseFieldTemplate,
  parseScheduleCellLink,
  type Command,
  type FormScheduleDefinition,
  type ModelState,
  type ParamDef,
  type ParamValue,
  type ViewElement,
} from '@permitzip/bim-kernel'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '../../ui/alert'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import type { SubmitCommand } from '../views-sheets/types'

export interface EditableFormBinding {
  readonly elementId: string
  readonly kind: 'mark' | 'param'
  readonly scope?: 'instance' | 'type'
  readonly paramName?: string
  readonly paramDef?: ParamDef
  readonly rawValue: string
}

/**
 * Determine whether a single-field template string (e.g. `{mark}`, `{gas_id}`,
 * `{param.notes}`, `{notes}`, `{voltage}`) resolves to an editable field on a
 * single backing `part` element. Returns null for computed/read-only cells or
 * multi-element aggregated rows.
 */
export function editableFieldOfTemplate(
  model: ModelState,
  elementId: string | undefined,
  template: string | undefined,
): EditableFormBinding | null {
  if (!elementId || !template) return null
  const el = model.elements[elementId]
  if (el?.kind !== 'part') return null
  const parsed = parseFieldTemplate(template.trim())
  if (!parsed.ok || parsed.parts.length !== 1 || parsed.parts[0]?.kind !== 'field') return null
  const path = parsed.parts[0].path.trim()
  if (path === 'mark' || path === 'gas_id') {
    return { elementId: el.id, kind: 'mark', rawValue: el.mark ?? '' }
  }
  const paramName = path.startsWith('param.') ? path.slice(6) : path
  const typeEl = model.elements[el.typeId]
  if (typeEl?.kind !== 'part_type') return null
  const instDef = typeEl.definition.instanceParams.find((p) => p.name === paramName)
  const typeDef = instDef ? undefined : typeEl.definition.typeParams.find((p) => p.name === paramName)
  const paramDef = instDef ?? typeDef
  if (!paramDef || paramDef.formula) return null
  const scope: 'instance' | 'type' = instDef ? 'instance' : 'type'
  const current = el.values[paramName] ?? typeEl.definition.typeValues[paramName] ?? paramDef.default
  return {
    elementId: el.id,
    kind: 'param',
    scope,
    paramName,
    paramDef,
    rawValue: current === undefined || current === null ? '' : String(current),
  }
}

/** Build the `set_parameters` command for an edited form cell, or a plain refusal reason. */
export function formCellEditCommand(binding: EditableFormBinding, draft: string): Command | string {
  const trimmed = draft.trim()
  if (binding.kind === 'mark') {
    return { type: 'set_parameters', id: binding.elementId, scope: 'instance', mark: trimmed }
  }
  const name = binding.paramName
  const def = binding.paramDef
  if (!name || !def) return 'This field cannot be edited here.'
  let value: ParamValue | null
  if (trimmed === '') {
    value = null
  } else if (def.kind === 'number' || def.kind === 'length' || def.kind === 'angle') {
    const n = Number(trimmed.replace(/,/g, ''))
    if (!Number.isFinite(n)) return `${def.label} must be a number.`
    value = n
  } else if (def.kind === 'boolean') {
    const lower = trimmed.toLowerCase()
    if (lower === 'true' || lower === 'yes' || lower === '1' || lower === 'on') value = true
    else if (lower === 'false' || lower === 'no' || lower === '0' || lower === 'off') value = false
    else return `${def.label} must be yes/no or true/false.`
  } else {
    value = trimmed
  }
  return {
    type: 'set_parameters',
    id: binding.elementId,
    scope: binding.scope ?? 'instance',
    values: { [name]: value },
  }
}

interface Props {
  readonly view: ViewElement
  readonly form: FormScheduleDefinition
  readonly model: ModelState
  readonly submit: SubmitCommand
  readonly editBlocked: string | null
  readonly onShowInModel: (elementIds: readonly string[]) => void
  readonly onOpenSheet?: (sheetId: string) => void
  readonly onOpenFormEditor?: (kind: string, elementId: string) => boolean
  readonly onTogglePrintPreview?: () => void
  readonly backSheet?: { readonly number: string; readonly onBack: () => void } | null
}

/**
 * Unified center-pane interactive viewer for `formSchedule` views (panel
 * schedules, gas equipment/connections, lighting controls, feeder schedules,
 * etc.). Opens directly in the interactive workspace with live filtering,
 * inline parameter editing where supported, model click-through, and a
 * one-click Print Preview toggle — never forcing users out to a sheet first.
 */
export function FormScheduleViewer({
  view,
  form,
  model,
  submit,
  editBlocked,
  onShowInModel,
  onOpenSheet,
  onOpenFormEditor,
  onTogglePrintPreview,
  backSheet = null,
}: Props) {
  const [query, setQuery] = useState('')
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ readonly key: string; readonly binding: EditableFormBinding; readonly draft: string; readonly label: string } | null>(null)

  const evaluated = useMemo(() => evaluateFormSchedule(model, form), [model, form])
  const kindLabel = formScheduleKindLabel(form.kind)
  const viewport = useMemo(() => documentIndex(model).viewportByView.get(view.id), [model, view.id])
  const sheet = useMemo(() => (viewport ? documentIndex(model).sheets.find((s) => s.id === viewport.sheetId) : undefined), [model, viewport])
  const canOpenFormEditor = Boolean(form.kind && form.elementId && onOpenFormEditor)

  const rowTemplates = form.template.body.layout === 'rows' ? form.template.body.columns : null
  const headerTemplates = form.template.header.fields

  const visibleRowIndices = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: number[] = []
    for (let i = 0; i < evaluated.grid.rows.length; i++) {
      const row = evaluated.grid.rows[i]!
      if (!q || row.some((c) => c.toLowerCase().includes(q))) out.push(i)
    }
    return out
  }, [evaluated.grid.rows, query])

  const commitEdit = () => {
    if (!editing) return
    const current = editing
    setEditing(null)
    if (current.draft.trim() === current.binding.rawValue.trim()) return
    const cmd = formCellEditCommand(current.binding, current.draft)
    if (typeof cmd === 'string') {
      toast.error(cmd)
      return
    }
    const refused = submit(cmd, `edit ${current.label} in ${view.name}`)
    if (refused) toast.error(refused)
  }

  const startEdit = (key: string, binding: EditableFormBinding, label: string) => {
    if (editBlocked) {
      toast.error(editBlocked)
      return
    }
    setEditing({ key, binding, draft: binding.rawValue, label })
  }

  const alignClass = (align: 'left' | 'center' | 'right' | undefined) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background" data-testid="form-schedule-interactive">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {backSheet && (
            <Button size="sm" variant="secondary" onClick={backSheet.onBack} data-testid="back-to-sheet">
              <ArrowLeft data-icon="inline-start" />
              Back to {backSheet.number}
            </Button>
          )}
          <h2 className="truncate text-sm font-semibold">{evaluated.title || view.name}</h2>
          <Badge variant="secondary" className="shrink-0 text-[11px]" data-testid="form-schedule-kind">
            {kindLabel}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter rows…"
              aria-label="Filter schedule rows"
              className="h-7 w-44 pl-7 text-xs"
              data-testid="form-schedule-filter"
            />
          </div>
          {canOpenFormEditor && (
            <Button size="sm" variant="default" onClick={() => onOpenFormEditor!(form.kind, form.elementId!)} data-testid="model-schedule-open-form">
              <SlidersHorizontal data-icon="inline-start" />
              Edit circuits / form
            </Button>
          )}
          {onTogglePrintPreview && (
            <Button size="sm" variant="outline" onClick={onTogglePrintPreview} data-testid="schedule-print-preview-toggle">
              <Printer data-icon="inline-start" />
              Print preview
            </Button>
          )}
          {sheet && onOpenSheet && (
            <Button size="sm" variant="ghost" onClick={() => onOpenSheet(sheet.id)} data-testid="model-schedule-open-sheet">
              <FileText data-icon="inline-start" />
              Sheet {sheet.number}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          {evaluated.problem && (
            <Alert variant="destructive" data-testid="form-schedule-problem">
              <AlertTitle>Schedule notice</AlertTitle>
              <AlertDescription>{evaluated.problem}</AlertDescription>
            </Alert>
          )}

          {evaluated.header.length > 0 && (
            <div
              className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, evaluated.headerColumns || 2))}, minmax(0, 1fr))` }}
              data-testid="form-schedule-header"
            >
              {evaluated.header.map((field, idx) => {
                const editKey = `hdr:${idx}`
                const binding = !editBlocked ? editableFieldOfTemplate(model, form.elementId, headerTemplates[idx]?.value) : null
                const isEditing = editing?.key === editKey
                return (
                  <div key={`${field.label}-${idx}`} className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 hover:bg-muted/40">
                    <span className="font-medium text-muted-foreground">{field.label}:</span>
                    {isEditing ? (
                      <Input
                        value={editing.draft}
                        onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit()
                          else if (e.key === 'Escape') setEditing(null)
                        }}
                        className="h-6 max-w-44 text-xs"
                        autoFocus
                        data-testid={`form-header-input-${idx}`}
                      />
                    ) : binding ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-right font-medium hover:bg-accent"
                        onClick={() => startEdit(editKey, binding, field.label)}
                        title={`Edit ${field.label}`}
                        data-testid={`form-header-edit-${idx}`}
                      >
                        <span>{field.value || '—'}</span>
                        <Pencil className="size-3 text-muted-foreground" />
                      </button>
                    ) : (
                      <span className="truncate font-medium">{field.value || '—'}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-xs" data-testid="form-schedule-table">
              {evaluated.grid.headings.length > 0 && (
                <thead className="bg-muted/50 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  <tr>
                    {evaluated.grid.headings.map((heading, colIdx) => (
                      <th
                        key={`${heading}-${colIdx}`}
                        className={`border-b px-2.5 py-2 whitespace-nowrap ${alignClass(evaluated.grid.aligns[colIdx])} ${evaluated.grid.splitAt === colIdx ? 'border-l-2 border-l-border' : ''}`}
                      >
                        {heading}
                      </th>
                    ))}
                    <th className="w-10 border-b px-2 py-2 text-right">
                      <span className="sr-only">Locate</span>
                    </th>
                  </tr>
                </thead>
              )}
              <tbody>
                {visibleRowIndices.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, evaluated.grid.headings.length + 1)} className="px-4 py-6 text-center text-muted-foreground">
                      {query.trim() ? `No rows match "${query.trim()}".` : form.emptyText || 'No items in this schedule yet.'}
                    </td>
                  </tr>
                ) : (
                  visibleRowIndices.map((rowIdx) => {
                    const cells = evaluated.grid.rows[rowIdx]!
                    const rowIds = evaluated.grid.rowIds[rowIdx] ?? []
                    const singleId = rowIds.length === 1 ? rowIds[0] : undefined
                    const isSelected = selectedRow === rowIdx
                    return (
                      <tr
                        key={rowIdx}
                        onClick={() => setSelectedRow(rowIdx)}
                        className={`border-b last:border-b-0 transition-colors ${isSelected ? 'bg-accent/50' : 'hover:bg-muted/30'}`}
                        data-testid={`form-schedule-row-${rowIdx}`}
                      >
                        {cells.map((rawCell, colIdx) => {
                          const link = parseScheduleCellLink(rawCell)
                          const shownText = link ? link.label : rawCell
                          const colTemplate = rowTemplates?.[colIdx]?.value
                          const binding = !editBlocked ? editableFieldOfTemplate(model, singleId, colTemplate) : null
                          const editKey = `cell:${rowIdx}:${colIdx}`
                          const isEditing = editing?.key === editKey
                          const splitBorder = evaluated.grid.splitAt === colIdx ? 'border-l-2 border-l-border' : ''
                          return (
                            <td
                              key={colIdx}
                              className={`px-2.5 py-1.5 ${alignClass(evaluated.grid.aligns[colIdx])} ${splitBorder}`}
                            >
                              {isEditing ? (
                                <Input
                                  value={editing.draft}
                                  onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit()
                                    else if (e.key === 'Escape') setEditing(null)
                                  }}
                                  className="h-6 min-w-20 text-xs"
                                  autoFocus
                                  data-testid={`form-cell-input-${rowIdx}-${colIdx}`}
                                />
                              ) : binding ? (
                                <button
                                  type="button"
                                  className="group inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    startEdit(editKey, binding, evaluated.grid.headings[colIdx] ?? 'field')
                                  }}
                                  title={`Click to edit ${evaluated.grid.headings[colIdx] ?? 'value'}`}
                                  data-testid={`form-cell-edit-${rowIdx}-${colIdx}`}
                                >
                                  <span className="truncate">{shownText || '—'}</span>
                                  <Pencil className="size-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                                </button>
                              ) : link ? (
                                <a href={link.href} target="_blank" rel="noreferrer" className="text-primary underline hover:opacity-80" onClick={(e) => e.stopPropagation()}>
                                  {link.label}
                                </a>
                              ) : (
                                <span>{shownText}</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1 text-right">
                          {rowIds.length > 0 && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              title="Show in 3D model"
                              aria-label="Show row in model"
                              onClick={(e) => {
                                e.stopPropagation()
                                onShowInModel(rowIds)
                              }}
                              data-testid={`form-row-locate-${rowIdx}`}
                            >
                              <Crosshair className="size-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {(evaluated.summary || evaluated.totals.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {evaluated.summary && evaluated.summary.rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-muted/50 text-[11px] font-semibold text-muted-foreground uppercase">
                      <tr>
                        {evaluated.summary.headings.map((h, i) => (
                          <th key={i} className="border-b px-2.5 py-1.5 text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {evaluated.summary.rows.map((r, ri) => (
                        <tr key={ri} className="border-b last:border-b-0">
                          {r.map((c, ci) => (
                            <td key={ci} className="px-2.5 py-1.5">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {evaluated.totals.length > 0 && (
                <div className="rounded-md border bg-muted/20 p-3 text-xs" data-testid="form-schedule-totals">
                  <div className="flex flex-col gap-1.5">
                    {evaluated.totals.map((t, i) => (
                      <div key={i} className="flex items-center justify-between gap-4">
                        <span className="font-semibold text-muted-foreground">{t.label}</span>
                        <span className="font-mono font-semibold tabular-nums">{t.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {evaluated.notes.length > 0 && (
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">Notes</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {evaluated.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {evaluated.footer && <p className="text-[11px] text-muted-foreground">{evaluated.footer}</p>}
        </div>
      </div>
    </div>
  )
}
