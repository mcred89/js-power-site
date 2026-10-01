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
  } else if (action === 'completion') {
    if (!current.workouts.some(workout => workout.id === value.workoutId)) {
      throw new Error('This workout is no longer available. Reopen your plan and try again.');
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
