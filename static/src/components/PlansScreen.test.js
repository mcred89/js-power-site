import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { isPlanComplete, PlansScreen } from './PlansScreen';

const actions = {
  newRoutine: jest.fn(),
  select: jest.fn(),
  rename: jest.fn(),
  copy: jest.fn(),
  saveTemplate: jest.fn(),
  delete: jest.fn(),
  correct: jest.fn(),
};

const RoutineNameEditor = () => <button type="button">Rename</button>;
const MaxCorrection = () => <div>Correct maxes</div>;
const PlanSetup = ({ routine }) => <div>Configuration for {routine.name}</div>;

it('derives completed status from every workout being complete', () => {
  expect(isPlanComplete({ workouts: [{ completedAt: 'now' }, { completedAt: 'later' }] })).toBe(true);
  expect(isPlanComplete({ workouts: [{ completedAt: 'now' }, { completedAt: null }] })).toBe(false);
  expect(isPlanComplete({ workouts: [] })).toBe(false);
});

it('shows active and completed plan states with delete actions', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routines = [
    { id: 'active', name: 'Current plan', workouts: [{ completedAt: null }] },
    { id: 'done', name: 'Old plan', workouts: [{ id: 'day-1', weekLabel: 'Week 1', name: 'Squat day', completedAt: 'now', exercises: [{ id: 'exercise-1', generated: { movement: 'Back squat', weight: '225', prescription: '3 × 5' }, overrides: {} }] }] },
  ];

  act(() => root.render(<PlansScreen
    profile={{ name: 'Alex' }}
    routines={routines}
    selectedId="active"
    templates={[]}
    actions={actions}
    RoutineNameEditor={RoutineNameEditor}
    MaxCorrection={MaxCorrection}
    PlanSetup={PlanSetup}
  />));

  expect(div.textContent).toContain('Active');
  expect(div.textContent).toContain('Completed');
  expect(div.textContent).not.toContain('Archive');
  expect(div.textContent).toContain('View details');
  expect(div.textContent).toContain('Configuration for Old plan');
  expect(div.textContent).toContain('Squat day');
  expect(div.textContent).toContain('Back squat');
  expect(div.textContent).toContain('3 × 5');
  expect([...div.querySelectorAll('button')].filter(button => button.textContent === 'Delete')).toHaveLength(2);
  act(() => root.unmount());
});
