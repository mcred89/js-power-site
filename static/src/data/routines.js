import { buildRoutinePlan } from './routineGeneration';

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

const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

const planWorkoutsToCsv = (routine, workouts) => {
  const rows = [[
    'Routine',
    'Microcycle',
    'Week',
    'Workout',
    'Session',
    'Movement',
    'Weight (lb)',
    'Prescription',
    'Status',
    'Completed at',
  ]];

  workouts.forEach(workout => workout.exercises.forEach(exercise => {
    const shown = visibleExercise(exercise);
    rows.push([
      routine.name,
      workout.cycleLabel,
      workout.weekLabel,
      workout.sequence,
      workout.name,
      shown.movement,
      shown.weight,
      shown.prescription,
      workout.completedAt ? 'Completed' : 'Planned',
      workout.completedAt,
    ]);
  }));

  return rows.map(row => row.map(escapeCsv).join(',')).join('\n');
};

export const routinePlanToCsv = routine => planWorkoutsToCsv(routine, routine.workouts);

const formatSeconds = seconds => seconds === null || seconds === undefined ? '' : seconds;

export const routineHistoryToCsv = routine => {
  const rows = [[
    'Routine', 'Microcycle', 'Week', 'Workout', 'Session', 'Started at', 'Completed at',
    'Total seconds', 'Movement', 'Substituted for', 'Set', 'Set status', 'Planned weight (lb)',
    'Planned reps', 'Actual weight (lb)', 'Actual reps', 'RPE', 'Split seconds',
    'Interval seconds',
  ]];

  routine.workouts.filter(workout => workout.completedAt).forEach(workout => {
    if (!workout.session?.exercises) {
      workout.exercises.forEach(exercise => {
        const shown = visibleExercise(exercise);
        rows.push([
          routine.name, workout.cycleLabel, workout.weekLabel, workout.sequence, workout.name,
          '', workout.completedAt, '', shown.movement, '', '', 'Legacy completed', shown.weight,
          shown.prescription, '', '', '', '', '',
        ]);
      });
      return;
    }

    const intervals = new Map();
    let previousSplit = 0;
    workout.session.exercises.flatMap(exercise => exercise.sets)
      .filter(set => set.status === 'completed')
      .sort((a, b) => a.splitSeconds - b.splitSeconds)
      .forEach(set => {
        intervals.set(set.id, set.splitSeconds - previousSplit);
        previousSplit = set.splitSeconds;
      });
    workout.session.exercises.forEach(sessionExercise => {
      sessionExercise.sets.forEach(set => {
        const interval = intervals.has(set.id) ? intervals.get(set.id) : '';
        rows.push([
          routine.name, workout.cycleLabel, workout.weekLabel, workout.sequence, workout.name,
          workout.session.startedAt, workout.completedAt, formatSeconds(workout.session.elapsedSeconds),
          sessionExercise.movement, sessionExercise.original?.movement || '', set.number, set.status, set.plannedWeight, set.plannedReps,
          set.actualWeight, set.actualReps,
          sessionExercise.exerciseId === workout.session.primaryExerciseId ? workout.session.rpe : '',
          formatSeconds(set.splitSeconds), interval,
        ]);
      });
    });
  });

  return rows.map(row => row.map(escapeCsv).join(',')).join('\n');
};

export const createRoutine = (profileId, name, inputs) => {
  let sequence = 0;
  const workouts = [];

  buildRoutinePlan(inputs).forEach((cycle, cycleIndex) => {
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

export const duplicateRoutine = (routine, profileId, name) => {
  const timestamp = now();
  return {
    ...routine,
    id: makeId(),
    profileId,
    name,
    inputs: {
      ...routine.inputs,
      microCycles: routine.inputs?.microCycles?.map(cycle => ({ ...cycle })),
    },
    workouts: routine.workouts.map(workout => ({
      ...workout,
      id: makeId(),
      completedAt: null,
      session: null,
      effectiveMaxes: workout.effectiveMaxes ? { ...workout.effectiveMaxes } : workout.effectiveMaxes,
      exercises: workout.exercises.map(exercise => ({
        ...exercise,
        id: makeId(),
        generated: { ...exercise.generated },
        overrides: { ...exercise.overrides },
      })),
    })),
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createRoutineTemplate = (routine, name) => {
  const timestamp = now();
  return {
    id: makeId(),
    name,
    inputs: {
      ...routine.inputs,
      microCycles: routine.inputs?.microCycles?.map(cycle => ({ ...cycle })),
    },
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
    const exercises = workout.exercises.map(exercise => {
      const shown = visibleExercise(exercise);
      const parsed = parsePrescription(shown.prescription);
      return {
        exerciseId: exercise.id,
        movement: shown.movement,
        prescription: shown.prescription,
        plannedWeight: shown.weight,
        original: null,
        substitutedAt: null,
        sets: Array.from({ length: parsed.setCount }, (_, index) => ({
          id: makeId(),
          number: index + 1,
          plannedWeight: shown.weight,
          plannedReps: parsed.plannedReps,
          actualWeight: shown.weight,
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

export const reopenWorkoutSession = (routine, workoutId, timestamp = now()) => updateWorkout(
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
);

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

export const correctMaxes = (routine, maxes) => {
  const inputs = { ...routine.inputs, ...maxes };
  const regenerated = createRoutine(routine.profileId, routine.name, inputs);

  return {
    ...routine,
    inputs,
    updatedAt: now(),
    workouts: routine.workouts.map(workout => {
      const generatedWorkout = regenerated.workouts.find(item => item.sequence === workout.sequence);
      if (workout.completedAt || !generatedWorkout) {
        return workout;
      }
      return {
        ...workout,
        effectiveMaxes: { ...generatedWorkout.effectiveMaxes },
        exercises: generatedWorkout.exercises.map((exercise, exerciseIndex) => ({
          ...exercise,
          id: workout.exercises[exerciseIndex]?.id || exercise.id,
          overrides: workout.exercises[exerciseIndex]?.overrides || {},
        })),
      };
    }),
  };
};

export const cloneImportedRecord = record => ({
  ...record,
  id: makeId(),
  name: `${record.name} (Imported)`,
  createdAt: now(),
  updatedAt: now(),
});
