import React, { memo, useLayoutEffect, useRef, useState } from 'react';

const HISTORY_PAGE_SIZE = 25;
let historySession = { key: null, count: HISTORY_PAGE_SIZE };

// Keep the completed-workout list outside overlay and notification render traffic.
export const HistoryScreen = memo(({ eyebrow, routine, completed, PlanSetup, WorkoutCard, onOpen, onScreenRender }) => {
  // Routine IDs are globally unique, so this also changes whenever a profile switch selects
  // that profile's routine. The empty key cannot retain expansion because it has no history.
  const historyKey = routine?.id || '';
  const [requestedCount, setRequestedCount] = useState(() => historySession.key === historyKey ? historySession.count : HISTORY_PAGE_SIZE);
  const firstAddedIndex = useRef(null);
  const listRef = useRef(null);
  const visibleCount = historySession.key === historyKey
    ? Math.min(requestedCount, Math.max(HISTORY_PAGE_SIZE, completed.length))
    : HISTORY_PAGE_SIZE;
  const visible = completed.slice(0, visibleCount);

  useLayoutEffect(() => {
    // This lazy module survives workout-detail unmounts. Keep one session window here so a
    // detail round trip retains expansion, while any profile/routine change resets to 25.
    const count = historySession.key === historyKey
      ? Math.min(requestedCount, Math.max(HISTORY_PAGE_SIZE, completed.length))
      : HISTORY_PAGE_SIZE;
    historySession = { key: historyKey, count };
    if (requestedCount !== count) setRequestedCount(count);
  }, [completed.length, historyKey, requestedCount]);

  useLayoutEffect(() => {
    if (firstAddedIndex.current === null) return;
    const added = listRef.current?.children[firstAddedIndex.current];
    const focusTarget = added?.querySelector('button, [href], input, select, textarea, [tabindex]') || added;
    focusTarget?.focus();
    firstAddedIndex.current = null;
  }, [visible.length]);

  const showOlder = () => {
    firstAddedIndex.current = visible.length;
    const count = Math.min(completed.length, visible.length + HISTORY_PAGE_SIZE);
    historySession = { key: historyKey, count };
    setRequestedCount(count);
  };

  onScreenRender?.();
  return (
    <section className="section-page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>History</h1>
      {routine && <PlanSetup routine={routine} />}
      {completed.length ? (
        <>
          {/* Keep only this window mounted: long histories must not grow the DOM without bound. */}
          <div className="history-workout-list" ref={listRef}>
            {visible.map(item => <div className="history-workout" key={item.id}><WorkoutCard workout={item} onOpen={() => onOpen(item)} /></div>)}
          </div>
          {visible.length < completed.length && (
            <button className="secondary-button full-button" type="button" onClick={showOlder}>
              Show 25 older workouts
            </button>
          )}
        </>
      ) : <div className="empty-card"><p>Completed workouts will appear here.</p></div>}
    </section>
  );
});
