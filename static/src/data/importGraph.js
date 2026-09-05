import { serializedRecordsEqual } from './recordComparison';

// Validate the final merged graph: a reference valid in the file can still
// belong to the original local plan instead of its imported conflict copy.
export const reconcileImportGraph = (plan, localProfiles, localRoutines) => {
  const finalRecords = (local, items) => new Map([...local, ...items.map(item => item.result)].map(record => [record.id, record]));
  const routines = finalRecords(localRoutines, plan.routines);
  const profiles = finalRecords(localProfiles, plan.profiles);
  const localById = new Map(localRoutines.map(record => [record.id, record]));
  const saveResult = (store, result, local) => {
    const index = plan[store].findIndex(item => item.result.id === result.id);
    if (index >= 0) {
      const item = plan[store][index];
      if (serializedRecordsEqual(item.result, result)) return;
      plan[store][index] = { ...item, result, action: item.action === 'skip' ? 'merge' : item.action,
        status: item.action === 'skip' ? 'conflict' : item.status };
    } else if (!serializedRecordsEqual(local, result)) {
      plan[store].push({ type: store === 'profiles' ? 'profile' : 'routine', status: 'conflict', action: 'merge', imported: local, local, result });
    }
    (store === 'profiles' ? profiles : routines).set(result.id, result);
  };
  const changeWorkout = (routine, workout, changes) => {
    const current = routines.get(routine.id);
    saveResult('routines', { ...current, workouts: current.workouts.map(item => item.id === workout.id ? { ...item, ...changes } : item) }, localById.get(current.id));
  };
  const targetFor = (routine, ref) => {
    const target = routines.get(ref?.routineId);
    return target && target.profileId === routine.profileId
      ? { routine: target, workout: target.workouts?.find(workout => workout.id === ref.workoutId) } : {};
  };
  const sameRef = (ref, routine, workout) => ref?.routineId === routine.id && ref?.workoutId === workout.id;
  const changedItems = plan.routines.filter(item => item.action !== 'skip');
  const isLocalWorkout = (routine, workout) => {
    const local = localById.get(routine.id)?.workouts?.find(entry => entry.id === workout.id);
    return local && serializedRecordsEqual(local, workout);
  };
  changedItems.forEach(item => {
    const routine = routines.get(item.result.id);
    (routine.workouts || []).forEach(workout => {
      // A strength merge retains its local workouts verbatim.
      if (!workout.hostRef || isLocalWorkout(routine, workout)) return;
      const target = targetFor(routine, workout.hostRef);
      if (!target.workout || !sameRef(target.workout.eventRef, routine, workout)) {
        changeWorkout(routine, workout, { hostRef: null, unresolvedHostRef: { ...workout.hostRef, unresolved: true } });
      }
    });
  });
  changedItems.forEach(item => {
    const routine = routines.get(item.result.id);
    (routine.workouts || []).forEach(workout => {
      if (!workout.eventRef || isLocalWorkout(routine, workout)) return;
      const target = targetFor(routine, workout.eventRef);
      const importedTarget = target.routine && plan.routines.some(entry => entry.result.id === target.routine.id && entry.action !== 'skip');
      if (target.workout && !target.workout.hostRef && importedTarget && !localById.has(target.routine.id)) {
        changeWorkout(target.routine, target.workout, { hostRef: { routineId: routine.id, workoutId: workout.id } });
      } else if (!target.workout || !sameRef(target.workout.hostRef, routine, workout)) {
        changeWorkout(routine, workout, { eventRef: null, unresolvedEventRef: { ...workout.eventRef, unresolved: true }, eventRemoved: true });
      }
    });
  });

  const now = Date.now();
  profiles.forEach(profile => {
    const localProfile = localProfiles.find(record => record.id === profile.id);
    const active = [...routines.values()].filter(routine => routine.profileId === profile.id)
      .flatMap(routine => (routine.workouts || []).filter(workout => workout.session?.status === 'inProgress').map(workout => ({ routine, workout })));
    const rank = ({ routine, workout }) => {
      const existed = localById.get(routine.id)?.workouts?.some(entry => entry.id === workout.id && entry.session?.status === 'inProgress');
      if (existed && routine.id === localProfile?.activeWorkoutRoutineId) return 0;
      if (existed) return 1;
      return routine.id === profile.activeWorkoutRoutineId ? 2 : 3;
    };
    active.sort((left, right) => rank(left) - rank(right) || String(right.routine.updatedAt || '').localeCompare(String(left.routine.updatedAt || '')));
    const owner = active[0];
    active.slice(1).forEach(({ routine, workout }) => {
      const session = workout.session;
      const runningSince = Date.parse(session.runningSince);
      const elapsedSeconds = (Number(session.elapsedSeconds) || 0) + (Number.isFinite(runningSince) ? Math.max(0, Math.floor((now - runningSince) / 1000)) : 0);
      changeWorkout(routine, workout, { session: { ...session, status: 'paused', runningSince: null, elapsedSeconds } });
      if (routine.kind === 'strongman' && owner?.routine.id !== routine.id) {
        saveResult('routines', { ...routines.get(routine.id), status: 'paused' }, localById.get(routine.id));
      }
    });
    const normalized = { ...profile };
    if (owner || Object.prototype.hasOwnProperty.call(profile, 'activeWorkoutRoutineId')) normalized.activeWorkoutRoutineId = owner?.routine.id || null;
    ['activeStrongmanRoutineId', 'scheduledStrengthRoutineId'].forEach(field => {
      if (!profile[field]) return;
      const target = routines.get(profile[field]);
      if (!target || target.profileId !== profile.id || (field === 'activeStrongmanRoutineId' ? target.kind !== 'strongman' || target.status !== 'active' : target.kind === 'strongman')) normalized[field] = null;
    });
    if (owner?.routine.kind === 'strongman') normalized.activeStrongmanRoutineId = owner.routine.id;
    saveResult('profiles', normalized, localProfile);
  });
  return plan;
};
