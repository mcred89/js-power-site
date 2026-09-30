import React, { useEffect, useMemo, useState } from 'react';
import {
  normalizeMovementName,
  getStrongmanRecordGoal,
  strongmanPrimaryRecord,
  strongmanRecordSetup,
  strongmanRecordSetupKey,
  strongmanResults,
  summarizeStrongmanResults,
} from '../data/strongman';
import { StrongmanResultEditor } from './StrongmanTraining';
import {
  formatStrongmanDate,
  formatStrongmanResult,
  formatStrongmanTarget,
  strongmanKnownMovements,
} from './StrongmanCompetition';
import './Strongman.css';

const PAGE_SIZE = 20;
const movementKey = entry => `${entry.scope === 'medley' ? 'medley' : 'movement'}:${normalizeMovementName(entry.movement)}`;
const present = value => value !== '' && value !== undefined && value !== null;
const setupLabel = setup => {
  if (setup?.type === 'medley') return [(setup.components || []).map((component, index) => [`${component.name || `Implement ${index + 1}`}: ${formatStrongmanTarget(component)}`, component.scoringRules].filter(Boolean).join(' · ')).join(' / '), setup.scoringRules].filter(Boolean).join(' · ');
  const goal = getStrongmanRecordGoal(setup);
  const fixed = formatStrongmanTarget({ ...setup, seconds: '', [goal.metric]: '' });
  const window = ['reps', 'distance', 'height', 'points'].includes(goal.value)
    ? (present(setup.seconds) ? `${formatStrongmanTarget({ seconds: setup.seconds })} time window` : 'Untimed') : '';
  return [fixed === 'To be announced' ? '' : fixed, window, goal.recordLabel, setup?.scoringRules].filter(Boolean).join(' · ');
};

const RecordMetric = ({ label, result, empty = 'No results yet' }) => (
  <div className="strongman-record-metric"><small>{label}</small><strong>{result ? formatStrongmanResult(result) : empty}</strong>{result && <span>{formatStrongmanDate(result.date)} · {result.routineName}{result.successful === false ? ' · Unsuccessful attempt' : ''}</span>}</div>
);

