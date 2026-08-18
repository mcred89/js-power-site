import {
  BACKUP_VERSION,
  DATABASE_VERSION,
  migrateBackup,
  runDatabaseMigrations,
} from './storageMigrations';

const DATABASE_NAME = 'mcilroy-method';

const openDatabase = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error('IndexedDB is not available in this browser.'));
    return;
  }

  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = event => {
    runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transaction = async (storeName, mode, action) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request;
    try {
      request = action(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      database.close();
      resolve(request?.result);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
  });
};

export const getAll = storeName => transaction(storeName, 'readonly', store => store.getAll());
export const save = (storeName, value) => transaction(storeName, 'readwrite', store => store.put(value));
export const remove = (storeName, id) => transaction(storeName, 'readwrite', store => store.delete(id));

export const exportBackup = (profiles, routines) => JSON.stringify({
  format: 'mcilroy-method-backup',
  version: BACKUP_VERSION,
  dataSchemaVersion: DATABASE_VERSION,
  exportedAt: new Date().toISOString(),
  profiles,
  routines,
}, null, 2);

export const parseBackup = contents => {
  const backup = migrateBackup(JSON.parse(contents));
  if (backup.format !== 'mcilroy-method-backup' ||
      !Array.isArray(backup.profiles) || !Array.isArray(backup.routines)) {
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
