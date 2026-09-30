import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { StrongmanResultEditor, StrongmanTraining } from './StrongmanTraining';

const competition = { name: 'Fall meet', events: [
  { id: 'yoke', name: 'Zercher yoke', type: 'single', weight: 600, distance: 100, components: [] },
  { id: 'medley', name: 'Carry medley', type: 'medley', components: [
    { id: 'sandbag', name: 'Sandbag', weight: 250, distance: 50 },
    { id: 'frame', name: 'Frame', weight: 500, distance: 50 },
    { id: 'stone', name: 'Stone', weight: '', distance: '' },
  ] },
] };
const workout = { id: 'strongman-day' };
const baseRoutine = { id: 'routine', inputs: { strongmanCompetition: competition }, strongmanLog: [] };
let container;
let root;

const click = async text => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  await act(async () => { button.click(); });
};
const change = (label, value, index = 0) => {
  const field = [...container.querySelectorAll('label')].filter(item => item.querySelector('.field-label')?.textContent === label)[index];
  if (!field) throw new Error(`Missing field ${label}`);
  const input = field.querySelector('input,select,textarea');
  act(() => { Simulate.change(input, { target: { value } }); });
};
const submit = async () => {
  await act(async () => { Simulate.submit(container.querySelector('form')); });
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

it('starts without prescriptions and saves an actual one-set carry linked to the day', async () => {
  const onSaveLog = jest.fn().mockResolvedValue(undefined);
  const onEditingChange = jest.fn();
  act(() => root.render(<StrongmanTraining routine={baseRoutine} workout={workout} onSaveLog={onSaveLog} onEditingChange={onEditingChange} />));
  expect(container.querySelectorAll('input')).toHaveLength(0);
  await click('Add exercise');
  change('Exercise', 'event:yoke');
  expect(onEditingChange).toHaveBeenLastCalledWith(true);
  expect(container.querySelectorAll('.strongman-training-set')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-set input').value).toBe('');
  change('Weight (lb)', '580');
  change('Distance (ft)', '50');
  await submit();
  expect(onSaveLog).toHaveBeenCalledWith([expect.objectContaining({
    movement: 'Zercher yoke', workoutId: workout.id, eventId: 'yoke', scope: 'movement',
    sets: [expect.objectContaining({ weight: 580, distance: 50, reps: '', successful: true })],
  })]);
  expect(onEditingChange).toHaveBeenLastCalledWith(false);
});

it('lets an unknown medley implement be logged on its own without prescribing targets', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onCancel = jest.fn();
  act(() => root.render(<StrongmanResultEditor competition={competition} onSave={onSave} onCancel={onCancel} />));
  change('Exercise', 'component:medley:stone');
  change('Weight (lb)', '200');
  change('Reps', '1');
  await submit();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    movement: 'Stone', eventId: 'medley', componentId: 'stone', scope: 'movement', eventSnapshot: expect.objectContaining({ name: 'Stone', type: 'single' }),
    sets: [expect.objectContaining({ weight: 200, reps: 1, distance: '' })],
  }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('preserves a failed attempt with zero reps and adds unprescribed sets', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanResultEditor competition={competition} onSave={onSave} onCancel={() => {}} />));
  change('Exercise', 'custom');
  change('Movement', 'Axle clean');
  change('Weight (lb)', '240');
  change('Reps', '0');
  change('Result', 'failed');
  await click('Add set');
  change('Weight (lb)', '220', 1);
  change('Reps', '1', 1);
  await submit();
  expect(onSave.mock.calls[0][0].sets).toEqual([
    expect.objectContaining({ weight: 240, reps: 0, successful: false }),
    expect.objectContaining({ weight: 220, reps: 1, successful: true }),
  ]);
});

