const DATABASE_NAME = 'mcilroy-method';
const DATABASE_VERSION = 1;
const STORES = ['profiles', 'routines'];

const openDatabase = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error('IndexedDB is not available in this browser.'));
    return;
  }

  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    STORES.forEach(store => {
      if (!request.result.objectStoreNames.contains(store)) {
        request.result.createObjectStore(store, { keyPath: 'id' });
      }
    });
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
  version: 1,
  exportedAt: new Date().toISOString(),
  profiles,
  routines,
}, null, 2);

export const parseBackup = contents => {
  const backup = JSON.parse(contents);
  if (backup.format !== 'mcilroy-method-backup' || backup.version !== 1 ||
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
