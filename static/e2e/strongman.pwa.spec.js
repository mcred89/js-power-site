const { expect, test } = require('./fixtures');
const { createProfile, fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

const openStrongmanDay = page => page.locator('.workout-card').filter({ hasText: 'Strongman' }).first().click();
const competition = page => page.getByRole('region', { name: 'Next competition', exact: true });
const exerciseEditor = page => page.locator('.strongman-result-editor');
test.use({ actionTimeout: 10000 });

test('max weight, distance, height, and manual points keep distinct records after reload', async ({ page }) => {
  test.setTimeout(90000);
  await createProfile(page, 'Event scoring athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Event scoring prep');
  await fillMaxes(page);
  await selectVolume(page);
  await selectWeakPoints(page);
  await page.getByLabel('Include a dedicated Strongman day').check();
  const events = [
    { name: 'Max axle', goal: 'weight', setup: { Reps: 1 }, sets: [{ 'Weight (lb)': 500, Reps: 1 }, { 'Weight (lb)': 550, Reps: 1 }], best: '550 lb · 1 rep' },
    { name: 'Bag carry', goal: 'distance', setup: { 'Weight (lb)': 200, 'Time window (sec)': 60 }, sets: [{ 'Weight (lb)': 200, 'Distance (ft)': 100, 'Time window (s)': 60 }, { 'Weight (lb)': 200, 'Distance (ft)': 120, 'Time window (s)': 60 }, { 'Weight (lb)': 100, 'Distance (ft)': 200, 'Time window (s)': 60 }], best: '200 lb · 120 ft · 60 sec' },
    { name: 'Bag height', goal: 'height', setup: { 'Weight (lb)': 30 }, sets: [{ 'Weight (lb)': 30, 'Height (in)': 144 }, { 'Weight (lb)': 30, 'Height (in)': 156 }, { 'Weight (lb)': 20, 'Height (in)': 180 }], best: '30 lb · 156 in height' },
    { name: 'Choice overhead', goal: 'points', setup: { 'Time window (sec)': 60 }, rules: 'Heavy rep = 5 points; light rep = 1', sets: [{ Points: 10, 'Time window (s)': 60 }, { Points: 15, 'Time window (s)': 60 }], best: '15 points' },
  ];
  for (const [index, event] of events.entries()) {
    await page.getByRole('button', { name: 'Add event', exact: true }).click();
    const prefix = `Event ${index + 1}`;
    await page.getByLabel(`${prefix} name`, { exact: true }).fill(event.name);
    await page.getByLabel(`${prefix} record goal`, { exact: true }).selectOption(event.goal);
    for (const [label, value] of Object.entries(event.setup)) await page.getByLabel(`${prefix} ${label}`, { exact: true }).fill(String(value));
    if (event.rules) await page.getByLabel(`${prefix} scoring rules`, { exact: true }).fill(event.rules);
  }
  await page.screenshot({ path: 'test-results/strongman-scoring-setup-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await openStrongmanDay(page);
  const editor = exerciseEditor(page);
  for (const event of events) {
    await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
    await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: event.name });
    await expect(editor.getByLabel('Record goal', { exact: true })).toHaveValue(event.goal);
    for (const [index, values] of event.sets.entries()) {
      if (index) await editor.getByRole('button', { name: 'Add set', exact: true }).click();
      const set = editor.locator('.strongman-training-set').nth(index);
      for (const [label, value] of Object.entries(values)) await set.getByLabel(label, { exact: true }).fill(String(value));
    }
    await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const card = competition(page).locator('.strongman-competition-event').filter({ has: page.getByRole('heading', { name: event.name, exact: true }) });
    await expect(card.locator('.strongman-event-results').first()).toContainText(event.best);
  }
  await page.reload();
  await openStrongmanDay(page);
  await expect(competition(page)).toContainText('550 lb · 1 rep');
  await expect(competition(page)).toContainText('156 in height');
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Strongman records', exact: true }).click();
  for (const event of events) {
    await page.getByLabel('Strongman movement', { exact: true }).selectOption({ label: event.name });
    await expect(page.locator('.strongman-record-metric').first()).toContainText(event.best);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/strongman-points-progress-mobile.png', fullPage: true });
});

test('rep events retain their goal and rank matching loads and time windows', async ({ page }) => {
  test.setTimeout(90000);
  await createProfile(page, 'Rep Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('Rep event prep');
  await fillMaxes(page);
  await selectVolume(page);
  await selectWeakPoints(page);
  await page.getByLabel('Include a dedicated Strongman day').check();
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill('Log press');
  await page.getByLabel('Event 1 record goal', { exact: true }).selectOption({ label: 'More reps is better' });
  await page.getByLabel('Event 1 Weight (lb)', { exact: true }).fill('200');
  await page.getByLabel('Event 1 Time window (sec)', { exact: true }).fill('60');
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await openStrongmanDay(page);
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const editor = exerciseEditor(page);
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Log press' });
  await expect(editor.getByLabel('Record goal', { exact: true })).toHaveValue('reps');
  await expect(editor.getByLabel('Time window (s)', { exact: true })).toHaveValue('');
  for (const [index, weight, reps, seconds] of [[0, 200, 8, 60], [1, 200, 10, 60], [2, 150, 20, 60], [3, 200, 15, 120]]) {
    if (index) await editor.getByRole('button', { name: 'Add set', exact: true }).click();
    const set = editor.locator('.strongman-training-set').nth(index);
    await set.getByLabel('Weight (lb)', { exact: true }).fill(String(weight));
    await set.getByLabel('Reps', { exact: true }).fill(String(reps));
    await set.getByLabel('Time window (s)', { exact: true }).fill(String(seconds));
  }
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  const record = competition(page).locator('.strongman-event-results > div').filter({ has: page.locator('dt', { hasText: 'This competition · most reps' }) });
  await expect(record).toContainText('200 lb · 10 reps · 60 sec');
  await page.reload();
  await openStrongmanDay(page);
  await expect(record).toContainText('200 lb · 10 reps · 60 sec');
  await competition(page).getByRole('button', { name: 'Edit competition', exact: true }).click();
  await expect(page.getByLabel('Event 1 record goal', { exact: true })).toHaveValue('reps');
  await competition(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Strongman records', exact: true }).click();
  await expect(page.getByLabel('Strongman record setup')).toBeVisible();
  await expect(page.locator('.strongman-record-metric').filter({ has: page.locator('small', { hasText: 'Most reps' }) }).first()).toContainText('200 lb · 10 reps · 60 sec');
  await page.screenshot({ path: 'test-results/strongman-reps-mobile.png', fullPage: true });
});

test('strongman training supports unknown medleys, backfill, actual sets and records across plans', async ({ page }) => {
  test.setTimeout(90000);
  await createProfile(page, 'Strongman Athlete');
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill('First competition prep');
  await fillMaxes(page);
  await selectVolume(page);
  await selectWeakPoints(page);
  await page.getByLabel('Include a dedicated Strongman day').check();
  await page.getByLabel('Competition name', { exact: true }).fill('Autumn Strongman');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill('Zercher yoke carry');
  await page.getByLabel('Event 1 Weight (lb)', { exact: true }).fill('600');
  await page.getByLabel('Event 1 Distance (ft)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 2 name', { exact: true }).fill('Carry medley');
  await page.getByLabel('Event 2 type', { exact: true }).selectOption('medley');
  for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: 'Add implement', exact: true }).click();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await openStrongmanDay(page);
  await expect(page.getByRole('heading', { name: 'Strongman day', exact: true })).toBeVisible();
  await expect(competition(page)).toContainText('600 lb · 100 ft');
  await expect(competition(page)).toContainText('Implement 3 · To be announced');

  await page.getByRole('button', { name: 'Log past training', exact: true }).click();
  const editor = exerciseEditor(page);
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  const past = new Date();
  past.setDate(past.getDate() - 21);
  const pastDate = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
  await editor.getByLabel('Training date', { exact: true }).fill(pastDate);
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('580');
  await editor.getByLabel('Distance (ft)', { exact: true }).fill('50');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.compact-brand').click();
  await expect(editor.getByLabel('Weight (lb)', { exact: true })).toHaveValue('580');
  const draftRoute = await page.evaluate(() => JSON.stringify(window.history.state));
  page.once('dialog', dialog => dialog.dismiss());
  await page.goBack();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.history.state))).toBe(draftRoute);
  await expect(editor.getByLabel('Distance (ft)', { exact: true })).toHaveValue('50');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(competition(page)).toContainText('580 lb · 50 ft');
  await expect(competition(page)).toContainText('3 weeks ago');

  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await expect(editor.getByLabel('Weight (lb)', { exact: true })).toHaveValue('');
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('550');
  await editor.getByLabel('Distance (ft)', { exact: true }).fill('75');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Add set', exact: true }).click();
  const secondSet = editor.locator('.strongman-training-set').first();
  await secondSet.getByLabel('Weight (lb)', { exact: true }).fill('650');
  await secondSet.getByLabel('Distance (ft)', { exact: true }).fill('0');
  await secondSet.getByLabel('Result', { exact: true }).selectOption('failed');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(competition(page)).toContainText('580 lb · 50 ft');
  await expect(competition(page)).not.toContainText('650 lb');
  await page.reload();
  await openStrongmanDay(page);
  await expect(page.locator('.strongman-training-entry')).toContainText('650 lb · 0 ft');

  await competition(page).getByRole('button', { name: 'Edit competition', exact: true }).click();
  for (const [index, name, weight] of [[1, 'Farmers carry', '200'], [2, 'Keg carry', '250'], [3, 'Sandbag carry', '300']]) {
    await page.getByLabel(`Event 2 implement ${index} name`, { exact: true }).fill(name);
    await page.getByLabel(`Event 2 implement ${index} Weight (lb)`, { exact: true }).fill(weight);
    await page.getByLabel(`Event 2 implement ${index} Distance (ft)`, { exact: true }).fill('50');
  }
  await page.getByRole('button', { name: 'Save competition', exact: true }).click();
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Sandbag carry · Carry medley' });
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('275');
  await editor.getByLabel('Reps', { exact: true }).fill('1');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  const medley = competition(page).locator('.strongman-competition-event').filter({ has: page.getByRole('heading', { name: 'Carry medley', exact: true }) });
  await expect(medley).toContainText('275 lb · 1 rep');
  await expect(medley).toContainText('No results yet');
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('600');
  await editor.getByLabel('Reps', { exact: true }).fill('0');
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Carry medley — full event' });
  await editor.locator('.strongman-training-set').getByLabel('Time (s)', { exact: true }).fill('42.5');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(medley).toContainText('42.5 sec');
  await page.getByRole('button', { name: 'Add run', exact: true }).click();
  await expect(editor.locator('.strongman-training-set')).toHaveCount(1);
  await editor.locator('.strongman-training-implement').first().getByLabel('Weight (lb)', { exact: true }).fill('210');
  await editor.locator('.strongman-training-set').getByLabel('Time (s)', { exact: true }).fill('30');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(medley).toContainText('42.5 sec');
  await expect(page.locator('.strongman-training-entry').filter({ hasText: 'Carry medley' })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/strongman-day-mobile.png', fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Finish strongman day', exact: true }).click();
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Strongman records', exact: true }).click();
  const records = page.getByRole('article', { name: 'Strongman records', exact: true });
  await records.getByLabel('Strongman movement', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await expect(records).toContainText('580 lb · 50 ft');
  await expect(records).toContainText('650 lb · 0 ft');
  await records.getByRole('button', { name: 'Log past result', exact: true }).click();
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('400');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('tab', { name: 'Strength', exact: true }).click();
  await expect(editor.getByLabel('Weight (lb)', { exact: true })).toHaveValue('400');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(editor.getByLabel('Weight (lb)', { exact: true })).toHaveValue('400');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: 'test-results/strongman-progress-mobile.png', fullPage: true });

  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Routine name').fill('Next competition prep');
  await page.getByRole('button', { name: 'Copy routine', exact: true }).click();
  const nextPlan = page.locator('.plan-card').filter({ hasText: 'Next competition prep' });
  await expect(nextPlan).toBeVisible();
  await expect(competition(page)).toContainText('580 lb · 50 ft');
  await expect(competition(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await openStrongmanDay(page);
  await expect(page.locator('.strongman-training-entry')).toHaveCount(0);
  await expect(competition(page)).toContainText('580 lb · 50 ft');
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await editor.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await editor.getByLabel('Weight (lb)', { exact: true }).fill('400');
  await editor.getByLabel('Distance (ft)', { exact: true }).fill('20');
  await editor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Delete future workout', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('saved Strongman results remain in Progress');
  await page.getByRole('button', { name: 'Delete workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Strongman day', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Strongman records', exact: true }).click();
  await records.getByLabel('Strongman movement', { exact: true }).selectOption({ label: 'Zercher yoke carry' });
  await records.getByLabel('Strongman plan', { exact: true }).selectOption({ label: 'Next competition prep' });
  await expect(records).toContainText('400 lb · 20 ft');
});
