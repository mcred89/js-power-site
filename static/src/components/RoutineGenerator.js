import React, { useState } from 'react';

const percentages = {
  Low: [{ percent: .65, reps: '4 × 6' }, { percent: .7, reps: '4 × 5' }, { percent: .75, reps: '4 × 4' }, { percent: .8, reps: '4 × 3' }, { percent: .85, reps: '4 × 2' }],
  High: [{ percent: .55, reps: '5 × 10' }, { percent: .6, reps: '5 × 9' }, { percent: .65, reps: '5 × 8' }, { percent: .7, reps: '5 × 7' }, { percent: .75, reps: '5 × 6' }],
};

const days = [
  { lift: 'Squat', max: 'maxSquat', eventKey: 'squat' },
  { lift: 'Press', max: 'maxPress', eventKey: 'press' },
  { lift: 'Deadlift', max: 'maxDead', eventKey: 'deadlift' },
];

const roundToFive = value => Math.ceil(value / 5) * 5;

const backoffSets = [
  { reduction: .1, maxPercent: .6, reps: 8 },
  { reduction: .2, maxPercent: .5, reps: 12 },
  { reduction: .3, maxPercent: .4, reps: 15 },
];

const getWeekGroups = duration => duration === '3 weeks'
  ? [[0, 1], [2, 3], [4]]
  : [[0], [1], [2], [3], [4]];

export const getEffectiveMaxes = (props, cycleIndex) => ({
  maxSquat: Number(props.maxSquat) + (Number(props.squatIncrement) || 0) * cycleIndex,
  maxPress: Number(props.maxPress) + (Number(props.pressIncrement) || 0) * cycleIndex,
  maxDead: Number(props.maxDead) + (Number(props.deadliftIncrement) || 0) * cycleIndex,
});

const getSessions = (weekIndexes, includeStrongmanDay, duration) => {
  const sessions = weekIndexes.flatMap((sourceWeek, cycleIndex) => days.map(day => ({
    ...day,
    sourceWeek,
    cycleIndex,
  })));

  if (!includeStrongmanDay) {
    return sessions;
  }

  if (duration === '3 weeks') {
    const hasSecondDeadlift = weekIndexes.length > 1;
    const scheduledSessions = sessions.map(session => (
      session.cycleIndex === 1 && session.lift === 'Deadlift'
        ? { lift: 'Strongman', isStrongman: true }
        : session
    ));

    return hasSecondDeadlift
      ? scheduledSessions
      : [...scheduledSessions, { lift: 'Strongman', isStrongman: true }];
  }

  return [...sessions, { lift: 'Strongman', isStrongman: true }];
};

const getExercises = (day, props) => {
  if (day.isStrongman) {
    return [{ movement: 'Strongman day', weight: '', prescription: '' }];
  }

  const prescription = percentages[props.mainLiftChoice][day.sourceWeek];
  const exercises = [{
    movement: day.lift,
    weight: roundToFive(props[day.max] * prescription.percent),
    prescription: prescription.reps,
  }];

  if (props.mainLiftChoice === 'Low' && props.includeBackoffSets) {
    backoffSets.forEach(backoff => exercises.push({
      movement: `${day.lift} back-off`,
      weight: roundToFive(props[day.max] * Math.min(prescription.percent - backoff.reduction, backoff.maxPercent)),
      prescription: `1 × ${backoff.reps}`,
    }));
  }

  if (day.lift !== 'Squat') {
    exercises.push({ movement: 'Accessory Movement', weight: '', prescription: '3 × 5–20' });
  }

  if (day.lift === 'Press') {
    exercises.push({ movement: 'Curls', weight: '', prescription: '3 × 5–20' });
  }

  if (props[`${day.eventKey}EventEnabled`]) {
    exercises.push({
      movement: `Strongman event: ${props[`${day.eventKey}EventMovement`]}`,
      weight: '',
      prescription: `${props[`${day.eventKey}EventSets`]} × ${props[`${day.eventKey}EventReps`]}`,
    });
  }

  return exercises;
};

