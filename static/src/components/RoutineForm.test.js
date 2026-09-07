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

it('lets every lifting day combine Tabata sprints and Strongman events independently', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onCreate = jest.fn();

  act(() => root.render(<RoutineForm onCreate={onCreate} />));

  ['squat', 'press', 'deadlift'].forEach(lift => {
    const tabata = div.querySelector(`[name="${lift}TabataEnabled"]`);
    const strongman = div.querySelector(`[name="${lift}EventEnabled"]`);
    expect(tabata.checked).toBe(false);
    act(() => tabata.click());
    act(() => strongman.click());
    expect(tabata.checked).toBe(true);
    expect(strongman.checked).toBe(true);
  });

  act(() => div.querySelector('[name="squatEventEnabled"]').click());
  expect(div.querySelector('[name="squatTabataEnabled"]').checked).toBe(true);
  act(() => div.querySelector('[name="pressTabataEnabled"]').click());
  expect(div.querySelector('[name="pressEventEnabled"]').checked).toBe(true);
  expect(div.querySelector('[name="deadliftTabataEnabled"]').checked).toBe(true);
  expect(div.textContent).toContain('8 rounds of 20 seconds sprint / 10 seconds rest, after accessories and Strongman work.');

  act(() => div.querySelector('form').dispatchEvent(new Event('submit', {
    bubbles: true,
    cancelable: true,
  })));

  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
    squatEventEnabled: false,
    squatTabataEnabled: true,
    pressEventEnabled: true,
    pressTabataEnabled: false,
    deadliftEventEnabled: true,
    deadliftTabataEnabled: true,
  }));
  act(() => root.unmount());
});
