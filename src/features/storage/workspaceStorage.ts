import { openDB } from 'idb'

const database = openDB('pixo-workspace', 1, {
  upgrade(db) {
    db.createObjectStore('workspace')
  },
})

export async function readWorkspaceValue<T>(key: string, fallback: T): Promise<T> {
  const value = await (await database).get('workspace', key) as T | undefined
  return value ?? fallback
}

export async function writeWorkspaceValue(key: string, value: unknown) {
  await (await database).put('workspace', value, key)
}