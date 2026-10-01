import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { isPlanComplete, PlansScreen } from './PlansScreen';

jest.mock('./PlanUpdateEditor', () => ({
  PlanUpdateEditor: ({ routine, onCancel, onSave }) => <div>
    <h1>Updating {routine.name}</h1>
    <button onClick={onCancel}>Cancel update</button>
    <button onClick={() => onSave({ maxSquat: '400' })}>Save update</button>
  </div>,
}));

const actions = {
  newRoutine: jest.fn(),
  select: jest.fn(),
  rename: jest.fn(),
  copy: jest.fn(),
  saveTemplate: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
};

const RoutineNameEditor = () => <button type="button">Rename</button>;
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
    PlanSetup={PlanSetup}
  />));

  expect(div.textContent).toContain('Current plan');
  expect(div.textContent).toContain('Completed');
  expect(div.textContent).not.toContain('Archive');
  expect(div.textContent).toContain('View details');
  expect(div.textContent).toContain('Configuration for Old plan');
  expect(div.textContent).toContain('Squat day');
  expect(div.textContent).toContain('Back squat');
  expect(div.textContent).toContain('3 × 5');
  expect([...div.querySelectorAll('button')].filter(button => button.textContent === 'Delete')).toHaveLength(2);
  expect([...div.querySelectorAll('button')].filter(button => button.textContent === 'Update plan')).toHaveLength(1);
  act(() => root.unmount());
});

it('shows one shared competition above all plans and sends edits through the profile action', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routines = ['first', 'second'].map(id => ({ id, name: id, inputs: { strongmanCompetition: { name: 'Old snapshot', events: [] } }, workouts: [] }));
  const localActions = { ...actions, saveCompetition: jest.fn().mockResolvedValue(undefined) };
  act(() => root.render(<PlansScreen profile={{ name: 'Alex', strongmanCompetition: { id: 'shared', name: 'Shared meet', events: [] } }} routines={routines} templates={[]} actions={localActions} RoutineNameEditor={RoutineNameEditor} PlanSetup={PlanSetup} />));
  expect(div.querySelectorAll('[aria-label="Next competition"]')).toHaveLength(1);
  expect(div.textContent).not.toContain('Old snapshot');
  act(() => [...div.querySelectorAll('button')].find(button => button.textContent === 'Edit competition').click());
  await act(async () => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(localActions.saveCompetition).toHaveBeenCalledWith(expect.objectContaining({ id: 'shared', name: 'Shared meet' }),
    { id: 'shared', name: 'Shared meet', events: [] });
  act(() => root.unmount());
});

it('puts the current plan first and opens an update for the chosen plan without changing the active selection', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routines = [
    { id: 'other', name: 'Other plan', workouts: [{ completedAt: null }] },
    { id: 'current', name: 'Current plan', workouts: [{ completedAt: null }] },
  ];
  const localActions = { ...actions, update: jest.fn().mockResolvedValue(undefined), select: jest.fn() };
  act(() => root.render(<PlansScreen profile={{ name: 'Alex' }} routines={routines}
    selectedId="current" templates={[]} actions={localActions}
    RoutineNameEditor={RoutineNameEditor} PlanSetup={PlanSetup} />));
  expect(div.querySelector('.plan-select strong').textContent).toBe('Current plan');
  const click = text => [...div.querySelectorAll('button')].find(button => button.textContent === text).click();
  act(() => click('Update plan'));
  expect(div.textContent).toContain('Updating Current plan');
  act(() => click('Cancel update'));
  expect(localActions.update).not.toHaveBeenCalled();
  act(() => [...div.querySelectorAll('button')].filter(button => button.textContent === 'Update plan')[1].click());
  expect(div.textContent).toContain('Updating Other plan');
  await act(async () => click('Save update'));
  expect(localActions.update).toHaveBeenCalledWith(routines[0], { maxSquat: '400' });
  expect(localActions.select).not.toHaveBeenCalled();
  expect(div.querySelectorAll('.plan-card')).toHaveLength(2);
  act(() => root.unmount());
});

it('keeps a competition draft when plan-update navigation is cancelled and discards only after approval', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const routine = {
    id: 'current', name: 'Current plan', workouts: [{ completedAt: null }],
    inputs: { includeStrongmanDay: true, strongmanCompetition: {
      name: 'Fall meet', events: [{ id: 'yoke', name: 'Yoke carry', type: 'single', weight: 600 }],
    } },
  };
  const localActions = { ...actions, saveCompetition: jest.fn(), update: jest.fn() };
  const click = text => [...div.querySelectorAll('button')].find(button => button.textContent === text).click();
  try {
    act(() => root.render(<PlansScreen profile={{ name: 'Alex', strongmanCompetition: routine.inputs.strongmanCompetition }} routines={[routine]}
      selectedId="current" templates={[]} actions={localActions}
      RoutineNameEditor={RoutineNameEditor} PlanSetup={PlanSetup} />));
    act(() => click('Edit competition'));
    act(() => {
      const name = div.querySelector('[aria-label="Competition name"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Unsaved new meet');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => click('Update plan'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(div.querySelector('[aria-label="Competition name"]').value).toBe('Unsaved new meet');
    expect(div.textContent).not.toContain('Updating Current plan');
    expect(localActions.saveCompetition).not.toHaveBeenCalled();
    expect(localActions.update).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    act(() => click('Update plan'));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(div.textContent).toContain('Updating Current plan');
    expect(div.querySelector('[aria-label="Competition name"]')).toBeNull();
    expect(routine.inputs.strongmanCompetition.name).toBe('Fall meet');
    expect(localActions.saveCompetition).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    confirm.mockRestore();
  }
});
