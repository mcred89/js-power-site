import React, { useRef, useState } from 'react';
import StrongmanBuilder from './StrongmanBuilder';
import StrongmanSession from './StrongmanSession';
import StrongmanPlanDetails from './StrongmanPlanDetails';
import { acceptPracticeRecipe, adaptStrongmanRoutine, confirmCapability, createStrongmanRoutine, nextStrongmanWorkout, updateStrongmanInputs } from '../data/strongman';
import { eventCoverageEvidence, finishLinkedEvent, reopenLinkedEvent, resumePausedLinkedEvent, skipEventWorkout, startLinkedEvent } from '../data/strongmanIntegration';
import './Strongman.css';

const timestamp = () => new Date().toISOString();

const StrongmanWorkspace = ({ profile, routines, request = {}, onCommit, onBack }) => {
  const plans = routines.filter(item => item.profileId === profile.id && item.kind === 'strongman');
  const requestedPlan = plans.find(item => item.id === request.planId);
  const initialPlan = requestedPlan || plans.find(item => item.id === profile.activeStrongmanRoutineId) || plans[0];
  const [selectedId, setSelectedId] = useState(initialPlan?.id);
  const [editing, setEditing] = useState(Boolean(request.create || request.edit || (!plans.length && !request.hostWorkoutId)));
  const [creating, setCreating] = useState(Boolean(request.create || !plans.length));
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(initialPlan?.workouts.some(item => item.id === request.workoutId) ? request.workoutId : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = plans.find(item => item.id === selectedId);
  const planRef = useRef(selected);
  const observedPlan = useRef(selected);
  if (selected !== observedPlan.current) {
    observedPlan.current = selected;
    if (selected && (!planRef.current || selected.updatedAt >= planRef.current.updatedAt)) planRef.current = selected;
  }
  const storedPlan = planRef.current?.id === selectedId ? planRef.current : selected;
  // Coverage sources can change while the event plan is closed. Refresh only the
  // read-only forecast here; an actual start atomically persists its chosen draft.
  const plan = storedPlan ? adaptStrongmanRoutine(storedPlan, eventCoverageEvidence(storedPlan, routines)) : storedPlan;
  const pending = plan && nextStrongmanWorkout(plan);
  const requestedHost = routines.find(item => item.id === request.hostRoutineId && item.profileId === profile.id);
  const host = requestedHost?.workouts.find(item => item.id === request.hostWorkoutId);
  const workout = plan?.workouts.find(item => item.id === selectedWorkoutId || item.id === host?.eventRef?.workoutId)
    || plan?.workouts.find(item => ['inProgress', 'paused'].includes(item.session?.status)) || (host && !host.completedAt && pending);
  const run = async task => {
    setError('');
    setBusy(true);
    try { return await task(); } catch (failure) { setError(failure.message); return null; } finally { setBusy(false); }
  };
  const commitPlan = async updated => {
    const previous = planRef.current;
    planRef.current = updated;
    try { await onCommit({ routines: [updated], conditions: { routines: [{ key: previous.id, expected: previous }] } }); }
    catch (failure) { planRef.current = previous; throw failure; }
  };
  const withEvidence = updated => adaptStrongmanRoutine(updated, eventCoverageEvidence(updated, routines));
  const saveInputs = (name, inputs) => run(async () => {
    const previous = creating ? undefined : planRef.current;
    const updated = creating ? createStrongmanRoutine(profile.id, name, inputs)
      : { ...updateStrongmanInputs(previous, inputs), name };
    const otherActive = updated.status === 'active' ? plans.filter(item => item.id !== updated.id && item.status === 'active') : [];
    if (otherActive.some(item => item.workouts.some(day => day.session?.status === 'inProgress'))) throw new Error('Finish the active event workout before activating another block.');
    const changes = [withEvidence(updated), ...otherActive.map(item => ({ ...item, status: 'paused', updatedAt: timestamp() }))];
    await onCommit({
      routines: changes,
      ...(updated.status === 'active' ? { profile: { ...profile, activeStrongmanRoutineId: updated.id, updatedAt: timestamp() } } : {}),
      conditions: {
        routines: [{ key: updated.id, expected: previous }, ...otherActive.map(item => ({ key: item.id, expected: item }))],
        ...(updated.status === 'active' ? { profiles: [{ key: profile.id, expected: profile }] } : {}),
      },
    });
    planRef.current = changes[0];
    setSelectedId(updated.id);
    setEditing(false);
    setCreating(false);
  });
  const changeStatus = status => run(async () => {
    const previous = planRef.current;
    if (previous.workouts.some(item => item.session?.status === 'inProgress')) throw new Error('Finish this event workout before changing the block status.');
    const others = status === 'active' ? plans.filter(item => item.id !== plan.id && item.status === 'active') : [];
    if (others.some(item => item.workouts.some(day => day.session?.status === 'inProgress'))) throw new Error('Finish the active event workout first.');
    const updated = withEvidence({ ...previous, status, updatedAt: timestamp() });
    await onCommit({
      routines: [updated, ...others.map(item => ({ ...item, status: 'paused', updatedAt: timestamp() }))],
      profile: { ...profile, activeStrongmanRoutineId: status === 'active' ? plan.id : profile.activeStrongmanRoutineId === plan.id ? null : profile.activeStrongmanRoutineId, updatedAt: timestamp() },
      conditions: { routines: [previous, ...others].map(item => ({ key: item.id, expected: item })), profiles: [{ key: profile.id, expected: profile }] },
    });
    planRef.current = updated;
  });
  const start = target => run(async () => {
    const current = planRef.current;
    const change = startLinkedEvent({ profile, eventPlan: current, draftPlan: withEvidence(current), workoutId: target.id, hostRoutine: host && !host.completedAt ? requestedHost : undefined, hostWorkoutId: host?.id });
    await onCommit(change);
    planRef.current = change.routines[0];
    setSelectedWorkoutId(target.id);
  });
  const updateSession = updatedWorkout => {
    const current = planRef.current;
    const updated = { ...current, updatedAt: timestamp(), workouts: current.workouts.map(item => item.id === updatedWorkout.id ? updatedWorkout : item) };
    // Full session drafts are published immediately and writes are serialized by the
    // tracker. Every keystroke survives navigation without a second debounce buffer.
    commitPlan(updated).catch(failure => setError(failure.message));
  };
  const finish = updatedWorkout => run(async () => {
    const current = planRef.current;
    const original = current.workouts.find(item => item.id === updatedWorkout.id);
    const hostRoutine = routines.find(item => item.id === original.hostRef?.routineId);
    const change = finishLinkedEvent({ profile, eventPlan: current, workout: updatedWorkout, hostRoutine });
    change.routines[0] = withEvidence(change.routines[0]);
    await onCommit(change);
    planRef.current = change.routines[0];
    setSelectedWorkoutId(null);
    onBack();
  });
  const reopen = target => run(async () => {
    const change = reopenLinkedEvent({ profile, eventPlan: planRef.current, workoutId: target.id, hostRoutine: routines.find(item => item.id === target.hostRef?.routineId) });
    await onCommit(change);
    planRef.current = change.routines[0];
    setSelectedWorkoutId(target.id);
  });
  const resume = target => run(async () => {
    const change = resumePausedLinkedEvent({ profile, eventPlan: planRef.current, workoutId: target.id, hostRoutine: routines.find(item => item.id === target.hostRef?.routineId) });
    await onCommit(change);
    planRef.current = change.routines[0];
    setSelectedWorkoutId(target.id);
  });
  const saveRecipe = async (eventId, practiceId, recipe, scope = 'normal') => {
    try { await commitPlan(withEvidence(acceptPracticeRecipe(planRef.current, eventId, practiceId, recipe, scope))); }
    catch (failure) { setError(failure.message); throw failure; }
  };
  const skip = workoutId => run(async () => {
    const previous = planRef.current;
    const updated = withEvidence(skipEventWorkout(previous, workoutId));
    const clearsEnrollment = updated.status === 'complete' && profile.activeStrongmanRoutineId === updated.id;
    await onCommit({
      routines: [updated],
      ...(clearsEnrollment ? { profile: { ...profile, activeStrongmanRoutineId: null, updatedAt: timestamp() } } : {}),
      conditions: {
        routines: [{ key: previous.id, expected: previous }],
        ...(clearsEnrollment ? { profiles: [{ key: profile.id, expected: profile }] } : {}),
      },
    });
    planRef.current = updated;
    setSelectedWorkoutId(null);
  });
  const attachLegacy = normal => run(async () => {
    const updated = { ...normal, updatedAt: timestamp(), workouts: normal.workouts.map(day => day.name === 'Strongman' && !day.kind && !day.completedAt && !day.session && day.exercises.length === 1 && day.exercises[0].generated.movement === 'Strongman day' && Object.keys(day.exercises[0].overrides || {}).length === 0
      ? { ...day, kind: 'eventSlot', eventRef: null, exercises: [] } : day) };
    await onCommit({ routines: [updated], conditions: { routines: [{ key: normal.id, expected: normal }] } });
  });

  const useManualSlot = () => run(async () => {
    const updated = { ...requestedHost, updatedAt: timestamp(), workouts: requestedHost.workouts.map(day => day.id === host.id
      ? { ...day, kind: 'manualEvent', eventRef: null, exercises: [{ id: `${day.id}:manual`, generated: { movement: 'Strongman day', weight: '', prescription: '' }, overrides: {} }] } : day) };
    await onCommit({ routines: [updated], conditions: { routines: [{ key: requestedHost.id, expected: requestedHost }] } });
    onBack();
  });

  if (editing) return <><button className="text-button" onClick={onBack}>← Back to training</button>{error && <p role="alert">{error}</p>}<StrongmanBuilder key={creating ? 'new' : plan?.id} profile={profile} initialRoutine={creating ? request.template : plan} onSave={saveInputs} onCancel={() => { if (!plan) onBack(); else setEditing(false); }} /></>;
  const evidence = plan ? eventCoverageEvidence(plan, routines) : [];
  return <section>
    <button className="text-button" onClick={onBack}>← Back to training</button>
    {error && <p className="strongman-error" role="alert">{error}</p>}
    {busy && <p role="status">Saving event plan…</p>}
    {host?.completedAt && !host.eventRef && <p>This Strongman day is complete. Its original event block has been removed.</p>}
    {host && !host.completedAt && !host.eventRef && (!pending || plan?.status !== 'active') && <div className="strongman-card"><h2>No active event week for this slot</h2><p>Activate or create a block, or enter this day manually.</p><button className="secondary-button" onClick={useManualSlot}>Use manual event day</button></div>}
    {workout?.session?.status === 'inProgress' ? <StrongmanSession key={workout.id} routine={plan} workout={workout} onUpdate={updateSession} onFinish={finish} onLeave={onBack} onSaveRecipe={saveRecipe} />
      : workout ? <>
        <p className="eyebrow">{plan.name} · {workout.weekLabel} · {workout.phase}</p>
        <h1>{workout.completedAt ? 'Event history' : 'Next event session'}</h1>
        {host && <p>Uses the Strongman day in {requestedHost.name}. This preview reserves no event week.</p>}
        {workout.completedAt ? <><StrongmanSession key={workout.id} routine={plan} workout={workout} onLeave={onBack} /><button className="secondary-button" disabled={busy} onClick={() => reopen(workout)}>Reopen event workout</button></>
          : workout.session?.status === 'paused' ? <><p>This saved session is paused. Activate its block and resume it when no other workout is active.</p><StrongmanSession key={`${workout.id}:paused`} routine={plan} workout={workout} onLeave={onBack} />{plan.status !== 'active' && <button className="secondary-button" disabled={busy} onClick={() => changeStatus('active')}>Activate block</button>}<button className="primary-button" disabled={busy || plan.status !== 'active' || Boolean(profile.activeWorkoutRoutineId)} onClick={() => resume(workout)}>Resume paused event day</button></>
          : <><ul>{workout.exercises.map(exercise => <li key={exercise.id}><strong>{exercise.generated.movement}</strong> · {exercise.reason} · {exercise.generated.prescription}</li>)}</ul><button className="primary-button" disabled={busy || plan.status !== 'active'} onClick={() => start(workout)}>Start event day</button><button className="text-button" disabled={busy} onClick={() => { setSelectedWorkoutId(null); if (host) onBack(); }}>View block</button></>}
      </> : <>
        <div className="button-row"><button className="primary-button" onClick={() => { setCreating(true); setEditing(true); }}>New strongman block</button>{plans.length > 1 && <select aria-label="Strongman block" value={selectedId || ''} onChange={event => { planRef.current = null; setSelectedId(event.target.value); }}>{plans.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select>}</div>
        {pending && <div className="strongman-card"><h2>Next: {pending.weekLabel}</h2><p>{pending.phase} · {pending.exercises.length} practices</p><button className="primary-button" onClick={() => setSelectedWorkoutId(pending.id)}>Open event day</button><p>Available on its own or through your next normal-routine Strongman slot.</p></div>}
        {evidence.some(item => item.needsReview) && <p role="status">Some normal-day event coverage needs review. Its prescriptions have not been changed.</p>}
        {plan && <StrongmanPlanDetails routine={plan} routines={routines.filter(item => item.kind !== 'strongman')} onEdit={() => { setCreating(false); setEditing(true); }} onStatus={changeStatus} onRecipe={saveRecipe} onCapability={(eventId, capabilityId, status) => run(() => commitPlan(withEvidence(confirmCapability(planRef.current, eventId, capabilityId, status))))} onLock={(workoutId, locked) => run(() => commitPlan(withEvidence({ ...planRef.current, updatedAt: timestamp(), workouts: planRef.current.workouts.map(item => item.id === workoutId ? { ...item, locked } : item) })))} onSkip={skip} onOpen={item => setSelectedWorkoutId(item.id)} onCoverage={(eventId, coverage) => run(() => commitPlan(withEvidence(updateStrongmanInputs(planRef.current, { ...planRef.current.inputs, events: planRef.current.inputs.events.map(event => event.id === eventId ? { ...event, coverage } : event) }))))} />}
        {routines.filter(normal => normal.kind !== 'strongman' && normal.workouts.some(day => day.name === 'Strongman' && !day.kind && !day.completedAt && !day.session && day.exercises.length === 1 && day.exercises[0].generated.movement === 'Strongman day' && Object.keys(day.exercises[0].overrides || {}).length === 0)).map(normal => <div className="strongman-card" key={normal.id}><p>{normal.name} has untouched Strongman placeholders.</p><button className="secondary-button" onClick={() => attachLegacy(normal)}>Connect future event slots</button></div>)}
      </>}
  </section>;
};

export default StrongmanWorkspace;
