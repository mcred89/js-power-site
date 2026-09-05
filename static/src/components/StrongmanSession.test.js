import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import StrongmanSession from './StrongmanSession';

global.IS_REACT_ACT_ENVIRONMENT = true;
const routine = { inputs: { events: [{ id: 'event1', name: 'Sandbag', practices: [{ id: 'practice1', name: 'Sandbag carry', recipe: null }] }] } };
const workout = {
  id: 'day1', name: 'Strongman', weekLabel: 'Week 1',
  exercises: [{ id: 'block1', eventId: 'event1', practiceId: 'practice1', assessment: true, reason: 'Establish a baseline', generated: { movement: 'Sandbag carry', event: { recipe: null } } }],
  session: { status: 'inProgress', startedAt: '2026-01-01T10:00:00Z', runningSince: null, elapsedSeconds: 0, exercises: [] },
};
const render = (overrides = {}) => {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const props = { onUpdate: jest.fn(), onFinish: jest.fn(), onSaveRecipe: jest.fn(), onLeave: jest.fn() };
  act(() => root.render(<StrongmanSession routine={routine} workout={workout} {...props} {...overrides} />));
  const click = label => act(() => [...div.querySelectorAll('button')].find(item => item.textContent === label).click());
  const change = (label, value) => act(() => {
    const input = div.querySelector(`[aria-label="${label}"]`);
    const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  return { div, props, click, change, cleanup: () => { act(() => root.unmount()); div.remove(); } };
};

it('persists unknown setup immediately and records an unsuccessful zero-distance attempt separately from blank', () => {
  const view = render();
  expect(view.div.textContent).toContain('Baseline assessment');
  view.change('Block 1 weight', '300');
  expect(view.props.onUpdate).toHaveBeenCalled();
  view.change('Block 1 distance', '0');
  view.change('Block 1 outcome', 'unsuccessful');
  view.click('Record attempt');
  const changed = view.props.onUpdate.mock.calls.at(-1)[0];
  expect(changed.session.eventBlocks[0].attempts[0]).toMatchObject({ weight: 300, distance: 0, reps: null, outcome: 'unsuccessful' });
  expect(view.props.onSaveRecipe).not.toHaveBeenCalled();
  view.cleanup();
});

it('undoes an attempt and requires an explicit action to save future work', () => {
  const view = render();
  view.change('Block 1 weight', '180');
  view.change('Block 1 distance', '40');
  view.click('Record attempt');
  view.click('Undo latest attempt');
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0].attempts).toHaveLength(0);
  view.click('Use this prescription next time');
  expect(view.props.onSaveRecipe).toHaveBeenCalledWith('event1', 'practice1', expect.objectContaining({ weight: 180, distance: 40 }), 'normal');
  view.click('Finish event day');
  expect(view.props.onFinish.mock.calls[0][0].session.eventBlocks[0].status).toBe('skipped');
  view.cleanup();
});

it('retains the practiced variation identity after an attempt has been recorded', () => {
  const withVariation = { inputs: { events: [{ ...routine.inputs.events[0], practices: [...routine.inputs.events[0].practices, { id: 'practice2', name: 'Lighter carry', recipe: null }] }] } };
  const view = render({ routine: withVariation });
  view.change('Block 1 weight', '200');
  view.click('Record attempt');
  expect(view.div.querySelector('[aria-label="Block 1 practice"]').disabled).toBe(true);
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0].attempts[0]).toMatchObject({ practiceId: 'practice1', eventId: 'event1' });
  view.cleanup();
});

it('renders immutable completed history without editable controls', () => {
  const completed = { ...workout, completedAt: '2026-01-01T11:00:00Z', session: { ...workout.session, eventBlocks: [{ id: 'block1', movement: 'Sandbag carry', setup: 'Turf', recipe: null, attempts: [{ id: 'a1', weight: 200, distance: 40, outcome: 'successful' }], status: 'completed' }] } };
  const view = render({ workout: completed, onUpdate: undefined });
  expect(view.div.textContent).toContain('200 lb');
  expect(view.div.querySelectorAll('input, select')).toHaveLength(0);
  expect(view.div.textContent).not.toContain('Finish event day');
  view.cleanup();
});

it('records paired work by component without changing the other component prescription', () => {
  const recipe = { parts: [{ id: 'pick', name: 'Pick', sets: 3, weight: 240, reps: 1, capabilityIds: ['pick-cap'] }, { id: 'carry', name: 'Lighter carry', sets: 2, weight: 180, distance: 40 }] };
  const pairedWorkout = { ...workout, exercises: [{ ...workout.exercises[0], generated: { movement: 'Pick and carry practice', event: recipe } }] };
  const view = render({ workout: pairedWorkout });
  view.change('Block 1 component', 'carry');
  view.change('Block 1 distance', '50');
  view.click('Record attempt');
  const block = view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0];
  expect(block.attempts[0]).toMatchObject({ partId: 'carry', weight: 180, distance: 50 });
  view.click('Use this prescription next time');
  const saved = view.props.onSaveRecipe.mock.calls[0][2];
  expect(saved.parts[0]).toEqual(recipe.parts[0]);
  expect(saved.parts[1]).toMatchObject({ distance: 50, sets: 2 });
  view.cleanup();
});

