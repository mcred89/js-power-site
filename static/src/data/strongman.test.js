import {
  addStrongmanTracking, createStrongmanLogEntry, normalizeStrongmanCompetition,
  removeStrongmanLogEntry, saveStrongmanLogEntry, strongmanResults,
  strongmanSetupKey, summarizeStrongmanResults, STRONGMAN_RECORD_GOALS,
  getStrongmanRecordGoal, strongmanRecordSetup, strongmanRecordSetupKey, strongmanPrimaryRecord,
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

  it('accepts rep goals for events and implements while preserving existing time goals', () => {
    const competition = normalizeStrongmanCompetition({ events: [
      { name: 'Log press', timeGoal: 'reps', weight: 200, seconds: 60 },
      { name: 'Carry medley', type: 'medley', timeGoal: 'fastest',
        components: [{ name: 'Sandbag load', timeGoal: 'reps', weight: 200 }] },
      { name: 'Hercules hold', timeGoal: 'longest' },
      { name: 'Yoke' },
    ] });
    expect(competition.events.map(item => item.timeGoal)).toEqual(['reps', 'fastest', 'longest', 'fastest']);
    expect(competition.events[1].components[0].timeGoal).toBe('reps');
    expect(() => normalizeStrongmanCompetition({ events: [{ name: 'Log press', timeGoal: 'unknown' }] }))
      .toThrow('Choose a valid record goal.');
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
    expect(saved.sets[0]).toEqual({ id: 'run', weight: '', distance: '', reps: '', height: '', points: '', seconds: 42,
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

  it('finds the most successful reps at the selected load, distance and time window across plans', () => {
    const results = strongmanResults([
      { id: 'old', profileId: 'p1', strongmanLog: [log({ movement: 'Log press', sets: [
        { weight: 200, reps: 8, seconds: 60 },
      ] })] },
      { id: 'current', profileId: 'p1', strongmanLog: [log({ movement: 'Log press', date: '2026-02-01', sets: [
        { weight: 200, reps: 6, seconds: 60 },
        { weight: 180, reps: 12, seconds: 60 },
        { weight: 200, reps: 15, seconds: 90 },
        { weight: 200, reps: 13, seconds: 60, distance: 50 },
        { weight: 200, reps: 20, seconds: 60, successful: false },
        { weight: 220, reps: 3, seconds: 60 },
        { weight: 200, reps: 0, seconds: 60 },
      ] })] },
      { id: 'other-profile', profileId: 'p2', strongmanLog: [log({ movement: 'Log press', sets: [
        { weight: 200, reps: 30, seconds: 60 },
      ] })] },
    ]);
    const options = { profileId: 'p1', movement: 'Log press',
      eventSnapshot: { weight: '200', seconds: '60', reps: 10, timeGoal: 'reps' } };
    const summary = summarizeStrongmanResults(results, options);
    expect(summary.mostReps).toMatchObject({ routineId: 'old', weight: 200, reps: 8, seconds: 60 });
    expect(summary.best).toMatchObject({ weight: 220, reps: 3 });
    expect(summarizeStrongmanResults(results, { ...options, routineId: 'current' }).mostReps.reps).toBe(6);
    expect(summarizeStrongmanResults(results, { ...options, eventSnapshot: null }).mostReps).toBeNull();
    expect(summarizeStrongmanResults(results, { ...options, eventSnapshot: { weight: '', seconds: 60 } }).mostReps).toBeNull();
  });

  it('keeps untimed reps separate from timed windows, excludes failed attempts and chooses the most recent tie', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      log({ id: 'older', date: '2026-01-01', sets: [{ weight: 200, reps: 8 }] }),
      log({ id: 'newer', date: '2026-02-01', sets: [{ weight: 200, reps: 8 }, { weight: 200, reps: 8 }] }),
      log({ date: '2026-03-01', sets: [{ weight: 200, reps: 20, seconds: 60 }] }),
      log({ date: '2026-04-01', sets: [{ weight: 200, reps: 25, successful: false }] }),
      log({ date: '2026-04-01', sets: [{ weight: 200, reps: 0 }] }),
    ] }]);
    const summary = summarizeStrongmanResults(results, { eventSnapshot: { weight: 200, reps: 4 } });
    expect(summary.mostReps).toMatchObject({ entryId: 'newer', reps: 8, setIndex: 1, seconds: '' });
    expect(summary.latest).toMatchObject({ date: '2026-04-01' });
    expect(summarizeStrongmanResults(results, { eventSnapshot: { weight: 200, seconds: 90 } }).mostReps).toBeNull();
    expect(summarizeStrongmanResults(results, { eventSnapshot: { weight: 200, distance: 0 } }).mostReps).toBeNull();
  });

  it('matches blank loads only to blank actual loads and never ranks full medleys by reps', () => {
    const results = [
      { movement: 'Bodyweight lift', reps: 10, weight: '', seconds: '', distance: '' },
      { movement: 'Bodyweight lift', reps: 30, weight: 100, seconds: '', distance: '' },
      { movement: 'Bodyweight lift', reps: 50, weight: '', seconds: '', distance: '', scope: 'medley' },
    ];
    expect(summarizeStrongmanResults(results, { eventSnapshot: { timeGoal: 'reps' } }).mostReps.reps).toBe(10);
    expect(summarizeStrongmanResults(results, { eventSnapshot: { type: 'medley', timeGoal: 'reps' } }).mostReps).toBeNull();
  });

  it('does not treat rep windows as elapsed times while retaining legacy times and full medley runs', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      log({ id: 'elapsed', sets: [{ weight: 200, reps: 6, seconds: 40 }] }),
      log({ id: 'rep-short', eventSnapshot: { name: 'Log press', timeGoal: 'reps' },
        sets: [{ weight: 200, reps: 6, seconds: 30 }] }),
      log({ id: 'rep-long', eventSnapshot: { name: 'Log press', timeGoal: 'reps' },
        sets: [{ weight: 200, reps: 6, seconds: 60 }] }),
      log({ id: 'medley', scope: 'medley', eventSnapshot: { ...event, timeGoal: 'reps' },
        sets: [{ seconds: 50 }] }),
    ] }]);
    const summary = summarizeStrongmanResults(results, { scope: 'movement', eventSnapshot: { weight: 200, reps: 6 } });
    expect(summary.fastest).toMatchObject({ entryId: 'elapsed', seconds: 40 });
    expect(summary.longest).toMatchObject({ entryId: 'elapsed', seconds: 40 });
    const medley = summarizeStrongmanResults(results, { scope: 'medley', eventSnapshot: event });
    expect(medley.fastest).toMatchObject({ entryId: 'medley', seconds: 50 });
    expect(medley.longest).toMatchObject({ entryId: 'medley', seconds: 50 });
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

  it('accepts all scoring goals, fractional height and custom points while retaining unknown fields', () => {
    const competition = normalizeStrongmanCompetition({ events: STRONGMAN_RECORD_GOALS.map(goal => ({
      name: `Event ${goal.value}`, timeGoal: goal.value, height: '204.5', points: '12.5', scoringRules: '  Two points per heavy rep  ',
      extension: { preserved: true },
    })) });
    expect(competition.events.map(item => item.timeGoal)).toEqual(STRONGMAN_RECORD_GOALS.map(goal => goal.value));
    expect(competition.events[0]).toMatchObject({ height: 204.5, points: 12.5,
      scoringRules: 'Two points per heavy rep', extension: { preserved: true } });
    expect(() => normalizeStrongmanCompetition({ events: [{ name: 'Toss', height: -1 }] })).toThrow('height');
    expect(() => normalizeStrongmanCompetition({ events: [{ name: 'Score', points: 'bad' }] })).toThrow('points');
    expect(() => normalizeStrongmanCompetition({ events: [{ name: 'Score', scoringRules: {} }] })).toThrow('rules as text');
    expect(getStrongmanRecordGoal({ type: 'medley', timeGoal: 'points' }).value).toBe('fastest');
  });

  it('allows pending point-event details but requires scoring rules when recording actual training', () => {
    expect(normalizeStrongmanCompetition({ events: [{ name: 'Loading', timeGoal: 'points' }] }).events[0].scoringRules).toBe('');
    expect(() => log({ eventSnapshot: { name: 'Loading', timeGoal: 'points' }, sets: [{ points: 12 }] }))
      .toThrow('Describe the scoring rules');
    const saved = log({ eventSnapshot: { name: 'Loading', timeGoal: 'points', scoringRules: '1 point per load' },
      sets: [{ points: '12.5', extension: true }] });
    expect(saved.sets[0]).toMatchObject({ points: 12.5, extension: true });
    expect(() => log({ sets: [{ height: Infinity }] })).toThrow('height');
    expect(() => log({ sets: [{ points: -1 }] })).toThrow('points');
  });

  it('ranks max weight at matching tasks and exact requested reps without treating elapsed time as a condition', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [log({ sets: [
      { weight: 500, reps: 1, seconds: 15 },
      { weight: 450, reps: 5 },
      { weight: 510, reps: 1, height: 18 },
      { weight: 520, reps: 1, distance: 10 },
      { weight: 600, reps: 1, successful: false },
      { weight: 700, reps: 0 },
    ] })] }]);
    const snapshot = { timeGoal: 'weight', weight: 600, reps: 5, seconds: 60 };
    expect(summarizeStrongmanResults(results, { eventSnapshot: snapshot }).heaviest.weight).toBe(450);
    const unrestricted = summarizeStrongmanResults(results, { eventSnapshot: { timeGoal: 'weight' } });
    expect(unrestricted.heaviest).toMatchObject({ weight: 500, seconds: 15 });
    expect(strongmanPrimaryRecord(unrestricted, 'weight')).toBe(unrestricted.heaviest);
    const weightOnly = strongmanResults([{ id: 'r1', strongmanLog: [log({ sets: [{ weight: 550 }] })] }]);
    expect(summarizeStrongmanResults(weightOnly, { eventSnapshot: { timeGoal: 'weight' } }).heaviest.weight).toBe(550);
    expect(summarizeStrongmanResults(weightOnly, { eventSnapshot: snapshot }).heaviest).toBeNull();
  });

  it('ranks distance only at the same load, task, height and actual time window', () => {
    const snapshot = { name: 'Husafell', timeGoal: 'distance', weight: 250, seconds: 60 };
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      log({ eventSnapshot: snapshot, sets: [
        { weight: 250, distance: 100, seconds: 60 }, { weight: 250, distance: 125, seconds: 60 },
        { weight: 200, distance: 200, seconds: 60 }, { weight: 250, distance: 250, seconds: 90 },
        { weight: 250, distance: 300, seconds: 60, reps: 2 }, { weight: 250, distance: 350, seconds: 60, height: 48 },
        { weight: 250, distance: 400, seconds: 60, successful: false }, { weight: 250, distance: 0, seconds: 60 },
      ] }),
      log({ eventSnapshot: { ...snapshot, timeGoal: 'fastest' }, sets: [{ weight: 250, distance: 500, seconds: 60 }] }),
    ] }]);
    const summary = summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, distance: 999 } });
    expect(summary.farthest).toMatchObject({ distance: 125, weight: 250, seconds: 60 });
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, weight: '' } }).farthest).toBeNull();
    expect(summarizeStrongmanResults(results, { eventSnapshot: null }).farthest).toBeNull();
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, type: 'medley' } }).farthest).toBeNull();
  });

  it('ranks cleared height separately from distance with matching implement weight and rules', () => {
    const snapshot = { name: 'Bag toss', timeGoal: 'height', weight: 35, scoringRules: 'Two hands' };
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      log({ eventSnapshot: snapshot, sets: [{ weight: 35, height: 180 }, { weight: 35, height: 192 },
        { weight: 30, height: 216 }, { weight: 35, height: 204, distance: 10 },
        { weight: 35, height: 230, successful: false }, { weight: 35, height: 0 }] }),
      log({ eventSnapshot: { ...snapshot, scoringRules: 'One hand' }, sets: [{ weight: 35, height: 240 }] }),
      log({ eventSnapshot: { ...snapshot, scoringRules: '  TWO   hands ' }, sets: [{ weight: 35, height: 200 }] }),
    ] }]);
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, height: 300 } }).highest.height).toBe(200);
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, seconds: 60 } }).highest).toBeNull();
  });

  it('compares manual points only under the same recorded fixed setup, rules and actual window', () => {
    const snapshot = { name: 'Weighted loading', timeGoal: 'points', weight: 100, height: 48,
      seconds: 60, scoringRules: 'Light = 1; heavy = 2' };
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      log({ eventSnapshot: snapshot, sets: [{ points: 10, weight: 200, reps: 5, seconds: 60 },
        { points: 12.5, weight: 100, reps: 8, seconds: 60 }, { points: 30, seconds: 90 },
        { points: 40, seconds: 60, successful: false }, { points: 0, seconds: 60 }] }),
      log({ eventSnapshot: { ...snapshot, weight: 80 }, sets: [{ points: 50, seconds: 60 }] }),
      log({ eventSnapshot: { ...snapshot, scoringRules: 'Light = 1; heavy = 3' }, sets: [{ points: 60, seconds: 60 }] }),
    ] }]);
    const summary = summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, points: 999 } });
    expect(summary.mostPoints).toMatchObject({ points: 12.5, weight: 100, reps: 8 });
    expect(summary.fastest).toBeNull();
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...snapshot, scoringRules: '' } }).mostPoints).toBeNull();
    const legacy = { ...results[0], points: 99, eventSnapshot: { timeGoal: 'points' } };
    expect(summarizeStrongmanResults([legacy], { eventSnapshot: { timeGoal: 'points' } }).mostPoints).toBeNull();
  });

  it('keeps scored attempts out of elapsed-time PRs and matches height and rules for existing goals', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [
      ...['weight', 'distance', 'height', 'points', 'reps'].map(timeGoal => log({
        eventSnapshot: { name: 'Lift', timeGoal, scoringRules: 'Same rules' },
        sets: [{ weight: 200, reps: 5, distance: 50, height: 48, points: 5, seconds: 5 }],
      })),
      log({ eventSnapshot: { name: 'Lift', scoringRules: 'Same rules' },
        sets: [{ weight: 200, reps: 5, distance: 50, height: 48, seconds: 20 }] }),
    ] }]);
    const setup = { weight: 200, reps: 5, distance: 50, height: 48, scoringRules: 'Same rules' };
    expect(summarizeStrongmanResults(results, { eventSnapshot: setup }).fastest.seconds).toBe(20);
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...setup, height: '' } }).fastest).toBeNull();
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...setup, scoringRules: '' } }).fastest).toBeNull();
    expect(summarizeStrongmanResults(results, { eventSnapshot: { ...setup, timeGoal: 'reps', seconds: 5 } }).mostReps.reps).toBe(5);
  });

  it('builds stable record setups without score targets and distinguishes windows, height and custom rules', () => {
    const first = { weight: 200, reps: 8, height: 48, seconds: 60,
      eventSnapshot: { timeGoal: 'reps', scoringRules: 'Same rules' } };
    const setup = strongmanRecordSetup(first);
    expect(setup).toMatchObject({ timeGoal: 'reps', weight: 200, reps: '', height: 48, seconds: 60 });
    expect(strongmanRecordSetupKey(setup)).toBe(strongmanRecordSetupKey(strongmanRecordSetup({ ...first, reps: 12 })));
    expect(strongmanRecordSetupKey(setup)).not.toBe(strongmanRecordSetupKey({ ...setup, seconds: 90 }));
    expect(strongmanRecordSetupKey(setup)).not.toBe(strongmanRecordSetupKey({ ...setup, height: 42 }));
    expect(strongmanRecordSetupKey(setup)).not.toBe(strongmanRecordSetupKey({ ...setup, scoringRules: 'Other rules' }));
    const points = strongmanRecordSetup({ ...first, points: 30, eventSnapshot: {
      timeGoal: 'points', weight: 100, reps: '', height: 48, scoringRules: 'Light 1, heavy 2',
    } });
    expect(points).toMatchObject({ weight: 100, reps: '', height: 48, seconds: 60 });
    expect(strongmanRecordSetup({ ...first, scope: 'medley', eventSnapshot: event })).toBe(event);
    expect(strongmanSetupKey({ ...event, components: event.components.map(component => ({ ...component, height: 48 })) }))
      .not.toBe(strongmanSetupKey(event));
  });

  it('allows floor-height context and zero custom scores without hiding completed strength work', () => {
    const results = strongmanResults([{ id: 'r1', strongmanLog: [log({
      eventSnapshot: { name: 'Deadlift', timeGoal: 'weight' },
      sets: [{ weight: 500, reps: 1, height: 0, points: 0 }],
    })] }]);
    const summary = summarizeStrongmanResults(results, { eventSnapshot: { timeGoal: 'weight', reps: 1, height: 0 } });
    expect(summary.best.weight).toBe(500);
    expect(summary.heaviest.weight).toBe(500);
    expect(summary.highest).toBeNull();
    expect(summary.mostPoints).toBeNull();
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
