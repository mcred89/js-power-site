import { buildRoutinePlan } from './routineGeneration';

// sourceWeek identifies the original training stage (0–4), independent of how
// those stages are grouped into calendar weeks. Keep it stable when shortening.
export const addWorkoutSourceWeeks = record => {
  if (!record || (record.kind && record.kind !== 'strength') ||
      !Array.isArray(record.workouts) || !record.inputs) return record;
  const inputs = record.inputs;
  const cycles = inputs.mesoMode ? inputs.microCycles : [{ duration: inputs.duration, volume: inputs.mainLiftChoice }];
  if (!Array.isArray(cycles) || !cycles.length || cycles.some(cycle => (
    !cycle || !['3 weeks', '5 weeks'].includes(cycle.duration) || !['Low', 'High'].includes(cycle.volume)
  ))) return record;

  const schedule = buildRoutinePlan(inputs).flatMap((cycle, cycleIndex) => (
    cycle.weeks.flatMap((week, weekIndex) => week.map(day => ({
      cycleIndex,
      weekIndex,
      name: day.name,
      sourceWeek: day.sourceWeek,
    })))
  ));
  let changed = false;
  const workouts = record.workouts.map(workout => {
    if (!workout || Object.prototype.hasOwnProperty.call(workout, 'sourceWeek') ||
        !Number.isInteger(workout.sequence) || workout.sequence < 1) return workout;
    // Never use an array offset: users may already have removed future workouts.
    const generated = schedule[workout.sequence - 1];
    if (!generated || generated.cycleIndex !== workout.cycleIndex ||
        generated.weekIndex !== workout.weekIndex || generated.name !== workout.name) return workout;
    changed = true;
    return { ...workout, sourceWeek: generated.sourceWeek };
  });
  return changed ? { ...record, workouts } : record;
};
