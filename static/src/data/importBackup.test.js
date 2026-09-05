import { createImportPlan, importPlanSummary, recordsToSave } from './importBackup';
import { createStrongmanRoutine, defaultStrongmanInputs } from './strongman';

const eventFixture = () => createStrongmanRoutine('p', 'Show', { ...defaultStrongmanInputs(), events: [{
  id: 'bag', name: 'Bag', practices: [{ id: 'pick', name: 'Pick', recipe: null }], capabilities: [], coverage: [],
}] });

it('detaches imported conflict history from an unchanged host owned by the original local plan', () => {
  const local = eventFixture();
  local.workouts[0].completedAt = '2026-09-01T12:00:00Z';
  local.workouts[0].session = { status: 'completed', startedAt: '2026-09-01T11:00:00Z', eventBlocks: [] };
  local.workouts[0].hostRef = { routineId: 'host', workoutId: 'slot' };
  const host = { id: 'host', kind: 'strength', profileId: 'p', workouts: [{ id: 'slot', exercises: [], completedAt: local.workouts[0].completedAt, eventRef: { routineId: local.id, workoutId: local.workouts[0].id } }] };
  const plan = createImportPlan({ profiles: [], routines: [host, { ...local, name: 'Imported changes' }] }, [], [host, local]);
  const imported = plan.routines.find(item => item.imported.id === local.id).result;
  expect(imported.workouts[0].hostRef).toBeNull();
  expect(imported.workouts[0].unresolvedHostRef).toMatchObject({ routineId: host.id, workoutId: 'slot', unresolved: true });
  expect(plan.routines.find(item => item.imported.id === host.id).result).toEqual(host);
});

it('retains the local active owner and suspends imported conflict attempts with captured elapsed time', () => {
  const local = eventFixture();
  local.workouts[0].session = { status: 'inProgress', startedAt: '2026-09-01T11:00:00Z', runningSince: '2026-09-01T11:00:00Z', elapsedSeconds: 7, eventBlocks: [{ id: 'block', attempts: [{ id: 'attempt', weight: 200 }] }] };
  const profile = { id: 'p', activeWorkoutRoutineId: local.id, activeStrongmanRoutineId: local.id };
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T11:01:00Z'));
  const plan = createImportPlan({ profiles: [profile], routines: [{ ...local, name: 'Imported changes' }] }, [profile], [local]);
  clock.mockRestore();
  const imported = plan.routines[0].result;
  expect(imported).toMatchObject({ status: 'paused' });
  expect(imported.workouts[0].session).toMatchObject({ status: 'paused', runningSince: null, elapsedSeconds: 67, eventBlocks: [{ attempts: [{ weight: 200 }] }] });
  expect(plan.profiles[0].result.activeWorkoutRoutineId).toBe(local.id);
  expect(local.workouts[0].session.status).toBe('inProgress');
});

it('sets the final profile pointer to a newly imported sole active event owner', () => {
  const imported = eventFixture();
  imported.workouts[0].session = { status: 'inProgress', startedAt: '2026-09-01T11:00:00Z', elapsedSeconds: 0 };
  const localProfile = { id: 'p', activeWorkoutRoutineId: null, activeStrongmanRoutineId: null };
  const plan = createImportPlan({ profiles: [], routines: [imported] }, [localProfile], []);
  expect(plan.profiles.find(item => item.result.id === 'p').result.activeWorkoutRoutineId).toBe(imported.id);
});

it('preserves a fully imported reciprocal host graph and pauses extra normal session history', () => {
  const event = eventFixture();
  event.workouts[0].hostRef = { routineId: 'host', workoutId: 'slot' };
  const host = { id: 'host', kind: 'strength', profileId: 'p', workouts: [{ id: 'slot', exercises: [], eventRef: { routineId: event.id, workoutId: event.workouts[0].id } }] };
  const normal = { id: 'normal', kind: 'strength', profileId: 'p', workouts: [{ id: 'normal-day', exercises: [], session: { status: 'inProgress', runningSince: null, elapsedSeconds: 30,
    exercises: [{ exerciseId: 'squat', sets: [{ id: 'set', status: 'completed', actualWeight: 300, actualReps: 5 }] }] } }] };
  event.workouts[0].session = { status: 'inProgress', elapsedSeconds: 0, runningSince: null, eventBlocks: [] };
  const profile = { id: 'p', activeWorkoutRoutineId: event.id };
  const plan = createImportPlan({ profiles: [profile], routines: [event, host, normal] }, [], []);
  expect(plan.routines[0].result.workouts[0].hostRef).toEqual(event.workouts[0].hostRef);
  expect(plan.routines[1].result.workouts[0].eventRef).toEqual(host.workouts[0].eventRef);
  expect(plan.routines[2].result.workouts[0].session).toEqual({ ...normal.workouts[0].session, status: 'paused' });
  expect(plan.profiles[0].result.activeWorkoutRoutineId).toBe(event.id);
});

