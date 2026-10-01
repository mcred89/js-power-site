import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  normalizeMovementName,
  normalizeStrongmanCompetition,
  getStrongmanRecordGoal,
  isCompleteStrongmanSetup,
  STRONGMAN_RECORD_GOALS,
  strongmanPrimaryRecord,
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
    present(target?.height) && `${numberLabel(target.height)} in height`,
    present(target?.reps) && `${numberLabel(target.reps)} rep${Number(target.reps) === 1 ? '' : 's'}`,
    present(target?.seconds) && `${numberLabel(target.seconds)} sec`,
    present(target?.points) && `${numberLabel(target.points)} points`,
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

const RulesField = ({ value, onChange, prefix, visible = false }) => {
  const field = <label className="form-field strongman-scoring-rules"><span className="field-label">Scoring rules</span><input className="number-input" aria-label={`${prefix} scoring rules`} value={value.scoringRules || ''} maxLength="2000" placeholder={visible ? 'e.g. 1 point per light stone, 2 per heavy stone; 60 sec' : 'e.g. Best of 3 throws; no drops; 2-inch deficit'} onChange={event => onChange({ ...value, scoringRules: event.target.value })} /></label>;
  return visible ? field : <details className="strongman-extra-fields" open={present(value.scoringRules) || undefined}><summary>Setup and scoring rules (optional)</summary>{field}<p className="strongman-help">Describe conditions that should have separate records, such as deficit height, permitted drops, or best of three versus total distance.</p></details>;
};

