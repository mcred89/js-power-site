import { completedPrimaryEstimate, MAIN_LIFTS } from './estimatedMax';
import { buildRoutinePlan, getEffectiveMaxes, getLiftProgressionMode, MAX_PROGRESSION_MODES } from './routineGeneration';
import { restoreLegacyEventSlots } from './legacyEventSlots';
import { isTabataExercise, tabataRoundCount } from './tabata';
import { getTimerElapsedMs } from './elapsedTimer';
import { isValidSetTimerInterval } from './setTimerInterval';

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const now = () => new Date().toISOString();

const secondsBetween = (start, end) => Math.max(0, Math.floor(
  (new Date(end).getTime() - new Date(start).getTime()) / 1000,
));

export const visibleExercise = exercise => ({
  movement: exercise.overrides.movement ?? exercise.generated.movement,
  weight: exercise.overrides.weight ?? exercise.generated.weight,
  prescription: exercise.overrides.prescription ?? exercise.generated.prescription,
});

export const createRoutine = (profileId, name, inputs, resolvedCycleMaxes = []) => {
  let sequence = 0;
  const workouts = [];

  buildRoutinePlan(inputs, resolvedCycleMaxes).forEach((cycle, cycleIndex) => {
    cycle.weeks.forEach((week, weekIndex) => {
      week.forEach(day => {
        sequence += 1;
        workouts.push({
          id: makeId(),
          sequence,
          cycleIndex,
          cycleLabel: inputs.mesoMode ? `Cycle ${cycleIndex + 1}` : null,
          weekIndex,
          weekLabel: `Week ${weekIndex + 1}`,
          name: day.name,
          effectiveMaxes: { ...cycle.effectiveMaxes },
          completedAt: null,
          session: null,
          exercises: day.exercises.map(exercise => ({
            id: makeId(),
            generated: { ...exercise },
            overrides: {},
          })),
        });
      });
    });
  });

  const timestamp = now();
  return {
    id: makeId(),
    profileId,
    name,
    inputs: {
      ...inputs,
      ...(inputs.liftProgressionModes ? { liftProgressionModes: { ...inputs.liftProgressionModes } } : {}),
    },
    workouts,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createRoutineFromTemplate = (template, profileId, name) => createRoutine(
  profileId,
  name,
  {
    ...template.inputs,
    microCycles: template.inputs?.microCycles?.map(cycle => ({ ...cycle })),
  },
);

export const archiveRoutine = routine => ({
  ...routine,
  archived: true,
  updatedAt: now(),
});

export const restoreRoutine = routine => ({
  ...routine,
  archived: false,
  updatedAt: now(),
});

export const setWorkoutComplete = (routine, workoutId, complete) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.map(workout => (
    workout.id === workoutId
      ? { ...workout, completedAt: complete ? now() : null }
      : workout
  )),
});

export const parsePrescription = prescription => {
  const match = String(prescription || '').match(/^\s*(\d+)\s*[x×]\s*(\d+)(?:\s*[-–—]\s*(\d+))?/i);
  if (!match) return { setCount: 1, plannedReps: '', actualReps: '' };
  const minimum = Number(match[2]);
  return {
    setCount: Number(match[1]),
    plannedReps: match[3] ? `${match[2]}–${match[3]}` : minimum,
    actualReps: minimum,
  };
};

const updateWorkout = (routine, workoutId, change, timestamp = now()) => ({
  ...routine,
  updatedAt: timestamp,
  workouts: routine.workouts.map(workout => workout.id === workoutId ? change(workout) : workout),
});

export const sessionElapsedSeconds = (session, timestamp = now()) => (
  session.runningSince
    ? session.elapsedSeconds + secondsBetween(session.runningSince, timestamp)
    : session.elapsedSeconds
);

