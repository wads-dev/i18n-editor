import { assertBundle, type I18nBundle } from '@wads.dev/i18n-ts/bundle'
import type { EditorProjectConfig } from '../core/projectConfig.js'

const DATABASE_NAME = 'wads-i18n-editor'
const DATABASE_VERSION = 1
const STORE_NAME = 'bundles'
const CURRENT_BUNDLE_KEY = 'current'
const PROJECT_CONFIG_KEY = 'project-config'
const LEGACY_VISUALIZATION_CONFIG_KEY = 'visualization-config'

function projectKey(projectDirectory: string, key: string): string {
  return `${key}:${projectDirectory}`
}

type StoredBundleRecord = { id: string; bundle: I18nBundle }
type StoredConfigRecord = { id: string; config: EditorProjectConfig }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadStoredBundle(projectDirectory: string): Promise<I18nBundle | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const record = await requestResult<StoredBundleRecord | undefined>(
      transaction.objectStore(STORE_NAME).get(projectKey(projectDirectory, CURRENT_BUNDLE_KEY)),
    )
    await transactionComplete(transaction)
    return record ? assertBundle(record.bundle) : null
  } finally {
    database.close()
  }
}

export async function saveStoredBundle(projectDirectory: string, bundle: I18nBundle): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(STORE_NAME).put({ id: projectKey(projectDirectory, CURRENT_BUNDLE_KEY), bundle }))
    await transactionComplete(transaction)
  } finally {
    database.close()
  }
}

export async function loadStoredProjectConfig(projectDirectory: string): Promise<EditorProjectConfig | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const record = await requestResult<StoredConfigRecord | undefined>(store.get(projectKey(projectDirectory, PROJECT_CONFIG_KEY)))
    const legacyRecord = record
      ? undefined
      : await requestResult<StoredConfigRecord | undefined>(store.get(projectKey(projectDirectory, LEGACY_VISUALIZATION_CONFIG_KEY)))
    await transactionComplete(transaction)
    return record?.config ?? legacyRecord?.config ?? null
  } finally {
    database.close()
  }
}

export async function saveStoredProjectConfig(projectDirectory: string, config: EditorProjectConfig): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(STORE_NAME).put({ id: projectKey(projectDirectory, PROJECT_CONFIG_KEY), config }))
    await transactionComplete(transaction)
  } finally {
    database.close()
  }
}
