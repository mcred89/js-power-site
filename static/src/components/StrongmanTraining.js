import React, { useEffect, useRef, useState } from 'react';
import { StrongmanResultEditor } from './StrongmanResultEditor';
import { previousStrongmanWorkouts, copyStrongmanWorkout } from '../data/strongmanWorkoutCopy';
import './StrongmanTraining.css';
import { useUnsavedChanges } from './useUnsavedChanges';
import { competitionChoicesForTraining, competitionForPastTraining } from '../data/strongmanCompetitionContext';

export { StrongmanResultEditor } from './StrongmanResultEditor';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const localDate = value => {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const today = () => localDate();
const EMPTY_QUEUE = [];

const emptySet = () => ({ id: makeId(), weight: '', reps: '', distance: '', seconds: '', height: '', points: '', successful: true });
export const newStrongmanSetEntry = entry => {
  const next = { ...entry, id: makeId(), sets: [{ ...emptySet(), ...entry.sets[entry.sets.length - 1], id: makeId(), successful: true }] };
  delete next.createdAt;
  delete next.updatedAt;
  return next;
};
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const setLabel = set => [
  set.weight !== '' && set.weight != null ? `${set.weight} lb` : '',
  set.reps !== '' && set.reps != null ? `${set.reps} ${Number(set.reps) === 1 ? 'rep' : 'reps'}` : '',
  set.distance !== '' && set.distance != null ? `${set.distance} ft` : '',
  set.height !== '' && set.height != null ? `${set.height} in height` : '',
  set.seconds !== '' && set.seconds != null ? `${set.seconds} s` : '',
  set.points !== '' && set.points != null ? `${set.points} points` : '',
].filter(Boolean).join(' · ');

export const StrongmanTraining = ({ routine, workout, routines = [], competition, competitionHistory = [], onSaveLog, onSaveTraining, onEditingChange }) => {
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pastEntryId, setPastEntryId] = useState(null);
  const [copying, setCopying] = useState(false);
  const [clearQueue, setClearQueue] = useState(false);
  const sectionRef = useRef(null);
  const savingRef = useRef(false);
  const returnFocus = useRef(null);
  useUnsavedChanges(saving, saving);
  const entries = routine.strongmanLog || [];
  const dayEntries = entries.filter(entry => entry.workoutId === workout.id);
  const pastEntry = entries.find(entry => entry.id === pastEntryId && !entry.workoutId);
  const queue = workout.strongmanQueue || EMPTY_QUEUE;
  const pendingCount = queue.reduce((count, entry) => count + entry.sets.length, 0);
  const loggedCount = dayEntries.reduce((count, entry) => count + entry.sets.length, 0);
  const sources = copying ? previousStrongmanWorkouts(routine, routines, workout, today()) : [];
  const currentCompetition = competition === undefined ? routine.inputs?.strongmanCompetition : competition;
  const historical = editing?.mode === 'past' || Boolean(workout.completedAt);
  const editorCompetition = historical ? competitionForPastTraining(routine, competition, competitionHistory, workout.completedAt ? workout : undefined) : currentCompetition;
  const competitionOptions = historical ? competitionChoicesForTraining(currentCompetition, competitionHistory, routine) : undefined;
  const knownMovements = [...new Set([routine, ...routines].flatMap(item => (
    (item.strongmanLog || []).filter(entry => entry.scope !== 'medley').map(entry => entry.movement)
  )))];
  useEffect(() => { onEditingChange?.(Boolean(editing) || saving); }, [editing, saving, onEditingChange]);
  useEffect(() => {
    if (editing || saving || !returnFocus.current) return;
    const buttons = [...(sectionRef.current?.querySelectorAll('[data-continue]') || [])];
    const target = buttons.find(button => button.dataset.continue === returnFocus.current) || buttons[0];
    target?.focus();
    returnFocus.current = null;
  }, [editing, saving, notice, queue]);
  const startEditing = value => { setEditing(value); setDeleteId(null); setClearQueue(false); setNotice(''); setCopying(false); };
  const closeEditor = () => { returnFocus.current = returnFocus.current || editing?.anchorId || 'new'; setEditing(null); };
  const saveEntry = async (entry, retainedEntry) => {
    const originals = retainedEntry ? entries.map(item => item.id === retainedEntry.id ? retainedEntry : item) : entries;
    const nextEntries = originals.some(item => item.id === entry.id)
      ? originals.map(item => item.id === entry.id ? entry : item) : [...originals, entry];
    if (editing?.queueId) {
      const remaining = queue.flatMap(item => item.id !== editing.queueId ? [item] : (
        item.sets.length > 1 ? [{ ...item, sets: item.sets.slice(1) }] : []
      ));
      await onSaveTraining(nextEntries, remaining);
    } else {
      await onSaveLog(nextEntries);
    }
    returnFocus.current = editing?.queueId || entry.id;
    if (!entry.workoutId) setPastEntryId(entry.id);
    setNotice(entry.workoutId ? `${entry.scope === 'medley' ? 'Run' : 'Set'} saved. Add another whenever you’re ready.` : 'Past training saved. It is included in your cycle records and Progress.');
  };
  const saveQueue = async (nextQueue, message) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSaveTraining(entries, nextQueue);
      setCopying(false);
      setClearQueue(false);
      setNotice(message);
      returnFocus.current = nextQueue[0]?.id || 'new';
    } catch (failure) {
      setError(failure.message || 'Could not save this workout. Try again.');
    } finally { savingRef.current = false; setSaving(false); }
  };
  const deleteEntry = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSaveLog(entries.filter(entry => entry.id !== deleteId));
      setDeleteId(null);
    } catch (saveError) {
      setError(saveError.message || 'Could not delete this exercise. Try again.');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const renderEditor = () => <StrongmanResultEditor key={`${editing.entry?.id || editing.mode}:${editing.editSetId || ''}`}
    entry={editing.entry} appendToEntry={editing.appendToEntry} editSetId={editing.editSetId}
    competition={editorCompetition} competitionOptions={competitionOptions?.length ? competitionOptions : undefined} knownMovements={knownMovements}
    workoutId={editing.mode === 'past' ? null : workout.id}
    initialDate={editing.mode !== 'past' && workout.completedAt ? localDate(workout.completedAt) : undefined}
    showDate={editing.mode === 'past' || Boolean(workout.completedAt)}
    focusLastSet={editing.focusLastSet} newRun={editing.newRun} newSet={editing.newSet}
    onSave={saveEntry} onCancel={closeEditor} />;

  return <section className="strongman-training card" aria-label="Strongman training log" ref={sectionRef}>
    <div className="strongman-training-heading"><div>
      <p className="eyebrow">Your training</p>
      <h2>{workout.completedAt ? 'What you did' : 'Today’s training'}</h2>
    </div></div>
    <p className="strongman-training-progress" aria-live="polite">{loggedCount} {loggedCount === 1 ? 'set' : 'sets'} logged{pendingCount > 0 ? ` · ${pendingCount} to go` : ''}</p>
    {!dayEntries.length && !queue.length && !editing && <p className="muted">Log one set at a time, or start from a previous workout.</p>}
    {editing && !editing.anchorId && renderEditor()}
    {!editing && <div className="strongman-training-actions">
      <button type="button" className="primary-button" data-continue="new" disabled={saving} onClick={() => startEditing({ mode: 'day' })}>Add exercise</button>
      {!workout.completedAt && !queue.length && onSaveTraining && <button type="button" className="secondary-button" disabled={saving}
        aria-expanded={copying} onClick={() => { setCopying(!copying); setError(''); }}>Copy previous workout</button>}
    </div>}
    {copying && <div className="strongman-copy-picker" role="group" aria-label="Choose a previous workout">
      <p className="field-help">Load the sets as a starting point. Log each one as you train; saved results stay unchanged.</p>
      {sources.length ? <ul>{sources.map(source => <li key={source.id}>
        <button className="strongman-copy-choice" type="button" disabled={saving}
          onClick={() => saveQueue(copyStrongmanWorkout(source, workout.id, today(), currentCompetition), 'Workout copied. Log each set as you train.')}>
          <strong>{source.label} · {dateLabel(source.date)}</strong>
          <span>{source.preview}</span><small>{source.routineName}</small>
        </button>
      </li>)}</ul> : <p className="muted">No earlier training yet. Log past training below to reuse it here.</p>}
      <button className="text-button" type="button" disabled={saving} onClick={() => setCopying(false)}>Cancel copy</button>
    </div>}
    {queue.length > 0 && <div className="strongman-training-queue" aria-label="Copied workout">
      {queue.map((entry, index) => {
        const logged = dayEntries.find(item => item.id === entry.id);
        return <article className="strongman-queue-entry" key={entry.id}>
          <div className="strongman-training-entry-heading"><div>
            <p className="eyebrow">{index === 0 ? 'Up next' : 'Coming up'}</p>
            <h3>{entry.movement}</h3>
            <p className="muted">{entry.sets.length} {entry.scope === 'medley' ? 'runs' : 'sets'} remaining{logged ? ` · ${logged.sets.length} logged` : ''}</p>
          </div></div>
          {editing?.queueId === entry.id ? renderEditor() : <>
            <p className="strongman-queue-preview">Next: {setLabel(entry.sets[0])}</p>
            <div className="strongman-training-actions">
              <button type="button" className="secondary-button" data-continue={entry.id} disabled={Boolean(editing) || saving}
                onClick={() => startEditing({
                  anchorId: entry.id, queueId: entry.id,
                  entry: { ...entry, id: logged ? makeId() : entry.id, date: today(), sets: [{ ...entry.sets[0] }] },
                  appendToEntry: logged || null, newSet: entry.scope !== 'medley', newRun: entry.scope === 'medley', focusLastSet: true,
                })}>Log next {entry.scope === 'medley' ? 'run' : 'set'}</button>
              <button type="button" className="text-button" disabled={Boolean(editing) || saving}
                onClick={() => saveQueue(queue.flatMap(item => item.id !== entry.id ? [item] : (item.sets.length > 1 ? [{ ...item, sets: item.sets.slice(1) }] : [])), 'Skipped. No result was recorded.')}>
                Skip {entry.scope === 'medley' ? 'run' : 'set'}</button>
            </div>
          </>}
        </article>;
      })}
      {!editing && <button className="text-button" type="button" disabled={saving} onClick={() => setClearQueue(true)}>Clear remaining sets</button>}
      {clearQueue && !editing && <div role="group" aria-label="Confirm clear remaining sets">
        <p>Remove the {pendingCount} unlogged sets? Your logged results stay saved.</p>
        <div className="strongman-training-actions"><button type="button" className="danger-button" disabled={saving} onClick={() => saveQueue([], 'Remaining sets cleared. Your logged results are saved.')}>Clear unlogged sets</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => setClearQueue(false)}>Keep sets</button></div>
      </div>}
    </div>}
    <div className="strongman-training-entries">
      {dayEntries.map(entry => <article className="strongman-training-entry" key={entry.id}>
        <div className="strongman-training-entry-heading"><div>
          <h3>{entry.movement}</h3>
          <p className="muted">{dateLabel(entry.date)}{entry.scope === 'medley' ? ' · Full event' : ''}</p>
        </div>
          <button type="button" className="text-button" disabled={Boolean(editing) || saving}
            aria-label={`Edit ${entry.movement}`} onClick={() => startEditing({ entry, anchorId: entry.id })}>Edit</button>
        </div>
        {editing?.anchorId === entry.id && !editing.queueId && renderEditor()}
        <ol className="strongman-training-results">
          {entry.sets.map((set, index) => <li key={set.id || index}>
            <span>{setLabel(set)}</span>
            {set.successful === false && <span className="strongman-training-attempt">Unsuccessful</span>}
            <button type="button" className="text-button" disabled={Boolean(editing) || saving}
              aria-label={`Edit ${entry.scope === 'medley' ? 'run' : 'set'} ${index + 1} of ${entry.movement}`}
              onClick={() => startEditing({ entry, anchorId: entry.id, editSetId: set.id })}>Edit</button>
          </li>)}
        </ol>
        {entry.eventSnapshot?.scoringRules && <p className="strongman-training-notes">Scoring: {entry.eventSnapshot.scoringRules}</p>}
        {entry.notes && <p className="strongman-training-notes">{entry.notes}</p>}
        <div className="strongman-training-actions">
          <button type="button" className="secondary-button" data-continue={entry.id} disabled={Boolean(editing) || saving}
            onClick={() => {
              startEditing({
                anchorId: entry.id,
                entry: newStrongmanSetEntry(entry),
                appendToEntry: entry,
                focusLastSet: true,
                newRun: entry.scope === 'medley',
                newSet: entry.scope !== 'medley',
              });
            }}>
            {entry.scope === 'medley' ? 'Add run' : 'Add set'}
          </button>
          <button type="button" className="text-button" disabled={Boolean(editing) || saving}
            aria-label={`Delete ${entry.movement}`} onClick={() => { setDeleteId(entry.id); setError(''); }}>Delete</button>
        </div>
        {deleteId === entry.id && <div className="strongman-training-delete" role="group" aria-label="Confirm delete exercise">
          <p>Delete this exercise and its {entry.sets.length === 1 ? 'set' : 'sets'}? It will also be removed from your records.</p>
          <div className="strongman-training-actions">
            <button type="button" className="danger-button" onClick={deleteEntry} disabled={saving}>{saving ? 'Deleting…' : 'Delete exercise'}</button>
            <button type="button" className="secondary-button" onClick={() => setDeleteId(null)} disabled={saving}>Keep exercise</button>
          </div>
        </div>}
      </article>)}
    </div>
    {error && <p className="strongman-training-error" role="alert">{error}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
    {pastEntry && !editing && <aside className="strongman-past-entry" aria-label="Recently logged past training">
      <p className="eyebrow">Past training · {dateLabel(pastEntry.date)}</p>
      <h3>{pastEntry.movement}</h3>
      <p className="muted">{pastEntry.sets.length} {pastEntry.scope === 'medley' ? 'runs' : 'sets'} logged · {setLabel(pastEntry.sets[pastEntry.sets.length - 1])}</p>
      <button type="button" className="secondary-button" data-continue={pastEntry.id} disabled={saving}
        onClick={() => startEditing({ mode: 'past', entry: newStrongmanSetEntry(pastEntry), appendToEntry: pastEntry,
          newSet: pastEntry.scope !== 'medley', newRun: pastEntry.scope === 'medley', focusLastSet: true })}>
        Add {pastEntry.scope === 'medley' ? 'run' : 'set'} to past training</button>
    </aside>}
    {!editing && <button type="button" className="text-button strongman-backfill" disabled={saving} onClick={() => startEditing({ mode: 'past' })}>Log past training</button>}
    {editing?.mode === 'past' && <p className="muted">Choose the date you trained. This result counts toward this cycle and appears in Progress.</p>}
  </section>;
};

export default StrongmanTraining;
