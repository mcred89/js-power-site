import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutineBuilderScreen } from './RoutineBuilderScreen';

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

it('uses the profile competition as a shared reference instead of reviving a template meet', () => {
  const active = { id: 'active', name: 'Current meet', events: [] };
  const template = { name: 'Template', inputs: { includeStrongmanDay: true, strongmanCompetition: { id: 'old', name: 'Old meet', events: [] } } };
  act(() => root.render(<RoutineBuilderScreen profile={{ name: 'Alex', strongmanCompetition: active }} count={1} template={template} onCreate={() => {}} />));
  expect(container.textContent).toContain('Training toward Current meet');
  expect(container.textContent).not.toContain('Old meet');
  expect(container.querySelector('[aria-label="Competition name"]')).toBeNull();
});

it('opens an empty competition editor when the profile has no active meet despite an old template', () => {
  const template = { name: 'Template', inputs: { includeStrongmanDay: true, strongmanCompetition: { name: 'Ended meet', events: [] } } };
  act(() => root.render(<RoutineBuilderScreen profile={{ name: 'Alex', strongmanCompetition: null }} count={1} template={template} onCreate={() => {}} />));
  expect(container.querySelector('[aria-label="Competition name"]').value).toBe('');
  expect(container.textContent).not.toContain('Ended meet');
});
