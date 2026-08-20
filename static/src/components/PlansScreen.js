import React from 'react';

export const PlansScreen = ({ profile, routines, archived, activeId, templates, actions, RoutineNameEditor, MaxCorrection }) => (
  <section className="section-page">
    <div className="section-heading"><div><p className="eyebrow">{profile.name}</p><h1>Plans</h1></div><button className="primary-button small-primary" type="button" onClick={actions.newRoutine}>New routine</button></div>
    {!routines.length ? <p>No routines yet.</p> : routines.map(item => <article className={`plan-card ${item.id === activeId ? 'active' : ''}`} key={item.id}>
      <button className="plan-select" type="button" onClick={() => actions.select(item)}><span><strong>{item.name}</strong><small>{item.workouts.filter(day => day.completedAt).length} of {item.workouts.length} complete</small></span><span>{item.id === activeId ? 'Active' : 'Use plan'}</span></button>
      <div className="plan-actions"><div className="button-row"><RoutineNameEditor routine={item} onSave={name => actions.rename(item, name)} /><button className="text-button" type="button" onClick={() => actions.copy(item)}>Copy</button><button className="text-button" type="button" onClick={() => actions.saveTemplate(item)}>Save as template</button><button className="text-button" type="button" onClick={() => actions.archive(item)}>Archive</button></div></div>
      {item.id === activeId && <MaxCorrection routine={item} onCorrect={maxes => actions.correct(item, maxes)} />}
    </article>)}
    {archived.length > 0 && <div className="archived-plans"><div><p className="eyebrow">Not in your queue</p><h2>Archived plans</h2></div>{archived.map(item => <article className="template-card" key={item.id}><span><strong>{item.name}</strong><small>{item.workouts.filter(day => day.completedAt).length} of {item.workouts.length} complete</small></span><button className="secondary-button" type="button" onClick={() => actions.restore(item)}>Restore</button></article>)}</div>}
    <div className="template-library"><div><p className="eyebrow">Reusable setups</p><h2>Templates</h2><p>Templates regenerate a fresh routine from saved generator settings.</p></div>{!templates.length ? <p>No templates yet. Save one from a routine above.</p> : templates.map(item => <article className="template-card" key={item.id}><strong>{item.name}</strong><div className="button-row"><button className="primary-button small-primary" type="button" onClick={() => actions.useTemplate(item)}>Use template</button><RoutineNameEditor routine={item} label="Template" onSave={name => actions.renameTemplate(item, name)} /><button className="text-button danger-text" type="button" onClick={() => actions.deleteTemplate(item)}>Delete</button></div></article>)}</div>
  </section>
);