const TrainingDay = ({ day }) => {
  return (
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
};

export const buildRoutinePlan = props => {
  const cycles = props.mesoMode
    ? props.microCycles
    : [{ duration: props.duration, volume: props.mainLiftChoice }];

  return cycles.map((cycle, cycleIndex) => {
    const effectiveMaxes = getEffectiveMaxes(props, cycleIndex);
    const routineProps = { ...props, ...effectiveMaxes, mainLiftChoice: cycle.volume, duration: cycle.duration };
    const weeks = getWeekGroups(cycle.duration).map(weekIndexes => (
      getSessions(weekIndexes, props.includeStrongmanDay, cycle.duration).map((day, dayIndex) => ({
        name: day.lift,
        dayNumber: dayIndex + 1,
        exercises: getExercises(day, routineProps),
      }))
    ));

    return { ...cycle, effectiveMaxes, routineProps, weeks };
  });
};

const escapeCsv = value => `"${String(value).replace(/"/g, '""')}"`;

export const routineToCsv = props => {
  const rows = [['Microcycle', 'Week', 'Day', 'Session', 'Movement', 'Weight (lb)', 'Prescription']];

  buildRoutinePlan(props).forEach((cycle, cycleIndex) => {
    cycle.weeks.forEach((week, weekIndex) => {
      week.forEach(day => day.exercises.forEach(exercise => rows.push([
        cycleIndex + 1,
        weekIndex + 1,
        day.dayNumber,
        day.name,
        exercise.movement,
        exercise.weight,
        exercise.prescription,
      ])));
    });
  });

  return rows.map(row => row.map(escapeCsv).join(',')).join('\n');
};

export const routineToMarkdown = props => buildRoutinePlan(props).map((cycle, cycleIndex) => {
  const heading = props.mesoMode
    ? `## Microcycle ${cycleIndex + 1}: ${cycle.duration}, ${cycle.volume} volume\n\nMaxes: Squat ${cycle.effectiveMaxes.maxSquat} lb · Press ${cycle.effectiveMaxes.maxPress} lb · Deadlift ${cycle.effectiveMaxes.maxDead} lb`
    : `## ${cycle.duration}, ${cycle.volume} volume`;
  const weeks = cycle.weeks.map((week, weekIndex) => {
    const sessions = week.map(day => {
      const exercises = day.exercises.map(exercise => (
        `- ${exercise.movement}${exercise.weight !== '' ? `: ${exercise.weight} lb` : ''}${exercise.prescription ? ` · ${exercise.prescription}` : ''}`
      )).join('\n');
      return `#### Day ${day.dayNumber}: ${day.name}\n\n${exercises}`;
    }).join('\n\n');
    return `### Week ${weekIndex + 1}\n\n${sessions}`;
  }).join('\n\n');
  return `${heading}\n\n${weeks}`;
}).join('\n\n---\n\n');

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
  const [markdownCopied, setMarkdownCopied] = useState(false);
  const cyclePlans = buildRoutinePlan(props);
  const weekCount = cyclePlans.reduce((total, cycle) => total + cycle.weeks.length, 0);
  const sessionCount = cyclePlans.reduce((total, cycle) => (
    total + cycle.weeks.reduce((cycleTotal, week) => cycleTotal + week.length, 0)
  ), 0);
  const copyMarkdown = () => {
    navigator.clipboard.writeText(routineToMarkdown(props)).then(() => {
      setMarkdownCopied(true);
      window.setTimeout(() => setMarkdownCopied(false), 2000);
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
          <button className="secondary-button" type="button" onClick={copyMarkdown}>{markdownCopied ? 'Copied!' : 'Copy Markdown'}</button>
          <button className="secondary-button" type="button" onClick={props.onReset}>← Edit your plan</button>
        </div>
      </div>
      <div className="weeks">
        {cyclePlans.map((cycle, cycleIndex) => (
          <section className="microcycle" key={cycleIndex}>
            {props.mesoMode && (
              <div className="microcycle-heading">
                <div><p className="eyebrow">Microcycle {cycleIndex + 1}</p><h2>{cycle.duration} · {cycle.volume} volume</h2></div>
                <p>Maxes: Squat {cycle.effectiveMaxes.maxSquat} · Press {cycle.effectiveMaxes.maxPress} · Deadlift {cycle.effectiveMaxes.maxDead} lb</p>
              </div>
            )}
            {cycle.weeks.map((week, weekIndex) => {
              return (
                <section className="week-card" key={weekIndex}>
                  <div className="week-heading"><span className="week-number">{weekIndex + 1}</span><h2>Week {weekIndex + 1}</h2></div>
                  <div className={`days ${week.length > 4 ? 'six-days' : ''}`}>
                    {week.map(day => (
                      <TrainingDay day={day} key={`${day.dayNumber}-${day.name}`} />
                    ))}
                  </div>
                </section>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
};

export default Routine;
