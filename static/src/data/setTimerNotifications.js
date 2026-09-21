import { getSetTimerTiming } from './setTimer';

const NOTIFICATION_TAG = 'mcilroy-set-timer';
let notificationWrites = Promise.resolve();

export const getSetTimerNotificationPermission = () => {
  if (typeof window === 'undefined' || !window.Notification
    || !navigator.serviceWorker?.getRegistration) return 'unsupported';
  return ['granted', 'denied'].includes(window.Notification.permission)
    ? window.Notification.permission : 'default';
};

export const cleanupStaleSetTimerNotifications = async () => {
  if (getSetTimerNotificationPermission() !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({ type: 'cleanup-set-timer-notifications' });
  } catch (ignored) { /* Cleanup is optional when the worker is unavailable. */ }
};

const getNotificationClientId = worker => new Promise((resolve, reject) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let timeout;
  const finish = (error, clientId) => {
    window.clearTimeout(timeout);
    navigator.serviceWorker.removeEventListener('message', receive);
    if (error) reject(error);
    else resolve(clientId);
  };
  const receive = event => {
    if (event.data?.type !== 'set-timer-client' || event.data.requestId !== requestId) return;
    if (typeof event.data.clientId !== 'string' || !event.data.clientId) return;
    finish(null, event.data.clientId);
  };
  navigator.serviceWorker.addEventListener('message', receive);
  timeout = window.setTimeout(() => finish(new Error('Update or reopen the app to enable timer notifications.')), 2000);
  try { worker.postMessage({ type: 'set-timer-client', requestId }); } catch (error) { finish(error); }
});

const formatDuration = milliseconds => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const formatClock = milliseconds => new Date(milliseconds).toLocaleTimeString([], {
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});

export const createSetTimerNotifications = ({ onError } = {}) => {
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let registration = null;
  let clientId = null;
  let enabled = false;
  let disposed = false;
  let activation = 0;
  let revision = 0;
  let latest = null;
  let pending = Promise.resolve();

  const reportError = error => {
    try { onError?.(error); } catch (ignored) { /* Notification failures must not stop the timer. */ }
  };

  const clearNotification = async () => {
    if (!registration) return;
    const notifications = await registration.getNotifications({ tag: NOTIFICATION_TAG });
    // A new timer view may already have replaced this instance's notification.
    notifications.filter(notification => notification.data?.owner === owner)
      .forEach(notification => notification.close());
  };

  const publishLatest = () => {
    const requested = ++revision;
    pending = notificationWrites.then(async () => {
      // Coalesce updates while an earlier browser operation is still in flight.
      if (requested !== revision) return;
      if (!registration) return;
      if (!enabled || disposed || !latest?.timer?.runningSince) {
        await clearNotification();
        return;
      }
      if (getSetTimerNotificationPermission() !== 'granted') {
        throw new Error('Timer notifications are blocked. Check this site’s notification permission.');
      }
      const now = Date.now();
      const { remainingMs, phase } = getSetTimerTiming(latest.timer, now);
      // This is explicitly a timestamped snapshot: browsers may suspend further
      // updates while hidden, and the Notifications API has no native countdown.
      await registration.showNotification(`Set timer · ${latest.exerciseName || 'Workout'}`, {
        body: `${phase === 'ready' ? 'Get ready: ' : ''}${formatDuration(remainingMs)} left (updated ${formatClock(now)}). Next buzzer: ${formatClock(now + remainingMs)}.`,
        tag: NOTIFICATION_TAG,
        icon: '/icon-192.png',
        silent: true,
        renotify: false,
        requireInteraction: true,
        timestamp: now,
        data: { type: 'set-timer', owner, clientId },
      });
    }).catch(async error => {
      if (requested !== revision || disposed) return;
      enabled = false;
      try { await clearNotification(); } catch (ignored) { /* The browser may have revoked permission. */ }
      reportError(error);
    });
    notificationWrites = pending;
    return pending;
  };

  const enable = async () => {
    if (disposed) return false;
    const attempt = ++activation;
    const permission = getSetTimerNotificationPermission();
    if (permission === 'unsupported' || permission === 'denied') return false;
    try {
      // Invoke requestPermission before the first await, preserving the click's
      // user activation. Merely constructing or updating this helper never asks.
      const granted = permission === 'granted'
        ? 'granted' : await window.Notification.requestPermission();
      if (disposed || attempt !== activation || granted !== 'granted') return false;
      const found = await navigator.serviceWorker.getRegistration();
      if (disposed || attempt !== activation) return false;
      if (!found?.active || !found?.showNotification || !found?.getNotifications) {
        throw new Error('Timer notifications are not available yet. Reopen the app and try again.');
      }
      // Browser client IDs change on reload and differ across duplicated tabs.
      // The worker uses this identity to remove abandoned tray snapshots safely.
      const foundClientId = await getNotificationClientId(found.active);
      if (disposed || attempt !== activation) return false;
      registration = found;
      clientId = foundClientId;
      enabled = true;
      return true;
    } catch (error) {
      if (!disposed && attempt === activation) reportError(error);
      return false;
    }
  };

  const update = (timer, exerciseName) => {
    if (disposed) return Promise.resolve();
    latest = { timer: timer && { ...timer }, exerciseName };
    return enabled ? publishLatest() : Promise.resolve();
  };

  const close = () => {
    activation += 1;
    enabled = false;
    latest = null;
    return publishLatest();
  };

  const dispose = () => {
    disposed = true;
    return close();
  };

  return { enable, update, close, dispose };
};
