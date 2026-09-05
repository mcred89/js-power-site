import { acceptPracticeRecipe, adaptStrongmanRoutine, capabilityProgress, createStrongmanRoutine, defaultStrongmanInputs, strongmanCoverage, updateStrongmanInputs, validateStrongmanInputs } from './strongman';
import { eventCoverageEvidence } from './strongmanIntegration';
import { snapshotPracticeCapabilities } from './strongmanEvidence';

const recipe = { weight: 100, sets: 1, reps: 1 };
const practice = (id, extra = {}) => ({ id, name: id, available: true, capacity: 1, recipe, ...extra });
const event = (id, extra = {}) => ({ id, name: id, family: 'carry', priority: 'maintenance', frequency: 2, practices: [practice(`${id}-practice`)], capabilities: [], coverage: [], ...extra });
const make = events => createStrongmanRoutine('p', 'Review', { ...defaultStrongmanInputs(), events });
const snapshot = (eventId, practiceId, capabilityIds) => ({ eventId, practiceId, capabilityIds, focus: '', parts: [] });

test.each([5, 7])('respects a two-week maximum gap with %i feasible mixed-priority events', count => {
  const plan = make(Array.from({ length: count }, (_, index) => event(`e${index}`, {
    priority: index === 0 ? 'main' : 'maintenance', frequency: index === 0 ? 1 : 2,
    ...(index === 0 ? { maxGap: 2 } : {}),
  })));
  const weeks = plan.workouts.filter(day => day.exercises.some(block => block.eventId === 'e0')).map(day => day.eventWeek);
  expect(weeks.every((week, index) => index === 0 || week - weeks[index - 1] <= 2)).toBe(true);
  expect(plan.workouts.every(day => day.exercises.reduce((sum, block) => sum + block.capacity, 0) <= 4)).toBe(true);
  expect(adaptStrongmanRoutine(plan).workouts).toEqual(plan.workouts);
});

test('counts an event only once per event week, even when several component blocks were performed', () => {
  const plan = make([event('bag', { priority: 'main', frequency: 3 }), event('axle'), event('load')]);
  plan.workouts[0].completedAt = '2026-01-01';
  plan.workouts[0].session = { eventBlocks: [{ id: 'first', eventId: 'bag', practiceId: 'bag-practice', attempts: [{ outcome: 'successful', weight: 100, reps: 1 }] }] };
  const once = adaptStrongmanRoutine(plan);
  plan.workouts[0].session.eventBlocks.push({ ...plan.workouts[0].session.eventBlocks[0], id: 'extra' });
  const twice = adaptStrongmanRoutine(plan);
  expect(twice.workouts.slice(1)).toEqual(once.workouts.slice(1));
});

test('does not double count exact normal-day coverage in an event week already completed on event day', () => {
  const plan = make([event('bag', { priority: 'main', frequency: 3 }), event('axle'), event('load')]);
  plan.workouts[0].completedAt = '2026-01-01';
  plan.workouts[0].session = { eventBlocks: [{ id: 'first', eventId: 'bag', practiceId: 'bag-practice', attempts: [{ outcome: 'successful', weight: 100, reps: 1 }] }] };
  const once = adaptStrongmanRoutine(plan);
  const overlap = adaptStrongmanRoutine(plan, [{ eventId: 'bag', eventWeek: 1, scope: 'exact', wholeEvent: true, completedAt: '2026-01-01', planned: false }]);
  expect(overlap.workouts.slice(1)).toEqual(once.workouts.slice(1));
});

test('requires valid practice prerequisite references rather than generating empty future weeks', () => {
  const inputs = { ...defaultStrongmanInputs(), events: [event('bag', { practices: [practice('carry', { prerequisites: ['removed-pick'] })] })] };
  expect(validateStrongmanInputs(inputs).join(' ')).toMatch(/carry.*prerequisite.*removed-pick/i);
  expect(() => createStrongmanRoutine('p', 'Review', inputs)).toThrow(/prerequisite/i);
  expect(validateStrongmanInputs({ ...inputs, events: [event('bag', { practices: [practice('carry', { prerequisites: 'pick' })] })] }).join(' ')).toMatch(/prerequisite.*list/i);
});

