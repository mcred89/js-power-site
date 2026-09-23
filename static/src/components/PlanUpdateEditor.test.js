import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutine, setWorkoutComplete, startWorkoutSession } from '../data/routines';
import { PlanUpdateEditor } from './PlanUpdateEditor';

const inputs = {
  maxSquat: '315',
  maxPress: '185',
  maxDead: '405',
  mainLiftChoice: 'Low',
  duration: '5 weeks',
  squatTabataEnabled: true,
  pressTabataEnabled: true,
  deadliftTabataEnabled: true,
};

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = label => [...container.querySelectorAll('button')].find(item => item.textContent === label);
const click = element => act(() => element.click());
const review = () => act(() => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const fill = (name, value) => {
  const element = container.querySelector(`[name="${name}"]`);
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

it('reviews removing deadlift Tabata while preserving past and started workouts', async () => {
  let routine = createRoutine('profile', 'My plan', inputs);
  routine = setWorkoutComplete(routine, routine.workouts[0].id, true);
  routine = startWorkoutSession(routine, routine.workouts[1].id);
  const original = JSON.parse(JSON.stringify(routine));
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));

  expect(document.activeElement.textContent).toBe('Update plan');
  expect(container.querySelector('[name="squatTabataEnabled"]').checked).toBe(true);
  expect(container.querySelector('[name="pressTabataEnabled"]').checked).toBe(true);
  expect(container.querySelector('[name="deadliftTabataEnabled"]').checked).toBe(true);
  expect(button('Review changes').disabled).toBe(true);
  click(container.querySelector('[name="deadliftTabataEnabled"]'));
  review();

  expect(document.activeElement.textContent).toBe('Review changes');
  expect(container.textContent).toContain('5 future workouts will change');
  expect(container.textContent).toContain('1 completed · 1 already started');
  expect(container.querySelector('dl').textContent).toBe('Deadlift day TabataFromOnToOff');
  expect(onSave).not.toHaveBeenCalled();
  expect(routine).toEqual(original);

  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    squatTabataEnabled: true,
    pressTabataEnabled: true,
    deadliftTabataEnabled: false,
  }));
});

it('keeps the draft when going back and never saves when cancelling either step', () => {
  const onSave = jest.fn();
  const onCancel = jest.fn();
  act(() => root.render(<PlanUpdateEditor routine={createRoutine('profile', 'Plan', inputs)} onSave={onSave} onCancel={onCancel} />));
  click(container.querySelector('[name="deadliftTabataEnabled"]'));
  review();
  click(button('Back to editing'));
  expect(container.querySelector('[name="deadliftTabataEnabled"]').checked).toBe(false);
  click(button('Cancel'));
  expect(onCancel).toHaveBeenCalledTimes(1);
  review();
  click(button('Cancel'));
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps a failed update reviewable and allows retry without duplicate saves', async () => {
  let rejectSave;
  const onSave = jest.fn()
    .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSave = reject; }))
    .mockResolvedValueOnce(undefined);
  const onCancel = jest.fn();
  act(() => root.render(<PlanUpdateEditor routine={createRoutine('profile', 'Plan', inputs)} onSave={onSave} onCancel={onCancel} />));
  click(container.querySelector('[name="deadliftTabataEnabled"]'));
  review();
  click(button('Save update'));
  expect(button('Saving…').disabled).toBe(true);
  expect(button('Back to editing').disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  click(button('Saving…'));
  click(button('Cancel'));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();

  await act(async () => rejectSave(new Error('Storage is unavailable. Try again.')));
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is unavailable. Try again.');
  expect(container.querySelector('h1').textContent).toBe('Review changes');
  expect(button('Save update').disabled).toBe(false);
  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
});

it('seeds older optional controls without inventing progression or pending changes', () => {
  const routine = createRoutine('profile', 'Older plan', {
    maxSquat: 315,
    maxPress: 185,
    maxDead: 405,
    mesoMode: true,
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' }],
  });
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={() => {}} onCancel={() => {}} />));
  expect(container.querySelector('[name="maxProgressionMode"]').value).toBe('fixed');
  expect(container.querySelector('[name="squatIncrement"]').value).toBe('0');
  expect(container.querySelector('[name="includeBackoffSets"]').checked).toBe(false);
  expect(container.querySelector('[name="deadliftEventEnabled"]').checked).toBe(false);
  expect(container.querySelector('[name="deadliftTabataEnabled"]').checked).toBe(false);
  expect(container.querySelector('[name="pressWeakPoint"]').value).toBe('');
  expect(container.querySelector('[name="pressWeakPoint"] option:checked').textContent).toBe('None');
  expect(button('Review changes').disabled).toBe(true);
  expect(container.querySelector('[name="duration"]')).toBeNull();
  expect(container.querySelector('[name="includeStrongmanDay"]')).toBeNull();
});

it('reviews weight, progression, event, cycle volume, and accessory changes together', async () => {
  const routine = createRoutine('profile', 'Mesocycle', {
    ...inputs,
    mesoMode: true,
    maxProgressionMode: 'same',
    squatIncrement: 10,
    pressIncrement: 5,
    deadliftIncrement: 10,
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' }],
    deadliftEventEnabled: true,
    deadliftEventMovement: 'Sandbag carry',
    deadliftEventSets: 3,
    deadliftEventReps: 5,
    pressWeakPoint: 'Shoulders',
  });
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));
  expect(container.querySelector('[name="deadliftEventEnabled"]').checked).toBe(true);
  expect(container.querySelector('[name="deadliftEventMovement"]').value).toBe('Sandbag carry');
  fill('maxDead', '450');
  fill('maxProgressionMode', 'fixed');
  fill('deadliftIncrement', '20');
  fill('deadliftEventMovement', 'Farmer carry');
  fill('deadliftEventSets', '4');
  fill('pressWeakPoint', '');
  fill('volume', 'High');
  click(container.querySelector('[name="includeBackoffSets"]'));
  review();
  const text = container.querySelector('dl').textContent;
  expect(text).toContain('Deadlift starting maxFrom405 lbTo450 lb');
  expect(text).toContain('Max progressionFromKeep maxes the sameToIncrease by set amounts');
  expect(text).toContain('Deadlift increase per cycleFromNot usedTo20 lb');
  expect(text).toContain('Deadlift day StrongmanFromSandbag carry · 3 × 5ToFarmer carry · 4 × 5');
  expect(text).toContain('Cycle 1 volumeFromLowToHigh');
  expect(text).toContain('Press accessoryFromShoulders — Dumbbell overhead pressToNone');
  expect(text).toContain('Low-volume back-off setsFromOffToOn');
  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    maxDead: '450',
    deadliftIncrement: '20',
    deadliftEventMovement: 'Farmer carry',
    deadliftEventSets: '4',
    pressWeakPoint: '',
    microCycles: [{ duration: '3 weeks', volume: 'High' }, { duration: '5 weeks', volume: 'High' }],
  }));
});
