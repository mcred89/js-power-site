const { expect, test } = require('./fixtures');
const { createProfile, createRoutine, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');
const usesLocalReleaseFixtures = !process.env.SMOKE_BASE_URL;

// Only the intentional failed runtime-image request is expected to reach the
// browser console; all other console errors still fail the fixture audit.
test.use({ expectedConsoleErrors: [/missing-runtime\.png/] });

test.beforeEach(async ({ request }) => {
  if (usesLocalReleaseFixtures) await request.get('/__smoke/release/reset');
});

test('independent strongman baseline resumes offline and continues through weeks 11–12 after a ten-week strength block', async ({ page, context }) => {
  await createProfile(page, 'Event Athlete');
  await expect(page.getByRole('button', { name: 'Build a routine', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan strongman training', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('today-create-plans.png'), fullPage: true });
  await page.getByRole('button', { name: 'New strongman block' }).click();
  await page.getByLabel('Block name', { exact: true }).fill('Nationals preparation');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill('Sandbag carry');
  await page.getByLabel('Event 1 family', { exact: true }).selectOption('carry');
  await page.getByLabel('Event 1 focus', { exact: true }).fill('Improve the pick, retain lighter carries');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('strongman-builder.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save strongman block', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next four event days' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('strongman-block.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to training' }).click();
  await page.getByText('Add plan', { exact: true }).click();
  await page.getByRole('button', { name: 'Strength routine', exact: true }).click();
  await fillMaxes(page);
  await selectWeakPoints(page);
  await page.getByLabel('Build a mesocycle from multiple cycles').check();
  await expect(page.getByLabel('Include a dedicated Strongman day')).toBeChecked();
  await expect(page.getByLabel('Include a dedicated Strongman day')).toBeDisabled();
  await page.getByLabel('Add a Strongman event to Press day').check();
  await page.getByLabel('Movement', { exact: true }).fill('Axle clean technique');
  await page.getByLabel('Sets', { exact: true }).fill('5');
  await page.getByLabel('Reps', { exact: true }).fill('2');
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const records = await new Promise(resolve => { const request = database.transaction('routines').objectStore('routines').getAll(); request.onsuccess = () => resolve(request.result); });
    const normal = records.find(record => record.kind !== 'strongman');
    const firstHost = normal.workouts.find(workout => workout.kind === 'eventSlot');
    normal.workouts = normal.workouts.map(workout => workout.sequence < firstHost.sequence ? { ...workout, completedAt: new Date().toISOString() } : workout);
    await new Promise((resolve, reject) => { const tx = database.transaction('routines', 'readwrite'); tx.objectStore('routines').put(normal); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    database.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Open workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next event session' })).toBeVisible();
  await page.getByRole('button', { name: 'Start event day', exact: true }).click();
  await expect(page.getByText('Baseline assessment', { exact: true })).toBeVisible();
  await page.getByLabel('Block 1 weight', { exact: true }).fill('200');
  await page.getByLabel('Block 1 distance', { exact: true }).fill('0');
  await page.getByLabel('Block 1 outcome', { exact: true }).selectOption('unsuccessful');
  await page.getByRole('button', { name: 'Record attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded attempts' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('strongman-session.png'), fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded attempts' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish event day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
  const state = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const records = await new Promise(resolve => { const request = database.transaction('routines').objectStore('routines').getAll(); request.onsuccess = () => resolve(request.result); });
    database.close();
    return records;
  });
  const normal = state.find(record => record.kind !== 'strongman');
  const events = state.find(record => record.kind === 'strongman');
  expect(normal.workouts.filter(workout => workout.kind === 'eventSlot')).toHaveLength(10);
  expect(events.workouts).toHaveLength(12);
  expect(normal.workouts.find(workout => workout.kind === 'eventSlot').completedAt).toBeTruthy();
  expect(events.workouts[0].completedAt).toBeTruthy();
  expect(events.workouts[0].session.eventBlocks[0].attempts[0]).toMatchObject({ weight: 200, distance: 0, outcome: 'unsuccessful' });
  expect(events.workouts[1].session).toBeNull();
  expect(normal.workouts.filter(workout => workout.name === 'Press').every(workout => workout.exercises.some(exercise => exercise.generated.movement === 'Strongman event: Axle clean technique' && exercise.generated.prescription === '5 × 2'))).toBe(true);
  await context.setOffline(false);
  // Establish the end-of-block boundary without simulating ten weeks of lifting.
  // The final two sessions below run through the real UI and persistence path.
  const finishedStrength = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const records = await new Promise(resolve => { const request = database.transaction('routines').objectStore('routines').getAll(); request.onsuccess = () => resolve(request.result); });
    const normal = records.find(record => record.kind !== 'strongman');
    const events = records.find(record => record.kind === 'strongman');
    const completedAt = new Date().toISOString();
    normal.workouts = normal.workouts.map(workout => ({ ...workout, completedAt: workout.completedAt || completedAt }));
    events.workouts = events.workouts.map((workout, index) => index < 10 ? { ...workout, completedAt: workout.completedAt || completedAt } : workout);
    await new Promise((resolve, reject) => { const tx = database.transaction('routines', 'readwrite'); tx.objectStore('routines').put(normal); tx.objectStore('routines').put(events); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    database.close();
    return normal;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Routine complete', exact: true })).toBeVisible();
  for (const week of [11, 12]) {
    await page.getByRole('button', { name: 'Open standalone event day', exact: true }).click();
    await expect(page.getByText(new RegExp(`Nationals preparation · Week ${week} of 12`))).toBeVisible();
    await page.getByRole('button', { name: 'Start event day', exact: true }).click();
    await page.getByRole('button', { name: 'Finish event day', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Open standalone event day', exact: true })).toHaveCount(0);
  const finished = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const read = store => new Promise(resolve => { const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [routines, profiles] = await Promise.all([read('routines'), read('profiles')]);
    database.close();
    return { routines, profiles };
  });
  expect(finished.routines.find(record => record.kind !== 'strongman')).toEqual(finishedStrength);
  const completedEvents = finished.routines.find(record => record.kind === 'strongman');
  expect(completedEvents.status).toBe('complete');
  expect(completedEvents.workouts.slice(10).every(workout => workout.completedAt && workout.hostRef === null)).toBe(true);
  expect(finished.profiles[0]).toMatchObject({ activeWorkoutRoutineId: null, activeStrongmanRoutineId: null });
});

test('Today adds strongman midway through a strength routine without a persistent creation card', async ({ page }) => {
  await createProfile(page, 'Mid-block Athlete');
  await createRoutine(page, { name: 'Current strength block' });
  await expect(page.getByRole('heading', { name: 'Plan strongman training', exact: true })).toHaveCount(0);
  const original = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const routines = await new Promise(resolve => { const request = database.transaction('routines').objectStore('routines').getAll(); request.onsuccess = () => resolve(request.result); });
    database.close();
    return routines[0];
  });
  await page.getByText('Add plan', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Strength routine', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Strongman block', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('today-add-plan.png'), fullPage: true });
  await page.getByRole('button', { name: 'Strongman block', exact: true }).click();
  await page.getByLabel('Block name', { exact: true }).fill('Mid-block event training');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill('Sandbag carry');
  await page.getByRole('button', { name: 'Save strongman block', exact: true }).click();
  await page.getByRole('button', { name: 'Back to training' }).click();
  await expect(page.getByRole('button', { name: 'Open workout', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View strongman block', exact: true })).toBeVisible();
  const current = await page.evaluate(async id => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const routine = await new Promise(resolve => { const request = database.transaction('routines').objectStore('routines').get(id); request.onsuccess = () => resolve(request.result); });
    database.close();
    return routine;
  }, original.id);
  expect(current).toEqual(original);
});

test('imported active event conflicts retain attempts and resume explicitly after the original finishes', async ({ page }) => {
  await createProfile(page, 'Restoring Athlete');
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'New strongman block' }).click();
  await page.getByLabel('Block name', { exact: true }).fill('Original preparation');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill('Sandbag carry');
  await page.getByLabel('Event 1 family', { exact: true }).selectOption('carry');
  await page.getByRole('button', { name: 'Save strongman block', exact: true }).click();
  await page.getByRole('button', { name: 'Open event day', exact: true }).first().click();
  await page.getByRole('button', { name: 'Start event day', exact: true }).click();
  await page.getByLabel('Block 1 weight', { exact: true }).fill('300');
  await page.getByLabel('Block 1 distance', { exact: true }).fill('0');
  await page.getByLabel('Block 1 outcome', { exact: true }).selectOption('unsuccessful');
  await page.getByRole('button', { name: 'Record attempt', exact: true }).click();
  await page.getByRole('button', { name: 'Leave and resume later' }).click();
  const backup = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const read = store => new Promise(resolve => { const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [routines, profiles, templates] = await Promise.all([read('routines'), read('profiles'), read('templates')]);
    routines[0].name = 'Restored preparation';
    const result = { format: 'mcilroy-method-backup', version: database.version, dataSchemaVersion: database.version, routines, profiles, templates };
    database.close();
    return result;
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'event-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('dialog', { name: 'Preview import' }).getByRole('button', { name: 'Import backup', exact: true }).click();
  await expect(page.getByText(/Import complete:/)).toBeVisible();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'View Restored preparation (imported copy)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded attempts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume paused event day' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to training' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await page.getByRole('button', { name: 'Finish event day', exact: true }).click();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'View Restored preparation (imported copy)', exact: true }).click();
  await page.getByRole('button', { name: 'Activate block', exact: true }).click();
  await page.getByRole('button', { name: 'Resume paused event day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded attempts', exact: true })).toBeVisible();
  await expect(page.locator('.strongman-attempts').last()).toContainText('300 lb');
  await page.screenshot({ path: test.info().outputPath('strongman-resumed-import.png'), fullPage: true });
  await page.getByRole('button', { name: 'Finish event day', exact: true }).click();
  const state = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('mcilroy-method'); request.onsuccess = () => resolve(request.result); });
    const read = store => new Promise(resolve => { const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [routines, profiles] = await Promise.all([read('routines'), read('profiles')]);
    database.close();
    return { routines, profiles };
  });
  expect(state.routines).toHaveLength(2);
  state.routines.forEach(routine => {
    expect(routine.workouts[0].session).toMatchObject({ status: 'completed', runningSince: null });
    expect(routine.workouts[0].session.eventBlocks[0].attempts[0]).toMatchObject({ weight: 300, distance: 0, outcome: 'unsuccessful' });
  });
  expect(state.profiles[0].activeWorkoutRoutineId).toBeNull();
});

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
  await page.getByLabel('Squat max').fill('400');
  await page.getByRole('button', { name: 'Update future workouts' }).click();
  await expect(page.getByText('Future workouts updated.')).toBeVisible();

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
