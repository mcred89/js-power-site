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
  jest.useRealTimers();
  container.remove();
});

const button = label => [...container.querySelectorAll('button')].find(item => item.textContent === label);
const click = element => act(() => element.click());
const review = () => act(() => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const fill = (name, value, cycleIndex) => {
  const element = container.querySelector(`[name="${name}"]${cycleIndex === undefined ? '' : `[data-cycle-index="${cycleIndex}"]`}`);
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

it.each([
  [0, false, 'Before11/01/265 weeks remainingAfter10/18/263 weeks remaining', false],
  [3, false, 'Before10/11/262 weeks remainingAfter10/04/261 week remaining', false],
  [4, false, 'Before10/04/261 week remainingAfter10/04/261 week remaining', true],
  [3, true, 'Before10/11/262 weeks remainingAfter10/11/262 weeks remaining', true],
])('previews the actual estimated end after %i completed weeks (next week started: %s)', (completedWeeks, started, dates, unchanged) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 3, 12));
  const routine = createRoutine('profile', 'My plan', { ...inputs, includeStrongmanDay: true });
  routine.workouts.forEach(workout => {
    if (workout.sourceWeek < completedWeeks) workout.completedAt = '2026-09-25T12:00:00';
  });
  if (started) routine.workouts.find(workout => workout.sourceWeek === completedWeeks).session = {
    status: 'inProgress', startedAt: '2026-10-01T12:00:00',
  };
  const snapshot = JSON.stringify(routine);
  const onSave = jest.fn();
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));
  fill('duration', '3 weeks');
  review();
  expect(container.querySelector('.plan-update-dates dl').textContent).toBe(dates);
  expect(Boolean(container.querySelector('.plan-update-dates .field-help'))).toBe(unchanged);
  expect(JSON.stringify(routine)).toBe(snapshot);
  expect(onSave).not.toHaveBeenCalled();
});

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
  fill('duration', '3 weeks');
  review();
  click(button('Back to editing'));
  expect(container.querySelector('[name="deadliftTabataEnabled"]').checked).toBe(false);
  expect(container.querySelector('[name="duration"]').value).toBe('3 weeks');
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
  const durations = [...container.querySelectorAll('[name="duration"]')];
  expect(durations).toHaveLength(2);
  expect(durations[0].value).toBe('3 weeks');
  expect(durations[0].disabled).toBe(true);
  expect(durations[0].closest('label').textContent).toContain('Cycle 1 duration');
  expect(durations[1].value).toBe('5 weeks');
  expect(durations[1].disabled).toBe(false);
  expect(container.textContent).toContain('Existing 3-week cycles cannot be lengthened.');
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
  expect(text).toContain('Deadlift increase per microcycleFromNot usedTo20 lb');
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

it('reviews and saves a fixed deadlift increase alongside shared adaptive progression', async () => {
  const routine = createRoutine('profile', 'Started mesocycle', {
    ...inputs, mesoMode: true, maxProgressionMode: 'adaptive',
    microCycles: Array.from({ length: 3 }, () => ({ duration: '5 weeks', volume: 'Low' })),
  });
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));
  expect(button('Review changes').disabled).toBe(true);
  expect(container.querySelector('[name="deadliftIncrement"]')).toBeNull();
  fill('deadliftProgressionMode', 'fixed');
  fill('deadliftIncrement', '25');
  expect(container.querySelector('[name="squatIncrement"]')).toBeNull();
  expect(container.querySelector('[name="pressIncrement"]')).toBeNull();
  review();
  expect(container.querySelector('dl').textContent).toContain('Deadlift progressionFromUse shared setting (Adapt from completed sets)ToIncrease by set amounts');
  expect(container.querySelector('dl').textContent).toContain('Deadlift increase per microcycleFromNot usedTo25 lb');
  click(button('Back to editing'));
  expect(container.querySelector('[name="deadliftProgressionMode"]').value).toBe('fixed');
  expect(container.querySelector('[name="deadliftIncrement"]').value).toBe('25');
  review();
  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    maxProgressionMode: 'adaptive', liftProgressionModes: { deadlift: 'fixed' }, deadliftIncrement: '25',
  }));
  expect(routine.inputs.liftProgressionModes).toBeUndefined();
});

it('restores saved per-lift choices and can return a lift to the shared setting', async () => {
  const routine = createRoutine('profile', 'Mixed plan', {
    ...inputs, mesoMode: true, maxProgressionMode: 'adaptive',
    liftProgressionModes: { deadlift: 'fixed' }, deadliftIncrement: '25',
    microCycles: [{ duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
  });
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));
  expect(button('Review changes').disabled).toBe(true);
  expect(container.querySelector('[name="deadliftProgressionMode"]').value).toBe('fixed');
  fill('deadliftProgressionMode', '');
  expect(container.querySelector('[name="deadliftIncrement"]')).toBeNull();
  review();
  expect(container.querySelector('dl').textContent).toContain('Deadlift progressionFromIncrease by set amountsToUse shared setting (Adapt from completed sets)');
  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ liftProgressionModes: {} }));
});

