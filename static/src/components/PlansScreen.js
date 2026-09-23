import React, { useRef, useState } from 'react';
import { visibleExercise } from '../data/routines';
import { PlanUpdateEditor } from './PlanUpdateEditor';

export const isPlanComplete = routine => (
  routine.workouts.length > 0 && routine.workouts.every(workout => Boolean(workout.completedAt))
);

export const CompletedPlanDetails = ({ routine, PlanSetup }) => (
  <details className="completed-plan-details">
    <summary>View details</summary>
    <div className="completed-plan-contents">
      <PlanSetup routine={routine} />
      <div className="completed-plan-days">
        <h3>Generated workout days</h3>
        {routine.workouts.map(workout => <details className="completed-plan-day" key={workout.id}>
          <summary><span><small>{workout.cycleLabel ? `${workout.cycleLabel} · ` : ''}{workout.weekLabel}</small><strong>{workout.name}</strong></span><span>{(workout.exercises || []).length} exercises</span></summary>
          {workout.effectiveMaxes && <small className="workout-maxes">Maxes: Squat {workout.effectiveMaxes.maxSquat} · Press {workout.effectiveMaxes.maxPress} · Deadlift {workout.effectiveMaxes.maxDead} lb</small>}
          <div className="exercise-list">
            {(workout.exercises || []).map(exercise => {
              const shown = visibleExercise(exercise);
              return <div className="exercise-row" key={exercise.id}><div><strong>{shown.movement}</strong><span>{shown.prescription || 'No prescription'}</span></div>{shown.weight !== '' && <b>{shown.weight} lb</b>}</div>;
            })}
          </div>
        </details>)}
      </div>
    </div>
  </details>
);

export const PlansScreen = ({ profile, routines, selectedId, templates, actions, RoutineNameEditor, PlanSetup }) => {
  const [editingId, setEditingId] = useState(null);
  const updateButtons = useRef(new Map());
  const editingRoutine = routines.find(item => item.id === editingId);
  const closeEditor = () => {
    const buttonId = editingId;
    setEditingId(null);
    window.requestAnimationFrame(() => updateButtons.current.get(buttonId)?.focus());
  };
  if (editingRoutine) return <PlanUpdateEditor
    key={editingRoutine.id}
    routine={editingRoutine}
    onCancel={closeEditor}
    onSave={async inputs => {
      await actions.update(editingRoutine, inputs);
      closeEditor();
    }}
  />;
  const orderedRoutines = [...routines].sort((left, right) => (
    Number(right.id === selectedId) - Number(left.id === selectedId)
  ));
  return (
    <section className="section-page">
      <div className="section-heading"><div><p className="eyebrow">{profile.name}</p><h1>Plans</h1></div><button className="primary-button small-primary" type="button" onClick={actions.newRoutine}>New routine</button></div>
      {!routines.length ? <p>No plans yet.</p> : orderedRoutines.map(item => {
        const completed = isPlanComplete(item);
        return <article className={`plan-card ${item.id === selectedId ? 'selected' : ''} ${completed ? 'completed' : 'active'}`} key={item.id}>
          <button className="plan-select" type="button" onClick={() => actions.select(item)} aria-label={`View ${item.name}`} aria-pressed={item.id === selectedId}><span><strong>{item.name}</strong><small>{item.workouts.filter(day => day.completedAt).length} of {item.workouts.length} complete</small></span><span className={`plan-status ${completed ? 'completed' : 'active'}`}>{completed ? 'Completed' : item.id === selectedId ? 'Current plan' : 'Active'}</span></button>
          {!completed && <div className="plan-update-action"><button ref={button => {
            if (button) updateButtons.current.set(item.id, button);
            else updateButtons.current.delete(item.id);
          }} className="primary-button small-primary" type="button" onClick={() => setEditingId(item.id)}>Update plan</button><p className="field-help">Adjust the workouts ahead of you.</p></div>}
          <div className="plan-actions"><div className="button-row"><RoutineNameEditor routine={item} onSave={name => actions.rename(item, name)} /><button className="text-button" type="button" onClick={() => actions.copy(item)}>Copy</button><button className="text-button" type="button" onClick={() => actions.saveTemplate(item)}>Save as template</button><button className="text-button danger-text" type="button" onClick={() => actions.delete(item)}>Delete</button></div></div>
          {completed && <CompletedPlanDetails routine={item} PlanSetup={PlanSetup} />}
          {item.id === selectedId && !completed && <div className="active-plan-setup"><PlanSetup routine={item} /></div>}
        </article>;
      })}
      <div className="template-library"><div><p className="eyebrow">Reusable setups</p><h2>Templates</h2><p>Templates regenerate a fresh routine from saved generator settings.</p></div>{!templates.length ? <p>No templates yet. Save one from a routine above.</p> : templates.map(item => <article className="template-card" key={item.id}><strong>{item.name}</strong><div className="button-row"><button className="primary-button small-primary" type="button" onClick={() => actions.useTemplate(item)}>Use template</button><RoutineNameEditor routine={item} label="Template" onSave={name => actions.renameTemplate(item, name)} /><button className="text-button danger-text" type="button" onClick={() => actions.deleteTemplate(item)}>Delete</button></div></article>)}</div>
    </section>
  );
};

