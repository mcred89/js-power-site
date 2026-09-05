import React, { useState } from 'react';

const SubstituteDialog = ({ exercise, onCancel, onConfirm }) => {
  const pending = exercise.sets.filter(set => set.status === 'pending');
  const first = pending[0] || {};
  const [movement, setMovement] = useState(exercise.movement);
  const [weight, setWeight] = useState(first.actualWeight ?? exercise.plannedWeight ?? '');
  const [setCount, setSetCount] = useState(String(Math.max(1, pending.length)));
  const [reps, setReps] = useState(String(first.actualReps ?? first.plannedReps ?? ''));
  return (
    <div className="modal-backdrop">
      <form className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="substitute-title" onSubmit={event => {
        event.preventDefault();
        onConfirm({ movement: movement.trim(), weight, setCount, reps });
      }}>
        <p className="eyebrow">This workout only</p>
        <h2 id="substitute-title">Substitute {exercise.movement}</h2>
        <label className="form-field"><span className="field-label">Movement</span><input className="number-input" value={movement} onChange={event => setMovement(event.target.value)} required autoFocus /></label>
        <div className="substitute-fields">
          <label className="form-field"><span className="field-label">Weight (lb)</span><input className="number-input" inputMode="decimal" value={weight} onChange={event => setWeight(event.target.value)} /></label>
          <label className="form-field"><span className="field-label">Remaining sets</span><input className="number-input" type="number" min="1" max="20" value={setCount} onChange={event => setSetCount(event.target.value)} required /></label>
          <label className="form-field"><span className="field-label">Reps</span><input className="number-input" inputMode="numeric" value={reps} onChange={event => setReps(event.target.value)} required /></label>
        </div>
        <p className="field-help">Completed and skipped sets stay unchanged. Future workouts are not edited.</p>
        <div className="button-row modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Use substitute</button></div>
      </form>
    </div>
  );
};

export default SubstituteDialog;
