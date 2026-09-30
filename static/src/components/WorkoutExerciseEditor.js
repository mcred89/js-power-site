import React from 'react';
import { visibleExercise } from '../data/routines';
import { clearExerciseOverrides, updateExercise } from '../data/workoutActions';

const WorkoutExerciseEditor = ({ workout, onChange }) => {
  // The editor loads its actions before any field can blur. Keep the change
  // synchronous so a following Start click snapshots the final typed values.
  const changeExercise = (exerciseId, values) => onChange(current => (
    values
      ? updateExercise(current, workout.id, exerciseId, values)
      : clearExerciseOverrides(current, workout.id, exerciseId)
  ));
  return (
    <div className="exercise-list">
      {workout.exercises.map(exercise => {
        const shown = visibleExercise(exercise);
        return (
          <div className="exercise-row" key={exercise.id}>
            <input aria-label="Movement" defaultValue={shown.movement} onBlur={event => changeExercise(exercise.id, { movement: event.target.value })} />
            <input aria-label="Weight" inputMode="decimal" defaultValue={shown.weight} placeholder="Weight" onBlur={event => changeExercise(exercise.id, { weight: event.target.value })} />
            <input aria-label="Prescription" defaultValue={shown.prescription} placeholder="Prescription" onBlur={event => changeExercise(exercise.id, { prescription: event.target.value })} />
            <button className="text-button" type="button" onClick={() => changeExercise(exercise.id, null)}>Use generated</button>
          </div>
        );
      })}
    </div>
  );
};

export default WorkoutExerciseEditor;
