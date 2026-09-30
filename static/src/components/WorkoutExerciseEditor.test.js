import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkoutExerciseEditor from './WorkoutExerciseEditor';

it('edits actual visible overrides on blur and lets the user restore the generated prescription', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  const onChange = jest.fn();
  const workout = { id: 'day', exercises: [{ id: 'squat', generated: {
    movement: 'Squat', weight: 300, prescription: '4 × 6',
  }, overrides: { weight: '315' } }] };
  act(() => root.render(<WorkoutExerciseEditor workout={workout} onChange={onChange} />));
  const weight = container.querySelector('[aria-label="Weight"]');
  expect(weight.value).toBe('315');
  expect(container.querySelector('[aria-label="Movement"]').value).toBe('Squat');
  expect(container.querySelector('[aria-label="Prescription"]').value).toBe('4 × 6');
  act(() => {
    weight.value = '320';
    weight.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  const routine = { id: 'plan', workouts: [workout] };
  expect(onChange).toHaveBeenLastCalledWith(expect.any(Function));
  const edited = onChange.mock.calls[0][0](routine);
  expect(edited.workouts[0].exercises[0].overrides).toEqual({ weight: '320' });
  act(() => container.querySelector('button').click());
  expect(onChange).toHaveBeenLastCalledWith(expect.any(Function));
  const restored = onChange.mock.calls[1][0](edited);
  expect(restored.workouts[0].exercises[0].overrides).toEqual({});
  expect(restored.workouts[0].exercises[0].generated).toEqual(workout.exercises[0].generated);
  expect(workout.exercises[0].overrides.weight).toBe('315');
  act(() => root.unmount());
});
