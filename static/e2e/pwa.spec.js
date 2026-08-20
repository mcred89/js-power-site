const { expect, test } = require('./fixtures');
const { createProfile, createRoutine, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');
const usesLocalReleaseFixtures = !process.env.SMOKE_BASE_URL;

// Only the intentional failed runtime-image request is expected to reach the
// browser console; all other console errors still fail the fixture audit.
test.use({ expectedConsoleErrors: [/missing-runtime\.png/] });

test.beforeEach(async ({ request }) => {
  if (usesLocalReleaseFixtures) await request.get('/__smoke/release/reset');
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
      const request = indexedDB.open('mcilroy-method', 9);
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
  await page.locator('.plan-card').filter({ hasText: 'Primary Plan' }).getByRole('button', { name: /Use plan/ }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: /QR/i })).toHaveCount(0);
  const planDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download plan CSV' }).click();
  await expect((await planDownload).suggestedFilename()).toBe('primary-plan-plan.csv');
  await expect(page.getByRole('button', { name: 'Download history CSV' })).toBeDisabled();

  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const backup = await backupDownload;
  const backupPath = testInfo.outputPath('backup.json');
  await backup.saveAs(backupPath);
  await page.locator('input[accept="application/json,.json"]').setInputFiles(backupPath);
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
