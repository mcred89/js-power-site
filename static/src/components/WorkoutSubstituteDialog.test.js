import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkoutSubstituteDialog from './WorkoutSubstituteDialog';

it('uses remaining work for a substitute and submits without rewriting performed sets', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onConfirm = jest.fn();
  const exercise = { movement: 'Squat', sets: [
    { status: 'completed', actualWeight: 300, actualReps: 6 },
    { status: 'skipped', actualWeight: 300, actualReps: 6 },
    { status: 'pending', actualWeight: 250, actualReps: 5 },
    { status: 'pending', actualWeight: 250, actualReps: 5 },
  ] };
  act(() => root.render(<WorkoutSubstituteDialog exercise={exercise} onCancel={() => {}} onConfirm={onConfirm} />));
  expect(div.querySelector('[role="dialog"]').textContent).toContain('Substitute Squat');
  expect([...div.querySelectorAll('input')].map(input => input.value)).toEqual(['Squat', '250', '2', '5']);
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onConfirm).toHaveBeenCalledWith({ movement: 'Squat', weight: 250, setCount: '2', reps: '5' });
  expect(exercise.sets[0]).toEqual({ status: 'completed', actualWeight: 300, actualReps: 6 });
  act(() => root.unmount());
});
