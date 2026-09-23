const { expect, test } = require('./fixtures');
const { checkOptionHighlights, createProfile, createRoutine, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');
const usesLocalReleaseFixtures = !process.env.SMOKE_BASE_URL;

// Only the intentional failed runtime-image request is expected to reach the
// browser console; all other console errors still fail the fixture audit.
test.use({ expectedConsoleErrors: [/missing-runtime\.png/] });

test.beforeEach(async ({ request }) => {
  if (usesLocalReleaseFixtures) await request.get('/__smoke/release/reset');
});

for (const theme of ['light', 'dark', 'system']) {
  test(`PWA selections keep the same bright outline after tapping in ${theme} appearance`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(appearance => localStorage.setItem('mcilroy-method-appearance', appearance), theme);
    await createProfile(page);
    await page.getByRole('button', { name: 'Build a routine' }).click();
    await checkOptionHighlights(page, { touch: true });
  });
}

test('standalone tracker excludes calculator-only entry requests', async ({ page }) => {
  const scripts = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who is training?' })).toBeVisible();
  const sources = await Promise.all(scripts.map(async url => {
    const response = await page.request.get(`${url}.map`);
    return response.ok() ? response.json().then(map => map.sources || []) : [];
  }));
  expect(sources.flat().some(source => /react-router|MaxesForm|CalculatorWebsite/.test(source))).toBe(false);
});

