import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardNavigation } from './use-keyboard-navigation'

function fireKey(key: string, options: Partial<KeyboardEvent> = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
}

describe('useKeyboardNavigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('j/k focus movement', () => {
    it('focuses the first item when j is pressed with no current focus', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      fireKey('j')
      expect(onFocusChange).toHaveBeenCalledWith('a')
    })

    it('focuses the first item when k is pressed with no current focus', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      fireKey('k')
      expect(onFocusChange).toHaveBeenCalledWith('a')
    })

    it('moves focus to the next item when j is pressed', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: 'a',
        onFocusChange,
        enabled: true,
      }))

      fireKey('j')
      expect(onFocusChange).toHaveBeenCalledWith('b')
    })

    it('moves focus to the previous item when k is pressed', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: 'b',
        onFocusChange,
        enabled: true,
      }))

      fireKey('k')
      expect(onFocusChange).toHaveBeenCalledWith('a')
    })
  })

  describe('boundary behavior', () => {
    it('does nothing when j is pressed at the end of the list', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: 'c',
        onFocusChange,
        enabled: true,
      }))

      fireKey('j')
      expect(onFocusChange).not.toHaveBeenCalled()
    })

    it('does nothing when k is pressed at the start of the list', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: 'a',
        onFocusChange,
        enabled: true,
      }))

      fireKey('k')
      expect(onFocusChange).not.toHaveBeenCalled()
    })
  })

  describe('stale focusedItemId', () => {
    it('resets to first item when focusedItemId is not in items', () => {
      const items = ['a', 'b', 'c']
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items,
        focusedItemId: 'deleted-item',
        onFocusChange,
        enabled: true,
      }))

      fireKey('j')
      expect(onFocusChange).toHaveBeenCalledWith('a')
    })
  })

  describe('dialog detection', () => {
    it('ignores keys when a non-passthrough dialog is open', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('data-state', 'open')
      document.body.appendChild(dialog)

      fireKey('j')
      expect(onFocusChange).not.toHaveBeenCalled()

      document.body.removeChild(dialog)
    })

    it('allows keys when only a passthrough dialog is open', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('data-state', 'open')
      dialog.setAttribute('data-keyboard-nav-passthrough', '')
      document.body.appendChild(dialog)

      fireKey('j')
      expect(onFocusChange).toHaveBeenCalledWith('a')

      document.body.removeChild(dialog)
    })
  })

  describe('empty list', () => {
    it('does nothing when j is pressed on an empty list', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: [],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      fireKey('j')
      expect(onFocusChange).not.toHaveBeenCalled()
    })

    it('does nothing when k is pressed on an empty list', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: [],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      fireKey('k')
      expect(onFocusChange).not.toHaveBeenCalled()
    })
  })

  describe('input field conflict avoidance', () => {
    it('ignores j/k when target is an INPUT element', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      expect(onFocusChange).not.toHaveBeenCalled()
      document.body.removeChild(input)
    })

    it('ignores j/k when target is a TEXTAREA element', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      expect(onFocusChange).not.toHaveBeenCalled()
      document.body.removeChild(textarea)
    })

    it('ignores j/k when target is contentEditable', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      const div = document.createElement('div')
      div.setAttribute('contenteditable', 'true')
      document.body.appendChild(div)
      div.focus()
      div.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      expect(onFocusChange).not.toHaveBeenCalled()
      document.body.removeChild(div)
    })
  })

  describe('Enter callback', () => {
    it('calls onEnter when Enter is pressed with a focused item', () => {
      const onEnter = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onEnter,
        enabled: true,
      }))

      fireKey('Enter')
      expect(onEnter).toHaveBeenCalledWith('a')
    })

    it('does not call onEnter when no item is focused', () => {
      const onEnter = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange: vi.fn(),
        onEnter,
        enabled: true,
      }))

      fireKey('Enter')
      expect(onEnter).not.toHaveBeenCalled()
    })
  })

  describe('Escape callback', () => {
    it('calls onEscape when Escape is pressed', () => {
      const onEscape = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onEscape,
        enabled: true,
      }))

      fireKey('Escape')
      expect(onEscape).toHaveBeenCalledOnce()
    })
  })

  describe('action callbacks', () => {
    it('calls onBookmarkToggle when b is pressed with a focused item', () => {
      const onBookmarkToggle = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onBookmarkToggle,
        enabled: true,
      }))

      fireKey('b')
      expect(onBookmarkToggle).toHaveBeenCalledWith('a')
    })

    it('calls onOpenExternal when ; is pressed with a focused item', () => {
      const onOpenExternal = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onOpenExternal,
        enabled: true,
      }))

      fireKey(';')
      expect(onOpenExternal).toHaveBeenCalledWith('a')
    })

    it('does not call action callbacks when no item is focused', () => {
      const onBookmarkToggle = vi.fn()
      const onOpenExternal = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange: vi.fn(),
        onBookmarkToggle,
        onOpenExternal,
        enabled: true,
      }))

      fireKey('b')
      fireKey(';')
      expect(onBookmarkToggle).not.toHaveBeenCalled()
      expect(onOpenExternal).not.toHaveBeenCalled()
    })
  })

  describe('enabled flag', () => {
    it('does not respond to keys when disabled', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: false,
      }))

      fireKey('j')
      expect(onFocusChange).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('removes listener on unmount', () => {
      const onFocusChange = vi.fn()
      const { unmount } = renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange,
        enabled: true,
      }))

      unmount()
      fireKey('j')
      expect(onFocusChange).not.toHaveBeenCalled()
    })
  })

  describe('custom keyBindings', () => {
    it('calls onFocusChange when custom next key is pressed', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b', 'c'],
        focusedItemId: 'a',
        onFocusChange,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('n')
      expect(onFocusChange).toHaveBeenCalledWith('b')
    })

    it('does not respond to default j when custom next key is set', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b', 'c'],
        focusedItemId: 'a',
        onFocusChange,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('j')
      expect(onFocusChange).not.toHaveBeenCalled()
    })

    it('uses custom prev key', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b', 'c'],
        focusedItemId: 'b',
        onFocusChange,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('p')
      expect(onFocusChange).toHaveBeenCalledWith('a')
    })

    it('uses custom bookmark key', () => {
      const onBookmarkToggle = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onBookmarkToggle,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('m')
      expect(onBookmarkToggle).toHaveBeenCalledWith('a')
    })

    it('uses custom openExternal key', () => {
      const onOpenExternal = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onOpenExternal,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('o')
      expect(onOpenExternal).toHaveBeenCalledWith('a')
    })

    it('uses custom toggleRead key', () => {
      const onToggleRead = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onToggleRead,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('t')
      expect(onToggleRead).toHaveBeenCalledWith('a')
    })

    it('does not respond to default m when custom toggleRead key is set', () => {
      const onToggleRead = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onToggleRead,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'b', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('m')
      expect(onToggleRead).not.toHaveBeenCalled()
    })

    it('falls back to defaults when keyBindings is not provided', () => {
      const onFocusChange = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b', 'c'],
        focusedItemId: 'a',
        onFocusChange,
        enabled: true,
      }))

      fireKey('j')
      expect(onFocusChange).toHaveBeenCalledWith('b')
    })
  })

  describe('Feedly-style fixed keys', () => {
    it('calls onEnter when o is pressed with a focused item (list-style open)', () => {
      const onEnter = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onEnter,
        enabled: true,
      }))

      fireKey('o')
      expect(onEnter).toHaveBeenCalledWith('a')
    })

    it('does nothing when o is pressed and onEnter is not provided (detail/overlay no-op)', () => {
      const onEscape = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onEscape,
        enabled: true,
      }))

      fireKey('o')
      expect(onEscape).not.toHaveBeenCalled()
    })

    it('calls onOpenExternal when v is pressed with a focused item', () => {
      const onOpenExternal = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onOpenExternal,
        enabled: true,
      }))

      fireKey('v')
      expect(onOpenExternal).toHaveBeenCalledWith('a')
    })

    it('calls onBookmarkToggle when s is pressed with a focused item', () => {
      const onBookmarkToggle = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onBookmarkToggle,
        enabled: true,
      }))

      fireKey('s')
      expect(onBookmarkToggle).toHaveBeenCalledWith('a')
    })

    it('calls onToggleRead when m is pressed with a focused item', () => {
      const onToggleRead = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onToggleRead,
        enabled: true,
      }))

      fireKey('m')
      expect(onToggleRead).toHaveBeenCalledWith('a')
    })

    it('does not call onToggleRead when no item is focused', () => {
      const onToggleRead = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange: vi.fn(),
        onToggleRead,
        enabled: true,
      }))

      fireKey('m')
      expect(onToggleRead).not.toHaveBeenCalled()
    })

    it('calls onMarkAllRead when Shift+A is pressed', () => {
      const onMarkAllRead = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange: vi.fn(),
        onMarkAllRead,
        enabled: true,
      }))

      fireKey('A', { shiftKey: true })
      expect(onMarkAllRead).toHaveBeenCalledOnce()
    })

    it('does not call onMarkAllRead for a plain a keypress', () => {
      const onMarkAllRead = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: null,
        onFocusChange: vi.fn(),
        onMarkAllRead,
        enabled: true,
      }))

      fireKey('a')
      expect(onMarkAllRead).not.toHaveBeenCalled()
    })

    it('does not break existing custom bookmark binding of m when onToggleRead is absent', () => {
      const onBookmarkToggle = vi.fn()
      renderHook(() => useKeyboardNavigation({
        items: ['a', 'b'],
        focusedItemId: 'a',
        onFocusChange: vi.fn(),
        onBookmarkToggle,
        enabled: true,
        keyBindings: { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o', toggleRead: 't' },
      }))

      fireKey('m')
      expect(onBookmarkToggle).toHaveBeenCalledWith('a')
    })
  })
})
