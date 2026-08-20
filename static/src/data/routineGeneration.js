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
const getWeekGroups = duration => duration === '3 weeks'
  ? [[0, 1], [2, 3], [4]]
  : [[0], [1], [2], [3], [4]];

export const getEffectiveMaxes = (props, cycleIndex) => ({
  maxSquat: Number(props.maxSquat) + (Number(props.squatIncrement) || 0) * cycleIndex,
  maxPress: Number(props.maxPress) + (Number(props.pressIncrement) || 0) * cycleIndex,
  maxDead: Number(props.maxDead) + (Number(props.deadliftIncrement) || 0) * cycleIndex,
});

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
  if (day.lift !== 'Squat') exercises.push({ movement: 'Accessory Movement', weight: '', prescription: '3 × 5–20' });
  if (day.lift === 'Press') exercises.push({ movement: 'Curls', weight: '', prescription: '3 × 5–20' });
  if (props[`${day.eventKey}EventEnabled`]) exercises.push({
    movement: `Strongman event: ${props[`${day.eventKey}EventMovement`]}`,
    weight: '',
    prescription: `${props[`${day.eventKey}EventSets`]} × ${props[`${day.eventKey}EventReps`]}`,
  });
  return exercises;
};

// This module must stay React-free: tracker persistence imports it while calculator
// presentation is lazy. Importing UI here would pull the website graph into standalone.
export const buildRoutinePlan = props => {
  const cycles = props.mesoMode ? props.microCycles : [{ duration: props.duration, volume: props.mainLiftChoice }];
  return cycles.map((cycle, cycleIndex) => {
    const effectiveMaxes = getEffectiveMaxes(props, cycleIndex);
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

const escapeCsv = value => `"${String(value).replace(/"/g, '""')}"`;
export const routineToCsv = props => {
  const rows = [['Microcycle', 'Week', 'Day', 'Session', 'Movement', 'Weight (lb)', 'Prescription']];
  buildRoutinePlan(props).forEach((cycle, cycleIndex) => cycle.weeks.forEach((week, weekIndex) => {
    week.forEach(day => day.exercises.forEach(exercise => rows.push([
      cycleIndex + 1, weekIndex + 1, day.dayNumber, day.name,
      exercise.movement, exercise.weight, exercise.prescription,
    ])));
  }));
  return rows.map(row => row.map(escapeCsv).join(',')).join('\n');
};

export const routineToMarkdown = props => buildRoutinePlan(props).map((cycle, cycleIndex) => {
  const heading = props.mesoMode
    ? `## Microcycle ${cycleIndex + 1}: ${cycle.duration}, ${cycle.volume} volume\n\nMaxes: Squat ${cycle.effectiveMaxes.maxSquat} lb · Press ${cycle.effectiveMaxes.maxPress} lb · Deadlift ${cycle.effectiveMaxes.maxDead} lb`
    : `## ${cycle.duration}, ${cycle.volume} volume`;
  const weeks = cycle.weeks.map((week, weekIndex) => {
    const sessions = week.map(day => {
      const exercises = day.exercises.map(exercise => `- ${exercise.movement}${exercise.weight !== '' ? `: ${exercise.weight} lb` : ''}${exercise.prescription ? ` · ${exercise.prescription}` : ''}`).join('\n');
      return `#### Day ${day.dayNumber}: ${day.name}\n\n${exercises}`;
    }).join('\n\n');
    return `### Week ${weekIndex + 1}\n\n${sessions}`;
  }).join('\n\n');
  return `${heading}\n\n${weeks}`;
}).join('\n\n---\n\n');
