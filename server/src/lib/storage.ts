// Where resume files live. Vercel Blob when BLOB_READ_WRITE_TOKEN is set
// (Vercel functions have no persistent disk); a local folder otherwise.
// The stored URL never leaves the server: downloads go through the API.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { del, put } from '@vercel/blob'

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = resolve(here, '..', '..', '.data')
const LOCAL_PREFIX = 'local:'

export type StorageKind = 'blob' | 'local'

export function storageKind(): StorageKind {
  return (process.env.BLOB_READ_WRITE_TOKEN ?? '').trim() ? 'blob' : 'local'
}

const safeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'

function localPath(url: string): string {
  const key = url.slice(LOCAL_PREFIX.length)
  // Keys are generated here, but never trust a stored value with a path.
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('invalid storage key')
  return resolve(DATA_DIR, 'resumes', key)
}

export async function putFile(fileName: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  if (storageKind() === 'blob') {
    const blob = await put(`resumes/${safeName(fileName)}`, Buffer.from(bytes), {
      access: 'public', // unguessable URL; never sent to the browser
      addRandomSuffix: true,
      contentType: mimeType,
    })
    return blob.url
  }
  if (process.env.VERCEL) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set: add a Vercel Blob store to keep resume files')
  }
  const key = `${randomUUID()}-${safeName(fileName)}`
  await mkdir(resolve(DATA_DIR, 'resumes'), { recursive: true })
  await writeFile(resolve(DATA_DIR, 'resumes', key), bytes)
  return `${LOCAL_PREFIX}${key}`
}

export async function getFile(url: string): Promise<Uint8Array> {
  if (url.startsWith(LOCAL_PREFIX)) return new Uint8Array(await readFile(localPath(url)))
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`could not read stored file (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function deleteFile(url: string): Promise<void> {
  if (url.startsWith(LOCAL_PREFIX)) {
    await rm(localPath(url), { force: true })
    return
  }
  await del(url)
}
