import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SetTimer from './SetTimer';
import { createSetTimerAudio } from '../data/setTimerAudio';
import { createSetTimerNotifications, getSetTimerNotificationPermission } from '../data/setTimerNotifications';

jest.mock('../data/setTimerAudio', () => ({ createSetTimerAudio: jest.fn() }));
jest.mock('../data/setTimerNotifications', () => ({
  cleanupStaleSetTimerNotifications: jest.fn().mockResolvedValue(),
  createSetTimerNotifications: jest.fn(),
  getSetTimerNotificationPermission: jest.fn(),
}));

let root;
let container;
let notifications;
let permission;
let props;
const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label);
const click = async label => { await act(async () => button(label).click()); };
const advance = milliseconds => { act(() => jest.advanceTimersByTime(milliseconds)); };
const countdown = () => document.querySelector('[role="timer"]').textContent;
const render = () => {
  props = {
    timer: null,
    exerciseId: 'squat',
    exerciseName: 'Squat',
    onTimerChange: jest.fn().mockResolvedValue(),
    onClose: jest.fn(),
  };
  act(() => root.render(<SetTimer {...props} />));
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
  permission = 'default';
  getSetTimerNotificationPermission.mockImplementation(() => permission);
  notifications = {
    enable: jest.fn().mockImplementation(async () => { permission = 'granted'; return true; }),
    update: jest.fn().mockResolvedValue(),
    close: jest.fn().mockResolvedValue(),
    dispose: jest.fn().mockResolvedValue(),
  };
  createSetTimerNotifications.mockReturnValue(notifications);
  createSetTimerAudio.mockReturnValue({
    unlock: jest.fn().mockResolvedValue(),
    schedule: jest.fn(),
    stop: jest.fn(),
    close: jest.fn().mockResolvedValue(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  jest.resetAllMocks();
});

it('asks for notifications only after explicit opt-in and updates the current running timer', async () => {
  render();
  expect(button('Show timer notification')).toBeDefined();
  expect(createSetTimerNotifications).not.toHaveBeenCalled();
  await click('Start timer');
  expect(createSetTimerNotifications).not.toHaveBeenCalled();
  await click('Show timer notification');
  expect(notifications.enable).toHaveBeenCalledTimes(1);
  const timer = props.onTimerChange.mock.calls[0][0];
  expect(notifications.update).toHaveBeenLastCalledWith(timer, 'Squat');
  expect(button('Hide timer notification')).toBeDefined();
  notifications.update.mockClear();
  advance(1000);
  expect(notifications.update).toHaveBeenCalledTimes(1);
  expect(notifications.update).toHaveBeenLastCalledWith(timer, 'Squat');
  expect(countdown()).toBe('0:09');
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
});

it('refreshes notifications on visibility changes without changing timer persistence', async () => {
  render();
  await click('Start timer');
  await click('Show timer notification');
  const timer = props.onTimerChange.mock.calls[0][0];
  notifications.update.mockClear();
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(notifications.update).toHaveBeenLastCalledWith(timer, 'Squat');
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
});

it('hides an opted-in notification without pausing or saving the timer', async () => {
  render();
  await click('Start timer');
  await click('Show timer notification');
  await click('Hide timer notification');
  expect(notifications.close).toHaveBeenCalledTimes(1);
  expect(button('Show timer notification')).toBeDefined();
  notifications.update.mockClear();
  advance(17000);
  expect(countdown()).toBe('0:53');
  expect(notifications.update).not.toHaveBeenCalled();
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
});

it('updates notifications through explicit pause and resume without requesting permission again', async () => {
  render();
  await click('Start timer');
  await click('Show timer notification');
  advance(12300);
  await click('Pause timer');
  expect(notifications.update).toHaveBeenLastCalledWith(expect.objectContaining({
    elapsedMs: 12300, runningSince: null,
  }), 'Squat');
  notifications.update.mockClear();
  advance(10000);
  expect(notifications.update).not.toHaveBeenCalled();
  await click('Resume timer');
  expect(notifications.enable).toHaveBeenCalledTimes(1);
  expect(notifications.update).toHaveBeenLastCalledWith(expect.objectContaining({
    elapsedMs: 12300, runningSince: '2026-09-18T12:00:22.300Z',
  }), 'Squat');
  expect(button('Hide timer notification')).toBeDefined();
  notifications.update.mockClear();
  advance(1000);
  expect(notifications.update).toHaveBeenCalledTimes(1);
  expect(countdown()).toBe('0:57');
});

it('keeps counting and explains a denied notification permission', async () => {
  notifications.enable.mockImplementation(async () => { permission = 'denied'; return false; });
  render();
  await click('Start timer');
  await click('Show timer notification');
  expect(document.body.textContent).toContain('Notifications are blocked');
  expect(button('Show timer notification')).toBeDefined();
  expect(notifications.update).not.toHaveBeenCalled();
  advance(17000);
  expect(countdown()).toBe('0:53');
  expect(button('Pause timer')).toBeDefined();
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
});

it('allows another notification attempt after an update error while the clock continues', async () => {
  render();
  await click('Start timer');
  await click('Show timer notification');
  act(() => createSetTimerNotifications.mock.calls[0][0].onError(new Error('Unavailable')));
  expect(document.body.textContent).toContain('notification could not update');
  expect(button('Show timer notification')).toBeDefined();
  advance(17000);
  expect(countdown()).toBe('0:53');
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
  await click('Show timer notification');
  expect(notifications.enable).toHaveBeenCalledTimes(2);
  expect(button('Hide timer notification')).toBeDefined();
});

it('clears the notification when the timer stops and disposes on navigation away', async () => {
  render();
  await click('Start timer');
  await click('Show timer notification');
  await click('Stop timer');
  expect(notifications.update).toHaveBeenLastCalledWith(null, 'Squat');
  expect(props.onClose).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  root = createRoot(container);
  expect(notifications.dispose).toHaveBeenCalledTimes(1);
});

it('explains unsupported notifications without offering an unusable control', () => {
  permission = 'unsupported';
  render();
  expect(button('Show timer notification')).toBeUndefined();
  expect(document.body.textContent).toContain('does not support timer notifications');
  expect(createSetTimerNotifications).not.toHaveBeenCalled();
});
