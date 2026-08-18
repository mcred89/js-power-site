import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { isInstalledApp, RoutineNameEditor } from './App';

it('renders without crashing', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<App />));
  act(() => root.unmount());
});

it('shows the calculator in a normal browser tab', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<App />));

  expect(div.textContent).toContain('Build your routine');
  expect(div.textContent).not.toContain('Who is training?');
  act(() => root.unmount());
});

it('detects an installed standalone app', () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });

  expect(isInstalledApp()).toBe(true);

  window.matchMedia = originalMatchMedia;
});

it('edits and trims a routine name', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onSave = jest.fn();
  act(() => root.render(<RoutineNameEditor routine={{ name: 'Old plan' }} onSave={onSave} />));

  act(() => div.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const input = div.querySelector('input');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '  New plan  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  expect(onSave).toHaveBeenCalledWith('New plan');
  expect(div.textContent).toContain('Rename');
  act(() => root.unmount());
});
