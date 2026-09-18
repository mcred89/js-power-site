import { getSetTimerElapsedMs, getSetTimerTiming, isValidSetTimerInterval } from './setTimer';

const start = '2026-09-18T12:00:00.000Z';
const at = seconds => Date.parse(start) + seconds * 1000;

describe('repeating set countdown', () => {
  const timer = { intervalMs: 60000, elapsedMs: 0, runningSince: start, exerciseId: 'squat' };

  it('counts down readiness, then repeats a full interval at each boundary', () => {
    expect(getSetTimerTiming(timer, at(0))).toEqual({ phase: 'ready', remainingMs: 10000 });
    expect(getSetTimerTiming(timer, at(9))).toEqual({ phase: 'ready', remainingMs: 1000 });
    expect(getSetTimerTiming(timer, at(10))).toEqual({ phase: 'interval', remainingMs: 60000 });
    expect(getSetTimerTiming(timer, at(69.9))).toEqual({ phase: 'interval', remainingMs: 100 });
    expect(getSetTimerTiming(timer, at(70))).toEqual({ phase: 'interval', remainingMs: 60000 });
    expect(getSetTimerTiming(timer, at(195))).toEqual({ phase: 'interval', remainingMs: 55000 });
  });

  it('holds the countdown while paused and resumes its remainder', () => {
    const paused = { ...timer, elapsedMs: getSetTimerElapsedMs(timer, at(35)), runningSince: null };
    expect(getSetTimerTiming(paused, at(300))).toEqual({ phase: 'interval', remainingMs: 35000 });
    const resumed = { ...paused, runningSince: new Date(at(300)).toISOString() };
    expect(getSetTimerTiming(resumed, at(310))).toEqual({ phase: 'interval', remainingMs: 25000 });
  });

  it('supports fractional minute intervals while requiring whole seconds and finite bounds', () => {
    [6000, 60000, 90000, 120000, 3600000].forEach(value => expect(isValidSetTimerInterval(value)).toBe(true));
    [0, 5999, 6500, 3601000, NaN, Infinity, '60000'].forEach(value => expect(isValidSetTimerInterval(value)).toBe(false));
    expect(getSetTimerElapsedMs({ elapsedMs: -20, runningSince: 'bad' }, at(10))).toBe(0);
    expect(getSetTimerElapsedMs(timer, at(-10))).toBe(0);
  });
});