it('reviews the removed workouts and customized exercises before shortening a single cycle', async () => {
  const routine = createRoutine('profile', 'Shorten my plan', { ...inputs, includeStrongmanDay: true });
  const removedDeadlift = routine.workouts.find(workout => workout.weekIndex === 1 && workout.name === 'Deadlift');
  removedDeadlift.exercises[0].overrides = { weight: 250 };
  routine.workouts[0].exercises[0].overrides = { movement: 'Front squat' };
  const original = JSON.parse(JSON.stringify(routine));
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));

  expect(container.querySelector('[name="duration"]').closest('label').textContent).toContain('Cycle duration');
  expect(container.textContent).toContain('combines remaining untouched weeks in pairs');
  fill('duration', '3 weeks');
  expect(button('Review changes').disabled).toBe(false);
  review();

  expect(container.querySelector('dl').textContent).toBe('Cycle durationFrom5 weeksTo3 weeks');
  expect(container.textContent).toContain('4 unstarted workouts will be removed');
  expect(container.textContent).toContain('Deadlift: 2');
  expect(container.textContent).toContain('Strongman: 2');
  expect(container.textContent).toContain('The removed workouts include 1 customized exercise.');
  expect(container.textContent).toContain('1 individual exercise customization stays in place on remaining workouts.');
  expect([...container.querySelectorAll('.plan-update-schedule li')].map(item => item.textContent)).toEqual([
    'Week 1 · 6 workoutsSquat → Press → Deadlift → Squat → Press → Strongman',
    'Week 2 · 6 workoutsSquat → Press → Deadlift → Squat → Press → Strongman',
    'Week 3 · 4 workoutsSquat → Press → Deadlift → Strongman',
  ]);
  expect(container.textContent).not.toContain('Your workout order and cycle schedule stay the same.');
  expect(onSave).not.toHaveBeenCalled();
  expect(routine).toEqual(original);
  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ duration: '3 weeks', includeStrongmanDay: true }));
});

it('shortens only untouched weeks after the latest started week', async () => {
  let routine = createRoutine('profile', 'Partly completed plan', {
    ...inputs, mesoMode: true, includeStrongmanDay: true,
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' }],
  });
  const completed = routine.workouts.find(workout => workout.cycleIndex === 1 && workout.name === 'Squat');
  const started = routine.workouts.find(workout => workout.cycleIndex === 1 && workout.weekIndex === 1 && workout.name === 'Deadlift');
  routine = setWorkoutComplete(routine, completed.id, true);
  routine = startWorkoutSession(routine, started.id);
  const original = JSON.parse(JSON.stringify(routine));
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={onSave} onCancel={() => {}} />));

  fill('duration', '3 weeks', 1);
  review();
  expect(container.querySelector('dl').textContent).toBe('Cycle 2 durationFrom5 weeksTo3 weeks');
  expect(container.textContent).toContain('1 completed · 1 already started — preserved');
  expect(container.textContent).toContain('2 unstarted workouts will be removed');
  expect(container.textContent).toContain('Deadlift: 1');
  expect(container.textContent).toContain('Strongman: 1');
  expect(container.textContent).not.toContain('outside the shorter schedule');
  expect(container.textContent).toContain('Only untouched weeks after your latest recorded or started workout are combined.');
  expect([...container.querySelectorAll('.plan-update-schedule li')].slice(-4).map(item => item.textContent)).toEqual([
    'Cycle 2 · Week 1 · 3 workoutsPress → Deadlift → Strongman',
    'Cycle 2 · Week 2 · 4 workoutsSquat → Press → Deadlift → Strongman',
    'Cycle 2 · Week 3 · 6 workoutsSquat → Press → Deadlift → Squat → Press → Strongman',
    'Cycle 2 · Week 4 · 4 workoutsSquat → Press → Deadlift → Strongman',
  ]);
  expect(routine).toEqual(original);
  await act(async () => button('Save update').click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '3 weeks', volume: 'High' }],
  }));
});

it('previews one six-day week after three completed weeks of a final cycle', () => {
  const routine = createRoutine('profile', 'Three weeks completed', {
    ...inputs, mesoMode: true, includeStrongmanDay: true,
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
  });
  routine.workouts.forEach(workout => {
    if (workout.cycleIndex === 0 || workout.weekIndex < 3) workout.completedAt = '2026-10-01T12:00:00Z';
  });
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={() => {}} onCancel={() => {}} />));
  fill('duration', '3 weeks', 1);
  review();

  expect(container.textContent).toContain('28 completed · 0 already started — preserved');
  expect(container.textContent).toContain('2 unstarted workouts will be removed');
  expect(container.textContent).toContain('Deadlift: 1');
  expect(container.textContent).toContain('Strongman: 1');
  expect([...container.querySelectorAll('.plan-update-schedule li')].map(item => item.textContent)).toEqual([
    'Cycle 2 · Week 4 · 6 workoutsSquat → Press → Deadlift → Squat → Press → Strongman',
  ]);
  expect(container.textContent).toContain('the total cycle may span more than three calendar weeks');
});

it('does not offer to expand a single three-week cycle', () => {
  const routine = createRoutine('profile', 'Three weeks', { ...inputs, duration: '3 weeks' });
  act(() => root.render(<PlanUpdateEditor routine={routine} onSave={() => {}} onCancel={() => {}} />));
  expect(container.querySelector('[name="duration"]').disabled).toBe(true);
  expect(container.querySelector('[name="duration"]').value).toBe('3 weeks');
  expect(container.textContent).toContain('Existing 3-week cycles cannot be lengthened.');
  expect(button('Review changes').disabled).toBe(true);
});
