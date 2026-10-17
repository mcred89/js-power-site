import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { StrongmanResultEditor } from './StrongmanResultEditor';

const savedSet = (id, values = {}) => ({
  id, weight: 200, reps: 3, distance: '', seconds: '', height: '', points: '', successful: true, ...values,
});
const savedEntry = values => ({
  id: 'axle-entry', date: '2025-01-10', workoutId: 'day', movement: 'Axle press', scope: 'movement',
  competitionId: null, eventId: null, componentId: null, eventSnapshot: null, notes: '',
  sets: [savedSet('one'), savedSet('two', { weight: 210, reps: 2 })], ...values,
});
let container;
let root;
const render = props => act(() => root.render(<StrongmanResultEditor onSave={jest.fn()} onCancel={jest.fn()} {...props} />));
const field = label => {
  const wrapper = [...container.querySelectorAll('label')].find(item => item.querySelector('.field-label')?.textContent === label);
  if (!wrapper) throw new Error(`Missing ${label}`);
  return wrapper.querySelector('input,select,textarea');
};
const change = (label, value) => act(() => Simulate.change(field(label), { target: { value } }));
const submit = async () => act(async () => Simulate.submit(container.querySelector('form')));
const click = async text => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === text);
  if (!button) throw new Error(`Missing ${text}`);
  await act(async () => button.click());
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it('opens only the requested saved set and preserves all other results while correcting it', async () => {
  const entry = savedEntry({ sets: [savedSet('one', { height: 48, points: 2, seconds: 60 }), savedSet('two')] });
  const original = JSON.stringify(entry);
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry, editSetId: 'two', onSave });
  expect(container.querySelectorAll('.strongman-training-set')).toHaveLength(1);
  expect(container.querySelectorAll('.strongman-training-saved-set')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-saved-set button')).toBeNull();
  expect(container.querySelector('.strongman-training-set h4').textContent).toBe('Set 2 of 2');
  expect(document.activeElement).toBe(field('Weight (lb)'));
  expect(container.textContent).toContain('48 in height · 60 s · 2 points');
  change('Reps', '4');
  await submit();
  expect(onSave.mock.calls[0][0].sets[0]).toEqual(entry.sets[0]);
  expect(onSave.mock.calls[0][0].sets[0]).toBe(entry.sets[0]);
  expect(onSave.mock.calls[0][0].sets[1]).toEqual({ ...entry.sets[1], reps: 4 });
  expect(JSON.stringify(entry)).toBe(original);
  expect(container.querySelector('button[type="submit"]').textContent).toBe('Save changes');
});

it('splits only the corrected medley run when its implement setup changes', async () => {
  const entry = savedEntry({ movement: 'Carry medley', scope: 'medley', notes: 'Heavy course',
    createdAt: '2025-01-10T10:00:00.000Z', updatedAt: '2025-01-10T11:00:00.000Z',
    eventSnapshot: { id: 'medley', name: 'Carry medley', type: 'medley', components: [
      { id: 'bag', name: 'Sandbag', weight: 250, distance: 50 },
    ] }, sets: [savedSet('first-run', { weight: '', reps: '', seconds: 50 }), savedSet('second-run', { weight: '', reps: '', seconds: 45 })],
  });
  const original = JSON.stringify(entry);
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry, editSetId: 'second-run', onSave });
  change('Weight (lb)', '275');
  change('Time (s)', '42');
  await submit();
  const [corrected, retained] = onSave.mock.calls[0];
  expect(corrected.id).not.toBe(entry.id);
  expect(corrected.createdAt).not.toBe(entry.createdAt);
  expect(corrected.eventSnapshot.components[0].weight).toBe(275);
  expect(corrected.sets).toEqual([expect.objectContaining({ id: 'second-run', seconds: 42 })]);
  expect(retained).toEqual({ ...entry, sets: [entry.sets[0]] });
  expect(retained.sets[0]).toBe(entry.sets[0]);
  expect(retained.eventSnapshot).toBe(entry.eventSnapshot);
  expect(JSON.stringify(entry)).toBe(original);
});

it.each([
  ['Movement', 'Axle clean'], ['Training date', '2025-01-09'], ['Notes (optional)', 'Different implement'],
  ['Record goal', 'reps'], ['Scoring rules', 'No belt'],
])('isolates a row correction that changes shared %s', async (label, value) => {
  const entry = savedEntry();
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry, editSetId: 'two', onSave });
  change(label, value);
  await submit();
  const [corrected, retained] = onSave.mock.calls[0];
  expect(corrected.id).not.toBe(entry.id);
  expect(corrected.sets).toEqual([entry.sets[1]]);
  expect(retained).toEqual({ ...entry, sets: [entry.sets[0]] });
});

it('updates a single-set entry in place when correcting its shared setup', async () => {
  const entry = savedEntry({ sets: [savedSet('one')] });
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry, editSetId: 'one', onSave });
  change('Scoring rules', 'No belt');
  await submit();
  expect(onSave.mock.calls[0]).toHaveLength(1);
  expect(onSave.mock.calls[0][0]).toMatchObject({ id: entry.id, eventSnapshot: { scoringRules: 'No belt' }, sets: entry.sets });
});

