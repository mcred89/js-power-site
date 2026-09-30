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

it('normalizes reference targets and publishes only after a guarded save', async () => {
  const before = JSON.stringify(routine);
  await commitStrongmanChange(routine, 'p1', 'competition', { name: 'Next meet', events: [
    { name: 'Yoke', weight: '600', distance: '100' },
  ] }, saveRoutine);
  const updated = saveRoutine.mock.calls[0][0];
  expect(updated.inputs).toMatchObject({ unknown: true, strongmanCompetition: {
    events: [{ name: 'Yoke', weight: 600, distance: 100 }],
  } });
  expect(updated.workouts).toBe(routine.workouts);
  expect(updated.strongmanLog).toBe(routine.strongmanLog);
  expect(saveRoutine.mock.calls[0][2]).toBe(true);
  expect(applyBatch).toHaveBeenCalledWith({ puts: { routines: [updated] },
    conditions: { routines: [{ key: routine.id, expected: routine }] } });
  expect(JSON.stringify(routine)).toBe(before);
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
