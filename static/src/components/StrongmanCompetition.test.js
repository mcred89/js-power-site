import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrongmanCompetitionCard, StrongmanCompetitionEditor } from './StrongmanCompetition';

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
  container.remove();
});
const click = text => act(() => [...container.querySelectorAll('button')].find(button => button.textContent === text).click());
const change = (label, value) => {
  const input = container.querySelector(`[aria-label="${label}"]`);
  act(() => {
    if (input.tagName === 'SELECT') input.value = value;
    else Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const competition = {
  name: 'Autumn show', date: '',
  events: [{ id: 'yoke', name: 'Zercher yoke carry', type: 'single', weight: 600, distance: 100, reps: '', seconds: '', components: [] }],
};
const record = (id, date, weight, distance, successful = true) => ({
  id, date, movement: 'Zercher yoke carry', scope: 'movement', sets: [{ id: `set-${id}`, weight, distance, reps: '', seconds: '', successful }],
});

it('keeps current-plan evidence separate from lifetime records and includes the most recent attempt', () => {
  const current = { id: 'current', name: 'Current plan', inputs: { strongmanCompetition: competition }, strongmanLog: [record('best', '2026-09-01', 580, 50), record('attempt', '2026-09-21', 600, 0, false)] };
  const past = { id: 'past', name: 'Past plan', strongmanLog: [record('past-best', '2025-09-01', 620, 100)] };
  act(() => root.render(<StrongmanCompetitionCard routine={current} routines={[current, past]} />));
  const rows = [...container.querySelectorAll('.strongman-event-results > div')];
  expect(rows.find(row => row.textContent.includes('This plan')).textContent).toContain('580 lb · 50 ft');
  expect(rows.find(row => row.textContent.includes('Lifetime')).textContent).toContain('620 lb · 100 ft');
  expect(rows.find(row => row.textContent.includes('Last trained')).textContent).toContain('Sep 21, 2026 · Attempt');
  expect(container.textContent).toContain('Competition: 600 lb · 100 ft');
});

it('allows a medley with three unknown implements without inventing targets', () => {
  let latest;
  const Editor = () => {
    const [value, setValue] = useState({ name: '', date: '', events: [] });
    latest = value;
    return <StrongmanCompetitionEditor value={value} onChange={setValue} knownMovements={['Sandbag carry']} />;
  };
  act(() => root.render(<Editor />));
  click('Add event');
  change('Event 1 name', 'Carry medley');
  change('Event 1 type', 'medley');
  click('Add implement');
  click('Add implement');
  click('Add implement');
  expect(latest.events[0].components).toHaveLength(3);
  expect(latest.events[0].components.every(item => item.name === '' && item.weight === '' && item.distance === '')).toBe(true);
  expect(container.querySelectorAll('form')).toHaveLength(0);
  change('Event 1 implement 1 name', 'Sandbag carry');
  change('Event 1 implement 1 Weight (lb)', '250');
  expect(latest.events[0].components[0]).toMatchObject({ name: 'Sandbag carry', weight: '250', distance: '' });
  expect(container.querySelector('datalist').textContent).toBe('');
  expect(container.querySelector('datalist option').value).toBe('Sandbag carry');
});

it('saves normalized competition details and retains an unsuccessful save for correction', async () => {
  const onSave = jest.fn().mockRejectedValueOnce(new Error('Storage is unavailable.')).mockResolvedValueOnce();
  const onEditing = jest.fn();
  const routine = { id: 'current', inputs: { strongmanCompetition: competition } };
  act(() => root.render(<StrongmanCompetitionCard routine={routine} onSaveCompetition={onSave} onEditingChange={onEditing} />));
  click('Edit competition');
  change('Event 1 Weight (lb)', '625');
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is unavailable.');
  expect(container.querySelector('[aria-label="Event 1 Weight (lb)"]').value).toBe('625');
  expect(onSave.mock.calls[0][0].events[0].weight).toBe(625);
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(container.querySelector('form')).toBeNull();
  expect(onEditing).toHaveBeenCalledWith(true);
  expect(onEditing).toHaveBeenLastCalledWith(false);
});

it('shows longest hold records instead of rewarding shorter holds', () => {
  const event = { id: 'hold', name: 'Hercules hold', type: 'single', weight: 200, distance: '', reps: '', seconds: 60, timeGoal: 'longest', components: [] };
  const routine = { id: 'current', inputs: { strongmanCompetition: { events: [event] } }, strongmanLog: [
    { id: 'hold-entry', date: '2026-09-01', movement: 'Hercules hold', scope: 'movement', sets: [
      { id: 'short', weight: 200, seconds: 15 }, { id: 'long', weight: 200, seconds: 45 }, { id: 'light', weight: 100, seconds: 90 },
    ] },
  ] };
  act(() => root.render(<StrongmanCompetitionCard routine={routine} />));
  const row = [...container.querySelectorAll('.strongman-event-results > div')].find(item => item.textContent.includes('Longest hold'));
  expect(row.textContent).toContain('200 lb · 45 sec');
  expect(row.textContent).not.toContain('90 sec');
});

it('offers more reps for single events and individual medley implements', () => {
  let latest;
  const Editor = () => {
    const [value, setValue] = useState(competition);
    latest = value;
    return <StrongmanCompetitionEditor value={value} onChange={setValue} />;
  };
  act(() => root.render(<Editor />));
  change('Event 1 record goal', 'reps');
  expect(latest.events[0].timeGoal).toBe('reps');
  expect(container.querySelector('[aria-label="Event 1 Time window (sec)"]')).not.toBeNull();
  expect(latest.events[0].reps).toBe('');
  change('Event 1 type', 'medley');
  expect(latest.events[0].timeGoal).toBe('fastest');
  click('Add implement');
  change('Event 1 implement 1 record goal', 'reps');
  expect(latest.events[0].components[0].timeGoal).toBe('reps');
});

it('shows comparable rep records prominently while retaining heaviest results', () => {
  const target = { id: 'log', name: 'Log press', type: 'single', weight: 200, distance: '', reps: '', seconds: 60, timeGoal: 'reps' };
  const entry = (id, sets) => ({ id, date: '2026-09-01', movement: 'Log press', scope: 'movement', sets });
  const routine = { id: 'current', inputs: { strongmanCompetition: { events: [target,
    { id: 'medley', name: 'Press medley', type: 'medley', components: [{ ...target, id: 'implement' }] },
  ] } }, strongmanLog: [entry('current-log', [
    { id: 'first', weight: 200, reps: 8, seconds: 60 },
    { id: 'best', weight: 200, reps: 10, seconds: 60 },
    { id: 'lighter', weight: 150, reps: 20, seconds: 60 },
    { id: 'longer', weight: 200, reps: 30, seconds: 120 },
    { id: 'heavier', weight: 220, reps: 2, seconds: 60 },
  ])] };
  const old = { id: 'old', strongmanLog: [entry('old-log', [{ id: 'old-set', weight: 200, reps: 12, seconds: 60 }])] };
  act(() => root.render(<StrongmanCompetitionCard routine={routine} routines={[routine, old]} />));
  const rows = [...container.querySelectorAll('.strongman-event-results > div')];
  expect(rows.find(row => row.textContent.startsWith('This plan · most reps')).textContent).toContain('200 lb · 10 reps · 60 sec');
  expect(rows.find(row => row.textContent.startsWith('Lifetime · most reps')).textContent).toContain('200 lb · 12 reps · 60 sec');
  expect(rows.find(row => row.textContent.startsWith('This plan · heaviest')).textContent).toContain('220 lb · 2 reps');
  expect(container.querySelector('.strongman-component > summary').textContent).toContain('This plan · most reps: 200 lb · 10 reps');
});
