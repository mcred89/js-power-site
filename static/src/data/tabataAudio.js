import { getTabataSchedule, getTabataTiming } from './tabataTimer';

const CUES = {
  warmup: [{ frequency: 660, offset: 0, duration: 0.3 }],
  sprint: [
    { frequency: 1050, offset: 0, duration: 0.24 },
    { frequency: 1320, offset: 0.32, duration: 0.24 },
  ],
  rest: [{ frequency: 330, offset: 0, duration: 0.6 }],
  complete: [
    { frequency: 780, offset: 0, duration: 0.2 },
    { frequency: 990, offset: 0.28, duration: 0.2 },
    { frequency: 1320, offset: 0.56, duration: 0.3 },
  ],
};

export const createTabataAudio = () => {
  let context = null;
  const scheduledNodes = new Set();

  const stop = () => {
    scheduledNodes.forEach(({ oscillator, gain }) => {
      // Disconnect immediately as well as cancelling sources that have not
      // started yet. Previously ended sources can reject a second stop call.
      oscillator.disconnect();
      gain.disconnect();
      try {
        oscillator.stop();
      } catch (error) {
        // Already stopped sources have nothing left to cancel.
      }
    });
    scheduledNodes.clear();
  };

  const unlock = async () => {
    if (!context || context.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser cannot play the Tabata buzzer.');
      // Construction and resume must run directly in the button handler,
      // before awaiting storage or any other operation requiring a new task.
      context = new AudioContextClass();
    }
    const unlockingContext = context;
    if (unlockingContext.state !== 'running') await unlockingContext.resume();
    if (context !== unlockingContext || unlockingContext.state !== 'running') {
      throw new Error('The Tabata buzzer could not start. Try enabling sound again.');
    }
  };

  const scheduleCue = (phase, when) => {
    CUES[phase].forEach(({ frequency, offset, duration }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = when + offset;
      const end = start + duration;
      const nodes = { oscillator, gain };
      scheduledNodes.add(nodes);
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(frequency, start);
      // Strong square-wave buzzer with short ramps to prevent audio clicks.
      // Actual loudness is controlled by the device's media volume.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.65, start + 0.012);
      gain.gain.setValueAtTime(0.65, end - 0.025);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        scheduledNodes.delete(nodes);
      };
      oscillator.start(start);
      oscillator.stop(end);
    });
  };

  const schedule = (roundCount, elapsedMs = 0) => {
    if (!context || context.state !== 'running') {
      throw new Error('Enable sound before starting the Tabata buzzer.');
    }
    stop();
    const timing = getTabataTiming(roundCount, elapsedMs);
    const origin = context.currentTime;
    try {
      scheduleCue(timing.phase, origin);
      // The audio clock runs these transitions independently of render timers.
      // On resume, replay the current phase cue and schedule only future cues.
      getTabataSchedule(roundCount)
        .filter(item => item.startMs > timing.totalElapsedMs)
        .forEach(item => scheduleCue(
          item.phase,
          origin + (item.startMs - timing.totalElapsedMs) / 1000,
        ));
    } catch (error) {
      stop();
      throw error;
    }
  };

  const close = async () => {
    stop();
    const closingContext = context;
    context = null;
    if (closingContext && closingContext.state !== 'closed') await closingContext.close();
  };

  return { unlock, schedule, stop, close };
};
