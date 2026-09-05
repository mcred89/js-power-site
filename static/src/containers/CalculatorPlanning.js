import React, { useCallback, useEffect, useRef, useState } from 'react';
import StrongmanBuilder from '../components/StrongmanBuilder';
import { createStrongmanRoutine, strongmanCoverage } from '../data/strongman';
import { applyBatch, getAll, getAllByIndex } from '../data/storage';

const emptyContext = () => ({ profile: null, activeStrongman: null, routines: [] });

// Website-only planning. Profile access is explicit, previews never write, and
// saving creates a separate inactive block without changing training enrollment.
const CalculatorPlanning = ({ mode = 'strongman', requestProfiles = false, onContextChange, onCancel }) => {
  const [profiles, setProfiles] = useState(null);
  const [context, setContext] = useState(emptyContext);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState('');
  const request = useRef(0);
  const loadedAutomatically = useRef(false);
  const changeContext = useCallback(value => {
    setContext(value);
    onContextChange?.(value);
  }, [onContextChange]);
  const loadProfiles = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setError('');
    try {
      const records = await getAll('profiles');
      if (token !== request.current) return;
      setProfiles(records);
      setSelectedId('');
      changeContext(emptyContext());
    } catch (failure) {
      if (token === request.current) setError(failure.message || 'Local profiles could not be loaded.');
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [changeContext]);
  useEffect(() => {
    if (requestProfiles && !loadedAutomatically.current) {
      loadedAutomatically.current = true;
      loadProfiles();
    }
  }, [requestProfiles, loadProfiles]);
  useEffect(() => () => { request.current += 1; }, []);
  const selectProfile = async id => {
    const token = ++request.current;
    setSelectedId(id);
    setSavedTo('');
    setError('');
    changeContext(emptyContext());
    const profile = profiles?.find(record => record.id === id);
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const routines = await getAllByIndex('routines', 'profileId', id);
      if (token !== request.current) return;
      const activeStrongman = routines.find(routine => routine.id === profile.activeStrongmanRoutineId
        && routine.kind === 'strongman' && routine.status === 'active' && !routine.archived) || null;
      changeContext({ profile, activeStrongman, routines });
    } catch (failure) {
      if (token === request.current) setError(failure.message || 'This profile could not be loaded.');
    } finally {
      if (token === request.current) setLoading(false);
    }
  };
  const showPreview = (name, inputs) => {
    try {
      setPreview(createStrongmanRoutine(context.profile?.id || 'calculator-preview', name, inputs));
      setEditing(false);
      setSavedTo('');
      setError('');
    } catch (failure) { setError(failure.message); }
  };
  const savePreview = async () => {
    if (!context.profile || !preview || saving || savedTo) return;
    const profile = context.profile;
    setSaving(true);
    setError('');
    try {
      const record = { ...createStrongmanRoutine(profile.id, preview.name, preview.inputs), status: 'saved' };
      await applyBatch({
        puts: { routines: [record] },
        conditions: { profiles: [{ key: profile.id, expected: profile }], routines: [{ key: record.id, expected: undefined }] },
      });
      setSavedTo(profile.name);
    } catch (failure) { setError(failure.message || 'The block could not be saved. Your preview is still available.'); }
    finally { setSaving(false); }
  };
  const coverage = preview ? strongmanCoverage(preview) : null;
  const connectedPreview = context.activeStrongman ? strongmanCoverage(context.activeStrongman) : null;
  return <section className="calculator-planning">
    <div className="strongman-card">
      <p className="strongman-help">Preview plans freely. Choose a local profile to connect its active strongman block to the strength calculator.</p>
      {profiles === null ? <button className="text-button" type="button" disabled={loading} onClick={loadProfiles}>Use a local profile</button>
        : <><label className="form-field"><span className="field-label">Local training profile</span><select className="number-input" aria-label="Local training profile" value={selectedId} onChange={event => selectProfile(event.target.value)} disabled={saving}>
          <option value="">Unsaved calculator only</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select></label><button className="text-button" type="button" disabled={loading || saving} onClick={loadProfiles}>Refresh profiles</button>{!profiles.length && <p>No local profiles are available on this browser yet.</p>}</>}
      {loading && <p role="status">Loading local planning…</p>}
      {context.activeStrongman && <p><strong>{context.activeStrongman.name}</strong> supplies dedicated Strongman days. Normal-day event prescriptions remain as entered.</p>}
      {context.profile && !context.activeStrongman && <p>{context.profile.name} has no active strongman block.</p>}
      {mode === 'strength' && connectedPreview && <details><summary>Preview upcoming connected event days</summary><p>These sessions continue the existing block. Previewing does not reserve them.</p>
        {connectedPreview.window.map(workout => <article className="strongman-inset" key={workout.id}><h3>{workout.weekLabel} · {workout.phase}</h3><ul>{workout.exercises.map(exercise => <li key={exercise.id}><strong>{exercise.generated.movement}</strong> · {exercise.generated.prescription}{exercise.assessment ? ' · Baseline assessment' : ''}</li>)}</ul></article>)}
      </details>}
    </div>
    {error && <p className="strongman-error" role="alert">{error}</p>}
    {mode === 'strongman' && (editing ? <StrongmanBuilder
      profile={context.profile}
      initialRoutine={preview}
      submitLabel="Preview strongman block"
      onSave={showPreview}
      onCancel={() => { if (preview) setEditing(false); else onCancel?.(); }}
    /> : <div className="strongman-details">
      <div className="strongman-card"><p className="eyebrow">{savedTo ? `Saved to ${savedTo}` : 'Unsaved preview'}</p><h2>{preview.name}</h2><p>{preview.inputs.weeks} event weeks · independent of your strength routine</p>
        <ul className="strongman-phase-list">{preview.inputs.phases.map(phase => <li key={phase.id}>{phase.type} · {phase.weeks} weeks</li>)}</ul>
        <div className="strongman-row"><button className="secondary-button" type="button" disabled={saving} onClick={() => setEditing(true)}>Edit preview</button>{context.profile && !savedTo && <button className="primary-button" type="button" disabled={saving} onClick={savePreview}>{saving ? 'Saving…' : `Save to ${context.profile.name}`}</button>}</div>
        {savedTo && <p>Open Plans in your installed app to activate the saved block. Your current training continues unchanged.</p>}
      </div>
      <div className="strongman-card"><h3>Next four event days</h3><table className="strongman-coverage"><thead><tr><th>Event</th><th>Planned / target</th><th>Baseline</th></tr></thead><tbody>{coverage.events.map(event => <tr key={event.eventId}><td>{event.name}</td><td>{event.planned} / {event.target}</td><td>{event.assessmentPending ? 'Assessment pending' : 'Established'}</td></tr>)}</tbody></table>
        {[...coverage.deficits.map(deficit => deficit.message), ...coverage.warnings].map((message, index) => <p key={index} role="status">{message}</p>)}
      </div>
      {preview.workouts.map(workout => <details className="strongman-card" key={workout.id} open={workout.eventWeek === 1}><summary>{workout.weekLabel} · {workout.phase}</summary><ul>{workout.exercises.map(exercise => <li key={exercise.id}><strong>{exercise.generated.movement}</strong> · {exercise.generated.prescription}{exercise.assessment ? ' · Baseline assessment' : ''}<br />{exercise.reason}</li>)}</ul>{!workout.exercises.length && <p>No available practice fits this week. Review equipment and coverage.</p>}</details>)}
    </div>)}
  </section>;
};

export default CalculatorPlanning;
