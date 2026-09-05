import React, { useState } from 'react';
import { strongmanCoverage, capabilityProgress } from '../data/strongman';
import { visibleExercise } from '../data/routines';
import { recipeForPractice } from '../data/strongmanPrescription';
import { snapshotPracticeCapabilities } from '../data/strongmanEvidence';
import { Field, PrescriptionFields, recipeDescription } from './StrongmanFields';
import './Strongman.css';

const RecipeEditor = ({ event, practice, onRecipe, scope }) => {
  const accepted = recipeForPractice(practice, scope);
  const [recipe, setRecipe] = useState(accepted || {});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  return <details className="strongman-inset"><summary>{practice.name} — {scope === 'taper' ? 'Taper / recovery' : 'Base / development / specific'}: {recipeDescription(accepted)}</summary>
    <PrescriptionFields prefix={`${practice.name}${scope === 'taper' ? ' taper' : ''} next`} value={recipe} setupFallback={practice.setup} capabilities={event.capabilities} onChange={setRecipe} />
    <p className="strongman-help">Only accept work you want to repeat. Changing a prescription leaves started and completed sessions intact.</p>
    {saveError && <p role="alert">{saveError}</p>}
    <button className="secondary-button" type="button" disabled={saving} onClick={async () => { setSaveError(''); setSaving(true); try { await onRecipe(event.id, practice.id, recipe, scope); } catch (error) { setSaveError(error.message || 'The prescription could not be saved.'); } finally { setSaving(false); } }}>Accept future prescription</button>
  </details>;
};

const CoverageEditor = ({ event, routines, onCoverage, currentWeek, totalWeeks }) => {
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState('support');
  const [capabilityIds, setCapabilityIds] = useState([]);
  const [wholeEvent, setWholeEvent] = useState(false);
  const [eventWeek, setEventWeek] = useState(currentWeek || 1);
  const [conditions, setConditions] = useState('');
  const choices = routines.filter(routine => routine.kind !== 'strongman').flatMap(routine => routine.workouts.flatMap(workout => (workout.exercises || []).filter(exercise => !exercise.strongmanHost).map(exercise => {
    const sourcePrescription = visibleExercise(exercise);
    const sourceMovement = sourcePrescription.movement;
    return { routineId: routine.id, exerciseId: exercise.id, sourceMovement, sourcePrescription, label: `${routine.name} · ${workout.weekLabel || ''} ${workout.name} · ${sourceMovement}` };
  })));
  const add = () => {
    const choice = choices.find(item => `${item.routineId}:${item.exerciseId}` === selected);
    if (!choice || !Number.isInteger(eventWeek) || eventWeek < 1 || eventWeek > totalWeeks) return;
    const next = { routineId: choice.routineId, exerciseId: choice.exerciseId, sourceMovement: choice.sourceMovement, sourcePrescription: choice.sourcePrescription, scope, capabilityIds, eventWeek, wholeEvent: scope === 'exact' && wholeEvent,
      capabilitySnapshot: snapshotPracticeCapabilities(event, { id: choice.exerciseId, capabilityIds, focus: '' }, null),
      ...(scope === 'exact' && conditions.trim() ? { sourceConditions: { setup: conditions.trim() } } : {}),
    };
    onCoverage(event.id, [...(event.coverage || []).filter(link => link.routineId !== next.routineId || link.exerciseId !== next.exerciseId), next]);
    setSelected('');
    setConditions('');
  };
  return <details className="strongman-inset"><summary>Coverage on normal lifting days</summary>
    <p className="strongman-help">Your normal-day event prescriptions stay unchanged. Link the exact exercise and what it covers; a clean does not cover pressing.</p>
    {(event.coverage || []).map((link, index) => <div className="strongman-inset" key={`${link.routineId}:${link.exerciseId}`}><p>{choices.find(choice => choice.routineId === link.routineId && choice.exerciseId === link.exerciseId)?.label || 'Source unavailable — review this link'}<br /><strong>{link.scope === 'exact' ? 'Matching event practice' : 'Supporting strength'}</strong>{link.eventWeek ? ` · Event week ${link.eventWeek}` : ' · Event week needs review'}{link.wholeEvent ? ' · Whole event' : ''}{link.capabilityIds?.length ? ` · ${(event.capabilities || []).filter(capability => link.capabilityIds.includes(capability.id)).map(capability => capability.name).join(', ')}` : ''}</p><button className="text-button" type="button" onClick={() => onCoverage(event.id, event.coverage.filter((item, other) => other !== index))}>Remove coverage link</button></div>)}
    <Field label="Normal-day exercise" ariaLabel={`${event.name} coverage exercise`} value={selected} onChange={setSelected}><option value="">Choose an exercise</option>{choices.map(choice => <option value={`${choice.routineId}:${choice.exerciseId}`} key={`${choice.routineId}:${choice.exerciseId}`}>{choice.label}</option>)}</Field>
    <Field label="Event week covered" ariaLabel={`${event.name} coverage event week`} type="number" min="1" max={totalWeeks} value={eventWeek} onChange={setEventWeek} />
    <p className="strongman-help">This exercise occurrence counts only toward the event week you choose. Its coverage will not move when you switch strength routines.</p>
    <Field label="How it contributes" ariaLabel={`${event.name} coverage scope`} value={scope} onChange={setScope}><option value="support">Supporting strength / practice</option><option value="exact">Matching event practice and conditions</option></Field>
    {scope === 'exact' && <><Field label="Actual normal-day conditions" ariaLabel={`${event.name} coverage conditions`} value={conditions} onChange={setConditions} /><p className="strongman-help">Enter the setup actually used for this exercise. Normal-day results record pounds and total load; distance and time are not inferred.</p></>}
    {(event.capabilities || []).map(capability => <label className="strongman-row strongman-inset" key={capability.id}><input type="checkbox" checked={capabilityIds.includes(capability.id)} onChange={change => setCapabilityIds(change.target.checked ? [...capabilityIds, capability.id] : capabilityIds.filter(id => id !== capability.id))} />{capability.name}</label>)}
    {scope === 'exact' && <label className="strongman-row strongman-inset"><input type="checkbox" checked={wholeEvent} onChange={change => setWholeEvent(change.target.checked)} />This covers the complete event under matching conditions</label>}
    <button className="secondary-button" type="button" disabled={!selected || !Number.isInteger(eventWeek) || eventWeek < 1 || eventWeek > totalWeeks} onClick={add}>Link coverage</button>
  </details>;
};

