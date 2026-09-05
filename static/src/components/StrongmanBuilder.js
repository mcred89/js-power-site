import React, { useState } from 'react';
import { defaultStrongmanInputs, defaultPhases, validateStrongmanInputs, EVENT_FAMILY_TEMPLATES } from '../data/strongman';
import { Field, Measurements, CapabilityChoices, PrescriptionFields, eventFamilies, strongmanId } from './StrongmanFields';
import { recipeForPractice } from '../data/strongmanPrescription';
import './Strongman.css';

const newPractice = (name = '', family = 'clean-press') => ({ id: strongmanId('practice'), name, family, focus: '', setup: '', available: true, capacity: 1, rotation: 'both', recipe: null });
const newEvent = () => ({ id: strongmanId('event'), name: '', family: 'clean-press', priority: 'main', frequency: 3, maxGap: 2, focus: '', target: {}, practices: [newPractice()], capabilities: [], coverage: [] });
const phaseNames = { base: 'Base building', development: 'Development', specific: 'Specific practice', taper: 'Taper', recovery: 'Recovery' };

const StrongmanBuilder = ({ profile, initialRoutine, onSave, onCancel, submitLabel = 'Save strongman block' }) => {
  const [name, setName] = useState(initialRoutine?.name || `${profile?.name || 'My'} strongman block`);
  const [inputs, setInputs] = useState(() => JSON.parse(JSON.stringify(initialRoutine?.inputs || defaultStrongmanInputs())));
  const [errors, setErrors] = useState([]);
  const update = patch => setInputs(value => ({ ...value, ...patch }));
  const updateEvent = (index, patch) => setInputs(value => ({ ...value, events: value.events.map((event, eventIndex) => eventIndex === index ? { ...event, ...patch } : event) }));
  const updatePractice = (index, practiceIndex, patch) => updateEvent(index, { practices: inputs.events[index].practices.map((practice, other) => other === practiceIndex ? { ...practice, ...patch } : practice) });
  const updateCapability = (index, capabilityIndex, patch) => updateEvent(index, { capabilities: inputs.events[index].capabilities.map((capability, other) => other === capabilityIndex ? { ...capability, ...patch } : capability) });
  const removeCapability = (index, capability) => {
    const event = inputs.events[index];
    const references = value => (value?.capabilityIds || []).includes(capability.id) || (value?.prerequisites || []).includes(capability.id);
    const referenced = event.practices.some(practice => references(practice) || [practice.recipe, practice.taperRecipe].some(recipe => references(recipe) || recipe?.parts?.some(references)))
      || event.capabilities.some(item => item.id !== capability.id && references(item)) || event.coverage?.some(references);
    if (referenced) { setErrors([`${capability.name || 'This capability'} is still in use. Remove its practice, checkpoint, or coverage references first.`]); return; }
    setErrors([]);
    updateEvent(index, { capabilities: event.capabilities.filter(item => item.id !== capability.id) });
  };
  const submit = event => {
    event.preventDefault();
    const normalized = { ...inputs, events: inputs.events.map(item => ({ ...item, practices: item.practices.map(practice => ({ ...practice, name: practice.name.trim() || item.name, family: practice.family || item.family })) })) };
    const messages = validateStrongmanInputs(normalized);
    setErrors(messages);
    if (!messages.length) onSave(name.trim() || 'Strongman block', normalized);
  };
  return <form className="strongman-builder" onSubmit={submit}>
    <div><p className="eyebrow">Independent event preparation</p><h1>{initialRoutine ? 'Edit strongman block' : 'Plan strongman training'}</h1><p className="strongman-help">Your normal lifting days keep their strongman exercises. This block supplies dedicated event days and continues across strength routines.</p></div>
    <section className="strongman-card">
      <h2>Timeline</h2>
      <Field label="Block name" value={name} onChange={setName} required />
      <div className="strongman-grid">
        <Field label="Training purpose" value={inputs.mode} onChange={mode => { const weeks = mode === 'general' ? 4 : inputs.weeks; update({ mode, weeks, phases: defaultPhases(weeks, mode) }); }}><option value="general">General training</option><option value="competition">Competition preparation</option></Field>
        <Field label="Block length in weeks" type="number" min="1" max="52" value={inputs.weeks} onChange={weeks => update({ weeks, phases: defaultPhases(weeks || 1, inputs.mode) })} />
        {inputs.mode === 'competition' && <Field label="Competition date" type="date" value={inputs.competitionDate} onChange={competitionDate => update({ competitionDate })} />}
      </div>
      <p className="strongman-help">One event workout advances one training week. Missing a session does not move the competition date or compress your training.</p>
      <details><summary>Edit phases</summary>
        {(inputs.phases || []).map((phase, index) => <div className="strongman-phase" key={phase.id}>
          <Field label={`Phase ${index + 1}`} value={phase.type} onChange={type => update({ phases: inputs.phases.map((item, other) => other === index ? { ...item, type } : item) })}>{Object.entries(phaseNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Field>
          <Field label={`Phase ${index + 1} weeks`} type="number" min="1" value={phase.weeks} onChange={weeks => update({ phases: inputs.phases.map((item, other) => other === index ? { ...item, weeks } : item) })} />
          <button className="text-button" type="button" onClick={() => update({ phases: inputs.phases.filter((item, other) => other !== index) })}>Remove phase</button>
        </div>)}
        <button className="text-button" type="button" onClick={() => update({ phases: [...inputs.phases, { id: strongmanId('phase'), type: 'recovery', weeks: 1 }] })}>Add phase</button>
        <p className="strongman-help">Phase weeks must add up to the block length. Resetting the block length or purpose restores phase defaults.</p>
      </details>
    </section>
    <section className="strongman-card"><h2>Events and priorities</h2><p>Unknown events receive early baseline practice. Plan up to four event blocks per day, with coverage across the next four event days.</p>
      {(inputs.events || []).map((event, index) => {
        const prefix = `Event ${index + 1}`;
        return <article className="strongman-inset" key={event.id}>
          <div className="strongman-row spread"><h3>{event.name || prefix}</h3><button className="text-button" type="button" onClick={() => update({ events: inputs.events.filter((item, other) => other !== index) })}>Remove event</button></div>
          <div className="strongman-grid">
            <Field label="Event name" ariaLabel={`${prefix} name`} value={event.name} onChange={nameValue => updateEvent(index, { name: nameValue })} required />
            <Field label="Movement family" ariaLabel={`${prefix} family`} value={event.family} onChange={family => updateEvent(index, { family, practices: event.practices.map(practice => ({ ...practice, family })) })}>{eventFamilies.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Field>
            <Field label="Priority" ariaLabel={`${prefix} priority`} value={event.priority} onChange={priority => updateEvent(index, { priority, frequency: { main: 3, maintenance: 2, occasional: 1 }[priority] })}><option value="main">Main focus</option><option value="maintenance">Maintenance</option><option value="occasional">Occasional</option></Field>
            <Field label="Practices per four event days" ariaLabel={`${prefix} frequency`} type="number" min="1" max="4" value={event.frequency} onChange={frequency => updateEvent(index, { frequency })} />
            <Field label="Maximum gap in event weeks" ariaLabel={`${prefix} maximum gap`} type="number" min="1" max="52" value={event.maxGap} onChange={maxGap => updateEvent(index, { maxGap })} />
            <Field label="What needs work?" ariaLabel={`${prefix} focus`} value={event.focus} onChange={focus => updateEvent(index, { focus })} />
          </div>
          <details className="strongman-inset"><summary>Show target and rules</summary>
            <Measurements prefix={`${prefix} target`} value={event.target} onChange={target => updateEvent(index, { target })} />
            <Field label="Setup, height, rules, and transitions" ariaLabel={`${prefix} target setup`} value={event.target?.setup} onChange={setup => updateEvent(index, { target: { ...event.target, setup } })} />
          </details>
          <details className="strongman-inset"><summary>Equipment and A/B variations</summary>
            {event.practices.map((practice, practiceIndex) => <div key={practice.id} className="strongman-inset">
              <div className="strongman-grid">
                <Field label="Practice / implement" ariaLabel={`${prefix} practice ${practiceIndex + 1} name`} value={practice.name} onChange={practiceName => updatePractice(index, practiceIndex, { name: practiceName })} />
                <Field label="Base rotation" ariaLabel={`${prefix} practice ${practiceIndex + 1} rotation`} value={practice.rotation || 'both'} onChange={rotation => updatePractice(index, practiceIndex, { rotation })}><option value="both">A and B</option><option value="A">A days</option><option value="B">B days</option></Field>
                <Field label="Focus / component" ariaLabel={`${prefix} practice ${practiceIndex + 1} focus`} value={practice.focus} onChange={focus => updatePractice(index, practiceIndex, { focus })} />
                <Field label="Setup and available loads" ariaLabel={`${prefix} practice ${practiceIndex + 1} setup`} value={practice.setup} onChange={setup => updatePractice(index, practiceIndex, { setup })} />
                <Field label="Session blocks occupied" ariaLabel={`${prefix} practice ${practiceIndex + 1} capacity`} type="number" min="1" max="4" value={practice.capacity || 1} onChange={capacity => updatePractice(index, practiceIndex, { capacity })} />
              </div>
              <label className="strongman-row strongman-inset"><input type="checkbox" checked={practice.available !== false} onChange={change => updatePractice(index, practiceIndex, { available: change.target.checked })} />Equipment available</label>
              <label className="strongman-row strongman-inset"><input type="checkbox" checked={practice.wholeEvent === true} onChange={change => updatePractice(index, practiceIndex, { wholeEvent: change.target.checked })} />Whole-event rehearsal</label>
              <details className="strongman-inset"><summary>Phases and capability requirements</summary>
                <p className="strongman-help">Leave phases unselected to allow this variation throughout the block. Prerequisites gate this practice only.</p>
                {Object.entries(phaseNames).map(([type, label]) => <label className="strongman-row" key={type}><input type="checkbox" checked={(practice.phases || []).includes(type)} onChange={change => updatePractice(index, practiceIndex, { phases: change.target.checked ? [...(practice.phases || []), type] : (practice.phases || []).filter(value => value !== type) })} />{label}</label>)}
                <CapabilityChoices label="Capabilities this practice develops" capabilities={event.capabilities} selected={practice.capabilityIds} onChange={capabilityIds => updatePractice(index, practiceIndex, { capabilityIds })} />
                <CapabilityChoices label="Confirm these before this practice" capabilities={event.capabilities} selected={practice.prerequisites} onChange={prerequisites => updatePractice(index, practiceIndex, { prerequisites })} />
              </details>
              <details className="strongman-inset"><summary>{practice.recipe ? 'Edit accepted prescription' : 'Optional: prescribe known practice'}</summary><p className="strongman-help">Leave this unset for an early assessment. Enter only work you want to accept as your starting prescription.</p><PrescriptionFields prefix={`${prefix} practice ${practiceIndex + 1}`} value={recipeForPractice(practice, 'normal')} capabilities={event.capabilities} setupFallback={practice.setup} onChange={recipe => updatePractice(index, practiceIndex, { recipe })} />{practice.recipe && <button className="text-button" type="button" onClick={() => updatePractice(index, practiceIndex, { recipe: null })}>Clear prescription for assessment</button>}</details>
              <details className="strongman-inset"><summary>Accepted taper / recovery work</summary><p className="strongman-help">Set lighter work explicitly. An unset taper prescription prompts setup rather than reusing heavier development work.</p><PrescriptionFields prefix={`${prefix} practice ${practiceIndex + 1} taper`} measurementsPrefix={`${prefix} practice ${practiceIndex + 1} taper`} value={recipeForPractice(practice, 'taper')} capabilities={event.capabilities} setupFallback={practice.setup} onChange={taperRecipe => updatePractice(index, practiceIndex, { taperRecipe })} />{practice.taperRecipe && <button className="text-button" type="button" onClick={() => updatePractice(index, practiceIndex, { taperRecipe: null })}>Clear taper prescription</button>}</details>
              <button className="text-button" type="button" disabled={event.practices.length === 1} onClick={() => updateEvent(index, { practices: event.practices.filter((item, other) => other !== practiceIndex) })}>Remove variation</button>
            </div>)}
            <button className="text-button" type="button" onClick={() => updateEvent(index, { practices: [...event.practices, newPractice('', event.family)] })}>Add variation</button>
          </details>
          <details className="strongman-inset"><summary>Capabilities and checkpoints</summary><p className="strongman-help">Assess the parts that matter: a pick does not establish a carry, and a clean does not establish a press.</p>
            {(event.capabilities || []).map((capability, capabilityIndex) => <div className="strongman-inset" key={capability.id}>
              <div className="strongman-grid"><Field label="Capability" ariaLabel={`${prefix} capability ${capabilityIndex + 1} name`} value={capability.name} onChange={capabilityName => updateCapability(index, capabilityIndex, { name: capabilityName })} /><Field label="Current status" ariaLabel={`${prefix} capability ${capabilityIndex + 1} status`} value={capability.status} onChange={status => updateCapability(index, capabilityIndex, { status })}><option value="unknown">Unknown — assess early</option><option value="working">Working on</option><option value="confirmed">Confirmed by me</option></Field></div>
              <Measurements prefix={`${prefix} capability ${capabilityIndex + 1}`} value={capability.criterion || {}} onChange={criterion => updateCapability(index, capabilityIndex, { criterion })} />
              <Field label="Required conditions" ariaLabel={`${prefix} capability ${capabilityIndex + 1} setup`} value={capability.criterion?.setup} onChange={setup => updateCapability(index, capabilityIndex, { criterion: { ...capability.criterion, setup } })} />
              {capability.criterion?.seconds != null && <Field label="Meaning of time" ariaLabel={`${prefix} capability ${capabilityIndex + 1} time mode`} value={capability.criterion?.timeMode || 'limit'} onChange={timeMode => updateCapability(index, capabilityIndex, { criterion: { ...capability.criterion, timeMode } })}><option value="limit">Finish within this time</option><option value="hold">Sustain for at least this time</option></Field>}
              <CapabilityChoices label="Prerequisite capabilities" capabilities={event.capabilities.filter(item => item.id !== capability.id)} selected={capability.prerequisites} onChange={prerequisites => updateCapability(index, capabilityIndex, { prerequisites })} />
              <button className="text-button" type="button" onClick={() => removeCapability(index, capability)}>Remove capability</button>
            </div>)}
            <button className="text-button" type="button" onClick={() => updateEvent(index, { capabilities: [...(event.capabilities || []), { id: strongmanId('capability'), name: '', status: 'unknown', criterion: {} }] })}>Add capability</button>
            {!(event.capabilities || []).length && (EVENT_FAMILY_TEMPLATES[event.family] || []).length > 0 && <button className="text-button" type="button" onClick={() => updateEvent(index, { capabilities: EVENT_FAMILY_TEMPLATES[event.family].map(capabilityName => ({ id: strongmanId('capability'), name: capabilityName, status: 'unknown', criterion: {} })) })}>Use movement checkpoints</button>}
          </details>
        </article>;
      })}
      <button className="secondary-button" type="button" onClick={() => update({ events: [...(inputs.events || []), newEvent()] })}>Add event</button>
    </section>
    {errors.length > 0 && <div className="strongman-error" role="alert"><strong>Check your block</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
    <div><button className="primary-button" type="submit">{submitLabel}</button><button className="text-button" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
};

export default StrongmanBuilder;