it('keeps a draft open during persistence and after failure, then closes after a successful retry', async () => {
  let reject;
  const onSave = jest.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const onCancel = jest.fn();
  act(() => root.render(<StrongmanResultEditor competition={competition} onSave={onSave} onCancel={onCancel} />));
  change('Exercise', 'event:yoke');
  change('Weight (lb)', '580');
  await submit();
  expect(container.querySelector('fieldset').disabled).toBe(true);
  expect(onCancel).not.toHaveBeenCalled();
  await act(async () => { reject(new Error('Storage is full')); });
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is full');
  expect(container.querySelector('.strongman-training-set input').value).toBe('580');
  expect(onCancel).not.toHaveBeenCalled();
  await submit();
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('saves retrospective cycle training with the chosen date and no current workout link', async () => {
  const onSaveLog = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanTraining routine={baseRoutine} workout={workout} onSaveLog={onSaveLog} />));
  await click('Log past training');
  change('Exercise', 'event:yoke');
  change('Training date', '2025-01-10');
  change('Weight (lb)', '580');
  change('Distance (ft)', '50');
  await submit();
  expect(onSaveLog.mock.calls[0][0][0]).toEqual(expect.objectContaining({ workoutId: null, date: '2025-01-10' }));
  expect(container.textContent).toContain('Past training saved.');
});

it('retains the actual medley setup and complete/failed runs separately from implement work', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanResultEditor competition={competition} onSave={onSave} onCancel={() => {}} />));
  change('Exercise', 'event:medley');
  change('Weight (lb)', '200', 2);
  change('Distance (ft)', '40', 2);
  change('Time (s)', '45', 3);
  change('Result', 'failed');
  await click('Add run');
  change('Time (s)', '42', 4);
  await submit();
  const result = onSave.mock.calls[0][0];
  expect(result.scope).toBe('medley');
  expect(result.eventSnapshot.components[2]).toEqual(expect.objectContaining({ name: 'Stone', weight: 200, distance: 40 }));
  expect(result.sets).toEqual([
    expect.objectContaining({ seconds: 45, successful: false }),
    expect.objectContaining({ seconds: 42, successful: true }),
  ]);
  expect(competition.events[1].components[2].weight).toBe('');
});

it('adds another set directly to a saved exercise while keeping past training off the day list', async () => {
  const entry = { id: 'entry', date: '2025-01-10', movement: 'Zercher yoke', scope: 'movement', workoutId: workout.id,
    sets: [{ id: 'one', weight: 580, distance: 50, reps: '', seconds: '', successful: true }] };
  const onSaveLog = jest.fn().mockResolvedValue(undefined);
  const routine = { ...baseRoutine, strongmanLog: [entry, { ...entry, id: 'past', workoutId: null, movement: 'Historical stone' }] };
  act(() => root.render(<StrongmanTraining routine={routine} workout={workout} onSaveLog={onSaveLog} />));
  expect(container.textContent).not.toContain('Historical stone');
  await click('Add set');
  expect(container.querySelectorAll('.strongman-training-set')).toHaveLength(2);
  expect(document.activeElement).toBe(container.querySelectorAll('.strongman-training-set')[1].querySelector('input'));
  change('Weight (lb)', '590', 1);
  change('Distance (ft)', '25', 1);
  await submit();
  expect(onSaveLog.mock.calls[0][0][0].sets).toHaveLength(2);
  expect(onSaveLog.mock.calls[0][0][1]).toEqual(routine.strongmanLog[1]);
});

it('clears hidden movement metrics when switching to a full medley while retaining time and outcome', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanResultEditor competition={competition} onSave={onSave} onCancel={() => {}} />));
  change('Exercise', 'event:yoke');
  change('Weight (lb)', '600');
  change('Reps', '0');
  change('Distance (ft)', '0');
  change('Time (s)', '42');
  change('Result', 'failed');
  change('Exercise', 'event:medley');
  expect(container.querySelectorAll('.strongman-training-set input')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-set input').value).toBe('42');
  expect(container.querySelector('.strongman-training-set select').value).toBe('failed');
  change('Exercise', 'event:yoke');
  expect([...container.querySelectorAll('.strongman-training-set input')].map(input => input.value)).toEqual(['', '', '', '42']);
  change('Exercise', 'event:medley');
  change('Result', 'completed');
  await submit();
  expect(onSave.mock.calls[0][0].sets).toEqual([
    expect.objectContaining({ weight: '', reps: '', distance: '', seconds: 42, successful: true }),
  ]);
});

