const { expect, test } = require('./fixtures');
const { createProfile, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

const competitionCard = page => page.getByRole('region', { name: 'Next competition', exact: true });
const openStrongmanDay = page => page.locator('.workout-card').filter({ hasText: 'Strongman' }).first().click();
const openPlans = async page => {
  const back = page.getByRole('button', { name: '← Back', exact: true });
  if (await back.count()) await back.click();
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
};
const preparePlan = async (page, name, button = 'New routine') => {
  await page.getByRole('button', { name: button, exact: true }).click();
  await page.getByLabel('Routine name').fill(name);
  await fillMaxes(page);
  await selectVolume(page);
  await selectWeakPoints(page);
  await page.getByLabel('3 weeks', { exact: true }).check();
  await page.getByLabel('Include a dedicated Strongman day').check();
};
const enterCompetition = async (page, name, movement = 'Zercher yoke carry', weight = '600') => {
  await page.getByLabel('Competition name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill(movement);
  await page.getByLabel('Event 1 Weight (lb)', { exact: true }).fill(weight);
  await page.getByLabel('Event 1 Distance (ft)', { exact: true }).fill('100');
};
const generatePlan = async page => {
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByRole('heading', { name: 'Your next workout', exact: true })).toBeVisible();
};
const preparationBest = page => competitionCard(page).locator('.strongman-event-results > div').filter({ has: page.locator('dt', { hasText: 'This competition · heaviest result' }) });
const copyPlan = async (page, source, name, destination) => {
  await page.locator('.plan-card').filter({ has: page.getByRole('button', { name: `View ${source}`, exact: true }) }).getByRole('button', { name: 'Copy', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Routine name', { exact: true }).fill(name);
  if (destination) await dialog.getByLabel('Destination profile', { exact: true }).selectOption({ label: destination });
  await dialog.getByRole('button', { name: 'Copy routine', exact: true }).click();
  await expect(page.getByRole('button', { name: `View ${name}`, exact: true })).toBeVisible();
};

test.use({ actionTimeout: 10000 });

test('competition preparation continues across new plans and ends without losing past records', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await createProfile(page, 'Competition Athlete');
  await preparePlan(page, 'First prep block', 'Build a routine');
  await enterCompetition(page, 'Autumn Strongman');
  await generatePlan(page);
  await openStrongmanDay(page);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const editor = page.locator('.strongman-result-editor');
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('580');
  await editor.getByLabel('Distance (ft)', { exact: true }).fill('50');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(preparationBest(page)).toContainText('580 lb · 50 ft');
  await page.getByRole('button', { name: 'Finish strongman day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next workout', exact: true })).toBeVisible();

  await openPlans(page);
  await preparePlan(page, 'Second prep block');
  await expect(page.getByText('Training toward Autumn Strongman.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Competition name', { exact: true })).toHaveCount(0);
  await generatePlan(page);
  await openStrongmanDay(page);
  await expect(competitionCard(page)).toContainText('Autumn Strongman');
  await expect(preparationBest(page)).toContainText('580 lb · 50 ft');
  await expect(page.locator('.strongman-training-entry')).toHaveCount(0);

  await openPlans(page);
  await expect(competitionCard(page)).toHaveCount(1);
  await competitionCard(page).getByRole('button', { name: 'Edit competition', exact: true }).click();
  await page.getByLabel('Event 1 Weight (lb)', { exact: true }).fill('625');
  await competitionCard(page).getByRole('button', { name: 'Save competition', exact: true }).click();
  await expect(competitionCard(page)).toContainText('Competition: 625 lb · 100 ft');
  await expect(preparationBest(page)).toContainText('580 lb · 50 ft');
  await competitionCard(page).screenshot({ path: testInfo.outputPath('shared-competition-plans.png') });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await openStrongmanDay(page);
  await expect(competitionCard(page)).toContainText('Competition: 625 lb · 100 ft');
  await expect(preparationBest(page)).toContainText('580 lb · 50 ft');

  await openPlans(page);
  await competitionCard(page).getByRole('button', { name: 'Mark competition complete', exact: true }).click();
  await expect(competitionCard(page)).toContainText('Your recorded training and records will stay saved.');
  await competitionCard(page).screenshot({ path: testInfo.outputPath('complete-competition-confirmation.png') });
  await competitionCard(page).getByRole('button', { name: 'Confirm completion', exact: true }).click();
  await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
  await copyPlan(page, 'First prep block', 'Copied after competition');
  await expect(competitionCard(page)).not.toContainText('Autumn Strongman');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await openStrongmanDay(page);
  await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();

  await openPlans(page);
  await competitionCard(page).getByRole('button', { name: 'Add competition', exact: true }).click();
  await enterCompetition(page, 'Winter Strongman', 'Zercher yoke carry', '625');
  await competitionCard(page).getByRole('button', { name: 'Save competition', exact: true }).click();
  await expect(preparationBest(page)).toContainText('No results yet');
  await competitionCard(page).getByText('Lifetime and event records', { exact: true }).click();
  await expect(competitionCard(page).locator('.strongman-event-results > div').filter({ has: page.locator('dt', { hasText: 'Lifetime · heaviest result' }) })).toContainText('580 lb · 50 ft');
  await competitionCard(page).getByRole('button', { name: 'Remove competition', exact: true }).click();
  await competitionCard(page).getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.reload();
  await openPlans(page);
  await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
  await expect(competitionCard(page)).not.toContainText('Winter Strongman');
  await expect(competitionCard(page)).not.toContainText('Autumn Strongman');
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Strongman records', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Strongman records', exact: true })).toContainText('580 lb · 50 ft');
});

