import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('./data/storage', () => ({
  applyBatch: jest.fn().mockResolvedValue(undefined),
  get: jest.fn((store, key) => Promise.resolve(store === 'metadata'
    ? { key, value: 'profile-1' }
    : {
      id: 'routine-1', profileId: 'profile-1', name: 'Test plan', updatedAt: '2026-08-20T12:00:00.000Z', inputs: {}, exercises: [],
      workouts: [{ id: 'workout-1', name: 'Squat day', weekLabel: 'Week 1', completedAt: '2026-08-20T12:00:00.000Z', session: { status: 'completed', startedAt: '2026-08-20T11:00:00.000Z', completedAt: '2026-08-20T12:00:00.000Z', elapsedSeconds: 3600, exercises: [{ exerciseId: 'exercise-1', name: 'Squat', sets: [{ id: 'set-1', status: 'skipped', actualWeight: '225', actualReps: '5' }] }] } }],
    })),
  getAll: jest.fn(store => Promise.resolve(store === 'profiles' ? [{ id: 'profile-1', name: 'Alex', activeRoutineId: 'routine-1', activeWorkoutRoutineId: null }] : [])),
  getAllByIndex: jest.fn().mockResolvedValue([{
    id: 'routine-1', profileId: 'profile-1', name: 'Test plan', updatedAt: '2026-08-20T12:00:00.000Z', inputs: {}, exercises: [],
    workouts: [{ id: 'workout-1', name: 'Squat day', weekLabel: 'Week 1', completedAt: '2026-08-20T12:00:00.000Z', session: { status: 'completed', startedAt: '2026-08-20T11:00:00.000Z', completedAt: '2026-08-20T12:00:00.000Z', elapsedSeconds: 3600, exercises: [{ exerciseId: 'exercise-1', name: 'Squat', sets: [{ id: 'set-1', status: 'skipped', actualWeight: '225', actualReps: '5' }] }] } }],
  }]),
  hasPersistentStorage: jest.fn().mockResolvedValue(false),
  remove: jest.fn().mockResolvedValue(undefined),
  requestPersistentStorage: jest.fn().mockResolvedValue(false),
  save: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./data/dataWorkerFactory', () => ({
  createDataWorker: jest.fn(() => { throw new Error('Worker unavailable in Jest.'); }),
}));

import TrackerApp from './TrackerApp';
import { get as mockGet, getAll as mockGetAll, getAllByIndex as mockGetAllByIndex } from './data/storage';

const clickButton = async (container, label) => {
  const button = [...container.querySelectorAll('button')]
    .find(item => item.textContent.includes(label));
  if (!button) throw new Error(`Missing ${label}: ${container.textContent}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
};

it('keeps History settled when reopening, starting, and leaving a workout updates the profile', async () => {
  const storedRoutine = {
    id: 'routine-1', profileId: 'profile-1', name: 'Test plan', updatedAt: '2026-08-20T12:00:00.000Z', inputs: {}, exercises: [],
    workouts: [{ id: 'workout-1', name: 'Squat day', weekLabel: 'Week 1', completedAt: '2026-08-20T12:00:00.000Z', session: { status: 'completed', startedAt: '2026-08-20T11:00:00.000Z', completedAt: '2026-08-20T12:00:00.000Z', elapsedSeconds: 3600, exercises: [{ exerciseId: 'exercise-1', name: 'Squat', sets: [{ id: 'set-1', status: 'skipped', actualWeight: '225', actualReps: '5' }] }] } }],
  };
  mockGetAll.mockImplementation(store => Promise.resolve(store === 'profiles'
    ? [{ id: 'profile-1', name: 'Alex', activeRoutineId: 'routine-1', activeWorkoutRoutineId: null }]
    : []));
  mockGet.mockImplementation((store, key) => Promise.resolve(store === 'metadata'
    ? { key, value: 'profile-1' }
    : storedRoutine));
  mockGetAllByIndex.mockResolvedValue([storedRoutine]);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<TrackerApp appearance="system" onAppearanceChange={() => {}} />);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  await clickButton(container, 'History');
  await clickButton(container, 'Squat day');
  await clickButton(container, 'Return to workout queue');
  await clickButton(container, 'Leave');

  expect(container.textContent).toContain('History');
  expect(container.textContent).not.toContain('Opening history…');
  expect(mockGetAllByIndex).toHaveBeenCalledTimes(1);

  act(() => root.unmount());
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it('reuses one complete profile read across Plans, History, and Progress, then reads once for a profile switch', async () => {
  const routineFor = (id, profileId, name) => ({
    id, profileId, name, updatedAt: '2026-08-20T12:00:00.000Z', inputs: {}, exercises: [], workouts: [],
  });
  const firstRoutine = routineFor('routine-1', 'profile-1', 'First plan');
  const secondRoutine = routineFor('routine-2', 'profile-2', 'Second plan');
  mockGetAll.mockImplementation(store => Promise.resolve(store === 'profiles' ? [
    { id: 'profile-1', name: 'Alex', activeRoutineId: 'routine-1', activeWorkoutRoutineId: null },
    { id: 'profile-2', name: 'Blair', activeRoutineId: 'routine-2', activeWorkoutRoutineId: null },
  ] : []));
  mockGet.mockImplementation((store, key) => Promise.resolve(store === 'metadata'
    ? { key, value: 'profile-1' }
    : key === 'routine-2' ? secondRoutine : firstRoutine));
  mockGetAllByIndex.mockImplementation((store, index, profileId) => Promise.resolve(
    profileId === 'profile-2' ? [secondRoutine] : [firstRoutine],
  ));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<TrackerApp appearance="system" onAppearanceChange={() => {}} />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  for (const screen of ['Plans', 'History', 'Progress']) {
    await clickButton(container, screen);
    expect(container.textContent).not.toMatch(/Opening (plans|history|progress)…/i);
  }
  expect(mockGetAllByIndex).toHaveBeenCalledTimes(1);

  const selector = container.querySelector('[aria-label="Current profile"]');
  await act(async () => {
    selector.value = 'profile-2';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(mockGetAllByIndex).toHaveBeenCalledTimes(2);
  await clickButton(container, 'History');
  await clickButton(container, 'Plans');
  expect(mockGetAllByIndex).toHaveBeenCalledTimes(2);

  act(() => root.unmount());
  global.IS_REACT_ACT_ENVIRONMENT = false;
});

it('shows an existing routine on Today at startup when its profile pointer is missing', async () => {
  const storedRoutine = {
    id: 'routine-1', profileId: 'profile-1', name: 'Recovered plan', updatedAt: '2026-08-20T12:00:00.000Z', inputs: {}, exercises: [],
    workouts: [{ id: 'workout-1', name: 'Deadlift day', weekLabel: 'Week 1', exercises: [] }],
  };
  mockGetAll.mockImplementation(store => Promise.resolve(store === 'profiles'
    ? [{ id: 'profile-1', name: 'Alex', activeRoutineId: null, activeWorkoutRoutineId: null }]
    : []));
  mockGet.mockImplementation((store, key) => Promise.resolve(store === 'metadata'
    ? { key, value: 'profile-1' }
    : undefined));
  mockGetAllByIndex.mockResolvedValue([storedRoutine]);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(<TrackerApp appearance="system" onAppearanceChange={() => {}} />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain('Your next workout');
  expect(container.textContent).toContain('Deadlift day');
  expect(container.textContent).not.toContain('Build your first routine');

  act(() => root.unmount());
  global.IS_REACT_ACT_ENVIRONMENT = false;
});
