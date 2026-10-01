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
const generatePlan = page => page.getByRole('button', { name: /Generate plan/ }).click();
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
