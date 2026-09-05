import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import StrongmanBuilder from './StrongmanBuilder';

global.IS_REACT_ACT_ENVIRONMENT = true;

const render = props => {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const onSave = jest.fn();
  act(() => root.render(<StrongmanBuilder profile={{ name: 'Athlete' }} onSave={onSave} onCancel={() => {}} {...props} />));
  const click = label => act(() => [...div.querySelectorAll('button')].find(item => item.textContent === label).click());
  const change = (label, value) => act(() => {
    const input = div.querySelector(`[aria-label="${label}"]`);
    const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  return { div, onSave, click, change, cleanup: () => { act(() => root.unmount()); div.remove(); } };
};

it('creates independent competition phases and unknown events without inventing a prescription', () => {
  const view = render();
  view.change('Training purpose', 'competition');
  view.change('Block length in weeks', '12');
  view.click('Add event');
  view.change('Event 1 name', 'Sandbag carry');
  view.change('Event 1 family', 'carry');
  view.change('Event 1 target weight', '300');
  view.click('Save strongman block');
  expect(view.onSave).toHaveBeenCalledTimes(1);
  const inputs = view.onSave.mock.calls[0][1];
  expect(inputs.weeks).toBe(12);
  expect(inputs.phases.map(phase => phase.weeks)).toEqual([4, 4, 3, 1]);
  expect(inputs.events[0].target.weight).toBe(300);
  expect(inputs.events[0].practices[0].recipe).toBeNull();
  expect(view.div.textContent).toContain('normal lifting days');
  view.cleanup();
});

it('keeps editable A/B variations and capability criteria when editing a saved block', () => {
  const view = render();
  view.click('Add event');
  view.change('Event 1 name', 'Clean and press');
  view.click('Add variation');
  view.change('Event 1 practice 2 name', 'Log clean and press');
  view.change('Event 1 practice 2 rotation', 'B');
  view.click('Add capability');
  view.change('Event 1 capability 1 name', 'Clean');
  view.change('Event 1 capability 1 weight', '180');
  view.click('Save strongman block');
  const event = view.onSave.mock.calls[0][1].events[0];
  expect(event.practices[1]).toMatchObject({ name: 'Log clean and press', rotation: 'B' });
  expect(event.capabilities[0]).toMatchObject({ name: 'Clean', status: 'unknown', criterion: { weight: 180 } });
  view.cleanup();
});

it('rejects invalid paired work until each part has its own prescription', () => {
  const view = render();
  view.click('Add event');
  view.change('Event 1 name', 'Pick then carry');
  view.click('Add prescription part');
  view.change('Event 1 practice 1 part 1 name', 'Pick');
  view.change('Event 1 practice 1 part 1 weight', '240');
  view.click('Save strongman block');
  expect(view.onSave).not.toHaveBeenCalled();
  expect(view.div.querySelector('[role="alert"]')).not.toBeNull();
  view.change('Event 1 practice 1 part 1 sets', '3');
  view.click('Save strongman block');
  expect(view.onSave).toHaveBeenCalledTimes(1);
  view.cleanup();
});

it('keeps accepted taper work independent from regular event work', () => {
  const view = render();
  view.click('Add event');
  view.change('Event 1 name', 'Carry');
  view.change('Event 1 practice 1 prescription weight', '200');
  view.change('Event 1 practice 1 prescription sets', '4');
  view.change('Event 1 practice 1 taper weight', '100');
  view.change('Event 1 practice 1 taper sets', '2');
  view.click('Save strongman block');
  const practice = view.onSave.mock.calls[0][1].events[0].practices[0];
  expect(practice.recipe).toMatchObject({ weight: 200, sets: 4 });
  expect(practice.taperRecipe).toMatchObject({ weight: 100, sets: 2 });
  view.cleanup();
});

it('supports paired taper prescriptions independently from regular paired work', () => {
  const view = render();
  view.click('Add event');
  view.change('Event 1 name', 'Pick and carry');
  const taperDetails = [...view.div.querySelectorAll('details')].find(details => details.firstElementChild?.textContent === 'Accepted taper / recovery work');
  const addPart = [...taperDetails.querySelectorAll('button')].find(button => button.textContent === 'Add prescription part');
  expect(addPart).toBeDefined();
  act(() => addPart.click());
  view.change('Event 1 practice 1 taper part 1 name', 'Light pick');
  view.change('Event 1 practice 1 taper part 1 sets', '2');
  view.change('Event 1 practice 1 taper part 1 weight', '100');
  view.click('Save strongman block');
  const practice = view.onSave.mock.calls[0][1].events[0].practices[0];
  expect(practice.recipe).toBeNull();
  expect(practice.taperRecipe.parts[0]).toMatchObject({ name: 'Light pick', sets: 2, weight: 100 });
  view.cleanup();
});

it('requires removing explicit references before deleting a capability that gates practice', () => {
  const inputs = { ...require('../data/strongman').defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Bag', practices: [{ id: 'carry', name: 'Carry', prerequisites: ['pick'], recipe: null }], capabilities: [{ id: 'pick', name: 'Pick', status: 'working', criterion: {} }] }] };
  const view = render({ initialRoutine: { name: 'Prep', inputs } });
  view.click('Remove capability');
  expect(view.div.querySelector('[aria-label="Event 1 capability 1 name"]')).not.toBeNull();
  expect(view.div.querySelector('[role="alert"]').textContent).toContain('Remove its practice, checkpoint, or coverage references first');
  view.cleanup();
});
