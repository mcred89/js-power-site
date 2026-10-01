import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutineForm } from './RoutineForm';
import { validateStrongmanRecord } from '../data/strongman';

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

describe('competition submission', () => {
  let div;
  let root;
  let onCreate;
  const submit = () => act(() => div.querySelector('form').dispatchEvent(new Event('submit', {
    bubbles: true, cancelable: true,
  })));

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    div = document.createElement('div');
    root = createRoot(div);
    onCreate = jest.fn();
  });

  afterEach(() => act(() => root.unmount()));

  it('retains inputs and reports a stale competition when asynchronous creation fails', async () => {
    let rejectCreation;
    onCreate.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectCreation = reject; }));
    act(() => root.render(<RoutineForm initialInputs={{ maxSquat: '315', includeStrongmanDay: true }}
      sharedCompetition={{ id: 'meet', name: 'Fall meet', events: [] }} onCreate={onCreate} />));
    submit();
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(div.querySelector('[name="maxSquat"]').closest('fieldset').disabled).toBe(true);
    expect(div.textContent).toContain('Creating plan');

    await act(async () => { rejectCreation(new Error('This profile changed in another window. Reload it before saving your changes.')); });
    expect(div.querySelector('[role="alert"]').textContent).toContain('changed in another window');
    expect(div.querySelector('[name="maxSquat"]').value).toBe('315');
    expect(div.querySelector('[name="maxSquat"]').closest('fieldset').disabled).toBe(false);
    expect(div.textContent).toContain('Fall meet');

    onCreate.mockResolvedValueOnce(undefined);
    await act(async () => { div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate.mock.calls[1][0]).toMatchObject({ maxSquat: '315', strongmanCompetition: { id: 'meet' } });
    expect(onCreate.mock.calls[1][0].creating).toBeUndefined();
    expect(div.querySelector('[role="alert"]')).toBeNull();
  });

  it('normalizes enabled targets and keeps unannounced medley details valid for backups', () => {
    const competition = { name: '  Fall meet  ', date: '', events: [
      { id: 'carry', name: '  Zercher yoke carry  ', type: 'single', weight: '600', distance: '100' },
      { id: 'medley', name: 'Carry medley', type: 'medley', components: [{ id: 'unknown', name: '' }] },
    ] };
    act(() => root.render(<RoutineForm initialInputs={{ includeStrongmanDay: true, strongmanCompetition: competition }} onCreate={onCreate} />));

    submit();

    const inputs = onCreate.mock.calls[0][0];
    expect(inputs.strongmanCompetition).toMatchObject({ name: 'Fall meet', events: [
      { name: 'Zercher yoke carry', weight: 600, distance: 100, reps: '', seconds: '' },
      { name: 'Carry medley', components: [{ name: '', weight: '', distance: '' }] },
    ] });
    expect(inputs.competitionError).toBeUndefined();
    expect(() => validateStrongmanRecord({ inputs, strongmanLog: [] })).not.toThrow();
    expect(competition.events[0].weight).toBe('600');
  });

  it('rejects whitespace-only event names inline and submits after the name is corrected', () => {
    act(() => root.render(<RoutineForm initialInputs={{ includeStrongmanDay: true,
      strongmanCompetition: { events: [{ id: 'event', name: '   ', weight: 600 }] },
    }} onCreate={onCreate} />));

    submit();

    expect(onCreate).not.toHaveBeenCalled();
    expect(div.querySelector('[role="alert"]').textContent).toContain('Name each competition event');
    act(() => {
      const name = div.querySelector('[aria-label="Event 1 name"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Yoke carry');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(div.querySelector('[role="alert"]')).toBeNull();
    submit();
    expect(onCreate.mock.calls[0][0].strongmanCompetition.events[0].name).toBe('Yoke carry');
  });

  it('submits no competition when Strongman is disabled without destroying the hidden draft', () => {
    act(() => root.render(<RoutineForm onCreate={onCreate} />));
    act(() => div.querySelector('[name="includeStrongmanDay"]').click());
    act(() => [...div.querySelectorAll('button')].find(button => button.textContent === 'Add event').click());
    expect(div.querySelector('[aria-label="Event 1 name"]').value).toBe('');
    act(() => div.querySelector('[name="includeStrongmanDay"]').click());

    submit();

    const inputs = onCreate.mock.calls[0][0];
    expect(inputs).toMatchObject({ includeStrongmanDay: false, strongmanCompetition: null });
    expect(() => validateStrongmanRecord({ inputs, strongmanLog: [] })).not.toThrow();
    act(() => div.querySelector('[name="includeStrongmanDay"]').click());
    expect(div.querySelector('[aria-label="Event 1 name"]').value).toBe('');
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(div.querySelector('[role="alert"]').textContent).toContain('Name each competition event');
  });

  it('blocks invalid nested targets before a routine is created', () => {
    act(() => root.render(<RoutineForm initialInputs={{ includeStrongmanDay: true,
      strongmanCompetition: { events: [{ id: 'medley', name: 'Carry medley', type: 'medley',
        components: [{ id: 'bag', name: 'Sandbag', reps: 1.5 }],
      }] },
    }} onCreate={onCreate} />));

    submit();

    expect(onCreate).not.toHaveBeenCalled();
    expect(div.querySelector('[role="alert"]').textContent).toContain('whole-number reps');
  });
});
