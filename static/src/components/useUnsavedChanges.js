import { useEffect, useRef } from 'react';
import { NAVIGATION_EVENT } from '../data/navigationGuard';

const editors = new Set();
let sourceDepth = 0;
let restoring = false;
let approved = false;
const depth = state => state?.mcilroyTracker?.depth || 0;
const canLeave = () => ![...editors].some(editor => editor.current) &&
  window.confirm('Discard unsaved changes and leave this screen?');
const beforeNavigation = event => {
  if (event.detail instanceof PopStateEvent) {
    if (restoring) {
      restoring = false;
      event.preventDefault();
      return;
    }
    if (approved) {
      approved = false;
      return;
    }
    if (canLeave()) return;
    // The browser has moved its cursor, but the router has not unmounted the
    // editor. Restore the cursor and suppress that restoration's route update.
    event.preventDefault();
    restoring = true;
    window.history.go(sourceDepth - depth(event.detail.state) || 1);
    return;
  }
  if (!canLeave()) event.preventDefault();
  else approved = event.detail === true;
};
const beforeUnload = event => {
  event.preventDefault();
  event.returnValue = '';
};

export const useUnsavedChanges = (active, saving = false) => {
  const busy = useRef(saving);
  busy.current = saving;
  useEffect(() => {
    if (!active) return undefined;
    if (!editors.size) {
      sourceDepth = depth(window.history.state);
      restoring = false;
      approved = false;
      window.addEventListener(NAVIGATION_EVENT, beforeNavigation);
      window.addEventListener('beforeunload', beforeUnload);
    }
    editors.add(busy);
    return () => {
      editors.delete(busy);
      if (editors.size) return;
      window.removeEventListener(NAVIGATION_EVENT, beforeNavigation);
      window.removeEventListener('beforeunload', beforeUnload);
      approved = false;
      restoring = false;
    };
  }, [active]);
};