const TargetFields = ({ value, onChange, prefix }) => {
  const goal = getStrongmanRecordGoal(value);
  const fields = [
    ['weight', 'Weight (lb)'], ['distance', 'Distance (ft)'], ['reps', 'Reps'],
    ['seconds', ['reps', 'distance', 'height', 'points'].includes(goal.value) ? 'Time window (sec)' : 'Time (sec)'],
    ...(goal.value === 'height' ? [['height', 'Height (in)']] : []),
    ...(goal.value === 'points' || present(value.points) ? [['points', 'Target points']] : []),
  ].sort(([left], [right]) => Number(right === goal.metric) - Number(left === goal.metric));
  const metric = (key, label) => (
      <label className="form-field" key={key}>
        <span className="field-label">{label}</span>
        <input className="number-input" type="number" inputMode={key === 'reps' ? 'numeric' : 'decimal'} min="0" step={key === 'reps' ? '1' : 'any'} aria-label={`${prefix} ${label}`} value={value[key] ?? ''} placeholder="TBA" onChange={event => onChange({ ...value, [key]: event.target.value })} />
      </label>
  );
  return <>
    <label className="form-field strongman-time-goal"><span className="field-label">Record goal</span><select className="number-input" aria-label={`${prefix} record goal`} value={goal.value} onChange={event => onChange({ ...value, timeGoal: event.target.value })}>{STRONGMAN_RECORD_GOALS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    {goal.value === 'weight' && <p className="strongman-help">For a max lift, leave weight blank or enter a personal target. Enter 1 rep for a single, or the required reps for a rep max.</p>}
    {goal.value === 'reps' && <p className="strongman-help">Reps are the score, so you can leave the target reps blank. Leave the time window blank for an untimed event.</p>}
    {goal.value === 'distance' && <p className="strongman-help">Distance is how far you travel or throw. Enter the implement weight and any time window; leave the target distance blank if there is no fixed finish.</p>}
    {goal.value === 'height' && <p className="strongman-help">Height is measured vertically in inches, for example a bag toss over a bar. Enter the implement weight; the target height is optional.</p>}
    {goal.value === 'points' && <p className="strongman-help">Enter scores manually. Include every implement’s weight, required distance or height, and scoring formula in the rules. For example: 200 lb stone = 1 point; 250 lb stone = 2; both over a 48-inch bar. Change the rules when any load or task changes so records stay separate. Leave unannounced rules blank for now.</p>}
    <div className="strongman-target-fields">{fields.map(([key, label]) => metric(key, label))}</div>
    {goal.value !== 'height' && <details className="strongman-extra-fields" open={present(value.height) || undefined}><summary>Height or loading platform (optional)</summary>{metric('height', 'Height (in)')}</details>}
    <RulesField value={value} onChange={onChange} prefix={prefix} visible={goal.value === 'points'} />
  </>;
};

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
              <label className="form-field"><span className="field-label">Event type</span><select className="number-input" aria-label={`Event ${index + 1} type`} value={event.type || 'single'} onChange={input => updateEvent(event.id, { ...event, type: input.target.value, ...(input.target.value === 'medley' ? { weight: '', distance: '', reps: '', height: '', points: '', scoringRules: '', timeGoal: 'fastest' } : {}) })}><option value="single">Movement or scored event</option><option value="medley">Timed medley</option></select></label>
            </div>
            {event.type === 'medley' ? (
              <div className="strongman-editor-components">
                <p className="strongman-help">Track each implement separately, then log full runs for the fastest time. For an event scored in points, choose Movement or scored event and More points is better.</p>
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
                <RulesField value={event} onChange={updated => updateEvent(event.id, updated)} prefix={`Event ${index + 1}`} />
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

const ResultSummary = ({ results, routineId, competitionId, movement, scope = 'movement', target }) => {
  const options = { movement, scope, eventSnapshot: target };
  const current = summarizeStrongmanResults(results, { ...options, ...(competitionId ? { competitionId } : { routineId }) });
  const periodLabel = competitionId ? 'This competition' : 'This plan';
  const lifetime = summarizeStrongmanResults(results, options);
  const goal = getStrongmanRecordGoal(target);
  const recordLabel = scope === 'medley' ? 'fastest full run' : `${goal.recordLabel.toLowerCase()} at this setup`;
  const currentRecord = scope === 'medley' ? current.fastest : strongmanPrimaryRecord(current, target);
  const lifetimeRecord = scope === 'medley' ? lifetime.fastest : strongmanPrimaryRecord(lifetime, target);
  const showHeaviest = scope !== 'medley' && (Number(current.best?.weight) > 0 || Number(lifetime.best?.weight) > 0);
  return (
    <>
      <dl className="strongman-event-results">
        <div><dt>{periodLabel} · {recordLabel}</dt><dd>{formatStrongmanResult(currentRecord)}</dd></div>
        {showHeaviest && <div><dt>{periodLabel} · heaviest result (any setup)</dt><dd>{formatStrongmanResult(Number(current.best?.weight) > 0 ? current.best : null)}</dd></div>}
        <div><dt>Last trained</dt><dd>{lifetime.latest ? <>{relativeDate(lifetime.latest.date)}<small>{formatStrongmanDate(lifetime.latest.date)}{lifetime.latest.successful === false ? ' · Attempt' : ''}</small></> : 'Not logged yet'}</dd></div>
      </dl>
      <details className="strongman-record-details"><summary>Lifetime and event records</summary><dl className="strongman-event-results">
        <div><dt>Lifetime · {recordLabel}</dt><dd>{formatStrongmanResult(lifetimeRecord)}{lifetimeRecord && <small>{formatStrongmanDate(lifetimeRecord.date)}</small>}</dd></div>
        {showHeaviest && <div><dt>Lifetime · heaviest result (any setup)</dt><dd>{formatStrongmanResult(Number(lifetime.best?.weight) > 0 ? lifetime.best : null)}</dd></div>}
      </dl></details>
    </>
  );
};

const ComponentSummary = ({ component, index, results, routineId, competitionId }) => {
  const options = { movement: component.name, scope: 'movement', eventSnapshot: component };
  const current = component.name ? summarizeStrongmanResults(results, { ...options, ...(competitionId ? { competitionId } : { routineId }) }) : null;
  const lifetime = component.name ? summarizeStrongmanResults(results, options) : null;
  const primary = current && strongmanPrimaryRecord(current, component);
  const heaviest = Number(current?.best?.weight) > 0 ? current.best : null;
  return <summary>
    <span className="strongman-component-title"><strong>{component.name || `Implement ${index + 1} · To be announced`}</strong><span>{formatStrongmanTarget(component)}</span></span>
    {component.scoringRules && <small>Scoring: {component.scoringRules}</small>}
    {component.name && <small>{competitionId ? 'This competition' : 'This plan'} · {primary || !heaviest ? getStrongmanRecordGoal(component).recordLabel.toLowerCase() : 'heaviest training'}: {formatStrongmanResult(primary || heaviest)}{lifetime.latest ? ` · Last ${relativeDate(lifetime.latest.date)}` : ''}</small>}
    {primary && heaviest && primary.id !== heaviest.id && <small>Heaviest training: {formatStrongmanResult(heaviest)}</small>}
  </summary>;
};

export const StrongmanCompetitionCard = ({ routine, routines = [], competition: suppliedCompetition, profileId, onSaveCompetition, onEndCompetition, onEditingChange }) => {
  const savedCompetition = suppliedCompetition === undefined ? routine?.inputs?.strongmanCompetition : suppliedCompetition;
  const competition = savedCompetition || { name: '', date: '', events: [] };
  const [draft, setDraft] = useState(null);
  const [ending, setEnding] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editing = draft !== null || ending !== null;
  useUnsavedChanges(editing, saving);
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const allRoutines = useMemo(() => {
    const owner = profileId || routine?.profileId;
    const owned = owner ? routines.filter(item => item.profileId === owner) : routines;
    return !routine || owned.some(item => item.id === routine.id) ? owned : [...owned, routine];
  }, [routines, routine, profileId]);
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
  const endCompetition = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onEndCompetition(ending);
      setEnding(null);
    } catch (failure) {
      setError(failure.message || 'Could not update the competition. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <section className="strongman-competition-card" aria-label="Next competition">
      <div className="strongman-card-heading"><div><p className="eyebrow">Next competition</p><h2>{competition.name || 'Your events'}</h2>{competition.date && <p className="strongman-help">{formatStrongmanDate(competition.date)}</p>}</div>{onSaveCompetition && !editing && <button className="text-button" type="button" onClick={() => { setDraft({ ...competition, events: [...(competition.events || [])] }); setError(''); }}>{savedCompetition ? 'Edit competition' : 'Add competition'}</button>}</div>
      {savedCompetition && suppliedCompetition !== undefined && <p className="strongman-help">This competition carries across your plans until you complete or remove it.</p>}
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
                {event.scoringRules && <p className="strongman-help">Scoring: {event.scoringRules}</p>}
                {!isCompleteStrongmanSetup(event) && <p className="strongman-help">Full-run comparisons become available when each implement and its load and task are known. Enter its distance, reps, hold time, or height; a points target alone does not define the physical task. You can log individual training now.</p>}
                <ResultSummary results={results} routineId={routine?.id} competitionId={competition.id} movement={event.name} scope="medley" target={event} />
                {(event.components || []).length ? <div className="strongman-medley-components">{event.components.map((component, index) => (
                  <details className="strongman-component" key={component.id}>
                    <ComponentSummary component={component} index={index} results={results} routineId={routine?.id} competitionId={competition.id} />
                    {component.name && <ResultSummary results={results} routineId={routine?.id} competitionId={competition.id} movement={component.name} target={component} />}
                  </details>
                ))}</div> : <p className="strongman-help">Implements to be announced. Add them whenever you know more.</p>}
              </> : <>
                <p className="strongman-target">Competition: {formatStrongmanTarget(event)} · {getStrongmanRecordGoal(event).label}</p>
                {event.scoringRules && <p className="strongman-help">Scoring: {event.scoringRules}</p>}
                <ResultSummary results={results} routineId={routine?.id} competitionId={competition.id} movement={event.name} target={event} />
              </>}
            </article>
          ))}
          <p className="strongman-help">Event records compare matching setups and scoring rules. Time windows stay separate from elapsed run times and holds. Heaviest results across setups are also shown with their actual reps and distance.</p>
        </div>
      ) : <p className="strongman-help">Add upcoming events to keep their weights and your training records in view. You can start with just an event name.</p>}
      {savedCompetition && onEndCompetition && !draft && (ending ? <div className="strongman-delete-confirm" role="group" aria-label="Confirm competition change">
        <p>{ending === 'completed' ? 'Mark this competition complete?' : 'Remove this competition from your plans?'} It will stop carrying into your plans. Your recorded training and records will stay saved.</p>
        <div className="strongman-actions"><button className="secondary-button" type="button" disabled={saving} onClick={endCompetition}>{saving ? 'Saving…' : ending === 'completed' ? 'Confirm completion' : 'Confirm removal'}</button><button className="text-button" type="button" disabled={saving} onClick={() => { setEnding(null); setError(''); }}>Cancel</button></div>
      </div> : <div className="strongman-actions"><button className="text-button" type="button" onClick={() => { setEnding('completed'); setError(''); }}>Mark competition complete</button><button className="text-button danger-text" type="button" onClick={() => { setEnding('removed'); setError(''); }}>Remove competition</button></div>)}
      {!draft && error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
};
