import { applyBatch, get } from './storage';

const commit = async batch => {
  try { await applyBatch(batch); }
  catch (error) {
    if (error.name === 'BatchConflictError') error.message = 'Training changed in another tab. Reload and try again.';
    throw error;
  }
};

// Metadata edits use the latest record and touch only their requested fields.
// The comparison still guards a concurrent change between the read and commit.
export const patchRecord = async (store, id, changes) => {
  const previous = await get(store, id);
  if (!previous) throw new Error('This record no longer exists. Reload to update your plans.');
  const updated = { ...previous, ...changes, id: previous.id, updatedAt: new Date().toISOString() };
  await commit({ puts: { [store]: [updated] }, conditions: { [store]: [{ key: id, expected: previous }] } });
  return updated;
};

export const saveCreatedRoutine = async (routine, profile) => {
  const updatedProfile = {
    ...profile,
    ...(routine.kind !== 'strongman' ? { activeRoutineId: routine.id, scheduledStrengthRoutineId: routine.id } : {}),
    updatedAt: new Date().toISOString(),
  };
  await commit({
    puts: { routines: [routine], profiles: [updatedProfile] },
    conditions: { routines: [{ key: routine.id, expected: undefined }], profiles: [{ key: profile.id, expected: profile }] },
  });
  return updatedProfile;
};
