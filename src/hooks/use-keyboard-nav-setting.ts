import { createLocalStorageHook } from './create-local-storage-hook'

export type KeyboardNavSetting = 'on' | 'off'

const useHook = createLocalStorageHook<KeyboardNavSetting>('keyboard-navigation', 'on', ['on', 'off'])

export function useKeyboardNavSetting() {
  const [keyboardNavigation, setKeyboardNavigation] = useHook()
  return { keyboardNavigation, setKeyboardNavigation }
}
