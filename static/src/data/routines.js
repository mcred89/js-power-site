import { completedPrimaryEstimate, MAIN_LIFTS } from './estimatedMax';
import { buildRoutinePlan, MAX_PROGRESSION_MODES } from './routineGeneration';
import { restoreLegacyEventSlots } from './retiredStrongman';

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
    inputs: { ...inputs },
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

const updateWorkout = (routine, workoutId, change) => ({
  ...routine,
  updatedAt: now(),
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
      const parsed = parsePrescription(shown.prescription);
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
        ? { ...set, status: 'completed', completedAt: timestamp, splitSeconds }
        : set
    )),
  }));
  const session = { ...workout.session, exercises };
  return {
    ...workout,
    session: hasPendingSets(session) ? session : {
      ...session,
      elapsedSeconds: splitSeconds,
      runningSince: null,
      stoppedAt: timestamp,
    },
  };
});

const stopSessionIfFinished = (session, timestamp) => hasPendingSets(session) ? session : {
  ...session,
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
            ? { ...set, status: 'skipped', skippedAt: timestamp, skipActionId }
            : set
        )),
      }
    ));
    const session = { ...workout.session, exercises };
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

export const undoLatestSessionAction = (routine, workoutId, timestamp = now()) => updateWorkout(
  routine,
  workoutId,
  workout => {
    if (workout.session?.status !== 'inProgress') return workout;
    const actions = workout.session.exercises.flatMap(exercise => exercise.sets.flatMap(set => {
      if (set.status === 'completed') return [{
        type: 'completed', actionId: set.id, occurredAt: set.completedAt, exerciseId: exercise.exerciseId,
      }];
      if (set.status === 'skipped' && set.skippedAt) return [{
        type: 'skipped', actionId: set.skipActionId || set.id, occurredAt: set.skippedAt, exerciseId: exercise.exerciseId,
      }];
      return [];
    })).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const latest = actions[0];
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
          }
          : set
      )),
    }));
    const session = { ...workout.session, exercises };
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
        completedAt: timestamp,
        elapsedSeconds,
        runningSince: null,
        stoppedAt: workout.session.stoppedAt || lastCompletedAt || timestamp,
        exercises: workout.session.exercises.map(exercise => ({
          ...exercise,
          sets: exercise.sets.map(set => set.status === 'pending'
            ? { ...set, status: 'skipped', skippedAt: timestamp, skipActionId: null }
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
    const session = { ...workout.session, status: 'inProgress', completedAt: null, exercises };
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
  const starting = {
    maxSquat: Number(inputs.maxSquat),
    maxPress: Number(inputs.maxPress),
    maxDead: Number(inputs.maxDead),
  };
  const bestByCycle = Array.from({ length: cycleCount }, () => ({}));
  (routine.workouts || []).forEach(workout => {
    const estimate = completedPrimaryEstimate(workout);
    if (!estimate || !bestByCycle[workout.cycleIndex]) return;
    bestByCycle[workout.cycleIndex][estimate.lift] = Math.max(
      bestByCycle[workout.cycleIndex][estimate.lift] || 0,
      estimate.value,
    );
  });
  const maxes = [starting];
  for (let cycleIndex = 1; cycleIndex < cycleCount; cycleIndex += 1) {
    const previous = maxes[cycleIndex - 1];
    const previousBest = bestByCycle[cycleIndex - 1];
    maxes.push(MAIN_LIFTS.reduce((result, lift) => {
      const key = maxKeyForLift[lift];
      const estimate = previousBest[lift] ? roundToNearestFive(previousBest[lift]) : previous[key];
      return { ...result, [key]: Math.max(previous[key], estimate) };
    }, {}));
  }
  return maxes;
};

export const refreshAdaptiveProgression = routine => {
  if (!routine.inputs?.mesoMode || routine.inputs.maxProgressionMode !== MAX_PROGRESSION_MODES.ADAPTIVE) {
    return { routine, changed: false };
  }
  const cycleMaxes = adaptiveCycleMaxes(routine);
  const regenerated = createRoutine(routine.profileId, routine.name, routine.inputs, cycleMaxes);
  const generatedBySequence = new Map(regenerated.workouts.map(workout => [workout.sequence, workout]));
  let changed = false;
  const workouts = routine.workouts.map(workout => {
    const generatedWorkout = generatedBySequence.get(workout.sequence);
    if (workout.completedAt || ['inProgress', 'paused'].includes(workout.session?.status) || !generatedWorkout) return workout;
    const next = {
      ...workout,
      effectiveMaxes: generatedWorkout.effectiveMaxes,
      exercises: generatedWorkout.exercises.map((exercise, exerciseIndex) => ({
        ...exercise,
        id: workout.exercises[exerciseIndex]?.id || exercise.id,
        overrides: workout.exercises[exerciseIndex]?.overrides || {},
      })),
    };
    if (JSON.stringify(next.effectiveMaxes) !== JSON.stringify(workout.effectiveMaxes) ||
        JSON.stringify(next.exercises.map(exercise => exercise.generated)) !==
          JSON.stringify(workout.exercises.map(exercise => exercise.generated))) changed = true;
    return next;
  });
  return {
    changed,
    routine: changed ? { ...routine, workouts, updatedAt: now() } : routine,
  };
};

export const adaptiveStatusForWorkout = (routine, workout) => {
  if (!routine?.inputs?.mesoMode || routine.inputs.maxProgressionMode !== MAX_PROGRESSION_MODES.ADAPTIVE || !workout?.cycleIndex) return null;
  const previousIndex = workout.cycleIndex - 1;
  const previous = routine.workouts.filter(item => item.cycleIndex === previousIndex);
  const allComplete = previous.length > 0 && previous.every(item => item.completedAt);
  const maxes = adaptiveCycleMaxes(routine);
  const improved = Object.keys(maxes[workout.cycleIndex] || {}).some(key => (
    maxes[workout.cycleIndex][key] > maxes[previousIndex][key]
  ));
  const source = `Cycle ${workout.cycleIndex}`;
  if (improved) return `Adaptive · updated from ${source}`;
  return `Adaptive · ${allComplete ? 'set' : 'projected'} from ${source}`;
};

export const correctMaxes = (routine, maxes) => {
  const inputs = { ...routine.inputs, ...maxes };
  const regenerated = createRoutine(routine.profileId, routine.name, inputs);
  // Sequence is the persisted identity of a generated workout. Index it once so long,
  // chained mesocycles remain O(W); gaps from user deletions must not shift later plans.
  const generatedBySequence = [null, ...regenerated.workouts];

  const corrected = {
    ...routine,
    inputs,
    updatedAt: now(),
    workouts: routine.workouts.map(workout => {
      const generatedWorkout = generatedBySequence[workout.sequence];
      if (workout.completedAt || ['inProgress', 'paused'].includes(workout.session?.status) || !generatedWorkout) {
        // Started and completed prescriptions are snapshots. Unknown sequences can come from
        // older/imported data and must also survive rather than being guessed by array position.
        return workout;
      }
      return {
        ...workout,
        effectiveMaxes: generatedWorkout.effectiveMaxes,
        exercises: generatedWorkout.exercises.map((exercise, exerciseIndex) => ({
          ...exercise,
          // Exercise position is stable within a generated workout. Retain persisted IDs and
          // explicit overrides so corrections do not break session links or user edits.
          id: workout.exercises[exerciseIndex]?.id || exercise.id,
          overrides: workout.exercises[exerciseIndex]?.overrides || {},
        })),
      };
    }),
  };
  return refreshAdaptiveProgression(corrected).routine;
};

export const cloneImportedRecord = record => ({
  ...record,
  id: makeId(),
  name: `${record.name} (Imported)`,
  createdAt: now(),
  updatedAt: now(),
});
