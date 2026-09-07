import { buildRoutinePlan, routineToCsv, routineToMarkdown } from './routineGeneration';
import {
  correctMaxes, createRoutine, createRoutineFromTemplate, setWorkoutComplete,
  updateExercise, visibleExercise,
} from './routines';
import { createRoutineTemplate, duplicateRoutine } from './routineCopies';

const inputs = {
  maxSquat: '315', maxPress: '185', maxDead: '405',
  duration: '5 weeks', mainLiftChoice: 'Low',
  pressWeakPoint: 'Triceps', deadliftWeakPoint: 'Back',
};
const tabata = {
  movement: 'Tabata sprints', weight: '',
  prescription: '8 rounds: 20 seconds sprint / 10 seconds rest',
};
const allFinishers = {
  squatTabataEnabled: true, pressTabataEnabled: true, deadliftTabataEnabled: true,
  squatEventEnabled: true, squatEventMovement: 'Yoke', squatEventSets: '3', squatEventReps: '1',
  pressEventEnabled: true, pressEventMovement: 'Log press', pressEventSets: '4', pressEventReps: '3',
  deadliftEventEnabled: true, deadliftEventMovement: 'Farmers carry', deadliftEventSets: '3', deadliftEventReps: '1',
};
const sessions = options => buildRoutinePlan({ ...inputs, ...options })
  .flatMap(cycle => cycle.weeks.flat());

it('leaves existing plans unchanged when Tabata is off or absent', () => {
  const legacy = sessions({});
  expect(sessions({ squatTabataEnabled: false, pressTabataEnabled: false, deadliftTabataEnabled: false })).toEqual(legacy);
  expect(legacy.flatMap(day => day.exercises).some(exercise => exercise.movement === 'Tabata sprints')).toBe(false);
});

it.each(['squat', 'press', 'deadlift'])('adds Tabata to only the selected %s days independently of strongman', key => {
  const plan = sessions({ [`${key}TabataEnabled`]: true });
  plan.forEach(day => {
    const selected = day.name.toLowerCase() === key;
    expect(day.exercises.filter(exercise => exercise.movement === 'Tabata sprints')).toHaveLength(selected ? 1 : 0);
    if (selected) expect(day.exercises[day.exercises.length - 1]).toEqual(tabata);
  });
});

it.each([
  ['3 weeks', 'Low'], ['3 weeks', 'High'], ['5 weeks', 'Low'], ['5 weeks', 'High'],
])('keeps Tabata last with back-off sets, accessories and events in %s %s plans', (duration, mainLiftChoice) => {
  const options = { duration, mainLiftChoice, includeBackoffSets: true, includeStrongmanDay: true };
  const withoutTabata = sessions({ ...options, ...allFinishers, squatTabataEnabled: false, pressTabataEnabled: false, deadliftTabataEnabled: false });
  const withTabata = sessions({ ...options, ...allFinishers });
  withTabata.forEach((day, index) => {
    expect(day.exercises).toEqual(day.name === 'Strongman'
      ? withoutTabata[index].exercises
      : [...withoutTabata[index].exercises, tabata]);
    if (day.name !== 'Strongman') {
      expect(day.exercises[day.exercises.length - 2].movement).toMatch(/^Strongman event:/);
    }
  });
});

it('retains the selected finishers through every chained microcycle', () => {
  const plan = buildRoutinePlan({
    ...inputs, ...allFinishers, mesoMode: true, includeStrongmanDay: true,
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' }],
  });
  plan.forEach(cycle => cycle.weeks.flat().filter(day => day.name !== 'Strongman').forEach(day => {
    expect(day.exercises[day.exercises.length - 1]).toEqual(tabata);
  }));
});

it('exports Tabata after accessories and strongman in CSV and Markdown', () => {
  const options = { ...inputs, ...allFinishers };
  const csv = routineToCsv(options).split('\n').filter(row => row.startsWith('"1","1","2","Press",'));
  expect(csv.slice(-3)).toEqual([
    '"1","1","2","Press","Curls","","3 × 5–20"',
    '"1","1","2","Press","Strongman event: Log press","","4 × 3"',
    '"1","1","2","Press","Tabata sprints","","8 rounds: 20 seconds sprint / 10 seconds rest"',
  ]);
  expect(routineToMarkdown(options)).toContain(
    '- Curls · 3 × 5–20\n- Strongman event: Log press · 4 × 3\n- Tabata sprints · 8 rounds: 20 seconds sprint / 10 seconds rest\n\n#### Day 3: Deadlift',
  );
});

it('preserves Tabata order, completed snapshots and manual overrides when correcting maxes', () => {
  let routine = createRoutine('profile', 'Finishers', { ...inputs, ...allFinishers });
  routine = setWorkoutComplete(routine, routine.workouts[0].id, true);
  const future = routine.workouts[1];
  const finisher = future.exercises[future.exercises.length - 1];
  routine = updateExercise(routine, future.id, finisher.id, { prescription: '6 rounds: 20 seconds sprint / 10 seconds rest' });
  const updated = correctMaxes(routine, { maxSquat: '350', maxPress: '200', maxDead: '450' });
  expect(updated.workouts[0]).toBe(routine.workouts[0]);
  updated.workouts.slice(1).forEach(workout => {
    expect(workout.exercises[workout.exercises.length - 1].generated).toEqual(tabata);
  });
  const last = updated.workouts[1].exercises[updated.workouts[1].exercises.length - 1];
  expect(last.id).toBe(finisher.id);
  expect(visibleExercise(last).prescription).toBe('6 rounds: 20 seconds sprint / 10 seconds rest');
});

it('preserves independent Tabata selections and ordering in copies and templates', () => {
  const routine = createRoutine('profile', 'Finishers', { ...inputs, ...allFinishers, deadliftTabataEnabled: false });
  const copy = duplicateRoutine(routine, 'other', 'Copy');
  const template = createRoutineTemplate(routine, 'Finisher setup');
  const regenerated = createRoutineFromTemplate(template, 'other', 'Next plan');
  [copy, regenerated].forEach(plan => {
    expect(plan.inputs).toMatchObject({ squatTabataEnabled: true, pressTabataEnabled: true, deadliftTabataEnabled: false });
    expect(plan.workouts.map(workout => workout.exercises.map(visibleExercise)))
      .toEqual(routine.workouts.map(workout => workout.exercises.map(visibleExercise)));
  });
});
