import React from 'react';
import { getLiftProgressionMode, hasAdaptiveProgression } from '../data/routineGeneration';
import NumberInput from './NumberInput';
import './LiftProgressionControls.css';

const lifts = [
  { key: 'squat', label: 'Squat' },
  { key: 'press', label: 'Press' },
  { key: 'deadlift', label: 'Deadlift' },
];

const modes = [
  ['same', 'Keep maxes the same'],
  ['fixed', 'Increase by set amounts'],
  ['adaptive', 'Adapt from completed sets'],
];

const LiftProgressionControls = ({ inputs, onChange, sharedControl = 'radios' }) => {
  const changeLiftMode = (liftKey, mode) => {
    const liftProgressionModes = { ...inputs.liftProgressionModes };
    if (mode) liftProgressionModes[liftKey] = mode;
    else delete liftProgressionModes[liftKey];
    onChange({ liftProgressionModes });
  };

  return (
    <fieldset className="option-group progression-mode lift-progression-controls">
      <legend className="option-title">Max progression</legend>
      <p className="field-help">Choose a shared setting for all lifts, then change individual lifts if needed.</p>
      {sharedControl === 'select' ? (
        <label className="form-field">
          <span className="field-label">Max progression</span>
          <select className="select-input" name="maxProgressionMode" value={inputs.maxProgressionMode || 'fixed'} onChange={event => onChange({ maxProgressionMode: event.target.value })}>
            {modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      ) : <div className="option-list progression-options">
        {modes.map(([value, label]) => (
          <label className="option-label" key={value}>
            <input className="option-input" required type="radio" name="maxProgressionMode" value={value} checked={(inputs.maxProgressionMode || 'fixed') === value} onChange={() => onChange({ maxProgressionMode: value })} />
            <span className="option-text">{label}</span>
          </label>
        ))}
      </div>}
      <div className="field-grid three-fields lift-progression-fields">
        {lifts.map(({ key, label }) => (
          <div className="lift-progression-field" key={key}>
            <label className="form-field">
              <span className="field-label">{label} progression</span>
              <select className="select-input" name={`${key}ProgressionMode`} value={inputs.liftProgressionModes?.[key] || ''} onChange={event => changeLiftMode(key, event.target.value)}>
                <option value="">Shared setting</option>
                <option value="same">Keep max the same</option>
                <option value="fixed">Fixed increase</option>
                <option value="adaptive">Adapt from sets</option>
              </select>
            </label>
            {getLiftProgressionMode(inputs, key) === 'fixed' && (
              <NumberInput name={`${key}Increment`} label={`${label} increase (lb per microcycle)`} controlFunc={event => onChange({ [`${key}Increment`]: event.target.value })} content={inputs[`${key}Increment`] ?? ''} min={0} max={100} />
            )}
          </div>
        ))}
      </div>
      {hasAdaptiveProgression(inputs) && <p className="field-help">Later cycles begin as projections for adaptive lifts. Completed main-lift sets can raise their future maxes and prescriptions automatically. Without a higher estimated max, the max stays the same. Adaptive progression never lowers a max.</p>}
    </fieldset>
  );
};

export default LiftProgressionControls;
