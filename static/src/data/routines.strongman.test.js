import { adaptiveCycleMaxes } from './routines';
import { correctMaxes, createRoutine, refreshAdaptiveProgression } from './routinePlanning';
import { createRoutineFromTemplate, createRoutineTemplate, duplicateRoutine } from './routineCopies';
import { routineHistoryToCsv, routinePlanToCsv } from './routineCsv';

const readCsv = csv => {
  const lines = csv.split('\n').map(line => Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), match => match[1].replace(/""/g, '"')));
  return lines.slice(1).map(values => Object.fromEntries(lines[0].map((key, index) => [key, values[index]])));
};

const makeEventPlan = () => ({
  id: 'event-plan', profileId: 'p1', kind: 'strongman', name: 'Show prep', status: 'active',
  inputs: { weeks: 12, competitionDate: '2027-06-01', phases: [{ id: 'base', type: 'base', weeks: 12 }], events: [{
    id: 'bag', name: 'Sandbag', capabilities: [{ id: 'pick', name: 'Pick', status: 'confirmed' }],
    practices: [{ id: 'carry', name: 'Sandbag carry', capabilityIds: ['pick'], recipe: { weight: 250, distance: 40, distanceUnit: 'ft' } }],
    coverage: [{ routineId: 'normal', exerciseId: 'regular', capabilityIds: ['pick'] }],
  }] },
  workouts: [{ id: 'event-week', eventWeek: 1, sequence: 1, phase: 'base', name: 'Strongman',
    completedAt: '2026-09-01T13:00:00.000Z', hostRef: { routineId: 'normal', workoutId: 'slot' },
    exercises: [{ id: 'practice-1', eventId: 'bag', practiceId: 'carry', overrides: {}, generated: {
      movement: 'Sandbag carry', weight: 250, prescription: '2 runs',
      event: { weight: 250, weightUnit: 'lb', loadMeaning: 'total', sets: 2, distance: 40, distanceUnit: 'ft', setup: 'From floor' },
    } }],
    session: { status: 'completed', startedAt: '2026-09-01T12:00:00.000Z', elapsedSeconds: 3600, eventBlocks: [{
      id: 'practice-1', eventId: 'bag', practiceId: 'carry', movement: 'Sandbag carry', setup: 'From floor', status: 'completed',
      recipe: { weight: 250, weightUnit: 'lb', loadMeaning: 'total', sets: 2, distance: 40, distanceUnit: 'ft' },
      attempts: [
        { id: 'attempt-1', status: 'completed', outcome: 'unsuccessful', weight: 250, weightUnit: 'lb', loadMeaning: 'total', distance: 0, distanceUnit: 'ft', seconds: null, reps: null, setup: 'From floor', notes: 'Could not pick', completedAt: '2026-09-01T12:01:00.000Z' },
        { id: 'attempt-2', status: 'completed', outcome: 'successful', weight: 200, weightUnit: 'lb', loadMeaning: 'total', distance: 40, distanceUnit: 'ft', seconds: 18.5, reps: null, setup: 'From floor', notes: 'Controlled, "steady"' },
      ],
    }] },
  }],
});

it('exports event results with typed measurements, units, failures, and unknown versus zero', () => {
  const plan = makeEventPlan();
  const rows = readCsv(routineHistoryToCsv(plan));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ Movement: 'Sandbag carry', Outcome: 'unsuccessful', 'Actual weight': '250',
    'Weight unit': 'lb', 'Actual distance': '0', 'Distance unit': 'ft', 'Event seconds': '', 'Actual reps': '', Setup: 'From floor' });
  expect(rows[1]).toMatchObject({ 'Actual weight': '200', 'Event seconds': '18.5', 'Total seconds': '3600', Notes: 'Controlled, "steady"' });
  plan.inputs.events[0].practices[0].recipe.weight = 999;
  expect(readCsv(routineHistoryToCsv(plan))[0]['Planned weight']).toBe('250');
});

it('exports ordered prescription parts and matching attempt snapshots', () => {
  const plan = makeEventPlan();
  const block = plan.workouts[0].session.eventBlocks[0];
  block.recipe = { parts: [
    { id: 'first', name: 'Pick practice', sets: 3, reps: 1, weight: 300, weightUnit: 'lb', setup: 'Raised bag' },
    { id: 'second', name: 'Lighter carry', sets: 2, distance: 20, distanceUnit: 'm', weight: 90, weightUnit: 'kg', loadMeaning: 'total' },
  ] };
  block.attempts = [{ id: 'a1', partId: 'second', partName: 'Lighter carry', status: 'completed', outcome: 'partial', weight: 90, weightUnit: 'kg', distance: 10, distanceUnit: 'm' }];
  const prescription = readCsv(routinePlanToCsv(plan));
  expect(prescription.map(row => row.Part)).toEqual(['Pick practice', 'Lighter carry']);
  expect(prescription[1]).toMatchObject({ Weight: '90', 'Weight unit': 'kg', Distance: '20', 'Distance unit': 'm' });
  expect(readCsv(routineHistoryToCsv(plan))[0]).toMatchObject({ Part: 'Lighter carry', 'Planned weight': '90', 'Actual weight': '90', 'Actual distance': '10' });
});

