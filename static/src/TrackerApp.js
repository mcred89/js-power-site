import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkoutSessionHistory, WorkoutSummary } from './components/WorkoutSession';
import { ActiveWorkoutScreen } from './components/EagerTrackerScreens';
import {
  adjustSessionSet,
  archiveRoutine,
  clearExerciseOverrides,
  completeSessionSet,
  correctMaxes,
  createRoutine,
  createRoutineTemplate,
  deleteFutureWorkout,
  duplicateRoutine,
  finishWorkoutSession,
  reopenWorkoutSession,
  restoreRoutine,
  setSessionRpe,
  setWorkoutComplete,
  startWorkoutSession,
  skipRemainingSessionExercise,
  skipSessionSet,
  substituteSessionExercise,
  undoLatestSessionAction,
  updateExercise,
  visibleExercise,
} from './data/routines';
import {
  download,
  sharedTransferContents,
  shareTransfer,
} from './data/transferUi';
import {
  applyBatch,
  get,
  getAll,
  getAllByIndex,
  hasPersistentStorage,
  remove,
  requestPersistentStorage,
  save,
} from './data/storage';
export {
  canShareTransfer,
  createSharedTransferContents,
  createTransferFile,
  download,
  sharedTransferContents,
  shareTransfer,
} from './data/transferUi';

const makeId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const navItems = [
  ['today', 'Today'],
  ['plans', 'Plans'],
  ['history', 'History'],
  ['progress', 'Progress'],
  ['settings', 'Settings'],
];

// Today, workout detail, and the active session stay in this eager graph. Everything reached
// through secondary navigation is requested on demand and can be added verbatim to precache.
const RoutineBuilder = lazy(() => import('./components/RoutineBuilderScreen').then(module => ({ default: module.RoutineBuilderScreen })));
const ProgressScreen = lazy(() => import('./components/ProgressScreen').then(module => ({ default: module.ProgressScreen })));
const HistoryScreen = lazy(() => import('./components/HistoryScreen').then(module => ({ default: module.HistoryScreen })));
const PlansScreen = lazy(() => import('./components/PlansScreen').then(module => ({ default: module.PlansScreen })));
const SettingsScreen = lazy(() => import('./components/SettingsScreen').then(module => ({ default: module.SettingsScreen })));
const loadImportTools = () => import('./data/importBackup');
const DATA_TASKS = {
  PARSE_BACKUP: 'parse-backup', PLAN_IMPORT: 'plan-import',
  CREATE_TRANSFER: 'create-transfer',
  PLAN_CSV: 'plan-csv', HISTORY_CSV: 'history-csv',
};
// Loading the worker client only when Settings data work starts keeps the installed Today shell
// below its entry budget; adding a task must not eagerly import migration, CSV, or crypto code.
const loadDataTaskClient = () => import('./data/dataTaskClient');
const runDataTaskInBackground = (type, payload) => loadDataTaskClient()
  .then(module => module.runDataTaskInBackground(type, payload));
const cancelDataTasks = () => loadDataTaskClient().then(module => module.cancelBackgroundDataTasks());
const ImportPreview = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.ImportPreview })));
const TransferCreator = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.TransferCreator })));
const TransferUnlock = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.TransferUnlock })));
const RoutineTransferCreator = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.RoutineTransferCreator })));
const RoutineDestination = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.RoutineDestination })));
const RoutineCopyDialog = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.RoutineCopyDialog })));
const SaveTemplateDialog = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.SaveTemplateDialog })));
const TrackerNotices = lazy(() => import('./components/TrackerOverlays').then(module => ({ default: module.TrackerNotices })));
const TrackerScreenFallback = ({ label, error, onRetry }) => <div className="loading-screen">
  <p>{error || `Opening ${label}…`}</p>
  {error && <button className="secondary-button" onClick={onRetry}>Retry</button>}
</div>;

export const createSerializedRoutineWriter = persist => {
  let tail = null;
  return (record, persistOverride) => {
    const write = () => persistOverride ? persistOverride(record) : persist('routines', record);
    // A lifecycle flush must enter persistence in the same event turn when the queue is idle.
    // Later writes still chain in order. IndexedDB completion is asynchronous and cannot be
    // guaranteed if the browser kills the page, which is why the session also flushes on hidden.
    let current;
    if (tail) {
      current = tail.then(write, write);
    } else {
      try {
        current = Promise.resolve(write());
      } catch (error) {
        current = Promise.reject(error);
      }
    }
    tail = current;
    const clear = () => { if (tail === current) tail = null; };
    current.then(clear, clear);
    return current;
  };
};

export const commitRoutineLifecycle = async ({ writer, routine, profile, persist, publish }) => {
  // Lifecycle state is not optimistic: routine/session and profile pointer become visible
  // only after their queued multi-store transaction commits. A failed transaction therefore
  // leaves React state and the committed routine ref aligned with IndexedDB.
  await writer(routine, record => persist(record, profile));
  publish(routine, profile);
};

export const completeWorkoutSetWithDraft = (routine, workoutId, exerciseId, setId, draft) => {
  const adjusted = draft
    ? adjustSessionSet(routine, workoutId, exerciseId, setId, draft)
    : routine;
  return completeSessionSet(adjusted, workoutId, exerciseId, setId);
};

export const skipWorkoutSetWithDraft = (routine, workoutId, exerciseId, setId, draft) => {
  const adjusted = draft
    ? adjustSessionSet(routine, workoutId, exerciseId, setId, draft)
    : routine;
  return skipSessionSet(adjusted, workoutId, exerciseId, setId);
};

export const initialProfileId = (profiles, defaultProfileId) => (
  profiles.some(profile => profile.id === defaultProfileId)
    ? defaultProfileId
    : profiles[0]?.id || null
);

export const todayRoutineIds = profile => [...new Set([
  profile?.activeRoutineId,
  profile?.activeWorkoutRoutineId,
].filter(Boolean))];

export const loadInitialTrackerRecords = async storage => {
  const [profiles, savedDefault] = await Promise.all([
    storage.getAll('profiles'), storage.get('metadata', 'defaultProfileId'),
  ]);
  const selectedProfileId = initialProfileId(profiles, savedDefault?.value);
  const selected = profiles.find(item => item.id === selectedProfileId);
  const routineIds = todayRoutineIds(selected);
  let routines = (await Promise.all(routineIds.map(id => storage.get('routines', id))))
    .filter(Boolean);
  // Older or interrupted writes can leave a profile without a usable active-routine
  // pointer even though its routines are still intact. Secondary screens query the full
  // profile index, which previously made Today appear to repair itself after changing tabs.
  // Keep the fast pointed read for normal startup, but recover from a missing/dangling pointer.
  if (selected && (!routineIds.length || routines.length !== routineIds.length)) {
    routines = await storage.getAllByIndex('routines', 'profileId', selected.id);
  }
  return { profiles, routines, selectedProfileId, defaultProfileId: savedDefault?.value || null };
};

export const mergeRoutineRead = (current, records, requestedGeneration, currentGeneration) => {
  if (requestedGeneration !== currentGeneration) return current;
  const known = new Map(current.map(item => [item.id, item]));
  records.filter(Boolean).forEach(item => {
    // A read begun before an action may contain an older copy. Only fill cache misses;
    // explicit writes already keep the in-memory record current.
    if (!known.has(item.id)) known.set(item.id, item);
  });
  return [...known.values()];
};

