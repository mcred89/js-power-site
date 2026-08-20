const base = require('@playwright/test');

const test = base.test.extend({
  expectedConsoleErrors: [[], { option: true }],
  page: async ({ page, expectedConsoleErrors }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(`Page error: ${error.message}`));
    page.on('console', message => {
      const diagnostic = `${message.text()} ${message.location().url || ''}`;
      if (message.type() === 'error' && !expectedConsoleErrors.some(pattern => pattern.test(diagnostic))) {
        errors.push(`Console error: ${message.text()}`);
      }
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
