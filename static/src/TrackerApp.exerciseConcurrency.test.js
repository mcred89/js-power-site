import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TrackerApp from './TrackerApp';
import { createRoutine } from './data/routines';
import { applyBatch, get, getAll, getAllByIndex, save } from './data/storage';

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

it.each([
  'another edit', 'starting the workout', 'starting with a delayed commit',
])('preserves the final typed prescription before %s', async nextAction => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '');
  const original = createRoutine('profile', 'Current training', {
    maxSquat: '315', maxPress: '185', maxDead: '405', duration: '5 weeks',
    mainLiftChoice: 'Low',
  });
  let stored = original;
  let finishStart;
  const profile = { id: 'profile', name: 'Alex', activeRoutineId: original.id };
  getAll.mockImplementation(store => Promise.resolve(store === 'profiles' ? [profile] : []));
  get.mockImplementation((store, key) => Promise.resolve(store === 'metadata' ? { key, value: profile.id } : stored));
  getAllByIndex.mockResolvedValue([original]);
  save.mockImplementation(async (store, record) => { if (store === 'routines') stored = record; });
  applyBatch.mockImplementation(batch => nextAction === 'starting with a delayed commit'
    ? new Promise(resolve => {
      finishStart = () => { stored = batch.puts.routines[0]; resolve(); };
    })
    : Promise.resolve().then(() => { stored = batch.puts.routines[0]; }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const click = async label => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => { button.click(); });
  };
  try {
    await act(async () => { root.render(<TrackerApp appearance="light" onAppearanceChange={() => {}} />); });
    await click('Open workout');
    await click('Edit exercises');
    const movement = container.querySelector('[aria-label="Movement"]');
    const weight = container.querySelector('[aria-label="Weight"]');

    // Blurring a field and immediately clicking Start is one normal interaction.
    // The final edit must reach the current routine before Start builds a session,
    // including when that session's storage transaction finishes later.
    await act(async () => {
      movement.value = 'Paused squat';
      movement.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      if (nextAction === 'another edit') {
        weight.value = '225';
        weight.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      } else {
        [...container.querySelectorAll('button')].find(item => item.textContent === 'Start workout').click();
      }
    });

    if (nextAction === 'another edit') {
      expect(save).toHaveBeenCalledTimes(2);
      expect(stored.workouts[0].exercises[0].overrides).toEqual({ movement: 'Paused squat', weight: '225' });
    } else {
      expect(save).toHaveBeenCalledTimes(1);
      expect(applyBatch).toHaveBeenCalledTimes(1);
      if (finishStart) {
        expect(stored.workouts[0].session).toBeNull();
        expect(stored.workouts[0].exercises[0].overrides).toEqual({ movement: 'Paused squat' });
        await act(async () => { finishStart(); });
      }
      expect(stored.workouts[0].session.status).toBe('inProgress');
      expect(stored.workouts[0].session.exercises).toHaveLength(original.workouts[0].exercises.length);
      expect(stored.workouts[0].session.exercises[0].movement).toBe('Paused squat');
      expect(stored.workouts[0].exercises[0].overrides).toEqual({ movement: 'Paused squat' });
    }
    expect(stored.workouts[0].exercises[0].generated).toEqual(original.workouts[0].exercises[0].generated);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = false;
  }
});