test('PWA upgrades a version 11 training database while preserving ordinary strongman work and retired records', async ({ page }) => {
  // Seed before loading the application so its real startup must upgrade IndexedDB.
  await page.route('**/rollback-seed', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Seed</title>' }));
  await page.goto('/rollback-seed');
  const seeded = await page.evaluate(async () => {
    const timestamp = '2026-09-01T12:00:00.000Z';
    const profile = {
      id: 'rollback-profile', name: 'Returning Athlete', createdAt: timestamp,
      activeRoutineId: 'retired-events', scheduledStrengthRoutineId: 'ordinary-strength',
      activeStrongmanRoutineId: 'retired-events', activeWorkoutRoutineId: 'retired-events',
    };
    const strength = {
      id: 'ordinary-strength', profileId: profile.id, kind: 'strength', name: 'My regular routine',
      archived: false, createdAt: timestamp, updatedAt: timestamp,
      inputs: {
        maxSquat: '315', maxPress: '185', maxDead: '405', duration: '5 weeks',
        mainLiftChoice: 'Low', mesoMode: false, maxProgressionMode: 'fixed',
        includeBackoffSets: false, includeStrongmanDay: true,
        pressWeakPoint: 'Shoulders', deadliftWeakPoint: 'Back',
        pressEventEnabled: true, pressEventMovement: 'Axle clean', pressEventSets: '4', pressEventReps: '2',
      },
      workouts: [{
        id: 'ordinary-press', sequence: 1, cycleIndex: 0, cycleLabel: null,
        weekIndex: 0, weekLabel: 'Week 1', name: 'Press', completedAt: null, session: null,
        effectiveMaxes: { maxSquat: 315, maxPress: 185, maxDead: 405 },
        exercises: [{
          id: 'press-exercise', generated: { movement: 'Press', weight: 120, prescription: '4 × 6' }, overrides: {},
        }, {
          id: 'axle-exercise', generated: { movement: 'Axle clean', weight: 0, prescription: '4 × 2' },
          overrides: { weight: '145' },
        }],
      }, {
        id: 'host-event-slot', sequence: 2, cycleIndex: 0, cycleLabel: null,
        weekIndex: 0, weekLabel: 'Week 1', name: 'Strongman', kind: 'eventSlot',
        eventRef: { routineId: 'retired-events', workoutId: 'event-week-one' },
        completedAt: null, session: null, exercises: [],
      }],
    };
    const retiredRoutine = {
      id: 'retired-events', profileId: profile.id, kind: 'strongman', name: 'Retired competition block',
      status: 'active', archived: false, createdAt: timestamp, updatedAt: timestamp,
      inputs: { weeks: 12, phases: [{ id: 'base', name: 'Base building', weeks: 6 }], events: [] },
      workouts: [{
        id: 'event-week-one', eventWeek: 1, name: 'Event week 1', exercises: [], completedAt: null,
        hostRef: { routineId: strength.id, workoutId: 'host-event-slot' },
        session: {
          status: 'inProgress', startedAt: timestamp, runningSince: timestamp, elapsedSeconds: 90,
          eventBlocks: [{
            id: 'sandbag-block', movement: 'Sandbag pick', capabilitySnapshot: null,
            attempts: [{ id: 'pick-attempt', status: 'completed', actual: { load: 250, reps: 1 }, outcome: 'successful' }],
          }],
        },
      }],
      customNotes: 'Keep this retired session in the backup.',
    };
    const retiredTemplate = {
      id: 'retired-template', kind: 'strongman', name: 'Retired event template',
      inputs: retiredRoutine.inputs, createdAt: timestamp, updatedAt: timestamp,
    };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method', 11);
      request.onupgradeneeded = () => {
        ['profiles', 'routines', 'templates'].forEach(name => {
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          if (name === 'routines') store.createIndex('profileId', 'profileId', { unique: false });
        });
        request.result.createObjectStore('metadata', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['profiles', 'routines', 'templates', 'metadata'], 'readwrite');
      transaction.objectStore('profiles').put(profile);
      transaction.objectStore('routines').put(strength);
      transaction.objectStore('routines').put(retiredRoutine);
      transaction.objectStore('templates').put(retiredTemplate);
      transaction.objectStore('metadata').put({ key: 'defaultProfileId', value: profile.id });
      transaction.objectStore('metadata').put({ key: 'dataSchemaVersion', value: 11 });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    const version = database.version;
    database.close();
    return { version, profile, strength, retiredRoutine, retiredTemplate };
  });
  expect(seeded.version).toBe(11);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
  await expect(page.locator('.dashboard .eyebrow')).toHaveText('My regular routine');
  await expect(page.locator('.next-workout')).toContainText('Axle clean');
  await expect(page.locator('.next-workout')).toContainText('145 lb');
  await expect(page.getByRole('button', { name: /strongman block|add plan|view block|event session/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.locator('.plan-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'View My regular routine' })).toBeVisible();
  await expect(page.locator('.template-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /strongman block|add plan|view block|event session/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup).toMatchObject({ version: 16, dataSchemaVersion: 16 });
  expect(backup.routines).toHaveLength(1);
  expect(backup.routines[0].inputs).toEqual({
    ...seeded.strength.inputs,
    liftProgressionModes: {},
    squatTabataEnabled: false, pressTabataEnabled: false, deadliftTabataEnabled: false,
  });
  expect(backup.routines[0].workouts[0]).toEqual(seeded.strength.workouts[0]);
  expect(backup.routines[0].workouts[1]).toEqual({
    ...seeded.strength.workouts[1], kind: undefined, eventRef: undefined,
    exercises: [{
      id: 'host-event-slot:strongman-day', generated: { movement: 'Strongman day', weight: '', prescription: '' }, overrides: {},
    }],
  });
  expect(backup.templates).toEqual([]);
  expect(backup.archives).toEqual([
    { id: 'routines:retired-events', store: 'routines', record: seeded.retiredRoutine },
    { id: 'templates:retired-template', store: 'templates', record: seeded.retiredTemplate },
  ]);
  expect(backup.profiles[0]).toEqual({
    ...seeded.profile, activeRoutineId: seeded.strength.id, activeWorkoutRoutineId: null,
    activeStrongmanRoutineId: undefined, scheduledStrengthRoutineId: undefined,
    setTimerIntervalMs: 60000,
  });

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
  await expect(page.locator('.next-workout')).toContainText('Axle clean');
  const persisted = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const archives = await new Promise((resolve, reject) => {
      const request = database.transaction('archives').objectStore('archives').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = { version: database.version, archives };
    database.close();
    return result;
  });
  expect(persisted).toEqual({ version: 16, archives: backup.archives });
});

const readWorkoutSession = async page => page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mcilroy-method');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const routines = await new Promise((resolve, reject) => {
      const request = database.transaction('routines').objectStore('routines').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return routines[0].workouts[0].session;
  } finally {
    database.close();
  }
});

test('PWA repeats a set countdown within each exercise and starts each new timer independently', async ({ page }, testInfo) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write', 'notifications']);
  await page.clock.install({ time: new Date('2026-09-18T12:00:00.000Z') });
  await createProfile(page, 'Set Timer Athlete');
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const readTimerNotifications = () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration.getNotifications({ tag: 'mcilroy-set-timer' }))
      .map(notification => ({ title: notification.title, body: notification.body }));
  });
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Timed strength and sprints');
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByLabel('Add a Strongman event to Squat day').check();
  await page.getByLabel('Movement').fill('Yoke carry');
  await page.getByLabel('Sets', { exact: true }).fill('3');
  await page.getByLabel('Reps', { exact: true }).fill('1');
  await page.getByLabel('Add Tabata sprints to Squat day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await page.getByRole('button', { name: 'Open workout' }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  const timer = page.getByRole('dialog', { name: 'Set timer', exact: true });
  await expect(timer).toHaveCount(0);
  await page.clock.pauseAt(new Date('2026-09-18T12:01:00.000Z'));
  await page.getByRole('button', { name: 'Start set timer', exact: true }).click();
  await timer.getByRole('button', { name: '1.5 min', exact: true }).click();
  await expect(timer.getByLabel('Interval (minutes)')).toHaveValue('1.5');
  await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(timer.getByRole('timer', { name: 'Get ready time remaining' })).toHaveText('0:10');
  expect(await readTimerNotifications()).toEqual([]);
  await timer.getByRole('button', { name: 'Show timer notification', exact: true }).click();
  await expect.poll(readTimerNotifications).toEqual([{
    title: expect.stringMatching(/^Set timer ·/),
    body: expect.stringMatching(/^Get ready: 0:10 left \(updated .+\)\. Next buzzer: /),
  }]);
  await page.clock.fastForward(10000);
  const countdown = timer.getByRole('timer', { name: 'Interval time remaining' });
  await expect(countdown).toHaveText('1:30');
  // Each snapshot replaces the prior notification instead of filling the tray.
  await expect.poll(readTimerNotifications).toEqual([expect.objectContaining({
    body: expect.stringMatching(/^1:30 left \(updated .+\)\. Next buzzer: /),
  })]);
  await page.clock.fastForward(20000);
  await expect(countdown).toHaveText('1:10');
  await expect.poll(readTimerNotifications).toEqual([expect.objectContaining({
    body: expect.stringMatching(/^1:10 left \(updated .+\)\. Next buzzer: /),
  })]);
  await timer.getByRole('textbox', { name: 'Weight (lb)' }).fill('225');
  await timer.getByRole('textbox', { name: 'Reps', exact: true }).fill('4');
  await timer.getByRole('button', { name: 'Complete set', exact: true }).dblclick();
  expect((await readWorkoutSession(page)).exercises[0].sets.filter(set => set.status === 'completed')).toHaveLength(1);
  await expect(countdown).toHaveText('1:10');
  await expect(timer.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('225');
  await expect(timer.getByRole('textbox', { name: 'Reps', exact: true })).toHaveValue('4');
  await timer.getByRole('button', { name: 'Undo latest action', exact: true }).click();
  await timer.getByRole('button', { name: 'Skip this set', exact: true }).click();
  await timer.getByRole('button', { name: 'Undo latest action', exact: true }).click();
  await timer.getByRole('button', { name: 'Complete set', exact: true }).click();
  await expect(countdown).toHaveText('1:10');
  await expect(timer.getByText('Workout time', { exact: true })).toHaveCount(0);
  expect(await countdown.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(64);
  expect(await timer.evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('workout-set-countdown.png') });

  // A new interval starts without recording another set or changing the displayed values.
  await page.clock.fastForward(70000);
  await expect(countdown).toHaveText('1:30');
  expect((await readWorkoutSession(page)).exercises[0].sets.map(set => set.status)).toEqual([
    'completed', 'pending', 'pending', 'pending',
  ]);
  await timer.getByRole('button', { name: 'Pause timer', exact: true }).click();
  await expect.poll(readTimerNotifications).toEqual([]);
  const pausedSession = await readWorkoutSession(page);
  expect(pausedSession.runningSince).toBeTruthy();
  const workoutElapsedAt = (session, timestamp) => session.elapsedSeconds + Math.max(
    0, Math.floor((timestamp - Date.parse(session.runningSince)) / 1000),
  );
  const elapsedAtPause = workoutElapsedAt(pausedSession, await page.evaluate(() => Date.now()));
  await page.clock.fastForward(60000);
  await expect(countdown).toHaveText('1:30');
  expect(workoutElapsedAt(await readWorkoutSession(page), await page.evaluate(() => Date.now()))).toBe(elapsedAtPause + 60);
  await timer.getByRole('button', { name: 'Increase weight (lb)', exact: true }).click();
  await timer.getByRole('button', { name: 'Increase reps', exact: true }).click();
  await timer.getByRole('button', { name: 'Complete set', exact: true }).click();
  expect((await readWorkoutSession(page)).exercises[0].sets[1]).toMatchObject({
    actualWeight: '230', actualReps: '5', splitSeconds: elapsedAtPause + 60,
  });
  await timer.getByRole('button', { name: 'Resume timer', exact: true }).click();
  await expect.poll(readTimerNotifications).toEqual([expect.objectContaining({
    body: expect.stringMatching(/^1:30 left \(updated .+\)\. Next buzzer: /),
  })]);
  await page.clock.fastForward(15000);
  await expect(countdown).toHaveText('1:15');
  // An immediate stop also flushes an edit that has not reached its debounce deadline.
  await timer.getByRole('textbox', { name: 'Weight (lb)' }).fill('240');
  await timer.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await expect(timer).toHaveCount(0);
  await expect.poll(readTimerNotifications).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('240');
  expect((await readWorkoutSession(page)).setTimer).toBeNull();

  await page.getByRole('button', { name: 'Start set timer', exact: true }).click();
  await expect(timer.getByLabel('Interval (minutes)')).toHaveValue('1.5');
  await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(timer.getByRole('timer', { name: 'Get ready time remaining' })).toHaveText('0:10');
  await page.clock.fastForward(10000);
  await timer.getByRole('button', { name: 'Complete set', exact: true }).click();
  await timer.getByRole('button', { name: 'Complete set', exact: true }).click();
  await expect(timer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Yoke carry/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start set timer', exact: true })).toBeVisible();
  expect((await readWorkoutSession(page)).setTimer).toBeNull();
  expect((await readWorkoutSession(page)).runningSince).toBeTruthy();
  // Reloading an exercise boundary must not restore the finished exercise's timer.
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(timer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Yoke carry/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start set timer', exact: true }).click();
  await expect(timer.getByLabel('Interval (minutes)')).toHaveValue('1.5');
  await timer.getByRole('button', { name: '1 min', exact: true }).click();
  await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(timer.getByRole('timer', { name: 'Get ready time remaining' })).toHaveText('0:10');
  await timer.getByRole('button', { name: 'Pause timer', exact: true }).click();
  await timer.getByRole('button', { name: 'Change interval', exact: true }).click();
  await timer.getByLabel('Interval (minutes)').fill('0.75');
  await timer.getByRole('button', { name: 'Save interval', exact: true }).click();
  await expect(timer.getByRole('timer', { name: 'Get ready time remaining' })).toHaveText('0:10');
  await page.clock.fastForward(30000);
  await expect(timer.getByRole('timer', { name: 'Get ready time remaining' })).toHaveText('0:10');
  await timer.getByRole('button', { name: 'Resume timer', exact: true }).click();
  await page.clock.fastForward(17000);
  await expect(countdown).toHaveText('0:38');
  const runningSetTimer = (await readWorkoutSession(page)).setTimer;
  expect(runningSetTimer.runningSince).toBeTruthy();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(timer.getByRole('button', { name: 'Pause timer', exact: true })).toBeVisible();
  await page.clock.fastForward(30000);
  await expect(countdown).toHaveText('0:08');
  expect((await readWorkoutSession(page)).setTimer).toEqual(runningSetTimer);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await timer.getByRole('button', { name: 'Show timer notification', exact: true }).click();
  await expect.poll(async () => (await readTimerNotifications()).length).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  // The prior document's persistent notification must not outlive its owner.
  await expect.poll(readTimerNotifications).toEqual([]);
  await expect(timer.getByRole('button', { name: 'Pause timer', exact: true })).toBeVisible();
  await expect(timer.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible();
  await expect(countdown).toHaveText('0:08');
  await page.clock.fastForward(30000);
  await expect(countdown).toHaveText('0:23');
  expect((await readWorkoutSession(page)).setTimer).toEqual(runningSetTimer);
  expect((await readWorkoutSession(page)).exercises[1].sets.map(set => set.status)).toEqual(Array(3).fill('pending'));
  expect((await readWorkoutSession(page)).runningSince).toBeTruthy();
  await timer.getByRole('button', { name: 'Enable sound', exact: true }).click();
  await expect(timer.getByRole('button', { name: 'Enable sound', exact: true })).toHaveCount(0);
  await expect(countdown).toHaveText('0:23');
  expect((await readWorkoutSession(page)).setTimer).toEqual(runningSetTimer);
  await timer.getByText('More workout controls', { exact: true }).click();
  await timer.getByRole('button', { name: 'Skip exercise', exact: true }).click();
  await expect(timer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tabata sprints', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  const finishedMainWork = await readWorkoutSession(page);
  expect(finishedMainWork.setTimer).toBeNull();
  expect(finishedMainWork.exercises[0].sets.map(set => set.status)).toEqual(Array(4).fill('completed'));
  expect(finishedMainWork.exercises[2].sets[0].status).toBe('pending');
});

test('PWA runs a hands-free Tabata timer after strongman and completes one set', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-09-07T12:00:00.000Z') });
  await page.addInitScript(() => {
    window.__tabataTones = [];
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function trackedOscillator() {
      const oscillator = createOscillator.call(this);
      const setFrequency = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      oscillator.frequency.setValueAtTime = (frequency, time) => {
        window.__tabataTones.push({ frequency, time });
        return setFrequency(frequency, time);
      };
      return oscillator;
    };
  });
  await createProfile(page, 'Sprint Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Strength and sprints');
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByLabel('Include three descending back-off sets').check();
  await page.getByLabel('Add a Strongman event to Squat day').check();
  await page.getByLabel('Movement').fill('Yoke carry');
  await page.getByLabel('Sets', { exact: true }).fill('3');
  await page.getByLabel('Reps', { exact: true }).fill('1');
  await page.getByLabel('Add Tabata sprints to Squat day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open workout' }).click();
  await expect(page.locator('.exercise-row').last()).toContainText('Tabata sprints');
  await expect(page.locator('.exercise-row').nth(-2)).toContainText('Strongman event: Yoke carry');
  await page.getByRole('button', { name: 'Start workout' }).click();
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole('button', { name: 'Skip exercise', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Tabata sprints', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next exercise' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Complete round', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Reps', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Weight (lb)', exact: true })).toHaveCount(0);
  await page.clock.pauseAt(new Date('2026-09-07T12:01:00.000Z'));
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  const timer = page.getByRole('dialog', { name: 'Tabata timer' });
  await expect(timer).toHaveClass(/tabata-timer-warmup/);
  await expect(timer.getByRole('timer', { name: 'Warm up time remaining' })).toHaveText('1:00');
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 1 of 8');
  await expect(timer.locator('.tabata-timer-total')).toContainText('0:00 / 4:50');
  const warmupColor = await timer.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.clock.fastForward(60000);
  await expect(timer).toHaveClass(/tabata-timer-sprint/);
  await expect(timer.getByRole('timer', { name: 'Sprint time remaining' })).toHaveText('0:20');
  const sprintColor = await timer.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.screenshot({ path: testInfo.outputPath('tabata-sprint.png') });
  await page.clock.fastForward(20000);
  await expect(timer).toHaveClass(/tabata-timer-rest/);
  await expect(timer.getByRole('timer', { name: 'Rest time remaining' })).toHaveText('0:10');
  const restColor = await timer.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(new Set([warmupColor, sprintColor, restColor]).size).toBe(3);
  await page.screenshot({ path: testInfo.outputPath('tabata-rest.png') });
  const tones = await page.evaluate(() => window.__tabataTones);
  expect(tones.filter(tone => tone.frequency === 1050)).toHaveLength(8);
  expect(tones.filter(tone => tone.frequency === 330)).toHaveLength(7);
  expect(tones.find(tone => tone.frequency === 330).time - tones.find(tone => tone.frequency === 1050).time).toBeCloseTo(20);
  await page.clock.fastForward(10000);
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 2 of 8');
  await page.getByRole('button', { name: 'Pause timer', exact: true }).click();
  await page.clock.fastForward(20000);
  await expect(timer.getByRole('timer', { name: 'Sprint time remaining' })).toHaveText('0:20');
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await page.getByRole('button', { name: 'Resume timer', exact: true }).click();
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 2 of 8');
  await page.clock.fastForward(180000);
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 8 of 8');
  await expect(timer.getByRole('timer', { name: 'Sprint time remaining' })).toHaveText('0:20');
  await page.clock.fastForward(20000);
  await expect(timer).toHaveClass(/tabata-timer-complete/);
  await expect(timer.locator('.tabata-timer-total')).toContainText('4:50 / 4:50');
  await page.getByRole('button', { name: 'Back to workout', exact: true }).click();
  await expect(page.getByText('Tabata complete', { exact: true })).toBeVisible();
  const savedSets = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const routines = await new Promise((resolve, reject) => {
      const request = database.transaction('routines').objectStore('routines').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return routines[0].workouts[0].session.exercises.slice(-1)[0].sets;
  });
  expect(savedSets).toHaveLength(1);
  expect(savedSets[0]).toMatchObject({ status: 'completed', tabataTimer: { elapsedMs: 290000, runningSince: null } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

const openTabataFinisher = async page => {
  await createProfile(page, 'Tabata Controls Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Tabata Controls Plan');
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByLabel('Add Tabata sprints to Squat day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();
  await page.getByRole('button', { name: 'Open workout' }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: 'Skip exercise', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tabata sprints', exact: true })).toBeVisible();
};

const readTabataSets = async page => page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mcilroy-method');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const routines = await new Promise((resolve, reject) => {
      const request = database.transaction('routines').objectStore('routines').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return routines[0].workouts[0].session.exercises.slice(-1)[0].sets;
  } finally {
    database.close();
  }
});

test('PWA completes a Tabata set without starting audio or recording timer duration', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__tabataAudioContexts = 0;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.__tabataAudioContexts += 1;
      }
    };
  });
  await openTabataFinisher(page);
  await page.screenshot({ path: testInfo.outputPath('tabata-completion-option.png') });
  await page.getByRole('button', { name: 'Complete without timer', exact: true }).click();
  await expect(page.getByText('Tabata complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Tabata timer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View finished timer', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__tabataAudioContexts)).toBe(0);
  const savedSets = await readTabataSets(page);
  expect(savedSets).toHaveLength(1);
  expect(savedSets[0]).toMatchObject({ status: 'completed', tabataTimer: null });
  expect(savedSets[0].completedAt).toBeTruthy();

  await page.reload();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await page.getByRole('button', { name: 'Next exercise', exact: true }).click();
  await expect(page.getByText('Tabata complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View finished timer', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo latest action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete without timer', exact: true })).toBeVisible();
  expect((await readTabataSets(page))[0]).toMatchObject({ status: 'pending', tabataTimer: null });
});

test('PWA advances Tabata intervals while running and paused, then completes the last sprint', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-09-07T12:00:00.000Z') });
  await openTabataFinisher(page);
  await page.clock.pauseAt(new Date('2026-09-07T12:01:00.000Z'));
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  const timer = page.getByRole('dialog', { name: 'Tabata timer' });
  const nextInterval = timer.getByRole('button', { name: 'Next interval', exact: true });
  await expect(timer).toHaveClass(/tabata-timer-warmup/);
  await nextInterval.click();
  await expect(timer).toHaveClass(/tabata-timer-sprint/);
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 1 of 8');
  await expect(timer.getByRole('timer', { name: 'Sprint time remaining' })).toHaveText('0:20');
  await page.clock.fastForward(5000);
  await expect(timer.getByRole('timer', { name: 'Sprint time remaining' })).toHaveText('0:15');
  await nextInterval.click();
  await expect(timer).toHaveClass(/tabata-timer-rest/);
  await expect(timer.getByRole('timer', { name: 'Rest time remaining' })).toHaveText('0:10');
  await timer.getByRole('button', { name: 'Pause timer', exact: true }).click();
  await nextInterval.click();
  await expect(timer).toHaveClass(/tabata-timer-sprint/);
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 2 of 8');
  await expect(timer.locator('.tabata-timer-direction')).toHaveText('Paused');
  await page.clock.fastForward(20000);
  await expect(timer.getByRole('timer', { name: 'Sprint time remaining' })).toHaveText('0:20');
  await page.screenshot({ path: testInfo.outputPath('tabata-next-interval.png') });
  expect(await timer.evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await readTabataSets(page))[0]).toMatchObject({
    status: 'pending', tabataTimer: { elapsedMs: 90000, runningSince: null },
  });

  await page.reload();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await page.getByRole('button', { name: 'Resume timer', exact: true }).click();
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 2 of 8');
  await page.clock.fastForward(180000);
  await expect(timer.locator('.tabata-timer-round')).toHaveText('Sprint 8 of 8');
  await nextInterval.click();
  await expect(timer).toHaveClass(/tabata-timer-complete/);
  await expect(nextInterval).toHaveCount(0);
  await timer.getByRole('button', { name: 'Back to workout', exact: true }).click();
  await expect(page.getByText('Tabata complete', { exact: true })).toBeVisible();
  const savedSets = await readTabataSets(page);
  expect(savedSets).toHaveLength(1);
  expect(savedSets[0]).toMatchObject({ status: 'completed', tabataTimer: { elapsedMs: 290000, runningSince: null } });
});

test('PWA coalesces typed drafts and folds an immediate action into one durable write', async ({ page }) => {
  await page.addInitScript(() => {
    window.__routineWrites = 0;
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function instrumentedTransaction(stores, mode, ...rest) {
      const names = Array.isArray(stores) ? stores : [stores];
      if (mode === 'readwrite' && names.includes('routines')) window.__routineWrites += 1;
      return original.call(this, stores, mode, ...rest);
    };
  });
  await createProfile(page, 'Draft Athlete');
  await createRoutine(page, { name: 'Draft Plan' });
  await page.getByRole('button', { name: 'Open workout' }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  const weight = page.getByRole('textbox', { name: 'Weight (lb)' });
  await page.evaluate(() => { window.__routineWrites = 0; });
  await weight.fill('1234567890');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__routineWrites)).toBe(0);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__routineWrites)).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('1234567890');

  await page.evaluate(() => { window.__routineWrites = 0; });
  await page.getByRole('textbox', { name: 'Reps' }).fill('9876543210');
  await page.getByRole('button', { name: 'Complete set' }).click();
  expect(await page.evaluate(() => window.__routineWrites)).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await expect(page.getByText('1/4 sets')).toBeVisible();
  await page.getByRole('button', { name: 'Undo latest action' }).click();
  await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('9876543210');
});

test('PWA bounds long History and Progress DOM while retaining complete metrics', async ({ page }) => {
  await createProfile(page, 'Long History Athlete');
  await createRoutine(page, { name: 'Long History Plan' });
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const routine = await new Promise((resolve, reject) => {
      const request = database.transaction('routines').objectStore('routines').getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    const base = routine.workouts[0];
    const now = Date.now();
    routine.workouts = Array.from({ length: 150 }, (_, index) => {
      const completedAt = new Date(now - (149 - index) * 86400000).toISOString();
      const exercises = base.exercises.map((exercise, exerciseIndex) => ({
        exerciseId: exercise.id,
        movement: exercise.generated.movement,
        prescription: exercise.generated.prescription,
        sets: [{
          id: `set-${index}-${exerciseIndex}`,
          number: 1,
          status: 'completed',
          plannedWeight: exercise.generated.weight,
          plannedReps: 5,
          actualWeight: Number(exercise.generated.weight) + index,
          actualReps: 5,
          splitSeconds: 60,
        }],
      }));
      return {
        ...base,
        id: `history-${index}`,
        sequence: index + 1,
        completedAt,
        session: {
          status: 'completed',
          startedAt: new Date(Date.parse(completedAt) - 1800000).toISOString(),
          completedAt,
          elapsedSeconds: 1800,
          primaryExerciseId: exercises[0].exerciseId,
          rpe: 8,
          exercises,
        },
      };
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('routines', 'readwrite');
      transaction.objectStore('routines').put(routine);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('.history-workout')).toHaveCount(25);
  await page.getByRole('button', { name: 'Show 25 older workouts' }).click();
  await expect(page.locator('.history-workout')).toHaveCount(50);
  await page.locator('.history-workout').first().getByRole('button').click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.history-workout')).toHaveCount(50);

  await page.getByRole('button', { name: 'Progress' }).click();
  await page.getByLabel('Time range').selectOption('all');
  await expect(page.locator('.progress-metric').filter({ hasText: 'Workouts' }).locator('strong')).toHaveText('150');
  await expect(page.locator('.chart-point')).toHaveCount(120);
  await expect(page.locator('.chart-data summary')).toHaveText('View all 150 data points');
  await expect(page.locator('.chart-data tbody tr')).toHaveCount(0);
});

test('PWA updates the current plan while preserving recorded workouts and the workout queue', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await createProfile(page, 'Plan Update Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Adjustable Plan');
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByLabel('Build a mesocycle from multiple cycles').check();
  await page.getByLabel('Add a Strongman event to Deadlift day').check();
  await page.getByLabel('Movement', { exact: true }).fill("Farmer's carry");
  await page.getByLabel('Sets', { exact: true }).fill('3');
  await page.getByLabel('Reps', { exact: true }).fill('1');
  for (const lift of ['Squat', 'Press', 'Deadlift']) {
    await page.getByLabel(`Add Tabata sprints to ${lift} day`).check();
  }
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();

  // Start from a realistic existing plan with both recorded and paused sessions,
  // plus a manual future exercise edit that a plan update must keep.
  const before = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await Promise.all(['routines', 'profiles'].map(store => new Promise((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })));
      const routine = records[0][0];
      const timestamp = '2026-09-20T12:00:00.000Z';
      const completed = routine.workouts.find(workout => workout.name === 'Deadlift');
      const paused = routine.workouts.find(workout => workout.name === 'Squat');
      [completed, paused].forEach(workout => {
        const isCompleted = workout === completed;
        workout.completedAt = isCompleted ? timestamp : null;
        workout.session = {
          status: isCompleted ? 'completed' : 'paused',
          startedAt: '2026-09-20T11:45:00.000Z',
          completedAt: workout.completedAt,
          stoppedAt: timestamp,
          elapsedSeconds: 900,
          runningSince: null,
          setTimer: null,
          primaryExerciseId: workout.exercises[0].id,
          rpe: isCompleted ? 8 : null,
          exercises: workout.exercises.map(exercise => ({
            exerciseId: exercise.id,
            movement: exercise.generated.movement,
            prescription: exercise.generated.prescription,
            plannedWeight: exercise.generated.weight,
            original: null,
            substitutedAt: null,
            sets: [{
              id: `${exercise.id}-recorded-set`, number: 1,
              plannedWeight: exercise.generated.weight, plannedReps: 5,
              actualWeight: exercise.generated.weight, actualReps: 5,
              status: isCompleted ? 'completed' : 'pending',
              completedAt: workout.completedAt, skippedAt: null, skipActionId: null,
              splitSeconds: isCompleted ? 600 : null,
            }],
          })),
        };
      });
      const future = routine.workouts.find(workout => workout.name === 'Deadlift' && !workout.completedAt);
      future.exercises[0].overrides = { weight: '333' };
      future.exercises.find(exercise => exercise.generated.movement.startsWith('Strongman event:')).overrides = { weight: '175' };
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('routines', 'readwrite');
        transaction.objectStore('routines').put(routine);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      return { routine, profiles: records[1] };
    } finally {
      database.close();
    }
  });
  const readStoredPlan = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const [routines, profiles] = await Promise.all(['routines', 'profiles'].map(store => new Promise((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })));
      return { routine: routines[0], profiles };
    } finally {
      database.close();
    }
  });

  await page.reload();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  const currentPlan = page.locator('.plan-card.selected');
  await expect(currentPlan).toContainText('Current plan');
  await expect(currentPlan.getByRole('button', { name: 'Update plan', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('current-plan-update-action.png'), fullPage: true });
  await currentPlan.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Update plan', exact: true })).toBeVisible();
  const initialReviewButton = page.getByRole('button', { name: 'Review changes', exact: true });
  await expect(initialReviewButton).toBeInViewport();
  const reviewButtonBounds = await initialReviewButton.boundingBox();
  const navigationBounds = await page.getByRole('navigation', { name: 'App navigation' }).boundingBox();
  expect(reviewButtonBounds.y).toBeGreaterThanOrEqual(0);
  expect(reviewButtonBounds.y + reviewButtonBounds.height).toBeLessThanOrEqual(navigationBounds.y);
  await page.screenshot({ path: testInfo.outputPath('update-plan-editor-initial-viewport.png') });
  await expect(page.getByLabel('Deadlift max')).toHaveValue('405');
  await expect(page.getByLabel('Deadlift increase')).toHaveValue('10');
  await expect(page.getByLabel('Add Tabata sprints to Deadlift day')).toBeChecked();
  await page.getByLabel('Add Tabata sprints to Deadlift day').uncheck();
  await page.getByLabel('Deadlift max').fill('450');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  expect(await readStoredPlan()).toEqual(before);

  await currentPlan.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByLabel('Add Tabata sprints to Deadlift day')).toBeChecked();
  await expect(page.getByLabel('Deadlift max')).toHaveValue('405');
  await page.getByLabel('Add Tabata sprints to Deadlift day').uncheck();
  await page.getByLabel('Deadlift max').fill('450');
  await page.getByRole('combobox', { name: 'Max progression', exact: true }).selectOption('adaptive');
  await page.getByRole('combobox', { name: 'Deadlift progression', exact: true }).selectOption('fixed');
  await page.getByLabel('Deadlift increase').fill('25');
  await expect(page.getByLabel('Squat increase')).toHaveCount(0);
  await expect(page.getByLabel('Press increase')).toHaveCount(0);
  await page.getByLabel('Deadlift event movement').fill('Sandbag carry');
  await page.screenshot({ path: testInfo.outputPath('update-plan-editor.png'), fullPage: true });
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toBeVisible();
  await expect(page.locator('.plan-update-changes')).toContainText('Deadlift progression');
  await expect(page.locator('.plan-update-changes')).toContainText('25 lb');
  await page.screenshot({ path: testInfo.outputPath('update-plan-review.png'), fullPage: true });
  expect(await readStoredPlan()).toEqual(before);
  await page.getByRole('button', { name: 'Back to editing', exact: true }).click();
  await expect(page.getByLabel('Deadlift max')).toHaveValue('450');
  await expect(page.getByLabel('Add Tabata sprints to Deadlift day')).not.toBeChecked();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();

  const after = await readStoredPlan();
  expect(after.profiles).toEqual(before.profiles);
  expect(after.routine.id).toBe(before.routine.id);
  expect(after.routine.inputs).toMatchObject({
    maxDead: '450', deadliftIncrement: '25', deadliftEventMovement: 'Sandbag carry',
    maxProgressionMode: 'adaptive', liftProgressionModes: { deadlift: 'fixed' },
    squatTabataEnabled: true, pressTabataEnabled: true, deadliftTabataEnabled: false,
  });
  expect(after.routine.workouts.map(workout => [workout.id, workout.sequence])).toEqual(
    before.routine.workouts.map(workout => [workout.id, workout.sequence]),
  );
  after.routine.workouts.forEach(workout => {
    const previous = before.routine.workouts.find(item => item.id === workout.id);
    if (previous.completedAt || previous.session) {
      expect(workout).toEqual(previous);
      return;
    }
    expect(workout.effectiveMaxes.maxDead).toBe(450 + workout.cycleIndex * 25);
    expect(workout.effectiveMaxes.maxSquat).toBeGreaterThanOrEqual(315);
    expect(workout.effectiveMaxes.maxPress).toBeGreaterThanOrEqual(185);
    expect(workout.exercises.some(exercise => exercise.generated.movement === 'Tabata sprints')).toBe(workout.name !== 'Deadlift');
    const retained = previous.exercises.filter(exercise => (
      workout.name !== 'Deadlift' || exercise.generated.movement !== 'Tabata sprints'
    ));
    expect(workout.exercises.map(exercise => exercise.id)).toEqual(retained.map(exercise => exercise.id));
    expect(workout.exercises.map(exercise => exercise.overrides)).toEqual(retained.map(exercise => exercise.overrides));
    if (workout.name === 'Deadlift') {
      expect(workout.exercises.find(exercise => exercise.generated.movement.startsWith('Strongman event:')).generated).toMatchObject({
        movement: 'Strongman event: Sandbag carry', prescription: '3 × 1',
      });
      expect(workout.exercises[0].generated.weight).not.toBe(previous.exercises[0].generated.weight);
    }
  });

  await page.reload();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByLabel('Add Tabata sprints to Squat day')).toBeChecked();
  await expect(page.getByLabel('Add Tabata sprints to Press day')).toBeChecked();
  await expect(page.getByLabel('Add Tabata sprints to Deadlift day')).not.toBeChecked();
  await expect(page.getByLabel('Deadlift max')).toHaveValue('450');
  await expect(page.getByLabel('Deadlift increase')).toHaveValue('25');
  await expect(page.getByRole('combobox', { name: 'Max progression', exact: true })).toHaveValue('adaptive');
  await expect(page.getByRole('combobox', { name: 'Deadlift progression', exact: true })).toHaveValue('fixed');
  await expect(page.getByRole('combobox', { name: 'Squat progression', exact: true })).toHaveValue('');
  expect(await readStoredPlan()).toEqual(after);
});

