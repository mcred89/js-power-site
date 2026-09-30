const { expect, test } = require('./fixtures');
const { fillMaxes, selectVolume, selectWeakPoints } = require('./helpers');
const { assertReadable, assertReadableControls, readAppearance } = require('./control-contrast.helpers');

const appearances = [
  { appearance: 'light', colorScheme: 'light' },
  { appearance: 'dark', colorScheme: 'dark' },
  { appearance: 'system', colorScheme: 'light' },
  { appearance: 'system', colorScheme: 'dark' },
];

for (const { appearance, colorScheme } of appearances) {
  test(`calculator controls stay readable in ${appearance} appearance on a ${colorScheme} device`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.getByLabel('Appearance').selectOption(appearance);
    const primary = page.getByRole('button', { name: /Generate plan/ });
    await assertReadableControls(page);
    for (const label of await page.locator('.field-label, .option-title, .check-label, .option-text').all()) {
      await assertReadable(label);
    }

    const primaryStyle = await readAppearance(primary);
    expect(Number(primaryStyle.fontWeight)).toBeGreaterThanOrEqual(700);
    expect(Number(primaryStyle.opacity)).toBe(1);
    await primary.hover();
    await assertReadable(primary);
    await page.keyboard.press('Tab');
    await primary.focus();
    await expect(primary).toHaveCSS('outline-style', 'solid');
    await expect.poll(() => primary.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);

    const highVolume = page.getByRole('radio', { name: 'High', exact: true });
    await page.getByRole('radio', { name: 'Low', exact: true }).check();
    await assertReadable(highVolume.locator('..').locator('.option-text'));
    await page.getByRole('radio', { name: 'Low', exact: true }).press('ArrowRight');
    await expect(highVolume).toBeChecked();
    const highLabel = highVolume.locator('..').locator('.option-text');
    await assertReadable(highLabel);
    await expect(highLabel).toHaveCSS('outline-style', 'solid');
    await selectVolume(page);
    await assertReadable(highLabel);

    await fillMaxes(page);
    await selectWeakPoints(page);
    await page.getByLabel('Build a mesocycle from multiple cycles').check();
    await page.getByRole('button', { name: 'Add microcycle' }).click();
    await expect(page.getByRole('button', { name: 'Remove cycle 3' })).toBeEnabled();
    await assertReadableControls(page);
    for (const label of await page.locator('.field-label, .option-title, .check-label, .option-text').all()) {
      await assertReadable(label);
    }
    await page.getByRole('button', { name: 'Remove cycle 3' }).click();
    await page.getByRole('button', { name: 'Remove cycle 2' }).click();
    await expect(page.getByRole('button', { name: 'Remove cycle 1' })).toBeDisabled();
    await primary.click();

    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await assertReadableControls(page);
    await page.getByRole('button', { name: 'Copy Markdown' }).click();
    await assertReadable(page.getByRole('button', { name: 'Copied!' }));
    await page.locator('.program-topbar').screenshot({ path: testInfo.outputPath(`calculator-controls-${appearance}-${colorScheme}.png`) });
    await page.getByRole('button', { name: 'Edit your plan' }).click();
    await expect(primary).toBeVisible();
  });
}
