const fs = require('fs');
const path = require('path');
const { expect, test } = require('./fixtures');

// Exercise the actual audio graph with Chromium's renderer. Unit-test mocks
// cannot establish that a slowed control buffer produces correctly timed PCM.
const modules = ['setTimerAudio', 'setTimer', 'setTimerInterval', 'elapsedTimer'];
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.route('**/__timer-audio-test/*.js', async route => {
    const name = path.basename(new URL(route.request().url()).pathname, '.js');
    if (!modules.includes(name)) { await route.abort(); return; }
    const source = fs.readFileSync(path.join(__dirname, '../src/data', `${name}.js`), 'utf8')
      .replace(/from '(\.\/[^']+)'/g, "from '$1.js'");
    await route.fulfill({ contentType: 'text/javascript', body: source });
  });
  await page.route('**/__timer-audio-test/page', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Timer audio rendering test</title>',
  }));
  await page.goto('/__timer-audio-test/page');
});

const renderTimer = (page, options) => page.evaluate(async ({ intervalMs, elapsedMs, duration, stop }) => {
  const { createSetTimerAudio } = await import('/__timer-audio-test/setTimerAudio.js');
  const sampleRate = 8000;
  const rendering = new OfflineAudioContext(1, duration * sampleRate, sampleRate);
  const originalAudioContext = window.AudioContext;
  const originalSetInterval = window.setInterval;
  // An offline context starts suspended; expose the running state expected of
  // an unlocked real-time context, while retaining its actual audio nodes.
  window.AudioContext = function AudioContext() {
    return {
      state: 'running',
      get currentTime() { return rendering.currentTime; },
      destination: rendering.destination,
      createOscillator: () => rendering.createOscillator(),
      createGain: () => rendering.createGain(),
      createBufferSource: () => rendering.createBufferSource(),
      createBuffer: (...args) => rendering.createBuffer(...args),
      close: () => Promise.resolve(),
    };
  };
  // Background rendering must continue even when no JavaScript poll runs.
  window.setInterval = () => 0;
  const audio = createSetTimerAudio();
  try {
    await audio.unlock();
    audio.schedule({ intervalMs, elapsedMs, runningSince: null, exerciseId: 'squat' });
    if (stop) audio.stop();
    const buffer = await rendering.startRendering();
    const samples = buffer.getChannelData(0);
    const cues = [];
    let sounding = false;
    for (let frame = 0; frame < samples.length; frame += sampleRate / 100) {
      let peak = 0;
      for (let offset = 0; offset < sampleRate / 100; offset += 1) {
        peak = Math.max(peak, Math.abs(samples[frame + offset] || 0));
      }
      const active = peak > 0.1;
      if (active && !sounding) cues.push({ start: frame / sampleRate });
      if (!active && sounding) cues[cues.length - 1].end = frame / sampleRate;
      sounding = active;
    }
    return cues;
  } finally {
    await audio.close();
    window.AudioContext = originalAudioContext;
    window.setInterval = originalSetInterval;
  }
}, options);

test('four-minute buzzers render at every rollover without JavaScript callbacks', async ({ page }) => {
  const cues = await renderTimer(page, { intervalMs: 240000, elapsedMs: 0, duration: 731 });
  expect(cues).toHaveLength(4);
  [10, 250, 490, 730].forEach((deadline, index) => {
    expect(Math.abs(cues[index].start - deadline)).toBeLessThanOrEqual(0.015);
    expect(cues[index].end - cues[index].start).toBeGreaterThan(0.4);
    expect(cues[index].end - cues[index].start).toBeLessThan(0.5);
  });
});

test('resumed sound waits for the next deadline and stopping silences queued repeats', async ({ page }) => {
  const resumed = await renderTimer(page, { intervalMs: 6000, elapsedMs: 17000, duration: 18 });
  expect(resumed.map(cue => cue.start)).toEqual([5, 11, 17]);
  const stopped = await renderTimer(page, { intervalMs: 6000, elapsedMs: 0, duration: 30, stop: true });
  expect(stopped).toEqual([]);
});
