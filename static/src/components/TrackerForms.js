import React, { useState } from 'react';

export const ProfileForm = ({ onSave, title = 'Who is training?' }) => {
  const [name, setName] = useState('');
  return (
    <form className="empty-card profile-form" onSubmit={event => {
      event.preventDefault();
      onSave(name.trim());
      setName('');
    }}>
      <p className="eyebrow">Local profile</p>
      <h1>{title}</h1>
      <p>Profiles keep routines separate on this phone. Nothing is uploaded.</p>
      <label className="form-field">
        <span className="field-label">Name</span>
        <input className="number-input" value={name} onChange={event => setName(event.target.value)} required autoFocus />
      </label>
      <button className="primary-button" type="submit">Create profile</button>
    </form>
  );
};

export const ConfirmationModal = ({ title, children, confirmLabel, requiredText, onCancel, onConfirm }) => {
  const [confirmation, setConfirmation] = useState('');
  const confirmed = !requiredText || confirmation.trim().toLowerCase() === requiredText.toLowerCase();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
        <h2 id="confirmation-title">{title}</h2>
        <p>{children}</p>
        {requiredText && <label className="form-field confirmation-field"><span className="field-label">Type {requiredText} to confirm</span><input className="number-input" aria-label={`Type ${requiredText} to confirm`} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoFocus /></label>}
        <div className="button-row modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="danger-button" type="button" disabled={!confirmed} onClick={onConfirm} autoFocus={!requiredText}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
};
