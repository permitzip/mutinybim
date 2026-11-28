import { chainOf, type DrawingItem } from '@permitzip/bim-kernel'
import type { DraftSettings } from './draft-input'

/**
 * 2D drafting Tab-select chain state and Create Similar (`CS`) resolution.
 *
 * Pure helpers so hover+Tab pre-highlight, click-to-commit chain persistence,
 * and `CS` Create Similar on every 2D drafting shape are deterministic and
 * directly unit-testable without a DOM.
 */

export interface DraftTabState {
  readonly anchorId: string
  readonly mode: 'single' | 'chain'
  readonly ids: readonly string[]
}

/**
 * Cycle Tab on a 2D drafted item: toggles between the single segment and its
 * full endpoint-connected chain (`chainOf`). Returns null when the item has no
 * connected neighbours (caller may then cycle overlapping items).
 */
export function cycleDraftTab(
  items: readonly DrawingItem[],
  current: DraftTabState | null,
  targetId: string,
): DraftTabState | null {
  const chain = chainOf(items, targetId)
  if (chain.length <= 1) return null
  const chainIds = chain.map((c) => c.id)
  if (current && current.mode === 'chain' && current.ids.includes(targetId)) {
    return { anchorId: targetId, mode: 'single', ids: [targetId] }
  }
  return { anchorId: targetId, mode: 'chain', ids: chainIds }
}

export interface DraftClickResolution {
  readonly ids: readonly string[]
  /** True when the selection came from a Tab-selected chain and must not collapse on click. */
  readonly chainLocked: boolean
  /** Stationary pointer-up collapse target for regular multi-picks; null preserves the full selection. */
  readonly collapseTo: string | null
  /** True when this click just committed a Tab chain pre-highlight. */
  readonly committedPreview: boolean
}

/**
 * Resolve a primary-button press on a 2D drafted item:
 * 1. If a Tab-cycled chain pre-highlight covers `itemId`, commit the entire
 *    chain and lock it against pointer-up collapse.
 * 2. If the item is part of an already Tab-selected chain (`chainLocked`),
 *    preserve the full chain on click (users can drag it immediately or click
 *    empty canvas / Esc to clear).
 * 3. Otherwise keep standard multi-pick / single-pick behavior.
 */
export function resolveDraftItemClick(input: {
  readonly itemId: string
  readonly selectedIds: readonly string[]
  readonly chainLocked: boolean
  readonly tabPreview: DraftTabState | null
}): DraftClickResolution {
  const { itemId, selectedIds, chainLocked, tabPreview } = input
  if (tabPreview && tabPreview.mode === 'chain' && tabPreview.ids.length > 1 && tabPreview.ids.includes(itemId)) {
    return { ids: tabPreview.ids, chainLocked: true, collapseTo: null, committedPreview: true }
  }
  const inPick = selectedIds.length > 1 && selectedIds.includes(itemId)
  if (inPick && chainLocked) {
    return { ids: selectedIds, chainLocked: true, collapseTo: null, committedPreview: false }
  }
  if (inPick) {
    return { ids: selectedIds, chainLocked: false, collapseTo: itemId, committedPreview: false }
  }
  return { ids: [itemId], chainLocked: false, collapseTo: null, committedPreview: false }
}

export interface DraftCreateSimilarResult {
  readonly tool: string
  readonly settings: DraftSettings
  readonly label: string
}

function formatInchesFromMm(mm: number): string {
  const inches = mm / 25.4
  const rounded = Math.round(inches * 16) / 16
  if (Number.isFinite(rounded) && rounded > 0) return `${rounded}"`
  return `${Math.round(mm)}mm`
}

/**
 * Create Similar (`CS`) for any 2D drafting item: selects the matching drawing
 * tool and copies its line style, fill, component symbol, batt thickness, or
 * dimension kind into `DraftSettings`. Returns null for unsupported items
 * (tags are handled separately via `startTagLike`).
 */
export function draftCreateSimilarFor(item: DrawingItem, current: DraftSettings): DraftCreateSimilarResult | null {
  if (item.tag) return null
  const withStyle = (base: DraftSettings): DraftSettings => ({
    ...base,
    weight: item.lineStyle?.weight ?? base.weight,
    pattern: item.lineStyle?.pattern ?? base.pattern,
  })

  if (item.dim) {
    return {
      tool: 'dimension',
      settings: {
        ...current,
        dimKind: item.dim.kind,
        dimChain: item.dim.chain ?? 'single',
      },
      label: `${item.dim.kind.replace(/_/g, ' ')} dimension`,
    }
  }

  switch (item.shape) {
    case 'line':
      return { tool: 'line', settings: withStyle(current), label: 'detail line' }
    case 'polyline':
      return { tool: 'polyline', settings: withStyle(current), label: 'line chain' }
    case 'rect':
      return { tool: 'rect', settings: withStyle(current), label: 'rectangle' }
    case 'arc':
      return { tool: 'arc', settings: withStyle(current), label: 'arc' }
    case 'circle':
      return { tool: 'circle', settings: withStyle(current), label: 'circle' }
    case 'spline':
      return { tool: 'spline', settings: withStyle(current), label: 'spline' }
    case 'region': {
      const fill = item.fill
      const masking = Boolean(fill?.masking)
      return {
        tool: 'region',
        settings: {
          ...withStyle(current),
          masking,
          ...(fill && !masking ? { hatch: fill.pattern, regionTone: fill.tone ?? 'ink' } : {}),
        },
        label: masking ? 'masking region' : 'filled region',
      }
    }
    case 'component':
      return {
        tool: 'component',
        settings: { ...current, ...(item.component?.symbolId ? { symbolId: item.component.symbolId } : {}) },
        label: 'detail component',
      }
    case 'repeat':
      return {
        tool: 'repeat',
        settings: { ...current, ...(item.component?.symbolId ? { symbolId: item.component.symbolId } : {}) },
        label: 'repeating component',
      }
    case 'batt':
      return {
        tool: 'batt',
        settings: {
          ...current,
          ...(item.batt?.thicknessMm ? { battThickness: formatInchesFromMm(item.batt.thicknessMm) } : {}),
        },
        label: 'batt insulation',
      }
    case 'text':
      return { tool: 'text', settings: current, label: 'text note' }
    case 'cloud':
      return { tool: 'cloud', settings: withStyle(current), label: 'revision cloud' }
    case 'callout':
      return { tool: 'callout', settings: current, label: 'callout' }
    default:
      return null
  }
}
