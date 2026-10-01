import React from 'react';
import { formatCalendarDate, localDateKey, workoutWeekText } from '../data/planCalendar';

const CalendarDate = ({ value }) => value
  ? <time dateTime={localDateKey(value)}>{formatCalendarDate(value)}</time>
  : <span>Not recorded</span>;

export const PlanCalendar = ({ calendar }) => {
  if (!calendar) return null;
  return <div className="plan-calendar">
    <dl className="plan-calendar-range">
      <div><dt>{calendar.started || calendar.completed ? 'Started' : 'Est. start'}</dt><dd><CalendarDate value={calendar.start} /></dd></div>
      <div><dt>{calendar.completed ? 'Finished' : 'Est. end'}</dt><dd><CalendarDate value={calendar.end} /></dd></div>
    </dl>
    {!calendar.completed && <>
      <p className="calendar-outlook">{calendar.remainingWeeks} {calendar.remainingWeeks === 1 ? 'week' : 'weeks'} remaining · Final week of <CalendarDate value={calendar.finalWeek} /></p>
      <details className="plan-calendar-details">
        <summary>Week-by-week dates</summary>
        <p className="field-help">Estimates assume one plan week per calendar week, Monday–Sunday, and shift with your progress. The next week starts after this one, unless you start it early. No workout days are assigned.</p>
        <ol className="plan-calendar-weeks">
          {calendar.weeks.map(week => <li key={week.key}>
            <span>{workoutWeekText(week)}</span>
            <span>{week.empty ? 'No workouts' : week.completed ? 'Completed' : <>Week of <CalendarDate value={week.start} /></>}</span>
          </li>)}
        </ol>
      </details>
    </>}
  </div>;
};
