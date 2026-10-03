const { expect, test } = require('./fixtures');

test('installed app never shows the website install banner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Who is training?')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Install the app' })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
  await expect(page.getByRole('region', { name: 'Install the app' })).toHaveCount(0);
});
