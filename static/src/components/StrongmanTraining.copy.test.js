import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { StrongmanTraining } from './StrongmanTraining';

let container;
let root;
const sourceEntry = { id: 'old-entry', date: '2026-10-03', workoutId: 'old-day', movement: 'Stones', scope: 'movement',
  competitionId: null, eventId: null, componentId: null, eventSnapshot: null, notes: '',
  sets: [{ id: 'old-set-1', weight: 200, reps: 3, successful: true }, { id: 'old-set-2', weight: 220, reps: 2, successful: true }] };
const initial = { id: 'plan', profileId: 'athlete', name: 'Event training', strongmanLog: [sourceEntry],
  workouts: [{ id: 'old-day', name: 'Strongman', completedAt: '2026-10-03T17:00:00Z' }, { id: 'today', name: 'Strongman' }] };
const click = async label => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
};
const submit = async () => act(async () => Simulate.submit(container.querySelector('form')));
const Harness = ({ persist }) => {
  const [routine, setRoutine] = useState(initial);
  return <StrongmanTraining routine={routine} workout={routine.workouts[1]} onSaveLog={async entries => {
    await persist(entries);
    setRoutine(current => ({ ...current, strongmanLog: entries }));
  }} onSaveTraining={async (entries, queue) => {
    await persist(entries, queue);
    setRoutine(current => ({ ...current, strongmanLog: entries,
      workouts: current.workouts.map(workout => workout.id === 'today' ? { ...workout, strongmanQueue: queue } : workout) }));
  }} />;
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers().setSystemTime(new Date('2026-10-17T17:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});
const copy = async () => {
  await click('Copy previous workout');
  await act(async () => container.querySelector('.strongman-copy-choice').click());
};

it('copies pending prefills without recording results, then consumes exactly one set per successful save', async () => {
  const persist = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<Harness persist={persist} />));
  await copy();
  expect(persist.mock.calls[0][0]).toEqual([sourceEntry]);
  expect(container.querySelectorAll('.strongman-training-entry')).toHaveLength(0);
  expect(container.textContent).toContain('0 sets logged · 2 to go');
  await click('Log next set');
  expect(container.querySelectorAll('.strongman-training-set')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-set input').value).toBe('200');
  await submit();
  expect(persist.mock.calls[1][0]).toHaveLength(2);
  expect(persist.mock.calls[1][0][0]).toEqual(sourceEntry);
  expect(persist.mock.calls[1][1][0].sets).toHaveLength(1);
  expect(container.textContent).toContain('1 set logged · 1 to go');
  await click('Log next set');
  expect(container.querySelector('.strongman-training-set input').value).toBe('220');
  await submit();
  expect(persist.mock.calls[2][1]).toEqual([]);
  expect(persist.mock.calls[2][0][1].sets).toHaveLength(2);
  expect(container.querySelectorAll('.strongman-training-entry')).toHaveLength(1);
});

it('retains a copied set and its edited values on write failure without advancing the queue', async () => {
  const persist = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Storage is full')).mockResolvedValue(undefined);
  act(() => root.render(<Harness persist={persist} />));
  await copy();
  await click('Log next set');
  act(() => Simulate.change(container.querySelector('.strongman-training-set input'), { target: { value: '205' } }));
  await submit();
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is full');
  expect(container.querySelector('.strongman-training-set input').value).toBe('205');
  expect(container.textContent).toContain('0 sets logged · 2 to go');
  await submit();
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('1 set logged · 1 to go');
  expect(persist.mock.calls[2][0][1].sets[0].weight).toBe(205);
});

it('skips and clears only pending sets, preserving historical results', async () => {
  const persist = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<Harness persist={persist} />));
  await copy();
  await click('Skip set');
  expect(persist.mock.calls[1][0]).toEqual([sourceEntry]);
  expect(persist.mock.calls[1][1][0].sets[0].weight).toBe(220);
  await click('Clear remaining sets');
  expect(persist).toHaveBeenCalledTimes(2);
  await click('Keep sets');
  expect(container.querySelector('.strongman-queue-entry')).not.toBeNull();
  await click('Clear remaining sets');
  await click('Clear unlogged sets');
  expect(persist).toHaveBeenLastCalledWith([sourceEntry], []);
  expect(container.querySelector('.strongman-queue-entry')).toBeNull();
});

it('keeps the picker open after a failed copy and does not expose it on completed workouts', async () => {
  const persist = jest.fn().mockRejectedValue(new Error('No space'));
  act(() => root.render(<Harness persist={persist} />));
  await copy();
  expect(container.querySelector('.strongman-copy-picker')).not.toBeNull();
  expect(container.querySelector('[role="alert"]').textContent).toBe('No space');
  expect(container.querySelector('.strongman-queue-entry')).toBeNull();
  act(() => root.render(<StrongmanTraining key="completed" routine={initial} workout={initial.workouts[0]} onSaveLog={persist} onSaveTraining={persist} />));
  expect(container.textContent).not.toContain('Copy previous workout');
});

it('dismisses clear confirmation before opening a set so it cannot remove an active editor', async () => {
  const persist = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<Harness persist={persist} />));
  await copy();
  await click('Clear remaining sets');
  await click('Log next set');
  expect(container.querySelector('[aria-label="Confirm clear remaining sets"]')).toBeNull();
  await submit();
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('1 set logged · 1 to go');
});

it('offers the next past set with the original date and setup after backfill saves', async () => {
  const persist = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<Harness persist={persist} />));
  await click('Log past training');
  act(() => Simulate.change(container.querySelector('[aria-label="Exercise"]'), { target: { value: 'past:Stones' } }));
  act(() => Simulate.change(container.querySelector('input[type="date"]'), { target: { value: '2026-10-01' } }));
  act(() => Simulate.change(container.querySelector('.strongman-training-set input'), { target: { value: '190' } }));
  await submit();
  expect(container.querySelectorAll('.strongman-training-entry')).toHaveLength(0);
  await click('Add set to past training');
  expect(container.querySelector('input[type="date"]').value).toBe('2026-10-01');
  expect(container.querySelector('.strongman-training-set input').value).toBe('190');
  await submit();
  const saved = persist.mock.calls[1][0];
  expect(saved[1]).toMatchObject({ date: '2026-10-01', workoutId: null });
  expect(saved[1].sets).toHaveLength(2);
  expect(saved[0]).toEqual(sourceEntry);
});
