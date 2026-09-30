import { routineHistoryCsvRows } from './routineCsv';

it('exports dated strongman actuals and saved medley setup without inventing planned work', () => {
  const routine = {
    name: 'Meet prep',
    workouts: [{ id: 'day', name: 'Strongman', completedAt: '2026-09-30', exercises: [] }],
    strongmanLog: [{
      date: '2026-09-01', movement: 'Carry medley', scope: 'medley', workoutId: null,
      eventSnapshot: { name: 'Carry medley', components: [{ name: 'Sandbag', weight: 200 }] },
      notes: 'Full run', sets: [{ weight: '', reps: '', distance: 100, seconds: 42.3, successful: true }],
    }],
  };
  const rows = routineHistoryCsvRows(routine);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('"Distance (ft)","Event time (seconds)","Training date"');
  expect(rows[1]).toContain('"100","42.3","2026-09-01","medley"');
  expect(rows[1]).toContain('Sandbag');
  expect(rows[1]).toContain('Full run');
});
