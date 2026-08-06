import { createLocalStorageHook } from './create-local-storage-hook'

export type HideZeroUnreadFeeds = 'on' | 'off'

// Defaults to 'on': the sidebar is a work queue, so feeds with nothing left to
// read are hidden until they pick up new articles.
const useHook = createLocalStorageHook<HideZeroUnreadFeeds>('hide-zero-unread-feeds', 'on', ['on', 'off'])

export function useHideZeroUnreadFeeds() {
  const [hideZeroUnreadFeeds, setHideZeroUnreadFeeds] = useHook()
  return { hideZeroUnreadFeeds, setHideZeroUnreadFeeds }
}