export const startWorkoutSession = (routine, workoutId, timestamp = now()) => updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.completedAt || workout.session?.status === 'inProgress') return workout;
    if (workout.session?.status === 'paused') return {
      ...workout,
      session: {
        ...workout.session,
        status: 'inProgress',
        runningSince: timestamp,
        stoppedAt: null,
      },
    };
    const previousWeightFor = movement => {
      const previousWorkouts = routine.workouts
        .filter(item => item.sequence < workout.sequence && item.completedAt && item.session?.exercises)
        .sort((a, b) => b.sequence - a.sequence);
      for (const previousWorkout of previousWorkouts) {
        const previousExercise = previousWorkout.session.exercises.find(item => item.movement === movement);
        const completedSets = previousExercise?.sets?.filter(set => (
          set.status === 'completed' && set.actualWeight !== '' && set.actualWeight !== null && set.actualWeight !== undefined
        ));
        if (completedSets?.length) return completedSets[completedSets.length - 1].actualWeight;
      }
      return 0;
    };
    const exercises = workout.exercises.map(exercise => {
      const shown = visibleExercise(exercise);
      const roundCount = tabataRoundCount(shown);
      const parsed = roundCount
        ? { setCount: 1, plannedReps: '', actualReps: '' }
        : parsePrescription(shown.prescription);
      const startingWeight = shown.weight === 0 ? previousWeightFor(shown.movement) : shown.weight;
      return {
        exerciseId: exercise.id,
        movement: shown.movement,
        prescription: shown.prescription,
        plannedWeight: startingWeight,
        original: null,
        substitutedAt: null,
        sets: Array.from({ length: parsed.setCount }, (_, index) => ({
          id: makeId(),
          number: index + 1,
          plannedWeight: startingWeight,
          plannedReps: parsed.plannedReps,
          actualWeight: startingWeight,
          actualReps: parsed.actualReps,
          status: 'pending',
          completedAt: null,
          skippedAt: null,
          skipActionId: null,
          splitSeconds: null,
          ...(roundCount ? { tabataTimer: null } : {}),
        })),
      };
    });
    return {
      ...workout,
      session: {
        status: 'inProgress',
        startedAt: timestamp,
        completedAt: null,
        runningSince: timestamp,
        stoppedAt: null,
        elapsedSeconds: 0,
        setTimer: null,
        primaryExerciseId: exercises[0]?.exerciseId || null,
        rpe: null,
        exercises,
      },
    };
  },
);

export const adjustSessionSet = (routine, workoutId, exerciseId, setId, values) => updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.session?.status !== 'inProgress') return workout;
    return {
      ...workout,
      session: {
        ...workout.session,
        exercises: workout.session.exercises.map(exercise => {
          if (exercise.exerciseId !== exerciseId) return exercise;
          const selected = exercise.sets.find(set => set.id === setId);
          if (!selected || selected.status !== 'pending') return exercise;
          return {
            ...exercise,
            sets: exercise.sets.map(set => (
              set.status === 'pending' && set.number >= selected.number
                ? { ...set, ...values }
                : set
            )),
          };
        }),
      },
    };
  },
);

const hasPendingSets = session => session.exercises.some(exercise => (
  exercise.sets.some(set => set.status === 'pending')
));

export const updateSessionSetTimer = (routine, workoutId, timer, timestamp = now()) => updateWorkout(
  routine,
  workoutId,
  workout => {
    const session = workout.session;
    if (session?.status !== 'inProgress' || (!timer && !session.setTimer)) return workout;
    const pending = hasPendingSets(session);
    if (timer) {
      const exercise = session.exercises.find(item => item.exerciseId === timer.exerciseId);
      if (!pending || !exercise?.sets.some(set => set.status === 'pending') || isTabataExercise(exercise) ||
          !isValidSetTimerInterval(timer.intervalMs) || !Number.isFinite(timer.elapsedMs) || timer.elapsedMs < 0 ||
          (timer.runningSince !== null && (typeof timer.runningSince !== 'string' ||
            !Number.isFinite(Date.parse(timer.runningSince))))) return workout;
    }
    return {
      ...workout,
      session: {
        ...session,
        setTimer: timer ? { ...timer } : null,
      },
    };
  },
  timestamp,
);

const transitionSetTimer = (session, exerciseId) => {
  const timer = session.setTimer;
  if (!timer || timer.exerciseId !== exerciseId || session.exercises.some(exercise => (
    exercise.exerciseId === exerciseId && exercise.sets.some(set => set.status === 'pending')
  ))) return session;
  return {
    ...session,
    setTimer: null,
  };
};

const freezeTabataTimer = (set, timestamp) => set.tabataTimer?.runningSince ? {
  ...set,
  tabataTimer: {
    ...set.tabataTimer,
    elapsedMs: getTimerElapsedMs(set.tabataTimer, Date.parse(timestamp)),
    runningSince: null,
  },
} : set;

