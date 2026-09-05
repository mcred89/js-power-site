import { createLinkedStrengthRoutine, startLinkedEvent, finishLinkedEvent, skipEventWorkout, reopenLinkedEvent, resumePausedLinkedEvent, detachLinkedPlan, eventCoverageEvidence } from './strongmanIntegration';
import { correctMaxes } from './routinePlanning';

const settings = { maxSquat: '500', maxPress: '225', maxDead: '600', duration: '3 weeks', mainLiftChoice: 'Low', includeStrongmanDay: false, pressEventEnabled: true, pressEventMovement: 'Axle clean', pressEventSets: '4', pressEventReps: '2' };
const eventPlan = () => ({ id: 'events', profileId: 'p', kind: 'strongman', status: 'active', inputs: { events: [] }, workouts: Array.from({ length: 12 }, (_, i) => ({ id: `e${i + 1}`, sequence: i + 1, eventWeek: i + 1, name: 'Strongman', exercises: [], session: null, completedAt: null, skippedAt: null })) });
const profile = { id: 'p', activeStrongmanRoutineId: 'events', activeWorkoutRoutineId: null };

test('forces dedicated slots without changing compressed strength or normal-day event work', () => {
  const normal = createLinkedStrengthRoutine('p', 'Strength', settings, eventPlan());
  expect(normal.inputs.includeStrongmanDay).toBe(true);
  expect(normal.workouts.filter(w => w.name === 'Deadlift')).toHaveLength(3);
  expect(normal.workouts.filter(w => w.kind === 'eventSlot')).toHaveLength(3);
  expect(normal.workouts.find(w => w.name === 'Press').exercises.some(e => e.generated.movement === 'Strongman event: Axle clean')).toBe(true);
  const slot = normal.workouts.find(w => w.kind === 'eventSlot');
  slot.eventRef = { routineId: 'events', workoutId: 'e1' };
  expect(correctMaxes(normal, { maxSquat: '550', maxPress: '250', maxDead: '650' }).workouts.find(w => w.id === slot.id)).toEqual(slot);
});

test('keeps dedicated slots while the final event week is in progress', () => {
  const plan = eventPlan();
  plan.workouts.forEach(day => { day.completedAt = 'earlier'; });
  plan.workouts[11] = { ...plan.workouts[11], completedAt: null, session: { status: 'inProgress', startedAt: 'today' } };
  const normal = createLinkedStrengthRoutine('p', 'Next strength block', settings, plan);
  expect(normal.inputs.includeStrongmanDay).toBe(true);
  expect(normal.workouts.filter(day => day.kind === 'eventSlot')).toHaveLength(3);
});

test('normal-day links require an explicit event week before they can replace an exposure', () => {
  const normal = createLinkedStrengthRoutine('p', 'Strength', settings, eventPlan());
  const exercise = normal.workouts.find(day => day.name === 'Press').exercises[0];
  const event = { ...eventPlan(), inputs: { events: [{ id: 'press', coverage: [{ routineId: normal.id, exerciseId: exercise.id, scope: 'exact', wholeEvent: true }] }] } };
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ needsReview: true });
  event.inputs.events[0].coverage[0].eventWeek = 2;
  event.inputs.events[0].coverage[0].sourcePrescription = { ...exercise.generated };
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ eventWeek: 2, needsReview: false });
});

test('uses a freshly adapted event draft while comparing the original persisted owner at claim time', () => {
  const event = eventPlan();
  const draft = { ...event, workouts: event.workouts.map((workout, index) => index ? workout : { ...workout, exercises: [{ id: 'new-practice', generated: { movement: 'Sandbag pick' }, overrides: {} }] }) };
  const started = startLinkedEvent({ profile, eventPlan: event, draftPlan: draft });
  expect(started.routines[0].workouts[0].exercises[0].id).toBe('new-practice');
  expect(started.conditions.routines[0]).toEqual({ key: event.id, expected: event });
  expect(event.workouts[0].exercises).toEqual([]);
});

test('requires review when future normal-day prescription or completed actual work changes from the linked source', () => {
  const normal = createLinkedStrengthRoutine('p', 'Strength', settings, eventPlan());
  const press = normal.workouts.find(day => day.name === 'Press');
  const exercise = press.exercises.find(item => item.generated.movement === 'Strongman event: Axle clean');
  const event = { ...eventPlan(), inputs: { events: [{ id: 'axle', coverage: [{ routineId: normal.id, exerciseId: exercise.id, eventWeek: 1, scope: 'exact', wholeEvent: true, sourcePrescription: { ...exercise.generated } }] }] } };
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ needsReview: false, planned: true });
  exercise.overrides = { movement: 'Dumbbell curl' };
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ needsReview: true, planned: false });
  press.completedAt = 'today';
  press.session = { exercises: [{ exerciseId: exercise.id, movement: 'Dumbbell curl', sets: [{ status: 'completed', actualWeight: 100, actualReps: 2 }] }] };
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ needsReview: true, completedAt: null });
  exercise.overrides = { prescription: '1 x 1' };
  press.completedAt = null;
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ needsReview: true, planned: false });
});

