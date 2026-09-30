import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  normalizeMovementName,
  normalizeStrongmanCompetition,
  strongmanResults,
  summarizeStrongmanResults,
} from '../data/strongman';
import './Strongman.css';
import { useUnsavedChanges } from './useUnsavedChanges';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const present = value => value !== '' && value !== null && value !== undefined;
const numberLabel = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const formatStrongmanTarget = target => {
  const values = [
    present(target?.weight) && `${numberLabel(target.weight)} lb`,
    present(target?.distance) && `${numberLabel(target.distance)} ft`,
    present(target?.reps) && `${numberLabel(target.reps)} rep${Number(target.reps) === 1 ? '' : 's'}`,
    present(target?.seconds) && `${numberLabel(target.seconds)} sec`,
  ].filter(Boolean);
  return values.length ? values.join(' · ') : 'To be announced';
};

export const formatStrongmanResult = result => {
  if (!result) return 'No results yet';
  const value = formatStrongmanTarget(result.set || result);
  return value === 'To be announced' ? 'Attempt recorded' : value;
};

export const formatStrongmanDate = value => {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const strongmanKnownMovements = routines => {
  const names = new Map();
  const add = name => {
    if (typeof name === 'string' && name.trim()) names.set(normalizeMovementName(name), name.trim());
  };
  routines.forEach(routine => {
    (routine.strongmanLog || []).forEach(entry => { if (entry.scope !== 'medley') add(entry.movement); });
    (routine.inputs?.strongmanCompetition?.events || []).forEach(event => {
      if (event.type !== 'medley') add(event.name);
      (event.components || []).forEach(component => add(component.name));
    });
  });
  return [...names.values()].sort((a, b) => a.localeCompare(b));
};

const relativeDate = (value, now = new Date()) => {
  const performed = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Math.max(0, Math.round((today - performed) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
};

const TargetFields = ({ value, onChange, prefix }) => (
  <><div className="strongman-target-fields">
    {[['weight', 'Weight (lb)'], ['distance', 'Distance (ft)'], ['reps', 'Reps'], ['seconds', 'Time (sec)']].map(([key, label]) => (
      <label className="form-field" key={key}>
        <span className="field-label">{label}</span>
        <input className="number-input" type="number" inputMode={key === 'reps' ? 'numeric' : 'decimal'} min="0" step={key === 'reps' ? '1' : 'any'} aria-label={`${prefix} ${label}`} value={value[key] ?? ''} placeholder="TBA" onChange={event => onChange({ ...value, [key]: event.target.value })} />
      </label>
    ))}
  </div>
  <label className="form-field strongman-time-goal"><span className="field-label">When timing this movement</span><select className="number-input" aria-label={`${prefix} time goal`} value={value.timeGoal || 'fastest'} onChange={event => onChange({ ...value, timeGoal: event.target.value })}><option value="fastest">Faster is better</option><option value="longest">Longer is better (hold)</option></select></label></>
);

export const StrongmanCompetitionEditor = ({ value, onChange, knownMovements = [] }) => {
  const competition = value || { name: '', date: '', events: [] };
  const movementsId = useId();
  const updateEvent = (id, updated) => onChange({ ...competition, events: (competition.events || []).map(event => event.id === id ? updated : event) });
  const addEvent = () => onChange({ ...competition, events: [...(competition.events || []), { id: makeId(), name: '', type: 'single', weight: '', distance: '', reps: '', seconds: '', components: [] }] });

  return (
    <div className="strongman-competition-editor">
      <p className="strongman-help">Your competition is a reference for training. Add what you know now; leave unannounced details blank.</p>
      <div className="strongman-editor-heading-fields">
        <label className="form-field"><span className="field-label">Competition name <span className="optional-label">Optional</span></span><input className="number-input" aria-label="Competition name" value={competition.name || ''} onChange={event => onChange({ ...competition, name: event.target.value })} placeholder="Next competition" /></label>
        <label className="form-field"><span className="field-label">Competition date <span className="optional-label">Optional</span></span><input className="number-input" type="date" aria-label="Competition date" value={competition.date || ''} onChange={event => onChange({ ...competition, date: event.target.value })} /></label>
      </div>
      <datalist id={movementsId}>{knownMovements.map(name => <option value={name} key={normalizeMovementName(name)} />)}</datalist>
      <div className="strongman-editor-events">
        {(competition.events || []).map((event, index) => (
          <fieldset className="strongman-editor-event" key={event.id}>
            <legend>Event {index + 1}</legend>
            <div className="strongman-event-name-fields">
              <label className="form-field"><span className="field-label">Movement or event</span><input className="number-input" aria-label={`Event ${index + 1} name`} list={movementsId} value={event.name || ''} onChange={input => updateEvent(event.id, { ...event, name: input.target.value })} placeholder="e.g. Zercher yoke carry" required /></label>
              <label className="form-field"><span className="field-label">Event type</span><select className="number-input" aria-label={`Event ${index + 1} type`} value={event.type || 'single'} onChange={input => updateEvent(event.id, { ...event, type: input.target.value, ...(input.target.value === 'medley' ? { weight: '', distance: '', reps: '', timeGoal: 'fastest' } : {}) })}><option value="single">Single movement</option><option value="medley">Medley</option></select></label>
            </div>
            {event.type === 'medley' ? (
              <div className="strongman-editor-components">
                <p className="strongman-help">Track each implement separately, then log full runs when you train the whole event.</p>
                {(event.components || []).map((component, componentIndex) => (
                  <fieldset className="strongman-editor-component" key={component.id}>
                    <legend>Implement {componentIndex + 1}</legend>
                    <label className="form-field"><span className="field-label">Movement <span className="optional-label">Can be added later</span></span><input className="number-input" aria-label={`Event ${index + 1} implement ${componentIndex + 1} name`} list={movementsId} value={component.name || ''} placeholder="To be announced" onChange={input => updateEvent(event.id, { ...event, components: event.components.map(item => item.id === component.id ? { ...item, name: input.target.value } : item) })} /></label>
                    <TargetFields value={component} prefix={`Event ${index + 1} implement ${componentIndex + 1}`} onChange={updated => updateEvent(event.id, { ...event, components: event.components.map(item => item.id === component.id ? updated : item) })} />
                    <button className="text-button strongman-remove" type="button" aria-label={`Remove implement ${componentIndex + 1} from event ${index + 1}`} onClick={() => updateEvent(event.id, { ...event, components: event.components.filter(item => item.id !== component.id) })}>Remove implement</button>
                  </fieldset>
                ))}
                <button className="secondary-button" type="button" onClick={() => updateEvent(event.id, { ...event, components: [...(event.components || []), { id: makeId(), name: '', weight: '', distance: '', reps: '', seconds: '' }] })}>Add implement</button>
                <label className="form-field strongman-event-time"><span className="field-label">Event time limit (sec) <span className="optional-label">Optional</span></span><input className="number-input" type="number" min="0" step="any" inputMode="decimal" aria-label={`Event ${index + 1} time limit (sec)`} value={event.seconds ?? ''} placeholder="TBA" onChange={input => updateEvent(event.id, { ...event, seconds: input.target.value })} /></label>
              </div>
            ) : <TargetFields value={event} prefix={`Event ${index + 1}`} onChange={updated => updateEvent(event.id, updated)} />}
            <button className="text-button strongman-remove" type="button" aria-label={`Remove event ${index + 1}`} onClick={() => onChange({ ...competition, events: competition.events.filter(item => item.id !== event.id) })}>Remove event</button>
          </fieldset>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={addEvent}>Add event</button>
    </div>
  );
};

const ResultSummary = ({ results, routineId, movement, scope = 'movement', target }) => {
  const options = { movement, scope, eventSnapshot: target };
  const current = summarizeStrongmanResults(results, { ...options, routineId });
  const lifetime = summarizeStrongmanResults(results, options);
  const timeGoal = target?.timeGoal === 'longest' ? 'longest' : 'fastest';
  const currentRecord = scope === 'medley' ? current.fastest : current.best;
  const lifetimeRecord = scope === 'medley' ? lifetime.fastest : lifetime.best;
  return (
    <>
      <dl className="strongman-event-results">
        <div><dt>This plan · {scope === 'medley' ? 'fastest full run' : 'heaviest result'}</dt><dd>{formatStrongmanResult(currentRecord)}</dd></div>
        <div><dt>Last trained</dt><dd>{lifetime.latest ? <>{relativeDate(lifetime.latest.date)}<small>{formatStrongmanDate(lifetime.latest.date)}{lifetime.latest.successful === false ? ' · Attempt' : ''}</small></> : 'Not logged yet'}</dd></div>
      </dl>
      <details className="strongman-record-details"><summary>Lifetime and timed records</summary><dl className="strongman-event-results">
        <div><dt>Lifetime · {scope === 'medley' ? 'same setup' : 'heaviest result'}</dt><dd>{formatStrongmanResult(lifetimeRecord)}{lifetimeRecord && <small>{formatStrongmanDate(lifetimeRecord.date)}</small>}</dd></div>
        {scope !== 'medley' && current[timeGoal] && <div><dt>{timeGoal === 'longest' ? 'Longest hold' : 'Fastest'} at this setup</dt><dd>{formatStrongmanResult(current[timeGoal])}</dd></div>}
        {scope !== 'medley' && lifetime[timeGoal] && <div><dt>Lifetime {timeGoal === 'longest' ? 'longest hold' : 'fastest'} · same setup</dt><dd>{formatStrongmanResult(lifetime[timeGoal])}<small>{formatStrongmanDate(lifetime[timeGoal].date)}</small></dd></div>}
      </dl></details>
    </>
  );
};

const ComponentSummary = ({ component, index, results, routineId }) => {
  const options = { movement: component.name, scope: 'movement' };
  const current = component.name ? summarizeStrongmanResults(results, { ...options, routineId }) : null;
  const lifetime = component.name ? summarizeStrongmanResults(results, options) : null;
  return <summary>
    <span className="strongman-component-title"><strong>{component.name || `Implement ${index + 1} · To be announced`}</strong><span>{formatStrongmanTarget(component)}</span></span>
    {component.name && <small>This plan: {formatStrongmanResult(current.best)}{lifetime.latest ? ` · Last ${relativeDate(lifetime.latest.date)}` : ''}</small>}
  </summary>;
};

export const StrongmanCompetitionCard = ({ routine, routines = [], onSaveCompetition, onEditingChange }) => {
  const competition = routine.inputs?.strongmanCompetition || { name: '', date: '', events: [] };
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editing = draft !== null;
  useUnsavedChanges(editing, saving);
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const allRoutines = useMemo(() => {
    const owned = routine.profileId ? routines.filter(item => item.profileId === routine.profileId) : routines;
    return owned.some(item => item.id === routine.id) ? owned : [...owned, routine];
  }, [routines, routine]);
  const results = useMemo(() => strongmanResults(allRoutines), [allRoutines]);
  const knownMovements = useMemo(() => strongmanKnownMovements(allRoutines), [allRoutines]);
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      await onSaveCompetition(normalizeStrongmanCompetition(draft));
      setDraft(null);
    } catch (failure) {
      setError(failure.message || 'Could not save the competition. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <section className="strongman-competition-card" aria-label="Next competition">
      <div className="strongman-card-heading"><div><p className="eyebrow">Next competition</p><h2>{competition.name || 'Your events'}</h2>{competition.date && <p className="strongman-help">{formatStrongmanDate(competition.date)}</p>}</div>{onSaveCompetition && !draft && <button className="text-button" type="button" onClick={() => { setDraft({ ...competition, events: [...(competition.events || [])] }); setError(''); }}>Edit competition</button>}</div>
      {draft ? (
        <form onSubmit={save}>
          <fieldset className="strongman-saving-fieldset" disabled={saving}>
            <StrongmanCompetitionEditor value={draft} onChange={setDraft} knownMovements={knownMovements} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="strongman-actions"><button className="primary-button" type="submit">{saving ? 'Saving…' : 'Save competition'}</button><button className="secondary-button" type="button" onClick={() => setDraft(null)}>Cancel</button></div>
          </fieldset>
        </form>
      ) : competition.events?.length ? (
        <div className="strongman-competition-events">
          {competition.events.map(event => (
            <article className="strongman-competition-event" key={event.id}>
              <h3>{event.name}</h3>
              {event.type === 'medley' ? <>
                <p className="strongman-target">Full medley{present(event.seconds) ? ` · ${numberLabel(event.seconds)} sec limit` : ' · Time limit to be announced'}</p>
                {(!(event.components || []).length || (event.components || []).some(component => !component.name || !present(component.weight) || !['distance', 'reps', 'seconds'].some(key => present(component[key]) && Number(component[key]) > 0))) && <p className="strongman-help">Full-run comparisons become available when each implement and its load and task are known. You can log individual training now.</p>}
                <ResultSummary results={results} routineId={routine.id} movement={event.name} scope="medley" target={event} />
                {(event.components || []).length ? <div className="strongman-medley-components">{event.components.map((component, index) => (
                  <details className="strongman-component" key={component.id}>
                    <ComponentSummary component={component} index={index} results={results} routineId={routine.id} />
                    {component.name && <ResultSummary results={results} routineId={routine.id} movement={component.name} target={component} />}
                  </details>
                ))}</div> : <p className="strongman-help">Implements to be announced. Add them whenever you know more.</p>}
              </> : <>
                <p className="strongman-target">Competition: {formatStrongmanTarget(event)}</p>
                <ResultSummary results={results} routineId={routine.id} movement={event.name} target={event} />
              </>}
            </article>
          ))}
          <p className="strongman-help">Heaviest results keep the reps and distance from that attempt. Full-run times compare the same implements, weights, and distances.</p>
        </div>
      ) : <p className="strongman-help">Add upcoming events to keep their weights and your training records in view. You can start with just an event name.</p>}
    </section>
  );
};
