import {
  BACKUP_VERSION,
  DATABASE_VERSION,
  addActiveWorkoutReferences,
  migrateBackup,
  runDatabaseMigrations,
} from './storageMigrations';
import { serializedRecordsEqual } from './recordComparison';

const DATABASE_NAME = 'mcilroy-method';

// Keep one connection for the lifetime of the page. Opening IndexedDB is asynchronous and
// comparatively expensive; re-opening it for every set completion also made rapid workout
// updates queue behind repeated connection handshakes. The browser still owns durability,
// and versionchange closes this cached connection so a newer app version can migrate safely.
let databasePromise;
let cachedDatabase;

const STORE_NAMES = new Set(['profiles', 'routines', 'templates', 'metadata']);
const validateStoreName = storeName => {
  if (!STORE_NAMES.has(storeName)) throw new Error(`Unknown IndexedDB store: ${storeName}.`);
};

const openDatabase = () => {
  if (databasePromise) return databasePromise;
  if (!window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = event => {
      runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
    };
    request.onsuccess = () => {
      const database = request.result;
      cachedDatabase = database;
      database.onversionchange = () => {
        database.close();
        cachedDatabase = undefined;
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error);
    };
  });
  return databasePromise;
};

const runTransaction = (database, storeName, mode, action) => new Promise((resolve, reject) => {
  const tx = database.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  let request;
  try {
    request = action(store);
  } catch (error) {
    reject(error);
    return;
  }
  tx.oncomplete = () => {
    resolve(request?.result);
  };
  tx.onerror = () => {
    reject(tx.error);
  };
});

const transaction = (storeName, mode, action) => {
  validateStoreName(storeName);
  // Once startup has opened IndexedDB, lifecycle flushes enter a transaction in the same
  // browser event turn. The first-ever open is necessarily asynchronous by IndexedDB design.
  if (cachedDatabase) return runTransaction(cachedDatabase, storeName, mode, action);
  return openDatabase().then(database => runTransaction(database, storeName, mode, action));
};

export const getAll = storeName => transaction(storeName, 'readonly', store => store.getAll());
export const getAllByIndex = (storeName, indexName, key) => transaction(
  storeName,
  'readonly',
  store => store.index(indexName).getAll(key),
);
export const get = (storeName, id) => transaction(storeName, 'readonly', store => store.get(id));
export const save = (storeName, value) => transaction(storeName, 'readwrite', store => store.put(value));
export const remove = (storeName, id) => transaction(storeName, 'readwrite', store => store.delete(id));

const batchConflict = () => Object.assign(
  new Error('Data changed. Review the updated import.'),
  { name: 'BatchConflictError' },
);

export const applyBatch = ({ puts = {}, deletes = {}, conditions = {}, deleteByIndex = {} }) => {
  const storeNames = [...new Set([
    ...Object.keys(puts), ...Object.keys(deletes), ...Object.keys(conditions), ...Object.keys(deleteByIndex),
  ])];
  storeNames.forEach(validateStoreName);
  Object.entries(deleteByIndex).forEach(([storeName, removals]) => removals.forEach(({ indexName }) => {
    if (storeName !== 'routines' || indexName !== 'profileId') {
      throw new Error(`Unknown IndexedDB index: ${storeName}.${indexName}.`);
    }
  }));
  if (!storeNames.length) return Promise.resolve();
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const tx = database.transaction(storeNames, 'readwrite');
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error || tx.error || new Error('IndexedDB batch failed.'));
    };
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);
    const performWrites = () => {
      storeNames.forEach(storeName => {
        const store = tx.objectStore(storeName);
        (puts[storeName] || []).forEach(value => {
          const request = store.put(value);
          request.onerror = () => {
            try { tx.abort(); } catch (error) { fail(request.error || error); }
          };
        });
        (deletes[storeName] || []).forEach(key => {
          const request = store.delete(key);
          request.onerror = () => {
            try { tx.abort(); } catch (error) { fail(request.error || error); }
          };
        });
        (deleteByIndex[storeName] || []).forEach(({ indexName, key }) => {
          const request = store.index(indexName).openKeyCursor(key);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            store.delete(cursor.primaryKey);
            cursor.continue();
          };
          request.onerror = () => {
            try { tx.abort(); } catch (error) { fail(request.error || error); }
          };
        });
      });
    };
    try {
      const checks = Object.entries(conditions).flatMap(([storeName, entries]) => (
        entries.map(entry => ({ storeName, ...entry }))
      ));
      if (!checks.length) {
        performWrites();
        return;
      }
      let remainingChecks = checks.length;
      checks.forEach(({ storeName, key, expected }) => {
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => {
          if (!serializedRecordsEqual(request.result, expected)) {
            const conflict = batchConflict();
            try { tx.abort(); } catch (error) { fail(conflict); }
            fail(conflict);
            return;
          }
          remainingChecks -= 1;
          // Reads and writes stay in this transaction, closing the preview/confirmation race.
          if (!remainingChecks) performWrites();
        };
        request.onerror = () => {
          try { tx.abort(); } catch (error) { fail(request.error || error); }
        };
      });
    } catch (error) {
      try { tx.abort(); } catch (abortError) { fail(error || abortError); }
      fail(error);
    }
  }));
};

export const exportBackup = (profiles, routines, templates = []) => JSON.stringify({
  format: 'mcilroy-method-backup',
  version: BACKUP_VERSION,
  dataSchemaVersion: DATABASE_VERSION,
  exportedAt: new Date().toISOString(),
  profiles,
  routines,
  templates,
}, null, 2);

export const parseBackup = contents => {
  const migrated = migrateBackup(JSON.parse(contents));
  // Normalize even current-version files: hand-edited or partially copied backups may
  // contain dangling active-workout references, which startup must never chase.
  const backup = {
    ...migrated,
    profiles: addActiveWorkoutReferences(migrated.profiles, migrated.routines),
  };
  if (backup.format !== 'mcilroy-method-backup' ||
      !Array.isArray(backup.profiles) || !Array.isArray(backup.routines) ||
      !Array.isArray(backup.templates)) {
    throw new Error('This is not a supported McIlroy Method backup.');
  }
  return backup;
};

export const requestPersistentStorage = async () => {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
};

export const hasPersistentStorage = async () => {
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
};
