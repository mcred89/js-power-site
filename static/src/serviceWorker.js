// In production, we register a service worker to serve assets from local cache.

// This lets the app load faster on subsequent visits in production, and gives
// it offline capabilities. However, it also means that developers (and users)
// will only see deployed updates on the "N+1" visit to a page, since previously
// cached resources are updated in the background.

// To learn more about the benefits of this model, read https://goo.gl/KwvDNy.
// This link also includes instructions on opting out of this behavior.

export function register(config) {
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    // The URL constructor is available in all browsers that support SW.
    const publicUrl = new URL(process.env.PUBLIC_URL, window.location);
    if (publicUrl.origin !== window.location.origin) {
      // Our service worker won't work if PUBLIC_URL is on a different origin
      // from what our page is served on. This might happen if a CDN is used to
      // serve assets; see https://github.com/facebook/create-react-app/issues/2374
      return;
    }

    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      // Production and smoke builds always contain the generated worker, including
      // on localhost, so registration needs no network validity probe.
      registerValidSW(swUrl, config);
    });
  }
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then(registration => {
      // An update can finish installing before this page attaches updatefound
      // (notably during a fast cached bootstrap). Report that waiting worker
      // immediately so the update banner cannot be lost.
      if (registration.waiting && navigator.serviceWorker.controller && config.onUpdate) {
        config.onUpdate(registration);
      }
      const handleUpdateFound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        const handleStateChange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // At this point, the old content will have been purged and
              // the fresh content will have been added to the cache.
              // It's the perfect time to display a "New content is
              // available; please refresh." message in your web app.
              console.log('New content is available; please refresh.');

              // Execute callback
              if (config.onUpdate) {
                config.onUpdate(registration);
              }
            } else {
              // At this point, everything has been precached.
              // It's the perfect time to display a
              // "Content is cached for offline use." message.
              console.log('Content is cached for offline use.');

              // Execute callback
              if (config.onSuccess) {
                config.onSuccess(registration);
              }
            }
          }
        };
        installingWorker.onstatechange = handleStateChange;
        // A tiny fully-cached worker can reach installed between updatefound and
        // handler assignment. Recheck synchronously so the update is still shown.
        handleStateChange();
      };
      registration.addEventListener('updatefound', handleUpdateFound);
    })
    .catch(error => {
      console.error('Error during service worker registration:', error);
    });
}

export { registerValidSW };

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      registration.unregister();
    });
  }
}