export const createControllerChangeHandler = (initiallyControlled, reloadPage) => {
  let wasControlled = initiallyControlled;
  let reloading = false;
  return () => {
    // The first controller on a pristine install makes the current page
    // controlled; only a later replacement controller represents an update.
    if (!wasControlled) {
      wasControlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    reloadPage();
  };
};

export const trackerLoadPolicy = view => ({
  profileRoutines: ['plans', 'history', 'progress'].includes(view),
  templates: ['plans', 'builder', 'settings'].includes(view),
  persistence: view === 'settings',
});

export const importPlanBatch = plan => ({
  puts: {
    profiles: plan.profiles.filter(item => item.action !== 'skip').map(item => item.result),
    routines: plan.routines.filter(item => item.action !== 'skip').map(item => item.result),
    templates: (plan.templates || []).filter(item => item.action !== 'skip').map(item => item.result),
  },
  conditions: {
    profiles: plan.profiles.map(item => ({ key: item.imported.id, expected: item.local })),
    routines: plan.routines.map(item => ({ key: item.imported.id, expected: item.local })),
    templates: (plan.templates || []).map(item => ({ key: item.imported.id, expected: item.local })),
  },
});

export const activateRoutineImport = (plan, destinationProfile, routineId, updatedAt = new Date().toISOString()) => {
  const updatedProfile = {
    ...destinationProfile,
    activeRoutineId: routineId,
    updatedAt,
  };
  const plannedProfile = plan.profiles.find(item => item.result.id === destinationProfile.id);
  if (!plannedProfile) {
    return {
      ...plan,
      routineActivation: { profileId: destinationProfile.id, routineId },
      profiles: [...plan.profiles, {
        type: 'profile',
        status: 'conflict',
        action: 'merge',
        imported: updatedProfile,
        local: destinationProfile,
        result: updatedProfile,
      }],
    };
  }
  return {
    ...plan,
    routineActivation: { profileId: destinationProfile.id, routineId },
    profiles: plan.profiles.map(item => item === plannedProfile ? {
      ...item,
      action: item.action === 'skip' ? 'merge' : item.action,
      imported: { ...item.imported, activeRoutineId: routineId, updatedAt },
      result: { ...item.result, activeRoutineId: routineId, updatedAt },
    } : item),
  };
};

export const profileWithActiveWorkout = (profile, routineId, updatedAt = new Date().toISOString()) => ({
  ...profile,
  activeWorkoutRoutineId: routineId,
  updatedAt,
});

export const profileAfterFinishedRoutine = (profile, routineId, updatedAt = new Date().toISOString()) => (
  profile.activeWorkoutRoutineId === routineId
    ? profileWithActiveWorkout(profile, null, updatedAt)
    : profile
);

const safeFilename = value => value.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'routine';

const ProfileForm = ({ onSave, title = 'Who is training?' }) => {
  const [name, setName] = useState('');
  return (
    <form className="empty-card profile-form" onSubmit={event => {
      event.preventDefault();
      onSave(name.trim());
      setName('');
    }}>
      <p className="eyebrow">Local profile</p>
      <h1>{title}</h1>
      <p>Profiles keep routines separate on this phone. Nothing is uploaded.</p>
      <label className="form-field">
        <span className="field-label">Name</span>
        <input className="number-input" value={name} onChange={event => setName(event.target.value)} required autoFocus />
      </label>
      <button className="primary-button" type="submit">Create profile</button>
    </form>
  );
};

const WorkoutExercises = ({ routine, workout, editable, onChange }) => (
  <div className="exercise-list">
    {workout.exercises.map(exercise => {
      const shown = visibleExercise(exercise);
      return (
        <div className="exercise-row" key={exercise.id}>
          {editable ? (
            <>
              <input aria-label="Movement" defaultValue={shown.movement} onBlur={event => onChange(exercise.id, { movement: event.target.value })} />
              <input aria-label="Weight" inputMode="decimal" defaultValue={shown.weight} placeholder="Weight" onBlur={event => onChange(exercise.id, { weight: event.target.value })} />
              <input aria-label="Prescription" defaultValue={shown.prescription} placeholder="Prescription" onBlur={event => onChange(exercise.id, { prescription: event.target.value })} />
              <button className="text-button" type="button" onClick={() => onChange(exercise.id, null)}>Use generated</button>
            </>
          ) : (
            <>
              <div><strong>{shown.movement}</strong><span>{shown.prescription || 'No prescription'}</span></div>
              {shown.weight !== '' && <b>{shown.weight} lb</b>}
            </>
          )}
        </div>
      );
    })}
  </div>
);

const WorkoutMaxes = ({ workout }) => workout.effectiveMaxes ? (
  <small className="workout-maxes">
    Maxes: Squat {workout.effectiveMaxes.maxSquat} · Press {workout.effectiveMaxes.maxPress} · Deadlift {workout.effectiveMaxes.maxDead} lb
  </small>
) : null;

export const formatCompletedDate = completedAt => new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(completedAt));

export const WorkoutCard = ({ workout, onOpen }) => (
  <button className="workout-card" type="button" onClick={onOpen}>
    <span><small>{workout.cycleLabel ? `${workout.cycleLabel} · ` : ''}{workout.weekLabel}</small><strong>{workout.name}</strong>{workout.completedAt && <small>Completed {formatCompletedDate(workout.completedAt)}</small>}<WorkoutMaxes workout={workout} /></span>
    <span aria-hidden="true">→</span>
  </button>
);

