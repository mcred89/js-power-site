import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import StrongmanPlanDetails from './StrongmanPlanDetails';
import { createStrongmanRoutine, defaultStrongmanInputs } from '../data/strongman';

global.IS_REACT_ACT_ENVIRONMENT = true;

it('shows rolling coverage, baseline assessment, and explicit plan actions', () => {
  const inputs = { ...defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Sandbag', family: 'carry', priority: 'main', frequency: 3, maxGap: 2, target: {}, capabilities: [], coverage: [], practices: [{ id: 'pick', name: 'Sandbag pick', available: true, capacity: 1, recipe: null }] }] };
  const routine = createStrongmanRoutine('profile1', 'Show prep', inputs);
  const div = document.createElement('div');
  const root = createRoot(div);
  const onStatus = jest.fn();
  const onOpen = jest.fn();
  act(() => root.render(<StrongmanPlanDetails routine={routine} routines={[]} onStatus={onStatus} onOpen={onOpen} onEdit={() => {}} onLock={() => {}} onSkip={() => {}} onRecipe={() => {}} onCapability={() => {}} onCoverage={() => {}} />));
  expect(div.textContent).toContain('Next four event days');
  expect(div.textContent).toContain('Baseline');
  act(() => [...div.querySelectorAll('button')].find(button => button.textContent === 'Pause block').click());
  expect(onStatus).toHaveBeenCalledWith('paused');
  act(() => [...div.querySelectorAll('button')].find(button => button.textContent === 'Open event day').click());
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: routine.workouts[0].id }));
  act(() => root.unmount());
});

it('links a normal-day exercise to an explicit event week without modifying its work', async () => {
  const inputs = { ...defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Sandbag', family: 'carry', priority: 'main', target: {}, capabilities: [], coverage: [], practices: [{ id: 'pick', name: 'Sandbag pick', available: true, recipe: null }] }] };
  const routine = createStrongmanRoutine('profile1', 'Show prep', inputs);
  const normal = { id: 'normal', kind: 'strength', name: 'Normal', workouts: [{ id: 'press', name: 'Press', weekLabel: 'Week 1', exercises: [{ id: 'normal-clean', generated: { movement: 'Axle clean', prescription: '4 × 2', weight: 135 }, overrides: { movement: 'Log clean' } }] }] };
  const before = JSON.stringify(normal);
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const onCoverage = jest.fn();
  act(() => root.render(<StrongmanPlanDetails routine={routine} routines={[normal]} onCoverage={onCoverage} />));
  const select = div.querySelector('[aria-label="Sandbag coverage exercise"]');
  act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'normal:normal-clean'); select.dispatchEvent(new Event('change', { bubbles: true })); });
  const week = div.querySelector('[aria-label="Sandbag coverage event week"]');
  expect(week).not.toBeNull();
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(week, '3'); week.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Link coverage').click());
  expect(onCoverage).toHaveBeenCalledWith('bag', [expect.objectContaining({ eventWeek: 3, routineId: 'normal', exerciseId: 'normal-clean', sourceMovement: 'Log clean', sourcePrescription: { movement: 'Log clean', weight: 135, prescription: '4 × 2' } })]);
  expect(JSON.stringify(normal)).toBe(before);
  act(() => root.unmount());
  div.remove();
});

it('accepts a taper prescription with explicit scope while keeping regular work untouched', async () => {
  const inputs = { ...defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Bag', practices: [{ id: 'carry', name: 'Carry', recipe: { sets: 4, weight: 250 }, taperRecipe: { sets: 2, weight: 100 } }], capabilities: [] }] };
  const routine = createStrongmanRoutine('p', 'Prep', inputs);
  const div = document.createElement('div');
  const root = createRoot(div);
  const onRecipe = jest.fn().mockResolvedValue();
  act(() => root.render(<StrongmanPlanDetails routine={routine} onRecipe={onRecipe} />));
  const input = div.querySelector('[aria-label="Carry taper next prescription weight"]');
  expect(input).not.toBeNull();
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '120'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => [...input.closest('details').querySelectorAll('button')].find(button => button.textContent === 'Accept future prescription').click());
  expect(onRecipe).toHaveBeenCalledWith('bag', 'carry', expect.objectContaining({ weight: 120, sets: 2 }), 'taper');
  expect(routine.inputs.events[0].practices[0].recipe.weight).toBe(250);
  act(() => root.unmount());
});

it('records explicitly entered normal-day conditions and freezes the selected capability association', async () => {
  const inputs = { ...defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Bag', practices: [{ id: 'pick', name: 'Pick', recipe: null }], capabilities: [{ id: 'pick-cap', name: 'Pick checkpoint', status: 'working', criterion: { setup: 'Floor' } }] }] };
  const routine = createStrongmanRoutine('p', 'Prep', inputs);
  const normal = { id: 'normal', name: 'Normal', workouts: [{ id: 'day', name: 'Deadlift', exercises: [{ id: 'pick', generated: { movement: 'Sandbag pick', weight: 200, prescription: '3 × 1' }, overrides: {} }] }] };
  const div = document.createElement('div');
  const root = createRoot(div);
  const onCoverage = jest.fn();
  act(() => root.render(<StrongmanPlanDetails routine={routine} routines={[normal]} onCoverage={onCoverage} />));
  const change = (label, value) => act(() => {
    const input = div.querySelector(`[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  change('Bag coverage exercise', 'normal:pick');
  change('Bag coverage scope', 'exact');
  const setup = div.querySelector('[aria-label="Bag coverage conditions"]');
  expect(setup).not.toBeNull();
  expect(setup.value).toBe('');
  change('Bag coverage conditions', 'Floor');
  act(() => [...div.querySelectorAll('label')].find(label => label.textContent === 'Pick checkpoint').querySelector('input').click());
  await act(async () => [...div.querySelectorAll('button')].find(button => button.textContent === 'Link coverage').click());
  expect(onCoverage.mock.calls[0][1][0]).toMatchObject({ sourceConditions: { setup: 'Floor' }, capabilitySnapshot: { eventId: 'bag', practiceId: 'pick', capabilityIds: ['pick-cap'] } });
  act(() => root.unmount());
});
