import React, { useMemo, useState } from 'react';
import { buildRoutinePlan, routineToCsv, routineToMarkdown } from '../data/routineGeneration';

const TrainingDay = ({ day }) => (
  <div className={`day ${day.name === 'Strongman' ? 'strongman-day' : ''}`}>
    <h3>Day {day.dayNumber} · {day.name}</h3>
    <ul>
      {day.exercises.map((exercise, exerciseIndex) => (
        <li className={exercise.movement.includes('back-off') ? 'backoff-set' : ''} key={`${exercise.movement}-${exerciseIndex}`}>
          {exercise.movement}{exercise.weight !== '' && `: ${exercise.weight} lb`}{exercise.prescription && ` · ${exercise.prescription}`}
        </li>
      ))}
    </ul>
  </div>
);

const downloadRoutine = (contents, type, extension) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `strength-routine.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
};

const Routine = props => {
  const [markdownCopyStatus, setMarkdownCopyStatus] = useState('idle');
  // Copy-status changes are presentation-only; preserve the generated plan so those updates
  // do not rebuild every cycle, week, session, and exercise before React can reconcile them.
  const cyclePlans = useMemo(() => buildRoutinePlan(props), [props]);
  const weekCount = cyclePlans.reduce((total, cycle) => total + cycle.weeks.length, 0);
  const sessionCount = cyclePlans.reduce((total, cycle) => (
    total + cycle.weeks.reduce((cycleTotal, week) => cycleTotal + week.length, 0)
  ), 0);
  const copyMarkdown = () => {
    navigator.clipboard.writeText(routineToMarkdown(props)).then(() => {
      setMarkdownCopyStatus('copied');
      window.setTimeout(() => setMarkdownCopyStatus('idle'), 2000);
    }).catch(() => {
      setMarkdownCopyStatus('failed');
      window.setTimeout(() => setMarkdownCopyStatus('idle'), 2000);
    });
  };

  return (
    <div className="program-page">
      <div className="program-topbar">
        <div>
          <p className="eyebrow">Your {props.mesoMode ? `${cyclePlans.length}-cycle mesocycle` : `${props.mainLiftChoice.toLowerCase()}-volume cycle`}</p>
          <h1 className="program-title">{weekCount} weeks. {sessionCount} sessions.</h1>
        </div>
        <div className="program-actions">
          <button className="secondary-button" type="button" onClick={() => downloadRoutine(routineToCsv(props), 'text/csv;charset=utf-8', 'csv')}>Export CSV</button>
          <button className="secondary-button" type="button" onClick={copyMarkdown}>{markdownCopyStatus === 'copied' ? 'Copied!' : markdownCopyStatus === 'failed' ? 'Copy failed' : 'Copy Markdown'}</button>
          <button className="secondary-button" type="button" onClick={props.onReset}>← Edit your plan</button>
        </div>
      </div>
      <div className="weeks">
        {cyclePlans.map((cycle, cycleIndex) => (
          <section className="microcycle" key={cycleIndex}>
            {props.mesoMode && (
              <div className="microcycle-heading">
                <div><p className="eyebrow">Microcycle {cycleIndex + 1}</p><h2>{cycle.duration} · {cycle.volume} volume</h2></div>
                <p>Maxes: Squat {cycle.effectiveMaxes.maxSquat} · Press {cycle.effectiveMaxes.maxPress} · Deadlift {cycle.effectiveMaxes.maxDead} lb{props.maxProgressionMode === 'adaptive' && cycleIndex > 0 ? ' · projected' : ''}</p>
              </div>
            )}
            {cycle.weeks.map((week, weekIndex) => (
              <section className="week-card" key={weekIndex}>
                <div className="week-heading"><span className="week-number">{weekIndex + 1}</span><h2>Week {weekIndex + 1}</h2></div>
                <div className={`days ${week.length > 4 ? 'six-days' : ''}`}>
                  {week.map(day => <TrainingDay day={day} key={`${day.dayNumber}-${day.name}`} />)}
                </div>
              </section>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};

export default Routine;