test('PWA tracks an autosaved workout session, history, and max correction', async ({ page }) => {
  await createProfile(page);
  await createRoutine(page);
  const squatWorkoutCards = () => page.locator('.workout-card').filter({
    has: page.locator('strong').filter({ hasText: /^Squat$/ }),
  });
  await expect(page.locator('.workout-card').first().locator('.workout-maxes')).toHaveText(
    'Maxes: Squat 315 · Press 185 · Deadlift 405 lb',
  );

  await page.getByRole('button', { name: 'Open workout' }).click();
  await expect(page.getByRole('heading', { name: 'Squat' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit exercises' }).click();
  const firstExercise = page.locator('.exercise-row').first();
  await firstExercise.getByLabel('Weight').fill('222');
  await page.getByRole('button', { name: 'Done editing' }).click();
  await expect(firstExercise.getByText('222 lb')).toBeVisible();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByLabel('Workout in progress')).toBeVisible();
  await page.getByRole('button', { name: 'Increase weight (lb)' }).click();
  await page.getByRole('button', { name: 'Decrease reps' }).click();
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('1/4 sets')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Workout in progress')).toBeVisible();
  await page.getByRole('button', { name: 'Resume workout' }).click();
  await expect(page.getByText('1/4 sets')).toBeVisible();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout' }).click();
  const finishDialog = page.getByRole('dialog');
  await expect(finishDialog).toContainText('planned sets will be recorded as skipped');
  await finishDialog.getByRole('button', { name: 'Finish workout' }).click();
  await expect(page.getByText('Workout complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Completed sets')).toBeVisible();
  await expect(page.getByText('Skipped sets')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(squatWorkoutCards().locator('.workout-maxes')).toHaveText(
    'Maxes: Squat 315 · Press 185 · Deadlift 405 lb',
  );
  await squatWorkoutCards().click();
  await expect(page.getByText('227 lb × 5 reps')).toBeVisible();
  await expect(page.locator('.history-summary')).toContainText('8');
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Plans' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Routine name').fill('Renamed Smoke Plan');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Routine renamed.')).toBeVisible();
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.getByLabel('Squat max').fill('400');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await squatWorkoutCards().click();
  await expect(page.getByText('227 lb × 5 reps')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await squatWorkoutCards().first().click();
  await expect(page.getByText('280 lb')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'History' }).click();
  await squatWorkoutCards().click();
  await page.getByRole('button', { name: 'Return to workout queue' }).click();
  await expect(page.getByText('Workout returned to your queue.')).toBeVisible();
  await page.getByRole('button', { name: 'Leave' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Completed workouts will appear here.')).toBeVisible();
});

test('PWA supports multiple profiles, routines, downloads, and backup import preview', async ({ page }, testInfo) => {
  await createProfile(page);
  await createRoutine(page, { name: 'Primary Plan', duration: '3 weeks' });
  await page.getByRole('button', { name: 'Plans' }).click();
  await page.getByRole('button', { name: 'New routine' }).click();
  await page.getByLabel('Routine name').fill('Second Plan');
  await fillMaxes(page, { squat: '300', press: '175', deadlift: '390' });
  await selectVolume(page, 'High');
  await selectWeakPoints(page);
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await page.getByRole('button', { name: 'Plans' }).click();
  await expect(page.locator('.plan-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'View Primary Plan' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Receive with QR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download plan CSV' })).toHaveCount(0);
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const backup = await backupDownload;
  const backupPath = testInfo.outputPath('backup.json');
  await backup.saveAs(backupPath);
  await page.locator('input[type="file"]').setInputFiles(backupPath);
  const importDialog = page.getByRole('dialog', { name: 'Preview import' });
  await expect(importDialog).toContainText('0 copied · 3 skipped · 0 merged');
  await importDialog.getByRole('button', { name: 'Import backup' }).click();
  await expect(page.getByText('Import complete: 0 copied, 0 merged, 3 skipped.')).toBeVisible();
  await expect(page.getByLabel('Current profile').locator('option')).toHaveCount(1);

  await page.getByRole('button', { name: 'Add profile' }).click();
  await page.getByLabel('Name').fill('Second Athlete');
  await page.getByRole('button', { name: 'Create profile' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Second Athlete' })).toBeVisible();
  await page.getByLabel('Current profile').selectOption({ label: 'Smoke Athlete' });
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
});

test('PWA persists data, has install metadata, and launches offline', async ({ page, context }) => {
  await createProfile(page, 'Offline Athlete');
  await createRoutine(page, { name: 'Offline Plan' });

  const metadata = await page.evaluate(async () => {
    const manifestResponse = await fetch('/manifest.json');
    const manifest = await manifestResponse.json();
    const iconStatuses = await Promise.all(manifest.icons.map(async icon => (await fetch(icon.src)).status));
    return { manifest, status: manifestResponse.status, iconStatuses };
  });
  expect(metadata.status).toBe(200);
  expect(metadata.manifest.display).toBe('standalone');
  expect(metadata.manifest.start_url).toBe('/');
  expect(metadata.manifest.share_target).toMatchObject({
    action: '/receive-transfer',
    method: 'POST',
  });
  expect(metadata.manifest.share_target.params.files[0].accept).toEqual(['text/plain', '.txt']);
  expect(metadata.iconStatuses).toEqual([200, 200]);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const receivedShare = await page.evaluate(async () => {
    const formData = new FormData();
    formData.append('transfer', new File(['encrypted transfer'], 'routine.txt', { type: 'text/plain' }));
    await fetch('/receive-transfer', { method: 'POST', body: formData });
    const response = await fetch('/incoming-transfer');
    return response.json();
  });
  expect(receivedShare).toEqual({ name: 'routine.txt', contents: 'encrypted transfer' });
  // The first reload after installation is deliberately offline: every emitted
  // lazy screen must come from the atomic shell without an online warm reload.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline Plan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
  for (const screen of ['Plans', 'History', 'Progress', 'Settings']) {
    await page.getByRole('button', { name: screen }).click();
    await expect(page.getByRole('heading', { name: screen === 'Settings' ? 'Settings & backup' : screen })).toBeVisible();
  }
  await context.setOffline(false);
});

test('PWA deletes a profile only after confirmation', async ({ page }) => {
  await createProfile(page, 'Delete Me');
  await page.getByRole('button', { name: 'Settings' }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete Delete Me' }).click();
  await expect(page.getByText('Settings & backup')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Delete Me' }).click();
  await expect(page.getByRole('heading', { name: 'Who is training?' })).toBeVisible();
});

test('PWA atomically installs updates and preserves release-independent transfers', async ({ page }) => {
  test.skip(!usesLocalReleaseFixtures, 'Release switching is available only from the local smoke server.');
  await page.goto('/');
  // Ensure TrackerApp has committed its update listener before asking Chromium
  // to discover the next release.
  await expect(page.getByRole('heading', { name: 'Who is training?' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const initial = await page.evaluate(async () => ({
    caches: await caches.keys(),
    controller: navigator.serviceWorker.controller.scriptURL,
  }));
  expect(initial.caches.filter(name => name.startsWith('mcilroy-shell-'))).toHaveLength(1);

  await page.evaluate(async () => {
    const formData = new FormData();
    formData.append('transfer', new File(['survives update'], 'update.txt', { type: 'text/plain' }));
    await fetch('/receive-transfer', { method: 'POST', body: formData });
  });

  await page.request.get('/__smoke/release/two');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect.poll(() => page.evaluate(async () => Boolean(
    (await navigator.serviceWorker.getRegistration()).waiting,
  ))).toBe(true);
  await expect(page.getByText('A new version is ready.')).toBeVisible();
  const waitingCaches = await page.evaluate(async () => ({
    caches: await caches.keys(),
    waiting: Boolean((await navigator.serviceWorker.getRegistration()).waiting),
  }));
  expect(waitingCaches.waiting).toBe(true);
  expect(waitingCaches.caches.filter(name => name.startsWith('mcilroy-shell-'))).toHaveLength(2);

  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Update now' }).click(),
  ]);
  await expect.poll(() => page.evaluate(async () => (
    (await caches.keys()).filter(name => name.startsWith('mcilroy-shell-')).length
  ))).toBe(1);
  const transfer = await page.evaluate(async () => (await fetch('/incoming-transfer')).json());
  expect(transfer).toEqual({ name: 'update.txt', contents: 'survives update' });

  const controllerBeforeFailedInstall = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
  await page.request.get('/__smoke/release/failed');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration.installing ? registration.installing.state : 'none';
  }), { timeout: 10000 }).toBe('none');
  const afterFailedInstall = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      caches: await caches.keys(),
      controller: navigator.serviceWorker.controller.scriptURL,
      waiting: Boolean(registration.waiting),
    };
  });
  expect(afterFailedInstall.waiting).toBe(false);
  expect(afterFailedInstall.controller).toBe(controllerBeforeFailedInstall);
  expect(afterFailedInstall.caches.filter(name => name.startsWith('mcilroy-shell-'))).toHaveLength(1);

  await page.evaluate(() => new Promise(resolve => {
    const image = new Image();
    image.onload = image.onerror = resolve;
    image.src = '/missing-runtime.png';
  }));
  const cachedFailure = await page.evaluate(async () => {
    const shell = (await caches.keys()).find(name => name.startsWith('mcilroy-shell-'));
    return Boolean(await (await caches.open(shell)).match('/missing-runtime.png'));
  });
  expect(cachedFailure).toBe(false);
});
// Real WebRTC and QR decoding; only the camera input is replaced with a canvas.
const installQrCamera = async page => page.addInitScript(() => {
  window.__qrTracks = [];
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    window.__qrCamera = canvas;
    const stream = canvas.captureStream(10);
    window.__qrTracks.push(...stream.getTracks());
    return stream;
  };
});

const scanDisplayedCodes = async (display, scanner) => {
  const image = display.getByRole('img', { name: /Device pairing code/ });
  await expect(image).toBeVisible();
  const count = Number((await image.getAttribute('alt')).match(/of (\d+)/)[1]);
  for (let index = 0; index < count; index += 1) {
    const source = await image.getAttribute('src');
    await scanner.waitForFunction(() => Boolean(window.__qrCamera));
    await scanner.evaluate(async source => {
      const image = new Image();
      image.src = source;
      await image.decode();
      window.__qrCamera.getContext('2d').drawImage(image, 0, 0, 600, 600);
    }, source);
    if (index < count - 1) {
      await expect(scanner.getByRole('status').filter({ hasText: `Scanned ${index + 1} of ${count} codes` })).toBeVisible();
      await expect(image).not.toHaveAttribute('src', source);
    }
  }
};

for (const scope of ['full backup', 'one routine']) {
  test(`PWA pairs through QR and transfers ${scope} over a real data channel`, async ({ page, browser }, testInfo) => {
    test.setTimeout(90000);
    await installQrCamera(page);
    await createProfile(page, 'Sending Athlete');
    await createRoutine(page, { name: 'QR Plan', duration: '3 weeks' });
    const receiverContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 393, height: 851 } });
    const receiver = await receiverContext.newPage();
    const errors = [];
    receiver.on('pageerror', error => errors.push(error.message));
    await receiver.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    await installQrCamera(receiver);
    try {
      await createProfile(receiver, 'Receiving Athlete');
      await receiver.getByRole('button', { name: 'Settings' }).click();
      await receiver.getByRole('button', { name: 'Receive with QR' }).click();
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.screenshot({ path: testInfo.outputPath('qr-settings.png'), fullPage: true });
      await expect(page.getByRole('button', { name: 'Open received transfer' })).toHaveCount(0);
      await page.getByRole('button', { name: `Send ${scope}` }).click();
      if (scope === 'one routine') await page.getByRole('button', { name: 'Continue to QR' }).click();
      await expect(page.getByRole('img', { name: /Device pairing code/ })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('qr-pairing.png'), fullPage: true });
      await scanDisplayedCodes(page, receiver);
      await expect(receiver.getByRole('img', { name: /Device pairing code/ })).toBeVisible();
      await page.getByRole('button', { name: 'Scan reply code' }).click();
      await scanDisplayedCodes(receiver, page);
      await expect(page.getByRole('button', { name: 'Send data' })).toBeVisible({ timeout: 35000 });
      await expect(receiver.getByText('Devices connected.')).toBeVisible();
      await page.getByRole('button', { name: 'Send data' }).click();
      await expect(page.getByText('Transfer received. Review and import it on the other device.')).toBeVisible();
      if (scope === 'one routine') await receiver.getByRole('button', { name: 'Preview import' }).click();
      const preview = receiver.getByRole('dialog', { name: 'Preview import' });
      await expect(preview).toContainText('QR Plan');
      await preview.getByRole('button', { name: 'Import backup' }).click();
      await expect(receiver.getByText(/Import complete:/)).toBeVisible();
      if (scope === 'full backup') await receiver.getByLabel('Current profile').selectOption({ label: 'Sending Athlete' });
      await receiver.getByRole('button', { name: 'Plans' }).click();
      await expect(receiver.getByRole('button', { name: 'View QR Plan' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__qrTracks.every(track => track.readyState === 'ended'))).toBe(true);
      await expect.poll(() => receiver.evaluate(() => window.__qrTracks.every(track => track.readyState === 'ended'))).toBe(true);
      expect(errors).toEqual([]);
    } finally { await receiverContext.close(); }
  });
}

test('PWA QR camera denial offers retry and cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await createProfile(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Receive with QR' }).click();
  await expect(page.getByText('Allow camera access in browser settings, then retry.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry camera' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
