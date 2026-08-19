import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter as Router, Link, Route, Routes } from 'react-router-dom';
import { MaxesForm } from './containers/MaxesForm';
import { ActiveWorkoutSession, WorkoutSessionHistory } from './components/WorkoutSession';
import { ProgressDashboard } from './components/ProgressDashboard';
import {
  adjustSessionSet,
  clearExerciseOverrides,
  completeSessionSet,
  correctMaxes,
  createRoutine,
  createRoutineTemplate,
  deleteFutureWorkout,
  duplicateRoutine,
  finishWorkoutSession,
  reopenWorkoutSession,
  routineHistoryToCsv,
  routinePlanToCsv,
  setSessionRpe,
  setWorkoutComplete,
  startWorkoutSession,
  undoLatestSessionSet,
  updateExercise,
  visibleExercise,
} from './data/routines';
import { createImportPlan, importPlanSummary } from './data/importBackup';
import { createTransferPackage, openTransferPackage } from './data/transferPackage';
import {
  exportBackup,
  get,
  getAll,
  hasPersistentStorage,
  parseBackup,
  remove,
  requestPersistentStorage,
  save,
} from './data/storage';
import './App.css';

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

export const initialProfileId = (profiles, defaultProfileId) => (
  profiles.some(profile => profile.id === defaultProfileId)
    ? defaultProfileId
    : profiles[0]?.id || null
);

const download = (contents, name, type = 'application/json') => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const SHARED_TRANSFER_FORMAT = 'mcilroy-method-shared-transfer';

export const createSharedTransferContents = transfer => JSON.stringify({
  format: SHARED_TRANSFER_FORMAT,
  version: 1,
  key: transfer.key,
  package: JSON.parse(transfer.contents),
});

export const createTransferFile = transfer => new File(
  [createSharedTransferContents(transfer)],
  transfer.filename,
  { type: 'text/plain' },
);

export const canShareTransfer = transfer => {
  if (!navigator.share || !navigator.canShare) return false;
  return navigator.canShare({ files: [createTransferFile(transfer)] });
};

export const shareTransfer = transfer => navigator.share({
  files: [createTransferFile(transfer)],
});

export const sharedTransferContents = contents => {
  try {
    const shared = JSON.parse(contents);
    if (shared.format !== SHARED_TRANSFER_FORMAT || shared.version !== 1 ||
        typeof shared.key !== 'string' || !shared.package) return null;
    return { key: shared.key, contents: JSON.stringify(shared.package) };
  } catch (error) {
    return null;
  }
};

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

