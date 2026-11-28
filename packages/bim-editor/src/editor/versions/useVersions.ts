'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedVersion } from '@permitzip/bim-kernel'
import { versionEntries, type IssuedSet, type VersionEntry } from '../../contracts/building-model/branch-versions'
import { useEditorHost } from '@permitzip/bim-editor/host'
import { EditorServiceUnavailableError } from '@permitzip/bim-editor/host/unavailable'
import { fetchSetStatusFrom } from '../views-sheets/drawing-set-client'
import { ask, type BranchChannel } from '../branches/useBranches'

export type VersionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly entries: readonly VersionEntry[]; readonly issuedError: string | null }

const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_MS = 1200

/**
 * True when an error from the authority channel or issued-sets endpoint is
 * likely transient (network drop, gateway 5xx, timeout, disconnected socket,
 * or an optional host service that is not wired in this environment).
 */
export function isTransientVersionsError(err: unknown): boolean {
  if (err instanceof EditorServiceUnavailableError) return true
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  const msg = err.message.toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('not connected') ||
    msg.includes('disconnected') ||
    msg.includes('closed') ||
    /http\s*5\d\d/.test(msg) ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  )
}

/**
 * Manage › Versions: saved versions and "now" from the model server, issued
 * sets from Views & Sheets' set history.
 *
 * Resilient against transient authority/issued-sets failures:
 * - An optional/unavailable drawing-sets service or transient issued-sets
 *   network failure degrades gracefully to listing saved versions without
 *   spamming `console.error` or blocking toasts.
 * - Transient authority errors perform bounded silent retries with backoff,
 *   and preserve previously loaded entries when a background refresh fails.
 */
export function useVersions(input: { readonly channel: BranchChannel | null; readonly connected: boolean; readonly projectId: string; readonly modelId: string | null; readonly names?: Readonly<Record<string, string>> }) {
  const { channel, connected, projectId, modelId, names } = input
  const drawingSets = useEditorHost().data.drawingSets
  const [nonce, setNonce] = useState(0)
  // The answer remembers which request it answers; anything else reads as loading.
  const [answer, setAnswer] = useState<{ readonly key: string; readonly channel: BranchChannel; readonly state: VersionsState } | null>(null)
  const lastReadyRef = useRef<{ readonly modelId: string; readonly entries: readonly VersionEntry[] } | null>(null)
  const warnedKeyRef = useRef<string | null>(null)
  const key = `${modelId ?? ''}:${nonce}`

  useEffect(() => {
    if (!channel || !connected || !modelId) return
    let live = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const load = (attempt: number) => {
      const issued: Promise<{ readonly sets: readonly IssuedSet[]; readonly error: string | null }> = !drawingSets
        ? Promise.resolve({ sets: [], error: null })
        : fetchSetStatusFrom(drawingSets, projectId, modelId).then(
            (status) => ({ sets: status.history.issues, error: null }),
            (err: unknown) => {
              const transient = isTransientVersionsError(err)
              if (err instanceof EditorServiceUnavailableError) {
                return { sets: [], error: null }
              }
              const warnId = `issued:${modelId}`
              if (warnedKeyRef.current !== warnId) {
                warnedKeyRef.current = warnId
                if (transient) console.warn('[versions] issued sets temporarily unavailable; listing saved versions', err)
                else console.error('[versions] reading issued sets failed; listing the rest', err)
              }
              return {
                sets: [],
                error: transient
                  ? 'Issued sets are temporarily unavailable; saved versions are still shown.'
                  : err instanceof Error
                    ? err.message
                    : "Couldn't read issued sets.",
              }
            },
          )

      Promise.all([ask(channel, { type: 'version_list' }, 'versions'), issued]).then(
        ([saved, sets]) => {
          if (!live) return
          const versions: readonly SavedVersion[] = saved.versions
          const entries = versionEntries({ head: saved.head, saved: versions, issued: sets.sets, ...(names ? { names } : {}) })
          lastReadyRef.current = { modelId, entries }
          setAnswer({ key, channel, state: { status: 'ready', entries, issuedError: sets.error } })
        },
        (err: unknown) => {
          if (!live) return
          const transient = isTransientVersionsError(err)
          if (transient && attempt < MAX_TRANSIENT_RETRIES) {
            retryTimer = setTimeout(() => {
              if (live) load(attempt + 1)
            }, RETRY_BASE_MS * (attempt + 1))
            return
          }
          const warnId = `versions:${modelId}:${attempt}`
          if (warnedKeyRef.current !== warnId) {
            warnedKeyRef.current = warnId
            if (transient) console.warn('[versions] authority temporarily unavailable while listing versions', err)
            else console.error('[versions] listing versions failed', err)
          }
          // Preserve last known ready entries on transient refresh failures rather than replacing the list with an error.
          const cached = lastReadyRef.current
          if (transient && cached && cached.modelId === modelId) {
            setAnswer({
              key,
              channel,
              state: {
                status: 'ready',
                entries: cached.entries,
                issuedError: 'Version history could not be refreshed right now; showing the last loaded list.',
              },
            })
            return
          }
          setAnswer({
            key,
            channel,
            state: {
              status: 'error',
              message: transient
                ? 'Version history is temporarily unavailable. Try Retry in a moment.'
                : err instanceof Error
                  ? err.message
                  : "Couldn't list versions.",
            },
          })
        },
      )
    }

    load(0)
    return () => {
      live = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [drawingSets, channel, connected, projectId, modelId, names, key])

  const state: VersionsState = answer && answer.key === key && answer.channel === channel ? answer.state : { status: 'loading' }

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const save = useCallback(
    async (name: string) => {
      if (!channel) throw new Error('Not connected to the model server yet. Try again in a moment.')
      await ask(channel, { type: 'version_save', name }, 'version_saved')
      reload()
    },
    [channel, reload],
  )

  return { state, reload, save }
}