it('undoes the recorded attempt while preserving edits made afterward', () => {
  const view = render();
  view.change('Block 1 weight', '200');
  view.click('Record attempt');
  view.change('Block 1 notes', 'Keep this cue for next time');
  view.change('Block 1 distance', '25');
  view.click('Undo latest attempt');
  const block = view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0];
  expect(block.attempts).toHaveLength(0);
  expect(block.draft).toMatchObject({ distance: 25, notes: 'Keep this cue for next time' });
  view.cleanup();
});

it('finishes known work with explicit remaining skips and preserves completed attempts', () => {
  const planned = { ...workout, exercises: [{ ...workout.exercises[0], generated: { movement: 'Sandbag carry', event: { sets: 3, weight: 180, distance: 40 } } }] };
  const view = render({ workout: planned });
  view.click('Record attempt');
  view.click('Finish event day');
  const block = view.props.onFinish.mock.calls[0][0].session.eventBlocks[0];
  expect(block.attempts.map(attempt => attempt.status)).toEqual(['completed', 'skipped', 'skipped']);
  expect(block.attempts[0]).not.toHaveProperty('sets');
  expect(block.attempts[1].distance).toBeNull();
  expect(block.status).toBe('completed');
  view.cleanup();
});

it('allows an explicit extra practice without changing normal-day work', () => {
  const view = render();
  view.change('Extra practice', 'event1:practice1');
  view.click('Add extra practice');
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks).toHaveLength(2);
  expect(view.props.onSaveRecipe).not.toHaveBeenCalled();
  view.cleanup();
});

it('shows a failed future-prescription save instead of reporting success', async () => {
  const onSaveRecipe = jest.fn(() => Promise.reject(new Error('Save did not complete')));
  const view = render({ onSaveRecipe });
  view.change('Block 1 weight', '180');
  await act(async () => { [...view.div.querySelectorAll('button')].find(item => item.textContent === 'Use this prescription next time').click(); });
  expect(view.div.textContent).toContain('Save did not complete');
  expect(view.div.textContent).not.toContain('selected for future practice');
  view.cleanup();
});

it('uses saved equipment conditions for an unknown baseline without inventing loads', () => {
  const configured = { inputs: { events: [{ ...routine.inputs.events[0], practices: [{ ...routine.inputs.events[0].practices[0], setup: '150 / 200 / 250 lb bags; turf', focus: 'Pick consistency' }] }] } };
  const view = render({ routine: configured });
  expect(view.div.querySelector('[aria-label="Block 1 setup"]').value).toBe('150 / 200 / 250 lb bags; turf');
  expect(view.div.querySelector('[aria-label="Block 1 weight"]').value).toBe('');
  expect(view.div.textContent).toContain('Pick consistency');
  view.cleanup();
});

const pairedRecipe = { parts: [{ id: 'pick', name: 'Pick', sets: 3, weight: 240, reps: 1 }, { id: 'carry', name: 'Carry', sets: 2, weight: 180, distance: 40 }] };
const pairedDay = { ...workout, exercises: [{ ...workout.exercises[0], generated: { movement: 'Pick and carry', event: pairedRecipe } }] };

it('preserves successive accepted component changes without rewriting the session prescription', async () => {
  const view = render({ workout: pairedDay });
  view.change('Block 1 weight', '250');
  await act(async () => view.click('Use this prescription next time'));
  view.change('Block 1 component', 'carry');
  view.change('Block 1 distance', '50');
  await act(async () => view.click('Use this prescription next time'));
  expect(view.props.onSaveRecipe.mock.calls[1][2].parts).toEqual([
    expect.objectContaining({ id: 'pick', weight: 250 }), expect.objectContaining({ id: 'carry', distance: 50 }),
  ]);
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0].recipe).toEqual(pairedRecipe);
  view.cleanup();
});

it('retains newer attempt edits while an accepted component save is pending', async () => {
  let resolveSave;
  const onSaveRecipe = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  const view = render({ workout: pairedDay, onSaveRecipe });
  view.change('Block 1 weight', '250');
  view.click('Use this prescription next time');
  view.change('Block 1 weight', '260');
  view.change('Block 1 component', 'carry');
  view.change('Block 1 distance', '50');
  await act(async () => resolveSave());
  await act(async () => view.click('Use this prescription next time'));
  expect(onSaveRecipe.mock.calls[1][2].parts[0].weight).toBe(250);
  view.change('Block 1 component', 'pick');
  expect(view.div.querySelector('[aria-label="Block 1 weight"]').value).toBe('260');
  view.cleanup();
});

