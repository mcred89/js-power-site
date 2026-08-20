import { registerValidSW } from './serviceWorker';

describe('service worker registration', () => {
  it('reports an already-waiting update immediately', async () => {
    const registration = { waiting: {}, installing: null, addEventListener: jest.fn() };
    const onUpdate = jest.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        register: jest.fn().mockResolvedValue(registration),
      },
    });

    registerValidSW('/service-worker.js', { onUpdate });
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(registration);
    expect(registration.addEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
  });
});
