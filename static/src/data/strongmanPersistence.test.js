import { commitStrongmanChange } from './strongmanPersistence';
import { createStrongmanLogEntry } from './strongman';
import { applyBatch } from './storage';

jest.mock('./storage', () => ({ applyBatch: jest.fn() }));

const routine = { id: 'r1', profileId: 'p1', inputs: { unknown: true }, strongmanLog: [],
  workouts: [{ id: 'w1', name: 'Strongman', completedAt: null, session: null, exercises: [] }] };
const saveRoutine = jest.fn((updated, persist) => persist(updated));

beforeEach(() => {
  jest.clearAllMocks();
  saveRoutine.mockImplementation((updated, persist) => persist(updated));
  applyBatch.mockResolvedValue(undefined);
});

it('does not write profile competitions through a plan-only action', async () => {
  await expect(commitStrongmanChange(routine, 'p1', 'competition', { events: [] }, saveRoutine))
    .rejects.toThrow('supported Strongman change');
  expect(saveRoutine).not.toHaveBeenCalled();
});
it('validates and persists dated results without changing the workout', async () => {
  const entries = [createStrongmanLogEntry({ movement: 'Yoke', date: '2026-01-01',
    sets: [{ weight: 580, distance: 50 }] })];
  await commitStrongmanChange(routine, 'p1', 'log', entries, saveRoutine);
  expect(saveRoutine.mock.calls[0][0]).toMatchObject({ strongmanLog: entries, workouts: routine.workouts });
  await expect(commitStrongmanChange(routine, 'p1', 'log', [{ id: 'invalid' }], saveRoutine)).rejects.toThrow('invalid strongman data');
  expect(saveRoutine).toHaveBeenCalledTimes(1);
});

it('completes and reopens the selected day while retaining results', async () => {
  const entries = [createStrongmanLogEntry({ movement: 'Yoke', date: '2026-01-01', sets: [{ weight: 580, reps: 1 }] })];
  const current = { ...routine, strongmanLog: entries };
  await expect(commitStrongmanChange(current, 'p1', 'completion', { workoutId: 'w1', complete: true }, saveRoutine))
    .resolves.toBe('Strongman day complete. Your results are saved.');
  const completed = saveRoutine.mock.calls[0][0];
  expect(completed.workouts[0].completedAt).toBeTruthy();
  expect(completed.strongmanLog).toBe(entries);
  await expect(commitStrongmanChange(completed, 'p1', 'completion', { workoutId: 'w1', complete: false }, saveRoutine))
    .resolves.toBe('Workout returned to your queue.');
  expect(saveRoutine.mock.calls[1][0].workouts[0].completedAt).toBeNull();
});

it('rejects another profile, removed workouts, and concurrent-window conflicts', async () => {
  await expect(commitStrongmanChange(routine, 'other', 'log', [], saveRoutine)).rejects.toThrow('no longer available');
  await expect(commitStrongmanChange(routine, 'p1', 'completion', { workoutId: 'removed', complete: true }, saveRoutine))
    .rejects.toThrow('no longer available');
  expect(saveRoutine).not.toHaveBeenCalled();
  applyBatch.mockRejectedValueOnce(Object.assign(new Error('changed'), { name: 'BatchConflictError' }));
  await expect(commitStrongmanChange(routine, 'p1', 'log', [], saveRoutine)).rejects.toThrow('changed in another window');
});

it('atomically saves actual sets and the remaining prefills while retaining history and other workouts', async () => {
  const entry = createStrongmanLogEntry({ id: 'entry', movement: 'Yoke', workoutId: 'w1', date: '2026-01-01',
    sets: [{ id: 'first', weight: 580, distance: 50 }, { id: 'second', weight: 590, distance: 50 }] });
  const history = { ...entry, id: 'history', workoutId: null };
  const otherWorkout = { id: 'other', strongmanQueue: [] };
  const current = { ...routine, strongmanLog: [history], workouts: [{ ...routine.workouts[0], strongmanQueue: [entry] }, otherWorkout] };
  const actual = { ...entry, sets: [entry.sets[0]] };
  const pending = { ...entry, sets: [entry.sets[1]] };
  await commitStrongmanChange(current, 'p1', 'training', { workoutId: 'w1', entries: [history, actual], queue: [pending] }, saveRoutine);
  const updated = saveRoutine.mock.calls[0][0];
  expect(updated.strongmanLog).toEqual([history, actual]);
  expect(updated.workouts[0].strongmanQueue).toEqual([pending]);
  expect(updated.workouts[1]).toBe(otherWorkout);
  expect(current.workouts[0].strongmanQueue).toEqual([entry]);
  expect(applyBatch).toHaveBeenCalledWith({ puts: { routines: [updated] }, conditions: { routines: [{ key: current.id, expected: current }] } });
});

it('rejects completed or removed targets, malformed queues, and finishing pending work', async () => {
  const entry = createStrongmanLogEntry({ movement: 'Yoke', workoutId: 'w1', date: '2026-01-01', sets: [{ weight: 580 }] });
  const current = { ...routine, workouts: [{ ...routine.workouts[0], strongmanQueue: [entry] }] };
  await expect(commitStrongmanChange(current, 'p1', 'completion', { workoutId: 'w1', complete: true }, saveRoutine)).rejects.toThrow('remaining copied sets');
  const value = { workoutId: 'w1', entries: [], queue: [] };
  await expect(commitStrongmanChange({ ...current, workouts: [{ ...current.workouts[0], completedAt: '2026-01-01' }] }, 'p1', 'training', value, saveRoutine)).rejects.toThrow('no longer available');
  await expect(commitStrongmanChange(current, 'p1', 'training', { ...value, workoutId: 'missing' }, saveRoutine)).rejects.toThrow('no longer available');
  await expect(commitStrongmanChange(current, 'p1', 'training', { ...value, queue: null }, saveRoutine)).rejects.toThrow('must be lists');
  await expect(commitStrongmanChange(current, 'p1', 'training', { ...value, queue: [{ ...entry, workoutId: 'other' }] }, saveRoutine)).rejects.toThrow('belong to its workout');
  expect(saveRoutine).not.toHaveBeenCalled();
});

it('retains pending work after a write conflict and allows explicit clearing before finishing', async () => {
  const entry = createStrongmanLogEntry({ movement: 'Yoke', workoutId: 'w1', date: '2026-01-01', sets: [{ weight: 580 }] });
  const current = { ...routine, workouts: [{ ...routine.workouts[0], strongmanQueue: [entry] }] };
  applyBatch.mockRejectedValueOnce(Object.assign(new Error('conflict'), { name: 'BatchConflictError' }));
  await expect(commitStrongmanChange(current, 'p1', 'training', { workoutId: 'w1', entries: [], queue: [] }, saveRoutine)).rejects.toThrow('another window');
  expect(current.workouts[0].strongmanQueue).toEqual([entry]);
  await commitStrongmanChange(current, 'p1', 'training', { workoutId: 'w1', entries: [], queue: [] }, saveRoutine);
  const cleared = saveRoutine.mock.calls[1][0];
  await expect(commitStrongmanChange(cleared, 'p1', 'completion', { workoutId: 'w1', complete: true }, saveRoutine)).resolves.toContain('complete');
});
