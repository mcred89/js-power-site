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
});
