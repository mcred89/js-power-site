import { DATA_TASKS, runDataTask, streamCsvChunks } from './dataTaskHandlers';
import { routineHistoryToCsv, routinePlanToCsv } from './routineCsv';
import { exportBackup } from './storageBackup';
import { openTransferPackage } from './transferPackage';

jest.mock('./transferPackage', () => ({
  ...jest.requireActual('./transferPackage'),
  openTransferPackage: jest.fn(),
}));

const routine = {
  id: 'routine-1', name: 'Test, "plan"', workouts: [{
    id: 'workout-1', sequence: 1, cycleLabel: 1, weekLabel: 1, name: 'Squat',
    completedAt: null,
    exercises: [{ overrides: {}, generated: { movement: 'Squat', weight: 300, prescription: '3 × 5' } }],
  }],
};

describe('background data task handlers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('classifies full backups and legacy transfers through the one restore action', () => {
    const backup = exportBackup([], [], []);
    expect(runDataTask(DATA_TASKS.READ_IMPORT_FILE, { contents: backup }).backup.profiles).toEqual([]);
    expect(runDataTask(DATA_TASKS.READ_IMPORT_FILE, { contents: JSON.stringify({
      format: 'mcilroy-method-shared-transfer', version: 1, key: 'key', package: { ciphertext: 'ciphertext' },
    }) })).toEqual({ transfer: { key: 'key', contents: '{"ciphertext":"ciphertext"}' } });
    expect(runDataTask(DATA_TASKS.READ_IMPORT_FILE, { contents: '{"format":"mcilroy-method-encrypted-transfer"}' })).toEqual({ locked: true });
    expect(() => runDataTask(DATA_TASKS.READ_IMPORT_FILE, { contents: '{}' })).toThrow();
  });
  it('produces byte-identical pretty backups', () => {
    const payload = { profiles: [{ id: 'p1' }], routines: [routine], templates: [] };
    const generated = runDataTask(DATA_TASKS.SERIALIZE_BACKUP, payload);
    const expected = exportBackup(payload.profiles, payload.routines, payload.templates);
    expect({ ...JSON.parse(generated), exportedAt: null })
      .toEqual({ ...JSON.parse(expected), exportedAt: null });
    expect(generated).toBe(JSON.stringify(JSON.parse(generated), null, 2));
  });

  it('preserves archived records through backup serialization and import planning', () => {
    const archived = { id: 'routines:event-1', store: 'routines', record: { id: 'event-1', kind: 'strongman' } };
    const payload = { profiles: [], routines: [], templates: [], archives: [archived] };
    const contents = runDataTask(DATA_TASKS.SERIALIZE_BACKUP, payload);
    const backup = runDataTask(DATA_TASKS.PARSE_BACKUP, { contents });
    expect(backup.archives).toEqual([archived]);
    const plan = runDataTask(DATA_TASKS.PLAN_IMPORT, { backup, ...payload });
    expect(plan.archives[0]).toMatchObject({ action: 'skip', result: archived });
  });

  it.each([1, 2])('opens version %i strength routine transfers, including deployed schema 11', async version => {
    const payload = {
      format: 'mcilroy-method-routine-transfer', version,
      ...(version === 2 ? { schemaVersion: 11 } : {}),
      profileName: 'Alex', routine: { ...routine, kind: 'strength' },
    };
    openTransferPackage.mockResolvedValue(JSON.stringify(payload));
    const opened = await runDataTask(DATA_TASKS.OPEN_TRANSFER_PLAN, { contents: 'encrypted', key: 'key', local: {} });
    expect(opened.routine).toMatchObject({ profileName: 'Alex', routine: { id: routine.id, kind: 'strength' } });
    expect(opened.routine.routine.workouts[0].exercises).toEqual(routine.workouts[0].exercises);
  });

  it.each([
    { version: 1, routine: { id: 'event', kind: 'strongman' } },
    { version: 2, schemaVersion: 11, routine: { id: 'event', kind: 'strongman' } },
  ])('clearly rejects retired standalone strongman transfers ($version)', async payload => {
    openTransferPackage.mockResolvedValue(JSON.stringify({ format: 'mcilroy-method-routine-transfer', ...payload }));
    await expect(runDataTask(DATA_TASKS.OPEN_TRANSFER_PLAN, { local: {} })).rejects.toThrow('Strongman blocks are no longer supported');
  });

  it.each([
    { version: 3, routine },
    { version: 2, schemaVersion: 99, routine },
    { version: 2, routine },
    { version: 1, routine: [] },
  ])('rejects invalid or future routine transfers', async payload => {
    openTransferPackage.mockResolvedValue(JSON.stringify({ format: 'mcilroy-method-routine-transfer', ...payload }));
    await expect(runDataTask(DATA_TASKS.OPEN_TRANSFER_PLAN, { local: {} })).rejects.toThrow('supported routine transfer');
  });

  it('checks existing archives when opening an encrypted full backup', async () => {
    const archived = { id: 'routines:event-1', store: 'routines', record: { id: 'event-1', kind: 'strongman' } };
    const local = { profiles: [], routines: [], templates: [], archives: [archived] };
    openTransferPackage.mockResolvedValue(exportBackup([], [], [], [archived]));
    const opened = await runDataTask(DATA_TASKS.OPEN_TRANSFER_PLAN, { local });
    expect(opened.plan.archives[0]).toMatchObject({ action: 'skip', result: archived });
  });

  it('produces bounded chunks with byte-identical CSV output', () => {
    const plan = runDataTask(DATA_TASKS.PLAN_CSV, { routine, chunkSize: 17 });
    const history = runDataTask(DATA_TASKS.HISTORY_CSV, { routine, chunkSize: 17 });
    expect(plan.every(chunk => chunk.length <= 17)).toBe(true);
    expect(plan.join('')).toBe(routinePlanToCsv(routine));
    expect(history.join('')).toBe(routineHistoryToCsv(routine));
  });

  it('emits bounded CSV before requesting every source row', () => {
    const events = [];
    function* rows() {
      events.push('first'); yield '12345';
      events.push('second'); yield '67890';
    }
    streamCsvChunks(rows(), chunk => events.push(`chunk:${chunk}`), 5);
    expect(events).toEqual(['first', 'chunk:12345', 'second', 'chunk:\n6789', 'chunk:0']);
  });

  it('rejects unknown typed tasks', () => {
    expect(() => runDataTask('not-a-task', {})).toThrow('Unknown data task');
  });
});
