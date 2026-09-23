import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput';
import LiftProgressionControls from './LiftProgressionControls';
import { getLiftProgressionMode } from '../data/routineGeneration';
import { getPlanUpdateSummary, updateRoutinePlan } from '../data/routineUpdates';
import './PlanUpdateEditor.css';

const lifts = [
  { key: 'squat', label: 'Squat', max: 'maxSquat' },
  { key: 'press', label: 'Press', max: 'maxPress' },
  { key: 'deadlift', label: 'Deadlift', max: 'maxDead' },
];

const progressionLabels = {
  same: 'Keep maxes the same',
  fixed: 'Increase by set amounts',
  adaptive: 'Adapt from completed sets',
};

const accessoryChoices = {
  pressWeakPoint: [
    ['', 'None'],
    ['Shoulders', 'Shoulders — Dumbbell overhead press'],
    ['Triceps', 'Triceps — Tricep extensions'],
  ],
  deadliftWeakPoint: [
    ['', 'None'],
    ['Back', 'Back — Bent over rows'],
    ['Glutes', 'Glutes — Hip thrusters'],
    ['Hamstrings', 'Hamstrings — Romanian deadlifts'],
  ],
};

// Older plans may predate optional controls. Match generator behavior when
// displaying them, so opening the editor does not introduce settings changes.
const initialDraft = inputs => ({
  ...inputs,
  maxProgressionMode: inputs.maxProgressionMode || 'fixed',
  liftProgressionModes: { ...inputs.liftProgressionModes },
  squatIncrement: inputs.squatIncrement ?? 0,
  pressIncrement: inputs.pressIncrement ?? 0,
  deadliftIncrement: inputs.deadliftIncrement ?? 0,
  pressWeakPoint: inputs.pressWeakPoint || '',
  deadliftWeakPoint: inputs.deadliftWeakPoint || '',
  includeBackoffSets: Boolean(inputs.includeBackoffSets),
  ...Object.fromEntries(lifts.flatMap(({ key }) => [
    [`${key}TabataEnabled`, Boolean(inputs[`${key}TabataEnabled`])],
    [`${key}EventEnabled`, Boolean(inputs[`${key}EventEnabled`])],
    [`${key}EventMovement`, inputs[`${key}EventMovement`] || ''],
    [`${key}EventSets`, inputs[`${key}EventSets`] ?? ''],
    [`${key}EventReps`, inputs[`${key}EventReps`] ?? ''],
  ])),
  ...(inputs.microCycles && { microCycles: inputs.microCycles.map(cycle => ({ ...cycle })) }),
});

const eventDescription = (inputs, key) => inputs[`${key}EventEnabled`]
  ? `${String(inputs[`${key}EventMovement`]).trim()} · ${inputs[`${key}EventSets`]} × ${inputs[`${key}EventReps`]}`
  : 'Off';

const describeChanges = (before, after) => {
  const changes = [];
  const add = (label, previous, next) => {
    if (String(previous) !== String(next)) changes.push({ label, previous, next });
  };
  lifts.forEach(({ key, label }) => add(`${label} day Tabata`, before[`${key}TabataEnabled`] ? 'On' : 'Off', after[`${key}TabataEnabled`] ? 'On' : 'Off'));
  lifts.forEach(({ max, label }) => add(`${label} starting max`, `${Number(before[max])} lb`, `${Number(after[max])} lb`));
  if (after.mesoMode) {
    add('Max progression', progressionLabels[before.maxProgressionMode], progressionLabels[after.maxProgressionMode]);
    lifts.forEach(({ key, label }) => {
      const description = inputs => inputs.liftProgressionModes[key]
        ? progressionLabels[inputs.liftProgressionModes[key]]
        : `Use shared setting (${progressionLabels[inputs.maxProgressionMode]})`;
      add(`${label} progression`, description(before), description(after));
      if (getLiftProgressionMode(after, key) === 'fixed') {
        add(`${label} increase per microcycle`, getLiftProgressionMode(before, key) === 'fixed' ? `${Number(before[`${key}Increment`])} lb` : 'Not used', `${Number(after[`${key}Increment`])} lb`);
      }
    });
  }
  lifts.forEach(({ key, label }) => add(`${label} day Strongman`, eventDescription(before, key), eventDescription(after, key)));
  if (after.mesoMode) {
    after.microCycles.forEach((cycle, index) => add(`Cycle ${index + 1} volume`, before.microCycles[index].volume, cycle.volume));
  } else {
    add('Training volume', before.mainLiftChoice, after.mainLiftChoice);
  }
  add('Low-volume back-off sets', before.includeBackoffSets ? 'On' : 'Off', after.includeBackoffSets ? 'On' : 'Off');
  Object.entries(accessoryChoices).forEach(([key, choices]) => {
    const description = value => choices.find(([option]) => option === value)?.[1] || value;
    add(key === 'pressWeakPoint' ? 'Press accessory' : 'Deadlift accessory', description(before[key]), description(after[key]));
  });
  return changes;
};