test('claims an event owner atomically, resolves the host, and continues standalone', () => {
  const event = eventPlan();
  const host = createLinkedStrengthRoutine('p', 'Strength', settings, event);
  const slot = host.workouts.find(w => w.kind === 'eventSlot');
  const started = startLinkedEvent({ profile, eventPlan: event, hostRoutine: host, hostWorkoutId: slot.id, timestamp: '2026-01-01T00:00:00Z' });
  expect(event.workouts[0].session).toBeNull();
  expect(started.profile.activeWorkoutRoutineId).toBe(event.id);
  expect(started.routines[0].workouts[0].hostRef).toEqual({ routineId: host.id, workoutId: slot.id });
  expect(started.conditions.routines).toHaveLength(2);
  const owner = started.routines[0];
  const updatedHost = started.routines[1];
  const finished = finishLinkedEvent({ profile: started.profile, eventPlan: owner, workout: owner.workouts[0], hostRoutine: updatedHost, timestamp: '2026-01-01T01:00:00Z' });
  expect(finished.routines[1].workouts.find(w => w.id === slot.id).completedAt).toBe('2026-01-01T01:00:00Z');
  expect(finished.profile.activeWorkoutRoutineId).toBeNull();
  const standalone = startLinkedEvent({ profile: finished.profile, eventPlan: finished.routines[0] });
  expect(standalone.routines[0].workouts[1].session.status).toBe('inProgress');
  expect(standalone.routines[0].workouts[1].hostRef).toBeNull();
});

test('rejects a second active session, wrong profiles, and jumping ahead', () => {
  expect(() => startLinkedEvent({ profile: { ...profile, activeWorkoutRoutineId: 'other' }, eventPlan: eventPlan() })).toThrow(/active workout/i);
  expect(() => startLinkedEvent({ profile: { ...profile, id: 'other' }, eventPlan: eventPlan() })).toThrow(/profile/i);
  expect(() => startLinkedEvent({ profile, eventPlan: eventPlan(), workoutId: 'e3' })).toThrow(/earlier/i);
});

test('explicit event skips consume one ordinal, while host deletion does not consume any', () => {
  const event = eventPlan();
  const skipped = skipEventWorkout(event, 'e1', '2026-01-01');
  expect(skipped.workouts[0]).toMatchObject({ skippedAt: '2026-01-01', completedAt: null });
  expect(startLinkedEvent({ profile, eventPlan: skipped }).routines[0].workouts[1].session.status).toBe('inProgress');
  const host = createLinkedStrengthRoutine('p', 'Strength', settings, event);
  const detached = detachLinkedPlan(host, [host, event]);
  expect(detached.find(r => r.id === event.id)).toEqual(event);
});

test('reopening an old event preserves later work and its host pairing', () => {
  const event = eventPlan();
  event.workouts[0] = { ...event.workouts[0], completedAt: 'then', session: { startedAt: 'before', status: 'completed', eventBlocks: [] } };
  event.workouts[1].completedAt = 'later';
  const result = reopenLinkedEvent({ profile, eventPlan: event, workoutId: 'e1' });
  expect(result.routines[0].workouts[0].session.startedAt).toBe('before');
  expect(result.routines[0].workouts[1].completedAt).toBe('later');
});

test('a copied event cannot reopen or finish the original event owner’s host', () => {
  const original = eventPlan();
  const host = createLinkedStrengthRoutine('p', 'Strength', settings, original);
  const slot = host.workouts.find(workout => workout.kind === 'eventSlot');
  slot.eventRef = { routineId: original.id, workoutId: 'e1' };
  slot.completedAt = 'original completion';
  const copied = { ...eventPlan(), id: 'copied-events' };
  copied.workouts[0] = {
    ...copied.workouts[0],
    hostRef: { routineId: host.id, workoutId: slot.id },
    completedAt: 'imported completion',
    session: { status: 'completed', startedAt: 'before', eventBlocks: [{ attempts: [{ weight: 300 }] }] },
  };
  const reopened = reopenLinkedEvent({ profile, eventPlan: copied, workoutId: 'e1', hostRoutine: host });
  expect(reopened.routines).toHaveLength(1);
  expect(reopened.routines[0].workouts[0].hostRef).toBeNull();
  expect(reopened.routines[0].workouts[0].session.eventBlocks[0].attempts).toEqual([{ weight: 300 }]);
  const active = { ...copied, workouts: copied.workouts.map((workout, index) => index ? workout : { ...workout, completedAt: null, session: { ...workout.session, status: 'inProgress' } }) };
  const finished = finishLinkedEvent({ profile: { ...profile, activeWorkoutRoutineId: copied.id }, eventPlan: active, workout: active.workouts[0], hostRoutine: host });
  expect(finished.routines).toHaveLength(1);
  expect(finished.routines[0].workouts[0].hostRef).toBeNull();
  expect(slot.completedAt).toBe('original completion');
});

