import React, { useState } from 'react';
import { RoutineForm } from './RoutineForm';

export const RoutineBuilderScreen = ({ profile, count, template, onCreate, onCancel }) => {
  const [name, setName] = useState(template?.name || `${profile.name}'s plan ${count + 1}`);
  const initialInputs = template ? {
    ...template.inputs,
    microCycles: template.inputs?.microCycles?.map(cycle => ({ ...cycle })),
    maxSquat: '', maxPress: '', maxDead: '',
    squatIncrement: '', pressIncrement: '', deadliftIncrement: '',
  } : undefined;
  return <div><div className="routine-name-wrap"><label className="form-field"><span className="field-label">Routine name</span><input className="number-input" value={name} onChange={event => setName(event.target.value)} required /></label></div><RoutineForm initialInputs={initialInputs} onCancel={onCancel} onCreate={inputs => onCreate(name.trim() || 'Strength plan', inputs)} /></div>;
};

