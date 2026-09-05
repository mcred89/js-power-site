import { DATA_TASKS, runDataTask, streamCsvChunks } from './dataTaskHandlers';
import { routineHistoryToCsv, routinePlanToCsv } from './routineCsv';
import { exportBackup } from './storageBackup';
import { createTransferPackage, openTransferPackage } from './transferPackage';

jest.mock('./transferPackage', () => ({ createTransferPackage: jest.fn(), openTransferPackage: jest.fn() }));

const routine = {
  id: 'routine-1', name: 'Test, "plan"', workouts: [{
    id: 'workout-1', sequence: 1, cycleLabel: 1, weekLabel: 1, name: 'Squat',
    completedAt: null,
    exercises: [{ overrides: {}, generated: { movement: 'Squat', weight: 300, prescription: '3 × 5' } }],
  }],
};

describe('background data task handlers', () => {
  it('serializes routine transfers with v2 and schema version 11', () => {
    const contents = runDataTask(DATA_TASKS.SERIALIZE_TRANSFER, {
      format: 'mcilroy-method-routine-transfer', version: 1, routine,
    });
    expect(JSON.parse(contents)).toMatchObject({ version: 2, schemaVersion: 11, routine: { kind: 'strength' } });
  });
  it('normalizes direct routine transfer creation before encrypting it', async () => {
    createTransferPackage.mockResolvedValue({ contents: 'encrypted' });
    await runDataTask(DATA_TASKS.CREATE_TRANSFER, { data: {
      format: 'mcilroy-method-routine-transfer', version: 1, routine,
    }, currentTime: 123, options: { compress: true } });
    expect(JSON.parse(createTransferPackage.mock.calls[0][0])).toMatchObject({ version: 2, schemaVersion: 11 });
    expect(createTransferPackage.mock.calls[0].slice(1)).toEqual([123, { compress: true }]);
  });
  it.each([1, 2])('opens version %i routine transfers through the worker path', async version => {
    openTransferPackage.mockResolvedValue(JSON.stringify({
      format: 'mcilroy-method-routine-transfer', version, ...(version === 2 ? { schemaVersion: 10 } : {}), routine,
    }));
    const opened = await runDataTask(DATA_TASKS.OPEN_TRANSFER_PLAN, { contents: 'encrypted', key: 'key', local: {} });
    expect(opened.routine).toMatchObject({ version: 2, schemaVersion: 11, routine: { kind: 'strength' } });
  });
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
