import React from 'react';

export const RpePicker = ({ value, onChange, disabled = false }) => (
  <fieldset className="rpe-picker" disabled={disabled}>
    <legend>Main-lift RPE</legend>
    <div>{Array.from({ length: 10 }, (_, index) => index + 1).map(rpe => (
      <button className={value === rpe ? 'selected' : ''} type="button" aria-pressed={value === rpe} onClick={() => onChange(rpe)} key={rpe}>{rpe}</button>
    ))}</div>
  </fieldset>
);
