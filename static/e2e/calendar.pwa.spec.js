const { expect, test } = require('./fixtures');
const { createProfile, createRoutine, fillMaxes, selectWeakPoints } = require('./helpers');

test.use({ timezoneId: 'America/Chicago' });

const expectNoOverflow = async page => {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

// Start from a generated plan so these existing completion records retain the
// normal workout prescriptions and IDs used by the application's real loader.
const storedRoutine = (page, progress = null) => page.evaluate(async state => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mcilroy-method');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('routines', state ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('routines');
      const request = store.getAll();
      let routine;
      request.onsuccess = () => {
        [routine] = request.result;
        if (state === 'delayed') {
          routine.workouts.filter(workout => workout.weekIndex === 0).forEach(workout => {
            workout.completedAt = '2026-09-21T17:00:00.000Z';
          });
          routine.workouts.find(workout => workout.weekIndex === 1).completedAt = '2026-09-23T17:00:00.000Z';
        } else if (state === 'week-finished') {
          routine.workouts.filter(workout => workout.weekIndex === 1 && !workout.completedAt).forEach(workout => {
            workout.completedAt = '2026-10-01T17:00:00.000Z';
          });
        } else if (state === 'plan-finished') {
          routine.workouts.filter(workout => !workout.completedAt).forEach(workout => {
            workout.completedAt = '2026-10-21T17:00:00.000Z';
          });
        }
        if (state) store.put(routine);
      };
      transaction.oncomplete = () => resolve(routine);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}, progress);

test('calendar dates agree across Today, mixed cycles, plan details and training views', async ({ page }) => {
  test.setTimeout(60000);
  await page.clock.setFixedTime(new Date('2026-10-01T17:00:00.000Z'));
  await createProfile(page, 'Calendar Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Autumn competition prep');
  await fillMaxes(page);
  await selectWeakPoints(page);
  await page.getByLabel('Build a mesocycle from multiple cycles').check();
  await page.locator('.cycle-row').nth(0).locator('select[name="duration"]').selectOption('3 weeks');
  await page.getByRole('button', { name: '+ Add microcycle', exact: true }).click();
  await page.locator('.cycle-row').nth(2).locator('select[name="duration"]').selectOption('3 weeks');
  await page.getByLabel('Include a dedicated Strongman day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();

  const firstWeek = 'Cycle 1 · Week 1 · Week of 09/28/26';
  await expect(page.locator('.next-workout .workout-week-label')).toHaveText(firstWeek);
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 12/13/26 · 11 weeks remaining');
  await expectNoOverflow(page);
  await expect(page.getByText('Routine created on this phone.', { exact: true })).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/calendar-today-mobile.png', fullPage: true });

  await page.getByRole('button', { name: /^View all \d+$/ }).click();
  const cycleThreeWeekTwo = page.locator('.workout-card').filter({ hasText: 'Cycle 3 · Week 2' });
  expect(await cycleThreeWeekTwo.count()).toBeGreaterThan(1);
  await expect(cycleThreeWeekTwo.locator('.workout-week-label')).toHaveText(Array(await cycleThreeWeekTwo.count()).fill('Cycle 3 · Week 2 · Week of 11/30/26'));
  await cycleThreeWeekTwo.filter({ has: page.locator('strong', { hasText: /^Squat$/ }) }).first().click();
  await expect(page.locator('.workout-detail .workout-week-label')).toHaveText('Cycle 3 · Week 2 · Week of 11/30/26');
  await expectNoOverflow(page);
  await page.screenshot({ path: 'test-results/calendar-workout-mobile.png', fullPage: true });
  await page.locator('.compact-brand').click();
  await page.locator('.workout-card').filter({ hasText: 'Cycle 1 · Week 1' }).filter({ has: page.locator('strong', { hasText: /^Strongman$/ }) }).click();
  await expect(page.locator('.strongman-day .workout-week-label')).toHaveText(firstWeek);
  await page.locator('.compact-brand').click();

  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  const plan = page.locator('.plan-card.selected');
  await expect(plan.locator('.plan-calendar-range')).toHaveText('Est. start09/28/26Est. end12/13/26');
  await expect(plan.locator('.calendar-outlook')).toHaveText('11 weeks remaining · Final week of 12/07/26');
  await expect(plan.locator('.plan-calendar-details')).not.toHaveAttribute('open', '');
  await expectNoOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/calendar-plan-mobile.png', fullPage: true });
  await plan.getByText('Week-by-week dates', { exact: true }).click();
  await expect(plan.locator('.plan-calendar-weeks li')).toHaveText([
    'Cycle 1 · Week 1Week of 09/28/26',
    'Cycle 1 · Week 2Week of 10/05/26',
    'Cycle 1 · Week 3Week of 10/12/26',
    'Cycle 2 · Week 1Week of 10/19/26',
    'Cycle 2 · Week 2Week of 10/26/26',
    'Cycle 2 · Week 3Week of 11/02/26',
    'Cycle 2 · Week 4Week of 11/09/26',
    'Cycle 2 · Week 5Week of 11/16/26',
    'Cycle 3 · Week 1Week of 11/23/26',
    'Cycle 3 · Week 2Week of 11/30/26',
    'Cycle 3 · Week 3Week of 12/07/26',
  ]);
  await expect(plan.locator('.plan-calendar-weeks time').nth(9)).toHaveAttribute('datetime', '2026-11-30');
  await expectNoOverflow(page);
  await page.screenshot({ path: 'test-results/calendar-plan-weeks-mobile.png', fullPage: true });

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Open workout', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.locator('.active-session .workout-week-label')).toHaveText(firstWeek);
  await expectNoOverflow(page);
});

test('starting a later week early dates that activity without postponing untouched weeks', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T17:00:00.000Z'));
  await createProfile(page, 'Early Training Athlete');
  await createRoutine(page);
  await page.getByRole('button', { name: /^View all \d+$/ }).click();
  const lastWeek = page.locator('.workout-card').filter({ hasText: 'Week 5' });
  await expect(lastWeek.first().locator('.workout-week-label')).toHaveText('Week 5 · Week of 10/26/26');
  await lastWeek.first().click();
  await expect(page.locator('.workout-detail .workout-week-label')).toHaveText('Week 5 · Week of 10/26/26');
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.locator('.active-session .workout-week-label')).toHaveText('Week 5 · Week of 09/28/26');
  await page.getByRole('button', { name: '← Leave', exact: true }).click();
  await expect(page.locator('.next-workout .workout-week-label')).toHaveText('Week 1 · Week of 09/28/26');
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 10/25/26 · 4 weeks remaining');
  await expect(lastWeek.locator('.workout-week-label')).toHaveText(Array(await lastWeek.count()).fill('Week 5 · Week of 09/28/26'));

  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  const plan = page.locator('.plan-card.selected');
  await expect(plan.locator('.plan-calendar-range')).toHaveText('Started10/01/26Est. end10/25/26');
  await expect(plan.locator('.calendar-outlook')).toHaveText('4 weeks remaining · Final week of 10/19/26');
  await plan.getByText('Week-by-week dates', { exact: true }).click();
  await expect(plan.locator('.plan-calendar-weeks li')).toHaveText([
    'Week 1Week of 09/28/26',
    'Week 2Week of 10/05/26',
    'Week 3Week of 10/12/26',
    'Week 4Week of 10/19/26',
    'Week 5Week of 09/28/26',
  ]);
  await expectNoOverflow(page);
});

