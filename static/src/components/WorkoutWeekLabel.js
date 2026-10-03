import React, { useEffect, useState } from 'react';
import { formatCalendarDate, localDateKey, workoutWeekText } from '../data/planCalendar';

// Refresh an installed app across midnight and after returning from the background.
export const useCalendarDay = () => {
  const [day, setDay] = useState(() => localDateKey(new Date()));
  useEffect(() => {
    let timer;
    const refresh = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setDay(localDateKey(now));
      const tomorrow = new Date(now);
      tomorrow.setHours(24, 0, 0, 0);
      timer = window.setTimeout(refresh, tomorrow.getTime() - now.getTime());
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return day;
};

export const WorkoutWeekLabel = ({ workout, calendarWeek }) => (
  <span className="workout-week-label">
    <span>{workoutWeekText(!workout.completedAt && calendarWeek?.weekLabel ? calendarWeek : workout)}</span>
    {!workout.completedAt && calendarWeek?.start && <span className="calendar-week-date">
      <span aria-hidden="true"> · </span>Week of <time dateTime={localDateKey(calendarWeek.start)}>{formatCalendarDate(calendarWeek.start)}</time>
    </span>}
  </span>
);
