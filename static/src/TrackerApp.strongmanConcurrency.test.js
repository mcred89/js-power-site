import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TrackerApp from './TrackerApp';
import { createRoutine } from './data/routines';
import { serializedRecordsEqual } from './data/recordComparison';
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
let storedProfile;
let copiedRoutines;
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
  Object.entries(batch.conditions || {}).forEach(([store, conditions]) => conditions.forEach(condition => {
    const current = store === 'profiles' ? storedProfile : condition.key === original.id ? stored
      : copiedRoutines.find(item => item.id === condition.key);
    if (!serializedRecordsEqual(condition.expected, current)) {
      throw Object.assign(new Error('Conflict'), { name: 'BatchConflictError' });
    }
  }));
  (batch.puts?.routines || []).forEach(record => {
    if (record.id === original.id) stored = record;
    else copiedRoutines = [...copiedRoutines.filter(item => item.id !== record.id), record];
  });
  (batch.puts?.profiles || []).forEach(record => { storedProfile = record; });
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
  copiedRoutines = [];
  storedProfile = { id: 'profile', name: 'Alex', activeRoutineId: original.id,
    strongmanCompetition: { ...original.inputs.strongmanCompetition, id: 'meet', status: 'active',
      createdAt: '2026-09-01T12:00:00.000Z' }, strongmanCompetitionHistory: [] };
  getAll.mockImplementation(store => Promise.resolve(store === 'profiles' ? [storedProfile] : []));
  get.mockImplementation((store, key) => Promise.resolve(store === 'metadata' ? { key, value: storedProfile.id }
    : store === 'profiles' ? storedProfile : key === original.id ? stored : copiedRoutines.find(item => item.id === key)));
  getAllByIndex.mockImplementation(() => Promise.resolve([stored, ...copiedRoutines].filter(Boolean)));
  save.mockImplementation(async (store, record) => {
    if (store === 'routines') stored = record;
    if (store === 'profiles') storedProfile = record;
  });
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
  jest.useRealTimers();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it('commits a plan rename independently while its profile competition save is pending', async () => {
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
  expect(applyBatch).toHaveBeenCalledTimes(2);
  expect(stored.name).toBe('Renamed training');
  expect(storedProfile.strongmanCompetition.name).toBe('Original competition');
  expect(container.querySelector('[aria-label="Competition name"]').closest('fieldset').disabled).toBe(true);

  await act(async () => { finishCompetition(); });

  expect(applyBatch).toHaveBeenCalledTimes(2);
  expect(stored.name).toBe('Renamed training');
  expect(stored.inputs.strongmanCompetition).toEqual(original.inputs.strongmanCompetition);
  expect(storedProfile.strongmanCompetition.name).toBe('New competition');
  expect(stored.workouts).toEqual(original.workouts);
  expect(container.querySelector('.plan-select strong').textContent).toBe(stored.name);
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('New competition');
  expect(container.querySelector('.routine-name-editor')).toBeNull();
});

it('commits a profile competition edit independently while a plan rename is pending', async () => {
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
  expect(applyBatch).toHaveBeenCalledTimes(2);
  expect(stored).toBe(original);
  expect(storedProfile.strongmanCompetition.name).toBe('New competition');
  expect(container.querySelector('[aria-label="Competition name"]')).toBeNull();

  await act(async () => { finishRename(); });

  expect(stored.name).toBe('Renamed training');
  expect(stored.inputs.strongmanCompetition.name).toBe('Original competition');
  expect(storedProfile.strongmanCompetition.name).toBe('New competition');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('.plan-select strong').textContent).toBe('Renamed training');
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('New competition');
});