test('calendar estimates follow progress and local weeks while recorded dates stay unchanged', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T17:00:00.000Z'));
  await createProfile(page, 'Progress Calendar Athlete');
  await createRoutine(page, { duration: '3 weeks' });
  const original = await storedRoutine(page, 'delayed');
  await page.reload();
  await expect(page.locator('.next-workout .workout-week-label')).toHaveText('Week 2 · Week of 09/28/26');
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 10/11/26 · 2 weeks remaining');
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  const plan = page.locator('.plan-card.selected');
  await expect(plan.locator('.plan-calendar-range')).toHaveText('Started09/21/26Est. end10/11/26');
  await plan.getByText('Week-by-week dates', { exact: true }).click();
  await expect(plan.locator('.plan-calendar-weeks li')).toHaveText([
    'Week 1Completed', 'Week 2Week of 09/28/26', 'Week 3Week of 10/05/26',
  ]);
  expect(await storedRoutine(page)).toEqual(original);

  await storedRoutine(page, 'week-finished');
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.next-workout .workout-week-label')).toHaveText('Week 3 · Week of 10/05/26');
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 10/11/26 · 1 week remaining');

  // A PWA returning from the background refreshes a now-overdue week without
  // needing to reload or rewrite historical completion dates.
  await page.clock.setFixedTime(new Date('2026-10-19T17:00:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.next-workout .workout-week-label')).toHaveText('Week 3 · Week of 10/19/26');
  await expect(page.locator('.next-workout .calendar-outlook')).toHaveText('Est. end 10/25/26 · 1 week remaining');
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(plan.locator('.plan-calendar-range')).toHaveText('Started09/21/26Est. end10/25/26');
  await expect(plan.locator('.calendar-outlook')).toHaveText('1 week remaining · Final week of 10/19/26');

  await page.clock.setFixedTime(new Date('2026-10-21T17:00:00.000Z'));
  const finished = await storedRoutine(page, 'plan-finished');
  await page.reload();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(plan.locator('.plan-status')).toHaveText('Completed');
  await expect(plan.locator('.plan-calendar-range')).toHaveText('Started09/21/26Finished10/21/26');
  await expect(plan.locator('.plan-calendar-details')).toHaveCount(0);
  await expect(plan.locator('.calendar-outlook')).toHaveCount(0);
  expect(await storedRoutine(page)).toEqual(finished);
  await expectNoOverflow(page);
});
