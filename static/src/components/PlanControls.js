import React, { useState } from 'react';

export const MaxCorrection = ({ routine, onCorrect }) => {
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

const setupValue = value => value === true ? 'Yes' : value === false ? 'No' : value || 'Not set';
const progressionLabel = mode => ({
  same: 'Keep maxes the same',
  fixed: 'Fixed increases',
  adaptive: 'Adaptive from completed sets',
}[mode || 'fixed']);

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
            <p><strong>Max progression:</strong> {progressionLabel(inputs.maxProgressionMode)}</p>
            {(inputs.maxProgressionMode || 'fixed') === 'fixed' && <dl className="setup-grid">
              <div><dt>Squat increase</dt><dd>{setupValue(inputs.squatIncrement)} lb</dd></div>
              <div><dt>Press increase</dt><dd>{setupValue(inputs.pressIncrement)} lb</dd></div>
              <div><dt>Deadlift increase</dt><dd>{setupValue(inputs.deadliftIncrement)} lb</dd></div>
            </dl>}
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
      <div className="setup-section">
        <h3>Tabata sprints</h3>
        <p>Always last, after accessories and Strongman work.</p>
        <dl className="setup-events">
          {eventLifts.map(([key, label]) => (
            <div key={key}><dt>{label}</dt><dd>{inputs[`${key}TabataEnabled`] ? '8 rounds · 20 seconds sprint / 10 seconds rest' : 'None'}</dd></div>
          ))}
        </dl>
      </div>
    </details>
  );
};
