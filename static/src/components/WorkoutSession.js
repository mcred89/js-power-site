import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionElapsedSeconds } from '../data/routines';

const SubstituteDialog = lazy(() => import('./WorkoutSubstituteDialog'));

export const formatDuration = value => {
  const seconds = Math.max(0, Number(value) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

// Isolate the one-second clock update from the session controls. Keeping this state in the
// parent caused every set, stepper, and action button to reconcile once per second.
const SessionClock = ({ session }) => {
  const [clock, setClock] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!session.runningSince) return undefined;
    const timer = window.setInterval(() => setClock(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, [session.runningSince]);
  return <strong>{formatDuration(sessionElapsedSeconds(session, clock))}</strong>;
};

export const useScreenWakeLock = active => {
  useEffect(() => {
    if (!active || !navigator.wakeLock?.request) return undefined;
    let lock = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== 'visible' || lock) return;
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (cancelled) {
          acquired.release();
          return;
        }
        lock = acquired;
        acquired.addEventListener?.('release', () => { lock = null; });
      } catch (error) {
        // Wake Lock is optional and may be denied by the browser or operating system.
      }
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      lock?.release();
    };
  }, [active]);
};

const Stepper = ({ label, value, step, onBlur, onChange }) => {
  const numeric = Number(value);
  const adjusted = change => onChange(String(Math.max(0, (Number.isFinite(numeric) ? numeric : 0) + change)));
  return (
    <div className="session-stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => adjusted(-step)}>−</button>
        <input
          aria-label={label}
          inputMode="decimal"
          value={value}
          onChange={event => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => adjusted(step)}>+</button>
      </div>
    </div>
  );
};

