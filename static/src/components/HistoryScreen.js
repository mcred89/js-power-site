import React, { memo } from 'react';

// Keep the completed-workout list outside overlay and notification render traffic.
export const HistoryScreen = memo(({ eyebrow, routine, completed, PlanSetup, WorkoutCard, onOpen, onScreenRender }) => {
  onScreenRender?.();
  return <section className="section-page"><p className="eyebrow">{eyebrow}</p><h1>History</h1>{routine && <PlanSetup routine={routine} />}{completed.length ? completed.map(item => <WorkoutCard workout={item} onOpen={() => onOpen(item)} key={item.id} />) : <div className="empty-card"><p>Completed workouts will appear here.</p></div>}</section>;
});

