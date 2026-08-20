import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ProgressDashboard } from './ProgressDashboard';

const trackedRoutine = {
  id: 'routine-1',
  name: 'First plan',
  workouts: [{
    id: 'workout-1',
    completedAt: '2026-08-17T12:00:00.000Z',
    session: {
      status: 'completed',
      elapsedSeconds: 600,
      primaryExerciseId: 'squat',
      exercises: [{
        exerciseId: 'squat',
        movement: 'Squat',
        sets: [{ id: 'set-1', status: 'completed', actualWeight: 300, actualReps: 5, splitSeconds: 60 }],
      }],
    },
  }],
};

it('renders profile progress and switches main lifts', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<ProgressDashboard profile={{ name: 'Alex' }} routines={[trackedRoutine]} now={new Date('2026-08-18T12:00:00.000Z')} />));

  expect(div.textContent).toContain('Alex');
  expect(div.querySelector('.strength-progress h2').textContent).toBe('Estimated max');
  expect(div.querySelector('.pr-summary small').textContent).toBe('Lifetime estimated max');
  expect(div.querySelector('.chart-point text').textContent).toBe('350 lb');
  expect(div.textContent).toContain('1,500 lb');
  const deadlift = Array.from(div.querySelectorAll('.lift-tabs button')).find(button => button.textContent === 'Deadlift');
  act(() => deadlift.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(div.textContent).toContain('No tracked deadlift sets in this range.');
  act(() => root.unmount());
});

it('caps chart point groups and mounts complete table rows only while expanded', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routines = [{
    ...trackedRoutine,
    workouts: Array.from({ length: 200 }, (_, index) => ({
      ...trackedRoutine.workouts[0],
      id: `workout-${index}`,
      completedAt: new Date(2026, 0, index + 1).toISOString(),
      session: {
        ...trackedRoutine.workouts[0].session,
        exercises: [{
          ...trackedRoutine.workouts[0].session.exercises[0],
          sets: [{ ...trackedRoutine.workouts[0].session.exercises[0].sets[0], actualWeight: 200 + index }],
        }],
      },
    })),
  }];
  act(() => root.render(<ProgressDashboard profile={{ name: 'Alex' }} routines={routines} now={new Date('2027-01-01T12:00:00.000Z')} />));
  const range = div.querySelector('.progress-filters select');
  act(() => {
    range.value = 'all';
    range.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(div.querySelectorAll('.chart-point')).toHaveLength(120);
  expect(div.querySelector('.line-chart').getAttribute('aria-label')).toContain('200 workouts');
  expect(div.querySelectorAll('.chart-data tbody tr')).toHaveLength(0);
  const details = div.querySelector('.chart-data');
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  expect(div.querySelectorAll('.chart-data tbody tr')).toHaveLength(200);
  act(() => root.unmount());
});
