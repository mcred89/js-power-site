import {
  addStrongmanTracking, createStrongmanLogEntry, normalizeStrongmanCompetition,
  removeStrongmanLogEntry, saveStrongmanLogEntry, strongmanResults,
  strongmanSetupKey, summarizeStrongmanResults,
} from './strongman';
import { duplicateRoutine, createRoutineTemplate } from './routineCopies';
import { createImportPlan } from './importBackup';
import { createRoutine } from './routines';
import { updateRoutinePlan } from './routineUpdates';

const event = { id: 'event', name: 'Carry medley', type: 'medley', components: [
  { id: 'one', name: 'Sandbag', weight: 200, distance: 50 },
  { id: 'two', name: 'Frame', weight: 500, distance: 50 },
  { id: 'three', name: 'Yoke', weight: 600, distance: 50 },
] };
const inputs = { maxSquat: '300', maxPress: '200', maxDead: '400', duration: '5 weeks',
  mainLiftChoice: 'Low', includeStrongmanDay: true, strongmanCompetition: { name: 'Fall show', date: '', events: [event] } };
const log = (overrides = {}) => createStrongmanLogEntry({ movement: 'Zercher yoke', date: '2026-01-03',
  sets: [{ weight: 580, distance: 50 }], ...overrides });

describe('strongman tracking data', () => {
  it('keeps unknown competition details blank and accepts an unannounced medley', () => {
    const competition = normalizeStrongmanCompetition({ name: 'Next meet', date: '', events: [
      { name: 'Carry medley', type: 'medley', components: [{ name: '' }, { name: '' }, { name: '' }] },
    ] });
    expect(competition.events[0].weight).toBe('');
    expect(competition.events[0].components[0]).toMatchObject({ name: '', weight: '', distance: '', reps: '', seconds: '' });
    expect(new Set(competition.events[0].components.map(item => item.id)).size).toBe(3);
  });

  it.each([-1, 'Infinity', 'nope', true])('rejects invalid actual weight %p', weight => {
    expect(() => log({ sets: [{ weight }] })).toThrow();
  });

  it('rejects empty results, invalid or future dates and fractional reps', () => {
    expect(() => log({ sets: [{}] })).toThrow('Enter weight');
    expect(() => log({ date: '2026-02-30' })).toThrow('training date');
    expect(() => log({ date: '2099-01-01' })).toThrow('training date');
    expect(() => log({ sets: [{ reps: 1.5 }] })).toThrow('whole-number');
  });

  it('adds and edits dated entries without changing a workout snapshot', () => {
    const routine = createRoutine('p1', 'Current cycle', inputs);
    const original = JSON.stringify(routine);
    const added = saveStrongmanLogEntry(routine, { ...log(), workoutId: routine.workouts[0].id });
    const edited = saveStrongmanLogEntry(added, { ...added.strongmanLog[0], date: '2026-01-04' });
    expect(edited.strongmanLog).toHaveLength(1);
    expect(edited.strongmanLog[0].date).toBe('2026-01-04');
    expect(edited.workouts).toBe(routine.workouts);
    expect(JSON.stringify(routine)).toBe(original);
    expect(removeStrongmanLogEntry(edited, edited.strongmanLog[0].id).strongmanLog).toEqual([]);
    expect(() => saveStrongmanLogEntry(routine, { ...log(), workoutId: 'missing' })).toThrow('no longer');
  });

  it('preserves paired actual metrics and separates cycle best, lifetime best and latest failure', () => {
    const old = { id: 'old', profileId: 'p1', name: 'Last show', strongmanLog: [log({ sets: [{ weight: 600, distance: 100 }] })] };
    const current = { id: 'current', profileId: 'p1', name: 'This show', strongmanLog: [
      log({ date: '2026-02-01', movement: '  zercher YOKE ', sets: [{ weight: 580, distance: 50 }] }),
      log({ date: '2026-02-08', sets: [{ weight: 500, distance: 100 }] }),
      log({ date: '2026-02-15', sets: [{ weight: 650, distance: 0, successful: false }] }),
    ] };
    const results = strongmanResults([old, current]);
    const cycle = summarizeStrongmanResults(results, { movement: 'Zercher yoke', routineId: 'current' });
    expect(cycle.best).toMatchObject({ weight: 580, distance: 50, routineId: 'current' });
    expect(cycle.latest).toMatchObject({ weight: 650, date: '2026-02-15' });
    expect(summarizeStrongmanResults(results, { movement: 'Zercher yoke' }).best).toMatchObject({ weight: 600, distance: 100 });
  });

  it('excludes zero-rep attempts from bests even when marked successful', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [log({ sets: [{ weight: 1000, reps: 0 }] })] }]);
    expect(summarizeStrongmanResults(results).best).toBeNull();
    expect(summarizeStrongmanResults(results).latest.weight).toBe(1000);
  });

  it('never treats a replaced implement as the old movement when event IDs are retained', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [log({ movement: 'Yoke',
      eventId: 'medley', componentId: 'third', sets: [{ weight: 500, reps: 1 }] })] }]);
    expect(summarizeStrongmanResults(results, { movement: 'Log press', eventId: 'medley', componentId: 'third' }).best).toBeNull();
    expect(summarizeStrongmanResults(results, { movement: 'Yoke' }).best.weight).toBe(500);
    expect(summarizeStrongmanResults(results, { movement: 'Sandbag', eventId: 'medley', componentId: 'first' }).best).toBeNull();
  });

  it('compares medley times only for successful full runs with the same known course', () => {
    const lighter = { ...event, components: event.components.map(item => ({ ...item, weight: item.weight - 20 })) };
    const entry = (seconds, snapshot, successful = true) => log({ movement: 'Carry medley', scope: 'medley',
      eventSnapshot: snapshot, sets: [{ seconds, successful }] });
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      entry(35, event), entry(28, lighter), entry(15, event, false),
    ] }]);
    expect(summarizeStrongmanResults(results, { movement: 'Carry medley', scope: 'medley', eventSnapshot: event }).fastest.seconds).toBe(35);
    expect(summarizeStrongmanResults(results, { movement: 'Carry medley', scope: 'medley' }).fastest).toBeNull();
    const unknown = { ...event, components: [{ id: 'unknown', name: '', weight: '', distance: '' }] };
    const unknownResults = strongmanResults([{ id: 'r1', strongmanLog: [entry(10, unknown)] }]);
    expect(summarizeStrongmanResults(unknownResults, { eventSnapshot: unknown }).fastest).toBeNull();
    expect(strongmanSetupKey({ ...event, id: 'another-meet', seconds: 60 })).toBe(strongmanSetupKey(event));
  });

  it('saves full runs by their visible time and preserves the outcome and unknown fields', () => {
    const values = { movement: 'Carry medley', scope: 'medley', eventSnapshot: event,
      sets: [{ id: 'run', weight: 500, distance: 50, reps: 0, seconds: '42', successful: false,
        extension: { preserved: true } }] };
    const saved = log(values);
    expect(saved.sets[0]).toEqual({ id: 'run', weight: '', distance: '', reps: '', seconds: 42,
      successful: false, extension: { preserved: true } });
    expect(values.sets[0]).toMatchObject({ weight: 500, distance: 50, reps: 0, seconds: '42' });
    expect(() => log({ ...values, sets: [{ weight: 500, reps: 1 }] })).toThrow('time for each full medley');
  });

  it('recovers previously saved full runs with hidden metrics without rewriting their history', () => {
    const entry = log({ movement: 'Carry medley', scope: 'medley', eventSnapshot: event,
      sets: [{ id: 'run', seconds: 42 }] });
    const legacy = { ...entry, sets: [{ ...entry.sets[0], weight: 500, distance: 0, reps: 0 }] };
    const untimed = { ...legacy, id: 'untimed', sets: [{ ...legacy.sets[0], seconds: '' }] };
    const failed = { ...legacy, id: 'failed', sets: [{ ...legacy.sets[0], seconds: 20, successful: false }] };
    const routine = { id: 'plan', strongmanLog: [legacy, untimed, failed] };
    const before = JSON.stringify(routine);
    const results = strongmanResults([routine]);
    const summary = summarizeStrongmanResults(results, { scope: 'medley', eventSnapshot: event });
    expect(summary.fastest).toMatchObject({ seconds: 42, weight: '', distance: '', reps: '' });
    expect(summary.records).toHaveLength(3);
    expect(summarizeStrongmanResults(results.filter(result => result.entryId === 'untimed'), {
      scope: 'medley', eventSnapshot: event,
    })).toMatchObject({ best: null, fastest: null });
    const corrected = saveStrongmanLogEntry(routine, legacy);
    expect(corrected.strongmanLog[0].sets[0]).toMatchObject({ seconds: 42, weight: '', distance: '', reps: '', successful: true });
    expect(JSON.stringify(routine)).toBe(before);
  });

  it('requires matching weight and distance for timed carries and supports longest holds', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      log({ sets: [{ weight: 200, distance: 10, seconds: 5 }] }),
      log({ sets: [{ weight: 600, distance: 100, seconds: 30 }, { weight: 600, distance: 100, seconds: 35 }] }),
    ] }]);
    const summary = summarizeStrongmanResults(results, { eventSnapshot: { weight: 600, distance: 100 } });
    expect(summary.fastest.seconds).toBe(30);
    expect(summary.longest.seconds).toBe(35);
    expect(summarizeStrongmanResults(results, { eventSnapshot: { weight: 600 } }).fastest).toBeNull();
    expect(summarizeStrongmanResults(results).fastest).toBeNull();
  });

  it('copies targets deeply while resetting training logs and preserves logs on plan updates', () => {
    const routine = saveStrongmanLogEntry(createRoutine('p1', 'Current', inputs), log());
    const copied = duplicateRoutine(routine, 'p1', 'Next');
    expect(copied.strongmanLog).toEqual([]);
    copied.inputs.strongmanCompetition.events[0].components[0].weight = 999;
    expect(routine.inputs.strongmanCompetition.events[0].components[0].weight).toBe(200);
    const template = createRoutineTemplate(routine, 'Template');
    expect(template.strongmanLog).toBeUndefined();
    expect(template.inputs.strongmanCompetition).not.toBe(routine.inputs.strongmanCompetition);
    const updated = updateRoutinePlan(routine, { maxSquat: '350' });
    expect(updated.strongmanLog).toBe(routine.strongmanLog);
  });

  it('merges new logs and keeps conflicting imported results without duplicates on repeated import', () => {
    const localEntry = log({ id: 'same', sets: [{ id: 'set', weight: 580, distance: 50 }] });
    const importedEntry = { ...localEntry, sets: [{ id: 'set', weight: 570, distance: 50 }] };
    const local = { id: 'r1', profileId: 'p1', workouts: [], strongmanLog: [localEntry] };
    const imported = { ...local, strongmanLog: [importedEntry, log({ id: 'new' })] };
    const backup = { profiles: [], routines: [imported] };
    const merged = createImportPlan(backup, [], [local]).routines[0].result;
    expect(merged.strongmanLog).toHaveLength(3);
    expect(merged.strongmanLog[0]).toBe(localEntry);
    expect(merged.strongmanLog[1]).toEqual({ ...importedEntry, id: 'same:imported-copy' });
    expect(createImportPlan(backup, [], [merged]).routines[0].result.strongmanLog).toEqual(merged.strongmanLog);
  });

  it('adds only containers and retains unknown or already migrated records', () => {
    const routine = { inputs: {}, workouts: [{ completedAt: '2026-01-01', session: { note: 'Keep' } }], unknown: true };
    const migrated = addStrongmanTracking(routine);
    expect(migrated).toEqual({ ...routine, inputs: { strongmanCompetition: null }, strongmanLog: [] });
    expect(migrated.workouts).toBe(routine.workouts);
    expect(addStrongmanTracking(migrated)).toBe(migrated);
    const unknown = { id: 'unknown', custom: true };
    expect(addStrongmanTracking(unknown)).toBe(unknown);
    const retired = { ...routine, kind: 'strongman' };
    expect(addStrongmanTracking(retired)).toBe(retired);
  });
});
