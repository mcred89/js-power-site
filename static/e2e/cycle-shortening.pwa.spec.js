const { expect, test } = require('./fixtures');
const { createProfile, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

// Generate the plan through the builder, then seed existing training records so
// the browser exercises the real persisted plan and its normal update flow.
const storedRoutine = (page, completedWeeks = 0) => page.evaluate(async seed => {
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
        routine.workouts.filter(workout => workout.cycleIndex === 0 || workout.weekIndex < seed).forEach(workout => {
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
          workout.cycleIndex === 1 && workout.weekIndex === seed && workout.name === 'Squat'
        ));
        remainingSquat.exercises[0].overrides = { weight: '333' };
        const removedDeadlift = routine.workouts.find(workout => (
          workout.cycleIndex === 1 && workout.weekIndex === seed + 1 && workout.name === 'Deadlift'
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
}, completedWeeks);

const buildMesocycle = async page => {
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
};

test('shortens a partly completed final cycle without rewriting history or losing remaining exercise edits', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await buildMesocycle(page);

  const before = await storedRoutine(page, 2);
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
  await expect(page.locator('.plan-update-schedule li')).toHaveText([
    'Cycle 2 · Week 3 · 6 workoutsSquat → Press → Deadlift → Squat → Press → Strongman',
    'Cycle 2 · Week 4 · 4 workoutsSquat → Press → Deadlift → Strongman',
  ]);
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
    ['Squat', 2, 2], ['Press', 2, 2], ['Deadlift', 2, 2],
    ['Squat', 3, 2], ['Press', 3, 2], ['Strongman', 3, 2],
    ['Squat', 4, 3], ['Press', 4, 3], ['Deadlift', 4, 3], ['Strongman', 4, 3],
  ]);
  expect(shortened.workouts.find(workout => workout.id === customized.id).exercises).toEqual(customized.exercises);

  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.next-workout .workout-week-label')).toContainText('Cycle 2 · Week 3');
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

const finalWeekSchedule = routine => routine.workouts.filter(workout => !workout.completedAt)
  .map(workout => [workout.name, workout.sourceWeek, workout.weekIndex]);
const expectedFinalWeek = [
  ['Squat', 3, 3], ['Press', 3, 3], ['Deadlift', 3, 3],
  ['Squat', 4, 3], ['Press', 4, 3], ['Strongman', 4, 3],
];

test('combines weeks four and five into six days after three completed weeks', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await buildMesocycle(page);
  const before = await storedRoutine(page, 3);
  const history = before.workouts.filter(workout => workout.completedAt);
  const deadlift = before.workouts.find(workout => workout.cycleIndex === 1 && workout.sourceWeek === 3 && workout.name === 'Deadlift');
  const removedIds = new Set(before.workouts.filter(workout => workout.cycleIndex === 1 && (
    (workout.sourceWeek === 3 && workout.name === 'Strongman') ||
    (workout.sourceWeek === 4 && workout.name === 'Deadlift')
  )).map(workout => workout.id));
  expect(history).toHaveLength(28);

  await page.reload();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.getByRole('combobox', { name: 'Cycle 2 duration', exact: true }).selectOption('3 weeks');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.locator('.plan-update-impact')).toContainText('28 completed');
  await expect(page.locator('.plan-update-impact')).toContainText('2 unstarted workouts will be removed');
  await expect(page.locator('.plan-update-schedule li')).toHaveText([
    'Cycle 2 · Week 4 · 6 workoutsSquat → Press → Deadlift → Squat → Press → Strongman',
  ]);
  await page.screenshot({ path: testInfo.outputPath('three-completed-weeks-review.png'), fullPage: true });
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await storedRoutine(page)).toEqual(before);
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  const shortened = await storedRoutine(page);
  expect(finalWeekSchedule(shortened)).toEqual(expectedFinalWeek);
  expect(shortened.cycleWeekGroups[1]).toEqual([[0], [1], [2], [3, 4]]);
  expect(shortened.workouts.filter(workout => workout.completedAt)).toEqual(history);
  expect(shortened.workouts.map(workout => [workout.id, workout.sequence])).toEqual(
    before.workouts.filter(workout => !removedIds.has(workout.id)).map(workout => [workout.id, workout.sequence]),
  );
  expect(shortened.workouts.find(workout => workout.id === deadlift.id).exercises).toEqual(deadlift.exercises);

  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.next-workout .workout-week-label')).toContainText('Cycle 2 · Week 4');
  await expect(page.locator('.next-workout .calendar-outlook')).toContainText('1 week remaining');
  expect(await storedRoutine(page)).toEqual(shortened);

  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.getByLabel('Deadlift max', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  const corrected = await storedRoutine(page);
  expect(finalWeekSchedule(corrected)).toEqual(expectedFinalWeek);
  expect(corrected.workouts.filter(workout => workout.completedAt)).toEqual(history);
  expect(corrected.workouts.find(workout => workout.id === deadlift.id).exercises[0].generated).toMatchObject({
    movement: 'Deadlift', weight: 410, prescription: '4 × 3',
  });
});

