import { DATA_TASKS, runDataTask, streamCsvChunks } from './dataTaskHandlers';
import { routineHistoryToCsv, routinePlanToCsv } from './routines';
import { exportBackup } from './storage';

const routine = {
  id: 'routine-1', name: 'Test, "plan"', workouts: [{
    id: 'workout-1', sequence: 1, cycleLabel: 1, weekLabel: 1, name: 'Squat',
    completedAt: null,
    exercises: [{ overrides: {}, generated: { movement: 'Squat', weight: 300, prescription: '3 × 5' } }],
  }],
};

describe('background data task handlers', () => {
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
