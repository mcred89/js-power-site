const { test, expect } = require('./fixtures');
const { createProfile, createRoutine } = require('./helpers');
const { assertReadable, assertReadableControls, readAppearance } = require('./control-contrast.helpers');

const appearances = [
  { name: 'light', theme: 'light', colorScheme: 'light' },
  { name: 'dark', theme: 'dark', colorScheme: 'dark' },
  { name: 'system-light', theme: 'system', colorScheme: 'light' },
  { name: 'system-dark', theme: 'system', colorScheme: 'dark' },
];

const checkPrimary = async (button, expectedBackground) => {
  await expect(button).toBeEnabled();
  const appearance = await assertReadable(button);
  expect(appearance.opacity).toBe('1');
  expect(appearance.fontWeight).toBeGreaterThanOrEqual(700);
  if (expectedBackground) expect(appearance.background).toBe(expectedBackground);
  return appearance;
};

const checkSetInteractionStates = async (page, button, baseline) => {
  await button.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await checkPrimary(button, baseline.normal);
  await button.hover();
  await checkPrimary(button, baseline.hover);
  await page.mouse.move(0, 0);
  await button.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button).toBeFocused();
  const focused = await checkPrimary(button, baseline.normal);
  expect(focused.outlineStyle).toBe('solid');
  expect(focused.outlineWidth).toBeGreaterThanOrEqual(2);
  await button.tap();
  // Touch browsers may retain :hover after a tap. Either enabled action shade
  // must remain dark and legible while the next set becomes available.
  const tapped = await checkPrimary(button);
  expect([baseline.normal, baseline.hover]).toContain(tapped.background);
};

for (const appearance of appearances) {
  test(`workout actions and plan notifications stay readable in ${appearance.name}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: appearance.colorScheme });
    await page.addInitScript(theme => localStorage.setItem('mcilroy-method-appearance', theme), appearance.theme);
    await createProfile(page, 'Contrast Athlete');
    await createRoutine(page, { name: 'Contrast Plan' });
    await page.getByRole('button', { name: 'Open workout', exact: true }).click();
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();

    const complete = page.getByRole('button', { name: 'Complete set', exact: true });
    await page.mouse.move(0, 0);
    const normal = await checkPrimary(complete);
    // A pale action can still be opaque; verify a saturated green fill as well
    // as the actual text contrast and matching styles inside the timer.
    expect(normal.background).toBe('rgb(20, 107, 71)');
    await complete.hover();
    const hovered = await checkPrimary(complete);
    const baseline = { normal: normal.background, hover: hovered.background };
    await checkSetInteractionStates(page, complete, baseline);
    await assertReadableControls(page);

    const rpe = page.getByRole('group', { name: 'Main-lift RPE' });
    await rpe.getByRole('button', { name: '8', exact: true }).tap();
    await expect(rpe.getByRole('button', { name: '8', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rpe.getByRole('button', { name: '7', exact: true })).toHaveAttribute('aria-pressed', 'false');
    const selectedRpe = await assertReadable(rpe.getByRole('button', { name: '8', exact: true }));
    const unselectedRpe = await readAppearance(rpe.getByRole('button', { name: '7', exact: true }));
    expect(selectedRpe.background).not.toBe(unselectedRpe.background);

    await page.getByRole('button', { name: 'Start set timer', exact: true }).click();
    const timer = page.getByRole('dialog', { name: 'Set timer', exact: true });
    await assertReadableControls(timer);
    await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
    await expect(timer.getByRole('button', { name: 'Pause timer', exact: true })).toBeEnabled();
    await checkSetInteractionStates(page, timer.getByRole('button', { name: 'Complete set', exact: true }), baseline);
    await assertReadableControls(timer);
    await page.screenshot({ path: testInfo.outputPath('running-set-timer.png') });

    await timer.getByRole('button', { name: 'Pause timer', exact: true }).click();
    await expect(timer.getByRole('button', { name: 'Resume timer', exact: true })).toBeEnabled();
    await checkSetInteractionStates(page, timer.getByRole('button', { name: 'Complete set', exact: true }), baseline);
    await timer.getByText('More workout controls', { exact: true }).click();
    const timerRpe = timer.getByRole('group', { name: 'Main-lift RPE' });
    await expect(timerRpe.getByRole('button', { name: '8', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(timerRpe.getByRole('button', { name: '8', exact: true })).toHaveCSS('background-color', selectedRpe.background);
    await assertReadableControls(timer);
    await page.screenshot({ path: testInfo.outputPath('paused-set-timer.png') });

    await timer.getByRole('button', { name: 'Substitute', exact: true }).click();
    const substitute = page.getByRole('dialog', { name: /^Substitute / });
    await expect(substitute).toBeVisible();
    await checkPrimary(substitute.getByRole('button', { name: 'Use substitute', exact: true }));
    await assertReadableControls(substitute);
    await page.screenshot({ path: testInfo.outputPath('substitute-dialog.png') });
    await substitute.getByRole('button', { name: 'Cancel', exact: true }).click();
    await timer.getByRole('button', { name: 'Stop timer', exact: true }).click();

    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    const finish = page.getByRole('dialog', { name: 'Finish this workout?' });
    await expect(finish).toBeVisible();
    await assertReadableControls(finish);
    await finish.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: '← Leave', exact: true }).click();

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('.plan-card.selected').getByRole('button', { name: 'Update plan', exact: true }).click();
    await page.getByLabel('Deadlift max').fill('425');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await assertReadableControls(page);
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Plan updated.' });
    await expect(toast).toBeVisible();
    await assertReadable(toast);
    await page.screenshot({ path: testInfo.outputPath('plan-updated-toast.png') });
  });
}
