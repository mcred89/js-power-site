import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ActiveWorkoutScreen } from './EagerTrackerScreens';
import { HistoryScreen } from './HistoryScreen';
import { ProgressScreen } from './ProgressScreen';

const renderCountAcrossShellUpdate = (root, makeChild) => {
  let commits = 0;
  const onScreenRender = () => { commits += 1; };
  const render = message => root.render(
    <div>
      {message && <div role="status">{message}</div>}
      {makeChild(onScreenRender)}
    </div>,
  );
  act(() => render(''));
  act(() => render('Update ready'));
  return commits;
};

it('does not commit Progress when a shell notification changes', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  const profile = { id: 'profile', name: 'Alex' };
  const routines = [];
  expect(renderCountAcrossShellUpdate(root, onScreenRender => <ProgressScreen profile={profile} routines={routines} onScreenRender={onScreenRender} />)).toBe(1);
  act(() => root.unmount());
});

it('does not commit History when a shell toast changes', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  const completed = [];
  const Empty = () => null;
  const onOpen = () => {};
  expect(renderCountAcrossShellUpdate(root, onScreenRender => (
    <HistoryScreen eyebrow="Plan" routine={null} completed={completed} PlanSetup={Empty} WorkoutCard={Empty} onOpen={onOpen} onScreenRender={onScreenRender} />
  ))).toBe(1);
  act(() => root.unmount());
});

it('does not commit the active workout when a confirmation modal opens', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  const workout = {
    id: 'workout',
    name: 'Squat',
    weekLabel: 'Week 1',
    session: {
      status: 'inProgress',
      startedAt: '2026-08-18T12:00:00.000Z',
      exercises: [{ exerciseId: 'squat', movement: 'Squat', prescription: '1 × 5', sets: [{ id: 'set', number: 1, status: 'pending', actualWeight: '225', actualReps: '5' }] }],
      actions: [],
    },
  };
  expect(renderCountAcrossShellUpdate(root, onScreenRender => (
    <ActiveWorkoutScreen workout={workout} onLeave={() => {}} onFinish={() => {}} onScreenRender={onScreenRender} />
  ))).toBe(1);
  act(() => root.unmount());
});