describe('backup import planning', () => {
  it('preserves conflicting event plans as reviewed copies instead of shallow merging components', () => {
    const local = { id: 'e1', kind: 'strongman', inputs: { events: [{ id: 'local' }] }, workouts: [] };
    const imported = { ...local, inputs: { events: [{ id: 'incoming' }] }, unknown: true };
    const plan = createImportPlan({ profiles: [], routines: [imported] }, [], [local]);
    expect(plan.routines[0]).toMatchObject({ status: 'conflict', action: 'copy', local, imported });
    expect(plan.routines[0].result.id).not.toBe('e1');
    expect(plan.routines[0].result.inputs.events).toHaveLength(1);
    expect(plan.routines[0].result.unknown).toBe(true);
    expect(local.inputs.events[0].id).toBe('local');
  });

  it('remaps imported host links to conflict copies without redirecting the existing local host', () => {
    const originalEvent = { id: 'e1', kind: 'strongman', name: 'Local', inputs: { events: [{ id: 'event1' }] }, workouts: [{ id: 'ew1' }] };
    const incomingEvent = { ...originalEvent, name: 'Incoming' };
    const localHost = { id: 's1', kind: 'strength', workouts: [{ id: 'w1', eventRef: { routineId: 'e1', workoutId: 'ew1' } }] };
    const incomingHost = { ...localHost, workouts: [...localHost.workouts, { id: 'w2', eventRef: { routineId: 'e1', workoutId: 'ew1' } }] };
    const plan = createImportPlan({ profiles: [], routines: [incomingHost, incomingEvent] }, [], [localHost, originalEvent]);
    const importedEvent = plan.routines[1].result;
    const restoredHost = plan.routines[0].result;
    expect(restoredHost.workouts[0].eventRef).toEqual(localHost.workouts[0].eventRef);
    expect(restoredHost.workouts[1].eventRef).toEqual({ routineId: importedEvent.id, workoutId: importedEvent.workouts[0].id });
    expect(incomingHost.workouts[1].eventRef.routineId).toBe('e1');
  });
  const localProfiles = [{ id: 'p1', name: 'Alex', localOnly: true }];
  const localRoutines = [{
    id: 'r1', profileId: 'p1', name: 'Local plan', workouts: [{ id: 'w1', sequence: 1, completedAt: 'today' }],
  }];

  it('copies new records and skips exact duplicates', () => {
    const plan = createImportPlan({
      profiles: [{ ...localProfiles[0] }, { id: 'p2', name: 'Sam' }],
      routines: [],
      templates: [],
    }, localProfiles, localRoutines);

    expect(plan.profiles.map(item => [item.status, item.action])).toEqual([
      ['duplicate', 'skip'],
      ['new', 'copy'],
    ]);
    expect(importPlanSummary(plan)).toEqual({ copy: 1, skip: 1, merge: 0 });
  });

  it('treats records with differently ordered keys as duplicates', () => {
    const plan = createImportPlan({
      profiles: [{ name: 'Alex', localOnly: true, id: 'p1' }],
      routines: [],
      templates: [],
    }, localProfiles, localRoutines);

    expect(plan.profiles[0].action).toBe('skip');
  });

  it('merges conflicts without overwriting local fields or completed workouts', () => {
    const plan = createImportPlan({
      profiles: [{ id: 'p1', name: 'Backup Alex', importedOnly: true }],
      routines: [{
        id: 'r1', profileId: 'p1', name: 'Backup plan', workouts: [
          { id: 'w1', sequence: 1, completedAt: null },
          { id: 'w2', sequence: 2, completedAt: null },
        ],
      }],
      templates: [],
    }, localProfiles, localRoutines);

    expect(plan.profiles[0]).toMatchObject({ status: 'conflict', action: 'merge' });
    expect(plan.profiles[0].result).toEqual({ id: 'p1', name: 'Alex', importedOnly: true, localOnly: true });
    expect(plan.routines[0].result.name).toBe('Local plan');
    expect(plan.routines[0].result.workouts).toEqual([
      { id: 'w1', sequence: 1, completedAt: 'today' },
      { id: 'w2', sequence: 2, completedAt: null },
    ]);
    expect(recordsToSave(plan)).toHaveLength(2);
  });

  it('copies and merges reusable templates without overwriting local values', () => {
    const localTemplates = [{ id: 't1', name: 'Local name', inputs: { maxSquat: '315' } }];
    const plan = createImportPlan({ profiles: [], routines: [], templates: [
      { id: 't1', name: 'Backup name', inputs: { maxSquat: '300' }, importedOnly: true },
      { id: 't2', name: 'New template', inputs: {} },
    ] }, [], [], localTemplates);

    expect(plan.templates.map(item => [item.status, item.action])).toEqual([
      ['conflict', 'merge'],
      ['new', 'copy'],
    ]);
    expect(plan.templates[0].result).toEqual({
      id: 't1', name: 'Local name', inputs: { maxSquat: '315' }, importedOnly: true,
    });
  });
});
