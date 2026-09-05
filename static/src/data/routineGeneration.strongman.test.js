import { buildRoutinePlan, routineToCsv, routineToMarkdown } from './routineGeneration';
import { visibleExercise } from './routines';
import { createRoutine, correctMaxes } from './routinePlanning';
import { duplicateRoutine, createRoutineTemplate } from './routineCopies';

const inputs = {
  maxSquat: '500', maxPress: '225', maxDead: '600', duration: '5 weeks',
  mainLiftChoice: 'Low', includeStrongmanDay: true,
  squatEventEnabled: true, squatEventMovement: 'Sandbag pick', squatEventSets: '4', squatEventReps: '2',
  pressEventEnabled: true, pressEventMovement: 'Axle clean', pressEventSets: '5', pressEventReps: '3',
  deadliftEventEnabled: true, deadliftEventMovement: 'Stone load', deadliftEventSets: '3', deadliftEventReps: '4',
};
const expected = { Squat: ['Sandbag pick', '4 × 2'], Press: ['Axle clean', '5 × 3'], Deadlift: ['Stone load', '3 × 4'] };

describe.each(['Low', 'High'])('%s normal-day event preservation', volume => {
  test.each(['3 weeks', '5 weeks'])('with %s and both dedicated-day settings', duration => {
    [false, true].forEach(includeStrongmanDay => {
      const settings = { ...inputs, duration, mainLiftChoice: volume, includeStrongmanDay };
      const weeks = buildRoutinePlan(settings)[0].weeks;
      weeks.flat().filter(day => expected[day.name]).forEach(day => {
        const [movement, prescription] = expected[day.name];
        expect(day.exercises).toContainEqual({ movement: `Strongman event: ${movement}`, weight: '', prescription });
      });
      expect(weeks.flat().filter(day => day.name === 'Deadlift')).toHaveLength(duration === '3 weeks' && includeStrongmanDay ? 3 : 5);
      expect(weeks.flat().filter(day => day.name === 'Strongman')).toHaveLength(includeStrongmanDay ? Number(duration[0]) : 0);
      if (duration === '3 weeks' && includeStrongmanDay) {
        expect(weeks.map(week => week.map(day => day.name))).toEqual([
          ['Squat', 'Press', 'Deadlift', 'Squat', 'Press', 'Strongman'],
          ['Squat', 'Press', 'Deadlift', 'Squat', 'Press', 'Strongman'],
          ['Squat', 'Press', 'Deadlift', 'Strongman'],
        ]);
      }
      Object.values(expected).forEach(([movement, prescription]) => {
        expect(routineToCsv(settings)).toContain(`Strongman event: ${movement}`);
        expect(routineToMarkdown(settings)).toContain(`Strongman event: ${movement} · ${prescription}`);
      });
    });
  });
});

test('normal-day prescriptions and overrides survive max corrections, copies and templates', () => {
  const routine = createRoutine('profile', 'Strength', inputs);
  const exercise = routine.workouts[0].exercises.find(item => item.generated.movement === 'Strongman event: Sandbag pick');
  exercise.overrides = { movement: 'My sandbag pick', weight: '200', prescription: '6 × 1' };
  const corrected = correctMaxes(routine, { maxSquat: '550', maxPress: '250', maxDead: '650' });
  const shown = visibleExercise(corrected.workouts[0].exercises.find(item => item.id === exercise.id));
  expect(shown).toEqual({ movement: 'My sandbag pick', weight: '200', prescription: '6 × 1' });
  const copied = duplicateRoutine(corrected, 'other', 'Copy');
  expect(visibleExercise(copied.workouts[0].exercises.find(item => item.generated.movement === exercise.generated.movement))).toEqual(shown);
  expect(createRoutineTemplate(corrected, 'Template').inputs).toMatchObject({ squatEventEnabled: true, pressEventEnabled: true, deadliftEventEnabled: true });
});
