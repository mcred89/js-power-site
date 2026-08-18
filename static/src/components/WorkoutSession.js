import React, { useEffect, useMemo, useState } from 'react';
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

const Stepper = ({ label, value, step, onChange }) => {
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
  onUndo,
}) => {
  const session = workout.session;
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [clock, setClock] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!session.runningSince) return undefined;
    const timer = window.setInterval(() => setClock(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, [session.runningSince]);

  const exercise = session.exercises[exerciseIndex];
  const progress = progressFor(session);
  const currentSet = exercise.sets.find(set => set.status === 'pending');
  const completedSets = session.exercises.flatMap(item => item.sets)
    .filter(set => set.status === 'completed');
  const elapsed = sessionElapsedSeconds(session, clock);

  const completeSet = () => {
    if (!currentSet) return;
    const hasMoreHere = exercise.sets.some(set => (
      set.status === 'pending' && set.id !== currentSet.id
    ));
    onCompleteSet(exercise.exerciseId, currentSet.id);
    if (!hasMoreHere && exerciseIndex < session.exercises.length - 1) {
      setExerciseIndex(exerciseIndex + 1);
    }
  };

  return (
    <section className="active-session" aria-label="Workout in progress">
      <div className="session-topbar">
        <button className="text-button" type="button" onClick={onLeave}>← Leave</button>
        <div className="session-clock"><span>Workout time</span><strong>{formatDuration(elapsed)}</strong></div>
        <span className="session-progress">{progress.completed}/{progress.total} sets</span>
      </div>

      <p className="eyebrow">{workout.weekLabel} · {workout.name}</p>
      <div className="exercise-pager">
        <button type="button" aria-label="Previous exercise" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex(exerciseIndex - 1)}>←</button>
        <div><small>Exercise {exerciseIndex + 1} of {session.exercises.length}</small><h1>{exercise.movement}</h1><p>{exercise.prescription || 'Open work'}</p></div>
        <button type="button" aria-label="Next exercise" disabled={exerciseIndex === session.exercises.length - 1} onClick={() => setExerciseIndex(exerciseIndex + 1)}>→</button>
      </div>

      <div className="set-tally" aria-label={`${exercise.movement} set tally`}>
        {exercise.sets.map(set => (
          <span className={set.status} key={set.id}>{set.status === 'completed' ? '✓' : set.number}</span>
        ))}
      </div>

      {currentSet ? (
        <div className="current-set-card">
          <p>Set {currentSet.number} of {exercise.sets.length}</p>
          <Stepper label="Weight (lb)" value={currentSet.actualWeight} step={5} onChange={value => onAdjust(exercise.exerciseId, currentSet.id, { actualWeight: value })} />
          <Stepper label="Reps" value={currentSet.actualReps} step={1} onChange={value => onAdjust(exercise.exerciseId, currentSet.id, { actualReps: value })} />
          <small>Plan: {currentSet.plannedWeight !== '' ? `${currentSet.plannedWeight} lb` : 'open weight'} · {currentSet.plannedReps || 'open reps'}</small>
          <button className="primary-button complete-set-button" type="button" onClick={completeSet}>Complete set</button>
        </div>
      ) : <div className="exercise-finished"><strong>Exercise complete</strong><span>Use the arrows to review another exercise.</span></div>}

      {exercise.exerciseId === session.primaryExerciseId && (
        <fieldset className="rpe-picker">
          <legend>Main-lift RPE</legend>
          <div>{Array.from({ length: 10 }, (_, index) => index + 1).map(value => (
            <button className={session.rpe === value ? 'selected' : ''} type="button" onClick={() => onRpe(value)} key={value}>{value}</button>
          ))}</div>
        </fieldset>
      )}

      <div className="session-footer-actions">
        <button className="secondary-button" type="button" disabled={!completedSets.length} onClick={onUndo}>Undo latest set</button>
        <button className="primary-button" type="button" onClick={onFinish}>Finish workout</button>
      </div>
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
