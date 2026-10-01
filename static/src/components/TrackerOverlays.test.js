import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutineCopyDialog } from './TrackerOverlays';

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
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

const render = onConfirm => act(() => root.render(<RoutineCopyDialog
  title="Copy Meet prep" eyebrow="Copy routine" defaultName="Meet prep copy"
  profiles={[{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Sam' }]}
  selectedProfileId="p1" confirmLabel="Copy routine" onCancel={() => {}} onConfirm={onConfirm}
/>));
const submit = () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

it('prevents duplicate pending copies and disables changes while saving', async () => {
  let finish;
  const onConfirm = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  render(onConfirm);
  await act(async () => { submit(); submit(); });
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Copying…');
  expect([...container.querySelectorAll('input, select, button')].every(field => field.disabled)).toBe(true);
  await act(async () => { finish(); });
  expect(container.querySelector('[type="submit"]').disabled).toBe(false);
});

it('preserves the name and destination after a conflict and permits a visible retry', async () => {
  const onConfirm = jest.fn().mockRejectedValueOnce(new Error('This profile changed in another window.'))
    .mockResolvedValueOnce(undefined);
  render(onConfirm);
  act(() => {
    const name = container.querySelector('input');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(name, '  Next prep plan  ');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const destination = container.querySelector('select');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(destination, 'p2');
    destination.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { submit(); });
  expect(container.querySelector('[role="alert"]').textContent).toContain('changed in another window');
  expect(container.querySelector('input').value).toBe('  Next prep plan  ');
  expect(container.querySelector('select').value).toBe('p2');
  expect([...container.querySelectorAll('input, select, button')].every(field => !field.disabled)).toBe(true);
  await act(async () => { submit(); });
  expect(onConfirm.mock.calls).toEqual([['p2', 'Next prep plan'], ['p2', 'Next prep plan']]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
