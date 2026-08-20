import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutineForm } from './RoutineForm';

it('offers same, fixed, and adaptive mesocycle max progression', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);

  act(() => root.render(<RoutineForm initialInputs={{ mesoMode: true }} onCreate={() => {}} />));

  const choices = [...div.querySelectorAll('[name="maxProgressionMode"]')];
  expect(choices.map(input => input.value)).toEqual(['same', 'fixed', 'adaptive']);
  expect(div.querySelector('[name="maxProgressionMode"]:checked').value).toBe('fixed');
  expect(div.querySelector('[name="squatIncrement"]')).not.toBeNull();

  act(() => choices.find(input => input.value === 'adaptive').click());

  expect(div.querySelector('[name="squatIncrement"]')).toBeNull();
  expect(div.textContent).toContain('Later cycles begin as projections');
  act(() => root.unmount());
});
