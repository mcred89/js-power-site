import { getEffectiveMaxes, getLiftProgressionMode, hasAdaptiveProgression } from '../data/routineGeneration';
import { routineToCsv, routineToMarkdown } from '../data/routineExports';

describe('mesocycle max progression', () => {
  const plan = {
    maxSquat: '500',
    maxPress: '225',
    maxDead: '600',
    squatIncrement: '10',
    pressIncrement: '5',
    deadliftIncrement: '15',
  };

  it('uses the entered maxes for the first microcycle', () => {
    expect(getEffectiveMaxes(plan, 0)).toEqual({
      maxSquat: 500,
      maxPress: 225,
      maxDead: 600,
    });
  });

  it('adds each lift increment once per completed microcycle', () => {
    expect(getEffectiveMaxes(plan, 2)).toEqual({
      maxSquat: 520,
      maxPress: 235,
      maxDead: 630,
    });
  });

  it('keeps maxes unchanged for same and projected adaptive progression', () => {
    expect(getEffectiveMaxes({ ...plan, maxProgressionMode: 'same' }, 2)).toEqual({
      maxSquat: 500, maxPress: 225, maxDead: 600,
    });
    expect(getEffectiveMaxes({ ...plan, maxProgressionMode: 'adaptive' }, 2)).toEqual({
      maxSquat: 500, maxPress: 225, maxDead: 600,
    });
  });

  it('defaults every lift to the shared strategy and allows individual overrides', () => {
    expect(getLiftProgressionMode(plan, 'squat')).toBe('fixed');
    const mixed = {
      ...plan,
      maxProgressionMode: 'adaptive',
      deadliftIncrement: '25',
      liftProgressionModes: { press: 'same', deadlift: 'fixed' },
    };
    expect(getLiftProgressionMode(mixed, 'squat')).toBe('adaptive');
    expect(getEffectiveMaxes(mixed, 2)).toEqual({ maxSquat: 500, maxPress: 225, maxDead: 650 });
    expect(hasAdaptiveProgression(mixed)).toBe(true);
  });

  it('detects adaptive overrides independently of the shared strategy', () => {
    expect(hasAdaptiveProgression({ ...plan, liftProgressionModes: { squat: 'adaptive' } })).toBe(true);
    expect(hasAdaptiveProgression({
      ...plan,
      maxProgressionMode: 'adaptive',
      liftProgressionModes: { squat: 'same', press: 'same', deadlift: 'fixed' },
    })).toBe(false);
  });
});

describe('routine exports', () => {
  const routine = {
    maxSquat: '500',
    maxPress: '225',
    maxDead: '600',
    duration: '5 weeks',
    mainLiftChoice: 'Low',
    mesoMode: false,
    includeBackoffSets: false,
    includeStrongmanDay: false,
    pressWeakPoint: 'Shoulders',
    deadliftWeakPoint: 'Hamstrings',
  };

  it('creates a CSV row for each prescribed movement', () => {
    const csv = routineToCsv(routine);

    expect(csv).toContain('"Microcycle","Week","Day","Session","Movement","Weight (lb)","Prescription"');
    expect(csv).toContain('"1","1","1","Squat","Squat","325","4 × 6"');
    expect(csv).toContain('"1","1","2","Press","Curls","","3 × 5–20"');
    expect(csv).toContain('"1","1","2","Press","Dumbbell overhead press","0","3 × 5–20"');
    expect(csv).toContain('"1","1","3","Deadlift","Romanian deadlifts","0","3 × 5–20"');
    expect(csv).not.toContain('"Squat","Accessory');
  });

  it('creates structured Markdown with weeks, days, and movements', () => {
    const markdown = routineToMarkdown(routine);

    expect(markdown).toContain('## 5 weeks, Low volume');
    expect(markdown).toContain('### Week 1');
    expect(markdown).toContain('#### Day 1: Squat');
    expect(markdown).toContain('- Squat: 325 lb · 4 × 6');
  });

  it('labels only adaptive lift maxes as projected in mixed-strategy exports', () => {
    const markdown = routineToMarkdown({
      ...routine,
      mesoMode: true,
      microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '3 weeks', volume: 'Low' }],
      maxProgressionMode: 'adaptive',
      liftProgressionModes: { deadlift: 'fixed', press: 'same' },
      deadliftIncrement: '25',
    });

    expect(markdown).toContain('Maxes: Squat 500 lb · Press 225 lb · Deadlift 600 lb');
    expect(markdown).toContain('Maxes: Squat 500 lb (projected; updates from completed sets) · Press 225 lb · Deadlift 625 lb');
    expect(markdown).not.toContain('Press 225 lb (projected');
    expect(markdown).not.toContain('Deadlift 625 lb (projected');
  });
});
