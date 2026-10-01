import { serializedRecordsEqual } from './recordComparison';
import { applyBatch, get } from './storage';
import { changeProfileCompetition, completePastCompetition, competitionDateHasPassed } from './strongmanCompetitions';
import { createRoutine } from './routines';

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
    if (patch === null) return current;
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

// Recheck the stored date on every CAS retry: another window may have postponed
// or already ended the meet. No-op checks must not create writes or history.
export const completeExpiredProfileCompetition = (profileId, now = new Date()) => (
  commitProfilePatch(profileId, current => {
    const updated = completePastCompetition(current, now);
    return updated === current ? null : updated;
  })
);

export const createRoutineForProfile = async (observed, name, inputs, now = new Date()) => {
  const current = await completeExpiredProfileCompetition(observed.id, now);
  const expected = completePastCompetition(observed, now).strongmanCompetition ?? null;
  if (!serializedRecordsEqual(current.strongmanCompetition ?? null, expected)) throw conflict();
  const draft = inputs.strongmanCompetition;
  // Saved identities belong to the shared meet, never to a new builder draft.
  const creating = !current.strongmanCompetition && !draft?.id && inputs.includeStrongmanDay &&
    Boolean(draft?.name?.trim() || draft?.date || draft?.events?.length);
  const timestamp = now.toISOString();
  const competition = creating ? changeProfileCompetition(current, draft, timestamp).strongmanCompetition : null;
  const prepare = latest => creating
    ? completePastCompetition(changeProfileCompetition(latest, competition, timestamp), now) : latest;
  const routine = createRoutine(current.id, name, { ...inputs, strongmanCompetition: prepare(current).strongmanCompetition || null });
  const profile = await commitProfilePatch(current.id, latest => {
    const updated = prepare(latest);
    return { activeRoutineId: routine.id, updatedAt: timestamp,
      ...(creating ? { strongmanCompetition: updated.strongmanCompetition,
        strongmanCompetitionHistory: updated.strongmanCompetitionHistory } : {}) };
  }, { puts: { routines: [routine] } }, { expectedCompetition: current.strongmanCompetition || null });
  return { routine, profile };
};

export const observeCompetitionCompletion = (profiles, publish, reportError) => {
  let disposed = false;
  let running = false;
  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      for (const observed of profiles.filter(profile => competitionDateHasPassed(profile.strongmanCompetition))) {
        if (disposed) return;
        try {
          const updated = await completeExpiredProfileCompetition(observed.id);
          if (!disposed) publish(observed, updated);
        } catch (error) {
          if (!disposed) reportError(`Could not automatically complete the competition: ${error.message}`);
        }
      }
    } finally { running = false; }
  };
  refresh();
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    disposed = true;
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
};
