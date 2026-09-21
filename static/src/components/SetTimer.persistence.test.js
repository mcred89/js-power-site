import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SetTimer from './SetTimer';
import { createSetTimerAudio } from '../data/setTimerAudio';

jest.mock('../data/setTimerAudio', () => ({ createSetTimerAudio: jest.fn() }));

const paused = { intervalMs: 60000, elapsedMs: 17000, runningSince: null, exerciseId: 'squat' };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label);
const click = async label => { await act(async () => button(label).click()); };
const countdown = () => document.querySelector('[role="timer"]').textContent;
let root;
let container;
let sound;

// Match TrackerApp: publish an optimistic clone before the storage promise
// settles, and remove the dialog as soon as onClose fires.
const render = (persist, initial = null) => {
  const closed = jest.fn();
  let replaceTimer;
  const Host = () => {
    const [timer, setTimer] = useState(initial);
    const [open, setOpen] = useState(true);
    replaceTimer = setTimer;
    return open ? <SetTimer
      timer={timer}
      exerciseId="squat"
      exerciseName="Squat"
      onTimerChange={next => {
        setTimer(next && { ...next });
        return persist(next);
      }}
      onClose={() => { closed(); setOpen(false); }}
    /> : <p>Workout</p>;
  };
  act(() => root.render(<Host />));
  return { closed, replaceTimer: next => replaceTimer(next) };
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
  sound = { unlock: jest.fn().mockResolvedValue(), schedule: jest.fn(), stop: jest.fn(), close: jest.fn() };
  createSetTimerAudio.mockReturnValue(sound);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  jest.clearAllMocks();
});

it.each([
  ['Start timer', null, '0:08'],
  ['Resume timer', paused, '0:51'],
])('freezes and reports a delayed failed %s after optimistic props were cloned', async (label, initial, remaining) => {
  const write = deferred();
  const persist = jest.fn().mockReturnValueOnce(write.promise).mockResolvedValue();
  const { closed } = render(persist, initial);
  await click(label);
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(2000));
  await act(async () => write.reject(new Error('Disk full')));
  expect(sound.stop).toHaveBeenCalled();
  expect(button('Resume timer').disabled).toBe(false);
  expect(document.body.textContent).toContain('could not be saved');
  expect(countdown()).toBe(remaining);
  act(() => jest.advanceTimersByTime(60000));
  expect(countdown()).toBe(remaining);
  expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ runningSince: null }));
  expect(closed).not.toHaveBeenCalled();
  await click('Resume timer');
  expect(button('Pause timer')).toBeDefined();
  expect(sound.schedule).toHaveBeenCalledTimes(2);
});

it('keeps a failed Stop visible and paused for retry until clearing storage succeeds', async () => {
  const write = deferred();
  const persist = jest.fn().mockResolvedValueOnce().mockReturnValueOnce(write.promise).mockResolvedValue();
  const { closed } = render(persist);
  await click('Start timer');
  act(() => jest.advanceTimersByTime(14000));
  await click('Stop timer');
  expect(closed).not.toHaveBeenCalled();
  expect(countdown()).toBe('0:56');
  expect(button('Stop timer').disabled).toBe(true);
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(persist).toHaveBeenCalledTimes(2);
  act(() => jest.advanceTimersByTime(60000));
  await act(async () => write.reject(new Error('Disk full')));
  expect(closed).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('could not be saved');
  expect(button('Resume timer')).toBeDefined();
  expect(countdown()).toBe('0:56');
  expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 14000, runningSince: null }));
  await click('Stop timer');
  expect(persist).toHaveBeenLastCalledWith(null);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[aria-label="Set timer"]')).toBeNull();
});

it('does not let an old failed write pause a newer resumed countdown', async () => {
  const write = deferred();
  const persist = jest.fn().mockResolvedValueOnce().mockReturnValueOnce(write.promise).mockResolvedValue();
  render(persist);
  await click('Start timer');
  act(() => jest.advanceTimersByTime(3000));
  await click('Pause timer');
  await click('Resume timer');
  const stopCount = sound.stop.mock.calls.length;
  await act(async () => write.reject(new Error('Old write failed')));
  expect(button('Pause timer')).toBeDefined();
  expect(sound.stop).toHaveBeenCalledTimes(stopCount);
  expect(persist).toHaveBeenCalledTimes(3);
  expect(document.body.textContent).not.toContain('could not be saved');
  act(() => jest.advanceTimersByTime(1000));
  expect(countdown()).toBe('0:06');
});

it('does not resurrect the timer when a pending Start fails after the workout clears it', async () => {
  const write = deferred();
  const persist = jest.fn().mockReturnValueOnce(write.promise).mockResolvedValue();
  const { closed, replaceTimer } = render(persist);
  await click('Start timer');
  await act(async () => replaceTimer(null));
  expect(closed).toHaveBeenCalledTimes(1);
  await act(async () => write.reject(new Error('Old write failed')));
  expect(persist).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[aria-label="Set timer"]')).toBeNull();
});
