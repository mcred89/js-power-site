import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FinishWorkoutDialog } from './FinishWorkoutDialog';

let container;
let root;
let onConfirm;
let onCancel;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onConfirm = jest.fn().mockResolvedValue(undefined);
  onCancel = jest.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.IS_REACT_ACT_ENVIRONMENT = false;
});
const render = (props = {}) => act(() => root.render(<FinishWorkoutDialog pendingSets={0} missingRpe onConfirm={onConfirm} onCancel={onCancel} {...props} />));
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
const click = async text => act(async () => button(text).click());

it('allows cancelling a selection without saving or finishing', async () => {
  render();
  expect(button('Finish workout').disabled).toBe(true);
  await click('8');
  expect(button('8').getAttribute('aria-pressed')).toBe('true');
  expect(button('Finish workout').disabled).toBe(false);
  await click('Cancel');
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('finishes with the latest selected RPE only after confirmation', async () => {
  render();
  await click('7');
  await click('9');
  expect(button('7').getAttribute('aria-pressed')).toBe('false');
  expect(onConfirm).not.toHaveBeenCalled();
  await click('Finish workout');
  expect(onConfirm).toHaveBeenCalledWith(9);
});

it('can explicitly finish without RPE even after selecting a value', async () => {
  render();
  await click('8');
  await click('Finish without RPE');
  expect(onConfirm).toHaveBeenCalledWith(null);
});

it('preserves an existing RPE and the skipped-set warning', async () => {
  render({ pendingSets: 1, missingRpe: false });
  expect(container.textContent).toContain('1 planned set will be recorded as skipped.');
  expect(container.querySelector('fieldset')).toBeNull();
  expect(button('Finish without RPE')).toBeUndefined();
  await click('Finish workout');
  expect(onConfirm).toHaveBeenCalledWith(undefined);
});

it('blocks duplicate completion and cancellation while saving, then permits retry on failure', async () => {
  let rejectSave;
  onConfirm.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSave = reject; }));
  render();
  await click('8');
  await act(async () => { button('Finish workout').click(); button('Finish workout').click(); });
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(button('Cancel').disabled).toBe(true);
  expect(container.querySelector('fieldset').disabled).toBe(true);
  act(() => container.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(onCancel).not.toHaveBeenCalled();
  await act(async () => rejectSave(new Error('Storage is unavailable.')));
  expect(container.querySelector('[role="alert"]').textContent).toBe('Storage is unavailable.');
  expect(button('8').getAttribute('aria-pressed')).toBe('true');
  await click('Finish workout');
  expect(onConfirm).toHaveBeenCalledTimes(2);
  expect(onConfirm).toHaveBeenLastCalledWith(8);
});