test('retains the capabilities actually practiced when the future practice mapping changes', () => {
  const plan = make([event('axle', { capabilities: [
    { id: 'clean', name: 'Clean', status: 'working', criterion: { weight: 100, reps: 1 } },
    { id: 'press', name: 'Press', status: 'working', criterion: { weight: 100, reps: 1 } },
  ], practices: [practice('axle-practice', { capabilityIds: ['clean'] })] })]);
  plan.workouts[0].completedAt = '2026-01-01';
  plan.workouts[0].session = { eventBlocks: [{ eventId: 'axle', practiceId: 'axle-practice', capabilitySnapshot: snapshot('axle', 'axle-practice', ['clean']), attempts: [{ outcome: 'successful', weight: 100, reps: 1 }] }] };
  const edited = updateStrongmanInputs(plan, { ...plan.inputs, events: [{ ...plan.inputs.events[0], practices: [practice('axle-practice', { capabilityIds: ['press'] })] }] });
  expect(edited.workouts[0]).toEqual(plan.workouts[0]);
  expect(capabilityProgress(edited).map(item => item.matched)).toEqual([true, false]);
  const legacy = JSON.parse(JSON.stringify(plan));
  legacy.workouts[0].session.eventBlocks[0].capabilitySnapshot = null;
  expect(capabilityProgress(legacy).every(item => !item.matched)).toBe(true);
});

test('uses matching completed normal-day actual sets as checkpoint evidence, never the planned numbers', () => {
  const sourcePrescription = { movement: 'Axle clean', weight: 100, prescription: '1 × 1' };
  const link = { routineId: 'normal', exerciseId: 'normal-clean', eventWeek: 1, scope: 'exact', capabilityIds: ['clean'], wholeEvent: true, sourcePrescription, sourceConditions: { setup: 'floor' }, capabilitySnapshot: snapshot('axle', 'normal-clean', ['clean']) };
  const plan = make([event('axle', { capabilities: [{ id: 'clean', name: 'Clean', status: 'working', criterion: { weight: 100, reps: 1, setup: 'floor' } }], practices: [practice('clean', { capabilityIds: ['clean'] })], coverage: [link] })]);
  const normal = { id: 'normal', profileId: 'p', name: 'Strength', workouts: [{ id: 'normal-day', completedAt: '2026-01-01', exercises: [{ id: 'normal-clean', generated: sourcePrescription, overrides: {} }], session: { exercises: [{ exerciseId: 'normal-clean', movement: 'Axle clean', sets: [{ id: 'set1', status: 'completed', actualWeight: 100, actualReps: 1 }] }] } }] };
  const before = JSON.stringify(normal);
  const projected = adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal]));
  expect(capabilityProgress(projected)[0]).toMatchObject({ matched: true, evidence: [expect.objectContaining({ workoutId: 'normal-day', weight: 100, reps: 1 })] });
  normal.workouts[0].session.exercises[0].sets[0].actualWeight = 90;
  expect(capabilityProgress(adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal])))[0].matched).toBe(false);
  normal.workouts[0].session.exercises[0].sets[0].actualWeight = 100;
  expect(JSON.stringify(normal)).toBe(before);
  plan.inputs.events[0].coverage[0].scope = 'support';
  expect(capabilityProgress(adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal])))[0].matched).toBe(false);
});

test('keeps capacity, deadlines, and stable drafts across bounded mixed-priority inputs', () => {
  for (let count = 2; count <= 7; count += 1) {
    for (const maxGap of [1, 2, 3]) {
      for (const capacity of [1, 2]) {
        // Skip combinations exceeding the four-day capacity even before variation.
        if (Math.ceil(4 / maxGap) * capacity + (count - 1) * 2 > 16) continue;
        const events = Array.from({ length: count }, (_, index) => event(`e${index}`, {
          priority: index % 2 ? 'occasional' : 'main', frequency: index === 0 ? 1 : 2,
          ...(index === 0 ? { maxGap, practices: [practice('priority', { capacity })] } : {}),
        }));
        const plan = make(events);
        const weeks = plan.workouts.filter(day => day.exercises.some(block => block.eventId === 'e0')).map(day => day.eventWeek);
        expect(weeks.every((week, index) => index === 0 || week - weeks[index - 1] <= maxGap)).toBe(true);
        expect(plan.workouts.every(day => day.exercises.reduce((sum, block) => sum + block.capacity, 0) <= 4)).toBe(true);
        expect(adaptStrongmanRoutine(plan).workouts).toEqual(plan.workouts);
      }
    }
  }
});

test('balances multiple simultaneous maximum-gap requirements within feasible capacity', () => {
  for (let count = 2; count <= 8; count += 1) {
    const events = Array.from({ length: count }, (_, index) => event(`e${index}`, {
      priority: index % 2 ? 'maintenance' : 'main', frequency: 1, maxGap: 2,
    }));
    const plan = make(events);
    for (const item of events) {
      const weeks = plan.workouts.filter(day => day.exercises.some(block => block.eventId === item.id)).map(day => day.eventWeek);
      expect(weeks.length).toBeGreaterThan(0);
      expect({ count, eventId: item.id, weeks, valid: weeks.every((week, index) => index === 0 || week - weeks[index - 1] <= item.maxGap) }).toMatchObject({ count, eventId: item.id, weeks, valid: true });
    }
    expect(plan.workouts.every(day => day.exercises.reduce((sum, block) => sum + block.capacity, 0) <= 4)).toBe(true);
  }
});

