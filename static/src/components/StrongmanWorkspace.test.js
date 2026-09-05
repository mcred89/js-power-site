import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import StrongmanWorkspace from './StrongmanWorkspace';
import { adaptStrongmanRoutine, createStrongmanRoutine, defaultStrongmanInputs } from '../data/strongman';
import { createLinkedStrengthRoutine, eventCoverageEvidence } from '../data/strongmanIntegration';
import { serializedRecordsEqual } from '../data/recordComparison';

test('a host preview reserves nothing and starts exactly one event-owned workout', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const events = [{ id: 'bag', name: 'Sandbag', family: 'carry', priority: 'main', practices: [{ id: 'pick', name: 'Pick assessment', available: true, capacity: 1, recipe: null }], capabilities: [], coverage: [] }];
  const plan = createStrongmanRoutine('p', 'Show', { ...defaultStrongmanInputs(), events });
  const host = createLinkedStrengthRoutine('p', 'Normal', { maxSquat: '400', maxPress: '200', maxDead: '500', mainLiftChoice: 'Low', duration: '5 weeks' }, plan);
  const slot = host.workouts.find(workout => workout.kind === 'eventSlot');
  const profile = { id: 'p', name: 'Sam', activeStrongmanRoutineId: plan.id, activeWorkoutRoutineId: null };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[host, plan]} request={{ hostRoutineId: host.id, hostWorkoutId: slot.id }} onCommit={onCommit} onBack={() => {}} />));
  expect(onCommit).not.toHaveBeenCalled();
  expect(div.textContent).toContain('Pick assessment');
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Start event day').click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  const change = onCommit.mock.calls[0][0];
  expect(change.profile.activeWorkoutRoutineId).toBe(plan.id);
  expect(change.routines.find(routine => routine.id === plan.id).workouts[0].session.status).toBe('inProgress');
  expect(change.routines.find(routine => routine.id === host.id).workouts.find(workout => workout.id === slot.id).eventRef.routineId).toBe(plan.id);
  act(() => root.unmount());
});

test('ignores a plan request from another profile and opens this profile block without writing', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const events = [{ id: 'bag', name: 'Sandbag', family: 'carry', priority: 'main', practices: [{ id: 'pick', name: 'Pick assessment', available: true, capacity: 1, recipe: null }], capabilities: [], coverage: [] }];
  const ownPlan = createStrongmanRoutine('second-profile', 'Current profile preparation', { ...defaultStrongmanInputs(), events });
  const profile = { id: 'second-profile', name: 'Alex', activeStrongmanRoutineId: ownPlan.id, activeWorkoutRoutineId: null };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[ownPlan]} request={{ planId: 'first-profile-plan', workoutId: 'old-workout' }} onCommit={onCommit} onBack={() => {}} />));
  expect(div.textContent).toContain('Current profile preparation');
  expect(onCommit).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test('does not reuse a completed orphan host for the next active event block', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const events = [{ id: 'bag', name: 'Sandbag', family: 'carry', priority: 'main', practices: [{ id: 'pick', name: 'Pick assessment', available: true, capacity: 1, recipe: null }], capabilities: [], coverage: [] }];
  const plan = createStrongmanRoutine('p', 'Next show', { ...defaultStrongmanInputs(), events });
  const host = createLinkedStrengthRoutine('p', 'Old normal routine', { maxSquat: '400', maxPress: '200', maxDead: '500', mainLiftChoice: 'Low', duration: '5 weeks' }, plan);
  const slot = host.workouts.find(workout => workout.kind === 'eventSlot');
  slot.completedAt = '2026-01-01T12:00:00Z';
  slot.eventRemoved = true;
  const profile = { id: 'p', name: 'Sam', activeStrongmanRoutineId: plan.id, activeWorkoutRoutineId: null };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[host, plan]} request={{ hostRoutineId: host.id, hostWorkoutId: slot.id }} onCommit={onCommit} onBack={() => {}} />));
  expect(div.textContent).not.toContain('Start event day');
  expect(div.textContent).not.toContain('Use manual event day');
  expect(onCommit).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test('offers a manual event day when the host remains after its event block was deleted', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = { id: 'normal', profileId: 'p', kind: 'strength', name: 'Normal', workouts: [{ id: 'slot', kind: 'eventSlot', name: 'Strongman', exercises: [], eventRef: null }] };
  const profile = { id: 'p', name: 'Sam', activeStrongmanRoutineId: null, activeWorkoutRoutineId: null };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[host]} request={{ hostRoutineId: host.id, hostWorkoutId: 'slot' }} onCommit={onCommit} onBack={() => {}} />));
  const manual = [...div.querySelectorAll('button')].find(button => button.textContent === 'Use manual event day');
  expect(manual).toBeDefined();
  await act(async () => manual.click());
  expect(onCommit.mock.calls[0][0].routines[0].workouts[0]).toMatchObject({ id: 'slot', kind: 'manualEvent', eventRef: null });
  act(() => root.unmount());
});

