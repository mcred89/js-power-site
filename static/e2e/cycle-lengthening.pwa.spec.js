const { expect, test } = require('./fixtures');
const { createProfile, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

// Create the plan in the browser before adding a realistic completed cycle and
// week. Updates then exercise the normal IndexedDB save and reload paths.
const storedRoutine = (page, seed = false) => page.evaluate(async shouldSeed => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mcilroy-method');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('routines', shouldSeed ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('routines');
      const request = store.getAll();
      let routine;
      request.onsuccess = () => {
        [routine] = request.result;
        if (!shouldSeed) return;
        const timestamp = '2026-10-01T17:00:00.000Z';
        routine.workouts.filter(workout => (
          workout.cycleIndex === 0 || (workout.cycleIndex === 1 && workout.weekIndex === 0)
        )).forEach(workout => { workout.completedAt = timestamp; });
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
          workout.cycleIndex === 1 && workout.sourceWeek === 2 && workout.name === 'Squat'
        ));
        remainingSquat.exercises[0].overrides = { movement: 'Safety bar squat', weight: '333' };
        store.put(routine);
      };
      transaction.oncomplete = () => resolve(routine);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}, seed);

const plansEstimatedEnd = page => page.locator('.plan-card.selected .plan-calendar-range > div')
  .filter({ hasText: 'Est. end' }).locator('time');
const stage = workout => [workout.cycleIndex, workout.name, workout.sourceWeek];
const schedule = routine => routine.workouts.map(workout => [...stage(workout), workout.weekIndex]);
const fourDays = ['Squat', 'Press', 'Deadlift', 'Strongman'];

test('expands future three-week cycles, restores omitted days, and saves the later estimated end', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.clock.setFixedTime(new Date('2026-10-03T17:00:00.000Z'));
  await createProfile(page, 'Cycle Lengthening Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('More recovery between sessions');
  await fillMaxes(page);
  await selectVolume(page);
  await selectWeakPoints(page);
  await page.getByLabel('Build a mesocycle from multiple cycles').check();
  await page.getByRole('button', { name: '+ Add microcycle', exact: true }).click();
  for (let index = 0; index < 3; index += 1) {
    await page.locator('.cycle-row').nth(index).locator('select[name="duration"]').selectOption('3 weeks');
  }
  await page.getByLabel('Include a dedicated Strongman day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();

  const before = await storedRoutine(page, true);
  const completed = before.workouts.filter(workout => workout.completedAt);
  const existingIds = new Set(before.workouts.map(workout => workout.id));
  const customized = before.workouts.find(workout => (
    workout.cycleIndex === 1 && workout.sourceWeek === 2 && workout.name === 'Squat'
  ));
  expect(before.workouts).toHaveLength(48);
  expect(completed).toHaveLength(22);
  await page.reload();
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 11/08/26 · 5 weeks remaining');
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(plansEstimatedEnd(page)).toHaveText('11/08/26');
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.getByRole('button', { name: 'Set future cycles to 5 weeks', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Cycle 1 duration', exact: true })).toHaveValue('3 weeks');
  await expect(page.getByRole('combobox', { name: 'Cycle 2 duration', exact: true })).toHaveValue('5 weeks');
  await expect(page.getByRole('combobox', { name: 'Cycle 3 duration', exact: true })).toHaveValue('5 weeks');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.locator('.plan-update-impact')).toContainText('22 completed');
  await expect(page.locator('.plan-update-impact')).toContainText('6 future workouts will be added');
  await expect(page.locator('.plan-update-impact')).toContainText('Deadlift: 3');
  await expect(page.locator('.plan-update-impact')).toContainText('Strongman: 3');
  await expect(page.locator('.plan-update-dates time')).toHaveText(['11/08/26', '11/29/26']);
  await expect(page.locator('.plan-update-schedule li')).toHaveText([
    ...[2, 3, 4].map(week => `Cycle 2 · Week ${week} · 4 workoutsSquat → Press → Deadlift → Strongman`),
    ...[1, 2, 3, 4, 5].map(week => `Cycle 3 · Week ${week} · 4 workoutsSquat → Press → Deadlift → Strongman`),
  ]);
  expect(await storedRoutine(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('cycle-lengthening-review.png'), fullPage: true });
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  await expect(plansEstimatedEnd(page)).toHaveText('11/29/26');

  const expanded = await storedRoutine(page);
  expect(expanded.id).toBe(before.id);
  expect(expanded.inputs.microCycles.map(cycle => cycle.duration)).toEqual(['3 weeks', '5 weeks', '5 weeks']);
  expect(expanded.workouts).toHaveLength(54);
  expect(new Set(expanded.workouts.map(workout => workout.id)).size).toBe(54);
  expect(expanded.workouts.filter(workout => workout.completedAt)).toEqual(completed);
  expect(expanded.workouts.filter(workout => existingIds.has(workout.id)).map(workout => [workout.id, workout.sequence]))
    .toEqual(before.workouts.map(workout => [workout.id, workout.sequence]));
  expect(expanded.workouts.find(workout => workout.id === customized.id).exercises).toEqual(customized.exercises);
  expect(expanded.workouts.filter(workout => !existingIds.has(workout.id)).map(stage)).toEqual([
    [1, 'Strongman', 2], [1, 'Deadlift', 3],
    [2, 'Strongman', 0], [2, 'Deadlift', 1], [2, 'Strongman', 2], [2, 'Deadlift', 3],
  ]);
  expect(expanded.workouts.filter(workout => !workout.completedAt).map(workout => [...stage(workout), workout.weekIndex])).toEqual([
    ...[2, 3, 4].flatMap(sourceWeek => fourDays.map(name => [1, name, sourceWeek, sourceWeek - 1])),
    ...[0, 1, 2, 3, 4].flatMap(sourceWeek => fourDays.map(name => [2, name, sourceWeek, sourceWeek])),
  ]);

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.next-workout .workout-week-label')).toContainText('Cycle 2 · Week 2');
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 11/29/26 · 8 weeks remaining');
  await page.reload();
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 11/29/26 · 8 weeks remaining');
  expect(await storedRoutine(page)).toEqual(expanded);
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(plansEstimatedEnd(page)).toHaveText('11/29/26');

  // Later prescription changes must retain the new days exactly once, including
  // their source-stage weights, while keeping all history and manual edits.
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.getByLabel('Deadlift max', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  const corrected = await storedRoutine(page);
  expect(corrected.workouts.map(workout => workout.id)).toEqual(expanded.workouts.map(workout => workout.id));
  expect(schedule(corrected)).toEqual(schedule(expanded));
  expect(corrected.workouts.filter(workout => workout.completedAt)).toEqual(completed);
  expect(corrected.workouts.find(workout => workout.id === customized.id).exercises).toEqual(customized.exercises);
  expect(corrected.workouts.filter(workout => !workout.completedAt && workout.name === 'Deadlift')
    .map(workout => workout.exercises[0].generated.weight)).toEqual([385, 410, 435, 340, 365, 390, 420, 445]);
  await expect(plansEstimatedEnd(page)).toHaveText('11/29/26');
});