it('omits host slots from strength exports and clears their pairing when copied', () => {
  const plan = createRoutine('p1', 'Strength', { maxSquat: 400, maxPress: 200, maxDead: 500, duration: '5 weeks', mainLiftChoice: 'Low' });
  const host = { id: 'slot', kind: 'eventSlot', eventRef: { routineId: 'event-plan', workoutId: 'event-week' },
    completedAt: '2026-09-01', exercises: [{ id: 'bad-duplicate', generated: { movement: 'Do not export host', weight: 500, prescription: '3 × 1' }, overrides: {} }], session: null };
  const expectedPlan = routinePlanToCsv(plan);
  const expectedHistory = routineHistoryToCsv(plan);
  plan.workouts.push(host);
  expect(routinePlanToCsv(plan)).toBe(expectedPlan);
  expect(routineHistoryToCsv(plan)).toBe(expectedHistory);
  expect(duplicateRoutine(plan, 'p2', 'Copy').workouts.slice(-1)[0]).toMatchObject({ kind: 'eventSlot', eventRef: null, completedAt: null });
});

it('keeps event plans out of direct strength max correction and adaptive calculations', () => {
  const plan = makeEventPlan();
  expect(correctMaxes(plan, { maxSquat: 999 })).toBe(plan);
  expect(adaptiveCycleMaxes(plan)).toEqual([]);
  expect(refreshAdaptiveProgression(plan)).toEqual({ routine: plan, changed: false });
});

it('labels newly generated routines and their templates as strength records', () => {
  const plan = createRoutine('p1', 'Strength', { maxSquat: 400, maxPress: 200, maxDead: 500, duration: '5 weeks', mainLiftChoice: 'Low' });
  expect(plan.kind).toBe('strength');
  expect(createRoutineTemplate(plan, 'Reusable').kind).toBe('strength');
});

it('keeps skipped blocks and unknown event outlines reviewable without inventing results', () => {
  const plan = makeEventPlan();
  const block = plan.workouts[0].session.eventBlocks[0];
  block.attempts = [];
  block.recipe = null;
  block.status = 'skipped';
  const history = readCsv(routineHistoryToCsv(plan));
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ Attempt: '', 'Attempt status': 'skipped', 'Actual weight': '', 'Actual reps': '', 'Actual distance': '', 'Event seconds': '' });
  expect(readCsv(routinePlanToCsv(plan))[0]).toMatchObject({ Weight: '', Prescription: 'Set up today', Status: 'Skipped' });
});

it('duplicates event plans without shared inputs, history, or stale internal identities', () => {
  const source = makeEventPlan();
  const copied = duplicateRoutine(source, 'p2', 'Next show');
  expect(copied).toMatchObject({ kind: 'strongman', profileId: 'p2', name: 'Next show', status: 'saved' });
  expect(copied.inputs.events[0].id).not.toBe('bag');
  expect(copied.workouts[0].exercises[0].eventId).toBe(copied.inputs.events[0].id);
  expect(copied.workouts[0]).toMatchObject({ completedAt: null, session: null, hostRef: null });
  expect(copied.inputs.events[0].capabilities[0].status).toBe('unknown');
  copied.inputs.events[0].practices[0].recipe.weight = 100;
  expect(source.inputs.events[0].practices[0].recipe.weight).toBe(250);
});

it('creates typed event templates with reusable inputs and no show date or asserted coverage', () => {
  const source = makeEventPlan();
  const template = createRoutineTemplate(source, 'Reusable event prep');
  expect(template).toMatchObject({ kind: 'strongman', name: 'Reusable event prep', inputs: { competitionDate: '' } });
  expect(template.workouts).toBeUndefined();
  expect(template.inputs.events[0].capabilities[0].status).toBe('unknown');
  expect(template.inputs.events[0].coverage[0].unresolved).toBe(true);
  template.inputs.events[0].name = 'Different';
  expect(source.inputs.events[0].name).toBe('Sandbag');
  expect(() => createRoutineFromTemplate(template, 'p2', 'New event block')).toThrow('strongman builder');
});
