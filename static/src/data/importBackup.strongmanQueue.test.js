import { createImportPlan } from './importBackup';
import { validateStrongmanRecord } from './strongman';

const first = { id: 's1', weight: 200, reps: 5, successful: true };
const second = { id: 's2', weight: 220, reps: 3, successful: true, unknown: { retained: true } };
const queued = { id: 'q', workoutId: 'day', date: '2026-01-01', movement: 'Axle', scope: 'movement',
  notes: 'Local setup', sets: [first, second], unknown: { retained: true } };
const local = { id: 'plan', profileId: 'athlete', name: 'Local name', strongmanLog: [],
  workouts: [{ id: 'day', name: 'Strongman', exercises: [], strongmanQueue: [queued], unknown: 'keep' }] };
const backupFor = routine => ({ profiles: [], routines: [routine], templates: [], archives: [] });
const merge = (current, incoming) => createImportPlan(backupFor(incoming), [], [current]).routines[0].result;

it.each(['q', 'different-setup-entry'])('removes imported actual sets from the pending queue when logged as %s', actualId => {
  const actual = { ...queued, id: actualId, notes: 'Felt strong', sets: [{ ...first, weight: 205 }] };
  const incoming = { ...local, name: 'Backup name', strongmanLog: [actual],
    workouts: [{ ...local.workouts[0], strongmanQueue: [{ ...queued, sets: [second] }] }] };
  const before = JSON.stringify({ local, incoming });
  const result = merge(local, incoming);

  expect(result.name).toBe('Local name');
  expect(result.strongmanLog).toEqual([actual]);
  expect(result.strongmanLog[0]).toBe(actual);
  expect(result.workouts[0]).toEqual({ ...local.workouts[0], strongmanQueue: [{ ...queued, sets: [second] }] });
  expect(result.workouts[0].strongmanQueue[0].sets[0]).toBe(second);
  expect(JSON.stringify({ local, incoming })).toBe(before);
  expect(merge(result, incoming)).toEqual(result);

  // The next pending set can now be logged without repeating an actual set ID.
  const existing = result.strongmanLog[0];
  const finished = { ...result, strongmanLog: [{ ...existing, sets: [...existing.sets, second] }],
    workouts: [{ ...result.workouts[0], strongmanQueue: [] }] };
  expect(() => validateStrongmanRecord(finished)).not.toThrow();
});

it('drops fully logged queue entries while keeping local pending choices and all actual history', () => {
  const other = { ...queued, id: 'other', movement: 'Stones', sets: [{ ...second, id: 'stone-set' }] };
  const current = { ...local, workouts: [{ ...local.workouts[0], strongmanQueue: [queued, other] }] };
  const incoming = { ...local, strongmanLog: [{ ...queued, notes: 'Actual completed work' }],
    workouts: [{ ...local.workouts[0], strongmanQueue: [] }] };
  const before = JSON.stringify({ current, incoming });
  const result = merge(current, incoming);
  expect(result.workouts[0].strongmanQueue).toEqual([other]);
  expect(result.workouts[0].strongmanQueue[0]).toBe(other);
  expect(result.strongmanLog).toEqual(incoming.strongmanLog);
  expect(JSON.stringify({ current, incoming })).toBe(before);
});

it('uses all conflicting history versions without changing their results', () => {
  const actual = { ...queued, sets: [first] };
  const current = { ...local, strongmanLog: [actual] };
  const incomingActual = { ...queued, notes: 'Imported correction', sets: [{ ...first, weight: 210 }, second] };
  const incoming = { ...local, strongmanLog: [incomingActual], workouts: [{ ...local.workouts[0], strongmanQueue: [] }] };
  const result = merge(current, incoming);
  expect(result.strongmanLog).toEqual([actual, { ...incomingActual, id: 'q:imported-copy' }]);
  expect(result.workouts[0].strongmanQueue).toEqual([]);
  expect(merge(result, incoming)).toEqual(result);
  expect(current.workouts[0].strongmanQueue).toEqual([queued]);
});

it('matches only the same workout even when other workouts or detached training reuse set IDs', () => {
  const incoming = { ...local, strongmanLog: [
    { ...queued, id: 'other-day', workoutId: 'other-day' },
    { ...queued, id: 'unlinked', workoutId: null },
  ] };
  const result = merge(local, incoming);
  expect(result.workouts[0]).toBe(local.workouts[0]);
  expect(result.workouts[0].strongmanQueue).toBe(local.workouts[0].strongmanQueue);
  expect(result.strongmanLog).toEqual(incoming.strongmanLog);
});

it('preserves a first copied queue with no logged sets and leaves ordinary local overlap precedence intact', () => {
  const current = { ...local };
  delete current.strongmanLog;
  const incoming = { ...current, name: 'Old backup', workouts: [{ ...local.workouts[0], strongmanQueue: [] }] };
  const result = merge(current, incoming);
  expect(result.workouts[0]).toBe(current.workouts[0]);
  expect(result.name).toBe(current.name);
  expect(result).not.toHaveProperty('strongmanLog');
  expect(merge(current, { ...incoming, strongmanLog: [] }).workouts[0]).toBe(current.workouts[0]);
});

it('reconciles newly imported workouts against actual results already stored locally', () => {
  const actual = { ...queued, id: 'detached-setup', sets: [first] };
  const current = { ...local, workouts: [], strongmanLog: [actual] };
  const incoming = { ...local, strongmanLog: [] };
  const before = JSON.stringify({ current, incoming });
  const result = merge(current, incoming);
  expect(result.workouts[0].strongmanQueue).toEqual([{ ...queued, sets: [second] }]);
  expect(result.strongmanLog).toEqual([actual]);
  expect(JSON.stringify({ current, incoming })).toBe(before);
});