it('does not redirect a missing set correction onto a different saved set', async () => {
  const onSave = jest.fn();
  render({ entry: savedEntry(), editSetId: 'no-longer-present', onSave });
  expect(container.querySelector('.strongman-training-set')).toBeNull();
  await submit();
  expect(onSave).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]').textContent).toContain('This set is no longer available');
});

it('switches between compact set summaries without losing unsaved changes', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry: savedEntry(), onSave });
  change('Reps', '5');
  await click('Edit set 2');
  expect(container.querySelectorAll('.strongman-training-set')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-saved-set').textContent).toContain('5 reps');
  change('Weight (lb)', '215');
  await click('Edit set 1');
  expect(field('Reps').value).toBe('5');
  await submit();
  expect(onSave.mock.calls[0][0].sets).toEqual([
    expect.objectContaining({ id: 'one', weight: 200, reps: 5 }),
    expect.objectContaining({ id: 'two', weight: 215, reps: 2 }),
  ]);
});

it('logs one additional set and preserves the original notes and set identities', async () => {
  const entry = savedEntry({ notes: 'Use thick axle' });
  const draft = { ...entry, id: 'new-entry', sets: [savedSet('three', { weight: 215, reps: 1 })] };
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry: draft, appendToEntry: entry, newSet: true, onSave });
  expect(container.querySelector('h3').textContent).toBe('Axle press · Set 3');
  expect(container.querySelector('button[type="submit"]').textContent).toBe('Log set');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Add set')).toBe(false);
  await submit();
  expect(onSave.mock.calls[0][0]).toMatchObject({ id: entry.id, notes: entry.notes, sets: [...entry.sets, draft.sets[0]] });
});

it('keeps custom movement and optional metrics in place while typing', () => {
  render({ workoutId: 'day' });
  change('Exercise', 'custom');
  const movement = field('Movement');
  change('Movement', 'A');
  expect(field('Movement')).toBe(movement);
  expect(movement.closest('details')).toBeNull();
  const height = field('Height (in)');
  change('Height (in)', '4');
  expect(field('Height (in)')).toBe(height);
  change('Height (in)', '48');
  expect(field('Height (in)').value).toBe('48');
  expect(container.querySelector('input[type="date"]').closest('details').querySelector('summary').textContent).toBe('Exercise details');
});

it('keeps unnamed competition implements editable after entering their name', () => {
  render({ workoutId: 'day', competition: { events: [{ id: 'medley', name: 'Medley', type: 'medley', components: [{ id: 'unknown', name: '' }] }] } });
  change('Exercise', 'component:medley:unknown');
  const input = field('Movement');
  change('Movement', 'S');
  expect(field('Movement')).toBe(input);
  expect(input.closest('details')).toBeNull();
});

it('shows backfill dates and unsuccessful outcomes without opening optional setup', () => {
  render({ entry: savedEntry({ workoutId: null, sets: [savedSet('failed', { reps: 0, successful: false })] }) });
  expect(field('Training date').closest('details')).toBeNull();
  expect(field('Result').closest('details').open).toBe(true);
  expect(container.querySelector('.strongman-editor-details').open).toBe(false);
});

it('preserves medley setup behind a preview while logging one run', async () => {
  const entry = savedEntry({ movement: 'Carry medley', scope: 'medley', eventSnapshot: {
    id: 'medley', name: 'Carry medley', type: 'medley', components: [
      { id: 'bag', name: 'Sandbag', weight: 250, distance: 50, height: 48, points: 2, scoringRules: 'No drops' },
      { id: 'frame', name: 'Frame', weight: 500, distance: 50 },
    ],
  }, sets: [savedSet('run', { weight: '', reps: '', seconds: 45 })] });
  const onSave = jest.fn().mockResolvedValue(undefined);
  render({ entry, newRun: true, onSave });
  expect(container.querySelector('.strongman-editor-setup').open).toBe(false);
  expect(container.querySelector('.strongman-editor-setup > summary').textContent).toBe('Actual event setup · Sandbag (250 lb · 50 ft · 48 in height · 2 points); Frame (500 lb · 50 ft)');
  expect(container.querySelectorAll('.strongman-training-set input')).toHaveLength(1);
  expect(container.querySelector('button[type="submit"]').textContent).toBe('Log run');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Add run')).toBe(false);
  change('Time (s)', '42');
  await submit();
  expect(onSave.mock.calls[0][0].sets[0].seconds).toBe(42);
  expect(onSave.mock.calls[0][0].eventSnapshot.components[0]).toMatchObject(entry.eventSnapshot.components[0]);
});

it('guards duplicate submissions and retains the compact draft after a persistence failure', async () => {
  let rejectSave;
  const onSave = jest.fn().mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
  const onCancel = jest.fn();
  render({ entry: savedEntry(), onSave, onCancel });
  change('Reps', '7');
  await submit();
  await submit();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(container.querySelector('fieldset').disabled).toBe(true);
  await act(async () => rejectSave(new Error('Storage is full')));
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is full');
  expect(field('Reps').value).toBe('7');
  expect(onCancel).not.toHaveBeenCalled();
  await submit();
  expect(onCancel).toHaveBeenCalledTimes(1);
});
