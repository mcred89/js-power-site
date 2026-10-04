import { buildRoutinePlan } from './routineGeneration';
import { buildRemainingWeekGroups } from './cycleShortening';

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const offsets = { Squat: 1, Press: 2, Deadlift: 3, Strongman: 4 };
const stageKey = workout => `${workout.name}:${workout.sourceWeek}`;
const oldRemoved = workout => (
  (workout.name === 'Deadlift' && [1, 3].includes(workout.sourceWeek)) ||
  (workout.name === 'Strongman' && [0, 2].includes(workout.sourceWeek))
);
const recognized = workout => workout && has(offsets, workout.name) &&
  Number.isInteger(workout.sourceWeek) && workout.sourceWeek >= 0 && workout.sourceWeek < 5 &&
  Number.isInteger(workout.sequence) && workout.sequence > 0 && Array.isArray(workout.exercises);

// v21 retained the original five-week queue numbers when it shortened a plan.
// Together with its fixed future week labels, these identify affected cycles
// without treating native three-week plans or unknown imported work as broken.
const legacyCycle = (workouts, protectedWorkout, includeStrongmanDay) => {
  const owners = new Map();
  [...workouts].filter(recognized).sort((a, b) => a.sequence - b.sequence).forEach(workout => {
    if (!owners.has(stageKey(workout))) owners.set(stageKey(workout), workout);
  });
  const values = [...owners.values()];
  if (new Set(values.map(workout => workout.sourceWeek)).size < 3) return null;
  const stride = includeStrongmanDay ? 4 : 3;
  const base = values[0].sequence - values[0].sourceWeek * stride - offsets[values[0].name];
  if (base < 0 || values.some(workout => (
    (!includeStrongmanDay && workout.name === 'Strongman') ||
    workout.sequence !== base + workout.sourceWeek * stride + offsets[workout.name] ||
    (!protectedWorkout(workout) && (workout.weekIndex !== Math.floor(workout.sourceWeek / 2) ||
      workout.weekLabel !== `Week ${Math.floor(workout.sourceWeek / 2) + 1}`))
  ))) return null;
  const historicalStages = values.filter(workout => protectedWorkout(workout) &&
    workout.weekIndex === workout.sourceWeek && (
      workout.sourceWeek >= 1 || (includeStrongmanDay && workout.name === 'Strongman')
    ));
  // Without Strongman, native three-week and converted queue numbers coincide.
  // Only an original, uncompressed historical week distinguishes those plans.
  if (!includeStrongmanDay && !historicalStages.length) return null;
  // Later activity on the bad Week 2/3 projections does not move the original
  // shortening boundary. Such activity remains a protected historical snapshot.
  const start = historicalStages.length ? Math.max(...historicalStages.map(workout => workout.sourceWeek)) + 1 : 0;
  return { owners, base, start, stride };
};

