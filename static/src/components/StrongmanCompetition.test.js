import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrongmanCompetitionCard, StrongmanCompetitionEditor, formatStrongmanTarget } from './StrongmanCompetition';

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

it('shows shared competition evidence across plans without another profile’s results', () => {
  const shared = { ...competition, id: 'meet' };
  const plan = { id: 'first', profileId: 'owner', strongmanLog: [{ ...record('first', '2026-09-01', 580, 50), competitionId: 'meet' }] };
  const other = { id: 'other', profileId: 'someone-else', strongmanLog: [{ ...record('other', '2026-09-02', 999, 100), competitionId: 'meet' }] };
  act(() => root.render(<StrongmanCompetitionCard competition={shared} profileId="owner" routines={[plan, other]} />));
  const row = [...container.querySelectorAll('.strongman-event-results > div')].find(item => item.textContent.includes('This competition · heaviest result'));
  expect(row.textContent).toContain('580 lb · 50 ft');
  expect(container.textContent).not.toContain('999');
});

it('explicitly absent shared competition does not revive an old plan snapshot', () => {
  act(() => root.render(<StrongmanCompetitionCard routine={{ inputs: { strongmanCompetition: competition } }} competition={null} onSaveCompetition={() => {}} />));
  expect(container.textContent).not.toContain('Autumn show');
  expect(container.textContent).toContain('Add competition');
});

it('confirms completion and retains failed lifecycle changes for retry', async () => {
  const onEnd = jest.fn().mockRejectedValueOnce(new Error('Storage unavailable.')).mockResolvedValueOnce();
  act(() => root.render(<StrongmanCompetitionCard competition={{ ...competition, id: 'meet' }} onEndCompetition={onEnd} />));
  click('Mark competition complete');
  expect(onEnd).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Your recorded training and records will stay saved.');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Confirm completion').click());
  expect(onEnd).toHaveBeenCalledWith('completed', { ...competition, id: 'meet' });
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage unavailable.');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Confirm completion').click());
  expect(container.querySelector('[aria-label="Confirm competition change"]')).toBeNull();
});

it.each(['Mark competition complete', 'Remove competition'])('dismisses %s confirmation if the meet automatically completes', label => {
  const shared = { ...competition, id: 'meet' };
  const onEditingChange = jest.fn();
  const render = value => root.render(<StrongmanCompetitionCard competition={value} onSaveCompetition={() => {}}
    onEndCompetition={() => {}} onEditingChange={onEditingChange} />);
  act(() => render(shared));
  click(label);
  expect(container.querySelector('[aria-label="Confirm competition change"]')).not.toBeNull();
  act(() => render(null));
  expect(container.querySelector('[aria-label="Confirm competition change"]')).toBeNull();
  expect(container.textContent).toContain('Add competition');
  expect(onEditingChange).toHaveBeenLastCalledWith(false);
});

it('keeps current-plan evidence separate from lifetime records and includes the most recent attempt', () => {
  const current = { id: 'current', name: 'Current plan', inputs: { strongmanCompetition: competition }, strongmanLog: [record('best', '2026-09-01', 580, 50), record('attempt', '2026-09-21', 600, 0, false)] };
  const past = { id: 'past', name: 'Past plan', strongmanLog: [record('past-best', '2025-09-01', 620, 100)] };
  act(() => root.render(<StrongmanCompetitionCard routine={current} routines={[current, past]} />));
  const rows = [...container.querySelectorAll('.strongman-event-results > div')];
  expect(rows.find(row => row.textContent.includes('This plan · heaviest result')).textContent).toContain('580 lb · 50 ft');
  expect(rows.find(row => row.textContent.includes('Lifetime · heaviest result')).textContent).toContain('620 lb · 100 ft');
  expect(rows.find(row => row.textContent.includes('Last trained')).textContent).toContain('Sep 21, 2026 · Attempt');
  expect(container.textContent).toContain('Competition: 600 lb · 100 ft');
});

it('explains that an implement points target alone cannot establish a timed medley task', () => {
  const event = { id: 'medley', name: 'Scored carry', type: 'medley', components: [
    { id: 'bag', name: 'Bag', weight: 200, timeGoal: 'points', points: 3 },
  ] };
  const routine = { id: 'plan', inputs: { strongmanCompetition: { events: [event] } }, strongmanLog: [] };
  act(() => root.render(<StrongmanCompetitionCard routine={routine} />));
  expect(container.textContent).toContain('a points target alone does not define the physical task');
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
  const row = [...container.querySelectorAll('.strongman-event-results > div')].find(item => item.textContent.includes('This plan · longest hold'));
  expect(row.textContent).toContain('200 lb · 45 sec');
  expect(row.textContent).not.toContain('90 sec');
});

