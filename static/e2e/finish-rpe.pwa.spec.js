const { test, expect } = require('./fixtures');
const { createProfile, createRoutine } = require('./helpers');

const readWorkout = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mcilroy-method');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const routines = await new Promise((resolve, reject) => {
      const request = db.transaction('routines').objectStore('routines').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return routines[0].workouts.find(workout => workout.name === 'Press');
  } finally {
    db.close();
  }
});

for (const withRpe of [true, false]) {
  test(`finishes from the final accessory ${withRpe ? 'with selected RPE' : 'without RPE'}`, async ({ page }) => {
    await createProfile(page);
    await createRoutine(page);
    await page.locator('.workout-card').filter({
      has: page.locator('strong').filter({ hasText: /^Press$/ }),
    }).first().click();
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.getByRole('button', { name: 'Complete set', exact: true }).click();
    const next = page.getByRole('button', { name: 'Next exercise', exact: true });
    // Cover both the missing-RPE-only prompt and the combined skipped-set warning.
    while (true) {
      const lastExercise = await next.isDisabled();
      if (withRpe) await page.getByRole('button', { name: 'Skip exercise', exact: true }).click();
      if (lastExercise) break;
      if (!withRpe) await next.click();
    }
    await expect(page.getByRole('group', { name: 'Main-lift RPE' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Finish this workout?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Finish workout', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '7', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await readWorkout(page)).session).toMatchObject({ status: 'inProgress', rpe: null });
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '7', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: '8', exact: true }).click();
    await dialog.getByRole('button', { name: withRpe ? 'Finish workout' : 'Finish without RPE', exact: true }).click();
    await expect(page.getByText('Workout complete', { exact: true })).toBeVisible();
    const finished = await readWorkout(page);
    expect(finished.session).toMatchObject({ status: 'completed', rpe: withRpe ? 8 : null });
    expect(finished.session.exercises[0].sets[0].status).toBe('completed');
    expect(finished.session.exercises.flatMap(exercise => exercise.sets).every(set => set.status !== 'pending')).toBe(true);
    await page.reload();
    expect(await readWorkout(page)).toEqual(finished);
  });
}
