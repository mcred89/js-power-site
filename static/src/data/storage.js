import {
  BACKUP_VERSION,
  DATABASE_VERSION,
  migrateBackup,
  runDatabaseMigrations,
} from './storageMigrations';

const DATABASE_NAME = 'mcilroy-method';

// Keep one connection for the lifetime of the page. Opening IndexedDB is asynchronous and
// comparatively expensive; re-opening it for every set completion also made rapid workout
// updates queue behind repeated connection handshakes. The browser still owns durability,
// and versionchange closes this cached connection so a newer app version can migrate safely.
let databasePromise;
let cachedDatabase;

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
  // Once startup has opened IndexedDB, lifecycle flushes enter a transaction in the same
  // browser event turn. The first-ever open is necessarily asynchronous by IndexedDB design.
  if (cachedDatabase) return runTransaction(cachedDatabase, storeName, mode, action);
  return openDatabase().then(database => runTransaction(database, storeName, mode, action));
};

export const getAll = storeName => transaction(storeName, 'readonly', store => store.getAll());
export const get = (storeName, id) => transaction(storeName, 'readonly', store => store.get(id));
export const save = (storeName, value) => transaction(storeName, 'readwrite', store => store.put(value));
export const remove = (storeName, id) => transaction(storeName, 'readwrite', store => store.delete(id));

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
  const backup = migrateBackup(JSON.parse(contents));
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
