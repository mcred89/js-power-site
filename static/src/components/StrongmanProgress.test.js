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

it('keeps both timing directions selectable for the same movement setup', () => {
  const entry = (id, date, seconds, timeGoal) => ({
    id, date, movement: 'Hercules hold', scope: 'movement', eventSnapshot: { timeGoal },
    sets: [{ id: `set-${id}`, weight: 200, distance: '', reps: '', seconds, successful: true }],
  });
  const routines = [{ id: 'plan', name: 'Current plan', strongmanLog: [
    entry('first', '2026-09-01', 30, 'fastest'),
    entry('second', '2026-09-02', 60, 'longest'),
  ] }];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman record setup"]');
  expect([...select.options].map(option => option.textContent)).toEqual([
    '200 lb · Fastest', '200 lb · Longest hold',
  ]);
  const timedCard = () => [...container.querySelectorAll('.strongman-record-metric')]
    .find(card => card.querySelector('small').textContent.endsWith(' · same setup'));
  expect(timedCard().querySelector('small').textContent).toBe('Fastest · same setup');
  expect(timedCard().querySelector('strong').textContent).toBe('200 lb · 30 sec');
  act(() => {
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(timedCard().querySelector('small').textContent).toBe('Longest hold · same setup');
  expect(timedCard().querySelector('strong').textContent).toBe('200 lb · 60 sec');
  act(() => {
    select.value = select.options[0].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(timedCard().querySelector('strong').textContent).toBe('200 lb · 30 sec');
  expect(container.querySelectorAll('.strongman-result-history > li')).toHaveLength(2);
});

it('compares full medley times only within the selected historical setup', () => {
  const setup = weight => ({ id: 'medley', name: 'Carry medley', type: 'medley', weight: '', reps: '', distance: '', seconds: '', components: [{ id: 'bag', name: 'Sandbag', weight, distance: 100, reps: '', seconds: '' }] });
  const entry = (id, weight, seconds) => ({ id, date: '2026-09-01', movement: 'Carry medley', scope: 'medley', eventSnapshot: setup(weight), sets: [{ id: `set-${id}`, weight: '', distance: '', reps: '', seconds }] });
  const repeatedCourse = { ...entry('repeat', 250, 40), eventSnapshot: { ...setup(250), id: 'another-meet', seconds: 90 } };
  const routines = [{ id: 'plan', name: 'Current plan', strongmanLog: [entry('heavy', 250, 45), entry('light', 150, 20), repeatedCourse] }];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman record setup"]');
  expect(select.options).toHaveLength(2);
  expect([...select.options].map(option => option.textContent)).toEqual([
    'Sandbag: 250 lb · 100 ft', 'Sandbag: 150 lb · 100 ft',
  ]);
  expect(container.querySelector('.strongman-record-metric').textContent).toContain('40 sec');
  act(() => {
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.strongman-record-metric').textContent).toContain('20 sec');
  expect(container.querySelectorAll('.strongman-result-history > li')).toHaveLength(3);
});

it('identifies medley setups and history by their implement rules', () => {
  const entry = (id, scoringRules, seconds) => ({ id, date: '2026-09-01', movement: 'Carry medley', scope: 'medley',
    eventSnapshot: { type: 'medley', components: [{ name: 'Bag', weight: 200, distance: 50, scoringRules }] },
    sets: [{ id: `set-${id}`, seconds }],
  });
  act(() => root.render(<StrongmanProgress routines={[{ id: 'plan', name: 'Current plan', strongmanLog: [entry('first', 'No drops', 40), entry('second', 'Unlimited drops', 30)] }]} />));
  const options = [...container.querySelector('[aria-label="Strongman record setup"]').options].map(option => option.textContent);
  expect(options).toEqual(['Bag: 200 lb · 50 ft · No drops', 'Bag: 200 lb · 50 ft · Unlimited drops']);
  const history = [...container.querySelectorAll('.strongman-result-history details')].map(details => details.textContent);
  expect(history.some(text => text.includes('No drops'))).toBe(true);
  expect(history.some(text => text.includes('Unlimited drops'))).toBe(true);
});

it('groups rep records by actual load and time window while keeping plan and lifetime records separate', () => {
  const entry = (id, weight, reps, seconds, successful = true) => ({
    id, date: '2026-09-01', movement: 'Log press', scope: 'movement',
    eventSnapshot: { timeGoal: 'reps', weight: 200, reps: id === 'past' ? 99 : 1, seconds: 60 },
    sets: [{ id: `set-${id}`, weight, distance: '', reps, seconds, successful }],
  });
  const routines = [
    { id: 'current', name: 'Current plan', strongmanLog: [
      entry('current', 200, 8, 60), entry('lighter', 150, 20, 60),
      entry('longer', 200, 30, 120), entry('untimed', 200, 12, ''),
      entry('heavier', 250, 1, 60), entry('failed', 200, 99, 60, false),
    ] },
    { id: 'past', name: 'Past plan', strongmanLog: [entry('past', 200, 10, 60)] },
  ];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman record setup"]');
  expect([...select.options].map(option => option.textContent)).toEqual([
    '200 lb · 60 sec time window · Most reps',
    '150 lb · 60 sec time window · Most reps',
    '200 lb · 120 sec time window · Most reps',
    '200 lb · Untimed · Most reps',
    '250 lb · 60 sec time window · Most reps',
  ]);
  const metric = label => [...container.querySelectorAll('.strongman-record-metric')]
    .find(card => card.querySelector('small').textContent === label).querySelector('strong').textContent;
  expect(metric('Most reps at this setup · all plans')).toBe('200 lb · 10 reps · 60 sec');
  act(() => {
    const plan = container.querySelector('[aria-label="Strongman plan"]');
    plan.value = 'current';
    plan.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(metric('Most reps at this setup · selected plan')).toBe('200 lb · 8 reps · 60 sec');
  expect(metric('Lifetime most reps · same setup')).toBe('200 lb · 10 reps · 60 sec');
  expect(metric('Heaviest result · selected plan')).toBe('250 lb · 1 rep · 60 sec');
  expect(metric('Lifetime heaviest result')).toBe('250 lb · 1 rep · 60 sec');
  act(() => {
    select.value = select.options[3].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(metric('Most reps at this setup · selected plan')).toBe('200 lb · 12 reps');
  expect(container.querySelectorAll('.strongman-result-history > li')).toHaveLength(6);
});

it('reuses untimed historical reps without changing their saved event goal', () => {
  const entry = (id, reps) => ({
    id, date: '2025-09-01', movement: 'Axle press', scope: 'movement',
    sets: [{ id: `set-${id}`, weight: 180, distance: '', reps, seconds: '', successful: true }],
  });
  const routines = [{ id: 'past', name: 'Past plan', strongmanLog: [entry('eight', 8), entry('ten', 10)] }];
  const original = JSON.stringify(routines);
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman record setup"]');
  expect([...select.options].map(option => option.textContent)).toEqual(['180 lb · Untimed · Most reps']);
  expect(container.querySelector('.strongman-record-metric strong').textContent).toBe('180 lb · 10 reps');
  expect(JSON.stringify(routines)).toBe(original);
});

it('retains legacy timed setups and offers a rep comparison at their shared time window', () => {
  const entry = (id, reps) => ({
    id, date: '2025-09-01', movement: 'Deadlift', scope: 'movement', eventSnapshot: { timeGoal: 'fastest' },
    sets: [{ id: `set-${id}`, weight: 400, distance: '', reps, seconds: 60, successful: true }],
  });
  const routines = [{ id: 'past', name: 'Past plan', strongmanLog: [entry('eight', 8), entry('ten', 10)] }];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman record setup"]');
  expect([...select.options].map(option => option.textContent)).toEqual([
    '400 lb · 8 reps · Fastest', '400 lb · 60 sec time window · Most reps', '400 lb · 10 reps · Fastest',
  ]);
  act(() => {
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.strongman-record-metric strong').textContent).toBe('400 lb · 10 reps · 60 sec');
  expect(container.querySelectorAll('.strongman-result-history > li')).toHaveLength(2);
});

it.each([
  ['weight', { reps: 1 }, { weight: 500, reps: 1 }, { weight: 550, reps: 1 }, { weight: 600, reps: 3 }, '550 lb · 1 rep'],
  ['distance', { weight: 200, seconds: 60 }, { weight: 200, distance: 100, seconds: 60 }, { weight: 200, distance: 120, seconds: 60 }, { weight: 100, distance: 200, seconds: 60 }, '200 lb · 120 ft · 60 sec'],
  ['height', { weight: 30 }, { weight: 30, height: 144 }, { weight: 30, height: 156 }, { weight: 20, height: 180 }, '30 lb · 156 in height'],
])('groups %s records without the scored metric and keeps other setups separate', (timeGoal, fixed, first, better, different, expected) => {
  const entry = (id, set, rules = 'Same competition rules') => ({
    id, date: '2026-09-01', movement: 'Test event', scope: 'movement',
    eventSnapshot: { id: 'event', type: 'single', name: 'Test event', timeGoal, ...fixed, scoringRules: rules },
    sets: [{ id: `set-${id}`, weight: '', reps: '', distance: '', seconds: '', height: '', ...set }],
  });
  const routines = [{ id: 'plan', name: 'Current plan', strongmanLog: [
    entry('first', first), entry('better', better), entry('different', different),
    entry('other-rules', different, 'Other competition rules'),
  ] }];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  const select = container.querySelector('[aria-label="Strongman record setup"]');
  expect(select.options).toHaveLength(3);
  expect(container.querySelector('.strongman-record-metric strong').textContent).toBe(expected);
  expect([...select.options].some(option => option.textContent.includes('Other competition rules'))).toBe(true);
  expect(container.querySelectorAll('.strongman-result-history > li')).toHaveLength(4);
});

it('keeps manual points scores separate by their recorded rules and time window', () => {
  const entry = (id, points, seconds, scoringRules) => ({
    id, date: '2026-09-01', movement: 'Choice log', scope: 'movement',
    eventSnapshot: { id: 'event', type: 'single', name: 'Choice log', timeGoal: 'points', scoringRules, seconds: 60 },
    sets: [{ id: `set-${id}`, points, seconds }],
  });
  const routines = [{ id: 'plan', name: 'Current plan', strongmanLog: [
    entry('first', 10, 60, 'Heavy rep = 5 points; light rep = 1'),
    entry('better', 15, 60, 'Heavy rep = 5 points; light rep = 1'),
    entry('longer', 50, 120, 'Heavy rep = 5 points; light rep = 1'),
    entry('other-rules', 100, 60, 'Heavy rep = 100 points; light rep = 1'),
  ] }];
  act(() => root.render(<StrongmanProgress routines={routines} />));
  expect(container.querySelector('[aria-label="Strongman record setup"]').options).toHaveLength(3);
  expect(container.querySelector('.strongman-record-metric strong').textContent).toContain('15 points');
  expect(container.querySelector('.strongman-record-metric strong').textContent).not.toContain('100 points');
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
