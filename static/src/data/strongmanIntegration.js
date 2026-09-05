import { visibleExercise } from './routines';
import { createRoutine } from './routinePlanning';
import { serializedRecordsEqual } from './recordComparison';

const now = () => new Date().toISOString();
const nextEvent = plan => plan.workouts.find(workout => !workout.completedAt && !workout.skippedAt && !workout.session?.startedAt);
const replaceWorkout = (plan, workout, timestamp) => ({ ...plan, updatedAt: timestamp, workouts: plan.workouts.map(item => item.id === workout.id ? workout : item) });
const reciprocalHost = (hostRoutine, eventPlan, workout) => (
  hostRoutine?.id === workout.hostRef?.routineId && hostRoutine?.profileId === eventPlan.profileId
    ? hostRoutine.workouts.find(item => item.id === workout.hostRef.workoutId && item.kind === 'eventSlot' && item.eventRef?.routineId === eventPlan.id && item.eventRef?.workoutId === workout.id)
    : null
);
const transition = (profile, nextProfile, before, after) => ({
  profile: nextProfile,
  routines: after,
  conditions: {
    profiles: [{ key: profile.id, expected: profile }],
    routines: before.map(record => ({ key: record.id, expected: record })),
  },
});

export const createLinkedStrengthRoutine = (profileId, name, inputs, eventPlan) => {
  const linked = eventPlan?.profileId === profileId && eventPlan.status === 'active';
  const routine = createRoutine(profileId, name, { ...inputs, ...(linked ? { includeStrongmanDay: true } : {}) });
  return {
    ...routine,
    kind: 'strength',
    workouts: routine.workouts.map(workout => linked && workout.name === 'Strongman'
      ? { ...workout, kind: 'eventSlot', eventRef: null, exercises: [] }
      : workout),
  };
};

export const startLinkedEvent = ({ profile, eventPlan, draftPlan = eventPlan, hostRoutine, hostWorkoutId, workoutId, timestamp = now() }) => {
  if (profile.activeWorkoutRoutineId || eventPlan.workouts.some(workout => workout.session?.status === 'inProgress')) throw new Error('Resume your active workout before starting another.');
  if (profile.id !== eventPlan.profileId || (hostRoutine && hostRoutine.profileId !== profile.id)) throw new Error('The event and host must belong to this profile.');
  if (eventPlan.status !== 'active') throw new Error('Activate this strongman block before starting it.');
  if (draftPlan.id !== eventPlan.id || draftPlan.profileId !== eventPlan.profileId) throw new Error('The event draft must belong to the current block.');
  const workout = nextEvent(draftPlan);
  if (!workout) throw new Error('This event block has no unstarted weeks.');
  if (workout.id !== nextEvent(eventPlan)?.id) throw new Error('The event draft is out of date. Review the next event week.');
  if (workoutId && workout.id !== workoutId) throw new Error('Complete or explicitly skip earlier event weeks first.');
  const host = hostRoutine?.workouts.find(item => item.id === hostWorkoutId);
  if (hostRoutine && (!host || host.kind !== 'eventSlot' || host.completedAt || host.eventRef)) throw new Error('This event slot is no longer available.');
  const started = {
    ...workout,
    hostRef: host ? { routineId: hostRoutine.id, workoutId: host.id } : null,
    session: { status: 'inProgress', startedAt: timestamp, runningSince: timestamp, elapsedSeconds: 0, exercises: [], completedAt: null },
  };
  // Save the refreshed forecast, but compare against the persisted owner so the
  // same atomic claim detects another tab consuming or editing that owner.
  const owner = replaceWorkout(draftPlan, started, timestamp);
  const before = [eventPlan];
  const after = [owner];
  if (host) {
    before.push(hostRoutine);
    after.push(replaceWorkout(hostRoutine, { ...host, eventRef: { routineId: eventPlan.id, workoutId: workout.id } }, timestamp));
  }
  return transition(profile, { ...profile, activeWorkoutRoutineId: eventPlan.id, updatedAt: timestamp }, before, after);
};

export const finishLinkedEvent = ({ profile, eventPlan, workout, hostRoutine, timestamp = now() }) => {
  const existing = eventPlan.workouts.find(item => item.id === workout.id);
  if (!existing || existing.session?.status !== 'inProgress' || profile.activeWorkoutRoutineId !== eventPlan.id) throw new Error('This event workout is no longer active.');
  const host = reciprocalHost(hostRoutine, eventPlan, existing);
  const finished = { ...workout, hostRef: host ? existing.hostRef : null, completedAt: timestamp, session: { ...workout.session, status: 'completed', completedAt: timestamp, runningSince: null } };
  let owner = replaceWorkout(eventPlan, finished, timestamp);
  const complete = owner.workouts.every(item => item.completedAt || item.skippedAt);
  owner = { ...owner, status: complete ? 'complete' : owner.status };
  const before = [eventPlan];
  const after = [owner];
  if (host) {
    before.push(hostRoutine);
    after.push(replaceWorkout(hostRoutine, { ...host, completedAt: timestamp }, timestamp));
  }
  return transition(profile, {
    ...profile, activeWorkoutRoutineId: null,
    ...(complete && profile.activeStrongmanRoutineId === eventPlan.id ? { activeStrongmanRoutineId: null } : {}),
    updatedAt: timestamp,
  }, before, after);
};

export const skipEventWorkout = (plan, workoutId, timestamp = now()) => {
  const workout = plan.workouts.find(item => item.id === workoutId);
  if (!workout || workout.completedAt || workout.session?.startedAt) throw new Error('Only an unstarted event week can be skipped.');
  const updated = replaceWorkout(plan, { ...workout, skippedAt: timestamp }, timestamp);
  return { ...updated, status: updated.workouts.every(item => item.completedAt || item.skippedAt) ? 'complete' : updated.status };
};

