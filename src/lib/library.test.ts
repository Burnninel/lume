import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canMoveFolder, getFolderDescendants, parseOutline, uniqueName, validateLibrary } from './library'
import { createSeedLibrary } from './seed'
import { exportBackup, importBackup, loadLibrary, loadPreviousLibrary, restoreLibrary, saveLibrary, savePendingDraft } from './storage'

beforeEach(async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lume-library')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('An earlier test left the database open.'))
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('portable backups', () => {
  it('round-trips documents, folders, preferences, favorites and deleted documents', () => {
    const library = createSeedLibrary(100)
    library.documents[1].deletedAt = 200
    library.settings.theme = 'dark'
    expect(importBackup(exportBackup(library))).toEqual(library)
  })

  it('rejects an unsupported version without accepting its data', () => {
    const backup = JSON.parse(exportBackup(createSeedLibrary(100)))
    backup.version = 999
    expect(() => importBackup(JSON.stringify(backup))).toThrow('versão')
    expect(() => importBackup('{broken')).toThrow('JSON')
  })

  it('rejects duplicated ids, missing folders and invalid active document pointers', () => {
    const duplicate = createSeedLibrary(100)
    duplicate.documents[1].id = duplicate.documents[0].id
    expect(() => validateLibrary(duplicate)).toThrow('repetidos')
    const missing = createSeedLibrary(100)
    missing.documents[0].folderId = 'absent'
    expect(() => validateLibrary(missing)).toThrow('não foi encontrada')
    const dangling = createSeedLibrary(100)
    dangling.activeId = 'absent'
    expect(() => validateLibrary(dangling)).toThrow('não foi encontrado')
    const deleted = createSeedLibrary(100)
    deleted.documents[0].deletedAt = 200
    expect(validateLibrary(deleted).activeId).toBe(deleted.documents[0].id)
  })

  it('rejects folder cycles and broken parent references', () => {
    const cyclic = createSeedLibrary(100)
    cyclic.folders[0].parentId = cyclic.folders[1].id
    cyclic.folders[1].parentId = cyclic.folders[0].id
    expect(() => validateLibrary(cyclic)).toThrow('ciclo')
    const orphan = createSeedLibrary(100)
    orphan.folders[0].parentId = 'missing'
    expect(() => validateLibrary(orphan)).toThrow('superior')
  })

  it('rejects oversized content and malformed preferences', () => {
    const huge = createSeedLibrary(100)
    huge.documents[0].content = 'a'.repeat(10_000_001)
    expect(() => validateLibrary(huge)).toThrow('limite')
    const invalid = createSeedLibrary(100)
    invalid.settings.fontSize = Infinity
    expect(() => validateLibrary(invalid)).toThrow('fonte')
  })
})

describe('durable library', () => {
  it('initializes once and preserves edits across fresh loads', async () => {
    const initial = await loadLibrary()
    initial.documents[0].content = '# Uma ideia persistente'
    await saveLibrary(initial)
    const restored = await loadLibrary()
    expect(restored.documents[0].content).toBe('# Uma ideia persistente')
    expect(restored.folders).toEqual(initial.folders)
  })

  it('serializes overlapping writes and captures data at invocation time', async () => {
    const library = createSeedLibrary(100)
    library.documents[0].content = 'first'
    const first = saveLibrary(library)
    library.documents[0].content = 'second'
    const second = saveLibrary(library)
    library.documents[0].content = 'not saved'
    await Promise.all([first, second])
    expect((await loadLibrary()).documents[0].content).toBe('second')
    expect((await loadPreviousLibrary())?.documents[0].content).toBe('first')
  })

  it('rejects invalid writes without poisoning the queue or overwriting the library', async () => {
    const valid = createSeedLibrary(100)
    await saveLibrary(valid)
    const invalid = createSeedLibrary(100)
    invalid.documents[0].folderId = 'missing'
    await expect(saveLibrary(invalid)).rejects.toThrow('inválidos')
    expect(await loadLibrary()).toEqual(valid)
    valid.documents[0].content = 'next valid update'
    await saveLibrary(valid)
    expect((await loadLibrary()).documents[0].content).toBe('next valid update')
  })

  it('preserves corrupt data instead of silently resetting it or overwriting it', async () => {
    const original = createSeedLibrary(100)
    await saveLibrary(original)
    original.documents[0].content = 'new version'
    await saveLibrary(original)
    await writeRawSnapshot({ broken: true })
    await expect(loadLibrary()).rejects.toThrow('preservados')
    await expect(saveLibrary(createSeedLibrary(100))).rejects.toThrow('preservada')
    expect((await loadPreviousLibrary())?.documents[0].content).not.toBe('new version')
    await expect(loadLibrary()).rejects.toThrow('preservados')
  })

  it('allows explicit recovery while archiving the original corrupt snapshot', async () => {
    await saveLibrary(createSeedLibrary(100))
    await writeRawSnapshot({ broken: true })
    const recovered = createSeedLibrary(200)
    recovered.documents[0].content = 'recovered'
    await restoreLibrary(recovered)
    expect(await loadLibrary()).toEqual(recovered)
    expect(await readRawSnapshots()).toContainEqual({ broken: true })
  })
})

describe('emergency drafts', () => {
  it('recovers newer text on load and only clears it after that text is committed', async () => {
    const original = createSeedLibrary(100)
    await saveLibrary(original)
    savePendingDraft({ id: 'welcome', content: 'last typed paragraph', updatedAt: 200 })
    // An already queued older write must not delete a newer emergency draft.
    await saveLibrary(original)
    expect(localStorage.getItem('lume-pending-drafts-v1')).not.toBeNull()
    const recovered = await loadLibrary()
    expect(recovered.documents[0].content).toBe('last typed paragraph')
    expect(recovered.documents[0].updatedAt).toBe(200)
    await saveLibrary(recovered)
    expect(localStorage.getItem('lume-pending-drafts-v1')).toBeNull()
    expect((await loadLibrary()).documents[0].content).toBe('last typed paragraph')
  })

  it('does not overwrite a newer saved document with an old draft or resurrect trash', async () => {
    const original = createSeedLibrary(200)
    original.documents[1].deletedAt = 300
    await saveLibrary(original)
    savePendingDraft({ id: 'welcome', content: 'obsolete text', updatedAt: 100 })
    savePendingDraft({ id: 'workspace-guide', content: 'discarded text', updatedAt: 400 })
    expect((await loadLibrary()).documents).toEqual(original.documents)
  })

  it('keeps a newer draft if a delayed handler tries to store an older value', () => {
    savePendingDraft({ id: 'welcome', content: 'new', updatedAt: 200 })
    savePendingDraft({ id: 'welcome', content: 'old', updatedAt: 100 })
    expect(JSON.parse(localStorage.getItem('lume-pending-drafts-v1')!).drafts[0].content).toBe('new')
  })

  it('bounds emergency storage without dropping the previous saved draft', () => {
    savePendingDraft({ id: 'welcome', content: 'keep me', updatedAt: 200 })
    expect(() => savePendingDraft({ id: 'welcome', content: 'a'.repeat(2_000_001), updatedAt: 300 })).toThrow('cópia de emergência')
    expect(JSON.parse(localStorage.getItem('lume-pending-drafts-v1')!).drafts[0].content).toBe('keep me')
  })

  it('explicit recovery archives a malformed emergency copy before removing it', async () => {
    const original = createSeedLibrary(100)
    await saveLibrary(original)
    localStorage.setItem('lume-pending-drafts-v1', '{broken')
    await expect(loadLibrary()).rejects.toThrow('preservados')
    await restoreLibrary(original)
    expect(localStorage.getItem('lume-pending-drafts-v1')).toBeNull()
    expect(await readRawSnapshots()).toContain('{broken')
    expect(await loadLibrary()).toEqual(original)
  })
})

describe('folder organization', () => {
  const folders = [
    { id: 'a', parentId: null, name: 'A', createdAt: 1 },
    { id: 'b', parentId: 'a', name: 'B', createdAt: 1 },
    { id: 'c', parentId: 'b', name: 'C', createdAt: 1 },
    { id: 'd', parentId: null, name: 'D', createdAt: 1 },
  ]

  it('prevents moving a folder into itself or a descendant', () => {
    expect(getFolderDescendants(folders, 'a')).toEqual(new Set(['a', 'b', 'c']))
    expect(canMoveFolder(folders, 'a', 'c')).toBe(false)
    expect(canMoveFolder(folders, 'a', 'a')).toBe(false)
    expect(canMoveFolder(folders, 'a', 'missing')).toBe(false)
    expect(canMoveFolder(folders, 'b', 'd')).toBe(true)
    expect(canMoveFolder(folders, 'b', null)).toBe(true)
  })

  it('finds readable unique names without exceeding the name limit', () => {
    expect(uniqueName('Ideia', ['ideia', 'Ideia (2)'])).toBe('Ideia (3)')
    expect(uniqueName('  ', [])).toBe('Sem título')
    expect(uniqueName('a'.repeat(180), ['a'.repeat(180)]).length).toBe(180)
  })
})

describe('document outline', () => {
  it('ignores front matter and fenced code, preserving source line positions', () => {
    const markdown = ['---', 'title: Example', '---', '# Intro', '```md', '# Not a heading', '```', '## Part **two**', '~~~', '# Not either', '~~~', 'Ending', '------'].join('\n')
    expect(parseOutline(markdown)).toEqual([
      { id: 'intro', text: 'Intro', level: 1, line: 4 },
      { id: 'part-two', text: 'Part two', level: 2, line: 8 },
      { id: 'ending', text: 'Ending', level: 2, line: 12 },
    ])
  })

  it('respects fence length and assigns unique ids to repeated headings', () => {
    const markdown = '# Começo\n####### no\n#not-a-heading\n````js\n```\n# hidden\n````\n## Começo\n  ### [Fim](https://example.org) ###'
    expect(parseOutline(markdown).map(({ id, level }) => ({ id, level }))).toEqual([
      { id: 'começo', level: 1 }, { id: 'começo-1', level: 2 }, { id: 'fim', level: 3 },
    ])
  })
})

async function writeRawSnapshot(value: unknown): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lume-library', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('library', 'readwrite')
      transaction.objectStore('library').put(value, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

async function readRawSnapshots(): Promise<unknown[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lume-library', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction('library', 'readonly')
      const request = transaction.objectStore('library').getAll()
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}