const StrongmanPlanDetails = ({ routine, onEdit, onStatus, onRecipe, onCapability, onLock, onSkip, onOpen, routines = [], onCoverage }) => {
  const coverage = strongmanCoverage(routine);
  const progress = capabilityProgress ? capabilityProgress(routine) : [];
  const competitionDays = routine.inputs.competitionDate ? Math.ceil((new Date(`${routine.inputs.competitionDate}T12:00:00`).getTime() - Date.now()) / 86400000) : null;
  const completed = routine.workouts.filter(workout => workout.completedAt).length;
  return <section className="strongman-details">
    <div className="strongman-card"><p className="eyebrow">Independent strongman block</p><h2>{routine.name}</h2><p>{completed} completed · {coverage.remainingWeeks} event weeks remaining · {routine.status || 'active'}</p>
      {competitionDays != null && <p>{competitionDays < 0 ? 'The competition date has passed. Review the date or finish this block.' : `Competition in ${competitionDays} days`}</p>}
      {competitionDays != null && competitionDays >= 0 && coverage.remainingWeeks * 7 > competitionDays + 7 && <p role="status">Your remaining event weeks extend beyond the competition date. Edit the phases or remove future work; sessions will not be compressed automatically.</p>}
      <ul className="strongman-phase-list">{routine.inputs.phases.map(phase => <li key={phase.id}>{phase.type} · {phase.weeks} weeks</li>)}</ul>
      <div className="strongman-row"><button className="secondary-button" type="button" onClick={onEdit}>Edit block</button><button className="text-button" type="button" onClick={() => onStatus(routine.status === 'active' ? 'paused' : 'active')}>{routine.status === 'active' ? 'Pause block' : 'Activate block'}</button>{routine.status !== 'complete' && <button className="text-button" type="button" onClick={() => onStatus('complete')}>End block</button>}</div>
      <p className="strongman-help">Strongman work on normal lifting days stays under your control. This block continues when your strength routine ends.</p>
    </div>
    <div className="strongman-card"><h2>Next four event days</h2><p>Priority practice, early baselines, and rotating coverage. The generated plan uses at most four blocks per day.</p>
      <table className="strongman-coverage"><thead><tr><th>Event</th><th>Planned / target</th><th>Baseline</th></tr></thead><tbody>{coverage.events.map(event => <tr key={event.eventId}><td>{event.name}</td><td>{event.planned} / {event.target}{event.normalDayPlanned > 0 && <small><br />+ {event.normalDayPlanned} normal-day coverage</small>}</td><td>{event.assessmentPending ? 'Assessment pending' : 'Established'}</td></tr>)}</tbody></table>
      {coverage.events.filter(event => event.practices?.length > 1).map(event => <details key={event.eventId} className="strongman-inset"><summary>{event.name}: component and rehearsal coverage</summary><ul className="strongman-attempts">{event.practices.map(practice => <li key={practice.practiceId}><strong>{practice.name}</strong> · {practice.planned} upcoming · {practice.completed} practiced{practice.rehearsal ? ` · ${practice.rehearsalsCompleted || 0} complete rehearsals` : ''}</li>)}</ul></details>)}
      {(coverage.deficits.length > 0 || coverage.warnings.length > 0) && <div className="strongman-error" role="status"><strong>Review coverage</strong><ul>{coverage.deficits.map(deficit => <li key={deficit.eventId}>{deficit.message}</li>)}{coverage.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    </div>
    <details className="strongman-card"><summary>Goals, prescriptions, and normal-day coverage</summary>
      {routine.inputs.events.map(event => <article className="strongman-inset" key={event.id}><h3>{event.name}</h3><p>{event.focus || 'Build repeatable event performance'}{event.target ? ` · Target: ${recipeDescription(event.target)}` : ''}</p>
        {(event.capabilities || []).map(capability => {
          const checkpoint = progress.find(item => item.eventId === event.id && item.capabilityId === capability.id);
          return <div className="strongman-inset" key={capability.id}><strong>{capability.name}</strong><p>{recipeDescription(capability.criterion)}{capability.criterion?.setup ? ` · ${capability.criterion.setup}` : ''}</p><span className="strongman-badge">{capability.status}</span>{checkpoint?.matched && capability.status !== 'confirmed' && <p>Recorded results match this checkpoint. Review the conditions before confirming.</p>}<div className="strongman-row">{capability.status !== 'confirmed' ? <button className="text-button" type="button" onClick={() => onCapability(event.id, capability.id, 'confirmed')}>Confirm {capability.name}</button> : <button className="text-button" type="button" onClick={() => onCapability(event.id, capability.id, 'working')}>Mark {capability.name} working on</button>}</div></div>;
        })}
        {event.practices.flatMap(practice => ['normal', 'taper'].map(scope => <RecipeEditor key={`${practice.id}:${scope}:${JSON.stringify(recipeForPractice(practice, scope))}`} event={event} practice={practice} scope={scope} onRecipe={onRecipe} />))}
        {onCoverage && <CoverageEditor event={event} routines={routines} onCoverage={onCoverage} currentWeek={coverage.currentWeek} totalWeeks={routine.inputs.weeks} />}
      </article>)}
    </details>
    <div className="strongman-card"><h2>Event weeks</h2>
      {routine.workouts.map(workout => <details className="strongman-inset" key={workout.id} open={coverage.window[0]?.id === workout.id}>
        <summary>{workout.weekLabel || `Week ${workout.eventWeek}`} · {workout.phase} {workout.completedAt ? '· Complete' : workout.skippedAt ? '· Skipped' : workout.session?.status === 'paused' ? '· Paused session' : workout.session ? '· In progress' : workout.locked ? '· Locked' : ''}</summary>
        <ul className="strongman-attempts">{workout.exercises.map(exercise => <li key={exercise.id}><strong>{exercise.generated?.movement}</strong> · {exercise.generated?.prescription || 'Set up today'}{exercise.assessment ? ' · Baseline assessment' : ''}<br />{exercise.reason}</li>)}</ul>
        <div className="strongman-row"><button className="secondary-button" type="button" onClick={() => onOpen(workout)}>{workout.completedAt ? 'View event history' : workout.session ? 'Resume event day' : 'Open event day'}</button>{!workout.completedAt && !workout.skippedAt && !workout.session && <><button className="text-button" type="button" onClick={() => onLock(workout.id, !workout.locked)}>{workout.locked ? 'Unlock session' : 'Lock session'}</button><button className="text-button" type="button" onClick={() => onSkip(workout.id)}>Skip event week</button></>}</div>
      </details>)}
    </div>
  </section>;
};

export default StrongmanPlanDetails;