test('repairs an existing version 21 shortened routine on startup and preserves it on later reloads', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await buildMesocycle(page);
  const before = await storedRoutine(page, 3);
  const history = before.workouts.filter(workout => workout.completedAt);
  const broken = {
    ...before,
    inputs: { ...before.inputs, microCycles: before.inputs.microCycles.map(cycle => ({ ...cycle, duration: '3 weeks' })) },
    workouts: before.workouts.filter(workout => !(workout.cycleIndex === 1 && workout.sourceWeek === 3 && workout.name === 'Deadlift'))
      .map(workout => workout.completedAt ? workout : {
        ...workout, weekIndex: Math.floor(workout.sourceWeek / 2), weekLabel: `Week ${Math.floor(workout.sourceWeek / 2) + 1}`,
      }),
  };
  delete broken.cycleWeekGroups;
  expect(finalWeekSchedule(broken)).toEqual([
    ['Squat', 3, 1], ['Press', 3, 1], ['Strongman', 3, 1],
    ['Squat', 4, 2], ['Press', 4, 2], ['Deadlift', 4, 2], ['Strongman', 4, 2],
  ]);
  await testInfo.attach('version-21-broken-routine', { body: JSON.stringify(broken, null, 2), contentType: 'application/json' });

  const records = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = ['profiles', 'routines', 'templates', 'archives', 'metadata'];
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(names, 'readonly');
        const result = {};
        names.forEach(name => {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => { result[name] = request.result; };
        });
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });
  records.routines = [broken];
  records.metadata = records.metadata.map(record => record.key === 'dataSchemaVersion' ? { ...record, value: 21 } : record);
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  });
  await page.goto('about:blank');
  await page.route('**/__migration_seed__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Seed prior app database</title>' }));
  await page.goto('/__migration_seed__');
  const seeded = await page.evaluate(async stores => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('mcilroy-method');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The previous app database is still open.'));
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mcilroy-method', 21);
      request.onupgradeneeded = () => {
        Object.keys(stores).forEach(name => {
          const store = request.result.createObjectStore(name, { keyPath: name === 'metadata' ? 'key' : 'id' });
          if (name === 'routines') store.createIndex('profileId', 'profileId', { unique: false });
          if (name === 'archives') store.createIndex('profileId', 'record.profileId', { unique: false });
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(Object.keys(stores), 'readwrite');
        Object.entries(stores).forEach(([name, values]) => values.forEach(value => transaction.objectStore(name).put(value)));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      return database.version;
    } finally {
      database.close();
    }
  }, records);
  expect(seeded).toBe(21);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
  await expect(page.locator('.next-workout .workout-week-label')).toContainText('Cycle 2 · Week 4');
  await expect(page.locator('.next-workout .calendar-outlook')).toContainText('1 week remaining');
  const repaired = await storedRoutine(page);
  expect(finalWeekSchedule(repaired)).toEqual(expectedFinalWeek);
  expect(repaired.cycleWeekGroups[1]).toEqual([[0], [1], [2], [3, 4]]);
  expect(repaired.workouts.filter(workout => workout.completedAt)).toEqual(history);
  const customized = before.workouts.find(workout => workout.cycleIndex === 1 && workout.sourceWeek === 3 && workout.name === 'Squat');
  expect(repaired.workouts.find(workout => workout.id === customized.id).exercises).toEqual(customized.exercises);
  const restored = repaired.workouts.find(workout => workout.cycleIndex === 1 && workout.sourceWeek === 3 && workout.name === 'Deadlift');
  expect(restored.exercises[0].generated).toMatchObject({ movement: 'Deadlift', weight: 335, prescription: '4 × 3' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
  expect(await storedRoutine(page)).toEqual(repaired);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup).toMatchObject({ version: 22, dataSchemaVersion: 22 });
  expect(backup.routines.find(routine => routine.id === repaired.id)).toEqual(repaired);
});
