import React, { useRef, useState } from 'react';
import { Field, Measurements, numberValue, recipeDescription, strongmanId } from './StrongmanFields';
import { mergePracticePrescription, prescriptionScopeForPhase, recipeForPractice } from '../data/strongmanPrescription';
import { snapshotPracticeCapabilities } from '../data/strongmanEvidence';
import './Strongman.css';

const copy = value => JSON.parse(JSON.stringify(value));
const recipeFor = exercise => {
  const value = exercise.generated?.event;
  if (value && Object.prototype.hasOwnProperty.call(value, 'recipe')) return value.recipe;
  return value && ['sets', 'weight', 'distance', 'seconds', 'reps', 'parts'].some(key => value[key] != null) ? value : null;
};
const draftFor = recipe => ({ weight: null, reps: null, distance: null, seconds: null, weightUnit: 'lb', distanceUnit: 'ft', loadMeaning: 'total', ...(recipe?.parts?.[0] || recipe || {}), ...(recipe?.parts?.[0] ? { partId: recipe.parts[0].id } : {}), outcome: 'successful', notes: recipe?.notes || '' });
const initialize = (workout, routine) => ({
  ...workout,
  session: {
    ...workout.session,
    eventBlocks: workout.session?.eventBlocks?.map(block => ({
      ...block,
      draft: block.draft || draftFor(block.recipe),
      attempts: block.attempts || [],
      capabilitySnapshot: block.capabilitySnapshot ?? null,
    })) || (workout.exercises || []).map(exercise => {
      const recipe = recipeFor(exercise);
      const eventId = exercise.eventId || exercise.generated?.event?.eventId;
      const practiceId = exercise.practiceId || exercise.generated?.event?.practiceId;
      const event = routine?.inputs?.events.find(item => item.id === eventId);
      const practice = event?.practices.find(item => item.id === practiceId);
      return {
        id: exercise.id,
        eventId,
        practiceId,
        movement: exercise.generated?.movement || exercise.movement || 'Event practice',
        assessment: Boolean(exercise.assessment),
        reason: exercise.reason || '',
        focus: exercise.focus || practice?.focus || '',
        setup: recipe?.parts?.[0]?.setup || recipe?.setup || exercise.setup || exercise.generated?.event?.setup || practice?.setup || '',
        recipe,
        capabilitySnapshot: exercise.capabilitySnapshot ?? null,
        draft: draftFor(recipe),
        attempts: [],
        status: 'pending',
      };
    }),
  },
});