it('offers seven record goals before their metrics and supports max targets without inventing a weight', () => {
  let latest;
  const Editor = () => {
    const [value, setValue] = useState({ events: [{ id: 'max', name: 'Max axle', type: 'single' }] });
    latest = value;
    return <StrongmanCompetitionEditor value={value} onChange={setValue} />;
  };
  act(() => root.render(<Editor />));
  const select = container.querySelector('[aria-label="Event 1 record goal"]');
  expect([...select.options].map(option => option.textContent)).toEqual([
    'Faster is better', 'Longer hold is better', 'More reps is better', 'Heavier is better',
    'Farther is better', 'Higher is better', 'More points is better',
  ]);
  change('Event 1 record goal', 'weight');
  change('Event 1 Reps', '1');
  expect(latest.events[0]).toMatchObject({ timeGoal: 'weight', reps: '1' });
  expect(container.querySelector('[aria-label="Event 1 Weight (lb)"]').value).toBe('');
  expect(container.querySelector('.strongman-time-goal').compareDocumentPosition(container.querySelector('.strongman-target-fields')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.textContent).toContain('For a max lift, leave weight blank');
});

it('keeps height separate from distance and lets pending point events retain unknown rules', () => {
  let latest;
  const Editor = () => {
    const [value, setValue] = useState(competition);
    latest = value;
    return <StrongmanCompetitionEditor value={value} onChange={setValue} />;
  };
  act(() => root.render(<Editor />));
  change('Event 1 record goal', 'height');
  change('Event 1 Height (in)', '156');
  expect(latest.events[0]).toMatchObject({ height: '156', distance: 100 });
  expect(formatStrongmanTarget(latest.events[0])).toContain('100 ft · 156 in height');
  change('Event 1 record goal', 'points');
  expect(container.querySelector('[aria-label="Event 1 scoring rules"]').required).toBe(false);
  expect(container.textContent).toContain('Enter scores manually');
  change('Event 1 Target points', '20');
  change('Event 1 scoring rules', 'Light stone = 1; heavy stone = 2');
  expect(latest.events[0]).toMatchObject({ timeGoal: 'points', points: '20', scoringRules: 'Light stone = 1; heavy stone = 2' });
  expect(formatStrongmanTarget(latest.events[0])).toContain('20 points');
});

it('offers setup rules for ordinary events, full timed medleys, and their implements', () => {
  let latest;
  const Editor = () => {
    const [value, setValue] = useState(competition);
    latest = value;
    return <StrongmanCompetitionEditor value={value} onChange={setValue} />;
  };
  act(() => root.render(<Editor />));
  change('Event 1 scoring rules', 'No drops');
  expect(latest.events[0].scoringRules).toBe('No drops');
  change('Event 1 type', 'medley');
  change('Event 1 scoring rules', 'One lap; no drops');
  click('Add implement');
  change('Event 1 implement 1 scoring rules', 'Load onto a platform');
  expect(latest.events[0]).toMatchObject({ timeGoal: 'fastest', scoringRules: 'One lap; no drops', components: [expect.objectContaining({ scoringRules: 'Load onto a platform' })] });
});

it.each([
  ['weight', 'heaviest', { reps: 1 }, { weight: 350, reps: 1 }, { weight: 380, reps: 1 }, '350 lb · 1 rep', '380 lb · 1 rep'],
  ['distance', 'farthest', { weight: 200, seconds: 60 }, { weight: 200, distance: 110, seconds: 60 }, { weight: 200, distance: 130, seconds: 60 }, '200 lb · 110 ft', '200 lb · 130 ft'],
  ['height', 'highest', { weight: 40 }, { weight: 40, height: 150 }, { weight: 40, height: 156 }, '40 lb · 150 in height', '40 lb · 156 in height'],
  ['points', 'most points', { seconds: 60, scoringRules: 'Light = 1; heavy = 2' }, { points: 12, seconds: 60 }, { points: 15, seconds: 60 }, '60 sec · 12 points', '60 sec · 15 points'],
])('shows %s records in the main card, lifetime details, and collapsed implement summary', (goal, label, target, currentSet, oldSet, currentText, oldText) => {
  const event = { id: 'event', name: 'Test event', type: 'single', timeGoal: goal, ...target };
  const entry = (id, set) => ({ id, movement: event.name, date: '2026-09-01', scope: 'movement', eventSnapshot: event, sets: [{ id: `${id}-set`, ...set }] });
  const routine = { id: 'current', inputs: { strongmanCompetition: { events: [event, { id: 'medley', name: 'Timed course', type: 'medley', components: [{ ...event, id: 'piece' }] }] } }, strongmanLog: [entry('current-entry', currentSet)] };
  const previous = { id: 'previous', strongmanLog: [entry('previous-entry', oldSet)] };
  act(() => root.render(<StrongmanCompetitionCard routine={routine} routines={[routine, previous]} />));
  const rows = [...container.querySelectorAll('.strongman-event-results > div')];
  expect(rows.find(row => row.textContent.startsWith(`This plan · ${label} at this setup`)).textContent).toContain(currentText);
  expect(rows.find(row => row.textContent.startsWith(`Lifetime · ${label} at this setup`)).textContent).toContain(oldText);
  expect(container.querySelector('.strongman-component > summary').textContent).toContain(`This plan · ${label}: ${currentText}`);
  if (goal === 'points') expect(container.textContent).not.toContain('heaviest result');
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

it('keeps strength progress visible in a collapsed timed implement before a complete run exists', () => {
  const component = { id: 'bag', name: 'Sandbag carry', weight: 300, distance: 50, timeGoal: 'fastest' };
  const routine = { id: 'current', inputs: { strongmanCompetition: { events: [
    { id: 'medley', name: 'Carry medley', type: 'medley', components: [component] },
  ] } }, strongmanLog: [{ id: 'pickup', movement: component.name, date: '2026-09-01', scope: 'movement',
    sets: [{ id: 'set', weight: 275, reps: 1, distance: '', seconds: '' }] }] };
  act(() => root.render(<StrongmanCompetitionCard routine={routine} />));
  expect(container.querySelector('.strongman-component > summary').textContent).toContain('This plan · heaviest training: 275 lb · 1 rep');
});
