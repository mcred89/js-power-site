import React, { useState } from 'react';
import { StrongmanCompetitionCard } from './StrongmanCompetition';
import { StrongmanTraining } from './StrongmanTraining';
import { WorkoutSessionHistory } from './WorkoutSessionHistory';
import { visibleExercise } from '../data/routines';
import { WorkoutWeekLabel } from './WorkoutWeekLabel';

export const StrongmanDay = ({ routine, workout, calendarWeek, routines, competition, competitionHistory = [], onBack, onSaveLog, onComplete, onDelete }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const legacyExercises = (workout.exercises || []).map(visibleExercise).filter(exercise => (
    exercise.movement !== 'Strongman day' || exercise.weight !== '' || exercise.prescription
  ));
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
    <button className="text-button" type="button" onClick={onBack} disabled={busy}>← Back</button>
    <p className="eyebrow"><WorkoutWeekLabel workout={workout} calendarWeek={calendarWeek} /></p>
    <h1>Strongman day</h1>
    <p>{workout.completedAt ? 'Your recorded training. You can add or correct results here.' : 'Choose what to work on today. Record each effort as you go.'}</p>
    <StrongmanCompetitionCard routine={routine} routines={routines} competition={competition} />
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
    <StrongmanTraining routine={routine} workout={workout} routines={routines} competition={competition} competitionHistory={competitionHistory} onSaveLog={onSaveLog} onEditingChange={setEditing} />
    {error && <p role="alert">{error}</p>}
    <button className="primary-button full-button" type="button" onClick={complete} disabled={busy || editing}>
      {busy ? 'Saving…' : workout.completedAt ? 'Return to workout queue' : 'Finish strongman day'}
    </button>
    {editing && <p className="field-help">Save or cancel your changes before finishing the day.</p>}
    {!workout.completedAt && onDelete && <button className="danger-button full-button" type="button" onClick={onDelete} disabled={busy || editing}>Delete future workout</button>}
  </section>;
};
