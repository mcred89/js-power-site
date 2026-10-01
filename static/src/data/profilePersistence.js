import { serializedRecordsEqual } from './recordComparison';
import { applyBatch, get } from './storage';

const conflict = () => Object.assign(new Error('This profile changed in another window. Reload it before saving your changes.'), {
  name: 'BatchConflictError',
});

// Profile preferences and pointers share a record with the active competition.
// Merge only this action's fields into a fresh record so an unrelated stale tab
// cannot restore a completed competition or discard its saved history.
export const commitProfilePatch = async (profileId, changes, batch = {}, options = {}) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await get('profiles', profileId);
    if (!current) throw new Error('This profile is no longer available. Reopen the app and choose a profile.');
    if (Object.prototype.hasOwnProperty.call(options, 'expectedCompetition') &&
        !serializedRecordsEqual(current.strongmanCompetition ?? null, options.expectedCompetition ?? null)) {
      throw conflict();
    }
    const patch = typeof changes === 'function' ? changes(current) : changes;
    const updated = { ...current, ...patch, id: profileId };
    try {
      await applyBatch({
        ...batch,
        puts: {
          ...batch.puts,
          profiles: [...(batch.puts?.profiles || []).filter(profile => profile.id !== profileId), updated],
        },
        conditions: {
          ...batch.conditions,
          profiles: [...(batch.conditions?.profiles || []), { key: profileId, expected: current }],
        },
      });
      return updated;
    } catch (error) {
      if (error.name !== 'BatchConflictError') throw error;
      if (attempt === 2) throw conflict();
    }
  }
  throw conflict();
};
