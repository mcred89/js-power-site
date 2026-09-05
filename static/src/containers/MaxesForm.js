import React, { forwardRef, lazy, Suspense, useState } from 'react';
import { RoutineForm } from '../components/RoutineForm';
import Routine from '../components/RoutineGenerator';

const CalculatorPlanning = lazy(() => import('./CalculatorPlanning'));

// The installed tracker imports RoutineForm directly. Keep calculator results and
// optional profile planning behind this website-only wrapper.
export const MaxesForm = forwardRef((props, ref) => {
  const [mode, setMode] = useState('strength');
  const [planningOpen, setPlanningOpen] = useState(false);
  const [requestProfiles, setRequestProfiles] = useState(false);
  const [context, setContext] = useState(null);
  const activeStrongman = props.activeStrongman || context?.activeStrongman;
  return <>
    {!props.onCreate && <div className="strongman-row" aria-label="Calculator type">
      <button className="secondary-button" type="button" aria-pressed={mode === 'strength'} onClick={() => setMode('strength')}>Strength routine</button>
      <button className="secondary-button" type="button" aria-pressed={mode === 'strongman'} onClick={() => { setMode('strongman'); setPlanningOpen(true); }}>Strongman block</button>
      {!planningOpen && <button className="text-button" type="button" onClick={() => { setPlanningOpen(true); setRequestProfiles(true); }}>Use a local profile</button>}
    </div>}
    {planningOpen && <Suspense fallback={<p role="status">Loading event planning…</p>}><CalculatorPlanning mode={mode} requestProfiles={requestProfiles} onContextChange={setContext} onCancel={() => setMode('strength')} /></Suspense>}
    <div hidden={mode !== 'strength'}><RoutineForm
      {...props}
      ref={ref}
      activeStrongman={activeStrongman}
      renderResult={(inputs, onReset) => <Routine {...inputs} includeStrongmanDay={activeStrongman?.status === 'active' || inputs.includeStrongmanDay} onReset={onReset} />}
    /></div>
  </>;
});
