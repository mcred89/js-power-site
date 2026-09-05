import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
jest.mock('./data/storage', () => ({ get: jest.fn(), getAll: jest.fn(), getAllByIndex: jest.fn(), save: jest.fn(), applyBatch: jest.fn(), remove: jest.fn(), hasPersistentStorage: jest.fn().mockResolvedValue(false), requestPersistentStorage: jest.fn() }));
jest.mock('./data/dataWorkerFactory', () => ({ createDataWorker: () => { throw new Error('No worker in Jest'); } }));
import TrackerApp from './TrackerApp';
import * as storage from './data/storage';
import { createRoutine } from './data/routinePlanning';
import { createStrongmanRoutine, defaultStrongmanInputs } from './data/strongman';

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
let db;
let container;
let root;
let first;
let events;
const click = async (text, scope = container) => act(async () => {
  [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text).click();
  await new Promise(resolve => setTimeout(resolve, 0));
});
const render = async () => {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root.render(<TrackerApp appearance="system" onAppearanceChange={() => {}} />); await new Promise(resolve => setTimeout(resolve, 0)); });
};
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const inputs = { maxSquat: '400', maxPress: '200', maxDead: '500', mainLiftChoice: 'Low', duration: '5 weeks' };
  first = createRoutine('p', 'Strength A', inputs);
  const second = createRoutine('p', 'Strength B', inputs);
  events = createStrongmanRoutine('p', 'Event block', { ...defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Sandbag', family: 'carry', priority: 'main', practices: [{ id: 'pick', name: 'Pick', recipe: null, available: true }], capabilities: [] }] });
  db = { profiles: [{ id: 'p', name: 'Alex', activeRoutineId: first.id, scheduledStrengthRoutineId: second.id, activeStrongmanRoutineId: events.id, activeWorkoutRoutineId: null }], routines: [first, second, events], templates: [] };
  storage.getAll.mockImplementation(async store => clone(db[store] || []));
  storage.get.mockImplementation(async (store, id) => store === 'metadata' ? { key: id, value: 'p' } : clone(db[store].find(item => item.id === id)));
  storage.getAllByIndex.mockImplementation(async () => clone(db.routines));
  storage.save.mockImplementation(async (store, item) => { db[store] = db[store].map(old => old.id === item.id ? clone(item) : old); });
  storage.applyBatch.mockImplementation(async batch => {
    Object.entries(batch.conditions || {}).forEach(([store, conditions]) => conditions.forEach(condition => {
      if (JSON.stringify(db[store].find(item => item.id === condition.key)) !== JSON.stringify(condition.expected)) throw Object.assign(new Error('Data changed.'), { name: 'BatchConflictError' });
    }));
    Object.entries(batch.puts || {}).forEach(([store, values]) => values.forEach(value => {
      db[store] = [...db[store].filter(old => old.id !== value.id), clone(value)];
    }));
  });
  await render();
});
afterEach(() => { act(() => root.unmount()); global.IS_REACT_ACT_ENVIRONMENT = false; });

test('keeps the normal routine selected for Today after reload', async () => {
  await click('Plans');
  await act(async () => container.querySelector('[aria-label="View Strength A"]').click());
  await click('Today');
  expect(container.textContent).toContain('Strength A');
  act(() => root.unmount());
  await render();
  expect(container.textContent).toContain('Strength A');
  expect(container.textContent).not.toContain('Strength B');
});

test('viewing a normal routine preserves another tab active event ownership', async () => {
  await click('Plans');
  db.profiles[0].activeWorkoutRoutineId = events.id;
  db.routines.find(item => item.id === events.id).workouts[0].session = { status: 'inProgress', startedAt: '2026-09-05T00:00:00Z' };
  await act(async () => container.querySelector('[aria-label="View Strength A"]').click());
  expect(db.profiles[0].activeWorkoutRoutineId).toBe(events.id);
});

