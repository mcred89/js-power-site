import React from 'react';
import { visibleExercise } from '../data/routines';

const WorkoutExerciseEditor = ({ workout, onChange }) => (
  <div className="exercise-list">
    {workout.exercises.map(exercise => {
      const shown = visibleExercise(exercise);
      return (
        <div className="exercise-row" key={exercise.id}>
          <input aria-label="Movement" defaultValue={shown.movement} onBlur={event => onChange(exercise.id, { movement: event.target.value })} />
          <input aria-label="Weight" inputMode="decimal" defaultValue={shown.weight} placeholder="Weight" onBlur={event => onChange(exercise.id, { weight: event.target.value })} />
          <input aria-label="Prescription" defaultValue={shown.prescription} placeholder="Prescription" onBlur={event => onChange(exercise.id, { prescription: event.target.value })} />
          <button className="text-button" type="button" onClick={() => onChange(exercise.id, null)}>Use generated</button>
        </div>
      );
    })}
  </div>
);

export default WorkoutExerciseEditor;
