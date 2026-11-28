import type { OpenItem } from './types'

/**
 * Persist the user's last-open view or sheet per project / model in
 * `localStorage` so reopening or refreshing the Building Model lands right
 * back where they were working.
 */

const STORAGE_PREFIX = 'mutinybim:last-open-view:v1:'

export interface LastOpenScope {
  readonly projectId: string
  readonly modelId?: string | null
  readonly userId?: string
}

export function lastOpenStorageKey(scope: LastOpenScope): string {
  const proj = scope.projectId.trim() || 'default'
  const model = scope.modelId?.trim() || 'default'
  const user = scope.userId?.trim() || 'default'
  return `${STORAGE_PREFIX}${proj}:${model}:${user}`
}

function isOpenItem(value: unknown): value is OpenItem {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  const rec = value as Record<string, unknown>
  if (rec.kind === 'model') return rec.mode === '3d' || rec.mode === 'plan'
  if (rec.kind === 'view' || rec.kind === 'sheet') return typeof rec.id === 'string' && rec.id.trim().length > 0 && rec.id.length <= 200
  return false
}

export function readLastOpenItem(scope: LastOpenScope): OpenItem | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(lastOpenStorageKey(scope))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isOpenItem(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeLastOpenItem(scope: LastOpenScope, item: OpenItem): void {
  if (!isOpenItem(item)) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(lastOpenStorageKey(scope), JSON.stringify(item))
  } catch {
    // Private browsing or quota errors: degrade cleanly without throwing.
  }
}

export function clearLastOpenItem(scope: LastOpenScope): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(lastOpenStorageKey(scope))
  } catch {
    // Ignore storage unavailability.
  }
}