test('renaming a stale event plan preserves another tab recorded session', async () => {
  await click('Plans');
  const card = [...container.querySelectorAll('.plan-card')].find(item => item.textContent.includes('Event block'));
  await click('Rename', card);
  const session = { status: 'inProgress', startedAt: '2026-09-05T00:00:00Z', eventBlocks: [{ attempts: [{ weight: 300, outcome: 'successful' }] }] };
  db.routines.find(item => item.id === events.id).workouts[0].session = clone(session);
  db.profiles[0].activeWorkoutRoutineId = events.id;
  act(() => { const input = card.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Renamed event block'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { card.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
  const saved = db.routines.find(item => item.id === events.id);
  expect(saved.name).toBe('Renamed event block');
  expect(saved.workouts[0].session).toEqual(session);
  expect(db.profiles[0].activeWorkoutRoutineId).toBe(events.id);
});

test.each(['empty', 'pending strength', 'completed strength', 'paused event', 'saved event', 'completed event'])('Today opens a new strongman block from %s without changing saved training', async state => {
  act(() => root.unmount());
  db.profiles[0] = { ...db.profiles[0], activeRoutineId: state === 'empty' ? null : first.id, scheduledStrengthRoutineId: null, activeStrongmanRoutineId: null };
  db.routines = state === 'empty' ? [] : [first];
  if (state === 'completed strength') first.workouts.forEach(workout => { workout.completedAt = '2026-09-05T12:00:00Z'; });
  if (state.endsWith('event')) db.routines.push({ ...events, status: { 'paused event': 'paused', 'saved event': 'saved', 'completed event': 'complete' }[state] });
  const before = clone(db);
  await render();
  const existingAction = state === 'empty' ? 'Build a routine' : state === 'completed strength' ? 'Build another routine' : 'Open workout';
  expect([...container.querySelectorAll('button')].some(button => button.textContent === existingAction)).toBe(true);
  if (state === 'empty') {
    expect(container.querySelector('.today-plan-menu')).toBeNull();
    await click('New strongman block');
  } else {
    expect([...container.querySelectorAll('h2')].some(heading => heading.textContent === 'Plan strongman training')).toBe(false);
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'New strongman block')).toBe(false);
    expect(container.querySelector('.today-plan-menu summary').textContent).toBe('Add plan');
    act(() => container.querySelector('.today-plan-menu summary').click());
    expect(container.querySelector('.today-plan-menu').open).toBe(true);
    await click('Strongman block');
  }
  expect(container.querySelector('.strongman-builder h1').textContent).toBe('Plan strongman training');
  expect(container.querySelector('[aria-label="Block name"]').value).toBe('Alex strongman block');
  await click('← Back to training');
  expect(container.querySelector('.dashboard')).not.toBeNull();
  expect(db).toEqual(before);
});

test('Today shows the enrolled event block instead of another creation card', () => {
  const labels = [...container.querySelectorAll('button')].map(button => button.textContent);
  expect(labels).toContain('View strongman block');
  expect(labels).toContain('Open standalone event day');
  expect(labels).not.toContain('New strongman block');
  expect(container.querySelector('.today-plan-menu summary').textContent).toBe('Add plan');
});

test('Today can add a strength routine from its compact plan action', async () => {
  act(() => container.querySelector('.today-plan-menu summary').click());
  await click('Strength routine');
  expect(container.textContent).toContain('Generate plan');
  expect(container.querySelector('[name="maxSquat"]')).not.toBeNull();
});

test.each(['saved', 'paused'])('a profile with only a %s event block gets compact creation actions', async status => {
  act(() => root.unmount());
  db.profiles[0] = { ...db.profiles[0], activeRoutineId: null, scheduledStrengthRoutineId: null, activeStrongmanRoutineId: null };
  db.routines = [{ ...events, status }];
  await render();
  expect(container.querySelector('.today-plan-menu summary').textContent).toBe('Add plan');
  expect(container.querySelector('.empty-card')).toBeNull();
  act(() => container.querySelector('.today-plan-menu summary').click());
  await click('Strongman block');
  expect(container.querySelector('[aria-label="Block name"]').value).toBe('Alex strongman block');
});