export const completeSessionSet = (
  routine,
  workoutId,
  exerciseId,
  setId,
  timestamp = now(),
) => updateWorkout(routine, workoutId, workout => {
  if (workout.session?.status !== 'inProgress') return workout;
  const splitSeconds = sessionElapsedSeconds(workout.session, timestamp);
  const exercises = workout.session.exercises.map(exercise => ({
    ...exercise,
    sets: exercise.sets.map(set => (
      exercise.exerciseId === exerciseId && set.id === setId && set.status === 'pending'
        ? { ...freezeTabataTimer(set, timestamp), status: 'completed', completedAt: timestamp, splitSeconds }
        : set
    )),
  }));
  const session = transitionSetTimer({ ...workout.session, exercises }, exerciseId);
  return {
    ...workout,
    session: hasPendingSets(session) ? session : {
      ...session,
      setTimer: null,
      elapsedSeconds: splitSeconds,
      runningSince: null,
      stoppedAt: timestamp,
    },
  };
});

const stopSessionIfFinished = (session, timestamp) => hasPendingSets(session) ? session : {
  ...session,
  setTimer: null,
  elapsedSeconds: sessionElapsedSeconds(session, timestamp),
  runningSince: null,
  stoppedAt: timestamp,
};

const skipSets = (routine, workoutId, exerciseId, shouldSkip, timestamp = now()) => updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.session?.status !== 'inProgress') return workout;
    const skipActionId = makeId();
    const exercises = workout.session.exercises.map(exercise => (
      exercise.exerciseId !== exerciseId ? exercise : {
        ...exercise,
        sets: exercise.sets.map(set => (
          set.status === 'pending' && shouldSkip(set)
            ? { ...freezeTabataTimer(set, timestamp), status: 'skipped', skippedAt: timestamp, skipActionId }
            : set
        )),
      }
    ));
    const session = transitionSetTimer({ ...workout.session, exercises }, exerciseId);
    return { ...workout, session: stopSessionIfFinished(session, timestamp) };
  },
);

export const skipSessionSet = (
  routine,
  workoutId,
  exerciseId,
  setId,
  timestamp = now(),
) => skipSets(routine, workoutId, exerciseId, set => set.id === setId, timestamp);

export const skipRemainingSessionExercise = (
  routine,
  workoutId,
  exerciseId,
  timestamp = now(),
) => skipSets(routine, workoutId, exerciseId, () => true, timestamp);

export const substituteSessionExercise = (
  routine,
  workoutId,
  exerciseId,
  values,
  timestamp = now(),
) => updateWorkout(routine, workoutId, workout => {
  if (workout.session?.status !== 'inProgress') return workout;
  const remainingSetCount = Math.max(1, Number(values.setCount) || 1);
  const exercises = workout.session.exercises.map(exercise => {
    if (exercise.exerciseId !== exerciseId) return exercise;
    const settled = exercise.sets.filter(set => set.status !== 'pending');
    const original = exercise.original || {
      movement: exercise.movement,
      prescription: exercise.prescription,
      plannedWeight: exercise.plannedWeight,
    };
    const pending = Array.from({ length: remainingSetCount }, (_, index) => ({
      id: makeId(),
      number: settled.length + index + 1,
      plannedWeight: values.weight,
      plannedReps: values.reps,
      actualWeight: values.weight,
      actualReps: values.reps,
      status: 'pending',
      completedAt: null,
      skippedAt: null,
      skipActionId: null,
      splitSeconds: null,
    }));
    return {
      ...exercise,
      movement: values.movement,
      prescription: `${remainingSetCount} × ${values.reps}`,
      plannedWeight: values.weight,
      original,
      substitutedAt: timestamp,
      sets: [...settled, ...pending],
    };
  });
  return {
    ...workout,
    session: {
      ...workout.session,
      exercises,
      runningSince: workout.session.runningSince || timestamp,
      stoppedAt: null,
    },
  };
});

export const getLatestSessionAction = session => session.exercises.flatMap(exercise => exercise.sets.flatMap(set => {
  if (set.status === 'completed') return [{
    type: 'completed', actionId: set.id, occurredAt: set.completedAt, exerciseId: exercise.exerciseId,
  }];
  if (set.status === 'skipped' && set.skippedAt) return [{
    type: 'skipped', actionId: set.skipActionId || set.id, occurredAt: set.skippedAt, exerciseId: exercise.exerciseId,
  }];
  return [];
})).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];