test('reopening a reciprocal event pairing clears only its own host completion', () => {
  const event = eventPlan();
  const host = createLinkedStrengthRoutine('p', 'Strength', settings, event);
  const slot = host.workouts.find(workout => workout.kind === 'eventSlot');
  const started = startLinkedEvent({ profile, eventPlan: event, hostRoutine: host, hostWorkoutId: slot.id });
  const finished = finishLinkedEvent({ profile: started.profile, eventPlan: started.routines[0], workout: started.routines[0].workouts[0], hostRoutine: started.routines[1] });
  const reopened = reopenLinkedEvent({ profile: finished.profile, eventPlan: finished.routines[0], workoutId: 'e1', hostRoutine: finished.routines[1] });
  expect(reopened.routines[0].workouts[0].hostRef).toEqual({ routineId: host.id, workoutId: slot.id });
  expect(reopened.routines[1].workouts.find(workout => workout.id === slot.id).completedAt).toBeNull();
});

test('resumes imported paused attempts without inventing work or elapsed time', () => {
  const event = eventPlan();
  const attempts = [{ weight: 300, distance: 0, outcome: 'unsuccessful' }];
  event.workouts[0].session = { status: 'paused', startedAt: '2026-01-01T10:00:00Z', elapsedSeconds: 90, runningSince: null, eventBlocks: [{ attempts }] };
  const timestamp = '2026-01-05T10:00:00Z';
  const change = resumePausedLinkedEvent({ profile, eventPlan: event, workoutId: 'e1', timestamp });
  expect(change.routines[0].workouts[0].session).toEqual({ ...event.workouts[0].session, status: 'inProgress', runningSince: timestamp });
  expect(change.profile.activeWorkoutRoutineId).toBe(event.id);
  expect(change.conditions.routines[0].expected).toEqual(event);
  expect(event.workouts[0].session.status).toBe('paused');
  const finished = finishLinkedEvent({ profile: change.profile, eventPlan: change.routines[0], workout: change.routines[0].workouts[0] });
  expect(finished.routines[0].workouts[0].session.eventBlocks[0].attempts).toEqual(attempts);
});

test('paused event resume requires activation, correct profile and no existing active session', () => {
  const event = eventPlan();
  event.workouts[0].session = { status: 'paused', startedAt: 'before', runningSince: null, eventBlocks: [] };
  expect(() => resumePausedLinkedEvent({ profile: { ...profile, activeWorkoutRoutineId: 'normal' }, eventPlan: event, workoutId: 'e1' })).toThrow(/active workout/i);
  expect(() => resumePausedLinkedEvent({ profile, eventPlan: { ...event, status: 'paused' }, workoutId: 'e1' })).toThrow(/activate/i);
  expect(() => resumePausedLinkedEvent({ profile: { ...profile, id: 'other' }, eventPlan: event, workoutId: 'e1' })).toThrow(/profile/i);
  expect(() => resumePausedLinkedEvent({ profile, eventPlan: event, workoutId: 'e2' })).toThrow(/paused/i);
});

test('normal-day evidence requires an explicit compatible link and completed actual work', () => {
  const normal = createLinkedStrengthRoutine('p', 'Strength', settings, eventPlan());
  const press = normal.workouts.find(w => w.name === 'Press');
  const exercise = press.exercises.find(e => e.generated.movement === 'Strongman event: Axle clean');
  const event = { ...eventPlan(), inputs: { events: [{ id: 'axle', coverage: [{ routineId: normal.id, exerciseId: exercise.id, scope: 'support', capabilityIds: ['clean'] }] }] } };
  expect(eventCoverageEvidence(event, [normal]).filter(item => item.completedAt)).toHaveLength(0);
  press.completedAt = 'today';
  press.session = { exercises: [{ exerciseId: exercise.id, movement: exercise.generated.movement, sets: [{ status: 'completed', actualWeight: 100, actualReps: 2 }] }] };
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ eventId: 'axle', scope: 'support', completedAt: 'today' });
  press.session.exercises[0].movement = 'Dumbbell curl';
  expect(eventCoverageEvidence(event, [normal])[0]).toMatchObject({ needsReview: true });
});