export const ImportPreview = ({ plan, onCancel, onConfirm }) => {
  const summary = importPlanSummary(plan);
  const sections = [['Profiles', plan.profiles], ['Routines', plan.routines], ['Templates', plan.templates || []]];
  return (
    <div className="modal-backdrop">
      <section className="confirmation-modal import-preview" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
        <p className="eyebrow">Backup review</p>
        <h2 id="import-preview-title">Preview import</h2>
        <p>{summary.copy} copied · {summary.skip} skipped · {summary.merge} merged</p>
        <p className="import-note">Merges keep this phone's values and completed workout snapshots, while adding records and workouts found only in the backup.</p>
        <div className="import-preview-list">
          {sections.map(([title, items]) => (
            <div key={title}>
              <h3>{title}</h3>
              {!items.length ? <p>None</p> : items.map((item, index) => (
                <div className="import-preview-row" key={`${item.imported.id}-${index}`}>
                  <span><strong>{item.imported.name || 'Unnamed'}</strong><small>{item.status}</small></span>
                  <b className={`import-action ${item.action}`}>{item.action}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="button-row modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="button" onClick={onConfirm}>Import backup</button>
        </div>
      </section>
    </div>
  );
};

export const TransferCreator = ({ transfer, onClose, onShare }) => {
  const shareSupported = canShareTransfer(transfer);
  return (
  <div className="modal-backdrop">
    <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <p className="eyebrow">Encrypted transfer</p>
      <h2 id="transfer-title">Send to another phone</h2>
      <p>{shareSupported ? 'Use your phone\'s share menu and choose Quick Share or another nearby option.' : 'Direct sharing is not supported by this browser. Download the file and share it from your phone\'s Files app.'}</p>
      {shareSupported && <button className="primary-button full-button" type="button" onClick={onShare}>Share with nearby phone</button>}
      <button className="secondary-button full-button" type="button" onClick={() => download(createSharedTransferContents(transfer), transfer.filename, 'text/plain')}>Download file instead</button>
      <p>On the other phone, accept the file and open it with McIlroy Method. The app will preview it automatically. It expires at {new Date(transfer.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
      <div className="button-row modal-actions"><button className="primary-button" type="button" onClick={onClose}>Done</button></div>
    </section>
  </div>
  );
};

const TransferUnlock = ({ file, onCancel, onUnlock }) => {
  const [key, setKey] = useState('');
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title" onSubmit={event => { event.preventDefault(); onUnlock(key); }}>
        <p className="eyebrow">Encrypted transfer</p>
        <h2 id="unlock-title">Open transfer package</h2>
        <p>{file.name} needs the key shown on the sending device.</p>
        <label className="form-field"><span className="field-label">Transfer key</span><input className="number-input transfer-key-input" value={key} onChange={event => setKey(event.target.value)} autoCapitalize="none" autoCorrect="off" required autoFocus /></label>
        <div className="button-row modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Decrypt and preview</button></div>
      </form>
    </div>
  );
};

const RoutineTransferCreator = ({ routines, onCancel, onCreate }) => {
  const [routineId, setRoutineId] = useState(routines[0]?.id || '');
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="routine-transfer-title" onSubmit={event => event.preventDefault()}>
        <p className="eyebrow">Routine transfer</p>
        <h2 id="routine-transfer-title">Choose a routine</h2>
        <p>The encrypted routine and its history can be sent through your phone's share menu.</p>
        <label className="form-field"><span className="field-label">Routine</span><select className="number-input" value={routineId} onChange={event => setRoutineId(event.target.value)}>{routines.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="button-row modal-actions"><button className="text-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="button" disabled={!routineId} onClick={() => onCreate(routineId)}>Create transfer</button></div>
      </form>
    </div>
  );
};

const RoutineDestination = ({ transfer, profiles, onCancel, onConfirm }) => {
  const [destination, setDestination] = useState(profiles[0]?.id || 'new');
  const [name, setName] = useState(transfer.profileName || 'Imported profile');
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="routine-destination-title" onSubmit={event => { event.preventDefault(); onConfirm(destination, name.trim()); }}>
        <p className="eyebrow">Routine received</p>
        <h2 id="routine-destination-title">Where should {transfer.routine.name} go?</h2>
        <label className="form-field"><span className="field-label">Profile</span><select className="number-input" value={destination} onChange={event => setDestination(event.target.value)}>{profiles.map(item => <option value={item.id} key={item.id}>Add to {item.name}</option>)}<option value="new">Create a new profile</option></select></label>
        {destination === 'new' && <label className="form-field"><span className="field-label">New profile name</span><input className="number-input" value={name} onChange={event => setName(event.target.value)} required autoFocus /></label>}
        <div className="button-row modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Preview import</button></div>
      </form>
    </div>
  );
};

export const RoutineCopyDialog = ({ title, eyebrow, defaultName, profiles, selectedProfileId, confirmLabel, onCancel, onConfirm }) => {
  const [destination, setDestination] = useState(selectedProfileId || profiles[0]?.id || '');
  const [name, setName] = useState(defaultName);
  const trimmedName = name.trim();
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="copy-routine-title" onSubmit={event => { event.preventDefault(); if (destination && trimmedName) onConfirm(destination, trimmedName); }}>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="copy-routine-title">{title}</h2>
        <label className="form-field"><span className="field-label">Routine name</span><input aria-label="Routine name" className="number-input" value={name} onChange={event => setName(event.target.value)} required autoFocus /></label>
        <label className="form-field"><span className="field-label">Profile</span><select aria-label="Destination profile" className="number-input" value={destination} onChange={event => setDestination(event.target.value)} required>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="button-row modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={!destination || !trimmedName}>{confirmLabel}</button></div>
      </form>
    </div>
  );
};

const SaveTemplateDialog = ({ routine, onCancel, onConfirm }) => {
  const [name, setName] = useState(routine.name);
  const trimmedName = name.trim();
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="save-template-title" onSubmit={event => { event.preventDefault(); if (trimmedName) onConfirm(trimmedName); }}>
        <p className="eyebrow">Reusable template</p>
        <h2 id="save-template-title">Save routine setup</h2>
        <p>Templates keep the generator setup, not workout progress or exercise-level edits.</p>
        <label className="form-field"><span className="field-label">Template name</span><input aria-label="Template name" className="number-input" value={name} onChange={event => setName(event.target.value)} required autoFocus /></label>
        <div className="button-row modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={!trimmedName}>Save template</button></div>
      </form>
    </div>
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

export const RoutineBuilder = ({ profile, count, template, onCreate, onCancel }) => {
  const [name, setName] = useState(template?.name || `${profile.name}'s plan ${count + 1}`);
  return (
    <div>
      <div className="routine-name-wrap">
        <label className="form-field">
          <span className="field-label">Routine name</span>
          <input className="number-input" value={name} onChange={event => setName(event.target.value)} required />
        </label>
      </div>
      <MaxesForm
        initialInputs={template ? templateBuilderInputs(template) : undefined}
        onCancel={onCancel}
        onCreate={inputs => onCreate(name.trim() || 'Strength plan', inputs)}
      />
    </div>
  );
};

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

const TrackerApp = () => {
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
  const importRef = useRef();
  const transferRef = useRef();
  const incomingTransferRef = useRef(false);
  const routinesRef = useRef([]);
  const routineSaveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    routinesRef.current = routines;
  }, [routines]);

  useEffect(() => {
    Promise.all([getAll('profiles'), getAll('routines'), getAll('templates'), hasPersistentStorage(), get('metadata', 'defaultProfileId')])
      .then(([savedProfiles, savedRoutines, savedTemplates, isPersistent, savedDefault]) => {
        setProfiles(savedProfiles);
        setRoutines(savedRoutines);
        setTemplates(savedTemplates);
        setDefaultProfileId(savedDefault?.value || null);
        setSelectedProfileId(initialProfileId(savedProfiles, savedDefault?.value));
        setPersistent(isPersistent);
      })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleUpdate = event => setUpdateRegistration(event.detail);
    const shouldReloadForUpdate = Boolean(navigator.serviceWorker?.controller);
    let reloading = false;
    const reload = () => {
      if (!shouldReloadForUpdate || reloading) return;
      reloading = true;
      window.location.reload();
    };
    window.addEventListener('app-update-available', handleUpdate);
    navigator.serviceWorker?.addEventListener('controllerchange', reload);
    return () => {
      window.removeEventListener('app-update-available', handleUpdate);
      navigator.serviceWorker?.removeEventListener('controllerchange', reload);
    };
  }, []);

  const profile = profiles.find(item => item.id === selectedProfileId);
  const profileRoutines = useMemo(() => routines
    .filter(routine => routine.profileId === selectedProfileId && !routine.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [routines, selectedProfileId]);
  const progressRoutines = useMemo(() => routines
    .filter(item => item.profileId === selectedProfileId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [routines, selectedProfileId]);
  const routine = profileRoutines.find(item => item.id === selectedRoutineId) ||
    profileRoutines.find(item => item.id === profile?.activeRoutineId) || profileRoutines[0];
  const workout = routine?.workouts.find(item => item.id === workoutId);
  const pending = routine?.workouts.filter(item => !item.completedAt) || [];
  const completed = routine?.workouts.filter(item => item.completedAt).reverse() || [];
  const activeEntry = profileRoutines.map(item => ({
    routine: item,
    workout: item.workouts.find(day => day.session?.status === 'inProgress'),
  })).find(item => item.workout);

  useEffect(() => {
    if (routine && routine.id !== selectedRoutineId) setSelectedRoutineId(routine.id);
  }, [routine, selectedRoutineId]);

  const flash = text => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3000);
  };

  const addProfile = async name => {
    const item = { id: makeId(), name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const shouldMakeDefault = profiles.length === 0;
    await Promise.all([
      save('profiles', item),
      shouldMakeDefault ? save('metadata', { key: 'defaultProfileId', value: item.id }) : Promise.resolve(),
    ]);
    setProfiles(current => [...current, item]);
    if (shouldMakeDefault) setDefaultProfileId(item.id);
    setSelectedProfileId(item.id);
    setAddingProfile(false);
    setView('today');
  };

  const saveRoutine = async updated => {
    routinesRef.current = routinesRef.current.map(item => item.id === updated.id ? updated : item);
    setRoutines(routinesRef.current);
    routineSaveQueueRef.current = routineSaveQueueRef.current
      .catch(() => {})
      .then(() => save('routines', updated));
    await routineSaveQueueRef.current;
  };

  const changeSelectedRoutine = transform => {
    const current = routinesRef.current.find(item => item.id === routine.id) || routine;
    return saveRoutine(transform(current));
  };

  const addRoutine = async (name, inputs) => {
    const item = createRoutine(profile.id, name, inputs);
    const updatedProfile = { ...profile, activeRoutineId: item.id, updatedAt: new Date().toISOString() };
    await Promise.all([save('routines', item), save('profiles', updatedProfile)]);
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
    await Promise.all([save('routines', item), save('profiles', updatedProfile)]);
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
    await changeSelectedRoutine(current => startWorkoutSession(current, target.id));
  };

  const adjustWorkoutSet = async (exerciseId, setId, values) => {
    await changeSelectedRoutine(current => adjustSessionSet(current, workout.id, exerciseId, setId, values));
  };

  const completeWorkoutSet = async (exerciseId, setId) => {
    await changeSelectedRoutine(current => completeSessionSet(current, workout.id, exerciseId, setId));
  };

  const undoWorkoutSet = async () => {
    await changeSelectedRoutine(current => undoLatestSessionSet(current, workout.id));
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
    await changeSelectedRoutine(current => finishWorkoutSession(current, workout.id));
    setFinishPrompt(null);
    setWorkoutId(null);
    flash('Workout complete.');
  };

  const reopenCompletedWorkout = async target => {
    if (activeEntry && activeEntry.workout.id !== target.id) {
      resumeActiveWorkout();
      flash('Finish your active workout before reopening another.');
      return;
    }
    if (target.session) {
      await changeSelectedRoutine(current => reopenWorkoutSession(current, target.id));
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
    try {
      const backup = parseBackup(await file.text());
      setImportPlan(createImportPlan(backup, profiles, routines, templates));
    } catch (error) {
      flash(error.message);
    }
  };

  const makeTransfer = async () => {
    try {
      const transfer = await createTransferPackage(exportBackup(profiles, routines, templates));
      setCreatedTransfer({
        ...transfer,
        filename: `mcilroy-method-transfer-${new Date().toISOString().slice(0, 10)}.txt`,
      });
    } catch (error) {
      flash(error.message);
    }
  };

  const unlockTransferContents = async (contents, key) => {
    try {
      const plaintext = await openTransferPackage(contents, key);
      setTransferFile(null);
      const payload = JSON.parse(plaintext);
      if (payload.format === 'mcilroy-method-routine-transfer' && payload.version === 1 && payload.routine) {
        setReceivedRoutine(payload);
      } else {
        setImportPlan(createImportPlan(parseBackup(plaintext), profiles, routines, templates));
      }
    } catch (error) {
      flash(error.message);
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
    const selected = routines.find(item => item.id === routineId);
    if (!selected) return;
    try {
      const payload = JSON.stringify({
        format: 'mcilroy-method-routine-transfer',
        version: 1,
        profileName: profiles.find(item => item.id === selected.profileId)?.name || 'Imported profile',
        routine: selected,
      });
      const transfer = await createTransferPackage(payload, Date.now(), { compress: true });
      setChoosingRoutineTransfer(false);
      setCreatedTransfer({
        ...transfer,
        filename: `${safeFilename(selected.name)}-${new Date().toISOString().slice(0, 10)}.txt`,
      });
    } catch (error) {
      flash(error.message);
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

  const chooseRoutineDestination = (destination, name) => {
    const profileId = destination === 'new' ? makeId() : destination;
    const incomingProfiles = destination === 'new' ? [{ id: profileId, name }] : [];
    const incomingRoutine = { ...receivedRoutine.routine, profileId };
    setReceivedRoutine(null);
    setImportPlan(createImportPlan({ profiles: incomingProfiles, routines: [incomingRoutine], templates: [] }, profiles, routines, templates));
  };

  const confirmImport = async () => {
    const profileChanges = importPlan.profiles.filter(item => item.action !== 'skip');
    const routineChanges = importPlan.routines.filter(item => item.action !== 'skip');
    const templateChanges = importPlan.templates.filter(item => item.action !== 'skip');
    try {
      await Promise.all([
        ...profileChanges.map(item => save('profiles', item.result)),
        ...routineChanges.map(item => save('routines', item.result)),
        ...templateChanges.map(item => save('templates', item.result)),
      ]);
      const profileResults = new Map(importPlan.profiles.map(item => [item.imported.id, item.result]));
      const routineResults = new Map(importPlan.routines.map(item => [item.imported.id, item.result]));
      const templateResults = new Map(importPlan.templates.map(item => [item.imported.id, item.result]));
      setProfiles(current => [...current.filter(item => !profileResults.has(item.id)), ...profileResults.values()]);
      setRoutines(current => [...current.filter(item => !routineResults.has(item.id)), ...routineResults.values()]);
      setTemplates(current => [...current.filter(item => !templateResults.has(item.id)), ...templateResults.values()]);
      const summary = importPlanSummary(importPlan);
      setImportPlan(null);
      flash(`Import complete: ${summary.copy} copied, ${summary.merge} merged, ${summary.skip} skipped.`);
    } catch (error) {
      flash(error.message);
    }
  };

  const deleteProfile = async () => {
    if (!profile || !window.confirm(`Delete ${profile.name} and every routine stored for this profile?`)) return;
    const owned = routines.filter(item => item.profileId === profile.id);
    const remaining = profiles.filter(item => item.id !== profile.id);
    const nextDefaultProfileId = profile.id === defaultProfileId ? remaining[0]?.id || null : defaultProfileId;
    await Promise.all([
      remove('profiles', profile.id),
      ...owned.map(item => remove('routines', item.id)),
      profile.id === defaultProfileId
        ? (nextDefaultProfileId
          ? save('metadata', { key: 'defaultProfileId', value: nextDefaultProfileId })
          : remove('metadata', 'defaultProfileId'))
        : Promise.resolve(),
    ]);
    setProfiles(remaining);
    setDefaultProfileId(nextDefaultProfileId);
    setRoutines(current => current.filter(item => item.profileId !== profile.id));
    setSelectedProfileId(remaining[0]?.id || null);
    setView('today');
  };

  if (loading) return <div className="loading-screen">Opening your training log…</div>;
  if (!profiles.length || addingProfile) return (
    <main className="onboarding">
      {addingProfile && <button className="text-button" type="button" onClick={() => setAddingProfile(false)}>← Back</button>}
      <ProfileForm onSave={addProfile} title={profiles.length ? 'Add another person' : 'Who is training?'} />
    </main>
  );

  const showWorkout = target => { setWorkoutId(target.id); setEditingWorkout(false); };

  return (
    <div className="site-shell">
      {workout?.session?.status !== 'inProgress' && <header className="app-header">
        <div className="header-inner">
          <button className="brand compact-brand" type="button" onClick={() => { setView('today'); setWorkoutId(null); }}><span className="brand-mark">TM</span><span>The McIlroy Method</span></button>
          <div className="profile-switcher">
            <select aria-label="Current profile" value={profile.id} onChange={event => { setSelectedProfileId(event.target.value); setSelectedRoutineId(null); setWorkoutId(null); }}>
              {profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <button type="button" aria-label="Add profile" onClick={() => setAddingProfile(true)}>+</button>
          </div>
        </div>
      </header>}

      <main className="app-main">
        {message && <div className="toast" role="status">{message}</div>}
        {updateRegistration && <div className="update-banner"><span>A new version is ready.</span><button type="button" onClick={() => updateRegistration.waiting?.postMessage('skip-waiting')}>Update now</button></div>}

        {workout?.session?.status === 'inProgress' ? (
          <ActiveWorkoutSession
            workout={workout}
            onAdjust={adjustWorkoutSet}
            onCompleteSet={completeWorkoutSet}
            onFinish={requestFinishWorkout}
            onLeave={() => setWorkoutId(null)}
            onRpe={setWorkoutRpe}
            onUndo={undoWorkoutSet}
          />
        ) : view === 'builder' ? (
          <RoutineBuilder
            profile={profile}
            count={profileRoutines.length}
            template={builderTemplate}
            onCreate={addRoutine}
            onCancel={() => { setBuilderTemplate(null); setView('plans'); }}
          />
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
          <section className="section-page">
            <div className="section-heading"><div><p className="eyebrow">{profile.name}</p><h1>Plans</h1></div><button className="primary-button small-primary" type="button" onClick={() => { setBuilderTemplate(null); setView('builder'); }}>New routine</button></div>
            {!profileRoutines.length ? <p>No routines yet.</p> : profileRoutines.map(item => (
              <article className={`plan-card ${item.id === routine?.id ? 'active' : ''}`} key={item.id}>
                <button className="plan-select" type="button" onClick={() => selectRoutine(item)}><span><strong>{item.name}</strong><small>{item.workouts.filter(day => day.completedAt).length} of {item.workouts.length} complete</small></span><span>{item.id === routine?.id ? 'Active' : 'Use plan'}</span></button>
                <div className="plan-actions"><div className="button-row"><RoutineNameEditor routine={item} onSave={name => renameRoutine(item, name)} /><button className="text-button" type="button" onClick={() => setCopyRequest({ type: 'routine', item })}>Copy</button><button className="text-button" type="button" onClick={() => setTemplateSource(item)}>Save as template</button></div></div>
                {item.id === routine?.id && <MaxCorrection routine={item} onCorrect={maxes => { saveRoutine(correctMaxes(item, maxes)); flash('Future workouts updated.'); }} />}
              </article>
            ))}
            <div className="template-library">
              <div><p className="eyebrow">Reusable setups</p><h2>Templates</h2><p>Templates regenerate a fresh routine from saved generator settings.</p></div>
              {!templates.length ? <p>No templates yet. Save one from a routine above.</p> : templates.map(item => (
                <article className="template-card" key={item.id}>
                  <strong>{item.name}</strong>
                  <div className="button-row"><button className="primary-button small-primary" type="button" onClick={() => { setBuilderTemplate(item); setView('builder'); }}>Use template</button><RoutineNameEditor routine={item} label="Template" onSave={name => renameTemplate(item, name)} /><button className="text-button danger-text" type="button" onClick={() => setTemplateToDelete(item)}>Delete</button></div>
                </article>
              ))}
            </div>
          </section>
        ) : view === 'history' ? (
          <section className="section-page"><p className="eyebrow">{routine?.name || profile.name}</p><h1>History</h1>{routine && <PlanSetup routine={routine} />}{completed.length ? completed.map(item => <WorkoutCard workout={item} onOpen={() => showWorkout(item)} key={item.id} />) : <div className="empty-card"><p>Completed workouts will appear here.</p></div>}</section>
        ) : view === 'progress' ? (
          <ProgressDashboard profile={profile} routines={progressRoutines} />
        ) : (
          <section className="section-page settings-page">
            <p className="eyebrow">This phone</p><h1>Settings & backup</h1>
            <article className="settings-card"><h2>Default profile</h2><p>Choose the profile that opens automatically when you launch the app.</p><label className="form-field"><span className="field-label">Open with</span><select className="number-input" aria-label="Default profile" value={defaultProfileId || profiles[0].id} onChange={async event => { const id = event.target.value; await save('metadata', { key: 'defaultProfileId', value: id }); setDefaultProfileId(id); flash(`${profiles.find(item => item.id === id).name} is now the default profile.`); }}>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></article>
            <article className="settings-card"><h2>Offline storage</h2><p>{persistent ? 'Persistent storage is enabled.' : 'Ask Chrome to protect this app from automatic storage cleanup.'}</p>{!persistent && <button className="secondary-button" type="button" onClick={async () => { const granted = await requestPersistentStorage(); setPersistent(granted); flash(granted ? 'Persistent storage enabled.' : 'Chrome did not grant persistent storage. Keep a recent backup.'); }}>Request persistent storage</button>}</article>
            <article className="settings-card"><h2>CSV downloads</h2><p>{routine ? `Download the active plan, ${routine.name}, or its completed workout history. Exercise edits and completed-workout snapshots are included.` : 'Create a routine before downloading plan or history data.'}</p><div className="button-row"><button className="secondary-button" type="button" disabled={!routine} onClick={() => download(routinePlanToCsv(routine), `${safeFilename(routine.name)}-plan.csv`, 'text/csv;charset=utf-8')}>Download plan CSV</button><button className="secondary-button" type="button" disabled={!completed.length} onClick={() => download(routineHistoryToCsv(routine), `${safeFilename(routine.name)}-history.csv`, 'text/csv;charset=utf-8')}>Download history CSV</button></div></article>
            <article className="settings-card"><h2>Backup and transfer</h2><p>Backups are unencrypted files for long-term recovery. Transfers are encrypted, expire after 30 minutes, and move all data or one selected routine without an account.</p><div className="button-row"><button className="secondary-button" type="button" onClick={() => download(exportBackup(profiles, routines, templates), `mcilroy-method-backup-${new Date().toISOString().slice(0, 10)}.json`)}>Export backup</button><button className="secondary-button" type="button" onClick={() => importRef.current.click()}>Import backup</button><button className="secondary-button" type="button" onClick={makeTransfer}>Move all data</button><button className="secondary-button" type="button" onClick={() => transferRef.current.click()}>Open received transfer</button><button className="secondary-button" type="button" disabled={!routines.length} onClick={() => setChoosingRoutineTransfer(true)}>Transfer one routine</button><input ref={importRef} className="hidden-input" type="file" accept="application/json,.json" onChange={event => { if (event.target.files[0]) importBackupFile(event.target.files[0]); event.target.value = ''; }} /><input ref={transferRef} className="hidden-input" type="file" accept="text/plain,.txt,application/json,.json,.mcilroy-transfer" onChange={event => { if (event.target.files[0]) receiveTransferFile(event.target.files[0]); event.target.value = ''; }} /></div></article>
            <article className="settings-card danger-card"><h2>Delete profile</h2><p>Deletes {profile.name} and every routine belonging to this profile from this phone.</p><button className="danger-button" type="button" onClick={deleteProfile}>Delete {profile.name}</button></article>
          </section>
        )}
      </main>

      {workoutToDelete && <ConfirmationModal title="Delete future workout?" confirmLabel="Delete workout" onCancel={() => setWorkoutToDelete(null)} onConfirm={confirmDeleteWorkout}>This removes {workoutToDelete.weekLabel} · {workoutToDelete.name} from this routine. It will not be marked complete or appear in history.</ConfirmationModal>}
      {finishPrompt && <ConfirmationModal title="Finish this workout?" confirmLabel="Finish workout" onCancel={() => setFinishPrompt(null)} onConfirm={finishActiveWorkout}>{finishPrompt.pendingSets ? `${finishPrompt.pendingSets} planned set${finishPrompt.pendingSets === 1 ? '' : 's'} will be recorded as skipped. ` : ''}{finishPrompt.missingRpe ? 'The main-lift RPE is still blank.' : ''}</ConfirmationModal>}
      {importPlan && <ImportPreview plan={importPlan} onCancel={() => setImportPlan(null)} onConfirm={confirmImport} />}
      {createdTransfer && <TransferCreator transfer={createdTransfer} onClose={() => setCreatedTransfer(null)} onShare={sendTransfer} />}
      {transferFile && <TransferUnlock file={transferFile} onCancel={() => setTransferFile(null)} onUnlock={unlockTransfer} />}
      {choosingRoutineTransfer && <RoutineTransferCreator routines={routines} onCancel={() => setChoosingRoutineTransfer(false)} onCreate={createRoutineTransfer} />}
      {receivedRoutine && <RoutineDestination transfer={receivedRoutine} profiles={profiles} onCancel={() => setReceivedRoutine(null)} onConfirm={chooseRoutineDestination} />}
      {copyRequest && <RoutineCopyDialog title={`Copy ${copyRequest.item.name}`} eyebrow="Copy routine" defaultName={`${copyRequest.item.name} copy`} profiles={profiles} selectedProfileId={selectedProfileId} confirmLabel="Copy routine" onCancel={() => setCopyRequest(null)} onConfirm={confirmRoutineCopy} />}
      {templateSource && <SaveTemplateDialog routine={templateSource} onCancel={() => setTemplateSource(null)} onConfirm={saveRoutineTemplate} />}
      {templateToDelete && <ConfirmationModal title="Delete template?" confirmLabel="Delete template" onCancel={() => setTemplateToDelete(null)} onConfirm={deleteTemplate}>Delete {templateToDelete.name}? Routines already created from it will not be affected.</ConfirmationModal>}

      {view !== 'builder' && !workout && <nav className="bottom-nav" aria-label="App navigation">{navItems.map(([key, label]) => <button className={view === key ? 'active' : ''} type="button" onClick={() => setView(key)} key={key}>{label}</button>)}</nav>}
    </div>
  );
};

export const isInstalledApp = () => (
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true)
);

const CalculatorWebsite = () => (
  <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <div className="site-shell">
      <header className="site-header">
        <nav className="nav-wrap" aria-label="Main navigation">
          <Link className="brand" to="/">
            <span className="brand-mark">TM</span>
            <span>The McIlroy Method</span>
          </Link>
        </nav>
      </header>
      <main className="site-main">
        <Routes>
          <Route path="/" element={<MaxesForm />} />
          <Route path="*" element={<MaxesForm />} />
        </Routes>
      </main>
      <footer className="site-footer">Built for steady progress, one session at a time.</footer>
    </div>
  </Router>
);

const App = () => isInstalledApp() ? <TrackerApp /> : <CalculatorWebsite />;

export default App;
