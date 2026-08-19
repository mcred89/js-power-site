const { expect, test } = require('./fixtures');
const { createProfile, createRoutine, fillMaxes, selectVolume } = require('./helpers');

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
  await page.reload();
  await expect(page.getByText('Offline Plan')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline Plan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
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