export const undoLatestSessionAction = (routine, workoutId, timestamp = now()) => updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.session?.status !== 'inProgress') return workout;
    const latest = getLatestSessionAction(workout.session);
    if (!latest) return workout;
    const exercises = workout.session.exercises.map(exercise => ({
      ...exercise,
      sets: exercise.sets.map(set => (
        exercise.exerciseId === latest.exerciseId && (
          (latest.type === 'completed' && set.id === latest.actionId) ||
          (latest.type === 'skipped' && (set.skipActionId || set.id) === latest.actionId)
        )
          ? {
            ...set,
            status: 'pending',
            completedAt: null,
            skippedAt: null,
            skipActionId: null,
            splitSeconds: null,
            ...(Object.prototype.hasOwnProperty.call(set, 'tabataTimer') ? { tabataTimer: null } : {}),
          }
          : set
      )),
    }));
    const restoredExercise = exercises.find(exercise => exercise.exerciseId === latest.exerciseId);
    const session = {
      ...workout.session,
      exercises,
      ...(workout.session.setTimer ? {
        setTimer: isTabataExercise(restoredExercise) || workout.session.setTimer.exerciseId !== latest.exerciseId
          ? null
          : workout.session.setTimer,
      } : {}),
    };
    if (workout.session.runningSince) return { ...workout, session };
    const remainingCompleted = exercises.flatMap(exercise => exercise.sets)
      .filter(set => set.status === 'completed');
    const elapsedSeconds = latest.type === 'completed'
      ? Math.max(0, ...remainingCompleted.map(set => set.splitSeconds))
      : workout.session.elapsedSeconds;
    return {
      ...workout,
      session: {
        ...session,
        elapsedSeconds,
        runningSince: timestamp,
        stoppedAt: null,
      },
    };
  },
);

export const undoLatestSessionSet = undoLatestSessionAction;

export const setSessionRpe = (routine, workoutId, rpe) => updateWorkout(
  routine,
  workoutId,
  workout => workout.session?.status === 'inProgress'
    ? { ...workout, session: { ...workout.session, rpe } }
    : workout,
);

export const finishWorkoutSession = (routine, workoutId, timestamp = now()) => updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.session?.status !== 'inProgress') return workout;
    const completedSets = workout.session.exercises.flatMap(exercise => (
      exercise.sets.filter(set => set.status === 'completed')
    ));
    const lastSplit = Math.max(0, ...completedSets.map(set => set.splitSeconds));
    const lastCompletedAt = completedSets
      .map(set => set.completedAt)
      .sort()
      .pop();
    const elapsedSeconds = !workout.session.runningSince && workout.session.stoppedAt
      ? workout.session.elapsedSeconds
      : completedSets.length
        ? lastSplit
        : sessionElapsedSeconds(workout.session, timestamp);
    return {
      ...workout,
      completedAt: timestamp,
      session: {
        ...workout.session,
        status: 'completed',
        setTimer: null,
        completedAt: timestamp,
        elapsedSeconds,
        runningSince: null,
        stoppedAt: workout.session.stoppedAt || lastCompletedAt || timestamp,
        exercises: workout.session.exercises.map(exercise => ({
          ...exercise,
          sets: exercise.sets.map(set => set.status === 'pending'
            ? { ...freezeTabataTimer(set, timestamp), status: 'skipped', skippedAt: timestamp, skipActionId: null }
            : set),
        })),
      },
    };
  },
);

export const reopenWorkoutSession = (routine, workoutId, timestamp = now()) => restoreLegacyEventSlots(updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.session?.status !== 'completed') {
      return { ...workout, completedAt: null };
    }
    const exercises = workout.session.exercises.map(exercise => ({
      ...exercise,
      sets: exercise.sets.map(set => set.status === 'skipped'
        ? { ...set, status: 'pending' }
        : set),
    }));
    const session = { ...workout.session, status: 'inProgress', completedAt: null, setTimer: null, exercises };
    const pending = hasPendingSets(session);
    return {
      ...workout,
      completedAt: null,
      session: {
        ...session,
        runningSince: pending ? timestamp : null,
        stoppedAt: pending ? null : workout.session.stoppedAt,
      },
    };
  },
));

export const deleteFutureWorkout = (routine, workoutId) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.filter(workout => (
    workout.id !== workoutId || workout.completedAt
  )),
});

