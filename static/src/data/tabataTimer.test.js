import {
  getTabataElapsedMs,
  getTabataSchedule,
  getTabataTiming,
} from './tabataTimer';

describe('Tabata interval clock', () => {
  test.each([
    [0, 'warmup', 1, 60000],
    [59999, 'warmup', 1, 1],
    [60000, 'sprint', 1, 20000],
    [79999, 'sprint', 1, 1],
    [80000, 'rest', 1, 10000],
    [89999, 'rest', 1, 1],
    [90000, 'sprint', 2, 20000],
    [260000, 'rest', 7, 10000],
    [270000, 'sprint', 8, 20000],
    [289999, 'sprint', 8, 1],
    [290000, 'complete', 8, 0],
  ])('elapsed %i selects %s %i with %i ms left', (elapsed, phase, sprint, left) => {
    expect(getTabataTiming(8, elapsed)).toEqual({
      phase,
      sprintNumber: sprint,
      phaseRemainingMs: left,
      totalElapsedMs: elapsed,
      totalDurationMs: 290000,
    });
  });

  test('one sprint still gets exactly a minute warmup and no trailing rest', () => {
    expect(getTabataSchedule(1)).toEqual([
      { phase: 'warmup', sprintNumber: 1, startMs: 0, endMs: 60000 },
      { phase: 'sprint', sprintNumber: 1, startMs: 60000, endMs: 80000 },
      { phase: 'complete', sprintNumber: 1, startMs: 80000, endMs: 80000 },
    ]);
  });

  test('all sprints and rests join without gaps and finish after the final sprint', () => {
    const schedule = getTabataSchedule(8);
    expect(schedule.filter(item => item.phase === 'sprint')).toHaveLength(8);
    expect(schedule.filter(item => item.phase === 'rest')).toHaveLength(7);
    expect(schedule.filter(item => item.phase === 'warmup')).toHaveLength(1);
    schedule.slice(1).forEach((phase, index) => {
      expect(phase.startMs).toBe(schedule[index].endMs);
    });
    expect(schedule[schedule.length - 2].phase).toBe('sprint');
    expect(schedule[schedule.length - 1].phase).toBe('complete');
  });

  test('delayed rendering jumps directly to the correct phase and clamps at completion', () => {
    expect(getTabataTiming(8, 205250)).toMatchObject({
      phase: 'rest',
      sprintNumber: 5,
      phaseRemainingMs: 4750,
      totalElapsedMs: 205250,
    });
    expect(getTabataTiming(8, 360000)).toMatchObject({
      phase: 'complete',
      phaseRemainingMs: 0,
      totalElapsedMs: 290000,
    });
  });

  test.each([-1, NaN, Infinity, undefined])('invalid elapsed %s starts at warmup', elapsed => {
    expect(getTabataTiming(8, elapsed)).toMatchObject({ phase: 'warmup', totalElapsedMs: 0 });
  });

  test.each([0, -1, 0.5, 101, NaN, undefined])('invalid round count %s has no runnable intervals', count => {
    expect(getTabataTiming(count, 0)).toEqual({
      phase: 'complete',
      sprintNumber: 0,
      phaseRemainingMs: 0,
      totalElapsedMs: 0,
      totalDurationMs: 0,
    });
  });
});

describe('Tabata running timestamp', () => {
  const started = '2026-09-07T12:00:00.000Z';
  const startMs = Date.parse(started);

  test('running elapsed includes the saved time and real time since resume', () => {
    const timer = { elapsedMs: 45000, runningSince: started };
    expect(getTabataElapsedMs(timer, startMs + 90000)).toBe(135000);
    expect(timer).toEqual({ elapsedMs: 45000, runningSince: started });
  });

  test('paused and unstarted clocks do not advance', () => {
    expect(getTabataElapsedMs({ elapsedMs: 72000, runningSince: null }, startMs + 999999)).toBe(72000);
    expect(getTabataElapsedMs(null, startMs)).toBe(0);
  });

  test('clock corrections and invalid timestamps never subtract saved elapsed', () => {
    expect(getTabataElapsedMs({ elapsedMs: 5000, runningSince: started }, startMs - 1000)).toBe(5000);
    expect(getTabataElapsedMs({ elapsedMs: 5000, runningSince: 'invalid' }, startMs)).toBe(5000);
    expect(getTabataElapsedMs({ elapsedMs: NaN, runningSince: null }, startMs)).toBe(0);
  });
});
