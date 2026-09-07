const { expect, test } = require('./fixtures');
const { fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');

test('normal website generates, edits, exports, and copies a routine', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Build your routine' })).toBeVisible();
  await expect(page.getByText('Who is training?')).toHaveCount(0);
  await fillMaxes(page);
  await selectVolume(page, 'Low');
  await selectWeakPoints(page);
  await page.getByLabel('Include three descending back-off sets').check();
  await page.getByLabel('Add Tabata sprints to Squat day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();

  await expect(page.getByRole('heading', { name: '5 weeks. 15 sessions.' })).toBeVisible();
  await expect(page.getByText('Squat back-off: 175 lb')).toBeVisible();
  await expect(page.locator('.day').first().locator('li').last()).toHaveText('Tabata sprints · 8 rounds: 20 seconds sprint / 10 seconds rest');
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect((await csvDownload).suggestedFilename()).toBe('strength-routine.csv');
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit your plan' }).click();
  await expect(page.getByLabel('Squat max')).toHaveValue('315');
  await expect(page.getByLabel('Add Tabata sprints to Squat day')).toBeChecked();
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
  await page.getByLabel('Add Tabata sprints to Press day').check();
  await page.getByRole('button', { name: /Generate plan/ }).click();

  await expect(page.getByRole('heading', { name: '3 weeks. 16 sessions.' })).toBeVisible();
  await expect(page.getByText('Strongman event: Log clean and press')).toHaveCount(5);
  await expect(page.getByText('Strongman day')).toHaveCount(3);
  const pressDays = page.locator('.day').filter({ has: page.getByRole('heading', { name: /· Press$/ }) });
  await expect(pressDays).toHaveCount(5);
  for (const day of await pressDays.all()) {
    await expect(day.locator('li').last()).toHaveText('Tabata sprints · 8 rounds: 20 seconds sprint / 10 seconds rest');
    await expect(day.locator('li').nth(-2)).toHaveText('Strongman event: Log clean and press · 4 × 3');
    await expect(day.locator('li').nth(-3)).toHaveText('Curls · 3 × 5–20');
  }
  await expect(page.getByText('Tabata sprints ·', { exact: false })).toHaveCount(5);
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
