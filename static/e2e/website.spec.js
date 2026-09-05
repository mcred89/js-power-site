const { expect, test } = require('./fixtures');
const { fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

test('website previews an independent strongman block without creating local routines', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Strongman block', exact: true }).click();
  await page.getByLabel('Block name', { exact: true }).fill('Twelve week event preparation');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event 1 name', { exact: true }).fill('Sandbag carry');
  await page.getByLabel('Event 1 family', { exact: true }).selectOption('carry');
  await page.getByRole('button', { name: 'Preview strongman block', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Twelve week event preparation' })).toBeVisible();
  await expect(page.getByText('12 event weeks · independent of your strength routine')).toBeVisible();
  await expect(page.getByText('Unsaved preview', { exact: true })).toBeVisible();
  await expect(page.getByText('Sandbag carry · Set up today').first()).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).filter(database => database.name === 'mcilroy-method'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Strength routine', exact: true }).click();
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByRole('heading', { name: '5 weeks. 15 sessions.' })).toBeVisible();
});

test('normal website generates, edits, exports, and copies a routine', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Build your routine' })).toBeVisible();
  await expect(page.getByText('Who is training?')).toHaveCount(0);
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByLabel('Include three descending back-off sets').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();

  await expect(page.getByRole('heading', { name: '5 weeks. 15 sessions.' })).toBeVisible();
  await expect(page.getByText('Squat back-off: 175 lb')).toBeVisible();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect((await csvDownload).suggestedFilename()).toBe('strength-routine.csv');
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit your plan' }).click();
  await expect(page.getByLabel('Squat max')).toHaveValue('315');
});

test('normal website supports short high-volume strongman routines', async ({ page }) => {
  await page.goto('/');
  await fillMaxes(page);
  await selectVolume(page, 'High');
  await selectWeakPoints(page, { pressWeakPoint: 'Triceps', deadliftWeakPoint: 'Glutes' });
  await page.getByLabel('3 weeks', { exact: true }).check();
  await page.getByLabel('Include a dedicated Strongman day').check();
  await page.getByLabel('Add a Strongman event to Press day').check();
  await page.getByLabel('Movement').fill('Log clean and press');
  await page.getByLabel('Sets').fill('4');
  await page.getByLabel('Reps').fill('3');
  await page.getByRole('button', { name: /Generate plan/ }).click();

  await expect(page.getByRole('heading', { name: '3 weeks. 16 sessions.' })).toBeVisible();
  await expect(page.getByText('Strongman event: Log clean and press')).toHaveCount(5);
  await expect(page.getByText('Strongman day')).toHaveCount(3);
});

test('normal website supports chained mesocycles with increasing maxes', async ({ page }) => {
  await page.goto('/');
  await fillMaxes(page);
  await selectWeakPoints(page, { deadliftWeakPoint: 'Hamstrings' });
  await page.getByLabel('Build a mesocycle from multiple cycles').check();
  await page.locator('.cycle-row').nth(0).getByRole('combobox', { name: '' }).first().selectOption('3 weeks');
  await page.locator('.cycle-row').nth(1).getByRole('combobox', { name: '' }).last().selectOption('High');
  await page.getByRole('button', { name: /Generate plan/ }).click();

  await expect(page.getByText('Maxes: Squat 315 · Press 185 · Deadlift 405 lb')).toBeVisible();
  await expect(page.getByText('Maxes: Squat 325 · Press 190 · Deadlift 415 lb')).toBeVisible();
  await expect(page.getByRole('heading', { name: '8 weeks. 30 sessions.' })).toBeVisible();
});
