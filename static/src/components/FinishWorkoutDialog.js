import React, { useRef, useState } from 'react';
import { RpePicker } from './RpePicker';

export const FinishWorkoutDialog = ({ pendingSets, missingRpe, onCancel, onConfirm }) => {
  const [rpe, setRpe] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const finish = async value => {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await onConfirm(value);
    } catch (failure) {
      setError(failure.message || 'Could not finish the workout. Please try again.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !submitting.current) onCancel();
  }}>
    <section className="confirmation-modal finish-workout-modal" role="dialog" aria-modal="true" aria-labelledby="finish-workout-title">
      <h2 id="finish-workout-title">Finish this workout?</h2>
      {pendingSets > 0 && <p>{pendingSets} planned set{pendingSets === 1 ? '' : 's'} will be recorded as skipped.</p>}
      {missingRpe && <>
        <p>The main-lift RPE is still blank. Select it below, or finish without RPE.</p>
        <RpePicker value={rpe} onChange={setRpe} disabled={saving} />
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="button-row modal-actions">
        <button className="secondary-button" type="button" disabled={saving} onClick={onCancel} autoFocus>Cancel</button>
        {missingRpe && <button className="secondary-button" type="button" disabled={saving} onClick={() => finish(null)}>Finish without RPE</button>}
        <button className="primary-button" type="button" disabled={saving || (missingRpe && rpe === null)} onClick={() => finish(missingRpe ? rpe : undefined)}>{saving ? 'Finishing…' : 'Finish workout'}</button>
      </div>
    </section>
  </div>;
};