it('corrects an existing full medley without retaining hidden movement metrics or changing its setup', async () => {
  const entry = { id: 'legacy-medley', date: '2025-01-10', movement: 'Carry medley', scope: 'medley',
    eventSnapshot: competition.events[1], sets: [{ id: 'run', weight: 600, reps: 0, distance: 0, seconds: 42, successful: true }] };
  const original = JSON.stringify(entry);
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanResultEditor entry={entry} competition={competition} onSave={onSave} onCancel={() => {}} />));
  expect(container.querySelectorAll('.strongman-training-set input')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-set input').value).toBe('42');
  await submit();
  expect(onSave.mock.calls[0][0].sets).toEqual([
    expect.objectContaining({ id: 'run', weight: '', reps: '', distance: '', seconds: 42, successful: true }),
  ]);
  expect(onSave.mock.calls[0][0].eventSnapshot.components).toEqual(competition.events[1].components.map(component => expect.objectContaining(component)));
  expect(JSON.stringify(entry)).toBe(original);
});

it.each(['switched', 'saved'])('requires a visible run time for a %s medley with old movement metrics', async mode => {
  const entry = mode === 'saved' ? { id: 'legacy-medley', date: '2025-01-10', movement: 'Carry medley', scope: 'medley',
    eventSnapshot: competition.events[1], sets: [{ id: 'run', weight: 600, reps: 1, distance: 50, seconds: '', successful: true }] } : null;
  const onSave = jest.fn();
  const onCancel = jest.fn();
  act(() => root.render(<StrongmanResultEditor entry={entry} competition={competition} onSave={onSave} onCancel={onCancel} />));
  if (!entry) {
    change('Exercise', 'event:yoke');
    change('Weight (lb)', '600');
    change('Reps', '1');
    change('Distance (ft)', '50');
    change('Exercise', 'event:medley');
  }
  await submit();
  expect(container.querySelector('[role="alert"]').textContent).toMatch(/time/i);
  expect(onSave).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  expect(container.querySelector('.strongman-training-set input').value).toBe('');
});

it('adds a saved medley run as a new entry so changing its setup cannot rewrite earlier runs', async () => {
  const entry = {
    id: 'old-medley', date: '2025-01-10', movement: 'Carry medley', scope: 'medley', workoutId: workout.id,
    eventId: 'medley', componentId: null, notes: 'Old setup felt heavy',
    createdAt: '2025-01-10T12:00:00.000Z', updatedAt: '2025-01-10T12:30:00.000Z',
    eventSnapshot: { ...competition.events[1], components: competition.events[1].components.map(component => ({ ...component })) },
    sets: [{ id: 'old-run-one', seconds: 50, successful: true }, { id: 'old-run-two', seconds: 45, successful: true }],
  };
  const original = JSON.stringify(entry);
  const onSaveLog = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanTraining routine={{ ...baseRoutine, strongmanLog: [entry] }} workout={workout} onSaveLog={onSaveLog} />));
  await click('Add run');
  expect(container.querySelector('form h3').textContent).toBe('Add run');
  expect(container.querySelectorAll('.strongman-training-set')).toHaveLength(1);
  expect(container.querySelector('.strongman-training-set input').value).toBe('');
  expect(container.querySelector('input[type="date"]').value).toBe(entry.date);
  expect(container.textContent).toContain('Every run in this entry shares this setup.');
  change('Weight (lb)', '275', 0);
  change('Time (s)', '42', 3);
  await submit();
  const saved = onSaveLog.mock.calls[0][0];
  expect(saved).toHaveLength(2);
  expect(saved[0]).toBe(entry);
  expect(JSON.stringify(entry)).toBe(original);
  expect(saved[1]).toMatchObject({ date: entry.date, workoutId: workout.id, eventId: 'medley', notes: '',
    sets: [expect.objectContaining({ seconds: 42, successful: true })] });
  expect(saved[1].id).not.toBe(entry.id);
  expect(saved[1].sets[0].id).not.toBe(entry.sets[0].id);
  expect(saved[1].createdAt).not.toBe(entry.createdAt);
  expect(saved[1].updatedAt).not.toBe(entry.updatedAt);
  expect(saved[1].eventSnapshot.components[0].weight).toBe(275);
  expect(saved[0].eventSnapshot.components[0].weight).toBe(250);
});