test('reports a deadline blocked by locked sessions even if its four-day frequency is satisfied', () => {
  const plan = make([event('bag', { frequency: 1, maxGap: 2 })]);
  plan.workouts[1] = { ...plan.workouts[1], locked: true, exercises: [] };
  plan.workouts[2] = { ...plan.workouts[2], locked: true, exercises: [] };
  const updated = adaptStrongmanRoutine(plan);
  const summary = strongmanCoverage(updated);
  expect(summary.events[0].deficit).toBe(0);
  expect(summary.warnings.join(' ')).toMatch(/bag.*maximum gap.*week 3/i);
  expect(updated.workouts[1]).toEqual(plan.workouts[1]);
  expect(updated.workouts[2]).toEqual(plan.workouts[2]);
});

test('freezes named focus and referenced medley-part associations before future edits', () => {
  const value = event('bag', {
    capabilities: [{ id: 'pick', name: 'Pick', status: 'working', criterion: { weight: 100, reps: 1 } }],
    practices: [practice('pick-practice', { focus: 'Pick' }), practice('pair', { recipe: { parts: [{ id: 'pick-part', name: 'Pick', practiceId: 'pick-practice', sets: 1, weight: 100, reps: 1 }] } })],
  });
  const frozen = snapshotPracticeCapabilities(value, value.practices[1]);
  expect(frozen.parts[0]).toEqual({ id: 'pick-part', capabilityIds: ['pick'], focus: 'Pick' });
  value.practices[0].focus = 'Carry';
  expect(frozen.parts[0].capabilityIds).toEqual(['pick']);
  const plan = make([value]);
  plan.workouts[0].completedAt = '2026-01-01';
  plan.workouts[0].session = { eventBlocks: [{ eventId: 'bag', practiceId: 'pair', capabilitySnapshot: frozen, attempts: [{ id: 'attempt', partId: 'pick-part', outcome: 'successful', weight: 100, reps: 1 }] }] };
  expect(capabilityProgress(plan)[0].matched).toBe(true);
});

test('keeps accepted taper prescriptions independent of ordinary setup and completed snapshots', () => {
  const plan = make([event('bag', { practices: [practice('bag-practice', { setup: 'floor' })] })]);
  plan.workouts[0].completedAt = '2026-01-01';
  const updated = acceptPracticeRecipe(plan, 'bag', 'bag-practice', { sets: 1, weight: 50, reps: 1, setup: 'blocks' }, 'taper');
  expect(updated.inputs.events[0].practices[0]).toMatchObject({ recipe, setup: 'floor', taperRecipe: { weight: 50, setup: 'blocks' } });
  expect(updated.workouts[0]).toEqual(plan.workouts[0]);
  expect(updated.workouts[11].exercises[0].generated.event).toMatchObject({ weight: 50, setup: 'blocks' });
});

test('does not certify normal-day sets with unknown conditions, a skipped result, or a legacy link', () => {
  const sourcePrescription = { movement: 'Clean', weight: 100, prescription: '1 × 1' };
  const plan = make([event('axle', { capabilities: [{ id: 'clean', name: 'Clean', status: 'working', criterion: { weight: 100, reps: 1, setup: 'floor' } }], coverage: [{ routineId: 'normal', exerciseId: 'e', eventWeek: 1, scope: 'exact', sourcePrescription, capabilitySnapshot: snapshot('axle', 'e', ['clean']) }] })]);
  const normal = { id: 'normal', profileId: 'p', name: 'Strength', workouts: [{ id: 'normal-day', completedAt: '2026-01-01', exercises: [{ id: 'e', generated: sourcePrescription, overrides: {} }], session: { exercises: [{ exerciseId: 'e', movement: 'Clean', sets: [{ id: 's', status: 'completed', actualWeight: 100, actualReps: 1 }] }] } }] };
  expect(capabilityProgress(adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal])))[0].matched).toBe(false);
  plan.inputs.events[0].coverage[0].sourceConditions = { setup: 'floor' };
  normal.workouts[0].session.exercises[0].sets[0].status = 'skipped';
  expect(capabilityProgress(adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal])))[0].matched).toBe(false);
  normal.workouts[0].session.exercises[0].sets[0].status = 'completed';
  plan.inputs.events[0].coverage[0].capabilitySnapshot = null;
  expect(capabilityProgress(adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal])))[0].matched).toBe(false);
});
