import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TrackerApp from './TrackerApp';
import { createRoutine, setWorkoutComplete } from './data/routines';
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
let original;

const click = async label => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); });
};

beforeEach(async () => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '');
  original = createRoutine('profile', 'Current training', {
    maxSquat: '315', maxPress: '185', maxDead: '405', duration: '5 weeks',
    mainLiftChoice: 'Low', squatTabataEnabled: true, pressTabataEnabled: true, deadliftTabataEnabled: true,
  });
  original = setWorkoutComplete(original, original.workouts[0].id, true);
  const profile = { id: 'profile', name: 'Alex', activeRoutineId: original.id };
  getAll.mockImplementation(store => Promise.resolve(store === 'profiles' ? [profile] : []));
  get.mockImplementation((store, key) => Promise.resolve(store === 'metadata' ? { key, value: profile.id } : original));
  getAllByIndex.mockResolvedValue([original]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<TrackerApp appearance="light" onAppearanceChange={() => {}} />); });
  await click('Plans');
  await click('Update plan');
  act(() => container.querySelector('input[name="deadliftTabataEnabled"]').click());
  await click('Review changes');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it('publishes a plan update only after its guarded database transaction commits', async () => {
  let commit;
  applyBatch.mockImplementation(() => new Promise(resolve => { commit = resolve; }));
  await click('Save update');
  const batch = applyBatch.mock.calls[0][0];
  expect(batch.conditions.routines).toEqual([{ key: original.id, expected: original }]);
  expect(batch.puts.routines[0].workouts[0]).toEqual(original.workouts[0]);
  expect(batch.puts.routines[0].inputs.deadliftTabataEnabled).toBe(false);
  expect(container.textContent).not.toContain('Plan updated.');
  await act(async () => { commit(); });
  expect(container.textContent).toContain('Plan updated.');
  await click('Update plan');
  expect(container.querySelector('input[name="deadliftTabataEnabled"]').checked).toBe(false);
});

it('keeps the saved plan unchanged after a failed update and reports concurrent changes clearly', async () => {
  applyBatch.mockRejectedValue(Object.assign(new Error('Conflict'), { name: 'BatchConflictError' }));
  await click('Save update');
  expect(container.querySelector('[role="alert"]').textContent).toContain('changed in another window');
  expect(container.textContent).not.toContain('Plan updated.');
  await click('Cancel');
  await click('Update plan');
  expect(container.querySelector('input[name="deadliftTabataEnabled"]').checked).toBe(true);
});
