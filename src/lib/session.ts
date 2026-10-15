import { acquireLibraryLock } from './storage'

// One promise per page, shared by StrictMode remounts and UI updates.
// The browser releases this document's lock automatically when the tab closes.
let access: Promise<boolean> | undefined
export function getWriterAccess(): Promise<boolean> {
  access ??= acquireLibraryLock().then(release => !!release).catch(() => false)
  return access
}