export const updateExercise = (routine, workoutId, exerciseId, values) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.map(workout => (
    workout.id !== workoutId || workout.completedAt
      ? workout
      : {
        ...workout,
        exercises: workout.exercises.map(exercise => (
          exercise.id === exerciseId
            ? { ...exercise, overrides: { ...exercise.overrides, ...values } }
            : exercise
        )),
      }
  )),
});

export const clearExerciseOverrides = (routine, workoutId, exerciseId) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.map(workout => (
    workout.id !== workoutId || workout.completedAt
      ? workout
      : {
        ...workout,
        exercises: workout.exercises.map(exercise => (
          exercise.id === exerciseId ? { ...exercise, overrides: {} } : exercise
        )),
      }
  )),
});

const maxKeyForLift = {
  Squat: 'maxSquat',
  Press: 'maxPress',
  Deadlift: 'maxDead',
};

const roundToNearestFive = value => Math.round(value / 5) * 5;

export const adaptiveCycleMaxes = routine => {
  const inputs = routine.inputs || {};
  const cycleCount = inputs.mesoMode ? (inputs.microCycles || []).length : 1;
  const starting = getEffectiveMaxes(inputs, 0);
  const bestByCycle = Array.from({ length: cycleCount }, () => ({}));
  const floorByCycle = Array.from({ length: cycleCount }, () => ({}));
  (routine.workouts || []).forEach(workout => {
    const floor = floorByCycle[workout.cycleIndex];
    const maxKey = maxKeyForLift[workout.name];
    const snapshotMax = Number(workout.effectiveMaxes?.[maxKey]);
    // A lift already trained or started at a max must not move backward when
    // its strategy changes. Other lifts and untouched projections are not floors.
    if (floor && maxKey && (workout.completedAt || workout.session) && Number.isFinite(snapshotMax) && snapshotMax > 0) {
      floor[maxKey] = Math.max(floor[maxKey] || 0, snapshotMax);
    }
    const estimate = completedPrimaryEstimate(workout);
    if (!estimate || !bestByCycle[workout.cycleIndex]) return;
    bestByCycle[workout.cycleIndex][estimate.lift] = Math.max(
      bestByCycle[workout.cycleIndex][estimate.lift] || 0,
      estimate.value,
    );
  });
  const maxes = [];
  for (let cycleIndex = 0; cycleIndex < cycleCount; cycleIndex += 1) {
    const previous = maxes[cycleIndex - 1] || starting;
    const previousBest = bestByCycle[cycleIndex - 1] || {};
    maxes.push(MAIN_LIFTS.reduce((result, lift) => {
      if (getLiftProgressionMode(inputs, lift.toLowerCase()) !== MAX_PROGRESSION_MODES.ADAPTIVE) return result;
      const key = maxKeyForLift[lift];
      const estimate = previousBest[lift] ? roundToNearestFive(previousBest[lift]) : previous[key];
      return { ...result, [key]: Math.max(previous[key], estimate, floorByCycle[cycleIndex][key] || 0) };
    }, getEffectiveMaxes(inputs, cycleIndex)));
  }
  return maxes;
};

export const adaptiveStatusForWorkout = (routine, workout) => {
  const maxKey = maxKeyForLift[workout?.name];
  if (!routine?.inputs?.mesoMode || !workout?.cycleIndex || !maxKey ||
      getLiftProgressionMode(routine.inputs, workout.name.toLowerCase()) !== MAX_PROGRESSION_MODES.ADAPTIVE) return null;
  const previousIndex = workout.cycleIndex - 1;
  const previous = routine.workouts.filter(item => item.cycleIndex === previousIndex);
  const allComplete = previous.length > 0 && previous.every(item => item.completedAt);
  const maxes = adaptiveCycleMaxes(routine);
  const improved = maxes[workout.cycleIndex]?.[maxKey] > maxes[previousIndex]?.[maxKey];
  const source = `Cycle ${workout.cycleIndex}`;
  if (improved) return `Adaptive · updated from ${source}`;
  return `Adaptive · ${allComplete ? 'set' : 'projected'} from ${source}`;
};

export const cloneImportedRecord = record => ({
  ...record,
  id: makeId(),
  name: `${record.name} (Imported)`,
  createdAt: now(),
  updatedAt: now(),
});
