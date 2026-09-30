import React, { memo, useState } from 'react';
import { ProgressDashboard } from './ProgressDashboard';
import { StrongmanProgress } from './StrongmanProgress';
import { confirmNavigation } from '../data/navigationGuard';

// Shell-only notifications must not repeat the history aggregation and chart render.
export const ProgressScreen = memo(({ profile, routines, onSaveLog, onScreenRender }) => {
  const [section, setSection] = useState('strength');
  onScreenRender?.();
  return <>
    <div className="strongman-progress-tabs" role="tablist" aria-label="Progress view">
      {[['strength', 'Strength'], ['strongman', 'Strongman records']].map(([key, label]) => (
        <button key={key} type="button" role="tab" id={`progress-tab-${key}`} aria-selected={section === key}
          aria-controls={`progress-panel-${key}`} className={section === key ? 'selected' : ''}
          tabIndex={section === key ? 0 : -1}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'strength' : event.key === 'End' ? 'strongman' : key === 'strength' ? 'strongman' : 'strength';
            if (next !== section && !confirmNavigation()) return;
            setSection(next);
            document.getElementById(`progress-tab-${next}`)?.focus();
          }}
          onClick={() => { if (key !== section && confirmNavigation()) setSection(key); }}>{label}</button>
      ))}
    </div>
    <div role="tabpanel" id={`progress-panel-${section}`} aria-labelledby={`progress-tab-${section}`}>
      {section === 'strength' ? <ProgressDashboard profile={profile} routines={routines} /> : <>
        <p className="eyebrow">{profile.name}</p><h1>Progress</h1>
        <StrongmanProgress routines={routines} defaultRoutineId={profile.activeRoutineId} onSaveLog={onSaveLog} />
      </>}
    </div>
  </>;
});