test('refreshes a stale event preview before starting while retaining the original storage comparison', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const normal = { id: 'normal', profileId: 'p', name: 'Normal', workouts: [{ id: 'press', exercises: [{ id: 'axle', generated: { movement: 'Axle clean', weight: 100, prescription: '3 x 2' }, overrides: {} }] }] };
  const events = ['axle', 'bag'].map(id => ({ id, name: id, family: 'carry', priority: 'main', practices: [{ id, name: id === 'axle' ? 'Axle practice' : 'Bag practice', recipe: { sets: 3, weight: 100, reps: 2 } }], capabilities: [], coverage: id === 'axle' ? [{ routineId: 'normal', exerciseId: 'axle', eventWeek: 1, scope: 'exact', wholeEvent: true, sourcePrescription: { ...normal.workouts[0].exercises[0].generated } }] : [] }));
  let plan = createStrongmanRoutine('p', 'Show', { ...defaultStrongmanInputs(), events });
  plan = adaptStrongmanRoutine(plan, eventCoverageEvidence(plan, [normal]));
  // A linked source is removed after the plan was last generated. Opening and
  // starting must both use current coverage while claiming the persisted owner.
  plan.workouts[0].exercises = plan.workouts[0].exercises.filter(exercise => exercise.eventId !== 'axle');
  const profile = { id: 'p', name: 'Sam', activeStrongmanRoutineId: plan.id, activeWorkoutRoutineId: null };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan]} request={{ planId: plan.id, workoutId: plan.workouts[0].id }} onCommit={onCommit} onBack={() => {}} />));
  expect(div.textContent).toContain('Axle practice');
  expect(onCommit).not.toHaveBeenCalled();
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Start event day').click());
  const change = onCommit.mock.calls[0][0];
  expect(change.routines[0].workouts[0].exercises.some(exercise => exercise.eventId === 'axle')).toBe(true);
  expect(change.conditions.routines[0].expected).toBe(plan);
  act(() => root.unmount());
});

test('skipping the final week of a paused block preserves another active block enrollment', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const events = [{ id: 'bag', name: 'Bag', practices: [{ id: 'bag', name: 'Bag', recipe: null }], capabilities: [] }];
  const active = createStrongmanRoutine('p', 'Active preparation', { ...defaultStrongmanInputs(), events });
  const paused = { ...createStrongmanRoutine('p', 'Old preparation', { ...defaultStrongmanInputs(), events }), status: 'paused' };
  paused.workouts.slice(0, 11).forEach(workout => { workout.skippedAt = 'before'; });
  const profile = { id: 'p', name: 'Sam', activeStrongmanRoutineId: active.id, activeWorkoutRoutineId: null };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[active, paused]} request={{ planId: paused.id }} onCommit={onCommit} onBack={() => {}} />));
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Skip event week').click());
  const change = onCommit.mock.calls[0][0];
  expect(change.profile ? change.profile.activeStrongmanRoutineId : profile.activeStrongmanRoutineId).toBe(active.id);
  expect(change.routines[0].status).toBe('complete');
  expect(change.conditions.routines).toEqual([{ key: paused.id, expected: paused }]);
  act(() => root.unmount());
});

const concurrencyFixture = () => {
  const events = [{ id: 'bag', name: 'Bag', practices: [{ id: 'bag', name: 'Bag', recipe: null }], capabilities: [] }];
  const plan = createStrongmanRoutine('p', 'Preparation', { ...defaultStrongmanInputs(), events });
  const profile = { id: 'p', name: 'Sam', activeStrongmanRoutineId: plan.id, activeWorkoutRoutineId: null };
  return { plan, profile };
};

