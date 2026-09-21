import { getSetTimerElapsedMs, isValidSetTimerInterval, SET_TIMER_READY_MS } from './setTimer';

// The buffer controls volume, not the audible pitch. A small control-rate
// envelope can repeat indefinitely on the audio thread without renderer timers
// and uses less than 3 MB even for the maximum one-hour interval.
const ENVELOPE_RATE = 200;
const BUFFER_RATE = 8000;
const MAX_CLOCK_DRIFT_SECONDS = 0.1;

export const createSetTimerAudio = () => {
  let context = null;
  let scheduler = null;
  let active = null;
  let clockOrigin = null;
  const nodes = new Set();

  const clearNodes = () => {
    nodes.forEach(node => {
      node.disconnect();
      if (node.stop) {
        try { node.stop(); } catch (error) { /* Already stopped. */ }
      }
    });
    nodes.clear();
  };

  const stop = () => {
    window.clearInterval(scheduler);
    scheduler = null;
    active = null;
    clockOrigin = null;
    clearNodes();
  };

  const fail = error => {
    const onError = active?.onError;
    stop();
    onError?.(error);
  };

  const stateChanged = () => {
    if (active && context.state !== 'running') {
      // Cancel pending sound before a suspended audio clock resumes late.
      fail(new Error('The set timer sound was interrupted.'));
    }
  };

  const unlock = async () => {
    if (!context || context.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser cannot play the set timer buzzer.');
      context = new AudioContextClass({ latencyHint: 'interactive' });
      context.addEventListener?.('statechange', stateChanged);
    }
    const unlocking = context;
    if (unlocking.state !== 'running') await unlocking.resume();
    if (context !== unlocking || unlocking.state !== 'running') {
      throw new Error('The set timer buzzer could not start.');
    }
  };

  const outputTime = () => {
    // Match the moment sound reaches the speakers to the wall-clock countdown,
    // rather than assuming the render clock has no device/Bluetooth latency.
    const timestamp = context.getOutputTimestamp?.();
    if (Number.isFinite(timestamp?.contextTime) && timestamp.contextTime > 0
      && Number.isFinite(timestamp?.performanceTime) && timestamp.performanceTime > 0) {
      return timestamp.contextTime + (performance.now() - timestamp.performanceTime) / 1000;
    }
    const latency = [context.baseLatency, context.outputLatency]
      .reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0);
    return context.currentTime - latency;
  };

  const queueLoop = (timer, elapsedMs, origin) => {
    const nextBoundary = elapsedMs < SET_TIMER_READY_MS
      ? SET_TIMER_READY_MS
      : SET_TIMER_READY_MS + (Math.floor((elapsedMs - SET_TIMER_READY_MS) / timer.intervalMs) + 1) * timer.intervalMs;
    const when = Math.max(context.currentTime, origin + nextBoundary / 1000);
    const oscillator = context.createOscillator();
    nodes.add(oscillator);
    const gain = context.createGain();
    nodes.add(gain);
    const envelope = context.createBufferSource();
    nodes.add(envelope);
    const buffer = context.createBuffer(1, timer.intervalMs * ENVELOPE_RATE / 1000, BUFFER_RATE);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < Math.ceil(0.45 * ENVELOPE_RATE); index += 1) {
      const seconds = index / ENVELOPE_RATE;
      samples[index] = 0.65 * Math.max(0, Math.min(seconds / 0.012, 1, (0.45 - seconds) / 0.05));
    }
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(1050, when);
    gain.gain.setValueAtTime(0, context.currentTime);
    envelope.buffer = buffer;
    envelope.loop = true;
    // playbackRate is evaluated once per audio block. Set it before the
    // scheduled start, so a start inside a block cannot consume the first
    // samples at the default rate and move subsequent buzzers early.
    envelope.playbackRate.setValueAtTime(ENVELOPE_RATE / BUFFER_RATE, context.currentTime);
    envelope.connect(gain.gain);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(when);
    envelope.start(when);
  };

  const align = force => {
    if (!active) return;
    if (context.state !== 'running') throw new Error('The set timer sound was interrupted.');
    const elapsedMs = getSetTimerElapsedMs(active.timer);
    const origin = outputTime() - elapsedMs / 1000;
    if (force || Math.abs(origin - clockOrigin) > MAX_CLOCK_DRIFT_SECONDS) {
      clearNodes();
      queueLoop(active.timer, elapsedMs, origin);
      clockOrigin = origin;
    }
  };

  const sync = () => {
    try { align(false); } catch (error) { fail(error); }
  };

  const schedule = (timer, onError) => {
    if (!context || context.state !== 'running') throw new Error('Enable sound before starting the set timer.');
    if (!isValidSetTimerInterval(timer?.intervalMs)) throw new Error('Choose a valid set timer interval.');
    stop();
    active = { timer, onError };
    try {
      align(true);
      // Playback repeats without these callbacks. They only correct drift or
      // device changes while JavaScript is available; missed cues stay skipped.
      scheduler = window.setInterval(sync, 250);
    } catch (error) {
      stop();
      throw error;
    }
  };

  const close = async () => {
    stop();
    const closing = context;
    context = null;
    closing?.removeEventListener?.('statechange', stateChanged);
    if (closing && closing.state !== 'closed') await closing.close();
  };

  return { unlock, schedule, sync, stop, close };
};
