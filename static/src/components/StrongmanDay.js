import React, { useState } from 'react';
import { StrongmanCompetitionCard } from './StrongmanCompetition';
import { StrongmanTraining } from './StrongmanTraining';
import { WorkoutSessionHistory } from './WorkoutSessionHistory';
import { visibleExercise } from '../data/routines';

export const StrongmanDay = ({ routine, workout, routines, onBack, onSaveCompetition, onSaveLog, onComplete }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingCompetition, setEditingCompetition] = useState(false);
  const legacyExercises = (workout.exercises || []).map(visibleExercise).filter(exercise => (
    exercise.movement !== 'Strongman day' || exercise.weight !== '' || exercise.prescription
  ));
  const leave = () => {
    if ((editing || editingCompetition) && !window.confirm('Discard unsaved changes and leave this day?')) return;
    onBack();
  };
  const complete = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onComplete(!workout.completedAt);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return <section className="workout-detail strongman-day">
    <button className="text-button" type="button" onClick={leave} disabled={busy}>← Back</button>
    <p className="eyebrow">{routine.name} · {workout.weekLabel}</p>
    <h1>Strongman day</h1>
    <p>{workout.completedAt ? 'Your recorded training. You can add or correct results here.' : 'Choose what to work on today. Record each effort as you go.'}</p>
    <StrongmanCompetitionCard routine={routine} routines={routines} onSaveCompetition={onSaveCompetition} onEditingChange={setEditingCompetition} />
    {workout.session?.status === 'completed' && <details>
      <summary>Previously recorded workout</summary>
      <WorkoutSessionHistory workout={workout} />
    </details>}
    {!workout.session && legacyExercises.length > 0 && <details>
      <summary>Previously entered exercises</summary>
      <p className="field-help">These saved plan notes are preserved. Log actual results below to include them in your records.</p>
      {legacyExercises.map((exercise, index) => <p key={index}><strong>{exercise.movement}</strong>
        {exercise.weight !== '' && ` · ${exercise.weight} lb`}{exercise.prescription && ` · ${exercise.prescription}`}
      </p>)}
    </details>}
    <StrongmanTraining routine={routine} workout={workout} routines={routines} onSaveLog={onSaveLog} onEditingChange={setEditing} />
    {error && <p role="alert">{error}</p>}
    <button className="primary-button full-button" type="button" onClick={complete} disabled={busy || editing || editingCompetition}>
      {busy ? 'Saving…' : workout.completedAt ? 'Return to workout queue' : 'Finish strongman day'}
    </button>
    {(editing || editingCompetition) && <p className="field-help">Save or cancel your changes before finishing the day.</p>}
  </section>;
};