test('copying between profiles uses the destination competition without changing the source meet', async ({ page }) => {
  test.setTimeout(90000);
  await createProfile(page, 'Source Athlete');
  await preparePlan(page, 'Source plan', 'Build a routine');
  await enterCompetition(page, 'Source meet', 'Source yoke', '600');
  await generatePlan(page);
  await page.getByRole('button', { name: 'Add profile', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Destination Athlete');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await preparePlan(page, 'Destination plan', 'Build a routine');
  await enterCompetition(page, 'Destination meet', 'Destination sandbag', '300');
  await generatePlan(page);
  await page.getByLabel('Current profile', { exact: true }).selectOption({ label: 'Source Athlete' });
  await openPlans(page);
  await copyPlan(page, 'Source plan', 'Copied for destination', 'Destination Athlete');
  await expect(competitionCard(page)).toContainText('Destination meet');
  await expect(competitionCard(page)).toContainText('Destination sandbag');
  await expect(competitionCard(page)).not.toContainText('Source yoke');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await openStrongmanDay(page);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const exercise = page.locator('.strongman-result-editor').getByLabel('Exercise', { exact: true });
  await expect(exercise.locator('option').filter({ hasText: 'Destination sandbag' })).toHaveCount(1);
  await expect(exercise.locator('option').filter({ hasText: 'Source yoke' })).toHaveCount(0);
  await page.locator('.strongman-result-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
  await openPlans(page);
  await competitionCard(page).getByRole('button', { name: 'Remove competition', exact: true }).click();
  await competitionCard(page).getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
  await page.getByLabel('Current profile', { exact: true }).selectOption({ label: 'Source Athlete' });
  await expect(competitionCard(page)).toContainText('Source meet');
  await copyPlan(page, 'Source plan', 'Copied without competition', 'Destination Athlete');
  await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Current profile', { exact: true }).selectOption({ label: 'Destination Athlete' });
  await openPlans(page);
  await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
});

test.describe('dated competition completion', () => {
  test.use({ timezoneId: 'America/Chicago' });

  test('completes after the local competition day on resume and startup while preserving records', async ({ page }) => {
    test.setTimeout(120000);
    const storedTracking = () => page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('mcilroy-method');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction(['profiles', 'routines'], 'readonly');
        const read = name => new Promise((resolve, reject) => {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const [profiles, routines] = await Promise.all([read('profiles'), read('routines')]);
        return { profile: profiles[0], routines };
      } finally { database.close(); }
    });

    // It is already October 2 in UTC, but still competition day in Chicago.
    await page.clock.setFixedTime(new Date('2026-10-02T04:59:00.000Z'));
    await createProfile(page, 'Dated Competition Athlete');
    await preparePlan(page, 'Dated prep plan', 'Build a routine');
    await enterCompetition(page, 'October first meet');
    await page.getByLabel('Competition date', { exact: true }).fill('2026-10-01');
    await generatePlan(page);
    await openStrongmanDay(page);
    await expect(competitionCard(page)).toContainText('October first meet');
    await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
    const editor = page.locator('.strongman-result-editor');
    await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
    await editor.getByLabel('Weight (lb)', { exact: true }).fill('580');
    await editor.getByLabel('Distance (ft)', { exact: true }).fill('50');
    await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
    await expect(preparationBest(page)).toContainText('580 lb · 50 ft');
    await openPlans(page);
    const before = await storedTracking();
    const firstCompetition = before.profile.strongmanCompetition;
    const originalPlan = before.routines.find(routine => routine.name === 'Dated prep plan');
    expect(firstCompetition.date).toBe('2026-10-01');
    expect(firstCompetition.status).toBe('active');

    // Resume just after local midnight; no manual completion is requested.
    await page.clock.setFixedTime(new Date('2026-10-02T05:01:00.000Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
    await expect.poll(async () => (await storedTracking()).profile.strongmanCompetition).toBeNull();
    const resumed = await storedTracking();
    expect(resumed.profile.strongmanCompetitionHistory.filter(item => item.id === firstCompetition.id)).toEqual([
      expect.objectContaining({ id: firstCompetition.id, status: 'completed', date: '2026-10-01', events: firstCompetition.events }),
    ]);
    expect(resumed.routines.find(routine => routine.id === originalPlan.id).strongmanLog).toEqual(originalPlan.strongmanLog);
    await copyPlan(page, 'Dated prep plan', 'Copy after dated meet');
    await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
    await preparePlan(page, 'New plan after dated meet');
    await expect(page.getByLabel('Competition name', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Event 1 name', { exact: true })).toHaveCount(0);
    await generatePlan(page);
    await openPlans(page);
    const afterPlans = await storedTracking();
    for (const name of ['Copy after dated meet', 'New plan after dated meet']) {
      expect(afterPlans.routines.find(routine => routine.name === name).inputs.strongmanCompetition).toBeNull();
    }

    // A second meet remains active on its date, then expires when reopening later.
    await competitionCard(page).getByRole('button', { name: 'Add competition', exact: true }).click();
    await enterCompetition(page, 'October second meet');
    await page.getByLabel('Competition date', { exact: true }).fill('2026-10-02');
    await competitionCard(page).getByRole('button', { name: 'Save competition', exact: true }).click();
    await expect(competitionCard(page)).toContainText('October second meet');
    const secondCompetition = (await storedTracking()).profile.strongmanCompetition;
    await page.clock.setFixedTime(new Date('2026-10-03T17:00:00.000Z'));
    await page.reload();
    await openPlans(page);
    await expect(competitionCard(page).getByRole('button', { name: 'Add competition', exact: true })).toBeVisible();
    await expect.poll(async () => (await storedTracking()).profile.strongmanCompetition).toBeNull();
    const reopened = await storedTracking();
    expect(reopened.profile.strongmanCompetitionHistory.filter(item => item.id === firstCompetition.id)).toHaveLength(1);
    expect(reopened.profile.strongmanCompetitionHistory.filter(item => item.id === secondCompetition.id)).toEqual([
      expect.objectContaining({ id: secondCompetition.id, status: 'completed', date: '2026-10-02' }),
    ]);
    expect(reopened.routines.find(routine => routine.id === originalPlan.id).strongmanLog).toEqual(originalPlan.strongmanLog);
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await page.getByRole('tab', { name: 'Strongman records', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Strongman records', exact: true })).toContainText('580 lb · 50 ft');
  });
});
