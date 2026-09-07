const successfulRequest = () => {
  const database = {
    close: jest.fn(),
    transaction: () => {
      const transaction = { objectStore: () => ({ getAll: () => ({ result: [] }) }) };
      Promise.resolve().then(() => transaction.oncomplete());
      return transaction;
    },
  };
  const request = { result: database };
  Promise.resolve().then(() => request.onsuccess());
  return request;
};

describe('deferred IndexedDB migration loading', () => {
  let originalIndexedDB;

  beforeEach(() => {
    originalIndexedDB = window.indexedDB;
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('./storageMigrations');
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDB });
  });

  it('loads migrations before opening IndexedDB and shares one open across concurrent callers', async () => {
    const loaded = jest.fn();
    jest.doMock('./storageMigrations', () => {
      loaded();
      return { DATABASE_VERSION: 14, runDatabaseMigrations: jest.fn() };
    });
    const open = jest.fn(() => {
      expect(loaded).toHaveBeenCalledTimes(1);
      return successfulRequest();
    });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open } });
    const storage = require('./storage');
    expect(loaded).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await Promise.all([storage.getAll('profiles'), storage.getAll('routines')]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('mcilroy-method', 14);
  });

  it('allows another operation to retry when loading migration code fails', async () => {
    let attempts = 0;
    jest.doMock('./storageMigrations', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Migration chunk unavailable');
      return { DATABASE_VERSION: 14, runDatabaseMigrations: jest.fn() };
    });
    const open = jest.fn(successfulRequest);
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open } });
    const storage = require('./storage');
    await expect(storage.getAll('profiles')).rejects.toThrow('Migration chunk unavailable');
    expect(open).not.toHaveBeenCalled();
    await expect(storage.getAll('profiles')).resolves.toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('allows another operation to retry when IndexedDB itself fails to open', async () => {
    jest.doMock('./storageMigrations', () => ({ DATABASE_VERSION: 14, runDatabaseMigrations: jest.fn() }));
    const open = jest.fn()
      .mockImplementationOnce(() => {
        const request = { error: new Error('IndexedDB temporarily unavailable') };
        Promise.resolve().then(() => request.onerror());
        return request;
      })
      .mockImplementation(successfulRequest);
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open } });
    const storage = require('./storage');
    await expect(storage.getAll('profiles')).rejects.toThrow('IndexedDB temporarily unavailable');
    await expect(storage.getAll('profiles')).resolves.toEqual([]);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
