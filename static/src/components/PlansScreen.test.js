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

it('uses explicit strongman enrollment status and treats resolved skips as completed', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routines = ['active', 'paused', 'saved', 'complete'].map(status => ({ id: status, kind: 'strongman', name: `${status} block`, status, workouts: [{ id: `${status}-day`, name: 'Strongman', completedAt: null, exercises: [] }] }));
  routines.push({ id: 'skipped', kind: 'strongman', name: 'Resolved block', status: 'active', workouts: [{ id: 'skipped-day', name: 'Strongman', skippedAt: 'now', exercises: [] }] });
  act(() => root.render(<PlansScreen profile={{ name: 'Alex' }} routines={routines} templates={[]} actions={actions} RoutineNameEditor={RoutineNameEditor} MaxCorrection={MaxCorrection} PlanSetup={PlanSetup} />));
  expect([...div.querySelectorAll('.plan-status')].map(badge => badge.textContent)).toEqual(['Active', 'Paused', 'Saved', 'Completed', 'Completed']);
  expect(div.querySelector('[aria-label="View paused block"]').closest('.plan-card').classList.contains('active')).toBe(false);
  act(() => root.unmount());
});

it('uses the accepted event units and per-hand meaning in completed plan details', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routines = [{ id: 'events', kind: 'strongman', name: 'Carry block', status: 'complete', workouts: [{ id: 'event-day', name: 'Strongman', completedAt: 'now', exercises: [{ id: 'carry', generated: { movement: 'Farmer carry', weight: 90, prescription: '2 × 20 m', event: { sets: 2, weight: 90, weightUnit: 'kg', loadMeaning: 'per-hand', distance: 20, distanceUnit: 'm' } }, overrides: {} }] }] }];
  act(() => root.render(<PlansScreen profile={{ name: 'Alex' }} routines={routines} templates={[]} actions={actions} RoutineNameEditor={RoutineNameEditor} MaxCorrection={MaxCorrection} PlanSetup={PlanSetup} />));
  expect(div.textContent).toContain('90 kg per hand');
  expect(div.textContent).toContain('20 m');
  expect(div.textContent).not.toContain('90 lb');
  act(() => root.unmount());
});
