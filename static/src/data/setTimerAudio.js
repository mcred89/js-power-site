import { getSetTimerElapsedMs, isValidSetTimerInterval, SET_TIMER_READY_MS } from './setTimer';

export const createSetTimerAudio = () => {
  let context = null;
  let scheduler = null;
  const nodes = new Set();

  const stop = () => {
    window.clearInterval(scheduler);
    scheduler = null;
    nodes.forEach(({ oscillator, gain }) => {
      oscillator.disconnect();
      gain.disconnect();
      try { oscillator.stop(); } catch (error) { /* Already stopped. */ }
    });
    nodes.clear();
  };

  const unlock = async () => {
    if (!context || context.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser cannot play the set timer buzzer.');
      context = new AudioContextClass();
    }
    const unlocking = context;
    if (unlocking.state !== 'running') await unlocking.resume();
    if (context !== unlocking || unlocking.state !== 'running') {
      throw new Error('The set timer buzzer could not start.');
    }
  };

  const cue = when => {
    const oscillator = context.createOscillator();
    let gain;
    try { gain = context.createGain(); } catch (error) {
      oscillator.disconnect();
      throw error;
    }
    const item = { oscillator, gain };
    nodes.add(item);
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(1050, when);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.65, when + 0.012);
    gain.gain.setValueAtTime(0.65, when + 0.4);
    gain.gain.linearRampToValueAtTime(0, when + 0.45);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      if (!nodes.delete(item)) return;
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(when);
    oscillator.stop(when + 0.45);
  };

  const schedule = (timer, onError) => {
    if (!context || context.state !== 'running') throw new Error('Enable sound before starting the set timer.');
    if (!isValidSetTimerInterval(timer?.intervalMs)) throw new Error('Choose a valid set timer interval.');
    stop();
    const elapsedMs = getSetTimerElapsedMs(timer);
    const origin = context.currentTime;
    const interval = timer.intervalMs / 1000;
    const nextBoundary = elapsedMs < SET_TIMER_READY_MS
      ? SET_TIMER_READY_MS
      : SET_TIMER_READY_MS + (Math.floor((elapsedMs - SET_TIMER_READY_MS) / timer.intervalMs) + 1) * timer.intervalMs;
    let nextCue = origin + (nextBoundary - elapsedMs) / 1000;
    const replenish = () => {
      if (context.state !== 'running') throw new Error('The set timer sound was interrupted.');
      const audioNow = context.currentTime;
      // Missed boundaries are discarded; returning from a stalled tab never
      // produces a burst of late buzzers. Two future cues survive render delays.
      if (nextCue <= audioNow) nextCue += (Math.floor((audioNow - nextCue) / interval) + 1) * interval;
      while (nextCue <= audioNow + interval * 2) {
        cue(nextCue);
        nextCue += interval;
      }
    };
    try {
      replenish();
      scheduler = window.setInterval(() => {
        try { replenish(); } catch (error) {
          stop();
          onError?.(error);
        }
      }, 250);
    } catch (error) {
      stop();
      throw error;
    }
  };

  const close = async () => {
    stop();
    const closing = context;
    context = null;
    if (closing && closing.state !== 'closed') await closing.close();
  };

  return { unlock, schedule, stop, close };
};
