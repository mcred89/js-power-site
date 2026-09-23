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
  ['squat', 'press', 'deadlift'].forEach(lift => {
    expect(div.querySelector(`[name="${lift}ProgressionMode"]`).value).toBe('');
  });

  act(() => choices.find(input => input.value === 'adaptive').click());

  expect(div.querySelector('[name="squatIncrement"]')).toBeNull();
  expect(div.textContent).toContain('Later cycles begin as projections');
  expect(div.textContent).toContain('Adaptive progression never lowers a max.');
  act(() => root.unmount());
});

it('creates a plan with adaptive squat and press and a 25 lb deadlift increase per microcycle', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onCreate = jest.fn();

  act(() => root.render(<RoutineForm initialInputs={{ mesoMode: true }} onCreate={onCreate} />));
  act(() => div.querySelector('[name="maxProgressionMode"][value="adaptive"]').click());
  const deadliftMode = div.querySelector('[name="deadliftProgressionMode"]');
  act(() => {
    deadliftMode.value = 'fixed';
    deadliftMode.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const deadliftIncrement = div.querySelector('[name="deadliftIncrement"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(deadliftIncrement, '25');
    deadliftIncrement.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(div.querySelector('[name="squatIncrement"]')).toBeNull();
  expect(div.querySelector('[name="pressIncrement"]')).toBeNull();
  expect(deadliftIncrement.value).toBe('25');
  expect(div.textContent).toContain('Deadlift increase (lb per microcycle)');
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
    maxProgressionMode: 'adaptive',
    liftProgressionModes: { deadlift: 'fixed' },
    deadliftIncrement: '25',
  }));
  act(() => root.unmount());
});

it('keeps individual strategies when the shared setting changes and can restore inheritance', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onCreate = jest.fn();
  const initialInputs = {
    mesoMode: true,
    maxProgressionMode: 'adaptive',
    liftProgressionModes: { deadlift: 'fixed' },
    deadliftIncrement: '25',
  };

  act(() => root.render(<RoutineForm initialInputs={initialInputs} onCreate={onCreate} />));
  act(() => div.querySelector('[name="maxProgressionMode"][value="same"]').click());
  expect(div.querySelector('[name="deadliftProgressionMode"]').value).toBe('fixed');
  expect(div.querySelector('[name="deadliftIncrement"]').value).toBe('25');
  expect(div.querySelector('[name="squatIncrement"]')).toBeNull();

  act(() => {
    const deadliftMode = div.querySelector('[name="deadliftProgressionMode"]');
    deadliftMode.value = '';
    deadliftMode.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(div.querySelector('[name="deadliftIncrement"]')).toBeNull();
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
    maxProgressionMode: 'same',
    liftProgressionModes: {},
    deadliftIncrement: '25',
  }));
  expect(initialInputs.liftProgressionModes).toEqual({ deadlift: 'fixed' });
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
