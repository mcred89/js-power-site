import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createStrongmanLogEntry, normalizeMovementName } from '../data/strongman';
import './StrongmanTraining.css';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const localDate = value => {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const today = () => localDate();

const emptySet = () => ({ id: makeId(), weight: '', reps: '', distance: '', seconds: '', successful: true });
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const setLabel = set => [
  set.weight !== '' && set.weight != null ? `${set.weight} lb` : '',
  set.reps !== '' && set.reps != null ? `${set.reps} ${Number(set.reps) === 1 ? 'rep' : 'reps'}` : '',
  set.distance !== '' && set.distance != null ? `${set.distance} ft` : '',
  set.seconds !== '' && set.seconds != null ? `${set.seconds} s` : '',
].filter(Boolean).join(' · ');

const competitionChoices = competition => (competition?.events || []).flatMap(event => (
  event.type === 'medley' ? [
    { key: `event:${event.id}`, label: `${event.name} — full event`, movement: event.name, event, scope: 'medley' },
    ...(event.components || []).map((component, index) => ({
      key: `component:${event.id}:${component.id}`, label: `${component.name || `Implement ${index + 1} (to be announced)`} · ${event.name}`,
      movement: component.name || '', event, component, scope: 'movement',
    })),
  ] : [{ key: `event:${event.id}`, label: event.name, movement: event.name, event, scope: 'movement' }]
));

const MetricInput = ({ label, value, onChange, whole = false }) => <label>
  <span className="field-label">{label}</span>
  <input className="number-input" type="number" inputMode={whole ? 'numeric' : 'decimal'}
    min="0" step={whole ? '1' : 'any'} value={value ?? ''} onChange={event => onChange(event.target.value)} />
</label>;

/** A dated result editor shared by the day logger and Progress backfill. */
export const StrongmanResultEditor = ({
  entry = null, competition, knownMovements = [], workoutId = null, initialDate, focusLastSet = false, onSave, onCancel,
}) => {
  const [draft, setDraft] = useState(() => entry ? {
    ...entry, sets: entry.sets.map(set => ({ ...set })),
    eventSnapshot: entry.eventSnapshot ? JSON.parse(JSON.stringify(entry.eventSnapshot)) : null,
  } : {
    id: makeId(), date: initialDate || today(), workoutId, movement: '', eventId: null, componentId: null,
    scope: 'movement', eventSnapshot: null, sets: [emptySet()], notes: '',
  });
  const [selected, setSelected] = useState(() => entry ? 'custom' : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const headingRef = useRef(null);
  const setsRef = useRef(null);
  const focusSetRef = useRef(focusLastSet ? draft.sets[draft.sets.length - 1]?.id : null);
  const choices = useMemo(() => competitionChoices(competition), [competition]);
  const movements = [...new Set(knownMovements)].filter(name => name && !choices.some(choice => (
    choice.scope === 'movement' && normalizeMovementName(choice.movement) === normalizeMovementName(name)
  ))).sort((a, b) => a.localeCompare(b));

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!focusSetRef.current) return;
    [...(setsRef.current?.children || [])].find(element => element.dataset.setId === focusSetRef.current)?.querySelector('input')?.focus();
    focusSetRef.current = null;
  }, [draft.sets]);

  const update = values => { setDraft(current => ({ ...current, ...values })); setError(''); };
  const updateSet = (index, values) => setDraft(current => ({
    ...current, sets: current.sets.map((set, setIndex) => setIndex === index ? { ...set, ...values } : set),
  }));
  const selectExercise = value => {
    setSelected(value);
    const choice = choices.find(item => item.key === value);
    update({
      movement: choice?.movement || (value.startsWith('past:') ? value.slice(5) : ''),
      eventId: choice?.event.id || null, componentId: choice?.component?.id || null,
      scope: choice?.scope || 'movement',
      eventSnapshot: choice ? JSON.parse(JSON.stringify(choice.component
        ? { ...choice.component, type: 'single', components: [] } : choice.event)) : null,
    });
  };
  const addSet = () => {
    const set = emptySet();
    focusSetRef.current = set.id;
    update({ sets: [...draft.sets, set] });
  };
  const updateComponent = (index, key, value) => setDraft(current => ({
    ...current, eventSnapshot: {
      ...current.eventSnapshot,
      components: current.eventSnapshot.components.map((component, componentIndex) => (
        componentIndex === index ? { ...component, [key]: value } : component
      )),
    },
  }));
  const save = async event => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const normalized = createStrongmanLogEntry(draft);
      await onSave(normalized);
      onCancel();
    } catch (saveError) {
      setError(saveError.message || 'Could not save this training. Your entries are still here; try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <form className="strongman-result-editor" onSubmit={save}>
    <h3 tabIndex="-1" ref={headingRef}>{entry ? 'Edit training' : 'Add exercise'}</h3>
    <p className="muted">Record what you actually do. Start with one set and add more as you go.</p>
    <fieldset disabled={saving}>
      {!entry && <label className="strongman-training-field">
        <span className="field-label">Exercise</span>
        <select className="select-input" aria-label="Exercise" value={selected} onChange={event => selectExercise(event.target.value)} required>
          <option value="" disabled>Choose or add an exercise</option>
          {choices.length > 0 && <optgroup label="Next competition">
            {choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </optgroup>}
          {movements.length > 0 && <optgroup label="Previous training">
            {movements.map(name => <option key={name} value={`past:${name}`}>{name}</option>)}
          </optgroup>}
          <option value="custom">New exercise</option>
        </select>
      </label>}
      {(entry || selected) && <>
        <div className="strongman-training-identity">
          <label>
            <span className="field-label">Movement</span>
            <input className="number-input" value={draft.movement} required maxLength="160"
              onChange={event => update({ movement: event.target.value })} />
          </label>
          <label>
            <span className="field-label">Training date</span>
            <input className="number-input" type="date" value={draft.date} required max={today()}
              onChange={event => update({ date: event.target.value })} />
          </label>
        </div>
        {draft.scope === 'medley' && <div className="strongman-training-course">
          <h4>Actual event setup</h4>
          <p className="muted">Check the implements you used. Best times compare matching setups; individual implement work is logged separately.</p>
          {(draft.eventSnapshot?.components || []).length === 0 && <p>Add the implements to your competition before logging a full event.</p>}
          {(draft.eventSnapshot?.components || []).map((component, index) => <div className="strongman-training-implement" key={component.id || index}>
            <label>
              <span className="field-label">Implement {index + 1}</span>
              <input className="number-input" value={component.name || ''} placeholder="Implement not yet known"
                onChange={event => updateComponent(index, 'name', event.target.value)} />
            </label>
            <div className="strongman-training-metrics">
              <MetricInput label="Weight (lb)" value={component.weight} onChange={value => updateComponent(index, 'weight', value)} />
              <MetricInput label="Distance (ft)" value={component.distance} onChange={value => updateComponent(index, 'distance', value)} />
              <MetricInput label="Reps" value={component.reps} whole onChange={value => updateComponent(index, 'reps', value)} />
              <MetricInput label="Time (s)" value={component.seconds} onChange={value => updateComponent(index, 'seconds', value)} />
            </div>
          </div>)}
        </div>}
        <p className="strongman-training-hint">{draft.scope === 'medley'
          ? 'Record your time and whether you completed the full event.'
          : 'Fill in the measures you used. For a pickup, enter 1 rep. Leave measures you did not track blank.'}</p>
        {draft.scope !== 'medley' && draft.sets.some(set => set.seconds !== '' && set.seconds != null) && <label className="strongman-training-field">
          <span className="field-label">Time record</span>
          <select className="select-input" aria-label="Time record" value={draft.eventSnapshot?.timeGoal || 'fastest'} onChange={event => update({
            eventSnapshot: { ...(draft.eventSnapshot || { id: makeId(), name: draft.movement, type: 'single', components: [] }), timeGoal: event.target.value },
          })}>
            <option value="fastest">Faster is better (run)</option>
            <option value="longest">Longer is better (hold)</option>
          </select>
        </label>}
        <div className="strongman-training-sets" ref={setsRef}>
          {draft.sets.map((set, index) => <div className="strongman-training-set" key={set.id} data-set-id={set.id}>
            <div className="strongman-training-set-heading">
              <h4>{draft.scope === 'medley' ? 'Run' : 'Set'} {index + 1}</h4>
              {draft.sets.length > 1 && <button type="button" className="text-button"
                aria-label={`Remove ${draft.scope === 'medley' ? 'run' : 'set'} ${index + 1}`}
                onClick={() => update({ sets: draft.sets.filter((_, setIndex) => setIndex !== index) })}>Remove</button>}
            </div>
            <div className="strongman-training-metrics">
              {draft.scope !== 'medley' && <MetricInput label="Weight (lb)" value={set.weight} onChange={value => updateSet(index, { weight: value })} />}
              {draft.scope !== 'medley' && <MetricInput label="Reps" value={set.reps} whole onChange={value => updateSet(index, { reps: value })} />}
              {draft.scope !== 'medley' && <MetricInput label="Distance (ft)" value={set.distance} onChange={value => updateSet(index, { distance: value })} />}
              <MetricInput label="Time (s)" value={set.seconds} onChange={value => updateSet(index, { seconds: value })} />
            </div>
            <label className="strongman-training-outcome">
              <span className="field-label">Result</span>
              <select className="select-input" aria-label="Result" value={set.successful === false ? 'failed' : 'completed'}
                onChange={event => updateSet(index, { successful: event.target.value === 'completed' })}>
                <option value="completed">{draft.scope === 'medley' ? 'Completed full event' : 'Completed'}</option>
                <option value="failed">{draft.scope === 'medley' ? 'Did not complete event' : 'Unsuccessful attempt'}</option>
              </select>
            </label>
          </div>)}
        </div>
        <button type="button" className="secondary-button" onClick={addSet}>
          {draft.scope === 'medley' ? 'Add run' : 'Add set'}
        </button>
        <label className="strongman-training-field">
          <span className="field-label">Notes (optional)</span>
          <textarea className="number-input" rows="2" value={draft.notes || ''} maxLength="2000"
            placeholder="Technique, implement details, or how it felt"
            onChange={event => update({ notes: event.target.value })} />
        </label>
      </>}
      {error && <p role="alert" className="strongman-training-error">{error}</p>}
      <div className="strongman-training-actions">
        <button type="submit" className="primary-button" disabled={!draft.movement.trim()}>{saving ? 'Saving…' : 'Save exercise'}</button>
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
};

export const StrongmanTraining = ({ routine, workout, routines = [], onSaveLog, onEditingChange }) => {
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const entries = routine.strongmanLog || [];
  const dayEntries = entries.filter(entry => entry.workoutId === workout.id);
  const knownMovements = [...new Set([routine, ...routines].flatMap(item => (
    (item.strongmanLog || []).filter(entry => entry.scope !== 'medley').map(entry => entry.movement)
  )))];
  useEffect(() => { onEditingChange?.(Boolean(editing) || saving); }, [editing, saving, onEditingChange]);
  const saveEntry = async entry => {
    await onSaveLog(entries.some(item => item.id === entry.id)
      ? entries.map(item => item.id === entry.id ? entry : item) : [...entries, entry]);
    setNotice(entry.workoutId ? 'Exercise saved.' : 'Past training saved. It is included in your cycle records and Progress.');
  };
  const deleteEntry = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSaveLog(entries.filter(entry => entry.id !== deleteId));
      setDeleteId(null);
    } catch (saveError) {
      setError(saveError.message || 'Could not delete this exercise. Try again.');
    } finally { setSaving(false); }
  };

  return <section className="strongman-training card" aria-label="Strongman training log">
    <div className="strongman-training-heading"><div>
      <p className="eyebrow">Your training</p>
      <h2>{workout.completedAt ? 'What you did' : 'What are you working on?'}</h2>
    </div></div>
    {!dayEntries.length && !editing && <p className="muted">Choose your work as you go. Log an exercise, a single implement, or a full event.</p>}
    <div className="strongman-training-entries">
      {dayEntries.map(entry => <article className="strongman-training-entry" key={entry.id}>
        <div className="strongman-training-entry-heading"><div>
          <h3>{entry.movement}</h3>
          <p className="muted">{dateLabel(entry.date)}{entry.scope === 'medley' ? ' · Full event' : ''}</p>
        </div>
          <button type="button" className="text-button" disabled={Boolean(editing) || saving}
            aria-label={`Edit ${entry.movement}`} onClick={() => { setEditing({ entry }); setDeleteId(null); }}>Edit</button>
        </div>
        <ol className="strongman-training-results">
          {entry.sets.map((set, index) => <li key={set.id || index}>
            <span>{setLabel(set)}</span>
            {set.successful === false && <span className="strongman-training-attempt">Unsuccessful</span>}
          </li>)}
        </ol>
        {entry.notes && <p className="strongman-training-notes">{entry.notes}</p>}
        <div className="strongman-training-actions">
          <button type="button" className="secondary-button" disabled={Boolean(editing) || saving}
            onClick={() => { setEditing({ entry: { ...entry, sets: [...entry.sets, emptySet()] }, focusLastSet: true }); setDeleteId(null); }}>
            {entry.scope === 'medley' ? 'Add run' : 'Add set'}
          </button>
          <button type="button" className="text-button" disabled={Boolean(editing) || saving}
            aria-label={`Delete ${entry.movement}`} onClick={() => { setDeleteId(entry.id); setError(''); }}>Delete</button>
        </div>
        {deleteId === entry.id && <div className="strongman-training-delete" role="group" aria-label="Confirm delete exercise">
          <p>Delete this exercise and its {entry.sets.length === 1 ? 'set' : 'sets'}? It will also be removed from your records.</p>
          <div className="strongman-training-actions">
            <button type="button" className="danger-button" onClick={deleteEntry} disabled={saving}>{saving ? 'Deleting…' : 'Delete exercise'}</button>
            <button type="button" className="secondary-button" onClick={() => setDeleteId(null)} disabled={saving}>Keep exercise</button>
          </div>
        </div>}
      </article>)}
    </div>
    {error && <p className="strongman-training-error" role="alert">{error}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
    {editing ? <StrongmanResultEditor key={editing.entry?.id || editing.mode} entry={editing.entry}
      competition={routine.inputs?.strongmanCompetition} knownMovements={knownMovements}
      workoutId={editing.mode === 'past' ? null : workout.id}
      initialDate={editing.mode !== 'past' && workout.completedAt ? localDate(workout.completedAt) : undefined}
      focusLastSet={editing.focusLastSet}
      onSave={saveEntry} onCancel={() => setEditing(null)} />
      : <div className="strongman-training-actions">
        <button type="button" className="primary-button" disabled={saving} onClick={() => { setEditing({ mode: 'day' }); setDeleteId(null); }}>Add exercise</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={() => { setEditing({ mode: 'past' }); setDeleteId(null); }}>Log past training</button>
      </div>}
    {editing?.mode === 'past' && <p className="muted">Choose the date you trained. This result counts toward this cycle and appears in Progress.</p>}
  </section>;
};

export default StrongmanTraining;
