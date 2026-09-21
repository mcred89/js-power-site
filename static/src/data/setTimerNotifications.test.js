import { cleanupStaleSetTimerNotifications, createSetTimerNotifications, getSetTimerNotificationPermission } from './setTimerNotifications';

const startedAt = Date.parse('2026-09-21T14:00:00Z');
const timer = { intervalMs: 240000, elapsedMs: 10000, runningSince: new Date(startedAt).toISOString(), exerciseId: 'bench' };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const clock = time => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

let originalNotification;
let originalServiceWorker;
let registration;
let displayed;
let controllers;

const create = options => {
  const controller = createSetTimerNotifications(options);
  controllers.push(controller);
  return controller;
};

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(startedAt);
  originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification');
  originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  displayed = [];
  controllers = [];
  const messages = new Set();
  registration = {
    active: { state: 'activated', postMessage: jest.fn(message => {
      if (message.type === 'set-timer-client') messages.forEach(receive => receive({
        data: { ...message, clientId: 'current-browser-client' },
      }));
    }) },
    showNotification: jest.fn(async (title, options) => {
      displayed = [{ ...options, close: jest.fn(() => { displayed = []; }) }];
    }),
    getNotifications: jest.fn(async () => displayed),
  };
  Object.defineProperty(window, 'Notification', { configurable: true, value: {
    permission: 'granted', requestPermission: jest.fn(async () => 'granted'),
  } });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    getRegistration: jest.fn(async () => registration),
    addEventListener: jest.fn((name, receive) => messages.add(receive)),
    removeEventListener: jest.fn((name, receive) => messages.delete(receive)),
  } });
});

afterEach(async () => {
  await Promise.all(controllers.map(controller => controller.dispose()));
  if (originalNotification) Object.defineProperty(window, 'Notification', originalNotification);
  else delete window.Notification;
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else delete navigator.serviceWorker;
  jest.useRealTimers();
});

it('does not opt in or prompt merely because permission is already granted', async () => {
  const notifications = create();
  expect(getSetTimerNotificationPermission()).toBe('granted');
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).not.toHaveBeenCalled();
  expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
});

it('requests permission synchronously from enable and publishes a truthful timestamped snapshot', async () => {
  window.Notification.permission = 'default';
  const permission = deferred();
  window.Notification.requestPermission.mockReturnValue(permission.promise);
  const notifications = create();
  const enabling = notifications.enable();
  expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
  expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
  window.Notification.permission = 'granted';
  permission.resolve('granted');
  await expect(enabling).resolves.toBe(true);
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).toHaveBeenCalledWith('Set timer · Bench press', expect.objectContaining({
    body: `4:00 left (updated ${clock(startedAt)}). Next buzzer: ${clock(startedAt + 240000)}.`,
    tag: 'mcilroy-set-timer', icon: '/icon-192.png', silent: true, renotify: false,
    timestamp: startedAt,
    data: expect.objectContaining({ clientId: 'current-browser-client' }),
  }));
});

it('returns unsupported without a service worker API and refuses denied permission without prompting', async () => {
  const notifications = create();
  window.Notification.permission = 'denied';
  expect(getSetTimerNotificationPermission()).toBe('denied');
  await expect(notifications.enable()).resolves.toBe(false);
  expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  delete navigator.serviceWorker;
  expect(getSetTimerNotificationPermission()).toBe('unsupported');
  await expect(notifications.enable()).resolves.toBe(false);
});

it.each([undefined, { active: null }])('fails cleanly when the worker is unavailable instead of waiting indefinitely for ready: %j', async unavailable => {
  const onError = jest.fn();
  navigator.serviceWorker.getRegistration.mockResolvedValue(unavailable);
  const notifications = create({ onError });
  await expect(notifications.enable()).resolves.toBe(false);
  expect(onError).toHaveBeenCalledWith(expect.any(Error));
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).not.toHaveBeenCalled();
});

it('clears a paused timer and keeps the opt-in for resuming', async () => {
  const notifications = create();
  await notifications.enable();
  await notifications.update(timer, 'Bench press');
  const shown = displayed[0];
  await notifications.update({ ...timer, runningSince: null }, 'Bench press');
  expect(shown.close).toHaveBeenCalledTimes(1);
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).toHaveBeenCalledTimes(2);
});

it('coalesces queued snapshots and calculates remaining time when publishing', async () => {
  const firstShow = deferred();
  registration.showNotification.mockImplementationOnce(() => firstShow.promise);
  const notifications = create();
  await notifications.enable();
  const first = notifications.update(timer, 'First');
  await Promise.resolve();
  const stale = notifications.update(timer, 'Stale');
  const latest = notifications.update(timer, 'Latest');
  jest.setSystemTime(startedAt + 120000);
  firstShow.resolve();
  await Promise.all([first, stale, latest]);
  expect(registration.showNotification).toHaveBeenCalledTimes(2);
  expect(registration.showNotification).toHaveBeenLastCalledWith('Set timer · Latest', expect.objectContaining({
    body: `2:00 left (updated ${clock(startedAt + 120000)}). Next buzzer: ${clock(startedAt + 240000)}.`,
    timestamp: startedAt + 120000,
  }));
});