test('a stale lock edit cannot erase an event session started by another tab', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { plan, profile } = concurrencyFixture();
  let stored = { ...plan, workouts: plan.workouts.map((workout, index) => index ? workout : { ...workout, session: { status: 'inProgress', startedAt: 'other-tab' } }) };
  const onCommit = jest.fn(async change => {
    const expected = change.conditions?.routines?.find(item => item.key === plan.id);
    if (expected && !serializedRecordsEqual(expected.expected, stored)) throw new Error('Data changed. Reload this plan.');
    stored = change.routines[0];
  });
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan]} request={{ planId: plan.id }} onCommit={onCommit} onBack={() => {}} />));
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Lock session').click());
  expect(stored.workouts[0].session?.status).toBe('inProgress');
  expect(div.querySelector('[role="alert"]').textContent).toContain('Data changed');
  act(() => root.unmount());
});

test('successive event draft writes compare the preceding owner version', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { plan, profile } = concurrencyFixture();
  plan.workouts[0].session = { status: 'inProgress', startedAt: '2026-01-01', runningSince: null, elapsedSeconds: 0 };
  profile.activeWorkoutRoutineId = plan.id;
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan]} request={{ planId: plan.id, workoutId: plan.workouts[0].id }} onCommit={onCommit} onBack={() => {}} />));
  const change = async value => act(async () => {
    const input = div.querySelector('[aria-label="Block 1 weight"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await change('200');
  await change('210');
  const [first, second] = onCommit.mock.calls.map(call => call[0]);
  expect(first.conditions.routines).toEqual([{ key: plan.id, expected: plan }]);
  expect(second.conditions.routines).toEqual([{ key: plan.id, expected: first.routines[0] }]);
  act(() => root.unmount());
});

test('creating another active block compares the profile, paused block, and absence of the new record', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { plan, profile } = concurrencyFixture();
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan]} request={{ create: true, template: { name: 'Next block', inputs: plan.inputs } }} onCommit={onCommit} onBack={() => {}} />));
  await act(async () => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const change = onCommit.mock.calls[0][0];
  expect(change.conditions.profiles).toEqual([{ key: profile.id, expected: profile }]);
  expect(change.conditions.routines).toEqual(expect.arrayContaining([{ key: plan.id, expected: plan }, { key: change.routines[0].id, expected: undefined }]));
  act(() => root.unmount());
});

test('activating a saved block compares both existing block statuses and profile enrollment', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { plan, profile } = concurrencyFixture();
  const saved = { ...createStrongmanRoutine('p', 'Saved block', plan.inputs), status: 'saved' };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan, saved]} request={{ planId: saved.id }} onCommit={onCommit} onBack={() => {}} />));
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Activate block').click());
  const change = onCommit.mock.calls[0][0];
  expect(change.conditions.profiles).toEqual([{ key: profile.id, expected: profile }]);
  expect(change.conditions.routines).toEqual(expect.arrayContaining([{ key: plan.id, expected: plan }, { key: saved.id, expected: saved }]));
  act(() => root.unmount());
});

test('saving a taper day updates only future taper work and leaves the started snapshot intact', async () => {
  const normal = { sets: 4, weight: 250, distance: 50 };
  const taper = { sets: 2, weight: 100, distance: 20 };
  const plan = createStrongmanRoutine('p', 'Taper', {
    ...defaultStrongmanInputs(), weeks: 2, phases: [{ id: 'taper', type: 'taper', weeks: 2 }],
    events: [{ id: 'bag', name: 'Bag', family: 'carry', priority: 'main', practices: [{ id: 'pick', name: 'Bag', recipe: normal, taperRecipe: taper }], capabilities: [], coverage: [] }],
  });
  plan.workouts[0].session = { status: 'inProgress', startedAt: '2026-01-01', runningSince: null, elapsedSeconds: 0 };
  const onCommit = jest.fn().mockResolvedValue();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={{ id: 'p', name: 'Sam', activeStrongmanRoutineId: plan.id, activeWorkoutRoutineId: plan.id }} routines={[plan]} request={{ planId: plan.id, workoutId: plan.workouts[0].id }} onCommit={onCommit} onBack={() => {}} />));
  await act(async () => {
    const input = div.querySelector('[aria-label="Block 1 weight"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '120');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Use this prescription next time').click());
  const updated = onCommit.mock.calls.at(-1)[0].routines[0];
  expect(updated.inputs.events[0].practices[0].taperRecipe.weight).toBe(120);
  expect(updated.inputs.events[0].practices[0].recipe).toEqual(normal);
  expect(updated.workouts[0].exercises).toEqual(plan.workouts[0].exercises);
  expect(updated.workouts[0].session.eventBlocks[0].recipe.weight).toBe(100);
  act(() => root.unmount());
});

