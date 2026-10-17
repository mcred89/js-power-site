import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createStrongmanLogEntry, normalizeMovementName, STRONGMAN_RECORD_GOALS } from '../data/strongman';
import { useUnsavedChanges } from './useUnsavedChanges';
import './StrongmanTraining.css';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const present = value => value !== '' && value !== undefined && value !== null;
const emptySet = () => ({ id: makeId(), weight: '', reps: '', distance: '', seconds: '', height: '', points: '', successful: true });
const medleySet = set => ({ ...set, weight: '', reps: '', distance: '', height: '', points: '' });
const sameEntryContext = (left, right) => ['movement', 'date', 'scope', 'competitionId', 'eventId', 'componentId', 'workoutId', 'notes']
  .every(key => (left[key] || '') === (right[key] || '')) &&
  JSON.stringify(left.eventSnapshot || null) === JSON.stringify(right.eventSnapshot || null);
const setLabel = set => [
  present(set.weight) ? `${set.weight} lb` : '',
  present(set.reps) ? `${set.reps} ${Number(set.reps) === 1 ? 'rep' : 'reps'}` : '',
  present(set.distance) ? `${set.distance} ft` : '',
  present(set.height) ? `${set.height} in height` : '',
  present(set.seconds) ? `${set.seconds} s` : '',
  present(set.points) ? `${set.points} points` : '',
  set.successful === false ? 'Unsuccessful' : '',
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

/** One editable set at a time, shared by the workout logger and Progress. */
export const StrongmanResultEditor = ({
  entry = null, appendToEntry = null, competition, competitionOptions, knownMovements = [], workoutId = null,
  initialDate, focusLastSet = false, editSetId, newRun = false, newSet = false, showDate, onSave, onCancel,
}) => {
  const individualEdit = Boolean(entry && editSetId);
  const [draft, setDraft] = useState(() => entry ? {
    ...entry, sets: entry.sets.filter(set => !editSetId || set.id === editSetId)
      .map(set => entry.scope === 'medley' ? medleySet(set) : { ...set }),
    eventSnapshot: entry.eventSnapshot ? JSON.parse(JSON.stringify(entry.eventSnapshot)) : null,
  } : {
    id: makeId(), date: initialDate || today(), workoutId, competitionId: competition?.id || null,
    movement: '', eventId: null, componentId: null, scope: 'movement', eventSnapshot: null, sets: [emptySet()], notes: '',
  });
  const [selected, setSelected] = useState(entry ? 'custom' : '');
  const [activeSetId, setActiveSetId] = useState(() => draft.sets.find(set => set.id === editSetId)?.id ||
    draft.sets[focusLastSet ? draft.sets.length - 1 : 0]?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const headingRef = useRef(null);
  const setsRef = useRef(null);
  const focusSetRef = useRef(focusLastSet || Boolean(editSetId));
  useUnsavedChanges(true, saving);
  const selectedCompetition = competitionOptions ? competitionOptions.find(item => item.id === draft.competitionId) : competition;
  const choices = useMemo(() => competitionChoices(selectedCompetition), [selectedCompetition]);
  const movements = [...new Set(knownMovements)].filter(name => name && !choices.some(choice => (
    choice.scope === 'movement' && normalizeMovementName(choice.movement) === normalizeMovementName(name)
  ))).sort((a, b) => a.localeCompare(b));
  const goal = draft.eventSnapshot?.timeGoal || 'fastest';
  const isMedley = draft.scope === 'medley';
  const timeWindow = !isMedley && ['reps', 'distance', 'height', 'points'].includes(goal);
  const isNew = !entry || newSet || newRun;
  const setName = isMedley ? 'Run' : 'Set';
  const newSetNumber = (appendToEntry?.sets.length || 0) + 1;
  const editedSetNumber = individualEdit ? entry.sets.findIndex(set => set.id === editSetId) + 1 : null;
  const displayedSetCount = individualEdit ? entry.sets.length : draft.sets.length;
  const showTrainingDate = showDate ?? !(workoutId || draft.workoutId);
  const customMovement = !entry && (selected === 'custom' || (selected && !selected.startsWith('past:') &&
    !choices.find(choice => choice.key === selected)?.movement));
  const primaryHeight = set => goal === 'height' || present(entry?.sets.find(item => item.id === set.id)?.height);
  const primaryPoints = set => goal === 'points' || present(entry?.sets.find(item => item.id === set.id)?.points);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!focusSetRef.current) return;
    setsRef.current?.querySelector('.strongman-training-set input')?.focus();
    focusSetRef.current = false;
  }, [activeSetId]);

  const update = values => { setDraft(current => ({ ...current, ...values })); setError(''); };
  const updateSnapshot = values => update({ eventSnapshot: {
    ...(draft.eventSnapshot || { id: makeId(), name: draft.movement, type: 'single', components: [] }), ...values,
  } });
  const updateSet = (index, values) => {
    setDraft(current => ({ ...current,
      sets: current.sets.map((set, setIndex) => setIndex === index ? { ...set, ...values } : set),
    }));
    setError('');
  };
  const selectExercise = value => {
    setSelected(value);
    const choice = choices.find(item => item.key === value);
    update({
      movement: choice?.movement || (value.startsWith('past:') ? value.slice(5) : ''),
      eventId: choice?.event.id || null, componentId: choice?.component?.id || null, scope: choice?.scope || 'movement',
      ...(choice?.scope === 'medley' ? { sets: draft.sets.map(medleySet) } : {}),
      eventSnapshot: choice ? JSON.parse(JSON.stringify(choice.component
        ? { ...choice.component, type: 'single', components: [] } : choice.event)) : null,
    });
  };
  const updateComponent = (index, key, value) => setDraft(current => ({
    ...current, eventSnapshot: { ...current.eventSnapshot,
      components: current.eventSnapshot.components.map((component, componentIndex) => (
        componentIndex === index ? { ...component, [key]: value } : component
      )),
    },
  }));
  const addComponent = () => update({ eventSnapshot: {
    ...draft.eventSnapshot, name: draft.eventSnapshot?.name || draft.movement, type: 'medley',
    components: [...(draft.eventSnapshot?.components || []), {
      id: makeId(), name: '', weight: '', distance: '', reps: '', seconds: '',
    }],
  } });
  const removeComponent = index => update({ eventSnapshot: {
    ...draft.eventSnapshot, components: draft.eventSnapshot.components.filter((_, componentIndex) => componentIndex !== index),
  } });
  const removeSet = index => {
    const remaining = draft.sets.filter((_, setIndex) => setIndex !== index);
    if (draft.sets[index].id === activeSetId) setActiveSetId(remaining[Math.min(index, remaining.length - 1)]?.id);
    update({ sets: remaining });
  };
  const save = async event => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      if (individualEdit && !editedSetNumber) throw new Error('This set is no longer available. Close the editor and choose another set.');
      const normalized = createStrongmanLogEntry(draft);
      if (individualEdit && sameEntryContext(draft, entry)) {
        await onSave({ ...entry, sets: entry.sets.map(set => set.id === editSetId ? normalized.sets[0] : set), updatedAt: normalized.updatedAt });
      } else if (individualEdit && entry.sets.length > 1) {
        await onSave({ ...normalized, id: makeId(), createdAt: normalized.updatedAt },
          { ...entry, sets: entry.sets.filter(set => set.id !== editSetId) });
      } else {
        const sameContext = appendToEntry && sameEntryContext(draft, appendToEntry);
        await onSave(sameContext ? { ...appendToEntry, sets: [...appendToEntry.sets, ...normalized.sets], updatedAt: normalized.updatedAt } : normalized);
      }
      onCancel();
    } catch (saveError) {
      setError(saveError.message || 'Could not save this training. Your entries are still here; try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const movementField = <label className="strongman-training-field">
    <span className="field-label">Movement</span>
    <input className="number-input" value={draft.movement} required maxLength="160" onChange={event => update({ movement: event.target.value })} />
  </label>;
  const dateField = <label className="strongman-training-field">
    <span className="field-label">Training date</span>
    <input className="number-input" type="date" value={draft.date} required max={today()} onChange={event => update({ date: event.target.value })} />
  </label>;

  return <form className="strongman-result-editor" onSubmit={save} onInvalid={event => {
    let parent = event.target.parentElement;
    while (parent && parent !== event.currentTarget) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
  }}>
    <h3 tabIndex="-1" ref={headingRef}>{isNew
      ? draft.movement ? `${draft.movement} · ${setName} ${newSetNumber}` : 'Log an exercise'
      : 'Edit training'}</h3>
    <fieldset disabled={saving}>
      {!entry && <label className="strongman-training-field">
        <span className="field-label">Exercise</span>
        <select className="select-input" aria-label="Exercise" value={selected} onChange={event => selectExercise(event.target.value)} required>
          <option value="" disabled>Choose or add an exercise</option>
          {choices.length > 0 && <optgroup label="Competition events">
            {choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </optgroup>}
          {movements.length > 0 && <optgroup label="Previous training">
            {movements.map(name => <option key={name} value={`past:${name}`}>{name}</option>)}
          </optgroup>}
          <option value="custom">New exercise</option>
        </select>
      </label>}
      {customMovement && movementField}
      {showTrainingDate && dateField}
      {(entry || selected) && <>
        <div className="strongman-training-sets" ref={setsRef}>
          {individualEdit && entry.sets.map((set, index) => set.id !== editSetId && <div className="strongman-training-saved-set" key={set.id}>
            <span><strong>{setName} {index + 1}</strong> · {setLabel(set)}</span>
          </div>)}
          {draft.sets.map((set, index) => set.id !== activeSetId ? <div className="strongman-training-saved-set" key={set.id}>
            <span><strong>{setName} {index + 1}</strong> · {setLabel(set)}</span>
            <button type="button" className="text-button" aria-label={`Edit ${setName.toLowerCase()} ${index + 1}`} onClick={() => {
              focusSetRef.current = true;
              setActiveSetId(set.id);
            }}>Edit {setName.toLowerCase()} {index + 1}</button>
          </div> : <div className="strongman-training-set" key={set.id} data-set-id={set.id}>
            <div className="strongman-training-set-heading">
              <h4>{setName} {isNew ? newSetNumber : editedSetNumber || index + 1}{!isNew && displayedSetCount > 1 ? ` of ${displayedSetCount}` : ''}</h4>
              {draft.sets.length > 1 && <button type="button" className="text-button" aria-label={`Remove ${setName.toLowerCase()} ${index + 1}`} onClick={() => removeSet(index)}>Remove</button>}
            </div>
            <div className="strongman-training-metrics strongman-editor-metrics">
              {!isMedley && primaryPoints(set) && <MetricInput label="Points" value={set.points} onChange={value => updateSet(index, { points: value })} />}
              {!isMedley && primaryHeight(set) && <MetricInput label="Height (in)" value={set.height} onChange={value => updateSet(index, { height: value })} />}
              {!isMedley && <MetricInput label="Weight (lb)" value={set.weight} onChange={value => updateSet(index, { weight: value })} />}
              {!isMedley && <MetricInput label="Reps" value={set.reps} whole onChange={value => updateSet(index, { reps: value })} />}
              {!isMedley && <MetricInput label="Distance (ft)" value={set.distance} onChange={value => updateSet(index, { distance: value })} />}
              <MetricInput label={timeWindow ? 'Time window (s)' : 'Time (s)'} value={set.seconds} onChange={value => updateSet(index, { seconds: value })} />
            </div>
            <details className="strongman-training-extra" open={set.successful === false || undefined}>
              <summary>More set details{set.successful === false ? ' · Unsuccessful' : ''}</summary>
              {!isMedley && !primaryHeight(set) && <MetricInput label="Height (in)" value={set.height} onChange={value => updateSet(index, { height: value })} />}
              {!isMedley && !primaryPoints(set) && <MetricInput label="Points" value={set.points} onChange={value => updateSet(index, { points: value })} />}
              <label className="strongman-training-outcome">
                <span className="field-label">Result</span>
                <select className="select-input" aria-label="Result" value={set.successful === false ? 'failed' : 'completed'}
                  onChange={event => updateSet(index, { successful: event.target.value === 'completed' })}>
                  <option value="completed">{isMedley ? 'Completed full event' : 'Completed'}</option>
                  <option value="failed">{isMedley ? 'Did not complete event' : 'Unsuccessful attempt'}</option>
                </select>
              </label>
            </details>
          </div>)}
        </div>
        {isMedley && <details className="strongman-training-course strongman-editor-setup">
          <summary>Actual event setup · {(draft.eventSnapshot?.components || []).map((component, index) => {
            const measures = setLabel(component);
            return `${component.name || `Implement ${index + 1}`}${measures ? ` (${measures})` : ''}`;
          }).join('; ') || 'Add implements'}</summary>
          <p className="muted">Check the implements you used. Best times compare matching setups; individual implement work is logged separately.</p>
          <p className="muted">{individualEdit ? 'Changes apply only to this run. Other runs keep their recorded setup.'
            : 'Every run in this entry shares this setup. For a different setup, log this run, then choose Add run on the saved event.'}</p>
          {(draft.eventSnapshot?.components || []).map((component, index) => <div className="strongman-training-implement" key={component.id || index}>
            <label><span className="field-label">Implement {index + 1}</span>
              <input className="number-input" value={component.name || ''} placeholder="Implement not yet known" onChange={event => updateComponent(index, 'name', event.target.value)} />
            </label>
            <div className="strongman-training-metrics">
              <MetricInput label="Weight (lb)" value={component.weight} onChange={value => updateComponent(index, 'weight', value)} />
              <MetricInput label="Distance (ft)" value={component.distance} onChange={value => updateComponent(index, 'distance', value)} />
              <MetricInput label="Reps" value={component.reps} whole onChange={value => updateComponent(index, 'reps', value)} />
              <MetricInput label="Time (s)" value={component.seconds} onChange={value => updateComponent(index, 'seconds', value)} />
            </div>
            <details className="strongman-training-extra" open={present(component.height) || present(component.points) || undefined}><summary>Height or points (optional)</summary><div className="strongman-training-metrics"><MetricInput label="Height (in)" value={component.height} onChange={value => updateComponent(index, 'height', value)} /><MetricInput label="Points" value={component.points} onChange={value => updateComponent(index, 'points', value)} /></div></details>
            <details className="strongman-training-extra" open={present(component.scoringRules) || undefined}><summary>Implement rules (optional)</summary><label><span className="field-label">Implement {index + 1} scoring rules</span><input className="number-input" value={component.scoringRules || ''} maxLength="2000" onChange={event => updateComponent(index, 'scoringRules', event.target.value)} /></label></details>
            <button type="button" className="text-button" aria-label={`Remove actual implement ${index + 1}`} onClick={() => removeComponent(index)}>Remove implement</button>
          </div>)}
          <button type="button" className="secondary-button" onClick={addComponent}>Add actual implement</button>
        </details>}
      </>}
      <details className="strongman-training-extra strongman-editor-details" open={goal === 'points' && !draft.eventSnapshot?.scoringRules ? true : undefined}>
        <summary>Exercise details</summary>
        {!entry && competitionOptions?.length > 0 && <label className="strongman-training-field">
          <span className="field-label">Competition for this result</span>
          <select className="select-input" aria-label="Competition for this result" value={draft.competitionId || ''} onChange={event => {
            setSelected(draft.movement ? 'custom' : '');
            update({ competitionId: event.target.value || null, eventId: null, componentId: null });
          }}><option value="">No competition</option>{competitionOptions.map(item => <option key={item.id} value={item.id}>{item.name || 'Unnamed competition'}{item.date ? ` · ${item.date}` : ''}</option>)}</select>
        </label>}
        {(entry || selected) && <>
          {!customMovement && movementField}
          {!showTrainingDate && dateField}
          {!isMedley && <label className="strongman-training-field"><span className="field-label">Record goal</span>
            <select className="select-input" aria-label="Record goal" value={goal} onChange={event => updateSnapshot({ timeGoal: event.target.value })}>
              {STRONGMAN_RECORD_GOALS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>}
          {timeWindow && <p className="strongman-training-hint">Leave the time window blank for untimed work. Records compare matching setups and time windows.</p>}
          {!isMedley && goal === 'height' && <p className="strongman-training-hint">Record cleared height in inches, separately from horizontal distance.</p>}
          {!isMedley && goal === 'weight' && <p className="strongman-training-hint">Record weight and actual reps. Failed attempts remain in history but do not count as records.</p>}
          {!isMedley && goal === 'points' && <p className="muted">Enter your actual score manually. Include every implement’s weight, required distance or height, and scoring formula in the rules. For example: 200 lb stone = 1 point; 250 lb stone = 2; both over a 48-inch bar. Update the rules if any load or task changes.</p>}
          <label className="strongman-training-field"><span className="field-label">Scoring rules</span>
            <textarea className="number-input" rows="2" maxLength="2000" value={draft.eventSnapshot?.scoringRules || ''} placeholder="e.g. Best of 3 throws; no drops; 2-inch deficit" onChange={event => updateSnapshot({ scoringRules: event.target.value })} />
          </label>
          <p className="strongman-training-hint">{individualEdit ? 'Changes apply only to this set. Other sets keep their recorded rules and setup.'
            : `Every set in this entry shares these rules and setup.${appendToEntry ? ' Changing them logs this set separately and keeps earlier sets unchanged.' : ''}`}</p>
          {!isMedley && goal === 'points' && <details className="strongman-training-extra"><summary>Fixed event setup (optional)</summary>
            <p className="muted">These are the event’s fixed conditions, copied from the competition when available. They are not completed results. Update them if you practiced different conditions.</p>
            <div className="strongman-training-metrics">
              {[['weight', 'Setup weight (lb)'], ['distance', 'Setup distance (ft)'], ['reps', 'Setup reps'], ['height', 'Setup height (in)']].map(([key, label]) => <MetricInput key={key} label={label} whole={key === 'reps'} value={draft.eventSnapshot?.[key]} onChange={value => updateSnapshot({ [key]: value })} />)}
            </div>
          </details>}
          <label className="strongman-training-field"><span className="field-label">Notes (optional)</span>
            <textarea className="number-input" rows="2" value={draft.notes || ''} maxLength="2000" placeholder="Technique, implement details, or how it felt" onChange={event => update({ notes: event.target.value })} />
          </label>
        </>}
      </details>
      {error && <p role="alert" className="strongman-training-error">{error}</p>}
      <div className="strongman-training-actions">
        <button type="submit" className="primary-button" disabled={!draft.movement.trim()}>{saving ? 'Saving…' : isNew ? `Log ${setName.toLowerCase()}` : 'Save changes'}</button>
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
  </form>;
};

export default StrongmanResultEditor;
