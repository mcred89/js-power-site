import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { getInstallation, subscribeToInstallation, takeInstallPrompt } from '../data/appInstallation';
import './InstallBanner.css';

const DISMISSED_KEY = 'mcilroy-install-dismissed';
const wasDismissed = () => {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const installInstructions = (userAgent, maxTouchPoints = 0) => {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return 'Open this page in Safari, tap Share, then Add to Home Screen.';
  }
  if (/Firefox\//.test(userAgent)) {
    if (/Android/.test(userAgent)) return 'Open the Firefox menu and tap Install, then follow the device prompts.';
    if (/Windows/.test(userAgent)) return 'In a recent Firefox for Windows, use the web apps button in the address bar to add this site to your taskbar. If it is unavailable, try Chrome, Edge, or Brave.';
    return 'Firefox on this device does not offer app installation. Open this page in Chrome, Edge, or Brave to install it, or bookmark it in Firefox.';
  }
  return 'Look for the install icon in the address bar, or open your browser menu and look for Install app, Install page as app, or Add to Home screen. In Edge, check Apps; in Chrome or Brave, check Save and share. If no option appears, installation may be unavailable on this device or the app may already be installed.';
};

const InstallBanner = () => {
  const { prompt, installed } = useSyncExternalStore(subscribeToInstallation, getInstallation);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // The banner still dismisses when browser storage is unavailable.
    }
  };

  useEffect(() => {
    if (installed) dismiss();
  }, [installed]);

  const install = async () => {
    const event = takeInstallPrompt();
    if (!event) {
      setShowHelp(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      // Call directly from the click to preserve the browser's user activation.
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === 'accepted' || choice?.outcome === 'dismissed') dismiss();
      else setShowHelp(true);
    } catch {
      setFailed(true);
      setShowHelp(true);
    } finally {
      setBusy(false);
    }
  };

  if (dismissed || installed) return null;

  return (
    <section className="install-banner" aria-label="Install the app">
      <div className="install-banner-inner">
        <div className="install-banner-copy">
          <strong>Install the McIlroy Method?</strong>
          <p>Keep your workout tracker one tap away.</p>
        </div>
        <div className="install-banner-actions">
          {prompt || busy ? (
            <button type="button" className="install-banner-primary" onClick={install} disabled={busy}>
              {busy ? 'Installing…' : 'Install app'}
            </button>
          ) : (
            <button type="button" className="install-banner-primary" aria-expanded={showHelp} aria-controls="install-help" onClick={() => setShowHelp(!showHelp)}>
              How to install
            </button>
          )}
          <button type="button" className="install-banner-dismiss" onClick={dismiss}>Not now</button>
        </div>
        {showHelp && (
          <p className="install-banner-help" id="install-help" role="status">
            {failed && 'The install dialog could not open. '}
            {installInstructions(navigator.userAgent, navigator.maxTouchPoints)}
          </p>
        )}
      </div>
    </section>
  );
};

export default InstallBanner;
