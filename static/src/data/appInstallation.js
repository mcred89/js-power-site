// Capture install availability before the lazy website UI loads. Browsers decide
// when (and whether) to dispatch this event; each prompt can only be used once.
export const isInstalledApp = () => Boolean(
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
);

let snapshot = { prompt: null, installed: isInstalledApp() };
const listeners = new Set();
const update = changes => {
  snapshot = { ...snapshot, ...changes };
  listeners.forEach(listener => listener());
};

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  update({ prompt: event });
});
window.addEventListener('appinstalled', () => update({ prompt: null, installed: true }));
window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => {
  update({ installed: isInstalledApp() });
});

export const subscribeToInstallation = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getInstallation = () => snapshot;
export const takeInstallPrompt = () => {
  const event = snapshot.prompt;
  update({ prompt: null });
  return event;
};
