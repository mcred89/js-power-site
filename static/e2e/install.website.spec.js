const { expect, test } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  // Control availability deterministically; the real browser decides eligibility.
  await page.addInitScript(() => window.addEventListener('beforeinstallprompt', event => {
    if (event.isTrusted) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }));
});

const offerInstall = (page, outcome = 'accepted', fail = false) => page.evaluate(({ outcome, fail }) => {
  window.installCalls = 0;
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = () => {
    window.installCalls += 1;
    return fail ? Promise.reject(new Error('Unavailable')) : Promise.resolve();
  };
  event.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}, { outcome, fail });

test('offers installation at the top and respects dismissal through reload', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Install the app' });
  await expect(banner).toBeVisible();
  expect((await banner.boundingBox()).y).toBe(0);
  await page.getByRole('button', { name: 'How to install' }).click();
  await expect(banner).toContainText('browser menu');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('install-banner-mobile.png') });
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Build your routine' })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await offerInstall(page);
  await expect(banner).toHaveCount(0);
});

for (const outcome of ['accepted', 'dismissed']) {
  test(`only opens the native dialog on a click and respects ${outcome}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Install the app' })).toBeVisible();
    expect(await offerInstall(page, outcome)).toBe(true);
    await expect(page.getByRole('button', { name: 'Install app', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.installCalls)).toBe(0);
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Install the app' })).toHaveCount(0);
    expect(await page.evaluate(() => window.installCalls)).toBe(1);
  });
}

test('recovers from a rejected install prompt without reusing it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Install the app' })).toBeVisible();
  await offerInstall(page, 'accepted', true);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('The install dialog could not open');
  await expect(page.getByRole('button', { name: 'How to install' })).toBeVisible();
  expect(await page.evaluate(() => window.installCalls)).toBe(1);
});

test('hides the banner when installation happens from browser controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Install the app' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('region', { name: 'Install the app' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Build your routine' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Install the app' })).toHaveCount(0);
});

test('Firefox Android gets menu instructions without a native prompt', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'How to install' }).click();
  await expect(page.getByRole('status')).toContainText('Firefox menu');
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
});

test('banner still works if session storage is blocked', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Blocked'); } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('region', { name: 'Install the app' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Build your routine' })).toBeVisible();
});
