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

let container;
let root;
let stored;
let original;

const click = async label => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); });
};
const fill = (label, value) => act(() => {
  const input = container.querySelector(`input[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const commit = batch => {
  const condition = batch.conditions.routines[0];
  expect(condition.key).toBe(stored.id);
  if (JSON.stringify(condition.expected) !== JSON.stringify(stored)) {
    throw Object.assign(new Error('Conflict'), { name: 'BatchConflictError' });
  }
  stored = batch.puts.routines[0];
};

beforeEach(async () => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '');
  original = createRoutine('profile', 'Current training', {
    maxSquat: '315', maxPress: '185', maxDead: '405', duration: '5 weeks',
    mainLiftChoice: 'Low', includeStrongmanDay: true,
    strongmanCompetition: { name: 'Original competition', date: '', events: [] },
  });
  stored = original;
  const profile = { id: 'profile', name: 'Alex', activeRoutineId: original.id };
  getAll.mockImplementation(store => Promise.resolve(store === 'profiles' ? [profile] : []));
  get.mockImplementation((store, key) => Promise.resolve(store === 'metadata' ? { key, value: profile.id } : stored));
  getAllByIndex.mockImplementation(() => Promise.resolve([stored]));
  save.mockImplementation(async (store, record) => { if (store === 'routines') stored = record; });
  applyBatch.mockImplementation(async batch => { commit(batch); });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<TrackerApp appearance="light" onAppearanceChange={() => {}} />); });
  await click('Plans');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it('preserves a competition save when a rename is submitted before its commit finishes', async () => {
  let finishCompetition;
  applyBatch.mockImplementationOnce(batch => new Promise(resolve => {
    finishCompetition = () => { commit(batch); resolve(); };
  }));
  await click('Rename');
  fill('Routine name', 'Renamed training');
  await click('Edit competition');
  fill('Competition name', 'New competition');
  await click('Save competition');
  await click('Save name');
  expect(applyBatch).toHaveBeenCalledTimes(1);
  expect(stored).toBe(original);
  expect(container.querySelector('[aria-label="Routine name"]').disabled).toBe(true);

  await act(async () => { finishCompetition(); });

  expect(applyBatch).toHaveBeenCalledTimes(2);
  expect(stored.name).toBe('Renamed training');
  expect(stored.inputs.strongmanCompetition.name).toBe('New competition');
  expect(stored.workouts).toEqual(original.workouts);
  expect(container.querySelector('.plan-select strong').textContent).toBe(stored.name);
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('New competition');
  expect(container.querySelector('.routine-name-editor')).toBeNull();
});

it('retains a competition draft when a pending rename commits first, then safely retries it', async () => {
  let finishRename;
  applyBatch.mockImplementationOnce(batch => new Promise(resolve => {
    finishRename = () => { commit(batch); resolve(); };
  }));
  await click('Rename');
  fill('Routine name', 'Renamed training');
  await click('Edit competition');
  fill('Competition name', 'New competition');
  await click('Save name');
  await click('Save competition');
  expect(applyBatch).toHaveBeenCalledTimes(1);
  expect(stored).toBe(original);

  await act(async () => { finishRename(); });

  expect(stored.name).toBe('Renamed training');
  expect(stored.inputs.strongmanCompetition.name).toBe('Original competition');
  expect(container.querySelector('[aria-label="Competition name"]').value).toBe('New competition');
  expect(container.querySelector('[role="alert"]').textContent).toContain('changed in another window');
  await click('Save competition');
  expect(stored.name).toBe('Renamed training');
  expect(stored.inputs.strongmanCompetition.name).toBe('New competition');
  expect(container.querySelector('.plan-select strong').textContent).toBe('Renamed training');
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('New competition');
});

it('retains the typed rename after a conflict and retries without overwriting the other change', async () => {
  applyBatch.mockImplementationOnce(async () => {
    stored = { ...stored, inputs: { ...stored.inputs, strongmanCompetition: {
      ...stored.inputs.strongmanCompetition, name: 'Other window competition',
    } } };
    throw Object.assign(new Error('Conflict'), { name: 'BatchConflictError' });
  });
  await click('Rename');
  fill('Routine name', 'Retained name');
  await click('Save name');
  expect(container.querySelector('[role="alert"]').textContent).toContain('changed in another window');
  expect(container.querySelector('[aria-label="Routine name"]').value).toBe('Retained name');
  expect(container.querySelector('.plan-select strong').textContent).toBe(original.name);

  await click('Save name');

  expect(stored.name).toBe('Retained name');
  expect(stored.inputs.strongmanCompetition.name).toBe('Other window competition');
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('Other window competition');
});

it.each([undefined, { profileId: 'other-profile' }])('does not rename a removed or reassigned plan: %j', async replacement => {
  await click('Rename');
  fill('Routine name', 'Unsaved name');
  stored = replacement && { ...original, ...replacement };
  await click('Save name');

  expect(applyBatch).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]').textContent).toContain('no longer available');
  expect(container.querySelector('[aria-label="Routine name"]').value).toBe('Unsaved name');
  expect(container.querySelector('.plan-select strong').textContent).toBe(original.name);
});