const StrongmanSession = ({ routine, workout, onUpdate, onFinish, onLeave, onSaveRecipe }) => {
  const [current, setCurrent] = useState(() => initialize(copy(workout), routine));
  const currentRef = useRef(current);
  const [undo, setUndo] = useState([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const acceptedRecipes = useRef(new Map());
  const [extraPractice, setExtraPractice] = useState('');
  const readOnly = !onUpdate || Boolean(current.completedAt);
  const blocks = current.session.eventBlocks;
  const events = routine?.inputs?.events || [];
  const scope = prescriptionScopeForPhase(current.phase || current.phaseType);
  const commit = next => {
    currentRef.current = next;
    setCurrent(next);
    onUpdate?.(next);
  };
  const changeBlock = (id, patch, remember = false) => {
    if (remember) {
      const original = currentRef.current.session.eventBlocks.find(block => block.id === id);
      const oldValues = Object.fromEntries(Object.keys(patch).map(key => [key, original[key]]));
      setUndo(previous => [...previous, { id, patch: oldValues }]);
    }
    commit({ ...currentRef.current, session: { ...currentRef.current.session, eventBlocks: currentRef.current.session.eventBlocks.map(block => block.id === id ? { ...block, ...patch } : block) } });
  };
  const changeDraft = (block, draft) => changeBlock(block.id, { draft, ...(draft.partId ? { partDrafts: { ...block.partDrafts, [draft.partId]: draft } } : {}) });
  const choosePart = (block, partId) => {
    const part = block.recipe.parts.find(item => item.id === partId);
    const previousDrafts = { ...block.partDrafts, [block.draft.partId]: { ...block.draft, setup: block.setup } };
    const draft = previousDrafts[partId] || { ...draftFor(part), partId };
    changeBlock(block.id, { draft, partDrafts: previousDrafts, setup: draft.setup || part.setup || '' });
  };
  const recordAttempt = block => {
    const draft = block.draft;
    if (!['weight', 'reps', 'distance', 'seconds'].some(field => draft[field] != null)) {
      setMessage('Enter at least one measurement before recording the attempt.');
      return;
    }
    if (['weight', 'reps', 'distance', 'seconds'].some(field => draft[field] != null && (!Number.isFinite(Number(draft[field])) || Number(draft[field]) < 0))) {
      setMessage('Measurements must be zero or greater. Leave unknown measurements blank.');
      return;
    }
    setMessage('');
    const { sets, ...actual } = draft;
    const attempt = {
      ...actual,
      id: strongmanId('attempt'),
      eventId: block.eventId, practiceId: block.practiceId,
      ...(draft.partId ? { partId: draft.partId, partName: block.recipe.parts.find(part => part.id === draft.partId)?.name } : {}),
      weight: numberValue(draft.weight), reps: numberValue(draft.reps), distance: numberValue(draft.distance), seconds: numberValue(draft.seconds),
      setup: block.setup,
      status: 'completed', completedAt: new Date().toISOString(),
    };
    changeBlock(block.id, { attempts: [...block.attempts, attempt], status: 'completed' }, true);
  };
  const saveRecipe = block => {
    if (savingRef.current) return;
    const fail = error => { savingRef.current = false; setSaving(false); setMessage(error?.message || 'The prescription could not be saved. Try again.'); };
    try {
      const practice = events.find(event => event.id === block.eventId)?.practices.find(item => item.id === block.practiceId);
      const source = recipeForPractice(practice, scope);
      const signature = JSON.stringify(source);
      const key = JSON.stringify([block.eventId, block.practiceId, scope]);
      const cached = acceptedRecipes.current.get(key);
      const accepted = cached && (signature === cached.source || signature === JSON.stringify(cached.recipe)) ? cached.recipe : source || block.recipe;
      const recipe = mergePracticePrescription(accepted, block);
      // Accepted future work is separate from today's frozen prescription and
      // draft. A slow save must not discard edits or attempts entered meanwhile.
      const succeed = () => {
        acceptedRecipes.current.set(key, { source: signature, recipe });
        savingRef.current = false;
        setSaving(false);
        setMessage('This prescription was selected for future practice.');
      };
      savingRef.current = true;
      setSaving(true);
      setMessage('Saving future prescription…');
      const pending = onSaveRecipe?.(block.eventId, block.practiceId, recipe, scope);
      if (pending && typeof pending.then === 'function') pending.then(succeed, fail);
      else succeed();
    } catch (error) { fail(error); }
  };
  const swap = (block, practiceId) => {
    const event = events.find(item => item.id === block.eventId);
    const practice = event?.practices.find(item => item.id === practiceId);
    if (!practice) return;
    const recipe = recipeForPractice(practice, scope);
    changeBlock(block.id, {
      practiceId,
      movement: practice.name,
      setup: recipe?.parts?.[0]?.setup || recipe?.setup || practice.setup || '',
      focus: practice.focus || event.focus || '',
      recipe,
      capabilitySnapshot: snapshotPracticeCapabilities(event, practice, recipe),
      assessment: !recipe,
      draft: draftFor(recipe),
      partDrafts: {},
    }, true);
  };
  const finish = () => {
    const timestamp = new Date().toISOString();
    const elapsed = current.session.runningSince ? Math.max(0, Math.floor((Date.now() - new Date(current.session.runningSince).getTime()) / 1000)) : 0;
    const finishedBlocks = blocks.map(block => {
      const prescriptions = block.recipe?.parts?.length ? block.recipe.parts.map(part => ({ ...part, ...block.partDrafts?.[part.id], ...(block.draft.partId === part.id ? block.draft : {}), partId: part.id })) : [block.draft];
      const skipped = prescriptions.flatMap(prescription => {
        const performed = block.attempts.filter(attempt => attempt.partId === prescription.partId).length;
        const count = Math.max(0, (Number(prescription.sets) || 0) - performed);
        return Array.from({ length: count }, () => ({ id: strongmanId('skip'), eventId: block.eventId, practiceId: block.practiceId, ...(prescription.partId ? { partId: prescription.partId, partName: prescription.name } : {}), weight: null, reps: null, distance: null, seconds: null, status: 'skipped', outcome: null, skippedAt: timestamp, planned: prescription }));
      });
      return { ...block, attempts: [...block.attempts, ...skipped], status: block.status === 'pending' ? 'skipped' : block.status };
    });
    const finalWorkout = { ...current, completedAt: timestamp, session: { ...current.session, status: 'completed', completedAt: timestamp, runningSince: null, elapsedSeconds: (current.session.elapsedSeconds || 0) + elapsed, eventBlocks: finishedBlocks } };
    onFinish(finalWorkout);
  };
  return <section className="strongman-session">
    <div><p className="eyebrow">{current.weekLabel || `Event week ${current.ordinal || 1}`} · {current.phase || current.phaseType || 'Event practice'}</p><h1>{current.name || 'Strongman day'}</h1><p className="strongman-help">{readOnly ? 'Recorded event work and conditions.' : 'The plan gives today a purpose. Set exact work from your available equipment and previous practice.'}</p></div>
    {message && <p className="strongman-error" role="status">{message}</p>}
    {blocks.map((block, index) => {
      const event = events.find(item => item.id === block.eventId);
      const prefix = `Block ${index + 1}`;
      const previous = (routine?.workouts || []).filter(day => day.id !== current.id && day.completedAt).flatMap(day => day.session?.eventBlocks || []).filter(item => item.practiceId === block.practiceId && item.setup === block.setup).slice(-1)[0];
      return <article className="strongman-card" key={block.id}>
        <div className="strongman-row spread"><h2>{index + 1}. {block.movement}</h2>{block.assessment && <span className="strongman-badge">Baseline assessment</span>}</div>
        {block.reason && <p>{block.reason}</p>}
        {(block.focus || event?.focus) && <p><strong>Focus:</strong> {block.focus || event.focus}</p>}
        <p><strong>Accepted work:</strong> {recipeDescription(block.recipe)}</p>
        {block.assessment && !readOnly && <p className="strongman-help">Establish manageable, repeatable work and record where performance breaks down. A failed pick and a lighter carry can provide different information.</p>}
        {previous && <details className="strongman-inset"><summary>Previous comparable practice</summary><ul className="strongman-attempts">{previous.attempts.map(attempt => <li key={attempt.id}>{recipeDescription(attempt)} · {attempt.outcome}{attempt.notes ? ` — ${attempt.notes}` : ''}</li>)}</ul></details>}
        {!readOnly && block.status !== 'skipped' && <>
          {event?.practices.length > 1 && <Field label="Practice for today" ariaLabel={`${prefix} practice`} value={block.practiceId} disabled={block.attempts.length > 0} onChange={practiceId => swap(block, practiceId)}>{event.practices.filter(practice => practice.available !== false || practice.id === block.practiceId).map(practice => <option value={practice.id} key={practice.id}>{practice.name}</option>)}</Field>}
          {block.recipe?.parts?.length > 0 && <Field label="Component / medley leg" ariaLabel={`${prefix} component`} value={block.draft.partId} onChange={partId => choosePart(block, partId)}>{block.recipe.parts.map((part, partIndex) => <option value={part.id} key={part.id}>{partIndex + 1}. {part.name}</option>)}</Field>}
          <Field label="Setup / height / surface / assistance" ariaLabel={`${prefix} setup`} value={block.setup} onChange={setup => changeBlock(block.id, { setup })} />
          <Measurements prefix={prefix} sets value={block.draft} onChange={draft => changeDraft(block, draft)} />
          <div className="strongman-grid"><Field label="Attempt outcome" ariaLabel={`${prefix} outcome`} value={block.draft.outcome} onChange={outcome => changeDraft(block, { ...block.draft, outcome })}><option value="successful">Successful</option><option value="partial">Partial</option><option value="unsuccessful">Unsuccessful</option></Field><Field label="Attempt / technique notes" ariaLabel={`${prefix} notes`} value={block.draft.notes} onChange={notes => changeDraft(block, { ...block.draft, notes })} /></div>
          <button className="primary-button" type="button" onClick={() => recordAttempt(block)}>Record attempt</button>
          {onSaveRecipe && <p className="strongman-help">Future prescription: {scope === 'taper' ? 'taper / recovery work' : 'base / development / specific work'}.</p>}
          <div className="strongman-row"><button className="text-button" type="button" onClick={() => changeBlock(block.id, { status: 'skipped' }, true)}>Skip remaining work</button>{onSaveRecipe && <button className="text-button" type="button" disabled={saving} onClick={() => saveRecipe(block)}>Use this prescription next time</button>}</div>
        </>}
        {block.status === 'skipped' && <p>Remaining work skipped.</p>}
        {block.attempts.length > 0 && <><h3 className="strongman-inset">Recorded attempts</h3><ol className="strongman-attempts">{block.attempts.map(attempt => <li key={attempt.id}><strong>{attempt.partName ? `${attempt.partName}: ` : ''}{attempt.status === 'skipped' ? 'Skipped planned attempt' : recipeDescription(attempt)}</strong>{attempt.outcome ? ` · ${attempt.outcome}` : ''}{attempt.setup ? ` · ${attempt.setup}` : ''}{attempt.notes ? ` — ${attempt.notes}` : ''}</li>)}</ol></>}
        {readOnly && !block.attempts.length && <p>No attempts recorded.</p>}
      </article>;
    })}
    {!readOnly && <details className="strongman-card"><summary>Add practice for today</summary><p className="strongman-help">An explicit addition may exceed the four generated blocks. Allocate its work yourself; normal-day prescriptions stay unchanged.</p><Field label="Extra practice" value={extraPractice} onChange={setExtraPractice}><option value="">Choose a practice</option>{events.flatMap(event => event.practices.filter(practice => practice.available !== false).map(practice => <option key={`${event.id}:${practice.id}`} value={`${event.id}:${practice.id}`}>{event.name} · {practice.name}</option>))}</Field><button className="secondary-button" type="button" disabled={!extraPractice} onClick={() => {
      const event = events.find(item => item.practices.some(practice => `${item.id}:${practice.id}` === extraPractice));
      const practice = event?.practices.find(item => `${event.id}:${item.id}` === extraPractice);
      if (!practice) return;
      const recipe = recipeForPractice(practice, scope);
      const block = { id: strongmanId('extra'), eventId: event.id, practiceId: practice.id, movement: practice.name, recipe, draft: draftFor(recipe), setup: recipe?.parts?.[0]?.setup || recipe?.setup || practice.setup || '', focus: practice.focus || event.focus || '', capabilitySnapshot: snapshotPracticeCapabilities(event, practice, recipe), assessment: !recipe, reason: 'Added for today', attempts: [], status: 'pending' };
      commit({ ...current, session: { ...current.session, eventBlocks: [...blocks, block] } });
      setExtraPractice('');
    }}>Add extra practice</button></details>}
    {!readOnly && <div className="strongman-card"><p>Finish saves recorded attempts and marks untouched blocks skipped. It does not automatically advance capabilities or increase future prescriptions.</p><button className="text-button" type="button" disabled={!undo.length} onClick={() => { const previous = undo[undo.length - 1]; setUndo(undo.slice(0, -1)); changeBlock(previous.id, previous.patch); }}>Undo latest attempt</button><button className="primary-button" type="button" onClick={finish}>Finish event day</button></div>}
    <button className="text-button" type="button" onClick={onLeave}>{readOnly ? 'Back to plan' : 'Leave and resume later'}</button>
  </section>;
};

export default StrongmanSession;
