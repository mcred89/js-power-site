import { buildRoutinePlan, MAX_PROGRESSION_MODES } from './routineGeneration';

// Export formatting belongs to the optional calculator/export UI, not tracker startup.
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
    ? `## Microcycle ${cycleIndex + 1}: ${cycle.duration}, ${cycle.volume} volume\n\nMaxes: Squat ${cycle.effectiveMaxes.maxSquat} lb · Press ${cycle.effectiveMaxes.maxPress} lb · Deadlift ${cycle.effectiveMaxes.maxDead} lb${props.maxProgressionMode === MAX_PROGRESSION_MODES.ADAPTIVE && cycleIndex > 0 ? ' (projected; updates from completed sets)' : ''}`
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
