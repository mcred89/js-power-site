import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionElapsedSeconds } from '../data/routines';

export const formatDuration = value => {
  const seconds = Math.max(0, Number(value) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const progressFor = session => {
  const sets = session.exercises.flatMap(exercise => exercise.sets);
  return {
    completed: sets.filter(set => set.status === 'completed').length,
    total: sets.length,
  };
};

const currentExerciseIndex = session => {
  const index = session.exercises.findIndex(exercise => (
    exercise.sets.some(set => set.status === 'pending')
  ));
  return index === -1 ? 0 : index;
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

const SubstituteDialog = ({ exercise, onCancel, onConfirm }) => {
  const pending = exercise.sets.filter(set => set.status === 'pending');
  const first = pending[0] || {};
  const [movement, setMovement] = useState(exercise.movement);
  const [weight, setWeight] = useState(first.actualWeight ?? exercise.plannedWeight ?? '');
  const [setCount, setSetCount] = useState(String(Math.max(1, pending.length)));
  const [reps, setReps] = useState(String(first.actualReps ?? first.plannedReps ?? ''));
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="substitute-title" onSubmit={event => {
        event.preventDefault();
        onConfirm({ movement: movement.trim(), weight, setCount, reps });
      }}>
        <p className="eyebrow">This workout only</p>
        <h2 id="substitute-title">Substitute {exercise.movement}</h2>
        <label className="form-field"><span className="field-label">Movement</span><input className="number-input" value={movement} onChange={event => setMovement(event.target.value)} required autoFocus /></label>
        <div className="substitute-fields">
          <label className="form-field"><span className="field-label">Weight (lb)</span><input className="number-input" inputMode="decimal" value={weight} onChange={event => setWeight(event.target.value)} /></label>
          <label className="form-field"><span className="field-label">Remaining sets</span><input className="number-input" type="number" min="1" max="20" value={setCount} onChange={event => setSetCount(event.target.value)} required /></label>
          <label className="form-field"><span className="field-label">Reps</span><input className="number-input" inputMode="numeric" value={reps} onChange={event => setReps(event.target.value)} required /></label>
        </div>
        <p className="field-help">Completed and skipped sets stay unchanged. Future workouts are not edited.</p>
        <div className="button-row modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Use substitute</button></div>
      </form>
    </div>
  );
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
  const [exerciseIndex, setExerciseIndex] = useState(() => currentExerciseIndex(session));
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
  const progress = progressFor(session);
  const currentSet = exercise.sets.find(set => set.status === 'pending');
  const reversibleSets = session.exercises.flatMap(item => item.sets)
    .filter(set => set.status === 'completed' || (set.status === 'skipped' && set.skippedAt));

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
    target instanceof Element && Boolean(target.closest('button, .session-stepper input'))
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
    const hasMoreHere = exercise.sets.some(set => (
      set.status === 'pending' && set.id !== currentSet.id
    ));
    onCompleteSet(exercise.exerciseId, currentSet.id, takeDraft(currentSet.id)?.values);
    if (!hasMoreHere && exerciseIndex < session.exercises.length - 1) {
      setExerciseIndex(exerciseIndex + 1);
    }
  };

  const skipSet = () => {
    if (!currentSet) return;
    const hasMoreHere = exercise.sets.some(set => set.status === 'pending' && set.id !== currentSet.id);
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
        <span className="session-progress">{progress.completed}/{progress.total} sets</span>
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
        <button className="secondary-button" type="button" disabled={!reversibleSets.length} onClick={() => { flushAllDrafts(); onUndo(); }}>Undo latest action</button>
        <button className="secondary-button" type="button" disabled={!currentSet} onClick={skipExercise}>Skip exercise</button>
        <button className="secondary-button" type="button" disabled={!currentSet} onClick={() => { flushAllDrafts(); setSubstituting(true); }}>Substitute</button>
        <button className="primary-button" type="button" onClick={() => { flushAllDrafts(); onFinish(); }}>Finish workout</button>
      </div>
      {substituting && <SubstituteDialog exercise={exercise} onCancel={() => setSubstituting(false)} onConfirm={values => { onSubstitute(exercise.exerciseId, values); setSubstituting(false); }} />}
    </section>
  );
};

export const WorkoutSummary = ({ workout, onDone }) => {
  const sets = workout.session.exercises.flatMap(exercise => exercise.sets);
  const completed = sets.filter(set => set.status === 'completed');
  const skipped = sets.filter(set => set.status === 'skipped');
  const volume = completed.reduce((total, set) => {
    const weight = Number(set.actualWeight);
    const reps = Number(set.actualReps);
    return total + (Number.isFinite(weight) && Number.isFinite(reps) ? weight * reps : 0);
  }, 0);
  const substitutions = workout.session.exercises.filter(exercise => exercise.original);
  return (
    <section className="workout-summary" aria-labelledby="workout-summary-title">
      <p className="eyebrow">Workout complete</p>
      <h1 id="workout-summary-title">{workout.name}</h1>
      <div className="summary-grid">
        <span><small>Workout time</small><strong>{formatDuration(workout.session.elapsedSeconds)}</strong></span>
        <span><small>Completed sets</small><strong>{completed.length}</strong></span>
        <span><small>Skipped sets</small><strong>{skipped.length}</strong></span>
        <span><small>Volume</small><strong>{Math.round(volume).toLocaleString()} lb</strong></span>
        <span><small>Main-lift RPE</small><strong>{workout.session.rpe || '—'}</strong></span>
      </div>
      {substitutions.length > 0 && <div className="summary-substitutions"><h2>Substitutions</h2>{substitutions.map(exercise => <p key={exercise.exerciseId}>{exercise.original.movement} → {exercise.movement}</p>)}</div>}
      <button className="primary-button" type="button" onClick={onDone}>Done</button>
    </section>
  );
};

export const WorkoutSessionHistory = ({ workout }) => {
  const session = workout.session;
  const intervals = useMemo(() => {
    const result = new Map();
    let previous = 0;
    session.exercises.flatMap(exercise => exercise.sets)
      .filter(set => set.status === 'completed')
      .sort((a, b) => a.splitSeconds - b.splitSeconds)
      .forEach(set => {
        result.set(set.id, set.splitSeconds - previous);
        previous = set.splitSeconds;
      });
    return result;
  }, [session]);

  return (
    <div className="session-history">
      <div className="history-summary">
        <span><small>Workout time</small><strong>{formatDuration(session.elapsedSeconds)}</strong></span>
        <span><small>Main-lift RPE</small><strong>{session.rpe || '—'}</strong></span>
      </div>
      {session.exercises.map(exercise => (
        <section className="history-exercise" key={exercise.exerciseId}>
          <h2>{exercise.movement}</h2>
          {exercise.original && <p className="substitution-note">Substituted for {exercise.original.movement}</p>}
          <p>{exercise.prescription || 'Open work'}</p>
          <div className="history-set-list">
            {exercise.sets.map(set => (
              <div className={`history-set ${set.status}`} key={set.id}>
                <strong>Set {set.number}</strong>
                {set.status === 'completed' ? (
                  <>
                    <span>{set.actualWeight !== '' ? `${set.actualWeight} lb` : 'Open weight'} × {set.actualReps !== '' ? `${set.actualReps} reps` : 'open reps'}</span>
                    <small>Split {formatDuration(set.splitSeconds)} · Interval {formatDuration(intervals.get(set.id))}</small>
                    {(String(set.actualWeight) !== String(set.plannedWeight) || String(set.actualReps) !== String(set.plannedReps)) && (
                      <small>Plan: {set.plannedWeight !== '' ? `${set.plannedWeight} lb` : 'open weight'} × {set.plannedReps || 'open reps'}</small>
                    )}
                  </>
                ) : <span>Skipped</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
