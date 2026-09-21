import { createSetTimerAudio } from './setTimerAudio';

let originalAudioContext;
let context;
let audio;
let startedAt;
let audioOffset;
const timer = (elapsedMs = 0, intervalMs = 60000) => ({
  intervalMs, elapsedMs, runningSince: new Date().toISOString(), exerciseId: 'squat',
});
const starts = () => context.oscillators.map(node => node.start.mock.calls[0][0]);

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
  startedAt = Date.now();
  audioOffset = 0;
  originalAudioContext = window.AudioContext;
  context = {
    state: 'suspended', destination: {}, oscillators: [], gains: [], envelopes: [],
    get currentTime() { return 10 + (Date.now() - startedAt) / 1000 + audioOffset; },
    resume: jest.fn(async () => { context.state = 'running'; }),
    close: jest.fn(async () => { context.state = 'closed'; }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    createOscillator: jest.fn(() => {
      const oscillator = {
        frequency: { setValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn(),
      };
      context.oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: jest.fn(() => {
      const gain = { gain: { setValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn() };
      context.gains.push(gain);
      return gain;
    }),
    createBufferSource: jest.fn(() => {
      const source = {
        playbackRate: { setValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn(),
      };
      context.envelopes.push(source);
      return source;
    }),
    createBuffer: jest.fn((channels, length, sampleRate) => {
      const data = new Float32Array(length);
      return { length, sampleRate, getChannelData: () => data };
    }),
  };
  window.AudioContext = jest.fn(() => context);
  audio = createSetTimerAudio();
});

afterEach(async () => {
  await audio.close();
  if (originalAudioContext) window.AudioContext = originalAudioContext;
  else delete window.AudioContext;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('unlocks from the user gesture with interactive latency and rejects unavailable audio', async () => {
  const unlocking = audio.unlock();
  expect(context.resume).toHaveBeenCalledTimes(1);
  await unlocking;
  await audio.unlock();
  expect(() => audio.schedule(timer(0, -1000))).toThrow('valid set timer interval');
  expect(window.AudioContext).toHaveBeenCalledTimes(1);
  expect(window.AudioContext).toHaveBeenCalledWith({ latencyHint: 'interactive' });
  expect(context.resume).toHaveBeenCalledTimes(1);
  await audio.close();
  delete window.AudioContext;
  await expect(audio.unlock()).rejects.toThrow('cannot play');
});

it('starts the ready-end cue and repeats entirely on the audio thread', async () => {
  expect(() => audio.schedule(timer())).toThrow('Enable sound');
  await audio.unlock();
  audio.schedule(timer());
  const envelope = context.envelopes[0];
  expect(starts()).toEqual([20]);
  expect(envelope.start).toHaveBeenCalledWith(20);
  expect(envelope.loop).toBe(true);
  const rate = envelope.playbackRate.setValueAtTime.mock.calls[0][0];
  expect(envelope.buffer.length / envelope.buffer.sampleRate / rate).toBe(60);
  expect(envelope.connect).toHaveBeenCalledWith(context.gains[0].gain);
  expect(envelope.buffer.getChannelData(0)[4]).toBeCloseTo(0.65);
  expect(envelope.buffer.getChannelData(0)[100]).toBe(0);
  // No renderer callbacks run during this six-interval absence.
  jest.setSystemTime(startedAt + 360000);
  audio.sync();
  expect(starts()).toEqual([20]);
  expect(envelope.stop).not.toHaveBeenCalled();
});

it('resumes at the next boundary without an immediate or duplicate cue', async () => {
  await audio.unlock();
  audio.schedule(timer(17000));
  expect(starts()).toEqual([63]);
  audio.stop();
  audio.schedule(timer(10000));
  expect(starts()).toEqual([63, 70]);
});

it('realigns a four-minute interval before the next cue when the audio clock falls four seconds behind', async () => {
  await audio.unlock();
  audio.schedule(timer(0, 240000));
  const original = context.oscillators[0];
  // The countdown is ten seconds from rollover, but the old audio clock would
  // sound four seconds after it. Rescheduling must remove that stale cue.
  jest.setSystemTime(startedAt + 240000);
  audioOffset = -4;
  audio.sync();
  expect(original.stop).toHaveBeenCalledTimes(1);
  expect(original.disconnect).toHaveBeenCalledTimes(1);
  expect(starts()).toEqual([20, 256]);
  expect(starts()[1] - context.currentTime).toBe(10);
  audio.sync();
  expect(context.oscillators).toHaveLength(2);
});

it('compensates output latency and prefers the output timestamp when available', async () => {
  await audio.unlock();
  context.baseLatency = 0.05;
  context.outputLatency = 0.2;
  audio.schedule(timer());
  expect(starts()[0]).toBe(19.75);
  jest.spyOn(performance, 'now').mockReturnValue(500);
  context.getOutputTimestamp = () => ({ contextTime: 9.5, performanceTime: 400 });
  audio.sync();
  expect(starts()[1]).toBeCloseTo(19.6);
});

it('skips missed boundaries when realigning after a stalled audio clock', async () => {
  await audio.unlock();
  audio.schedule(timer());
  jest.setSystemTime(startedAt + 251000);
  audioOffset = -4;
  audio.sync();
  // Ready at 10s, then 70/130/190/250/310s: only the next cue is scheduled.
  expect(starts()[1] - context.currentTime).toBe(59);
});

it('cancels repeating sources and monitoring on pause, and replaces sound on reschedule', async () => {
  await audio.unlock();
  audio.schedule(timer());
  const first = [...context.oscillators, ...context.envelopes];
  audio.stop();
  first.forEach(node => {
    expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(node.stop).toHaveBeenCalledTimes(1);
  });
  jest.advanceTimersByTime(60000);
  expect(context.oscillators).toHaveLength(1);
  audio.schedule(timer(5000));
  expect(starts()[1]).toBe(75);
});

it('cancels sound on audio interruption and notifies exactly once', async () => {
  const interrupted = jest.fn();
  await audio.unlock();
  audio.schedule(timer(), interrupted);
  context.state = 'suspended';
  context.addEventListener.mock.calls[0][1]();
  jest.advanceTimersByTime(1000);
  expect(interrupted).toHaveBeenCalledTimes(1);
  context.oscillators.forEach(node => expect(node.disconnect).toHaveBeenCalledTimes(1));
});

it('cleans up partial scheduling failures and closes all live sources', async () => {
  await audio.unlock();
  context.createGain.mockImplementationOnce(() => { throw new Error('Audio failed'); });
  expect(() => audio.schedule(timer())).toThrow('Audio failed');
  expect(context.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
  audio.schedule(timer());
  await audio.close();
  expect(context.close).toHaveBeenCalledTimes(1);
  expect(context.removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));
  context.oscillators.forEach(node => expect(node.disconnect).toHaveBeenCalledTimes(1));
});

it('bounds the envelope memory for the longest supported interval', async () => {
  await audio.unlock();
  audio.schedule(timer(0, 3600000));
  expect(context.envelopes[0].buffer.getChannelData(0).byteLength).toBeLessThan(3 * 1024 * 1024);
});
