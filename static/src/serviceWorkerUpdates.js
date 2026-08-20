export function observeServiceWorkerUpdates(onUpdate) {
  let disposed = false;
  let registration = null;
  let installingWorker = null;
  let reportedWorker = null;
  const reportInstalledWorker = () => {
    if (!registration || !navigator.serviceWorker.controller) return;
    const worker = registration.waiting
      || (installingWorker?.state === 'installed' ? installingWorker : null);
    if (worker && worker !== reportedWorker) {
      reportedWorker = worker;
      onUpdate(registration);
    }
  };
  const observeInstallingWorker = () => {
    installingWorker?.removeEventListener('statechange', reportInstalledWorker);
    installingWorker = registration?.installing || null;
    installingWorker?.addEventListener('statechange', reportInstalledWorker);
    reportInstalledWorker();
  };
  const reconcileRegistration = () => {
    Promise.resolve(navigator.serviceWorker?.getRegistration?.()).then(observedRegistration => {
      if (disposed) return;
      const nextRegistration = observedRegistration || null;
      if (registration !== nextRegistration) {
        registration?.removeEventListener('updatefound', observeInstallingWorker);
        installingWorker?.removeEventListener('statechange', reportInstalledWorker);
        registration = nextRegistration;
        registration?.addEventListener('updatefound', observeInstallingWorker);
        observeInstallingWorker();
      } else reportInstalledWorker();
    }).catch(() => {});
  };
  const reconcileVisibleRegistration = () => {
    if (document.visibilityState !== 'hidden') reconcileRegistration();
  };

  reconcileRegistration();
  // Update events are advisory: a cached install can finish between callbacks.
  // Reconcile the durable registration state while the Tracker is mounted.
  const reconciliationInterval = window.setInterval(reconcileRegistration, 1000);
  window.addEventListener('focus', reconcileRegistration);
  window.addEventListener('pageshow', reconcileRegistration);
  document.addEventListener('visibilitychange', reconcileVisibleRegistration);

  return () => {
    disposed = true;
    window.clearInterval(reconciliationInterval);
    window.removeEventListener('focus', reconcileRegistration);
    window.removeEventListener('pageshow', reconcileRegistration);
    document.removeEventListener('visibilitychange', reconcileVisibleRegistration);
    registration?.removeEventListener('updatefound', observeInstallingWorker);
    installingWorker?.removeEventListener('statechange', reportInstalledWorker);
  };
}
