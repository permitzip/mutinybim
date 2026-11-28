import { useEffect, useSyncExternalStore } from 'react'

/**
 * Configurable plan / drag / route snap grid increment, persisted per user in
 * `localStorage` and shared across the 3D canvas, drawings, routing panel, and
 * bottom status bar.
 *
 * `0` means Free (rounds to 1 mm without jumping in 6" / 12" increments).
 */

const MM_PER_IN = 25.4

export interface SnapGridOption {
  readonly mm: number
  readonly label: string
  readonly shortLabel: string
}

export const SNAP_GRID_OPTIONS: readonly SnapGridOption[] = [
  { mm: 0, label: 'Free (1 mm)', shortLabel: 'Free' },
  { mm: 0.5 * MM_PER_IN, label: '1/2"', shortLabel: '1/2"' },
  { mm: 1 * MM_PER_IN, label: '1"', shortLabel: '1"' },
  { mm: 3 * MM_PER_IN, label: '3"', shortLabel: '3"' },
  { mm: 6 * MM_PER_IN, label: '6" (default)', shortLabel: '6"' },
  { mm: 12 * MM_PER_IN, label: '12"', shortLabel: '12"' },
] as const

/** Default snap increment (6" = 152.4 mm), matching the historical GRID_MM. */
export const DEFAULT_SNAP_GRID_MM = 6 * MM_PER_IN

const STORAGE_PREFIX = 'mutinybim:snap-grid-mm:v1:'

function storageKey(userId?: string): string {
  return `${STORAGE_PREFIX}${userId?.trim() || 'default'}`
}

function isValidSnapMm(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000
}

/** Human-readable short label for any snap step in mm (`0` -> `Free`, `152.4` -> `6"`). */
export function snapGridLabel(stepMm: number): string {
  if (!Number.isFinite(stepMm) || stepMm <= 0) return 'Free'
  const match = SNAP_GRID_OPTIONS.find((opt) => opt.mm > 0 && Math.abs(opt.mm - stepMm) < 0.05)
  if (match) return match.shortLabel
  const inches = stepMm / MM_PER_IN
  if (Math.abs(inches - Math.round(inches)) < 0.01) return `${Math.round(inches)}"`
  return `${Math.round(stepMm)} mm`
}

/**
 * Snap a scalar length/coordinate (mm) to `stepMm`.
 * When `stepMm <= 0` (Free), rounds cleanly to the nearest 1 mm without
 * jumping in 6" or 12" increments.
 */
export function snapToIncrement(value: number, stepMm: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(stepMm) || stepMm <= 0) return Math.round(value) || 0
  return (Math.round(Math.round(value / stepMm) * stepMm * 1000) / 1000) || 0
}

/** Read a user's persisted snap increment from `localStorage`, defaulting to 6" (152.4 mm). */
export function readSnapGridMm(userId?: string): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SNAP_GRID_MM
    const raw = localStorage.getItem(storageKey(userId))
    if (raw === null) return DEFAULT_SNAP_GRID_MM
    const parsed = Number(raw)
    return isValidSnapMm(parsed) ? parsed : DEFAULT_SNAP_GRID_MM
  } catch {
    return DEFAULT_SNAP_GRID_MM
  }
}

/** Persist a user's snap increment to `localStorage`. */
export function writeSnapGridMm(mm: number, userId?: string): void {
  if (!isValidSnapMm(mm)) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(storageKey(userId), String(mm))
  } catch {
    // Private browsing or unavailable storage: keep in-memory state only.
  }
}

let currentSnapGridMm: number = DEFAULT_SNAP_GRID_MM
let activeUserId: string | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function getSnapGridMm(): number {
  return currentSnapGridMm
}

export function subscribeSnapGridMm(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function initSnapGridForUser(userId?: string): number {
  activeUserId = userId
  const next = readSnapGridMm(userId)
  if (next !== currentSnapGridMm) {
    currentSnapGridMm = next
    emit()
  }
  return currentSnapGridMm
}

export function setSnapGridMm(mm: number, userId?: string): void {
  if (!isValidSnapMm(mm)) return
  const targetUser = userId ?? activeUserId
  writeSnapGridMm(mm, targetUser)
  if (mm === currentSnapGridMm) return
  currentSnapGridMm = mm
  emit()
}

/** Cycle through the preset increments (`Free` -> `1/2"` -> `1"` -> `3"` -> `6"` -> `12"` -> `Free`). */
export function cycleSnapGridMm(userId?: string): number {
  const idx = SNAP_GRID_OPTIONS.findIndex((o) => Math.abs(o.mm - currentSnapGridMm) < 0.05)
  const next = SNAP_GRID_OPTIONS[(idx + 1) % SNAP_GRID_OPTIONS.length] ?? SNAP_GRID_OPTIONS[0]!
  setSnapGridMm(next.mm, userId)
  return next.mm
}

export function useSnapGridMm(userId?: string): number {
  useEffect(() => {
    if (userId !== undefined) initSnapGridForUser(userId)
  }, [userId])
  return useSyncExternalStore(subscribeSnapGridMm, getSnapGridMm, () => DEFAULT_SNAP_GRID_MM)
}
