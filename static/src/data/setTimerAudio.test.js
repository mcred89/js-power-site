import { createSetTimerAudio } from './setTimerAudio';

let originalAudioContext;
let context;
let audio;
const timer = (elapsedMs = 0, intervalMs = 60000) => ({ intervalMs, elapsedMs, runningSince: null, exerciseId: 'squat' });

beforeEach(() => {
  jest.useFakeTimers('modern');
  originalAudioContext = window.AudioContext;
  context = {
    state: 'suspended', currentTime: 10, destination: {}, oscillators: [], gains: [],
    resume: jest.fn(async () => { context.state = 'running'; }),
    close: jest.fn(async () => { context.state = 'closed'; }),
    createOscillator: jest.fn(() => {
      const oscillator = {
        frequency: { setValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn(),
      };
      context.oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: jest.fn(() => {
      const gain = { gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn() };
      context.gains.push(gain);
      return gain;
    }),
  };
  window.AudioContext = jest.fn(() => context);
  audio = createSetTimerAudio();
});

afterEach(async () => {
  await audio.close();
  if (originalAudioContext) window.AudioContext = originalAudioContext;
  else delete window.AudioContext;
  jest.useRealTimers();
});

it('unlocks from the user gesture and rejects unavailable audio', async () => {
  const unlocking = audio.unlock();
  expect(context.resume).toHaveBeenCalledTimes(1);
  await unlocking;
  await audio.unlock();
  expect(() => audio.schedule(timer(0, -1000))).toThrow('valid set timer interval');
  expect(window.AudioContext).toHaveBeenCalledTimes(1);
  expect(context.resume).toHaveBeenCalledTimes(1);
  await audio.close();
  delete window.AudioContext;
  await expect(audio.unlock()).rejects.toThrow('cannot play');
});

it('requires a running audio context and schedules the ready-end cue followed by steady intervals', async () => {
  expect(() => audio.schedule(timer())).toThrow('Enable sound');
  await audio.unlock();
  audio.schedule(timer());
  expect(context.oscillators.map(node => node.start.mock.calls[0][0])).toEqual([20, 80]);
  context.currentTime = 20;
  jest.advanceTimersByTime(250);
  expect(context.oscillators.map(node => node.start.mock.calls[0][0])).toEqual([20, 80, 140]);
});

it('resumes at the remaining boundary without an immediate or duplicate cue', async () => {
  await audio.unlock();
  audio.schedule(timer(17000));
  expect(context.oscillators.map(node => node.start.mock.calls[0][0])).toEqual([63, 123]);
  audio.stop();
  context.oscillators.length = 0;
  audio.schedule(timer(10000));
  expect(context.oscillators.map(node => node.start.mock.calls[0][0])).toEqual([70, 130]);
});

it('skips missed future scheduling boundaries after a stalled renderer', async () => {
  await audio.unlock();
  audio.schedule(timer());
  context.currentTime = 245;
  jest.advanceTimersByTime(250);
  expect(context.oscillators.slice(2).map(node => node.start.mock.calls[0][0])).toEqual([260, 320]);
});

it('cancels all queued sound and polling on pause, and replaces cues on reschedule', async () => {
  await audio.unlock();
  audio.schedule(timer());
  const first = [...context.oscillators];
  audio.stop();
  first.forEach(node => {
    expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(node.stop).toHaveBeenLastCalledWith();
  });
  context.currentTime = 1000;
  jest.advanceTimersByTime(60000);
  expect(context.oscillators).toHaveLength(first.length);
  audio.schedule(timer(5000));
  expect(context.oscillators[first.length].start).toHaveBeenCalledWith(1005);
});

it('pauses on audio interruption and notifies exactly once', async () => {
  const interrupted = jest.fn();
  await audio.unlock();
  audio.schedule(timer(), interrupted);
  context.state = 'suspended';
  jest.advanceTimersByTime(1000);
  expect(interrupted).toHaveBeenCalledTimes(1);
  context.oscillators.forEach(node => expect(node.disconnect).toHaveBeenCalledTimes(1));
});

it('cleans up partial scheduling errors and ended nodes', async () => {
  await audio.unlock();
  context.createGain.mockImplementationOnce(() => { throw new Error('Audio failed'); });
  expect(() => audio.schedule(timer())).toThrow('Audio failed');
  expect(context.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
  audio.schedule(timer());
  const ended = context.oscillators[1];
  ended.onended();
  await audio.close();
  expect(ended.disconnect).toHaveBeenCalledTimes(1);
  expect(context.close).toHaveBeenCalledTimes(1);
});