export const StrongmanProgress = ({ routines = [], onSaveLog, defaultRoutineId }) => {
  const results = useMemo(() => strongmanResults(routines), [routines]);
  const knownMovements = useMemo(() => strongmanKnownMovements(routines), [routines]);
  const [selectedMovement, setSelectedMovement] = useState('');
  const [routineId, setRoutineId] = useState('all');
  const [selectedSetup, setSelectedSetup] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [editor, setEditor] = useState(null);
  const [newRoutineId, setNewRoutineId] = useState('');
  const [removing, setRemoving] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const movements = useMemo(() => {
    const found = new Map();
    results.forEach(result => {
      const key = movementKey(result);
      if (!found.has(key)) found.set(key, { key, movement: result.movement, scope: result.scope === 'medley' ? 'medley' : 'movement' });
    });
    return [...found.values()].sort((a, b) => a.movement.localeCompare(b.movement));
  }, [results]);
  const movement = movements.find(item => item.key === selectedMovement) || movements[0];
  const movementResults = useMemo(() => results.filter(result => movement && movementKey(result) === movement.key), [results, movement]);
  const setups = useMemo(() => {
    const found = new Map();
    const addSetup = (result, timeGoal) => {
      const snapshot = strongmanRecordSetup(result, timeGoal);
      if (!snapshot) return;
      const key = strongmanRecordSetupKey(snapshot);
      if (!found.has(key)) found.set(key, { key, snapshot, label: setupLabel(snapshot) || 'Full event setup' });
    };
    movementResults.forEach(result => {
      if (result.scope === 'medley') {
        if (present(result.seconds)) addSetup(result);
        return;
      }
      const goal = getStrongmanRecordGoal(result.eventSnapshot).value;
      if (['weight', 'distance', 'height', 'points'].includes(goal)) {
        addSetup(result);
      } else {
        if (goal !== 'reps' && present(result.seconds)) addSetup(result);
        if (goal === 'reps' || Number(result.reps) > 0) addSetup(result, 'reps');
      }
    });
    return [...found.values()];
  }, [movementResults]);
  const setup = setups.find(item => item.key === selectedSetup) || setups[0];
  const options = { movement: movement?.movement, scope: movement?.scope, eventSnapshot: setup?.snapshot };
  const scoped = summarizeStrongmanResults(movement ? results : [], { ...options, routineId: routineId === 'all' ? undefined : routineId });
  const lifetime = summarizeStrongmanResults(movement ? results : [], options);
  const timeGoal = setup?.snapshot?.timeGoal === 'longest' ? 'longest' : 'fastest';
  const recordGoal = getStrongmanRecordGoal(setup?.snapshot);
  const scored = ['reps', 'weight', 'distance', 'height', 'points'].includes(recordGoal.value);
  const records = scoped.records || [];
  const entries = [];
  const seen = new Set();
  records.forEach(result => {
    const key = `${result.routineId}:${result.entryId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const routine = routines.find(item => item.id === result.routineId);
    const entry = routine?.strongmanLog?.find(item => item.id === result.entryId);
    if (entry) entries.push({ routine, entry });
  });
  const defaultRoutine = routines.find(item => item.id === defaultRoutineId) || routines.find(item => !item.archived) || routines[0];
  const activeEditorRoutine = editor && routines.find(item => item.id === (editor.routineId || newRoutineId));
  useEffect(() => {
    if (editor && !routines.some(item => item.id === (editor.routineId || newRoutineId))) setEditor(null);
    if (removing && !routines.some(item => item.id === removing.routine.id)) setRemoving(null);
  }, [routines, editor, newRoutineId, removing]);

  const saveEntry = async entry => {
    const target = activeEditorRoutine;
    if (!target) throw new Error('Choose a plan for this result.');
    const logs = target.strongmanLog || [];
    const next = logs.some(item => item.id === entry.id) ? logs.map(item => item.id === entry.id ? entry : item) : [...logs, entry];
    setSaving(true);
    try {
      await onSaveLog(target.id, next);
      setSelectedMovement(movementKey(entry));
      setSelectedSetup('');
      setVisibleCount(PAGE_SIZE);
    } finally { setSaving(false); }
  };

  const deleteEntry = async () => {
    if (saving || !removing) return;
    setSaving(true);
    setError('');
    try {
      const target = routines.find(item => item.id === removing.routine.id);
      await onSaveLog(target.id, target.strongmanLog.filter(item => item.id !== removing.entry.id));
      setRemoving(null);
    } catch (failure) { setError(failure.message || 'Could not remove the result. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <article className="progress-card strongman-records" aria-label="Strongman records">
      <div className="strongman-card-heading"><div><p className="eyebrow">Strongman</p><h2>Event records</h2></div>{onSaveLog && routines.length > 0 && !editor && !removing && <button className="secondary-button" type="button" onClick={() => { setNewRoutineId(routineId === 'all' ? defaultRoutine.id : routineId); setEditor({ entry: null }); setError(''); }}>Log past result</button>}</div>
      <p className="strongman-help">Your implements and full events across every plan. Reuse the same movement name in a new competition to carry these records forward.</p>
      {editor && activeEditorRoutine && <div className="strongman-result-editor-slot">
        {!editor.entry && <label className="form-field strongman-record-select"><span className="field-label">Plan for this result</span><select className="number-input" aria-label="Plan for past result" disabled={saving} value={activeEditorRoutine.id} onChange={event => setNewRoutineId(event.target.value)}>{routines.map(routine => <option value={routine.id} key={routine.id}>{routine.name}{routine.archived ? ' (archived)' : ''}</option>)}</select></label>}
        <StrongmanResultEditor key={editor.entry?.id || 'new'} entry={editor.entry} onSave={saveEntry} onCancel={() => setEditor(null)} competition={activeEditorRoutine.inputs?.strongmanCompetition} knownMovements={knownMovements} workoutId={editor.entry?.workoutId || null} />
      </div>}
      {movements.length > 0 ? <>
        <div className="strongman-record-filters">
          <label className="form-field"><span className="field-label">Movement or full event</span><select className="number-input" aria-label="Strongman movement" value={movement?.key || ''} onChange={event => { setSelectedMovement(event.target.value); setSelectedSetup(''); setVisibleCount(PAGE_SIZE); }}>
            {movements.map(item => <option key={item.key} value={item.key}>{item.movement}{item.scope === 'medley' ? ' · Full medley' : ''}</option>)}
          </select></label>
          <label className="form-field"><span className="field-label">Training plan</span><select className="number-input" aria-label="Strongman plan" value={routineId} onChange={event => { setRoutineId(event.target.value); setVisibleCount(PAGE_SIZE); }}><option value="all">All plans</option>{routines.map(routine => <option value={routine.id} key={routine.id}>{routine.name}</option>)}</select></label>
        </div>
        {setups.length > 0 && <label className="form-field strongman-record-select"><span className="field-label">Setup for records</span><select className="number-input" aria-label="Strongman record setup" value={setup?.key || ''} onChange={event => setSelectedSetup(event.target.value)}>{setups.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>}
        <div className="strongman-record-summary">
          <RecordMetric label={`${movement.scope === 'medley' ? 'Fastest full run' : scored ? `${recordGoal.recordLabel} at this setup` : 'Heaviest result'} · ${routineId === 'all' ? 'all plans' : 'selected plan'}`} result={movement.scope === 'medley' ? scoped.fastest : scored ? strongmanPrimaryRecord(scoped, setup.snapshot) : scoped.best} />
          <RecordMetric label={movement.scope === 'medley' ? 'Lifetime fastest · same setup' : scored ? `Lifetime ${recordGoal.recordLabel.toLowerCase()} · same setup` : 'Lifetime heaviest result'} result={movement.scope === 'medley' ? lifetime.fastest : scored ? strongmanPrimaryRecord(lifetime, setup.snapshot) : lifetime.best} />
          {scored && recordGoal.value !== 'points' && <>
            <RecordMetric label={`Heaviest result · ${routineId === 'all' ? 'all plans' : 'selected plan'}`} result={scoped.best} />
            <RecordMetric label="Lifetime heaviest result" result={lifetime.best} />
          </>}
          {movement.scope !== 'medley' && setup && !scored && <RecordMetric label={`${timeGoal === 'longest' ? 'Longest hold' : 'Fastest'} · same setup`} result={scoped[timeGoal]} />}
          <RecordMetric label={`Last trained · ${routineId === 'all' ? 'all plans' : 'selected plan'}`} result={scoped.latest} />
        </div>
        <p className="strongman-help">Records compare the same setup and rules, leaving out the measure being scored. Time windows stay separate from elapsed run times. Heaviest training results retain their actual task; unsuccessful attempts remain in history.</p>
        <h3>Training history</h3>
        {entries.length ? <ul className="strongman-result-history">
          {entries.slice(0, visibleCount).map(({ routine, entry }) => <li key={`${routine.id}:${entry.id}`}>
            <div className="strongman-result-history-heading"><strong>{formatStrongmanDate(entry.date)}</strong><small>{routine.name}</small></div>
            {(entry.sets || []).map((set, index) => <p key={set.id}><strong>Set {index + 1}</strong> · {formatStrongmanResult(set)}{set.successful === false ? ' · Unsuccessful attempt' : ''}</p>)}
            {entry.notes && <p>{entry.notes}</p>}
            {entry.scope === 'medley' && entry.eventSnapshot && <details><summary>Full event setup</summary><p>{setupLabel(entry.eventSnapshot)}</p></details>}
            {entry.scope !== 'medley' && entry.eventSnapshot?.scoringRules && <details><summary>Recorded setup and rules</summary><p>{entry.eventSnapshot.scoringRules}</p>{entry.eventSnapshot.timeGoal === 'points' && ['weight', 'distance', 'reps', 'height'].some(key => present(entry.eventSnapshot[key])) && <p>Fixed setup: {formatStrongmanTarget({ weight: entry.eventSnapshot.weight, distance: entry.eventSnapshot.distance, reps: entry.eventSnapshot.reps, height: entry.eventSnapshot.height })}</p>}</details>}
            {onSaveLog && !editor && !removing && <div className="strongman-actions"><button className="text-button" type="button" aria-label={`Edit ${entry.movement} result from ${formatStrongmanDate(entry.date)}`} onClick={() => { setEditor({ routineId: routine.id, entry }); setError(''); }}>Edit result</button><button className="text-button" type="button" aria-label={`Remove ${entry.movement} result from ${formatStrongmanDate(entry.date)}`} onClick={() => { setRemoving({ routine, entry }); setError(''); }}>Remove result</button></div>}
          </li>)}
        </ul> : <p className="strongman-help">No attempts in this plan yet. Your lifetime record is still shown above.</p>}
        {entries.length > visibleCount && <button className="secondary-button" type="button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show older results</button>}
      </> : <p className="strongman-help">Log a Strongman exercise or add a past result to start your record book.</p>}
      {removing && <div className="strongman-delete-confirm" role="group" aria-label="Confirm removal"><p>Remove {removing.entry.movement} from {formatStrongmanDate(removing.entry.date)}? Its sets will be removed from your records.</p><div className="strongman-actions"><button className="secondary-button" type="button" disabled={saving} onClick={deleteEntry}>{saving ? 'Removing…' : 'Remove result'}</button><button className="text-button" type="button" disabled={saving} onClick={() => setRemoving(null)}>Cancel</button></div></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </article>
  );
};
