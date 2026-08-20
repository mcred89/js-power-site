import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryScreen } from './HistoryScreen';

const Empty = () => null;
const WorkoutCard = ({ workout, onOpen }) => <button className="workout-card" type="button" onClick={onOpen}>{workout.id}</button>;
const workouts = count => Array.from({ length: count }, (_, index) => ({ id: `workout-${count - index}` }));

beforeAll(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
});

let mountNumber = 0;
const mount = (completed, profileId = `profile-${mountNumber += 1}`, routine = { id: `routine-${profileId}` }) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = nextCompleted => act(() => root.render(<HistoryScreen eyebrow="Plan" routine={routine} completed={nextCompleted} PlanSetup={Empty} WorkoutCard={WorkoutCard} onOpen={() => {}} />));
  render(completed);
  return { container, render, root };
};

afterEach(() => {
  document.body.innerHTML = '';
});

it.each([0, 1, 25, 26, 50, 500, 5000])('mounts no more than the first 25 of %i completed workouts', count => {
  const { container, root } = mount(workouts(count));
  expect(container.querySelectorAll('.workout-card')).toHaveLength(Math.min(25, count));
  expect(container.textContent.includes('Show 25 older workouts')).toBe(count > 25);
  act(() => root.unmount());
});

it('reveals exact 25-workout batches in the supplied newest-first order', () => {
  const completed = workouts(50);
  const { container, root } = mount(completed);
  expect([...container.querySelectorAll('.workout-card')].map(node => node.textContent)).toEqual(completed.slice(0, 25).map(item => item.id));

  act(() => container.querySelector('.full-button').click());
  expect(container.querySelectorAll('.workout-card')).toHaveLength(50);
  expect([...container.querySelectorAll('.workout-card')].map(node => node.textContent)).toEqual(completed.map(item => item.id));
  expect(container.querySelector('.full-button')).toBeNull();
  act(() => root.unmount());
});

it('focuses the first newly mounted workout after showing older history', () => {
  const { container, root } = mount(workouts(26));
  act(() => container.querySelector('.full-button').click());
  expect(document.activeElement.textContent).toBe('workout-1');
  expect(container.querySelectorAll('.workout-card')).toHaveLength(26);
  act(() => root.unmount());
});

it('retains expansion across a workout-detail unmount but resets for another routine', () => {
  const completed = workouts(50);
  const first = mount(completed, 'retained-profile', { id: 'retained-routine' });
  act(() => first.container.querySelector('.full-button').click());
  expect(first.container.querySelectorAll('.workout-card')).toHaveLength(50);
  act(() => first.root.unmount());

  const returned = mount(completed, 'retained-profile', { id: 'retained-routine' });
  expect(returned.container.querySelectorAll('.workout-card')).toHaveLength(50);
  act(() => returned.root.unmount());

  const changed = mount(completed, 'retained-profile', { id: 'different-routine' });
  expect(changed.container.querySelectorAll('.workout-card')).toHaveLength(25);
  act(() => changed.root.unmount());
});

it('clamps the expanded window when a workout is reopened', () => {
  const mounted = mount(workouts(50), 'clamp-profile', { id: 'clamp-routine' });
  act(() => mounted.container.querySelector('.full-button').click());
  mounted.render(workouts(26));
  expect(mounted.container.querySelectorAll('.workout-card')).toHaveLength(26);
  mounted.render(workouts(27));
  expect(mounted.container.querySelectorAll('.workout-card')).toHaveLength(26);
  act(() => mounted.root.unmount());
});
