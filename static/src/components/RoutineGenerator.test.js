import {
  getEffectiveMaxes,
  routineToCsv,
  routineToMarkdown,
} from '../data/routineGeneration';

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
});