export const ActiveWorkoutSession = ({
  workout,
  onAdjust,
  onCompleteSet,
  onFinish,
  onLeave,
  onRpe,
  onSkipExercise,
  onSkipSet,
  onSubstitute,
  onUndo,
}) => {
  const session = workout.session;
  const [completedCount, totalCount, canUndo, pending] = useMemo(() => {
    const nextPending = [];
    let nextCompleted = 0;
    let nextTotal = 0;
    let nextCanUndo = false;
    // Performance invariant: all set-derived render state comes from this single traversal.
    // Finish-generated skips intentionally have no skippedAt and therefore remain non-reversible.
    session.exercises.forEach(item => {
      let firstPending = null;
      let pendingCount = 0;
      item.sets.forEach(set => {
        nextTotal += 1;
        if (set.status === 'completed') {
          nextCompleted += 1;
          nextCanUndo = true;
        } else if (set.status === 'pending') {
          pendingCount += 1;
          if (!firstPending) firstPending = set;
        } else if (set.status === 'skipped' && set.skippedAt) {
          nextCanUndo = true;
        }
      });
      nextPending.push([firstPending, pendingCount]);
    });
    return [nextCompleted, nextTotal, nextCanUndo, nextPending];
  }, [session]);
  const [exerciseIndex, setExerciseIndex] = useState(() => Math.max(0, pending.findIndex(item => item[0])));
  const [substituting, setSubstituting] = useState(false);
  const [drafts, setDrafts] = useState({});
  const draftsRef = useRef({});
  const draftTimersRef = useRef(new Map());
  const internalPointerRef = useRef(false);
  const internalPointerTimerRef = useRef();
  const onAdjustRef = useRef(onAdjust);
  onAdjustRef.current = onAdjust;

  useScreenWakeLock(true);

  const exercise = session.exercises[exerciseIndex];
  const currentSet = pending[exerciseIndex][0];

  const cancelDraftTimer = useCallback(setId => {
    const timer = draftTimersRef.current.get(setId);
    if (timer) window.clearTimeout(timer);
    draftTimersRef.current.delete(setId);
  }, []);

  const takeDraft = useCallback((setId, updateRenderedDrafts = true) => {
    const draft = draftsRef.current[setId];
    if (!draft) return null;
    cancelDraftTimer(setId);
    const next = { ...draftsRef.current };
    delete next[setId];
    draftsRef.current = next;
    if (updateRenderedDrafts) setDrafts(next);
    return draft;
  }, [cancelDraftTimer]);

  const flushDraft = useCallback(setId => {
    const draft = takeDraft(setId);
    if (draft) onAdjustRef.current(draft.exerciseId, setId, draft.values);
  }, [takeDraft]);

  const flushAllDrafts = useCallback(() => {
    Object.keys(draftsRef.current).forEach(flushDraft);
  }, [flushDraft]);

  const drainAllDrafts = useCallback(() => {
    // React cleanup must not enqueue state after unmount. Draining refs still invokes the
    // persistence callback immediately; browsers may terminate before any asynchronous
    // IndexedDB transaction completes, so visibilitychange/pagehide remain the primary guards.
    Object.keys(draftsRef.current).forEach(setId => {
      const draft = takeDraft(setId, false);
      if (draft) onAdjustRef.current(draft.exerciseId, setId, draft.values);
    });
  }, [takeDraft]);

  const updateDraft = (exerciseId, setId, values) => {
    const previous = draftsRef.current[setId]?.values || {};
    const next = {
      ...draftsRef.current,
      [setId]: { exerciseId, values: { ...previous, ...values } },
    };
    draftsRef.current = next;
    setDrafts(next);
    cancelDraftTimer(setId);
    // Performance invariant: editable set values stay local during an input burst. Future
    // controls must use draft-plus-flush semantics; status transitions must never be debounced.
    draftTimersRef.current.set(setId, window.setTimeout(() => flushDraft(setId), 250));
  };

  const consumesOrContinuesDraft = target => (
    target instanceof Element && target.closest('button, .session-stepper input')
  );

  const markInternalPointer = event => {
    if (!consumesOrContinuesDraft(event.target)) {
      internalPointerRef.current = false;
      return;
    }
    internalPointerRef.current = true;
    window.clearTimeout(internalPointerTimerRef.current);
    // Blur precedes click for pointer interaction. Keep the marker through that click so a
    // draft-consuming action can fold values into its single durable write.
    internalPointerTimerRef.current = window.setTimeout(() => {
      internalPointerRef.current = false;
    }, 0);
  };

  const blurDraft = (setId, event) => {
    const focusMovesToDraftControl = consumesOrContinuesDraft(event.relatedTarget);
    if (internalPointerRef.current || focusMovesToDraftControl) return;
    flushDraft(setId);
  };

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushAllDrafts();
    };
    const flushOnPageHide = () => flushAllDrafts();
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushOnPageHide);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushOnPageHide);
      window.clearTimeout(internalPointerTimerRef.current);
      drainAllDrafts();
    };
  }, [drainAllDrafts, flushAllDrafts]);

  const completeSet = () => {
    if (!currentSet) return;
    const hasMoreHere = pending[exerciseIndex][1] > 1;
    onCompleteSet(exercise.exerciseId, currentSet.id, takeDraft(currentSet.id)?.values);
    if (!hasMoreHere && exerciseIndex < session.exercises.length - 1) {
      setExerciseIndex(exerciseIndex + 1);
    }
  };

  const skipSet = () => {
    if (!currentSet) return;
    const hasMoreHere = pending[exerciseIndex][1] > 1;
    onSkipSet(exercise.exerciseId, currentSet.id, takeDraft(currentSet.id)?.values);
    if (!hasMoreHere && exerciseIndex < session.exercises.length - 1) setExerciseIndex(exerciseIndex + 1);
  };

  const skipExercise = () => {
    const draft = currentSet ? takeDraft(currentSet.id)?.values : undefined;
    onSkipExercise(exercise.exerciseId, currentSet?.id, draft);
    if (exerciseIndex < session.exercises.length - 1) setExerciseIndex(exerciseIndex + 1);
  };

  return (
    <section className="active-session" aria-label="Workout in progress" onMouseDownCapture={markInternalPointer} onPointerDownCapture={markInternalPointer}>
      <div className="session-topbar">
        <button className="text-button" type="button" onClick={() => { flushAllDrafts(); onLeave(); }}>← Leave</button>
        <div className="session-clock"><span>Workout time</span><SessionClock session={session} /></div>
        <span className="session-progress">{completedCount}/{totalCount} sets</span>
      </div>

      <p className="eyebrow">{workout.weekLabel} · {workout.name}</p>
      <div className="exercise-pager">
        <button type="button" aria-label="Previous exercise" disabled={exerciseIndex === 0} onClick={() => { flushAllDrafts(); setExerciseIndex(exerciseIndex - 1); }}>←</button>
        <div><small>Exercise {exerciseIndex + 1} of {session.exercises.length}</small><h1>{exercise.movement}</h1><p>{exercise.prescription || 'Open work'}</p></div>
        <button type="button" aria-label="Next exercise" disabled={exerciseIndex === session.exercises.length - 1} onClick={() => { flushAllDrafts(); setExerciseIndex(exerciseIndex + 1); }}>→</button>
      </div>

      <div className="set-tally" aria-label={`${exercise.movement} set tally`}>
        {exercise.sets.map(set => (
          <span className={set.status} key={set.id}>{set.status === 'completed' ? '✓' : set.status === 'skipped' ? '—' : set.number}</span>
        ))}
      </div>

      {exercise.original && <p className="substitution-note">Substituted for {exercise.original.movement} in this workout.</p>}

      {currentSet ? (
        <div className="current-set-card">
          <p>Set {currentSet.number} of {exercise.sets.length}</p>
          <Stepper label="Weight (lb)" value={drafts[currentSet.id]?.values.actualWeight ?? currentSet.actualWeight} step={5} onBlur={event => blurDraft(currentSet.id, event)} onChange={value => updateDraft(exercise.exerciseId, currentSet.id, { actualWeight: value })} />
          <Stepper label="Reps" value={drafts[currentSet.id]?.values.actualReps ?? currentSet.actualReps} step={1} onBlur={event => blurDraft(currentSet.id, event)} onChange={value => updateDraft(exercise.exerciseId, currentSet.id, { actualReps: value })} />
          <small>Plan: {currentSet.plannedWeight !== '' ? `${currentSet.plannedWeight} lb` : 'open weight'} · {currentSet.plannedReps || 'open reps'}</small>
          <button className="primary-button complete-set-button" type="button" onClick={completeSet}>Complete set</button>
          <button className="text-button skip-set-button" type="button" onClick={skipSet}>Skip this set</button>
        </div>
      ) : <div className="exercise-finished"><strong>Exercise complete</strong><span>Use the arrows to review another exercise.</span></div>}

      {exercise.exerciseId === session.primaryExerciseId && (
        <fieldset className="rpe-picker">
          <legend>Main-lift RPE</legend>
          <div>{Array.from({ length: 10 }, (_, index) => index + 1).map(value => (
            <button className={session.rpe === value ? 'selected' : ''} type="button" onClick={() => { flushAllDrafts(); onRpe(value); }} key={value}>{value}</button>
          ))}</div>
        </fieldset>
      )}

      <div className="session-footer-actions">
        <button className="secondary-button" type="button" disabled={!canUndo} onClick={() => { flushAllDrafts(); onUndo(); }}>Undo latest action</button>
        <button className="secondary-button" type="button" disabled={!currentSet} onClick={skipExercise}>Skip exercise</button>
        <button className="secondary-button" type="button" disabled={!currentSet} onClick={() => { flushAllDrafts(); setSubstituting(true); }}>Substitute</button>
        <button className="primary-button" type="button" onClick={() => { flushAllDrafts(); onFinish(); }}>Finish workout</button>
      </div>
      {substituting && <Suspense fallback={<p role="status">Opening substitute options…</p>}><SubstituteDialog exercise={exercise} onCancel={() => setSubstituting(false)} onConfirm={values => { onSubstitute(exercise.exerciseId, values); setSubstituting(false); }} /></Suspense>}
    </section>
  );
};
