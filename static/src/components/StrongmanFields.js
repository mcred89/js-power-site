import React from 'react';

export const strongmanId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const numberValue = value => value === '' || value === null || value === undefined ? null : Number(value);
export const eventFamilies = [
  ['clean-press', 'Clean and press'], ['load', 'Load'], ['carry', 'Carry'],
  ['pull', 'Pull or drag'], ['static', 'Static lift'], ['throw', 'Throw'], ['medley', 'Medley'], ['custom', 'Custom event'],
];

export const Field = ({ label, ariaLabel, value, onChange, type = 'text', min, max, required, disabled, children }) => <label className="form-field">
  <span className="field-label">{label}</span>
  {children ? <select className="number-input" aria-label={ariaLabel || label} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)}>{children}</select>
    : <input className="number-input" aria-label={ariaLabel || label} value={value ?? ''} type={type} min={min} max={max} disabled={disabled} step={type === 'number' ? 'any' : undefined} required={required} onChange={event => onChange(type === 'number' ? numberValue(event.target.value) : event.target.value)} />}
</label>;

export const Measurements = ({ prefix, value = {}, onChange, sets = false }) => <div className="strongman-measurements">
  {sets && <Field label="Sets / runs" ariaLabel={`${prefix} sets`} type="number" min="1" max="100" value={value.sets} onChange={setsValue => onChange({ ...value, sets: setsValue })} />}
  {[['weight', 'Load'], ['reps', 'Repetitions'], ['distance', 'Distance'], ['seconds', 'Event seconds']].map(([key, label]) => <Field key={key} label={label} ariaLabel={`${prefix} ${key}`} type="number" min="0" value={value[key]} onChange={input => onChange({ ...value, [key]: input })} />)}
  <Field label="Load units" ariaLabel={`${prefix} weight units`} value={value.weightUnit || 'lb'} onChange={weightUnit => onChange({ ...value, weightUnit })}><option value="lb">lb</option><option value="kg">kg</option></Field>
  <Field label="Distance units" ariaLabel={`${prefix} distance units`} value={value.distanceUnit || 'ft'} onChange={distanceUnit => onChange({ ...value, distanceUnit })}><option value="ft">ft</option><option value="m">m</option></Field>
  <Field label="Load meaning" ariaLabel={`${prefix} load meaning`} value={value.loadMeaning || 'total'} onChange={loadMeaning => onChange({ ...value, loadMeaning })}><option value="total">Total load</option><option value="per-hand">Per hand</option></Field>
</div>;

export const recipeDescription = recipe => {
  if (!recipe) return 'Set up today';
  if (recipe.parts?.length) return recipe.parts.map(part => `${part.name}: ${recipeDescription(part)}`).join(' / ');
  return [
    recipe.sets ? `${recipe.sets} sets / runs` : '',
    recipe.weight != null ? `${recipe.weight} ${recipe.weightUnit || 'lb'}${recipe.loadMeaning === 'per-hand' ? ' per hand' : ''}` : '',
    recipe.reps != null ? `${recipe.reps} reps` : '',
    recipe.distance != null ? `${recipe.distance} ${recipe.distanceUnit || 'ft'}` : '',
    recipe.seconds != null ? `${recipe.seconds} seconds` : '',
  ].filter(Boolean).join(' · ') || 'Set up today';
};

export const CapabilityChoices = ({ label, capabilities = [], selected = [], onChange }) => <fieldset className="strongman-inset" style={{ border: 0, paddingLeft: 0 }}><legend className="field-label">{label}</legend>{capabilities.length ? capabilities.map(capability => <label className="strongman-row" key={capability.id}><input type="checkbox" checked={selected.includes(capability.id)} onChange={change => onChange(change.target.checked ? [...selected, capability.id] : selected.filter(id => id !== capability.id))} />{capability.name || 'Unnamed capability'}</label>) : <p className="strongman-help">Add capabilities below to connect this practice.</p>}</fieldset>;

export const PrescriptionParts = ({ prefix, value = {}, capabilities, onChange }) => {
  const parts = value.parts || [];
  const changePart = (index, patch) => onChange({ ...value, parts: parts.map((part, other) => other === index ? { ...part, ...patch } : part) });
  return <details className="strongman-inset"><summary>Paired work or ordered medley legs</summary><p className="strongman-help">Divide work explicitly between components. Give each part its own sets or runs; the app will not duplicate a full prescription.</p>
    {parts.map((part, index) => <div className="strongman-inset" key={part.id}><Field label={`Part ${index + 1} name`} ariaLabel={`${prefix} part ${index + 1} name`} value={part.name} onChange={name => changePart(index, { name })} /><Measurements prefix={`${prefix} part ${index + 1}`} sets value={part} onChange={patch => changePart(index, patch)} /><Field label="Part conditions" ariaLabel={`${prefix} part ${index + 1} setup`} value={part.setup} onChange={setup => changePart(index, { setup })} /><CapabilityChoices label="Capabilities this part practices" capabilities={capabilities} selected={part.capabilityIds} onChange={capabilityIds => changePart(index, { capabilityIds })} /><button className="text-button" type="button" onClick={() => onChange({ ...value, parts: parts.filter((item, other) => other !== index) })}>Remove part</button></div>)}
    <button className="text-button" type="button" onClick={() => onChange({ ...value, parts: [...parts, { id: strongmanId('part'), name: '', sets: null }] })}>Add prescription part</button>
  </details>;
};

export const PrescriptionFields = ({ prefix, measurementsPrefix = `${prefix} prescription`, value, capabilities, setupFallback = '', onChange }) => {
  const recipe = value || {};
  return <>
    <Measurements prefix={measurementsPrefix} sets value={recipe} onChange={onChange} />
    <Field label="Prescription conditions" ariaLabel={`${measurementsPrefix} setup`} value={recipe.setup ?? setupFallback} onChange={setup => onChange({ ...recipe, setup })} />
    <Field label="Prescription notes" ariaLabel={`${prefix} notes`} value={recipe.notes} onChange={notes => onChange({ ...recipe, notes })} />
    <PrescriptionParts prefix={prefix} value={recipe} capabilities={capabilities} onChange={onChange} />
  </>;
};