it('retains the typed rename after a conflict and retries without overwriting the other change', async () => {
  applyBatch.mockImplementationOnce(async () => {
    stored = { ...stored, notes: 'Other window change' };
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
  expect(stored.notes).toBe('Other window change');
  expect(stored.inputs.strongmanCompetition).toEqual(original.inputs.strongmanCompetition);
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('Original competition');
});

it('retains a competition draft after another window completes that meet without reactivating it', async () => {
  await click('Edit competition');
  fill('Competition name', 'Unsaved target change');
  const ended = { ...storedProfile.strongmanCompetition, status: 'completed', endedAt: '2026-10-01T12:00:00.000Z' };
  storedProfile = { ...storedProfile, strongmanCompetition: null, strongmanCompetitionHistory: [ended] };
  await click('Save competition');
  expect(applyBatch).not.toHaveBeenCalled();
  expect(storedProfile.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetitionHistory).toEqual([ended]);
  expect(container.querySelector('[aria-label="Competition name"]').value).toBe('Unsaved target change');
  expect(container.querySelector('[role="alert"]').textContent).toContain('changed in another window');
});

it('selects a plan using the fresh profile so a removed competition is not restored', async () => {
  const ended = { ...storedProfile.strongmanCompetition, status: 'removed', endedAt: '2026-10-01T12:00:00.000Z' };
  storedProfile = { ...storedProfile, strongmanCompetition: null, strongmanCompetitionHistory: [ended] };
  await act(async () => { container.querySelector(`button[aria-label="View ${original.name}"]`).click(); });
  expect(storedProfile.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetitionHistory).toEqual([ended]);
  expect(stored.inputs.strongmanCompetition).toEqual(original.inputs.strongmanCompetition);
  expect(container.querySelector('.strongman-competition-card h2').textContent).toBe('Your events');
  expect(container.textContent).not.toContain('Mark competition complete');
});

it('carries the latest profile competition into a copied plan and stops after completion', async () => {
  await click('Edit competition');
  fill('Competition name', 'Latest competition targets');
  await click('Save competition');
  await click('Copy');
  await click('Copy routine');
  expect(copiedRoutines).toHaveLength(1);
  expect(copiedRoutines[0].inputs.strongmanCompetition).toEqual(storedProfile.strongmanCompetition);
  expect(copiedRoutines[0].inputs.strongmanCompetition.name).toBe('Latest competition targets');
  expect(stored.inputs.strongmanCompetition.name).toBe('Original competition');

  await click('Mark competition complete');
  await click('Confirm completion');
  await click('Copy');
  await click('Copy routine');
  expect(copiedRoutines).toHaveLength(2);
  expect(copiedRoutines[1].inputs.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetitionHistory).toHaveLength(1);
  expect(storedProfile.strongmanCompetitionHistory[0]).toMatchObject({ id: 'meet', status: 'completed' });
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

it('automatically completes after local midnight without losing a draft or reactivating its meet', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 1, 23, 59));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await click('Edit competition');
  fill('Competition date', '2026-10-01');
  await click('Save competition');
  expect(storedProfile.strongmanCompetition.date).toBe('2026-10-01');
  await click('Edit competition');
  fill('Competition name', 'Unfinished draft');
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(storedProfile.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetitionHistory).toEqual([
    expect.objectContaining({ id: 'meet', status: 'completed', date: '2026-10-01' }),
  ]);
  expect(stored).toEqual(original);
  expect(container.querySelector('[aria-label="Competition name"]').value).toBe('Unfinished draft');
  await click('Save competition');
  expect(container.querySelector('[role="alert"]').textContent).toContain('changed in another window');
  expect(storedProfile.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetitionHistory).toHaveLength(1);
});

it('retries failed automatic completion on focus without a date change', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 1, 12));
  await click('Edit competition');
  fill('Competition date', '2026-10-01');
  await click('Save competition');
  applyBatch.mockRejectedValueOnce(new Error('Storage unavailable'));
  jest.setSystemTime(new Date(2026, 9, 2, 12));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  // The day-change effect may start a new check after the old observer is
  // disposed. A fresh focus must still settle the lifecycle idempotently.
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(storedProfile.strongmanCompetition).toBeNull();
  expect(storedProfile.strongmanCompetitionHistory).toHaveLength(1);
});
