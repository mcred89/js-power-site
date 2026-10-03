const { expect, test } = require('./fixtures');
const { createProfile, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

// Generate the plan through the builder, then seed existing training records so
// the browser exercises the real persisted plan and its normal update flow.
const storedRoutine = (page, seedProgress = false) => page.evaluate(async seed => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mcilroy-method');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('routines', seed ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('routines');
      const request = store.getAll();
      let routine;
      request.onsuccess = () => {
        [routine] = request.result;
        if (!seed) return;
        const timestamp = '2026-10-01T17:00:00.000Z';
        routine.workouts.filter(workout => workout.cycleIndex === 0 || workout.weekIndex < 2).forEach(workout => {
          workout.completedAt = timestamp;
        });
        const completed = routine.workouts.find(workout => workout.cycleIndex === 1 && workout.name === 'Squat');
        completed.session = {
          status: 'completed', startedAt: '2026-10-01T16:45:00.000Z', completedAt: timestamp,
          stoppedAt: timestamp, elapsedSeconds: 900, runningSince: null, setTimer: null,
          primaryExerciseId: completed.exercises[0].id, rpe: 8,
          exercises: completed.exercises.map(exercise => ({
            exerciseId: exercise.id, movement: exercise.generated.movement,
            prescription: exercise.generated.prescription, plannedWeight: exercise.generated.weight,
            original: null, substitutedAt: null,
            sets: [{
              id: `${exercise.id}-recorded-set`, number: 1,
              plannedWeight: exercise.generated.weight, plannedReps: 6,
              actualWeight: exercise.generated.weight, actualReps: 6,
              status: 'completed', completedAt: timestamp, skippedAt: null,
              skipActionId: null, splitSeconds: 600,
            }],
          })),
        };
        const remainingSquat = routine.workouts.find(workout => (
          workout.cycleIndex === 1 && workout.weekIndex === 2 && workout.name === 'Squat'
        ));
        remainingSquat.exercises[0].overrides = { weight: '333' };
        const removedDeadlift = routine.workouts.find(workout => (
          workout.cycleIndex === 1 && workout.weekIndex === 3 && workout.name === 'Deadlift'
        ));
        removedDeadlift.exercises[0].overrides = { weight: '444' };
        store.put(routine);
      };
      transaction.oncomplete = () => resolve(routine);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}, seedProgress);

test('shortens a partly completed final cycle without rewriting history or losing remaining exercise edits', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await createProfile(page, 'Cycle Editing Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Final cycle adjustment');
  await fillMaxes(page);
  await selectVolume(page);
  await selectWeakPoints(page);
  await page.getByLabel('Build a mesocycle from multiple cycles').check();
  await page.locator('.cycle-row').nth(0).locator('select[name="duration"]').selectOption('3 weeks');
  await page.getByLabel('Include a dedicated Strongman day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();

  const before = await storedRoutine(page, true);
  const completed = before.workouts.filter(workout => workout.completedAt);
  expect(completed).toHaveLength(24);
  const removed = before.workouts.filter(workout => workout.cycleIndex === 1 && (
    (workout.weekIndex === 2 && workout.name === 'Strongman') ||
    (workout.weekIndex === 3 && workout.name === 'Deadlift')
  ));
  expect(removed).toHaveLength(2);
  const removedIds = new Set(removed.map(workout => workout.id));
  const retained = before.workouts.filter(workout => !removedIds.has(workout.id));
  const customized = before.workouts.find(workout => (
    workout.cycleIndex === 1 && workout.weekIndex === 2 && workout.name === 'Squat'
  ));

  await page.reload();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Cycle 1 duration', exact: true })).toHaveValue('3 weeks');
  await page.getByRole('combobox', { name: 'Cycle 2 duration', exact: true }).selectOption('3 weeks');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.locator('.plan-update-impact')).toContainText('24 completed');
  await expect(page.locator('.plan-update-impact')).toContainText('2 unstarted workouts will be removed');
  await expect(page.locator('.plan-update-impact')).toContainText('Strongman: 1');
  await expect(page.locator('.plan-update-impact')).toContainText('Deadlift: 1');
  await expect(page.locator('.plan-update-warning')).toContainText('1 customized exercise');
  await expect(page.locator('.plan-update-changes')).toContainText('Cycle 2 duration');
  expect(await storedRoutine(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('cycle-shortening-review.png'), fullPage: true });
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();

  const shortened = await storedRoutine(page);
  expect(shortened.id).toBe(before.id);
  expect(shortened.inputs.microCycles.map(cycle => cycle.duration)).toEqual(['3 weeks', '3 weeks']);
  expect(shortened.workouts.map(workout => [workout.id, workout.sequence])).toEqual(
    retained.map(workout => [workout.id, workout.sequence]),
  );
  expect(shortened.workouts.filter(workout => workout.completedAt)).toEqual(completed);
  expect(shortened.workouts.filter(workout => !workout.completedAt).map(workout => [workout.name, workout.sourceWeek, workout.weekIndex])).toEqual([
    ['Squat', 2, 1], ['Press', 2, 1], ['Deadlift', 2, 1],
    ['Squat', 3, 1], ['Press', 3, 1], ['Strongman', 3, 1],
    ['Squat', 4, 2], ['Press', 4, 2], ['Deadlift', 4, 2], ['Strongman', 4, 2],
  ]);
  expect(shortened.workouts.find(workout => workout.id === customized.id).exercises).toEqual(customized.exercises);

  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.next-workout .workout-week-label')).toContainText('Cycle 2 · Week 2');
  await expect(page.locator('.next-workout .calendar-outlook')).toContainText('2 weeks remaining');
  expect(await storedRoutine(page)).toEqual(shortened);

  // A later max edit must follow the retained source stages despite sequence
  // gaps and the completed workouts' original week labels.
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Cycle 2 duration', exact: true })).toHaveValue('3 weeks');
  await page.getByLabel('Squat max', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  const corrected = await storedRoutine(page);
  expect(corrected.workouts.map(workout => workout.id)).toEqual(shortened.workouts.map(workout => workout.id));
  expect(corrected.workouts.filter(workout => workout.completedAt)).toEqual(completed);
  const futureSquats = corrected.workouts.filter(workout => !workout.completedAt && workout.name === 'Squat');
  expect(futureSquats.map(workout => workout.exercises[0].generated.weight)).toEqual([385, 410, 435]);
  expect(futureSquats.find(workout => workout.id === customized.id).exercises[0]).toMatchObject({
    id: customized.exercises[0].id, overrides: { weight: '333' },
  });
});
