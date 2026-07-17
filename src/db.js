const DB_NAME = 'schematic-schema-library'
const DB_VERSION = 2
const STORE_NAME = 'schemas'
const SETTINGS_STORE = 'settings'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open local schema storage.'))
  })
}

function runTransaction(mode, operation, storeName = STORE_NAME) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let result

    try {
      result = operation(store)
    } catch (error) {
      database.close()
      reject(error)
      return
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(result?.result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error('The local database operation failed.'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error || new Error('The local database operation was cancelled.'))
    }
  }))
}

export function createSchemaId() {
  return globalThis.crypto?.randomUUID?.() || `schema-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function listSchemaRecords() {
  return runTransaction('readonly', (store) => store.getAll())
    .then((records = []) => records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
}

export function getSchemaRecord(id) {
  return runTransaction('readonly', (store) => store.get(id))
}

export function putSchemaRecord(record) {
  return runTransaction('readwrite', (store) => store.put(record)).then(() => record)
}

export function deleteSchemaRecord(id) {
  return runTransaction('readwrite', (store) => store.delete(id))
}

export function getLastOpenedSchemaId() {
  return runTransaction('readonly', (store) => store.get('lastOpenedSchemaId'), SETTINGS_STORE)
    .then((setting) => setting?.value || null)
}

export function setLastOpenedSchemaId(id) {
  return runTransaction('readwrite', (store) => store.put({ key: 'lastOpenedSchemaId', value: id }), SETTINGS_STORE)
}
