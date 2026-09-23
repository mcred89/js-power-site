import { TABATA_PRESCRIPTION } from './tabata';

const percentages = {
  Low: [{ percent: .65, reps: '4 × 6' }, { percent: .7, reps: '4 × 5' }, { percent: .75, reps: '4 × 4' }, { percent: .8, reps: '4 × 3' }, { percent: .85, reps: '4 × 2' }],
  High: [{ percent: .55, reps: '5 × 10' }, { percent: .6, reps: '5 × 9' }, { percent: .65, reps: '5 × 8' }, { percent: .7, reps: '5 × 7' }, { percent: .75, reps: '5 × 6' }],
};

const days = [
  { lift: 'Squat', max: 'maxSquat', eventKey: 'squat' },
  { lift: 'Press', max: 'maxPress', eventKey: 'press' },
  { lift: 'Deadlift', max: 'maxDead', eventKey: 'deadlift' },
];

const roundToFive = value => Math.ceil(value / 5) * 5;
const backoffSets = [
  { reduction: .1, maxPercent: .6, reps: 8 },
  { reduction: .2, maxPercent: .5, reps: 12 },
  { reduction: .3, maxPercent: .4, reps: 15 },
];
const accessoryMovements = {
  Press: {
    Shoulders: 'Dumbbell overhead press',
    Triceps: 'Tricep extensions',
  },
  Deadlift: {
    Back: 'Bent over rows',
    Glutes: 'Hip thrusters',
    Hamstrings: 'Romanian deadlifts',
  },
};
const getWeekGroups = duration => duration === '3 weeks'
  ? [[0, 1], [2, 3], [4]]
  : [[0], [1], [2], [3], [4]];

export const MAX_PROGRESSION_MODES = {
  SAME: 'same',
  FIXED: 'fixed',
  ADAPTIVE: 'adaptive',
};

export const getLiftProgressionMode = (inputs, liftKey) => (
  inputs.liftProgressionModes?.[liftKey] || inputs.maxProgressionMode || MAX_PROGRESSION_MODES.FIXED
);

export const hasAdaptiveProgression = inputs => days.some(day => (
  getLiftProgressionMode(inputs, day.eventKey) === MAX_PROGRESSION_MODES.ADAPTIVE
));

export const getEffectiveMaxes = (props, cycleIndex) => {
  return days.reduce((maxes, day) => {
    const fixed = getLiftProgressionMode(props, day.eventKey) === MAX_PROGRESSION_MODES.FIXED;
    const increment = fixed ? (Number(props[`${day.eventKey}Increment`]) || 0) * cycleIndex : 0;
    return { ...maxes, [day.max]: Number(props[day.max]) + increment };
  }, {});
};

const getSessions = (weekIndexes, includeStrongmanDay, duration) => {
  const sessions = weekIndexes.flatMap((sourceWeek, cycleIndex) => days.map(day => ({ ...day, sourceWeek, cycleIndex })));
  if (!includeStrongmanDay) return sessions;
  if (duration === '3 weeks') {
    const scheduled = sessions.map(session => session.cycleIndex === 1 && session.lift === 'Deadlift'
      ? { lift: 'Strongman', isStrongman: true }
      : session);
    return weekIndexes.length > 1 ? scheduled : [...scheduled, { lift: 'Strongman', isStrongman: true }];
  }
  return [...sessions, { lift: 'Strongman', isStrongman: true }];
};

const getExercises = (day, props) => {
  if (day.isStrongman) return [{ movement: 'Strongman day', weight: '', prescription: '' }];
  const prescription = percentages[props.mainLiftChoice][day.sourceWeek];
  const exercises = [{
    movement: day.lift,
    weight: roundToFive(props[day.max] * prescription.percent),
    prescription: prescription.reps,
  }];
  if (props.mainLiftChoice === 'Low' && props.includeBackoffSets) {
    backoffSets.forEach(backoff => exercises.push({
      movement: `${day.lift} back-off`,
      weight: roundToFive(props[day.max] * Math.min(prescription.percent - backoff.reduction, backoff.maxPercent)),
      prescription: `1 × ${backoff.reps}`,
    }));
  }
  const weakPoint = props[`${day.eventKey}WeakPoint`];
  const accessoryMovement = accessoryMovements[day.lift]?.[weakPoint];
  if (accessoryMovement) exercises.push({ movement: accessoryMovement, weight: 0, prescription: '3 × 5–20' });
  if (day.lift === 'Press') exercises.push({ movement: 'Curls', weight: '', prescription: '3 × 5–20' });
  if (props[`${day.eventKey}EventEnabled`]) exercises.push({
    movement: `Strongman event: ${props[`${day.eventKey}EventMovement`]}`,
    weight: '',
    prescription: `${props[`${day.eventKey}EventSets`]} × ${props[`${day.eventKey}EventReps`]}`,
  });
  // Finishers must follow every main lift, back-off set, accessory, and event.
  if (props[`${day.eventKey}TabataEnabled`]) exercises.push({
    movement: 'Tabata sprints',
    weight: '',
    prescription: TABATA_PRESCRIPTION,
  });
  return exercises;
};

// This module must stay React-free: tracker persistence imports it while calculator
// presentation is lazy. Importing UI here would pull the website graph into standalone.
export const buildRoutinePlan = (props, resolvedCycleMaxes = []) => {
  const cycles = props.mesoMode ? props.microCycles : [{ duration: props.duration, volume: props.mainLiftChoice }];
  return cycles.map((cycle, cycleIndex) => {
    const effectiveMaxes = resolvedCycleMaxes[cycleIndex] || getEffectiveMaxes(props, cycleIndex);
    const routineProps = { ...props, ...effectiveMaxes, mainLiftChoice: cycle.volume, duration: cycle.duration };
    const weeks = getWeekGroups(cycle.duration).map(weekIndexes => (
      getSessions(weekIndexes, props.includeStrongmanDay, cycle.duration).map((day, dayIndex) => ({
        name: day.lift,
        dayNumber: dayIndex + 1,
        exercises: getExercises(day, routineProps),
      }))
    ));
    return { ...cycle, effectiveMaxes, routineProps, weeks };
  });
};
