import { applyBatch, get } from './storage';

// Resolve the record inside the shared write queue: a prior competition save
// may still be committing when the user submits a new name.
export const commitRoutineRename = (routineId, profileId, name, writer) => writer(null, async () => {
  const current = await get('routines', routineId);
  if (!current || current.profileId !== profileId) {
    throw new Error('This plan is no longer available. Reopen it and try again.');
  }
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Enter a plan name.');
  const updated = { ...current, name: trimmedName, updatedAt: new Date().toISOString() };
  try {
    await applyBatch({
      puts: { routines: [updated] },
      conditions: { routines: [{ key: current.id, expected: current }] },
    });
  } catch (error) {
    if (error.name === 'BatchConflictError') {
      throw new Error('This plan changed in another window. Try saving the name again.');
    }
    throw error;
  }
  return updated;
});
