import React, { useMemo } from 'react';
import { formatDuration } from './WorkoutSession';
import { isTabataRound } from '../data/tabata';

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
  const hasRounds = workout.session.exercises.some(exercise => exercise.sets.some(set => (
    isTabataRound(exercise, set) && !Object.prototype.hasOwnProperty.call(set, 'tabataTimer')
  )));
  const progressLabel = hasRounds ? 'sets + rounds' : 'sets';
  return (
    <section className="workout-summary" aria-labelledby="workout-summary-title">
      <p className="eyebrow">Workout complete</p>
      <h1 id="workout-summary-title">{workout.name}</h1>
      <div className="summary-grid">
        <span><small>Workout time</small><strong>{formatDuration(workout.session.elapsedSeconds)}</strong></span>
        <span><small>Completed {progressLabel}</small><strong>{completed.length}</strong></span>
        <span><small>Skipped {progressLabel}</small><strong>{skipped.length}</strong></span>
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
            {exercise.sets.map(set => {
              const tabata = isTabataRound(exercise, set);
              const legacyRound = tabata && !Object.prototype.hasOwnProperty.call(set, 'tabataTimer');
              return (
                <div className={`history-set ${set.status}`} key={set.id}>
                  <strong>{legacyRound ? 'Round' : 'Set'} {set.number}</strong>
                  {set.status === 'completed' ? (
                    <>
                      {tabata
                        ? <span>{legacyRound ? '20 seconds sprint / 10 seconds rest' : 'Tabata finisher complete'}{set.tabataTimer && ` · ${formatDuration(Math.floor(set.tabataTimer.elapsedMs / 1000))}`}</span>
                        : <span>{set.actualWeight !== '' ? `${set.actualWeight} lb` : 'Open weight'} × {set.actualReps !== '' ? `${set.actualReps} reps` : 'open reps'}</span>}
                      <small>Split {formatDuration(set.splitSeconds)} · Interval {formatDuration(intervals.get(set.id))}</small>
                      {!tabata && (String(set.actualWeight) !== String(set.plannedWeight) || String(set.actualReps) !== String(set.plannedReps)) && (
                        <small>Plan: {set.plannedWeight !== '' ? `${set.plannedWeight} lb` : 'open weight'} × {set.plannedReps || 'open reps'}</small>
                      )}
                    </>
                  ) : <span>Skipped</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
