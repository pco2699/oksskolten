import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeybindingsSetting } from './use-keybindings-setting'
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from './use-keyboard-navigation'

const STORAGE_KEY = 'keybindings'

describe('useKeybindingsSetting', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default keybindings when localStorage is empty', () => {
    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEY_BINDINGS)
  })

  it('returns stored keybindings from localStorage', () => {
    const custom: KeyBindings = { next: 'n', prev: 'p', bookmark: 'x', openExternal: 'o', toggleRead: 'r' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(custom)
  })

  it('persists keybindings to localStorage when set', () => {
    const { result } = renderHook(() => useKeybindingsSetting())
    const custom: KeyBindings = { next: 'n', prev: 'p', bookmark: 'x', openExternal: 'o', toggleRead: 'r' }

    act(() => {
      result.current.setKeybindings(custom)
    })

    expect(result.current.keybindings).toEqual(custom)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(custom)
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEY_BINDINGS)
  })

  it('falls back to defaults when localStorage contains incomplete data', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ next: 'n' }))

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEY_BINDINGS)
  })

  it('backfills toggleRead with the default when stored data only has the 4 legacy fields', () => {
    // Values stored before `toggleRead` was introduced only had these 4 keys.
    const legacy = { next: 'n', prev: 'p', bookmark: 'x', openExternal: 'o' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual({ ...legacy, toggleRead: DEFAULT_KEY_BINDINGS.toggleRead })
  })

  it('accepts a stored value with an invalid toggleRead the same way it would reject other invalid fields', () => {
    const invalid = { next: 'n', prev: 'p', bookmark: 'x', openExternal: 'o', toggleRead: 'not-single-char' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(invalid))

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEY_BINDINGS)
  })
})
