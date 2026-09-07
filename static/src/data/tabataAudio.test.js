import { createTabataAudio } from './tabataAudio';

const createAudioContext = () => {
  const oscillators = [];
  const gains = [];
  const context = {
    state: 'suspended',
    currentTime: 10,
    destination: {},
    oscillators,
    gains,
    resume: jest.fn(async () => { context.state = 'running'; }),
    close: jest.fn(async () => { context.state = 'closed'; }),
    createOscillator: jest.fn(() => {
      const oscillator = {
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: jest.fn(() => {
      const gain = {
        gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };
  return context;
};

describe('Tabata buzzer', () => {
  let originalAudioContext;
  let originalWebkitAudioContext;
  let context;

  beforeEach(() => {
    originalAudioContext = window.AudioContext;
    originalWebkitAudioContext = window.webkitAudioContext;
    context = createAudioContext();
    window.AudioContext = jest.fn(() => context);
    delete window.webkitAudioContext;
  });

  afterEach(() => {
    if (originalAudioContext) window.AudioContext = originalAudioContext;
    else delete window.AudioContext;
    if (originalWebkitAudioContext) window.webkitAudioContext = originalWebkitAudioContext;
    else delete window.webkitAudioContext;
  });

  test('creates and resumes audio immediately when the user enables sound', async () => {
    const audio = createTabataAudio();
    expect(window.AudioContext).not.toHaveBeenCalled();
    const unlocking = audio.unlock();
    expect(window.AudioContext).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    await expect(unlocking).resolves.toBeUndefined();
    await audio.unlock();
    expect(window.AudioContext).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  test('reports unsupported and blocked audio rather than claiming sound is ready', async () => {
    delete window.AudioContext;
    await expect(createTabataAudio().unlock()).rejects.toThrow('cannot play');
    window.AudioContext = jest.fn(() => context);
    context.resume.mockImplementation(async () => {});
    await expect(createTabataAudio().unlock()).rejects.toThrow('could not start');
    context.resume.mockRejectedValue(new Error('Blocked'));
    await expect(createTabataAudio().unlock()).rejects.toThrow('Blocked');
  });

  test('requires successful sound enablement before scheduling', () => {
    expect(() => createTabataAudio().schedule(8, 0)).toThrow('Enable sound');
  });

  test('schedules every transition on the audio clock, with different work and rest buzzers', async () => {
    const audio = createTabataAudio();
    await audio.unlock();
    audio.schedule(8, 0);
    const tones = context.oscillators.map(oscillator => ({
      start: oscillator.start.mock.calls[0][0],
      frequency: oscillator.frequency.setValueAtTime.mock.calls[0][0],
    }));
    expect(tones[0]).toEqual({ start: 10, frequency: 660 });
    expect(tones.filter(tone => tone.frequency === 1050).map(tone => tone.start))
      .toEqual([70, 100, 130, 160, 190, 220, 250, 280]);
    expect(tones.filter(tone => tone.frequency === 330).map(tone => tone.start))
      .toEqual([90, 120, 150, 180, 210, 240, 270]);
    expect(tones.slice(-3).map(tone => tone.frequency)).toEqual([780, 990, 1320]);
    expect(tones[tones.length - 3].start).toBe(300);
    expect(context.oscillators).toHaveLength(27);
  });

  test('resuming during rest cues rest immediately and schedules only remaining transitions', async () => {
    const audio = createTabataAudio();
    await audio.unlock();
    audio.schedule(8, 85000);
    expect(context.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(330, 10);
    expect(context.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(1050, 15);
    expect(context.oscillators[context.oscillators.length - 3].start).toHaveBeenCalledWith(215);
    expect(context.oscillators).toHaveLength(24);
  });

  test('resuming exactly on a sprint transition does not play the work cue twice', async () => {
    const audio = createTabataAudio();
    await audio.unlock();
    audio.schedule(1, 60000);
    expect(context.oscillators).toHaveLength(5);
    expect(context.oscillators[0].start).toHaveBeenCalledWith(10);
    expect(context.oscillators[2].start).toHaveBeenCalledWith(30);
  });

  test('pause cancels all current and future tones, and a new schedule replaces old tones', async () => {
    const audio = createTabataAudio();
    await audio.unlock();
    audio.schedule(8, 0);
    const firstNodes = [...context.oscillators];
    audio.stop();
    firstNodes.forEach(node => {
      expect(node.stop).toHaveBeenLastCalledWith();
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    });
    audio.schedule(1, 0);
    const replacementNodes = context.oscillators.slice(firstNodes.length);
    audio.schedule(1, 61000);
    replacementNodes.forEach(node => expect(node.disconnect).toHaveBeenCalledTimes(1));
  });

  test('completed sources release their audio nodes and close releases all remaining audio', async () => {
    const audio = createTabataAudio();
    await audio.unlock();
    audio.schedule(1, 0);
    const first = context.oscillators[0];
    first.onended();
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(context.gains[0].disconnect).toHaveBeenCalledTimes(1);
    await audio.close();
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(context.oscillators[1].disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(() => audio.schedule(8)).toThrow('Enable sound');
    await audio.close();
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
