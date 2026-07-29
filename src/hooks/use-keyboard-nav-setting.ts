import { createLocalStorageHook } from './create-local-storage-hook'

export type KeyboardNavSetting = 'on' | 'off'

// createLocalStorageHook eagerly writes the current value on every mount, so
// any browser that has ever loaded the app already has the old key
// persisted regardless of whether the user touched the setting. Move to a
// new key so the 'on' default actually takes effect, and drop the stale key.
localStorage.removeItem('keyboard-navigation')

const useHook = createLocalStorageHook<KeyboardNavSetting>('keyboard-navigation-v2', 'on', ['on', 'off'])

export function useKeyboardNavSetting() {
  const [keyboardNavigation, setKeyboardNavigation] = useHook()
  return { keyboardNavigation, setKeyboardNavigation }
}
