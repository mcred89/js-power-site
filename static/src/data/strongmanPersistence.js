import { validateStrongmanRecord } from './strongman';
import { setWorkoutComplete } from './routines';
import { applyBatch } from './storage';

// Loaded only after a Strongman action. Validation and conflict handling stay
// outside the eager tracker entry without making persistence optimistic.
export const commitStrongmanChange = async (current, profileId, action, value, saveRoutine) => {
  if (!current || current.profileId !== profileId) {
    throw new Error('This plan is no longer available. Reopen it and try again.');
  }
  let updated;
  let message;
  if (action === 'log') {
    updated = { ...current, strongmanLog: value };
    validateStrongmanRecord(updated);
  } else if (action === 'training') {
    if (!Array.isArray(value.entries) || !Array.isArray(value.queue)) {
      throw new Error('Training results and copied sets must be lists.');
    }
    const workout = current.workouts.find(item => item.id === value.workoutId);
    if (!workout || workout.completedAt) {
      throw new Error('This workout is no longer available for training. Reopen your plan and try again.');
    }
    updated = {
      ...current,
      strongmanLog: value.entries,
      workouts: current.workouts.map(item => item.id === workout.id ? { ...item, strongmanQueue: value.queue } : item),
    };
    validateStrongmanRecord(updated);
  } else if (action === 'completion') {
    const workout = current.workouts.find(item => item.id === value.workoutId);
    if (!workout) {
      throw new Error('This workout is no longer available. Reopen your plan and try again.');
    }
    if (value.complete && workout.strongmanQueue?.length) {
      throw new Error('Log or remove the remaining copied sets before finishing the day.');
    }
    updated = setWorkoutComplete(current, value.workoutId, value.complete);
    message = value.complete ? 'Strongman day complete. Your results are saved.' : 'Workout returned to your queue.';
  } else {
    throw new Error('Choose a supported Strongman change.');
  }
  updated = { ...updated, updatedAt: new Date().toISOString() };
  try {
    await saveRoutine(updated, record => applyBatch({
      puts: { routines: [record] },
      conditions: { routines: [{ key: current.id, expected: current }] },
    }), true);
  } catch (error) {
    if (error.name === 'BatchConflictError') {
      throw new Error('This plan changed in another window. Reload it before saving your changes.');
    }
    throw error;
  }
  return message;
};
