const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(`Page error: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`Console error: ${message.text()}`);
    });

    if (testInfo.project.name === 'pwa-mobile') {
      await page.addInitScript(() => {
        Object.defineProperty(window.navigator, 'standalone', {
          configurable: true,
          get: () => true,
        });
      });
    }

    await use(page);
    base.expect(errors, errors.join('\n')).toEqual([]);
  },
});

module.exports = { expect: base.expect, test };