it('does not merge a rejected component save into the next accepted component', async () => {
  const onSaveRecipe = jest.fn().mockRejectedValueOnce(new Error('Storage changed')).mockResolvedValue();
  const view = render({ workout: pairedDay, onSaveRecipe });
  view.change('Block 1 weight', '250');
  await act(async () => view.click('Use this prescription next time'));
  view.change('Block 1 component', 'carry');
  view.change('Block 1 distance', '50');
  await act(async () => view.click('Use this prescription next time'));
  expect(onSaveRecipe.mock.calls[1][2].parts[0].weight).toBe(240);
  view.cleanup();
});

it.each(['taper', 'recovery'])('uses only accepted %s work when changing variations or adding practice', phase => {
  const practices = [routine.inputs.events[0].practices[0], { id: 'practice2', name: 'Other bag', recipe: { sets: 5, weight: 300 }, taperRecipe: { sets: 2, weight: 120, setup: 'Raised platform' } }];
  const view = render({ routine: { inputs: { events: [{ ...routine.inputs.events[0], practices }] } }, workout: { ...workout, phase } });
  view.change('Block 1 practice', 'practice2');
  expect(view.div.querySelector('[aria-label="Block 1 weight"]').value).toBe('120');
  expect(view.div.querySelector('[aria-label="Block 1 sets"]').value).toBe('2');
  expect(view.div.querySelector('[aria-label="Block 1 setup"]').value).toBe('Raised platform');
  view.change('Block 1 practice', 'practice1');
  expect(view.div.querySelector('[aria-label="Block 1 weight"]').value).toBe('');
  view.change('Extra practice', 'event1:practice2');
  view.click('Add extra practice');
  expect(view.div.querySelector('[aria-label="Block 2 weight"]').value).toBe('120');
  expect(view.div.querySelector('[aria-label="Block 2 setup"]').value).toBe('Raised platform');
  view.cleanup();
});

it('freezes capability associations on initialize, variation changes, and explicit extra practice', () => {
  const practices = [{ id: 'practice1', name: 'Pick', capabilityIds: ['pick'], recipe: null }, { id: 'practice2', name: 'Carry', capabilityIds: ['carry'], recipe: null }];
  const configured = { inputs: { events: [{ ...routine.inputs.events[0], practices, capabilities: [{ id: 'pick', name: 'Pick' }, { id: 'carry', name: 'Carry' }] }] } };
  const snapshot = { eventId: 'event1', practiceId: 'practice1', capabilityIds: ['pick'], focus: '', parts: [] };
  const view = render({ routine: configured, workout: { ...workout, exercises: [{ ...workout.exercises[0], capabilitySnapshot: snapshot }] } });
  view.change('Block 1 weight', '200');
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0].capabilitySnapshot).toMatchObject({ practiceId: 'practice1', capabilityIds: ['pick'] });
  view.change('Block 1 practice', 'practice2');
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0].capabilitySnapshot).toMatchObject({ practiceId: 'practice2', capabilityIds: ['carry'] });
  view.change('Extra practice', 'event1:practice1');
  view.click('Add extra practice');
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[1].capabilitySnapshot).toMatchObject({ practiceId: 'practice1', capabilityIds: ['pick'] });
  view.cleanup();
});

it.each([undefined, null])('does not assign current capability associations to a legacy session with snapshot %s', capabilitySnapshot => {
  const configured = { inputs: { events: [{ ...routine.inputs.events[0], capabilities: [{ id: 'pick', name: 'Pick' }], practices: [{ ...routine.inputs.events[0].practices[0], capabilityIds: ['pick'] }] }] } };
  const legacy = { ...workout, exercises: [{ ...workout.exercises[0], ...(capabilitySnapshot === undefined ? {} : { capabilitySnapshot }) }] };
  const view = render({ routine: configured, workout: legacy });
  view.change('Block 1 weight', '200');
  expect(view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0].capabilitySnapshot).toBeNull();
  view.cleanup();
});

it('resumes imported attempts without a saved entry draft using the frozen prescription', () => {
  const attempts = [{ id: 'a1', weight: 180, reps: 1, status: 'completed', outcome: 'successful' }];
  const imported = { ...workout, session: { ...workout.session, eventBlocks: [{ id: 'block1', eventId: 'event1', practiceId: 'practice1', movement: 'Bag', setup: 'Floor', recipe: { sets: 3, weight: 200, reps: 1 }, attempts, status: 'completed', capabilitySnapshot: null }] } };
  const view = render({ workout: imported });
  expect(view.div.querySelector('[aria-label="Block 1 weight"]').value).toBe('200');
  view.click('Record attempt');
  const block = view.props.onUpdate.mock.calls.at(-1)[0].session.eventBlocks[0];
  expect(block.attempts[0]).toEqual(attempts[0]);
  expect(block.attempts[1]).toMatchObject({ weight: 200, reps: 1, setup: 'Floor' });
  expect(block.capabilitySnapshot).toBeNull();
  view.cleanup();
});