it('repairs an empty historical medley setup by adding and removing actual implements', async () => {
  const entry = { id: 'unknown-medley', date: '2025-01-10', movement: 'Carry medley', scope: 'medley',
    workoutId: workout.id, eventId: 'medley', eventSnapshot: { id: 'medley', name: 'Carry medley', type: 'medley', components: [] },
    sets: [{ id: 'old-run', seconds: 50, successful: true }] };
  const original = JSON.stringify(entry);
  const onSave = jest.fn().mockResolvedValue(undefined);
  act(() => root.render(<StrongmanResultEditor entry={entry} competition={competition} onSave={onSave} onCancel={() => {}} />));
  expect(container.querySelectorAll('.strongman-training-implement')).toHaveLength(0);
  await click('Add actual implement');
  change('Implement 1', 'Wrong implement');
  await click('Add actual implement');
  change('Implement 2', 'Sandbag');
  change('Weight (lb)', '250', 1);
  change('Distance (ft)', '50', 1);
  await act(async () => { container.querySelector('[aria-label="Remove actual implement 1"]').click(); });
  expect(container.querySelectorAll('.strongman-training-implement')).toHaveLength(1);
  await submit();
  const saved = onSave.mock.calls[0][0];
  expect(saved.id).toBe(entry.id);
  expect(saved.eventSnapshot.components).toEqual([expect.objectContaining({ name: 'Sandbag', weight: 250, distance: 50 })]);
  expect(saved.sets).toEqual([expect.objectContaining({ id: 'old-run', seconds: 50 })]);
  expect(JSON.stringify(entry)).toBe(original);
  expect(competition.events[1].components).toHaveLength(3);
});

it('rejects blank results without calling persistence', async () => {
  const onSave = jest.fn();
  act(() => root.render(<StrongmanResultEditor competition={competition} onSave={onSave} onCancel={() => {}} />));
  change('Exercise', 'event:yoke');
  await submit();
  expect(container.querySelector('[role="alert"]').textContent).toContain('Enter weight, reps, distance, or time');
  expect(onSave).not.toHaveBeenCalled();
});

it('defaults new entries on a completed day to that workout date', async () => {
  act(() => root.render(<StrongmanTraining routine={baseRoutine}
    workout={{ ...workout, completedAt: '2025-01-10T12:00:00' }} onSaveLog={jest.fn()} />));
  await click('Add exercise');
  change('Exercise', 'event:yoke');
  expect(container.querySelector('input[type="date"]').value).toBe('2025-01-10');
});

it('preserves longer-is-better hold records and lets custom timed work choose the same direction', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const holds = { events: [{ id: 'hold', name: 'Hercules hold', type: 'single', timeGoal: 'longest', weight: 200 }] };
  act(() => root.render(<StrongmanResultEditor competition={holds} onSave={onSave} onCancel={() => {}} />));
  change('Exercise', 'event:hold');
  change('Time (s)', '60');
  expect([...container.querySelectorAll('select')].find(select => select.value === 'longest')).toBeTruthy();
  await submit();
  expect(onSave.mock.calls[0][0].eventSnapshot.timeGoal).toBe('longest');
  change('Exercise', 'custom');
  change('Movement', 'Grip hold');
  change('Time record', 'longest');
  await submit();
  expect(onSave.mock.calls[1][0].eventSnapshot).toEqual(expect.objectContaining({ name: 'Grip hold', type: 'single', timeGoal: 'longest' }));
});

it('requires explicit delete confirmation and preserves the entry after a failed delete', async () => {
  const entry = { id: 'entry', date: '2025-01-10', movement: 'Zercher yoke', scope: 'movement', workoutId: workout.id,
    sets: [{ id: 'one', weight: 580, distance: 50, successful: true }] };
  const onSaveLog = jest.fn().mockRejectedValueOnce(new Error('Could not write')).mockResolvedValue(undefined);
  act(() => root.render(<StrongmanTraining routine={{ ...baseRoutine, strongmanLog: [entry] }} workout={workout} onSaveLog={onSaveLog} />));
  await click('Delete');
  expect(onSaveLog).not.toHaveBeenCalled();
  await click('Delete exercise');
  expect(container.querySelector('[role="alert"]').textContent).toBe('Could not write');
  expect(container.textContent).toContain('580 lb');
  await click('Delete exercise');
  expect(onSaveLog).toHaveBeenLastCalledWith([]);
  expect(container.querySelector('[aria-label="Confirm delete exercise"]')).toBeNull();
});