it('waits for an in-flight notification before closing it and ignores updates until enabled again', async () => {
  const firstShow = deferred();
  registration.showNotification.mockImplementationOnce(async (title, options) => {
    await firstShow.promise;
    displayed = [{ ...options, close: jest.fn(() => { displayed = []; }) }];
  });
  const notifications = create();
  await notifications.enable();
  const updating = notifications.update(timer, 'Bench press');
  await Promise.resolve();
  const closing = notifications.close();
  expect(registration.getNotifications).not.toHaveBeenCalled();
  firstShow.resolve();
  await Promise.all([updating, closing]);
  expect(displayed).toEqual([]);
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).toHaveBeenCalledTimes(1);
  await notifications.enable();
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).toHaveBeenCalledTimes(2);
});

it('invalidates permission work on disposal and never prompts again', async () => {
  window.Notification.permission = 'default';
  const permission = deferred();
  window.Notification.requestPermission.mockReturnValue(permission.promise);
  const notifications = create();
  const enabling = notifications.enable();
  await notifications.dispose();
  permission.resolve('granted');
  await expect(enabling).resolves.toBe(false);
  await expect(notifications.enable()).resolves.toBe(false);
  expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
  expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
});

it('does not enable after the user hides notifications while registration is pending', async () => {
  const lookup = deferred();
  navigator.serviceWorker.getRegistration.mockReturnValue(lookup.promise);
  const notifications = create();
  const enabling = notifications.enable();
  await notifications.close();
  lookup.resolve(registration);
  await expect(enabling).resolves.toBe(false);
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).not.toHaveBeenCalled();
});

it('does not let an old view close a newer view’s notification', async () => {
  const older = create();
  const newer = create();
  await older.enable();
  await newer.enable();
  await older.update(timer, 'Older');
  await newer.update(timer, 'Newer');
  const current = displayed[0];
  await older.dispose();
  expect(current.close).not.toHaveBeenCalled();
  expect(displayed).toContain(current);
});

it('serializes writes across views so a late old publish cannot replace a new notification', async () => {
  const firstShow = deferred();
  registration.showNotification.mockImplementationOnce(async (title, options) => {
    await firstShow.promise;
    displayed = [{ ...options, close: jest.fn(() => { displayed = []; }) }];
  });
  const older = create();
  const newer = create();
  await older.enable();
  await newer.enable();
  const oldUpdate = older.update(timer, 'Older');
  await Promise.resolve();
  const newUpdate = newer.update(timer, 'Newer');
  const disposal = older.dispose();
  expect(registration.showNotification).toHaveBeenCalledTimes(1);
  firstShow.resolve();
  await Promise.all([oldUpdate, newUpdate, disposal]);
  expect(registration.showNotification).toHaveBeenLastCalledWith('Set timer · Newer', expect.any(Object));
  expect(displayed).toHaveLength(1);
  expect(displayed[0].close).not.toHaveBeenCalled();
});

it('recalculates the next boundary after wall-clock jumps and identifies the ready countdown', async () => {
  const notifications = create();
  await notifications.enable();
  await notifications.update({ ...timer, elapsedMs: 0 }, 'Bench press');
  expect(registration.showNotification.mock.calls[0][1].body).toContain('Get ready: 0:10 left');
  jest.setSystemTime(startedAt + 501000);
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).toHaveBeenLastCalledWith('Set timer · Bench press', expect.objectContaining({
    body: `3:39 left (updated ${clock(startedAt + 501000)}). Next buzzer: ${clock(startedAt + 720000)}.`,
  }));
});

it('reports browser failures without rejecting updates or repeatedly attempting to publish', async () => {
  const error = new Error('Notifications unavailable');
  const onError = jest.fn();
  registration.showNotification.mockRejectedValue(error);
  const notifications = create({ onError });
  await notifications.enable();
  await expect(notifications.update(timer, 'Bench press')).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledWith(error);
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).toHaveBeenCalledTimes(1);
});

it('requests stale snapshot cleanup on reopening without enabling or prompting', async () => {
  await cleanupStaleSetTimerNotifications();
  expect(registration.active.postMessage).toHaveBeenCalledWith({ type: 'cleanup-set-timer-notifications' });
  expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  expect(registration.showNotification).not.toHaveBeenCalled();
  window.Notification.permission = 'default';
  registration.active.postMessage.mockClear();
  await cleanupStaleSetTimerNotifications();
  expect(registration.active.postMessage).not.toHaveBeenCalled();
});

it('bounds the identity lookup when the active worker needs an update', async () => {
  registration.active.postMessage.mockImplementation(() => {});
  const onError = jest.fn();
  const notifications = create({ onError });
  const enabling = notifications.enable();
  await Promise.resolve();
  jest.advanceTimersByTime(2000);
  await expect(enabling).resolves.toBe(false);
  expect(onError).toHaveBeenCalledWith(expect.any(Error));
  expect(navigator.serviceWorker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  await notifications.update(timer, 'Bench press');
  expect(registration.showNotification).not.toHaveBeenCalled();
});
