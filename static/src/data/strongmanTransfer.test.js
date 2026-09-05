import { cloneStrongmanRoutine, remapStrongmanReferences } from './strongmanTransfer';
import { normalizeRoutineTransfer } from './storageBackup';

const eventPlan = () => ({
  id: 'r1', profileId: 'p1', kind: 'strongman', name: 'Show prep', unknown: { keep: true },
  inputs: { events: [{ id: 'e1', practices: [{ id: 'p1-practice', eventId: 'e1' }],
    capabilities: [{ id: 'c1', status: 'confirmed', evidence: [{ workoutId: 'w1' }] }],
    coverage: [{ routineId: 'external', workoutId: 'outside', exerciseId: 'lift' }],
  }] },
  workouts: [{ id: 'w1', sequence: 1, completedAt: 'yesterday', hostRef: { routineId: 'strength', workoutId: 'slot' },
    blocks: [{ id: 'b1', eventId: 'e1', practiceId: 'p1-practice', capabilityId: 'c1' }], session: { status: 'completed' } }],
  coverageEvidence: [{ eventId: 'e1', eventWeek: 1, capabilityIds: ['c1'] }],
});

it('copies fresh plans with remapped component references and no performed evidence or binding', () => {
  const source = eventPlan();
  let next = 0;
  const copy = cloneStrongmanRoutine(source, { profileId: 'p2', name: 'Next', idFactory: () => `copy-${++next}` });
  expect(copy).toMatchObject({ kind: 'strongman', profileId: 'p2', name: 'Next', unknown: { keep: true } });
  expect(copy.id).not.toBe(source.id);
  expect(copy.workouts[0]).toMatchObject({ completedAt: null, session: null, hostRef: null });
  expect(copy.inputs.events[0].capabilities[0]).toMatchObject({ status: 'unknown', evidence: [] });
  expect(copy.coverageEvidence).toEqual([]);
  expect(copy.workouts[0].blocks[0].eventId).toBe(copy.inputs.events[0].id);
  expect(copy.workouts[0].blocks[0].practiceId).toBe(copy.inputs.events[0].practices[0].id);
  expect(copy.inputs.events[0].coverage[0]).toMatchObject({ routineId: 'external', unresolved: true });
  expect(source.workouts[0].completedAt).toBe('yesterday');
});

it('rejects malformed nested event history before copying it', () => {
  const source = eventPlan();
  source.workouts[0].session.eventBlocks = [{ attempts: 'bad' }];
  expect(() => cloneStrongmanRoutine(source)).toThrow(/attempts/);
});

it('remaps frozen checkpoint associations while leaving unknown extension records unchanged', () => {
  const source = eventPlan();
  source.unknown = { id: 'extension', session: { keep: true }, capabilityIds: ['c1'], completedAt: 'preserve' };
  const snapshot = { eventId: 'e1', practiceId: 'p1-practice', capabilityIds: ['c1'], focus: 'pick', parts: [{ id: 'leg', capabilityIds: ['c1'], focus: 'carry' }] };
  source.workouts[0].exercises = [{ id: 'exercise', capabilitySnapshot: snapshot }];
  source.workouts[0].session.eventBlocks = [{ id: 'block', capabilitySnapshot: snapshot, attempts: [{ id: 'attempt', partId: 'leg' }] }];
  source.inputs.events[0].practices[0].recipe = { parts: [{ id: 'leg', name: 'Carry' }] };
  const copy = cloneStrongmanRoutine(source, { preserveHistory: true });
  const event = copy.inputs.events[0];
  const copiedSnapshot = copy.workouts[0].session.eventBlocks[0].capabilitySnapshot;
  expect(copiedSnapshot).toMatchObject({ eventId: event.id, practiceId: event.practices[0].id, capabilityIds: [event.capabilities[0].id],
    parts: [{ id: event.practices[0].recipe.parts[0].id, capabilityIds: [event.capabilities[0].id] }] });
  expect(copy.workouts[0].session.eventBlocks[0].attempts[0].partId).toBe(copiedSnapshot.parts[0].id);
  expect(copy.unknown).toEqual(source.unknown);
  expect(cloneStrongmanRoutine(source).unknown).toEqual(source.unknown);
});

it('preserves history in a conflict copy and remaps cross-record host links when available', () => {
  const source = eventPlan();
  const copy = cloneStrongmanRoutine(source, { preserveHistory: true });
  expect(copy.workouts[0].completedAt).toBe('yesterday');
  expect(copy.inputs.events[0].capabilities[0].evidence[0].workoutId).toBe(copy.workouts[0].id);
  const remapped = remapStrongmanReferences({ kind: 'strength', workouts: [
    { kind: 'eventSlot', eventRef: { routineId: 'r1', workoutId: 'w1' } },
  ] }, new Map([['r1', copy.id], ['w1', copy.workouts[0].id]]));
  expect(remapped.workouts[0].eventRef).toEqual({ routineId: copy.id, workoutId: copy.workouts[0].id });
});

it('reads version 1 transfers as normalized strength plans and emits schema version 11', () => {
  const payload = { format: 'mcilroy-method-routine-transfer', version: 1, routine: { id: 'r1', inputs: {}, workouts: [] } };
  expect(normalizeRoutineTransfer(payload)).toMatchObject({ version: 2, schemaVersion: 11,
    routine: { kind: 'strength', inputs: { maxProgressionMode: 'fixed' } } });
  expect(payload.routine.kind).toBeUndefined();
  expect(() => normalizeRoutineTransfer({ ...payload, version: 3 })).toThrow('supported');
  expect(() => normalizeRoutineTransfer({ ...payload, version: 2, schemaVersion: 999 })).toThrow('supported');
});
