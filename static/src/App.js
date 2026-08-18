import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaxesForm } from './containers/MaxesForm';
import {
  clearExerciseOverrides,
  cloneImportedRecord,
  correctMaxes,
  createRoutine,
  setWorkoutComplete,
  updateExercise,
  visibleExercise,
} from './data/routines';
import {
  exportBackup,
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
  ['settings', 'Settings'],
];

const download = (contents, name, type = 'application/json') => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

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

const WorkoutCard = ({ workout, onOpen }) => (
  <button className="workout-card" type="button" onClick={onOpen}>
    <span><small>{workout.cycleLabel ? `${workout.cycleLabel} · ` : ''}{workout.weekLabel}</small><strong>{workout.name}</strong></span>
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

const RoutineBuilder = ({ profile, count, onCreate, onCancel }) => {
  const [name, setName] = useState(`${profile.name}'s plan ${count + 1}`);
  return (
    <div>
      <div className="routine-name-wrap">
        <label className="form-field">
          <span className="field-label">Routine name</span>
          <input className="number-input" value={name} onChange={event => setName(event.target.value)} required />
        </label>
      </div>
      <MaxesForm onCancel={onCancel} onCreate={inputs => onCreate(name.trim() || 'Strength plan', inputs)} />
    </div>
  );
};

const App = () => {
  const [profiles, setProfiles] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
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
  const importRef = useRef();

  useEffect(() => {
    Promise.all([getAll('profiles'), getAll('routines'), hasPersistentStorage()])
      .then(([savedProfiles, savedRoutines, isPersistent]) => {
        setProfiles(savedProfiles);
        setRoutines(savedRoutines);
        setSelectedProfileId(savedProfiles[0]?.id || null);
        setPersistent(isPersistent);
      })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleUpdate = event => setUpdateRegistration(event.detail);
    const reload = () => window.location.reload();
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
  const routine = profileRoutines.find(item => item.id === selectedRoutineId) ||
    profileRoutines.find(item => item.id === profile?.activeRoutineId) || profileRoutines[0];
  const workout = routine?.workouts.find(item => item.id === workoutId);
  const pending = routine?.workouts.filter(item => !item.completedAt) || [];
  const completed = routine?.workouts.filter(item => item.completedAt).reverse() || [];

  useEffect(() => {
    if (routine && routine.id !== selectedRoutineId) setSelectedRoutineId(routine.id);
  }, [routine, selectedRoutineId]);

  const flash = text => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3000);
  };

  const addProfile = async name => {
    const item = { id: makeId(), name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await save('profiles', item);
    setProfiles(current => [...current, item]);
    setSelectedProfileId(item.id);
    setAddingProfile(false);
    setView('today');
  };

  const saveRoutine = async updated => {
    await save('routines', updated);
    setRoutines(current => current.map(item => item.id === updated.id ? updated : item));
  };

  const addRoutine = async (name, inputs) => {
    const item = createRoutine(profile.id, name, inputs);
    const updatedProfile = { ...profile, activeRoutineId: item.id, updatedAt: new Date().toISOString() };
    await Promise.all([save('routines', item), save('profiles', updatedProfile)]);
    setRoutines(current => [...current, item]);
    setProfiles(current => current.map(entry => entry.id === updatedProfile.id ? updatedProfile : entry));
    setSelectedRoutineId(item.id);
    setView('today');
    flash('Routine created on this phone.');
  };

  const selectRoutine = async item => {
    const updatedProfile = { ...profile, activeRoutineId: item.id, updatedAt: new Date().toISOString() };
    await save('profiles', updatedProfile);
    setProfiles(current => current.map(entry => entry.id === updatedProfile.id ? updatedProfile : entry));
    setSelectedRoutineId(item.id);
  };

  const completeWorkout = async (target, complete = true) => {
    const updated = setWorkoutComplete(routine, target.id, complete);
    await saveRoutine(updated);
    setWorkoutId(null);
    setEditingWorkout(false);
    flash(complete ? 'Workout complete.' : 'Workout returned to your queue.');
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
      const profileIds = new Set(profiles.map(item => item.id));
      const routineIds = new Set(routines.map(item => item.id));
      const importedProfiles = backup.profiles.map(item => profileIds.has(item.id) ? cloneImportedRecord(item) : item);
      const profileIdMap = new Map(backup.profiles.map((item, index) => [item.id, importedProfiles[index].id]));
      const importedRoutines = backup.routines.map(item => {
        const mapped = { ...item, profileId: profileIdMap.get(item.profileId) || item.profileId };
        return routineIds.has(item.id) ? cloneImportedRecord(mapped) : mapped;
      });
      await Promise.all([
        ...importedProfiles.map(item => save('profiles', item)),
        ...importedRoutines.map(item => save('routines', item)),
      ]);
      setProfiles(current => [...current, ...importedProfiles]);
      setRoutines(current => [...current, ...importedRoutines]);
      flash(`Imported ${importedProfiles.length} profiles and ${importedRoutines.length} routines.`);
    } catch (error) {
      flash(error.message);
    }
  };

  const deleteProfile = async () => {
    if (!profile || !window.confirm(`Delete ${profile.name} and every routine stored for this profile?`)) return;
    const owned = routines.filter(item => item.profileId === profile.id);
    await Promise.all([remove('profiles', profile.id), ...owned.map(item => remove('routines', item.id))]);
    const remaining = profiles.filter(item => item.id !== profile.id);
    setProfiles(remaining);
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
      <header className="app-header">
        <div className="header-inner">
          <button className="brand compact-brand" type="button" onClick={() => { setView('today'); setWorkoutId(null); }}><span className="brand-mark">TM</span><span>The McIlroy Method</span></button>
          <div className="profile-switcher">
            <select aria-label="Current profile" value={profile.id} onChange={event => { setSelectedProfileId(event.target.value); setSelectedRoutineId(null); setWorkoutId(null); }}>
              {profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <button type="button" aria-label="Add profile" onClick={() => setAddingProfile(true)}>+</button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {message && <div className="toast" role="status">{message}</div>}
        {updateRegistration && <div className="update-banner"><span>A new version is ready.</span><button type="button" onClick={() => updateRegistration.waiting?.postMessage('skip-waiting')}>Update now</button></div>}

        {view === 'builder' ? (
          <RoutineBuilder profile={profile} count={profileRoutines.length} onCreate={addRoutine} onCancel={() => setView('plans')} />
        ) : workout ? (
          <section className="workout-detail">
            <button className="text-button" type="button" onClick={() => { setWorkoutId(null); setEditingWorkout(false); }}>← Back</button>
            <p className="eyebrow">{workout.cycleLabel ? `${workout.cycleLabel} · ` : ''}{workout.weekLabel}</p>
            <div className="detail-heading"><h1>{workout.name}</h1>{!workout.completedAt && <button className="secondary-button" type="button" onClick={() => setEditingWorkout(!editingWorkout)}>{editingWorkout ? 'Done editing' : 'Edit exercises'}</button>}</div>
            <WorkoutExercises routine={routine} workout={workout} editable={editingWorkout} onChange={editExercise} />
            {workout.completedAt
              ? <button className="secondary-button full-button" type="button" onClick={() => completeWorkout(workout, false)}>Return to workout queue</button>
              : <button className="primary-button complete-button" type="button" onClick={() => completeWorkout(workout)}>Mark workout complete</button>}
          </section>
        ) : view === 'today' ? (
          <section className="dashboard">
            <p className="eyebrow">{routine ? routine.name : 'Ready when you are'}</p>
            <h1>{pending.length ? 'Your next workout' : routine ? 'Routine complete' : `Welcome, ${profile.name}`}</h1>
            {!routine ? (
              <div className="empty-card"><h2>Build your first routine</h2><p>Generate a complete plan and keep it on this phone.</p><button className="primary-button" type="button" onClick={() => setView('builder')}>Build a routine</button></div>
            ) : pending.length ? (
              <>
                <div className="next-workout">
                  <p>{pending[0].cycleLabel && <>{pending[0].cycleLabel} · </>}{pending[0].weekLabel}</p>
                  <h2>{pending[0].name}</h2>
                  <WorkoutExercises routine={routine} workout={pending[0]} editable={false} />
                  <button className="primary-button" type="button" onClick={() => showWorkout(pending[0])}>Open workout</button>
                </div>
                {pending.length > 1 && <div className="up-next"><div className="list-heading"><h2>Coming up</h2>{pending.length > 6 && <button className="text-button" type="button" onClick={() => setShowAllPending(!showAllPending)}>{showAllPending ? 'Show less' : `View all ${pending.length}`}</button>}</div>{(showAllPending ? pending.slice(1) : pending.slice(1, 6)).map(item => <WorkoutCard workout={item} onOpen={() => showWorkout(item)} key={item.id} />)}</div>}
              </>
            ) : <div className="empty-card"><p>Every workout in this routine is complete.</p><button className="primary-button" type="button" onClick={() => setView('builder')}>Build another routine</button></div>}
          </section>
        ) : view === 'plans' ? (
          <section className="section-page">
            <div className="section-heading"><div><p className="eyebrow">{profile.name}</p><h1>Plans</h1></div><button className="primary-button small-primary" type="button" onClick={() => setView('builder')}>New routine</button></div>
            {!profileRoutines.length ? <p>No routines yet.</p> : profileRoutines.map(item => (
              <article className={`plan-card ${item.id === routine?.id ? 'active' : ''}`} key={item.id}>
                <button className="plan-select" type="button" onClick={() => selectRoutine(item)}><span><strong>{item.name}</strong><small>{item.workouts.filter(day => day.completedAt).length} of {item.workouts.length} complete</small></span><span>{item.id === routine?.id ? 'Active' : 'Use plan'}</span></button>
                {item.id === routine?.id && <MaxCorrection routine={item} onCorrect={maxes => { saveRoutine(correctMaxes(item, maxes)); flash('Future workouts updated.'); }} />}
              </article>
            ))}
          </section>
        ) : view === 'history' ? (
          <section className="section-page"><p className="eyebrow">{routine?.name || profile.name}</p><h1>History</h1>{completed.length ? completed.map(item => <WorkoutCard workout={item} onOpen={() => showWorkout(item)} key={item.id} />) : <div className="empty-card"><p>Completed workouts will appear here.</p></div>}</section>
        ) : (
          <section className="section-page settings-page">
            <p className="eyebrow">This phone</p><h1>Settings & backup</h1>
            <article className="settings-card"><h2>Offline storage</h2><p>{persistent ? 'Persistent storage is enabled.' : 'Ask Chrome to protect this app from automatic storage cleanup.'}</p>{!persistent && <button className="secondary-button" type="button" onClick={async () => { const granted = await requestPersistentStorage(); setPersistent(granted); flash(granted ? 'Persistent storage enabled.' : 'Chrome did not grant persistent storage. Keep a recent backup.'); }}>Request persistent storage</button>}</article>
            <article className="settings-card"><h2>Backup and transfer</h2><p>Export a JSON backup before clearing browser data or moving plans to another phone.</p><div className="button-row"><button className="secondary-button" type="button" onClick={() => download(exportBackup(profiles, routines), `mcilroy-method-backup-${new Date().toISOString().slice(0, 10)}.json`)}>Export backup</button><button className="secondary-button" type="button" onClick={() => importRef.current.click()}>Import backup</button><input ref={importRef} className="hidden-input" type="file" accept="application/json,.json" onChange={event => { if (event.target.files[0]) importBackupFile(event.target.files[0]); event.target.value = ''; }} /></div></article>
            <article className="settings-card danger-card"><h2>Delete profile</h2><p>Deletes {profile.name} and every routine belonging to this profile from this phone.</p><button className="danger-button" type="button" onClick={deleteProfile}>Delete {profile.name}</button></article>
          </section>
        )}
      </main>

      {view !== 'builder' && !workout && <nav className="bottom-nav" aria-label="App navigation">{navItems.map(([key, label]) => <button className={view === key ? 'active' : ''} type="button" onClick={() => setView(key)} key={key}>{label}</button>)}</nav>}
    </div>
  );
};

export default App;
