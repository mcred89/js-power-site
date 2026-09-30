import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StrongmanProgress } from './StrongmanProgress';

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
const makeRecord = (id, date, weight, distance) => ({ id, date, movement: 'Zercher yoke carry', scope: 'movement', sets: [{ id: `set-${id}`, weight, distance, reps: '', seconds: '', successful: true }] });

it('retains lifetime records when the selected plan has no matching training', () => {
  const routines = [
    { id: 'current', name: 'Current plan', inputs: {}, strongmanLog: [] },
    { id: 'past', name: 'Last year', inputs: {}, strongmanLog: [makeRecord('old', '2025-09-01', 620, 100)] },
  ];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  act(() => {
    const select = container.querySelector('[aria-label="Strongman plan"]');
    select.value = 'current';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const cards = [...container.querySelectorAll('.strongman-record-metric')];
  expect(cards.find(card => card.textContent.includes('selected plan')).textContent).toContain('No results yet');
  expect(cards.find(card => card.textContent.includes('Lifetime')).textContent).toContain('620 lb · 100 ft');
  expect(container.textContent).toContain('No attempts in this plan yet.');
});

it('compares full medley times only within the selected historical setup', () => {
  const setup = weight => ({ id: 'medley', name: 'Carry medley', type: 'medley', weight: '', reps: '', distance: '', seconds: '', components: [{ id: 'bag', name: 'Sandbag', weight, distance: 100, reps: '', seconds: '' }] });
  const entry = (id, weight, seconds) => ({ id, date: '2026-09-01', movement: 'Carry medley', scope: 'medley', eventSnapshot: setup(weight), sets: [{ id: `set-${id}`, weight: '', distance: '', reps: '', seconds }] });
  const routines = [{ id: 'plan', name: 'Current plan', strongmanLog: [entry('heavy', 250, 45), entry('light', 150, 20)] }];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman timed setup"]');
  expect(select.options).toHaveLength(2);
  expect(container.querySelector('.strongman-record-metric').textContent).toContain('45 sec');
  act(() => {
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.strongman-record-metric').textContent).toContain('20 sec');
  expect(container.querySelectorAll('.strongman-result-history > li')).toHaveLength(2);
});

it('requires deliberate removal and persists the remaining entries in their original plan', async () => {
  const first = makeRecord('first', '2026-09-01', 580, 50);
  const second = makeRecord('second', '2026-09-02', 600, 50);
  const routines = [{ id: 'plan', name: 'Current plan', inputs: {}, strongmanLog: [first, second] }];
  const onSaveLog = jest.fn().mockResolvedValue();
  act(() => root.render(<StrongmanProgress routines={routines} onSaveLog={onSaveLog} />));
  act(() => container.querySelector('[aria-label^="Remove Zercher"]').click());
  expect(onSaveLog).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Confirm removal"]')).not.toBeNull();
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Log past result')).toBe(false);
  await act(async () => container.querySelector('[aria-label="Confirm removal"] button').click());
  expect(onSaveLog).toHaveBeenCalledWith('plan', [first]);
  expect(container.querySelector('[aria-label="Confirm removal"]')).toBeNull();
});

it('opens a dated past-result editor even when there are no recorded events', () => {
  const routines = [{ id: 'plan', name: 'Current plan', inputs: {}, strongmanLog: [] }];
  act(() => root.render(<StrongmanProgress routines={routines} onSaveLog={jest.fn()} />));
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Log past result').click());
  expect(container.querySelector('[aria-label="Plan for past result"]').value).toBe('plan');
  act(() => {
    const exercise = container.querySelector('.strongman-result-editor select');
    exercise.value = 'custom';
    exercise.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('input[type="date"]')).not.toBeNull();
});

it('defaults a new past result to the active plan even when an older plan was edited most recently', () => {
  const routines = [
    { id: 'old', name: 'Recently edited old plan', inputs: {}, strongmanLog: [makeRecord('old-result', '2025-09-01', 620, 100)] },
    { id: 'current', name: 'Active plan', inputs: {}, strongmanLog: [] },
  ];
  act(() => root.render(<StrongmanProgress routines={routines} defaultRoutineId="current" onSaveLog={jest.fn()} />));
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Log past result').click());
  expect(container.querySelector('[aria-label="Plan for past result"]').value).toBe('current');
});

it('does not carry an open result editor into another profile', () => {
  const routines = [{ id: 'plan', profileId: 'first', name: 'First profile plan', inputs: {}, strongmanLog: [] }];
  act(() => root.render(<StrongmanProgress routines={routines} defaultRoutineId="plan" onSaveLog={jest.fn()} />));
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Log past result').click());
  expect(container.querySelector('.strongman-result-editor')).not.toBeNull();
  act(() => root.render(<StrongmanProgress routines={[{ id: 'other', profileId: 'second', name: 'Second profile plan', inputs: {}, strongmanLog: [] }]} defaultRoutineId="other" onSaveLog={jest.fn()} />));
  expect(container.querySelector('.strongman-result-editor')).toBeNull();
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Log past result')).toBe(true);
});
