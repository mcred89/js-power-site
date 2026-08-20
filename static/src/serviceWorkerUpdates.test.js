import { observeServiceWorkerUpdates } from './serviceWorkerUpdates';

describe('service worker update observation', () => {
  afterEach(() => jest.useRealTimers());

  it('reports an installed replacement before registration.waiting is populated', async () => {
    const listeners = {};
    const installing = {
      state: 'installing',
      addEventListener: jest.fn((name, listener) => { listeners[name] = listener; }),
      removeEventListener: jest.fn(),
    };
    const registration = {
      installing,
      waiting: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {}, getRegistration: jest.fn().mockResolvedValue(registration) },
    });
    const onUpdate = jest.fn();
    const unsubscribe = observeServiceWorkerUpdates(onUpdate);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    installing.state = 'installed';
    listeners.statechange();
    expect(onUpdate).toHaveBeenCalledWith(registration);
    unsubscribe();
  });

  it('reconciles eventless waiting state once and cleans up polling', async () => {
    jest.useFakeTimers();
    const registration = {
      installing: null, waiting: null, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    };
    const getRegistration = jest.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {}, getRegistration },
    });
    const onUpdate = jest.fn();
    const unsubscribe = observeServiceWorkerUpdates(onUpdate);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    registration.waiting = {};
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const callsBeforeCleanup = getRegistration.mock.calls.length;
    unsubscribe();
    jest.advanceTimersByTime(2000);
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(getRegistration).toHaveBeenCalledTimes(callsBeforeCleanup);
  });
});
