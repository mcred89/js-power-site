import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TrackerApp from './TrackerApp';
import { createRoutine } from './data/routines';
import { applyBatch, get, getAll, getAllByIndex } from './data/storage';

jest.mock('./data/storage', () => ({
  applyBatch: jest.fn(),
  get: jest.fn(),
  getAll: jest.fn(),
  getAllByIndex: jest.fn(),
  hasPersistentStorage: jest.fn().mockResolvedValue(false),
  remove: jest.fn(),
  requestPersistentStorage: jest.fn(),
  save: jest.fn(),
}));
jest.mock('./data/dataWorkerFactory', () => ({ createDataWorker: jest.fn() }));

let container;
let root;
let storedRoutine;

const click = async label => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); });
};
const todayOutlook = () => container.querySelector('.next-workout .calendar-outlook').textContent;
const plansEnd = () => container.querySelector('.plan-card.selected .plan-calendar-range > div:nth-child(2) time')?.textContent;
const mountTracker = async () => {
  root = createRoot(container);
  await act(async () => { root.render(<TrackerApp appearance="light" onAppearanceChange={() => {}} />); });
};
const seedPlan = async mesocycle => {
  storedRoutine = createRoutine('profile', 'Calendar update plan', {
    maxSquat: '315', maxPress: '185', maxDead: '405', duration: '5 weeks',
    mainLiftChoice: 'Low', includeStrongmanDay: true,
    ...(mesocycle ? {
      mesoMode: true,
      microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
    } : {}),
  });
  if (mesocycle) storedRoutine.workouts.forEach(workout => {
    if (workout.cycleIndex === 0 || workout.sourceWeek < 3) workout.completedAt = '2026-10-01T12:00:00';
  });
  const profile = { id: 'profile', name: 'Alex', activeRoutineId: storedRoutine.id };
  getAll.mockImplementation(store => Promise.resolve(store === 'profiles' ? [profile] : []));
  get.mockImplementation((store, key) => Promise.resolve(store === 'metadata' ? { key, value: profile.id } : storedRoutine));
  getAllByIndex.mockImplementation(() => Promise.resolve([storedRoutine]));
  applyBatch.mockImplementation(async batch => { storedRoutine = batch.puts.routines[0]; });
  await mountTracker();
};
const reviewShortening = async mesocycle => {
  await click('Update plan');
  const selector = mesocycle ? 'select[name="duration"][data-cycle-index="1"]' : 'select[name="duration"]';
  act(() => {
    const input = container.querySelector(selector);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, '3 weeks');
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Review changes');
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date(2026, 9, 3, 12));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  jest.useRealTimers();
  container.remove();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it.each([
  ['an untouched five-week cycle', false, '11/01/26', 5, '10/18/26', 3],
  ['a final cycle with three completed weeks', true, '10/18/26', 2, '10/11/26', 1],
])('updates Plans and Today immediately after shortening %s and keeps the dates after reload', async (
  description, mesocycle, oldEnd, oldWeeks, newEnd, newWeeks,
) => {
  await seedPlan(mesocycle);
  expect(todayOutlook()).toBe(`Est. end ${oldEnd} · ${oldWeeks} weeks remaining`);
  await click('Plans');
  expect(plansEnd()).toBe(oldEnd);
  await reviewShortening(mesocycle);
  await click('Save update');

  expect(plansEnd()).toBe(newEnd);
  await click('Today');
  expect(todayOutlook()).toBe(`Est. end ${newEnd} · ${newWeeks} ${newWeeks === 1 ? 'week' : 'weeks'} remaining`);

  act(() => root.unmount());
  window.history.replaceState(null, '');
  await mountTracker();
  expect(todayOutlook()).toBe(`Est. end ${newEnd} · ${newWeeks} ${newWeeks === 1 ? 'week' : 'weeks'} remaining`);
  await click('Plans');
  expect(plansEnd()).toBe(newEnd);
});

it('keeps the old estimated end in Plans, Today, and storage when shortening cannot be saved', async () => {
  await seedPlan(true);
  const original = storedRoutine;
  await click('Plans');
  expect(plansEnd()).toBe('10/18/26');
  await reviewShortening(true);
  applyBatch.mockRejectedValueOnce(new Error('Storage is unavailable.'));
  await click('Save update');
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is unavailable.');
  expect(storedRoutine).toBe(original);
  await click('Cancel');
  expect(plansEnd()).toBe('10/18/26');
  await click('Today');
  expect(todayOutlook()).toBe('Est. end 10/18/26 · 2 weeks remaining');

  act(() => root.unmount());
  window.history.replaceState(null, '');
  await mountTracker();
  expect(todayOutlook()).toBe('Est. end 10/18/26 · 2 weeks remaining');
  await click('Plans');
  expect(plansEnd()).toBe('10/18/26');
});