test('an imported paused session resumes explicitly after activation without erasing its attempts', async () => {
  const { plan, profile } = concurrencyFixture();
  plan.status = 'paused';
  profile.activeStrongmanRoutineId = null;
  const attempt = { id: 'attempt', weight: 200, reps: 1, outcome: 'successful', status: 'completed' };
  const pausedSession = { status: 'paused', startedAt: '2026-01-01', runningSince: null, elapsedSeconds: 120, eventBlocks: [{ id: 'block', eventId: 'bag', practiceId: 'bag', movement: 'Bag', setup: '', recipe: null, draft: { weight: 200 }, attempts: [attempt], status: 'completed', capabilitySnapshot: null }] };
  plan.workouts[0].session = pausedSession;
  const commits = [];
  const Harness = () => {
    const [records, setRecords] = React.useState([plan]);
    const [currentProfile, setProfile] = React.useState(profile);
    return <StrongmanWorkspace profile={currentProfile} routines={records} request={{ planId: plan.id, workoutId: plan.workouts[0].id }} onBack={() => {}} onCommit={async change => {
      commits.push(change);
      setRecords(current => current.map(record => change.routines?.find(item => item.id === record.id) || record));
      if (change.profile) setProfile(change.profile);
    }} />;
  };
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<Harness />));
  expect(div.textContent).toContain('200 lb');
  expect(commits).toHaveLength(0);
  const button = label => [...div.querySelectorAll('button')].find(item => item.textContent === label);
  expect(button('Resume paused event day')?.disabled).toBe(true);
  await act(async () => button('Activate block').click());
  expect(commits[0].routines[0].workouts[0].session).toEqual(pausedSession);
  await act(async () => button('Resume paused event day').click());
  expect(commits[1].profile.activeWorkoutRoutineId).toBe(plan.id);
  expect(commits[1].routines[0].workouts[0].session).toMatchObject({ status: 'inProgress', elapsedSeconds: 120, eventBlocks: [{ attempts: [attempt] }] });
  expect(div.textContent).toContain('Finish event day');
  act(() => root.unmount());
});

test('a paused event session cannot resume over another active workout', async () => {
  const { plan, profile } = concurrencyFixture();
  plan.workouts[0].session = { status: 'paused', startedAt: 'before', elapsedSeconds: 120, runningSince: null, eventBlocks: [] };
  profile.activeWorkoutRoutineId = 'normal';
  const onCommit = jest.fn();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan]} request={{ planId: plan.id, workoutId: plan.workouts[0].id }} onCommit={onCommit} onBack={() => {}} />));
  const resume = [...div.querySelectorAll('button')].find(item => item.textContent === 'Resume paused event day');
  expect(resume.disabled).toBe(true);
  await act(async () => resume.click());
  expect(onCommit).not.toHaveBeenCalled();
  expect(plan.workouts[0].session.status).toBe('paused');
  act(() => root.unmount());
});

test('a rejected paused-session resume preserves saved attempts and remains available to retry', async () => {
  const { plan, profile } = concurrencyFixture();
  const attempts = [{ id: 'a1', weight: 220, reps: 1, status: 'completed', outcome: 'successful' }];
  plan.workouts[0].session = { status: 'paused', startedAt: 'before', runningSince: null, elapsedSeconds: 120, eventBlocks: [{ id: 'block', movement: 'Bag', recipe: null, setup: '', attempts, status: 'completed' }] };
  const original = JSON.stringify(plan);
  const onCommit = jest.fn().mockRejectedValue(new Error('Data changed. Reload this plan.'));
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<StrongmanWorkspace profile={profile} routines={[plan]} request={{ planId: plan.id, workoutId: plan.workouts[0].id }} onCommit={onCommit} onBack={() => {}} />));
  await act(async () => [...div.querySelectorAll('button')].find(item => item.textContent === 'Resume paused event day').click());
  expect(div.querySelector('[role="alert"]').textContent).toContain('Data changed');
  expect(div.textContent).toContain('220 lb');
  expect(div.textContent).not.toContain('Finish event day');
  expect(JSON.stringify(plan)).toBe(original);
  act(() => root.unmount());
});