// Migration-only transform: call from the v22 database/backup steps, never from
// normal loading or editing. Saved cycle groups also make repaired records
// idempotent without interpreting later manual deletions as missing work.
export const repairShortenedCycles = record => {
  if (!record || (record.kind && record.kind !== 'strength') || typeof record.id !== 'string' ||
      !Array.isArray(record.workouts) || !record.inputs || typeof record.inputs !== 'object' ||
      (has(record, 'cycleWeekGroups') && (!record.cycleWeekGroups || typeof record.cycleWeekGroups !== 'object' ||
        Array.isArray(record.cycleWeekGroups)))) return record;
  const inputs = record.inputs;
  const cycles = inputs.mesoMode ? inputs.microCycles : [{ duration: inputs.duration, volume: inputs.mainLiftChoice }];
  if (!Array.isArray(cycles) || !cycles.length || cycles.some(cycle => !cycle ||
      !['3 weeks', '5 weeks'].includes(cycle.duration) || !['Low', 'High'].includes(cycle.volume)) ||
      ['maxSquat', 'maxPress', 'maxDead'].some(key => !Number.isFinite(Number(inputs[key])) || Number(inputs[key]) <= 0) ||
      (record.strongmanLog !== undefined && !Array.isArray(record.strongmanLog)) ||
      (record.shorteningRepair !== undefined && (!record.shorteningRepair || typeof record.shorteningRepair !== 'object' ||
        Array.isArray(record.shorteningRepair) ||
        ['removedWorkouts', 'restoredWorkoutIds'].some(key => has(record.shorteningRepair, key) &&
          !Array.isArray(record.shorteningRepair[key]))))) return record;
  const logged = new Set((record.strongmanLog || []).map(entry => entry?.workoutId));
  const protectedWorkout = workout => Boolean(workout.completedAt || workout.skippedAt || workout.session || logged.has(workout.id));
  let workouts = record.workouts;
  const cycleWeekGroups = { ...record.cycleWeekGroups };
  const removedWorkouts = [];
  const restoredWorkoutIds = [];
  let changed = false;
  cycles.forEach((cycle, cycleIndex) => {
    if (cycle.duration !== '3 weeks' || has(cycleWeekGroups, cycleIndex)) return;
    const cycleWorkouts = workouts.filter(workout => workout?.cycleIndex === cycleIndex);
    const legacy = legacyCycle(cycleWorkouts, protectedWorkout, Boolean(inputs.includeStrongmanDay));
    if (!legacy) return;
    const { owners, base, start, stride } = legacy;
    const groups = buildRemainingWeekGroups(start);
    // With no historical boundary, the existing canonical schedule is already
    // correct. Record its grouping, but do not reinterpret deliberate deletions.
    if (!start) {
      cycleWeekGroups[cycleIndex] = groups;
      changed = true;
      return;
    }
    const generatedCycle = buildRoutinePlan(inputs, [], { [cycleIndex]: groups })[cycleIndex];
    const scheduled = new Map(generatedCycle.weeks.flatMap((week, weekIndex) => week.map(day => [
      stageKey(day), { day, weekIndex },
    ])));
    // The old transform also erased unstarted days inside a week whose Squat,
    // Press or Strongman work was already recorded. Recover those active-week
    // gaps and the latest original week, whose last untouched day may itself
    // have been erased. Earlier settled gaps remain ambiguous intentional deletes.
    const unfinishedSources = new Set([...owners.values()].filter(workout => !workout.completedAt && !workout.skippedAt)
      .map(workout => workout.sourceWeek));
    const missing = inputs.includeStrongmanDay ? [...scheduled.values()].filter(({ day }) => (
      (day.sourceWeek >= start - 1 || unfinishedSources.has(day.sourceWeek)) && oldRemoved(day) && !owners.has(stageKey(day))
    )) : [];
    const repairId = day => `${record.id}:shortening-repair-22:${cycleIndex}:${day.name}:${day.sourceWeek}`;
    // Do not remove a remaining deadlift if a custom/imported identity would
    // prevent inserting its replacement. Leave the ambiguous cycle unchanged.
    if (missing.some(({ day }) => workouts.some(workout => workout?.id === repairId(day) ||
      workout?.sequence === base + day.sourceWeek * stride + offsets[day.name]))) return;
    cycleWeekGroups[cycleIndex] = groups;
    changed = true;
    workouts = workouts.flatMap(workout => {
      if (workout?.cycleIndex !== cycleIndex || owners.get(stageKey(workout)) !== workout || protectedWorkout(workout)) return [workout];
      const target = scheduled.get(stageKey(workout));
      if (!target) {
        removedWorkouts.push(workout);
        return [];
      }
      return [{ ...workout, weekIndex: target.weekIndex, weekLabel: `Week ${target.weekIndex + 1}` }];
    });
    if (!inputs.includeStrongmanDay) return;
    for (const { day, weekIndex } of missing) {
      const sequence = base + day.sourceWeek * stride + offsets[day.name];
      const id = repairId(day);
      const donors = [...owners.values()].filter(workout =>
        ['maxSquat', 'maxPress', 'maxDead'].every(key => Number.isFinite(Number(workout.effectiveMaxes?.[key])) &&
          Number(workout.effectiveMaxes[key]) > 0));
      const donorScore = workout => (protectedWorkout(workout) ? 100 : 0) +
        (workout.name === day.name ? 0 : 10) + Math.abs(workout.sourceWeek - day.sourceWeek);
      donors.sort((a, b) => donorScore(a) - donorScore(b) || b.sourceWeek - a.sourceWeek);
      const effectiveMaxes = { ...(donors[0]?.effectiveMaxes || generatedCycle.effectiveMaxes) };
      const resolved = [];
      resolved[cycleIndex] = effectiveMaxes;
      const prescription = buildRoutinePlan(inputs, resolved, { [cycleIndex]: groups })[cycleIndex].weeks[weekIndex]
        .find(candidate => stageKey(candidate) === stageKey(day));
      const restored = {
        id, sequence, cycleIndex, cycleLabel: inputs.mesoMode ? `Cycle ${cycleIndex + 1}` : null,
        weekIndex, weekLabel: `Week ${weekIndex + 1}`, sourceWeek: day.sourceWeek, name: day.name,
        effectiveMaxes, completedAt: null, session: null,
        exercises: prescription.exercises.map((exercise, index) => ({
          id: `${id}:exercise:${index + 1}`, generated: { ...exercise }, overrides: {},
        })),
      };
      const following = workouts.findIndex(workout => Number.isFinite(workout?.sequence) && workout.sequence > sequence);
      workouts = [...workouts.slice(0, following < 0 ? workouts.length : following), restored,
        ...workouts.slice(following < 0 ? workouts.length : following)];
      restoredWorkoutIds.push(id);
    }
  });
  if (!changed) return record;
  return {
    ...record, workouts, cycleWeekGroups,
    shorteningRepair: {
      ...record.shorteningRepair, version: 22,
      removedWorkouts: [...(Array.isArray(record.shorteningRepair?.removedWorkouts) ? record.shorteningRepair.removedWorkouts : []), ...removedWorkouts],
      restoredWorkoutIds: [...(Array.isArray(record.shorteningRepair?.restoredWorkoutIds) ? record.shorteningRepair.restoredWorkoutIds : []), ...restoredWorkoutIds],
    },
  };
};