const MaxCorrection = ({ routine, onCorrect }) => {
  const [maxes, setMaxes] = useState({
    maxSquat: routine.inputs.maxSquat,
    maxPress: routine.inputs.maxPress,
    maxDead: routine.inputs.maxDead,
  });
  return (
    <form className="max-correction" onSubmit={event => { event.preventDefault(); onCorrect(maxes); }}>
      <p className="field-help">Completed workouts stay unchanged. Future generated weights update immediately.</p>
      <div className="field-grid three-fields">
        {[
          ['maxSquat', 'Squat max'],
          ['maxPress', 'Press max'],
          ['maxDead', 'Deadlift max'],
        ].map(([key, label]) => (
          <label className="form-field" key={key}>
            <span className="field-label">{label}</span>
            <input className="number-input" type="number" min="1" required value={maxes[key]} onChange={event => setMaxes({ ...maxes, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <button className="secondary-button" type="submit">Update future workouts</button>
    </form>
  );
};

export const templateBuilderInputs = template => ({
  ...template.inputs,
  microCycles: template.inputs?.microCycles?.map(cycle => ({ ...cycle })),
  maxSquat: '',
  maxPress: '',
  maxDead: '',
  squatIncrement: '',
  pressIncrement: '',
  deadliftIncrement: '',
});

export const RoutineNameEditor = ({ routine, onSave, label = 'Routine' }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(routine.name);

  const cancel = () => {
    setName(routine.name);
    setEditing(false);
  };

  if (!editing) return <button className="text-button" type="button" onClick={() => setEditing(true)}>Rename</button>;

  return (
    <form className="routine-name-editor" onSubmit={event => {
      event.preventDefault();
      const nextName = name.trim();
      if (!nextName) return;
      onSave(nextName);
      setEditing(false);
    }}>
      <label className="form-field">
        <span className="field-label">{label} name</span>
        <input aria-label={`${label} name`} className="number-input" value={name} onChange={event => setName(event.target.value)} required autoFocus />
      </label>
      <div className="button-row">
        <button className="secondary-button" type="submit">Save name</button>
        <button className="text-button" type="button" onClick={cancel}>Cancel</button>
      </div>
    </form>
  );
};

export const ConfirmationModal = ({ title, children, confirmLabel, onCancel, onConfirm }) => (
  <div className="modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onCancel();
  }}>
    <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
      <h2 id="confirmation-title">{title}</h2>
      <p>{children}</p>
      <div className="button-row modal-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="danger-button" type="button" onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </section>
  </div>
);

const setupValue = value => value === true ? 'Yes' : value === false ? 'No' : value || 'Not set';

export const PlanSetup = ({ routine }) => {
  const { inputs = {} } = routine;
  const eventLifts = [['squat', 'Squat day'], ['press', 'Press day'], ['deadlift', 'Deadlift day']];

  return (
    <details className="settings-card plan-setup">
      <summary>View plan setup</summary>
      <div className="setup-section">
        <h3>Starting maxes</h3>
        <dl className="setup-grid">
          <div><dt>Squat</dt><dd>{setupValue(inputs.maxSquat)} lb</dd></div>
          <div><dt>Press</dt><dd>{setupValue(inputs.maxPress)} lb</dd></div>
          <div><dt>Deadlift</dt><dd>{setupValue(inputs.maxDead)} lb</dd></div>
        </dl>
      </div>
      <div className="setup-section">
        <h3>Cycle structure</h3>
        {inputs.mesoMode ? (
          <>
            <p>Mesocycle with {inputs.microCycles?.length || 0} microcycles</p>
            <ol className="setup-cycles">
              {(inputs.microCycles || []).map((cycle, index) => <li key={index}>Cycle {index + 1}: {setupValue(cycle.duration)}, {setupValue(cycle.volume)} volume</li>)}
            </ol>
            <dl className="setup-grid">
              <div><dt>Squat increase</dt><dd>{setupValue(inputs.squatIncrement)} lb</dd></div>
              <div><dt>Press increase</dt><dd>{setupValue(inputs.pressIncrement)} lb</dd></div>
              <div><dt>Deadlift increase</dt><dd>{setupValue(inputs.deadliftIncrement)} lb</dd></div>
            </dl>
          </>
        ) : <p>{setupValue(inputs.duration)} · {setupValue(inputs.mainLiftChoice)} volume</p>}
      </div>
      <div className="setup-section">
        <h3>Options</h3>
        <dl className="setup-grid">
          <div><dt>Back-off sets</dt><dd>{setupValue(inputs.includeBackoffSets)}</dd></div>
          <div><dt>Dedicated Strongman day</dt><dd>{setupValue(inputs.includeStrongmanDay)}</dd></div>
          <div><dt>Press weak point</dt><dd>{setupValue(inputs.pressWeakPoint)}</dd></div>
          <div><dt>Deadlift weak point</dt><dd>{setupValue(inputs.deadliftWeakPoint)}</dd></div>
        </dl>
      </div>
      <div className="setup-section">
        <h3>Strongman events</h3>
        <dl className="setup-events">
          {eventLifts.map(([key, label]) => {
            const enabled = inputs[`${key}EventEnabled`];
            return <div key={key}><dt>{label}</dt><dd>{enabled ? `${setupValue(inputs[`${key}EventMovement`])} · ${setupValue(inputs[`${key}EventSets`])} sets × ${setupValue(inputs[`${key}EventReps`])} reps` : 'None'}</dd></div>;
          })}
        </dl>
      </div>
    </details>
  );
};

const AppearanceControl = ({ appearance, onChange }) => (
  <label className="form-field appearance-control">
    <span className="field-label">Appearance</span>
    <select className="number-input" value={appearance} onChange={event => onChange(event.target.value)}>
      <option value="system">Use device setting</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>
);

const TrackerApp = ({ appearance, onAppearanceChange }) => {
  const [profiles, setProfiles] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [defaultProfileId, setDefaultProfileId] = useState(null);
  const [selectedRoutineId, setSelectedRoutineId] = useState(null);
  const [view, setView] = useState('today');
  const [workoutId, setWorkoutId] = useState(null);
  const [editingWorkout, setEditingWorkout] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [persistent, setPersistent] = useState(false);
  const [profileRoutinesLoaded, setProfileRoutinesLoaded] = useState(false);
  const [profileRoutinesError, setProfileRoutinesError] = useState('');
  const [profileRoutinesRetry, setProfileRoutinesRetry] = useState(0);
  const [todayRoutinesLoaded, setTodayRoutinesLoaded] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [showAllPending, setShowAllPending] = useState(false);
  const [workoutToDelete, setWorkoutToDelete] = useState(null);
  const [finishPrompt, setFinishPrompt] = useState(null);
  const [importPlan, setImportPlan] = useState(null);
  const [createdTransfer, setCreatedTransfer] = useState(null);
  const [transferFile, setTransferFile] = useState(null);
  const [choosingRoutineTransfer, setChoosingRoutineTransfer] = useState(false);
  const [receivedRoutine, setReceivedRoutine] = useState(null);
  const [copyRequest, setCopyRequest] = useState(null);
  const [templateSource, setTemplateSource] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [builderTemplate, setBuilderTemplate] = useState(null);
  const [workoutSummary, setWorkoutSummary] = useState(null);
  const [dataTaskBusy, setDataTaskBusy] = useState(false);
  const importRef = useRef();
  const transferRef = useRef();
  const incomingTransferRef = useRef(false);
  const overlayTaskRef = useRef(null);
  const routinesRef = useRef([]);
  const loadedProfileRoutinesFor = useRef();
  const profileLoadGeneration = useRef(0);
  const todayLoadGeneration = useRef(0);
  const routineWriterRef = useRef();
  if (!routineWriterRef.current) routineWriterRef.current = createSerializedRoutineWriter(save);
  const showWorkout = useCallback(target => {
    setWorkoutId(target.id);
    setEditingWorkout(false);
  }, []);

  useEffect(() => {
    routinesRef.current = routines;
  }, [routines]);

  useEffect(() => {
    loadInitialTrackerRecords({ getAll, get, getAllByIndex })
      .then(({ profiles: savedProfiles, routines: startupRoutines, defaultProfileId: savedDefaultId, selectedProfileId: selectedId }) => {
        setProfiles(savedProfiles);
        setRoutines(startupRoutines);
        setDefaultProfileId(savedDefaultId);
        setSelectedProfileId(selectedId);
        setTodayRoutinesLoaded(true);
      })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  const profile = profiles.find(item => item.id === selectedProfileId);
  const todayRoutineKey = todayRoutineIds(profile).join('|');
  const todayIds = useMemo(() => todayRoutineKey ? todayRoutineKey.split('|') : [], [todayRoutineKey]);

  useEffect(() => {
    if (loading || !selectedProfileId) return undefined;
    const generation = ++todayLoadGeneration.current;
    setTodayRoutinesLoaded(false);
    Promise.all(todayIds
      .map(id => get('routines', id)))
      .then(records => {
        if (generation !== todayLoadGeneration.current) return;
        // Merge by id instead of replacing the cache: a slower read must not discard a
        // routine already updated by an action in this page session.
        setRoutines(current => mergeRoutineRead(current, records, generation, todayLoadGeneration.current));
        setTodayRoutinesLoaded(true);
      })
      .catch(error => { if (generation === todayLoadGeneration.current) setMessage(error.message); });
    return () => { todayLoadGeneration.current += 1; };
  }, [loading, selectedProfileId, todayIds]);

  useEffect(() => {
    if (loading || !selectedProfileId || !trackerLoadPolicy(view).profileRoutines) return;
    if (loadedProfileRoutinesFor.current === selectedProfileId) {
      setProfileRoutinesLoaded(true);
      return;
    }
    const generation = ++profileLoadGeneration.current;
    setProfileRoutinesLoaded(false);
    setProfileRoutinesError('');
    getAllByIndex('routines', 'profileId', selectedProfileId).then(records => {
      if (generation !== profileLoadGeneration.current) return;
      setRoutines(current => {
        const known = new Map(current.map(item => [item.id, item]));
        records.forEach(item => {
          const cached = known.get(item.id);
          if (!cached || String(item.updatedAt || '') >= String(cached.updatedAt || '')) known.set(item.id, item);
        });
        return [...known.values()];
      });
      // A full profile index read is reusable across secondary screens. Routine
      // actions keep this cache coherent through their normal state updates; only
      // operations that replace an unknown portion of storage invalidate it.
      loadedProfileRoutinesFor.current = selectedProfileId;
      setProfileRoutinesLoaded(true);
    }).catch(error => {
      if (generation !== profileLoadGeneration.current) return;
      setProfileRoutinesError(error.message);
    });
    return () => { profileLoadGeneration.current += 1; };
  }, [loading, profileRoutinesRetry, selectedProfileId, view]);

  useEffect(() => {
    if (loading || !trackerLoadPolicy(view).templates || templatesLoaded) return;
    getAll('templates').then(records => { setTemplates(records); setTemplatesLoaded(true); })
      .catch(error => setMessage(error.message));
  }, [loading, templatesLoaded, view]);

  useEffect(() => {
    if (!trackerLoadPolicy(view).persistence) return;
    hasPersistentStorage().then(setPersistent).catch(error => setMessage(error.message));
  }, [view]);

  useEffect(() => {
    const handleUpdate = event => setUpdateRegistration(event.detail);
    let disposed = false;
    let stopObservingUpdates = () => {};
    const reload = createControllerChangeHandler(
      Boolean(navigator.serviceWorker?.controller),
      () => window.location.reload(),
    );
    window.addEventListener('app-update-available', handleUpdate);
    navigator.serviceWorker?.addEventListener('controllerchange', reload);
    import('./serviceWorkerUpdates').then(({ observeServiceWorkerUpdates }) => {
      const stop = observeServiceWorkerUpdates(setUpdateRegistration);
      if (disposed) stop();
      else stopObservingUpdates = stop;
    });
    return () => {
      disposed = true;
      window.removeEventListener('app-update-available', handleUpdate);
      navigator.serviceWorker?.removeEventListener('controllerchange', reload);
      stopObservingUpdates();
      // The shared client owns every backup, CSV, transfer, and import task.
      cancelDataTasks();
    };
  }, []);

  // Partition once when stored routines change. These lists feed most tracker views, so
  // avoiding three full filter/sort passes also prevents incidental UI state from rescanning
  // a large history while preserving the existing newest-first ordering.
  const { profileRoutines, archivedRoutines, progressRoutines } = useMemo(() => {
    const active = [];
    const archived = [];
    routines.forEach(item => {
      if (item.profileId !== selectedProfileId) return;
      (item.archived ? archived : active).push(item);
    });
    const newestFirst = (left, right) => right.updatedAt.localeCompare(left.updatedAt);
    active.sort(newestFirst);
    archived.sort(newestFirst);
    return {
      profileRoutines: active,
      archivedRoutines: archived,
      progressRoutines: [...active, ...archived].sort(newestFirst),
    };
  }, [routines, selectedProfileId]);
  const routine = profileRoutines.find(item => item.id === selectedRoutineId) ||
    profileRoutines.find(item => item.id === profile?.activeRoutineId) || profileRoutines[0];
  const { workout, pending, completed } = useMemo(() => {
    const nextPending = [];
    const nextCompleted = [];
    let selectedWorkout;
    (routine?.workouts || []).forEach(item => {
      if (item.id === workoutId) selectedWorkout = item;
      (item.completedAt ? nextCompleted : nextPending).push(item);
    });
    // History has always shown the routine's completed snapshots in reverse queue order.
    nextCompleted.reverse();
    return { workout: selectedWorkout, pending: nextPending, completed: nextCompleted };
  }, [routine, workoutId]);
  const activeEntry = useMemo(() => {
    for (const item of profileRoutines) {
      const activeWorkout = item.workouts.find(day => day.session?.status === 'inProgress');
      if (activeWorkout) return { routine: item, workout: activeWorkout };
    }
    return undefined;
  }, [profileRoutines]);

  useEffect(() => {
    if (routine && routine.id !== selectedRoutineId) setSelectedRoutineId(routine.id);
  }, [routine, selectedRoutineId]);

  const flash = text => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3000);
  };

  const loadAllData = async () => {
    const [allProfiles, allRoutines, allTemplates] = await Promise.all([
      getAll('profiles'), getAll('routines'), getAll('templates'),
    ]);
    setProfiles(allProfiles);
    setRoutines(allRoutines);
    routinesRef.current = allRoutines;
    setTemplates(allTemplates);
    setTemplatesLoaded(true);
    loadedProfileRoutinesFor.current = null;
    return { profiles: allProfiles, routines: allRoutines, templates: allTemplates };
  };

  const addProfile = async name => {
    const item = { id: makeId(), name, activeWorkoutRoutineId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const shouldMakeDefault = profiles.length === 0;
    // The first profile and its default pointer are one logical record. Never publish either
    // in React unless the shared IndexedDB transaction commits both of them.
    await applyBatch({ puts: {
      profiles: [item],
      ...(shouldMakeDefault ? { metadata: [{ key: 'defaultProfileId', value: item.id }] } : {}),
    } });
    setProfiles(current => [...current, item]);
    if (shouldMakeDefault) setDefaultProfileId(item.id);
    setSelectedProfileId(item.id);
    setAddingProfile(false);
    setView('today');
  };

  const publishRoutine = updated => {
    routinesRef.current = routinesRef.current.map(item => item.id === updated.id ? updated : item);
    setRoutines(routinesRef.current);
  };

  const saveRoutine = async (updated, persistOverride, publishAfterCommit = false) => {
    if (!publishAfterCommit) publishRoutine(updated);
    await routineWriterRef.current(updated, persistOverride);
    if (publishAfterCommit) publishRoutine(updated);
  };

  const changeSelectedRoutine = transform => {
    const current = routinesRef.current.find(item => item.id === routine.id) || routine;
    return saveRoutine(transform(current));
  };

  const addRoutine = async (name, inputs) => {
    const item = createRoutine(profile.id, name, inputs);
    const updatedProfile = { ...profile, activeRoutineId: item.id, updatedAt: new Date().toISOString() };
    await applyBatch({ puts: { routines: [item], profiles: [updatedProfile] } });
    setRoutines(current => [...current, item]);
    setProfiles(current => current.map(entry => entry.id === updatedProfile.id ? updatedProfile : entry));
    setSelectedRoutineId(item.id);
    setBuilderTemplate(null);
    setView('today');
    flash('Routine created on this phone.');
  };

  const selectRoutine = async item => {
    const updatedProfile = { ...profile, activeRoutineId: item.id, updatedAt: new Date().toISOString() };
    await save('profiles', updatedProfile);
    setProfiles(current => current.map(entry => entry.id === updatedProfile.id ? updatedProfile : entry));
    setSelectedRoutineId(item.id);
  };

  const renameRoutine = async (item, name) => {
    await saveRoutine({ ...item, name, updatedAt: new Date().toISOString() });
    flash('Routine renamed.');
  };

  const addCopiedRoutine = async item => {
    const destinationProfile = profiles.find(entry => entry.id === item.profileId);
    if (!destinationProfile) return;
    const updatedProfile = { ...destinationProfile, activeRoutineId: item.id, updatedAt: new Date().toISOString() };
    await applyBatch({ puts: { routines: [item], profiles: [updatedProfile] } });
    setRoutines(current => [...current, item]);
    setProfiles(current => current.map(entry => entry.id === updatedProfile.id ? updatedProfile : entry));
    setSelectedProfileId(item.profileId);
    setSelectedRoutineId(item.id);
    setWorkoutId(null);
    setView('plans');
  };

  const confirmRoutineCopy = async (destination, name) => {
    const item = duplicateRoutine(copyRequest.item, destination, name);
    await addCopiedRoutine(item);
    setCopyRequest(null);
    flash('Routine copied. The original is unchanged.');
  };

  const saveRoutineTemplate = async name => {
    const item = createRoutineTemplate(templateSource, name);
    await save('templates', item);
    setTemplates(current => [...current, item]);
    setTemplateSource(null);
    flash('Template saved on this phone.');
  };

  const renameTemplate = async (item, name) => {
    const updated = { ...item, name, updatedAt: new Date().toISOString() };
    await save('templates', updated);
    setTemplates(current => current.map(entry => entry.id === item.id ? updated : entry));
    flash('Template renamed.');
  };

  const deleteTemplate = async () => {
    if (!templateToDelete) return;
    await remove('templates', templateToDelete.id);
    setTemplates(current => current.filter(item => item.id !== templateToDelete.id));
    setTemplateToDelete(null);
    flash('Template deleted.');
  };

  const completeWorkout = async (target, complete = true) => {
    const updated = setWorkoutComplete(routine, target.id, complete);
    await saveRoutine(updated);
    setWorkoutId(null);
    setEditingWorkout(false);
    flash(complete ? 'Workout complete.' : 'Workout returned to your queue.');
  };

  const resumeActiveWorkout = () => {
    if (!activeEntry) return;
    setSelectedRoutineId(activeEntry.routine.id);
    setWorkoutId(activeEntry.workout.id);
    setEditingWorkout(false);
  };

  const startWorkout = async target => {
    if (activeEntry && activeEntry.workout.id !== target.id) {
      resumeActiveWorkout();
      flash('Resume your active workout before starting another.');
      return;
    }
    const current = routinesRef.current.find(item => item.id === routine.id) || routine;
    const updatedRoutine = startWorkoutSession(current, target.id);
    const updatedProfile = profileWithActiveWorkout(profile, routine.id);
    await saveRoutine(updatedRoutine, record => applyBatch({
      puts: { routines: [record], profiles: [updatedProfile] },
    }), true);
    setProfiles(items => items.map(item => item.id === updatedProfile.id ? updatedProfile : item));
  };

  const adjustWorkoutSet = async (exerciseId, setId, values) => {
    await changeSelectedRoutine(current => adjustSessionSet(current, workout.id, exerciseId, setId, values));
  };

  const completeWorkoutSet = async (exerciseId, setId, draft) => {
    await changeSelectedRoutine(current => (
      completeWorkoutSetWithDraft(current, workout.id, exerciseId, setId, draft)
    ));
  };

  const undoWorkoutSet = async () => {
    await changeSelectedRoutine(current => undoLatestSessionAction(current, workout.id));
  };

  const skipWorkoutSet = async (exerciseId, setId, draft) => {
    await changeSelectedRoutine(current => (
      skipWorkoutSetWithDraft(current, workout.id, exerciseId, setId, draft)
    ));
  };

  const skipWorkoutExercise = async (exerciseId, setId, draft) => {
    await changeSelectedRoutine(current => {
      const adjusted = draft && setId
        ? adjustSessionSet(current, workout.id, exerciseId, setId, draft)
        : current;
      return skipRemainingSessionExercise(adjusted, workout.id, exerciseId);
    });
  };

  const substituteWorkoutExercise = async (exerciseId, values) => {
    await changeSelectedRoutine(current => substituteSessionExercise(current, workout.id, exerciseId, values));
  };

  const setWorkoutRpe = async rpe => {
    await changeSelectedRoutine(current => setSessionRpe(current, workout.id, rpe));
  };

  const requestFinishWorkout = () => {
    const pendingSets = workout.session.exercises.reduce((total, exercise) => (
      total + exercise.sets.filter(set => set.status === 'pending').length
    ), 0);
    if (pendingSets || !workout.session.rpe) {
      setFinishPrompt({ pendingSets, missingRpe: !workout.session.rpe });
      return;
    }
    finishActiveWorkout();
  };

  const finishActiveWorkout = async () => {
    const current = routinesRef.current.find(item => item.id === routine.id) || routine;
    const updated = finishWorkoutSession(current, workout.id);
    const updatedProfile = profileAfterFinishedRoutine(profile, routine.id);
    const shouldClear = updatedProfile !== profile;
    await saveRoutine(updated, record => applyBatch({
      puts: {
        routines: [record],
        ...(shouldClear ? { profiles: [updatedProfile] } : {}),
      },
    }), true);
    if (shouldClear) setProfiles(items => items.map(item => item.id === updatedProfile.id ? updatedProfile : item));
    setWorkoutSummary(updated.workouts.find(item => item.id === workout.id));
    setFinishPrompt(null);
    setWorkoutId(null);
  };

  const archivePlan = async item => {
    if (item.workouts.some(day => day.session?.status === 'inProgress')) {
      flash('Finish the workout in progress before archiving this plan.');
      return;
    }
    const updated = archiveRoutine(item);
    const remaining = profileRoutines.filter(entry => entry.id !== item.id);
    const replacement = remaining[0] || null;
    // The rendered fallback routine can differ from the durable profile pointer. Only clear
    // the pointer when the archived record is the one the profile actually selected.
    const profileUpdate = item.id === profile.activeRoutineId
      ? { ...profile, activeRoutineId: replacement?.id || null, updatedAt: new Date().toISOString() }
      : null;
    await applyBatch({ puts: {
      routines: [updated],
      ...(profileUpdate ? { profiles: [profileUpdate] } : {}),
    } });
    setRoutines(current => current.map(entry => entry.id === item.id ? updated : entry));
    if (profileUpdate) {
      setProfiles(current => current.map(entry => entry.id === profile.id ? profileUpdate : entry));
      setSelectedRoutineId(replacement?.id || null);
    }
    flash(`${item.name} archived.`);
  };

  const restorePlan = async item => {
    const updated = restoreRoutine(item);
    await save('routines', updated);
    setRoutines(current => current.map(entry => entry.id === item.id ? updated : entry));
    flash(`${item.name} restored.`);
  };

  const reopenCompletedWorkout = async target => {
    if (activeEntry && activeEntry.workout.id !== target.id) {
      resumeActiveWorkout();
      flash('Finish your active workout before reopening another.');
      return;
    }
    if (target.session) {
      const current = routinesRef.current.find(item => item.id === routine.id) || routine;
      const updatedRoutine = reopenWorkoutSession(current, target.id);
      const updatedProfile = profileWithActiveWorkout(profile, routine.id);
      await saveRoutine(updatedRoutine, record => applyBatch({
        puts: { routines: [record], profiles: [updatedProfile] },
      }), true);
      setProfiles(items => items.map(item => item.id === updatedProfile.id ? updatedProfile : item));
      flash('Workout returned to your queue.');
      return;
    }
    completeWorkout(target, false);
  };

  const confirmDeleteWorkout = async () => {
    if (!workoutToDelete || workoutToDelete.completedAt) return;
    await saveRoutine(deleteFutureWorkout(routine, workoutToDelete.id));
    setWorkoutToDelete(null);
    setWorkoutId(null);
    setEditingWorkout(false);
    flash('Future workout deleted.');
  };

  const editExercise = async (exerciseId, values) => {
    const updated = values
      ? updateExercise(routine, workout.id, exerciseId, values)
      : clearExerciseOverrides(routine, workout.id, exerciseId);
    await saveRoutine(updated);
  };

  const importBackupFile = async file => {
    if (dataTaskBusy) return;
    setDataTaskBusy(true);
    try {
      const backup = await runDataTaskInBackground(DATA_TASKS.PARSE_BACKUP, { contents: await file.text() });
      const local = await loadAllData();
      setImportPlan(await runDataTaskInBackground(DATA_TASKS.PLAN_IMPORT, { backup, ...local }));
    } catch (error) {
      flash(error.message);
    } finally {
      setDataTaskBusy(false);
    }
  };

  const makeTransfer = async () => {
    if (dataTaskBusy) return;
    setDataTaskBusy(true);
    try {
      const local = await loadAllData();
      const transfer = await runDataTaskInBackground(DATA_TASKS.CREATE_TRANSFER, { data: {
        format: 'mcilroy-method-backup', version: 7, dataSchemaVersion: 7,
        exportedAt: new Date().toISOString(), ...local,
      }, options: { compress: true } });
      setCreatedTransfer({
        ...transfer,
        filename: `mcilroy-method-transfer-${new Date().toISOString().slice(0, 10)}.txt`,
      });
    } catch (error) {
      flash(error.message);
    } finally {
      setDataTaskBusy(false);
    }
  };

  const downloadRoutineCsv = async (type, suffix) => {
    if (dataTaskBusy || !routine) return;
    setDataTaskBusy(true);
    try {
      const chunks = await runDataTaskInBackground(type, { routine });
      download(chunks, `${safeFilename(routine.name)}-${suffix}.csv`, 'text/csv;charset=utf-8');
    } catch (error) {
      flash(error.message);
    } finally {
      setDataTaskBusy(false);
    }
  };

  const unlockTransferContents = async (contents, key) => {
    if (dataTaskBusy) return;
    setDataTaskBusy(true);
    const task = {};
    overlayTaskRef.current = task;
    try {
      const local = await loadAllData();
      if (overlayTaskRef.current !== task) return;
      const result = await runDataTaskInBackground('open-transfer-plan', { contents, key, local });
      if (overlayTaskRef.current !== task) return;
      setTransferFile(null);
      if (result.routine) setReceivedRoutine(result.routine);
      else setImportPlan(result.plan);
    } catch (error) {
      if (error.name !== 'AbortError') flash(error.message);
    } finally {
      if (overlayTaskRef.current === task) {
        overlayTaskRef.current = null;
        setDataTaskBusy(false);
      }
    }
  };

  const unlockTransfer = async key => unlockTransferContents(await transferFile.text(), key);

  const receiveTransferFile = async file => {
    try {
      const contents = await file.text();
      const shared = sharedTransferContents(contents);
      if (shared) await unlockTransferContents(shared.contents, shared.key);
      else setTransferFile(file);
    } catch (error) {
      flash(error.message);
    }
  };

  const createRoutineTransfer = async routineId => {
    if (dataTaskBusy) return;
    const selected = routines.find(item => item.id === routineId);
    if (!selected) return;
    setDataTaskBusy(true);
    try {
      const task = runDataTaskInBackground(DATA_TASKS.CREATE_TRANSFER, { data: {
        format: 'mcilroy-method-routine-transfer',
        version: 1,
        profileName: profiles.find(item => item.id === selected.profileId)?.name || 'Imported profile',
        routine: selected,
      }, options: { compress: true } });
      overlayTaskRef.current = task;
      const transfer = await task;
      if (overlayTaskRef.current !== task) return;
      setChoosingRoutineTransfer(false);
      setCreatedTransfer({
        ...transfer,
        filename: `${safeFilename(selected.name)}-${new Date().toISOString().slice(0, 10)}.txt`,
      });
    } catch (error) {
      if (error.name !== 'AbortError') flash(error.message);
    } finally {
      overlayTaskRef.current = null;
      setDataTaskBusy(false);
    }
  };

  const sendTransfer = async () => {
    try {
      await shareTransfer(createdTransfer);
    } catch (error) {
      if (error.name !== 'AbortError') flash('The phone could not share this transfer. Download the file instead.');
    }
  };

  useEffect(() => {
    if (loading || incomingTransferRef.current ||
        !new URLSearchParams(window.location.search).has('incoming-transfer')) return;
    incomingTransferRef.current = true;
    window.history.replaceState({}, '', '/');
    fetch('/incoming-transfer')
      .then(response => {
        if (!response.ok) throw new Error('The shared transfer could not be opened.');
        return response.json();
      })
      .then(shared => receiveTransferFile(new File(
        [shared.contents],
        shared.name || 'mcilroy-method-transfer.txt',
        { type: 'text/plain' },
      )))
      .catch(error => flash(error.message));
  // The share-target URL is consumed only once when the installed app launches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const chooseRoutineDestination = async (destination, name) => {
    const local = await loadAllData();
    const profileId = destination === 'new' ? makeId() : destination;
    const destinationProfile = destination === 'new'
      ? { id: profileId, name, activeWorkoutRoutineId: null, createdAt: new Date().toISOString() }
      : local.profiles.find(item => item.id === profileId);
    const incomingProfiles = destination === 'new' ? [destinationProfile] : [];
    const incomingRoutine = { ...receivedRoutine.routine, profileId };
    setReceivedRoutine(null);
    const plan = await runDataTaskInBackground(DATA_TASKS.PLAN_IMPORT, {
      backup: { profiles: incomingProfiles, routines: [incomingRoutine], templates: [] }, ...local,
    });
    setImportPlan(activateRoutineImport(plan, destinationProfile, incomingRoutine.id));
  };

  const confirmImport = async () => {
    if (dataTaskBusy) return;
    setDataTaskBusy(true);
    try {
      const { importPlanSummary } = await loadImportTools();
      // An import preview describes one user decision. All stores commit together so an
      // invalid record, quota error, or abort cannot leave a partially imported backup.
      await applyBatch(importPlanBatch(importPlan));
      const profileResults = new Map(importPlan.profiles.map(item => [item.imported.id, item.result]));
      const routineResults = new Map(importPlan.routines.map(item => [item.imported.id, item.result]));
      const templateResults = new Map(importPlan.templates.map(item => [item.imported.id, item.result]));
      setProfiles(current => [...current.filter(item => !profileResults.has(item.id)), ...profileResults.values()]);
      setRoutines(current => [...current.filter(item => !routineResults.has(item.id)), ...routineResults.values()]);
      setTemplates(current => [...current.filter(item => !templateResults.has(item.id)), ...templateResults.values()]);
      // Import plans may describe only changed records, so the in-memory routine
      // list no longer proves that any profile is a complete indexed snapshot.
      loadedProfileRoutinesFor.current = null;
      setProfileRoutinesLoaded(false);
      const summary = importPlanSummary(importPlan);
      setImportPlan(null);
      flash(`Import complete: ${summary.copy} copied, ${summary.merge} merged, ${summary.skip} skipped.`);
    } catch (error) {
      if (error.name === 'BatchConflictError') {
        const local = await loadAllData();
        const backup = {
          profiles: importPlan.profiles.map(item => item.imported),
          routines: importPlan.routines.map(item => item.imported),
          templates: (importPlan.templates || []).map(item => item.imported),
        };
        const replanned = await runDataTaskInBackground(DATA_TASKS.PLAN_IMPORT, { backup, ...local });
        const activation = importPlan.routineActivation;
        setImportPlan(activation
          ? activateRoutineImport(
            replanned,
            local.profiles.find(item => item.id === activation.profileId) ||
              importPlan.profiles.find(item => item.result.id === activation.profileId).result,
            activation.routineId,
          )
          : replanned);
      }
      flash(error.message);
    } finally {
      setDataTaskBusy(false);
    }
  };

  const deleteProfile = async () => {
    if (!profile || !window.confirm(`Delete ${profile.name} and every routine stored for this profile?`)) return;
    const remaining = profiles.filter(item => item.id !== profile.id);
    const nextDefaultProfileId = profile.id === defaultProfileId ? remaining[0]?.id || null : defaultProfileId;
    await applyBatch({
      puts: profile.id === defaultProfileId && nextDefaultProfileId
        ? { metadata: [{ key: 'defaultProfileId', value: nextDefaultProfileId }] }
        : {},
      deletes: {
        profiles: [profile.id],
        ...(profile.id === defaultProfileId && !nextDefaultProfileId
          ? { metadata: ['defaultProfileId'] }
          : {}),
      },
      // Resolve ownership within the same transaction as profile deletion so a routine
      // created concurrently cannot be stranded after an earlier index read.
      deleteByIndex: { routines: [{ indexName: 'profileId', key: profile.id }] },
    });
    setProfiles(remaining);
    loadedProfileRoutinesFor.current = null;
    setDefaultProfileId(nextDefaultProfileId);
    setRoutines(current => current.filter(item => item.profileId !== profile.id));
    setSelectedProfileId(remaining[0]?.id || null);
    setView('today');
  };

  // Notices belong above screen routing so an update remains actionable during
  // loading, onboarding, and profile creation without rerendering screen trees.
  const notices = (message || updateRegistration) && (
    <Suspense fallback={null}>
      <TrackerNotices message={message} updateRegistration={updateRegistration} />
    </Suspense>
  );
  if (loading) return <>{notices}<div className="loading-screen">Opening your training log…</div></>;
  if (!profiles.length || addingProfile) return (
    <>
      {notices}
      <main className="onboarding">
        {addingProfile && <button className="text-button" type="button" onClick={() => setAddingProfile(false)}>← Back</button>}
        <ProfileForm onSave={addProfile} title={profiles.length ? 'Add another person' : 'Who is training?'} />
      </main>
    </>
  );

  return (
    <div className="site-shell">
      {notices}
      {workout?.session?.status !== 'inProgress' && <header className="app-header">
        <div className="header-inner">
          <button className="brand compact-brand" type="button" onClick={() => { setView('today'); setWorkoutId(null); }}><span className="brand-mark">TM</span><span>The McIlroy Method</span></button>
          <div className="profile-switcher">
            <select aria-label="Current profile" value={profile.id} onChange={event => {
              const nextProfileId = event.target.value;
              setTodayRoutinesLoaded(false);
              setProfileRoutinesLoaded(false);
              setSelectedProfileId(nextProfileId);
              setSelectedRoutineId(null);
              setWorkoutId(null);
            }}>
              {profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <button type="button" aria-label="Add profile" onClick={() => setAddingProfile(true)}>+</button>
          </div>
        </div>
      </header>}

      <main className="app-main">
        {workoutSummary ? (
          <WorkoutSummary workout={workoutSummary} onDone={() => { setWorkoutSummary(null); setView('today'); }} />
        ) : workout?.session?.status === 'inProgress' ? (
          <ActiveWorkoutScreen
            workout={workout}
            onAdjust={adjustWorkoutSet}
            onCompleteSet={completeWorkoutSet}
            onFinish={requestFinishWorkout}
            onLeave={() => setWorkoutId(null)}
            onRpe={setWorkoutRpe}
            onSkipExercise={skipWorkoutExercise}
            onSkipSet={skipWorkoutSet}
            onSubstitute={substituteWorkoutExercise}
            onUndo={undoWorkoutSet}
          />
        ) : view === 'builder' ? (
          !templatesLoaded ? <TrackerScreenFallback label="routine builder" /> : <Suspense fallback={<TrackerScreenFallback label="routine builder" />}>
            <RoutineBuilder
              profile={profile}
              count={profileRoutines.length}
              template={builderTemplate}
              onCreate={addRoutine}
              onCancel={() => { setBuilderTemplate(null); setView('plans'); }}
            />
          </Suspense>
        ) : workout ? (
          <section className="workout-detail">
            <button className="text-button" type="button" onClick={() => { setWorkoutId(null); setEditingWorkout(false); }}>← Back</button>
            <p className="eyebrow">{workout.cycleLabel ? `${workout.cycleLabel} · ` : ''}{workout.weekLabel}</p>
            <div className="detail-heading"><h1>{workout.name}</h1>{!workout.completedAt && <button className="secondary-button" type="button" onClick={() => setEditingWorkout(!editingWorkout)}>{editingWorkout ? 'Done editing' : 'Edit exercises'}</button>}</div>
            <WorkoutMaxes workout={workout} />
            {workout.session?.status === 'completed'
              ? <WorkoutSessionHistory workout={workout} />
              : <WorkoutExercises routine={routine} workout={workout} editable={editingWorkout} onChange={editExercise} />}
            {workout.completedAt
              ? <button className="secondary-button full-button" type="button" onClick={() => reopenCompletedWorkout(workout)}>Return to workout queue</button>
              : <div className="workout-actions"><button className="primary-button complete-button" type="button" onClick={() => startWorkout(workout)}>Start workout</button><button className="danger-button" type="button" onClick={() => setWorkoutToDelete(workout)}>Delete future workout</button></div>}
          </section>
        ) : view === 'today' && !todayRoutinesLoaded ? (
          <TrackerScreenFallback label="training log" />
        ) : view === 'today' ? (
          <section className="dashboard">
            <p className="eyebrow">{routine ? routine.name : 'Ready when you are'}</p>
            <h1>{pending.length ? 'Your next workout' : routine ? 'Routine complete' : `Welcome, ${profile.name}`}</h1>
            {!routine ? (
              <div className="empty-card"><h2>Build your first routine</h2><p>Generate a complete plan and keep it on this phone.</p><button className="primary-button" type="button" onClick={() => setView('builder')}>Build a routine</button></div>
            ) : pending.length ? (
              <>
                {activeEntry && <div className="resume-workout"><div><p>Workout in progress</p><strong>{activeEntry.workout.name}</strong></div><button className="primary-button" type="button" onClick={resumeActiveWorkout}>Resume workout</button></div>}
                <div className="next-workout">
                  <p>{pending[0].cycleLabel && <>{pending[0].cycleLabel} · </>}{pending[0].weekLabel}</p>
                  <h2>{pending[0].name}</h2>
                  <WorkoutMaxes workout={pending[0]} />
                  <WorkoutExercises routine={routine} workout={pending[0]} editable={false} />
                  <button className="primary-button" type="button" onClick={() => showWorkout(pending[0])}>Open workout</button>
                </div>
                {pending.length > 1 && <div className="up-next"><div className="list-heading"><h2>Coming up</h2>{pending.length > 6 && <button className="text-button" type="button" onClick={() => setShowAllPending(!showAllPending)}>{showAllPending ? 'Show less' : `View all ${pending.length}`}</button>}</div>{(showAllPending ? pending.slice(1) : pending.slice(1, 6)).map(item => <WorkoutCard workout={item} onOpen={() => showWorkout(item)} key={item.id} />)}</div>}
              </>
            ) : <div className="empty-card"><p>Every workout in this routine is complete.</p><button className="primary-button" type="button" onClick={() => setView('builder')}>Build another routine</button></div>}
          </section>
        ) : view === 'plans' ? (
          !profileRoutinesLoaded || !templatesLoaded ? <TrackerScreenFallback label="plans" error={profileRoutinesError} onRetry={() => setProfileRoutinesRetry(value => value + 1)} /> : <Suspense fallback={<TrackerScreenFallback label="plans" />}><PlansScreen profile={profile} routines={profileRoutines} archived={archivedRoutines} activeId={routine?.id} templates={templates} RoutineNameEditor={RoutineNameEditor} MaxCorrection={MaxCorrection} actions={{ newRoutine: () => { setBuilderTemplate(null); setView('builder'); }, select: selectRoutine, rename: renameRoutine, copy: item => setCopyRequest({ type: 'routine', item }), saveTemplate: setTemplateSource, archive: archivePlan, correct: (item, maxes) => { saveRoutine(correctMaxes(item, maxes)); flash('Future workouts updated.'); }, restore: restorePlan, useTemplate: item => { setBuilderTemplate(item); setView('builder'); }, renameTemplate, deleteTemplate: setTemplateToDelete }} /></Suspense>
        ) : view === 'history' ? (
          !profileRoutinesLoaded ? <TrackerScreenFallback label="history" error={profileRoutinesError} onRetry={() => setProfileRoutinesRetry(value => value + 1)} /> : <Suspense fallback={<TrackerScreenFallback label="history" />}>
            <HistoryScreen eyebrow={routine?.name || profile.name} routine={routine} completed={completed} PlanSetup={PlanSetup} WorkoutCard={WorkoutCard} onOpen={showWorkout} />
          </Suspense>
        ) : view === 'progress' ? (
          !profileRoutinesLoaded ? <TrackerScreenFallback label="progress" error={profileRoutinesError} onRetry={() => setProfileRoutinesRetry(value => value + 1)} /> : <Suspense fallback={<TrackerScreenFallback label="progress" />}>
            <ProgressScreen profile={profile} routines={progressRoutines} />
          </Suspense>
        ) : (
          <Suspense fallback={<TrackerScreenFallback label="settings" />}><SettingsScreen profile={profile} profiles={profiles} defaultProfileId={defaultProfileId} appearance={appearance} persistent={persistent} routine={routine} completedCount={completed.length} hasRoutines={Boolean(routines.length)} busy={dataTaskBusy} refs={{ import: importRef, transfer: transferRef }} AppearanceControl={AppearanceControl} actions={{ defaultProfile: async id => { await save('metadata', { key: 'defaultProfileId', value: id }); setDefaultProfileId(id); flash(`${profiles.find(item => item.id === id).name} is now the default profile.`); }, appearance: onAppearanceChange, persistence: async () => { const granted = await requestPersistentStorage(); setPersistent(granted); flash(granted ? 'Persistent storage enabled.' : 'Chrome did not grant persistent storage. Keep a recent backup.'); }, planCsv: () => downloadRoutineCsv(DATA_TASKS.PLAN_CSV, 'plan'), historyCsv: () => downloadRoutineCsv(DATA_TASKS.HISTORY_CSV, 'history'), backup: async () => { if (dataTaskBusy) return; setDataTaskBusy(true); try { const local = await loadAllData(); download(await runDataTaskInBackground('serialize-backup', local), `mcilroy-method-backup-${new Date().toISOString().slice(0, 10)}.json`); } catch (error) { flash(error.message); } finally { setDataTaskBusy(false); } }, transfer: makeTransfer, routineTransfer: async () => { const records = await getAllByIndex('routines', 'profileId', profile.id); setRoutines(current => [...current.filter(item => item.profileId !== profile.id), ...records]); setChoosingRoutineTransfer(true); }, importFile: event => { if (event.target.files[0]) importBackupFile(event.target.files[0]); event.target.value = ''; }, transferFile: event => { if (event.target.files[0]) receiveTransferFile(event.target.files[0]); event.target.value = ''; }, deleteProfile }} /></Suspense>
        )}
      </main>

      {workoutToDelete && <ConfirmationModal title="Delete future workout?" confirmLabel="Delete workout" onCancel={() => setWorkoutToDelete(null)} onConfirm={confirmDeleteWorkout}>This removes {workoutToDelete.weekLabel} · {workoutToDelete.name} from this routine. It will not be marked complete or appear in history.</ConfirmationModal>}
      {finishPrompt && <ConfirmationModal title="Finish this workout?" confirmLabel="Finish workout" onCancel={() => setFinishPrompt(null)} onConfirm={finishActiveWorkout}>{finishPrompt.pendingSets ? `${finishPrompt.pendingSets} planned set${finishPrompt.pendingSets === 1 ? '' : 's'} will be recorded as skipped. ` : ''}{finishPrompt.missingRpe ? 'The main-lift RPE is still blank.' : ''}</ConfirmationModal>}
      <Suspense fallback={null}>
      {importPlan && <ImportPreview plan={importPlan} busy={dataTaskBusy} onCancel={() => { if (!dataTaskBusy) setImportPlan(null); }} onConfirm={confirmImport} />}
      {createdTransfer && <TransferCreator transfer={createdTransfer} onClose={() => setCreatedTransfer(null)} onShare={sendTransfer} />}
      {transferFile && <TransferUnlock file={transferFile} busy={dataTaskBusy} onCancel={() => { overlayTaskRef.current = null; cancelDataTasks(); setDataTaskBusy(false); setTransferFile(null); }} onUnlock={unlockTransfer} />}
      {choosingRoutineTransfer && <RoutineTransferCreator routines={routines} busy={dataTaskBusy} onCancel={() => { overlayTaskRef.current = null; cancelDataTasks(); setDataTaskBusy(false); setChoosingRoutineTransfer(false); }} onCreate={createRoutineTransfer} />}
      {receivedRoutine && <RoutineDestination transfer={receivedRoutine} profiles={profiles} onCancel={() => setReceivedRoutine(null)} onConfirm={chooseRoutineDestination} />}
      {copyRequest && <RoutineCopyDialog title={`Copy ${copyRequest.item.name}`} eyebrow="Copy routine" defaultName={`${copyRequest.item.name} copy`} profiles={profiles} selectedProfileId={selectedProfileId} confirmLabel="Copy routine" onCancel={() => setCopyRequest(null)} onConfirm={confirmRoutineCopy} />}
      {templateSource && <SaveTemplateDialog routine={templateSource} onCancel={() => setTemplateSource(null)} onConfirm={saveRoutineTemplate} />}
      </Suspense>
      {templateToDelete && <ConfirmationModal title="Delete template?" confirmLabel="Delete template" onCancel={() => setTemplateToDelete(null)} onConfirm={deleteTemplate}>Delete {templateToDelete.name}? Routines already created from it will not be affected.</ConfirmationModal>}

      {view !== 'builder' && !workout && !workoutSummary && <nav className="bottom-nav" aria-label="App navigation">{navItems.map(([key, label]) => <button className={view === key ? 'active' : ''} type="button" onClick={() => setView(key)} key={key}>{label}</button>)}</nav>}
    </div>
  );
};

export { AppearanceControl };
export default TrackerApp;