export const reopenLinkedEvent = ({ profile, eventPlan, workoutId, hostRoutine, timestamp = now() }) => {
  if (profile.activeWorkoutRoutineId) throw new Error('Finish your active workout first.');
  const workout = eventPlan.workouts.find(item => item.id === workoutId);
  if (!workout?.completedAt || !workout.session) throw new Error('This event workout has no completed session to reopen.');
  const host = reciprocalHost(hostRoutine, eventPlan, workout);
  const reopened = { ...workout, hostRef: host ? workout.hostRef : null, completedAt: null, session: { ...workout.session, status: 'inProgress', completedAt: null, runningSince: timestamp } };
  const before = [eventPlan];
  const after = [replaceWorkout(eventPlan, reopened, timestamp)];
  if (host) {
    before.push(hostRoutine);
    after.push(replaceWorkout(hostRoutine, { ...host, completedAt: null }, timestamp));
  }
  return transition(profile, { ...profile, activeWorkoutRoutineId: eventPlan.id, updatedAt: timestamp }, before, after);
};

export const resumePausedLinkedEvent = ({ profile, eventPlan, workoutId, timestamp = now() }) => {
  if (profile.activeWorkoutRoutineId || eventPlan.workouts.some(item => item.session?.status === 'inProgress')) throw new Error('Finish your active workout before resuming this event session.');
  if (eventPlan.profileId !== profile.id) throw new Error('This event session belongs to another profile.');
  if (eventPlan.status !== 'active' || eventPlan.archived) throw new Error('Activate this event block before resuming its session.');
  const workout = eventPlan.workouts.find(item => item.id === workoutId);
  if (!workout || workout.completedAt || workout.skippedAt || workout.session?.status !== 'paused') throw new Error('This event workout has no paused session to resume.');
  const resumed = { ...workout, session: { ...workout.session, status: 'inProgress', runningSince: timestamp } };
  return transition(profile, { ...profile, activeWorkoutRoutineId: eventPlan.id, updatedAt: timestamp }, [eventPlan], [replaceWorkout(eventPlan, resumed, timestamp)]);
};

export const detachLinkedPlan = (deleted, routines) => {
  const active = routines.some(routine => routine.workouts.some(workout => (
    workout.session?.status === 'inProgress' && (routine.id === deleted.id || workout.hostRef?.routineId === deleted.id)
  )));
  if (active) throw new Error('Finish the linked active workout before deleting this plan.');
  return routines.filter(routine => routine.id !== deleted.id).map(routine => {
    let changed = false;
    const workouts = routine.workouts.map(workout => {
      if (workout.hostRef?.routineId === deleted.id) {
        changed = true;
        return { ...workout, hostRef: null };
      }
      if (workout.eventRef?.routineId === deleted.id) {
        changed = true;
        return { ...workout, eventRef: null, eventRemoved: Boolean(workout.completedAt) };
      }
      return workout;
    });
    return changed ? { ...routine, workouts, updatedAt: now() } : routine;
  });
};

export const eventCoverageEvidence = (plan, routines) => (plan.inputs.events || []).flatMap(event => (event.coverage || []).map(link => {
  const routine = routines.find(item => item.id === link.routineId && item.profileId === plan.profileId);
  const workout = routine?.workouts.find(item => item.exercises?.some(exercise => exercise.id === link.exerciseId));
  const prescription = workout?.exercises.find(exercise => exercise.id === link.exerciseId);
  const actual = workout?.session?.exercises?.find(exercise => exercise.exerciseId === link.exerciseId);
  const visible = prescription ? visibleExercise(prescription) : null;
  const sourceMatches = Boolean(visible) && (link.sourcePrescription
    ? serializedRecordsEqual(link.sourcePrescription, visible) : link.scope !== 'exact');
  const compatible = sourceMatches && actual && !actual.original && actual.movement === visible.movement;
  const completed = compatible && workout.completedAt && actual.sets?.some(set => set.status === 'completed');
  const actualNumber = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  // The normal tracker records actual pounds and repetitions. Conditions come
  // only from the explicit link; goals and planned numbers are never evidence.
  const attempts = completed && link.scope === 'exact' && link.capabilitySnapshot
    ? actual.sets.filter(set => set.status === 'completed').map((set, index) => ({
      id: set.id || `${link.exerciseId}:set:${index + 1}`,
      weight: actualNumber(set.actualWeight), reps: actualNumber(set.actualReps),
      weightUnit: 'lb', loadMeaning: 'total',
      ...(typeof link.sourceConditions?.setup === 'string' ? { setup: link.sourceConditions.setup } : {}),
      outcome: actualNumber(set.actualReps) === 0 ? 'unsuccessful' : 'successful',
      status: 'completed', completedAt: set.completedAt || workout.completedAt,
    })) : [];
  return {
    ...link, eventId: event.id,
    completedAt: completed ? workout.completedAt : null,
    sourceWorkoutId: workout?.id || null,
    attempts,
    planned: Boolean(sourceMatches && workout && !workout.completedAt && !workout.skippedAt),
    needsReview: !workout || !sourceMatches || Boolean(workout.skippedAt) || !Number.isInteger(link.eventWeek) || link.eventWeek < 1 || link.eventWeek > plan.workouts.length || Boolean(workout.completedAt && !completed),
    sourceName: routine?.name || 'Missing routine',
  };
}));
