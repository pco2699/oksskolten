import { useState, useEffect } from 'react'
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from './use-keyboard-navigation'

const STORAGE_KEY = 'keybindings'

const PRINTABLE_RE = /^[!-~]$/

/** Fields every stored keybindings object must have. */
const REQUIRED_FIELDS = ['next', 'prev', 'bookmark', 'openExternal'] as const
/** Newer fields that may be absent on values stored before they were introduced — backfilled from defaults rather than rejected. */
const OPTIONAL_FIELDS = ['toggleRead'] as const

/**
 * Tolerant on purpose: legacy stored values only have the 4 required fields.
 * Those remain valid so they aren't discarded wholesale — missing optional
 * fields (e.g. toggleRead) are backfilled with defaults by getStored().
 */
function isValidKeybindings(value: unknown): value is Partial<KeyBindings> {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || !PRINTABLE_RE.test(obj[field] as string)) return false
  }
  for (const field of OPTIONAL_FIELDS) {
    if (field in obj && (typeof obj[field] !== 'string' || !PRINTABLE_RE.test(obj[field] as string))) return false
  }
  return true
}

function getStored(): KeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_KEY_BINDINGS
    const parsed = JSON.parse(raw)
    if (!isValidKeybindings(parsed)) return DEFAULT_KEY_BINDINGS
    // Backfill any fields introduced after this value was stored (e.g. legacy 4-field data).
    return { ...DEFAULT_KEY_BINDINGS, ...parsed }
  } catch {
    return DEFAULT_KEY_BINDINGS
  }
}

export function useKeybindingsSetting() {
  const [keybindings, setKeybindingsState] = useState<KeyBindings>(getStored)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings))
  }, [keybindings])

  return { keybindings, setKeybindings: setKeybindingsState }
}
