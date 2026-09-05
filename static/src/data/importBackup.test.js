import { createImportPlan, importPlanSummary, recordsToSave } from './importBackup';

describe('backup import planning', () => {
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

  it('preserves conflicting retired blocks as separate opaque archives', () => {
    const archived = {
      id: 'routines:event-1', store: 'routines', extension: { source: 'backup' },
      record: {
        id: 'event-1', profileId: 'p1', kind: 'strongman', name: 'Show prep',
        events: [{ id: 'event', attempts: [{ load: 300, unknown: true }] }],
        workouts: [{ id: 'session', completedAt: 'yesterday' }],
      },
    };
    const local = { ...archived, record: { ...archived.record, name: 'Local prep' } };
    const backup = { profiles: [], routines: [], templates: [], archives: [archived] };
    const unchanged = JSON.parse(JSON.stringify({ backup, local }));
    const plan = createImportPlan(backup, [], [], [], [local]);

    expect(plan.archives[0]).toMatchObject({ type: 'archive', status: 'conflict', action: 'copy', imported: archived, local });
    expect(plan.archives[0].result.id).not.toBe(archived.id);
    expect({ ...plan.archives[0].result, id: archived.id }).toEqual(archived);
    expect(recordsToSave(plan)).toEqual([plan.archives[0].result]);
    expect(importPlanSummary(plan)).toEqual({ copy: 1, skip: 0, merge: 0 });
    expect({ backup, local }).toEqual(unchanged);
  });

  it('skips identical archives and avoids IDs already used by incoming or local records', () => {
    const archived = { id: 'routines:event-1', store: 'routines', record: { id: 'event-1', kind: 'strongman' } };
    const occupied = { ...archived, id: `${archived.id}:imported-copy`, record: { ...archived.record, name: 'Other copy' } };
    const backup = { profiles: [], routines: [], templates: [], archives: [archived, occupied] };
    const plan = createImportPlan(backup, [], [], [], [
      { ...archived, record: { ...archived.record, name: 'Local' } }, occupied,
    ]);

    expect(plan.archives[0].action).toBe('copy');
    expect(plan.archives[0].result.id).not.toBe(archived.id);
    expect(plan.archives[0].result.id).not.toBe(occupied.id);
    expect(plan.archives[1].action).toBe('skip');
  });

  it('reuses an existing identical conflict copy when importing the same archive again', () => {
    const archived = { id: 'routines:event-1', store: 'routines', record: { id: 'event-1', kind: 'strongman', name: 'Imported' } };
    const local = { ...archived, record: { ...archived.record, name: 'Local' } };
    const backup = { profiles: [], routines: [], templates: [], archives: [archived] };
    const first = createImportPlan(backup, [], [], [], [local]).archives[0].result;
    const repeated = createImportPlan(backup, [], [], [], [local, first]);

    expect(repeated.archives[0]).toMatchObject({
      type: 'archive', action: 'skip', imported: archived, local, existingResult: first, result: first,
    });
    expect(recordsToSave(repeated)).toEqual([]);
    expect(importPlanSummary(repeated)).toEqual({ copy: 0, skip: 1, merge: 0 });
  });

  it('archives retired records supplied directly to planning before they can merge with strength work', () => {
    const retired = { id: 'r1', kind: 'strongman', profileId: 'p1', workouts: [{ id: 'event-day' }] };
    const plan = createImportPlan({ profiles: [], routines: [retired], templates: [] }, [], localRoutines);

    expect(plan.routines).toEqual([]);
    expect(plan.archives[0]).toMatchObject({ action: 'copy', result: { store: 'routines', record: retired } });
    expect(recordsToSave(plan)).toEqual([plan.archives[0].result]);
  });

  it('copies a routine owned by another profile and remaps only incoming profile pointers', () => {
    const imported = {
      id: 'r1', profileId: 'p2', name: 'Sam plan', extra: { retained: true },
      workouts: [{ id: 'w1', session: { status: 'inProgress', elapsedSeconds: 20 } }],
    };
    const incomingProfile = { id: 'p2', name: 'Sam', activeRoutineId: 'r1', activeWorkoutRoutineId: 'r1' };
    const backup = { profiles: [incomingProfile], routines: [imported] };
    const before = JSON.stringify(backup);
    const plan = createImportPlan(backup, localProfiles, localRoutines);
    const copied = plan.routines[0].result;

    expect(plan.routines[0]).toMatchObject({ type: 'routine', status: 'conflict', action: 'copy', local: localRoutines[0] });
    expect(copied.id).not.toBe(imported.id);
    expect({ ...copied, id: imported.id }).toEqual(imported);
    expect(plan.profiles[0].result).toEqual({ ...incomingProfile, activeRoutineId: copied.id, activeWorkoutRoutineId: copied.id });
    expect(plan.profiles[0].imported).toEqual(incomingProfile);
    expect(JSON.stringify(backup)).toBe(before);

    const repeated = createImportPlan(backup, [...localProfiles, plan.profiles[0].result], [...localRoutines, copied]);
    expect(repeated.routines[0]).toMatchObject({ action: 'skip', existingResult: copied, result: copied });
  });

  it('clears imported active-workout pointers when the local completed snapshot wins the merge', () => {
    const plan = createImportPlan({
      profiles: [{ id: 'p1', activeRoutineId: 'r1', activeWorkoutRoutineId: 'r1' }],
      routines: [{ id: 'r1', profileId: 'p1', workouts: [{ id: 'w1', session: { status: 'inProgress' } }] }],
    }, localProfiles, localRoutines);

    expect(plan.routines[0].result.workouts).toEqual(localRoutines[0].workouts);
    expect(plan.profiles[0].result).toMatchObject({ activeRoutineId: 'r1', activeWorkoutRoutineId: null });
  });

  it('updates an existing profile when a routine-only import adds its resumable session', () => {
    const profile = { ...localProfiles[0], activeRoutineId: 'r1', activeWorkoutRoutineId: null };
    const imported = { id: 'r2', profileId: 'p1', workouts: [{ id: 'w2', session: { status: 'inProgress' } }] };
    const plan = createImportPlan({ profiles: [], routines: [imported] }, [profile], localRoutines);

    expect(plan.profiles).toEqual([expect.objectContaining({
      action: 'merge', local: profile, imported: profile,
      result: { ...profile, activeWorkoutRoutineId: imported.id },
    })]);
  });
});
