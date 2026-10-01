import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useCalendarDay, WorkoutWeekLabel } from './WorkoutWeekLabel';

let root;
let container;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  jest.useRealTimers();
});

it('pairs the cycle and week with a local calendar date, keeping history free of forecasts', () => {
  const workout = { cycleLabel: 'Cycle 3', weekLabel: 'Week 2' };
  const calendarWeek = { start: new Date(2026, 9, 5) };
  act(() => root.render(<WorkoutWeekLabel workout={workout} calendarWeek={calendarWeek} />));
  expect(container.textContent).toBe('Cycle 3 · Week 2 · Week of 10/05/26');
  expect(container.querySelector('time').dateTime).toBe('2026-10-05');
  act(() => root.render(<WorkoutWeekLabel workout={{ ...workout, completedAt: '2026-10-06' }} calendarWeek={calendarWeek} />));
  expect(container.textContent).toBe('Cycle 3 · Week 2');
});

it('refreshes the calendar after local midnight and after resuming an idle app', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 4, 23, 59, 59));
  const Day = () => <span>{useCalendarDay()}</span>;
  act(() => root.render(<Day />));
  expect(container.textContent).toBe('2026-10-04');
  act(() => jest.advanceTimersByTime(1000));
  expect(container.textContent).toBe('2026-10-05');
  jest.setSystemTime(new Date(2026, 9, 12, 12));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.textContent).toBe('2026-10-12');
});
