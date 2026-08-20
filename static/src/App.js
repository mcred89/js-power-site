import React, { lazy, Suspense, useEffect, useState } from 'react';
import TrackerApp from './TrackerApp';
import './App.css';

const CalculatorWebsite = lazy(() => import('./components/CalculatorWebsite'));
const APPEARANCE_KEY = 'mcilroy-method-appearance';

export const isInstalledApp = () => (
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true)
);

const App = () => {
  const [appearance, setAppearance] = useState(() => {
    const saved = window.localStorage?.getItem(APPEARANCE_KEY);
    return ['system', 'light', 'dark'].includes(saved) ? saved : 'system';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    window.localStorage?.setItem(APPEARANCE_KEY, appearance);
  }, [appearance]);

  if (isInstalledApp()) {
    // Standalone must render from the eager entry only; never wrap this branch in Suspense
    // or import calculator modules here, or the installed Today shell gains a bootstrap request.
    return <TrackerApp appearance={appearance} onAppearanceChange={setAppearance} />;
  }

  return (
    <Suspense fallback={<div className="loading-screen">Loading…</div>}>
      <CalculatorWebsite appearance={appearance} onAppearanceChange={setAppearance} />
    </Suspense>
  );
};

export default App;