export const PlanUpdateEditor = ({ routine, onSave, onCancel }) => {
  const [original] = useState(() => initialDraft(routine.inputs));
  const [draft, setDraft] = useState(() => initialDraft(routine.inputs));
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const headingRef = useRef(null);
  const changes = describeChanges(original, draft);

  useEffect(() => {
    headingRef.current?.focus();
  }, [review]);

  const changeInput = event => {
    const { name, type, checked, value } = event.target;
    setDraft(current => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const changeCycleVolume = (index, volume) => {
    setDraft(current => ({
      ...current,
      microCycles: current.microCycles.map((cycle, cycleIndex) => cycleIndex === index ? { ...cycle, volume } : cycle),
    }));
    setError('');
  };

  const reviewChanges = event => {
    event.preventDefault();
    if (!changes.length) return;
    try {
      const updated = updateRoutinePlan(routine, draft);
      setReview(getPlanUpdateSummary(routine, updated));
      setError('');
    } catch (reviewError) {
      setError(reviewError.message || 'Could not review this update. Check the plan settings and try again.');
    }
  };

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(saveError.message || 'Could not save the update. Your changes are still here; please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const lowVolume = draft.mesoMode
    ? draft.microCycles.some(cycle => cycle.volume === 'Low')
    : draft.mainLiftChoice === 'Low';

  return (
    <section className="plan-update-editor" aria-labelledby="plan-update-heading" aria-busy={saving}>
      <header className="plan-update-header">
        <p className="eyebrow">{routine.name}</p>
        <h1 id="plan-update-heading" tabIndex={-1} ref={headingRef}>{review ? 'Review changes' : 'Update plan'}</h1>
        <p>Update future workouts in this plan. Completed workouts and sessions already started keep their recorded weights, exercises, and results.</p>
      </header>
      {review ? (
        <div className="panel plan-update-panel">
          <div className="plan-update-impact" role="status">
            <strong>{review.changedWorkouts} future {review.changedWorkouts === 1 ? 'workout' : 'workouts'} will change</strong>
            <p>{review.completedWorkouts} completed · {review.startedWorkouts} already started — preserved</p>
            {!review.changedWorkouts && <p>These settings will be saved, but no remaining workout prescriptions change.</p>}
          </div>
          <h2 className="plan-update-subheading">Your changes</h2>
          <dl className="plan-update-changes">
            {changes.map(change => (
              <div key={change.label}>
                <dt>{change.label}</dt>
                <dd><span><small>From</small>{change.previous}</span><span><small>To</small>{change.next}</span></dd>
              </div>
            ))}
          </dl>
          <p className="plan-update-note">{review.preservedOverrides > 0 ? `${review.preservedOverrides} individual exercise ${review.preservedOverrides === 1 ? 'customization stays' : 'customizations stay'} in place. ` : ''}Individual exercise edits are kept, including customized exercises whose plan option you turn off. Edit those exercises from the workout if needed.</p>
          <p className="plan-update-note">Your workout order and cycle schedule stay the same.</p>
          {error && <p className="plan-update-error" role="alert">{error}</p>}
          <div className="plan-update-actions">
            <button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save update'}</button>
            <button type="button" className="secondary-button" disabled={saving} onClick={() => { setReview(null); setError(''); }}>Back to editing</button>
            <button type="button" className="text-button" disabled={saving} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <form className="panel plan-update-panel" onSubmit={reviewChanges}>
          <fieldset className="plan-update-group plan-update-tabata">
            <legend>Tabata sprints</legend>
            <p className="field-help">Choose exactly which days finish with 8 rounds of 20 seconds sprint / 10 seconds rest.</p>
            <div className="plan-update-checks">
              {lifts.map(({ key, label }) => (
                <label className="check-label standalone-check" key={key}>
                  <input type="checkbox" name={`${key}TabataEnabled`} checked={draft[`${key}TabataEnabled`]} onChange={changeInput} />
                  <span>Add Tabata sprints to {label} day</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="plan-update-group">
            <legend>Weights and progression</legend>
            <p className="field-help">Use pounds. Starting maxes are the baseline for cycle 1. Each future workout uses its original cycle number and the plan's weekly percentages; changing volume changes those prescriptions. Past workouts stay unchanged.</p>
            <div className="field-grid three-fields">
              {lifts.map(({ max, label }) => <NumberInput key={max} name={max} label={`${label} max`} controlFunc={changeInput} content={draft[max]} min={1} max={1001} />)}
            </div>
            {draft.mesoMode ? (
              <React.Fragment>
                <LiftProgressionControls inputs={draft} sharedControl="select" onChange={changes => {
                  setDraft(current => ({ ...current, ...changes }));
                  setError('');
                }} />
                {lifts.some(({ key }) => getLiftProgressionMode(draft, key) === 'fixed') && <p className="field-help">Fixed increases use the cycle 1 starting max. Cycle 2 adds the amount once, cycle 3 adds it twice, even when you update the plan midway through.</p>}
              </React.Fragment>
            ) : <p className="field-help plan-update-note">This plan has one cycle. Its weekly weight progression follows the selected training volume.</p>}
          </fieldset>
          <fieldset className="plan-update-group">
            <legend>Strongman events by day</legend>
            <p className="field-help">Change the event, sets, or reps for each lifting day.</p>
            {lifts.map(({ key, label }) => (
              <div className="event-option" key={key}>
                <label className="check-label standalone-check">
                  <input type="checkbox" name={`${key}EventEnabled`} checked={draft[`${key}EventEnabled`]} onChange={changeInput} />
                  <span>Add a Strongman event to {label} day</span>
                </label>
                {draft[`${key}EventEnabled`] && <div className="event-fields">
                  <label className="form-field event-movement">
                    <span className="field-label">{label} event movement</span>
                    <input className="number-input" required type="text" name={`${key}EventMovement`} value={draft[`${key}EventMovement`]} onChange={changeInput} />
                  </label>
                  <NumberInput name={`${key}EventSets`} label={`${label} event sets`} controlFunc={changeInput} content={draft[`${key}EventSets`]} min={1} max={20} />
                  <NumberInput name={`${key}EventReps`} label={`${label} event reps`} controlFunc={changeInput} content={draft[`${key}EventReps`]} min={1} max={100} />
                </div>}
              </div>
            ))}
          </fieldset>
          <fieldset className="plan-update-group">
            <legend>Volume and accessories</legend>
            <div className="plan-update-volumes">
              {draft.mesoMode ? draft.microCycles.map((cycle, index) => (
                <label className="form-field" key={index}>
                  <span className="field-label">Cycle {index + 1} volume <small>({cycle.duration})</small></span>
                  <select className="select-input" name="volume" data-cycle-index={index} value={cycle.volume} onChange={event => changeCycleVolume(index, event.target.value)}>
                    <option>Low</option><option>High</option>
                  </select>
                </label>
              )) : (
                <label className="form-field">
                  <span className="field-label">Training volume</span>
                  <select className="select-input" name="mainLiftChoice" value={draft.mainLiftChoice} onChange={changeInput}><option>Low</option><option>High</option></select>
                </label>
              )}
            </div>
            <label className="check-label standalone-check plan-update-backoff">
              <input type="checkbox" name="includeBackoffSets" checked={draft.includeBackoffSets} onChange={changeInput} />
              <span>Include three descending back-off sets</span>
            </label>
            <p className="field-help">Back-off sets apply to low-volume cycles only.{!lowVolume && ' Your current cycles all use high volume.'}</p>
            <div className="plan-update-accessories">
              {Object.entries(accessoryChoices).map(([key, choices]) => (
                <label className="form-field" key={key}>
                  <span className="field-label">{key === 'pressWeakPoint' ? 'Press weak point' : 'Deadlift weak point'}</span>
                  <select className="select-input" name={key} value={draft[key]} onChange={changeInput}>
                    {choices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="plan-update-note">Individual exercise edits are kept. Your workout order, cycle lengths, and dedicated Strongman day stay the same. Create a new plan to change that schedule.</p>
          {error && <p className="plan-update-error" role="alert">{error}</p>}
          <div className="plan-update-actions">
            <button type="submit" className="primary-button" disabled={!changes.length}>Review changes</button>
            <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
};

export default PlanUpdateEditor;
