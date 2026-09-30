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

it('exports actual height and points independently of targets and aligns every history row', () => {
  const routine = {
    name: 'Scoring prep',
    workouts: [
      { id: 'legacy', name: 'Deadlift', completedAt: '2026-09-01', exercises: [{ overrides: {}, generated: { movement: 'Deadlift', weight: 400, prescription: '5 reps' } }] },
      { id: 'tracked', name: 'Press', completedAt: '2026-09-02', exercises: [], session: { exercises: [{ movement: 'Press', sets: [{ number: 1, status: 'completed', actualWeight: 200, actualReps: 5 }] }] } },
    ],
    strongmanLog: [{ date: '2026-09-03', movement: 'Scored event', scope: 'movement',
      eventSnapshot: { height: 180, points: 100 }, notes: '',
      sets: [{ height: 156.5, points: 12.5 }, { height: 0, points: 0, successful: false }],
    }],
  };
  // Split on CSV delimiters outside quoted cells, including JSON setup cells.
  const cells = row => row.match(/"(?:[^"]|"")*"/g);
  const rows = routineHistoryCsvRows(routine).map(cells);
  expect(rows).toHaveLength(5);
  expect(rows.every(row => row.length === rows[0].length)).toBe(true);
  expect(rows[0].slice(-2)).toEqual(['"Actual height (in)"', '"Actual points"']);
  expect(rows[1].slice(-2)).toEqual(['""', '""']);
  expect(rows[2].slice(-2)).toEqual(['""', '""']);
  expect(rows[3].slice(-2)).toEqual(['"156.5"', '"12.5"']);
  expect(rows[4].slice(-2)).toEqual(['"0"', '"0"']);
});
